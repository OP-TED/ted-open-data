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
// The SPARQL reference card promises "use the following in your SPARQL
// query". This file holds it to that promise, for every shape of resource the
// tree can render — by handing what the card offers to a real SPARQL parser
// rather than comparing it against a string somebody expected.
//
// Two things have to hold, and the second is the one string comparison keeps
// missing: what the card offers must PARSE, and the prefixes it declares must
// COVER what its rows use. A Path that walks epo: predicates to a skos:
// Concept needs both declared; a card that only declares the target's own
// prefix hands the user something that fails the moment they paste it into an
// empty query.
//
// Each case below is a resource shape, not a fix for a reported bug, so the
// matrix keeps covering combinations nobody has thought to report yet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Parser } from 'sparqljs';
import './_helpers.js';
import { TreeRenderer } from '../src/js/TreeRenderer.js';

const EPO   = 'http://data.europa.eu/a4g/ontology#';
const SKOS  = 'http://www.w3.org/2004/02/skos/core#';
const M8G   = 'http://data.europa.eu/m8g/';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

const NOTICE   = 'http://data.europa.eu/a4g/resource/id_x_Notice';
const REVIEWER = 'http://data.europa.eu/a4g/resource/id_x_Reviewer_3qDo';
const CONCEPT  = 'http://publications.europa.eu/resource/authority/cpv/45000000';

const NOTICE_ANCHOR = '?notice a epo:Notice';

// ── harness ─────────────────────────────────────────────────────────

function namedNode(value) { return { termType: 'NamedNode', value }; }
function blankNode(value) { return { termType: 'BlankNode', value }; }
function quad(subject, predicate, object) {
  return { subject, predicate: namedNode(predicate), object };
}

// Render the card for one resource, in the state a given navigation would
// leave the renderer in.
function card({ subject, blank = false, types = [], chain = [], anchor = null }) {
  const r = new TreeRenderer({ innerHTML: '', appendChild() {} });
  const subjectTerm = blank ? blankNode(subject) : namedNode(subject);

  const quads = types.length
    ? types.map(t => quad(subjectTerm, RDF_TYPE, namedNode(t)))
    : [quad(subjectTerm, `${EPO}someProperty`, { termType: 'Literal', value: 'x' })];

  r.subjectIndex = r._buildIndex(quads);
  r._navigatedSubject = subject;
  r._pathFromRoot = chain;
  r._rootPattern = anchor;

  return r._buildInfoRows(subject, r.subjectIndex.get(subject));
}

const unescape = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// The values the copy buttons actually put on the clipboard — what the user
// ends up pasting, rather than what the card happens to display.
function rowsOf(html) {
  const re = /<span class="tree-info-label">([^<]*)<\/span><button class="tree-info-copy-inline" data-copy="([^"]*)"/g;
  const rows = [];
  let m;
  while ((m = re.exec(html)) !== null) rows.push({ label: m[1], value: unescape(m[2]) });
  return rows;
}

const valuesFor = (rows, label) => rows.filter(r => r.label === label).map(r => r.value);

function parses(query) {
  try {
    new Parser().parse(query);
    return null;
  } catch (err) {
    return err.message;
  }
}

// The card's central promise: its declarations plus any one of its patterns
// form a query that parses on its own, with nothing else supplied.
function assertCardIsUsable(html, description) {
  const rows = rowsOf(html);
  const prefixes = valuesFor(rows, 'Prefix').join('\n');

  for (const path of valuesFor(rows, 'Path')) {
    const query = `${prefixes}\nSELECT * WHERE { ${path} }`;
    assert.equal(parses(query), null, `${description} — Path does not parse:\n${query}`);
  }

  for (const name of valuesFor(rows, 'Name')) {
    const query = `${prefixes}\nSELECT * WHERE { ?s a ${name} }`;
    assert.equal(parses(query), null, `${description} — Name does not parse:\n${query}`);
  }

  for (const iri of valuesFor(rows, 'IRI')) {
    const query = `${prefixes}\nSELECT * WHERE { ${iri} ?p ?o }`;
    assert.equal(parses(query), null, `${description} — IRI does not parse:\n${query}`);
  }

  return rows;
}


