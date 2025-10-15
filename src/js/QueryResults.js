/*
 * Copyright 2022 European Union
 *
 * Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
 * Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Lic
 */

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
    this.openUrlButton = document.getElementById('open-url-button');
    this.copyUrlAlert = document.getElementById('copy-url-alert');
    this.queryResultsTab = new bootstrap.Tab(document.getElementById('query-results-tab'));

    this.initEventListeners();
  }

  /**
   * Initialize event listeners.
   * Sets up event listeners for the copy URL button and the open URL button.
   */
  initEventListeners() {
    this.copyUrlButton.addEventListener('click', this.onCopyUrl.bind(this));
    this.openUrlButton.addEventListener('click', this.onOpenUrl.bind(this));
  }

  /**
   * Generate the URL for the current query.
   * @returns {string} - The generated URL.
   */
  generateUrl() {
    const query = this.queryEditor.editor.getValue();
    const minifiedQuery = this.queryEditor.minifySparqlQuery(query);
    const format = document.getElementById("format").value || "application/sparql-results+json";
    const defaultGraphUri = document.getElementById("default-graph-uri").value;
    const timeout = document.getElementById("timeout").value || 30000;

    return `${this.originalSparqlEndpoint}?default-graph-uri=${encodeURIComponent(defaultGraphUri)}&query=${encodeURIComponent(minifiedQuery)}&format=${encodeURIComponent(format)}&timeout=${encodeURIComponent(timeout)}`;
  }

  /**
   * Display JSON results.
   * @param {Object} data - The JSON results data.
   */
  displayJsonResults(data) {
    this.resultsDiv.innerHTML = "";

    if (data.results && data.results.bindings.length > 0) {
      const table = document.createElement("table");
      table.className = "table sparql monospace";

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
      this.copyUrlAlert.style.display = 'flex';
    } else {
      this.resultsDiv.textContent = "No results found.";
      this.copyUrlAlert.style.display = 'none';
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
    this.copyUrlAlert.style.display = 'flex';
  }

  /**
   * Handle copy URL button click event.
   * Generates a URL for the current query and copies it to the clipboard.
   */
  onCopyUrl() {
    const url = this.generateUrl();
    
    console.log(`Generated URL: ${url}`);
    navigator.clipboard.writeText(url).then(() => {
      const toast = new bootstrap.Toast(document.getElementById('copyUrlToast'));
      toast.show();
    }).catch(err => {
      console.error('Failed to copy URL:', err);
    });
  }

  /**
   * Handle open URL button click event.
   * Generates a URL for the current query and triggers a download.
   */
  onOpenUrl() {
    const url = this.generateUrl();
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'query-results';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}