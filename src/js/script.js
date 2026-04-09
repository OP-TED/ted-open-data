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
import { QueryEditor } from './QueryEditor.js';
import { QueryLibrary } from './QueryLibrary.js';
import { HomeTab } from './HomeTab.js';
import { QueryResults } from './QueryResults.js';

// Explorer port — Stage 6 wiring. These classes drive the Inspect
// tab (`#app-tab-search`) and the Reuse tab's graph lane
// (`#app-tab-explorer`), both of which were added in Stage 5 by
// porting ted-open-data-explorer. They run alongside the existing
// ted-open-data classes above and use a separate execution path
// (worker-based, via services/sparqlService.js) until Stage 7
// unifies the SPARQL execution into a single pipeline.
import { BacklinksView } from './BacklinksView.js';
import { DataView } from './DataView.js';
import { ExplorerController } from './ExplorerController.js';
import { NoticeView } from './NoticeView.js';
import { SearchPanel } from './SearchPanel.js';
import { setController } from './TermRenderer.js';

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

  // ── Explorer port (Stages 6-7) ──
  // Wire up the Inspect tab (`#app-tab-search`) and the Reuse
  // graph lane (`#app-tab-explorer`). ExplorerController is the
  // model layer; SearchPanel/NoticeView/DataView/BacklinksView bind
  // to the HTML scaffolding added in Stage 5. Stage 7 also wires
  // the Customize tab to route CONSTRUCT/DESCRIBE queries to this
  // controller (so they render on the Reuse graph lane) while
  // leaving SELECT/ASK on ted-open-data's existing tabular path.
  bootstrapExplorer(queryEditor);

  // Initialize all Bootstrap tooltips
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el));

  // Per-tab guided tours. The tour modules are imported dynamically
  // on first click so users who never take a tour pay no cost at
  // load time. Each tour anchors to real elements on its own tab;
  // the trigger icon only exists inside that tab's pane so it is
  // implicit that the tab is active when clicked.
  //
  // Dynamic imports and the tour's internal driver.js CDN fetch can
  // both fail (network, CSP, 404 after a deploy, corporate firewall).
  // Catch around both so a dead play-button never happens silently.
  const TOURS = [
    { id: 'inspect-tour-trigger',      module: './tours/inspectTour.js',      fn: 'startInspectTour' },
    { id: 'explore-tour-trigger',      module: './tours/exploreTour.js',      fn: 'startExploreTour' },
    { id: 'customize-tour-trigger',    module: './tours/customizeTour.js',    fn: 'startCustomizeTour' },
    { id: 'reuse-select-tour-trigger', module: './tours/reuseSelectTour.js',  fn: 'startReuseSelectTour' },
    { id: 'reuse-graph-tour-trigger',  module: './tours/reuseGraphTour.js',   fn: 'startReuseGraphTour' },
  ];
  for (const { id, module, fn } of TOURS) {
    const el = document.getElementById(id);
    if (!el) {
      console.warn(`Tour trigger #${id} not found in DOM — tour unavailable.`);
      continue;
    }
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const mod = await import(module);
        await mod[fn]();
      } catch (err) {
        console.error(`Failed to load tour ${id}:`, err);
        const { showToast } = await import('./toast.js').catch(() => ({ showToast: null }));
        if (showToast) {
          showToast(
            'Could not load the tour',
            'The guided tour could not be loaded. Please check your connection and try again.',
            { variant: 'danger' },
          );
        }
      }
    });
  }

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

// ── Explorer bootstrap (Stage 6) ──
// Instantiates the explorer controller + views and wires them to the
// HTML scaffolding from Stage 5. Mirrors ted-open-data-explorer's old
// app.js, minus the SparqlPanel (decision §3.2: only one editor),
// minus the progress-bar/stop-button wiring (those use explorer's own
// element IDs that don't exist in ted-open-data; Stage 7 will unify
// progress feedback into ted-open-data's existing footer), and minus
// loadDataPeriod (the existing script.js block above already does it).
function bootstrapExplorer(queryEditor) {
  const controller = new ExplorerController();
  setController(controller);

  // Switch to the Reuse tab's graph lane (`#app-tab-explorer`).
  // Called only by direct user gestures (Inspect button, Enter,
  // lucky link, timeline click, history pick, and — added in Stage
  // 7 — running a CONSTRUCT/DESCRIBE in the Customize tab). Resets
  // view mode to Tree and expands the procedure mini-card so the
  // user lands in a consistent state regardless of where they
  // came from.
  function showExplorerTab() {
    const treeRadio = document.getElementById('view-tree');
    if (treeRadio && !treeRadio.checked) {
      treeRadio.checked = true;
      treeRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const procedureBody = document.getElementById('explorer-procedure-body');
    if (procedureBody) {
      bootstrap.Collapse.getOrCreateInstance(procedureBody, { toggle: false }).show();
    }
    const tabBtn = document.getElementById('app-tab-explorer');
    if (tabBtn) new bootstrap.Tab(tabBtn).show();
  }

  // Stage 8 — best-effort callback that drops a query string into
  // the Customize tab's editor as a side effect of a notice-search
  // gesture. The notice-number facet path through the controller is
  // unchanged; the editor reflection is purely visual so the user
  // can see the query that produced what they are now looking at
  // on the Reuse graph lane.
  const loadEditorText = (text) => queryEditor?.setValue?.(text);

  // Stage 12 — mutual exclusion of the two Reuse-tab lanes. Both
  // share the user-facing label "Reuse"; only one is shown at a
  // time, based on which query type just ran. Cold load = both
  // hidden.
  //   'select' → SELECT/ASK tabular lane (`#query-results-tab-item`)
  //   'graph'  → CONSTRUCT/DESCRIBE tree/turtle/backlinks lane
  //              (`#app-tab-explorer-item`)
  //   'none'   → both hidden
  // Declared BEFORE setExplorerRouting because that call passes it
  // in as a callback.
  const setActiveResultTab = (kind) => {
    const selectItem = document.getElementById('query-results-tab-item');
    const graphItem = document.getElementById('app-tab-explorer-item');
    if (selectItem) selectItem.style.display = kind === 'select' ? '' : 'none';
    if (graphItem)  graphItem.style.display  = kind === 'graph'  ? '' : 'none';
  };

  // Stage 7 — let QueryEditor route CONSTRUCT/DESCRIBE queries to
  // this controller. SELECT/ASK queries continue to use ted-open-data's
  // existing fetch-based path on the Query Results tab. The
  // setActiveResultTab callback enforces the Stage 12 mutual exclusion.
  if (queryEditor?.setExplorerRouting) {
    queryEditor.setExplorerRouting(controller, showExplorerTab, setActiveResultTab);
  }

  const searchPanel = new SearchPanel(controller, {
    showExplorerTab,
    loadEditorText,
    setActiveResultTab,
  });
  new NoticeView(controller, {
    showExplorerTab,
    setSearchInput: (v) => searchPanel.setInputValue(v),
    loadEditorText,
    setActiveResultTab,
  });
  new DataView(controller, {
    pickRandom: () => searchPanel.pickRandom(),
  });
  new BacklinksView(controller);

  searchPanel.init();
}
