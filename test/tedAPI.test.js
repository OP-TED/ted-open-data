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
// tedAPI tests — response mapping, date-based sorting, field normalization.
//
// The sort logic and boundary normalization are the parts most likely to
// regress during a refactor; covering them via the public mapResponse
// surface exercises _dateSortKey, _mapNotice, _extractCodedValue and
// _normalizeBuyerCountry in one sweep.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapResponse, extractProcedureIds } from '../src/js/services/tedAPI.js';

// Helper: minimal fixture shaped like what the TED acceptance API returns.
// Uses `in` checks on the overrides object so passing a literal `null` or
// `undefined` actually overrides the default; `??` would treat both as
// absent and fall through, which matters for the "null field" tests below.
function fixtureNotice(overrides = {}) {
  const pick = (key, fallback) => (key in overrides ? overrides[key] : fallback);
  return {
    'publication-number':   pick('pub', '00172531-2026'),
    'publication-date':     pick('date', '2026-03-12+01:00'),
    'notice-version':       pick('version', 1),
    'notice-type':          pick('noticeType', { value: 'can-standard' }),
    'form-type':            pick('formType', { value: 'result' }),
    'buyer-country':        pick('buyerCountry', ['ITA']),
    'customization-id':     pick('customization-id', 'eforms-sdk-1.12'),
    'procedure-identifier': pick('procedureId', '6497924e-6920-4348-8ecb-71530f802aef'),
  };
}

// ── mapResponse sorting ────────────────────────────────────────────

test('mapResponse sorts notices oldest-first by publication date', () => {
  const response = {
    notices: [
      fixtureNotice({ pub: '00172531-2026', date: '2026-03-12+01:00' }),
      fixtureNotice({ pub: '00149228-2024', date: '2024-03-13Z' }),
    ],
  };
  const mapped = mapResponse(response);
  assert.equal(mapped[0].publicationNumber, '00149228-2024');
  assert.equal(mapped[1].publicationNumber, '00172531-2026');
});

test('mapResponse tiebreaks same-day notices by notice-version ascending', () => {
  // Procedure 9f554b2f-df10-48c1-80b1-2ac8c2255427 actually has several
  // amendments published on 2026-03-10; they should line up v1 < v2 < v3.
  const response = {
    notices: [
      fixtureNotice({ pub: '00165237-2026', date: '2026-03-10+01:00', version: 8 }),
      fixtureNotice({ pub: '00163965-2026', date: '2026-03-10+01:00', version: 13 }),
      fixtureNotice({ pub: '00164247-2026', date: '2026-03-10+01:00', version: 11 }),
      fixtureNotice({ pub: '00164544-2026', date: '2026-03-10+01:00', version: 12 }),
    ],
  };
  const mapped = mapResponse(response);
  const versions = mapped.map(n => n.noticeVersion);
  assert.deepEqual(versions, [8, 11, 12, 13]);
});

test('mapResponse rejects out-of-range numeric date components', () => {
  // "99999-99-99" used to slip through and produce a silently nonsense
  // sort key. With the range check, the date is treated as unparseable
  // and the comparator falls back to version order.
  const response = {
    notices: [
      fixtureNotice({ pub: '00172531-2026', date: '2026-03-12+01:00', version: 1 }),
      fixtureNotice({ pub: '00149228-2024', date: '2024-99-99+01:00', version: 2 }),
    ],
  };
  const mapped = mapResponse(response);
  // The bad-date entry has no usable sort key; the comparator falls back
  // to version order, so v1 comes before v2.
  assert.equal(mapped[0].noticeVersion, 1);
  assert.equal(mapped[1].noticeVersion, 2);
});

test('mapResponse refuses non-array `notices` and warns', () => {
  // Capture warnings to confirm the schema-drift signal is emitted.
  const original = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    const result = mapResponse({ notices: { not: 'an array' } });
    assert.deepEqual(result, []);
    assert.equal(warned, true, 'should have emitted a console.warn');
  } finally {
    console.warn = original;
  }
});

test('extractProcedureIds warns when notices exist but none have a procedure-identifier', () => {
  const original = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    const ids = extractProcedureIds({ notices: [{ 'publication-number': 'x' }, { 'publication-number': 'y' }] });
    assert.deepEqual(ids, []);
    assert.equal(warned, true);
  } finally {
    console.warn = original;
  }
});

test('extractProcedureIds does NOT warn when there are simply no notices', () => {
  const original = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    extractProcedureIds({ notices: [] });
    assert.equal(warned, false, 'empty notices is a normal state, not a warning');
  } finally {
    console.warn = original;
  }
});

