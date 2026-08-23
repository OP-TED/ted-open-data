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
// Facet logic: creation, labelling, querying, validation.
//
// A facet is a persistent description of a query the user can navigate to.
// Three kinds are supported:
//
//   notice-number — { type: 'notice-number', value: 'XXXXXXXX-YYYY' }
//   named-node    — { type: 'named-node',    term: { termType: 'NamedNode', value: <URI> } }
//   query         — { type: 'query',         query: '<raw SPARQL string>' }
//
// Each also carries a `timestamp` field used for ordering and uniqueness.

import { resourceIdentifier, resourceUuid, shortLabel } from './utils/namespaces.js';

// ── Publication number normalisation ──

// TED publication numbers are "NNNNNNNN-YYYY" — 1-8 digits, hyphen, 4-digit year.
// The previous Zod schema enforced this shape; the rewrite now enforces it here.
const PUBLICATION_NUMBER_PATTERN = /^\s*(\d{1,8})-(\d{4})\s*$/;

// Characters that must never appear in a URI interpolated into a SPARQL
// query. `<` and `>` would break out of the angle-bracket IRI literal; `"`
// would break out of a string literal; `\` enables escape sequences;
// whitespace and control characters are invalid in IRIs per the RDF spec.
// Used by both validateFacet (URL/sessionStorage boundary) and
// _describeTermQuery (interpolation boundary for click-time facets).
const FORBIDDEN_URI_CHARS = /[<>"\\\s\x00-\x1f\x7f]/;

function _isSafeUri(value) {
  return typeof value === 'string'
    && value.length > 0
    && !FORBIDDEN_URI_CHARS.test(value);
}

// Zero-pad publication numbers to 8 digits so that "12345-2024" and
// "00012345-2024" hash to the same facet. Returns null for input that
// doesn't match the format so callers can reject garbage at the boundary.
function normalize(publicationNumber) {
  if (typeof publicationNumber !== 'string') return null;
  const match = publicationNumber.match(PUBLICATION_NUMBER_PATTERN);
  if (!match) return null;
  const [, number, year] = match;
  return `${number.padStart(8, '0')}-${year}`;
}

function createPublicationNumberFacet(publicationNumber) {
  const normalized = normalize(publicationNumber);
  if (!normalized) return null;
  return {
    type: 'notice-number',
    value: normalized,
    timestamp: Date.now(),
  };
}

// ── Facet → label and SPARQL query ──

// Human-readable label for a facet. Used in the breadcrumb, the Data card
// title and the History dropdown.
function getLabel(facet) {
  if (!facet) return '';
  if (facet.type === 'query') return 'Query';
  if (facet.type === 'notice-number') return facet.value;
  if (facet.type === 'named-node') {
    // An ePO resource URI carries a class name the mapping wrote into it,
    // which the ontology need not recognise, so it is never shown (issue
    // #74). The name comes from the types the resource declares and travels
    // on the facet; the identifier still comes from the URI, which is where
    // it belongs. Same halves as the badge, same rule for a missing one, so
    // the heading and the badge below it read alike. URIs of any other shape
    // have no class name embedded in them and are shown as they are.
    const uuid = resourceUuid(facet.term.value);
    if (!uuid) return shortLabel(facet.term.value);
    const identifier = resourceIdentifier(facet.term.value) || (facet.typeName ? '' : uuid);
    return [facet.typeName, identifier].filter(Boolean).join(' ');
  }
  return '';
}

// The SPARQL query that backs a facet, ready to send to the endpoint.
// Throws for unknown facet types so the Symbol fallback in facetEquals
// actually kicks in (a malformed facet compares unequal to every other
// facet, including another differently-malformed one, so they can't
// silently collapse in addUnique).
function getQuery(facet, { noticeNumber } = {}) {
  if (!facet) return null;
  if (facet.type === 'query') return facet.query;
  if (facet.type === 'notice-number') return _noticeByPublicationNumberQuery(facet.value);
  if (facet.type === 'named-node') return _describeTermQuery(facet.term, noticeNumber);
  throw new Error(`Unknown facet type: ${facet.type}`);
}

function _noticeByPublicationNumberQuery(publicationNumber) {
  // Defence-in-depth: normalize() already restricts to digits + hyphen,
  // but validate at the interpolation boundary to match _describeTermQuery.
  if (!/^\d{8}-\d{4}$/.test(publicationNumber)) {
    throw new Error(`Invalid publication number at query boundary: ${publicationNumber}`);
  }
  return `PREFIX epo: <http://data.europa.eu/a4g/ontology#>

CONSTRUCT { ?s ?p ?o }
WHERE {
  graph ?g {
    ?s ?p ?o .
    ?notice epo:hasNoticePublicationNumber "${publicationNumber}"
  }
}`;
}

// ePO 3 fallback query. ePO 3 notices (mapped from the legacy XML forms)
// do NOT carry epo:hasNoticePublicationNumber — the primary query above
// returns nothing for them. Instead they store the publication number as
// an identifier value reached via epo:hasID, formatted as
// "YYYY/S <ojs-issue>-<number>" (e.g. "2023/S 191-597014").
//
// Two segments of that string are not derivable from the app's
// "NNNNNNNN-YYYY" publication number:
//   - the OJS issue number (191) — wildcarded with [0-9]{1,4}
//   - leading zeros on the number — the identifier value is not
//     zero-padded, so we strip the pub number's padding and allow
//     optional zeros with 0*
// Both ends are anchored (^…$) so "597014" cannot also match "5970140".
//
// This is deliberately the SECOND query tried (see
// ExplorerController._executeCurrentQuery): the REGEX-over-identifier-values
// scan is ~3-4x slower than the ePO 4 exact match, so ePO 4 notices must
// never pay its cost. Only notices the fast query could not find fall
// through to here.
function noticeByPublicationNumberQueryEpo3(publicationNumber) {
  if (!/^\d{8}-\d{4}$/.test(publicationNumber)) {
    throw new Error(`Invalid publication number at query boundary: ${publicationNumber}`);
  }
  const [number, year] = publicationNumber.split('-');
  // Strip leading zeros; guard the all-zeros edge case so we never emit
  // an empty alternation that would match every value.
  const bareNumber = number.replace(/^0+/, '') || '0';
  return `PREFIX epo: <http://data.europa.eu/a4g/ontology#>

CONSTRUCT { ?s ?p ?o }
WHERE {
  graph ?g {
    ?s ?p ?o .
    ?notice a epo:Notice ;
            epo:hasID ?id .
    ?id epo:hasIdentifierValue ?idValue .
    FILTER(REGEX(?idValue, "^${year}/S [0-9]{1,4}-0*${bareNumber}$"))
  }
}`;
}

// Belt-and-braces: facets built at click-time (TermRenderer's click handler,
// BacklinksView's subject badge click handler) don't go through validateFacet
// because they come from server-trusted SPARQL responses. That's fine in
// practice — endpoint output is not user input — but the URI is still
// interpolated directly into a DESCRIBE query, so we apply the same
// FORBIDDEN_URI_CHARS check here at the point of interpolation. Any URI
// that would let `>` or quote characters break out of the IRI literal
// gets thrown before the query is built.
const EPO_RESOURCE_BASE = 'http://data.europa.eu/a4g/resource/';

function _describeTermQuery(term, noticeNumber) {
  if (!_isSafeUri(term?.value)) {
    throw new Error(`Unsafe URI for DESCRIBE: ${JSON.stringify(term?.value)}`);
  }
  // Graph-scope only data resource URIs (subjects within a notice graph).
  // Ontology terms, vocabulary URIs, and other non-resource URIs use the
  // unscoped DESCRIBE so they return their full definition across all graphs.
  const isDataResource = term.value.startsWith(EPO_RESOURCE_BASE);
  if (isDataResource && noticeNumber && /^\d{8}-\d{4}$/.test(noticeNumber)) {
    return `PREFIX epo: <http://data.europa.eu/a4g/ontology#>

CONSTRUCT {
  <${term.value}> ?p ?o .
  ?o ?p2 ?o2 .
}
WHERE {
  GRAPH ?g {
    ?notice epo:hasNoticePublicationNumber "${noticeNumber}" .
    <${term.value}> ?p ?o .
    OPTIONAL { FILTER(isBlank(?o)) ?o ?p2 ?o2 . }
  }
}`;
  }
  return `DEFINE sql:describe-mode "CBD"
DESCRIBE <${term.value}>`;
}

// ── List operations ──

// Two facets are considered equal when their SPARQL queries are
// identical. A Symbol fallback makes sure a broken facet (e.g.
// malformed URL, unknown facet type) never accidentally equals
// another broken facet — a getQuery throw returns a fresh Symbol,
// which only compares equal to itself. A warning logs on the first
// failure per session so a developer watching history dedup can
// see that a facet is considered "never equal to anything".
let _facetEqualsWarned = false;
function facetEquals(a, b) {
  const safeQuery = (f) => {
    try {
      return getQuery(f);
    } catch (err) {
      if (!_facetEqualsWarned) {
        console.warn('[facets] facetEquals received a facet getQuery could not build:', f, err);
        _facetEqualsWarned = true;
      }
      return Symbol('invalid');
    }
  };
  return safeQuery(a) === safeQuery(b);
}

// Add a facet to a list, or bump it to the end if it already exists.
// Returns both the updated list and the final index of the facet.
//
// When a duplicate is found, the entry is moved to the end of the
// list (the "most recent" position) rather than staying in its
// original slot. The history dropdown reverses the list, so
// bumping-to-end means re-running an old notice brings it back to
// the top of "Most recent first" — which is what the label promises.
// The existing entry's enrichment metadata (publicationDate,
// noticeType, buyerCountry, etc.) is preserved via a merge with
// the incoming facet so timeline data is not lost.
function addUnique(facets, newFacet) {
  const existingIndex = facets.findIndex(f => facetEquals(f, newFacet));
  if (existingIndex >= 0) {
    // Merge: keep enrichment from the existing entry, update
    // timestamp from the new one (the new search is the most recent).
    const merged = { ...facets[existingIndex], ...newFacet };
    const updated = [
      ...facets.slice(0, existingIndex),
      ...facets.slice(existingIndex + 1),
      merged,
    ];
    return { facets: updated, index: updated.length - 1 };
  }
  return { facets: [...facets, newFacet], index: facets.length };
}

// ── Validation ──

// Fields recording how a resource was navigated to, attached by tree clicks
// and read back by DataView to rebuild the property path on the SPARQL
// reference card. They describe a live exploration and are deliberately left
// out of shareable URLs, so anything arriving over one is forged.
//
// This matters because `viaRootPattern` is a ready-made SPARQL fragment that
// the card interpolates verbatim and offers for copying. A crafted ?facet=
// could therefore put a SERVICE clause pointing at an attacker's endpoint in
// front of a recipient, presented as the app's own suggested query. The other
// two are less dangerous — path elements are re-rendered through
// _shrinkOrBracket and come back bracketed — but none of the three has any
// business crossing this boundary.
//
// When route sharing is implemented, it should serialise validated IRIs and
// type URIs and rebuild the pattern locally. No transported field should ever
// contain executable SPARQL.
const SESSION_ONLY_FIELDS = ['viaPath', 'viaRoot', 'viaRootPattern', 'typeName'];

// Boundary validator for facets coming from untrusted sources (URL params,
// sessionStorage). Returns a cleaned-up copy of the facet or null. The
// checks are stricter than "has a value field": notice-number values must
// match the publication-number format, named-node URIs must be safe
// strings, query strings must be non-empty.
function validateFacet(data) {
  if (!data || typeof data !== 'object' || !data.type) return null;

  // Spreading `data` below preserves fields this validator does not know
  // about, which is what lets a forged one through. Drop the session-only
  // ones before anything else looks at them.
  for (const field of SESSION_ONLY_FIELDS) {
    if (field in data) {
      data = { ...data };
      for (const f of SESSION_ONLY_FIELDS) delete data[f];
      break;
    }
  }

  if (data.type === 'notice-number') {
    const normalized = normalize(data.value);
    if (!normalized) return null;
    return { ...data, value: normalized, timestamp: data.timestamp || Date.now() };
  }
  if (data.type === 'named-node') {
    if (!_isSafeUri(data.term?.value)) return null;
    return {
      ...data,
      term: { termType: 'NamedNode', value: data.term.value },
      timestamp: data.timestamp || Date.now(),
    };
  }
  if (data.type === 'query') {
    if (typeof data.query !== 'string' || data.query.trim().length === 0) return null;
    return { ...data, timestamp: data.timestamp || Date.now() };
  }
  return null;
}

export {
  _isSafeUri as isSafeUri,
  addUnique,
  createPublicationNumberFacet,
  facetEquals,
  getLabel,
  getQuery,
  noticeByPublicationNumberQueryEpo3,
  normalize,
  validateFacet,
};
