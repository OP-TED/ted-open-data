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
  startTour([
    {
      element: '#results',
      title: 'Your results',
      content:
        'The rows returned by your SPARQL query, shown as a table. Each column is one of the ' +
        'variables you asked for in the SELECT clause.',
      placement: 'top',
    },
    {
      element: '#copy-url-button',
      title: 'Copy endpoint URL',
      content:
        'Copies a URL that returns exactly these results as JSON. Paste it into Excel, ' +
        'Power BI or any other application that can load JSON from a URL, and you will always ' +
        'see the latest data without having to re-run the query by hand.',
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
  ]);
}
