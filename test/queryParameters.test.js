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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidDate, isValidMonth, isValidYear, lastDayOfMonth, fillTemplate } from '../src/js/utils/queryParameters.js';

// ── isValidDate ────────────────────────────────────────────────────

test('isValidDate accepts real calendar dates', () => {
  assert.equal(isValidDate('2024-11-05'), true);
  assert.equal(isValidDate('2024-02-29'), true); // 2024 is a leap year
  assert.equal(isValidDate('2025-12-31'), true);
});

test('isValidDate rejects impossible months and days', () => {
  assert.equal(isValidDate('2024-13-01'), false);
  assert.equal(isValidDate('2024-00-10'), false);
  assert.equal(isValidDate('2024-02-30'), false);
  assert.equal(isValidDate('2025-02-29'), false); // not a leap year
  assert.equal(isValidDate('2024-04-31'), false);
});

test('isValidDate rejects malformed shapes', () => {
  assert.equal(isValidDate('2024-115-15'), false);
  assert.equal(isValidDate('2024-1-5'), false);
  assert.equal(isValidDate('2024/11/05'), false);
  assert.equal(isValidDate('not-a-date'), false);
  assert.equal(isValidDate(''), false);
});

test('isValidDate rejects non-string input', () => {
  assert.equal(isValidDate(null), false);
  assert.equal(isValidDate(undefined), false);
  assert.equal(isValidDate(20241105), false);
});

// ── fillTemplate ───────────────────────────────────────────────────

test('fillTemplate replaces placeholders with typed date literals', () => {
  const template = 'FILTER (?d >= {{startDate}} && ?d <= {{endDate}})';
  const params = [
    { label: 'Start', type: 'date', placeholder: 'startDate', default: '2024-01-01' },
    { label: 'End', type: 'date', placeholder: 'endDate', default: '2024-01-31' },
  ];
  const result = fillTemplate(template, params, ['2026-06-01', '2026-06-30']);
  assert.equal(result, 'FILTER (?d >= "2026-06-01"^^xsd:date && ?d <= "2026-06-30"^^xsd:date)');
});

test('fillTemplate uses defaults when user values are invalid', () => {
  const template = 'FILTER (?d >= {{pubDate}})';
  const params = [
    { label: 'Date', type: 'date', placeholder: 'pubDate', default: '2025-01-01' },
  ];
  // Invalid month
  const result = fillTemplate(template, params, ['2025-13-01']);
  assert.equal(result, 'FILTER (?d >= "2025-01-01"^^xsd:date)');
});

test('fillTemplate uses defaults when user values are empty', () => {
  const template = 'FILTER (?d >= {{pubDate}})';
  const params = [
    { label: 'Date', type: 'date', placeholder: 'pubDate', default: '2025-01-01' },
  ];
  const result = fillTemplate(template, params, ['']);
  assert.equal(result, 'FILTER (?d >= "2025-01-01"^^xsd:date)');
});

test('fillTemplate handles same placeholder appearing multiple times', () => {
  const template = 'FILTER (?a >= {{date}} && ?b >= {{date}})';
  const params = [
    { label: 'Date', type: 'date', placeholder: 'date', default: '2025-01-01' },
  ];
  const result = fillTemplate(template, params, ['2026-03-15']);
  assert.equal(result, 'FILTER (?a >= "2026-03-15"^^xsd:date && ?b >= "2026-03-15"^^xsd:date)');
});

test('fillTemplate handles two distinct placeholders with same default independently', () => {
  const template = 'FILTER (?d >= {{startDate}} && ?d <= {{endDate}})';
  const params = [
    { label: 'Start', type: 'date', placeholder: 'startDate', default: '2026-01-05' },
    { label: 'End', type: 'date', placeholder: 'endDate', default: '2026-01-05' },
  ];
  const result = fillTemplate(template, params, ['2026-06-01', '2026-06-30']);
  assert.equal(result, 'FILTER (?d >= "2026-06-01"^^xsd:date && ?d <= "2026-06-30"^^xsd:date)');
});

test('fillTemplate skips non-date parameter types', () => {
  const template = 'FILTER (?x = {{country}})';
  const params = [
    { label: 'Country', type: 'text', placeholder: 'country', default: 'FRA' },
  ];
  // Text type not yet supported — placeholder replaced with quoted default
  const result = fillTemplate(template, params, ['DEU']);
  assert.equal(result, 'FILTER (?x = "DEU")');
});

