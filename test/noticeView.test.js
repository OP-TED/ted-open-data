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
// NoticeView tests — exercises the request-token race in _fetchData.
//
// The race we're guarding against: user searches notice A, the procedure
// API call goes out, then before A's response arrives the user searches
// notice B. A's late response must NOT render its (now-stale) procedure
// data into the containers that B's call already cleared.
//
// The token guard in NoticeView._fetchData mirrors the controller's
// pattern but is its own siblings — broken just as easily by a refactor.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { resetShims } from './_helpers.js';
import { NoticeView } from '../src/js/NoticeView.js';

// Real publication numbers from the TED acceptance dataset.
const PUB_A = '00172531-2026';
const PUB_B = '00149228-2024';

// Minimal controller stub. NoticeView only uses .breadcrumb,
// .enrichNoticeFacet, and addEventListener('facet-changed').
function makeController(initialBreadcrumb = []) {
  const c = new EventTarget();
  c.breadcrumb = initialBreadcrumb;
  c.enrichedFacets = []; // for assertions
  c.enrichNoticeFacet = (publicationNumber, metadata) => {
    c.enrichedFacets.push({ publicationNumber, metadata });
  };
  return c;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Yield long enough for any pending microtasks AND macrotasks (like
// AbortController-based timeouts that schedule via setTimeout) to drain.
// Using setTimeout(0) bounces out of the microtask queue once, which is
// enough for the multi-step async chains in NoticeView._fetchData.
function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// Build a fake `Response` object that satisfies the bits NoticeView reads:
//   .ok, .status, .statusText, .json()
function fakeResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  };
}

// A minimal procedure-search response with one notice carrying a real
// procedure-identifier. Calls to NoticeView trigger two fetches per
// _fetchData: one for the notice lookup, one for the procedure listing.
function noticeLookupResponse(publicationNumber, procedureId) {
  return {
    notices: [{
      'publication-number': publicationNumber,
      'procedure-identifier': procedureId,
    }],
  };
}

function procedureListResponse(publicationNumber, procedureId) {
  return {
    notices: [{
      'publication-number': publicationNumber,
      'publication-date': '2026-03-12+01:00',
      'notice-version': 1,
      'notice-type': { value: 'can-standard' },
      'form-type': { value: 'result' },
      'buyer-country': ['ITA'],
      'customization-id': 'eforms-sdk-1.12',
      'procedure-identifier': procedureId,
    }],
  };
}

beforeEach(() => {
  resetShims();
});

// ── The race ───────────────────────────────────────────────────────

test('NoticeView._fetchData drops a late response from a superseded fetch', async () => {
  // We're going to fire _fetchData twice. Each invocation makes two
  // fetch() calls (notice lookup, then procedure listing). The fetch
  // stub returns deferred promises so we can control exactly when each
  // pair resolves.
  //
  // Order of events:
  //   1. _fetchData('A') starts → fetch #1 (notice lookup for A) goes out
  //   2. _fetchData('B') starts → bumps token, fetch #2 (notice lookup for B) goes out
  //   3. fetch #2 resolves → _fetchData('B') makes its second fetch → fetch #3 resolves → renders B
  //   4. fetch #1 finally resolves → token mismatch, A's chain bails out
  //
  // Assertion: only B's data was rendered/enriched, never A's.

  const fetchCalls = [];
  const fetchDeferreds = [];

  globalThis.fetch = (_url, _options) => {
    const d = deferred();
    fetchDeferreds.push(d);
    fetchCalls.push(_url);
    return d.promise;
  };

  const controller = makeController();
  const view = new NoticeView(controller);

  // Kick off A. Calling _fetchData directly skips _onFacetChanged (which
  // would short-circuit on cached procedure data and complicate the test).
  const fetchA = view._fetchData(PUB_A);
  await tick();
  assert.equal(fetchDeferreds.length, 1, 'A\'s notice lookup should be in flight');

  // Kick off B without awaiting A.
  const fetchB = view._fetchData(PUB_B);
  await tick();
  assert.equal(fetchDeferreds.length, 2, 'B\'s notice lookup should be in flight too');

  // Resolve B's first fetch (notice lookup) → B's _fetchData advances to
  // _fetchProcedures, which spawns one fetch per procedure id.
  fetchDeferreds[1].resolve(fakeResponse(noticeLookupResponse(PUB_B, 'proc-B')));
  await tick();
  assert.equal(fetchDeferreds.length, 3, 'B\'s procedure listing should now be in flight');

  // Resolve B's procedure listing.
  fetchDeferreds[2].resolve(fakeResponse(procedureListResponse(PUB_B, 'proc-B')));

  // Wait for B's chain to settle.
  await fetchB;

  // Assertion #1: B's enrichment landed.
  assert.equal(controller.enrichedFacets.length, 1);
  assert.equal(controller.enrichedFacets[0].publicationNumber, PUB_B);

  // Now resolve A — late.
  fetchDeferreds[0].resolve(fakeResponse(noticeLookupResponse(PUB_A, 'proc-A')));
  await fetchA;

  // Assertion #2: A's late chain did NOT enrich. The token guard
  // should have bailed out before _enrichHistoryEntry was called.
  assert.equal(controller.enrichedFacets.length, 1,
    'late A response must not enrich');
  assert.equal(controller.enrichedFacets[0].publicationNumber, PUB_B,
    'only B remains the enriched entry');
});

test('NoticeView._fetchData drops a late error from a superseded fetch', async () => {
  // If A's fetch *fails* late (after B has already succeeded), the
  // failure must NOT show in the error element — that would cover the
  // fresh state from B with a stale error.
  const fetchDeferreds = [];
  globalThis.fetch = () => {
    const d = deferred();
    fetchDeferreds.push(d);
    return d.promise;
  };

  const controller = makeController();
  const view = new NoticeView(controller);

  const fetchA = view._fetchData(PUB_A);
  await tick();
  const fetchB = view._fetchData(PUB_B);
  await tick();

  // B succeeds.
  fetchDeferreds[1].resolve(fakeResponse(noticeLookupResponse(PUB_B, 'proc-B')));
  await tick();
  fetchDeferreds[2].resolve(fakeResponse(procedureListResponse(PUB_B, 'proc-B')));
  await fetchB;

  // The errorEl should be hidden (B succeeded).
  assert.equal(view.errorEl.style.display, 'none');

  // A fails late.
  fetchDeferreds[0].reject(new Error('A failed late'));
  await fetchA;

  // The errorEl must still be hidden — A's stale error must not surface.
  assert.equal(view.errorEl.style.display, 'none',
    'stale error from A should not be displayed');
});
