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
 * Interactive guided tour for the Inspect tab.
 *
 * Anchors popovers to the real UI elements on the Inspect tab and walks
 * the user through the canonical lookup flow: type a publication number,
 * use history, or pick a random notice. Four steps total, scoped to the
 * elements visible on a cold Inspect tab (no results card).
 *
 * Driver.js is imported lazily so users who never click the tour icon
 * pay zero cost on initial load. The first click of any tour trigger
 * pulls the module from the CDN (~20 kB gzipped) and caches it.
 *
 * This is the reference implementation — Explore/Customize/Reuse tours
 * will follow the same shape.
 */

let driverPromise = null;

/**
 * Lazy-load driver.js on first use. All subsequent calls reuse the
 * same promise so the module is only fetched once per session.
 * @returns {Promise<Function>} resolves to the driver() constructor
 */
function loadDriver() {
  if (!driverPromise) {
    driverPromise = import('https://cdn.jsdelivr.net/npm/driver.js@1.3.1/+esm')
      .then(mod => mod.driver);
  }
  return driverPromise;
}

/**
 * Start the Inspect tab tour.
 * Caller is responsible for ensuring the Inspect tab is currently
 * visible — the tour anchors to elements inside #app-search and will
 * misbehave if that pane is hidden.
 */
export async function startInspectTour() {
  const driver = await loadDriver();

  const tour = driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0,          // no backdrop dim — match SDK Explorer's "you're still using the app" feel
    stagePadding: 6,
    stageRadius: 6,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next →',
    prevBtnText: '← Back',
    doneBtnText: 'Got it',
    steps: [
      {
        element: '#search-input',
        popover: {
          title: 'Look up a notice',
          description:
            'Type a TED publication number here — the format is usually something like ' +
            '<code>123456-2024</code>. Hit Enter or click the magnifying glass to fetch it.',
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
        // would be the Reuse tab button, but that tab is hidden until
        // the first query runs, so anchoring would fail on cold load.
        popover: {
          title: 'Then what?',
          description:
            'Once you hit Enter, you are taken straight to the <strong>Reuse</strong> tab to ' +
            'inspect the notice as a linked-data graph — browse every property, follow the ' +
            'links between resources, and download the whole thing when you are done.',
        },
      },
    ],
  });

  tour.drive();
}
