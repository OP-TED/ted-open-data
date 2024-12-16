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
import yaml from 'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm';

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
    this.queryAccordion = document.getElementById('queryAccordion');
    this.selectQueryMessage = document.getElementById('selectQueryMessage');
    this.queryCard = document.getElementById('queryCard');
    this.queryTitle = document.getElementById('queryTitle');
    this.queryDescription = document.getElementById('queryDescription');
    this.querySparqlEditor = CodeMirror.fromTextArea(document.getElementById("querySparql"), {
      mode: "sparql",
      theme: "eclipse",
      lineNumbers: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      lineWrapping: true,
      readOnly: true,
      viewportMargin: Infinity
    });
    this.tryQueryButton = document.getElementById('tryQueryButton');
    this.selectedQueryElement = null;
    this.queries = [];

    this.initEventListeners();
    this.loadQueries();
  }

  /**
   * Initialize event listeners.
   * Sets up event listeners for the query accordion and the try query button.
   */
  initEventListeners() {
    this.queryAccordion.addEventListener('click', this.onQueryClick.bind(this));
    this.tryQueryButton.addEventListener('click', this.onTryQuery.bind(this));
  }

  /**
   * Load queries from the remote URL.
   * This method fetches a YAML file containing SPARQL queries from the specified remote URL.
   * The queries are categorized and displayed in an accordion format.
   * @async
   */
  async loadQueries() {
    try {
      // Fetch the YAML file containing the queries
      const response = await fetch(`${this.remoteQueriesUrl}index.yaml`);
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

      // Create accordion items for each category and populate with queries
      categories.forEach((queries, category) => {
        const categoryId = `category-${category.replace(/\s+/g, '-')}`;
        const categoryItem = document.createElement('div');
        categoryItem.className = 'accordion-item';

        categoryItem.innerHTML = `
          <h2 class="accordion-header" id="${categoryId}-header">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${categoryId}" aria-expanded="false" aria-controls="${categoryId}">
              ${category}
            </button>
          </h2>
          <div id="${categoryId}" class="accordion-collapse collapse" aria-labelledby="${categoryId}-header" data-bs-parent="#queryAccordion">
            <div class="accordion-body p-0">
              <ul class="list-group list-group-flush">
                ${queries.map(query => `
                  <li class="list-group-item list-group-item-action" data-query-title="${query.title}" data-query-file="${query.sparql}">
                    ${query.title}
                  </li>
                `).join('')}
              </ul>
            </div>
          </div>
        `;

        this.queryAccordion.appendChild(categoryItem);
      });

      this.queries = data.queries;
    } catch (error) {
      console.error('Failed to load queries:', error);
    }
  }

  /**
   * Handle query click event.
   * This method is triggered when a query is clicked in the accordion.
   * It fetches the SPARQL query file and displays its content in the query editor.
   * @param {Event} event - The click event.
   * @async
   */
  async onQueryClick(event) {
    if (event.target.matches('.list-group-item')) {
      const selectedQuery = this.queries.find(query => query.title === event.target.dataset.queryTitle);

      if (selectedQuery) {
        const queryFileResponse = await fetch(`${this.remoteQueriesUrl}${selectedQuery.sparql}`);
        const querySparqlText = await queryFileResponse.text();

        this.queryTitle.textContent = selectedQuery.title;
        this.queryDescription.textContent = selectedQuery.description;
        this.querySparqlEditor.setValue(querySparqlText);
        setTimeout(() => this.querySparqlEditor.refresh(), 0);
        this.tryQueryButton.disabled = false;
        this.queryCard.classList.remove('d-none');
        this.selectQueryMessage.classList.add('d-none');

        if (this.selectedQueryElement) {
          this.selectedQueryElement.classList.remove('active');
        }
        event.target.classList.add('active');
        this.selectedQueryElement = event.target;
      } else {
        this.queryTitle.textContent = 'Query Title';
        this.queryDescription.textContent = 'Select a query to see its description.';
        this.querySparqlEditor.setValue('SPARQL query will be displayed here.');
        setTimeout(() => this.querySparqlEditor.refresh(), 0);
        this.tryQueryButton.disabled = true;
        this.queryCard.classList.add('d-none');
        this.selectQueryMessage.classList.remove('d-none');
      }
    }
  }

  /**
   * Handle try query button click event.
   * This method is triggered when the "Try this query" button is clicked.
   * It sets the selected query in the main query editor and switches to the query editor tab.
   */
  onTryQuery() {
    const queryText = this.querySparqlEditor.getValue();
    this.queryEditor.editor.setValue(queryText);
    const queryEditorTab = new bootstrap.Tab(document.getElementById('query-editor-tab'));
    queryEditorTab.show();
  }
}
