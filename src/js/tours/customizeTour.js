/*
 * Copyright 2026 European Union
 *
 * Licensed under the EUPL, Version 1.2 or - as soon they will be approved by the European
 * Commission - subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */

/**
 * Interactive guided tour for the Customize tab (Query Editor).
 *
 * Walks the user through the SPARQL editor, the options panel, the
 * Run Query button, and points back to the Explore tab as the
 * recommended starting point for users who do not know SPARQL.
 *
 * Primes the UI by expanding the Options collapse panel so step 2
 * can anchor to the populated options card instead of a collapsed
 * button. The panel is left expanded after the tour ends.
 */

import { createTour, loadDriver } from './_driver.js';

let activeTour = null;

/**
 * Expand the Options collapse panel if it is currently collapsed,
 * so the tour's Options step can anchor to a populated card with
 * the actual checkboxes and timeout field visible. Listens for the
 * `shown.bs.collapse` event rather than guessing at animation
 * timing.
 *
 * Returns once the panel has finished expanding, or immediately if
 * it was already expanded, or after a 500ms fallback if anything
 * goes wrong (Bootstrap not loaded, element missing, etc.).
 */
function primeCustomizeTab() {
  return new Promise(resolve => {
    const panel = document.getElementById('options-collapse');
    if (!panel) {
      resolve();
      return;
    }
    if (panel.classList.contains('show')) {
      resolve();
      return;
    }

    if (typeof bootstrap === 'undefined' || !bootstrap.Collapse) {
      console.warn('primeCustomizeTab: bootstrap.Collapse unavailable, continuing without prime');
      resolve();
      return;
    }

    const onShown = () => {
      panel.removeEventListener('shown.bs.collapse', onShown);
      resolve();
    };
    panel.addEventListener('shown.bs.collapse', onShown);

    try {
      bootstrap.Collapse.getOrCreateInstance(panel, { toggle: false }).show();
    } catch (err) {
      console.warn('primeCustomizeTab: failed to expand options panel:', err);
      panel.removeEventListener('shown.bs.collapse', onShown);
      resolve();
      return;
    }

    // Safety fallback — if the shown event never fires (e.g. the
    // panel was replaced mid-animation), resolve after 500ms so
    // the tour does not hang indefinitely.
    setTimeout(resolve, 500);
  });
}

/**
 * Start the Customize tab tour. Any previous instance is destroyed
 * first so only one tour is ever live at a time.
 */
export async function startCustomizeTour() {
  const driver = await loadDriver();

  if (activeTour) {
    try { activeTour.destroy(); } catch { /* best-effort cleanup */ }
    activeTour = null;
  }

  await primeCustomizeTab();

  activeTour = createTour(driver, [
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
        // chrome. Centered under the editor gives it room to breathe
        // above the Options / Run row.
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '#options-collapse',
      popover: {
        title: 'Options',
        description:
          'Fine-tune how the endpoint executes your query: set a <strong>timeout</strong> in ' +
          'milliseconds, toggle strict checking of void variables, or ask the server for debug ' +
          'output and a compilation report. The defaults are sensible — only touch these if you ' +
          'know why.',
        side: 'right',
        align: 'center',
      },
    },
    {
      element: '#run-query-button',
      popover: {
        title: 'Run your query',
        description:
          'Click this to send the query to the endpoint. The results appear on the ' +
          '<strong>Reuse</strong> tab — as a sortable table for SELECT queries, or as an ' +
          'interactive knowledge graph for CONSTRUCT and DESCRIBE.',
        side: 'left',
        align: 'end',
      },
    },
    {
      // Centered modal — points sideways at the Explore tab as the
      // recommended starting point for non-experts. We showed the
      // editor, but we do not pretend every visitor can write SPARQL
      // from scratch, so we tell them where to find ready-made
      // queries they can tweak here.
      popover: {
        title: 'New to SPARQL?',
        description:
          'The fastest way to get started is to pick a query from the <strong>Explore</strong> ' +
          'tab and click <strong>Customise</strong> — it drops the query straight into this ' +
          'editor, ready for you to adapt to your own needs.',
      },
    },
  ]);

  activeTour.drive();
}