// Parse what the card offers and inspect the result, rather than grepping the
// text. A hostile URI keeps its scary-looking words after percent-encoding —
// "SERVICE" survives inside <…%20SERVICE%20…> — but as inert characters in a
// single IRI. What must never happen is those words becoming query structure,
// so the assertion is about the shape the parser produces.
function assertNoExtraClauses(rows, description) {
  const prefixes = valuesFor(rows, 'Prefix').join('\n');
  const patterns = [
    ...valuesFor(rows, 'Path'),
    ...valuesFor(rows, 'Name').map(n => `?typed a ${n} .`),
    ...valuesFor(rows, 'IRI').map(i => `${i} ?p ?o .`),
  ];

  for (const pattern of patterns) {
    const query = `${prefixes}\nSELECT * WHERE { ${pattern} }`;
    const parsed = new Parser().parse(query);
    const kinds = [...new Set(parsed.where.map(w => w.type))];
    assert.deepEqual(kinds, ['bgp'], `${description}: expected only triple patterns, got ${kinds}`);
  }

  // Every IRI the card offers has to be exactly one IRIREF — nothing that
  // closes its own brackets and starts something new.
  for (const iri of valuesFor(rows, 'IRI')) {
    assert.match(iri, /^<[^<>\s]*>$/, `${description}: the IRI row is a single IRIREF`);
  }
}

// ── the harness has to be able to fail ──────────────────────────────

test('the parser rejects the mistakes this suite exists to catch', () => {
  assert.notEqual(parses('SELECT * WHERE { <urn:a> ; epo:x ?v }'), null, 'leading semicolon');
  assert.notEqual(parses('SELECT * WHERE { ?s a http://example.org/T }'), null, 'unbracketed IRI');
  assert.notEqual(parses('SELECT * WHERE { ?some-Type a ?t }'), null, 'illegal variable name');
  assert.notEqual(parses('SELECT * WHERE { ?s epo:x ?v }'), null, 'undeclared prefix');
  assert.equal(parses('PREFIX epo: <http://data.europa.eu/a4g/ontology#>\nSELECT * WHERE { ?s epo:x ?v }'), null);
});

// ── the resource shapes the tree can render ─────────────────────────

