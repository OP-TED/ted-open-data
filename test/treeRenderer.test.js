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
// TreeRenderer unit tests — exercise the pure helpers on TreeRenderer
// (`_buildIndex`, `_findRootSubjects`, `_partitionObjects`) without
// touching the DOM. These helpers drive how the Tree view looks in
// practice, so a regression in any of them silently corrupts the UI.
//
// The agent review flagged this as the single source file in the
// rewrite with non-DOM logic and zero direct test coverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './_helpers.js'; // provides the minimal document shim TreeRenderer needs at construction
import { TreeRenderer } from '../src/js/TreeRenderer.js';
import { setController } from '../src/js/TermRenderer.js';
import { __setOntologyDataForTesting } from '../src/js/services/ontologyData.js';

// Real URIs from TED notice 00172531-2026's DESCRIBE response.
const NOTICE      = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Notice';
const PROCEDURE   = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Procedure_6dcsBnuV4FTNoRpTZHckqN';
const LOT         = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Lot_LOT-0001';
const CONTRACT    = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_SettledContract_CON-0001';
const REVIEWER     = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Reviewer_3qDoBaQsAXVe5Ci2dDBD6C';
const ORGANISATION = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Organisation_ORG-0002';
const RDF_TYPE    = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const EPO_CONCERNS_PROC = 'http://data.europa.eu/a4g/ontology#concernsProcedure';
const EPO_HAS_LOT_REF   = 'http://data.europa.eu/a4g/ontology#hasLotReference';
const EPO_NOTICE_CLASS  = 'http://data.europa.eu/a4g/ontology#Notice';
const EPO_ANNOUNCES_ROLE   = 'http://data.europa.eu/a4g/ontology#announcesRole';
const EPO_PLAYED_BY        = 'http://data.europa.eu/a4g/ontology#playedBy';
const EPO_REVIEWER_CLASS   = 'http://data.europa.eu/a4g/ontology#Reviewer';
const EPO_ORGANISATION_CLASS = 'http://data.europa.eu/a4g/ontology#Organisation';
const EPO_PROCEDURE_CLASS  = 'http://data.europa.eu/a4g/ontology#Procedure';
const XSD_STRING  = 'http://www.w3.org/2001/XMLSchema#string';

// N3-shaped quad. The real parser returns {subject, predicate, object}
// with termType / value on each term; that's what TreeRenderer expects.
function quad(subjectUri, predicateUri, object) {
  return {
    subject: { termType: 'NamedNode', value: subjectUri },
    predicate: { termType: 'NamedNode', value: predicateUri },
    object,
  };
}
function namedNode(uri) { return { termType: 'NamedNode', value: uri }; }
function blankNode(id)  { return { termType: 'BlankNode', value: id  }; }
function literal(value, datatype = XSD_STRING, language) {
  return { termType: 'Literal', value, datatype: { value: datatype }, language };
}

// Test fixture: TreeRenderer constructor takes a container reference but
// the pure helpers never read from it, so a plain object is enough.
function makeRenderer() {
  return new TreeRenderer({ innerHTML: '', appendChild: () => {} });
}

// ── _buildIndex ─────────────────────────────────────────────────────

test('_buildIndex groups triples by subject and predicate', () => {
  const quads = [
    quad(NOTICE, RDF_TYPE, namedNode(EPO_NOTICE_CLASS)),
    quad(NOTICE, EPO_CONCERNS_PROC, namedNode(PROCEDURE)),
    quad(PROCEDURE, RDF_TYPE, namedNode('http://data.europa.eu/a4g/ontology#Procedure')),
  ];
  const r = makeRenderer();
  const idx = r._buildIndex(quads);

  assert.equal(idx.size, 2, 'two distinct subjects');
  assert.ok(idx.has(NOTICE));
  assert.ok(idx.has(PROCEDURE));

  const noticeEntries = idx.get(NOTICE);
  assert.equal(noticeEntries.size, 2, 'notice has rdf:type and concernsProcedure');
  assert.equal(noticeEntries.get(RDF_TYPE).length, 1);
  assert.equal(noticeEntries.get(EPO_CONCERNS_PROC).length, 1);
});

test('_buildIndex collects multiple objects under the same predicate', () => {
  const quads = [
    quad(NOTICE, RDF_TYPE, namedNode('http://data.europa.eu/a4g/ontology#Notice')),
    quad(NOTICE, RDF_TYPE, namedNode('http://data.europa.eu/a4g/ontology#ResultNotice')),
  ];
  const r = makeRenderer();
  const idx = r._buildIndex(quads);
  assert.equal(idx.get(NOTICE).get(RDF_TYPE).length, 2);
});

test('_buildIndex handles an empty input', () => {
  const r = makeRenderer();
  const idx = r._buildIndex([]);
  assert.equal(idx.size, 0);
});

// ── _findRootSubjects ───────────────────────────────────────────────

test('_findRootSubjects returns subjects never referenced as objects', () => {
  // NOTICE is a subject but is not referenced as an object of anything.
  // PROCEDURE is both a subject (has rdf:type) and an object (referenced
  // by NOTICE via concernsProcedure). So only NOTICE is a root.
  const quads = [
    quad(NOTICE, RDF_TYPE, namedNode(EPO_NOTICE_CLASS)),
    quad(NOTICE, EPO_CONCERNS_PROC, namedNode(PROCEDURE)),
    quad(PROCEDURE, RDF_TYPE, namedNode('http://data.europa.eu/a4g/ontology#Procedure')),
  ];
  const r = makeRenderer();
  r.subjectIndex = r._buildIndex(quads);
  const roots = r._findRootSubjects(quads);
  assert.deepEqual(roots, [NOTICE]);
});

