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

/**
 * Interactive guided tour for the Explore tab (Query Library).
 *
 * Walks the user through the library of pre-made SPARQL queries: how
 * to browse categories, what happens when a query is selected, the
 * Customise vs Try-this-query split, and the contribute link.
 *
 * Primes the UI before the tour runs by expanding the first accordion
 * category so step 1 can show the nested query items in-situ. No
 * network calls — the priming is a synchronous click that toggles
 * Bootstrap's collapse plugin, not a query fetch.
 */

let driverPromise = null;

/**
 * Lazy-load driver.js on first use. Reuses the same promise across
 * all tours so the module is only pulled from the CDN once per
 * session (Inspect / Explore / Customize / Reuse tours share it).
 * @returns {Promise<Function>}
 */
function loadDriver() {
  if (!driverPromise) {
    driverPromise = import('https://cdn.jsdelivr.net/npm/driver.js@1.3.1/+esm')
      .then(mod => mod.driver);
  }
  return driverPromise;
}

/**
 * Prime the Explore tab so every tour step has a real, populated
 * element to anchor to:
 *
 *   1. Expand the first accordion category (so step 1 shows nested
 *      query items underneath, not an empty collapsed header).
 *   2. Click the first query item in that category (so step 2 can
 *      anchor to the populated preview card — #queryCard — instead
 *      of the empty container that normally sits there on cold load).
 *
 * Step 2 triggers a network fetch for the query's SPARQL file. The
 * file is tiny and browser-cached, so the cost is negligible; the
 * reward is that the user sees the preview in its real working state
 * during the tour, which is exactly what a "show, don't tell"
 * walkthrough is supposed to do.
 *
 * Returns a Promise that resolves once the preview card is visible,
 * so the caller can wait before measuring element positions.
 */
async function primeExploreTab() {
  const firstBtn = document.querySelector('#queryAccordion .accordion-button');
  if (firstBtn && firstBtn.classList.contains('collapsed')) {
    firstBtn.click();
  }

  // Wait a beat for the accordion expand animation so the first
  // query item is actually clickable (Bootstrap collapse animates
  // over ~350ms).
  await new Promise(resolve => setTimeout(resolve, 380));

  // Click the first query in the first category. onQueryClick is
  // async (it fetches the .sparql file) but does its DOM mutation
  // synchronously right after; wait until #queryCard is visible.
  const firstQuery = document.querySelector('#queryAccordion .list-group-item');
  if (firstQuery) {
    firstQuery.click();
    await waitForElementVisible('#queryCard', 1500);
  }
}

/**
 * Poll for an element to lose its `d-none` class (or any display-none
 * styling), up to a timeout. Returns even if the element never appears
 * — the tour should still run rather than hang.
 */
function waitForElementVisible(selector, timeoutMs) {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      const el = document.querySelector(selector);
      if (el && !el.classList.contains('d-none') && el.offsetParent !== null) {
        resolve();
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/**
 * Start the Explore tab tour.
 * Caller ensures the Explore tab is currently active (the trigger
 * icon only exists inside that tab's pane).
 */
export async function startExploreTour() {
  const driver = await loadDriver();

  await primeExploreTab();

  const tour = driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0,
    stagePadding: 6,
    stageRadius: 6,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next →',
    prevBtnText: '← Back',
    doneBtnText: 'Got it',
    steps: [
      {
        // Anchor to the currently-selected query item (primed by
        // primeExploreTab above — always the first item in the first
        // category). It's small and sits near the top of the accordion,
        // so `side: 'right'` + `align: 'start'` places the popover
        // compactly next to it without blocking the preview panel
        // that the copy asks the user to look at. Driver.js will
        // auto-flip to the best free side if right is blocked.
        element: '#queryAccordion .list-group-item.active',
        popover: {
          title: 'A library of ready-made queries',
          description:
            'SPARQL queries grouped by category. We opened the first category for you — click any ' +
            'other category to expand it, then click a query to preview it on the right.',
          side: 'right',
          align: 'start',
        },
      },
      {
        // Anchor to the button row, not the whole card. The card is
        // enormous (fills the right half of the viewport) so any
        // `side` placement either sends the popover off-screen or
        // lands it over the accordion. The buttons are small and
        // sit at the bottom-right, leaving plenty of room for a
        // popover anchored above them.
        element: '#queryActionButtons',
        popover: {
          title: 'Preview and action',
          description:
            'When you pick a query from the library, its SPARQL code and description appear on ' +
            'the right part of the screen. Click on <strong>Try this query</strong> to run it ' +
            'straight away, or click on <strong>Customise</strong> to tweak it for your own needs.',
          side: 'top',
          align: 'end',
        },
      },
      {
        element: '#contribute-query-link',
        popover: {
          title: 'Got a query worth sharing?',
          description:
            'The library is community-curated. If you know SPARQL and have written a query that ' +
            'others might find useful, follow this link to learn how to contribute it back.',
          side: 'top',
          align: 'start',
        },
      },
      {
        // Centered modal — points forward to what happens after the
        // user clicks Try this query. The destination tab varies by
        // query type (Reuse for SELECT, Reuse-as-graph for
        // CONSTRUCT/DESCRIBE), so describe both flows in one place.
        popover: {
          title: 'Then what?',
          description:
            'The results land on the <strong>Reuse</strong> tab: as a sortable table for SELECT ' +
            'queries, or as an interactive knowledge graph for CONSTRUCT and DESCRIBE. Either way, ' +
            'you can download everything or grab a URL you can use to fetch live data from your apps.',
        },
      },
    ],
  });

  tour.drive();
}
