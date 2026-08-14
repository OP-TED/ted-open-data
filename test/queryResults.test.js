/*
 * Copyright 2026 European Union
 *
 * Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
 * Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */
// QueryResults._isWebUrl and _renderCell tests.
//
// _isWebUrl determines which URI bindings in the results table get
// rendered as clickable links vs. plain text. Getting this wrong either
// breaks TED links (false negative) or makes ontology URIs clickable
// (false positive). Both are user-visible regressions.
//
// _renderCell is the rendering function that uses _isWebUrl.
// Tests cover the three cases: navigable web URL, ontology URI, literal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './_helpers.js';
import { QueryResults } from '../src/js/QueryResults.js';

// ── _isWebUrl ──────────────────────────────────────────────────────

test('_isWebUrl accepts a TED notice URL (https://ted.europa.eu)', () => {
  assert.equal(QueryResults._isWebUrl('https://ted.europa.eu/en/notice/-/detail/123-2024'), true);
});

test('_isWebUrl accepts an XML source URL (https://ted.europa.eu)', () => {
  assert.equal(QueryResults._isWebUrl('https://ted.europa.eu/en/notice/123-2024/xml'), true);
});

test('_isWebUrl rejects an ePO ontology URI (data.europa.eu)', () => {
  assert.equal(QueryResults._isWebUrl('http://data.europa.eu/a4g/ontology#Notice'), false);
});

test('_isWebUrl rejects an ePO resource URI (data.europa.eu)', () => {
  assert.equal(QueryResults._isWebUrl('http://data.europa.eu/a4g/resource/id_xxx_Notice'), false);
});

test('_isWebUrl rejects a publications.europa.eu authority URI', () => {
  assert.equal(QueryResults._isWebUrl('http://publications.europa.eu/resource/authority/notice-type/can-standard'), false);
});

