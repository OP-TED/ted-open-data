/*
 * Copyright 2026 European Union
 *
 * Licensed under the EUPL, Version 1.2 or - as soon they will be approved by the European
 * Commission - subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */
// Label resolution service with batching and caching.
//
// Many URIs on the page need a human-readable label. Instead of firing a
// separate query per URI, callers use requestLabel() which groups requests
// into batches and runs a single CONSTRUCT query for the whole batch.
//
// A label is selected by priority:
//   1. skos:prefLabel @en
//   2. rdfs:label     @en
//   3. rdfs:label     (no language tag)
//
// Intentional non-defence against the stale-response race:
// Unlike _executeCurrentQuery / _fetchData / _loadBatch, this service does
// NOT use a request-token guard. If the user navigates away while a label
// batch is in flight, the late response still populates the cache. This
// is intentional and benign — a label for a URI not currently on screen
// is written to a cache keyed by URI, so nothing renders incorrectly; at
// worst the entry becomes a small wasted cache slot. Adding token guards
// here would complicate the batching/dedup logic without fixing any
// observable bug.

import { isSafeUri } from '../facets.js';
import { ns } from '../utils/namespaces.js';
import { doSPARQL as defaultDoSPARQL } from './sparqlService.js';

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 100;

// Additional URI prefixes that are likely to have labels in the endpoint but
// are not part of any ontology namespace in our `ns` map.
const ADDITIONAL_PREFIXES = [
  'http://publications.europa.eu/resource/authority/',
  'http://data.europa.eu/cpv',
];

const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

const eligiblePrefixes = [...Object.values(ns), ...ADDITIONAL_PREFIXES];

// Module state
const labelCache = new Map();
const pendingRequests = new Map(); // uri → callback[]
let batchTimer = null;
// Indirect call so tests can inject a stub via __setDoSPARQLForTesting().
let _doSPARQL = defaultDoSPARQL;

function isLabelEligible(uri) {
  if (typeof uri !== 'string') return false;
  return eligiblePrefixes.some(prefix => uri.startsWith(prefix));
}

// Request a label for a URI. The callback is invoked with the resolved label
// (or null). Request is batched with other pending requests; batches either
// reach BATCH_SIZE or wait up to BATCH_DELAY_MS before firing.
function requestLabel(uri, callback) {
  if (!isLabelEligible(uri)) {
    callback(null);
    return;
  }

  const cached = labelCache.get(uri);
  if (cached !== undefined) {
    callback(cached);
    return;
  }

  if (!pendingRequests.has(uri)) pendingRequests.set(uri, []);
  pendingRequests.get(uri).push(callback);

  _scheduleBatch();
}

function _scheduleBatch() {
  if (batchTimer) clearTimeout(batchTimer);

  if (pendingRequests.size >= BATCH_SIZE) {
    _processPending();
  } else {
    batchTimer = setTimeout(_processPending, BATCH_DELAY_MS);
  }
}

async function _processPending() {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }

  const uris = Array.from(pendingRequests.keys());
  if (uris.length === 0) return;

  // Snapshot and clear so that new requests made during the await below
  // queue a fresh batch rather than getting silently dropped.
  const callbacks = new Map(pendingRequests);
  pendingRequests.clear();

  // Split into chunks of BATCH_SIZE and run them in parallel.
  const batches = [];
  for (let i = 0; i < uris.length; i += BATCH_SIZE) {
    batches.push(uris.slice(i, i + BATCH_SIZE));
  }
  const batchResults = await Promise.all(batches.map(_fetchBatch));

  // Merge all batches into a single map, keeping track of which URIs came
  // back from a successful batch (`ok: true`) and which belonged to a
  // failed batch. Only successful entries are cached — failed ones are
  // left uncached so that the next requestLabel() for the same URI retries
  // instead of being permanently poisoned to "no label".
  const merged = new Map();      // uri → label | null  (from successful batches)
  const failedUris = new Set();  // URIs whose batch failed
  for (const batchResult of batchResults) {
    if (batchResult.ok) {
      for (const [uri, label] of batchResult.results) merged.set(uri, label);
    } else {
      for (const uri of batchResult.uris) failedUris.add(uri);
    }
  }

  callbacks.forEach((callbackList, uri) => {
    if (failedUris.has(uri)) {
      // Failed batch: invoke callbacks with null so the UI shows the
      // fallback label, but do NOT cache — next request retries.
      callbackList.forEach(cb => cb(null));
      return;
    }
    const label = merged.get(uri) ?? null;
    labelCache.set(uri, label);
    callbackList.forEach(cb => cb(label));
  });
}

