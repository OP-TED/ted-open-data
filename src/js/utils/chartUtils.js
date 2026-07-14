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

import { shortLabel } from './namespaces.js';

/**
 * Short, human-readable label for a chart axis / legend value.
 *
 * URIs collapse to their local name so a URI-valued column doesn't render
 * every axis tick as an identical shared prefix (e.g. every legal-basis URI
 * as "http://publ…"). The full value stays available in tooltips.
 *
 *  - ePO-resource / known-namespace URIs use the app's shortLabel
 *    ("Lot LOT-0001", "epo:Notice").
 *  - Any other http(s) URI → the segment after the last "/" or "#".
 *  - Non-URI values (codes, dates, plain strings) are returned unchanged.
 *
 * @param {string} value
 * @returns {string}
 */
export function chartLabel(value) {
  if (value == null) return '';
  const s = String(value);
  const short = shortLabel(s);
  if (short !== s) return short;
  if (/^https?:\/\//i.test(s)) {
    const trimmed = s.replace(/[/#]+$/, '');
    const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('#'));
    if (idx >= 0 && idx < trimmed.length - 1) return trimmed.slice(idx + 1);
  }
  return s;
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
