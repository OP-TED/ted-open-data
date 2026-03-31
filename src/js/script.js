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
import { QueryEditor } from './QueryEditor.js';
import { QueryLibrary } from './QueryLibrary.js';
import { HomeTab } from './HomeTab.js';
import { QueryResults } from './QueryResults.js';

const SPARQL_ENDPOINT = 'https://publications.europa.eu/webapi/rdf/sparql';
const REMOTE_QUERIES_URL = 'https://raw.githubusercontent.com/OP-TED/ted-rdf-docs/main/docs/antora/modules/samples/queries/';

document.addEventListener('DOMContentLoaded', function () {
  const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const sparqlEndpoint = isDevelopment 
    ? `http://localhost:8080/proxy?url=${encodeURIComponent(SPARQL_ENDPOINT)}`
    : SPARQL_ENDPOINT;

  new HomeTab();
  const queryEditor = new QueryEditor(sparqlEndpoint);
  const queryResults = new QueryResults(queryEditor, SPARQL_ENDPOINT);
  queryEditor.setQueryResults(queryResults);
  const queryLibrary = new QueryLibrary(sparqlEndpoint, queryEditor, REMOTE_QUERIES_URL);

  // Initialize all Bootstrap tooltips
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el));

  // Ensure CM6 editors re-measure when their Bootstrap tabs become visible
  document.querySelectorAll('[data-bs-toggle="tab"]').forEach(tab => {
    tab.addEventListener('shown.bs.tab', () => {
      queryEditor.editor.requestMeasure();
      queryLibrary.querySparqlEditor.requestMeasure();
    });
  });

  // Fetch data period from the SPARQL endpoint and display in footer
  const datePeriodQuery = `PREFIX epo: <http://data.europa.eu/a4g/ontology#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?earliestDate ?latestDate WHERE {
  { SELECT ?date AS ?earliestDate WHERE {
      GRAPH ?g { ?notice a epo:Notice ; epo:hasPublicationDate ?date . FILTER(DATATYPE(?date) = xsd:date) }
    } ORDER BY ASC(?date) LIMIT 1 }
  { SELECT ?date AS ?latestDate WHERE {
      GRAPH ?g { ?notice a epo:Notice ; epo:hasPublicationDate ?date . FILTER(DATATYPE(?date) = xsd:date) }
    } ORDER BY DESC(?date) LIMIT 1 }
}`;

  fetch(sparqlEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `query=${encodeURIComponent(datePeriodQuery)}&format=${encodeURIComponent('application/sparql-results+json')}`
  })
    .then(response => response.json())
    .then(data => {
      const bindings = data.results?.bindings?.[0];
      if (bindings?.earliestDate?.value && bindings?.latestDate?.value) {
        const fmt = (dateStr) => {
          const [y, m, d] = dateStr.split('-');
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
        };
        document.getElementById('data-period').textContent =
          `Data period: ${fmt(bindings.earliestDate.value)} to ${fmt(bindings.latestDate.value)}`;
        const infoIcon = document.getElementById('data-period-info');
        infoIcon.style.display = 'inline';
        bootstrap.Tooltip.getOrCreateInstance(infoIcon);
      }
    })
    .catch(() => {});
});
