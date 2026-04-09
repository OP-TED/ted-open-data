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

import { copyToClipboard } from './clipboardCopy.js';
import { triggerBlobDownload } from './download.js';
import { classifyError } from './errorMessages.js';
import { buildSparqlBody, buildSparqlUrl } from './sparqlRequest.js';
import { showToast } from './toast.js';

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
    this.copyUrlButton = document.getElementById('copy-url-button');
    this.copyUrlAlert = document.getElementById('copy-url-alert');
    this.queryResultsTab = new bootstrap.Tab(document.getElementById('query-results-tab'));

    this.initEventListeners();
  }

  /**
   * Initialize event listeners.
   * Wires the Copy URL button and every dropdown item in the
   * "Download as…" menu. Each download item carries a
   * data-download-format attribute with the MIME type to request.
   */
  initEventListeners() {
    this.copyUrlButton.addEventListener('click', this.onCopyUrl.bind(this));

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
   * that holds the hint, the Copy endpoint URL button and the
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
          td.textContent = row[header]?.value || "";
        });
      });

      this.resultsDiv.appendChild(table);
      this.setToolbarVisible(true);
    } else {
      this.resultsDiv.textContent = "No results found.";
      this.setToolbarVisible(false);
    }
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
  }

  /**
   * Handle copy URL button click event.
   * Generates a URL for the current query and copies it to the
   * clipboard. Uses the shared `copyToClipboard` helper so insecure
   * contexts (non-HTTPS, older browsers) get the execCommand
   * fallback instead of a synchronous throw, and a real failure
   * surfaces via the shared toast instead of a silent
   * console.error.
   */
  async onCopyUrl() {
    const url = this.generateUrl();
    const copied = await copyToClipboard(url);
    if (copied) {
      // SELECT-lane specific success copy: the URL is a JSON
      // endpoint, consumable by Excel / Power BI / any HTTP client.
      showToast(
        'Query URL copied',
        'You can use it in any app that can load JSON data from the web like Excel, Power BI, etc.',
      );
    } else {
      showToast(
        'Copy failed',
        'Could not copy the URL to the clipboard. Please copy it manually from the address bar after clicking Run Query.',
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
      const response = await fetch(this.queryEditor.sparqlEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": format,
        },
        body,
      });
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
      const { friendly } = classifyError(error, 'select');
      showToast('Download failed', friendly, { variant: 'danger' });
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