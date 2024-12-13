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
import yaml from 'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm';

// Production SPARQL endpoint
const SPARQL_ENDPOINT = 'https://publications.europa.eu/webapi/rdf/sparql';
let sparqlEndpoint;

// Detect if we're running locally
const hostname = window.location.hostname;
const isDevelopment = hostname === 'localhost' || hostname === '127.0.0.1';

document.addEventListener('DOMContentLoaded', async function () {
  // Set endpoint (with proxy if running locally)
  sparqlEndpoint = isDevelopment 
    ? `http://localhost:8080/proxy?url=${encodeURIComponent(SPARQL_ENDPOINT)}`
    : SPARQL_ENDPOINT;

  // Get references to elements
  const queryTextarea = document.getElementById('query');
  const runQueryButton = document.getElementById('runQueryButton');
  const queryForm = document.getElementById('queryForm');
  const queryResultsTab = new bootstrap.Tab(document.getElementById('query-results-tab'));
  const startTourButton = document.getElementById('start-tour');
  const tryQueryLibraryButton = document.getElementById('try-query-library');
  const queryEditorTab = new bootstrap.Tab(document.getElementById('query-editor-tab'));
  const queryLibraryTab = new bootstrap.Tab(document.getElementById('query-library-tab'));
  const copyUrlButton = document.getElementById('copy-url-button');
  const copyUrlAlert = document.getElementById('copy-url-alert');
  const openUrlButton = document.getElementById('open-url-button');
  const resultsDiv = document.getElementById("results");
  const queryAccordion = document.getElementById('queryAccordion');
  const selectQueryMessage = document.getElementById('selectQueryMessage');
  const queryCard = document.getElementById('queryCard');
  const queryTitle = document.getElementById('queryTitle');
  const queryDescription = document.getElementById('queryDescription');
  const querySparql = document.getElementById('querySparql');
  const tryQueryButton = document.getElementById('tryQueryButton');

  // Remove environment selector if it exists
  const envSelector = document.querySelector('#cellarEnvironment');
  if (envSelector) {
    const container = envSelector.closest('.form-floating');
    if (container) {
      container.remove();
    }
  }

  // Add event listener for textarea changes
  queryTextarea.addEventListener('input', function() {
    runQueryButton.disabled = !this.value.trim();
  });

  // Event listeners
  startTourButton.addEventListener('click', function () {
    console.log('Write your query button clicked'); // Debugging log
    queryEditorTab.show();
  });

  tryQueryLibraryButton.addEventListener('click', function () {
    console.log('Try our query library button clicked'); // Debugging log
    queryLibraryTab.show();
  });

  // Add event listener for "Try this query" button
  tryQueryButton.addEventListener('click', function () {
    const queryText = querySparqlEditor.getValue();
    editor.setValue(queryText);
    queryEditorTab.show();
  });

  // Initialize CodeMirror
  const editor = CodeMirror.fromTextArea(document.getElementById("query"), {
    mode: "sparql",
    theme: "eclipse",
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    lineWrapping: true,
    extraKeys: {"Ctrl-Space": "autocomplete"},
    placeholder: "Enter your SPARQL query here..."
  });

  // Initialize CodeMirror for the query library display
  const querySparqlEditor = CodeMirror.fromTextArea(document.getElementById("querySparql"), {
    mode: "sparql",
    theme: "eclipse",
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    lineWrapping: true,
    readOnly: true,
    viewportMargin: Infinity // Ensure the editor adjusts its height to fit the content
  });

  let errorMarker = null; // Variable to store the error marker

  // Add this function to minify SPARQL queries using sparqljs
  function minifySparqlQuery(query) {
    const parser = new SparqlJs.Parser();
    const generator = new SparqlJs.Generator();
    const parsedQuery = parser.parse(query);
    return generator.stringify(parsedQuery);
  }

  // Add this function to check SPARQL syntax using sparqljs
  function checkSparqlSyntax(query) {
    const parser = new SparqlJs.Parser();
    try {
      parser.parse(query);
      return null; // No errors
    } catch (error) {
      return error; // Return error object
    }
  }

  // Update button state on editor changes
  function onEditorChange() {
    const query = editor.getValue();
    const error = checkSparqlSyntax(query);

    if (error) {
      // Log the error object to inspect its structure
      console.log('SPARQL Syntax Error:', error);

      // Clear previous error marker
      if (errorMarker) {
        errorMarker.clear();
      }

      // Highlight the error position in the editor if location is available
      if (error.hash && error.hash.loc && error.hash.loc.first_line && error.hash.loc.last_line) {
        const start = error.hash.loc;
        errorMarker = editor.markText(
          { line: start.first_line - 1, ch: start.first_column },
          { line: start.last_line - 1, ch: start.last_column },
          { className: 'syntax-error-highlight', title: `${error.message}` }
        );
        addTooltipToMarker(errorMarker, `${error.message}`);
      } else if (error.hash && error.hash.loc && error.hash.loc.first_line) {
        const start = error.hash.loc;
        errorMarker = editor.markText(
          { line: start.first_line - 1, ch: 0 },
          { line: start.first_line - 1, ch: editor.getLine(start.first_line - 1).length },
          { className: 'syntax-error-highlight', title: `${error.message}` }
        );
        addTooltipToMarker(errorMarker, `${error.message}`);
      }
      runQueryButton.disabled = true; // Disable the button if there's a syntax error
    } else {
      // Clear previous error marker
      if (errorMarker) {
        errorMarker.clear();
        errorMarker = null;
      }
      runQueryButton.disabled = !query.trim(); // Enable the button only if the query is not empty
    }
  }

  function addTooltipToMarker(marker, message) {
    const markerElements = marker.replacedWith || [marker];
    markerElements.forEach((element) => {
      const from = element.from || marker.from;
      const to = element.to || marker.to;
      if (from && to) {
        const lineHandle = editor.getLineHandle(from.line);
        const lineElement = editor.getWrapperElement().querySelector(`.CodeMirror-line:nth-child(${from.line + 1})`);

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

  editor.on("change", onEditorChange);

  // Update copyUrlButton click handler
  copyUrlButton.addEventListener('click', function () {
    const query = editor.getValue();
    const minifiedQuery = minifySparqlQuery(query);
    const format = document.getElementById("format").value || "application/sparql-results+json";
    const defaultGraphUri = document.getElementById("default-graph-uri").value;
    const timeout = document.getElementById("timeout").value || 30000;

    // Use the original SPARQL endpoint URL
    const url = `${SPARQL_ENDPOINT}?default-graph-uri=${encodeURIComponent(defaultGraphUri)}&query=${encodeURIComponent(minifiedQuery)}&format=${encodeURIComponent(format)}&timeout=${encodeURIComponent(timeout)}`;
    
    console.log(`Generated URL: ${url}`);
    navigator.clipboard.writeText(url).then(() => {
      const toast = new bootstrap.Toast(document.getElementById('copyUrlToast'));
      toast.show();
    }).catch(err => {
      console.error('Failed to copy URL:', err);
    });
  });

  // Update openUrlButton click handler
  openUrlButton.addEventListener('click', function () {
    const query = editor.getValue();
    const minifiedQuery = minifySparqlQuery(query);
    const format = document.getElementById("format").value || "application/sparql-results+json";
    const defaultGraphUri = document.getElementById("default-graph-uri").value;
    const timeout = document.getElementById("timeout").value || 30000;

    // Use the original SPARQL endpoint URL
    const url = `${SPARQL_ENDPOINT}?default-graph-uri=${encodeURIComponent(defaultGraphUri)}&query=${encodeURIComponent(minifiedQuery)}&format=${encodeURIComponent(format)}&timeout=${encodeURIComponent(timeout)}`;
    
    window.open(url, '_blank');
  });

  queryForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    
    // Show progress bar and disable Run Query button
    const progressBar = document.querySelector('.progress-bar');
    const submitButton = this.querySelector('button[type="submit"]');
    progressBar.style.width = '100%';
    progressBar.classList.add('progress-bar-striped', 'progress-bar-animated');
    submitButton.disabled = true;
    
    try {
      // Get query from CodeMirror instead of textarea
      const query = editor.getValue();
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
      console.log(`Sending request to: ${sparqlEndpoint}`);

      const response = await fetch(sparqlEndpoint, {
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
        result = await response.json();
        displayJsonResults(result);
      } else if (contentType.includes('html') || 
                 format === 'text/html' || 
                 format === 'text/x-html+tr' ||
                 format === 'application/vnd.ms-excel') {
        // Handle HTML and spreadsheet content
        result = await response.text();
        resultsDiv.innerHTML = result; // Use resultsDiv here

        // Fix table structure and pre tags
        const table = resultsDiv.querySelector('table');
        if (table) {
          // Fix thead
          const firstRow = table.querySelector('tr');
          if (firstRow && firstRow.querySelectorAll('th').length > 0) {
            if (!table.querySelector('thead')) {
              const thead = document.createElement('thead');
              thead.appendChild(firstRow);
              table.insertBefore(thead, table.firstChild);
            }
          }

          // Fix pre tags in cells
          table.querySelectorAll('td pre').forEach(pre => {
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.wordBreak = 'break-word';
            pre.style.overflowX = 'hidden';
          });
        }

        copyUrlAlert.style.display = 'flex';
      } else if (contentType.includes('xml')) {
        result = await response.text();
        displayTextResults(result, 'xml');
      } else if (contentType.includes('csv')) {
        result = await response.text();
        displayTextResults(result, 'csv');
      } else {
        result = await response.text();
        displayTextResults(result, 'text');
      }
    } catch (error) {
      resultsDiv.textContent = `Error: ${error.message}`; // Use resultsDiv here
      copyUrlAlert.style.display = 'none'; // Hide the alert box if there's an error
    } finally {
      // Reset progress bar and re-enable Run Query button
      progressBar.style.width = '0%';
      progressBar.classList.remove('progress-bar-striped', 'progress-bar-animated');
      submitButton.disabled = false;
    }

    // Switch to the results tab
    queryResultsTab.show();
  });

  function displayJsonResults(data) {
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = "";

    if (data.results && data.results.bindings.length > 0) {
      const table = document.createElement("table");
      table.className = "table sparql monospace";

      // Create table headers
      const thead = table.createTHead();
      const headerRow = thead.insertRow();
      const headers = Object.keys(data.results.bindings[0]);
      headers.forEach((header) => {
        const th = document.createElement("th");
        th.textContent = header;
        headerRow.appendChild(th);
      });

      // Create table rows
      const tbody = table.createTBody();
      data.results.bindings.forEach((row, index) => {
        const tr = tbody.insertRow();
        tr.className = index % 2 === 1 ? 'even' : ''; // Use CSS classes instead of inline styles
        headers.forEach((header) => {
          const td = tr.insertCell();
          td.textContent = row[header]?.value || "";
        });
      });

      resultsDiv.appendChild(table);
      copyUrlAlert.style.display = 'flex';
    } else {
      resultsDiv.textContent = "No results found.";
      copyUrlAlert.style.display = 'none';
    }
  }

  function displayTextResults(content, type) {
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = "";

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

    resultsDiv.appendChild(pre);
    copyUrlAlert.style.display = 'flex';
  }

  let queries = [];
  let selectedQueryElement = null;

  const REMOTE_QUERIES_URL = 'https://raw.githubusercontent.com/OP-TED/ted-rdf-docs/develop/docs/antora/modules/samples/queries/';

  // Load categories and queries from a remote YAML file
  async function loadQueries() {
    try {
      const response = await fetch(`${REMOTE_QUERIES_URL}index.yaml`);
      const text = await response.text();
      const data = yaml.load(text);
      const categories = new Map();

      data.queries.forEach(query => {
        if (!categories.has(query.category)) {
          categories.set(query.category, []);
        }
        categories.get(query.category).push(query);
      });

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

        queryAccordion.appendChild(categoryItem);
      });

      // Store the queries for later use
      queries = data.queries;
    } catch (error) {
      console.error('Failed to load queries:', error);
    }
  }

  // Display selected query details
  queryAccordion.addEventListener('click', async function (event) {
    if (event.target.matches('.list-group-item')) {
      const selectedQuery = queries.find(query => query.title === event.target.dataset.queryTitle);

      if (selectedQuery) {
        const queryFileResponse = await fetch(`${REMOTE_QUERIES_URL}${selectedQuery.sparql}`);
        const querySparqlText = await queryFileResponse.text();

        queryTitle.textContent = selectedQuery.title;
        queryDescription.textContent = selectedQuery.description;
        querySparqlEditor.setValue(querySparqlText);
        setTimeout(() => querySparqlEditor.refresh(), 0); // Ensure the editor is refreshed after setting the value
        tryQueryButton.disabled = false;
        queryCard.classList.remove('d-none');
        selectQueryMessage.classList.add('d-none');

        // Highlight the selected query
        if (selectedQueryElement) {
          selectedQueryElement.classList.remove('active');
        }
        event.target.classList.add('active');
        selectedQueryElement = event.target;
      } else {
        queryTitle.textContent = 'Query Title';
        queryDescription.textContent = 'Select a query to see its description.';
        querySparqlEditor.setValue('SPARQL query will be displayed here.');
        setTimeout(() => querySparqlEditor.refresh(), 0); // Ensure the editor is refreshed after setting the value
        tryQueryButton.disabled = true;
        queryCard.classList.add('d-none');
        selectQueryMessage.classList.remove('d-none');
      }
    }
  });

  // Load queries on page load
  loadQueries();

});
