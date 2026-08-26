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

import { addUnique, getQuery, noticeByPublicationNumberQueryEpo3, validateFacet } from './facets.js';
import {
  doSPARQL as defaultDoSPARQL,
  cancelAllSparqlRequests as defaultCancelAllSparqlRequests,
} from './services/sparqlService.js';
import { ensureOntologyData, getClassHierarchy } from './services/ontologyData.js';
import { resourceTypeName } from './utils/resourceType.js';
import { ns } from './utils/namespaces.js';

const STORAGE_KEY = 'explorer-facets-v3';
const RDF_TYPE = `${ns.rdf}type`;

/** The rdf:type statements in a result, as the types declared per subject. */
function declaredTypesIn(quads) {
  const declared = new Map();
  for (const quad of quads || []) {
    if (quad.predicate?.value !== RDF_TYPE) continue;
    const subject = quad.subject?.value;
    const type = quad.object?.value;
    if (!subject || !type) continue;
    if (!declared.has(subject)) declared.set(subject, []);
    declared.get(subject).push(type);
  }
  return declared;
}

export class ExplorerController extends EventTarget {
  // The `doSPARQL` and `cancelAllSparqlRequests` options let tests inject
  // stubs; production callers (script.js) pass no arguments and get the real
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
    // The SPARQL query string that actually produced `this.results`. For
    // most notices this is the ePO 4 CONSTRUCT; for an ePO 3 (StandardForms)
    // notice that only the fallback resolves, it is the fallback query.
    // SearchPanel reflects this into the editor so the query on screen
    // matches the triples on screen (issue #76, "Option B").
    this.executedQuery = null;
    // Monotonic token incremented on every navigation. An in-flight query
    // whose token no longer matches is a stale response and gets dropped.
    this._queryToken = 0;
    // What the notice at the root of the breadcrumb says each resource is.
    // See _rememberDeclaredTypes.
    this.declaredTypes = new Map();
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
    // A new root means a new graph; what the previous notice said about its
    // resources has no bearing on this one.
    this.declaredTypes = new Map();
    // sparqlOptions are forwarded to doSPARQL so CONSTRUCT/DESCRIBE
    // queries honour the fixed endpoint options from readSparqlOptions
    // (or a shared URL's ?opts=). Notice-number searches pass no options
    // because they use a canned query whose options are baked in.
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

