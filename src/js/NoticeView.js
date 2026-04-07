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
// NoticeView — fetches procedure metadata from the TED API and renders a
// horizontal timeline of all notices in the procedure. The timeline is shown
// in two places:
//   1. the Search tab, as the result of a notice-number search
//   2. the Explorer tab, as a collapsible mini-card above the tree
// Both copies stay in sync: a click navigates everywhere, a highlight-only
// update (same procedure, different notice selected) avoids refetching.

import { createPublicationNumberFacet, getQuery } from './facets.js';
import {
  extractProcedureIds,
  getNoticeByPublicationNumber,
  getRequest,
  mapResponse,
} from './services/tedAPI.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Upper bound for TED API calls. Hung endpoints otherwise leave the spinner
// running forever. 30s is generous for the real API's response time (~1-3s)
// while still failing clearly when the endpoint is actually unreachable.
const TED_API_TIMEOUT_MS = 30_000;

// fetch() with an AbortController-based timeout. Throws `TimeoutError`
// (just a plain Error with a recognisable name) when the timer fires
// before the response arrives.
async function _fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error(`TED API request timed out after ${timeoutMs}ms`);
      e.name = 'TimeoutError';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Form-type → Bootstrap icon. Form-type is a small, semantic vocabulary
// (planning / competition / result / change / …) that maps cleanly to
// glyphs the user can learn at a glance. Notice-type is left as text.
const FORM_TYPE_ICONS = {
  'planning':    'bi-calendar-event',
  'competition': 'bi-megaphone',
  'result':      'bi-trophy',
  'change':      'bi-pencil-square',
  'directive':   'bi-file-text',
};
const FORM_TYPE_FALLBACK_ICON = 'bi-file-earmark-text';

// Build a Bootstrap Icons <i> element.
function _iconEl(iconClass) {
  const i = document.createElement('i');
  i.className = `bi ${iconClass}`;
  return i;
}

