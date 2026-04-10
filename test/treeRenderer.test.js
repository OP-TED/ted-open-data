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

// Real URIs from TED notice 00172531-2026's DESCRIBE response.
const NOTICE      = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Notice';
const PROCEDURE   = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Procedure_6dcsBnuV4FTNoRpTZHckqN';
const LOT         = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Lot_LOT-0001';
const CONTRACT    = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_SettledContract_CON-0001';
const RDF_TYPE    = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const EPO_CONCERNS_PROC = 'http://data.europa.eu/a4g/ontology#concernsProcedure';
const EPO_HAS_LOT_REF   = 'http://data.europa.eu/a4g/ontology#hasLotReference';
const EPO_NOTICE_CLASS  = 'http://data.europa.eu/a4g/ontology#Notice';
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