test('_findRootSubjects falls back to all subjects for a pure cycle', () => {
  // A → B → A. Neither is a "never-referenced" root; the fallback
  // returns everything so the UI can still render something.
  const A = 'http://example.org/A';
  const B = 'http://example.org/B';
  const refs = 'http://example.org/refs';
  const quads = [
    quad(A, refs, namedNode(B)),
    quad(B, refs, namedNode(A)),
  ];
  const r = makeRenderer();
  r.subjectIndex = r._buildIndex(quads);
  const roots = r._findRootSubjects(quads);
  assert.equal(roots.length, 2);
  assert.ok(roots.includes(A));
  assert.ok(roots.includes(B));
});

test('_findRootSubjects does not count literals as references', () => {
  // A subject whose only "reference" is via being a literal value
  // shouldn't disqualify another subject. Guards against someone
  // accidentally putting literal handling in the reference set.
  const quads = [
    quad(NOTICE, RDF_TYPE, namedNode(EPO_NOTICE_CLASS)),
    quad(NOTICE, 'http://example.org/label', literal('Notice label', XSD_STRING, 'en')),
  ];
  const r = makeRenderer();
  r.subjectIndex = r._buildIndex(quads);
  const roots = r._findRootSubjects(quads);
  assert.deepEqual(roots, [NOTICE], 'literal targets do not make NOTICE non-root');
});

// ── _partitionObjects ───────────────────────────────────────────────

test('_partitionObjects nests named-node objects that are also subjects', () => {
  // PROCEDURE is in the subject index → nestable.
  // Literal is not → non-nestable.
  const r = makeRenderer();
  r.subjectIndex = new Map([[PROCEDURE, new Map()]]);

  const objects = [
    namedNode(PROCEDURE),
    literal('some value'),
  ];
  const [nestable, nonNestable] = r._partitionObjects(objects, new Set());

  assert.equal(nestable.length, 1);
  assert.equal(nestable[0].value, PROCEDURE);
  assert.equal(nonNestable.length, 1);
  assert.equal(nonNestable[0].termType, 'Literal');
});

test('_partitionObjects nests blank-node objects that are also subjects', () => {
  // Blank nodes in subject position (anonymous resources) should also
  // be nestable when they appear as objects elsewhere.
  const bnodeId = '_:b42';
  const r = makeRenderer();
  r.subjectIndex = new Map([[bnodeId, new Map()]]);

  const objects = [blankNode(bnodeId)];
  const [nestable, nonNestable] = r._partitionObjects(objects, new Set());

  assert.equal(nestable.length, 1);
  assert.equal(nonNestable.length, 0);
});

test('_partitionObjects does NOT nest objects already on the ancestor path', () => {
  // If A → B is being rendered and A is already an ancestor in this
  // branch, we must NOT recurse back into A — that would produce an
  // infinite loop. _partitionObjects relies on the ancestors Set to
  // enforce this.
  const r = makeRenderer();
  r.subjectIndex = new Map([[PROCEDURE, new Map()], [NOTICE, new Map()]]);

  const ancestors = new Set([PROCEDURE]);
  const objects = [namedNode(PROCEDURE), namedNode(NOTICE)];
  const [nestable, nonNestable] = r._partitionObjects(objects, ancestors);

  // PROCEDURE is in ancestors → must be non-nestable (will render as a leaf)
  // NOTICE is not → nestable
  assert.equal(nestable.length, 1);
  assert.equal(nestable[0].value, NOTICE);
  assert.equal(nonNestable.length, 1);
  assert.equal(nonNestable[0].value, PROCEDURE);
});

test('_partitionObjects does NOT nest named-node objects that are not in the subject index', () => {
  // Dangling reference: the object points at a URI that has no
  // statements of its own in the dataset. Should render as a leaf.
  const r = makeRenderer();
  r.subjectIndex = new Map([[PROCEDURE, new Map()]]);

  const objects = [namedNode('http://example.org/dangling')];
  const [nestable, nonNestable] = r._partitionObjects(objects, new Set());

  assert.equal(nestable.length, 0);
  assert.equal(nonNestable.length, 1);
});

test('_partitionObjects handles mixed literal + nested + ancestor in one call', () => {
  const r = makeRenderer();
  r.subjectIndex = new Map([
    [LOT, new Map()],
    [PROCEDURE, new Map()],
    [CONTRACT, new Map()],
  ]);

  const ancestors = new Set([CONTRACT]); // CONTRACT is on the current path
  const objects = [
    namedNode(LOT),                                // nestable: in index, not in ancestors
    namedNode(PROCEDURE),                          // nestable: in index, not in ancestors
    namedNode(CONTRACT),                           // non-nestable: in ancestors
    literal('some value'),                         // non-nestable: literal
    namedNode('http://example.org/unknown'),       // non-nestable: not in index
  ];
  const [nestable, nonNestable] = r._partitionObjects(objects, ancestors);

  assert.equal(nestable.length, 2);
  assert.ok(nestable.some(o => o.value === LOT));
  assert.ok(nestable.some(o => o.value === PROCEDURE));
  assert.equal(nonNestable.length, 3);
});

test('_partitionObjects preserves per-object order within each bucket', () => {
  // The real TreeRenderer renders non-nestable rows first, then
  // nestable cards. The order within each bucket should match the
  // caller's input order so the UI is stable.
  const r = makeRenderer();
  r.subjectIndex = new Map([
    [LOT, new Map()],
    [PROCEDURE, new Map()],
  ]);

  const objects = [
    namedNode(LOT),              // nestable
    literal('a'),                // non
    namedNode(PROCEDURE),        // nestable
    literal('b'),                // non
  ];
  const [nestable, nonNestable] = r._partitionObjects(objects, new Set());

  assert.deepEqual(nestable.map(o => o.value), [LOT, PROCEDURE]);
  assert.deepEqual(nonNestable.map(o => o.value), ['a', 'b']);
});

