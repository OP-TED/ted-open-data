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
// classifyError pins the contract between QueryEditor / DataView and the
// friendly error states on the Reuse tab. It keys off the `HTTP error.
// Status: NNN` prefix that `sparqlWorker.js` builds on non-OK responses;
// any drift in that prefix or in the branch order will silently degrade
// every error screen in the app. These tests are narrow on purpose:
// one case per branch, plus the regression cases that motivated the
// classifier rewrite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../src/js/errorMessages.js';

// ── Null / falsy input ─────────────────────────────────────────────

test('classifyError returns a generic message for null error', () => {
  const r = classifyError(null);
  assert.equal(r.friendly, 'The query could not be completed.');
  assert.equal(r.detail, null);
  assert.equal(r.action, null);
});

// ── Cancellation ──────────────────────────────────────────────────

test('classifyError detects AbortError by name', () => {
  const e = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
  const r = classifyError(e);
  assert.equal(r.friendly, 'Query cancelled.');
  assert.equal(r.action, null);
});

test('classifyError detects "cancelled" by message when name is not AbortError', () => {
  const r = classifyError(new Error('Query was cancelled'));
  assert.equal(r.friendly, 'Query cancelled.');
});

// ── 400 Bad Request ──────────────────────────────────────────────

test('classifyError classifies a Status: 400 as a syntax error and extracts the Virtuoso block', () => {
  const raw = "HTTP error. Status: 400\nVirtuoso 37000 Error SP030: SPARQL compiler, line 1: syntax error at 'BROKEN' before 'WHERE'";
  const r = classifyError(new Error(raw), 'select');
  assert.match(r.friendly, /could not process your query/i);
  assert.match(r.detail, /Virtuoso 37000 Error SP030/);
  assert.equal(r.action, null);
});

test('classifyError 400 falls back to stripped-prefix detail for non-Virtuoso backends', () => {
  const raw = 'HTTP error. Status: 400\nFuseki: unexpected token at line 2';
  const r = classifyError(new Error(raw));
  assert.match(r.friendly, /could not process your query/i);
  assert.equal(r.detail, 'Fuseki: unexpected token at line 2');
});

// ── 500 / 502 / 503 ─────────────────────────────────────────────

test('classifyError classifies a Status: 500 as an internal endpoint error', () => {
  const raw = 'HTTP error. Status: 500\nVirtuoso 42000 Error The query was killed';
  const r = classifyError(new Error(raw));
  assert.match(r.friendly, /internal error/i);
  assert.match(r.detail, /Virtuoso 42000 Error/);
});

test('classifyError treats 502 like 500 (reverse-proxy layer)', () => {
  const raw = 'HTTP error. Status: 502\n<html>nginx Bad Gateway</html>';
  const r = classifyError(new Error(raw));
  assert.match(r.friendly, /internal error|temporarily unavailable/i);
});

test('classifyError treats 503 like 500 (service unavailable)', () => {
  const raw = 'HTTP error. Status: 503\nService Unavailable';
  const r = classifyError(new Error(raw));
  assert.match(r.friendly, /internal error|temporarily unavailable/i);
});

// ── 504 Timeout — lane-aware ─────────────────────────────────────

test('classifyError 504 on SELECT lane returns the copy-URL recovery action', () => {
  const raw = 'HTTP error. Status: 504\nGateway Timeout';
  const r = classifyError(new Error(raw), 'select');
  assert.match(r.friendly, /timed out/i);
  assert.deepEqual(r.action, { label: 'copy the query URL', kind: 'copy-select-url' });
});

test('classifyError 504 on graph lane omits the action and suggests retry', () => {
  const raw = 'HTTP error. Status: 504\nGateway Timeout';
  const r = classifyError(new Error(raw), 'graph');
  assert.match(r.friendly, /endpoint may be under load|try again/i);
  assert.equal(r.action, null);
});

