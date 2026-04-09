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
// ExplorerController — central state management.
//
// The controller owns two navigation concepts:
//
//   facetsList  — the full search history (notice lookups + SPARQL queries).
//                 Drives the History dropdown in the Inspect tab. Persisted
//                 in sessionStorage so it survives reloads but not new tabs.
//
//   breadcrumb  — the click path within the current exploration. A fresh
//                 search resets it; clicking a subject in the tree extends
//                 it; clicking a step jumps back and trims everything after.
//                 Not persisted — rebuilding it requires re-traversing.
//
// UI panels subscribe to the following events:
//   facet-changed        — current facet changed (breadcrumb reset
//                          or new search)
//   results-changed      — query finished (results present OR an
//                          error is on `.error`; see below)
//   error-changed        — query failed; fired immediately before
//                          results-changed so error-aware views can
//                          render before the null-results path
//   loading-changed      — `.isLoading` flipped
//   facets-list-changed  — the persistent history changed (add /
//                          clear / enrich)

import { addUnique, getQuery, validateFacet } from './facets.js';
import {
  doSPARQL as defaultDoSPARQL,
  cancelAllSparqlRequests as defaultCancelAllSparqlRequests,
} from './services/sparqlService.js';

const STORAGE_KEY = 'explorer-facets-v3';

class ExplorerController extends EventTarget {
  // The `doSPARQL` and `cancelAllSparqlRequests` options let tests inject
  // stubs; production callers (app.js) pass no arguments and get the real
  // worker-backed service.
  constructor({
    doSPARQL = defaultDoSPARQL,
    cancelAllSparqlRequests = defaultCancelAllSparqlRequests,
  } = {}) {
    super();
    this._doSPARQL = doSPARQL;
    this._cancelAllSparqlRequests = cancelAllSparqlRequests;
    this.facetsList = [];
    this.breadcrumb = [];
    this.breadcrumbIndex = -1;
    this.isLoading = false;
    this.error = null;
    this.results = null;
    // Monotonic token incremented on every navigation. An in-flight query
    // whose token no longer matches is a stale response and gets dropped.
    this._queryToken = 0;
    this._loadFromSession();
  }

  // ── Getters ──

  get currentFacet() {
    if (this.breadcrumbIndex < 0 || this.breadcrumbIndex >= this.breadcrumb.length) return null;
    return this.breadcrumb[this.breadcrumbIndex];
  }

  get canGoBack() {
    return this.breadcrumbIndex > 0;
  }

  get canGoForward() {
    return this.breadcrumbIndex < this.breadcrumb.length - 1;
  }

  // ── Navigation ──

  // A new search: notice lookup or custom SPARQL. Resets the breadcrumb and
  // (by default) adds the facet to the persistent search history. When the
  // facet is a notice-number already in history, the breadcrumb is wired
  // to the existing (possibly enriched) object, so later enrichment shows
  // up in `currentFacet` and the History dropdown's active-highlight
  // comparison.
  //
  // Pass `{ addToHistory: false }` for lateral navigation within an
  // already-visible context — e.g. clicking a sibling notice in the
  // Procedure Timeline. Those gestures reset the breadcrumb like a fresh
  // search (we're switching notices) but should not pollute the History
  // dropdown with siblings the user didn't explicitly look up. The facet
  // is still resolved to an existing history entry if one exists, so
  // enrichment stays consistent.
  async search(facet, { addToHistory = true, sparqlOptions = {} } = {}) {
    const stamped = this._withTimestamp(facet);
    const canonical = addToHistory
      ? this._addToHistory(stamped)
      : this._resolveExisting(stamped);
    this.breadcrumb = [canonical];
    this.breadcrumbIndex = 0;
    // sparqlOptions are forwarded to doSPARQL so CONSTRUCT/DESCRIBE
    // queries honour the Customize tab's Options panel (timeout,
    // strict, debug, report, default-graph-uri). Notice-number
    // searches pass no options because they use a canned query whose
    // options are baked in.
    this._sparqlOptions = sparqlOptions;
    await this._navigated();
  }

