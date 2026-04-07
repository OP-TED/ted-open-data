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
// ExplorerController tests — the crown jewel is the request-token race
// guard in _executeCurrentQuery (test T8 from the pr-test-analyzer's
// proposal). The URL round-trip and _loadFromSession filter tests are
// smaller but guard behaviors that silently break with nothing else
// to catch them.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Install globals before importing the code under test.
import { resetShims, setLocation } from './_helpers.js';
import { ExplorerController } from '../src/js/ExplorerController.js';
import { createPublicationNumberFacet } from '../src/js/facets.js';

const PUB_A = '00172531-2026';
const PUB_B = '00149228-2024';

// Manually-resolvable promise so tests can control exactly when a query
// "returns" from the stubbed doSPARQL.
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetShims();
});

// ── The token race ────────────────────────────────────────────────

test('token race: late response from a superseded search does not overwrite fresh state', async () => {
  // Two deferreds: the first simulates a slow search(A), the second a
  // fast search(B) that arrives after A was initiated but resolves first.
  const dA = deferred();
  const dB = deferred();
  let callCount = 0;
  const doSPARQL = (_query) => {
    callCount++;
    return callCount === 1 ? dA.promise : dB.promise;
  };

  const controller = new ExplorerController({ doSPARQL });
  const facetA = createPublicationNumberFacet(PUB_A);
  const facetB = createPublicationNumberFacet(PUB_B);

  // Fire both searches without awaiting the first. Each one kicks off an
  // _executeCurrentQuery that takes a fresh request token.
  const searchA = controller.search(facetA);
  const searchB = controller.search(facetB);

  // Resolve B first (the "fresh" query), then A (the "stale" query).
  const resultsB = { quads: [], size: 42, rawTurtle: 'B' };
  const resultsA = { quads: [], size: 99, rawTurtle: 'A' };
  dB.resolve(resultsB);
  await searchB;
  dA.resolve(resultsA);
  await searchA;

  // Fresh results from B must be the survivor. A's late resolution is dropped.
  assert.equal(controller.results, resultsB,
    'controller.results should hold B\'s results, not A\'s stale reply');
  assert.equal(controller.results.size, 42);

  // isLoading should be false once the fresh query finishes. The stale
  // query's finally branch must not touch it because its token is stale.
  assert.equal(controller.isLoading, false,
    'isLoading should be cleared by B, not re-set by stale A');

  // currentFacet is B.
  assert.equal(controller.currentFacet.value, '00149228-2024');
});

test('token race: stale error does not clobber a fresh successful result', async () => {
  const dA = deferred();
  const dB = deferred();
  let callCount = 0;
  const doSPARQL = (_query) => {
    callCount++;
    return callCount === 1 ? dA.promise : dB.promise;
  };

  const controller = new ExplorerController({ doSPARQL });
  const searchA = controller.search(createPublicationNumberFacet(PUB_A));
  const searchB = controller.search(createPublicationNumberFacet(PUB_B));

  // B succeeds first; then A rejects late.
  const resultsB = { quads: [], size: 5, rawTurtle: 'B' };
  dB.resolve(resultsB);
  await searchB;
  dA.reject(new Error('A failed late'));
  await searchA;

  assert.equal(controller.results, resultsB);
  assert.equal(controller.error, null,
    'Stale error from A should not surface after B\'s success');
});

// ── cancelCurrentQuery (stop button) ─────────────────────────────

test('cancelCurrentQuery invokes the cancel hook and clears loading state', async () => {
  const d = deferred();
  let cancelCallCount = 0;
  const controller = new ExplorerController({
    doSPARQL: () => d.promise,
    cancelAllSparqlRequests: () => {
      cancelCallCount++;
      // Production behaviour: the terminated worker causes all pending
      // promises to reject with a CancelledError. Simulate that here.
      const err = new Error('SPARQL request cancelled');
      err.name = 'CancelledError';
      d.reject(err);
    },
  });

  const facet = createPublicationNumberFacet(PUB_A);
  const searchPromise = controller.search(facet);

  // Let the search advance into the in-flight state.
  await new Promise(r => setTimeout(r, 0));
  assert.equal(controller.isLoading, true, 'loading should be true while in flight');

  // User clicks stop.
  controller.cancelCurrentQuery();
  assert.equal(cancelCallCount, 1, 'cancel hook should have fired once');

  // Wait for the search promise to settle.
  await searchPromise;

  // Controller should land in a clean state: no results, no error, not loading.
  assert.equal(controller.isLoading, false);
  assert.equal(controller.results, null, 'results should be null after cancel');
  assert.equal(controller.error, null, 'error should be null after cancel (not a real error)');
});

