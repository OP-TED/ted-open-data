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
// TermRenderer — renders RDF terms (NamedNode, BlankNode, Literal) as DOM
// elements. Also exposes renderSubjectBadge() for the clickable badges
// used in tree card headers and backlinks.
//
// The module keeps a reference to the ExplorerController so that default
// click handlers can navigate without the caller plumbing it through.

import { resourceIdentifier, resourceUuid, shortLabel } from './utils/namespaces.js';
import { isLabelEligible, requestLabel } from './services/labelService.js';

const BADGE_CLICKABLE = 'badge tree-type-badge tree-badge-solid';
const BADGE_READONLY = 'badge tree-type-badge tree-badge-solid';

let _controller = null;

function setController(controller) {
  _controller = controller;
}

// Render a term as a DOM element. The returned element depends on the
// term's kind (named node → <a>, blank node → plain span, literal → span
// with datatype / language suffixes).
function renderTerm(term, options = {}) {
  const { clickable = true, onClick = null, viaPath = [], viaRoot = null, viaRootPattern = null, typeName = null } = options;

  if (!term || !term.value) {
    const span = document.createElement('span');
    span.textContent = '(empty)';
    return span;
  }

  const termType = term.termType || _guessTermType(term);

  if (termType === 'BlankNode') {
    const span = document.createElement('span');
    span.textContent = term.value;
    return span;
  }

  if (termType === 'NamedNode') {
    return _renderNamedNode(term, clickable, onClick, { viaPath, viaRoot, viaRootPattern }, typeName);
  }

  return _renderLiteral(term);
}

// Guess the term type for plain objects that don't carry a termType field.
function _guessTermType(term) {
  if (term.datatype || term.language !== undefined) return 'Literal';
  if (term.value && term.value.startsWith('http')) return 'NamedNode';
  return 'Literal';
}

// A URI is navigable only if it carries a safe http(s) scheme. Anything
// else (javascript:, data:, vbscript:, blank-node-like identifiers without
// a scheme) is rendered as plain text with no href, so middle-click /
// "open in new tab" / "copy link" cannot be tricked into evaluating a
// hostile URL that the click handler's preventDefault would otherwise
// neutralise.
function _isNavigableHref(value) {
  return typeof value === 'string'
    && (value.startsWith('http://') || value.startsWith('https://'));
}

// Fill in the split pill an ePO resource URI renders as: the class on the
// left, the identifier on the right.
//
// Either half can be missing.
//
// A resource the current data only refers to has no type here — none of its
// triples are loaded — and the left half is then left off rather than filled
// in from the URI's class segment (issue #74). A resource the source data
// gives no identifier of, a notice among them, has no right half; its uuid
// stands in only when there is no type either, so that the badge still says
// something rather than nothing.
function _fillSplitBadge(el, { uuid, identifier }, typeName) {
  if (typeName) {
    const typeSpan = document.createElement('span');
    typeSpan.className = 'split-badge-type';
    typeSpan.textContent = typeName;
    el.appendChild(typeSpan);
  }

  const shown = identifier || (typeName ? null : uuid);
  if (shown) {
    const idSpan = document.createElement('span');
    idSpan.className = 'split-badge-id';
    idSpan.textContent = shown;
    el.appendChild(idSpan);
  }
}

function _renderNamedNode(term, clickable, onClick, via = {}, typeName = null) {
  // ePO resources get the same split pill as subject badges.
  const uuid = resourceUuid(term.value);
  if (uuid) {
    const el = document.createElement(clickable ? 'a' : 'span');
    el.className = 'split-badge' + (clickable ? ' split-badge-clickable' : '');
    el.title = term.value;

    _fillSplitBadge(el, { uuid, identifier: resourceIdentifier(term.value) }, typeName);

    if (clickable && _isNavigableHref(term.value)) {
      el.href = term.value;
    }
    _attachNavigationHandler(el, term, clickable, onClick, via, typeName);
    return el;
  }

  const el = document.createElement('a');
  if (_isNavigableHref(term.value)) {
    el.href = term.value;
  }
  el.className = 'uri-link';
  el.textContent = shortLabel(term.value);
  el.title = term.value;

  if (isLabelEligible(term.value)) {
    requestLabel(term.value, (label) => {
      if (label) el.textContent = label;
    });
  }

  _attachNavigationHandler(el, term, clickable, onClick, via, typeName);
  return el;
}

