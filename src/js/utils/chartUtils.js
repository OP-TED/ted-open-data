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

import { resourceIdentifier, resourceUuid, shortLabel } from './namespaces.js';

/**
 * Short, human-readable label for a chart axis / legend value.
 *
 * URIs collapse to their local name so a URI-valued column doesn't render
 * every axis tick as an identical shared prefix (e.g. every legal-basis URI
 * as "http://publ…"). Tooltips show the same label untruncated; the full
 * value lives in the Table view, where it can be selected and copied.
 *
 *  - ePO resource URIs → the identifier they end with ("LOT-0001").
 *  - Known-namespace URIs use the app's shortLabel ("epo:Notice").
 *  - Any other http(s) URI → the segment after the last "/" or "#".
 *  - Non-URI values (codes, dates, plain strings) are returned unchanged.
 *
 * @param {string} value
 * @returns {string}
 */
export function chartLabel(value) {
  if (value == null) return '';
  const s = String(value);

  // The class name in a resource URI is the RML mapping's, which the ontology
  // need not recognise (issue #74), and a chart has no rdf:type to consult in
  // its place — its rows are whatever the query selected. So it is left out.
  // Nothing is lost by that: every row of a column is generally the same kind
  // of thing, which makes the class name the identical half of every label,
  // and the identifier the half that survives an axis truncating at 80px.
  const uuid = resourceUuid(s);
  if (uuid) return resourceIdentifier(s) || uuid;

  const short = shortLabel(s);
  if (short !== s) return short;
  if (/^https?:\/\//i.test(s)) {
    const trimmed = s.replace(/[/#]+$/, '');
    const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('#'));
    if (idx >= 0 && idx < trimmed.length - 1) return trimmed.slice(idx + 1);
  }
  return s;
}

// ECharts renders whatever a tooltip formatter returns as HTML. Every
// fragment below comes from a SPARQL result — a label, a group name, a value —
// so every one is escaped on its way in. Only `p.marker`, the coloured dot
// ECharts builds itself, is passed through as the markup it is.
//
// The built-in '{b}: {c}' templates these formatters replaced were escaped by
// ECharts; a formatter function has to do it itself.
const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// An axis tick has 80px and a row of neighbours, so it shows a truncated
// label. Hovering is where the whole one belongs — the same label, in full,
// naming the column you are on. Both sides go through chartLabel, so the
// tooltip can never disagree with the tick above it.
//
// What hovering does not carry is the underlying URI. It is a hundred
// characters, it cannot be selected out of a tooltip that closes when the
// pointer leaves, and the Table view has it in a form you can copy.

/**
 * Tooltip text for a category axis. ECharts hands `trigger: 'axis'` every
 * series at the hovered category, so a grouped chart names each one and an
 * ungrouped chart, having only the one, does not.
 *
 * @param {Array} params - ECharts axis tooltip params.
 * @returns {string} HTML, as ECharts expects.
 */
export function axisTooltipFormatter(params) {
  const rows = params.map(p => (
    params.length > 1
      ? `${p.marker ?? ''}${escapeHtml(p.seriesName)}: ${escapeHtml(p.value)}`
      : `${p.marker ?? ''}${escapeHtml(p.value)}`
  ));
  return [escapeHtml(chartLabel(params[0]?.axisValue ?? '')), ...rows].join('<br/>');
}

/**
 * Tooltip text for a single point: a pie slice, or one scatter point.
 *
 * `showSeriesName` is passed by the caller rather than read off the params,
 * because only the caller knows whether the series carries a group the user
 * chose or a name ECharts made up for an unnamed one.
 *
 * @param {object} p - ECharts item tooltip params.
 * @param {{showSeriesName?: boolean}} [options]
 * @returns {string}
 */
export function itemTooltipFormatter(p, { showSeriesName = false } = {}) {
  // A scatter point's value is the [x, y] pair; a pie slice's is the number,
  // and its category is the name.
  const [label, value] = Array.isArray(p.value)
    ? [chartLabel(p.value[0]), p.value[1]]
    : [chartLabel(p.name), p.value];

  const percent = p.percent === undefined ? '' : ` (${escapeHtml(p.percent)}%)`;
  const group = showSeriesName && p.seriesName ? `${escapeHtml(p.seriesName)}<br/>` : '';
  return `${group}${escapeHtml(label)}: ${escapeHtml(value)}${percent}`;
}

/**
 * Classify SPARQL result columns as numeric or non-numeric (label).
 * A column is numeric if every row has a non-empty value that parses as a number.
 *
 * @param {Array} bindings - The SPARQL results bindings array.
 * @returns {{ numericColumns: string[], labelColumns: string[] }}
 */
export function classifyColumns(bindings) {
  if (!bindings || bindings.length === 0) return { numericColumns: [], labelColumns: [] };

  const headers = Object.keys(bindings[0]);
  const numericColumns = headers.filter(h =>
    bindings.every(row => {
      const val = row[h]?.value;
      return val !== undefined && val !== '' && !isNaN(Number(val));
    })
  );
  const labelColumns = headers.filter(h => !numericColumns.includes(h));
  return { numericColumns, labelColumns };
}

/**
 * Determine if SPARQL result bindings are chartable.
 * Requires at least one numeric column (a Y axis) and at least two columns
 * total (so a distinct X axis exists). An all-numeric result is chartable —
 * e.g. `?year ?count` plots count-by-year with a numeric column as the X axis.
 *
 * @param {Array} bindings - The SPARQL results bindings array.
 * @returns {boolean}
 */
export function isChartable(bindings) {
  if (!bindings || bindings.length === 0) return false;
  const { numericColumns } = classifyColumns(bindings);
  return numericColumns.length > 0 && Object.keys(bindings[0]).length >= 2;
}

/**
 * Aggregate Y values per unique X label by summing duplicates.
 *
 * @param {Array} bindings - The SPARQL results bindings array.
 * @param {string} xColumn - The column to use as the X axis (labels).
 * @param {string} yColumn - The column to use as the Y axis (values to sum).
 * @returns {{ labels: string[], values: number[] }}
 */
export function aggregateByX(bindings, xColumn, yColumn) {
  const aggregated = new Map();
  bindings.forEach(row => {
    const label = row[xColumn]?.value || '';
    const value = Number(row[yColumn]?.value) || 0;
    aggregated.set(label, (aggregated.get(label) || 0) + value);
  });
  return { labels: [...aggregated.keys()], values: [...aggregated.values()] };
}