test('fillTemplate leaves template unchanged when no parameters', () => {
  const template = 'SELECT ?x WHERE { ?x a epo:Notice }';
  const result = fillTemplate(template, [], []);
  assert.equal(result, template);
});

// ── isValidMonth ───────────────────────────────────────────────────

test('isValidMonth accepts valid months', () => {
  assert.equal(isValidMonth('2025-01'), true);
  assert.equal(isValidMonth('2025-12'), true);
  assert.equal(isValidMonth('2024-06'), true);
});

test('isValidMonth rejects invalid months', () => {
  assert.equal(isValidMonth('2025-13'), false);
  assert.equal(isValidMonth('2025-00'), false);
  assert.equal(isValidMonth('2025-1'), false);   // must be zero-padded
  assert.equal(isValidMonth('2025'), false);
  assert.equal(isValidMonth(''), false);
  assert.equal(isValidMonth(null), false);
});

// ── isValidYear ────────────────────────────────────────────────────

test('isValidYear accepts 4-digit years', () => {
  assert.equal(isValidYear('2024'), true);
  assert.equal(isValidYear('2030'), true);
});

test('isValidYear rejects non-4-digit values', () => {
  assert.equal(isValidYear('202'), false);
  assert.equal(isValidYear('20245'), false);
  assert.equal(isValidYear('abcd'), false);
  assert.equal(isValidYear(''), false);
  assert.equal(isValidYear(null), false);
});

// ── lastDayOfMonth ─────────────────────────────────────────────────

test('lastDayOfMonth returns correct last day for various months', () => {
  assert.equal(lastDayOfMonth(2025, 1), 31);  // January
  assert.equal(lastDayOfMonth(2025, 2), 28);  // February (non-leap)
  assert.equal(lastDayOfMonth(2024, 2), 29);  // February (leap year)
  assert.equal(lastDayOfMonth(2025, 4), 30);  // April
  assert.equal(lastDayOfMonth(2025, 12), 31); // December
});

// ── fillTemplate: month and year types ─────────────────────────────

test('fillTemplate month-start produces first day of month', () => {
  const template = 'FILTER (?d >= {{start}})';
  const params = [{ label: 'Start', type: 'month-start', placeholder: 'start', default: '2025-01' }];
  const result = fillTemplate(template, params, ['2025-06']);
  assert.equal(result, 'FILTER (?d >= "2025-06-01"^^xsd:date)');
});

test('fillTemplate month-end produces last day of month', () => {
  const template = 'FILTER (?d <= {{end}})';
  const params = [{ label: 'End', type: 'month-end', placeholder: 'end', default: '2025-01' }];
  const result = fillTemplate(template, params, ['2025-02']);
  assert.equal(result, 'FILTER (?d <= "2025-02-28"^^xsd:date)');
});

test('fillTemplate month-end handles leap year February', () => {
  const template = 'FILTER (?d <= {{end}})';
  const params = [{ label: 'End', type: 'month-end', placeholder: 'end', default: '2024-02' }];
  const result = fillTemplate(template, params, ['2024-02']);
  assert.equal(result, 'FILTER (?d <= "2024-02-29"^^xsd:date)');
});

test('fillTemplate year-start produces January 1', () => {
  const template = 'FILTER (?d >= {{start}})';
  const params = [{ label: 'Start', type: 'year-start', placeholder: 'start', default: '2024' }];
  const result = fillTemplate(template, params, ['2026']);
  assert.equal(result, 'FILTER (?d >= "2026-01-01"^^xsd:date)');
});

test('fillTemplate year-end produces December 31', () => {
  const template = 'FILTER (?d <= {{end}})';
  const params = [{ label: 'End', type: 'year-end', placeholder: 'end', default: '2026' }];
  const result = fillTemplate(template, params, ['2026']);
  assert.equal(result, 'FILTER (?d <= "2026-12-31"^^xsd:date)');
});

test('fillTemplate month/year types fall back to default on invalid input', () => {
  const template = 'FILTER (?d >= {{start}} && ?d <= {{end}})';
  const params = [
    { label: 'Start', type: 'month-start', placeholder: 'start', default: '2025-01' },
    { label: 'End', type: 'year-end', placeholder: 'end', default: '2026' },
  ];
  const result = fillTemplate(template, params, ['invalid', '']);
  assert.equal(result, 'FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2026-12-31"^^xsd:date)');
});