// ── _formatPropertyPath ─────────────────────────────────────────────

test('_formatPropertyPath shrinks a single known-namespace predicate', () => {
  const r = makeRenderer();
  assert.equal(r._formatPropertyPath([EPO_ANNOUNCES_ROLE]), 'epo:announcesRole');
});

test('_formatPropertyPath joins a multi-hop chain with the sequence operator', () => {
  const r = makeRenderer();
  assert.equal(
    r._formatPropertyPath([EPO_ANNOUNCES_ROLE, EPO_PLAYED_BY]),
    'epo:announcesRole / epo:playedBy',
  );
});

test('_formatPropertyPath wraps unknown-namespace predicates in angle brackets', () => {
  // shrink() returns the URI unchanged when no prefix matches. Emitting it
  // bare would be invalid SPARQL, so it must come back bracketed.
  const r = makeRenderer();
  assert.equal(
    r._formatPropertyPath(['http://example.org/custom#linksTo']),
    '<http://example.org/custom#linksTo>',
  );
});

test('_formatPropertyPath mixes shrunk and bracketed predicates in one chain', () => {
  const r = makeRenderer();
  assert.equal(
    r._formatPropertyPath([EPO_ANNOUNCES_ROLE, 'http://example.org/custom#linksTo']),
    'epo:announcesRole / <http://example.org/custom#linksTo>',
  );
});

test('_formatPropertyPath returns an empty string for an empty chain', () => {
  const r = makeRenderer();
  assert.equal(r._formatPropertyPath([]), '');
});

// ── _buildPathPattern ───────────────────────────────────────────────
//
// The Path row on the SPARQL reference card (issue #73). The chain and the
// root pattern are supplied by DataView from the breadcrumb; these tests set
// them directly, which is exactly the state render() installs.

// Puts the renderer in the state it would be in after the user navigated
// from a notice down to `subject` along `chain`.
function navigatedTo(r, subject, chain, rootPattern = '?notice a epo:Notice') {
  r._navigatedSubject = subject;
  r._pathFromRoot = chain;
  r._rootPattern = rootPattern;
}

function typedAs(classUri) {
  return new Map([[RDF_TYPE, [namedNode(classUri)]]]);
}

test('_buildPathPattern renders the walked chain anchored at the root pattern', () => {
  const r = makeRenderer();
  navigatedTo(r, REVIEWER, [EPO_ANNOUNCES_ROLE]);
  assert.equal(
    r._buildPathPattern(REVIEWER, typedAs(EPO_REVIEWER_CLASS)),
    '?notice a epo:Notice ; epo:announcesRole ?reviewer .',
  );
});

test('_buildPathPattern joins a multi-hop chain into one property path', () => {
  // The whole point of #73: the route survives several navigations.
  const r = makeRenderer();
  navigatedTo(r, ORGANISATION, [EPO_ANNOUNCES_ROLE, EPO_PLAYED_BY]);
  assert.equal(
    r._buildPathPattern(ORGANISATION, typedAs(EPO_ORGANISATION_CLASS)),
    '?notice a epo:Notice ; epo:announcesRole / epo:playedBy ?organisation .',
  );
});

test('_buildPathPattern names the bound variable after the resource type', () => {
  // ?reviewer, not a bare ?value — the pattern should say what it binds.
  const r = makeRenderer();
  navigatedTo(r, REVIEWER, [EPO_ANNOUNCES_ROLE]);
  const pattern = r._buildPathPattern(REVIEWER, typedAs(EPO_REVIEWER_CLASS));
  assert.ok(pattern.endsWith('?reviewer .'), pattern);
});

test('_buildPathPattern renames the target when it would collide with the root variable', () => {
  // Notice → Notice: binding ?notice at both ends would silently change the
  // meaning of the query.
  const r = makeRenderer();
  navigatedTo(r, NOTICE, [EPO_ANNOUNCES_ROLE]);
  assert.equal(
    r._buildPathPattern(NOTICE, typedAs(EPO_NOTICE_CLASS)),
    '?notice a epo:Notice ; epo:announcesRole ?notice2 .',
  );
});

test('_buildPathPattern falls back to a type binding when nothing was navigated', () => {
  // Sitting on the notice itself: no chain walked yet.
  const r = makeRenderer();
  navigatedTo(r, NOTICE, []);
  assert.equal(
    r._buildPathPattern(NOTICE, typedAs(EPO_NOTICE_CLASS)),
    '?notice a epo:Notice .',
  );
});

test('_buildPathPattern falls back to a type binding when no root pattern is known', () => {
  // A shared link opens mid-exploration with no recorded breadcrumb route.
  const r = makeRenderer();
  navigatedTo(r, REVIEWER, [EPO_ANNOUNCES_ROLE], null);
  assert.equal(
    r._buildPathPattern(REVIEWER, typedAs(EPO_REVIEWER_CLASS)),
    '?reviewer a epo:Reviewer .',
  );
});

test('_buildPathPattern does not give a sibling root the navigated subject chain', () => {
  // A graph can surface several root cards. Only the subject actually
  // navigated to owns the walked chain; the others must not claim it.
  const r = makeRenderer();
  navigatedTo(r, REVIEWER, [EPO_ANNOUNCES_ROLE]);
  assert.equal(
    r._buildPathPattern(PROCEDURE, typedAs(EPO_PROCEDURE_CLASS)),
    '?procedure a epo:Procedure .',
  );
});

test('_buildPathPattern binds an untyped resource by its IRI', () => {
  // No rdf:type means no sensible variable name and no class to match on;
  // the IRI is the only thing that identifies it.
  const r = makeRenderer();
  navigatedTo(r, REVIEWER, [], null);
  assert.equal(
    r._buildPathPattern(REVIEWER, new Map()),
    `<${REVIEWER}> ?predicate ?value .`,
  );
});

