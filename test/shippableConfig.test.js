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
// The addresses the built application talks to.
//
// Testing a query against a local copy of the library means pointing the
// application at it, and that edit is one line in a file nobody reads
// again. Shipped, it sends every reader to a server on their own machine
// and the Query Library is simply empty.
//
// Nothing else catches it: the parser tests pass either way, and the page
// looks right on the machine running the copy. So it is asserted here.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (path) => readFileSync(fileURLToPath(new URL(`../src/js/${path}`, import.meta.url)), 'utf8');

/** Addresses that only exist on the machine they were written on. */
const LOCAL = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])\b/;

test('the query library is fetched from where it is published', () => {
  const declaration = source('script.js').match(/^const REMOTE_QUERIES_URL = '([^']*)';$/m);
  assert.ok(declaration, 'REMOTE_QUERIES_URL is not declared as this test expects to find it');
  assert.strictEqual(declaration[1],
    'https://raw.githubusercontent.com/OP-TED/ted-open-data-examples/main/',
    'the Query Library would be fetched from a machine only the author has');
});

test('the SPARQL endpoint is the published one', () => {
  const declaration = source('script.js').match(/^const SPARQL_ENDPOINT = '([^']*)';$/m);
  assert.ok(declaration, 'SPARQL_ENDPOINT is not declared as this test expects to find it');
  assert.doesNotMatch(declaration[1], LOCAL,
    'queries would be sent to a machine only the author has');
});

// The proxy is meant for development and names localhost on purpose; it is
// chosen at runtime by isDevelopment, not written into the constants above.
test('no other address in the application is a local one', () => {
  for (const file of ['script.js', 'QueryLibrary.js', 'epoCompletion.js']) {
    for (const [line] of source(file).matchAll(/^const [A-Z_]+ = '[^']*';$/gm)) {
      assert.doesNotMatch(line, LOCAL, `${file}: ${line}`);
    }
  }
});