test('cancelCurrentQuery is a no-op when no query is in flight', () => {
  let cancelCallCount = 0;
  const controller = new ExplorerController({
    doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }),
    cancelAllSparqlRequests: () => { cancelCallCount++; },
  });

  // isLoading is false immediately after construction.
  assert.equal(controller.isLoading, false);
  controller.cancelCurrentQuery();
  assert.equal(cancelCallCount, 0, 'should not call cancel hook when nothing is running');
});

test('cancelCurrentQuery during a navigation does not affect the fresh search that replaces it', async () => {
  // Regression guard: after cancelling, the user searches something new.
  // The cancel must not leave the controller in a broken state that
  // prevents the fresh search from rendering.
  const dA = deferred();
  const dB = deferred();
  let callCount = 0;
  const controller = new ExplorerController({
    doSPARQL: () => { callCount++; return callCount === 1 ? dA.promise : dB.promise; },
    cancelAllSparqlRequests: () => {
      const err = new Error('SPARQL request cancelled');
      err.name = 'CancelledError';
      dA.reject(err);
    },
  });

  const searchA = controller.search(createPublicationNumberFacet(PUB_A));
  await new Promise(r => setTimeout(r, 0));

  controller.cancelCurrentQuery();
  await searchA;
  assert.equal(controller.isLoading, false);

  // Fresh search should work normally.
  const searchB = controller.search(createPublicationNumberFacet(PUB_B));
  const resultsB = { quads: [], size: 7, rawTurtle: 'B' };
  dB.resolve(resultsB);
  await searchB;

  assert.equal(controller.results, resultsB);
  assert.equal(controller.error, null);
  assert.equal(controller.isLoading, false);
});

// ── URL round-trip ────────────────────────────────────────────────

test('URL round-trip: getShareableUrl produces a URL that initFromUrlParams can load', async () => {
  const dummyResults = { quads: [], size: 1, rawTurtle: '' };
  const doSPARQL = async () => dummyResults;

  // First controller: run a search, then build the share URL.
  const producer = new ExplorerController({ doSPARQL });
  const originalFacet = createPublicationNumberFacet(PUB_A);
  await producer.search(originalFacet);

  const shareUrl = producer.getShareableUrl();
  assert.ok(shareUrl.includes('facet='),
    'Share URL should carry a facet query parameter');

  // Move the shim's location to the share URL and fresh-load it from there.
  setLocation(shareUrl);

  // Second controller: loads from the URL.
  resetShimsExceptLocation();
  setLocation(shareUrl);
  const consumer = new ExplorerController({ doSPARQL });
  const result = consumer.initFromUrlParams();
  assert.equal(result.status, 'loaded', 'initFromUrlParams should report loaded for a valid share URL');

  // Give the microtasks a chance to settle _executeCurrentQuery.
  await new Promise(r => setTimeout(r, 0));

  assert.equal(consumer.currentFacet.type, 'notice-number');
  assert.equal(consumer.currentFacet.value, '00172531-2026');
});

test('getShareableUrl strips enrichment fields, keeping only identity', async () => {
  const dummyResults = { quads: [], size: 1, rawTurtle: '' };
  const controller = new ExplorerController({ doSPARQL: async () => dummyResults });
  await controller.search(createPublicationNumberFacet(PUB_A));

  // Enrich the facet with the same kind of metadata NoticeView attaches
  // after the TED API resolves the procedure.
  controller.enrichNoticeFacet(PUB_A, {
    publicationDate: '2026-01-15',
    noticeType: 'Contract notice',
    formType: 'F02',
    buyerCountry: 'BE',
    customizationId: 'eforms-sdk-2.0.0',
    noticeVersion: '01',
  });

  const shareUrl = controller.getShareableUrl();
  const facetParam = new URL(shareUrl).searchParams.get('facet');
  const parsed = JSON.parse(facetParam);

  // Only identity-defining fields survive.
  assert.deepEqual(parsed, { type: 'notice-number', value: PUB_A });
  assert.equal(parsed.publicationDate, undefined);
  assert.equal(parsed.noticeType, undefined);
  assert.equal(parsed.timestamp, undefined);
});

test('URL round-trip: reports status:invalid reason:shape for a garbage facet', () => {
  setLocation('http://localhost:8080/?facet=' + encodeURIComponent('{"value":"foo"}'));
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  const result = controller.initFromUrlParams();
  assert.deepEqual(result, { status: 'invalid', reason: 'shape' });
  assert.equal(controller.currentFacet, null);
});

