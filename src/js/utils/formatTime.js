/*
 * Copyright 2026 European Union
 *
 * Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
 * Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */

/**
 * Format an elapsed time (in seconds) into a human-readable string.
 * Under 60 seconds: "3.2s"
 * 60 seconds or above: "2m 5s"
 *
 * @param {string|number} seconds - Elapsed time in seconds (e.g. "3.2" or 125.7)
 * @returns {string} Formatted time string
 */
export function formatElapsedTime(seconds) {
  const num = parseFloat(seconds);
  if (num >= 60) {
    const minutes = Math.floor(num / 60);
    const secs = Math.round(num % 60);
    return `${minutes}m ${secs}s`;
  }
  return `${seconds}s`;
}
