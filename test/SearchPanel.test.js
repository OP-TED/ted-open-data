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
// SearchPanel tests — the editor reflection for ePO 3 StandardForms notices
// (issue #76, "Option B"). When a notice-number search resolves only via the
// controller's ePO 3 identifier-value fallback, the panel must correct the
// SPARQL editor to show the query that actually produced the triples, instead
// of the ePO 4 query that returned nothing — WITHOUT clobbering edits the user
// made in the editor while the (slow) fallback was still in flight.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Install the DOM/sessionStorage shims before importing the panel.
import { resetShims } from './_helpers.js';
import { ExplorerController } from '../src/js/ExplorerController.js';
import { SearchPanel } from '../src/js/SearchPanel.js';
import { createPublicationNumberFacet, getQuery } from '../src/js/facets.js';
import { __setOntologyDataForTesting } from '../src/js/services/ontologyData.js';

// An ePO 3 StandardForms notice from issue #76 (pub number 597014-2023).
const PUB = '00597014-2023';

beforeEach(() => {
  resetShims();
  // Every query awaits the ontology; supplying it keeps the loader from
  // reaching for a file over a browser-relative path that means nothing
  // under Node. Nothing here depends on its contents.
  __setOntologyDataForTesting({ subClassOf: {} });
});

// Route by query shape: the ePO 4 query carries hasNoticePublicationNumber,
// the ePO 3 fallback carries hasIdentifierValue.
function routedDoSPARQL({ primary, fallback }) {
  return async (query) =>
    query.includes('hasIdentifierValue') ? fallback : primary;
}

const EMPTY_RESULT = { quads: [], size: 0, rawTurtle: '' };

// A minimal stand-in for the SPARQL editor: loadEditorText writes, getEditorText
// reads. Mirrors the queryEditor.setValue / queryEditor.getValue wiring.
function makeEditor(initial = '') {
  let content = initial;
  return {
    loadEditorText: (t) => { content = t; },
    getEditorText: () => content,
    get: () => content,
    set: (t) => { content = t; },
  };
}

// Wire a panel to a controller and editor. Returns the editor stub.
function wirePanel(controller, editor) {
  // eslint-disable-next-line no-new -- constructor wires the event listeners we exercise
  new SearchPanel(controller, {
    loadEditorText: editor.loadEditorText,
    getEditorText: editor.getEditorText,
  });
}

test('SearchPanel reflects the ePO 3 fallback query into the editor once results resolve', async () => {
  const fallbackHit = { quads: [], size: 4, rawTurtle: 'epo3' };
  const controller = new ExplorerController({
    doSPARQL: routedDoSPARQL({ primary: EMPTY_RESULT, fallback: fallbackHit }),
  });
  const editor = makeEditor();
  wirePanel(controller, editor);

  const facet = createPublicationNumberFacet(PUB);
  // The panel drops the primary query into the editor synchronously before
  // the search runs; replicate that here.
  editor.set(getQuery(facet));
  await controller.search(facet);

  assert.match(editor.get(), /hasIdentifierValue/,
    'the editor ends up showing the ePO 3 fallback query, not the ePO 4 query');
});

test('SearchPanel leaves the editor on the ePO 4 query for a normal (ePO 4) notice', async () => {
  const hit = { quads: [], size: 9, rawTurtle: 'epo4' };
  const controller = new ExplorerController({
    doSPARQL: routedDoSPARQL({ primary: hit, fallback: EMPTY_RESULT }),
  });
  const editor = makeEditor();
  wirePanel(controller, editor);

  const facet = createPublicationNumberFacet(PUB);
  editor.set(getQuery(facet));
  await controller.search(facet);

  // executedQuery equals the primary query, so the reflection is a no-op.
  assert.equal(editor.get(), getQuery(facet), 'editor unchanged: still the ePO 4 query');
  assert.ok(!editor.get().includes('hasIdentifierValue'),
    'the fallback query must never reach the editor for an ePO 4 notice');
});

