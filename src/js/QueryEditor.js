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
 * the Lic
 */
import SparqlJs from 'https://cdn.jsdelivr.net/npm/sparqljs@3.7.4/+esm';
import {EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
        drawSelection, dropCursor, rectangularSelection, crosshairCursor,
        highlightSpecialChars, placeholder, keymap,
        EditorState,
        history, defaultKeymap, historyKeymap,
        bracketMatching, foldGutter, foldKeymap, indentOnInput,
        syntaxHighlighting, defaultHighlightStyle,
        autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap,
        searchKeymap, highlightSelectionMatches,
        linter, lintGutter, lintKeymap,
        sparql} from '../vendor/codemirror-bundle.js';
import {eclipseTheme, eclipseHighlightStyle} from './cm-theme.js';
import {epoCompletionSource, getEpoData} from './epo-completion.js';

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
    this.alertMessage = document.getElementById('alert-message');
    this.openUrlButton = document.getElementById('open-url-button');
    this.queryResultsTab = new bootstrap.Tab(document.getElementById('query-results-tab'));
    this.stopQueryButton = document.getElementById('stopQueryButton');
    this.queryResults = null;
    this.abortController = null;
    this.isQueryRunning = false;
    this.timerInterval = null;

    const sparqlLinter = linter((view) => {
      const doc = view.state.doc.toString();
      if (!doc.trim()) return [];
      const diagnostics = [];

      // Syntax errors
      const error = this.checkSparqlSyntax(doc);
      if (error) {
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
      }

      // ePO term validation — check epo:Term references against known terms
      const epo = getEpoData();
      if (epo) {
        const allTerms = new Set([...epo.classes, ...epo.objectProperties, ...epo.datatypeProperties]);
        const allTermsLower = new Map();
        for (const term of allTerms) {
          allTermsLower.set(term.toLowerCase(), term);
        }

        const regex = /epo:(\w+)/g;
        let match;
        while ((match = regex.exec(doc)) !== null) {
          const term = match[1];
          if (!allTerms.has(term)) {
            const correctTerm = allTermsLower.get(term.toLowerCase());
            const from = match.index;
            const to = from + match[0].length;
            if (correctTerm) {
              diagnostics.push({
                from, to,
                severity: "warning",
                message: `Unknown term "epo:${term}". Did you mean "epo:${correctTerm}"?`
              });
            } else {
              diagnostics.push({
                from, to,
                severity: "warning",
                message: `"epo:${term}" is not a known ePO class or property.`
              });
            }
          }
        }
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
          autocompletion({ override: [epoCompletionSource] }),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          placeholder("Enter your SPARQL query here... (Ctrl+Space for suggestions)"),
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
   * Wire the explorer routing — Stage 7. When set, queries with type
   * CONSTRUCT or DESCRIBE are routed to the ExplorerController for
   * tree/turtle/backlinks rendering on the Explore tab, instead of
   * being fetched and rendered as text on the Query Results tab.
   * SELECT and ASK queries continue to use the existing fetch path.
   *
   * @param {ExplorerController} explorerController
   * @param {() => void} showExplorerTab — switches the active Bootstrap
   *   tab to the Explore tab and resets its view mode to Tree.
   */
  setExplorerRouting(explorerController, showExplorerTab) {
    this.explorerController = explorerController;
    this.showExplorerTab = showExplorerTab;
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
    if (this.isQueryRunning) return;
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
    if (this.isQueryRunning) return;

    // Stage 7 — auto-route by query type. CONSTRUCT and DESCRIBE
    // queries return RDF graphs, which the Explore tab is built to
    // render (tree / turtle / backlinks). SELECT and ASK return
    // tabular bindings, which the existing Query Results path below
    // handles. ASK with no result tab support yet falls through to
    // SELECT (the user sees the boolean as a one-row table).
    //
    // The routing only kicks in when setExplorerRouting() has been
    // called from the bootstrap (script.js), which is always true in
    // the merged app but kept optional so QueryEditor can still be
    // used standalone if anyone needs to.
    if (this.explorerController && this.showExplorerTab) {
      const queryText = this.getQuery();
      let queryType;
      try {
        queryType = new SparqlJs.Parser().parse(queryText)?.queryType;
      } catch {
        // Parse error: fall through to the existing SELECT path which
        // surfaces the error message via its own error handling. Run
        // is normally disabled when there's a syntax error, so this
        // branch is mostly defensive.
      }
      if (queryType === 'CONSTRUCT' || queryType === 'DESCRIBE') {
        // Hand the raw query to the ExplorerController. It re-runs
        // the query through its own worker-backed sparqlService, parses
        // the Turtle into quads, and emits results-changed for DataView
        // to render. Then we switch tabs.
        try {
          await this.explorerController.search({ type: 'query', query: queryText });
          this.showExplorerTab();
        } catch (error) {
          // Surface controller-side errors to the user via the existing
          // alert UI in the Query Editor tab so they aren't lost. The
          // user is on the Editor tab when they click Run, so showing
          // the error there (rather than on the Explore tab) keeps
          // attention where it already is.
          this.copyUrlAlert.classList.remove('d-none', 'alert-info');
          this.copyUrlAlert.classList.add('d-flex', 'alert-danger');
          this.alertMessage.textContent = `Error: ${error.message}`;
          this.openUrlButton.classList.add('d-none');
        }
        return;
      }
    }

    this.queryResults.setResponseData(null, null);
    const progressBar = document.querySelector('.progress-bar');
    const submitButton = this.queryForm.querySelector('button[type="submit"]');
    const queryTimer = document.getElementById('query-timer');
    progressBar.style.width = '100%';
    progressBar.classList.add('progress-bar-striped', 'progress-bar-animated');
    queryTimer.textContent = '0s';
    submitButton.disabled = true;
    this.stopQueryButton.style.display = 'flex';
    this.isQueryRunning = true;
    this.abortController = new AbortController();

    const startTime = performance.now();
    this.timerInterval = setInterval(() => {
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(0);
      queryTimer.textContent = `${elapsed}s`;
    }, 1000);

    this.copyUrlAlert.classList.add('d-none');
    this.copyUrlAlert.classList.remove('d-flex', 'alert-danger');
    this.copyUrlAlert.classList.add('alert-info');
    this.alertMessage.textContent = 'You can run this query directly from Excel or any other application by using its URL.';
    this.openUrlButton.classList.remove('d-none');
    this.resultsDiv.innerHTML = '';

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
        const errorBody = await response.text();
        const error = new Error(`HTTP error. Status: ${response.status}`);
        error.serverMessage = errorBody;
        throw error;
      }

      const contentType = response.headers.get('content-type');
      const responseText = await response.text();
      this.queryResults.setResponseData(responseText, contentType);

      if (contentType.includes('json')) {
        const result = JSON.parse(responseText);
        this.queryResults.displayJsonResults(result);
      } else if (contentType.includes('html') ||
                 format === 'text/html' ||
                 format === 'text/x-html+tr' ||
                 format === 'application/vnd.ms-excel') {
        this.resultsDiv.innerHTML = responseText;

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

        this.copyUrlAlert.classList.remove('d-none'); this.copyUrlAlert.classList.add('d-flex');
      } else if (contentType.includes('xml')) {
        this.queryResults.displayTextResults(responseText, 'xml');
      } else if (contentType.includes('csv')) {
        this.queryResults.displayTextResults(responseText, 'csv');
      } else {
        this.queryResults.displayTextResults(responseText, 'text');
      }
    } catch (error) {
      let message;
      if (error.name === 'AbortError') {
        message = 'Query cancelled.';
      } else if (error.message.includes('Status: 400')) {
        message = 'The SPARQL endpoint could not process your query. Please check your query syntax, prefixes, and property names.';
      } else if (error.message.includes('Status: 500')) {
        message = 'The SPARQL endpoint encountered an internal error. The query may be too complex or the server may be temporarily unavailable.';
      } else if (error.message.includes('Status: 504') || error.message.includes('timeout')) {
        message = 'The query timed out. Try simplifying your query or adding more specific filters to reduce the result set.';
      } else {
        message = `Error: ${error.message}`;
      }
      this.alertMessage.textContent = message;
      if (error.serverMessage) {
        const details = document.createElement('pre');
        details.className = 'mt-2 mb-0 small';
        details.style.whiteSpace = 'pre-wrap';
        details.textContent = error.serverMessage;
        this.alertMessage.appendChild(details);
      }
      this.copyUrlAlert.classList.remove('d-none', 'alert-info');
      this.copyUrlAlert.classList.add('d-flex', 'alert-danger');
      this.openUrlButton.classList.add('d-none');
    } finally {
      clearInterval(this.timerInterval);
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      progressBar.style.width = '0%';
      progressBar.classList.remove('progress-bar-striped', 'progress-bar-animated');
      queryTimer.textContent = `${elapsed}s`;
      submitButton.disabled = false;
      this.stopQueryButton.style.display = 'none';
      this.isQueryRunning = false;
      this.abortController = null;
      this.onEditorChange();
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
