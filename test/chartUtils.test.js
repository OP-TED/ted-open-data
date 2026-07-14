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
// chartUtils tests — column classification, chartability detection,
// and Y-value aggregation logic used by ChartView.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyColumns, isChartable, aggregateByX, chartLabel } from '../src/js/utils/chartUtils.js';

// ── chartLabel ─────────────────────────────────────────────────────

test('chartLabel collapses an authority URI to its local name', () => {
  // The bug this fixes: legal-basis URIs all share a long prefix, so an
  // axis truncated to a fixed width shows an identical "http://publ…".
  assert.equal(
    chartLabel('http://publications.europa.eu/resource/authority/legal-basis/32014L0024'),
    '32014L0024',
  );
});

test('chartLabel distinguishes URIs that share a prefix', () => {
  const base = 'http://publications.europa.eu/resource/authority/legal-basis/';
  assert.notEqual(chartLabel(base + '32014L0024'), chartLabel(base + '32014L0025'));
});

test('chartLabel uses the fragment after a # for hash URIs', () => {
  assert.equal(chartLabel('http://data.europa.eu/a4g/ontology#Notice'), 'epo:Notice');
});

test('chartLabel shortens ePO resource URIs to "Type id" via shortLabel', () => {
  assert.equal(
    chartLabel('http://data.europa.eu/a4g/resource/id_abc_Lot_LOT-0001'),
    'Lot LOT-0001',
  );
});

test('chartLabel leaves non-URI values untouched', () => {
  assert.equal(chartLabel('45000000'), '45000000');       // CPV code
  assert.equal(chartLabel('2024-11-06'), '2024-11-06');   // date
  assert.equal(chartLabel('Belgium'), 'Belgium');         // plain string
});

test('chartLabel handles a trailing slash and empty / nullish input', () => {
  assert.equal(chartLabel('http://example.org/foo/bar/'), 'bar');
  assert.equal(chartLabel(''), '');
  assert.equal(chartLabel(null), '');
  assert.equal(chartLabel(undefined), '');
});

// ── classifyColumns ────────────────────────────────────────────────

test('classifyColumns identifies numeric and label columns correctly', () => {
  const bindings = [
    { date: { value: '2026-01-01' }, count: { value: '42' } },
    { date: { value: '2026-01-02' }, count: { value: '15' } },
  ];
  const { numericColumns, labelColumns } = classifyColumns(bindings);
  assert.deepEqual(numericColumns, ['count']);
  assert.deepEqual(labelColumns, ['date']);
});

test('classifyColumns treats a column with one non-numeric value as a label column', () => {
  const bindings = [
    { name: { value: 'Alice' }, score: { value: '10' } },
    { name: { value: 'Bob' }, score: { value: 'N/A' } },
  ];
  const { numericColumns, labelColumns } = classifyColumns(bindings);
  assert.deepEqual(numericColumns, []);
  assert.deepEqual(labelColumns, ['name', 'score']);
});

test('classifyColumns returns empty arrays for empty bindings', () => {
  const { numericColumns, labelColumns } = classifyColumns([]);
  assert.deepEqual(numericColumns, []);
  assert.deepEqual(labelColumns, []);
});

// ── isChartable ────────────────────────────────────────────────────

test('isChartable returns true when at least one numeric and one label column exist', () => {
  const bindings = [
    { country: { value: 'DE' }, notices: { value: '500' } },
    { country: { value: 'FR' }, notices: { value: '300' } },
  ];
  assert.equal(isChartable(bindings), true);
});

test('isChartable returns false when all columns are strings', () => {
  const bindings = [
    { name: { value: 'Alice' }, city: { value: 'Brussels' } },
    { name: { value: 'Bob' }, city: { value: 'Paris' } },
  ];
  assert.equal(isChartable(bindings), false);
});

test('isChartable returns true when all columns are numeric', () => {
  // A numeric column can serve as the X axis — e.g. `?year ?count` plots
  // count-by-year, so an all-numeric two-column result is chartable.
  const bindings = [
    { year: { value: '2020' }, count: { value: '145' } },
    { year: { value: '2021' }, count: { value: '210' } },
  ];
  assert.equal(isChartable(bindings), true);
});

test('isChartable returns false for a single numeric column (no X axis)', () => {
  const bindings = [{ count: { value: '1' } }, { count: { value: '2' } }];
  assert.equal(isChartable(bindings), false);
});

test('isChartable returns false for empty bindings', () => {
  assert.equal(isChartable([]), false);
  assert.equal(isChartable(null), false);
});

// ── aggregateByX ──────────────────────────────────────────────────

test('aggregateByX sums Y values for duplicate X labels', () => {
  const bindings = [
    { date: { value: '2026-01-01' }, count: { value: '10' } },
    { date: { value: '2026-01-01' }, count: { value: '20' } },
    { date: { value: '2026-01-02' }, count: { value: '5' } },
  ];
  const { labels, values } = aggregateByX(bindings, 'date', 'count');
  assert.deepEqual(labels, ['2026-01-01', '2026-01-02']);
  assert.deepEqual(values, [30, 5]);
});

test('aggregateByX preserves order of first appearance', () => {
  const bindings = [
    { country: { value: 'FR' }, amount: { value: '100' } },
    { country: { value: 'DE' }, amount: { value: '200' } },
    { country: { value: 'FR' }, amount: { value: '50' } },
  ];
  const { labels, values } = aggregateByX(bindings, 'country', 'amount');
  assert.deepEqual(labels, ['FR', 'DE']);
  assert.deepEqual(values, [150, 200]);
});

test('aggregateByX treats non-numeric Y values as 0', () => {
  const bindings = [
    { name: { value: 'A' }, val: { value: 'abc' } },
    { name: { value: 'A' }, val: { value: '10' } },
  ];
  const { labels, values } = aggregateByX(bindings, 'name', 'val');
  assert.deepEqual(labels, ['A']);
  assert.deepEqual(values, [10]);
});
