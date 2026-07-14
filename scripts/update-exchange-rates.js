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

/**
 * Refresh exchange-rates.json (currency -> EUR) from the European Commission's
 * official monthly InforEuro rates.
 *
 * InforEuro publishes `value` = units of a currency per 1 EUR (EUR -> currency).
 * The snippet needs the inverse (currency -> EUR = 1 / value), matching the
 * lookup table the SPARQL BIND multiplies by.
 *
 * The set of currencies is taken from the *existing* file, so the table stays in
 * sync with what the dataset actually uses; a currency InforEuro doesn't list
 * keeps its previous value (and is reported), rather than being dropped.
 *
 * Usage: node scripts/update-exchange-rates.js <path-to-exchange-rates.json>
 * Exit code 0 on success (whether or not values changed); non-zero on failure.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const INFOREURO_URL = 'https://ec.europa.eu/budg/inforeuro/api/public/monthly-rates';
const SIG_FIGS = 3;

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/update-exchange-rates.js <path-to-exchange-rates.json>');
  process.exit(2);
}

/** Round to a fixed number of significant figures (keeps the file compact and honest about precision). */
function roundSig(value, sig = SIG_FIGS) {
  if (value === 0 || !Number.isFinite(value)) return value;
  const magnitude = Math.ceil(Math.log10(Math.abs(value)));
  const factor = Math.pow(10, sig - magnitude);
  return Math.round(value * factor) / factor;
}

async function main() {
  const current = JSON.parse(readFileSync(filePath, 'utf8'));
  const currencies = Object.keys(current.rates);

  const res = await fetch(INFOREURO_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`InforEuro request failed: HTTP ${res.status}`);
  const feed = await res.json();

  // isoA3Code -> units per EUR
  const perEur = new Map(feed.map(e => [e.isoA3Code, Number(e.value)]));

  const nextRates = {};
  const changed = [];
  const missing = [];
  for (const code of currencies) {
    if (code === 'EUR') { nextRates.EUR = 1.0; continue; }
    const units = perEur.get(code);
    if (!units || units <= 0) {
      nextRates[code] = current.rates[code]; // preserve prior value
      missing.push(code);
      continue;
    }
    const rate = roundSig(1 / units);
    nextRates[code] = rate;
    if (rate !== current.rates[code]) changed.push({ code, from: current.rates[code], to: rate });
  }

  const month = new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const next = {
    description: `Exchange rates to EUR, sourced from the European Commission InforEuro monthly ` +
      `accounting rates (https://ec.europa.eu/budg/inforeuro/) for ${month}. Values are the inverse ` +
      `of the published EUR->currency rate (1 / rate). Used by the currencyconversion autocomplete ` +
      `snippet in the SPARQL editor, for approximate value calculations only. Auto-updated by CI ` +
      `(see OP-TED/ted-open-data#96). Keep the keys in sync with the currencies returned by the ` +
      `sample query in the snippet; a currency not listed by InforEuro keeps its previous value.`,
    rates: nextRates,
  };

  // Report
  console.log(`Currencies: ${currencies.length} | refreshed from InforEuro: ${currencies.length - missing.length - 1} | changed: ${changed.length}`);
  if (changed.length) {
    console.log('Changed:');
    for (const c of changed.slice(0, 100)) console.log(`  ${c.code}: ${c.from} -> ${c.to}`);
  }
  if (missing.length) console.log(`Not in InforEuro (kept prior value): ${missing.join(', ')}`);

  const before = JSON.stringify(current);
  const after = JSON.stringify(next);
  if (before === after) {
    console.log('No change — file left untouched.');
    return;
  }
  writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n');
  console.log(`Wrote ${filePath}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