// Wires up the click behaviour for a NamedNode element. Blank-node-like
// identifiers (no http scheme) render as non-clickable plain text.
//
// `via` describes how this term was reached: the chain of predicate URIs
// walked (`viaPath`), the root subject that chain starts at (`viaRoot`), and
// the pattern binding that root (`viaRootPattern`). All three ride along on
// the facet that ExplorerController pushes onto the breadcrumb, so the
// breadcrumb records not just *which* resources were visited but *how* —
// which is what lets DataView.navigationPath() reconstruct the whole route
// and detect when it does not actually join up.
function _attachNavigationHandler(el, term, clickable, onClick, via = {}, typeName = null) {
  const isNavigable = _isNavigableHref(term.value);

  if (!isNavigable || !clickable) {
    el.style.cursor = 'default';
    el.removeAttribute('href');
    return;
  }

  if (onClick) {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      onClick(term.value);
    });
    return;
  }

  if (_controller) {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      _controller.navigateTo({
        type: 'named-node',
        term: { termType: 'NamedNode', value: term.value },
        viaPath: via.viaPath || [],
        viaRoot: via.viaRoot ?? null,
        viaRootPattern: via.viaRootPattern ?? null,
        typeName,
        timestamp: Date.now(),
      });
    });
  }
}

function _renderLiteral(term) {
  const span = document.createElement('span');
  span.className = 'literal';
  span.appendChild(document.createTextNode(`"${term.value}"`));

  if (term.datatype?.value) {
    const dt = term.datatype.value.split('#').pop() || '';
    if (dt && dt !== 'string') {
      const dtSpan = document.createElement('span');
      dtSpan.className = 'datatype';
      dtSpan.textContent = `^^${dt}`;
      span.appendChild(dtSpan);
    }
  }

  if (term.language) {
    const langSpan = document.createElement('span');
    langSpan.className = 'language';
    langSpan.textContent = `@${term.language}`;
    span.appendChild(langSpan);
  }

  return span;
}

// Render a subject URI as a badge. The text is the short resource label,
// asynchronously replaced with a human label if one resolves. Clickable
// badges navigate (default: extend the breadcrumb); use clickable: false
// for "you are here" markers.
//
// Builds the badge element directly rather than routing through renderTerm,
// because renderTerm would already issue a label request inside its
// _renderNamedNode helper — and then this function would issue a second
// one after overwriting the text. One badge, one request.
function renderSubjectBadge(subjectUri, options = {}) {
  const { clickable = true, badgeClass, onClick = null, viaPath = [], viaRoot = null, viaRootPattern = null, typeName = null } = options;

  const term = { termType: 'NamedNode', value: subjectUri };
  const badge = document.createElement(clickable ? 'a' : 'span');
  badge.title = subjectUri;

  const uuid = resourceUuid(subjectUri);
  if (uuid) {
    // Split badge: type (left, grey) + identifier (right, blue).
    badge.className = 'split-badge' + (clickable ? ' split-badge-clickable' : '');
    _fillSplitBadge(badge, { uuid, identifier: resourceIdentifier(subjectUri) }, typeName);
  } else {
    badge.className = badgeClass || (clickable ? BADGE_CLICKABLE : BADGE_READONLY);
    badge.textContent = shortLabel(subjectUri);
    if (isLabelEligible(subjectUri)) {
      requestLabel(subjectUri, (label) => { if (label) badge.textContent = label; });
    }
  }

  if (clickable) {
    if (_isNavigableHref(subjectUri)) {
      badge.href = subjectUri;
    }
    _attachNavigationHandler(badge, term, /* clickable */ true, onClick, { viaPath, viaRoot, viaRootPattern }, typeName);
  }

  return badge;
}

export { _isNavigableHref as isNavigableHref, renderSubjectBadge, renderTerm, setController };
