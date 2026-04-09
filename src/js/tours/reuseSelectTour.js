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
 * Interactive guided tour for the Reuse tab — SELECT lane.
 *
 * Shown when a SELECT query has produced a tabular result set. The
 * tour walks through the three things a user can do with a tabular
 * result: read it, copy the endpoint URL so it can be loaded live
 * from another application, or download a file in the format that
 * best fits their workflow.
 *
 * No priming is needed — the trigger only exists inside the
 * SELECT-lane toolbar, which is itself hidden until a query has
 * successfully returned rows. By the time the user can click the
 * trigger, the table, the Copy endpoint URL button and the Download
 * as… dropdown are all guaranteed to exist and be visible.
 */

import { createTour, loadDriver } from './_driver.js';

let activeTour = null;

/**
 * Start the Reuse (SELECT lane) tour. Any previous instance is
 * destroyed first so only one tour is ever live at a time.
 */
export async function startReuseSelectTour() {
  const driver = await loadDriver();

  if (activeTour) {
    try { activeTour.destroy(); } catch { /* best-effort cleanup */ }
    activeTour = null;
  }

  activeTour = createTour(driver, [
    {
      element: '#results',
      popover: {
        title: 'Your results',
        description:
          'The rows returned by your SPARQL query, shown as a table. Each column is one of the ' +
          'variables you asked for in the SELECT clause.',
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '#copy-url-button',
      popover: {
        title: 'Copy endpoint URL',
        description:
          'Copies a URL that returns exactly these results as JSON. Paste it into Excel, ' +
          'Power BI or any other application that can load JSON from a URL, and you will always ' +
          'see the latest data without having to re-run the query by hand.',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '#download-as-button',
      popover: {
        title: 'Download the results',
        description:
          'Save the results to a file in the format that fits your workflow — JSON, CSV, TSV, ' +
          'Excel spreadsheet or XML.',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      // Centered modal — closes the loop back to the other tabs.
      popover: {
        title: 'Want to change the query?',
        description:
          'Go back to the <strong>Customize</strong> tab to edit the SPARQL and run it again, ' +
          'or visit the <strong>Explore</strong> tab to pick a different ready-made query from ' +
          'the library.',
      },
    },
  ]);

  activeTour.drive();
}
