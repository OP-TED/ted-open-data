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
// Guided tour for the Explore tab (Query Library) — 4 steps.
// Primes the UI by expanding the first accordion category and
// clicking the first query so every step anchors to a real element.

import { startTour } from './tour.js';

async function primeExploreTab() {
  const firstBtn = document.querySelector('#query-accordion .accordion-button');
  if (firstBtn && firstBtn.classList.contains('collapsed')) {
    firstBtn.click();
  }
  await new Promise(resolve => setTimeout(resolve, 380));

  const firstQuery = document.querySelector('#query-accordion .list-group-item');
  if (firstQuery) {
    firstQuery.click();
    await waitForElementVisible('#query-card', 1500);
  }
}

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

export async function startExploreTour() {
  await primeExploreTab();

  startTour([
    {
      element: '#query-accordion .list-group-item.active',
      title: 'A library of ready-made queries',
      content:
        'SPARQL queries grouped by category. We opened the first category for you — click any ' +
        'other category to expand it, then click a query to preview it on the right.',
      placement: 'right',
    },
    {
      element: '#query-action-buttons',
      title: 'Preview and action',
      content:
        'When you pick a query from the library, its SPARQL code and description appear on ' +
        'the right part of the screen. Click on <strong>Try this query</strong> to run it ' +
        'straight away, or click on <strong>Customise</strong> to tweak it for your own needs.',
      placement: 'top',
    },
    {
      element: '#contribute-query-link',
      title: 'Got a query worth sharing?',
      content:
        'The library is community-curated. If you know SPARQL and have written a query that ' +
        'others might find useful, follow this link to learn how to contribute it back.',
      placement: 'top',
    },
    {
      title: 'Then what?',
      content:
        'The results land on the <strong>Reuse</strong> tab: as a sortable table for SELECT ' +
        'queries, or as an interactive knowledge graph for CONSTRUCT and DESCRIBE. Either way, ' +
        'you can download everything or grab a URL you can use to fetch live data from your apps.',
    },
  ]);
}
