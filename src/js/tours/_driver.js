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
// Shared driver.js loader for the per-tab guided tours.
//
// The five per-tab tour modules (inspectTour, exploreTour,
// customizeTour, reuseSelectTour, reuseGraphTour) used to each
// declare their own `let driverPromise = null` and their own
// `loadDriver()` with comments claiming the cache was "shared
// with other tours". The comment was a lie: module-local state is
// not shared, so every tour opened triggered its own CDN fetch.
//
// Moving the cache here gives us one real shared promise (so
// driver.js is fetched once per session) and one shared
// `createTour(steps)` factory (so the driver config does not
// drift between tours).

let driverPromise = null;

/**
 * Lazy-load driver.js from jsDelivr on first use. Reuses the same
 * promise across all tours so the module is only pulled once per
 * session. On failure the cached promise is cleared so a later
 * retry can succeed once the network comes back.
 * @returns {Promise<Function>}  resolves to the `driver` constructor
 */
export async function loadDriver() {
  if (driverPromise) return driverPromise;

  driverPromise = import('https://cdn.jsdelivr.net/npm/driver.js@1.3.1/+esm')
    .then(mod => mod.driver)
    .catch(err => {
      // Clear the cache so a subsequent click can retry. Without
      // this, a one-off CDN blip would dead-lock every tour for
      // the rest of the session.
      driverPromise = null;
      throw err;
    });

  return driverPromise;
}

// Shared base config for every tour. Individual tours provide only
// their `steps` array; everything else (no backdrop dim, progress
// text, button labels, padding) stays identical across tours.
const BASE_CONFIG = {
  showProgress: true,
  allowClose: true,
  overlayOpacity: 0,
  stagePadding: 6,
  stageRadius: 6,
  progressText: '{{current}} of {{total}}',
  nextBtnText: 'Next →',
  prevBtnText: '← Back',
  doneBtnText: 'Got it',
};

/**
 * Build a driver instance for the given steps, applying the shared
 * base config. Callers still own the `tour.drive()` invocation and
 * the `tour.destroy()` cleanup.
 *
 * @param {Function} driver - the resolved driver constructor
 * @param {Array} steps - the tour's step definitions
 * @returns {object} a driver instance
 */
export function createTour(driver, steps) {
  return driver({ ...BASE_CONFIG, steps });
}