  // Look up a notice-number facet in history without inserting it. Used
  // when navigating laterally (timeline clicks) so the breadcrumb points
  // at the canonical enriched entry if we've seen the notice before, but
  // we don't add a new History entry for a sibling the user never
  // searched for.
  _resolveExisting(facet) {
    if (facet.type !== 'notice-number') return facet;
    const existing = this.facetsList.find(f => f.value === facet.value);
    return existing || facet;
  }

  // Clicking a backlink: the user is still within the same original notice
  // context, but the current path no longer applies. Keep the root and
  // insert the backlink target as the second step.
  async exploreFromBacklink(facet) {
    const stamped = this._withTimestamp(facet);
    const root = this.breadcrumb[0];
    this.breadcrumb = root ? [root, stamped] : [stamped];
    this.breadcrumbIndex = this.breadcrumb.length - 1;
    await this._navigated();
  }

  // Clicking a subject in the tree: push onto the breadcrumb. Tree clicks
  // are not added to the search history — they're a breadcrumb concept.
  async explore(facet) {
    const stamped = this._withTimestamp(facet);

    // No-op if the target is already the current facet. Otherwise clicking
    // the root subject's own badge would keep pushing itself onto the
    // breadcrumb. We only compare URIs here — different timestamps don't
    // make it a different facet.
    const current = this.currentFacet;
    if (
      current?.type === 'named-node' &&
      stamped.type === 'named-node' &&
      current.term?.value === stamped.term?.value
    ) {
      return;
    }

    // If we've gone back and now explore a new path, drop the stale forward.
    if (this.breadcrumbIndex < this.breadcrumb.length - 1) {
      this.breadcrumb = this.breadcrumb.slice(0, this.breadcrumbIndex + 1);
    }

    this.breadcrumb.push(stamped);
    this.breadcrumbIndex = this.breadcrumb.length - 1;
    await this._navigated();
  }

  async goBack() {
    if (!this.canGoBack) return;
    this.breadcrumbIndex--;
    await this._navigated({ save: false });
  }

  async goForward() {
    if (!this.canGoForward) return;
    this.breadcrumbIndex++;
    await this._navigated({ save: false });
  }

  // Jump to a specific breadcrumb position and trim everything after it.
  async goTo(index) {
    if (index < 0 || index >= this.breadcrumb.length || index === this.breadcrumbIndex) return;
    this.breadcrumb = this.breadcrumb.slice(0, index + 1);
    this.breadcrumbIndex = index;
    await this._navigated({ save: false });
  }

  // Selecting an item from the History dropdown is treated as a new search.
  async selectFromHistory(facet) {
    await this.search(facet);
  }

  // Generic entry point for URI clicks from the TermRenderer.
  // Named-node facets extend the breadcrumb; everything else resets it.
  async navigateTo(facet) {
    if (facet.type === 'named-node') {
      await this.explore(facet);
    } else {
      await this.search(facet);
    }
  }

  // User clicked the stop button in the footer. Terminate the SPARQL
  // worker — every in-flight promise rejects with a CancelledError,
  // which _executeCurrentQuery's catch branch recognises and turns
  // into a clean "no results, no error" state instead of a red banner.
  // The next search spawns a fresh worker automatically via getWorker().
  //
  // No-op if nothing is in flight.
  cancelCurrentQuery() {
    if (!this.isLoading) return;
    this._cancelAllSparqlRequests();
  }

  removeFacet(index) {
    this.facetsList.splice(index, 1);
    this._saveToSession();
    this._emit('facets-list-changed');
  }

  // Remove a notice-number facet from the persistent history by its
  // publication-number value. Used by DataView when a search resolves
  // to zero triples (i.e. the notice does not exist) so the phantom
  // entry doesn't pollute the History dropdown. No-op if no match.
  removeFacetByValue(publicationNumber) {
    const idx = this.facetsList.findIndex(
      f => f.type === 'notice-number' && f.value === publicationNumber
    );
    if (idx < 0) return;
    this.removeFacet(idx);
  }

  // ── URL sharing ──

