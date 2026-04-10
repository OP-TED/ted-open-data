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
import { isNavigableHref } from '../src/js/TermRenderer.js';

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
