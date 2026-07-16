/*
 * Copyright 2026 European Union
 *
 * Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
 * Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */
// Regression tests for the merged epo-terms.json.
// Ensures the data-driven completion/linting path stays correct after
// regeneration of the terms files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const termsPath = join(__dirname, '..', 'src', 'assets', 'epo-terms.json');
const terms = JSON.parse(readFileSync(termsPath, 'utf8'));

// ── Structure validation ───────────────────────────────────────────

test('epo-terms.json has classes, objectProperties, and datatypeProperties as objects', () => {
  assert.equal(typeof terms.classes, 'object');
  assert.equal(typeof terms.objectProperties, 'object');
  assert.equal(typeof terms.datatypeProperties, 'object');
  assert.ok(Object.keys(terms.classes).length > 0);
  assert.ok(Object.keys(terms.objectProperties).length > 0);
  assert.ok(Object.keys(terms.datatypeProperties).length > 0);
});

test('every term maps to a non-empty array of version strings', () => {
  for (const [term, versions] of Object.entries(terms.classes)) {
    assert.ok(Array.isArray(versions), `${term} should map to an array`);
    assert.ok(versions.length > 0, `${term} should have at least one version`);
    for (const v of versions) {
      assert.match(v, /^v\d+$/, `${term} version "${v}" should be v3 or v4`);
    }
  }
});

// ── Key terms from issue #77 and #85 ──────────────────────────────

test('ResultNotice is labelled as both v3 and v4', () => {
  assert.deepEqual(terms.classes.ResultNotice.sort(), ['v3', 'v4']);
});

test('CompetitionNotice is labelled as both v3 and v4', () => {
  assert.deepEqual(terms.classes.CompetitionNotice.sort(), ['v3', 'v4']);
});

test('PlanningNotice is labelled as both v3 and v4', () => {
  assert.deepEqual(terms.classes.PlanningNotice.sort(), ['v3', 'v4']);
});

test('hasID is a v3 object property (Standard Forms fallback)', () => {
  assert.ok('hasID' in terms.objectProperties);
  assert.ok(terms.objectProperties.hasID.includes('v3'));
});

test('hasIdentifierValue is a v3 datatype property (Standard Forms fallback)', () => {
  assert.ok('hasIdentifierValue' in terms.datatypeProperties);
  assert.ok(terms.datatypeProperties.hasIdentifierValue.includes('v3'));
});

// ── Shared infrastructure terms ────────────────────────────────────

test('Notice, Buyer, Lot are shared across both versions', () => {
  for (const term of ['Notice', 'Buyer', 'Lot']) {
    assert.ok(term in terms.classes, `${term} should be in classes`);
    assert.deepEqual(terms.classes[term].sort(), ['v3', 'v4'], `${term} should be in both versions`);
  }
});

test('prefixes and keywords are present', () => {
  assert.ok(terms.prefixes && typeof terms.prefixes === 'object');
  assert.ok(terms.keywords && Array.isArray(terms.keywords));
  assert.ok(terms.prefixes.epo === 'http://data.europa.eu/a4g/ontology#');
});
