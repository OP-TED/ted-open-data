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
// SearchPanel — the Search tab's notice input and history dropdown.
// In the merged ted-open-data app there is no SPARQL mode toggle on
// this panel; custom SPARQL is composed in the Query Editor tab,
// which is the single editor surface for the whole app. Sharing of
// the current view lives in DataView (next to the data card title)
// since that's where the user is actually looking at what they want
// to share.

import { createPublicationNumberFacet, getLabel } from './facets.js';
import { getRandomPublicationNumber } from './services/randomNotice.js';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Format an ISO date like "2024-12-24+01:00" → "24 Dec 2024".
function _formatShortDate(dateStr) {
  if (!dateStr) return '';
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  return `${parseInt(m[3])} ${SHORT_MONTHS[parseInt(m[2]) - 1]} ${m[1]}`;
}

class SearchPanel {
  constructor(controller, { showExplorerTab } = {}) {
    this.controller = controller;
    this.showExplorerTab = showExplorerTab || (() => {});

    this.input = document.getElementById('search-input');
    this.searchBtn = document.getElementById('search-btn');
    this.luckyLink = document.getElementById('lucky-link');
    this.datalist = document.getElementById('search-history');
    this.historyMenu = document.getElementById('history-menu');

    this._bindEvents();
    this._listen();
  }

  // Exposed to other panels (NoticeView, app.js) so they can mirror a
  // selected publication number into the search box without reaching
  // into another panel's DOM directly.
  setInputValue(value) {
    this.input.value = value;
  }

