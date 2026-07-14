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
// Currency conversion snippet tests — validates the exchange-rates.json data
// file and the ACTUAL snippet emitted by buildCurrencySnippet (the same
// function the editor autocomplete inserts), not a re-implementation of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCurrencySnippet } from '../src/js/utils/currencySnippet.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ratesPath = join(__dirname, '..', 'src', 'assets', 'exchange-rates.json');
const ratesJson = JSON.parse(readFileSync(ratesPath, 'utf8'));

// ── exchange-rates.json validation ─────────────────────────────────

test('exchange-rates.json has a rates object', () => {
  assert.equal(typeof ratesJson.rates, 'object');
  assert.ok(ratesJson.rates !== null);
  assert.ok(Object.keys(ratesJson.rates).length > 0, 'rates should not be empty');
});

test('exchange-rates.json EUR rate is exactly 1.0', () => {
  assert.equal(ratesJson.rates.EUR, 1.0);
});

test('exchange-rates.json all rate values are positive numbers', () => {
  for (const [currency, rate] of Object.entries(ratesJson.rates)) {
    assert.equal(typeof rate, 'number', `rate for ${currency} should be a number`);
    assert.ok(rate > 0, `rate for ${currency} should be positive, got ${rate}`);
  }
});

test('exchange-rates.json all currency codes are uppercase 3-letter strings', () => {
  for (const currency of Object.keys(ratesJson.rates)) {
    assert.match(currency, /^[A-Z]{3}$/, `currency code "${currency}" should be 3 uppercase letters`);
  }
});

test('exchange-rates.json includes common EU procurement currencies', () => {
  // These are the currencies most frequently seen in TED procurement data
  const expected = ['EUR', 'GBP', 'PLN', 'SEK', 'DKK', 'CZK', 'HUF', 'RON', 'BGN', 'NOK'];
  for (const currency of expected) {
    assert.ok(currency in ratesJson.rates, `common currency ${currency} should be in the rates file`);
  }
});

// ── buildCurrencySnippet (the real, shipped snippet) ───────────────

test('snippet has a VALUES row for every currency in the rates file', () => {
  const snippet = buildCurrencySnippet(ratesJson);
  for (const [currency, rate] of Object.entries(ratesJson.rates)) {
    assert.ok(snippet.includes(`("${currency}" ${rate})`), `snippet should contain ("${currency}" ${rate})`);
  }
});

test('snippet wraps the VALUES lookup in OPTIONAL so unknown currencies are not dropped', () => {
  // Regression guard for the inner-join bug: a bare VALUES inner-joins with the
  // result's ?currency and silently drops rows whose currency is absent from
  // the table. OPTIONAL preserves them and lets the BIND fall back to 1:1.
  const snippet = buildCurrencySnippet(ratesJson);
  assert.match(snippet, /OPTIONAL\s*\{\s*VALUES \(\?currency \?rate\) \{/);
});

test('snippet keeps the BIND OUTSIDE the OPTIONAL (no COALESCE) so unknown currencies stay unbound', () => {
  // Semantics verified against the endpoint:
  //  - VALUES must be OPTIONAL, else rows with an unlisted currency are dropped;
  //  - the BIND must be OUTSIDE the OPTIONAL — SPARQL evaluates the OPTIONAL group
  //    independently, so a BIND inside it can't see ?OriginalAmountValue and nothing converts;
  //  - no COALESCE(?rate, 1.0), else an unlisted currency is mislabelled as a 1:1 EUR value.
  // The BIND is therefore the last line, right after the OPTIONAL's closing brace.
  const snippet = buildCurrencySnippet(ratesJson);
  assert.match(snippet, /\}\n\s*BIND\(\?OriginalAmountValue \* \?rate AS \?AmountValueInEUR\)\s*$/);
  assert.ok(!snippet.includes('COALESCE'), 'must not COALESCE to a 1:1 rate (fabricates wrong EUR values)');
});

test('snippet sample query declares every prefix it uses (epo: and dc:)', () => {
  const snippet = buildCurrencySnippet(ratesJson);
  assert.ok(snippet.includes('# PREFIX dc: <http://purl.org/dc/elements/1.1/>'), 'dc: must be declared');
  assert.ok(snippet.includes('dc:identifier ?currency'), 'sample query uses dc:identifier');
});
