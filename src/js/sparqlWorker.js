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
// Web Worker that runs SPARQL queries off the main thread.
//
// The result is returned as raw Turtle text; parsing into quads happens
// in the main thread (the N3 library isn't easily usable inside a worker
// without bundling).

// Upper bound for CONSTRUCT/DESCRIBE fetches. A hung endpoint would
// otherwise leave the main-thread promise pending indefinitely.
const SPARQL_CONSTRUCT_TIMEOUT_MS = 60_000;

self.onmessage = async function(event) {
  const { id, type, query, endpoint } = event.data;

  if (type !== 'sparql') {
    self.postMessage({
      id,
      type: 'error',
      error: { message: 'Unknown message type', name: 'Error' },
    });
    return;
  }

  try {
    const turtleData = await _runSparqlQuery(query, endpoint);
    self.postMessage({ id, type: 'success', turtleData });
  } catch (error) {
    // Pass `name` and `message` through the structured-clone boundary
    // so the main thread can rehydrate an Error with the correct
    // type. Without `name`, an AbortError round-trips as a plain
    // Error and the cancelled-query branch in errorMessages cannot
    // fire.
    self.postMessage({
      id,
      type: 'error',
      error: {
        message: error?.message || String(error),
        name: error?.name || 'Error',
      },
    });
  }
};

async function _runSparqlQuery(query, endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPARQL_CONSTRUCT_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Accept': 'text/turtle',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ query }).toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Include the HTTP status in the error message so the shared
      // classifier in errorMessages.js can match it the same way it
      // matches errors from the SELECT lane.
      const body = await response.text();
      throw new Error(`HTTP error. Status: ${response.status}\n${body}`);
    }

    return await response.text();
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`SPARQL query timed out after ${SPARQL_CONSTRUCT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
