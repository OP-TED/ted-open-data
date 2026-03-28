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
import {EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
        drawSelection, dropCursor, rectangularSelection, crosshairCursor,
        highlightSpecialChars, placeholder, keymap} from 'https://esm.sh/@codemirror/view@6.40.0';
import {EditorState} from 'https://esm.sh/@codemirror/state@6.6.0';
import {history, defaultKeymap, historyKeymap} from 'https://esm.sh/@codemirror/commands@6.10.3';
import {bracketMatching, foldGutter, foldKeymap, indentOnInput,
        syntaxHighlighting, defaultHighlightStyle} from 'https://esm.sh/@codemirror/language@6.12.3';
import {autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap} from 'https://esm.sh/@codemirror/autocomplete@6.20.1';
import {searchKeymap, highlightSelectionMatches} from 'https://esm.sh/@codemirror/search@6.6.0';
import {linter, lintGutter, lintKeymap} from 'https://esm.sh/@codemirror/lint@6.9.5';
import {sparql} from 'https://esm.sh/codemirror-lang-sparql@2.0.0';
import {eclipseTheme, eclipseHighlightStyle} from './cm-theme.js';

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
    this.runQueryButton = document.getElementById('runQueryButton');
    this.queryForm = document.getElementById('queryForm');
    this.resultsDiv = document.getElementById("results");
    this.copyUrlButton = document.getElementById('copy-url-button');
    this.copyUrlAlert = document.getElementById('copy-url-alert');
    this.queryResultsTab = new bootstrap.Tab(document.getElementById('query-results-tab'));
    this.stopQueryButton = document.getElementById('stopQueryButton');
    this.queryResults = null;
    this.abortController = null;

    const sparqlLinter = linter((view) => {
      const doc = view.state.doc.toString();
      if (!doc.trim()) return [];
      const error = this.checkSparqlSyntax(doc);
      if (!error) return [];

      const diagnostics = [];
      if (error.hash && error.hash.loc && error.hash.loc.first_line) {
        const loc = error.hash.loc;
        const fromLine = view.state.doc.line(loc.first_line);
        const from = fromLine.from + (loc.first_column || 0);
        let to;
        if (loc.last_line && loc.last_column) {
          const toLine = view.state.doc.line(loc.last_line);
          to = toLine.from + loc.last_column;
        } else {
          to = fromLine.to;
        }
        diagnostics.push({ from, to, severity: "error", message: error.message });
      }
      return diagnostics;
    });

    this.editor = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          placeholder("Enter your SPARQL query here..."),
          sparql(),
          eclipseTheme,
          eclipseHighlightStyle,
          sparqlLinter,
          lintGutter(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.onEditorChange();
            }
          }),
        ]
      }),
      parent: document.getElementById("query")
    });

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
   * Get the current query text.
   * @returns {string} - The current query text.
   */
  getQuery() {
    return this.editor.state.doc.toString();
  }

  /**
   * Set the query text.
   * @param {string} text - The query text to set.
   */
  setValue(text) {
    this.editor.dispatch({
      changes: { from: 0, to: this.editor.state.doc.length, insert: text }
    });
  }

  /**
   * Initialize event listeners.
   * Sets up event listeners for form submission, copy URL button, and stop button.
   */
  initEventListeners() {
    this.queryForm.addEventListener('submit', this.onSubmit.bind(this));
    this.copyUrlButton.addEventListener('click', this.onCopyUrl.bind(this));
    this.stopQueryButton.addEventListener('click', this.onStopQuery.bind(this));
  }

  /**
   * Handle editor change event.
   * Updates the run query button state based on syntax validity.
   */
  onEditorChange() {
    const query = this.getQuery();
    const error = this.checkSparqlSyntax(query);
    this.runQueryButton.disabled = error ? true : !query.trim();
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
    this.stopQueryButton.style.display = 'flex';
    this.abortController = new AbortController();

    try {
      const query = this.getQuery();
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
        body: body,
        signal: this.abortController.signal
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
      if (error.name === 'AbortError') {
        this.resultsDiv.textContent = 'Query cancelled.';
      } else {
        this.resultsDiv.textContent = `Error: ${error.message}`;
      }
      this.copyUrlAlert.style.display = 'none';
    } finally {
      progressBar.style.width = '0%';
      progressBar.classList.remove('progress-bar-striped', 'progress-bar-animated');
      submitButton.disabled = false;
      this.stopQueryButton.style.display = 'none';
      this.abortController = null;
    }

    this.queryResultsTab.show();
  }

  /**
   * Handle stop query button click event.
   * Aborts the currently running SPARQL query.
   */
  onStopQuery() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Handle copy URL button click event.
   * Generates a URL for the current query and copies it to the clipboard.
   */
  onCopyUrl() {
    const query = this.getQuery();
    const minifiedQuery = this.minifySparqlQuery(query);
    const format = document.getElementById("format").value || "application/sparql-results+json";
    const defaultGraphUri = document.getElementById("default-graph-uri").value;
    const timeout = document.getElementById("timeout").value || 30000;
    const strict = document.getElementById("strict").checked ? "true" : "false";
    const debug = document.getElementById("debug").checked ? "true" : "false";
    const report = document.getElementById("report").checked ? "true" : "false";

    const url = `${this.sparqlEndpoint}?default-graph-uri=${encodeURIComponent(defaultGraphUri)}&query=${encodeURIComponent(minifiedQuery)}&format=${encodeURIComponent(format)}&timeout=${encodeURIComponent(timeout)}&strict=${encodeURIComponent(strict)}&debug=${encodeURIComponent(debug)}&report=${encodeURIComponent(report)}`;

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