const CASES = [
  {
    name: 'typed resource at the start of an exploration',
    input: { subject: NOTICE, types: [`${EPO}Notice`] },
  },
  {
    name: 'one hop walked from a notice',
    input: { subject: REVIEWER, types: [`${EPO}Reviewer`], chain: [`${EPO}announcesRole`], anchor: NOTICE_ANCHOR },
  },
  {
    name: 'several hops walked from a notice',
    input: {
      subject: REVIEWER, types: [`${EPO}Reviewer`], anchor: NOTICE_ANCHOR,
      chain: [`${EPO}announcesRole`, `${EPO}playedBy`, `${EPO}hasLegalName`],
    },
  },
  {
    name: 'route ending at a term from a different vocabulary',
    // The reported case: an ePO anchor and ePO predicates landing on a
    // skos:Concept. Two prefixes are in play and both must be declared.
    input: {
      subject: CONCEPT, types: [`${SKOS}Concept`], anchor: NOTICE_ANCHOR,
      chain: [`${EPO}refersToLot`, `${EPO}hasPurpose`, `${EPO}hasMainClassification`],
    },
    expect: (rows) => {
      const declared = valuesFor(rows, 'Prefix').join(' ');
      assert.ok(declared.includes('PREFIX epo:'), 'epo declared for the path');
      assert.ok(declared.includes('PREFIX skos:'), 'skos declared for the type');
    },
  },
  {
    name: 'route mixing vocabularies within the chain itself',
    input: {
      subject: REVIEWER, types: [`${EPO}Reviewer`], anchor: NOTICE_ANCHOR,
      chain: [`${EPO}announcesRole`, `${M8G}address`, `${SKOS}prefLabel`],
    },
    expect: (rows) => {
      const declared = valuesFor(rows, 'Prefix').join(' ');
      for (const p of ['epo', 'm8g', 'skos']) {
        assert.ok(declared.includes(`PREFIX ${p}:`), `${p} declared`);
      }
    },
  },
  {
    name: 'anchor that is an IRI rather than a variable binding',
    input: { subject: REVIEWER, types: [`${EPO}Reviewer`], chain: [`${EPO}announcesRole`], anchor: `<${NOTICE}>` },
  },
  {
    name: 'resource with several declared types',
    input: { subject: NOTICE, types: [`${EPO}Notice`, `${EPO}CompetitionNotice`, `${EPO}Notice16`] },
  },
  {
    name: 'untyped resource',
    input: { subject: REVIEWER },
  },
  {
    name: 'untyped blank node',
    input: { subject: 'b0_b0', blank: true },
    expect: (rows) => {
      assert.equal(valuesFor(rows, 'Path').length, 0, 'nothing to offer, so nothing offered');
      assert.equal(valuesFor(rows, 'IRI').length, 0, 'a blank label is not an IRI');
    },
  },
  {
    name: 'typed blank node',
    input: { subject: 'b1_b1', blank: true, types: [`${EPO}Reviewer`] },
    expect: (rows) => {
      assert.equal(valuesFor(rows, 'Path').length, 1, 'a type is enough to match on');
      assert.equal(valuesFor(rows, 'IRI').length, 0);
    },
  },
  {
    name: 'type from a namespace the app does not know',
    input: { subject: REVIEWER, types: ['http://example.org/Some-Type'] },
  },
  {
    name: 'known namespace whose local part contains a slash',
    input: { subject: REVIEWER, types: ['http://schema.org/foo/bar'] },
  },
  {
    name: 'known namespace whose local part contains a space',
    input: { subject: REVIEWER, types: ['http://purl.org/dc/terms/a b'] },
  },
  {
    name: 'local part ending in a dot',
    input: { subject: REVIEWER, types: ['http://schema.org/foo.'] },
  },
  {
    name: 'local part starting with a digit',
    input: { subject: REVIEWER, types: ['http://schema.org/123'] },
  },
  {
    name: 'predicate in the chain from an unknown namespace',
    input: {
      subject: REVIEWER, types: [`${EPO}Reviewer`], anchor: NOTICE_ANCHOR,
      chain: [`${EPO}announcesRole`, 'http://example.org/custom#links/to'],
    },
  },
  {
    name: 'subject IRI containing a space',
    // Angle brackets do not rescue this — IRIREF excludes space outright.
    input: { subject: 'http://data.europa.eu/a4g/resource/id x_Notice', types: [`${EPO}Notice`] },
  },
  {
    name: 'subject IRI containing angle brackets and a backslash',
    input: { subject: 'http://ex.org/a<b>c\\d', types: [`${EPO}Notice`] },
  },
  {
    name: 'type that is exactly a known namespace, with an empty local part',
    input: { subject: REVIEWER, types: ['http://schema.org/'] },
  },
  {
    name: 'type whose local part is non-ASCII',
    input: { subject: REVIEWER, types: ['http://schema.org/Ünicode'] },
  },
  {
    name: 'rdf:type appearing inside the walked chain',
    input: {
      subject: REVIEWER, types: [`${EPO}Reviewer`], anchor: NOTICE_ANCHOR,
      chain: [`${EPO}announcesRole`, RDF_TYPE],
    },
  },
  {
    name: 'a deep chain',
    input: {
      subject: REVIEWER, types: [`${EPO}Reviewer`], anchor: NOTICE_ANCHOR,
      chain: Array.from({ length: 12 }, (_, i) => `${EPO}hop${i}`),
    },
  },
  {
    name: 'type named Value, colliding with the fallback variable',
    input: { subject: REVIEWER, types: ['http://schema.org/Value'], anchor: '?value a schema:Value', chain: [`${EPO}announcesRole`] },
  },
  {
    name: 'navigating from a notice to another notice',
    input: { subject: NOTICE, types: [`${EPO}Notice`], anchor: NOTICE_ANCHOR, chain: [`${EPO}refersToPrevious`] },
  },
  {
    name: 'chain using prefixes that are string-prefixes of other prefixes',
    // rdf/rdfs, dct/dcterms, epo/epo_shape, sh/shacl all share a stem. A
    // declaration derived by loose matching would declare the short one for
    // the long one's use, and the query would then fail on the real prefix.
    // The anchor deliberately avoids epo:, so the only thing that could put
    // "epo" on the card is loose matching against epo_shape:.
    // The type is deliberately in no known namespace: it must not put a
    // prefix on the card itself, and it must not be one of the types that
    // would make this subject a vocabulary term rather than a resource.
    input: {
      subject: REVIEWER, types: ['http://example.org/Thing'],
      anchor: '?class a rdfs:Class',
      chain: ['http://www.w3.org/2000/01/rdf-schema#label', 'http://data.europa.eu/a4g/data-shape#note'],
    },
    expect: (rows) => {
      const declared = valuesFor(rows, 'Prefix').map(d => d.slice('PREFIX '.length, d.indexOf(':')));
      assert.ok(declared.includes('rdfs'), 'rdfs declared');
      assert.ok(declared.includes('epo_shape'), 'epo_shape declared');
      assert.ok(!declared.includes('rdf'), 'rdf not declared off the back of rdfs');
      assert.ok(!declared.includes('epo'), 'epo not declared off the back of epo_shape');
    },
  },
  {
    name: 'type URI crafted to break out of its angle brackets',
    // The card is built from RDF the endpoint returns. That is a second
    // untrusted source, and a resource typed with a URI shaped like SPARQL
    // would otherwise smuggle a clause into the pattern the user copies.
    input: { subject: REVIEWER, types: ['http://ex.org/T> . SERVICE <http://attacker.example/x'] },
    expect: (rows) => {
      const offered = [...valuesFor(rows, 'Path'), ...valuesFor(rows, 'Name')].join('\n');
      assert.ok(!offered.includes('SERVICE <http'), 'no clause escapes into the pattern');
    },
  },
  {
    name: 'predicate in the chain crafted to break out',
    input: {
      subject: REVIEWER, types: [`${EPO}Reviewer`], anchor: NOTICE_ANCHOR,
      chain: [`${EPO}announcesRole`, 'http://ex.org/p> . ?x ?y ?z . #'],
    },
    expect: (rows) => {
      const path = valuesFor(rows, 'Path').join('\n');
      assert.ok(!path.includes('> . ?x'), 'no clause escapes into the property path');
    },
  },
  {
    name: 'subject IRI crafted to break out of the IRI row',
    input: { subject: 'http://ex.org/s> . SERVICE <http://attacker.example/x', types: [`${EPO}Reviewer`] },
    expect: (rows) => assertNoExtraClauses(rows, 'crafted subject'),
  },
  {
    name: 'vocabulary term as the subject',
    input: { subject: `${EPO}Notice` },
  },
  {
    name: 'vocabulary term whose local part cannot be a prefixed name',
    input: { subject: 'http://schema.org/foo/bar' },
  },
];

