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
// Bootstrap-wiring contract (issue #76 follow-up).
//
// script.js adapts the QueryEditor instance into the loadEditorText /
// getEditorText callbacks it hands to SearchPanel. Those adapters call
// queryEditor methods by name — and a name that does not exist fails
// SILENTLY: `queryEditor?.getValue?.()` just returns undefined, which made
// SearchPanel's user-edit guard a no-op in the real app while every unit
// test (which stubs the editor) still passed.
//
// QueryEditor pulls in CodeMirror plus a URL import of sparqljs and is
// heavily DOM-coupled, so it cannot be imported under node:test (see
// sparqlParser.test.js). script.js is a DOMContentLoaded bootstrap IIFE and
// is equally un-importable. So we pin the contract at the source level:
// whatever queryEditor method script.js wires for reading/writing the
// editor MUST be a method QueryEditor actually defines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = new URL('../src/js/', import.meta.url);
const scriptSource = readFileSync(new URL('script.js', SRC), 'utf8');
const queryEditorSource = readFileSync(new URL('QueryEditor.js', SRC), 'utf8');

// Class methods in QueryEditor.js are declared at two-space indentation
// (`  name(...) {`). This over-collects a little (it also picks up any
// two-space-indented call), which only matters for false *positives* — and
// we never assert a name is ABSENT, only that a wired name is PRESENT.
function classMethodNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/^ {2}(?:async\s+|\*\s*)?([a-zA-Z_]\w*)\s*\(/gm)) {
    names.add(m[1]);
  }
  return names;
}

const editorMethods = classMethodNames(queryEditorSource);

test('QueryEditor exposes the reader (getQuery) the app wires against', () => {
  assert.ok(editorMethods.has('getQuery'),
    'QueryEditor must define getQuery() — the reader the whole app relies on');
});

test('script.js wires getEditorText to a reader QueryEditor actually defines', () => {
  const m = scriptSource.match(/getEditorText\s*=\s*\(\)\s*=>\s*queryEditor\?\.(\w+)\?\.\(\)/);
  assert.ok(m, 'getEditorText should be wired to a queryEditor method (arrow adapter)');
  const method = m[1];
  assert.ok(editorMethods.has(method),
    `getEditorText calls queryEditor.${method}(), which QueryEditor does not define`);
});

test('script.js wires loadEditorText to a writer QueryEditor actually defines', () => {
  const m = scriptSource.match(/loadEditorText\s*=\s*\(text\)\s*=>\s*queryEditor\?\.(\w+)\?\.\(text\)/);
  assert.ok(m, 'loadEditorText should be wired to a queryEditor method (arrow adapter)');
  const method = m[1];
  assert.ok(editorMethods.has(method),
    `loadEditorText calls queryEditor.${method}(), which QueryEditor does not define`);
});
