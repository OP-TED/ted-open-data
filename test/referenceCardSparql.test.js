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
    input: {
      subject: REVIEWER, types: ['http://www.w3.org/2000/01/rdf-schema#Class'],
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