test('SearchPanel does not change the editor for a genuinely missing notice', async () => {
  const controller = new ExplorerController({
    doSPARQL: routedDoSPARQL({ primary: EMPTY_RESULT, fallback: EMPTY_RESULT }),
  });
  const editor = makeEditor();
  wirePanel(controller, editor);

  const facet = createPublicationNumberFacet(PUB);
  editor.set(getQuery(facet));
  await controller.search(facet);

  // Nothing resolved: executedQuery stays on the primary query, so the
  // correction is a no-op and the editor keeps its ePO 4 query.
  assert.equal(editor.get(), getQuery(facet), 'editor still shows the ePO 4 query');
});

test('SearchPanel preserves the user\'s edits made before the ePO 3 fallback resolves', async () => {
  // The fallback query is gated so we can inject a user edit into the editor
  // in the window between the primary returning empty and the fallback
  // resolving — the exact race the correction must not lose.
  const fallbackHit = { quads: [], size: 4, rawTurtle: 'epo3' };
  let releaseFallback;
  const gate = new Promise((r) => { releaseFallback = r; });
  const controller = new ExplorerController({
    doSPARQL: async (query) => {
      if (query.includes('hasIdentifierValue')) { await gate; return fallbackHit; }
      return EMPTY_RESULT;
    },
  });
  const editor = makeEditor();
  wirePanel(controller, editor);

  const facet = createPublicationNumberFacet(PUB);
  // Search gesture drops the primary query into the editor synchronously.
  editor.set(getQuery(facet));
  const searchPromise = controller.search(facet);

  // The user edits the editor while the (slow) fallback is still in flight.
  const userEdit = 'SELECT * WHERE { ?s ?p ?o } # my own edit';
  editor.set(userEdit);

  releaseFallback();
  await searchPromise;

  assert.equal(editor.get(), userEdit,
    'edits made during the fallback window must not be clobbered by the correction');
  assert.ok(!editor.get().includes('hasIdentifierValue'),
    'the fallback query must not overwrite the user\'s edit');
});

test('SearchPanel still corrects the editor when the editor reader is not wired', async () => {
  // Backward-compat: a caller that wires loadEditorText but not getEditorText
  // cannot detect user edits, so the correction proceeds as before.
  const fallbackHit = { quads: [], size: 4, rawTurtle: 'epo3' };
  const controller = new ExplorerController({
    doSPARQL: routedDoSPARQL({ primary: EMPTY_RESULT, fallback: fallbackHit }),
  });
  const writes = [];
  // eslint-disable-next-line no-new -- constructor wires the event listeners we exercise
  new SearchPanel(controller, { loadEditorText: (t) => writes.push(t) });

  await controller.search(createPublicationNumberFacet(PUB));

  assert.ok(writes.some((t) => t.includes('hasIdentifierValue')),
    'without an editor reader, the fallback query is still reflected');
});

// ── "not found" chip in the history dropdown (issue #79) ─────────

// Walk the stub-element tree (the DOM shim exposes appended children on
// `_children`) and return the first element whose className matches.
function findByClass(el, cls) {
  for (const child of el._children || []) {
    if ((child.className || '').includes(cls)) return child;
    const nested = findByClass(child, cls);
    if (nested) return nested;
  }
  return null;
}

test('a not-found history item renders a "not found" chip', () => {
  const controller = new ExplorerController({ doSPARQL: async () => EMPTY_RESULT });
  const panel = new SearchPanel(controller, {});
  const li = panel._buildHistoryItem({ type: 'notice-number', value: '00172531-2026', notFound: true }, false);

  const chip = findByClass(li, 'badge-not-found');
  assert.ok(chip, 'a not-found item should render the chip');
  assert.equal(chip.textContent, 'not found');
});

test('a found history item renders no "not found" chip', () => {
  const controller = new ExplorerController({ doSPARQL: async () => EMPTY_RESULT });
  const panel = new SearchPanel(controller, {});
  const li = panel._buildHistoryItem({ type: 'notice-number', value: '00172531-2026' }, false);

  assert.equal(findByClass(li, 'badge-not-found'), null, 'no chip for a found notice');
});
