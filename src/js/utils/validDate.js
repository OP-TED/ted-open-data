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
/**
 * A value split into what it says and the timezone it carries, if any.
 *
 * The offset is the same suffix on all three datatypes, and it is the only
 * part of a dateTime that belongs to the whole value rather than to the
 * date or the time within it.
 *
 * @param {string} value
 * @returns {[string, string]} the value without its offset, and the offset
 */
function splitTimezone(value) {
  const match = value.match(/(Z|[+-]\d{2}:\d{2})$/);
  return match ? [value.slice(0, -match[0].length), match[0]] : [value, ''];
}

/**
 * Whether an offset is one a timezone can have.
 *
 * @param {string} timezone the offset, or '' for a value without one
 */
function isRealTimezone(timezone) {
  if (timezone === '' || timezone === 'Z') return true;
  const [hours, minutes] = timezone.slice(1).split(':').map(Number);
  // The offset runs to ±14:00, and 14:00 is the only offset at that hour.
  return hours <= 14 && minutes <= 59 && !(hours === 14 && minutes !== 0);
}

/**
 * Whether a string names a day, offset aside.
 *
 * @param {string} value
 */
function isRealDay(value) {
  const match = value.match(/^(-?)(\d{4,})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, sign, year, month, day] = match;

  // A year is four digits, or more with no zero padding it out.
  if (year.length > 4 && year.startsWith('0')) return false;

  const numbered = BigInt(sign + year);
  // XSD 1.0 had no year zero and XSD 1.1 added one, so `0000` is a date in
  // the later reading and not in the earlier. Neither reading has `-0000`,
  // and nothing was procured in either — a query naming that year has gone
  // wrong whichever spec is held to, which is what this module reports.
  if (numbered === 0n) return false;

  return isRealDate(numbered, Number(month), Number(day));
}

/**
 * Whether a string names a time of day, offset aside.
 *
 * Hour 24 is the end of a day rather than a 25th hour, so it is written
 * only as the moment the day ends: any minute or second past it names a
 * time that does not exist. Seconds may carry a fraction, and XSD has no
 * leap second, so 60 is out whatever the almanac says.
 *
 * @param {string} value
 */
function isRealClock(value) {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})(\.\d+)?$/);
  if (!match) return false;
  const [, hours, minutes, seconds, fraction] = match;

  if (Number(minutes) > 59 || Number(seconds) > 59) return false;
  if (Number(hours) === 24) {
    return minutes === '00' && seconds === '00' && (!fraction || /^\.0+$/.test(fraction));
  }
  return Number(hours) <= 23;
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
  const [day, timezone] = splitTimezone(value);
  return isRealDay(day) && isRealTimezone(timezone);
}

/**
 * Whether a string is a valid xsd:time value.
 *
 * @param {string} value the literal's value, with its escapes resolved
 * @returns {boolean}
 */
function isValidXsdTime(value) {
  const [clock, timezone] = splitTimezone(value);
  return isRealClock(clock) && isRealTimezone(timezone);
}

/**
 * Whether a string is a valid xsd:dateTime value.
 *
 * A day and a time of day with a `T` between them, each held to what it
 * would have to be on its own. The day is read as written even when the
 * time is the end of one: `2024-02-29T24:00:00` names the close of a
 * leap day, and is a date that does not exist in any other year.
 *
 * @param {string} value the literal's value, with its escapes resolved
 * @returns {boolean}
 */
function isValidXsdDateTime(value) {
  const [moment, timezone] = splitTimezone(value);
  const separator = moment.indexOf('T');
  if (separator === -1) return false;
  return isRealDay(moment.slice(0, separator))
    && isRealClock(moment.slice(separator + 1))
    && isRealTimezone(timezone);
}

/** How each kind of moment is held to what it has to be. */
const BY_KIND = new Map([
  ['date', isValidXsdDate],
  ['time', isValidXsdTime],
  ['dateTime', isValidXsdDateTime],
]);

/**
 * The datatypes this module has an opinion about, and which kind each is.
 *
 * The kind travels with the answer because a reader told only that a value
 * is wrong is not told what it should have been, and what it should have
 * been differs for each of the three.
 */
const KIND_OF = new Map([
  [`${XSD_NAMESPACE}date`, 'date'],
  [`${XSD_NAMESPACE}time`, 'time'],
  [`${XSD_NAMESPACE}dateTime`, 'dateTime'],
]);

/**
 * Whether a value is a moment of the kind it is offered as.
 *
 * The same judgement the editor makes of a query's own literals, asked of
 * one value at a time — so a form collecting a moment can say which field
 * is wrong while it is still open, rather than leaving it to the check on
 * submission to refuse the whole query afterwards.
 *
 * @param {string} kind one of `date`, `time`, `dateTime`; anything else is
 *   not a moment and is nothing this module has an opinion about
 * @param {string} value
 * @returns {boolean} true unless it is a kind we judge and the value fails
 */
export function isRealMoment(kind, value) {
  const isValid = BY_KIND.get(kind);
  return isValid ? isValid(value) : true;
}

/**
 * The dated literals in a parsed query that are not a real date or time.
 *
 * @param {import('@lezer/common').Tree} tree the query's syntax tree, as the
 *   editor has already parsed it
 * @param {import('@codemirror/state').Text} doc the document the tree is of
 * @returns {Array<{value: string, kind: string, from: number, to: number}>}
 *   each offending literal with the range of the literal and its datatype,
 *   for a marker, and which of the three it was written as.
 */
export function invalidMomentLiterals(tree, doc) {
  const text = textReader(doc);
  const prologue = readPrologue(tree, text);
  const found = [];

  tree.iterate({
    enter(node) {
      if (node.name !== 'RDFLiteral') return;
      const literal = node.node;
      const kind = KIND_OF.get(datatypeOf(literal, text, prologue));
      if (!kind) return;

      const string = literal.getChild('String');
      if (!string) return;

      const value = literalValue(text(string));
      if (!isRealMoment(kind, value)) {
        found.push({ value, kind, from: literal.from, to: literal.to });
      }
    },
  });

  return found;
}
