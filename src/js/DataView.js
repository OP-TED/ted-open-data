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
// DataView — owns the Explorer tab.
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
import { eclipseHighlightStyle, eclipseTheme } from './cm-theme.js';
import { copyToClipboard } from './clipboardCopy.js';
import { getLabel } from './facets.js';
import { TreeRenderer } from './TreeRenderer.js';

class DataView {
  // `pickRandom` is an optional callback wired from app.js to
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
    this.errorEl = document.getElementById('data-error');
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

    this.treeRenderer = new TreeRenderer(this.treeContainer);

    this._bindEvents();
    this._listen();
  }

  _bindEvents() {
    document.querySelectorAll('input[name="view-mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.viewMode = e.target.value;
        this._showCurrentView();
      });
    });

    // "Pick a random notice" link in the not-found state. Routes to the
    // same lucky flow as the Search tab's link so the two stay in sync.
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
  }

  // Copy the shareable URL for the currently focused facet to the
  // clipboard, mirroring the Search tab's share button. Lives here too
  // so users can share whatever they're actually looking at — including
  // deep named-node states that the Search-tab button can't represent.
  async _share() {
    const url = this.controller.getShareableUrl();
    if (!url) return;
    const copied = await copyToClipboard(url);
    this._flashShareIcon(copied);
  }

  _flashShareIcon(success) {
    if (!this.shareBtn) return;
    const original = '<i class="bi bi-share"></i>';
    this.shareBtn.innerHTML = success
      ? '<i class="bi bi-check"></i>'
      : '<i class="bi bi-x text-danger"></i>';
    if (!success) this.shareBtn.title = 'Could not copy to clipboard';
    setTimeout(() => {
      this.shareBtn.innerHTML = original;
      this.shareBtn.title = 'Copy shareable URL';
    }, 1500);
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
      // Hide the Explore tab entirely — there's nothing to explore, so
      // the affordance itself shouldn't exist. If the user happened to
      // be sitting on the Explore tab when the facet cleared (e.g. a
      // clearHistory from the dropdown), bounce them back to Search so
      // they're not stranded on a tab that just vanished.
      if (explorerTabItem) explorerTabItem.style.display = 'none';
      if (explorerTabBtn?.classList.contains('active')) {
        const searchTabBtn = document.getElementById('app-tab-search');
        if (searchTabBtn) new bootstrap.Tab(searchTabBtn).show();
      }
      return;
    }

    this.card.style.display = '';
    this.placeholderEl.style.display = 'none';
    // Reveal the Explore tab now that there's something to explore.
    // SearchPanel / NoticeView may call showExplorerTab() after this to
    // switch to it; the tab needs to be visible first for Bootstrap's
    // Tab.show() to work.
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
    this.errorEl.style.display = 'none';
    this._hideNotFound();
    this._setShareBtnVisible(false);

    if (error) {
      this.errorEl.textContent = error.message || 'Query failed';
      this.errorEl.style.display = '';
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
  }

  _onLoadingChanged() {
    this.loadingEl.style.display = this.controller.isLoading ? '' : 'none';
  }

  _renderView(results) {
    if (this.viewMode === 'tree') {
      this.treeRenderer.render(results.quads);
    } else if (this.viewMode === 'turtle') {
      this._renderTurtle(results.rawTurtle);
    }
    this._showCurrentView();
  }

  _showCurrentView() {
    this.treeContainer.style.display = this.viewMode === 'tree' ? '' : 'none';
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

export { DataView };