for (const { name, input, expect } of CASES) {
  test(`card is usable: ${name}`, () => {
    const rows = assertCardIsUsable(card(input), name);
    if (expect) expect(rows);
  });
}

// ── the whole card at once ──────────────────────────────────────────

test('every declared prefix and every pattern coexist in one query', () => {
  // Paste the entire card in, not one row at a time.
  for (const { name, input } of CASES) {
    const rows = rowsOf(card(input));
    const prefixes = valuesFor(rows, 'Prefix').join('\n');
    const patterns = [
      ...valuesFor(rows, 'Path'),
      ...valuesFor(rows, 'Name').map(n => `?typed a ${n} .`),
      ...valuesFor(rows, 'IRI').map(i => `${i} ?p ?o .`),
    ];
    if (!patterns.length) continue;

    const query = `${prefixes}\nSELECT * WHERE {\n  ${patterns.join('\n  ')}\n}`;
    assert.equal(parses(query), null, `${name} — whole card does not parse:\n${query}`);
  }
});

test('no card declares a prefix none of its rows use', () => {
  // Redundant declarations are valid SPARQL but they are noise, and they hide
  // whether the derivation is actually tracking what gets emitted.
  for (const { name, input } of CASES) {
    const rows = rowsOf(card(input));
    const used = [...valuesFor(rows, 'Name'), ...valuesFor(rows, 'Path')].join('\n');
    for (const decl of valuesFor(rows, 'Prefix')) {
      const prefix = decl.slice('PREFIX '.length, decl.indexOf(':'));
      assert.ok(used.includes(`${prefix}:`), `${name} — declares ${prefix}: but never uses it`);
    }
  }
});

// ── the card on a row ───────────────────────────────────────────────
//
// A row states one triple, and its card answers for that statement: which
// property makes it, and how to reach the value from the notice. The same two
// promises apply — what it offers must parse, and its declarations must cover
// its rows.

const LITERAL = { termType: 'Literal', value: 'ANAC', datatype: namedNode(`${EPO}x`) };

