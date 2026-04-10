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
// Guided tour for the Customize tab (Query Editor) — 4 steps.
// Primes the UI by expanding the Options collapse panel.

import { startTour } from './tour.js';

function primeCustomizeTab() {
  return new Promise(resolve => {
    const panel = document.getElementById('options-collapse');
    if (!panel) { resolve(); return; }
    if (panel.classList.contains('show')) { resolve(); return; }
    if (typeof bootstrap === 'undefined' || !bootstrap.Collapse) {
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
      panel.removeEventListener('shown.bs.collapse', onShown);
      resolve();
      return;
    }

    setTimeout(resolve, 500);
  });
}

export async function startCustomizeTour() {
  await primeCustomizeTab();

  startTour([
    {
      element: '#query',
      title: 'Write your SPARQL query here',
      content:
        'A full-featured SPARQL editor with syntax highlighting, bracket matching, line ' +
        'numbers, and autocomplete for the eProcurement Ontology. Write a query from scratch ' +
        'or tweak one you loaded from the library.',
      placement: 'bottom',
    },
    {
      element: '#options-collapse',
      title: 'Options',
      content:
        'Fine-tune how the endpoint executes your query: set a <strong>timeout</strong> in ' +
        'milliseconds, toggle strict checking of void variables, or ask the server for debug ' +
        'output and a compilation report. The defaults are sensible — only touch these if you ' +
        'know why.',
      placement: 'right',
    },
    {
      element: '#run-query-button',
      title: 'Run your query',
      content:
        'Click this to send the query to the endpoint. The results appear on the ' +
        '<strong>Reuse</strong> tab — as a sortable table for SELECT queries, or as an ' +
        'interactive knowledge graph for CONSTRUCT and DESCRIBE.',
      placement: 'left',
    },
    {
      title: 'New to SPARQL?',
      content:
        'The fastest way to get started is to pick a query from the <strong>Explore</strong> ' +
        'tab and click <strong>Customise</strong> — it drops the query straight into this ' +
        'editor, ready for you to adapt to your own needs.',
    },
  ]);
}
