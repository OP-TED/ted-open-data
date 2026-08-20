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
// isNavigableHref — the XSS gate that prevents javascript:/data:/vbscript:
// URIs from becoming clickable hrefs in the tree view.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './_helpers.js'; // document shim — the badge/term renderers build elements
import { isNavigableHref, renderSubjectBadge, renderTerm, setController } from '../src/js/TermRenderer.js';

test('isNavigableHref accepts http:// URI', () => {
  assert.equal(isNavigableHref('http://data.europa.eu/a4g/ontology#Notice'), true);
});

test('isNavigableHref accepts https:// URI', () => {
  assert.equal(isNavigableHref('https://example.org/resource'), true);
});

test('isNavigableHref rejects javascript: URI', () => {
  assert.equal(isNavigableHref('javascript:alert(1)'), false);
});

test('isNavigableHref rejects data: URI', () => {
  assert.equal(isNavigableHref('data:text/html,<script>alert(1)</script>'), false);
});

test('isNavigableHref rejects vbscript: URI', () => {
  assert.equal(isNavigableHref('vbscript:MsgBox("XSS")'), false);
});

test('isNavigableHref rejects blank node identifier', () => {
  assert.equal(isNavigableHref('_:b0'), false);
});

test('isNavigableHref rejects empty string', () => {
  assert.equal(isNavigableHref(''), false);
});

test('isNavigableHref rejects non-string input', () => {
  assert.equal(isNavigableHref(null), false);
  assert.equal(isNavigableHref(undefined), false);
  assert.equal(isNavigableHref(42), false);
});

// ── viaPath: recording *how* a resource was reached ─────────────────
//
// Clicking a resource in the tree navigates to it. The predicate chain
// walked to get there rides along on the facet, which is what lets the
// breadcrumb reconstruct the whole route later (issue #73). Without it the
// breadcrumb knows which resources were visited but not how, and the SPARQL
// reference card can only fall back to a bare type binding.

const RES = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Reviewer_3qDoBaQsAXVe5Ci2dDBD6C';
const EPO_ANNOUNCES_ROLE = 'http://data.europa.eu/a4g/ontology#announcesRole';
const EPO_PLAYED_BY      = 'http://data.europa.eu/a4g/ontology#playedBy';

// The click handler is only wired when a controller is registered, so the
// controller has to be installed before the element is built. Returns a sink
// that records the facet the controller was handed.
function installController() {
  const seen = {};
  setController({ navigateTo(facet) { seen.facet = facet; } });
  return seen;
}

function click(el) {
  const handlers = el._listeners.get('click') || [];
  assert.equal(handlers.length, 1, 'element should have exactly one click handler');
  handlers[0]({ preventDefault() {} });
}

test('clicking a subject badge reports the predicate chain walked to reach it', () => {
  const seen = installController();
  click(renderSubjectBadge(RES, { viaPath: [EPO_ANNOUNCES_ROLE, EPO_PLAYED_BY] }));

  assert.equal(seen.facet.type, 'named-node');
  assert.equal(seen.facet.term.value, RES);
  assert.deepEqual(seen.facet.viaPath, [EPO_ANNOUNCES_ROLE, EPO_PLAYED_BY]);
});

test('clicking a leaf term reports its predicate chain too', () => {
  // Leaf values are navigable as well — the CPV code in issue #73's example
  // is reached this way, not through a nested card.
  const seen = installController();
  click(renderTerm({ termType: 'NamedNode', value: RES }, { viaPath: [EPO_ANNOUNCES_ROLE] }));

  assert.deepEqual(seen.facet.viaPath, [EPO_ANNOUNCES_ROLE]);
});

test('a badge rendered without a chain reports an empty one, never undefined', () => {
  // Root cards have nothing above them. DataView flat-maps viaPath across the
  // breadcrumb, so an undefined here would break the whole reconstruction.
  const seen = installController();
  click(renderSubjectBadge(RES));

  assert.deepEqual(seen.facet.viaPath, []);
});