// Render the card for one row, in the state a given navigation would leave
// the renderer in. `chain` is the whole walk from the tree root to the value,
// its last element being the row's own predicate.
function rowCard({ predicate, chain, anchor = NOTICE_ANCHOR, objectTypes = null, object = LITERAL }) {
  const r = new TreeRenderer({ innerHTML: '', appendChild() {} });
  r._navigatedSubject = NOTICE;
  r._pathFromRoot = [];
  r._rootPattern = anchor;

  const objectPredicates = objectTypes
    ? new Map([[RDF_TYPE, objectTypes.map(namedNode)]])
    : null;

  return r._buildRowInfoRows(predicate, objectPredicates, { root: NOTICE, anchor, chain }, object);
}

test('a row one step from the notice', () => {
  const rows = assertCardIsUsable(
    rowCard({ predicate: `${EPO}hasPublicationDate`, chain: [`${EPO}hasPublicationDate`] }),
    'row one step down',
  );

  assert.deepEqual(valuesFor(rows, 'Name'), ['epo:hasPublicationDate']);
  assert.deepEqual(valuesFor(rows, 'Path'),
    ['?notice a epo:Notice ; epo:hasPublicationDate ?hasPublicationDate .']);
});

test('a row three steps down keeps the whole walk in one property path', () => {
  const rows = assertCardIsUsable(
    rowCard({
      predicate: `${EPO}hasLegalName`,
      chain: [`${EPO}announcesRole`, `${EPO}playedBy`, `${EPO}hasLegalName`],
    }),
    'row three steps down',
  );

  assert.deepEqual(valuesFor(rows, 'Path'), [
    '?notice a epo:Notice ; epo:announcesRole / epo:playedBy / epo:hasLegalName ?hasLegalName .',
  ]);
});

test('a literal is named after the property, having no type of its own', () => {
  const rows = rowsOf(rowCard({ predicate: `${EPO}hasLegalName`, chain: [`${EPO}hasLegalName`] }));
  assert.ok(valuesFor(rows, 'Path')[0].endsWith('?hasLegalName .'));
});

test('a resource is named after what it is', () => {
  // The row's card and the card you reach by clicking through it should agree
  // on what the thing is called.
  const rows = rowsOf(rowCard({
    predicate: `${EPO}playedBy`,
    chain: [`${EPO}announcesRole`, `${EPO}playedBy`],
    objectTypes: [`${EPO}Organization`],
    object: namedNode(REVIEWER),
  }));

  assert.ok(valuesFor(rows, 'Path')[0].endsWith('?organization .'), valuesFor(rows, 'Path')[0]);
});

test('a row pointing at a resource offers its IRI, a row pointing at a literal does not', () => {
  const resourceRow = rowsOf(rowCard({
    predicate: `${EPO}playedBy`,
    chain: [`${EPO}playedBy`],
    objectTypes: [`${EPO}Organization`],
    object: namedNode(REVIEWER),
  }));
  const literalRow = rowsOf(rowCard({ predicate: `${EPO}hasLegalName`, chain: [`${EPO}hasLegalName`] }));

  assert.deepEqual(valuesFor(resourceRow, 'IRI'), [`<${REVIEWER}>`]);
  assert.deepEqual(valuesFor(literalRow, 'IRI'), []);
});

test('a row whose walk crosses vocabularies declares every prefix it uses', () => {
  // The failure string comparison misses: a path of epo: predicates ending in
  // an m8g: one, with only epo: declared, does not parse when pasted.
  const rows = assertCardIsUsable(
    rowCard({
      predicate: `${M8G}email`,
      chain: [`${EPO}announcesRole`, `${EPO}playedBy`, `${M8G}email`],
    }),
    'row crossing vocabularies',
  );

  assert.deepEqual(valuesFor(rows, 'Prefix').sort(), [
    `PREFIX epo: <${EPO}>`,
    `PREFIX m8g: <${M8G}>`,
  ].sort());
});

test('a predicate in no known namespace is bracketed, not left bare', () => {
  const rows = assertCardIsUsable(
    rowCard({ predicate: 'http://example.org/odd', chain: ['http://example.org/odd'] }),
    'row with an unknown namespace',
  );

  assert.deepEqual(valuesFor(rows, 'Name'), ['<http://example.org/odd>']);
});

test('a predicate URI carrying a space is percent-encoded', () => {
  // Not legal in an IRI to begin with, so the data is already malformed — but
  // an unescaped space inside <> is a parse error, and the card promises to
  // parse.
  assertCardIsUsable(
    rowCard({ predicate: 'http://example.org/a b', chain: ['http://example.org/a b'] }),
    'row with a space in the predicate',
  );
});

