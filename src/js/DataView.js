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
// DataView — owns the graph lane of the Reuse tab (`#app-tab-explorer`).
// Responsibilities:
//   - breadcrumb rendering and navigation
//   - switching between Tree, Turtle, Backlinks view modes
//   - Turtle editor (lazily initialised CodeMirror)
//   - disabling the Backlinks tab when no URI is selected
// The actual Tree and Backlinks rendering lives in dedicated classes.

import {
  EditorState,
  EditorView,
  bracketMatching,
  defaultHighlightStyle,
  defaultKeymap,
  drawSelection,
  foldGutter,
  foldKeymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSelectionMatches,
  highlightSpecialChars,
  indentOnInput,
  keymap,
  lineNumbers,
  searchKeymap,
  syntaxHighlighting,
  turtle,
} from '../vendor/codemirror-bundle.js';
import { eclipseHighlightStyle, eclipseTheme } from './utils/cmTheme.js';
import { copyToClipboard } from './utils/clipboardCopy.js';
import { triggerBlobDownload } from './utils/download.js';
import { classifyError } from './utils/errorMessages.js';
import { getLabel, getQuery } from './facets.js';
import { getEndpoint } from './services/sparqlService.js';
import { showToast } from './utils/toast.js';
import { TreeRenderer } from './TreeRenderer.js';
import { TreeSearch } from './TreeSearch.js';

export class DataView {
  // `pickRandom` is an optional callback wired from script.js to
  // SearchPanel.pickRandom(). It fires when the user clicks the
  // "pick a random notice" link inside the not-found state.
  constructor(controller, { pickRandom } = {}) {
    this.controller = controller;
    this.viewMode = 'tree';
    this.turtleEditor = null;
    this.pickRandom = pickRandom || (() => {});

    // DOM refs
    this.card = document.getElementById('data-card');
    this.titleEl = document.getElementById('data-card-title');
    this.shareBtn = document.getElementById('data-share-btn');
    this.loadingEl = document.getElementById('data-loading');
    // Friendly error state on the Reuse tab's graph lane
    // (`#app-tab-explorer`). Replaces the old red alert-danger
    // banner with an empty-state view in the same register as
    // #data-not-found: centred icon + title + message. We populate
    // the message slot and toggle the wrapper.
    this.errorStateEl = document.getElementById('data-error-state');
    this.errorMessageEl = document.getElementById('data-error-message');
    this.errorDetailEl = document.getElementById('data-error-detail');
    this.placeholderEl = document.getElementById('data-placeholder');
    this.treeContainer = document.getElementById('tree-container');
    this.turtleContainer = document.getElementById('turtle-container');
    this.backlinksContainer = document.getElementById('backlinks-container');
    this.breadcrumbEl = document.getElementById('data-breadcrumb');

    // Not-found state shown when a notice-number search returns
    // zero triples. Replaces the Tree/Turtle/Backlinks trio with a
    // dedicated message so the user doesn't have to interpret
    // "0 triples" as "the notice doesn't exist".
    this.notFoundEl = document.getElementById('data-not-found');
    this.notFoundPubEl = document.getElementById('data-not-found-pub');
    this.viewModeGroup = this.card?.querySelector('.btn-group[role="group"]');
    // Download menu (Turtle / RDF/XML / N-Triples)
    this.downloadMenu = document.getElementById('data-download-menu');

    this.treeRenderer = new TreeRenderer(this.treeContainer);
    this.treeSearch = new TreeSearch(this.treeRenderer);

    this._bindEvents();
    this._listen();
  }

