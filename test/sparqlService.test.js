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
// sparqlService tests — narrowly focused on the orphan-pending-request
// regression: doSPARQL() must not leave an entry in pendingRequests if
// worker creation throws (e.g. _assertN3Loaded fails because the N3
// <script> is missing).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  doSPARQL,
  _rehydrateWorkerError,
  __getPendingCountForTesting,
  __resetWorkerForTesting,
} from '../src/js/services/sparqlService.js';

// Snapshot whatever globalThis.N3 was so we can restore it after the
// tests, in case some other test installed a stub.
const _originalN3 = globalThis.N3;

beforeEach(() => {
  __resetWorkerForTesting();
  // Make sure N3 is NOT defined so getWorker()'s _assertN3Loaded throws.
  delete globalThis.N3;
});

afterEach(() => {
  globalThis.N3 = _originalN3;
});

test('doSPARQL rejects synchronously when N3 is not loaded — and leaves no orphan pending entry', async () => {
  assert.equal(__getPendingCountForTesting(), 0, 'precondition: no pending requests');

  let rejected = false;
  let rejectedError = null;
  try {
    await doSPARQL('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 1');
  } catch (err) {
    rejected = true;
    rejectedError = err;
  }

  assert.equal(rejected, true, 'doSPARQL must reject when worker creation fails');
  assert.match(rejectedError.message, /N3/, 'error should mention N3');
  assert.equal(__getPendingCountForTesting(), 0,
    'pendingRequests must be empty — no orphaned entry left behind');
});

test('doSPARQL handles repeated worker-creation failures without leaking entries', async () => {
  // Fire several failing calls in a row. Each must reject, none must
  // leak. (Catches a regression where the leak only happens after N
  // calls — defence in depth against accidental closure-state pollution.)
  for (let i = 0; i < 5; i++) {
    try { await doSPARQL('SELECT * WHERE { ?s ?p ?o }'); } catch { /* expected */ }
  }
  assert.equal(__getPendingCountForTesting(), 0,
    'no pending entries after 5 failed creations');
});

// ── _rehydrateWorkerError — structured-clone boundary ────────────
//
// The worker posts `{message, name}` so an AbortError can round-trip
// the structured-clone boundary back into an Error instance with the
// same `.name`. Without the rehydration, the main thread sees a
// plain Error and the cancelled-query branch in errorMessages
// cannot fire.

test('_rehydrateWorkerError preserves name and message from object payload', () => {
  const err = _rehydrateWorkerError({ message: 'The user aborted a request.', name: 'AbortError' });
  assert.equal(err.message, 'The user aborted a request.');
  assert.equal(err.name, 'AbortError');
  assert.ok(err instanceof Error);
});

test('_rehydrateWorkerError defaults the name to "Error" when the payload omits it', () => {
  const err = _rehydrateWorkerError({ message: 'Something exotic' });
  assert.equal(err.message, 'Something exotic');
  assert.equal(err.name, 'Error');
});

test('_rehydrateWorkerError handles the legacy bare-string shape', () => {
  // Defence in depth: if the worker ever falls out of sync with the
  // main thread and posts a plain string instead of {message, name},
  // we still produce a sensible Error rather than crashing.
  const err = _rehydrateWorkerError('legacy string payload');
  assert.equal(err.message, 'legacy string payload');
  assert.equal(err.name, 'Error');
});

test('_rehydrateWorkerError tolerates a null payload with a generic message', () => {
  const err = _rehydrateWorkerError(null);
  assert.equal(err.message, 'SPARQL worker error');
  assert.equal(err.name, 'Error');
});
