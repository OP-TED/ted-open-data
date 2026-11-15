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

// Service notice — a banner below the tabs that maintainers switch on and off
// without releasing the app. Its setting lives in notice.json on the protected
// `data/service-notice` branch, read at page load the same way the exchange rates
// are (see epoCompletion.js). The `refs/heads/` form is required because the
// branch name contains a slash.
//
// The notice must never get in the way of the page: if the file cannot be
// fetched, is malformed, or says not to show, nothing is shown.

export const SERVICE_NOTICE_URL =
  'https://raw.githubusercontent.com/OP-TED/ted-open-data/refs/heads/data/service-notice/notice.json';
const SERVICE_NOTICE_TIMEOUT_MS = 4000;
// Icon per level, so the level is not told by colour alone. An error is announced
// at once (role="alert"); the others wait until the user pauses (role="status"),
// as the TED design system's Notification does.
const LEVELS = {
  info: { icon: 'bi-info-circle-fill', role: 'status' },
  warning: { icon: 'bi-exclamation-triangle-fill', role: 'status' },
  error: { icon: 'bi-x-circle-fill', role: 'alert' },
};

/**
 * Validate the content of notice.json.
 * @param {unknown} data - parsed JSON
 * @returns {{ level: string, title: string, message: string } | null} what to show, or null for nothing
 */
export function parseServiceNotice(data) {
  if (!data || typeof data !== 'object' || data.show !== true) return null;
  const text = value => (typeof value === 'string' ? value.trim() : '');
  const message = text(data.message);
  if (!message) return null;
  const level = Object.hasOwn(LEVELS, data.level) ? data.level : 'warning';
  return { level, title: text(data.title), message };
}

/**
 * Fetch the notice setting and fill in the banner element if it says to show.
 * @param {HTMLElement | null} element - the #service-notice element
 */
export async function loadServiceNotice(element, url = SERVICE_NOTICE_URL) {
  if (!element) return;
  // AbortController rather than AbortSignal.timeout(), for the reason given in epoCompletion.js.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVICE_NOTICE_TIMEOUT_MS);
  try {
    // no-store so that switching the notice off is not held back by the browser cache.
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return;
    const notice = parseServiceNotice(await response.json());
    if (!notice) return;
    // Role first, so the text that follows is announced.
    element.setAttribute('role', LEVELS[notice.level].role);
    const title = element.querySelector('.service-notice__title');
    title.textContent = notice.title;
    title.hidden = !notice.title;
    element.querySelector('.service-notice__text').textContent = notice.message;
    element.querySelector('.service-notice__icon').classList.add(LEVELS[notice.level].icon);
    element.dataset.level = notice.level;
    element.hidden = false;
  } catch (err) {
    console.warn('Service notice unavailable:', err);
  } finally {
    clearTimeout(timer);
  }
}
