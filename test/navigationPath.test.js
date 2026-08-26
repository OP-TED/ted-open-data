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
// navigationPath — reassembles the route the user walked from the
// breadcrumb, for the Path row on the SPARQL reference card (issue #73).
//
// The hazard this guards against is a pattern that parses cleanly but means
// something false: concatenating chains that do not actually join up produces
// valid SPARQL asserting a relationship the data never had. Every case below
// is one where the hops do not join.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigationPath } from '../src/js/utils/navigationPath.js';

const NOTICE   = 'http://data.europa.eu/a4g/resource/id_x_Notice';
const REVIEWER = 'http://data.europa.eu/a4g/resource/id_x_Reviewer_3qDo';
const ORG      = 'http://data.europa.eu/a4g/resource/id_x_Organisation_ORG-0002';
const OTHER    = 'http://data.europa.eu/a4g/resource/id_x_ProcurementProcessInformation_5oS2';

const ANNOUNCES_ROLE = 'http://data.europa.eu/a4g/ontology#announcesRole';
const PLAYED_BY      = 'http://data.europa.eu/a4g/ontology#playedBy';
const CONCERNS       = 'http://data.europa.eu/a4g/ontology#concernsProcedure';
const NOTICE_ANCHOR  = '?notice a epo:Notice';

function walk(breadcrumb, breadcrumbIndex = breadcrumb.length - 1) {
  return navigationPath(breadcrumb, breadcrumbIndex);
}

// A breadcrumb entry produced by clicking through the tree.
function hop(target, { viaPath, viaRoot, viaRootPattern = NOTICE_ANCHOR }) {
  return {
    type: 'named-node',
    term: { termType: 'NamedNode', value: target },
    viaPath, viaRoot, viaRootPattern,
  };
}

const noticeSearch = { type: 'notice-number', value: '00100333-2025' };

test('navigationPath returns nothing at the start of an exploration', () => {
  assert.deepEqual(walk([noticeSearch]), { chain: [], anchor: null });
});

test('navigationPath returns a single hop with the anchor it started from', () => {
  const result = walk([
    noticeSearch,
    hop(REVIEWER, { viaPath: [ANNOUNCES_ROLE], viaRoot: NOTICE }),
  ]);
  assert.deepEqual(result, {
    chain: [ANNOUNCES_ROLE],
    anchor: NOTICE_ANCHOR,
  });
});

test('navigationPath joins consecutive hops that continue from one another', () => {
  // notice → Reviewer → Organisation. The second hop starts where the first
  // landed, so the two chains are genuinely one route.
  const result = walk([
    noticeSearch,
    hop(REVIEWER, { viaPath: [ANNOUNCES_ROLE], viaRoot: NOTICE }),
    hop(ORG, { viaPath: [PLAYED_BY], viaRoot: REVIEWER }),
  ]);
  assert.deepEqual(result, {
    chain: [ANNOUNCES_ROLE, PLAYED_BY],
    anchor: NOTICE_ANCHOR,
  });
});

test('navigationPath refuses a hop that starts somewhere the previous one did not land', () => {
  // The regression this whole mechanism exists to prevent. Concatenating
  // regardless would claim the notice reaches ORG via announcesRole/playedBy,
  // when the second hop was actually walked from an unrelated subject.
  const result = walk([
    noticeSearch,
    hop(REVIEWER, { viaPath: [ANNOUNCES_ROLE], viaRoot: NOTICE }),
    hop(ORG, { viaPath: [PLAYED_BY], viaRoot: OTHER }),
  ]);
  assert.deepEqual(result, { chain: [], anchor: null });
});

test('navigationPath refuses a chain recorded under a secondary tree root', () => {
  // Multi-root graphs render several top-level cards. A chain walked beneath
  // one of them does not start at the notice, even on the very first hop.
  const result = walk([
    noticeSearch,
    hop(REVIEWER, {
      viaPath: [CONCERNS],
      viaRoot: OTHER,
      viaRootPattern: '?procurementProcessInformation a epo:ProcurementProcessInformation',
    }),
  ]);
  // The route is still true — it just starts somewhere else, and says so.
  assert.deepEqual(result, {
    chain: [CONCERNS],
    anchor: '?procurementProcessInformation a epo:ProcurementProcessInformation',
  });
});

