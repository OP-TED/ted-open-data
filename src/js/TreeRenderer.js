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
// TreeRenderer — builds a collapsible RDF tree from parsed quads.
//
// The tree is built around "subjects": each unique RDF subject becomes a card
// whose header shows the resource identity and whose body lists the
// predicate-object pairs. When an object is itself a subject in the dataset,
// its card is nested inside the parent — this is how the tree grows.
//
// Nested cards are built lazily: when the user expands them, not when the
// outer tree renders. This keeps the initial render fast even for notices
// with tens of thousands of triples.

import { ns, resolvePrefix, shrink } from './utils/namespaces.js';
import { renderSubjectBadge, renderTerm } from './TermRenderer.js';
import { copyToClipboard } from './utils/clipboardCopy.js';

const RDF_TYPE = ns.rdf + 'type';

export class TreeRenderer {
  constructor(container) {
    this.container = container;
    this.subjectIndex = null; // Map<subject, Map<predicate, object[]>>
    this._activePopover = null;
    this._toggles = new Map();  // subjectValue → { toggle, expand, collapse, card }
    this._searchIndex = [];     // flat array of { label, subjectValue, kind }
  }

  render(quads, { subjectUri } = {}) {
    this._dismissPopover();
    this.container.innerHTML = '';
    this._toggles.clear();
    this._searchIndex = [];

    if (!quads || quads.length === 0) {
      if (subjectUri) {
        // Show an empty card with the header + info button
        const card = document.createElement('div');
        card.className = 'tree-card';
        const predicates = new Map();
        const header = this._buildCardHeader(subjectUri, predicates, null);
        const toggle = header.querySelector('.tree-toggle');
        if (toggle) toggle.remove();
        card.appendChild(header);
        const body = document.createElement('div');
        body.className = 'tree-card-body';
        body.innerHTML = '<div class="text-muted fst-italic py-3 text-center">No triples to display</div>';
        card.appendChild(body);
        this.container.appendChild(card);
      } else {
        this.container.innerHTML = '<div class="text-muted fst-italic py-3 text-center">No triples to display</div>';
      }
      return;
    }

    this.subjectIndex = this._buildIndex(quads);
    this._buildSearchIndex();
    const roots = this._findRootSubjects(quads);

    // `ancestors` is per-branch, not global: the same subject can appear
    // under multiple parents but a real A → B → A cycle is guarded against.
    for (const subj of roots) {
      const node = this._renderSubjectTree(subj, new Set(), null);
      this.container.appendChild(node);
    }
  }

  // Search the tree for a query string. Returns an array of
  // { subjectValue, kind, label } entries matching the query.
  search(query) {
    if (!query || !query.trim()) return [];
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return [];
    return this._searchIndex.filter(e => {
      const text = e.label.toLowerCase();
      return words.every(w => text.includes(w));
    });
  }

  // Expand the path from root to a subject, forcing lazy card
  // creation at each level. Then optionally find a specific row.
  // Returns the matching DOM element (row or card).
  // `path` is the ancestor chain captured during the DFS index walk.
  reveal(subjectValue, predValue, objValue, path) {
    // Use the path from the search index entry (cycle-safe by
    // construction) or fall back to just the subject itself.
    const chain = path || [subjectValue];

    // Expand each level from root down, forcing lazy card creation
    for (const subj of chain) {
      const entry = this._toggles.get(subj);
      if (entry) entry.expand();
    }

    const entry = this._toggles.get(subjectValue);
    if (!entry) return null;

    // If a specific predicate+object is given, find the matching element.
    if (predValue && objValue) {
      // First try leaf rows (predicate → literal/non-nestable object)
      const rows = entry.card.querySelectorAll(':scope > .tree-card-body > .tree-node');
      for (const row of rows) {
        if (row.dataset.predicate === predValue && row.dataset.objectValue === objValue) {
          return row;
        }
      }
      // Then try nested card headers (predicate → nestable subject)
      const nestedCards = entry.card.querySelectorAll(':scope > .tree-card-body > .tree-card');
      for (const nested of nestedCards) {
        if (nested.dataset.subject === objValue) {
          return nested.querySelector('.tree-card-header') || nested;
        }
      }
    }

    // Fallback: highlight just the header, not the entire card
    return entry.card.querySelector('.tree-card-header') || entry.card;
  }

  get searchIndex() {
    return this._searchIndex;
  }