test('_isWebUrl rejects a W3C namespace URI', () => {
  assert.equal(QueryResults._isWebUrl('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), false);
});

test('_isWebUrl rejects a purl.org URI', () => {
  assert.equal(QueryResults._isWebUrl('http://purl.org/dc/elements/1.1/identifier'), false);
});

test('_isWebUrl rejects a non-http URI', () => {
  assert.equal(QueryResults._isWebUrl('urn:isbn:978-3-16-148410-0'), false);
});

test('_isWebUrl rejects empty string', () => {
  assert.equal(QueryResults._isWebUrl(''), false);
});

test('_isWebUrl rejects a domain not in the allowlist', () => {
  // An http URI on an unknown domain is not navigable — the allowlist
  // ensures only explicitly approved domains produce clickable links.
  assert.equal(QueryResults._isWebUrl('https://example.com/some/path'), false);
});

// ── _renderCell ────────────────────────────────────────────────────

// Build a minimal QueryResults instance using Object.create to skip
// the constructor. The constructor requires Bootstrap (new bootstrap.Tab)
// and ChartView (new ChartView + ECharts) which are not available in
// Node.js. Object.create(QueryResults.prototype) gives us an object with
// all the class methods (including _renderCell) without running the
// constructor.
function makeQueryResults() {
  return Object.create(QueryResults.prototype);
}

test('_renderCell renders a web URL as an anchor element', () => {
  const qr = makeQueryResults();
  const binding = { type: 'uri', value: 'https://ted.europa.eu/en/notice/-/detail/123-2024' };
  const node = qr._renderCell(binding);
  // Should be an anchor element (nodeType 1), not a text node (nodeType 3)
  assert.equal(node.nodeType, 1, 'should be an element node');
  assert.equal(node.tagName, 'A', 'should be an anchor element');
  assert.equal(node.href, binding.value);
  assert.equal(node.target, '_blank');
  assert.equal(node.rel, 'noopener noreferrer');
  assert.equal(node.textContent, binding.value);
});

test('_renderCell renders an ontology URI as plain text', () => {
  const qr = makeQueryResults();
  const binding = { type: 'uri', value: 'http://data.europa.eu/a4g/ontology#Notice' };
  const node = qr._renderCell(binding);
  assert.equal(node.nodeType, 3);
  assert.equal(node.textContent || node.nodeValue, binding.value);
});

test('_renderCell renders a literal as plain text', () => {
  const qr = makeQueryResults();
  const binding = { type: 'literal', value: '2024-11-04' };
  const node = qr._renderCell(binding);
  assert.equal(node.nodeType, 3);
  assert.equal(node.textContent || node.nodeValue, '2024-11-04');
});

test('_renderCell renders undefined binding as empty text', () => {
  const qr = makeQueryResults();
  const node = qr._renderCell(undefined);
  assert.equal(node.nodeType, 3);
  assert.equal(node.textContent || node.nodeValue, '');
});

test('_renderCell does not make a javascript: URI clickable', () => {
  const qr = makeQueryResults();
  const binding = { type: 'uri', value: 'javascript:alert(1)' };
  const node = qr._renderCell(binding);
  // _isWebUrl parses the URI with new URL() and checks the hostname
  // against NAVIGABLE_DOMAINS. javascript: URIs don't have an http/https
  // protocol so they never match — rendered as plain text.
  assert.equal(node.nodeType, 3);
});

// ── _buildCurlCommand ──────────────────────────────────────────────
//
// The generated command is pasted directly into a shell. A SPARQL query
// containing a literal single quote (e.g. FILTER(?name = 'John')) survives
// encodeURIComponent unescaped, since encodeURIComponent does not encode
// `'`. Left as-is inside the curl command's single-quoted -d argument, it
// would prematurely close the shell string and corrupt or break the
// command — these tests pin the %27 escaping that prevents that.

test('_buildCurlCommand includes the endpoint, method, and headers', () => {
  const cmd = QueryResults._buildCurlCommand('https://example.com/sparql', 'query=x');
  assert.match(cmd, /^curl -X POST 'https:\/\/example\.com\/sparql'/);
  assert.match(cmd, /-H 'Content-Type: application\/x-www-form-urlencoded'/);
  assert.match(cmd, /-H 'Accept: application\/sparql-results\+json'/);
  assert.match(cmd, /-d 'query=x'/);
});

test('_buildCurlCommand escapes a literal single quote in the body to %27', () => {
  // encodeURIComponent leaves ' unescaped, so a SPARQL string literal like
  // FILTER(?name = 'John') would flow through as a bare quote here.
  const bodyWithQuote = "query=FILTER(?name%20=%20'John')";
  const cmd = QueryResults._buildCurlCommand('https://example.com/sparql', bodyWithQuote);
  assert.doesNotMatch(cmd, /'John'/, 'a literal quote must not survive into the shell argument');
  assert.match(cmd, /%27John%27/);
});

test('_buildCurlCommand leaves a body with no single quotes unchanged', () => {
  const body = 'query=SELECT%20%2A%20WHERE%20%7B%20%3Fs%20%3Fp%20%3Fo%20%7D&format=application%2Fsparql-results%2Bjson';
  const cmd = QueryResults._buildCurlCommand('https://example.com/sparql', body);
  assert.match(cmd, new RegExp(`-d '${body}'`));
});

test('_buildCurlCommand produces a single-quoted -d argument with no unescaped quote inside it', () => {
  const bodyWithQuote = "query=a'b'c";
  const cmd = QueryResults._buildCurlCommand('https://example.com/sparql', bodyWithQuote);
  // Extract the -d argument's quoted content and confirm it contains no
  // raw single quote (i.e. the shell would see exactly one quoted string).
  const match = cmd.match(/-d '([^\n]*)'$/);
  assert.ok(match, 'the -d argument should be present and single-quoted');
  assert.doesNotMatch(match[1], /'/, 'the body inside the quotes must not contain a raw single quote');
});
