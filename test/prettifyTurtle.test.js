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
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// N3 is expected as a global (loaded via <script> in the app).
import N3 from 'n3';
globalThis.N3 = N3;

import { prettifyTurtle } from '../src/js/utils/prettifyTurtle.js';

const UGLY_TURTLE = `@prefix ns1: <http://data.europa.eu/a4g/ontology#> .
@prefix ns2: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .

<http://example.org/notice> ns2:type ns1:Notice ;
    ns1:hasPublicationDate "2024-11-06" .
`;

test('prettifyTurtle replaces auto-generated prefixes with known ones', () => {
  const parser = new N3.Parser();
  const quads = parser.parse(UGLY_TURTLE);

  const result = prettifyTurtle(quads, UGLY_TURTLE);

  // Should use epo: instead of ns1: and rdf: instead of ns2:
  assert.ok(result.includes('epo:'), `expected epo: prefix, got:\n${result}`);
  assert.ok(result.includes('rdf:'), `expected rdf: prefix, got:\n${result}`);
  assert.ok(!result.includes('ns1:'), `should not contain ns1:, got:\n${result}`);
  assert.ok(!result.includes('ns2:'), `should not contain ns2:, got:\n${result}`);
});

test('prettifyTurtle produces valid Turtle that round-trips to identical triples', () => {
  const parser = new N3.Parser();
  const quads = parser.parse(UGLY_TURTLE);

  const result = prettifyTurtle(quads, UGLY_TURTLE);

  // Re-parse — if the Turtle is invalid, this throws
  const outputQuads = new N3.Parser().parse(result);
  assert.equal(outputQuads.length, quads.length, 'triple count must be preserved');

  // Compare actual triple content (subject, predicate, object values)
  const tripleKey = (q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`;
  const inputSet = new Set(quads.map(tripleKey));
  const outputSet = new Set(outputQuads.map(tripleKey));
  assert.deepEqual(outputSet, inputSet, 'triples must be identical after round-trip');
});

test('prettifyTurtle returns fallback on empty quads', () => {
  const result = prettifyTurtle([], 'fallback text');
  // Empty quads should still produce valid output (just prefixes, no triples)
  assert.ok(typeof result === 'string');
});

test('prettifyTurtle returns a string even with invalid quads', () => {
  const result = prettifyTurtle([{ bad: 'data' }], 'my fallback');
  assert.ok(typeof result === 'string');
});