test('classifyError 524 is classified as a timeout (Cloudflare)', () => {
  const raw = 'HTTP error. Status: 524\nA timeout occurred';
  const r = classifyError(new Error(raw), 'select');
  assert.match(r.friendly, /timed out/i);
  assert.equal(r.action.kind, 'copy-select-url');
});

// ── Regression: 500-with-the-word-"timeout" must not be mis-classified ─

test('classifyError prefers timeout over 500 when the 500 body contains "timeout"', () => {
  // This was the exact bug that motivated the classifier rewrite: a
  // Virtuoso 500 whose body contained "Transaction timed out" was being
  // matched by the 500 branch first, hiding the correct timeout copy
  // (and the SELECT-lane copy-URL recovery action).
  const raw = 'HTTP error. Status: 500\nVirtuoso 42000 Error Transaction timed out';
  const r = classifyError(new Error(raw), 'select');
  assert.match(r.friendly, /timed out/i);
  assert.equal(r.action.kind, 'copy-select-url');
});

// ── Regression: substring-match false positives must not fire ────

test('classifyError does NOT misclassify an unrelated message containing "400"', () => {
  // The old classifier matched on `raw.includes('400')`, which would
  // flag a timestamp, a byte count, or a quoted literal as a 400.
  const r = classifyError(new Error('Query finished after 400ms'));
  // Fallthrough to "Unknown": the friendly line is the raw message,
  // not the 400 syntax-error copy.
  assert.equal(r.friendly, 'Query finished after 400ms');
});

test('classifyError does NOT misclassify a "5040" substring as 504', () => {
  // The old classifier matched on `raw.includes('504')`, which would
  // flag the literal "5040" as a timeout.
  const r = classifyError(new Error('result count: 5040'));
  assert.equal(r.friendly, 'result count: 5040');
});

// ── 413 Payload Too Large ────────────────────────────────────────

test('classifyError classifies 413 with a "shorten the query" hint', () => {
  const raw = 'HTTP error. Status: 413\nRequest Entity Too Large';
  const r = classifyError(new Error(raw));
  assert.match(r.friendly, /too large|shorten/i);
});

// ── Network failures (worker-relayed plain Errors) ───────────────

test('classifyError classifies "Failed to fetch" as a network failure', () => {
  const r = classifyError(new Error('Failed to fetch'));
  assert.match(r.friendly, /could not reach|internet connection/i);
});

test('classifyError classifies Node-side ECONNREFUSED as a network failure', () => {
  // Worker-relayed errors arrive as plain Error with just the message;
  // dev-proxy / test relays can surface Node errno text.
  const r = classifyError(new Error('connect ECONNREFUSED 127.0.0.1:8890'));
  assert.match(r.friendly, /could not reach|internet connection/i);
});

test('classifyError classifies ENOTFOUND as a network failure', () => {
  const r = classifyError(new Error('getaddrinfo ENOTFOUND bad.host'));
  assert.match(r.friendly, /could not reach|internet connection/i);
});

test('classifyError classifies a TLS certificate error as a network failure', () => {
  const r = classifyError(new Error('unable to verify the first certificate'));
  assert.match(r.friendly, /could not reach|internet connection/i);
});

// ── Unknown fallthrough ──────────────────────────────────────────

test('classifyError returns the raw message as the friendly line for unknown shapes', () => {
  const r = classifyError(new Error('something exotic happened'));
  assert.equal(r.friendly, 'something exotic happened');
  assert.equal(r.detail, null);
});

// ── serverMessage override takes precedence ─────────────────────

test('classifyError prefers error.serverMessage over the raw body extraction', () => {
  const e = Object.assign(
    new Error('HTTP error. Status: 400\nVirtuoso 37000 Error SP030: foo'),
    { serverMessage: 'Pre-extracted friendlier detail' },
  );
  const r = classifyError(e);
  assert.equal(r.detail, 'Pre-extracted friendlier detail');
});
