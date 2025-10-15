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
import SparqlJs from 'https://cdn.jsdelivr.net/npm/sparqljs@3.7.3/+esm';

/**
 * Class representing the Query Editor.
 * This class is responsible for handling the SPARQL query editor and executing queries.
 */
export class QueryEditor {
  /**
   * Create a Query Editor.
   * @param {string} sparqlEndpoint - The SPARQL endpoint URL.
   */
  constructor(sparqlEndpoint) {
    this.sparqlEndpoint = sparqlEndpoint;
    this.editor = CodeMirror.fromTextArea(document.getElementById("query"), {
      mode: "sparql",
      theme: "eclipse",
      lineNumbers: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      lineWrapping: true,
      extraKeys: {"Ctrl-Space": "autocomplete"},
      placeholder: "Enter your SPARQL query here..."
    });
    this.runQueryButton = document.getElementById('runQueryButton');
    this.queryForm = document.getElementById('queryForm');
    this.resultsDiv = document.getElementById("results");
    this.copyUrlButton = document.getElementById('copy-url-button');
    this.copyUrlAlert = document.getElementById('copy-url-alert');
    this.queryResultsTab = new bootstrap.Tab(document.getElementById('query-results-tab'));
    this.errorMarker = null;
    this.queryResults = null;

    this.initEventListeners();
  }

  /**
   * Set the Query Results instance.
   * @param {QueryResults} queryResults - The QueryResults instance.
   */
  setQueryResults(queryResults) {
    this.queryResults = queryResults;
  }

  /**
   * Initialize event listeners.
   * Sets up event listeners for the query editor, form submission, and copy URL button.
   */
  initEventListeners() {
    this.editor.on("change", this.onEditorChange.bind(this));
    this.queryForm.addEventListener('submit', this.onSubmit.bind(this));
    this.copyUrlButton.addEventListener('click', this.onCopyUrl.bind(this));
  }

  /**
   * Handle editor change event.
   * Checks the SPARQL syntax and updates the run query button state.
   */
  onEditorChange() {
    const query = this.editor.getValue();
    const error = this.checkSparqlSyntax(query);

    if (error) {
      console.log('SPARQL Syntax Error:', error);
      if (this.errorMarker) {
        this.errorMarker.clear();
      }
      if (error.hash && error.hash.loc && error.hash.loc.first_line && error.hash.loc.last_line) {
        const start = error.hash.loc;
        this.errorMarker = this.editor.markText(
          { line: start.first_line - 1, ch: start.first_column },
          { line: start.last_line - 1, ch: start.last_column },
          { className: 'syntax-error-highlight', title: `${error.message}` }
        );
        this.addTooltipToMarker(this.errorMarker, `${error.message}`);
      } else if (error.hash && error.hash.loc && error.hash.loc.first_line) {
        const start = error.hash.loc;
        this.errorMarker = this.editor.markText(
          { line: start.first_line - 1, ch: 0 },
          { line: start.first_line - 1, ch: this.editor.getLine(start.first_line - 1).length },
          { className: 'syntax-error-highlight', title: `${error.message}` }
        );
        this.addTooltipToMarker(this.errorMarker, `${error.message}`);
      }
      this.runQueryButton.disabled = true;
    } else {
      if (this.errorMarker) {
        this.errorMarker.clear();
        this.errorMarker = null;
      }
      this.runQueryButton.disabled = !query.trim();
    }
  }

  /**
   * Add a tooltip to the syntax error marker.
   * @param {CodeMirror.TextMarker} marker - The syntax error marker.
   * @param {string} message - The tooltip message.
   */
  addTooltipToMarker(marker, message) {
    const markerElements = marker.replacedWith || [marker];
    markerElements.forEach((element) => {
      const from = element.from || marker.from;
      const to = element.to || marker.to;
      if (from && to) {
        const lineHandle = this.editor.getLineHandle(from.line);
        const lineElement = this.editor.getWrapperElement().querySelector(`.CodeMirror-line:nth-child(${from.line + 1})`);

        if (lineElement) {
          lineElement.addEventListener('mouseenter', function () {
            const tooltip = document.createElement('div');
            tooltip.className = 'custom-tooltip';
            tooltip.textContent = message;
            document.body.appendChild(tooltip);

            const rect = lineElement.getBoundingClientRect();
            tooltip.style.left = `${rect.left + window.scrollX}px`;
            tooltip.style.top = `${rect.bottom + window.scrollY}px`;

            lineElement.addEventListener('mouseleave', function () {
              tooltip.remove();
            }, { once: true });
          });
        }
      }
    });
  }