test('_buildPathPattern binds every declared type, not one of them', () => {
  // A real notice carries epo:Notice alongside epo:CompetitionNotice and a
  // mapping-version class such as epo:Notice16, in no guaranteed order.
  // Singling one out both discards what the resource is and makes the pattern
  // depend on the order the endpoint returned the triples in — which is how
  // the anchor ended up reading "?notice16 a epo:Notice16 ." in the browser.
  const r = makeRenderer();
  navigatedTo(r, NOTICE, []);
  const predicates = new Map([[RDF_TYPE, [
    namedNode('http://data.europa.eu/a4g/ontology#Notice16'),
    namedNode(EPO_NOTICE_CLASS),
    namedNode('http://data.europa.eu/a4g/ontology#CompetitionNotice'),
  ]]]);
  assert.equal(
    r._buildPathPattern(NOTICE, predicates),
    '?notice16 a epo:Notice16, epo:Notice, epo:CompetitionNotice .',
  );
});

test('_buildPathPattern names its variable after the most specific type', () => {
  // With the ontology loaded, the variable follows the class the badge shows
  // rather than whichever type the endpoint happened to return first.
  __setOntologyDataForTesting({
    subClassOf: {
      'http://data.europa.eu/a4g/ontology#Notice16': ['http://data.europa.eu/a4g/ontology#CompetitionNotice'],
      'http://data.europa.eu/a4g/ontology#CompetitionNotice': [EPO_NOTICE_CLASS],
    },
  });
  const r = makeRenderer();
  navigatedTo(r, NOTICE, []);
  const predicates = new Map([[RDF_TYPE, [
    namedNode(EPO_NOTICE_CLASS),
    namedNode('http://data.europa.eu/a4g/ontology#Notice16'),
    namedNode('http://data.europa.eu/a4g/ontology#CompetitionNotice'),
  ]]]);

  assert.equal(
    r._buildPathPattern(NOTICE, predicates),
    '?notice16 a epo:Notice, epo:Notice16, epo:CompetitionNotice .',
  );
  // Loaded and stating nothing, not unloaded: null would send the next
  // render off to fetch the real file, which no test wants.
  __setOntologyDataForTesting({ subClassOf: {} });
});

test('_variableNameFrom follows the ontology, not the shortest name', () => {
  // "notice" is the shorter name; "notice16" is the more specific class.
  __setOntologyDataForTesting({
    subClassOf: {
      'http://data.europa.eu/a4g/ontology#Notice16': ['http://data.europa.eu/a4g/ontology#CompetitionNotice'],
      'http://data.europa.eu/a4g/ontology#CompetitionNotice': [EPO_NOTICE_CLASS],
    },
  });
  const r = makeRenderer();
  assert.equal(
    r._variableNameFrom([
      'http://data.europa.eu/a4g/ontology#Notice16',
      EPO_NOTICE_CLASS,
      'http://data.europa.eu/a4g/ontology#CompetitionNotice',
    ]),
    'notice16',
  );
  // Loaded and stating nothing, not unloaded: null would send the next
  // render off to fetch the real file, which no test wants.
  __setOntologyDataForTesting({ subClassOf: {} });
});

test('_variableNameFrom uses the first declared type when the ontology ranks none', () => {
  // Two unrelated classes: the variable is only a label, and every type is
  // bound in the pattern, so the choice cannot change what the query matches.
  const r = makeRenderer();
  assert.equal(r._variableNameFrom(['http://ex.org/Beta', 'http://ex.org/Alfa']), 'beta');
});

test('_variableNameFrom falls back when a type yields no usable name', () => {
  const r = makeRenderer();
  assert.equal(r._variableNameFrom([]), 'value');
  assert.equal(r._variableNameFrom(['http://ex.org/123']), 'value');
  assert.equal(r._variableNameFrom(['http://ex.org/Some-Type.v2']), 'some_Type_v2');
});

// ── predicate path threading ────────────────────────────────────────

test('_buildCardBody appends each predicate to the path handed to its children', () => {
  // The chain that reaches a clicked node is accumulated during rendering.
  // If this stops growing, every path below the first level goes wrong —
  // and nothing else in the suite would notice.
  const r = makeRenderer();
  r.subjectIndex = new Map([[PROCEDURE, new Map()]]);

  const seen = { rows: [], cards: [] };
  r._renderPredicateObject = (pred, obj, ctx) => { seen.rows.push(ctx); return {}; };
  r._renderSubjectTree = (subj, anc, pred, ctx) => { seen.cards.push(ctx); return {}; };

  const parent = { root: NOTICE, anchor: '?notice a epo:Notice', chain: [EPO_PLAYED_BY] };
  const predicates = new Map([
    [EPO_ANNOUNCES_ROLE, [namedNode(PROCEDURE), literal('a leaf')]],
  ]);
  r._buildCardBody(predicates, new Set(), parent);

  const expected = [EPO_PLAYED_BY, EPO_ANNOUNCES_ROLE];
  assert.deepEqual(seen.cards[0].chain, expected, 'nested card');
  assert.deepEqual(seen.rows[0].chain, expected, 'leaf row');
  assert.equal(seen.cards[0].root, NOTICE, 'root identity is carried down unchanged');
  assert.equal(seen.cards[0].anchor, '?notice a epo:Notice');
  assert.deepEqual(parent.chain, [EPO_PLAYED_BY], 'parent context is not mutated');
});

