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
// Naming a resource from the types it declares (issue #74).
//
// The point of these is that no answer comes from a rule of thumb. Where a
// resource declares several types, the ontology decides which is the most
// specific; where the ontology says nothing, neither does the application.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mostSpecificTypes, resourceTypeName } from '../src/js/utils/resourceType.js';

const EPO = 'http://data.europa.eu/a4g/ontology#';
const ORG = 'http://www.w3.org/ns/org#';
const ADMS = 'http://www.w3.org/ns/adms#';

// The shape scripts/extract-epo-terms.js produces: superclasses by class IRI.
const HIERARCHY = {
  [`${EPO}Business`]: [`${ORG}Organization`],
  [`${EPO}CompetitionNotice`]: [`${EPO}Notice`],
  [`${EPO}Notice16`]: [`${EPO}CompetitionNotice`],
  [`${EPO}Notice`]: [`${EPO}Document`],
};

test('a single declared type is the name', () => {
  assert.equal(resourceTypeName([`${EPO}Contract`], HIERARCHY), 'Contract');
});

test('a resource with no declared type has no name to offer', () => {
  assert.equal(resourceTypeName([], HIERARCHY), null);
  assert.equal(resourceTypeName(undefined, HIERARCHY), null);
});

test('the subclass wins, across vocabularies', () => {
  // The case the shortest-name rule got right only by accident: ePO states
  // that Business is a subclass of org:Organization.
  assert.equal(
    resourceTypeName([`${ORG}Organization`, `${EPO}Business`], HIERARCHY),
    'Business',
  );
});

test('the subclass wins regardless of the order the types arrive in', () => {
  const types = [`${ORG}Organization`, `${EPO}Business`];
  assert.equal(resourceTypeName(types, HIERARCHY), 'Business');
  assert.equal(resourceTypeName([...types].reverse(), HIERARCHY), 'Business');
});

test('an indirect superclass is still discarded', () => {
  // Notice16 -> CompetitionNotice -> Notice. Only the deepest survives, even
  // though Notice is two steps up.
  assert.equal(
    resourceTypeName([`${EPO}Notice`, `${EPO}CompetitionNotice`, `${EPO}Notice16`], HIERARCHY),
    'Notice16',
  );
});

test('unrelated types are all shown, because nothing ranks them', () => {
  // Inventing an order here is exactly what this exists to avoid.
  assert.equal(
    resourceTypeName([`${ADMS}Identifier`, `${EPO}Contract`], HIERARCHY),
    'Identifier, Contract',
  );
});

test('without the hierarchy nothing is discarded', () => {
  // Before the ontology data arrives, every declared type is still true; only
  // the ranking is unavailable.
  assert.equal(
    resourceTypeName([`${ORG}Organization`, `${EPO}Business`], {}),
    'Organization, Business',
  );
});

test('a type declared twice is named once', () => {
  assert.equal(resourceTypeName([`${EPO}Contract`, `${EPO}Contract`], HIERARCHY), 'Contract');
});

test('a cycle in the hierarchy does not hang the search', () => {
  // Not expected from a published ontology, but the data is external.
  const cyclic = { 'urn:a': ['urn:b'], 'urn:b': ['urn:a'] };
  assert.deepEqual(mostSpecificTypes(['urn:a', 'urn:b'], cyclic), []);
});

test('mostSpecificTypes returns IRIs, leaving presentation to the caller', () => {
  assert.deepEqual(
    mostSpecificTypes([`${ORG}Organization`, `${EPO}Business`], HIERARCHY),
    [`${EPO}Business`],
  );
});

test('local names are taken from either IRI shape', () => {
  // Hash-delimited and slash-delimited namespaces both occur in the data.
  assert.equal(resourceTypeName(['http://example.org/path/Thing'], {}), 'Thing');
  assert.equal(resourceTypeName(['http://example.org/ns#Thing'], {}), 'Thing');
});
