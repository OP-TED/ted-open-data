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

  // DOM elements
  const queryForm = document.getElementById('queryForm');
  const queryResultsTab = new bootstrap.Tab(document.getElementById('query-results-tab'));
  const startTourButton = document.getElementById('start-tour');
  const queryEditorTab = new bootstrap.Tab(document.getElementById('query-editor-tab'));
  const copyUrlButton = document.getElementById('copy-url-button');
  const copyUrlAlert = document.getElementById('copy-url-alert');
  const openUrlButton = document.getElementById('open-url-button');

  // Event listeners
  startTourButton.addEventListener('click', function () {
    console.log('Write your query button clicked'); // Debugging log
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

  // Update button state on editor changes
  editor.on("change", function() {
    runQueryButton.disabled = !editor.getValue().trim();
  });

  // Update copyUrlButton click handler
  copyUrlButton.addEventListener('click', function () {
    const query = editor.getValue();
    const format = document.getElementById("format").value || "application/sparql-results+json";
    const defaultGraphUri = document.getElementById("default-graph-uri").value;
    const timeout = document.getElementById("timeout").value || 30000;

    // Use the original SPARQL endpoint URL
    const url = `${SPARQL_ENDPOINT}?default-graph-uri=${encodeURIComponent(defaultGraphUri)}&query=${encodeURIComponent(query)}&format=${encodeURIComponent(format)}&timeout=${encodeURIComponent(timeout)}`;
    
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
    const format = document.getElementById("format").value || "application/sparql-results+json";
    const defaultGraphUri = document.getElementById("default-graph-uri").value;
    const timeout = document.getElementById("timeout").value || 30000;

    // Use the original SPARQL endpoint URL
    const url = `${SPARQL_ENDPOINT}?default-graph-uri=${encodeURIComponent(defaultGraphUri)}&query=${encodeURIComponent(query)}&format=${encodeURIComponent(format)}&timeout=${encodeURIComponent(timeout)}`;
    
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
        resultsDiv = document.getElementById("results");
        resultsDiv.innerHTML = result;
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
      document.getElementById("results").textContent = `Error: ${error.message}`;
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
    resultsDiv.innerHTML = ""; // Clear previous results

    if (data.results && data.results.bindings.length > 0) {
      const table = document.createElement("table");
      table.className = "table table-bordered table-striped";

      // Create table headers
      const headers = Object.keys(data.results.bindings[0]);
      const thead = table.createTHead();
      const headerRow = thead.insertRow();
      headers.forEach((header) => {
        const th = document.createElement("th");
        th.textContent = header;
        headerRow.appendChild(th);
      });

      // Create table rows
      const tbody = table.createTBody();
      data.results.bindings.forEach((row) => {
        const tr = tbody.insertRow();
        headers.forEach((header) => {
          const td = tr.insertCell();
          td.textContent = row[header]?.value || "";
        });
      });

      resultsDiv.appendChild(table);
      copyUrlAlert.style.display = 'flex'; // Show the alert box when there are results
    } else {
      resultsDiv.textContent = "No results found.";
      copyUrlAlert.style.display = 'none'; // Hide the alert box if no results
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
});
