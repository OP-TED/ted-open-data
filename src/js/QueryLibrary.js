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
import { copyToClipboard } from './utils/clipboardCopy.js';
import { fillTemplate, isValidDate, isValidMonth, isValidYear } from './utils/queryParameters.js';

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
    this.tryQueryButtonBottom = document.querySelector('#query-action-buttons-bottom .query-try-btn');
    this.customiseQueryButtonBottom = document.querySelector('#query-action-buttons-bottom .query-customise-btn');
    this.bottomButtons = document.getElementById('query-action-buttons-bottom');
    this.parametersForm = document.getElementById('query-parameters-form');
    this.parametersFields = document.getElementById('query-parameters-fields');
    this.toggleSparqlButton = document.getElementById('toggle-sparql-button');
    this.sparqlWrapper = document.getElementById('query-sparql-wrapper');
    this.selectedQueryElement = null;
    this.queries = [];
    this.currentParams = [];
    this.currentQueryText = '';
    this.currentTemplate = null;
    this.queryParametersData = null;

    this.initEventListeners();
    this.loadQueries();
    this._loadParametersData();
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
    this.tryQueryButtonBottom?.addEventListener('click', this.onTryQuery.bind(this));
    this.customiseQueryButtonBottom?.addEventListener('click', this.onCustomise.bind(this));

    const copySparqlBtn = document.getElementById('copy-sparql-button');
    if (copySparqlBtn) {
      copySparqlBtn.addEventListener('click', async () => {
        const text = this.querySparqlEditor.state.doc.toString();
        const ok = await copyToClipboard(text);
        copySparqlBtn.innerHTML = ok ? '<i class="bi bi-check"></i> Copied' : '<i class="bi bi-x"></i> Failed';
        setTimeout(() => {
          copySparqlBtn.innerHTML = '<i class="bi bi-clipboard"></i> Copy';
        }, 2000);
      });
    }

    // Toggle SPARQL query visibility
    if (this.toggleSparqlButton) {
      this.toggleSparqlButton.addEventListener('click', () => {
        const isHidden = this.sparqlWrapper.classList.toggle('d-none');
        this.bottomButtons.classList.toggle('d-none', isHidden);
        this.toggleSparqlButton.setAttribute('aria-expanded', String(!isHidden));
        this.toggleSparqlButton.innerHTML = isHidden
          ? '<i class="bi bi-eye"></i> Show query'
          : '<i class="bi bi-eye-slash"></i> Hide query';
      });
    }
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

        const isFirst = categoryCounter === 1;
        const headerButton = document.createElement('button');
        headerButton.className = isFirst ? 'accordion-button' : 'accordion-button collapsed';
        headerButton.type = 'button';
        headerButton.setAttribute('data-bs-toggle', 'collapse');
        headerButton.setAttribute('data-bs-target', `#${categoryId}`);
        headerButton.setAttribute('aria-expanded', isFirst ? 'true' : 'false');
        headerButton.setAttribute('aria-controls', categoryId);
        headerButton.textContent = category;
        header.appendChild(headerButton);

        const collapse = document.createElement('div');
        collapse.id = categoryId;
        collapse.className = isFirst ? 'accordion-collapse collapse show' : 'accordion-collapse collapse';
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
      if (this.tryQueryButtonBottom) this.tryQueryButtonBottom.disabled = true;
      if (this.customiseQueryButtonBottom) this.customiseQueryButtonBottom.disabled = true;
      this.queryCard.classList.add('d-none');
      this.queryTitle.classList.add('d-none');
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
    this.currentQueryText = querySparqlText;
    this._renderParameterForm(selectedQuery.sparql);
    const queryRunning = this.queryEditor.isQueryRunning;
    this.tryQueryButton.disabled = queryRunning;
    if (this.customiseQueryButton) this.customiseQueryButton.disabled = queryRunning;
    if (this.tryQueryButtonBottom) this.tryQueryButtonBottom.disabled = queryRunning;
    if (this.customiseQueryButtonBottom) this.customiseQueryButtonBottom.disabled = queryRunning;
    this.queryCard.classList.remove('d-none');
    this.queryTitle.classList.remove('d-none');
    this.selectQueryMessage.classList.add('d-none');

    if (this.selectedQueryElement) {
      this.selectedQueryElement.classList.remove('active');
    }
    item.classList.add('active');
    this.selectedQueryElement = item;
  }

  /**
   * Handle "Try this query" click: load the query into the editor
   * and immediately run it. If the query has parameters, inject the
   * form values before execution. The user lands on the Reuse tab
   * (via QueryEditor's auto-routing) without a detour through the
   * Customize tab.
   */
  onTryQuery() {
    if (!this._validateParams()) return;
    const queryText = this._getQueryWithInjectedParams();
    this.queryEditor.setValue(queryText);
    document.getElementById('query-form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  }

  /**
   * Handle "Customise" click: load the query (with injected params)
   * into the editor and switch to the Editor tab so the user can
   * edit it before running.
   */
  onCustomise() {
    if (!this._validateParams()) return;
    const queryText = this._getQueryWithInjectedParams();
    this.queryEditor.setValue(queryText);
    const queryEditorTab = new bootstrap.Tab(document.getElementById('query-editor-tab'));
    queryEditorTab.show();
  }

  /**
   * Validate all parameter form inputs. Marks invalid fields with
   * a red border and shows feedback text. Shows a toast if any
   * field fails validation.
   * @returns {boolean} true if all valid, false if any invalid.
   * @private
   */
  _validateParams() {
    if (this.currentParams.length === 0) return true;

    let allValid = true;

    for (let i = 0; i < this.currentParams.length; i++) {
      const param = this.currentParams[i];
      const input = document.getElementById(`query-param-${i}`);
      if (!input) continue;

      let valid;
      if (param.type === 'date' || param.type === 'date-raw') {
        valid = isValidDate(input.value);
      } else if (param.type === 'month-start' || param.type === 'month-end') {
        valid = isValidMonth(input.value);
      } else if (param.type === 'year-start' || param.type === 'year-end') {
        valid = isValidYear(input.value);
      } else {
        valid = input.value.trim().length > 0;
      }

      if (!valid) {
        input.classList.add('is-invalid');
        allValid = false;
      } else {
        input.classList.remove('is-invalid');
      }
    }

    if (!allValid) {
      showToast(
        'Invalid parameters',
        'Please correct the highlighted fields before running the query.',
        { variant: 'danger' },
      );
    }

    return allValid;
  }

  /**
   * Load the declared query parameters from the local JSON file.
   * Called once at construction. If the file fails to load, the form
   * simply won't appear (graceful degradation).
   * @private
   */
  async _loadParametersData() {
    try {
      const response = await fetch('src/assets/query-parameters.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.queryParametersData = await response.json();
    } catch (err) {
      console.warn('[QueryLibrary] Could not load query-parameters.json:', err);
      this.queryParametersData = {};
    }
  }

  /**
   * Render date parameter input fields for the selected query.
   * Looks up declared parameters from query-parameters.json by filename.
   * If the query has declared parameters, shows a form with date pickers
   * pre-filled with default values. Otherwise hides the form.
   * @param {string} sparqlFilename - The .sparql filename (e.g. "notices-per-period.sparql")
   * @private
   */
  _renderParameterForm(sparqlFilename) {
    const entry = this.queryParametersData?.[sparqlFilename];
    this.currentParams = entry?.parameters || [];
    this.currentTemplate = entry?.template || null;

    // Always hide the SPARQL by default — user can reveal via toggle
    this.sparqlWrapper.classList.add('d-none');
    this.bottomButtons.classList.add('d-none');
    this.toggleSparqlButton.setAttribute('aria-expanded', 'false');
    this.toggleSparqlButton.innerHTML = '<i class="bi bi-eye"></i> Show query';

    if (this.currentParams.length === 0 || !this.currentTemplate) {
      this.parametersForm.classList.add('d-none');
      return;
    }

    // Show the parameter form
    this.parametersForm.classList.remove('d-none');

    // Show preview with defaults filled in
    this._updatePreview();

    // Clear existing fields
    this.parametersFields.replaceChildren();

    // Create a date input for each parameter
    for (let i = 0; i < this.currentParams.length; i++) {
      const param = this.currentParams[i];
      const col = document.createElement('div');
      col.className = 'col-auto';

      const label = document.createElement('label');
      label.className = 'form-label small mb-1';
      label.setAttribute('for', `query-param-${i}`);
      label.textContent = param.label;

      const input = document.createElement('input');
      input.className = 'form-control form-control-sm';
      input.id = `query-param-${i}`;
      input.dataset.paramIndex = i;

      if (param.type === 'date' || param.type === 'date-raw') {
        input.type = 'date';
        input.value = param.default;
      } else if (param.type === 'month-start' || param.type === 'month-end') {
        input.type = 'month';
        input.value = param.default;
      } else if (param.type === 'year-start' || param.type === 'year-end') {
        input.type = 'number';
        input.min = '2015';
        input.max = '2035';
        input.value = param.default;
        input.style.maxWidth = '100px';
      } else {
        input.type = 'text';
        input.value = param.default;
        input.placeholder = param.label;
      }

      // Validation feedback message (hidden by default)
      const feedback = document.createElement('div');
      feedback.className = 'invalid-feedback';
      if (param.type === 'date' || param.type === 'date-raw') {
        feedback.textContent = 'Please enter a valid date';
      } else if (param.type === 'month-start' || param.type === 'month-end') {
        feedback.textContent = 'Please select a valid month';
      } else if (param.type === 'year-start' || param.type === 'year-end') {
        feedback.textContent = 'Please enter a valid year';
      } else {
        feedback.textContent = 'This field is required';
      }

      // Clear validation error on input change and update preview
      input.addEventListener('input', () => {
        input.classList.remove('is-invalid');
        this._updatePreview();
      });

      col.appendChild(label);
      col.appendChild(input);
      col.appendChild(feedback);
      this.parametersFields.appendChild(col);
    }
  }

  /**
   * Collect current values from the parameter form inputs.
   * @returns {Array<string>}
   * @private
   */
  _collectFormValues() {
    const values = [];
    for (let i = 0; i < this.currentParams.length; i++) {
      const input = document.getElementById(`query-param-${i}`);
      values.push(input ? input.value : this.currentParams[i].default);
    }
    return values;
  }

  /**
   * Update the read-only SPARQL editor preview with current form values
   * filled into the template. Shows valid SPARQL at all times (falls back
   * to defaults for invalid inputs).
   * @private
   */
  _updatePreview() {
    if (!this.currentTemplate || this.currentParams.length === 0) return;
    const values = this._collectFormValues();
    const filled = fillTemplate(this.currentTemplate, this.currentParams, values);
    this.setSparqlEditorValue(filled);
  }

  /**
   * Get the final query with user values filled into the template.
   * If no parameters exist, returns the raw query text from the editor.
   * Also updates the SPARQL preview to show the filled query.
   * @returns {string}
   * @private
   */
  _getQueryWithInjectedParams() {
    if (this.currentParams.length === 0) {
      return this.querySparqlEditor.state.doc.toString();
    }

    const values = this._collectFormValues();
    return fillTemplate(this.currentTemplate, this.currentParams, values);
  }
}