  // Build a shareable URL for the current facet. Only the identity-defining
  // fields are serialised — enrichment (publicationDate, noticeType, etc.)
  // is stripped because it would:
  //   - bloat the URL (234 chars → ~90 chars for notice-number facets),
  //   - freeze a point-in-time snapshot of metadata that gets overwritten
  //     on load anyway by fresh enrichment from the TED API,
  //   - leak verbose JSON into URL previews in chat clients.
  // The recipient's app re-enriches from the live endpoint on load, so
  // they see fresher metadata than a URL with baked-in values would carry.
  getShareableUrl() {
    const facet = this.currentFacet;
    if (!facet) return null;
    const stripped = _stripFacetForSharing(facet);
    if (!stripped) return null;
    const url = new URL(window.location.href);
    url.searchParams.set('facet', JSON.stringify(stripped));
    return url.toString();
  }

  // Look for a ?facet=... query parameter and, if present, load it.
  //
  // Returns one of:
  //   { status: 'absent'  }                 — no ?facet= in the URL
  //   { status: 'loaded'  }                 — parsed, validated, search kicked off
  //   { status: 'invalid', reason: 'parse' } — JSON.parse threw
  //   { status: 'invalid', reason: 'shape' } — validated was null
  //
  // The caller (SearchPanel.init) surfaces the invalid cases as a UI
  // banner so the recipient of a broken shared link actually sees the
  // failure instead of a silently blank Inspect tab.
  initFromUrlParams() {
    const facetParam = new URLSearchParams(window.location.search).get('facet');
    if (!facetParam) return { status: 'absent' };

    let parsed;
    try {
      parsed = JSON.parse(facetParam);
    } catch (e) {
      console.error('Failed to parse facet from URL:', e);
      return { status: 'invalid', reason: 'parse' };
    }

    const validated = validateFacet(parsed);
    if (!validated) return { status: 'invalid', reason: 'shape' };

    // Fire-and-forget the search but attach a .catch so any rejection
    // inside `_executeCurrentQuery` becomes a loud console.error
    // rather than a silent unhandled-promise-rejection at boot.
    // The result object is returned synchronously with `loaded` —
    // the caller (SearchPanel.init) only uses it to decide which
    // UI state to render, not to wait on the query.
    this.search(validated).catch(err => {
      console.error('[ExplorerController] initFromUrlParams search failed:', err);
    });
    return { status: 'loaded' };
  }

  // ── Private ──

  // Return a facet with a timestamp, without mutating the caller's object.
  // Callers are navigation methods that get facets from factories, history
  // clicks, or sessionStorage — all shared references that must not be
  // modified from under other readers.
  _withTimestamp(facet) {
    if (facet.timestamp) return facet;
    return { ...facet, timestamp: Date.now() };
  }

  // Add a facet to the persistent search history and return the canonical
  // reference — either the newly-appended entry or the pre-existing one if
  // addUnique found a duplicate. Non-persisted facet kinds (named-node,
  // query) pass through unchanged so the breadcrumb still has something
  // to point at.
  _addToHistory(facet) {
    if (facet.type !== 'notice-number') return facet;
    const { facets, index } = addUnique(this.facetsList, facet);
    this.facetsList = facets;
    return facets[index];
  }

