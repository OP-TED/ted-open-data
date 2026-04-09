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
// SPARQL execution service.
//
// CONSTRUCT/DESCRIBE queries run off-thread in a Web Worker and return parsed
// quads. SELECT queries are executed directly on the main thread and return
// JSON bindings (only used by the footer's data-period query).
//
// N3 is loaded via a <script> tag in index.html rather than bundled, so the
// global must be present by the time any CONSTRUCT/DESCRIBE response comes
// back. We assert it once on first use of the service and fail loudly if
// the script tag was moved/removed — otherwise an opaque ReferenceError
// deep inside the worker.onmessage handler would leak pending promises
// with no diagnosable cause.
function _assertN3Loaded() {
  if (typeof globalThis.N3 === 'undefined' || !globalThis.N3?.Parser) {
    throw new Error(
      'N3 library is not loaded. Expected `window.N3` to be defined ' +
      '(see the <script> tag for n3 in index.html).'
    );
  }
}

const SPARQL_ENDPOINT = 'https://publications.europa.eu/webapi/rdf/sparql';
const LOCAL_DEV_ENDPOINT = '/sparql';
// Cap for a direct SELECT query. CONSTRUCT/DESCRIBE via the worker has
// its own timeout in sparqlWorker.js. 60s is generous for SPARQL but
// short enough that a hung endpoint eventually surfaces an error instead
// of spinning the progress bar forever.
const SPARQL_SELECT_TIMEOUT_MS = 60_000;

let worker = null;
let messageIdCounter = 0;
const pendingRequests = new Map();

// Circuit-breaker state for the worker. A persistently crashing
// worker (bad script, OOM, runaway loop) would otherwise produce an
// invisible reject/respawn/reject loop — every individual error is
// surfaced, but the user has no way to tell the problem is
// systemic. After N consecutive crashes inside a short time window
// we stop auto-respawning and surface a single structured failure
// until the page is reloaded.
const WORKER_CRASH_LIMIT = 3;
const WORKER_CRASH_WINDOW_MS = 30_000;
let workerCrashTimestamps = [];
let workerDisabled = false;

// In development (localhost) the dev server proxies /sparql to the real
// endpoint to side-step CORS. In production the real URL is used directly.
function getEndpoint() {
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return isDev ? LOCAL_DEV_ENDPOINT : SPARQL_ENDPOINT;
}

function getWorker() {
  if (workerDisabled) {
    throw new Error('SPARQL worker has been disabled after repeated crashes. Reload the page to retry.');
  }
  if (worker) return worker;

  // Fail loudly if the N3 <script> tag is missing. Otherwise the first
  // successful SPARQL response would throw deep inside the onmessage
  // handler and leak the pending promise.
  _assertN3Loaded();

  // Worker sits at ../sparqlWorker.js relative to this file.
  worker = new Worker(new URL('../sparqlWorker.js', import.meta.url));

  worker.onmessage = (event) => {
    const { id, type, turtleData, error } = event.data;
    const pending = pendingRequests.get(id);
    pendingRequests.delete(id);
    if (!pending) return;

    if (type === 'success') {
      try {
        const parser = new N3.Parser();
        const quads = parser.parse(turtleData);
        pending.resolve({ rawTurtle: turtleData, quads, size: quads.length });
      } catch (parseError) {
        pending.reject(new Error(`Failed to parse SPARQL response: ${parseError.message}`));
      }
    } else if (type === 'error') {
      pending.reject(_rehydrateWorkerError(error));
    } else {
      // Unknown message type — reject explicitly instead of silently
      // leaking the promise. This guards against worker protocol drift
      // and makes the failure diagnosable.
      pending.reject(new Error(`Unknown worker response type: ${type}`));
    }
  };

  // If the worker itself throws (script load failure, syntax error,
  // OOM), every in-flight promise would otherwise leak and the UI
  // would spin forever. Reject all pending requests, clear the map,
  // and null out the worker so the next call respawns it — unless
  // we are hitting the crash limit, in which case the circuit
  // breaker trips and no further worker is spawned this session.
  worker.onerror = (event) => {
    const message = event?.message || 'SPARQL worker crashed';
    console.error('SPARQL Worker error:', event);

    // Track this crash in the rolling window. Anything older than
    // WORKER_CRASH_WINDOW_MS is forgotten.
    const now = Date.now();
    workerCrashTimestamps = workerCrashTimestamps.filter(t => now - t < WORKER_CRASH_WINDOW_MS);
    workerCrashTimestamps.push(now);

    const userFacingMessage = workerCrashTimestamps.length >= WORKER_CRASH_LIMIT
      ? `SPARQL worker crashed ${workerCrashTimestamps.length} times; aborting. Reload the page to retry.`
      : `SPARQL worker error: ${message}`;

    const err = new Error(userFacingMessage);
    for (const pending of pendingRequests.values()) pending.reject(err);
    pendingRequests.clear();
    try { worker?.terminate(); } catch { /* already dead */ }
    worker = null;

    if (workerCrashTimestamps.length >= WORKER_CRASH_LIMIT) {
      workerDisabled = true;
      console.error('[sparqlService] Worker circuit breaker tripped; further SPARQL queries will fail fast.');
    }
  };

  return worker;
}

