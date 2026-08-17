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
// Guided tour for the Reuse tab — SELECT lane — 4 steps.
// No priming needed — the trigger only exists when results are visible.

import { startTour } from './tour.js';

export function startReuseSelectTour() {
  const steps = [
    {
      element: '#results',
      title: 'Your results',
      content:
        'The rows returned by your SPARQL query, shown as a table. Each column is one of the ' +
        'variables you asked for in the SELECT clause.',
      placement: 'top',
    },
  ];

  // Only include the chart step when the Table/Chart toggle is actually
  // visible (i.e. the results are chartable; ECharts itself loads on demand
  // when the toggle is clicked). Otherwise the toggle is `d-none` and the
  // popover would anchor to a hidden element.
  const viewToggle = document.getElementById('results-view-toggle');
  if (viewToggle && !viewToggle.classList.contains('d-none')) {
    steps.push({
      element: '#results-view-toggle',
      title: 'Table or chart',
      content:
        'When your results have a numeric column, switch from the table to an interactive ' +
        'chart — bar, line, pie or scatter — and choose which columns to plot on each axis.',
      placement: 'bottom',
    });
  }

  steps.push(
    {
      element: '#copy-url-button',
      title: 'Copy Query',
      content:
        'Copy the query as a link, raw SPARQL text, or a cURL command. The query link returns ' +
        'these results as JSON — paste it into Excel, Power BI or any HTTP client for live data.',
      placement: 'bottom',
    },
    {
      element: '#download-as-button',
      title: 'Download the results',
      content:
        'Save the results to a file in the format that fits your workflow — JSON, CSV, TSV, ' +
        'Excel spreadsheet or XML.',
      placement: 'bottom',
    },
    {
      title: 'Want to change the query?',
      content:
        'Go back to the <strong>Customize</strong> tab to edit the SPARQL and run it again, ' +
        'or visit the <strong>Explore</strong> tab to pick a different ready-made query from ' +
        'the library.',
    },
  );

  startTour(steps);
}
