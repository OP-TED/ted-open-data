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

import { shortLabel } from './namespaces.js';

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
  if (facet.type === 'named-node') return shortLabel(facet.term.value);
  return '';
}

// The SPARQL query that backs a facet, ready to send to the endpoint.
// Throws for unknown facet types so the Symbol fallback in facetEquals
// actually kicks in (a malformed facet compares unequal to every other
// facet, including another differently-malformed one, so they can't
// silently collapse in addUnique).
function getQuery(facet) {
  if (!facet) return null;
  if (facet.type === 'query') return facet.query;
  if (facet.type === 'notice-number') return _noticeByPublicationNumberQuery(facet.value);
  if (facet.type === 'named-node') return _describeTermQuery(facet.term);
  throw new Error(`Unknown facet type: ${facet.type}`);
}

function _noticeByPublicationNumberQuery(publicationNumber) {
  return `PREFIX epo: <http://data.europa.eu/a4g/ontology#>

CONSTRUCT { ?s ?p ?o }
WHERE {
  graph ?g {
    ?s ?p ?o .
    ?notice epo:hasNoticePublicationNumber "${publicationNumber}"
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
function _describeTermQuery(term) {
  if (!_isSafeUri(term?.value)) {
    throw new Error(`Unsafe URI for DESCRIBE: ${JSON.stringify(term?.value)}`);
  }
  return `DEFINE sql:describe-mode "CBD"
DESCRIBE <${term.value}>`;
}

// ── List operations ──

// Two facets are considered equal when their SPARQL queries are identical.
// A Symbol fallback makes sure a broken facet (e.g. malformed URL) never
// accidentally equals another broken facet.
function facetEquals(a, b) {
  const safeQuery = (f) => {
    try { return getQuery(f); } catch { return Symbol('invalid'); }
  };
  return safeQuery(a) === safeQuery(b);
}

// Add a facet to a list if it's not already there. Returns both the new list
// and the final index of the facet (pre-existing or newly appended).
function addUnique(facets, newFacet) {
  const existingIndex = facets.findIndex(f => facetEquals(f, newFacet));
  if (existingIndex >= 0) return { facets, index: existingIndex };
  return { facets: [...facets, newFacet], index: facets.length };
}

// ── Validation ──

// Boundary validator for facets coming from untrusted sources (URL params,
// sessionStorage). Returns a cleaned-up copy of the facet or null. The
// checks are stricter than "has a value field": notice-number values must
// match the publication-number format, named-node URIs must be safe
// strings, query strings must be non-empty.
function validateFacet(data) {
  if (!data || typeof data !== 'object' || !data.type) return null;

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
  addUnique,
  createPublicationNumberFacet,
  facetEquals,
  getLabel,
  getQuery,
  normalize,
  validateFacet,
};
