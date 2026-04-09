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
// BacklinksView — shows subjects that reference the current URI, grouped by
// predicate. Loads incrementally: an initial batch on demand and a "Load more"
// button when more results may be available.

import { doSPARQL as defaultDoSPARQL } from './services/sparqlService.js';
import { isSafeUri } from './facets.js';
import { renderSubjectBadge, renderTerm } from './TermRenderer.js';

const BATCH_SIZE = 100;

const NO_SELECTION_MESSAGE =
  '<div class="text-muted fst-italic py-2">Select a resource to see backlinks</div>';
const NO_BACKLINKS_MESSAGE =
  '<div class="text-muted fst-italic">No backlinks found</div>';

export class BacklinksView {
  // The `doSPARQL` option lets tests inject a stub; production callers
  // (script.js) pass no arguments and get the real worker-backed service.
  constructor(controller, { doSPARQL = defaultDoSPARQL } = {}) {
    this.controller = controller;
    this._doSPARQL = doSPARQL;
    this.currentUri = null;
    this.currentOffset = 0;
    this.allQuads = [];
    this.hasMore = true;

    // Monotonic token bumped every time the target URI changes. An in-flight
    // batch whose token no longer matches belongs to a previous URI and must
    // not touch the accumulator or the DOM.
    this._batchToken = 0;

    this.loadingEl = document.getElementById('backlinks-loading');
    this.content = document.getElementById('backlinks-content');

    this.controller.addEventListener('facet-changed', () => this._onFacetChanged());
  }

  _onFacetChanged() {
    // Backlinks only apply to named-node facets.
    const facet = this.controller.currentFacet;
    const uri = facet?.type === 'named-node' ? facet.term?.value : null;

    if (!uri) {
      this.currentUri = null;
      this.content.innerHTML = NO_SELECTION_MESSAGE;
      return;
    }

    if (uri === this.currentUri) return;

    // New target URI: bump the token so any in-flight batch from the prior
    // URI can recognise itself as stale and drop its result.
    this._batchToken++;
    this.currentUri = uri;
    this.currentOffset = 0;
    this.allQuads = [];
    this.hasMore = true;
    this._loadBatch(/* isFirst */ true);
  }

  async _loadBatch(isFirst) {
    if (!this.currentUri) return;

    const token = this._batchToken;
    const uri = this.currentUri;
    const offset = this.currentOffset;

    // Defence-in-depth: the URI is about to be interpolated into a
    // SPARQL CONSTRUCT via <${uri}>, so reject anything that contains
    // characters which could break out of the IRI (`>`, whitespace,
    // control chars). Matches the same boundary check facets.js
    // enforces on its own interpolation sites. In practice URIs come
    // from parsed RDF and are safe, but a malicious or malformed
    // dataset should never be able to inject SPARQL.
    if (!isSafeUri(uri)) {
      if (isFirst) {
        this.content.innerHTML = '';
        this._appendLoadError(new Error('Invalid URI — cannot load backlinks.'));
      }
      this.loadingEl.style.display = 'none';
      return;
    }

    if (isFirst) {
      this.loadingEl.style.display = '';
      this.content.innerHTML = '';
    }
    this._removeLoadMoreButton();

    try {
      const { quads } = await this._doSPARQL(this._buildQuery(uri, offset));
      if (token !== this._batchToken) return;
      this._appendBatch(quads);
      this._renderBacklinks(this.allQuads);
      if (this.hasMore) this._addLoadMoreButton();
    } catch (err) {
      if (token !== this._batchToken) return;
      // First batch: clear whatever was rendered and show the error.
      // Subsequent "Load more" failures: keep the already-loaded rows
      // visible, append an inline error beneath them, and re-add the
      // Load More button so the user can retry. Otherwise a single
      // transient network error on "Load more" would strand the user
      // with no feedback and no way to recover.
      if (isFirst) this.content.innerHTML = '';
      this._appendLoadError(err);
      if (!isFirst && this.hasMore) this._addLoadMoreButton();
    } finally {
      if (token === this._batchToken) {
        this.loadingEl.style.display = 'none';
      }
    }
  }

  _appendLoadError(err) {
    const div = document.createElement('div');
    div.className = 'text-danger mt-2';
    div.textContent = err?.message || 'Failed to load backlinks';
    this.content.appendChild(div);
  }