test('URL round-trip: reports status:invalid reason:parse for malformed JSON', () => {
  setLocation('http://localhost:8080/?facet=%7Bnot-json');
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  const result = controller.initFromUrlParams();
  assert.deepEqual(result, { status: 'invalid', reason: 'parse' });
  assert.equal(controller.currentFacet, null);
});

test('URL round-trip: reports status:absent when no ?facet= is present', () => {
  setLocation('http://localhost:8080/');
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  const result = controller.initFromUrlParams();
  assert.deepEqual(result, { status: 'absent' });
});

// ── _loadFromSession filter ───────────────────────────────────────

test('_loadFromSession silently drops non-notice-number entries from old storage', () => {
  // Seed sessionStorage with a mix of valid notice-number entries and
  // legacy query entries; the controller should only surface the first.
  const legacy = [
    { type: 'notice-number', value: '00172531-2026', timestamp: 1 },
    { type: 'query', query: 'SELECT * WHERE { ?s ?p ?o }', timestamp: 2 },
    { type: 'named-node', term: { value: 'http://example.org/x' }, timestamp: 3 },
  ];
  globalThis.sessionStorage.setItem('explorer-facets-v3', JSON.stringify(legacy));

  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });

  // Only the notice-number entry survives the filter.
  assert.equal(controller.facetsList.length, 1);
  assert.equal(controller.facetsList[0].type, 'notice-number');
  assert.equal(controller.facetsList[0].value, '00172531-2026');
});

test('_loadFromSession returns empty list for corrupted JSON', () => {
  globalThis.sessionStorage.setItem('explorer-facets-v3', '{not json');
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  assert.equal(controller.facetsList.length, 0);
});

// ── removeFacetByValue (phantom history cleanup) ─────────────────

test('removeFacetByValue removes a notice-number entry by publication number', async () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  await controller.search(createPublicationNumberFacet(PUB_A));
  await controller.search(createPublicationNumberFacet(PUB_B));
  assert.equal(controller.facetsList.length, 2);

  controller.removeFacetByValue('00172531-2026');
  assert.equal(controller.facetsList.length, 1);
  assert.equal(controller.facetsList[0].value, '00149228-2024');
});

test('removeFacetByValue is a no-op when no entry matches', () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  controller.facetsList = [createPublicationNumberFacet(PUB_A)];
  controller.removeFacetByValue('99999999-9999');
  assert.equal(controller.facetsList.length, 1, 'list should be unchanged');
});

test('removeFacetByValue only matches notice-number facets, not other types with the same value field', () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  // Seed the list directly (bypassing validation) with a hypothetical
  // non-notice entry that happens to carry the same string in a
  // 'value' field. removeFacetByValue must ignore it.
  controller.facetsList = [
    { type: 'query', value: '00172531-2026', query: 'SELECT * WHERE { ?s ?p ?o }' },
    createPublicationNumberFacet('00172531-2026'),
  ];
  controller.removeFacetByValue('00172531-2026');
  assert.equal(controller.facetsList.length, 1);
  assert.equal(controller.facetsList[0].type, 'query');
});

test('removeFacetByValue persists the removal to sessionStorage', () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  controller.facetsList = [
    createPublicationNumberFacet(PUB_A),
    createPublicationNumberFacet(PUB_B),
  ];
  controller._saveToSession();
  assert.equal(
    JSON.parse(globalThis.sessionStorage.getItem('explorer-facets-v3')).length,
    2,
  );

  controller.removeFacetByValue('00172531-2026');
  assert.equal(
    JSON.parse(globalThis.sessionStorage.getItem('explorer-facets-v3')).length,
    1,
    'sessionStorage should reflect the removal',
  );
});

// ── Identity preservation (M1 + M6) ──────────────────────────────

test('identity: breadcrumb[0] is the same reference as facetsList[0] after search', async () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  await controller.search(createPublicationNumberFacet(PUB_A));

  assert.equal(controller.facetsList.length, 1);
  assert.equal(controller.breadcrumb[0], controller.facetsList[0],
    'breadcrumb[0] must be the same reference as facetsList[0]');
});

test('identity: re-searching the same notice rebinds to the enriched reference', async () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });

  await controller.search(createPublicationNumberFacet(PUB_A));
  controller.enrichNoticeFacet('00172531-2026', {
    publicationDate: '2026-03-12+01:00',
    noticeType: 'can-standard',
  });
  const enrichedRef = controller.facetsList[0];
  assert.equal(enrichedRef.noticeType, 'can-standard');

  // Re-search the same notice. The breadcrumb must wire to the enriched
  // entry, not a fresh bare copy.
  await controller.search(createPublicationNumberFacet('172531-2026'));
  assert.equal(controller.facetsList.length, 1, 'duplicate should not grow the list');
  assert.equal(controller.breadcrumb[0], enrichedRef,
    'breadcrumb[0] must be the pre-existing enriched reference');
  assert.equal(controller.currentFacet.noticeType, 'can-standard',
    'currentFacet must expose enrichment because identity is preserved');
});

