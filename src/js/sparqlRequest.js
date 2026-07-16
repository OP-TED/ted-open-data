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
// Shared SPARQL request-shape helpers.
//
// Three sites build the same parameter block for the Virtuoso endpoint:
// QueryEditor.onSubmit (POST body), QueryResults.downloadAs (POST body
// with a caller-supplied format), and QueryResults.generateUrl (GET URL
// for Copy endpoint URL). Consolidating them here keeps them honest so
// "Copy endpoint URL" reproduces exactly what "Run Query" just ran.
//
// The options they carry used to come from the Customize tab's Options
// panel; that UI was removed (issue #32), so readSparqlOptions now returns
// a fixed block (strict on, debug/report off, timeout/default-graph-uri
// blank and therefore omitted).

const DEFAULT_FORMAT = 'application/sparql-results+json';

/**
 * The fixed SPARQL endpoint options every request carries. The Options UI
 * was removed (issue #32): debug/report produced output the app never
 * rendered, and the endpoint ignores the timeout for the values it
 * accepted, so nothing was left worth exposing. `strict` checking stays on
 * (the former default); `timeout` and `default-graph-uri` stay blank so the
 * endpoint applies its own defaults (buildSparqlBody omits both). Returns a
 * fresh object so callers can't mutate a shared constant. Used by
 * `buildSparqlBody` (the SELECT lane) and by QueryEditor's CONSTRUCT/DESCRIBE
 * routing (which passes these to ExplorerController → doSPARQL → sparqlWorker).
 */
export function readSparqlOptions() {
  return { defaultGraphUri: '', timeout: '', strict: 'true', debug: 'false', report: 'false' };
}

/**
 * Build an application/x-www-form-urlencoded POST body for a SPARQL
 * query. Empty `default-graph-uri` and `timeout` are omitted so the
 * endpoint sees "no opinion" rather than an empty value (some
 * Virtuoso configurations interpret an empty default-graph-uri as
 * "no default graph" and return zero results).
 *
 * @param {string} query  - SPARQL query text (already minified or not).
 * @param {string} [format=DEFAULT_FORMAT]
 * @returns {string} url-encoded POST body
 */
export function buildSparqlBody(query, format = DEFAULT_FORMAT) {
  const { defaultGraphUri, timeout, strict, debug, report } = readSparqlOptions();
  let body = `query=${encodeURIComponent(query)}&format=${encodeURIComponent(format)}`;
  if (defaultGraphUri) body += `&default-graph-uri=${encodeURIComponent(defaultGraphUri)}`;
  if (timeout) body += `&timeout=${encodeURIComponent(timeout)}`;
  body += `&strict=${encodeURIComponent(strict)}`;
  body += `&debug=${encodeURIComponent(debug)}`;
  body += `&report=${encodeURIComponent(report)}`;
  return body;
}

/**
 * Build a GET URL that, when fetched, returns the same result as
 * running the query from the editor. Used by the "Copy endpoint
 * URL" button so the user can paste the URL into Excel / Power BI /
 * any HTTP client.
 *
 * Applies the same `default-graph-uri` / `timeout` omission rules as
 * `buildSparqlBody` — the copied URL is an exact reproduction of
 * what `onSubmit` just ran, not a configurably-different request.
 *
 * @param {string} endpoint - SPARQL endpoint URL (no trailing `?`).
 * @param {string} query    - SPARQL query text.
 * @param {string} [format=DEFAULT_FORMAT]
 * @returns {string}
 */
export function buildSparqlUrl(endpoint, query, format = DEFAULT_FORMAT) {
  return `${endpoint}?${buildSparqlBody(query, format)}`;
}
