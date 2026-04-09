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
// Tiny wrapper around the shared #copyUrlToast element so every user-
// facing message — success, error, or plain info — goes through one
// entry point. The toast DOM lives in index.html and is populated
// dynamically on each show; callers pass a title and a body and
// (optionally) a variant for the coloured accent.
//
// The element was originally introduced for the Copy URL / Share view
// success messages, but nothing about the DOM is specific to those
// flows, so we reuse it for error toasts too instead of adding a
// second toast element to index.html.

const TOAST_ID = 'copy-url-toast';
const TOAST_TITLE_ID = 'copy-url-toast-title';
const TOAST_BODY_ID = 'copy-url-toast-body';

const VARIANT_CLASSES = {
  success: [],
  danger: ['text-bg-danger'],
  warning: ['text-bg-warning'],
  info: ['text-bg-info'],
};
// Track the last-applied variant classes so we can strip them cleanly
// on the next show without fighting Bootstrap's own class management.
let lastVariantClasses = [];

/**
 * Show the shared toast with the given title and body.
 *
 * @param {string} title - Toast header text.
 * @param {string} body  - Toast body text.
 * @param {{variant?: 'success'|'danger'|'warning'|'info'}} [options]
 *   - `variant` controls the coloured accent on the toast. Defaults
 *     to `'success'`, which leaves the toast in its base (plain)
 *     styling.
 */
export function showToast(title, body, { variant = 'success' } = {}) {
  const toastEl = document.getElementById(TOAST_ID);
  const titleEl = document.getElementById(TOAST_TITLE_ID);
  const bodyEl = document.getElementById(TOAST_BODY_ID);

  // If any of the expected elements are missing (template regression,
  // stripped-down test harness), log and bail — don't throw. A broken
  // toast must not take a click handler down with it.
  if (!toastEl || !titleEl || !bodyEl) {
    console.warn('showToast: toast DOM is incomplete; message dropped:', { title, body });
    return;
  }
  if (typeof bootstrap === 'undefined' || !bootstrap.Toast) {
    console.warn('showToast: bootstrap.Toast is not available; message dropped:', { title, body });
    return;
  }

  titleEl.textContent = title;
  bodyEl.textContent = body;

  // Strip any variant classes left over from a previous call before
  // applying the new ones.
  toastEl.classList.remove(...lastVariantClasses);
  const next = VARIANT_CLASSES[variant] || [];
  toastEl.classList.add(...next);
  lastVariantClasses = next;

  bootstrap.Toast.getOrCreateInstance(toastEl).show();
}
