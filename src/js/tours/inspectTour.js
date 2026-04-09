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
 * Interactive guided tour for the Inspect tab.
 *
 * Walks the user through the canonical lookup flow: type a
 * publication number, use history, or pick a random notice. Four
 * steps, scoped to the elements visible on a cold Inspect tab.
 *
 * Driver.js is loaded once per session via the shared _driver module
 * and the driver instance is reused across opens (destroyed only
 * when a *new* open replaces it), so repeated clicks do not leak
 * window/resize listeners or overlay DOM.
 */

import { createTour, loadDriver } from './_driver.js';

let activeTour = null;

/**
 * Start the Inspect tab tour. Any previous instance is destroyed
 * first so only one tour is ever live at a time.
 */
export async function startInspectTour() {
  const driver = await loadDriver();

  if (activeTour) {
    try { activeTour.destroy(); } catch { /* best-effort cleanup */ }
    activeTour = null;
  }

  activeTour = createTour(driver, [
    {
      element: '#search-input',
      popover: {
        title: 'Look up a notice',
        description:
          'Type a TED publication number here — the format is usually something like ' +
          '<code>123456-2024</code>. Press Enter or click the magnifying glass to fetch it.',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '#history-btn',
      popover: {
        title: 'Your recent lookups',
        description:
          'Every notice you look up is remembered here so you can jump back to it without retyping. ' +
          'The list lives in your browser — nothing is sent anywhere.',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '#lucky-link',
      popover: {
        title: 'Not sure where to start?',
        description:
          'Click this to pick a random notice from the dataset. Handy if you just want to see ' +
          'what a notice looks like before you have a specific one in mind.',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      // No element — driver.js renders a centered modal. The target
      // would be the Reuse-tab graph-lane button (#app-tab-explorer),
      // but that tab is hidden until the first lookup runs, so
      // anchoring would fail on cold load.
      popover: {
        title: 'Then what?',
        description:
          'Once you press Enter, you are taken straight to the <strong>Reuse</strong> tab to ' +
          'inspect the notice as a linked-data graph — browse every property, follow the ' +
          'links between resources, and download the whole thing when you are done.',
      },
    },
  ]);

  activeTour.drive();
}