test('a row under a root nobody navigated to still binds by that root', () => {
  // Nothing was walked to reach this tree, so the row's path starts from the
  // root card's own type binding rather than from a breadcrumb.
  const r = new TreeRenderer({ innerHTML: '', appendChild() {} });
  r._navigatedSubject = null;
  r._pathFromRoot = [];
  r._rootPattern = null;

  const html = r._buildRowInfoRows(
    `${EPO}hasLegalName`,
    null,
    { root: NOTICE, anchor: NOTICE_ANCHOR, chain: [`${EPO}hasLegalName`] },
    LITERAL,
  );

  assert.deepEqual(valuesFor(assertCardIsUsable(html, 'row under an un-navigated root'), 'Path'),
    ['?notice a epo:Notice ; epo:hasLegalName ?hasLegalName .']);
});

test('a row under an unbindable root offers no path at all', () => {
  // An untyped blank node cannot be named in a query, so nothing below it can
  // be reached from one either. An unusable pattern would be worse than none.
  const rows = rowsOf(rowCard({
    predicate: `${EPO}hasLegalName`,
    chain: [`${EPO}hasLegalName`],
    anchor: null,
  }));

  assert.deepEqual(valuesFor(rows, 'Path'), []);
  assert.deepEqual(valuesFor(rows, 'Name'), ['epo:hasLegalName'], 'the property is still nameable');
});

// ── the card on an ontology term ────────────────────────────────────
//
// A term's page is not a place in anyone's data. There is no route to it, so
// no Path; what can be said is the shape of the statement the property makes,
// which the ontology states as its domain and range.

const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL  = 'http://www.w3.org/2002/07/owl#';
const XSD  = 'http://www.w3.org/2001/XMLSchema#';

function termCard(termUri, statements) {
  const r = new TreeRenderer({ innerHTML: '', appendChild() {} });
  const quads = Object.entries(statements)
    .flatMap(([p, objects]) => [].concat(objects).map(o => quad(namedNode(termUri), p, namedNode(o))));
  r.subjectIndex = r._buildIndex(quads);
  r._navigatedSubject = termUri;
  r._pathFromRoot = [];
  r._rootPattern = null;
  return r._buildInfoRows(termUri, r.subjectIndex.get(termUri));
}

test('a property is shown by how it is used', () => {
  const rows = assertCardIsUsable(termCard(`${EPO}hasPublicationDate`, {
    [RDF_TYPE]: `${OWL}DatatypeProperty`,
    [`${RDFS}domain`]: `${EPO}Document`,
    [`${RDFS}range`]: `${XSD}date`,
  }), 'a datatype property');

  assert.deepEqual(valuesFor(rows, 'Usage'),
    ['?document epo:hasPublicationDate ?date .']);
  assert.deepEqual(valuesFor(rows, 'Path'), [], 'a term has no route to it');
});

test('an object property names both ends after the classes it connects', () => {
  const rows = assertCardIsUsable(termCard(`${EPO}announcesRole`, {
    [RDF_TYPE]: `${OWL}ObjectProperty`,
    [`${RDFS}domain`]: `${EPO}Notice`,
    [`${RDFS}range`]: `${EPO}AgentInRole`,
  }), 'an object property');

  assert.deepEqual(valuesFor(rows, 'Usage'), ['?notice epo:announcesRole ?agentInRole .']);
});

test('a property stating no domain or range still offers a usable pattern', () => {
  const rows = assertCardIsUsable(termCard(`${EPO}someProperty`, {
    [RDF_TYPE]: `${OWL}ObjectProperty`,
  }), 'a property with neither');

  assert.deepEqual(valuesFor(rows, 'Usage'), ['?subject epo:someProperty ?value .']);
});

test('a property from one class to itself binds two variables, not one', () => {
  // Otherwise the pattern matches only the resources that point at themselves.
  const rows = assertCardIsUsable(termCard(`${EPO}modifies`, {
    [RDF_TYPE]: `${OWL}ObjectProperty`,
    [`${RDFS}domain`]: `${EPO}Contract`,
    [`${RDFS}range`]: `${EPO}Contract`,
  }), 'a self-referential property');

  assert.deepEqual(valuesFor(rows, 'Usage'), ['?contract epo:modifies ?contract2 .']);
});