test('_buildCardBody keeps sibling predicates on separate branches', () => {
  // childPath must be derived from the parent path each time, not mutated
  // in place — otherwise the second predicate inherits the first.
  const r = makeRenderer();
  r.subjectIndex = new Map();

  const seen = [];
  r._renderPredicateObject = (pred, obj, ctx) => { seen.push(ctx.chain); return {}; };

  const predicates = new Map([
    [EPO_ANNOUNCES_ROLE, [literal('one')]],
    [EPO_PLAYED_BY, [literal('two')]],
  ]);
  r._buildCardBody(predicates, new Set(), { root: NOTICE, anchor: '?notice a epo:Notice', chain: [] });

  assert.deepEqual(seen, [[EPO_ANNOUNCES_ROLE], [EPO_PLAYED_BY]]);
});

// ── SPARQL validity of the generated pattern ────────────────────────
//
// The Path row is meant to be pasted straight into a query, so anything it
// emits has to parse. These cover the shapes that are not ePO-with-a-clean-
// local-name, which is everything the Reuse tab can render from a CONSTRUCT.

test('_buildPathPattern does not put a semicolon after an IRI anchor', () => {
  // "<iri> ; epo:foo ?bar ." is a syntax error — a semicolon continues a
  // predicate list, and an IRI on its own has not started one.
  const r = makeRenderer();
  navigatedTo(r, REVIEWER, [EPO_ANNOUNCES_ROLE], `<${NOTICE}>`);
  assert.equal(
    r._buildPathPattern(REVIEWER, typedAs(EPO_REVIEWER_CLASS)),
    `<${NOTICE}> epo:announcesRole ?reviewer .`,
  );
});

test('_buildPathPattern brackets a type from an unknown namespace', () => {
  // shrink() passes unknown namespaces through untouched, and a bare IRI is
  // not valid in the object position of "a".
  const r = makeRenderer();
  navigatedTo(r, REVIEWER, [], null);
  assert.equal(
    r._buildPathPattern(REVIEWER, typedAs('http://example.org/SomeType')),
    '?someType a <http://example.org/SomeType> .',
  );
});

test('_buildPathPattern strips characters a SPARQL variable cannot contain', () => {
  // "?some-Type" and "?some.Type" are unparseable.
  const r = makeRenderer();
  navigatedTo(r, REVIEWER, [], null);
  assert.equal(
    r._buildPathPattern(REVIEWER, typedAs('http://example.org/Some-Type.v2')),
    '?some_Type_v2 a <http://example.org/Some-Type.v2> .',
  );
});

test('_buildPathPattern falls back to ?value when a type yields no usable name', () => {
  // A local name that is entirely punctuation or starts with a digit cannot
  // seed a variable at all.
  const r = makeRenderer();
  navigatedTo(r, REVIEWER, [], null);
  assert.equal(
    r._buildPathPattern(REVIEWER, typedAs('http://example.org/123')),
    '?value a <http://example.org/123> .',
  );
});

test('_buildAnchorPattern binds an untyped root by its IRI', () => {
  const r = makeRenderer();
  assert.equal(r._buildAnchorPattern(REVIEWER, new Map()), `<${REVIEWER}>`);
});

test('_buildAnchorPattern binds a typed root by its class', () => {
  const r = makeRenderer();
  assert.equal(
    r._buildAnchorPattern(NOTICE, typedAs(EPO_NOTICE_CLASS)),
    '?notice a epo:Notice',
  );
});

// ── per-root navigation context ─────────────────────────────────────

test('render gives each root card its own anchor and root identity', () => {
  // A graph with two roots. A chain walked under one of them must not be
  // reported as if it started at the other — that produces a pattern which
  // parses cleanly and means something false.
  const r = makeRenderer();
  const captured = [];
  r._renderSubjectTree = (subj, anc, pred, ctx) => { captured.push(ctx); return {}; };

  r.render([
    quad(NOTICE, RDF_TYPE, namedNode(EPO_NOTICE_CLASS)),
    quad(PROCEDURE, RDF_TYPE, namedNode(EPO_PROCEDURE_CLASS)),
  ], {});

  assert.equal(captured.length, 2, 'both roots rendered');
  assert.deepEqual(
    captured.map(c => [c.root, c.anchor, c.chain.length]),
    [
      [NOTICE, '?notice a epo:Notice', 0],
      [PROCEDURE, '?procedure a epo:Procedure', 0],
    ],
  );
});

test('_navigationContext reports the chain, its root, and that root pattern', () => {
  const r = makeRenderer();
  const ctx = { root: NOTICE, anchor: '?notice a epo:Notice', chain: [EPO_ANNOUNCES_ROLE] };
  assert.deepEqual(r._navigationContext(ctx), {
    viaPath: [EPO_ANNOUNCES_ROLE],
    viaRoot: NOTICE,
    viaRootPattern: '?notice a epo:Notice',
  });
});

test('_navigationContext reports nothing when there is no context to report', () => {
  // An element rendered outside a root's subtree must not claim a route.
  const r = makeRenderer();
  assert.deepEqual(r._navigationContext(null), {});
});

// ── blank-node subjects ─────────────────────────────────────────────
//
// The subject index is keyed by bare value, which drops the term type, and
// the parser hands blank nodes over as plain labels like "b0_b0". Treated as
// an IRI that becomes <b0_b0> — a relative reference to something entirely
// unrelated, in a pattern that parses cleanly.

test('_buildAnchorPattern refuses to name an untyped blank node', () => {
  const r = makeRenderer();
  r.subjectIndex = r._buildIndex([
    { subject: blankNode('b0_b0'), predicate: namedNode(EPO_PLAYED_BY), object: literal('x') },
  ]);
  assert.equal(r._buildAnchorPattern('b0_b0', r.subjectIndex.get('b0_b0')), null);
});

