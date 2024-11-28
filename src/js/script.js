// Load configuration
let config;
let sparqlEndpoint;

async function loadConfig() {
  const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? ''
    : '/ted-sparql-editor';
  const response = await fetch(`${baseUrl}/config.json`);
  if (!response.ok) {
    throw new Error(`Failed to load configuration: ${response.statusText}`);
  }
  config = await response.json();
}

// Function to get SPARQL endpoint
function getSparqlEndpoint(env) {
  let endpoint = config.environments.cellar[env]?.sparqlEndpoint;
  if (!endpoint) {
    throw new Error(`Environment ${env} not found in configuration`);
  }
  if (appEnvironment === 'development') {
    endpoint = `http://localhost:8080/proxy?url=${encodeURIComponent(endpoint)}`;
  }
  return endpoint;
}

// Function to get original SPARQL endpoint (without proxy)
function getOriginalSparqlEndpoint(env) {
  let endpoint = config.environments.cellar[env]?.sparqlEndpoint;
  if (!endpoint) {
    throw new Error(`Environment ${env} not found in configuration`);
  }
  return endpoint;
}

// Function to get app configuration
function getAppConfig(env) {
  if (config.environments.application[env]) {
    return config.environments.application[env];
  } else {
    throw new Error(`App environment ${env} not found in configuration`);
  }
}

// Detect the application environment based on the URL
const hostname = window.location.hostname;
const appEnvironment = (hostname === 'localhost' || hostname === '127.0.0.1') ? 'development' : 'production';

document.addEventListener('DOMContentLoaded', async function () {
  try {
    await loadConfig();
  } catch (error) {
    console.error(error.message);
    return;
  }

  // DOM elements
  const queryForm = document.getElementById('queryForm');
  const queryResultsTab = new bootstrap.Tab(document.getElementById('query-results-tab'));
  const startTourButton = document.getElementById('start-tour');
  const queryEditorTab = new bootstrap.Tab(document.getElementById('query-editor-tab'));
  const copyUrlButton = document.getElementById('copy-url-button');
  const copyUrlAlert = document.getElementById('copy-url-alert');
  const cellarEnvironmentSelect = document.getElementById('cellarEnvironment');

  // Set the environment (test or production)
  let sparqlEnvironment = cellarEnvironmentSelect.value || config.defaultEnvironment.cellarEnvironment;

  try {
    sparqlEndpoint = getSparqlEndpoint(sparqlEnvironment);
    const appConfig = getAppConfig(appEnvironment);
    console.log(`Using SPARQL endpoint: ${sparqlEndpoint}`);
    console.log(`Using app configuration:`, appConfig);
    // Your code to use the sparqlEndpoint and appConfig
  } catch (error) {
    console.error(error.message);
  }

  // Update sparqlEndpoint when the environment dropdown changes
  cellarEnvironmentSelect.addEventListener('change', function () {
    sparqlEnvironment = cellarEnvironmentSelect.value;
    sparqlEndpoint = getSparqlEndpoint(sparqlEnvironment);
    console.log(`Environment changed to: ${sparqlEnvironment}`);
    console.log(`Using SPARQL endpoint: ${sparqlEndpoint}`);
  });

  // Event listeners
  startTourButton.addEventListener('click', function () {
    console.log('Write your query button clicked'); // Debugging log
    queryEditorTab.show();
  });

  copyUrlButton.addEventListener('click', function () {
    const query = document.getElementById("query").value;
    const format = document.getElementById("format").value || "application/sparql-results+json";
    const defaultGraphUri = document.getElementById("default-graph-uri").value;
    const timeout = document.getElementById("timeout").value || 30000;

    // Use the original SPARQL endpoint URL
    const originalSparqlEndpoint = getOriginalSparqlEndpoint(sparqlEnvironment);
    const url = `${originalSparqlEndpoint}?default-graph-uri=${encodeURIComponent(defaultGraphUri)}&query=${encodeURIComponent(query)}&format=${encodeURIComponent(format)}&timeout=${encodeURIComponent(timeout)}`;
    
    console.log(`Generated URL: ${url}`);
    navigator.clipboard.writeText(url).then(() => {
      alert('URL copied to clipboard');
    }).catch(err => {
      alert('Failed to copy URL');
    });
  });

  queryForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    
    // Run the query
    const query = document.getElementById("query").value;
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

    try {
      const response = await fetch(sparqlEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const result = await response.json(); // Assuming JSON format
      displayResults(result);
    } catch (error) {
      document.getElementById("results").textContent = `Error: ${error.message}`;
      copyUrlAlert.style.display = 'none'; // Hide the alert box if there's an error
    }

    // Switch to the results tab
    queryResultsTab.show();
  });

  // Function to display results
  function displayResults(data) {
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
});
