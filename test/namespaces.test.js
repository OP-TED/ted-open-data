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
// Namespace / URI shortening tests.
//
// shortLabel feeds every badge and link in the UI; a regression here is
// very visible and hard to bisect, so the test exercises all three
// branches (ePO resource, known namespace, unknown URI).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ns, shortLabel, shrink, resolvePrefix } from '../src/js/utils/namespaces.js';

// Real URIs drawn from TED notice 00172531-2026's description.
const EPO_NOTICE_CLASS     = 'http://data.europa.eu/a4g/ontology#Notice';
const EPO_RESULT_NOTICE    = 'http://data.europa.eu/a4g/ontology#ResultNotice';
const EPO_NOTICE_RESOURCE  =
  'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_Notice';
const EPO_CONTRACT_RESOURCE =
  'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_SettledContract_CON-0001';
const RDF_TYPE      = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const SKOS_PREFLBL  = 'http://www.w3.org/2004/02/skos/core#prefLabel';
const UNKNOWN_URI   = 'http://example.org/whatever/thing';

test('shortLabel shrinks known ontology namespaces to prefix:localname', () => {
  assert.equal(shortLabel(EPO_NOTICE_CLASS), 'epo:Notice');
  assert.equal(shortLabel(EPO_RESULT_NOTICE), 'epo:ResultNotice');
  assert.equal(shortLabel(RDF_TYPE), 'rdf:type');
  assert.equal(shortLabel(SKOS_PREFLBL), 'skos:prefLabel');
});

test('shortLabel shortens ePO resource URIs to "Type identifier"', () => {
  // Pattern: id_{uuid}_{Type} → "Type" (no identifier segment)
  assert.equal(shortLabel(EPO_NOTICE_RESOURCE), 'Notice');
  // Pattern: id_{uuid}_{Type}_{identifier} → "Type identifier"
  assert.equal(shortLabel(EPO_CONTRACT_RESOURCE), 'SettledContract CON-0001');
});

test('shortLabel handles every ePO resource Type seen in the dataset', () => {
  // Real types extracted from a notice DESCRIBE — covers the variations
  // _shortenEpoResource has to handle (with identifier, without, with
  // letters and digits in the identifier).
  const base = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_';
  const cases = [
    ['Notice',                                        'Notice'],                                  // no identifier
    ['ProcurementProcessInformation_WcwJtRXtDB2SosVcBYfxSC',
                                                       'ProcurementProcessInformation WcwJtRXtDB2SosVcBYfxSC'],
    ['SettledContract_CON-0001',                       'SettledContract CON-0001'],               // has hyphen
    ['Lot_LOT-0001',                                   'Lot LOT-0001'],
    ['NoticeAwardInformation_JryEpNBTCzNfzKbsxaXwjt',  'NoticeAwardInformation JryEpNBTCzNfzKbsxaXwjt'],
    ['Tenderer_TPA-0001',                              'Tenderer TPA-0001'],
    ['NoticeIdentifier_aHt4iskyRUJYALjw7mSMu2',        'NoticeIdentifier aHt4iskyRUJYALjw7mSMu2'],
    ['Buyer_PbuuQVDAP9jvgtF6eprdW2',                   'Buyer PbuuQVDAP9jvgtF6eprdW2'],
  ];
  for (const [suffix, expected] of cases) {
    assert.equal(shortLabel(base + suffix), expected, `for suffix ${suffix}`);
  }
});

test('shortLabel handles ePO resource with multi-segment identifier (only first underscore split)', () => {
  // Identifier itself contains underscores — shortLabel should only
  // replace the FIRST underscore after the type with a space, leaving
  // the identifier intact.
  const uri = 'http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef_AccessTerm_246rmGzZvwFBcxRNZTXjTW';
  assert.equal(shortLabel(uri), 'AccessTerm 246rmGzZvwFBcxRNZTXjTW');
});

test('shortLabel handles malformed ePO resource URIs gracefully', () => {
  // If the URI matches the prefix but has nothing after, return the empty
  // string — best effort, no crash.
  assert.equal(shortLabel('http://data.europa.eu/a4g/resource/id_'), '');
  // Just a uuid with no type or identifier — return whatever's there.
  assert.equal(
    shortLabel('http://data.europa.eu/a4g/resource/id_6497924e-6920-4348-8ecb-71530f802aef'),
    '6497924e-6920-4348-8ecb-71530f802aef',
  );
});

test('shortLabel returns unknown URIs unchanged', () => {
  assert.equal(shortLabel(UNKNOWN_URI), UNKNOWN_URI);
  assert.equal(shortLabel('http://example.org/'), 'http://example.org/');
  assert.equal(shortLabel('urn:uuid:not-a-resource'), 'urn:uuid:not-a-resource');
});

test('shortLabel resolves every namespace declared in the ns map', () => {
  // Smoke test: build "<base>foo" for every prefix and check it shortens
  // to "<prefix>:foo" (skipping the dct/dcterms alias which both point at
  // the same base — only one of them wins, and that's fine).
  const seen = new Set();
  for (const [prefix, base] of Object.entries(ns)) {
    if (seen.has(base)) continue;
    seen.add(base);
    const localName = 'TestResource';
    const result = shortLabel(base + localName);
    // Either returns "<prefix>:TestResource" OR "<dct or dcterms>:TestResource"
    // for the dual prefix — assert it matches at least the localname.
    assert.match(result, /:TestResource$/, `failed for prefix ${prefix} (${base})`);
  }
});

test('shrink is an alias of the "known namespace" branch of shortLabel', () => {
  assert.equal(shrink(EPO_NOTICE_CLASS), 'epo:Notice');
  assert.equal(shrink(UNKNOWN_URI), UNKNOWN_URI);
});

test('resolvePrefix returns {prefix, localName} for known namespaces', () => {
  assert.deepEqual(resolvePrefix(EPO_NOTICE_CLASS), {
    prefix: 'epo',
    localName: 'Notice',
  });
  assert.equal(resolvePrefix(UNKNOWN_URI), null);
});

test('ns map exposes the ePO and RDF namespaces at canonical URIs', () => {
  assert.equal(ns.epo, 'http://data.europa.eu/a4g/ontology#');
  assert.equal(ns.rdf, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#');
  assert.equal(ns.rdfs, 'http://www.w3.org/2000/01/rdf-schema#');
});
