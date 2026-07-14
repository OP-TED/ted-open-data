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
 * CodeMirror v6 autocomplete source for ePO ontology terms and SPARQL.
 * Loads terms from a local JSON file and provides context-aware completions.
 */

import { buildCurrencySnippet } from './utils/currencySnippet.js';

let epoData = null;
let loadingPromise = null;
let exchangeRatesData = null;
let exchangeRatesPromise = null;

/**
 * Load ePO terms from the JSON file. Called once, cached thereafter.
 */
async function ensureLoaded() {
  if (epoData) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = fetch('src/assets/epo-terms-v4.json')
    .then(r => r.json())
    .then(data => { epoData = data; })
    .catch(err => {
      console.error('Failed to load ePO terms:', err);
      loadingPromise = null;
    });
  return loadingPromise;
}

// Exchange rates are served from the protected `data/exchange-rates` branch so they can be
// refreshed by CI without an app release (see issue #96). The `refs/heads/` form is required
// because the branch name contains a slash. If the remote is unreachable — or slow: the fetch
// is time-boxed so a hanging request still fails over promptly — we fall back to the copy
// bundled with the app, which is approximate but keeps the snippet working.
const REMOTE_EXCHANGE_RATES_URL =
  'https://raw.githubusercontent.com/OP-TED/ted-open-data/refs/heads/data/exchange-rates/exchange-rates.json';
const LOCAL_EXCHANGE_RATES_URL = 'src/assets/exchange-rates.json';
const REMOTE_EXCHANGE_RATES_TIMEOUT_MS = 4000;

/**
 * Load exchange rates, preferring the CI-maintained data branch and falling back to the
 * bundled copy. Called once, cached thereafter.
 */
async function ensureExchangeRatesLoaded() {
  if (exchangeRatesData) return;
  if (exchangeRatesPromise) return exchangeRatesPromise;
  exchangeRatesPromise = fetch(REMOTE_EXCHANGE_RATES_URL, { signal: AbortSignal.timeout(REMOTE_EXCHANGE_RATES_TIMEOUT_MS) })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch(err => {
      console.warn('Remote exchange rates unavailable, using bundled copy:', err);
      return fetch(LOCAL_EXCHANGE_RATES_URL).then(r => r.json());
    })
    .then(data => { exchangeRatesData = data; })
    .catch(err => {
      console.error('Failed to load exchange rates:', err);
      exchangeRatesPromise = null;
    });
  return exchangeRatesPromise;
}

/**
 * CodeMirror completion source for SPARQL + ePO.
 * Provides completions for:
 * - SPARQL keywords (SELECT, WHERE, FILTER, etc.)
 * - PREFIX declarations (with full URIs)
 * - ePO classes (after "a " or "rdf:type")
 * - ePO properties (after a prefix like "epo:")
 */
export function epoCompletionSource(context) {
  if (!epoData) {
    ensureLoaded();
    return null;
  }
  // Also ensure exchange rates are loading (non-blocking)
  if (!exchangeRatesData) ensureExchangeRatesLoaded();

  // Get the word being typed
  const word = context.matchBefore(/[\w:]+/);

  const text = word ? word.text : '';
  const from = word ? word.from : context.pos;

  // Get the line up to the cursor for context
  const line = context.state.doc.lineAt(context.pos);
  const lineText = line.text.substring(0, context.pos - line.from);

  const options = [];

  // After "PREFIX " — suggest prefix declarations (even with no word typed)
  if (/PREFIX\s+$/i.test(lineText)) {
    for (const [prefix, uri] of Object.entries(epoData.prefixes)) {
      options.push({
        label: `${prefix}: <${uri}>`,
        type: 'keyword',
        apply: `${prefix}: <${uri}>`
      });
    }
    if (options.length > 0) return { from: context.pos, options };
  }

  // After "a " or "rdf:type " — suggest classes (even with no word typed)
  if (/\ba\s+$/.test(lineText) || /rdf:type\s+$/.test(lineText)) {
    for (const cls of epoData.classes) {
      options.push({ label: `epo:${cls}`, type: 'class' });
    }
    if (options.length > 0) return { from: context.pos, options };
  }

  // Need a word for the remaining completions
  if (!word && !context.explicit) return null;

  // After "epo:" — suggest classes and properties
  if (text.startsWith('epo:')) {
    const fragment = text.substring(4).toLowerCase();
    for (const cls of epoData.classes) {
      if (cls.toLowerCase().startsWith(fragment)) {
        options.push({ label: `epo:${cls}`, type: 'class', boost: 2 });
      }
    }
    for (const prop of epoData.objectProperties) {
      if (prop.toLowerCase().startsWith(fragment)) {
        options.push({ label: `epo:${prop}`, type: 'property', boost: 1 });
      }
    }
    for (const prop of epoData.datatypeProperties) {
      if (prop.toLowerCase().startsWith(fragment)) {
        options.push({ label: `epo:${prop}`, type: 'property', boost: 1 });
      }
    }
    if (options.length > 0) return { from, options };
  }

  // After any known prefix (other than epo:) — don't suggest ePO terms
  const prefixMatch = text.match(/^(\w+):/);
  if (prefixMatch && prefixMatch[1] !== 'epo') {
    return null;
  }

  // General context — suggest keywords, prefixes, and snippets
  const lowerText = text.toLowerCase();
  for (const kw of epoData.keywords) {
    if (kw.toLowerCase().startsWith(lowerText)) {
      options.push({ label: kw, type: 'keyword' });
    }
  }

  // Also suggest "epo:" prefix if user is typing something that starts with 'e'
  if ('epo:'.startsWith(lowerText) && lowerText.length > 0) {
    options.push({ label: 'epo:', type: 'namespace' });
  }

  // Snippet: insert all standard prefixes at once
  if ('prefixes'.startsWith(lowerText) && lowerText.length > 0) {
    const allPrefixes = Object.entries(epoData.prefixes)
      .map(([prefix, uri]) => `PREFIX ${prefix}: <${uri}>`)
      .join('\n');
    options.push({
      label: 'prefixes (insert all standard prefixes)',
      type: 'text',
      apply: allPrefixes,
      boost: 3
    });
  }

  // Snippet: insert currency conversion OPTIONAL VALUES block and BIND
  if ('currencyconversion'.startsWith(lowerText) && lowerText.length > 0 && exchangeRatesData) {
    options.push({
      label: 'currencyconversion (insert exchange rates to EUR)',
      type: 'text',
      apply: buildCurrencySnippet(exchangeRatesData),
      boost: 3
    });
  }

  if (options.length === 0) return null;
  return { from, options };
}

/**
 * Returns the loaded ePO data, or null if not yet loaded.
 */
export function getEpoData() {
  return epoData;
}

// Start loading immediately when the module is imported
ensureLoaded();
ensureExchangeRatesLoaded();