  _bindEvents() {
    // Delegate the view-mode change event on a stable ancestor
    // (#data-view-mode-toggle) rather than querying every radio at
    // construction time. The direct-query approach returned an
    // empty NodeList if DataView was constructed before the radios
    // were in the DOM (DOM-ready race), silently breaking view
    // switching without any signal.
    const viewModeToggle = document.getElementById('data-view-mode-toggle');
    if (viewModeToggle) {
      viewModeToggle.addEventListener('change', (e) => {
        if (e.target?.name !== 'view-mode') return;
        this.viewMode = e.target.value;
        this._showCurrentView();
      });
    } else {
      console.warn('[DataView] #data-view-mode-toggle missing — view switching disabled.');
    }

    // "Pick a random notice" link in the not-found state. Routes to
    // the same lucky flow as the Inspect tab's link (`#lucky-link`)
    // so the two stay in sync.
    const notFoundLucky = document.getElementById('data-not-found-lucky');
    if (notFoundLucky) {
      notFoundLucky.addEventListener('click', (e) => {
        e.preventDefault();
        this.pickRandom();
      });
    }

    if (this.shareBtn) {
      this.shareBtn.addEventListener('click', () => this._share());
    }

    // Download menu items. Each option's data-download-format
    // attribute carries the MIME type to request from the SPARQL
    // endpoint. Turtle is short-circuited to use the rawTurtle already
    // in memory; RDF/XML and N-Triples re-fetch via /sparql.
    if (this.downloadMenu) {
      this.downloadMenu.querySelectorAll('[data-download-format]').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          this._download(item.dataset.downloadFormat);
        });
      });
    }
  }

  // Copy the shareable URL for the currently focused facet to the
  // clipboard and show the shared toast with an explanation of what
  // the URL is for. Mirrors the SELECT-lane Copy URL flow — same
  // toast DOM element, different title/body text per lane.
  async _share() {
    const url = this.controller.getShareableUrl();
    if (!url) return;
    const copied = await copyToClipboard(url);
    if (copied) {
      showToast(
        'Link copied',
        'Save this link to come back to the same view later, or share it with a colleague — they will see exactly what you see now.',
      );
    } else {
      // Fallback: brief visual signal on the button itself when the
      // clipboard API is blocked (rare, but possible in some
      // embedded-browser contexts).
      const original = this.shareBtn.innerHTML;
      this.shareBtn.innerHTML = '<i class="bi bi-x text-danger"></i> Copy failed';
      setTimeout(() => { this.shareBtn.innerHTML = original; }, 1500);
    }
  }

  /**
   * Download the current data card's content in the
   * requested RDF serialisation. Turtle short-circuits to use the
   * rawTurtle already in memory; RDF/XML and N-Triples re-fetch via
   * /sparql with the appropriate Accept header. Triggers a browser
   * download via a temporary <a> element + Blob URL.
   *
   * @param {string} format MIME type — text/turtle, application/rdf+xml, application/n-triples
   * @private
   */
  async _download(format) {
    const facet = this.controller.currentFacet;
    if (!facet) return;
    // Disable download items during fetch to prevent duplicate clicks.
    const items = this.downloadMenu?.querySelectorAll('[data-download-format]') || [];
    items.forEach(i => i.classList.add('disabled'));
    let body;
    let extension;
    try {
      if (format === 'text/turtle' && this.controller.results?.rawTurtle) {
        body = this.controller.results.rawTurtle;
        extension = 'ttl';
      } else {
        // Re-fetch from the endpoint with the requested Accept header.
        // Uses the same endpoint-selection logic as sparqlService so
        // dev mode routes through the cors-proxy while production
        // hits the real endpoint directly. The previous hard-coded
        // `/sparql` only worked in dev.
        const root = this.controller.breadcrumb?.[0];
        const noticeNumber = root?.type === 'notice-number' ? root.value : undefined;
        const query = getQuery(facet, { noticeNumber });
        if (!query) {
          showToast('Download failed', 'Could not build a download query for the current view.', { variant: 'danger' });
          return;
        }
        // Build the POST body from the controller's stored options
        // rather than from the live DOM form inputs. When a shared
        // URL loads with `?opts=...`, those options go into the
        // controller's `_sparqlOptions` but the Options panel form
        // is NOT repopulated. Reading from the DOM would produce a
        // download that diverges from what produced the current
        // graph.
        const opts = this.controller._sparqlOptions || {};
        const params = new URLSearchParams({ query, format });
        if (opts.defaultGraphUri) params.set('default-graph-uri', opts.defaultGraphUri);
        if (opts.timeout) params.set('timeout', opts.timeout);
        if (opts.strict) params.set('strict', opts.strict);
        if (opts.debug) params.set('debug', opts.debug);
        if (opts.report) params.set('report', opts.report);

        const downloadTimeout = Math.max(Number(opts.timeout) || 60_000, 10_000);
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), downloadTimeout);
        const response = await fetch(getEndpoint(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': format,
          },
          body: params.toString(),
          signal: abort.signal,
        });
        clearTimeout(timer);
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          console.error('Download failed:', response.status, detail);
          const err = new Error(`HTTP error. Status: ${response.status}\n${detail}`);
          const { friendly } = classifyError(err, 'graph');
          showToast('Download failed', friendly, { variant: 'danger' });
          return;
        }
        body = await response.text();
        extension = format === 'application/rdf+xml' ? 'rdf'
          : format === 'application/n-triples' ? 'nt'
          : 'txt';
      }
    } catch (error) {
      console.error('Download failed:', error);
      if (error?.name === 'AbortError') {
        showToast('Download timed out', 'The download took too long. Try a narrower query or increase the timeout in Options.', { variant: 'danger' });
      } else {
        const { friendly } = classifyError(error, 'graph');
        showToast('Download failed', friendly, { variant: 'danger' });
      }
      return;
    } finally {
      items.forEach(i => i.classList.remove('disabled'));
    }

    // Build a filename from the current facet for friendlier downloads.
    const stem = facet.type === 'notice-number'
      ? `notice-${facet.value}`
      : facet.type === 'named-node'
        ? 'resource'
        : 'query-result';
    triggerBlobDownload(body, `${stem}.${extension}`);
  }

  _listen() {
    // `facet-changed` already drives _onFacetChanged, which calls
    // _renderBreadcrumb itself. Subscribing to `breadcrumb-changed`
    // separately would re-render the breadcrumb twice on every
    // navigation — drop the redundant listener.
    this.controller.addEventListener('facet-changed', () => this._onFacetChanged());
    this.controller.addEventListener('results-changed', () => this._onResultsChanged());
    this.controller.addEventListener('loading-changed', () => this._onLoadingChanged());
  }

  _onFacetChanged() {
    const facet = this.controller.currentFacet;
    const explorerTabItem = document.getElementById('app-tab-explorer-item');
    const explorerTabBtn = document.getElementById('app-tab-explorer');

    if (!facet) {
      this.card.style.display = 'none';
      this.placeholderEl.style.display = '';
      // Hide the Reuse tab's graph lane entirely — there is nothing
      // to reuse, so the affordance itself should not exist. If the
      // user happened to be sitting on `#app-tab-explorer` when the
      // facet cleared (e.g. a clearHistory from the dropdown), bounce
      // them back to the Inspect tab (`#app-tab-search`) so they are
      // not stranded on a tab that just vanished.
      if (explorerTabItem) explorerTabItem.style.display = 'none';
      if (explorerTabBtn?.classList.contains('active')) {
        const searchTabBtn = document.getElementById('app-tab-search');
        if (searchTabBtn) new bootstrap.Tab(searchTabBtn).show();
      }
      return;
    }

    this.card.style.display = '';
    this.placeholderEl.style.display = 'none';
    // Hide any lingering error state from a previous failed run so
    // the new facet renders cleanly.
    this.errorStateEl.style.display = 'none';
    this.errorMessageEl.textContent = '';
    // Reveal the Reuse graph-lane tab (`#app-tab-explorer`) now that
    // there is something to render. SearchPanel / NoticeView may call
    // showExplorerTab() after this to switch to it; the tab item
    // needs to be visible first for Bootstrap's Tab.show() to work.
    if (explorerTabItem) explorerTabItem.style.display = '';
    this._renderBreadcrumb();
    this._updateBacklinksAvailability(facet);
  }

  _updateBacklinksAvailability(facet) {
    const hasUri = facet.type === 'named-node' && !!facet.term?.value;
    document.getElementById('view-backlinks').disabled = !hasUri;

    // If we were on Backlinks for a node with a URI and the user navigates
    // away to a notice/query facet, fall back to Tree view.
    if (this.viewMode === 'backlinks' && !hasUri) {
      this.viewMode = 'tree';
      document.getElementById('view-tree').checked = true;
      this._showCurrentView();
    }
  }

  _onResultsChanged() {
    const { results, error, currentFacet } = this.controller;

    // Placeholder visibility is owned by _onFacetChanged — it's the
    // "nothing loaded yet" affordance and is tied to facet presence, not
    // results presence. Touching it here caused the cold-load bug where
    // clearing results flashed the placeholder inside a still-hidden card.
    this.errorStateEl.style.display = 'none';
    this.errorMessageEl.textContent = '';
    this._hideNotFound();
    this._setShareBtnVisible(false);

    if (error) {
      // Hide the entire data card (breadcrumb, timeline, view-mode
      // radios, title) so the error state stands alone at tab level,
      // the same way the cold-load placeholder does. The error view
      // lives outside the card in the DOM.
      this.card.style.display = 'none';
      this.placeholderEl.style.display = 'none';
      // Classify via the shared helper (lane='graph') so the graph
      // lane shows the same friendly + detail shape as the SELECT
      // lane, with lane-appropriate copy where it matters (e.g.
      // timeout advice differs between the two).
      const { friendly, detail } = classifyError(error, 'graph');
      this.errorMessageEl.textContent = friendly;
      // Populate the dedicated detail slot (rather than generic
      // querySelector('pre')?.remove() + appendChild) so a future
      // template addition of an unrelated <pre> cannot be trashed
      // by the reset.
      if (this.errorDetailEl) {
        if (detail) {
          this.errorDetailEl.textContent = detail;
          this.errorDetailEl.style.display = '';
        } else {
          this.errorDetailEl.textContent = '';
          this.errorDetailEl.style.display = 'none';
        }
      }
      this.errorStateEl.style.display = '';
      this._clearViews();
      return;
    }

    if (!results) {
      this._clearViews();
      return;
    }

    // Notice-number search with zero results = the notice doesn't exist.
    // Any real notice produces at least rdf:type triples, so an empty
    // CONSTRUCT on a well-formed publication number is a strong "not
    // found" signal. Show a dedicated state instead of an empty tree
    // labelled "0 triples", which users can't distinguish from a real
    // empty notice. Also ask the controller to evict the phantom entry
    // from the History dropdown so typos don't pollute recent searches.
    if (currentFacet?.type === 'notice-number' && results.size === 0) {
      this._showNotFound(currentFacet.value);
      this.controller.removeFacetByValue?.(currentFacet.value);
      return;
    }

    this.titleEl.textContent = `${this._titleFor(currentFacet)} — ${results.size.toLocaleString()} triples`;
    this._setShareBtnVisible(true);
    this._renderView(results);
  }

  _setShareBtnVisible(visible) {
    if (this.shareBtn) this.shareBtn.style.display = visible ? '' : 'none';
    // Download menu visibility tracks the share button.
    // Both are "you have something loaded that you can act on" affordances.
    if (this.downloadMenu) this.downloadMenu.style.display = visible ? '' : 'none';
  }

  _showNotFound(publicationNumber) {
    // Title: just the notice number. The "— N triples" suffix we use
    // for successful loads would leak "0 triples" here, which is the
    // confusing framing we're trying to replace.
    this.titleEl.textContent = `Notice ${publicationNumber}`;
    if (this.notFoundPubEl) this.notFoundPubEl.textContent = publicationNumber;
    if (this.notFoundEl) this.notFoundEl.style.display = '';
    // Hide the Tree/Turtle/Backlinks toggle — nothing meaningful to switch to.
    if (this.viewModeGroup) this.viewModeGroup.style.display = 'none';
    // And hide the three view containers so the not-found state stands alone.
    this.treeContainer.style.display = 'none';
    this.turtleContainer.style.display = 'none';
    this.backlinksContainer.style.display = 'none';
    this._clearViews();
  }

  _hideNotFound() {
    if (this.notFoundEl) this.notFoundEl.style.display = 'none';
    if (this.viewModeGroup) this.viewModeGroup.style.display = '';
  }

  // Title for the data card. For named-node and query facets the label
  // already begins with the resource type (e.g. "ChangedSectionIdentifier
  // 6da4hK8…") so it stands on its own. For notice-number facets the
  // label is just the publication number, which reads better when
  // prefixed with "Notice" so the title pattern matches the deeper
  // navigation cases.
  _titleFor(facet) {
    const label = getLabel(facet);
    return facet?.type === 'notice-number' ? `Notice ${label}` : label;
  }

  // Clear every view mode's content so a failed/empty query does not leave
  // stale data from a previous successful query visible. Backlinks is
  // cleared too even though it is owned by BacklinksView — when a query
  // fails on a named-node facet that previously had backlinks, switching
  // to the Backlinks view would otherwise show stale subjects from the
  // earlier URI.
  _clearViews() {
    this.treeContainer.innerHTML = '';
    this._renderTurtle('');
    const backlinksContent = document.getElementById('backlinks-content');
    if (backlinksContent) backlinksContent.innerHTML = '';
    this.treeSearch.hide();
  }

  _onLoadingChanged() {
    this.loadingEl.style.display = this.controller.isLoading ? '' : 'none';
  }

  _renderView(results) {
    this.treeSearch.clear();
    if (this.viewMode === 'tree') {
      const facet = this.controller.currentFacet;
      const subjectUri = facet?.type === 'named-node' ? facet.term?.value : null;
      this.treeRenderer.render(results.quads, { subjectUri });
    } else if (this.viewMode === 'turtle') {
      this._renderTurtle(results.rawTurtle);
    }
    this._showCurrentView();
  }

  _showCurrentView() {
    const isTree = this.viewMode === 'tree';
    this.treeContainer.style.display = isTree ? '' : 'none';
    if (isTree) this.treeSearch.show(); else this.treeSearch.hide();
    this.turtleContainer.style.display = this.viewMode === 'turtle' ? '' : 'none';
    this.backlinksContainer.style.display = this.viewMode === 'backlinks' ? '' : 'none';

    if (this.viewMode === 'turtle') {
      if (!this.turtleEditor) this._initTurtleEditor();
      // Always sync the editor's contents from the controller's current
      // results. _renderView only updates Turtle when Turtle is the
      // active mode, so a notice loaded while Tree was active leaves the
      // editor showing the previous notice's RDF until we re-render here.
      this._renderTurtle(this.controller.results?.rawTurtle ?? '');
      this.turtleEditor.requestMeasure();
    }
  }

  _initTurtleEditor() {
    this.turtleEditor = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          foldGutter(),
          drawSelection(),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          turtle(),
          eclipseTheme,
          eclipseHighlightStyle,
          EditorState.readOnly.of(true),
          keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]),
        ],
      }),
      parent: this.turtleContainer,
    });
  }

  _renderTurtle(rawTurtle) {
    if (!this.turtleEditor) return;
    const currentDoc = this.turtleEditor.state.doc.toString();
    if (currentDoc !== rawTurtle) {
      this.turtleEditor.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: rawTurtle || '' },
      });
    }
  }

  _renderBreadcrumb() {
    this.breadcrumbEl.innerHTML = '';
    const crumbs = this.controller.breadcrumb;
    const currentIdx = this.controller.breadcrumbIndex;

    // Only show items up to and including the current position.
    // Trailing forward-history items are hidden.
    crumbs.slice(0, currentIdx + 1).forEach((facet, i) => {
      this.breadcrumbEl.appendChild(this._buildBreadcrumbItem(facet, i, i === currentIdx));
    });
  }

  _buildBreadcrumbItem(facet, index, isCurrent) {
    const li = document.createElement('li');
    li.className = 'breadcrumb-item';
    if (isCurrent) li.classList.add('active');

    const label = getLabel(facet);
    const isHome = index === 0;

    const target = isCurrent ? li : document.createElement('a');
    if (!isCurrent) {
      target.href = '#';
      target.addEventListener('click', (e) => {
        e.preventDefault();
        this.controller.goTo(index);
      });
      li.appendChild(target);
    }

    if (isHome) {
      const icon = document.createElement('i');
      icon.className = 'bi bi-house-door';
      target.appendChild(icon);
      target.appendChild(document.createTextNode(' '));
    }
    target.appendChild(document.createTextNode(label));

    return li;
  }
}