  // Mark a notice-number facet as "not found" in the persistent history.
  // Used by DataView when a search resolves to zero triples so the entry
  // stays in history (allowing re-search) but is visually distinguishable
  // from notices that were found.
  markFacetNotFound(publicationNumber) {
    const entry = this.facetsList.find(
      f => f.type === 'notice-number' && f.value === publicationNumber
    );
    if (!entry) return;
    entry.notFound = true;
    this._saveToSession();
    this._emit('facets-list-changed');
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
    // Include the root notice number so named-node share links
    // reproduce the same graph-scoped view the sharer sees.
    const root = this.breadcrumb[0];
    if (facet.type === 'named-node' && root?.type === 'notice-number') {
      url.searchParams.set('root', root.value);
    }
    // Serialise SPARQL options whenever the controller holds non-empty
    // ones — not just for query facets. A user who ran a CONSTRUCT
    // with custom options and then drilled into a named-node via the
    // breadcrumb is still executing in the context of those options
    // (the controller applies _sparqlOptions to every
    // _executeCurrentQuery call). Dropping them on a named-node
    // share link would silently replay the same resource against
    // different endpoint behaviour.
    if (this._sparqlOptions && Object.keys(this._sparqlOptions).length) {
      // Include every key that carries a value — even `"false"`.
      // The worker and the download path only append flags that are
      // present in the restored options object, so stripping
      // `"false"` would omit those flags on replay and break the
      // "exact reproduction" contract if the endpoint treats
      // omission differently from explicit `false`. Only truly
      // empty strings are dropped (they mean "no opinion").
      const meaningful = {};
      for (const [k, v] of Object.entries(this._sparqlOptions)) {
        if (v !== undefined && v !== null && v !== '') meaningful[k] = v;
      }
      if (Object.keys(meaningful).length) {
        url.searchParams.set('opts', JSON.stringify(meaningful));
      }
    }
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
    const params = new URLSearchParams(window.location.search);
    const facetParam = params.get('facet');
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

    // Read optional SPARQL options that getShareableUrl serialises
    // for query facets. If absent or malformed, fall back to an
    // empty object so the query still runs with endpoint defaults.
    let sparqlOptions = {};
    const optsParam = params.get('opts');
    if (optsParam) {
      try { sparqlOptions = JSON.parse(optsParam); } catch (e) { console.debug('[ExplorerController] Malformed ?opts= parameter, using defaults:', e); }
    }

    // Restore root notice context for named-node share links so
    // the scoped query reproduces the original graph-scoped view.
    // Sets up the full breadcrumb atomically before emitting any
    // events, avoiding races with user navigation and preventing
    // a double procedure-timeline fetch.
    const rootParam = params.get('root');
    if (validated.type === 'named-node' && rootParam && /^\d{8}-\d{4}$/.test(rootParam)) {
      const rootFacet = this._withTimestamp({ type: 'notice-number', value: rootParam });
      const namedNode = this._withTimestamp(validated);
      this.breadcrumb = [rootFacet, namedNode];
      this.breadcrumbIndex = 1;
      this._sparqlOptions = sparqlOptions;
      // The root notice is never navigated to on this path, so its type
      // statements — which name every resource it refers to — have to be
      // fetched deliberately. Runs alongside the resource's own query.
      this._loadRootDeclaredTypes(rootParam);
      this._navigated({ save: false }).catch(err => {
        console.error('[ExplorerController] initFromUrlParams root+named-node failed:', err);
      });
      return { status: 'loaded' };
    }

    // Fire-and-forget the search but attach a .catch so any rejection
    // inside `_executeCurrentQuery` becomes a loud console.error
    // rather than a silent unhandled-promise-rejection at boot.
    // The result object is returned synchronously with `loaded` —
    // the caller (SearchPanel.init) only uses it to decide which
    // UI state to render, not to wait on the query.
    this.search(validated, { sparqlOptions }).catch(err => {
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
    } catch (e) {
      console.debug('[ExplorerController] sessionStorage.removeItem failed:', e);
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

  // Remember what the notice at the root of the breadcrumb says each of its
  // resources is.
  //
  // Drilling into a resource re-queries for that resource alone, so the
  // handful of triples that come back name it but say nothing about the
  // resources it points at — which the notice, a moment earlier, did. Keeping
  // the notice's rdf:type statements lets those references stay named all the
  // way down. It is the same data the user was just looking at, for the same
  // URIs; nothing is fetched or inferred.
  //
  // Only the root fills the map, and only until the user searches for another
  // notice. Arriving on a shared link straight to a resource fills nothing,
  // and its references show identifiers alone.
  _rememberDeclaredTypes(results) {
    if (this.breadcrumbIndex !== 0) return;
    this.declaredTypes = declaredTypesIn(results?.quads);
  }

  // A shared link opens on a resource, so the notice it came from is never
  // queried and nothing loaded says what the resources it references are. The
  // link carries the root notice, so fetch it alongside — the same query a
  // notice search runs — for its rdf:type statements alone.
  //
  // The whole notice rather than a query for the type statements: `?s a ?t`
  // inside the graph join costs the endpoint around twenty times what
  // `?s ?p ?o` does, for a third of the data.
  async _loadRootDeclaredTypes(publicationNumber) {
    const facet = { type: 'notice-number', value: publicationNumber };
    let results;
    try {
      results = await this._doSPARQL(getQuery(facet), this._sparqlOptions || {});
      // Legacy notices carry no publication number of the kind the primary
      // query matches on, exactly as in _executeCurrentQuery.
      if (results.size === 0) {
        results = await this._doSPARQL(
          noticeByPublicationNumberQueryEpo3(publicationNumber),
          this._sparqlOptions || {},
        );
      }
    } catch (e) {
      // Nothing on screen waits for this. Without it the references show
      // their identifiers, which is what a link carrying no root does anyway.
      console.warn('[ExplorerController] Could not load the root notice for its types:', e);
      return;
    }

    // A search started meanwhile has a root of its own, and its types are the
    // ones that apply.
    if (this.breadcrumb[0]?.value !== publicationNumber) return;
    this.declaredTypes = declaredTypesIn(results.quads);
    // Redraw only if there is something drawn. Announcing results while the
    // resource's own query is still in flight would clear the view it is
    // about to fill; when it lands it announces them itself.
    if (this.results) this._emit('results-changed');
  }

  // What the notice at the root of the breadcrumb calls a resource. For views
  // that hold no triples of their own — the backlinks list, whose query
  // returns references and nothing else — this is the only source of a name.
  typeNameFor(uri) {
    return resourceTypeName(this.declaredTypes.get(uri) || [], getClassHierarchy());
  }

  // Record what to call the resource just loaded, from the types it declares.
  //
  // The tree can only name a resource it holds triples for, so a reference to
  // a resource described in another notice arrives here unnamed. Its own
  // triples are loaded now, which is the first point at which its type is
  // known. Writing the name onto the facet — the same object the breadcrumb
  // and the heading read — keeps every mention of it in step, including on a
  // later return to this entry, when the triples are no longer at hand.
  _recordTypeName(facet, results) {
    if (facet.type !== 'named-node') return;
    const uri = facet.term?.value;
    const fromResults = (results?.quads || [])
      .filter(q => q.subject?.value === uri && q.predicate?.value === RDF_TYPE)
      .map(q => q.object?.value);
    // A resource the query returned nothing about — a backlink target outside
    // the notice, say — may still have been typed by the notice itself.
    const name = fromResults.length
      ? resourceTypeName(fromResults, getClassHierarchy())
      : this.typeNameFor(uri);
    // In memory only: validateFacet drops typeName on the way out of
    // sessionStorage, since a stored one would be indistinguishable from a
    // forged one. It is recomputed here on every load anyway.
    if (name) facet.typeName = name;
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
    const root = this.breadcrumb[0];
    const noticeNumber = root?.type === 'notice-number' ? root.value : undefined;
    const query = getQuery(facet, { noticeNumber });
    if (!query) return;

    // Capture the token for this query. If the user navigates while the
    // SPARQL call is in flight, `_queryToken` gets bumped and we drop the
    // late response instead of overwriting fresh state.
    const token = ++this._queryToken;
    this.isLoading = true;
    this.error = null;
    // Reset the executed-query reflection; the success path below records
    // the query that actually produced the results.
    this.executedQuery = null;
    this._emit('loading-changed');

    try {
      // The ontology's class hierarchy decides what the loaded resource is
      // called. Fetching it alongside the query costs nothing: it is a small
      // local file, it is served in parallel, and it is loaded only once.
      let [results] = await Promise.all([
        this._doSPARQL(query, this._sparqlOptions || {}),
        ensureOntologyData(),
      ]);
      if (token !== this._queryToken) return;
      // The query that produced `results`. Starts as the primary query and
      // is swapped for the fallback below only when the fallback is what
      // actually returned triples, so SearchPanel can reflect the query the
      // displayed data really came from.
      let effectiveQuery = query;
      // ePO 3 fallback: the primary query uses epo:hasNoticePublicationNumber,
      // which ePO 4 (eForms) notices carry but ePO 3 (legacy XML) notices do
      // not. When a notice-number search comes back empty, retry with the
      // slower identifier-value query before concluding the notice does not
      // exist. ePO 4 notices never reach this branch, so their performance is
      // unchanged. Failures in the fallback are swallowed to a warning: we
      // fall back to the (empty) primary result and let DataView render its
      // normal "not found" state rather than a red error banner.
      if (facet.type === 'notice-number' && results.size === 0) {
        try {
          const fallbackQuery = noticeByPublicationNumberQueryEpo3(facet.value);
          const fallbackResults = await this._doSPARQL(fallbackQuery, this._sparqlOptions || {});
          if (token !== this._queryToken) return;
          if (fallbackResults.size > 0) {
            results = fallbackResults;
            effectiveQuery = fallbackQuery;
          }
        } catch (fallbackErr) {
          if (token !== this._queryToken) return;
          console.warn('[ExplorerController] ePO 3 fallback query failed:', fallbackErr);
        }
      }
      this.results = results;
      this.executedQuery = effectiveQuery;
      this._rememberDeclaredTypes(results);
      this._recordTypeName(facet, results);
      // Clear a stale "not found" flag ONLY now that a notice-number search
      // has actually returned data. Clearing it at search start (before the
      // query resolves) would wipe the badge on a failed, cancelled, or
      // still-empty retry, even though the notice was not found. The token
      // guard above means only the winning query reaches here; the catch and
      // cancellation branches never do.
      if (facet.type === 'notice-number' && results.size > 0 && facet.notFound) {
        delete facet.notFound;
        this._saveToSession();
        this._emit('facets-list-changed');
      }
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
      } catch (e) { console.debug('[ExplorerController] Failed to archive corrupt storage:', e); }
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

