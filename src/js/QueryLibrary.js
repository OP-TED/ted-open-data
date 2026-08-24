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
        ensureSyntaxTree, syntaxTree,
        sparql} from '../vendor/codemirror-bundle.js';
import {eclipseTheme, eclipseHighlightStyle} from './utils/cmTheme.js';
import { showToast } from './utils/toast.js';
import { copyToClipboard } from './utils/clipboardCopy.js';
import { queryParameters } from './utils/queryParameters.js';
import { rangeEnds, rangeWording, parameterRanges } from './utils/parameterRanges.js';
import { fillQuery, controlKind, compareValues, valueProblem } from './utils/parameterValues.js';

/**
 * How long the parser may run to read a query through to its end. A library
 * query is a few kilobytes and parses in single-digit milliseconds; this is
 * the ceiling for one that does not.
 */
const PARSE_BUDGET_MS = 5000;

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
    this.parametersFields = document.getElementById('query-parameters-fields');
    this.parametersModal = document.getElementById('query-parameters-modal');
    this.parametersRunButton = document.getElementById('query-parameters-run');
    this.parametersError = document.getElementById('query-parameters-error');
    this.selectedQueryElement = null;
    this.queries = [];
    /** The selected query, exactly as published. */
    this.currentQueryText = '';
    /** Its parameters, whose slots index into that text. */
    this.currentParams = [];
    /** Which slot each form control fills. Rebuilt with the form. */
    this.slotOf = new Map();

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

    this.parametersRunButton?.addEventListener('click', () => this._runWithFormValues());
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
      const response = await fetch(`${this.remoteQueriesUrl}web-library.yaml`);
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
      // source YAML is trusted (OP-TED/ted-open-data-examples), but defence
      // in depth is cheap here and prevents future supply-chain or typo issues.
      let categoryCounter = 0;
      categories.forEach((queries, category) => {
        const categoryId = `category-${categoryCounter++}`;

        const categoryItem = document.createElement('div');
        categoryItem.className = 'accordion-item';

        const header = document.createElement('h2');
        header.className = 'ted-accordion-header';
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
    this._readParameters(querySparqlText);
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
    // A query offering values to change asks for them first. One that
    // offers none runs straight away, as it always has.
    if (this.currentParams.length > 0) {
      this._askForParameters();
      return;
    }
    this._runQuery(this.currentQueryText);
  }

  /**
   * Offer the query's values for changing, then run it.
   * @private
   */
  _askForParameters() {
    this.parametersFields.replaceChildren();
    this.slotOf.clear();
    this.currentParams.forEach((parameter, index) => {
      this.parametersFields.appendChild(this._parameterField(parameter, index));
    });

    this._clearParameterError();

    const modal = bootstrap.Modal.getOrCreateInstance(this.parametersModal);
    // Enter runs the query, so re-running with the same values costs one
    // keystroke rather than a form to fill.
    this.parametersModal.addEventListener('shown.bs.modal', () => {
      this.parametersRunButton.focus();
    }, { once: true });
    modal.show();
  }

  /**
   * Run the query the dialog was opened for, with the values it collected.
   * @private
   */
  _runWithFormValues() {
    const problems = this._parameterProblems();
    if (problems.length > 0) {
      this._showParameterProblems(problems);
      return;
    }
    const queryText = this._getQueryWithInjectedParams();
    bootstrap.Modal.getOrCreateInstance(this.parametersModal).hide();
    this._runQuery(queryText);
  }

  /**
   * What is wrong with the values as they stand, if anything.
   *
   * Two things are worth refusing. A value the query needs and does not
   * have makes a query that cannot run — an empty date is not a date, and
   * an empty number is not even SPARQL. And a range the wrong way round
   * describes an empty period: the query runs, matches nothing, and
   * returns a result that reads as an answer.
   *
   * Nothing else is judged. Where two values cannot be ordered soundly no
   * order is asserted, and a value that is merely surprising is the
   * reader's business.
   *
   * @returns {Array<{message: string, inputs: HTMLInputElement[]}>}
   * @private
   */
  _parameterProblems() {
    const problems = [];

    // A value the query cannot do without, or one it cannot be written
    // with. A checkbox has only the two values its slot allows.
    for (const [input, slot] of this.slotOf) {
      if (input.type === 'checkbox') continue;
      const problem = valueProblem(slot, input.value);
      if (problem) problems.push({ message: `${this._nameOf(input)} ${problem}`, inputs: [input] });
    }
    if (problems.length > 0) return problems;

    for (const range of parameterRanges(this.currentParams)) {
      const lower = this._inputFor(range.lower);
      const upper = this._inputFor(range.upper);
      if (!lower || !upper) continue;

      const order = compareValues(range.lower.kind, lower.value, upper.value);
      if (order === null) continue;
      // Both ends belong to one named group, so the group is what the
      // message names. Naming each end instead repeats the whole label
      // twice in a sentence that then reads as broken English.
      if (order === 1) {
        problems.push({
          message: `${this._rangeNameOf(lower)}: the two ends are the wrong way round.`,
          inputs: [lower, upper],
        });
      } else if (order === 0 && range.strict) {
        // `>` or `<` at either end leaves nothing between two equal values.
        problems.push({
          message: `${this._rangeNameOf(lower)}: both ends are the same, and this query excludes that value.`,
          inputs: [lower, upper],
        });
      }
    }
    return problems;
  }

  /** The control filling a given slot. @private */
  _inputFor(slot) {
    for (const [input, candidate] of this.slotOf) if (candidate === slot) return input;
    return null;
  }

  /** What the group of controls a range fills is called. @private */
  _rangeNameOf(input) {
    const legend = input.closest('fieldset')?.querySelector('legend');
    return legend?.textContent.trim() || this._nameOf(input);
  }

  /** What a control is called, as the reader sees it. @private */
  _nameOf(input) {
    const labelled = input.id && document.querySelector(`label[for="${input.id}"]`);
    return input.getAttribute('aria-label') || labelled?.textContent.trim() || 'This value';
  }

  /**
   * Say what is wrong, and mark it.
   * @private
   */
  _showParameterProblems(problems) {
    for (const { inputs } of problems) inputs.forEach(i => i.classList.add('is-invalid'));
    this.parametersError.textContent = problems.length === 1
      ? problems[0].message
      : problems.map(p => p.message).join(' ');
    this.parametersError.classList.remove('d-none');
    problems[0].inputs[0].focus();
  }

  /**
   * Take the error down once the reader changes anything.
   * @private
   */
  _clearParameterError() {
    if (this.parametersError.classList.contains('d-none')) return;
    this.parametersError.classList.add('d-none');
    for (const input of this.slotOf.keys()) input.classList.remove('is-invalid');
  }

  /**
   * Put a query into the editor and run it.
   * @param {string} queryText
   * @private
   */
  _runQuery(queryText) {
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
    this.queryEditor.setValue(this.currentQueryText);
    const queryEditorTab = new bootstrap.Tab(document.getElementById('query-editor-tab'));
    queryEditorTab.show();
  }
  /**
   * Read what the selected query offers to have changed.
   *
   * The query itself says: a variable annotated in a comment, and the
   * literal it is compared to or bound to. Nothing is declared anywhere
   * else, so there is no second copy of the query to fall out of step with
   * the published one.
   *
   * Nothing is shown here. The values are asked for at the moment of
   * running, where they are about to matter, so a query that declares none
   * changes nothing about the page.
   *
   * @param {string} queryText - The query, exactly as published.
   * @private
   */
  _readParameters(queryText) {
    this.currentParams = this._parametersIn(queryText);
  }

  /**
   * The parameters a query declares.
   *
   * Parsed here rather than in the preview editor, whose text is replaced
   * with the filled query as the form is used; the slots have to keep
   * pointing into the query as published.
   *
   * @param {string} queryText
   * @returns {import('./utils/queryParameters.js').QueryParameter[]}
   * @private
   */
  _parametersIn(queryText) {
    const state = EditorState.create({ doc: queryText, extensions: [sparql()] });
    const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS)
      || syntaxTree(state);
    return queryParameters(tree, state.doc);
  }

  /**
   * One labelled control per parameter.
   *
   * A parameter filling two ends of a range gets one label and two inputs,
   * marked "from" and "to" — which end each is comes from the comparison
   * in the query, not from anything the author had to write.
   *
   * @param {import('./utils/queryParameters.js').QueryParameter} parameter
   * @param {number} index
   * @returns {HTMLElement}
   * @private
   */
  _parameterField(parameter, index) {
    const ends = rangeEnds(parameter);
    const title = ends ? `${parameter.label} range` : parameter.label;

    // A range is a group of controls under one name, which is what a
    // fieldset is for: a screen reader announces the name with each of
    // them. A single value needs only its own label.
    const group = document.createElement(ends ? 'fieldset' : 'div');
    group.className = 'col-12';

    const heading = document.createElement(ends ? 'legend' : 'label');
    heading.className = 'form-label small mb-1';
    heading.textContent = title;
    group.appendChild(heading);

    const inputs = document.createElement('div');
    inputs.className = 'd-flex align-items-center flex-wrap gap-2';
    const word = (text) => {
      const span = document.createElement('span');
      span.className = 'small text-body-secondary';
      span.textContent = text;
      inputs.appendChild(span);
    };

    if (ends) {
      const [from, to] = ends;
      const { opening, joining } = rangeWording(from, to);
      // The two ends need names of their own: the legend alone would give
      // both controls the same one.
      word(opening);
      inputs.appendChild(this._parameterInput(from, `query-param-${index}-0`, `${title}, from`));
      word(joining);
      inputs.appendChild(this._parameterInput(to, `query-param-${index}-1`, `${title}, to`));
    } else if (parameter.slots.length === 1) {
      const id = `query-param-${index}-0`;
      heading.setAttribute('for', id);
      inputs.appendChild(this._parameterInput(parameter.slots[0], id, title, { hasOwnLabel: true }));
    } else {
      // Several values with nothing to tell them apart: numbered, and each
      // named after its place.
      parameter.slots.forEach((slot, position) => {
        word(`${position + 1}:`);
        inputs.appendChild(
          this._parameterInput(slot, `query-param-${index}-${position}`, `${title}, ${position + 1}`));
      });
    }

    group.appendChild(inputs);
    return group;
  }

  /**
   * The control a slot asks for, carrying the value already in the query.
   *
   * @param {import('./utils/queryParameters.js').ParameterSlot} slot
   * @param {string} id
   * @param {string} label
   * @returns {HTMLInputElement}
   * @private
   */
  _parameterInput(slot, id, name, { hasOwnLabel = false } = {}) {
    const input = document.createElement('input');
    input.className = 'form-control form-control-sm';
    input.id = id;
    input.value = slot.value;
    // A control inside a range or a numbered list has no <label> of its
    // own, so it is named here. One that has a label needs no second name.
    if (!hasOwnLabel) input.setAttribute('aria-label', name);

    switch (controlKind(slot)) {
      case 'date':
        input.type = 'date';
        break;
      case 'dateTime':
      case 'time':
        input.type = slot.kind === 'time' ? 'time' : 'datetime-local';
        // Seconds are part of an xsd:dateTime and an xsd:time. Without
        // this the control rounds them off and hides them.
        input.step = '1';
        break;
      case 'number':
        input.type = 'number';
        break;
      case 'boolean':
        input.type = 'checkbox';
        input.className = 'form-check-input';
        input.checked = slot.value === 'true';
        break;
      default:
        input.type = 'text';
        input.placeholder = name;
    }

    // controlKind says which values a control should be able to hold; the
    // browser decides whether it actually will, and a rejected value is
    // cleared. Asking it directly catches whatever the patterns misjudge,
    // here or in a browser they were never measured against. A value the
    // control merely rewrites — seconds dropped from a round time — is not
    // rejected, and is restored when the query is filled.
    if (input.type !== 'checkbox' && input.value === '' && slot.value !== '') {
      input.type = 'text';
      input.removeAttribute('step');
      input.className = 'form-control form-control-sm';
      input.value = slot.value;
      input.placeholder = name;
    }

    this.slotOf.set(input, slot);
    input.addEventListener('input', () => this._clearParameterError());
    return input;
  }

  /**
   * The value each slot should take, read from the form.
   *
   * @returns {Map<import('./utils/queryParameters.js').ParameterSlot, string>}
   * @private
   */
  _collectFormValues() {
    const values = new Map();
    for (const [input, slot] of this.slotOf) {
      values.set(slot, input.type === 'checkbox' ? String(input.checked) : input.value);
    }
    return values;
  }

  /**
   * The query with the form's values in place of its own.
   * @returns {string}
   * @private
   */
  _getQueryWithInjectedParams() {
    if (this.currentParams.length === 0) return this.currentQueryText;
    return fillQuery(this.currentQueryText, this.currentParams, this._collectFormValues());
  }
}
