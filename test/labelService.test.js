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
// labelService tests — batching, caching, reentrancy.
//
// The single most important behaviour to lock down is the "snapshot and
// clear" dance in _processPending: requests made *during* an in-flight
// batch must enqueue into a fresh batch instead of being silently
// dropped. The pr-test-analyzer flagged this as exactly the kind of
// cleverness that gets "simplified" and silently regresses.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  isLabelEligible,
  requestLabel,
  __setDoSPARQLForTesting,
  __resetForTesting,
} from '../src/js/services/labelService.js';

// Real ePO authority URIs that the eligibility filter accepts.
const EPO_NOTICE     = 'http://data.europa.eu/a4g/ontology#Notice';
const EPO_LOT        = 'http://data.europa.eu/a4g/ontology#Lot';
const EPO_PROCEDURE  = 'http://data.europa.eu/a4g/ontology#Procedure';
const PUBLICATIONS_AUTH_NOTICE_TYPE =
  'http://publications.europa.eu/resource/authority/notice-type/can-standard';
const CPV =
  'http://data.europa.eu/cpv/45000000';
const NOT_ELIGIBLE = 'http://example.org/not-an-ontology';

// Build a quad fixture mimicking what doSPARQL returns. Each entry is
// `{ subject, predicate, object }` with `value` and `language` on the
// object — the same shape N3 produces.
function quad(subjectUri, predicateUri, label, lang = 'en') {
  return {
    subject: { value: subjectUri },
    predicate: { value: predicateUri },
    object: { value: label, language: lang },
  };
}

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';

// Resolvable promise so tests can control when a stubbed doSPARQL settles.
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  __resetForTesting();
});

// ── eligibility ───────────────────────────────────────────────────

test('isLabelEligible accepts ePO ontology URIs', () => {
  assert.equal(isLabelEligible(EPO_NOTICE), true);
  assert.equal(isLabelEligible(EPO_LOT), true);
  assert.equal(isLabelEligible(EPO_PROCEDURE), true);
});

test('isLabelEligible accepts authority and CPV URIs', () => {
  assert.equal(isLabelEligible(PUBLICATIONS_AUTH_NOTICE_TYPE), true);
  assert.equal(isLabelEligible(CPV), true);
});

test('isLabelEligible rejects URIs from unrecognised namespaces', () => {
  assert.equal(isLabelEligible(NOT_ELIGIBLE), false);
  assert.equal(isLabelEligible('http://example.org/'), false);
});

test('isLabelEligible rejects non-string input', () => {
  assert.equal(isLabelEligible(null), false);
  assert.equal(isLabelEligible(undefined), false);
  assert.equal(isLabelEligible(42), false);
  assert.equal(isLabelEligible({}), false);
});

// ── label resolution priority ─────────────────────────────────────

test('requestLabel resolves to skos:prefLabel @en when present (highest priority)', async () => {
  __setDoSPARQLForTesting(async () => ({
    quads: [
      quad(EPO_NOTICE, SKOS_PREF_LABEL, 'Notice (preferred)', 'en'),
      quad(EPO_NOTICE, RDFS_LABEL, 'Notice (rdfs label)', 'en'),
    ],
  }));

  const label = await new Promise(resolve => requestLabel(EPO_NOTICE, resolve));
  assert.equal(label, 'Notice (preferred)');
});

test('requestLabel falls back to rdfs:label @en when no skos:prefLabel', async () => {
  __setDoSPARQLForTesting(async () => ({
    quads: [
      quad(EPO_NOTICE, RDFS_LABEL, 'Notice (en)', 'en'),
      quad(EPO_NOTICE, RDFS_LABEL, 'Notice (no lang)', ''),
    ],
  }));

  const label = await new Promise(resolve => requestLabel(EPO_NOTICE, resolve));
  assert.equal(label, 'Notice (en)');
});

test('requestLabel falls back to language-less rdfs:label as last resort', async () => {
  __setDoSPARQLForTesting(async () => ({
    quads: [
      quad(EPO_NOTICE, RDFS_LABEL, 'Notice (no lang)', ''),
    ],
  }));

  const label = await new Promise(resolve => requestLabel(EPO_NOTICE, resolve));
  assert.equal(label, 'Notice (no lang)');
});

test('requestLabel resolves to null when no label is found', async () => {
  __setDoSPARQLForTesting(async () => ({ quads: [] }));

  const label = await new Promise(resolve => requestLabel(EPO_NOTICE, resolve));
  assert.equal(label, null);
});

test('requestLabel for an ineligible URI immediately resolves null without querying', async () => {
  let queried = false;
  __setDoSPARQLForTesting(async () => { queried = true; return { quads: [] }; });

  const label = await new Promise(resolve => requestLabel(NOT_ELIGIBLE, resolve));
  assert.equal(label, null);
  assert.equal(queried, false, 'ineligible URIs must not hit the endpoint');
});

// ── caching ───────────────────────────────────────────────────────

test('requestLabel caches successful resolutions', async () => {
  let callCount = 0;
  __setDoSPARQLForTesting(async () => {
    callCount++;
    return { quads: [quad(EPO_NOTICE, SKOS_PREF_LABEL, 'Notice', 'en')] };
  });

  const label1 = await new Promise(resolve => requestLabel(EPO_NOTICE, resolve));
  const label2 = await new Promise(resolve => requestLabel(EPO_NOTICE, resolve));
  assert.equal(label1, 'Notice');
  assert.equal(label2, 'Notice');
  assert.equal(callCount, 1, 'second request should hit the cache');
});