  // Wipe both the in-memory list and the persisted copy. Used by the
  // "Clear history" item in the Search panel dropdown so that a reload
  // of the same tab no longer surfaces the cleared entries.
  clearHistory() {
    this.facetsList = [];
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Best effort — quota or unavailable storage is fine to ignore.
    }
    this._emit('facets-list-changed');
  }

  // Attach timeline metadata (publication date, notice type, country, …)
  // to a notice-number entry already in the history. Called by NoticeView
  // once the TED API has resolved the procedure for a notice.
  //
  // Mutates the existing entry in place rather than replacing it with a
  // spread copy — otherwise the breadcrumb (which shares the reference
  // from _addToHistory) would see stale, unenriched data, and the History
  // dropdown's active-highlight comparison (which is reference-equality)
  // would silently break. The destructure also prevents enrichment from
  // overwriting identity-defining fields.
  enrichNoticeFacet(publicationNumber, metadata) {
    const entry = this.facetsList.find(
      f => f.type === 'notice-number' && f.value === publicationNumber
    );
    if (!entry) return;
    const { type, value, timestamp, ...safeMetadata } = metadata;
    Object.assign(entry, safeMetadata);
    this._saveToSession();
    this._emit('facets-list-changed');
  }

  // Shared tail of every navigation method: emit events, persist,
  // and run the query for the newly current facet. Views re-read
  // the breadcrumb off `this.breadcrumb` inside their `facet-changed`
  // handler, so no separate `breadcrumb-changed` emit is needed
  // (a second emit would double-render on every navigation).
  async _navigated({ save = true } = {}) {
    this._emit('facet-changed');
    if (save) this._saveToSession();
    await this._executeCurrentQuery();
  }

  async _executeCurrentQuery() {
    const facet = this.currentFacet;
    if (!facet) return;
    const query = getQuery(facet);
    if (!query) return;

    // Capture the token for this query. If the user navigates while the
    // SPARQL call is in flight, `_queryToken` gets bumped and we drop the
    // late response instead of overwriting fresh state.
    const token = ++this._queryToken;
    this.isLoading = true;
    this.error = null;
    this._emit('loading-changed');

    try {
      const results = await this._doSPARQL(query, this._sparqlOptions || {});
      if (token !== this._queryToken) return;
      this.results = results;
      this._emit('results-changed');
    } catch (e) {
      if (token !== this._queryToken) return;
      // User-initiated cancellation is NOT an error — it just clears
      // the current results without raising a red banner. Everything
      // else (network, parse, timeout) is a real error.
      if (e?.name === 'CancelledError') {
        this.error = null;
        this.results = null;
        this._emit('results-changed');
      } else {
        this.error = e;
        this.results = null;
        console.error('Query execution failed:', e);
        // Emit `error-changed` FIRST so views that want to render an
        // error state can do so before the (null) results-changed
        // event reaches the normal render path. Subscribers should
        // listen to both events because a refactor might one day
        // route errors through only one of them.
        this._emit('error-changed');
        this._emit('results-changed');
      }
    } finally {
      if (token === this._queryToken) {
        this.isLoading = false;
        this._emit('loading-changed');
      }
    }
  }

  _emit(eventName) {
    this.dispatchEvent(new CustomEvent(eventName));
  }

  _saveToSession() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.facetsList));
    } catch (e) {
      // Quota or unavailable. Log once per session on the first
      // failure so a developer watching the console sees it, but
      // don't spam on every subsequent add. The user-visible effect
      // is that their history won't survive a reload, which is the
      // right graceful degradation for a dev-console-invisible
      // feature.
      if (!this._sessionSaveWarned) {
        console.warn('[ExplorerController] sessionStorage save failed; history will not persist:', e);
        this._sessionSaveWarned = true;
      }
    }
  }

  _loadFromSession() {
    let stored;
    try {
      stored = sessionStorage.getItem(STORAGE_KEY);
    } catch (e) {
      console.warn('[ExplorerController] sessionStorage unavailable; starting with empty history:', e);
      return;
    }
    if (!stored) return;

    let parsed;
    try {
      parsed = JSON.parse(stored);
    } catch (e) {
      // Distinguishes "no entry" (handled above) from "corrupt JSON".
      // Preserve the corrupt payload under a backup key so a
      // developer can inspect it in devtools, then discard the
      // primary key. The user just sees an empty history.
      console.warn('[ExplorerController] Corrupt history in sessionStorage; moved to backup key.', e);
      try {
        sessionStorage.setItem(`${STORAGE_KEY}.corrupt`, stored);
        sessionStorage.removeItem(STORAGE_KEY);
      } catch { /* quota — nothing we can do */ }
      return;
    }

    if (!Array.isArray(parsed)) return;
    // Drop anything that isn't a notice search. Old storage from earlier
    // versions of the rewrite may carry queries or named-node facets.
    this.facetsList = parsed
      .filter(f => f?.type === 'notice-number')
      .map(f => validateFacet(f))
      .filter(f => f !== null);
  }
}

// Strip a facet down to its identity-defining fields for serialisation
// into a shareable URL. Returns null for facet shapes we don't know how
// to share (the UI should also hide the share button in those cases).
function _stripFacetForSharing(facet) {
  if (!facet) return null;
  if (facet.type === 'notice-number') {
    return { type: 'notice-number', value: facet.value };
  }
  if (facet.type === 'named-node') {
    return {
      type: 'named-node',
      term: { termType: 'NamedNode', value: facet.term?.value },
    };
  }
  if (facet.type === 'query') {
    return { type: 'query', query: facet.query };
  }
  return null;
}

export { ExplorerController };
