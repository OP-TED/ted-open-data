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
import yaml from 'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm';
import {EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
        drawSelection, highlightSpecialChars, keymap,
        EditorState,
        defaultKeymap,
        bracketMatching, foldGutter, foldKeymap,
        syntaxHighlighting, defaultHighlightStyle,
        sparql} from '../vendor/codemirror-bundle.js';
import {eclipseTheme, eclipseHighlightStyle} from './utils/cmTheme.js';
import { showToast } from './utils/toast.js';

/**
 * Class representing the Query Library.
 * This class is responsible for loading and displaying SPARQL queries from a remote source.
 */
export class QueryLibrary {
  /**
   * Create a Query Library.
   * @param {string} sparqlEndpoint - The SPARQL endpoint URL.
   * @param {QueryEditor} queryEditor - The QueryEditor instance.
   * @param {string} remoteQueriesUrl - The URL to fetch remote queries.
   */
  constructor(sparqlEndpoint, queryEditor, remoteQueriesUrl) {
    this.sparqlEndpoint = sparqlEndpoint;
    this.queryEditor = queryEditor;
    this.remoteQueriesUrl = remoteQueriesUrl;
    this.queryAccordion = document.getElementById('query-accordion');
    this.selectQueryMessage = document.getElementById('select-query-message');
    this.queryCard = document.getElementById('query-card');
    this.queryTitle = document.getElementById('query-title');
    this.queryDescription = document.getElementById('query-description');
    this.querySparqlEditor = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          foldGutter(),
          drawSelection(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          sparql(),
          eclipseTheme,
          eclipseHighlightStyle,
          keymap.of([
            ...defaultKeymap,
            ...foldKeymap,
          ]),
        ]
      }),
      parent: document.getElementById("query-sparql")
    });
    this.tryQueryButton = document.getElementById('try-query-button');
    this.customiseQueryButton = document.getElementById('customise-query-button');
    this.selectedQueryElement = null;
    this.queries = [];

    this.initEventListeners();
    this.loadQueries();
  }

  /**
   * Initialize event listeners.
   * Sets up event listeners for the query accordion and the try
   * query / customise buttons.
   */
  initEventListeners() {
    this.queryAccordion.addEventListener('click', this.onQueryClick.bind(this));
    // Keyboard selection for the query items. Enter and Space are
    // the canonical activation keys for role="button" elements.
    // Space must preventDefault or the browser scrolls the page.
    this.queryAccordion.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest('.list-group-item');
      if (!item) return;
      event.preventDefault();
      this.onQueryClick(event);
    });
    this.tryQueryButton.addEventListener('click', this.onTryQuery.bind(this));
    this.customiseQueryButton?.addEventListener('click', this.onCustomise.bind(this));
  }

  /**
   * Load queries from the remote URL.
   * This method fetches a YAML file containing SPARQL queries from the specified remote URL.
   * The queries are categorized and displayed in an accordion format.
   * @async
   */
  async loadQueries() {
    try {
      // Fetch the YAML file containing the queries. Check
      // response.ok explicitly — otherwise a 404 HTML body flows
      // into yaml.load() and throws an opaque parse error.
      const response = await fetch(`${this.remoteQueriesUrl}index.yaml`);
      if (!response.ok) {
        throw new Error(`HTTP error. Status: ${response.status}`);
      }
      const text = await response.text();
      const data = yaml.load(text);
      const categories = new Map();

      // Organize queries by category
      data.queries.forEach(query => {
        if (!categories.has(query.category)) {
          categories.set(query.category, []);
        }
        categories.get(query.category).push(query);
      });

      // Create accordion items for each category and populate with queries.
      // All text is set via textContent and all identifiers are safely
      // slugified, so a query title or category name containing quotes,
      // angle brackets or HTML entities cannot escape the markup. The
      // source YAML is trusted (OP-TED/ted-rdf-docs), but defence in depth
      // is cheap here and prevents future supply-chain or typo issues.
      let categoryCounter = 0;
      categories.forEach((queries, category) => {
        const categoryId = `category-${categoryCounter++}`;

        const categoryItem = document.createElement('div');
        categoryItem.className = 'accordion-item';

        const header = document.createElement('h2');
        header.className = 'query-library-accordion-header';
        header.id = `${categoryId}-header`;

        const headerButton = document.createElement('button');
        headerButton.className = 'accordion-button collapsed';
        headerButton.type = 'button';
        headerButton.setAttribute('data-bs-toggle', 'collapse');
        headerButton.setAttribute('data-bs-target', `#${categoryId}`);
        headerButton.setAttribute('aria-expanded', 'false');
        headerButton.setAttribute('aria-controls', categoryId);
        headerButton.textContent = category;
        header.appendChild(headerButton);

        const collapse = document.createElement('div');
        collapse.id = categoryId;
        collapse.className = 'accordion-collapse collapse';
        collapse.setAttribute('aria-labelledby', `${categoryId}-header`);
        collapse.setAttribute('data-bs-parent', '#query-accordion');

        const body = document.createElement('div');
        body.className = 'accordion-body p-0';

        const list = document.createElement('ul');
        list.className = 'list-group list-group-flush';

        for (const query of queries) {
          const li = document.createElement('li');
          li.className = 'list-group-item list-group-item-action query-library-item';
          li.dataset.queryTitle = query.title;
          li.dataset.queryFile = query.sparql;
          // Accessibility: the items look and behave like buttons
          // but the semantic element is <li> (they live in an
          // accordion list). Expose them as buttons to assistive
          // tech and make them reachable via keyboard.
          li.setAttribute('role', 'button');
          li.setAttribute('tabindex', '0');
          li.setAttribute('aria-label', `Select query: ${query.title}`);

          const icon = document.createElement('i');
          icon.className = 'bi bi-file-earmark-code query-library-item-icon';
          icon.setAttribute('aria-hidden', 'true');

          const label = document.createElement('span');
          label.textContent = query.title;

          li.appendChild(icon);
          li.appendChild(label);
          list.appendChild(li);
        }

        body.appendChild(list);
        collapse.appendChild(body);

        categoryItem.appendChild(header);
        categoryItem.appendChild(collapse);

        this.queryAccordion.appendChild(categoryItem);
      });

      this.queries = data.queries;
    } catch (error) {
      console.error('[QueryLibrary] Failed to load queries:', error);
      this._renderLoadError();
    }
  }

  /**
   * Render an inline error state inside the (empty) accordion when
   * the initial loadQueries fetch fails. Without this, a failed
   * load leaves a silently blank library with no explanation —
   * users assume the tab is broken and bounce. The retry button
   * re-runs loadQueries so transient failures are recoverable
   * without a page reload.
   * @private
   */
  _renderLoadError() {
    if (!this.queryAccordion) return;
    this.queryAccordion.replaceChildren();

    const wrapper = document.createElement('div');
    wrapper.className = 'text-muted small p-3';

    const title = document.createElement('p');
    title.className = 'mb-2';
    title.textContent = 'Could not load the query library.';
    wrapper.appendChild(title);

    const hint = document.createElement('p');
    hint.className = 'mb-2';
    hint.textContent = 'Please check your connection and try again.';
    wrapper.appendChild(hint);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-sm btn-outline-secondary';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      this.queryAccordion.replaceChildren();
      this.loadQueries();
    });
    wrapper.appendChild(retry);

    this.queryAccordion.appendChild(wrapper);
  }

  /**
   * Set the content of the read-only SPARQL editor.
   * @param {string} text - The text to set.
   */
  setSparqlEditorValue(text) {
    this.querySparqlEditor.dispatch({
      changes: { from: 0, to: this.querySparqlEditor.state.doc.length, insert: text }
    });
  }

  /**
   * Handle query click event.
   * This method is triggered when a query is clicked in the accordion.
   * It fetches the SPARQL query file and displays its content in the query editor.
   * @param {Event} event - The click event.
   * @async
   */
  async onQueryClick(event) {
    // Use .closest() so clicks on the icon or the <span> inside the
    // list item still resolve to the <li>. .matches('.list-group-item')
    // on its own fails because event.target is whichever inner node
    // the user actually clicked on.
    const item = event.target.closest('.list-group-item');
    if (!item) return;

    const selectedQuery = this.queries.find(query => query.title === item.dataset.queryTitle);

    if (!selectedQuery) {
      this.queryTitle.textContent = 'Query Title';
      this.queryDescription.textContent = 'Select a query to see its description.';
      this.setSparqlEditorValue('SPARQL query will be displayed here.');
      this.tryQueryButton.disabled = true;
      if (this.customiseQueryButton) this.customiseQueryButton.disabled = true;
      this.queryCard.classList.add('d-none');
      this.selectQueryMessage.classList.remove('d-none');
      return;
    }

    // Fetch the .sparql file. A failed fetch (offline, 404, CORS) used
    // to bubble out of this async handler as an unhandled rejection,
    // leaving the editor with stale content and the user with no
    // feedback. Now we surface via a toast and leave the previously-
    // selected query untouched so the user can retry.
    let querySparqlText;
    try {
      const response = await fetch(`${this.remoteQueriesUrl}${selectedQuery.sparql}`);
      if (!response.ok) {
        throw new Error(`HTTP error. Status: ${response.status}`);
      }
      querySparqlText = await response.text();
    } catch (err) {
      console.error('Failed to load query file:', err);
      showToast(
        'Could not load query',
        'The query file could not be fetched. Please check your connection and try again.',
        { variant: 'danger' },
      );
      return;
    }

    this.queryTitle.textContent = selectedQuery.title;
    this.queryDescription.textContent = selectedQuery.description;
    this.setSparqlEditorValue(querySparqlText);
    this.tryQueryButton.disabled = false;
    if (this.customiseQueryButton) this.customiseQueryButton.disabled = false;
    this.queryCard.classList.remove('d-none');
    this.selectQueryMessage.classList.add('d-none');

    if (this.selectedQueryElement) {
      this.selectedQueryElement.classList.remove('active');
    }
    item.classList.add('active');
    this.selectedQueryElement = item;
  }

  /**
   * Handle "Try this query" click: load the query into the editor
   * and immediately run it. The user lands on the Reuse tab (via
   * QueryEditor's auto-routing) without a detour through the
   * Customize tab — this is for users who want to see the result,
   * not to modify the query. Customise is the separate path for
   * editing.
   */
  onTryQuery() {
    const queryText = this.querySparqlEditor.state.doc.toString();
    this.queryEditor.setValue(queryText);
    // Submit the form programmatically. QueryEditor.onSubmit takes
    // care of everything: syntax check, POST, auto-route to either
    // the SELECT lane (`#query-results`) or the graph lane
    // (`#app-tab-explorer`) of the Reuse tab.
    document.getElementById('query-form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  }

  /**
   * Handle "Customise" click: load the query into the editor and
   * switch to the Editor tab so the user can edit it before running.
   * This is the old Try-this-query behaviour, now a separate path.
   */
  onCustomise() {
    const queryText = this.querySparqlEditor.state.doc.toString();
    this.queryEditor.setValue(queryText);
    const queryEditorTab = new bootstrap.Tab(document.getElementById('query-editor-tab'));
    queryEditorTab.show();
  }
}
