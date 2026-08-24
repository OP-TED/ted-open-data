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
// Values, in and out of the form.
//
// Which control can carry a value without altering it, what may be typed
// into one, how two of them compare, and how one is written back into
// the query.
//
// This end knows nothing about how a parameter was found — only what a
// slot holds and what SPARQL will accept in its place.

import { escapeLiteral, applyEdits } from './sparqlTree.js';

/** @typedef {import('./queryParameters.js').ParameterSlot} ParameterSlot */
/** @typedef {import('./queryParameters.js').QueryParameter} QueryParameter */

const DAY = /\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/.source;
const CLOCK = /([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?/.source;

const DISPLAYABLE = {
  // Hour 24 is a valid xsd:time — the end of a day — and no clock control
  // will take it. Nor will one take a month of 13, which is not valid
  // either but can still be sitting in a query.
  date: new RegExp(`^${DAY}$`),
  time: new RegExp(`^${CLOCK}$`),
  dateTime: new RegExp(`^${DAY}T${CLOCK}$`),
  // A mantissa ending in a bare dot — `3.`, valid xsd:decimal — is
  // cleared. Whether an exponent rescues it varies by browser, so any
  // trailing dot is left to a text box, which always holds its value.
  number: /^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/,
  boolean: /^(true|false)$/,
};

/**
 * What SPARQL reads as a number written without quotes.
 *
 * Exactly the grammar's INTEGER, DECIMAL and DOUBLE, signed or not. It is
 * narrower than the lexical space of the datatypes: `3.` is a fine
 * xsd:decimal inside quotes, and not a number at all outside them, while
 * `INF` is only ever a quoted xsd:double.
 */
const SPARQL_NUMBER =
  /^[+-]?(\d+\.\d*[eE][+-]?\d+|\.\d+([eE][+-]?\d+)?|\d+(\.\d+)?([eE][+-]?\d+)?)$/;

/**
 * What each kind that is written without quotes may be written as.
 *
 * A quoted value is safe whatever it holds, because escaping keeps it
 * inside its quotes. A bare one has no such wall: it becomes part of the
 * query itself, so it has to be a literal of that kind and nothing else.
 */
const BARE = {
  number: { shape: SPARQL_NUMBER, wanted: 'must be a number.' },
  boolean: { shape: /^(true|false)$/, wanted: 'must be true or false.' },
};

/**
 * Why a value cannot be put in a slot, as a clause following the field's
 * name, or null if it can.
 *
 * @param {ParameterSlot} slot
 * @param {string} value
 * @returns {string|null}
 */
export function valueProblem(slot, value) {
  // Only a plain string may be empty, since `""` is a literal and
  // `""^^xsd:date` is not a date.
  if (value === '') return slot.kind === 'text' ? null : 'needs a value.';
  // Quoting and escaping keep a value inside its literal whatever it says.
  if (slot.quoted) return null;
  const bare = BARE[slot.kind];
  if (!bare) return 'cannot be written without quotes.';
  return bare.shape.test(value) ? null : bare.wanted;
}

/**
 * The kind of control a slot should be given.
 *
 * Usually the kind of its value, but a value the control cannot hold is
 * offered as text instead. `"2024-11-04T10:00:00Z"` in a datetime-local
 * control would come back without its timezone, changing a query the user
 * never edited; a text box hands it back exactly as it was found.
 *
 * @param {ParameterSlot} slot
 * @returns {ParameterSlot['kind']}
 */
export function controlKind(slot) {
  const displayable = DISPLAYABLE[slot.kind];
  if (displayable && !displayable.test(slot.value)) return 'text';
  return slot.kind;
}

/**
 * A decimal broken into the pieces needed to compare it exactly: its sign,
 * its digits, and the power of ten they are scaled by.
 *
 * @param {string} value
 * @returns {{negative: boolean, digits: bigint, scale: number}|null}
 */
function decimalParts(value) {
  const match = value.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;
  const [, sign, whole = '', fraction = '', exponent] = match;
  if (!whole && !fraction) return null;
  const scale = Number(exponent || 0) - fraction.length;
  // SPARQL puts no limit on how many digits an exponent may have, and past
  // 308 of them a Number is Infinity. Two of those subtract to NaN, which
  // no comparison against a limit rejects — every one is false — so the
  // scale is refused here, where it is still a number.
  if (!Number.isSafeInteger(scale)) return null;
  return {
    negative: sign === '-',
    digits: BigInt(`${whole}${fraction}`),
    scale,
  };
}

/**
 * Which of two numbers is the smaller, exactly.
 *
 * Not through Number: XSD puts no limit on a decimal's precision, and past
 * 2^53 a Number stops telling one integer from the next — 9007199254740992
 * and 9007199254740993 become the same value, and an inverted range built
 * from them would pass unnoticed.
 *
 * @returns {-1|0|1|null} null where either value is not a plain number
 */
function compareNumbers(a, b) {
  const [x, y] = [decimalParts(a), decimalParts(b)];
  if (!x || !y) return null;
  if (x.digits === 0n && y.digits === 0n) return 0;
  if (x.negative !== y.negative) return x.negative ? -1 : 1;

  // Scale both to the same power of ten before comparing the digits. An
  // exponent far beyond any real quantity is left unordered rather than
  // turned into a number that long.
  const difference = x.scale - y.scale;
  if (Math.abs(difference) > 1000) return null;
  const shift = 10n ** BigInt(Math.abs(difference));
  const [left, right] = difference > 0 ? [x.digits * shift, y.digits] : [x.digits, y.digits * shift];

  const order = left < right ? -1 : left > right ? 1 : 0;
  return x.negative ? -order : order;
}

/**
 * Which of two values of the same kind comes first, or null when they
 * cannot be ordered soundly.
 *
 * Dates and times in their plain forms sort as text — that is what ISO
 * 8601 is for — but only once both carry the same precision, and not at
 * all once one carries a timezone. Numbers must be compared as numbers,
 * since "9" sorts after "10" and is not larger than it. Anything else,
 * including text, has no order worth asserting.
 *
 * @param {ParameterSlot['kind']} kind
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1|null}
 */
export function compareValues(kind, a, b) {
  if (kind === 'number') return compareNumbers(a, b);

  const shape = kind === 'date' || kind === 'time' || kind === 'dateTime' ? DISPLAYABLE[kind] : null;
  if (!shape || !shape.test(a) || !shape.test(b)) return null;

  // A control may hand back a time without seconds; the same instant must
  // not sort before itself written more precisely.
  const seconds = (value) => (kind === 'date' || /:\d{2}:\d{2}/.test(value) ? value : `${value}:00`);
  const [x, y] = [seconds(a), seconds(b)];
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * A slot's literal, written with a new value.
 *
 * @param {ParameterSlot} slot
 * @param {string} value
 * @returns {string}
 */
export function literalFor(slot, value) {
  const lexical = lexicalForm(slot, String(value));
  // A number or a boolean is written bare; quoting it would change its type.
  if (slot.quoted) return `"${escapeLiteral(lexical)}"${slot.suffix}`;

  // Bare, so the value becomes part of the query rather than sitting inside
  // it. `1) . ?x ?p ?o . FILTER(1` is a query of its own, and it parses.
  // The form refuses such a value long before this, and this refuses it
  // again: a wrong query is worth an error, never a run.
  if (!BARE[slot.kind]?.shape.test(lexical)) {
    throw new Error(`${JSON.stringify(lexical)} is not a ${slot.kind} SPARQL can read unquoted`);
  }
  return lexical;
}

/**
 * A value in the form its datatype requires.
 *
 * A `datetime-local` control yields `2024-11-04T00:00`, and xsd:dateTime
 * has no such form — seconds are part of it. Writing the control's value
 * straight into the query would replace a valid literal with an invalid
 * one, which is the failure this whole area exists to prevent.
 *
 * @param {ParameterSlot} slot
 * @param {string} value
 * @returns {string}
 */
function lexicalForm(slot, value) {
  if (slot.kind === 'dateTime' && /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return `${value}:00`;
  }
  if (slot.kind === 'time' && /^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return value;
}

/**
 * The query with the given values in place of its own.
 *
 * @param {string} text the query as it stands
 * @param {QueryParameter[]} parameters as {@link queryParameters} found them
 * @param {Map<ParameterSlot, string>} values the value for each slot; a slot
 *   with no entry keeps the value already in the query
 * @returns {string}
 */
export function fillQuery(text, parameters, values) {
  const edits = [];
  for (const parameter of parameters) {
    for (const slot of parameter.slots) {
      if (!values.has(slot)) continue;
      edits.push({ from: slot.from, to: slot.to, insert: literalFor(slot, values.get(slot)) });
    }
  }
  return applyEdits(text, edits);
}
