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
import {
  classifyColumns, isChartable, aggregateByX, chartLabel,
  axisTooltipFormatter, itemTooltipFormatter,
} from '../src/js/utils/chartUtils.js';

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

test('chartLabel labels an ePO resource by its identifier', () => {
  // Not "Lot LOT-0001": the class name is the mapping's, and it is also the
  // identical half of every label in a column of lots (issue #74).
  assert.equal(
    chartLabel('http://data.europa.eu/a4g/resource/id_abc_Lot_LOT-0001'),
    'LOT-0001',
  );
});

test('chartLabel never shows a class name the ontology does not have', () => {
  // "ContractLocation" is invented by the mapping; the endpoint types these
  // as dct:Location. Truncated to an axis width it also read the same on
  // every bar, hiding the one part that told them apart.
  assert.equal(
    chartLabel('http://data.europa.eu/a4g/resource/id_abc_ContractLocation_3d8j29UsaRcxS2BiGuKwnE'),
    '3d8j29UsaRcxS2BiGuKwnE',
  );
});

test('chartLabel falls back to the uuid for a resource with no identifier', () => {
  // A notice: the source data gives it no identifier, so its URI ends at the
  // class name. Its uuid at least differs between notices, which the class
  // name repeated down the axis never did.
  assert.equal(
    chartLabel('http://data.europa.eu/a4g/resource/id_0ad4e9e7-fafc_Notice'),
    '0ad4e9e7-fafc',
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

// ── tooltip text ────────────────────────────────────────────────────
//
// The axis truncates at 80px; hovering is where the whole label belongs. The
// two go through the same function, so they cannot disagree.

const CONTRACT_LOCATION =
  'http://data.europa.eu/a4g/resource/id_abc_ContractLocation_UuomzHtPoyL8ffyDMgaUUK';

test('an axis tooltip names the category in full', () => {
  assert.equal(
    axisTooltipFormatter([{ axisValue: CONTRACT_LOCATION, marker: '●', value: 4 }]),
    'UuomzHtPoyL8ffyDMgaUUK<br/>●4',
  );
});

test('an axis tooltip names each series when there is more than one', () => {
  assert.equal(
    axisTooltipFormatter([
      { axisValue: CONTRACT_LOCATION, marker: '●', seriesName: 'ESP', value: 4 },
      { axisValue: CONTRACT_LOCATION, marker: '○', seriesName: 'ITA', value: 7 },
    ]),
    'UuomzHtPoyL8ffyDMgaUUK<br/>●ESP: 4<br/>○ITA: 7',
  );
});

test('an axis tooltip survives params ECharts hands over empty', () => {
  assert.equal(axisTooltipFormatter([]), '');
});

test('a pie tooltip keeps the percentage', () => {
  assert.equal(
    itemTooltipFormatter({ name: CONTRACT_LOCATION, value: 4, percent: 12.5 }),
    'UuomzHtPoyL8ffyDMgaUUK: 4 (12.5%)',
  );
});

test('a scatter tooltip reads its label out of the point', () => {
  assert.equal(
    itemTooltipFormatter({ value: [CONTRACT_LOCATION, 4] }),
    'UuomzHtPoyL8ffyDMgaUUK: 4',
  );
});

test('a grouped point names its group, an ungrouped one does not', () => {
  const point = { value: [CONTRACT_LOCATION, 4], seriesName: 'ESP' };

  assert.equal(itemTooltipFormatter(point, { showSeriesName: true }),
    'ESP<br/>UuomzHtPoyL8ffyDMgaUUK: 4');
  // Unnamed series can arrive carrying a name ECharts invented, so the caller
  // says whether there is a real group rather than the formatter guessing.
  assert.equal(itemTooltipFormatter(point), 'UuomzHtPoyL8ffyDMgaUUK: 4');
});

// ── tooltips are HTML, and their contents are not ours ──────────────
//
// ECharts renders a formatter's return value as HTML. Everything in it comes
// from a SPARQL result: the endpoint's data, or a query someone was sent in a
// shared link. None of it may reach the DOM as markup.

const XSS = '<img src=x onerror=alert(1)>';

test('a hostile category cannot smuggle markup into an axis tooltip', () => {
  const out = axisTooltipFormatter([{ axisValue: XSS, marker: '<span></span>', value: 1 }]);

  assert.ok(!out.includes('<img'), out);
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'), out);
});

test('a hostile group name and value cannot either', () => {
  const out = axisTooltipFormatter([
    { axisValue: 'ok', marker: '', seriesName: XSS, value: XSS },
    { axisValue: 'ok', marker: '', seriesName: 'b', value: 2 },
  ]);

  assert.ok(!out.includes('<img'), out);
});

test('the same holds for a single point', () => {
  assert.ok(!itemTooltipFormatter({ name: XSS, value: XSS }).includes('<img'));
  assert.ok(!itemTooltipFormatter({ value: [XSS, XSS] }).includes('<img'));
  assert.ok(
    !itemTooltipFormatter({ value: [1, 2], seriesName: XSS }, { showSeriesName: true })
      .includes('<img'),
  );
});

test("ECharts' own marker is markup and stays markup", () => {
  // It is the coloured dot, built by the library, not by the data.
  const marker = '<span style="background-color:#2c862d"></span>';
  assert.ok(axisTooltipFormatter([{ axisValue: 'ok', marker, value: 1 }]).includes(marker));
});

test('an ampersand in a label is escaped once, not twice', () => {
  assert.equal(
    axisTooltipFormatter([{ axisValue: 'Bread & Butter Ltd', marker: '', value: 1 }]),
    'Bread &amp; Butter Ltd<br/>1',
  );
});