  _bindEvents() {
    this.searchBtn.addEventListener('click', () => this._search());
    this.input.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') this._search();
    });
    this.luckyLink.addEventListener('click', (e) => {
      e.preventDefault();
      this._lucky();
    });
  }

  _listen() {
    this.controller.addEventListener('facet-changed', () => this._updateUI());
    this.controller.addEventListener('facets-list-changed', () => this._updateUI());
    this.controller.addEventListener('loading-changed', () => this._updateLoadingState());
  }

  _search() {
    const value = this.input.value.trim();
    if (!value) return;
    const facet = createPublicationNumberFacet(value);
    if (!facet) return;
    this.controller.search(facet);
    // Direct user gesture (button or Enter) → switch to Explore tab.
    this.showExplorerTab();
  }

  async _lucky() {
    this._clearLuckyError();
    try {
      const pubNumber = await getRandomPublicationNumber();
      this.input.value = pubNumber;
      this._search();
    } catch (e) {
      console.error('Lucky failed:', e);
      this._showLuckyError(e?.message || 'Failed to pick a random notice.');
    }
  }

  // Public entry point so other panels (DataView's not-found state) can
  // trigger the same lucky flow without reaching into private methods.
  pickRandom() {
    return this._lucky();
  }

  // Show / hide an inline error message inside the lucky-hint paragraph.
  // Lives next to the lucky link itself so the user sees the failure
  // exactly where they clicked, instead of having to check the console.
  _showLuckyError(message) {
    let el = document.getElementById('lucky-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lucky-error';
      el.className = 'text-danger small mt-1';
      this.luckyLink.parentElement.appendChild(el);
    }
    el.textContent = message;
  }

  _clearLuckyError() {
    const el = document.getElementById('lucky-error');
    if (el) el.remove();
  }

  _updateLoadingState() {
    const loading = this.controller.isLoading;
    this.searchBtn.disabled = loading;
    this.searchBtn.innerHTML = loading
      ? '<span class="spinner-border spinner-border-sm"></span>'
      : '<i class="bi bi-search"></i>';
  }

  _updateUI() {
    this._updateDatalist();
    this._updateHistoryMenu();
  }

  // The datalist drives the input's native autocomplete. Only past notice
  // numbers are offered (SPARQL queries have no meaningful input-level suggestion).
  _updateDatalist() {
    this.datalist.innerHTML = '';
    const seen = new Set();
    for (const facet of this.controller.facetsList) {
      if (facet.type === 'notice-number' && !seen.has(facet.value)) {
        seen.add(facet.value);
        const option = document.createElement('option');
        option.value = facet.value;
        this.datalist.appendChild(option);
      }
    }
  }

  // History dropdown lists past notice searches. Queries and URI clicks
  // are deliberately not persisted (queries have no human label; URIs are
  // a breadcrumb concept).
  _updateHistoryMenu() {
    this.historyMenu.innerHTML = '';
    const searches = this.controller.facetsList;

    if (searches.length === 0) {
      this.historyMenu.appendChild(this._buildEmptyHistoryItem());
      return;
    }

    const current = this.controller.currentFacet;
    // Most recent first.
    [...searches].reverse().forEach(facet => {
      this.historyMenu.appendChild(this._buildHistoryItem(facet, facet === current));
    });

    this.historyMenu.appendChild(this._buildDivider());
    this.historyMenu.appendChild(this._buildClearHistoryItem());
  }

  _buildEmptyHistoryItem() {
    const li = document.createElement('li');
    li.innerHTML = '<span class="dropdown-item text-muted fst-italic">No history</span>';
    return li;
  }

  _buildHistoryItem(facet, isActive) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'dropdown-item';
    if (isActive) a.classList.add('active');
    a.href = '#';

    const label = document.createElement('div');
    label.className = 'fw-semibold';
    label.textContent = getLabel(facet);
    if (facet.noticeVersion > 1) {
      const v = document.createElement('small');
      v.className = isActive ? 'text-white-50 ms-1' : 'text-muted ms-1';
      v.textContent = `v${facet.noticeVersion}`;
      label.appendChild(v);
    }
    a.appendChild(label);

    const metaText = this._buildHistoryItemMetaText(facet);
    if (metaText) {
      const meta = document.createElement('small');
      meta.className = isActive ? 'text-white-50' : 'text-muted';
      meta.textContent = metaText;
      a.appendChild(meta);
    }

    a.addEventListener('click', (e) => {
      e.preventDefault();
      // Mirror the publication number into the search box, the same way
      // the lucky link does. The input then accurately reflects "what is
      // currently being looked at" rather than a stale earlier value.
      if (facet.type === 'notice-number') {
        this.input.value = facet.value;
      }
      this.controller.selectFromHistory(facet);
      // Direct user gesture (history dropdown click) → switch to Explore tab.
      this.showExplorerTab();
    });

    li.appendChild(a);
    return li;
  }

  // Build the second-line metadata text for a notice history item. Each
  // field is optional — older entries (or entries from a fast tab close)
  // may have only the publication number.
  _buildHistoryItemMetaText(facet) {
    // All enriched fields are pre-normalised to primitives at the tedAPI
    // boundary (noticeType/formType to `string | null`, buyerCountry to a
    // joined string). No defensive type coercion needed here.
    const parts = [];
    if (facet.publicationDate) parts.push(_formatShortDate(facet.publicationDate));
    if (facet.noticeType) {
      parts.push(facet.formType ? `${facet.noticeType} - ${facet.formType}` : facet.noticeType);
    }
    if (facet.buyerCountry)    parts.push(facet.buyerCountry);
    if (facet.customizationId) parts.push(facet.customizationId);
    return parts.join(' · ');
  }

  _buildDivider() {
    const li = document.createElement('li');
    li.innerHTML = '<hr class="dropdown-divider">';
    return li;
  }

  _buildClearHistoryItem() {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'dropdown-item text-danger';
    a.href = '#';
    a.innerHTML = '<i class="bi bi-trash3"></i> Clear history';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      this.controller.clearHistory();
    });
    li.appendChild(a);
    return li;
  }

  // Called once at startup. Loads a facet only if it was explicitly
  // provided in the URL — otherwise the app stays put on the Search tab
  // with an empty input. We deliberately do not auto-replay the most
  // recent history entry: reload should restore the page, not invent
  // activity the user did not request. The history dropdown is the
  // explicit, user-initiated way to revisit a past search.
  async init() {
    // Hydrate the history dropdown from whatever the controller loaded
    // out of sessionStorage at construction time. Without this, the
    // dropdown only populates after the first facets-list-changed event
    // (i.e. after the next search), which looks to users like "reload
    // clears history and a new search brings it back."
    this._updateUI();

    const result = this.controller.initFromUrlParams();
    if (result.status === 'invalid') {
      this._showUrlLoadError(result.reason);
      return;
    }
    if (result.status === 'loaded') {
      // Mirror the loaded notice number into the search input for the
      // same reason the lucky link, history dropdown and timeline click
      // do: the input always reflects "what's currently being looked at."
      const facet = this.controller.currentFacet;
      if (facet?.type === 'notice-number') {
        this.input.value = facet.value;
      }
      // Fresh navigation from a shared link carries explicit intent: the
      // recipient was sent here to look at a notice, so jump straight to
      // the Explore tab. Reloads (F5/⌘R) preserve the current tab so the
      // user lands back where they were. If the Navigation Timing API is
      // unavailable, default to switching — a fresh share URL is the
      // overwhelmingly common case.
      const navType = performance.getEntriesByType('navigation')[0]?.type;
      if (navType !== 'reload') {
        this.showExplorerTab();
      }
    }
  }

  // Surfaces a dismissible Bootstrap alert when a shared ?facet= URL
  // fails to parse or validate. Without this, the recipient of a broken
  // link would land on a blank Search tab with no indication that a
  // facet was even attempted.
  _showUrlLoadError(reason) {
    const el = document.getElementById('url-load-error');
    const textEl = document.getElementById('url-load-error-text');
    const closeBtn = document.getElementById('url-load-error-close');
    if (!el || !textEl) return;

    const message = reason === 'parse'
      ? 'The shared link could not be loaded: the facet parameter is not valid JSON.'
      : 'The shared link could not be loaded: the facet does not match any supported shape.';
    textEl.textContent = message;
    el.style.display = '';
    closeBtn?.addEventListener('click', () => { el.style.display = 'none'; }, { once: true });
  }
}

export { SearchPanel };