test('navigationPath gives up when a hop records no chain at all', () => {
  // A lateral jump — the procedure timeline — replaces the breadcrumb entry
  // with one carrying no viaPath. Anything appended after it is anchored to
  // the wrong subject.
  const result = walk([
    noticeSearch,
    { type: 'named-node', term: { termType: 'NamedNode', value: REVIEWER } },
    hop(ORG, { viaPath: [PLAYED_BY], viaRoot: REVIEWER }),
  ]);
  assert.deepEqual(result, { chain: [], anchor: null });
});

test('navigationPath gives up when the starting hop names no anchor pattern', () => {
  // Without a pattern binding the root there is nothing to hang the chain on.
  const result = walk([
    noticeSearch,
    hop(REVIEWER, { viaPath: [ANNOUNCES_ROLE], viaRoot: NOTICE, viaRootPattern: null }),
  ]);
  assert.deepEqual(result, { chain: [], anchor: null });
});

test('navigationPath ignores forward history after stepping back', () => {
  // Going back shortens the displayed path; the abandoned forward entries
  // must not leak into it.
  const result = walk([
    noticeSearch,
    hop(REVIEWER, { viaPath: [ANNOUNCES_ROLE], viaRoot: NOTICE }),
    hop(ORG, { viaPath: [PLAYED_BY], viaRoot: REVIEWER }),
  ], 1);
  assert.deepEqual(result, {
    chain: [ANNOUNCES_ROLE],
    anchor: NOTICE_ANCHOR,
  });
});

test('navigationPath tolerates an empty breadcrumb', () => {
  assert.deepEqual(walk([], -1), { chain: [], anchor: null });
});

// ── malformed input ─────────────────────────────────────────────────
//
// validateFacet() spreads unknown fields without inspecting them, so nothing
// upstream guarantees these shapes. The failure mode without checking is not a
// crash but a plausible-looking query built from nonsense, which is worse.

test('navigationPath rejects a viaPath that is a string rather than an array', () => {
  // Spreading a string yields one entry per character, and the card would
  // offer "<a> / <b> / <c>" as though it were a real property path.
  const result = walk([
    noticeSearch,
    { ...hop(REVIEWER, { viaPath: [ANNOUNCES_ROLE], viaRoot: NOTICE }), viaPath: 'abc' },
  ]);
  assert.deepEqual(result, { chain: [], anchor: null });
});

test('navigationPath rejects a viaPath holding anything but strings', () => {
  const result = walk([
    noticeSearch,
    hop(REVIEWER, { viaPath: [ANNOUNCES_ROLE, null], viaRoot: NOTICE }),
  ]);
  assert.deepEqual(result, { chain: [], anchor: null });
});

test('navigationPath rejects a non-string anchor', () => {
  // Assembling the pattern calls anchor.startsWith, which would throw.
  const result = walk([
    noticeSearch,
    hop(REVIEWER, { viaPath: [ANNOUNCES_ROLE], viaRoot: NOTICE, viaRootPattern: 42 }),
  ]);
  assert.deepEqual(result, { chain: [], anchor: null });
});

test('navigationPath rejects a non-string viaRoot', () => {
  const result = walk([
    noticeSearch,
    hop(REVIEWER, { viaPath: [ANNOUNCES_ROLE], viaRoot: { value: NOTICE } }),
  ]);
  assert.deepEqual(result, { chain: [], anchor: null });
});

test('navigationPath tolerates a breadcrumb that is not an array', () => {
  assert.deepEqual(navigationPath(null, 3), { chain: [], anchor: null });
  assert.deepEqual(navigationPath(undefined, 0), { chain: [], anchor: null });
  assert.deepEqual(navigationPath('not a breadcrumb', 2), { chain: [], anchor: null });
});

test('navigationPath never hands back a shared empty result to mutate', () => {
  // The no-path result is a frozen singleton; a caller pushing onto its chain
  // would otherwise corrupt every later call.
  const a = walk([noticeSearch]);
  a.chain.push?.('x');
  assert.deepEqual(walk([noticeSearch]).chain, [], 'still empty for the next caller');
});
