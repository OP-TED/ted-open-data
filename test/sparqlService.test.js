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
