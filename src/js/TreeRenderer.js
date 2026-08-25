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
import { showToast } from './utils/toast.js';

const RDF_TYPE = ns.rdf + 'type';

// The characters SPARQL's IRIREF grammar excludes: everything up to and
// including space, plus <, >, ", {, }, |, ^, backtick and backslash. A URI
// carrying one of these cannot be written between angle brackets at all.
const IRIREF_FORBIDDEN = /[\u0000-\u0020<>"{}|^`\\]/g;

// A conservative subset of SPARQL's PN_LOCAL: starts with a letter, digit or
// underscore, may carry dots or hyphens inside, and never ends in a dot.
// Anything outside it keeps its full bracketed IRI — over-bracketing costs
// only verbosity, while a malformed prefixed name costs correctness.
const SAFE_LOCAL_NAME = /^[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?$/;

// The kinds of term that make a statement of their own, so that a usage
// pattern can be written for them.
//
// The characteristics below are property classes in their own right —
// owl:FunctionalProperty is a subclass of rdf:Property, the rest of
// owl:ObjectProperty — so declaring one says what the subject is, not merely
// how it behaves. A property may carry only a characteristic and nothing else.
const PROPERTY_TYPES = [
  `${ns.owl}ObjectProperty`,
  `${ns.owl}DatatypeProperty`,
  `${ns.owl}AnnotationProperty`,
  `${ns.rdf}Property`,
  `${ns.owl}FunctionalProperty`,
  `${ns.owl}InverseFunctionalProperty`,
  `${ns.owl}TransitiveProperty`,
  `${ns.owl}SymmetricProperty`,
  `${ns.owl}AsymmetricProperty`,
  `${ns.owl}ReflexiveProperty`,
  `${ns.owl}IrreflexiveProperty`,
];

// Declaring any of these makes a subject part of a vocabulary rather than
// something the data describes — whichever namespace it happens to live in.
// The list cannot be complete: OWL and RDFS keep company with metatypes
// nobody thinks of, which is why it never stands alone.
const TERM_TYPES = [
  `${ns.owl}Class`,
  `${ns.rdfs}Class`,
  `${ns.rdfs}Datatype`,
  `${ns.owl}Ontology`,
  ...PROPERTY_TYPES,
];

// The reference card is built as HTML rather than elements, so everything
// placed in it is escaped. Both the card for a resource and the card for a
// row are laid out the same way, and share these.
const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const copyIcon = (value, label) =>
  `<button class="tree-info-copy-inline" data-copy="${esc(value)}" title="${esc(label)}"><i class="bi bi-clipboard"></i></button>`;

const infoRow = (label, copyValue, display, copyLabel) =>
  `<div class="tree-info-row"><span class="tree-info-label">${label}</span>`
  + `${copyIcon(copyValue, copyLabel)}<code class="tree-info-value">${esc(display)}</code></div>`;

export class TreeRenderer {
  constructor(container) {
    this.container = container;
    this.subjectIndex = null; // Map<subject, Map<predicate, object[]>>
    // The open card's own teardown, not the Popover instance. Holding the
    // instance would mean disposing an object another closure still points
    // at, and a disposed Popover is a husk — Bootstrap nulls every property
    // on it, so the next open would call show() on nothing.
    this._closeActivePopover = null;
    this._toggles = new Map();  // subjectValue → { toggle, expand, collapse, card }
    this._searchIndex = [];     // flat array of { label, subjectValue, kind }
  }

  render(quads, { subjectUri, pathFromRoot = [], rootPattern = null } = {}) {
    // How the user reached this tree: the predicate chain walked from the
    // first breadcrumb entry, and the pattern binding that entry. Both come
    // from DataView, which owns the breadcrumb. Empty when we are at the root.
    this._pathFromRoot = pathFromRoot;
    this._rootPattern = rootPattern;
    this._navigatedSubject = subjectUri;
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
      // Each root anchors its own chain. A graph can surface several, and a
      // chain walked beneath one of them says nothing about the others.
      const pathCtx = {
        root: subj,
        anchor: this._buildAnchorPattern(subj, this.subjectIndex.get(subj)),
        chain: [],
      };
      const node = this._renderSubjectTree(subj, new Set(), null, pathCtx);
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
    // The index is keyed by subject value, which loses the distinction
    // between an IRI and a blank node. That matters when building query
    // patterns: a blank node's label is local to the parse and cannot be
    // written as an IRI, so remember which subjects are blank.
    this._blankSubjects = new Set();
    for (const quad of quads) {
      const subj = quad.subject.value;
      const pred = quad.predicate.value;
      if (quad.subject.termType === 'BlankNode') this._blankSubjects.add(subj);
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
  _renderSubjectTree(subjectValue, ancestors, incomingPredicate, pathCtx = null) {
    const fragment = document.createDocumentFragment();
    const predicates = this.subjectIndex.get(subjectValue);
    if (!predicates) return fragment;

    if (ancestors.has(subjectValue)) {
      // The marker stands where the nested card would have been, so it is
      // reached by the same route and has to report the same context.
      fragment.appendChild(this._renderCycleMarker(subjectValue, pathCtx));
      return fragment;
    }

    const branchAncestors = new Set(ancestors);
    branchAncestors.add(subjectValue);

    const card = document.createElement('div');
    card.className = 'tree-card';
    card.dataset.subject = subjectValue;
    card.appendChild(this._buildCardHeader(subjectValue, predicates, incomingPredicate, pathCtx));

    // Root cards render their body eagerly so the tree is
    // immediately visible. Nested cards defer body creation until
    // first expand (lazy render).
    const startExpanded = !incomingPredicate;
    const toggle = card.querySelector('.tree-toggle');
    const buildBody = () => this._buildCardBody(predicates, branchAncestors, pathCtx);
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
      // Let links, badges and the actions menu handle their own clicks. The
      // menu lives inside the header, so without this opening it would also
      // expand the card underneath.
      const target = e.target.closest('a, .split-badge, .tree-toggle, .tree-actions');
      if (target && target !== toggle) return;
      toggleBody();
    });

    fragment.appendChild(card);
    return fragment;
  }

  _renderCycleMarker(subjectValue, pathCtx = null) {
    const el = document.createElement('div');
    el.className = 'tree-node';
    el.appendChild(renderTerm({ termType: 'NamedNode', value: subjectValue }, this._navigationContext(pathCtx)));
    el.appendChild(document.createTextNode(' (circular ref)'));
    return el;
  }

  _buildCardHeader(subjectValue, predicates, incomingPredicate, pathCtx = null) {
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

    let pred = null;
    if (incomingPredicate) {
      // Deliberately carries no navigation context. Clicking a predicate jumps
      // to its definition in the ontology, which is not somewhere the walked
      // route leads — reporting the chain here would claim the notice reaches
      // the term epo:announcesRole by following epo:announcesRole.
      pred = renderTerm({ termType: 'NamedNode', value: incomingPredicate });
      pred.classList.add('predicate');
      header.appendChild(pred);
      header.appendChild(document.createTextNode(' → '));
    }

    const badge = renderSubjectBadge(subjectValue, this._navigationContext(pathCtx));
    header.appendChild(badge);

    if (incomingPredicate) {
      // A nested card's header is a row like any other: it states one triple,
      // and its card answers for that statement rather than for the resource
      // in isolation.
      // A blank node is passed as none: its label belongs to this parse alone,
      // so there is neither an IRI to offer nor anything worth copying.
      const object = this._isBlankSubject(subjectValue)
        ? null
        : { termType: 'NamedNode', value: subjectValue };
      header.appendChild(
        this._buildRowInfoButton(incomingPredicate, predicates, pathCtx, object, pred));
    } else {
      // A root card's menu answers for the resource, so its card hangs off
      // the badge that names it.
      // An ontology term is not a place in anyone's data, so there is no path
      // to it — the same distinction the card makes by showing Usage instead.
      // Offering one here would copy "?datatypeProperty a owl:DatatypeProperty",
      // which matches every datatype property rather than this one.
      const isTerm = this._isOntologyTerm(subjectValue, predicates);
      header.appendChild(this._buildActionsMenu({
        label: 'Actions for this element',
        anchor: badge,
        copies: [
          {
            icon: 'bi-clipboard',
            item: 'Copy path',
            value: isTerm ? null : this._buildPathPattern(subjectValue, predicates),
            title: 'Path copied',
            body: 'The pattern that reaches this resource in a query:',
          },
          {
            icon: 'bi-clipboard',
            item: 'Copy usage',
            value: isTerm ? this._buildUsagePattern(subjectValue, predicates) : null,
            title: 'Usage copied',
            body: 'The shape of the statement this property makes:',
          },
          {
            icon: 'bi-clipboard',
            item: 'Copy IRI',
            value: this._isBlankSubject(subjectValue) ? null : subjectValue,
            title: 'IRI copied',
            body: 'The identifier of this resource is now on your clipboard:',
          },
        ],
        buildContent: () => this._buildInfoRows(subjectValue, predicates),
      }));
    }

    return header;
  }

  /** Shut whichever card is open, through the teardown that card owns. */
  _dismissPopover() {
    if (this._closeActivePopover) this._closeActivePopover();
  }

  // The body of the SPARQL reference card, as HTML. Split out from
  // _buildActionsMenu so the content can be asserted on without standing up a
  // Bootstrap popover.
  _buildInfoRows(subjectValue, predicates) {
    // Work out everything the card will show before deciding what to declare.
    // The prefixes needed depend on the finished text — the Path in particular
    // carries predicates from the whole walked route, not just this resource's
    // type — so guessing them from the terms that went in gets it wrong.
    const isVocabularyTerm = this._isOntologyTerm(subjectValue, predicates);
    const types = this._typeUris(predicates).map(uri => this._shrinkOrBracket(uri));

    let name = null;
    let nameCopy = null;
    let path = null;
    let usage = null;
    let iri = null;

    if (isVocabularyTerm) {
      // The subject is itself an ontology term, so it names a class or
      // property rather than describing an instance.
      name = nameCopy = this._shrinkOrBracket(subjectValue);
      // No Path: a term is not somewhere the data leads. The same property is
      // reached by countless routes, and the one the reader happened to
      // arrive by is a fact about that notice, not about the term. What can
      // be said is how the term is used, which the ontology states.
      usage = this._buildUsagePattern(subjectValue, predicates);
    } else {
      if (types.length) {
        // What is copied is what is shown, and it matches what the Path binds
        // — a resource is all of its types, and picking one would depend on
        // the order the endpoint happened to return them in.
        name = nameCopy = types.join(', ');
      }
      // Null when the resource cannot be named in a query at all — an untyped
      // blank node. An unusable pattern would be worse than none.
      path = this._buildPathPattern(subjectValue, predicates);
      // A blank node has no IRI. Its label is local to this parse, so wrapping
      // it in angle brackets would offer <b0_b0> — a relative reference to
      // something else entirely — as though it identified this resource.
      if (!this._isBlankSubject(subjectValue)) iri = this._asIriRef(subjectValue);
    }

    const rows = [`<p class="tree-info-intro">Use the following in your SPARQL query</p>`];

    // One declaration per prefix the rows below actually use, so the whole
    // card can be pasted into an empty query and still parse.
    for (const prefix of this._prefixesUsedIn([name, path])) {
      const decl = `PREFIX ${prefix}: <${ns[prefix]}>`;
      rows.push(infoRow('Prefix', decl, decl, 'Copy prefix declaration'));
    }

    if (name) rows.push(infoRow('Name', nameCopy, name, 'Copy name'));
    if (path) rows.push(infoRow('Path', path, path, 'Copy path'));
    if (usage) rows.push(infoRow('Usage', usage, usage, 'Copy usage'));
    if (iri) rows.push(infoRow('IRI', iri, iri, 'Copy IRI'));

    return [`<div class="tree-info-popover">`, ...rows, `</div>`].join('\n');
  }

  // Whether the subject is a term of some vocabulary — a class or a property
  // — rather than a resource described by the data.
  //
  // Two signals, either of which is enough.
  //
  // What it declares itself to be holds for a vocabulary this application has
  // never heard of. Where it lives holds for terms whose declared type is not
  // one this code lists — `xsd:date a rdfs:Datatype`, a property declared only
  // `owl:FunctionalProperty` — and for terms with no triples loaded at all.
  // Neither covers the other, so both are asked.
  _isOntologyTerm(subjectValue, predicates) {
    const declared = new Set(this._typeUris(predicates));
    return TERM_TYPES.some(type => declared.has(type)) || Boolean(resolvePrefix(subjectValue));
  }

  // How a property is used, from what the ontology says it connects:
  // "?document epo:hasPublicationDate ?date ." from rdfs:domain Document and
  // rdfs:range xsd:date.
  //
  // This is what the term's own page can honestly offer in place of a Path. A
  // path is a route through one notice's data; a property has no position, it
  // has a shape, and the shape holds wherever it is used.
  //
  // Null for anything that is not a property — a class is named, not used in
  // this sense — and the variables fall back to neutral names where the
  // ontology states no domain or range.
  _buildUsagePattern(subjectValue, predicates) {
    const declared = new Set(this._typeUris(predicates));
    if (!PROPERTY_TYPES.some(type => declared.has(type))) return null;

    const first = (predicateUri) => (predicates?.get(predicateUri) || [])
      .map(term => term.value)
      .filter(Boolean)[0] ?? null;

    const domain = first(`${ns.rdfs}domain`);
    const range = first(`${ns.rdfs}range`);
    const subject = domain ? this._variableNameFrom([domain]) : 'subject';
    const object = range ? this._variableNameFrom([range]) : 'value';

    // Domain and range appear only as variable names, never as terms, so a
    // usage pattern introduces no prefix beyond the property's own — which is
    // why it is not consulted when working out the declarations.
    //
    // A property whose domain and range are the same class would bind one
    // variable at both ends, matching only self-references.
    const objectVar = subject === object ? `${object}2` : object;
    return `?${subject} ${this._shrinkOrBracket(subjectValue)} ?${objectVar} .`;
  }

  // The prefixes appearing in the given patterns, in namespace-table order.
  //
  // Read back off the finished text rather than tracked while building it,
  // because the Path's anchor may have been composed during an earlier render
  // and carried here on the breadcrumb — by then only the string survives.
  // Every prefix is matched literally against the known table, so an unrelated
  // colon cannot invent one; at worst a colon inside a bracketed IRI declares
  // a prefix nothing uses, which is redundant but still valid SPARQL.
  _prefixesUsedIn(patterns) {
    const text = patterns.filter(Boolean).join('\n');
    return Object.keys(ns).filter(prefix =>
      new RegExp(`(^|[^A-Za-z0-9_-])${prefix}:`).test(text),
    );
  }

  // The actions menu carried by a card header and by every row.
  //
  // A row states a triple, and "how do I reach this in a query" is asked of a
  // value at least as often as of the resource holding it — so the menu sits
  // on both. It holds one item today; a menu rather than a bare button
  // because a row is where further actions on a single statement belong, and
  // because one repeated on every row should be quiet until it is wanted.
  //
  // `buildContent` is called the first time the card is opened rather than at
  // render: a notice puts hundreds of these on screen and almost none of them
  // is opened.
  _buildActionsMenu({ label, buildContent, anchor = null, copies = [] }) {
    const wrap = document.createElement('span');
    wrap.className = 'tree-actions dropdown';

    const btn = document.createElement('button');
    btn.className = 'tree-actions-btn';
    btn.type = 'button';
    btn.setAttribute('data-bs-toggle', 'dropdown');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', label);
    btn.innerHTML = '<i class="bi bi-three-dots-vertical"></i>';

    const menu = document.createElement('ul');
    menu.className = 'dropdown-menu dropdown-menu-end tree-actions-menu';

    const addItem = (icon, text) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dropdown-item';
      button.innerHTML = `<i class="bi ${icon}"></i> ${text}`;
      li.appendChild(button);
      menu.appendChild(li);
      return button;
    };

    // The path comes first. People reading a notice this closely are mostly
    // learning SPARQL and ePO, and the path is what they came for; the value
    // is the everyday task, and the card the longer answer.
    let copied = 0;
    for (const copy of copies) {
      if (!copy.value) continue;
      this._wireCopyItem(addItem(copy.icon, copy.item), copy);
      copied++;
    }
    // Separated because it is a different kind of thing: the items above act
    // and close, this one opens something to read. No rule where there is
    // nothing above it to divide from.
    if (copied) {
      const li = document.createElement('li');
      const hr = document.createElement('hr');
      hr.className = 'dropdown-divider';
      li.appendChild(hr);
      menu.appendChild(li);
    }
    const action = addItem('bi-code-square', 'SPARQL reference card');

    wrap.appendChild(btn);
    wrap.appendChild(menu);

    // The card is anchored to what it describes — the property on a row, the
    // badge on a card header — rather than to the kebab at the right edge,
    // which says nothing about which row was asked about.
    const anchorEl = anchor || btn;

    let popover = null;
    let onOutsideClick = null;
    const getPopover = () => (popover ??= new bootstrap.Popover(anchorEl, {
      title: `<span>SPARQL reference card</span><button class="btn-close tree-info-close" aria-label="Close"></button>`,
      content: buildContent(),
      html: true,
      sanitize: false,
      placement: 'bottom',
      trigger: 'manual',
      container: 'body',
      customClass: 'tree-info-popover-container',
      // Bootstrap's hide() is animated by default, and so finishes after it
      // returns — while dispose() empties the instance at once. Disposing on
      // the way out then leaves the transition reading from what it emptied
      // (`Cannot convert undefined or null to object`), and leaves the
      // anchor's aria-describedby pointing at a card that has gone. Without
      // the animation the close is over when hide() returns, and a card
      // asked for from a menu is better appearing at once anyway.
      animation: false,
    }));

    // Every way this card can close comes through here. Bootstrap keeps its
    // instances in a strong map and only dispose() removes them, so a card
    // opened and left undisposed pins its anchor and its tip for the life of
    // the page. Disposing is not enough on its own either: dispose() empties
    // the instance, so the reference has to go with it or the next open
    // hands back the husk. Both steps are safe here only because the popover
    // is built without animation, so hide() has finished when it returns.
    const close = () => {
      if (onOutsideClick) {
        document.removeEventListener('click', onOutsideClick, true);
        onOutsideClick = null;
      }
      if (popover) {
        popover.hide();
        popover.dispose();
        popover = null;
      }
      if (this._closeActivePopover === close) this._closeActivePopover = null;
    };

    // The kebab itself is Bootstrap's — it opens and closes the menu through
    // the data API, so nothing here intercepts its click. The card opens from
    // the item, once the menu has closed itself.
    action.addEventListener('click', () => {
      if (this._closeActivePopover === close) {
        close();
        return;
      }
      this._dismissPopover();
      getPopover().show();
      this._closeActivePopover = close;
    });

    anchorEl.addEventListener('shown.bs.popover', () => {
      const tip = popover.tip;
      if (!tip) return;
      onOutsideClick = (e) => {
        if (!tip.contains(e.target) && !wrap.contains(e.target)) close();
      };
      document.addEventListener('click', onOutsideClick, true);
      const closeBtn = tip.querySelector('.tree-info-close');
      if (closeBtn) closeBtn.addEventListener('click', close);
      tip.querySelectorAll('.tree-info-copy-inline').forEach(cb => {
        cb.addEventListener('click', async () => {
          const ok = await copyToClipboard(cb.dataset.copy);
          cb.innerHTML = ok ? '<i class="bi bi-check"></i>' : '<i class="bi bi-x"></i>';
          setTimeout(() => { cb.innerHTML = '<i class="bi bi-clipboard"></i>'; }, 1500);
        });
      });
    });

    return wrap;
  }

  _buildRowInfoButton(predicateUri, objectPredicates, pathCtx, object = null, anchor = null) {
    const isResource = object?.termType === 'NamedNode';
    return this._buildActionsMenu({
      label: 'Actions for this value',
      anchor,
      copies: [
        {
          icon: 'bi-clipboard',
          item: 'Copy path',
          value: this._buildRowPathPattern(predicateUri, objectPredicates, pathCtx),
          title: 'Path copied',
          body: 'The pattern that reaches this value from the notice:',
        },
        {
          icon: 'bi-clipboard',
          item: 'Copy value',
          // What the row shows: the text of a literal, the IRI of a resource.
          // Not the shortened form on screen — what is copied is meant to be
          // pasted somewhere else, where the short form means nothing.
          //
          // A blank node has nothing to offer for the same reason: "b0" is a
          // label this parse invented, and it identifies nothing anywhere
          // else. Nested blank-node headers already withhold it.
          value: object && object.termType !== 'BlankNode' ? object.value : null,
          title: isResource ? 'IRI copied' : 'Value copied',
          body: isResource
            ? 'The identifier of this resource is now on your clipboard:'
            : 'This value is now on your clipboard:',
        },
      ],
      buildContent: () => this._buildRowInfoRows(predicateUri, objectPredicates, pathCtx, object),
    });
  }

  // Copy to the clipboard, reporting through a toast.
  //
  // Not by changing the item: the menu closes on the click, so a tick shown
  // there is gone before it can be read. The toast names what was copied,
  // because a resource's value is a long URI and "copied" alone leaves the
  // user unsure which of the two things on the row they now hold.
  _wireCopyItem(item, { value, title, body }) {
    // Carried on the element, as the card's own copy buttons do, so what
    // would land on the clipboard can be read off the DOM.
    item.setAttribute('data-copy', value);
    item.addEventListener('click', async () => {
      if (await copyToClipboard(value)) {
        showToast(title, body, { detail: value });
      } else {
        showToast('Nothing copied', 'The browser refused access to the clipboard.',
          { variant: 'warning' });
      }
    });
  }

  // The body of a row's reference card.
  //
  // A row is a statement, so the card describes the statement: the property
  // that makes it, and the route from the notice to the value it points at.
  // Where that value is a resource its IRI is offered too; a literal has none.
  _buildRowInfoRows(predicateUri, objectPredicates, pathCtx, object) {
    const name = this._shrinkOrBracket(predicateUri);
    const path = this._buildRowPathPattern(predicateUri, objectPredicates, pathCtx);
    const iri = object && object.termType === 'NamedNode' ? this._asIriRef(object.value) : null;

    const rows = [`<p class="tree-info-intro">Use the following in your SPARQL query</p>`];
    for (const prefix of this._prefixesUsedIn([name, path])) {
      const decl = `PREFIX ${prefix}: <${ns[prefix]}>`;
      rows.push(infoRow('Prefix', decl, decl, 'Copy prefix declaration'));
    }
    rows.push(infoRow('Name', name, name, 'Copy name'));
    if (path) rows.push(infoRow('Path', path, path, 'Copy path'));
    if (iri) rows.push(infoRow('IRI', iri, iri, 'Copy IRI'));

    return [`<div class="tree-info-popover">`, ...rows, `</div>`].join('\n');
  }

  // The pattern reaching a row's value, as one property path from wherever
  // the walk started — the same route _buildPathPattern gives for the card
  // this row sits in, carried one predicate further.
  //
  // Null when the walk has no binding to start from: an untyped blank node at
  // the root of the tree can be reached in the display but not in a query.
  _buildRowPathPattern(predicateUri, objectPredicates, pathCtx) {
    if (!pathCtx) return null;
    const fromNavigation = pathCtx.root === this._navigatedSubject && this._rootPattern;
    const anchor = fromNavigation ? this._rootPattern : pathCtx.anchor;
    if (!anchor) return null;
    const chain = fromNavigation
      ? [...(this._pathFromRoot || []), ...pathCtx.chain]
      : pathCtx.chain;
    if (!chain.length) return null;

    // Named after what the value is where the data says so, and after the
    // property that reaches it where it does not — a literal has no type.
    //
    // Renamed when it collides with the anchor's variable, as _targetVariable
    // does for a card: a notice pointing at another notice would otherwise
    // read "?notice a epo:Notice ; epo:refersToPrevious ?notice .", which
    // matches only the notices that refer to themselves.
    const typeUris = this._typeUris(objectPredicates);
    const name = this._variableNameFrom(typeUris.length ? typeUris : [predicateUri]);
    const variable = anchor.startsWith(`?${name} `) ? `${name}2` : name;
    // "?notice a epo:Notice" already states a predicate, so the chain
    // continues it with ";". An IRI anchor states none.
    const join = anchor.startsWith('?') ? ' ;' : '';
    return `${anchor}${join} ${this._formatPropertyPath(chain)} ?${variable} .`;
  }

  // The triple pattern that reaches this resource in a query.
  //
  // When the user navigated in from somewhere — say a notice, then a Reviewer
  // — the breadcrumb knows both the pattern that binds the starting point and
  // the predicate chain walked since, and the two combine into a property
  // path: "?notice a epo:Notice ; epo:announcesRole ?reviewer ." That chain is
  // what makes the resource findable from a query, and it is the thing the
  // tree alone cannot know (issue #73).
  //
  // At the start of an exploration there is no chain, so the best available
  // binding is the resource's own type — falling back to its IRI when it has
  // no type. Returns null when neither is available and the resource simply
  // cannot be referred to in a query.
  _buildPathPattern(subjectValue, predicates) {
    // A graph can surface several root cards; the walked chain belongs only
    // to the subject actually navigated to, not to its siblings.
    const chain = subjectValue === this._navigatedSubject ? (this._pathFromRoot || []) : [];
    const anchor = this._rootPattern;

    if (chain.length > 0 && anchor) {
      const targetVar = this._targetVariable(predicates, anchor);
      // "?notice a epo:Notice" already states a predicate, so the chain
      // continues it with ";". An IRI anchor states none, and a leading ";"
      // there would be a syntax error.
      const join = anchor.startsWith('?') ? ' ;' : '';
      return `${anchor}${join} ${this._formatPropertyPath(chain)} ?${targetVar} .`;
    }

    // No chain: the best available binding is the resource's own type.
    // Null means the resource cannot be expressed in a query at all.
    const pattern = this._buildAnchorPattern(subjectValue, predicates);
    if (!pattern) return null;
    return pattern.startsWith('?') ? `${pattern} .` : `${pattern} ?predicate ?value .`;
  }

  // What a click on this element should record about how it was reached: the
  // predicates walked, which root the walk started from, and the pattern that
  // binds that root. DataView needs all three to tell a continuous route from
  // a chain that silently jumped to a different part of the graph.
  _navigationContext(pathCtx) {
    if (!pathCtx) return {};
    return {
      viaPath: pathCtx.chain,
      viaRoot: pathCtx.root,
      viaRootPattern: pathCtx.anchor,
    };
  }

  // The pattern that binds a resource to a variable by its type, e.g.
  // "?notice a epo:Notice". A typed blank node works the same way, since the
  // pattern matches on the class rather than on identity.
  //
  // Every declared type is bound, not one of them. A notice typically carries
  // several — epo:Notice alongside epo:CompetitionNotice and a mapping-version
  // class like epo:Notice16 — and the endpoint returns them in no particular
  // order, so singling one out would both discard what the resource is and
  // make the pattern depend on the order the triples arrived in.
  //
  // Untyped resources have no class to match on. An IRI can still be named
  // directly; a blank node cannot — its label belongs to this parse alone and
  // means nothing in a query, so there is no pattern to offer and we say so.
  _buildAnchorPattern(subjectValue, predicates) {
    const typeUris = this._typeUris(predicates);
    if (typeUris.length) {
      const classes = typeUris.map(uri => this._shrinkOrBracket(uri)).join(', ');
      return `?${this._variableNameFrom(typeUris)} a ${classes}`;
    }
    return this._isBlankSubject(subjectValue) ? null : this._asIriRef(subjectValue);
  }

  _typeUris(predicates) {
    return (predicates?.get(RDF_TYPE) || []).map(t => t.value).filter(Boolean);
  }

  // Blank-node subjects are tracked while indexing, because the subject index
  // is keyed by bare value and `_:b0` arrives from the parser as "b0_b0" —
  // indistinguishable from a relative IRI once the term type is dropped.
  _isBlankSubject(subjectValue) {
    return this._blankSubjects?.has(subjectValue) ?? false;
  }

  // The variable the walked chain lands on, named after the resource's type so
  // the pattern says what it binds — ?contractTerm rather than a bare ?value.
  // Navigating from a notice to another notice would otherwise bind the same
  // variable at both ends: "?notice a epo:Notice ; … ?notice ."
  _targetVariable(predicates, anchor) {
    const varName = this._variableNameFrom(this._typeUris(predicates));
    return anchor.startsWith(`?${varName} `) ? `${varName}2` : varName;
  }

  // A readable variable name for a resource with these types.
  //
  // Where several types are present the shortest local name wins, which for
  // ePO tends to be the general class — ?notice over ?notice16. That is a
  // legibility preference and nothing more: a SPARQL variable name carries no
  // meaning, and every type is bound in the pattern regardless, so the choice
  // cannot change what the query matches.
  //
  // A name may only contain letters, digits and underscores, so a local name
  // carrying a hyphen or a dot would otherwise produce something unparseable.
  _variableNameFrom(typeUris) {
    const locals = [].concat(typeUris ?? [])
      .filter(Boolean)
      .map(uri => uri.split(/[#/]/).pop())
      .sort((a, b) => a.length - b.length || a.localeCompare(b));

    const local = (locals[0] || '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!local || !/^[A-Za-z_]/.test(local)) return 'value';
    return local.charAt(0).toLowerCase() + local.slice(1);
  }

  // A URI as it can safely appear in a query — prefixed where that is legal,
  // bracketed otherwise.
  //
  // shrink() matches on namespace and slices the rest off blindly, so a known
  // namespace is no guarantee of a valid prefixed name: it turns
  // http://schema.org/foo/bar into "schema:foo/bar". Inside a property path
  // that reads as a sequence operator, so the pattern parses and quietly means
  // something other than what it names. A local part outside SAFE_LOCAL_NAME
  // therefore keeps the full IRI, as does a URI in no known namespace.
  _shrinkOrBracket(uri) {
    const shortened = shrink(uri);
    if (shortened === uri) return this._asIriRef(uri);

    const localPart = shortened.slice(shortened.indexOf(':') + 1);
    return SAFE_LOCAL_NAME.test(localPart) ? shortened : this._asIriRef(uri);
  }

  // A URI written as a SPARQL IRIREF.
  //
  // Angle brackets alone do not make an arbitrary string usable: IRIREF
  // excludes <, >, ", {, }, |, ^, `, \ and everything up to and including
  // space, so <http://purl.org/dc/terms/a b> is a parse error. Those
  // characters are not legal in an IRI to begin with — data carrying one is
  // already malformed — so percent-encoding is how the value gets written
  // down, not a change to what it refers to.
  _asIriRef(uri) {
    const encoded = String(uri).replace(
      IRIREF_FORBIDDEN,
      c => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
    );
    return `<${encoded}>`;
  }

  // Format a chain of predicate URIs as a SPARQL property path, e.g.
  // ["…#announcesRole", "…#playedBy"] → "epo:announcesRole / epo:playedBy".
  _formatPropertyPath(chain) {
    return chain.map(uri => this._shrinkOrBracket(uri)).join(' / ');
  }

  _buildCardBody(predicates, branchAncestors, pathCtx = null) {
    const body = document.createElement('div');
    body.className = 'tree-card-body';

    for (const [predValue, objects] of predicates) {
      const [nestable, nonNestable] = this._partitionObjects(objects, branchAncestors);
      const childCtx = pathCtx
        ? { ...pathCtx, chain: [...pathCtx.chain, predValue] }
        : null;

      for (const obj of nonNestable) {
        body.appendChild(this._renderPredicateObject(predValue, obj, childCtx));
      }
      for (const obj of nestable) {
        body.appendChild(this._renderSubjectTree(obj.value, branchAncestors, predValue, childCtx));
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

  _renderPredicateObject(predValue, object, pathCtx = null) {
    const row = document.createElement('div');
    row.className = 'tree-node';
    row.dataset.predicate = predValue;
    row.dataset.objectValue = object.value;

    // No navigation context, for the same reason as the card header: this
    // links to the predicate's own definition, not to a step on the route.
    const pred = renderTerm({ termType: 'NamedNode', value: predValue });
    pred.classList.add('predicate');
    row.appendChild(pred);

    row.appendChild(document.createTextNode(' → '));
    row.appendChild(renderTerm(object, this._navigationContext(pathCtx)));
    // Anchored on the property: it is what the card names, and it sits at the
    // start of the row where the eye already is.
    row.appendChild(this._buildRowInfoButton(predValue, null, pathCtx, object, pred));

    return row;
  }
}

