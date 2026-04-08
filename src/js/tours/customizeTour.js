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
 * Interactive guided tour for the Customize tab (Query Editor).
 *
 * Walks the user through the SPARQL editor, the advanced options
 * panel, the Run Query button, and points back to the Explore tab
 * as the canonical starting point for people who don't know SPARQL.
 *
 * Primes the UI by expanding the Options collapse panel so step 3
 * can anchor to the populated options card instead of the collapsed
 * button. The panel is left expanded after the tour ends (consistent
 * with the Explore tour priming which leaves state in place).
 */

let driverPromise = null;

/**
 * Lazy-load driver.js on first use — shared with the Inspect and
 * Explore tours via a module-level promise cache.
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
 * Expand the Options collapse panel if it is currently collapsed, so
 * the tour's Options step can anchor to a populated card with the
 * actual checkboxes and timeout field visible. Uses Bootstrap's
 * Collapse plugin directly so we can wait on the 'shown.bs.collapse'
 * event instead of guessing at animation timing.
 *
 * @returns {Promise<void>} resolves once the panel has finished
 *   expanding (or immediately, if it was already expanded).
 */
function primeCustomizeTab() {
  return new Promise(resolve => {
    const panel = document.getElementById('optionsCollapse');
    if (!panel) { resolve(); return; }
    if (panel.classList.contains('show')) { resolve(); return; }

    const onShown = () => {
      panel.removeEventListener('shown.bs.collapse', onShown);
      resolve();
    };
    panel.addEventListener('shown.bs.collapse', onShown);

    bootstrap.Collapse.getOrCreateInstance(panel, { toggle: false }).show();

    // Safety fallback — if the event never fires (Bootstrap not
    // loaded, element detached, etc.), resolve after 500ms so the
    // tour does not hang indefinitely.
    setTimeout(resolve, 500);
  });
}

/**
 * Start the Customize tab tour.
 * Caller ensures the Customize tab is currently active (the trigger
 * link only exists inside that tab's pane).
 */
export async function startCustomizeTour() {
  const driver = await loadDriver();

  await primeCustomizeTab();

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
        element: '#query',
        popover: {
          title: 'Write your SPARQL query here',
          description:
            'A full-featured SPARQL editor with syntax highlighting, bracket matching, line ' +
            'numbers, and autocomplete for the eProcurement Ontology. Write a query from scratch ' +
            'or tweak one you loaded from the library.',
          // The editor fills almost the entire tab, so any `side`
          // placement either overlaps it or sends the popover into
          // chrome. Centered under the editor gives the popover room
          // to breathe above the Options/Run row.
          side: 'bottom',
          align: 'center',
        },
      },
      {
        element: '#optionsCollapse',
        popover: {
          title: 'Advanced options',
          description:
            'Fine-tune how the endpoint executes your query: set a <strong>timeout</strong> in ' +
            'milliseconds, toggle strict checking of void variables, or ask the server for debug ' +
            'output and a compilation report. The defaults are sensible — only touch these if you ' +
            'know why.',
          // `side: 'top'` on an options card that already sits at
          // the bottom of the viewport leaves a long visual gap
          // between popover and target. Anchoring to the right of
          // the card places the popover in the gutter between the
          // options and the Run Query button — tight, unambiguous,
          // and keeps the options card fully visible.
          side: 'right',
          align: 'center',
        },
      },
      {
        element: '#runQueryButton',
        popover: {
          title: 'Run your query',
          description:
            'Hit this to send the query to the endpoint. The results land on the <strong>Reuse</strong> ' +
            'tab — as a sortable table for SELECT queries, or as an interactive knowledge graph for ' +
            'CONSTRUCT and DESCRIBE.',
          side: 'left',
          align: 'end',
        },
      },
      {
        // Centered modal — points sideways at the Explore tab as
        // the recommended starting point for non-experts. This
        // rounds out the tour: we showed the user the editor, but
        // we do not pretend every visitor can write SPARQL from
        // scratch, so we tell them where to find ready-made queries
        // that they can then tweak here.
        popover: {
          title: 'New to SPARQL?',
          description:
            'The fastest way to get started is to pick a query from the <strong>Explore</strong> ' +
            'tab and click <strong>Customise</strong> — it drops the query straight into this ' +
            'editor, ready for you to adapt to your own needs.',
        },
      },
    ],
  });

  tour.drive();
}
