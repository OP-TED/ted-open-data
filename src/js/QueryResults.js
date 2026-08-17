/*
 * Copyright 2024 European Union
 *
 * Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
 * Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */

import { copyToClipboard } from './utils/clipboardCopy.js';
import { triggerBlobDownload } from './utils/download.js';
import { classifyError } from './utils/errorMessages.js';
import { buildSparqlBody, buildSparqlUrl } from './sparqlRequest.js';
import { showToast } from './utils/toast.js';
import { ChartView } from './ChartView.js';

// Domains that host actual navigable web pages in TED query results.
// An allowlist is safer than a blocklist: it stays correct as new
// data namespaces are added to the triplestore without needing updates here.
// Only URIs whose hostname is in this set are rendered as clickable links.
const NAVIGABLE_DOMAINS = new Set([
  'ted.europa.eu',
]);

/**
 * Class representing the Query Results.
 * This class is responsible for displaying the results of SPARQL queries and handling related actions.
 */
export class QueryResults {
  /**
   * Create a Query Results instance.
   * @param {QueryEditor} queryEditor - The QueryEditor instance.
   * @param {string} originalSparqlEndpoint - The original SPARQL endpoint URL.
   */
  constructor(queryEditor, originalSparqlEndpoint) {
    this.queryEditor = queryEditor;
    this.originalSparqlEndpoint = originalSparqlEndpoint;
    this.resultsDiv = document.getElementById("results");
    this.copyUrlAlert = document.getElementById('copy-url-alert');
    this.queryResultsTab = new bootstrap.Tab(document.getElementById('query-results-tab'));
    this.chartView = new ChartView();

    this.initEventListeners();
  }