test('a class is named, not used — it makes no statement of its own', () => {
  const rows = termCard(`${EPO}Notice`, { [RDF_TYPE]: `${OWL}Class` });

  assert.deepEqual(valuesFor(rowsOf(rows), 'Usage'), []);
  assert.deepEqual(valuesFor(rowsOf(rows), 'Name'), ['epo:Notice']);
});

test('domain and range appear as variable names, never as terms', () => {
  // Which is why a usage pattern needs no prefix beyond the property's own.
  const rows = assertCardIsUsable(termCard('http://data.europa.eu/m8g/email', {
    [RDF_TYPE]: `${OWL}DatatypeProperty`,
    [`${RDFS}domain`]: `${EPO}ContactPoint`,
    [`${RDFS}range`]: `${XSD}string`,
  }), 'a property from another vocabulary');

  assert.deepEqual(valuesFor(rows, 'Usage'), ['?contactPoint m8g:email ?string .']);
  assert.deepEqual(valuesFor(rows, 'Prefix'), ['PREFIX m8g: <http://data.europa.eu/m8g/>'],
    'epo: is not declared: no epo: term appears on the card');
});

// ── what makes something a term ─────────────────────────────────────
//
// A vocabulary this application has never heard of is still a vocabulary.
// What a subject declares itself to be is the reliable signal; the namespace
// table only answers when the data states nothing.

function cardFor(subject, quads) {
  const r = new TreeRenderer({ innerHTML: '', appendChild() {} });
  r.subjectIndex = r._buildIndex(quads);
  r._navigatedSubject = subject;
  r._pathFromRoot = [];
  r._rootPattern = null;
  return r._buildInfoRows(subject, r.subjectIndex.get(subject));
}

test('a property in an unknown namespace is a term, not a resource', () => {
  // Without this it took the resource branch and offered
  // "?objectProperty a owl:ObjectProperty ." — every object property there is.
  const CUSTOM = 'http://example.org/customProperty';
  const rows = assertCardIsUsable(cardFor(CUSTOM, [
    quad(namedNode(CUSTOM), RDF_TYPE, namedNode(`${OWL}ObjectProperty`)),
  ]), 'a custom property');

  assert.deepEqual(valuesFor(rows, 'Path'), []);
  assert.deepEqual(valuesFor(rows, 'Usage'), ['?subject <http://example.org/customProperty> ?value .']);
});

test('a class in an unknown namespace is a term too', () => {
  const CUSTOM = 'http://example.org/CustomClass';
  const rows = rowsOf(cardFor(CUSTOM, [
    quad(namedNode(CUSTOM), RDF_TYPE, namedNode(`${OWL}Class`)),
  ]));

  assert.deepEqual(valuesFor(rows, 'Path'), [], 'a class is not somewhere data leads');
  assert.deepEqual(valuesFor(rows, 'Usage'), [], 'nor does it make a statement of its own');
});

test('a resource typed with an ordinary class keeps its path', () => {
  // The reverse mistake: treating everything typed as a term would leave
  // every resource in a notice without one.
  const rows = assertCardIsUsable(cardFor(REVIEWER, [
    quad(namedNode(REVIEWER), RDF_TYPE, namedNode(`${EPO}Reviewer`)),
  ]), 'an ordinary resource');

  assert.deepEqual(valuesFor(rows, 'Path'), ['?reviewer a epo:Reviewer .']);
  assert.deepEqual(valuesFor(rows, 'Usage'), []);
});

test('an untyped subject falls back to the namespace it lives in', () => {
  // Nothing was loaded about it, so the only signal left is where it lives.
  const rows = rowsOf(cardFor(`${EPO}somethingUnloaded`, [
    quad(namedNode(`${EPO}somethingUnloaded`), `${SKOS}note`, { termType: 'Literal', value: 'x' }),
  ]));

  assert.deepEqual(valuesFor(rows, 'Path'), [], 'an ePO-namespace subject is a term');
  assert.deepEqual(valuesFor(rows, 'Name'), ['epo:somethingUnloaded']);
});

const XSD_NS = 'http://www.w3.org/2001/XMLSchema#';
const RDFS_NS = 'http://www.w3.org/2000/01/rdf-schema#';

test('a term whose declared type this code does not list is still a term', () => {
  // The list of term types cannot be complete — OWL and RDFS keep company
  // with metatypes nobody thinks of. Where the term lives answers when what
  // it declares does not.
  const rows = rowsOf(cardFor(`${XSD_NS}date`, [
    quad(namedNode(`${XSD_NS}date`), RDF_TYPE, namedNode(`${RDFS_NS}Datatype`)),
  ]));

  assert.deepEqual(valuesFor(rows, 'Path'), [], 'not "?datatype a rdfs:Datatype ."');
  assert.deepEqual(valuesFor(rows, 'Name'), ['xsd:date']);
});

