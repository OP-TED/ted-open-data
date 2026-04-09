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

import { classifyError } from './errorMessages.js';
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
   * Store the raw response data for reference (legacy API — the
   * download path now re-fetches from the endpoint so this cache
   * is only kept for potential future uses).
   * @param {string} data - The raw response text.
   * @param {string} contentType - The response content type.
   */
  setResponseData(data, contentType) {
    this.lastResponseData = data;
    this.lastResponseType = contentType;
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
    const format = "application/sparql-results+json";
    const defaultGraphUri = document.getElementById("default-graph-uri").value;
    const timeout = document.getElementById("timeout").value || 30000;
    const strict = document.getElementById("strict").checked ? "true" : "false";
    const debug = document.getElementById("debug").checked ? "true" : "false";
    const report = document.getElementById("report").checked ? "true" : "false";

    return `${this.originalSparqlEndpoint}?default-graph-uri=${encodeURIComponent(defaultGraphUri)}&query=${encodeURIComponent(minifiedQuery)}&format=${encodeURIComponent(format)}&timeout=${encodeURIComponent(timeout)}&strict=${encodeURIComponent(strict)}&debug=${encodeURIComponent(debug)}&report=${encodeURIComponent(report)}`;
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
      this.copyUrlAlert.classList.remove('d-none'); this.copyUrlAlert.classList.add('d-flex');
    } else {
      this.resultsDiv.textContent = "No results found.";
      this.copyUrlAlert.classList.add('d-none'); this.copyUrlAlert.classList.remove('d-flex');
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
    this.copyUrlAlert.classList.remove('d-none'); this.copyUrlAlert.classList.add('d-flex');
  }

  /**
   * Handle copy URL button click event.
   * Generates a URL for the current query and copies it to the clipboard.
   */
  onCopyUrl() {
    const url = this.generateUrl();
    navigator.clipboard.writeText(url).then(() => {
      // Populate the shared toast with a SELECT-lane-specific
      // explanation: this URL is a JSON endpoint, consumable by
      // Excel / Power BI / any HTTP client.
      document.getElementById('copyUrlToastTitle').textContent = 'Query URL copied';
      document.getElementById('copyUrlToastBody').textContent =
        'You can use it in any app that can load JSON data from the web like Excel, Power BI, etc.';
      const toast = new bootstrap.Toast(document.getElementById('copyUrlToast'));
      toast.show();
    }).catch(err => {
      console.error('Failed to copy URL:', err);
    });
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
    const defaultGraphUri = document.getElementById("default-graph-uri").value;
    const timeout = document.getElementById("timeout").value;
    const strict = document.getElementById("strict").checked ? "true" : "false";
    const debug = document.getElementById("debug").checked ? "true" : "false";
    const report = document.getElementById("report").checked ? "true" : "false";
    const body = `query=${encodeURIComponent(minifiedQuery)}&format=${encodeURIComponent(format)}`
      + (defaultGraphUri ? `&default-graph-uri=${encodeURIComponent(defaultGraphUri)}` : "")
      + (timeout ? `&timeout=${encodeURIComponent(timeout)}` : "")
      + `&strict=${encodeURIComponent(strict)}`
      + `&debug=${encodeURIComponent(debug)}`
      + `&report=${encodeURIComponent(report)}`;

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

      // Force the browser to treat this as a file download by using
      // application/octet-stream in the Blob — regardless of what the
      // endpoint returned (HTML, XML, CSV, JSON), an opaque octet
      // stream + a download attribute makes every browser save
      // rather than render.
      const blob = new Blob([text], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `query-results${QueryResults._extensionFor(format)}`;
      document.body.appendChild(link);
      link.click();
      // Revoke the blob URL AFTER the browser has had a chance to
      // hand the download off to the OS. Revoking synchronously
      // (as the previous version did) races with Chromium's async
      // download pipeline: the browser reads the blob URL a moment
      // after .click() returns, and if we've already revoked it,
      // it falls back to saving the file with a GUID filename and
      // no extension. A 100ms defer is generous enough for every
      // browser we care about.
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
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