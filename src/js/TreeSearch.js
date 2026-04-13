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
// TreeSearch — search-in-tree controller.
//
// Wires a search input to the TreeRenderer's in-memory search index.
// On each keystroke, filters the index, highlights matching results,
// and provides prev/next navigation to cycle through them.

export class TreeSearch {
  constructor(treeRenderer) {
    this.treeRenderer = treeRenderer;
    this.input = document.getElementById('tree-search-input');
    this.countEl = document.getElementById('tree-search-count');
    this.prevBtn = document.getElementById('tree-search-prev');
    this.nextBtn = document.getElementById('tree-search-next');
    this.clearBtn = document.getElementById('tree-search-clear');
    this.searchContainer = document.getElementById('tree-search');

    this.matches = [];
    this.currentIndex = -1;
    this._highlights = [];

    this._initListeners();
  }

  show() {
    if (this.searchContainer) this.searchContainer.style.display = '';
  }

  hide() {
    if (this.searchContainer) this.searchContainer.style.display = 'none';
    this.clear();
  }

  clear() {
    if (this.input) this.input.value = '';
    this.matches = [];
    this.currentIndex = -1;
    this._clearHighlights();
    this._updateUI();
  }

  _initListeners() {
    if (!this.input) return;

    let debounceTimer = null;
    this.input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => this._onSearch(), 150);
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // First Enter reveals the current match; subsequent ones step forward
        if (this._highlights.length === 0 && this.matches.length > 0) {
          this._revealCurrent();
        } else if (e.shiftKey) {
          this._prev();
        } else {
          this._next();
        }
      }
      if (e.key === 'Escape') {
        this.clear();
        this.input.blur();
      }
    });

    this.prevBtn?.addEventListener('click', () => this._prev());
    this.nextBtn?.addEventListener('click', () => this._next());
    this.clearBtn?.addEventListener('click', () => this.clear());
  }

  _onSearch() {
    const query = this.input.value.trim();
    this._clearHighlights();

    if (query.length < 3) {
      this.matches = [];
      this.currentIndex = -1;
      this._updateUI();
      return;
    }

    // Search the tree renderer's index — each match is a specific row.
    // Cap at 100 results to avoid UI freezes on broad queries.
    const all = this.treeRenderer.search(query);
    this.matches = all.length > 100 ? all.slice(0, 100) : all;

    this.currentIndex = this.matches.length > 0 ? 0 : -1;
    this._updateUI();
    // Don't auto-reveal on input — wait for Enter or Next/Prev click.
  }

  _next() {
    if (this.matches.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.matches.length;
    this._updateUI();
    this._revealCurrent();
  }

  _prev() {
    if (this.matches.length === 0) return;
    this.currentIndex = (this.currentIndex - 1 + this.matches.length) % this.matches.length;
    this._updateUI();
    this._revealCurrent();
  }

  _revealCurrent() {
    this._clearHighlights();
    const match = this.matches[this.currentIndex];
    if (!match) return;

    const el = this.treeRenderer.reveal(match.subjectValue, match.predValue, match.objValue, match.path);
    if (!el) return;

    el.classList.add('tree-search-highlight-current');
    this._highlights.push(el);

    // Defer scroll to after DOM layout from lazy expansion
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center' });
    });
  }

  _clearHighlights() {
    for (const el of this._highlights) {
      el.classList.remove('tree-search-highlight', 'tree-search-highlight-current');
    }
    this._highlights = [];
  }

  _updateUI() {
    const n = this.matches.length;
    const hasMatches = n > 0;

    if (this.countEl) {
      this.countEl.textContent = this.input.value.trim()
        ? (hasMatches ? `${this.currentIndex + 1} of ${n}` : 'No matches')
        : '';
    }

    if (this.prevBtn) this.prevBtn.disabled = !hasMatches;
    if (this.nextBtn) this.nextBtn.disabled = !hasMatches;
  }
}