test('_buildAnchorPattern binds a typed blank node by its class', () => {
  // Identity is not needed here: the pattern matches on the type, so a blank
  // node is as addressable as any other resource.
  const r = makeRenderer();
  r.subjectIndex = r._buildIndex([
    { subject: blankNode('b0_b0'), predicate: namedNode(RDF_TYPE), object: namedNode(EPO_REVIEWER_CLASS) },
  ]);
  assert.equal(
    r._buildAnchorPattern('b0_b0', r.subjectIndex.get('b0_b0')),
    '?reviewer a epo:Reviewer',
  );
});

test('_buildPathPattern offers no pattern at all for an untyped blank node', () => {
  // The card drops the Path row entirely rather than showing <b0_b0>.
  const r = makeRenderer();
  r.subjectIndex = r._buildIndex([
    { subject: blankNode('b0_b0'), predicate: namedNode(EPO_PLAYED_BY), object: literal('x') },
  ]);
  navigatedTo(r, 'b0_b0', [], null);
  assert.equal(r._buildPathPattern('b0_b0', r.subjectIndex.get('b0_b0')), null);
});

test('_buildPathPattern still names an untyped IRI subject', () => {
  // Only blank nodes are unnameable; an IRI without a type is fine.
  const r = makeRenderer();
  r.subjectIndex = r._buildIndex([
    quad(REVIEWER, EPO_PLAYED_BY, literal('x')),
  ]);
  navigatedTo(r, REVIEWER, [], null);
  assert.equal(
    r._buildPathPattern(REVIEWER, r.subjectIndex.get(REVIEWER)),
    `<${REVIEWER}> ?predicate ?value .`,
  );
});

test('render gives an untyped blank-node root no anchor to record', () => {
  // Descendants of that root must not report a route, or a click beneath it
  // would anchor the chain to <b0_b0>.
  const r = makeRenderer();
  const captured = [];
  r._renderSubjectTree = (subj, anc, pred, ctx) => { captured.push(ctx); return {}; };

  r.render([
    { subject: blankNode('b0_b0'), predicate: namedNode(EPO_PLAYED_BY), object: literal('x') },
  ], {});

  assert.equal(captured.length, 1);
  assert.equal(captured[0].anchor, null);
  assert.deepEqual(r._navigationContext(captured[0]).viaRootPattern, null);
});

test('_buildInfoRows omits the IRI row for a blank node', () => {
  // <b0_b0> is a relative IRI pointing at something unrelated, offered with a
  // copy button as though it identified this resource.
  const r = makeRenderer();
  r.subjectIndex = r._buildIndex([
    { subject: blankNode('b0_b0'), predicate: namedNode(RDF_TYPE), object: namedNode(EPO_REVIEWER_CLASS) },
  ]);
  const html = r._buildInfoRows('b0_b0', r.subjectIndex.get('b0_b0'));

  assert.ok(!html.includes('>IRI<'), 'no IRI row');
  assert.ok(!html.includes('b0_b0'), 'the blank label is never shown as a term');
  assert.ok(html.includes('>Path<'), 'a typed blank node still has a usable pattern');
});

test('_buildInfoRows keeps the IRI row for a named resource', () => {
  const r = makeRenderer();
  r.subjectIndex = r._buildIndex([quad(REVIEWER, RDF_TYPE, namedNode(EPO_REVIEWER_CLASS))]);
  const html = r._buildInfoRows(REVIEWER, r.subjectIndex.get(REVIEWER));

  assert.ok(html.includes('>IRI<'), 'IRI row present');
  assert.ok(html.includes(`&lt;${REVIEWER}&gt;`), 'IRI shown escaped');
});

// ── prefixed names that cannot parse ────────────────────────────────
//
// shrink() matches on namespace and slices the rest off blindly, so a known
// namespace does not guarantee a legal prefixed name. The dangerous case is a
// slash: inside a property path "schema:foo/bar" reads as a sequence
// operator, so the pattern parses and quietly means something else.

const SCHEMA_NESTED = 'http://schema.org/foo/bar';

test('_shrinkOrBracket keeps a well-formed prefixed name', () => {
  const r = makeRenderer();
  assert.equal(r._shrinkOrBracket(EPO_ANNOUNCES_ROLE), 'epo:announcesRole');
});

test('_shrinkOrBracket brackets a known namespace whose local part has a slash', () => {
  const r = makeRenderer();
  assert.equal(r._shrinkOrBracket(SCHEMA_NESTED), `<${SCHEMA_NESTED}>`);
});

test('_shrinkOrBracket brackets local parts with spaces or brackets', () => {
  const r = makeRenderer();
  // A space cannot appear inside <> either — IRIREF excludes it — so falling
  // back to the full IRI also means percent-encoding what IRIREF forbids.
  assert.equal(
    r._shrinkOrBracket('http://purl.org/dc/terms/a b'),
    '<http://purl.org/dc/terms/a%20b>',
  );
  // Parentheses are legal in an IRIREF, so they survive untouched — only the
  // characters the grammar actually excludes get encoded.
  assert.equal(
    r._shrinkOrBracket('http://data.europa.eu/m8g/x(y)'),
    '<http://data.europa.eu/m8g/x(y)>',
  );
});

test('_shrinkOrBracket brackets a local part ending in a dot', () => {
  // A trailing dot would run into the statement terminator.
  const r = makeRenderer();
  assert.equal(
    r._shrinkOrBracket('http://schema.org/foo.'),
    '<http://schema.org/foo.>',
  );
});

test('_shrinkOrBracket allows dots and hyphens inside a local part', () => {
  const r = makeRenderer();
  assert.equal(r._shrinkOrBracket('http://schema.org/foo-bar.baz'), 'schema:foo-bar.baz');
});

