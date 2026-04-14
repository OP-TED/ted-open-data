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
import { QueryEditor } from './QueryEditor.js';
import { QueryLibrary } from './QueryLibrary.js';
import { HomeTab } from './HomeTab.js';
import { QueryResults } from './QueryResults.js';

// Explorer integration. These classes drive the Inspect tab
// (`#app-tab-search`) and the Reuse tab's graph lane
// (`#app-tab-explorer`). They use a worker-based execution path
// (services/sparqlService.js) for CONSTRUCT/DESCRIBE queries,
// while SELECT/ASK queries go through the QueryEditor's direct
// fetch path. The routing is unified in QueryEditor.onSubmit.
import { BacklinksView } from './BacklinksView.js';
import { DataView } from './DataView.js';
import { ExplorerController } from './ExplorerController.js';
import { NoticeView } from './NoticeView.js';
import { SearchPanel } from './SearchPanel.js';
import { setController } from './TermRenderer.js';

const SPARQL_ENDPOINT = 'https://publications.europa.eu/webapi/rdf/sparql';
const REMOTE_QUERIES_URL = 'https://raw.githubusercontent.com/OP-TED/ted-rdf-docs/main/docs/antora/modules/samples/queries/';

// Reset scroll on page load (browsers may restore previous scroll position).
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

