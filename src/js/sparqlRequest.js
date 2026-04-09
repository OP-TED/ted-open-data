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
// Three sites used to hand-build the same parameter block for the
// Virtuoso endpoint: QueryEditor.onSubmit (POST body), QueryResults
// .downloadAs (POST body with a caller-supplied format), and
// QueryResults.generateUrl (GET URL for Copy endpoint URL).
//
// They had drifted out of sync in two places:
//   - onSubmit / downloadAs omit `default-graph-uri` and `timeout`
//     when the form input is blank; generateUrl always included
//     them, so a copied URL could diverge from the query the user
//     had just run.
//   - onSubmit uses whatever value the timeout input has (possibly
//     blank → omitted); generateUrl substituted 30000 when blank.
//
// Consolidating the three sites here keeps them honest.

const DEFAULT_FORMAT = 'application/sparql-results+json';

/**
 * Read the SPARQL options panel inputs from the DOM and return a
 * normalised object. Intended for all three builder callers, so they
 * all see the same values.
 * @private
 */
function _readOptions() {
  const defaultGraphUri = document.getElementById('default-graph-uri')?.value || '';
  const timeout = document.getElementById('timeout')?.value || '';
  const strict = document.getElementById('strict')?.checked ? 'true' : 'false';
  const debug = document.getElementById('debug')?.checked ? 'true' : 'false';
  const report = document.getElementById('report')?.checked ? 'true' : 'false';
  return { defaultGraphUri, timeout, strict, debug, report };
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
  const { defaultGraphUri, timeout, strict, debug, report } = _readOptions();
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