// Format an ISO date like "2024-12-24+01:00" as "24 Dec 2024 (+01:00)".
// One regex captures the date and (optional) timezone in one go, with no
// chained replacements:
//   YYYY-MM-DD                     → "24 Dec 2024"
//   YYYY-MM-DD+HH:MM / -HH:MM / Z  → "24 Dec 2024 (+01:00)"
//   YYYY-MM-DDTHH:MM:SSZ           → "24 Dec 2024 (Z)"
function _formatDate(dateStr) {
  if (!dateStr) return '';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:T[^+\-Z]*)?([+\-]\d{2}:\d{2}|Z)?$/);
  if (!match) return dateStr;
  const [, y, m, d, tz] = match;
  const friendly = `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
  return tz ? `${friendly} (${tz})` : friendly;
}

class NoticeView {
  constructor(controller, { showExplorerTab, setSearchInput, loadEditorText, setActiveResultTab } = {}) {
    this.controller = controller;
    this.showExplorerTab = showExplorerTab || (() => {});
    // Called when the user navigates via a timeline click so the Search
    // input mirrors "the notice currently being looked at", matching the
    // behaviour of the lucky link and the History dropdown.
    this.setSearchInput = setSearchInput || (() => {});
    // Stage 8 — same Search-tab editor reflection as SearchPanel: when
    // a timeline sibling is clicked, drop the canned CONSTRUCT for the
    // sibling notice into the SPARQL editor as a side effect, so the
    // Query Editor tab stays in sync with what's currently being
    // shown on Explore.
    this.loadEditorText = loadEditorText || (() => {});
    // Stage 12 — graph lane wins on timeline navigation.
    this.setActiveResultTab = setActiveResultTab || (() => {});

    // Search tab DOM refs
    this.resultsCard = document.getElementById('notice-results');
    this.procedureCardTitle = document.getElementById('procedure-card-title');
    this.proceduresContainer = document.getElementById('procedures-container');
    this.loadingEl = document.getElementById('notice-loading');
    this.errorEl = document.getElementById('notice-error');

    // Explorer tab DOM refs (mini procedure card above the tree)
    this.explorerProcedureMini = document.getElementById('explorer-procedure-mini');
    this.explorerProcedureTitle = document.getElementById('explorer-procedure-title');
    this.explorerProceduresContainer = document.getElementById('explorer-procedures-container');

    // Cached notice list from the most recent procedure fetch, used to
    // recognise when a newly selected facet belongs to the same procedure.
    this._lastProcedureNotices = null;

    // Monotonic token for in-flight TED API fetches. Each call to _fetchData
    // bumps it; responses that return after the user moved on get dropped.
    this._fetchToken = 0;

    this.controller.addEventListener('facet-changed', () => this._onFacetChanged());
  }

  _onFacetChanged() {
    const root = this.controller.breadcrumb[0];
    if (!root || root.type !== 'notice-number') {
      this._hide();
      return;
    }

    this._show();

    // Same procedure, different notice: just move the highlight and
    // enrich the freshly-added history entry from the cached procedure
    // data — no need to refetch the procedure timeline.
    if (this._lastProcedureNotices && this._isInLastProcedure(root.value)) {
      this._updateHighlight(root.value);
      this._enrichHistoryEntry(root.value);
      return;
    }

    this._fetchData(root.value);
  }

  // Look up `publicationNumber` in the cached procedure data and merge its
  // timeline metadata into the matching history entry on the controller.
  // No-op when there is no match (different procedure / not yet loaded).
  _enrichHistoryEntry(publicationNumber) {
    const matched = this._lastProcedureNotices?.find(
      n => n.publicationNumber === publicationNumber
    );
    if (!matched) return;
    this.controller.enrichNoticeFacet(publicationNumber, {
      publicationDate: matched.publicationDate,
      noticeType: matched.noticeType,
      formType: matched.formType,
      buyerCountry: matched.buyerCountry,
      customizationId: matched.customizationId,
      noticeVersion: matched.noticeVersion,
    });
  }

  _show() {
    this.resultsCard.style.display = '';
    this.explorerProcedureMini.style.display = '';
  }

  _hide() {
    this.resultsCard.style.display = 'none';
    this.explorerProcedureMini.style.display = 'none';
  }

  _isInLastProcedure(publicationNumber) {
    return this._lastProcedureNotices?.some(n => n.publicationNumber === publicationNumber);
  }

  _updateHighlight(currentPubNumber) {
    // Read the publication number from a data attribute on the card,
    // not by parsing the rendered text. The previous textContent.split(' ')
    // approach silently broke the moment _buildPubNumber's layout changed.
    const containers = [this.proceduresContainer, this.explorerProceduresContainer];
    for (const container of containers) {
      for (const item of container.querySelectorAll('.timeline-item')) {
        item.classList.toggle('current', item.dataset.publicationNumber === currentPubNumber);
      }
    }
  }

  async _fetchData(publicationNumber) {
    // Bump the token and capture it locally. If the user searches another
    // notice (or navigates away) while we await the TED API, the later
    // resolutions will no longer match and get dropped instead of rendering
    // stale procedure data into freshly cleared containers.
    const token = ++this._fetchToken;

    this._clearContainers();
    this.errorEl.style.display = 'none';
    this.loadingEl.style.display = '';

    try {
      const procedureIds = await this._fetchProcedureIdsForNotice(publicationNumber);
      if (token !== this._fetchToken) return;

      if (!procedureIds.length) {
        // Zero procedures means either the notice doesn't exist or it
        // exists but has no procurement procedure attached. Both cases
        // are handled by DataView's "Notice not found" state on the
        // Explore tab (triggered by the SPARQL CONSTRUCT also returning
        // zero triples, which happens in lockstep with this branch).
        // Hide the entire procedure-timeline card here so the user
        // doesn't see a second, less clear message on the Search tab.
        this.loadingEl.style.display = 'none';
        this.resultsCard.style.display = 'none';
        this.explorerProcedureMini.style.display = 'none';
        return;
      }

      const procedures = await this._fetchProcedures(procedureIds);
      if (token !== this._fetchToken) return;

      this.loadingEl.style.display = 'none';
      this._lastProcedureNotices = procedures.flatMap(p => p.notices);
      this._enrichHistoryEntry(publicationNumber);

      // Render into both containers; set matching titles.
      for (const container of [this.proceduresContainer, this.explorerProceduresContainer]) {
        procedures.forEach(p => this._renderProcedure(p, publicationNumber, container));
      }
      this._setProcedureTitle(this.explorerProcedureTitle, procedures);
      this._setProcedureTitle(this.procedureCardTitle, procedures);
    } catch (err) {
      if (token !== this._fetchToken) return;
      this.loadingEl.style.display = 'none';
      this.errorEl.textContent = err.message || 'Failed to fetch notice data';
      this.errorEl.style.display = '';
    }
  }

  _clearContainers() {
    this.proceduresContainer.innerHTML = '';
    this.explorerProceduresContainer.innerHTML = '';
  }

  async _fetchProcedureIdsForNotice(publicationNumber) {
    const { url, options } = getNoticeByPublicationNumber(publicationNumber);
    const response = await _fetchWithTimeout(url, options, TED_API_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`TED API ${response.status} ${response.statusText}`.trim());
    }
    const data = await response.json();
    return extractProcedureIds(data);
  }

  // Fetch the full notice list for each procedure ID. Errors on one procedure
  // are captured as per-procedure `error` fields so partial results can render.
  async _fetchProcedures(procedureIds) {
    return Promise.all(
      procedureIds.map(async (procedureId) => {
        try {
          const { url, options } = getRequest(procedureId);
          const response = await _fetchWithTimeout(url, options, TED_API_TIMEOUT_MS);
          if (!response.ok) {
            throw new Error(`TED API ${response.status} ${response.statusText}`.trim());
          }
          const data = await response.json();
          return { procedureId, notices: mapResponse(data), error: null };
        } catch (err) {
          return { procedureId, notices: [], error: err?.message || 'Failed to fetch procedure' };
        }
      })
    );
  }

  // Render the card-header content: "Procedure Timeline" on the left, the
  // procedure ID(s) pushed to the right in a monospace font. `flex-grow-1`
  // lets this work both for the Search-tab card-header (where the target
  // element is the card-header itself) and for the Explorer mini card
  // (where the target is a span sharing a d-flex parent with the chevron).
  // `align-items-baseline` keeps the sans-serif label and the monospace IDs
  // visually aligned on the text baseline — centering by line-box would
  // misalign them because the two fonts report different metrics.
  _setProcedureTitle(el, procedures) {
    el.replaceChildren();
    el.classList.add('d-flex', 'align-items-baseline', 'flex-grow-1');

    const label = document.createElement('span');
    label.textContent = 'Procedure Timeline';
    el.appendChild(label);

    const ids = document.createElement('span');
    // ps-3 enforces a real minimum gap on top of the ms-auto pushing right,
    // so the procedure ID never butts up against the title even when the
    // header is so narrow that the auto-margin collapses to zero.
    ids.className = 'ms-auto ps-3 font-monospace text-muted';
    ids.textContent = procedures.map(p => p.procedureId).join(', ');
    el.appendChild(ids);
  }

  _renderProcedure({ notices, error }, currentPubNumber, container) {
    const wrapper = document.createElement('div');

    if (error) {
      const alert = document.createElement('div');
      alert.className = 'alert alert-danger py-2';
      alert.textContent = error;
      wrapper.appendChild(alert);
      container.appendChild(wrapper);
      return;
    }

    if (!notices.length) {
      const empty = document.createElement('div');
      empty.className = 'text-muted';
      empty.textContent = 'No data available';
      wrapper.appendChild(empty);
      container.appendChild(wrapper);
      return;
    }

    const timeline = this._buildTimeline(notices, currentPubNumber);
    wrapper.appendChild(timeline);
    container.appendChild(wrapper);
    this._scrollToCurrent(timeline);
  }

  _buildTimeline(notices, currentPubNumber) {
    const timeline = document.createElement('div');
    timeline.className = 'procedure-timeline';

    notices.forEach((notice, i) => {
      if (i > 0) timeline.appendChild(this._buildArrow());
      timeline.appendChild(this._buildTimelineItem(notice, currentPubNumber));
    });

    return timeline;
  }

  _buildArrow() {
    const arrow = document.createElement('div');
    arrow.className = 'timeline-arrow';
    arrow.appendChild(_iconEl('bi-arrow-right'));
    return arrow;
  }

  _buildTimelineItem(notice, currentPubNumber) {
    // The TED API always returns notice-version as a number. version 1
    // (the common case) is the original publication and gets the green
    // 'success' border; > 1 is an amendment and gets the yellow 'warning'
    // border. The version badge next to the publication number is only
    // shown for amendments — version 1 is implicit.
    const isAmended = notice.noticeVersion > 1;
    const isCurrent = notice.publicationNumber === currentPubNumber;

    const item = document.createElement('div');
    item.className = `timeline-item ${isAmended ? 'warning' : 'success'}${isCurrent ? ' current' : ''}`;
    // Used by _updateHighlight so the "current" toggle reads from a
    // stable attribute, not from text-content parsing.
    item.dataset.publicationNumber = notice.publicationNumber;

    // Vertical lines, in order:
    //   1. Publication number (+ version suffix if amended)
    //   2. Country + publication date (on the same line)
    //   3. Notice type (icon = form-type, text = notice-type code)
    //   4. eForms SDK version
    //   5. TED link
    // Each row is conditional on the underlying field being present so a
    // sparse notice degrades to a shorter card instead of rendering
    // placeholder "Unknown" strings.
    item.appendChild(this._buildPubNumber(notice, isAmended));
    item.appendChild(this._buildPubDate(notice));
    if (notice.noticeType)      item.appendChild(this._buildNoticeTypeRow(notice));
    if (notice.customizationId) item.appendChild(this._buildSdkRow(notice));
    if (notice.html)            item.appendChild(this._buildTedLink(notice));

    item.addEventListener('click', () => {
      const facet = createPublicationNumberFacet(notice.publicationNumber);
      if (!facet) return;
      // Mirror the clicked pub number into the Search input so the input
      // reflects "what's currently being looked at", matching the lucky
      // link and History dropdown behaviour.
      this.setSearchInput(notice.publicationNumber);
      // Stage 8 — also drop the canned CONSTRUCT for this sibling into
      // the SPARQL editor as a side effect, mirroring SearchPanel._search.
      try {
        const query = getQuery(facet);
        if (query) this.loadEditorText(query);
      } catch {
        // Best-effort — never block the navigation on editor reflection.
      }
      // Lateral navigation within an already-visible procedure: reset
      // the breadcrumb (we're switching notices) but don't add the
      // sibling to History. The Procedure Timeline is already the
      // contextual UI for these siblings; History is reserved for
      // notices the user explicitly started from.
      this.controller.search(facet, { addToHistory: false });
      // Stage 12 — graph lane wins (lateral notice navigation).
      this.setActiveResultTab('graph');
      // Direct user gesture (timeline click) → switch to Explore tab.
      this.showExplorerTab();
    });

    return item;
  }

  _buildPubNumber(notice, isAmended) {
    const el = document.createElement('div');
    el.className = 'pub-number';
    el.textContent = notice.publicationNumber;
    if (isAmended) {
      const version = document.createElement('small');
      version.className = 'text-muted';
      version.textContent = ` v${notice.noticeVersion}`;
      el.appendChild(version);
    }
    return el;
  }

  // Country + date on a single line. Country comes first (when present),
  // followed by the date — answers "where" before "when". The country
  // segment is omitted entirely for entries that don't have one. Each
  // segment is its own inline-block so the gap between them is a real
  // CSS margin, not a single whitespace character.
  _buildPubDate(notice) {
    const el = document.createElement('div');
    el.className = 'pub-date';

    if (notice.buyerCountry) {
      const country = document.createElement('span');
      country.className = 'pub-date-segment';
      country.appendChild(_iconEl('bi-geo-alt'));
      country.appendChild(document.createTextNode(' ' + notice.buyerCountry));
      el.appendChild(country);
    }

    if (notice.publicationDate) {
      const date = document.createElement('span');
      date.className = 'pub-date-segment';
      date.appendChild(_iconEl('bi-calendar3'));
      date.appendChild(document.createTextNode(' ' + _formatDate(notice.publicationDate)));
      el.appendChild(date);
    }

    return el;
  }

  // noticeType and formType are pre-normalised to `string | null` at the
  // tedAPI boundary, so this row can treat them as plain text.
  _buildNoticeTypeRow(notice) {
    const icon = FORM_TYPE_ICONS[notice.formType] || FORM_TYPE_FALLBACK_ICON;
    // The icon encodes the form-type axis (planning/competition/result/…).
    // The text shows the more specific notice-type code, with the form-type
    // appended in parens as a memory aid until the user learns the icons.
    const label = notice.formType
      ? `${notice.noticeType} (${notice.formType})`
      : notice.noticeType;
    return this._buildIconRow(icon, label, 'notice-meta');
  }

  _buildSdkRow(notice) {
    return this._buildIconRow('bi-cpu', notice.customizationId, 'notice-meta');
  }

  // One row = an icon, a space, and a piece of text. Shared by the
  // notice-type and SDK rows so the two stay visually identical.
  _buildIconRow(iconClass, text, cssClass) {
    const el = document.createElement('div');
    el.className = cssClass;
    el.appendChild(_iconEl(iconClass));
    el.appendChild(document.createTextNode(' ' + text));
    return el;
  }

  _buildTedLink(notice) {
    const el = document.createElement('div');
    el.className = 'ted-link';

    const a = document.createElement('a');
    a.href = notice.html;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'text-muted';
    a.appendChild(document.createTextNode('TED '));
    a.appendChild(_iconEl('bi-box-arrow-up-right'));

    // Prevent the link click from bubbling up to the timeline-item navigation.
    a.addEventListener('click', e => e.stopPropagation());

    el.appendChild(a);
    return el;
  }

  // After the timeline has been appended to the DOM, scroll it horizontally
  // so the selected notice sits in the visible center.
  //
  // Called once per container per render (Search-tab card + Explore-tab
  // mini-card), so each container gets its own scroll position computed
  // independently. The Explorer mini-card is collapsed by default, which
  // means `clientWidth === 0` on the first render and the scrollLeft
  // assignment is effectively a no-op; it gets recomputed naturally the
  // next time `_updateHighlight` fires after the card is expanded,
  // because Bootstrap's collapse reveals the real width at that point.
  _scrollToCurrent(timeline) {
    requestAnimationFrame(() => {
      const currentItem = timeline.querySelector('.timeline-item.current');
      if (!currentItem) return;
      const itemCenter = currentItem.offsetLeft + currentItem.offsetWidth / 2;
      timeline.scrollLeft = itemCenter - timeline.clientWidth / 2;
    });
  }
}

export { NoticeView };