  _buildSearchIndex() {
    const localName = (uri) => {
      const hash = uri.lastIndexOf('#');
      const slash = uri.lastIndexOf('/');
      return uri.substring(Math.max(hash, slash) + 1);
    };

    // Walk the tree depth-first in display order. Each search entry
    // carries the ancestor path so reveal() can expand from root
    // without relying on a parent map (which breaks on cycles).
    const roots = this._findRootSubjects([...this._flatQuads()]);
    const visited = new Set();
    const walk = (subj, ancestorPath) => {
      if (visited.has(subj)) return;
      visited.add(subj);
      const predicates = this.subjectIndex.get(subj);
      if (!predicates) return;

      const path = [...ancestorPath, subj];

      for (const [pred, objects] of predicates) {
        const predLabel = localName(pred);
        for (const obj of objects) {
          const objLabel = obj.termType === 'Literal' ? obj.value : localName(obj.value);
          this._searchIndex.push({
            label: `${predLabel} → ${objLabel}`,
            predLabel, objLabel,
            subjectValue: subj,
            predValue: pred,
            objValue: obj.value,
            path,
            kind: 'row',
          });
          // Recurse into nestable objects (same logic as _partitionObjects)
          const isSubject = this.subjectIndex.has(obj.value);
          const isNode = obj.termType === 'NamedNode' || obj.termType === 'BlankNode';
          if (isSubject && isNode) walk(obj.value, path);
        }
      }
    };
    for (const root of roots) walk(root, []);
  }

  // Yield all quads from the subject index (for _findRootSubjects).
  *_flatQuads() {
    for (const [subj, predicates] of this.subjectIndex) {
      for (const [pred, objects] of predicates) {
        for (const obj of objects) {
          yield { subject: { value: subj }, predicate: { value: pred }, object: obj };
        }
      }
    }
  }

  _buildIndex(quads) {
    const index = new Map();
    for (const quad of quads) {
      const subj = quad.subject.value;
      const pred = quad.predicate.value;
      if (!index.has(subj)) index.set(subj, new Map());
      const predicates = index.get(subj);
      if (!predicates.has(pred)) predicates.set(pred, []);
      predicates.get(pred).push(quad.object);
    }
    return index;
  }

  // Roots are subjects never referenced as objects anywhere. Falls back to
  // the full subject set when the dataset has only cycles (unusual).
  _findRootSubjects(quads) {
    const allObjects = new Set();
    for (const quad of quads) {
      if (quad.object.termType === 'NamedNode' || quad.object.termType === 'BlankNode') {
        allObjects.add(quad.object.value);
      }
    }
    const roots = [];
    for (const subj of this.subjectIndex.keys()) {
      if (!allObjects.has(subj)) roots.push(subj);
    }
    return roots.length > 0 ? roots : Array.from(this.subjectIndex.keys());
  }