test('enrichNoticeFacet mutates in place so the breadcrumb sees the update', async () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  await controller.search(createPublicationNumberFacet(PUB_A));

  // Before enrichment, currentFacet has no metadata.
  assert.equal(controller.currentFacet.noticeType, undefined);

  // Enrich.
  controller.enrichNoticeFacet('00172531-2026', {
    publicationDate: '2026-03-12+01:00',
    noticeType: 'can-standard',
    buyerCountry: 'ITA',
  });

  // After enrichment, currentFacet (which points into breadcrumb[0]) must
  // see the new fields because the mutation was in place.
  assert.equal(controller.currentFacet.noticeType, 'can-standard');
  assert.equal(controller.currentFacet.buyerCountry, 'ITA');
  assert.equal(controller.currentFacet.publicationDate, '2026-03-12+01:00');
});

test('enrichNoticeFacet cannot clobber identity-defining fields', () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  controller.facetsList = [createPublicationNumberFacet(PUB_A)];

  // Attempt to inject a different type/value via the metadata payload.
  controller.enrichNoticeFacet('00172531-2026', {
    type: 'evil',
    value: 'pwned',
    timestamp: 0,
    noticeType: 'can-standard',
  });

  assert.equal(controller.facetsList[0].type, 'notice-number');
  assert.equal(controller.facetsList[0].value, '00172531-2026');
  assert.notEqual(controller.facetsList[0].timestamp, 0);
  assert.equal(controller.facetsList[0].noticeType, 'can-standard',
    'Safe fields should still be applied');
});

test('search() does not mutate the caller-owned facet object', async () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  const original = { type: 'notice-number', value: '00172531-2026' };
  assert.equal(original.timestamp, undefined);
  await controller.search(original);
  assert.equal(original.timestamp, undefined,
    'search() must not have stamped a timestamp on the caller\'s object');
  assert.equal(typeof controller.facetsList[0].timestamp, 'number',
    'the stored copy should have a timestamp');
});

// ─────────────────────────────────────────────────────────────────

test('search() with addToHistory:false does not add the facet to facetsList', async () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  // Seed with PUB_A via a normal search so History has one entry.
  await controller.search(createPublicationNumberFacet(PUB_A));
  assert.equal(controller.facetsList.length, 1);

  // Timeline-style lateral navigation to a sibling PUB_B.
  await controller.search(createPublicationNumberFacet(PUB_B), { addToHistory: false });

  // PUB_B is now the current facet (breadcrumb reset) but History still
  // has only the original PUB_A entry.
  assert.equal(controller.currentFacet.value, PUB_B);
  assert.equal(controller.facetsList.length, 1);
  assert.equal(controller.facetsList[0].value, PUB_A);
});

test('search() with addToHistory:false resolves to the existing canonical reference', async () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  await controller.search(createPublicationNumberFacet(PUB_A));
  const enriched = controller.facetsList[0];
  // Simulate NoticeView enrichment attaching metadata.
  controller.enrichNoticeFacet(PUB_A, { publicationDate: '2026-01-15', buyerCountry: 'BE' });

  // Navigate laterally (sibling click) to the SAME notice we already
  // have in History — breadcrumb should point at the enriched canonical
  // reference, not a fresh unenriched clone.
  await controller.search(createPublicationNumberFacet(PUB_A), { addToHistory: false });
  assert.equal(controller.currentFacet, enriched,
    'currentFacet must be the same reference as the enriched history entry');
  assert.equal(controller.currentFacet.buyerCountry, 'BE');
});

test('clearHistory removes the sessionStorage key entirely', () => {
  const controller = new ExplorerController({ doSPARQL: async () => ({ quads: [], size: 0, rawTurtle: '' }) });
  controller.facetsList = [createPublicationNumberFacet(PUB_A)];
  controller._saveToSession();
  assert.ok(globalThis.sessionStorage.getItem('explorer-facets-v3') !== null);

  controller.clearHistory();
  assert.equal(controller.facetsList.length, 0);
  assert.equal(globalThis.sessionStorage.getItem('explorer-facets-v3'), null,
    'clearHistory should removeItem, not just write []');
});

// ── helper used only in this file ─────────────────────────────────

function resetShimsExceptLocation() {
  globalThis.sessionStorage.clear();
}