test('_formatPropertyPath does not emit a slash that would be read as a sequence', () => {
  // "epo:announcesRole / schema:foo/bar" is a three-hop path, not a two-hop
  // one — the query parses and means something the user never asked for.
  const r = makeRenderer();
  assert.equal(
    r._formatPropertyPath([EPO_ANNOUNCES_ROLE, SCHEMA_NESTED]),
    `epo:announcesRole / <${SCHEMA_NESTED}>`,
  );
});

test('_buildPathPattern brackets an unparseable type in the anchor', () => {
  const r = makeRenderer();
  navigatedTo(r, REVIEWER, [], null);
  assert.equal(
    r._buildPathPattern(REVIEWER, typedAs(SCHEMA_NESTED)),
    `?bar a <${SCHEMA_NESTED}> .`,
  );
});

test('_buildInfoRows offers a Name that can actually be pasted', () => {
  // The card says "use the following in your SPARQL query", so the Name row
  // is held to the same standard as the Path row.
  const r = makeRenderer();
  r.subjectIndex = r._buildIndex([quad(REVIEWER, RDF_TYPE, namedNode(SCHEMA_NESTED))]);
  const html = r._buildInfoRows(REVIEWER, r.subjectIndex.get(REVIEWER));

  assert.ok(!html.includes('schema:foo/bar'), 'never offers the malformed prefixed name');
  assert.ok(html.includes('&lt;http://schema.org/foo/bar&gt;'), 'offers the full IRI instead');
});

test('_buildInfoRows offers a parseable Name for a vocabulary subject', () => {
  // The card is also shown for ontology terms, which take a different branch
  // built from resolvePrefix() — same blind namespace split, same hazard.
  const r = makeRenderer();
  const html = r._buildInfoRows(SCHEMA_NESTED, new Map());

  assert.ok(!html.includes('schema:foo/bar'), 'never offers the malformed prefixed name');
  assert.ok(html.includes('&lt;http://schema.org/foo/bar&gt;'), 'offers the full IRI instead');
});

test('_buildInfoRows still shortens a well-formed vocabulary subject', () => {
  const r = makeRenderer();
  const html = r._buildInfoRows(EPO_NOTICE_CLASS, new Map());

  assert.ok(html.includes('epo:Notice'), 'prefixed name kept');
  assert.ok(html.includes('PREFIX epo:'), 'and its declaration offered alongside');
});

test('_buildInfoRows omits the prefix declaration when the name is a bracketed IRI', () => {
  // A PREFIX line is only useful if something below actually uses the prefix.
  const r = makeRenderer();
  assert.ok(!r._buildInfoRows(SCHEMA_NESTED, new Map()).includes('PREFIX schema:'));

  const typed = r._buildIndex([quad(REVIEWER, RDF_TYPE, namedNode(SCHEMA_NESTED))]);
  assert.ok(!r._buildInfoRows(REVIEWER, typed.get(REVIEWER)).includes('PREFIX schema:'));
});

// ── navigation context on every clickable term ──────────────────────
//
// The Path row is only correct if every link that navigates reports how it was
// reached. A link that reports nothing makes navigationPath() abandon the
// route, and the card silently drops back to a bare type binding — which looks
// like a rendering quirk rather than the lost information it is.

// The cycle marker is a guard inside _renderSubjectTree, entered when the
// subject is already on the current branch. _partitionObjects filters those
// out before recursing, so render() does not reach it today — the guard exists
// for a caller that forgets to. It is driven here through _renderSubjectTree,
// which is the entry point that would actually reach it.

test('_renderCycleMarker reports the route that reached it', () => {
  // The marker stands where a nested card would have been, so following it is
  // the same navigation and has to carry the same context.
  const r = makeRenderer();
  const ctx = { root: NOTICE, anchor: '?notice a epo:Notice', chain: [EPO_ANNOUNCES_ROLE] };
  const captured = [];
  const original = r._navigationContext.bind(r);
  r._navigationContext = (c) => { captured.push(c); return original(c); };

  r._renderCycleMarker(NOTICE, ctx);

  assert.deepEqual(captured, [ctx], 'the marker asks for the context it was given');
});

test('_renderSubjectTree hands the walked route to the cycle marker', () => {
  // Entering the guard the way a caller that skipped _partitionObjects would.
  const r = makeRenderer();
  r.subjectIndex = new Map([[NOTICE, new Map([[RDF_TYPE, [namedNode(EPO_NOTICE_CLASS)]]])]]);

  const seen = [];
  const original = r._renderCycleMarker.bind(r);
  r._renderCycleMarker = (subject, ctx) => { seen.push({ subject, ctx }); return original(subject, ctx); };

  const ctx = {
    root: NOTICE,
    anchor: '?notice a epo:Notice',
    chain: [EPO_ANNOUNCES_ROLE, EPO_PLAYED_BY],
  };
  r._renderSubjectTree(NOTICE, new Set([NOTICE]), EPO_PLAYED_BY, ctx);

  assert.equal(seen.length, 1, 'the guard fired');
  assert.deepEqual(seen[0].ctx.chain, [EPO_ANNOUNCES_ROLE, EPO_PLAYED_BY], 'full route preserved');
  assert.equal(seen[0].ctx.root, NOTICE);
  assert.equal(seen[0].ctx.anchor, '?notice a epo:Notice');
});

test('_partitionObjects is what keeps the cycle guard unreachable from render', () => {
  // If this ever stops holding, the guard becomes live — and it now carries
  // the route, so the card keeps working rather than silently resetting.
  const r = makeRenderer();
  r.subjectIndex = new Map([[NOTICE, new Map()]]);
  const [nestable, nonNestable] = r._partitionObjects([namedNode(NOTICE)], new Set([NOTICE]));

  assert.equal(nestable.length, 0, 'an ancestor is never recursed into');
  assert.equal(nonNestable.length, 1, 'it renders as a leaf instead');
});

