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
// buildSparqlBody / buildSparqlUrl read the SPARQL options panel from
// the DOM and produce the POST body / GET URL that every lane of the
// app uses to talk to the endpoint. They absorb the three sites that
// previously hand-built the same option block with drift between
// them (the Copy URL path used to always include an empty
// default-graph-uri and substitute `30000` for a blank timeout; the
// editor submit path omits both when blank). These tests pin the
// expected contract so a future refactor cannot silently regress the
// "Copy URL exactly reproduces what Run Query just ran" guarantee.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetShims } from './_helpers.js';
import { buildSparqlBody, buildSparqlUrl } from '../src/js/sparqlRequest.js';

// Stage a minimal option block in the shared DOM shim. Individual
// tests override only the fields they need to assert on.
function setOptions({
  defaultGraphUri = '',
  timeout = '',
  strict = false,
  debug = false,
  report = false,
} = {}) {
  document.getElementById('default-graph-uri').value = defaultGraphUri;
  document.getElementById('timeout').value = timeout;
  document.getElementById('strict').checked = strict;
  document.getElementById('debug').checked = debug;
  document.getElementById('report').checked = report;
}

beforeEach(() => {
  resetShims();
  // Re-stage fresh option elements in the cleared shim.
  setOptions();
});

// ── buildSparqlBody — format handling ─────────────────────────────

test('buildSparqlBody defaults to sparql-results+json when no format given', () => {
  const body = buildSparqlBody('SELECT * WHERE { ?s ?p ?o }');
  assert.match(body, /format=application%2Fsparql-results%2Bjson/);
});

test('buildSparqlBody honours an explicit format argument', () => {
  const body = buildSparqlBody('SELECT * WHERE { ?s ?p ?o }', 'text/csv');
  assert.match(body, /format=text%2Fcsv/);
  assert.doesNotMatch(body, /format=application%2Fsparql-results/);
});

// ── buildSparqlBody — query encoding ──────────────────────────────

test('buildSparqlBody percent-encodes the query string', () => {
  const body = buildSparqlBody('SELECT * WHERE { ?s ?p ?o }');
  // Spaces, braces and `?` all need encoding; `*` is safe under
  // RFC3986 and encodeURIComponent leaves it alone, which is fine —
  // Virtuoso accepts it either way.
  assert.match(body, /query=SELECT%20\*%20WHERE%20%7B%20%3Fs%20%3Fp%20%3Fo%20%7D/);
});

// ── Conditional omission of default-graph-uri ─────────────────────

test('buildSparqlBody omits default-graph-uri when the input is blank', () => {
  setOptions({ defaultGraphUri: '' });
  const body = buildSparqlBody('SELECT * WHERE { ?s ?p ?o }');
  assert.doesNotMatch(body, /default-graph-uri=/);
});

test('buildSparqlBody includes default-graph-uri when the input is set', () => {
  setOptions({ defaultGraphUri: 'http://example.org/g' });
  const body = buildSparqlBody('SELECT * WHERE { ?s ?p ?o }');
  assert.match(body, /default-graph-uri=http%3A%2F%2Fexample\.org%2Fg/);
});

// ── Conditional omission of timeout ───────────────────────────────

test('buildSparqlBody omits timeout when the input is blank', () => {
  setOptions({ timeout: '' });
  const body = buildSparqlBody('SELECT * WHERE { ?s ?p ?o }');
  assert.doesNotMatch(body, /timeout=/);
});

test('buildSparqlBody includes timeout when the input is set', () => {
  setOptions({ timeout: '5000' });
  const body = buildSparqlBody('SELECT * WHERE { ?s ?p ?o }');
  assert.match(body, /timeout=5000/);
});

test('buildSparqlBody does NOT substitute a default value for blank timeout', () => {
  // Regression for S23: generateUrl used to emit `timeout=30000` when
  // the input was blank, diverging from what onSubmit actually ran.
  setOptions({ timeout: '' });
  const body = buildSparqlBody('SELECT * WHERE { ?s ?p ?o }');
  assert.doesNotMatch(body, /timeout=30000/);
});

// ── strict / debug / report always present as booleans ────────────

test('buildSparqlBody always emits strict/debug/report as true/false', () => {
  setOptions({ strict: true, debug: false, report: true });
  const body = buildSparqlBody('SELECT * WHERE { ?s ?p ?o }');
  assert.match(body, /strict=true/);
  assert.match(body, /debug=false/);
  assert.match(body, /report=true/);
});

test('buildSparqlBody emits strict=false when the checkbox is unchecked', () => {
  setOptions({ strict: false });
  const body = buildSparqlBody('SELECT * WHERE { ?s ?p ?o }');
  assert.match(body, /strict=false/);
});

// ── buildSparqlUrl prefixes the endpoint ──────────────────────────

test('buildSparqlUrl prefixes the endpoint with a ? separator', () => {
  const url = buildSparqlUrl('https://example.com/sparql', 'SELECT * WHERE { ?s ?p ?o }');
  assert.ok(url.startsWith('https://example.com/sparql?'));
});

test('buildSparqlUrl applies the same omission rules as buildSparqlBody', () => {
  // Blank defaultGraphUri / timeout must NOT appear in the URL either
  // — this is the regression test for "Copy URL diverges from what
  // Run Query just ran".
  setOptions({ defaultGraphUri: '', timeout: '' });
  const url = buildSparqlUrl('https://example.com/sparql', 'SELECT * WHERE { ?s ?p ?o }');
  assert.doesNotMatch(url, /default-graph-uri=/);
  assert.doesNotMatch(url, /timeout=/);
});

test('buildSparqlUrl and buildSparqlBody produce the same parameter block for the same inputs', () => {
  // Same inputs must produce the same body — the only difference is
  // the URL wrapper prefix.
  setOptions({ defaultGraphUri: 'http://example.org/g', timeout: '5000', strict: true });
  const body = buildSparqlBody('SELECT * WHERE { ?s ?p ?o }');
  const url = buildSparqlUrl('https://example.com/sparql', 'SELECT * WHERE { ?s ?p ?o }');
  assert.equal(url, `https://example.com/sparql?${body}`);
});
