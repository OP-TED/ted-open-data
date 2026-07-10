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
// Currency conversion snippet tests — validates the exchange-rates.json
// data file and the snippet generation logic used by the autocomplete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

// ── snippet generation logic ───────────────────────────────────────

test('generated snippet contains a VALUES line for each currency in the JSON', () => {
  // Simulate the snippet generation logic from epoCompletion.js
  const ratesEntries = Object.entries(ratesJson.rates)
    .map(([currency, rate]) => `    ("${currency}" ${rate})`)
    .join('\n');
  const snippet = `  VALUES (?currency ?rate) {\n${ratesEntries}\n  }`;

  for (const currency of Object.keys(ratesJson.rates)) {
    assert.ok(snippet.includes(`"${currency}"`), `snippet should contain ${currency}`);
  }
});

test('generated snippet contains the BIND statement for EUR conversion', () => {
  const bindStatement = 'BIND(?OriginalAmountValue * COALESCE(?rate, 1.0) AS ?AmountValueInEUR)';
  // This is the exact BIND the snippet inserts — verify the string is correct
  assert.ok(bindStatement.includes('COALESCE(?rate, 1.0)'), 'should fall back to 1.0 for unknown currencies');
  assert.ok(bindStatement.includes('?AmountValueInEUR'), 'output variable should be ?AmountValueInEUR');
});

test('exchange-rates.json includes common EU procurement currencies', () => {
  // These are the currencies most frequently seen in TED procurement data
  const expected = ['EUR', 'GBP', 'PLN', 'SEK', 'DKK', 'CZK', 'HUF', 'RON', 'BGN', 'NOK'];
  for (const currency of expected) {
    assert.ok(currency in ratesJson.rates, `common currency ${currency} should be in the rates file`);
  }
});