test('mapResponse handles TED +01:00 and Z suffixes without breaking', () => {
  // Earlier bug: new Date("2024-03-28+01:00") is Invalid Date, so the
  // sort comparator short-circuited and returned 0 for every pair.
  const response = {
    notices: [
      fixtureNotice({ pub: '00172531-2026', date: '2026-03-12+01:00' }),
      fixtureNotice({ pub: '00149228-2024', date: '2024-03-13Z' }),
      fixtureNotice({ pub: '00001111-2025', date: '2025-01-01+00:00' }),
    ],
  };
  const mapped = mapResponse(response);
  assert.deepEqual(
    mapped.map(n => n.publicationNumber),
    ['00149228-2024', '00001111-2025', '00172531-2026'],
  );
});

test('mapResponse preserves order when a date is missing (no crash)', () => {
  const response = {
    notices: [
      fixtureNotice({ pub: '00172531-2026', date: null }),
      fixtureNotice({ pub: '00149228-2024', date: '2024-03-13Z' }),
    ],
  };
  const mapped = mapResponse(response);
  // When one date can't be parsed the comparator falls back to version order;
  // both default to version 1 so the original order is preserved.
  assert.equal(mapped.length, 2);
});

test('mapResponse returns [] for an empty or missing notices array', () => {
  assert.deepEqual(mapResponse({ notices: [] }), []);
  assert.deepEqual(mapResponse({}), []);
  assert.deepEqual(mapResponse(null), []);
});

// ── Field normalization at the boundary ────────────────────────────

test('mapResponse normalizes buyer-country array to a string', () => {
  // The TED API returns buyer-country as ["ITA"], not "ITA".
  const mapped = mapResponse({
    notices: [fixtureNotice({ pub: '00172531-2026', buyerCountry: ['ITA'] })],
  });
  assert.equal(mapped[0].buyerCountry, 'ITA');
});

test('mapResponse joins multi-country arrays with commas', () => {
  const mapped = mapResponse({
    notices: [fixtureNotice({ pub: '00172531-2026', buyerCountry: ['ITA', 'FRA'] })],
  });
  assert.equal(mapped[0].buyerCountry, 'ITA, FRA');
});

test('mapResponse normalizes buyer-country null/missing to null', () => {
  const mapped = mapResponse({
    notices: [fixtureNotice({ pub: '00172531-2026', buyerCountry: null })],
  });
  assert.equal(mapped[0].buyerCountry, null);
});

test('mapResponse extracts coded values from notice-type / form-type objects', () => {
  const mapped = mapResponse({
    notices: [fixtureNotice({
      pub: '00172531-2026',
      noticeType: { value: 'can-standard' },
      formType: { value: 'result' },
    })],
  });
  assert.equal(mapped[0].noticeType, 'can-standard');
  assert.equal(mapped[0].formType, 'result');
});

test('mapResponse normalizes missing notice-type / form-type to null (not "Unknown")', () => {
  // Regression: earlier code fabricated { value: 'Unknown' } and the UI
  // rendered "Unknown (Unknown)" as if it were real data.
  const mapped = mapResponse({
    notices: [fixtureNotice({
      pub: '00172531-2026',
      noticeType: null,
      formType: undefined,
    })],
  });
  assert.equal(mapped[0].noticeType, null);
  assert.equal(mapped[0].formType, null);
});

test('mapResponse falls back to raw publication-number if normalize fails', () => {
  // _normalizePublicationNumber logs a warning and returns the raw value
  // rather than dropping the notice from the timeline.
  const mapped = mapResponse({
    notices: [{
      'publication-number': 'not-a-real-pub-number',
      'publication-date': '2026-01-01Z',
      'notice-version': 1,
    }],
  });
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].publicationNumber, 'not-a-real-pub-number');
});

// ── extractProcedureIds ────────────────────────────────────────────

test('extractProcedureIds collects unique procedure-identifier values', () => {
  const ids = extractProcedureIds({
    notices: [
      { 'procedure-identifier': 'proc-a' },
      { 'procedure-identifier': 'proc-b' },
      { 'procedure-identifier': 'proc-a' }, // duplicate
    ],
  });
  assert.deepEqual(ids.sort(), ['proc-a', 'proc-b']);
});

test('extractProcedureIds silently drops falsy ids', () => {
  const ids = extractProcedureIds({
    notices: [
      { 'procedure-identifier': 'proc-a' },
      { 'procedure-identifier': null },
      { 'procedure-identifier': '' },
      { /* missing field entirely */ },
    ],
  });
  assert.deepEqual(ids, ['proc-a']);
});

test('extractProcedureIds returns [] for an empty or null response', () => {
  assert.deepEqual(extractProcedureIds({ notices: [] }), []);
  assert.deepEqual(extractProcedureIds({}), []);
  assert.deepEqual(extractProcedureIds(null), []);
});