test('a property carrying both a kind and a characteristic keeps its usage', () => {
  const rows = assertCardIsUsable(cardFor(`${EPO}hasFixedValue`, [
    quad(namedNode(`${EPO}hasFixedValue`), RDF_TYPE, namedNode(`${OWL}FunctionalProperty`)),
    quad(namedNode(`${EPO}hasFixedValue`), RDF_TYPE, namedNode(`${OWL}DatatypeProperty`)),
    quad(namedNode(`${EPO}hasFixedValue`), `${RDFS_NS}domain`, namedNode(`${EPO}AwardCriterion`)),
    quad(namedNode(`${EPO}hasFixedValue`), `${RDFS_NS}range`, namedNode(`${XSD_NS}decimal`)),
  ]), 'a functional property');

  assert.deepEqual(valuesFor(rows, 'Path'), []);
  assert.deepEqual(valuesFor(rows, 'Usage'), ['?awardCriterion epo:hasFixedValue ?decimal .']);
});

test('an annotation property makes a statement like any other', () => {
  // Classified as a term, so it has no Path. Without being counted as a
  // property it had no Usage either, and the card said nothing at all.
  const rows = assertCardIsUsable(cardFor(`${OWL}versionInfo`, [
    quad(namedNode(`${OWL}versionInfo`), RDF_TYPE, namedNode(`${OWL}AnnotationProperty`)),
  ]), 'an annotation property');

  assert.deepEqual(valuesFor(rows, 'Usage'), ['?subject owl:versionInfo ?value .']);
});

test('a term declaring only a type this code does not list', () => {
  // A SHACL shape is vocabulary, not data, and sh:NodeShape is neither class
  // nor property. Nothing in the declared types identifies it, so only the
  // namespace it lives in can — which is why that check is not skipped
  // whenever some type happens to be present.
  const SHAPE = 'http://data.europa.eu/a4g/data-shape#NoticeShape';
  const rows = rowsOf(cardFor(SHAPE, [
    quad(namedNode(SHAPE), RDF_TYPE, namedNode('http://www.w3.org/ns/shacl#NodeShape')),
  ]));

  assert.deepEqual(valuesFor(rows, 'Path'), [],
    'not "?nodeShape a sh:NodeShape ." — every shape there is');
  assert.deepEqual(valuesFor(rows, 'Usage'), [], 'a shape states nothing of its own');
});

test('a property declaring only an OWL characteristic is a property', () => {
  // owl:FunctionalProperty is a property class, so it identifies its subject
  // even in a namespace this application has never seen — where there is no
  // fallback to rescue it.
  const CUSTOM = 'http://example.org/customFunctional';
  const rows = assertCardIsUsable(cardFor(CUSTOM, [
    quad(namedNode(CUSTOM), RDF_TYPE, namedNode(`${OWL}FunctionalProperty`)),
  ]), 'a functional property of an unknown vocabulary');

  assert.deepEqual(valuesFor(rows, 'Path'), [],
    'not "?functionalProperty a owl:FunctionalProperty ."');
  assert.deepEqual(valuesFor(rows, 'Usage'),
    ['?subject <http://example.org/customFunctional> ?value .']);
});

test('a transitive property is recognised the same way', () => {
  const CUSTOM = 'http://example.org/partOf';
  const rows = rowsOf(cardFor(CUSTOM, [
    quad(namedNode(CUSTOM), RDF_TYPE, namedNode(`${OWL}TransitiveProperty`)),
  ]));

  assert.deepEqual(valuesFor(rows, 'Usage'), ['?subject <http://example.org/partOf> ?value .']);
});

test('a datatype of some other vocabulary is a term on its own say-so', () => {
  // Neither in a namespace this application knows nor a class or property:
  // rdfs:Datatype is the only thing marking it as vocabulary rather than data.
  const CUSTOM = 'http://example.org/myDatatype';
  const rows = rowsOf(cardFor(CUSTOM, [
    quad(namedNode(CUSTOM), RDF_TYPE, namedNode(`${RDFS_NS}Datatype`)),
  ]));

  assert.deepEqual(valuesFor(rows, 'Path'), []);
});
