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
// BacklinksView tests — exercises the request-token race in _loadBatch.
//
// The race we're guarding against: user navigates from URI A to URI B
// while A's CONSTRUCT query is still in flight. A's late response must
// NOT touch this.allQuads (which now belongs to B's batch) or render
// stale subjects into the content container.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { resetShims } from './_helpers.js';
import { BacklinksView } from '../src/js/BacklinksView.js';

const URI_A = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Notice';
const URI_B = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Lot_LOT-0001';

// Minimal controller stub.
function makeController() {
  const c = new EventTarget();
  c.currentFacet = null;
  return c;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function tick() { return new Promise(r => setTimeout(r, 0)); }

// Build a fake quads response for a CONSTRUCT query. Each quad is a
// `{subject, predicate, object}` triple where the object is the
// backlink target URI.
function backlinkQuad(subjectUri, predicateUri, targetUri) {
  return {
    subject: { value: subjectUri, termType: 'NamedNode' },
    predicate: { value: predicateUri, termType: 'NamedNode' },
    object: { value: targetUri, termType: 'NamedNode' },
  };
}

beforeEach(() => {
  resetShims();
});

// ── The race ───────────────────────────────────────────────────────

test('BacklinksView._loadBatch drops a late response from a superseded URI navigation', async () => {
  // Set up two deferreds. The first is for URI A's batch, the second
  // for URI B's batch. We resolve B first, then A late.
  const dA = deferred();
  const dB = deferred();
  const calls = [];
  const doSPARQL = (query) => {
    calls.push(query);
    return calls.length === 1 ? dA.promise : dB.promise;
  };

  const controller = makeController();
  const view = new BacklinksView(controller, { doSPARQL });

  // Simulate navigating to URI A. _onFacetChanged is what would normally
  // bump the token; we set the controller state and fire the event.
  controller.currentFacet = { type: 'named-node', term: { value: URI_A } };
  controller.dispatchEvent(new CustomEvent('facet-changed'));
  await tick();

  assert.equal(view.currentUri, URI_A);
  assert.equal(calls.length, 1, 'A\'s batch should be in flight');

  // Now navigate to URI B before A resolves. The token bumps, so A's
  // late response should be dropped.
  controller.currentFacet = { type: 'named-node', term: { value: URI_B } };
  controller.dispatchEvent(new CustomEvent('facet-changed'));
  await tick();

  assert.equal(view.currentUri, URI_B);
  assert.equal(calls.length, 2, 'B\'s batch should now be in flight');

  // Resolve B first.
  dB.resolve({
    quads: [
      backlinkQuad('http://example.org/subject-of-B', 'http://example.org/refersTo', URI_B),
    ],
  });
  await tick();

  // B's batch should have populated allQuads.
  assert.equal(view.allQuads.length, 1, 'B\'s batch should have populated allQuads');

  // Snapshot the state. Now resolve A — late.
  const allQuadsBeforeLateA = view.allQuads.length;
  dA.resolve({
    quads: [
      backlinkQuad('http://example.org/subject-of-A-1', 'http://example.org/refersTo', URI_A),
      backlinkQuad('http://example.org/subject-of-A-2', 'http://example.org/refersTo', URI_A),
      backlinkQuad('http://example.org/subject-of-A-3', 'http://example.org/refersTo', URI_A),
    ],
  });
  await tick();

  // A's late response must NOT have touched the accumulator. The state
  // should still reflect B's single quad, not A's three.
  assert.equal(view.allQuads.length, allQuadsBeforeLateA,
    'late A response must not be appended to B\'s allQuads');
  assert.equal(view.currentUri, URI_B, 'currentUri must still be B');
});

test('BacklinksView: same URI re-fetch (no token bump) does not drop the response', async () => {
  // If the user explicitly clicks "Load more" on the same URI, the token
  // does NOT change between requests, and the response should be applied.
  const d1 = deferred();
  const d2 = deferred();
  const calls = [];
  const doSPARQL = () => {
    calls.push(true);
    return calls.length === 1 ? d1.promise : d2.promise;
  };

  const controller = makeController();
  const view = new BacklinksView(controller, { doSPARQL });

  controller.currentFacet = { type: 'named-node', term: { value: URI_A } };
  controller.dispatchEvent(new CustomEvent('facet-changed'));
  await tick();

  // Resolve the first batch.
  d1.resolve({
    quads: [backlinkQuad('http://example.org/s1', 'http://example.org/p', URI_A)],
  });
  await tick();
  assert.equal(view.allQuads.length, 1);

  // Trigger "Load more" by calling _loadBatch directly with isFirst=false.
  view._loadBatch(false);
  await tick();
  assert.equal(calls.length, 2, 'second batch should have been fired');

  d2.resolve({
    quads: [backlinkQuad('http://example.org/s2', 'http://example.org/p', URI_A)],
  });
  await tick();

  // Both batches' quads should be in the accumulator (additive).
  assert.equal(view.allQuads.length, 2,
    'second batch should have appended to allQuads (no token bump on same-URI Load more)');
});

test('BacklinksView: navigating away during in-flight load resets currentUri to the new target', async () => {
  // Tests that the token bump in _onFacetChanged is the load-bearing
  // line — currentUri/currentOffset/hasMore all get reset together.
  const d = deferred();
  const doSPARQL = () => d.promise;

  const controller = makeController();
  const view = new BacklinksView(controller, { doSPARQL });

  controller.currentFacet = { type: 'named-node', term: { value: URI_A } };
  controller.dispatchEvent(new CustomEvent('facet-changed'));
  await tick();

  // Pollute state to verify the reset.
  view.currentOffset = 999;
  view.allQuads = [{}];
  view.hasMore = false;

  // Navigate to B.
  controller.currentFacet = { type: 'named-node', term: { value: URI_B } };
  controller.dispatchEvent(new CustomEvent('facet-changed'));
  await tick();

  assert.equal(view.currentUri, URI_B);
  assert.equal(view.currentOffset, 0, 'currentOffset reset on URI change');
  assert.deepEqual(view.allQuads, [], 'allQuads reset on URI change');
  assert.equal(view.hasMore, true, 'hasMore reset on URI change');
});
