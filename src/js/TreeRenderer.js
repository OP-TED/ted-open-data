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

import { ns } from './utils/namespaces.js';
import { renderSubjectBadge, renderTerm } from './TermRenderer.js';

const RDF_TYPE = ns.rdf + 'type';

export class TreeRenderer {
  constructor(container) {
    this.container = container;
    this.subjectIndex = null; // Map<subject, Map<predicate, object[]>>
  }

  render(quads) {
    this.container.innerHTML = '';

    if (!quads || quads.length === 0) {
      this.container.innerHTML = '<div class="text-muted fst-italic py-3 text-center">No triples to display</div>';
      return;
    }

    this.subjectIndex = this._buildIndex(quads);
    const roots = this._findRootSubjects(quads);

    // `ancestors` is per-branch, not global: the same subject can appear
    // under multiple parents but a real A → B → A cycle is guarded against.
    for (const subj of roots) {
      const node = this._renderSubjectTree(subj, new Set(), null);
      this.container.appendChild(node);
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

    const toggleBody = () => {
      if (!body) {
        body = buildBody();
        card.appendChild(body);
        toggle.textContent = '▼';
        toggle.setAttribute('aria-expanded', 'true');
        return;
      }
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? '▼' : '▶';
      toggle.setAttribute('aria-expanded', String(collapsed));
    };

    toggle.addEventListener('click', toggleBody);
    // Keyboard activation for screen-reader and keyboard-only users.
    // Space and Enter are the canonical keys for role="button".
    toggle.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
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

    const hasTypes = (predicates.get(RDF_TYPE) || []).length > 0;
    if (hasTypes) {
      header.appendChild(renderSubjectBadge(subjectValue));
    } else {
      header.appendChild(renderTerm({ termType: 'NamedNode', value: subjectValue }));
    }

    return header;
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

    const pred = renderTerm({ termType: 'NamedNode', value: predValue });
    pred.classList.add('predicate');
    row.appendChild(pred);

    row.appendChild(document.createTextNode(' → '));
    row.appendChild(renderTerm(object));

    return row;
  }
}

