import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRates, roundSig } from '../scripts/update-exchange-rates.js';

// Minimal stand-in for exchange-rates.json. BGN is in ALLOWED_MISSING; USD/GBP are not.
const current = { rates: { EUR: 1.0, USD: 0.92, GBP: 1.17, BGN: 0.511 } };
const entry = (isoA3Code, value) => ({ isoA3Code, value });

test('roundSig keeps 3 significant figures', () => {
  assert.equal(roundSig(1 / 655.957), 0.00152); // XAF peg
  assert.equal(roundSig(1.0536), 1.05);
  assert.equal(roundSig(0), 0);
});

test('throws on an empty feed instead of relabelling stale rates as current', () => {
  assert.throws(() => computeRates(current, []), /empty or malformed/);
});

test('throws on a partial feed when a required currency is absent', () => {
  // Only USD present: GBP (required) and BGN (allowed) are absent -> must fail on GBP.
  assert.throws(() => computeRates(current, [entry('USD', 1 / 0.9)]), /missing .*not on the known list/);
});

test('keeps the prior value for an allowed-missing currency without failing', () => {
  const { nextRates, missing } = computeRates(current, [entry('USD', 1 / 0.9), entry('GBP', 1 / 1.2)]);
  assert.deepEqual(missing, ['BGN']);
  assert.equal(nextRates.BGN, 0.511); // preserved, not dropped
  assert.equal(nextRates.EUR, 1.0);
});

test('reports only real rate movements (after rounding), not noise', () => {
  // USD inverts back to 0.92 (unchanged after rounding); GBP moves to 1.1.
  const { changed } = computeRates(current, [entry('USD', 1 / 0.92), entry('GBP', 1 / 1.10)]);
  const codes = changed.map(c => c.code);
  assert.ok(codes.includes('GBP'), 'GBP should be reported as changed');
  assert.ok(!codes.includes('USD'), 'USD rounds back to its prior value and must not be reported');
});