  _buildQuery(uri, offset) {
    return `CONSTRUCT {
  ?s ?p ?o .
}
WHERE {
  {
    SELECT DISTINCT ?s ?p WHERE {
      VALUES ?o { <${uri}> }
      ?s ?p ?o .
    }
    LIMIT ${BATCH_SIZE}
    OFFSET ${offset}
  }
  VALUES ?o { <${uri}> }
  ?s ?p ?o .
}`;
  }

  // Accumulate quads and advance pagination state.
  _appendBatch(quads) {
    const batchRelationships = new Set();
    for (const quad of quads) {
      if (quad.object.value === this.currentUri) {
        batchRelationships.add(`${quad.subject.value}|${quad.predicate.value}`);
      }
    }
    this.hasMore = batchRelationships.size >= BATCH_SIZE;
    this.currentOffset += BATCH_SIZE;
    this.allQuads = this.allQuads.concat(quads);
  }

  _renderBacklinks(quads) {
    this.content.innerHTML = '';

    const groups = this._groupByPredicate(quads);
    if (Object.keys(groups).length === 0) {
      this.content.innerHTML = NO_BACKLINKS_MESSAGE;
      return;
    }

    for (const group of Object.values(groups)) {
      this.content.appendChild(this._buildBacklinkRow(group));
    }
  }

  // Build a map of predicate → { property, subjects } from the quads.
  _groupByPredicate(quads) {
    const groups = {};
    for (const quad of quads) {
      if (quad.object.value !== this.currentUri) continue;
      const predicate = quad.predicate.value;
      if (!groups[predicate]) {
        groups[predicate] = { property: predicate, subjects: new Set() };
      }
      groups[predicate].subjects.add(quad.subject.value);
    }
    return groups;
  }

  _buildBacklinkRow(group) {
    const row = document.createElement('div');
    row.className = 'backlink-row';
    row.appendChild(this._buildSubjectsWrap(group.subjects));
    row.appendChild(this._buildRelation(group.property));
    return row;
  }

  _buildSubjectsWrap(subjectSet) {
    const wrap = document.createElement('div');
    wrap.className = 'backlink-subjects';
    for (const subjUri of Array.from(subjectSet).sort()) {
      wrap.appendChild(this._buildSubjectBadge(subjUri));
    }
    return wrap;
  }

  _buildSubjectBadge(subjUri) {
    // Clicking a backlink subject switches to Tree view and navigates there.
    // This goes through exploreFromBacklink() — a special breadcrumb reset
    // that keeps the root facet and inserts this subject as the second step.
    const badge = renderSubjectBadge(subjUri, {
      onClick: (uri) => {
        document.getElementById('view-tree').click();
        this.controller.exploreFromBacklink({
          type: 'named-node',
          term: { termType: 'NamedNode', value: uri },
          timestamp: Date.now(),
        });
      },
    });
    badge.classList.add('backlink-subject');
    return badge;
  }

  // Build the non-wrapping "→ predicate → target" section of a backlink row.
  _buildRelation(predicateUri) {
    const relation = document.createElement('div');
    relation.className = 'backlink-relation';

    relation.appendChild(this._buildArrow());

    const predBadge = renderTerm({ termType: 'NamedNode', value: predicateUri });
    predBadge.className = 'badge text-warning-emphasis bg-warning-subtle tree-type-badge';
    relation.appendChild(predBadge);

    relation.appendChild(this._buildArrow());
    relation.appendChild(renderSubjectBadge(this.currentUri, { clickable: false }));

    return relation;
  }

  _buildArrow() {
    const arrow = document.createElement('span');
    arrow.className = 'backlink-arrow';
    return arrow;
  }

  _addLoadMoreButton() {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-secondary btn-sm mt-2 load-more-btn';
    btn.innerHTML = '<i class="bi bi-plus-circle"></i> Load more backlinks';
    btn.addEventListener('click', () => this._loadBatch(/* isFirst */ false));
    this.content.appendChild(btn);
  }

  _removeLoadMoreButton() {
    const existing = this.content.querySelector('.load-more-btn');
    if (existing) existing.remove();
  }
}

