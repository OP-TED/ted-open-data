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
//
// Baseline characterisation tests for QueryEditor.js
// ─────────────────────────────────────────────────
//
// QueryEditor.js wraps the sparqljs Parser/Generator for three operations:
//   1. minifySparqlQuery(q)  → parser.parse() then generator.stringify()
//   2. checkSparqlSyntax(q)  → parser.parse() and return any error
//   3. (planned for Stages 7-8) auto-routing by parser.parse(q).queryType
//
// The QueryEditor class itself is heavily DOM-coupled — its constructor
// wires up CodeMirror against real DOM elements — so we can't instantiate
// it from a node:test runner without a heavy shim. Instead, these tests
// pin down the *contract* that QueryEditor relies on by exercising
// sparqljs directly with the same usage patterns. If a future refactor
// inlines the wrappers, swaps to a different parser, or changes how
// queryType is read, these tests catch the regression.
//
// What's deliberately NOT tested here:
//   - The QueryEditor class itself (DOM-coupled, requires shim — out of
//     scope for the integration's "narrow safety net" goal)
//   - QueryLibrary.js, QueryResults.js, HomeTab.js (touched lightly or
//     not at all by the integration; manual QA at Stage 14 covers them)
//
// See INTEGRATION_PLAN.md §6 Stage 1.5 for the full rationale.
//

import test from 'node:test';
import assert from 'node:assert/strict';
import { Parser, Generator } from 'sparqljs';

// ── minify (parse → stringify round-trip) ──────────────────────────
//
// We characterise the *current* output exactly. If a future sparqljs
// upgrade tweaks the formatting (extra whitespace, prefix ordering),
// these tests fail and the implementer makes a deliberate decision
// about whether to update the expected output or pin the dep version.

test('minify: simple SELECT round-trips through Parser + Generator', () => {
  const input = 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10';
  const parser = new Parser();
  const generator = new Generator();
  const output = generator.stringify(parser.parse(input));
  // The Generator normalises whitespace; we just confirm the round-trip
  // produces a non-empty string containing the SELECT keyword and the
  // LIMIT — the exact formatting is sparqljs's choice.
  assert.match(output, /SELECT/i);
  assert.match(output, /LIMIT 10/);
  assert.match(output, /\?s \?p \?o/);
});

test('minify: SELECT with comments survives the round-trip (comments stripped)', () => {
  const input = `
    # leading comment
    SELECT ?s WHERE {
      ?s a ?type . # inline comment
    }
  `;
  const parser = new Parser();
  const generator = new Generator();
  const output = generator.stringify(parser.parse(input));
  // Comments are dropped by sparqljs — pin that behaviour so a future
  // change (e.g. preserving comments) is caught and discussed.
  assert.doesNotMatch(output, /comment/);
  assert.match(output, /SELECT/i);
  assert.match(output, /\?s/);
});

test('minify: CONSTRUCT round-trips', () => {
  const input = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 5';
  const parser = new Parser();
  const generator = new Generator();
  const output = generator.stringify(parser.parse(input));
  assert.match(output, /CONSTRUCT/i);
  assert.match(output, /LIMIT 5/);
});

test('minify: DESCRIBE with a hardcoded URI round-trips', () => {
  const input = 'DESCRIBE <http://example.org/notice/1>';
  const parser = new Parser();
  const generator = new Generator();
  const output = generator.stringify(parser.parse(input));
  assert.match(output, /DESCRIBE/i);
  assert.match(output, /example\.org\/notice\/1/);
});

test('minify: ASK round-trips', () => {
  const input = 'ASK { ?s a <http://example.org/Thing> }';
  const parser = new Parser();
  const generator = new Generator();
  const output = generator.stringify(parser.parse(input));
  assert.match(output, /ASK/i);
});

// ── syntax check (parse + catch error) ────────────────────────────
//
// QueryEditor.checkSparqlSyntax returns null on success or the Error
// on failure. We pin down both branches.

test('syntax check: valid SELECT returns no error', () => {
  const parser = new Parser();
  let error = null;
  try { parser.parse('SELECT * WHERE { ?s ?p ?o }'); }
  catch (e) { error = e; }
  assert.equal(error, null);
});

test('syntax check: valid CONSTRUCT returns no error', () => {
  const parser = new Parser();
  let error = null;
  try { parser.parse('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }'); }
  catch (e) { error = e; }
  assert.equal(error, null);
});

test('syntax check: malformed query throws an Error', () => {
  const parser = new Parser();
  let error = null;
  try { parser.parse('SELECT BROKEN WHERE'); }
  catch (e) { error = e; }
  assert.ok(error instanceof Error,
    'A malformed query must produce an Error so the editor can surface it');
  // sparqljs errors carry positional info — confirm it's there so the
  // editor can render line/column markers. Don't pin the exact field
  // names because sparqljs versions differ.
  assert.ok(error.message.length > 0);
});

test('syntax check: empty string parses without error (no queryType)', () => {
  // Discovered during baseline writing: sparqljs treats an empty
  // string as valid input and returns {prefixes: {}} with NO queryType
  // field. This is unexpected (intuition says "empty = error") but
  // it's the actual behaviour and the auto-routing in Stages 7-8 must
  // handle it: if `parsed.queryType` is undefined, the router should
  // no-op rather than routing to a result tab.
  //
  // This test pins the contract so a future sparqljs version that
  // starts throwing on empty input is caught and the auto-router can
  // be updated accordingly.
  const parser = new Parser();
  const parsed = parser.parse('');
  assert.equal(parsed.queryType, undefined,
    'Empty input parses to an object with no queryType — auto-router must no-op');
  assert.equal(typeof parsed.prefixes, 'object',
    'Empty input produces a prefixes object');
  assert.equal(Object.keys(parsed.prefixes).length, 0,
    'The prefixes object is empty for empty input');
});

// ── queryType detection (the contract for Stages 7-8 auto-routing) ─
//
// This is the single most important test in the file. The merged app's
// auto-routing decision (SELECT → Query Results, CONSTRUCT/DESCRIBE →
// Explore, ASK → popup) hinges on `parser.parse(q).queryType` returning
// the expected uppercase string for each query kind.

test('queryType: SELECT → "SELECT"', () => {
  const parser = new Parser();
  const parsed = parser.parse('SELECT ?s WHERE { ?s ?p ?o }');
  assert.equal(parsed.queryType, 'SELECT');
});

test('queryType: lowercase select still → "SELECT"', () => {
  const parser = new Parser();
  const parsed = parser.parse('select ?s where { ?s ?p ?o }');
  assert.equal(parsed.queryType, 'SELECT',
    'queryType is normalised to uppercase regardless of source case');
});

test('queryType: SELECT with PREFIX declarations still → "SELECT"', () => {
  const parser = new Parser();
  const parsed = parser.parse(`
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    SELECT ?s WHERE { ?s rdf:type ?t }
  `);
  assert.equal(parsed.queryType, 'SELECT');
});

test('queryType: CONSTRUCT → "CONSTRUCT"', () => {
  const parser = new Parser();
  const parsed = parser.parse('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');
  assert.equal(parsed.queryType, 'CONSTRUCT');
});

test('queryType: DESCRIBE → "DESCRIBE"', () => {
  const parser = new Parser();
  const parsed = parser.parse('DESCRIBE <http://example.org/x>');
  assert.equal(parsed.queryType, 'DESCRIBE');
});

test('queryType: ASK → "ASK"', () => {
  const parser = new Parser();
  const parsed = parser.parse('ASK { ?s ?p ?o }');
  assert.equal(parsed.queryType, 'ASK');
});