test('requestLabel caches null resolutions (no label exists)', async () => {
  let callCount = 0;
  __setDoSPARQLForTesting(async () => { callCount++; return { quads: [] }; });

  await new Promise(resolve => requestLabel(EPO_NOTICE, resolve));
  await new Promise(resolve => requestLabel(EPO_NOTICE, resolve));
  assert.equal(callCount, 1, 'second null lookup should hit the cache');
});

test('requestLabel does NOT cache failed batches — failed URIs retry next time', async () => {
  let callCount = 0;
  __setDoSPARQLForTesting(async () => {
    callCount++;
    if (callCount === 1) throw new Error('endpoint down');
    return { quads: [quad(EPO_NOTICE, SKOS_PREF_LABEL, 'Notice', 'en')] };
  });

  // First call fails, callback gets null.
  const first = await new Promise(resolve => requestLabel(EPO_NOTICE, resolve));
  assert.equal(first, null);

  // Second call should retry (not hit a poisoned cache entry) and succeed.
  const second = await new Promise(resolve => requestLabel(EPO_NOTICE, resolve));
  assert.equal(second, 'Notice');
  assert.equal(callCount, 2, 'failed batches must not poison the cache');
});

// ── batching reentrancy: the snapshot-and-clear dance ─────────────
//
// The reentrancy tests below are REAL-TIME COUPLED to labelService's
// BATCH_DELAY_MS constant (currently 100ms). We wait 150ms after a request
// to be sure the batch timer has fired, giving a ~50ms slack on a loaded
// CI runner. If these tests ever flake under load, the fix is either:
//   1. Bump the wait to ~300ms (easy, but makes the suite slower)
//   2. Add an `__advanceBatchTimerForTesting()` hook to labelService and
//      drive the timer deterministically from the test (cleaner, but
//      adds a test-only surface to production code)
// Option 2 is the right long-term answer if we see actual flakes.

test('reentrancy: requests made during an in-flight batch enqueue a fresh batch', async () => {
  // Set up a doSPARQL stub that records each invocation's URI list and
  // returns from a controllable deferred. The first call returns labels
  // for [EPO_NOTICE], the second for [EPO_LOT].
  const calls = [];
  const responses = [
    deferred(),
    deferred(),
  ];
  __setDoSPARQLForTesting((query) => {
    // The query body lists the URIs inside `VALUES ?uri { <a> <b> }`.
    // Match only that block (not the PREFIX declarations above it).
    const valuesMatch = query.match(/VALUES \?uri \{([^}]*)\}/);
    const uris = valuesMatch
      ? [...valuesMatch[1].matchAll(/<([^>]+)>/g)].map(m => m[1])
      : [];
    calls.push(uris);
    return responses[calls.length - 1].promise;
  });

  // First request — kicks off a 100ms batch timer.
  let label1Resolved = null;
  requestLabel(EPO_NOTICE, (label) => { label1Resolved = label; });

  // Wait for the batch timer to fire and the first SPARQL call to be made.
  // We can't easily fast-forward node's setTimeout, so we use a real wait.
  await new Promise(r => setTimeout(r, 150));
  assert.equal(calls.length, 1, 'first batch should have fired');
  assert.deepEqual(calls[0], [EPO_NOTICE]);

  // Now — while the first batch is still in flight (we haven't resolved
  // its deferred yet) — make a second request for a different URI.
  // The snapshot-and-clear dance means this should enqueue into a FRESH
  // pendingRequests map and schedule a new batch, NOT get silently
  // dropped or merged into the in-flight one.
  let label2Resolved = null;
  requestLabel(EPO_LOT, (label) => { label2Resolved = label; });

  // Resolve the first batch.
  responses[0].resolve({
    quads: [quad(EPO_NOTICE, SKOS_PREF_LABEL, 'Notice (en)', 'en')],
  });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(label1Resolved, 'Notice (en)');

  // Wait for the second batch timer to fire.
  await new Promise(r => setTimeout(r, 150));
  assert.equal(calls.length, 2, 'second batch should have fired after the first resolved');
  assert.deepEqual(calls[1], [EPO_LOT], 'second batch should contain the URI requested during the wait');

  // Resolve the second batch.
  responses[1].resolve({
    quads: [quad(EPO_LOT, SKOS_PREF_LABEL, 'Lot (en)', 'en')],
  });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(label2Resolved, 'Lot (en)');
});

test('reentrancy: identical URI requested twice while in-flight resolves both callbacks', async () => {
  // Two callbacks queued for the same URI before the batch fires should
  // both be invoked when the result arrives.
  const d = deferred();
  __setDoSPARQLForTesting(() => d.promise);

  let cb1, cb2;
  requestLabel(EPO_NOTICE, (label) => { cb1 = label; });
  requestLabel(EPO_NOTICE, (label) => { cb2 = label; });

  // Wait for the batch to fire.
  await new Promise(r => setTimeout(r, 150));
  d.resolve({ quads: [quad(EPO_NOTICE, SKOS_PREF_LABEL, 'Notice', 'en')] });
  await new Promise(r => setTimeout(r, 50));

  assert.equal(cb1, 'Notice');
  assert.equal(cb2, 'Notice');
});
