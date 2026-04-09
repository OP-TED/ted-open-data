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
// Shared browser-side file download helper.
//
// Both the SELECT-lane "Download as…" (QueryResults) and the graph-
// lane "Download as…" (DataView) build a Blob from a string payload
// and trigger a file download via a temporary <a download> element.
// The logic was duplicated verbatim in both callers, including the
// tricky 100ms deferred `URL.revokeObjectURL` which exists to work
// around a real Chromium race:
//
//   If the blob URL is revoked synchronously right after .click(),
//   Chromium's download pipeline (which reads the blob URL
//   asynchronously, a moment after the click event) sometimes sees
//   the URL already gone and falls back to saving the file with a
//   GUID filename and no extension.
//
// Extracting the helper keeps the race-fix in exactly one place.

/**
 * Trigger a browser file download for the given text payload.
 *
 * The content type is hard-coded to `application/octet-stream` so
 * the browser always saves rather than attempting to render HTML /
 * XML / CSV / JSON inline in a new tab. The actual extension comes
 * from the `filename` argument.
 *
 * @param {string} content  - Text payload to download.
 * @param {string} filename - Full filename including extension
 *                            (e.g. "query-results.csv").
 */
export function triggerBlobDownload(content, filename) {
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  // Defer the revoke so Chromium's async download pipeline has a
  // chance to read the blob URL before it disappears. 100ms is
  // generous enough for every browser we care about.
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}
