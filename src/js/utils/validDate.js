/*
 * Copyright 2024 European Union
 *
 * Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
 * Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence
 */

// An impossible date is not an error the endpoint reports. A query filtering
// on the 15th month runs, matches nothing, and returns an empty result that
// reads as an answer (issue #108).
//
// Which literals a query contains is a question about the query, not about
// its text: a date inside a comment is not in the query, `xsd` means
// whatever the query's own PREFIX says it means, and xsd:dateTime is not
// xsd:date. The editor already parses SPARQL continuously to colour it, so
// those questions are answered by asking its syntax tree rather than by
// reading the text again.

import {
  XSD_NAMESPACE, textReader, literalValue, readPrologue, datatypeOf,
} from './sparqlTree.js';

/** The one datatype this module has an opinion about. */
const XSD_DATE = `${XSD_NAMESPACE}date`;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Whether a year has a 29 February, by the Gregorian rule.
 *
 * The year is a BigInt because XSD puts no limit on its length, and past
 * 2^53 a Number no longer distinguishes one year from the next.
 *
 * @param {bigint} year
 */
function isLeapYear(year) {
  return (year % 4n === 0n && year % 100n !== 0n) || year % 400n === 0n;
}

/**
 * Whether a year, month and day name a day that exists.
 *
 * The arithmetic is done here rather than through Date, which reads a year
 * of 0-99 as 1900-1999 and rolls an impossible day forward into the next
 * month instead of rejecting it.
 *
 * @param {bigint} year
 * @param {number} month
 * @param {number} day
 */
function isRealDate(year, month, day) {
  if (month < 1 || month > 12) return false;
  const days = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= days;
}

/**
 * Whether a string is a valid xsd:date value.
 *
 * Wider than a date picker's YYYY-MM-DD, because XSD is: a date may carry
 * a timezone, and its year may be negative or longer than four digits.
 * None of those will come out of this application, but a query is free to
 * contain one and reporting it as a mistake would be wrong.
 *
 * @param {string} value the literal's value, with its escapes resolved
 * @returns {boolean}
 */
function isValidXsdDate(value) {
  const match = value.match(/^(-?)(\d{4,})-(\d{2})-(\d{2})(Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return false;
  const [, sign, year, month, day, timezone] = match;

  // A year is four digits, or more with no zero padding it out.
  if (year.length > 4 && year.startsWith('0')) return false;

  if (timezone && timezone !== 'Z') {
    const [hours, minutes] = timezone.slice(1).split(':').map(Number);
    // The offset runs to ±14:00, and 14:00 is the only offset at that hour.
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return false;
  }

  return isRealDate(BigInt(sign + year), Number(month), Number(day));
}

/**
 * The xsd:date literals in a parsed query that are not real calendar dates.
 *
 * @param {import('@lezer/common').Tree} tree the query's syntax tree, as the
 *   editor has already parsed it
 * @param {import('@codemirror/state').Text} doc the document the tree is of
 * @returns {Array<{value: string, from: number, to: number}>} each offending
 *   literal with the range of the literal and its datatype, for a marker.
 */
export function invalidDateLiterals(tree, doc) {
  const text = textReader(doc);
  const prologue = readPrologue(tree, text);
  const found = [];

  tree.iterate({
    enter(node) {
      if (node.name !== 'RDFLiteral') return;
      const literal = node.node;
      if (datatypeOf(literal, text, prologue) !== XSD_DATE) return;

      const string = literal.getChild('String');
      if (!string) return;

      const value = literalValue(text(string));
      if (!isValidXsdDate(value)) {
        found.push({ value, from: literal.from, to: literal.to });
      }
    },
  });

  return found;
}
