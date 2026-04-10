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
// Random notice picker. Used by the "click here to pick a random
// notice" link on the Inspect tab (`#app-tab-search`).
//
// Strategy: pick a random day within the last LOOKBACK_DAYS and ask the
// SPARQL endpoint for any notice published on that day. If none is found
// (weekends and holidays are common offenders) expand the window and retry.

import { doSPARQL as defaultDoSPARQL } from './sparqlService.js';

const LOOKBACK_DAYS = 60;
const MAX_ATTEMPTS = 10;
const MAX_RANGE_DAYS = 14;

// Indirect call so tests can inject a stub via __setDoSPARQLForTesting().
let _doSPARQL = defaultDoSPARQL;

// Pick a random publication number. Throws if every attempt fails — the
// caller (SearchPanel._lucky) is responsible for surfacing the failure to
// the user. We deliberately do NOT fall back to a hardcoded notice: the
// user clicks "I'm feeling lucky" expecting a random pick, and silently
// returning the same hardcoded notice every time would be more confusing
// than admitting the endpoint is unavailable.
async function getRandomPublicationNumber() {
  let dayRange = 1;
  // Stash the most recent endpoint error so the final "gave up"
  // throw can include the real cause instead of a generic message.
  // Without this, a misconfigured endpoint that 500s on every
  // attempt looks identical to "the window happened to be empty
  // ten times in a row".
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const [startDate, endDate] = attempt === 0
      ? _singleDayWindow()
      : _expandedWindow(dayRange);

    const { result, error } = await _queryRandomNoticeInRange(startDate, endDate);
    if (result) return result;
    if (error) lastError = error;

    dayRange = Math.min(dayRange * 2, MAX_RANGE_DAYS);
  }

  const reason = lastError
    ? ` Last endpoint error: ${lastError.message}`
    : '';
  throw new Error(
    `Could not find a random notice — the SPARQL endpoint may be unavailable.${reason}`,
  );
}

// Pick a random day in the last LOOKBACK_DAYS and return [start, start+1).
function _singleDayWindow() {
  const today = new Date();
  const daysAgo = Math.floor(Math.random() * LOOKBACK_DAYS);
  const start = new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return [_toIsoDate(start), _toIsoDate(end)];
}

// Pick a random day and return a [start - range, start + range) window.
function _expandedWindow(range) {
  const today = new Date();
  const daysAgo = Math.floor(Math.random() * LOOKBACK_DAYS);
  const anchor = new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const start = new Date(anchor.getTime() - range * 24 * 60 * 60 * 1000);
  const end = new Date(anchor.getTime() + range * 24 * 60 * 60 * 1000);
  return [_toIsoDate(start), _toIsoDate(end)];
}

function _toIsoDate(date) {
  return date.toISOString().split('T')[0];
}

async function _queryRandomNoticeInRange(startDate, endDate) {
  const query = `
    PREFIX epo: <http://data.europa.eu/a4g/ontology#>
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

    CONSTRUCT {
      ?notice epo:hasNoticePublicationNumber ?publicationNumber .
    }
    WHERE {
      ?notice a epo:Notice ;
              epo:hasNoticePublicationNumber ?publicationNumber ;
              epo:hasPublicationDate ?publicationDate .
      FILTER (?publicationDate >= "${startDate}"^^xsd:date &&
              ?publicationDate <  "${endDate}"^^xsd:date)
    }
    LIMIT 1
  `;

  try {
    const { quads } = await _doSPARQL(query);
    for (const quad of quads) {
      if (quad.predicate.value.includes('hasNoticePublicationNumber')) {
        return { result: quad.object.value, error: null };
      }
    }
    return { result: null, error: null };
  } catch (error) {
    console.warn(`Failed to query notices for date range ${startDate} to ${endDate}:`, error);
    // Return the error alongside so the retry loop can tell
    // "empty window" apart from "endpoint failed" and surface the
    // real reason if every attempt fails.
    return { result: null, error };
  }
}

// ─────────────────────────────────────────────────────────────────
// Test-only hooks. Same pattern as labelService: an explicit setter
// for the doSPARQL stub so tests can drive the retry loop without
// hitting the real endpoint, and a reset to restore the real import
// between tests. Production code should never touch these.
function __setDoSPARQLForTesting(stub) {
  _doSPARQL = stub || defaultDoSPARQL;
}
function __resetForTesting() {
  _doSPARQL = defaultDoSPARQL;
}

export {
  getRandomPublicationNumber,
  __setDoSPARQLForTesting,
  __resetForTesting,
};