// Returns { ok: true, results } on success, { ok: false, uris } on
// failure. Callers distinguish so failed URIs don't get cached as
// permanent nulls.
//
// A persistently failing label endpoint is invisible to the user
// (the UI just shows the short prefix:localname form, which is
// indistinguishable from "no label exists"). To give a developer
// watching the console something to notice, log the first failure
// loudly and then downgrade to quieter warnings on subsequent ones.
let _labelServiceFailuresLogged = 0;
async function _fetchBatch(uris) {
  try {
    const { quads } = await _doSPARQL(_buildLabelsQuery(uris));
    return { ok: true, results: _parseResults(quads, uris) };
  } catch (error) {
    _labelServiceFailuresLogged++;
    if (_labelServiceFailuresLogged === 1) {
      console.error(
        `[labelService] First label batch failed (${uris.length} URIs). ` +
        `Short-form labels will be used until it recovers. First URI: ${uris[0]}`,
        error,
      );
    } else if (_labelServiceFailuresLogged % 10 === 0) {
      console.warn(`[labelService] ${_labelServiceFailuresLogged} label batches have now failed.`);
    }
    return { ok: false, uris };
  }
}

function _buildLabelsQuery(uris) {
  // Defence-in-depth: even though URIs come from parsed RDF and are
  // almost certainly safe, drop any that contain characters that
  // could break out of the IRI wrapper. Matches the check in
  // facets._describeTermQuery on the interpolation boundary.
  const safe = uris.filter(isSafeUri);
  const values = safe.map(uri => `<${uri}>`).join(' ');
  return `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

    CONSTRUCT {
      ?uri skos:prefLabel ?prefLabel .
      ?uri rdfs:label ?label .
    }
    WHERE {
      VALUES ?uri { ${values} }
      { ?uri skos:prefLabel ?prefLabel . FILTER (lang(?prefLabel) = "en") }
      UNION
      { ?uri rdfs:label ?label . FILTER (lang(?label) = "en") }
      UNION
      { ?uri rdfs:label ?label . FILTER (lang(?label) = "") }
    }`;
}

// Score quads by the label priority and return a Map<uri, label | null>
// covering every requested URI.
function _parseResults(quads, requestedUris) {
  const labelsByUri = new Map();

  for (const quad of quads) {
    const uri = quad.subject.value;
    const label = quad.object.value;
    const lang = quad.object.language || '';

    if (!labelsByUri.has(uri)) {
      labelsByUri.set(uri, { skosPrefLabel: null, rdfsLabelEn: null, rdfsLabelNoLang: null });
    }
    const bucket = labelsByUri.get(uri);

    if (quad.predicate.value === SKOS_PREF_LABEL && lang === 'en') {
      bucket.skosPrefLabel = label;
    } else if (quad.predicate.value === RDFS_LABEL) {
      if (lang === 'en') bucket.rdfsLabelEn = label;
      else if (lang === '') bucket.rdfsLabelNoLang = label;
    }
  }

  const results = new Map();
  for (const uri of requestedUris) {
    const bucket = labelsByUri.get(uri);
    results.set(
      uri,
      bucket ? (bucket.skosPrefLabel || bucket.rdfsLabelEn || bucket.rdfsLabelNoLang || null) : null
    );
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────
// Test-only hooks. The labelService uses module-level state so test
// isolation requires an explicit reset; the doSPARQL setter lets tests
// inject a stub. Production code should never touch these.
function __setDoSPARQLForTesting(stub) {
  _doSPARQL = stub || defaultDoSPARQL;
}
function __resetForTesting() {
  labelCache.clear();
  pendingRequests.clear();
  if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
  _doSPARQL = defaultDoSPARQL;
}

export {
  isLabelEligible,
  requestLabel,
  __setDoSPARQLForTesting,
  __resetForTesting,
};