  // Render one subject as a card. Nested cards are lazily built on first
  // toggle-expand to keep the initial DOM small.
  _renderSubjectTree(subjectValue, ancestors, incomingPredicate) {
    const fragment = document.createDocumentFragment();
    const predicates = this.subjectIndex.get(subjectValue);
    if (!predicates) return fragment;

    if (ancestors.has(subjectValue)) {
      fragment.appendChild(this._renderCycleMarker(subjectValue));
      return fragment;
    }

    const branchAncestors = new Set(ancestors);
    branchAncestors.add(subjectValue);

    const card = document.createElement('div');
    card.className = 'tree-card';
    card.dataset.subject = subjectValue;
    card.appendChild(this._buildCardHeader(subjectValue, predicates, incomingPredicate));

    // Root cards render their body eagerly so the tree is
    // immediately visible. Nested cards defer body creation until
    // first expand (lazy render).
    const startExpanded = !incomingPredicate;
    const toggle = card.querySelector('.tree-toggle');
    const buildBody = () => this._buildCardBody(predicates, branchAncestors);
    let body = null;

    if (startExpanded) {
      body = buildBody();
      card.appendChild(body);
    }
    toggle.textContent = startExpanded ? '▼' : '▶';
    toggle.setAttribute('aria-expanded', String(startExpanded));

    const expand = () => {
      if (!body) {
        body = buildBody();
        card.appendChild(body);
      }
      body.style.display = '';
      toggle.textContent = '▼';
      toggle.setAttribute('aria-expanded', 'true');
    };

    const collapse = () => {
      if (body) body.style.display = 'none';
      toggle.textContent = '▶';
      toggle.setAttribute('aria-expanded', 'false');
    };

    const toggleBody = () => {
      if (!body || body.style.display === 'none') expand();
      else collapse();
    };

    this._toggles.set(subjectValue, { toggle, expand, collapse, card });

    toggle.addEventListener('click', (e) => { e.stopPropagation(); toggleBody(); });
    // Keyboard activation for screen-reader and keyboard-only users.
    // Space and Enter are the canonical keys for role="button".
    toggle.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggleBody();
    });

    // Clicking anywhere on the header toggles expand/collapse, except
    // when the click lands on an interactive child (link, badge).
    const header = card.querySelector('.tree-card-header');
    header.style.cursor = 'pointer';
    header.addEventListener('click', (e) => {
      const target = e.target.closest('a, .split-badge, .tree-toggle');
      if (target && target !== toggle) return; // let links/badges handle it
      toggleBody();
    });

    fragment.appendChild(card);
    return fragment;
  }

  _renderCycleMarker(subjectValue) {
    const el = document.createElement('div');
    el.className = 'tree-node';
    el.appendChild(renderTerm({ termType: 'NamedNode', value: subjectValue }));
    el.appendChild(document.createTextNode(' (circular ref)'));
    return el;
  }

  _buildCardHeader(subjectValue, predicates, incomingPredicate) {
    const header = document.createElement('div');
    header.className = 'tree-card-header';

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = '▼';
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('tabindex', '0');
    toggle.setAttribute('aria-label', 'Toggle card');
    header.appendChild(toggle);
    header.appendChild(document.createTextNode(' '));

    if (incomingPredicate) {
      const pred = renderTerm({ termType: 'NamedNode', value: incomingPredicate });
      pred.classList.add('predicate');
      header.appendChild(pred);
      header.appendChild(document.createTextNode(' → '));
    }

    header.appendChild(renderSubjectBadge(subjectValue));

    // Add info icon for root-level cards (no incoming predicate)
    if (!incomingPredicate) {
      header.appendChild(this._buildInfoButton(subjectValue, predicates));
    }

    return header;
  }

  _dismissPopover() {
    if (this._activePopoverCleanup) {
      this._activePopoverCleanup();
      this._activePopoverCleanup = null;
    }
    if (this._activePopover) {
      this._activePopover.hide();
      this._activePopover.dispose();
      this._activePopover = null;
    }
  }

  _buildInfoButton(subjectValue, predicates) {
    const btn = document.createElement('button');
    btn.className = 'tree-info-btn';
    btn.setAttribute('aria-label', 'SPARQL reference card');
    btn.setAttribute('title', 'Click here for referencing this element in your SPARQL query');
    btn.innerHTML = '<i class="bi bi-code-square"></i>';
    const tooltip = new bootstrap.Tooltip(btn, { placement: 'top' });

    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const resolved = resolvePrefix(subjectValue);
    const types = (predicates.get(RDF_TYPE) || []).map(t => shrink(t.value));
    const title = `<span>SPARQL reference card</span><button class="btn-close tree-info-close" aria-label="Close"></button>`;

    const copyIcon = (value, label) =>
      `<button class="tree-info-copy-inline" data-copy="${esc(value)}" title="${label}"><i class="bi bi-clipboard"></i></button>`;

    const rows = [
      `<p class="tree-info-intro">Use the following in your SPARQL query</p>`,
    ];

    if (resolved) {
      // Ontology/vocabulary term — PREFIX, Name
      const prefixDecl = `PREFIX ${resolved.prefix}: <${ns[resolved.prefix]}>`;
      const prefixedName = `${resolved.prefix}:${resolved.localName}`;
      rows.push(`<div class="tree-info-row"><span class="tree-info-label">Prefix</span>${copyIcon(prefixDecl, 'Copy prefix declaration')}<code class="tree-info-value">${esc(prefixDecl)}</code></div>`);
      rows.push(`<div class="tree-info-row"><span class="tree-info-label">Name</span>${copyIcon(prefixedName, 'Copy name')}<code class="tree-info-value">${esc(prefixedName)}</code></div>`);
    } else {
      // Data resource — PREFIX (from type), Name (type), IRI
      if (types.length) {
        const typeResolved = resolvePrefix((predicates.get(RDF_TYPE) || [])[0]?.value);
        if (typeResolved) {
          const typePrefixDecl = `PREFIX ${typeResolved.prefix}: <${ns[typeResolved.prefix]}>`;
          rows.push(`<div class="tree-info-row"><span class="tree-info-label">Prefix</span>${copyIcon(typePrefixDecl, 'Copy prefix declaration')}<code class="tree-info-value">${esc(typePrefixDecl)}</code></div>`);
        }
        rows.push(`<div class="tree-info-row"><span class="tree-info-label">Name</span>${copyIcon(types[0], 'Copy name')}<code class="tree-info-value">${esc(types.join(', '))}</code></div>`);
      }
      const iri = `<${subjectValue}>`;
      rows.push(`<div class="tree-info-row"><span class="tree-info-label">IRI</span>${copyIcon(iri, 'Copy IRI')}<code class="tree-info-value">${esc(iri)}</code></div>`);
    }

    const lines = [`<div class="tree-info-popover">`, ...rows, `</div>`].join('\n');

    const popover = new bootstrap.Popover(btn, {
      title,
      content: lines,
      html: true,
      sanitize: false,
      placement: 'bottom',
      trigger: 'manual',
      container: 'body',
      customClass: 'tree-info-popover-container',
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      tooltip.hide();
      tooltip.disable();
      if (this._activePopover === popover) {
        popover.hide();
        this._activePopover = null;
        tooltip.enable();
      } else {
        this._dismissPopover();
        popover.show();
        this._activePopover = popover;
      }
    });

    btn.addEventListener('hidden.bs.popover', () => {
      tooltip.enable();
    });

    btn.addEventListener('shown.bs.popover', () => {
      const tip = popover.tip;
      if (!tip) return;
      const onOutsideClick = (e) => {
        if (!tip.contains(e.target) && !btn.contains(e.target)) {
          popover.hide();
          this._activePopover = null;
          document.removeEventListener('click', onOutsideClick, true);
        }
      };
      document.addEventListener('click', onOutsideClick, true);
      const cleanup = () => {
        document.removeEventListener('click', onOutsideClick, true);
      };
      this._activePopoverCleanup = cleanup;
      btn.addEventListener('hidden.bs.popover', () => {
        cleanup();
        if (this._activePopoverCleanup === cleanup) this._activePopoverCleanup = null;
      }, { once: true });
      const closeBtn = tip.querySelector('.tree-info-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          popover.hide();
          this._activePopover = null;
        });
      }
      tip.querySelectorAll('.tree-info-copy-inline').forEach(cb => {
        cb.addEventListener('click', async () => {
          const ok = await copyToClipboard(cb.dataset.copy);
          cb.innerHTML = ok ? '<i class="bi bi-check"></i>' : '<i class="bi bi-x"></i>';
          setTimeout(() => { cb.innerHTML = '<i class="bi bi-clipboard"></i>'; }, 1500);
        });
      });
    });

    return btn;
  }

  _buildCardBody(predicates, branchAncestors) {
    const body = document.createElement('div');
    body.className = 'tree-card-body';

    for (const [predValue, objects] of predicates) {
      const [nestable, nonNestable] = this._partitionObjects(objects, branchAncestors);

      for (const obj of nonNestable) {
        body.appendChild(this._renderPredicateObject(predValue, obj));
      }
      for (const obj of nestable) {
        body.appendChild(this._renderSubjectTree(obj.value, branchAncestors, predValue));
      }
    }

    return body;
  }

  // Split objects into (a) those that can nest as subtrees — subjects in the
  // dataset that aren't already on the current ancestor path — and (b) plain
  // literal/leaf objects that become predicate → value rows.
  _partitionObjects(objects, branchAncestors) {
    const nestable = [];
    const nonNestable = [];
    for (const obj of objects) {
      const isSubject = this.subjectIndex.has(obj.value) && !branchAncestors.has(obj.value);
      const isNode = obj.termType === 'NamedNode' || obj.termType === 'BlankNode';
      if (isSubject && isNode) nestable.push(obj);
      else nonNestable.push(obj);
    }
    return [nestable, nonNestable];
  }

  _renderPredicateObject(predValue, object) {
    const row = document.createElement('div');
    row.className = 'tree-node';
    row.dataset.predicate = predValue;
    row.dataset.objectValue = object.value;

    const pred = renderTerm({ termType: 'NamedNode', value: predValue });
    pred.classList.add('predicate');
    row.appendChild(pred);

    row.appendChild(document.createTextNode(' → '));
    row.appendChild(renderTerm(object));

    return row;
  }
}