  /**
   * Initialize event listeners.
   * Wires the Copy Query dropdown items and every dropdown item in the
   * "Download as…" menu. Each download item carries a
   * data-download-format attribute with the MIME type to request.
   */
  initEventListeners() {
    // Copy Query dropdown items
    document.querySelectorAll('#copy-url-alert [data-share-type]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.onShare(item.dataset.shareType);
      });
    });

    // Download as… dropdown items
    document.querySelectorAll('#copy-url-alert [data-download-format]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.downloadAs(item.dataset.downloadFormat);
      });
    });
  }

  /**
   * Generate a shareable URL for the current query.
   * Always emits a SPARQL Results JSON URL — that's the most
   * machine-friendly format for Excel, Power BI and custom apps,
   * and matches what the editor renders on screen.
   * @returns {string} - The generated URL.
   */
  generateUrl() {
    const query = this.queryEditor.getQuery();
    const minifiedQuery = this.queryEditor.minifySparqlQuery(query);
    // Always emits a JSON URL — that's the most machine-friendly
    // format for Excel, Power BI and custom apps. The `originalSparqlEndpoint`
    // field is the public endpoint (not the dev-mode /proxy wrapper),
    // so the copied URL is usable outside the app.
    return buildSparqlUrl(this.originalSparqlEndpoint, minifiedQuery);
  }

  /**
   * Show or hide the slim results toolbar (the strip above the table
   * that holds the hint, the Copy Query dropdown and the
   * Download as… menu). Centralised here so every lane that needs to
   * toggle it (displayJsonResults, displayTextResults, the SELECT
   * submit paths in QueryEditor) goes through one place.
   * @param {boolean} visible
   */
  setToolbarVisible(visible) {
    if (!this.copyUrlAlert) return;
    this.copyUrlAlert.classList.toggle('d-none', !visible);
    this.copyUrlAlert.classList.toggle('d-flex', visible);
  }

  /**
   * Display JSON results.
   * @param {Object} data - The JSON results data.
   */
  displayJsonResults(data) {
    this.resultsDiv.innerHTML = "";

    // ASK queries return { boolean: true/false } rather than
    // { results: { bindings: [...] } }. Render a single-cell table
    // showing the boolean so the result is visible and downloadable,
    // rather than falling through to "No results found".
    if (typeof data.boolean === 'boolean') {
      const table = document.createElement('table');
      table.className = 'table table-striped sparql monospace';
      const thead = table.createTHead();
      const headerRow = thead.insertRow();
      const th = document.createElement('th');
      th.textContent = 'ASK';
      headerRow.appendChild(th);
      const tbody = table.createTBody();
      const tr = tbody.insertRow();
      const td = tr.insertCell();
      td.textContent = String(data.boolean);
      this.resultsDiv.appendChild(table);
      this.setToolbarVisible(true);
      this.chartView.destroy();
      return;
    }

    if (data.results && data.results.bindings.length > 0) {
      const table = document.createElement("table");
      table.className = "table table-striped sparql monospace";

      const thead = table.createTHead();
      const headerRow = thead.insertRow();
      const headers = Object.keys(data.results.bindings[0]);
      headers.forEach((header) => {
        const th = document.createElement("th");
        th.textContent = header;
        headerRow.appendChild(th);
      });

      const tbody = table.createTBody();
      data.results.bindings.forEach((row, index) => {
        const tr = tbody.insertRow();
        tr.className = index % 2 === 1 ? 'even' : '';
        headers.forEach((header) => {
          const td = tr.insertCell();
          const binding = row[header];
          td.appendChild(this._renderCell(binding));
        });
      });

      this.resultsDiv.appendChild(table);
      this.setToolbarVisible(true);
      this.chartView.setData(data);
    } else {
      this.resultsDiv.textContent = "No results found.";
      this.setToolbarVisible(false);
      this.chartView.destroy();
    }
  }

  /**
   * Render a single SPARQL result binding as a DOM node.
   * URI bindings that look like navigable web URLs (http/https pointing
   * to a known web domain) are rendered as clickable links opening in a
   * new tab. Everything else is plain text.
   *
   * Security is provided entirely by _isWebUrl: it uses new URL() to parse
   * the value and checks the hostname against an allowlist of known
   * navigable domains. Any dangerous scheme (javascript:, data:, etc.)
   * either fails to parse or returns a hostname that isn't in the allowlist.
   *
   * @param {{ type: string, value: string }|undefined} binding
   * @returns {Node}
   */
  _renderCell(binding) {
    const value = binding?.value || '';
    if (binding?.type === 'uri' && QueryResults._isWebUrl(value)) {
      const a = document.createElement('a');
      a.href = value;
      a.textContent = value;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return a;
    }
    return document.createTextNode(value);
  }

  /**
   * Returns true only for http/https URIs whose hostname is in the
   * NAVIGABLE_DOMAINS allowlist — i.e. URIs that point to real web pages
   * rather than ontology terms or RDF data resources.
   *
   * @param {string} value
   * @returns {boolean}
   */
  static _isWebUrl(value) {
    try {
      const { protocol, hostname } = new URL(value);
      if (protocol !== 'http:' && protocol !== 'https:') return false;
      return NAVIGABLE_DOMAINS.has(hostname);
    } catch {
      return false;
    }
  }

  /**
   * Build a ready-to-paste cURL command that reproduces a SPARQL POST
   * request. The body is a URL-encoded `application/x-www-form-urlencoded`
   * string (from `buildSparqlBody`); it is wrapped in single quotes for
   * the shell, so any literal single quote inside it (e.g. from a SPARQL
   * string literal like `FILTER(?name = 'John')`) is percent-encoded to
   * %27 first — otherwise it would prematurely close the shell's quoted
   * argument and corrupt or break the command.
   *
   * @param {string} endpoint - The SPARQL endpoint URL.
   * @param {string} body - The url-encoded POST body (from buildSparqlBody).
   * @returns {string} - The full curl command, ready to paste into a terminal.
   */
  static _buildCurlCommand(endpoint, body) {
    const safeBody = body.replace(/'/g, '%27');
    return `curl -X POST '${endpoint}' \\\n  -H 'Content-Type: application/x-www-form-urlencoded' \\\n  -H 'Accept: application/sparql-results+json' \\\n  -d '${safeBody}'`;
  }

  /**
   * Display text results.
   * @param {string} content - The text content.
   * @param {string} type - The content type (e.g., 'xml', 'csv', 'text').
   */
  displayTextResults(content, type) {
    this.resultsDiv.innerHTML = "";

    const pre = document.createElement("pre");
    pre.className = "p-3 bg-white border rounded";
    pre.style.overflow = "auto";
    
    if (type === 'xml') {
      pre.innerHTML = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    } else {
      pre.textContent = content;
    }

    this.resultsDiv.appendChild(pre);
    this.setToolbarVisible(true);
    this.chartView.destroy();
  }

  /**
   * Handle share dropdown item click.
   * Copies the appropriate content to the clipboard based on the
   * selected share type.
   * @param {string} type - The share type: 'query-link', 'sparql-query', or 'curl-command'.
   */
  async onShare(type) {
    const query = this.queryEditor.getQuery();
    if (!query || !query.trim()) {
      showToast('Nothing to copy', 'Write a query first, then try again.', { variant: 'warning' });
      return;
    }

    let textToCopy;
    let toastTitle;
    let toastBody;

    switch (type) {
      case 'query-link': {
        textToCopy = this.generateUrl();
        toastTitle = 'Query link copied';
        toastBody = 'Open this link in a browser or any HTTP client to re-run the query and get JSON results.';
        break;
      }
      case 'sparql-query': {
        textToCopy = query;
        toastTitle = 'SPARQL query copied';
        toastBody = 'Paste this into any SPARQL editor to run the same query.';
        break;
      }
      case 'curl-command': {
        const minifiedQuery = this.queryEditor.minifySparqlQuery(query);
        const body = buildSparqlBody(minifiedQuery);
        textToCopy = QueryResults._buildCurlCommand(this.originalSparqlEndpoint, body);
        toastTitle = 'cURL command copied';
        toastBody = 'Paste into a terminal to execute the query via command line.';
        break;
      }
      default:
        return;
    }

    const copied = await copyToClipboard(textToCopy);
    if (copied) {
      showToast(toastTitle, toastBody);
    } else {
      showToast(
        'Copy failed',
        'Could not copy to the clipboard. Please try again.',
        { variant: 'danger' },
      );
    }
  }

  /**
   * Download the current query's result in the requested format.
   *
   * Re-fetches the endpoint with the chosen `format` parameter rather
   * than reusing the cached editor response — the editor always runs
   * JSON, but the user might want a CSV or an Excel file on disk.
   *
   * The returned payload is wrapped in a Blob with MIME type
   * application/octet-stream so the browser always triggers a file
   * download instead of opening HTML/XML/CSV content inline. The
   * `download` attribute on the anchor element provides the actual
   * filename and extension.
   *
   * @param {string} format - The SPARQL result MIME type to request
   *   (e.g. "text/csv", "application/sparql-results+json").
   * @async
   */
  async downloadAs(format) {
    const query = this.queryEditor.getQuery();
    if (!query || !query.trim()) {
      showToast('Download failed', 'Write a query first, then try again.', { variant: 'warning' });
      return;
    }

    // Build the same POST body the editor uses, but with the chosen
    // format instead of the always-JSON one.
    const minifiedQuery = this.queryEditor.minifySparqlQuery(query);
    const body = buildSparqlBody(minifiedQuery, format);

    try {
      // Client-side abort ceiling for the download fetch. The user-facing
      // server timeout option was removed (issue #32), so use a fixed 60s.
      const downloadTimeout = 60_000;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), downloadTimeout);
      const response = await fetch(this.queryEditor.sparqlEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": format,
        },
        body,
        signal: abort.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        console.error('Download failed:', response.status, detail);
        const err = new Error(`HTTP error. Status: ${response.status}\n${detail}`);
        const { friendly } = classifyError(err, 'select');
        showToast('Download failed', friendly, { variant: 'danger' });
        return;
      }
      const text = await response.text();
      triggerBlobDownload(text, `query-results${QueryResults._extensionFor(format)}`);
    } catch (error) {
      console.error('Download failed:', error);
      if (error?.name === 'AbortError') {
        showToast('Download timed out', 'The download took too long. Try narrowing your query with a LIMIT or more specific filters.', { variant: 'danger' });
      } else {
        const { friendly } = classifyError(error, 'select');
        showToast('Download failed', friendly, { variant: 'danger' });
      }
    }
  }

  /**
   * Map a SPARQL result MIME type to a file extension.
   * @param {string} format
   * @returns {string}
   * @private
   */
  static _extensionFor(format) {
    const map = {
      'application/sparql-results+json': '.json',
      'application/sparql-results+xml': '.xml',
      'application/vnd.ms-excel': '.xls',
      'text/csv': '.csv',
      'text/tab-separated-values': '.tsv',
    };
    return map[format] || '.txt';
  }
}