  /**
   * Handle form submission event.
   * Executes the SPARQL query and displays the results.
   * @param {Event} event - The form submission event.
   * @async
   */
  async onSubmit(event) {
    event.preventDefault();
    const progressBar = document.querySelector('.progress-bar');
    const submitButton = this.queryForm.querySelector('button[type="submit"]');
    progressBar.style.width = '100%';
    progressBar.classList.add('progress-bar-striped', 'progress-bar-animated');
    submitButton.disabled = true;

    try {
      const query = this.editor.getValue();
      const format = document.getElementById("format").value || "application/sparql-results+json";
      const defaultGraphUri = document.getElementById("default-graph-uri").value;
      const timeout = document.getElementById("timeout").value;
      const strict = document.getElementById("strict").checked ? "true" : "false";
      const debug = document.getElementById("debug").checked ? "true" : "false";
      const report = document.getElementById("report").checked ? "true" : "false";

      const body = `query=${encodeURIComponent(query)}&format=${encodeURIComponent(format)}`
        + (defaultGraphUri ? `&default-graph-uri=${encodeURIComponent(defaultGraphUri)}` : "")
        + (timeout ? `&timeout=${encodeURIComponent(timeout)}` : "")
        + `&strict=${encodeURIComponent(strict)}`
        + `&debug=${encodeURIComponent(debug)}`
        + `&report=${encodeURIComponent(report)}`;

      console.log(`Request body: ${body}`);
      console.log(`Sending request to: ${this.sparqlEndpoint}`);

      const response = await fetch(this.sparqlEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      let result;

      if (contentType.includes('json')) {
        const responseText = await response.text();
        console.log(`Response text: ${responseText}`);
        result = JSON.parse(responseText);
        this.queryResults.displayJsonResults(result);
      } else if (contentType.includes('html') || 
                 format === 'text/html' || 
                 format === 'text/x-html+tr' ||
                 format === 'application/vnd.ms-excel') {
        result = await response.text();
        this.resultsDiv.innerHTML = result;

        const table = this.resultsDiv.querySelector('table');
        if (table) {
          const firstRow = table.querySelector('tr');
          if (firstRow && firstRow.querySelectorAll('th').length > 0) {
            if (!table.querySelector('thead')) {
              const thead = document.createElement('thead');
              thead.appendChild(firstRow);
              table.insertBefore(thead, table.firstChild);
            }
          }

          table.querySelectorAll('td pre').forEach(pre => {
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.wordBreak = 'break-word';
            pre.style.overflowX = 'hidden';
          });
        }

        this.copyUrlAlert.style.display = 'flex';
      } else if (contentType.includes('xml')) {
        result = await response.text();
        this.queryResults.displayTextResults(result, 'xml');
      } else if (contentType.includes('csv')) {
        result = await response.text();
        this.queryResults.displayTextResults(result, 'csv');
      } else {
        result = await response.text();
        this.queryResults.displayTextResults(result, 'text');
      }
    } catch (error) {
      this.resultsDiv.textContent = `Error: ${error.message}`;
      this.copyUrlAlert.style.display = 'none';
    } finally {
      progressBar.style.width = '0%';
      progressBar.classList.remove('progress-bar-striped', 'progress-bar-animated');
      submitButton.disabled = false;
    }

    this.queryResultsTab.show();
  }

  /**
   * Handle copy URL button click event.
   * Generates a URL for the current query and copies it to the clipboard.
   */
  onCopyUrl() {
    const query = this.editor.getValue();
    const minifiedQuery = this.minifySparqlQuery(query);
    const format = document.getElementById("format").value || "application/sparql-results+json";
    const defaultGraphUri = document.getElementById("default-graph-uri").value;
    const timeout = document.getElementById("timeout").value || 30000;

    const url = `${this.sparqlEndpoint}?default-graph-uri=${encodeURIComponent(defaultGraphUri)}&query=${encodeURIComponent(minifiedQuery)}&format=${encodeURIComponent(format)}&timeout=${encodeURIComponent(timeout)}`;
    
    console.log(`Generated URL: ${url}`);
    navigator.clipboard.writeText(url).then(() => {
      const toast = new bootstrap.Toast(document.getElementById('copyUrlToast'));
      toast.show();
    }).catch(err => {
      console.error('Failed to copy URL:', err);
    });
  }

  /**
   * Minify the SPARQL query.
   * @param {string} query - The SPARQL query.
   * @returns {string} - The minified SPARQL query.
   */
  minifySparqlQuery(query) {
    const parser = new SparqlJs.Parser();
    const generator = new SparqlJs.Generator();
    const parsedQuery = parser.parse(query);
    return generator.stringify(parsedQuery);
  }

  /**
   * Check the SPARQL syntax.
   * @param {string} query - The SPARQL query.
   * @returns {Error|null} - The syntax error or null if the syntax is valid.
   */
  checkSparqlSyntax(query) {
    const parser = new SparqlJs.Parser();
    try {
      parser.parse(query);
      return null;
    } catch (error) {
      return error;
    }
  }
}
