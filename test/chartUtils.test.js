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
import { classifyColumns, isChartable, aggregateByX } from '../src/js/utils/chartUtils.js';

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

test('isChartable returns false when all columns are numeric', () => {
  const bindings = [
    { x: { value: '1' }, y: { value: '2' } },
    { x: { value: '3' }, y: { value: '4' } },
  ];
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
