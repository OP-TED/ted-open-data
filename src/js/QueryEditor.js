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
import {classifyError} from './errorMessages.js';

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
    // Friendly error state on the Data tab (SELECT lane). Replaces the
    // old red alert-danger banner with an empty-state view. The
    // container wraps icon + title + message; we populate only the
    // #results-error-message slot and toggle the wrapper's visibility.
    this.resultsErrorState = document.getElementById('results-error-state');
    this.resultsErrorMessage = document.getElementById('results-error-message');
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
  setExplorerRouting(explorerController, showExplorerTab, setActiveResultTab) {
    this.explorerController = explorerController;
    this.showExplorerTab = showExplorerTab;
    // Stage 12 mutual exclusion of the two result tabs ("Query Results"
    // SELECT lane vs graph lane). Optional — defaults to a no-op so
    // QueryEditor can still run standalone.
    this.setActiveResultTab = setActiveResultTab || (() => {});
  }

  /**
   * Replace the editor's content with the given text — Stage 8.
   * Used by the Search tab when it generates a canned CONSTRUCT for a
   * notice lookup: the query is shown in the editor (so the user can
   * see, edit, and learn from it) while the actual execution is still
   * routed via the controller's notice-number facet path so the title,
   * procedure timeline, and history dropdown stay populated.
   *
   * Does NOT trigger Run. Callers that want to also run after loading
   * the text should follow up with a separate call to onSubmit (or
   * just dispatch a submit event on the form).
   *
   * @param {string} text
   */
  setQueryText(text) {
    if (!this.editor || typeof text !== 'string') return;
    this.editor.dispatch({
      changes: { from: 0, to: this.editor.state.doc.length, insert: text },
    });
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

    // Mark the editor busy up-front, before the CONSTRUCT/DESCRIBE
    // routing branch. Previously the `isQueryRunning` flag was only
    // set on the SELECT path, so two rapid-fire CONSTRUCT submissions
    // could run overlapping explorer searches and fire their tab
    // switches out of order. A single `try/finally` around the whole
    // submit body guarantees the flag is always released, regardless
    // of which lane the query took.
    this.isQueryRunning = true;

    try {
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
        let parseError;
        try {
          queryType = new SparqlJs.Parser().parse(queryText)?.queryType;
        } catch (e) {
          // Parse error: remember it so we can surface it via the
          // friendly error state below, instead of silently falling
          // through to the SELECT path (where the server would reject
          // the same query and return a confusingly late error).
          parseError = e;
        }

        if (parseError) {
          this._renderSelectLaneError(parseError);
          return;
        }

        if (queryType === 'CONSTRUCT' || queryType === 'DESCRIBE') {
          // Hand the raw query to the ExplorerController. It re-runs
          // the query through its own worker-backed sparqlService, parses
          // the Turtle into quads, and emits results-changed for DataView
          // to render. Then we switch tabs and enforce Stage 12 mutual
          // exclusion (hide the SELECT lane's tab — graph lane wins).
          try {
            await this.explorerController.search({ type: 'query', query: queryText });
            this.setActiveResultTab('graph');
            this.showExplorerTab();
          } catch (error) {
            // Defensive: ExplorerController already catches worker
            // errors internally and routes them to DataView's graph
            // lane error state, so this branch is mostly unreachable.
            // If something slips through, log it rather than leaving
            // the user with no feedback.
            console.error('Explorer controller error:', error);
          }
          return;
        }
      }

      // ── SELECT / ASK path ────────────────────────────────────────
      this.queryResults.setResponseData(null, null);
      const progressBar = document.querySelector('.progress-bar');
      const submitButton = this.queryForm.querySelector('button[type="submit"]');
      const queryTimer = document.getElementById('query-timer');
      progressBar.style.width = '100%';
      progressBar.classList.add('progress-bar-striped', 'progress-bar-animated');
      queryTimer.textContent = '0s';
      submitButton.disabled = true;
      this.stopQueryButton.style.display = 'flex';
      this.abortController = new AbortController();

      const startTime = performance.now();
      this.timerInterval = setInterval(() => {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(0);
        queryTimer.textContent = `${elapsed}s`;
      }, 1000);

      // Reset the results toolbar and the friendly error state to a
      // clean start before the new run. The toolbar is revealed on
      // success via QueryResults.displayJsonResults; the error state
      // only appears if the fetch or rendering fails.
      this.copyUrlAlert.classList.add('d-none');
      this.resultsErrorState.style.display = 'none';
      this.resultsErrorMessage.textContent = '';
      this.resultsDiv.innerHTML = '';

      try {
        const query = this.getQuery();
        // The editor always requests SPARQL Results JSON — QueryResults
        // renders its own consistent table from the structured payload
        // (drops language tags, unwraps quoted literals, formats dates).
        // Format choice for export has moved to the Data tab's
        // "Download as…" menu and no longer affects what the editor runs.
        const format = "application/sparql-results+json";
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

        // The request is always JSON, but a misconfigured endpoint could
        // still return an unexpected content type — parse defensively.
        try {
          const result = JSON.parse(responseText);
          this.queryResults.displayJsonResults(result);
        } catch (parseError) {
          this.queryResults.displayTextResults(responseText, 'text');
        }
        this.copyUrlAlert.classList.remove('d-none');
        this.copyUrlAlert.classList.add('d-flex');

        // Stage 12 — mutual exclusion: SELECT lane wins. Reveal the
        // SELECT result tab and hide the graph result tab. Only runs
        // on success; on error we stay on whatever tab the user is on
        // (previously the tab-switch fell out of the try/catch and
        // yanked the user to an empty SELECT tab after a failure).
        this.setActiveResultTab('select');
        this.queryResultsTab.show();
      } catch (error) {
        this._renderSelectLaneError(error);
      } finally {
        clearInterval(this.timerInterval);
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        progressBar.style.width = '0%';
        progressBar.classList.remove('progress-bar-striped', 'progress-bar-animated');
        queryTimer.textContent = `${elapsed}s`;
        submitButton.disabled = false;
        this.stopQueryButton.style.display = 'none';
        this.abortController = null;
        this.onEditorChange();
      }
    } finally {
      // Outer finally — releases the top-level busy flag set at entry,
      // regardless of whether this was a CONSTRUCT or a SELECT path
      // and regardless of whether it succeeded.
      this.isQueryRunning = false;
    }
  }

  /**
   * Render a SELECT-lane error into the shared friendly-error state.
   * Extracted so both the sparqljs parse-error branch and the fetch
   * error branch can use the same rendering code, and so the rendering
   * logic is not duplicated mid-method.
   * @param {Error} error
   * @private
   */
  _renderSelectLaneError(error) {
    // Classify via the shared helper (lane='select') so the SELECT
    // and graph lanes present errors with the same vocabulary and
    // visual shape. The classifier can also hand back an optional
    // inline action (e.g. "copy the query URL" on timeout).
    const { friendly, detail, action } = classifyError(error, 'select');
    // Wipe the message slot (and any previous inline link) before
    // re-rendering.
    this.resultsErrorMessage.textContent = friendly;
    if (action?.kind === 'copy-select-url') {
      // Append a space + inline link + period to the friendly
      // sentence. Clicking the link calls the existing Copy URL
      // handler on QueryResults so the user gets the same toast
      // and the same JSON-format URL we offer from the toolbar.
      this.resultsErrorMessage.appendChild(document.createTextNode(' You can still '));
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = action.label;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.queryResults?.onCopyUrl();
      });
      this.resultsErrorMessage.appendChild(link);
      this.resultsErrorMessage.appendChild(document.createTextNode(' to use the query from a tool that can handle long-running requests.'));
    }
    // Remove any previous details block before adding a new one.
    this.resultsErrorState.querySelector('pre')?.remove();
    if (detail) {
      const pre = document.createElement('pre');
      pre.className = 'mt-3 mb-0 small text-muted text-center';
      pre.style.whiteSpace = 'pre-wrap';
      pre.textContent = detail;
      this.resultsErrorState.appendChild(pre);
    }
    this.resultsErrorState.style.display = '';
    this.copyUrlAlert.classList.add('d-none');
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
    // Copy URL emits a SPARQL Results JSON URL. Anyone pasting this
    // into Excel, Power BI, or a custom app gets the same structured
    // JSON the editor consumes — which is the most machine-friendly
    // SELECT/ASK format. Format choice for on-disk export lives in
    // the Data tab's "Download as…" menu, not here.
    const format = "application/sparql-results+json";
    const defaultGraphUri = document.getElementById("default-graph-uri").value;
    const timeout = document.getElementById("timeout").value || 30000;
    const strict = document.getElementById("strict").checked ? "true" : "false";
    const debug = document.getElementById("debug").checked ? "true" : "false";
    const report = document.getElementById("report").checked ? "true" : "false";

    const url = `${this.sparqlEndpoint}?default-graph-uri=${encodeURIComponent(defaultGraphUri)}&query=${encodeURIComponent(minifiedQuery)}&format=${encodeURIComponent(format)}&timeout=${encodeURIComponent(timeout)}&strict=${encodeURIComponent(strict)}&debug=${encodeURIComponent(debug)}&report=${encodeURIComponent(report)}`;

    navigator.clipboard.writeText(url).then(() => {
      const toast = new bootstrap.Toast(document.getElementById('copyUrlToast'));
      toast.show();
    }).catch(err => {
      console.error('Failed to copy URL:', err);
    });
  }

  /**
   * Minify the SPARQL query. The return value is fed directly into
   * `encodeURIComponent` for Copy URL / Share view, so it must never
   * throw — a parse failure would bubble out of the click handler as
   * an unhandled rejection and leave the button in a broken state.
   * On parse failure, fall back to the raw query: the resulting URL
   * is longer than ideal but still a valid SPARQL query string.
   * @param {string} query - The SPARQL query.
   * @returns {string} - The minified (or, on parse failure, raw) query.
   */
  minifySparqlQuery(query) {
    try {
      const parser = new SparqlJs.Parser();
      const generator = new SparqlJs.Generator();
      const parsedQuery = parser.parse(query);
      return generator.stringify(parsedQuery);
    } catch (e) {
      console.warn('minifySparqlQuery: falling back to raw query (parse failed):', e);
      return query;
    }
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