document.addEventListener('DOMContentLoaded', function () {
  // Fail loudly if the Bootstrap JS bundle did not load. Tabs,
  // dropdowns, tooltips, collapse panels, carousel and toasts all
  // depend on the global `bootstrap` object; losing it (CDN block,
  // CSP violation, corporate firewall) makes every subsequent
  // `new bootstrap.Tab(...)` throw synchronously inside a
  // constructor, and the user sees a half-dead page with nothing
  // pointing at the cause. Surfacing a single top-of-page banner
  // here turns an invisible cascade of errors into one clear
  // signal.
  if (typeof bootstrap === 'undefined') {
    const banner = document.createElement('div');
    banner.className = 'alert alert-danger m-0 rounded-0';
    banner.setAttribute('role', 'alert');
    banner.textContent =
      'A required script failed to load (Bootstrap). The app will not work correctly. ' +
      'Check your network connection and content-security policy, then reload the page.';
    document.body.insertAdjacentElement('afterbegin', banner);
    console.error('[script] bootstrap global is undefined; aborting app initialisation.');
    return;
  }

  const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const sparqlEndpoint = isDevelopment
    ? `http://localhost:8080/proxy?url=${encodeURIComponent(SPARQL_ENDPOINT)}`
    : SPARQL_ENDPOINT;

  new HomeTab();
  const queryEditor = new QueryEditor(sparqlEndpoint);
  const queryResults = new QueryResults(queryEditor, SPARQL_ENDPOINT);
  queryEditor.setQueryResults(queryResults);
  const queryLibrary = new QueryLibrary(sparqlEndpoint, queryEditor, REMOTE_QUERIES_URL);

  // Wire up the Inspect tab (`#app-tab-search`) and the Reuse
  // graph lane (`#app-tab-explorer`). ExplorerController is the
  // model layer; SearchPanel/NoticeView/DataView/BacklinksView bind
  // to the HTML scaffolding. The Customize tab routes
  // CONSTRUCT/DESCRIBE queries to this controller (rendering on the
  // Reuse graph lane) while SELECT/ASK uses the tabular path.
  bootstrapExplorer(queryEditor);

  // Initialize all Bootstrap tooltips
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el));

  // Per-tab guided tours. The tour modules are imported dynamically
  // on first click so users who never take a tour pay no cost at
  // load time. Each tour anchors to real elements on its own tab;
  // the trigger icon only exists inside that tab's pane so it is
  // implicit that the tab is active when clicked.
  //
  // Dynamic imports can fail (network, CSP, 404 after a deploy).
  // Catch so a dead play-button never happens silently.
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
        const { showToast } = await import('./utils/toast.js').catch(() => ({ showToast: null }));
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

  // Measure actual header height and set CSS variable for layout calculations.
  const measureHeader = () => {
    const globan = document.querySelector('.eu-globan');
    const scrollableHeader = document.querySelector('.site-header--scrollable');
    const stickyNav = document.querySelector('.sticky-nav');
    const stickyNavHeight = stickyNav?.offsetHeight || 0;
    const total = (globan?.offsetHeight || 0) + (scrollableHeader?.offsetHeight || 0) + stickyNavHeight;
    document.documentElement.style.setProperty('--header-total-height', total + 'px');
    document.documentElement.style.setProperty('--sticky-nav-height', stickyNavHeight + 'px');
    const dataHeader = document.querySelector('.data-sticky-header');
    if (dataHeader) {
      document.documentElement.style.setProperty('--data-header-height', dataHeader.offsetHeight + 'px');
    }
  };
  measureHeader();
  window.addEventListener('resize', measureHeader);

  // Re-measure when the data header changes size (breadcrumb wrap, view-mode toggle).
  const dataHeader = document.querySelector('.data-sticky-header');
  if (dataHeader && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--data-header-height', dataHeader.offsetHeight + 'px');
    }).observe(dataHeader);
  }

  // EU globan "How do you know?" toggle
  const globanBtn = document.querySelector('.eu-globan__button');
  const globanDropdown = document.getElementById('eu-globan-dropdown');
  if (globanBtn && globanDropdown) {
    globanBtn.addEventListener('click', () => {
      const expanded = globanBtn.getAttribute('aria-expanded') === 'true';
      globanBtn.setAttribute('aria-expanded', String(!expanded));
      globanDropdown.hidden = expanded;
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.eu-globan__content')) {
        globanBtn.setAttribute('aria-expanded', 'false');
        globanDropdown.hidden = true;
      }
    });
  }

  // Ensure CM6 editors re-measure when their Bootstrap tabs become visible.
  // On tab switch, scroll so the non-sticky header (globan + EU logo) is
  // just out of view, leaving the sticky title row + tabs visible at the top.
  const scrollableHeaderHeight = () => {
    const globan = document.querySelector('.eu-globan');
    const upper = document.querySelector('.site-header--scrollable');
    return (globan?.offsetHeight || 0) + (upper?.offsetHeight || 0);
  };
  document.querySelectorAll('[data-bs-toggle="tab"]').forEach(tab => {
    tab.addEventListener('shown.bs.tab', () => {
      queryEditor.editor.requestMeasure();
      queryLibrary.querySparqlEditor.requestMeasure();
      const target = scrollableHeaderHeight();
      if (window.scrollY > target) {
        window.scrollTo(0, target);
      }
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
    .then(response => {
      // Check `response.ok` explicitly — otherwise a 500 HTML
      // error page would flow into response.json() and throw a
      // SyntaxError that was previously swallowed by the empty
      // .catch() below.
      if (!response.ok) {
        throw new Error(`HTTP error. Status: ${response.status}`);
      }
      return response.json();
    })
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
        if (infoIcon) {
          infoIcon.style.display = 'inline';
          bootstrap.Tooltip.getOrCreateInstance(infoIcon);
        }
        measureHeader();
      }
    })
    .catch(err => {
      // Log the failure so a developer can see why the footer is
      // missing its data-period label. Users get graceful
      // degradation — the footer slot just stays empty.
      console.warn('[script] Failed to load data period for footer:', err);
    });

});

// Instantiates the explorer controller + views and wires them to the
// HTML scaffolding. Progress feedback uses the footer's existing
// progress bar and stop button. Data-period loading is handled by the
// DOMContentLoaded block above.
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

  // Best-effort callback that drops a query string into
  // the Customize tab's editor as a side effect of a notice-search
  // gesture. The notice-number facet path through the controller is
  // unchanged; the editor reflection is purely visual so the user
  // can see the query that produced what they are now looking at
  // on the Reuse graph lane.
  const loadEditorText = (text) => queryEditor?.setValue?.(text);

  // Mutual exclusion of the two Reuse-tab lanes. Both
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

  // Let QueryEditor route CONSTRUCT/DESCRIBE queries to this controller.
  // SELECT/ASK queries continue to use the existing fetch-based path on
  // the Query Results tab. The setActiveResultTab callback enforces the
  // mutual exclusion between the SELECT and graph result lanes.
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