// Run a CONSTRUCT/DESCRIBE query. Resolves with { rawTurtle, quads, size }.
//
// Worker creation can throw — _assertN3Loaded fails if the N3 <script>
// is missing, and the `new Worker(...)` constructor itself can throw on
// some browsers. We resolve the worker BEFORE inserting into
// pendingRequests so a failure here can never leave an orphan entry
// behind.
//
// postMessage itself can also throw (structured-clone failure on an
// exotic payload, worker crashed between calls). When that happens we
// must remove the entry we just inserted into pendingRequests, or the
// promise leaks and the caller waits forever. The try/catch below
// guarantees the entry and the promise stay in lockstep.
function doSPARQL(query) {
  return new Promise((resolve, reject) => {
    let activeWorker;
    try {
      activeWorker = getWorker();
    } catch (err) {
      reject(err);
      return;
    }
    const id = ++messageIdCounter;
    pendingRequests.set(id, { resolve, reject });
    try {
      activeWorker.postMessage({
        id,
        type: 'sparql',
        query,
        endpoint: getEndpoint(),
      });
    } catch (err) {
      pendingRequests.delete(id);
      reject(err);
    }
  });
}

// Run a SELECT query. Resolves with the parsed JSON bindings response.
// Wrapped in an AbortController-based timeout so a hung endpoint surfaces
// as a clear error instead of a permanently-pending promise.
async function doSPARQLSelect(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPARQL_SELECT_TIMEOUT_MS);
  try {
    const response = await fetch(getEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/sparql-results+json',
      },
      body: `query=${encodeURIComponent(query)}&format=${encodeURIComponent('application/sparql-results+json')}`,
      signal: controller.signal,
    });
    if (!response.ok) {
      // Mirror the sparqlWorker format so errorMessages.classifyError
      // can key off the same `Status: NNN` prefix whether the error
      // came from the worker (CONSTRUCT/DESCRIBE) or from this
      // direct-fetch path (SELECT/ASK via ExplorerController).
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP error. Status: ${response.status}\n${body}`);
    }
    return await response.json();
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`SPARQL SELECT timed out after ${SPARQL_SELECT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Cancel every in-flight CONSTRUCT/DESCRIBE. Used by the footer stop
// button and (internally) by the worker-crash handler. Terminates the
// worker nuclear-style — all pending promises are rejected with a
// CancelledError, the worker is killed, and the next doSPARQL call
// respawns it. Not per-request: a "cancel" here means "stop whatever
// SPARQL work is happening right now," consistent with the user's
// mental model of the stop button.
//
// Note that this also kills any in-flight labelService batches that
// happened to be running through the same worker. That's acceptable —
// labels are URI-keyed, they'll be re-requested next render, and the
// user clicking Stop is unlikely to care about label decorations.
function cancelAllSparqlRequests() {
  if (pendingRequests.size === 0 && !worker) return;
  const err = new Error('SPARQL request cancelled');
  err.name = 'CancelledError';
  for (const pending of pendingRequests.values()) pending.reject(err);
  pendingRequests.clear();
  try { worker?.terminate(); } catch { /* already dead */ }
  worker = null;
}

/**
 * Rehydrate a structured-clone-boundary error payload from the worker
 * into a real Error with both `message` and `name` populated.
 *
 * The worker posts `{message, name}` on error. Handling the legacy
 * bare-string shape is defence in depth: if the worker ever falls
 * out of sync with the main thread, the caller still gets a sensible
 * Error rather than a silent cast.
 *
 * @param {string | {message?: string, name?: string}} payload
 * @returns {Error}
 * @private
 */
function _rehydrateWorkerError(payload) {
  const msg = typeof payload === 'string'
    ? payload
    : (payload?.message || 'SPARQL worker error');
  const name = typeof payload === 'object' && payload !== null
    ? (payload.name || 'Error')
    : 'Error';
  const err = new Error(msg);
  err.name = name;
  return err;
}

// Test-only hook: lets tests inspect pending request count and reset
// the worker between tests. Production code never touches this.
function __getPendingCountForTesting() {
  return pendingRequests.size;
}
function __resetWorkerForTesting() {
  for (const pending of pendingRequests.values()) {
    pending.reject(new Error('reset for test'));
  }
  pendingRequests.clear();
  try { worker?.terminate(); } catch { /* already dead */ }
  worker = null;
}

export {
  doSPARQL,
  doSPARQLSelect,
  cancelAllSparqlRequests,
  getEndpoint,
  _rehydrateWorkerError,
  __getPendingCountForTesting,
  __resetWorkerForTesting,
};