test('predicate links deliberately carry no route', () => {
  // Clicking a predicate opens its definition in the ontology. That is not a
  // step on the walked route, so claiming the chain there would assert a
  // relationship the data does not contain. Locked down so the omission is
  // not later "fixed" into a bug.
  const r = makeRenderer();
  const predicates = new Map([[EPO_ANNOUNCES_ROLE, [literal('x')]]]);
  const ctx = { root: NOTICE, anchor: '?notice a epo:Notice', chain: [EPO_ANNOUNCES_ROLE] };

  const header = r._buildCardHeader(NOTICE, predicates, EPO_ANNOUNCES_ROLE, ctx);
  const predEl = header._children.find(c => c.classList?.contains('predicate'));
  assert.ok(predEl, 'the predicate label is rendered');
  assert.equal(predEl._listeners?.get('click')?.length ?? 0, 0, 'and navigates without a route');
});

// ── every navigating link in a rendered tree ────────────────────────
//
// The cycle marker lost its route because context is passed link by link, and
// one call site was missed. Rather than testing that site, this walks a real
// rendered tree and holds every navigating link to the rule — so the next call
// site that forgets is caught by a test nobody had to remember to write.

test('every link in a rendered tree either carries its route or is a predicate', () => {
  const captured = [];
  setController({ navigateTo: (facet) => captured.push(facet) });

  const container = document.createElement('div');
  const r = new TreeRenderer(container);
  r.render([
    quad(NOTICE, RDF_TYPE, namedNode(EPO_NOTICE_CLASS)),
    quad(NOTICE, EPO_ANNOUNCES_ROLE, namedNode(REVIEWER)),
    quad(REVIEWER, RDF_TYPE, namedNode(EPO_REVIEWER_CLASS)),
    quad(REVIEWER, EPO_PLAYED_BY, namedNode(ORGANISATION)),
    quad(ORGANISATION, RDF_TYPE, namedNode(EPO_ORGANISATION_CLASS)),
  ], {});

  // Force the lazy bodies so nested levels are included.
  for (const toggle of container.querySelectorAll('.tree-toggle')) {
    for (const handler of toggle._listeners.get('click') || []) {
      handler({ target: toggle, stopPropagation() {}, preventDefault() {} });
    }
  }

  // Click everything that navigates, remembering whether it was a predicate.
  const clicked = [];
  const walk = (el) => {
    for (const child of el._children || []) {
      if (child.nodeType !== 1) continue;
      const handlers = child._listeners?.get('click') || [];
      const navigates = handlers.length && !String(child.className).includes('tree-toggle');
      if (navigates) {
        const isPredicate = child.classList?.contains('predicate');
        const before = captured.length;
        handlers.forEach(h => h({ target: child, preventDefault() {}, stopPropagation() {} }));
        if (captured.length > before) clicked.push({ isPredicate, facet: captured[captured.length - 1] });
      }
      walk(child);
    }
  };
  walk(container);

  assert.ok(clicked.length >= 3, `expected several navigating links, got ${clicked.length}`);

  for (const { isPredicate, facet } of clicked) {
    if (isPredicate) {
      // Jumping to a predicate's definition is not a step along the route.
      assert.deepEqual(facet.viaPath, [], 'a predicate link reports no route');
      continue;
    }
    assert.ok(Array.isArray(facet.viaPath), 'a resource link reports a route array');
    assert.ok(facet.viaRoot, 'and the subject that route starts from');
    assert.ok(facet.viaRootPattern, 'and the pattern binding that subject');
  }
});

// ── names inherited from the notice ─────────────────────────────────
//
// A drill-down query returns one resource's triples, so the resources it
// refers to arrive untyped. The notice the user came from typed them, and
// DataView hands those statements down as `declaredTypes`.

test('a resource the current data does not type is named from the notice', () => {
  __setOntologyDataForTesting({ subClassOf: {} });
  const r = makeRenderer();
  r.render([quad(ORGANISATION, EPO_PLAYED_BY, namedNode(REVIEWER))], {
    declaredTypes: new Map([[REVIEWER, [EPO_REVIEWER_CLASS]]]),
  });

  assert.equal(r._typeName(REVIEWER), 'Reviewer');
});

test('what the current data says wins over what the notice said', () => {
  // The resource's own triples are the better source: the notice may have
  // stated only the class it needed, its own graph states them all.
  __setOntologyDataForTesting({ subClassOf: {} });
  const r = makeRenderer();
  r.render([quad(REVIEWER, RDF_TYPE, namedNode(EPO_ORGANISATION_CLASS))], {
    declaredTypes: new Map([[REVIEWER, [EPO_REVIEWER_CLASS]]]),
  });

  assert.equal(r._typeName(REVIEWER), 'Organisation');
});

test('a resource neither source types has no name', () => {
  __setOntologyDataForTesting({ subClassOf: {} });
  const r = makeRenderer();
  r.render([quad(ORGANISATION, EPO_PLAYED_BY, namedNode(REVIEWER))], {
    declaredTypes: new Map(),
  });

  assert.equal(r._typeName(REVIEWER), null);
});

test('inherited types survive the re-render that follows the ontology load', () => {
  // render() replays itself once the class hierarchy arrives. Dropping the
  // inherited map on that replay would rename every reference mid-view.
  __setOntologyDataForTesting({ subClassOf: {} });
  const r = makeRenderer();
  r.render([quad(ORGANISATION, EPO_PLAYED_BY, namedNode(REVIEWER))], {
    declaredTypes: new Map([[REVIEWER, [EPO_REVIEWER_CLASS]]]),
  });

  r.render(...r._lastRender);

  assert.equal(r._typeName(REVIEWER), 'Reviewer');
});
