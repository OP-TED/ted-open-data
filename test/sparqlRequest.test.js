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
// buildSparqlBody / buildSparqlUrl produce the POST body / GET URL that
// every lane of the app uses to talk to the endpoint. Since the Options UI
// was removed (issue #32), readSparqlOptions returns a FIXED option block
// instead of reading the DOM: strict on, debug/report off, timeout and
// default-graph-uri blank (and therefore omitted). These tests pin that
// contract and the "Copy URL exactly reproduces what Run Query ran"
// guarantee.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSparqlOptions, buildSparqlBody, buildSparqlUrl } from '../src/js/sparqlRequest.js';

const QUERY = 'SELECT * WHERE { ?s ?p ?o }';

// ── readSparqlOptions returns the fixed option block ──────────────

test('readSparqlOptions returns the fixed endpoint options (no DOM dependency)', () => {
  assert.deepEqual(readSparqlOptions(), {
    defaultGraphUri: '',
    timeout: '',
    strict: 'true',
    debug: 'false',
    report: 'false',
  });
});

test('readSparqlOptions returns a fresh object each call (no shared mutable constant)', () => {
  const first = readSparqlOptions();
  first.strict = 'mutated';
  assert.equal(readSparqlOptions().strict, 'true');
});

// ── buildSparqlBody — format handling ─────────────────────────────

test('buildSparqlBody defaults to sparql-results+json when no format given', () => {
  assert.match(buildSparqlBody(QUERY), /format=application%2Fsparql-results%2Bjson/);
});

test('buildSparqlBody honours an explicit format argument', () => {
  const body = buildSparqlBody(QUERY, 'text/csv');
  assert.match(body, /format=text%2Fcsv/);
  assert.doesNotMatch(body, /format=application%2Fsparql-results/);
});

// ── buildSparqlBody — query encoding ──────────────────────────────

test('buildSparqlBody percent-encodes the query string', () => {
  // Spaces, braces and `?` all need encoding; `*` is safe under RFC3986 and
  // encodeURIComponent leaves it alone, which Virtuoso accepts.
  assert.match(buildSparqlBody(QUERY),
    /query=SELECT%20\*%20WHERE%20%7B%20%3Fs%20%3Fp%20%3Fo%20%7D/);
});

// ── Fixed option block ────────────────────────────────────────────

test('buildSparqlBody always emits strict=true, debug=false, report=false', () => {
  const body = buildSparqlBody(QUERY);
  assert.match(body, /strict=true/);
  assert.match(body, /debug=false/);
  assert.match(body, /report=false/);
});

test('buildSparqlBody omits timeout and default-graph-uri (endpoint uses its own defaults)', () => {
  const body = buildSparqlBody(QUERY);
  assert.doesNotMatch(body, /timeout=/);
  assert.doesNotMatch(body, /default-graph-uri=/);
});

// ── buildSparqlUrl ────────────────────────────────────────────────

test('buildSparqlUrl prefixes the endpoint with a ? separator', () => {
  const url = buildSparqlUrl('https://example.com/sparql', QUERY);
  assert.ok(url.startsWith('https://example.com/sparql?'));
});

test('buildSparqlUrl produces the same parameter block as buildSparqlBody', () => {
  // "Copy Query" link must exactly reproduce what Run Query just ran.
  const body = buildSparqlBody(QUERY);
  const url = buildSparqlUrl('https://example.com/sparql', QUERY);
  assert.equal(url, `https://example.com/sparql?${body}`);
});
