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
// Values, in and out of the form.
//
// A filled query must still be a query, whatever is typed into the form —
// which for a value written without quotes means it has to be a number
// SPARQL can read, and for every other kind means the escaping holds.

import { test } from 'node:test';
import assert from 'node:assert';

import SparqlJs from 'sparqljs';

import {
  literalFor, valueProblem, controlKind, compareValues,
} from '../src/js/utils/parameterValues.js';
import { query, parametersOf, filled } from './_parameterFixtures.js';

// ── filling the query ──────────────────────────────────────────────

test('puts the value in place, keeping the datatype as written', () => {
  const out = filled(query('# ?d: Day\nFILTER (?d = "2024-11-04"^^xsd:date)'), [['2026-01-15']]);
  assert.match(out, /FILTER \(\?d = "2026-01-15"\^\^xsd:date\)/);
});

test('writes numbers and booleans without quotes', () => {
  assert.match(filled(query('# ?n: N\nFILTER (?n >= 42)'), [['99']]), /\?n >= 99\)/);
  assert.match(filled(query('# ?b: B\nVALUES ?b { true }'), [['false']]), /VALUES \?b \{ false \}/);
});

test('keeps a language tag', () => {
  assert.match(filled(query('# ?t: T\nFILTER (?t = "hello"@en)'), [['bonjour']]), /"bonjour"@en/);
});

test('fills both ends of a range', () => {
  const out = filled(query('# ?d: D\nFILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date)'),
    [['2026-02-01', '2026-02-28']]);
  assert.match(out, /"2026-02-01"\^\^xsd:date && \?d <= "2026-02-28"\^\^xsd:date/);
});

test('leaves a slot alone when no value is given for it', () => {
  const text = query('# ?d: D\nFILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date)');
  assert.match(filled(text, [[undefined, '2026-02-28']]),
    /"2025-01-01"\^\^xsd:date && \?d <= "2026-02-28"\^\^xsd:date/);
});

test('changes nothing else in the query', () => {
  const text = query('# ?d: D\nFILTER (?d = "2024-11-04"^^xsd:date)');
  const out = filled(text, [['2026-01-15']]);
  assert.strictEqual(out.replace('2026-01-15', '2024-11-04'), text);
});

// A query is read by people as well as machines, and its comments and
// layout are how it teaches. Filling a form must not disturb them.
test('preserves comments, blank lines and indentation', () => {
  const text = `# Notices published on a given day.
# ?publicationDate: Published on

PREFIX epo: <http://data.europa.eu/a4g/ontology#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT ?publicationDate WHERE {

  FILTER (?publicationDate = "2024-11-04"^^xsd:date)

  GRAPH ?g {
    ?notice a epo:Notice ;
            epo:hasPublicationDate ?publicationDate .
  }
}`;
  const out = filled(text, [['2026-01-15']]);
  assert.strictEqual(out.split('\n').length, text.split('\n').length);
  assert.strictEqual(out, text.replace('2024-11-04', '2026-01-15'));
});

// ── whatever is typed, the result is still a query ─────────────────

test('escapes anything typed into a text field', () => {
  const parser = new SparqlJs.Parser();
  const hostile = [
    'Bâtiment "A"',
    'back\\slash',
    'line\nbreak',
    '" . ?x ?y ?z . FILTER("',
    '\\" injection',
    '',
    '中文 — em dash',
    "'single'",
  ];
  for (const value of hostile) {
    const out = filled(query('# ?t: T\nFILTER (?t = "plain")'), [[value]]);
    assert.doesNotThrow(() => parser.parse(out), `not valid SPARQL for ${JSON.stringify(value)}`);
  }
});

test('the value survives the round trip', () => {
  for (const value of ['Bâtiment "A"', 'back\\slash', "it's", 'plain']) {
    const out = filled(query('# ?t: T\nFILTER (?t = "x")'), [[value]]);
    const [parameter] = parametersOf(out);
    assert.strictEqual(parameter.slots[0].value, value, JSON.stringify(value));
  }
});

// A datetime-local control yields "2024-11-04T00:00" — no seconds, which
// xsd:dateTime has no form for. Writing that straight into the query would
// replace a valid literal with an invalid one.
test('gives a dateTime the seconds its datatype requires', () => {
  assert.strictEqual(
    literalFor({ quoted: true, suffix: '^^xsd:dateTime', kind: 'dateTime' }, '2024-11-04T00:00'),
    '"2024-11-04T00:00:00"^^xsd:dateTime');
  // Already complete, or carrying a timezone: left alone.
  assert.strictEqual(
    literalFor({ quoted: true, suffix: '^^xsd:dateTime', kind: 'dateTime' }, '2024-11-04T23:59:59'),
    '"2024-11-04T23:59:59"^^xsd:dateTime');
  assert.strictEqual(
    literalFor({ quoted: true, suffix: '^^xsd:dateTime', kind: 'dateTime' }, '2024-11-04T10:00:00Z'),
    '"2024-11-04T10:00:00Z"^^xsd:dateTime');
  // A date is not touched by it.
  assert.strictEqual(
    literalFor({ quoted: true, suffix: '^^xsd:date', kind: 'date' }, '2024-11-04'),
    '"2024-11-04"^^xsd:date');
});

test('a filled dateTime query is still valid SPARQL', () => {
  const text = query('# ?d: Moment\nFILTER (?d >= "2024-11-04T00:00:00"^^xsd:dateTime)');
  const out = filled(text, [['2026-01-15T09:30']]);
  assert.match(out, /"2026-01-15T09:30:00"\^\^xsd:dateTime/);
  assert.doesNotThrow(() => new SparqlJs.Parser().parse(out));
});

test('literalFor writes each form correctly', () => {
  const quoted = (suffix) => ({ kind: 'date', quoted: true, suffix });
  assert.strictEqual(literalFor(quoted('^^xsd:date'), '2024-11-04'), '"2024-11-04"^^xsd:date');
  assert.strictEqual(literalFor({ kind: 'text', quoted: true, suffix: '@en' }, 'hello'), '"hello"@en');
  assert.strictEqual(literalFor({ kind: 'text', quoted: true, suffix: '' }, 'plain'), '"plain"');
  assert.strictEqual(literalFor({ kind: 'number', quoted: false, suffix: '' }, '42'), '42');
  assert.strictEqual(literalFor({ kind: 'text', quoted: true, suffix: '' }, 'say "hi"'), '"say \\"hi\\""');
});

// A bare value is not inside a literal — it is part of the query. Quoting
// is what makes every other kind safe, and a number has none, so the only
// protection is that it really is a number.
test('refuses to write a bare value that is not one', () => {
  const number = { kind: 'number', quoted: false, suffix: '' };
  for (const attack of ['abc', '1) . ?x ?p ?o . FILTER(1', '1 || 1=1', '"pwn"', '3.', '']) {
    assert.throws(() => literalFor(number, attack), /unquoted/, attack);
  }
  for (const fine of ['42', '-1', '+5', '3.14', '3.e2', '.5', '.5e3', '1e5']) {
    assert.strictEqual(literalFor(number, fine), fine);
  }

  const boolean = { kind: 'boolean', quoted: false, suffix: '' };
  assert.strictEqual(literalFor(boolean, 'true'), 'true');
  assert.throws(() => literalFor(boolean, 'yes'), /unquoted/);

  // A quoted value may say anything: escaping keeps it inside its quotes.
  const text = { kind: 'text', quoted: true, suffix: '' };
  assert.strictEqual(literalFor(text, '1) . ?x ?p ?o . FILTER(1'), '"1) . ?x ?p ?o . FILTER(1"');
});

// The form asks the same question before the query is ever built.
test('valueProblem names what a slot will not take', () => {
  const number = { kind: 'number', quoted: false, suffix: '' };
  assert.strictEqual(valueProblem(number, '3.e2'), null);
  assert.strictEqual(valueProblem(number, 'abc'), 'must be a number.');
  assert.strictEqual(valueProblem(number, '1) . ?x ?p ?o . FILTER(1'), 'must be a number.');
  assert.strictEqual(valueProblem(number, 'INF'), 'must be a number.');
  assert.strictEqual(valueProblem(number, ''), 'needs a value.');

  assert.strictEqual(valueProblem({ kind: 'boolean', quoted: false }, 'yes'), 'must be true or false.');
  assert.strictEqual(valueProblem({ kind: 'boolean', quoted: false }, 'false'), null);

  // A quoted slot takes anything but emptiness, and plain text takes that.
  assert.strictEqual(valueProblem({ kind: 'date', quoted: true }, 'whatever'), null);
  assert.strictEqual(valueProblem({ kind: 'date', quoted: true }, ''), 'needs a value.');
  assert.strictEqual(valueProblem({ kind: 'text', quoted: true }, ''), null);

  // A bare kind nothing knows how to write is refused rather than guessed.
  assert.strictEqual(valueProblem({ kind: 'iri', quoted: false }, 'ex:thing'),
    'cannot be written without quotes.');
});

// A single-quoted literal is rewritten double-quoted, which is the one
// cosmetic change filling a form makes.
test('normalises quoting to double quotes', () => {
  assert.match(filled(query("# ?d: D\nFILTER (?d = '2024-11-04'^^xsd:date)"), [['2026-01-15']]),
    /"2026-01-15"\^\^xsd:date/);
});

// ── ordering the two ends of a range ───────────────────────────────

test('orders dates, times and dateTimes', () => {
  assert.strictEqual(compareValues('date', '2025-01-01', '2025-12-31'), -1);
  assert.strictEqual(compareValues('date', '2025-12-31', '2025-01-01'), 1);
  assert.strictEqual(compareValues('date', '2025-01-01', '2025-01-01'), 0);
  assert.strictEqual(compareValues('time', '09:00:00', '17:00:00'), -1);
  assert.strictEqual(compareValues('dateTime', '2025-01-01T09:00:00', '2025-01-01T17:00:00'), -1);
});

// A control may hand back a time without seconds. The same instant must
// not be reported as earlier than itself written more precisely.
test('ignores a difference in precision alone', () => {
  assert.strictEqual(compareValues('dateTime', '2025-01-01T09:00', '2025-01-01T09:00:00'), 0);
  assert.strictEqual(compareValues('time', '09:00', '09:00:00'), 0);
  assert.strictEqual(compareValues('dateTime', '2025-01-01T09:00:01', '2025-01-01T09:00'), 1);
});

// "9" sorts after "10" as text and is not larger than it.
test('orders numbers as numbers', () => {
  assert.strictEqual(compareValues('number', '9', '10'), -1);
  assert.strictEqual(compareValues('number', '10', '9'), 1);
  assert.strictEqual(compareValues('number', '1.0e3', '999'), 1);
  assert.strictEqual(compareValues('number', '-5', '5'), -1);
  assert.strictEqual(compareValues('number', '-10', '-9'), -1);
  assert.strictEqual(compareValues('number', '1e3', '1000'), 0);
  assert.strictEqual(compareValues('number', '0.1', '0.10'), 0);
  assert.strictEqual(compareValues('number', '0', '-0'), 0);
});

// XSD sets no limit on a decimal's precision. Past 2^53 a Number stops
// telling one integer from the next, and an inverted range built from two
// such values would pass unnoticed.
test('orders numbers beyond the precision of a Number', () => {
  assert.strictEqual(compareValues('number', '9007199254740992', '9007199254740993'), -1);
  assert.strictEqual(compareValues('number', '9007199254740993', '9007199254740992'), 1);
  assert.strictEqual(compareValues('number', '9007199254740993', '9007199254740993'), 0);
  assert.strictEqual(compareValues('number', '1.00000000000000001', '1'), 1);
  assert.strictEqual(compareValues('number', '-9007199254740993', '-9007199254740992'), -1);
});

// A number parameter the browser will not police falls back to a text box,
// so anything at all can arrive here. Only a number is ordered.
test('orders nothing that is not a number', () => {
  for (const value of ['.', '', '-', 'e5', 'abc', '1,5', 'INF', 'NaN', '1 2']) {
    assert.strictEqual(compareValues('number', value, '5'), null, value);
    assert.strictEqual(compareValues('number', '5', value), null, value);
  }
});

// SPARQL puts no limit on an exponent's digits. Past 308 of them a Number
// is Infinity, and two of those subtract to NaN — which every comparison
// against a limit lets through, since they are all false. Ordering has to
// decline, not throw: this is reached from the Run button.
test('declines to order an exponent too long to be a Number', () => {
  const huge = `1E${'9'.repeat(400)}`;
  for (const [a, b] of [[huge, huge], [huge, '1'], ['1', huge], [`-${huge}`, huge]]) {
    assert.strictEqual(compareValues('number', a, b), null);
  }
});

// The exponents either side of that limit still order normally.
test('orders exponents a Number can still hold', () => {
  assert.strictEqual(compareValues('number', '1E308', '1E309'), -1);
  assert.strictEqual(compareValues('number', '1E-400', '1E-400'), 0);
  assert.strictEqual(compareValues('number', '1E-400', '1E-399'), -1);
});

// An exponent past any real quantity is left unordered rather than turned
// into a number with that many digits.
test('refuses to order an exponent beyond all reason', () => {
  assert.strictEqual(compareValues('number', '1e100000000', '1'), null);
});

// Where an order cannot be asserted soundly, none is.
test('refuses to order what it cannot', () => {
  assert.strictEqual(compareValues('number', 'INF', '5'), null);
  assert.strictEqual(compareValues('number', 'NaN', '5'), null);
  assert.strictEqual(compareValues('text', 'apple', 'banana'), null);
  assert.strictEqual(compareValues('boolean', 'true', 'false'), null);
  // A timezone changes which instant a value names, so the text no longer
  // sorts the way the values do.
  assert.strictEqual(compareValues('date', '2025-01-01Z', '2025-01-02'), null);
  assert.strictEqual(compareValues('dateTime', '2025-01-01T09:00:00+02:00', '2025-01-01T10:00:00'), null);
  // Nor do years outside four digits.
  assert.strictEqual(compareValues('date', '-0045-01-01', '2025-01-01'), null);
});

// ── the control a value can actually be shown in ───────────────────

test('offers the control the value asks for', () => {
  assert.strictEqual(controlKind({ kind: 'date', value: '2024-11-04' }), 'date');
  assert.strictEqual(controlKind({ kind: 'dateTime', value: '2024-11-04T10:00:00' }), 'dateTime');
  assert.strictEqual(controlKind({ kind: 'dateTime', value: '2024-11-04T10:00' }), 'dateTime');
  assert.strictEqual(controlKind({ kind: 'time', value: '10:00:00' }), 'time');
  assert.strictEqual(controlKind({ kind: 'number', value: '42' }), 'number');
  assert.strictEqual(controlKind({ kind: 'text', value: 'anything' }), 'text');
});

// A date or time control has nowhere to show a timezone, so it would hand
// the value back without one — editing a query the user never touched.
test('falls back to text where the control would lose part of the value', () => {
  assert.strictEqual(controlKind({ kind: 'date', value: '2024-11-04Z' }), 'text');
  assert.strictEqual(controlKind({ kind: 'dateTime', value: '2024-11-04T10:00:00Z' }), 'text');
  assert.strictEqual(controlKind({ kind: 'dateTime', value: '2024-11-04T10:00:00+02:00' }), 'text');
  assert.strictEqual(controlKind({ kind: 'time', value: '10:00:00Z' }), 'text');
  // Years outside four digits, likewise.
  assert.strictEqual(controlKind({ kind: 'date', value: '-0045-03-15' }), 'text');
  assert.strictEqual(controlKind({ kind: 'date', value: '12024-01-01' }), 'text');
});

// A number control clears a value it cannot parse. These are all valid
// XSD, and a field the user never touched would come back empty.
test('offers a number control only for numbers it can carry', () => {
  for (const value of ['42', '-42', '3.14', '1.0e6', '1E6', '007', '0.0', '-0', '.5']) {
    assert.strictEqual(controlKind({ kind: 'number', value }), 'number', value);
  }
  for (const value of ['INF', '-INF', 'NaN', '+42']) {
    assert.strictEqual(controlKind({ kind: 'number', value }), 'text', value);
  }
});

// `3.` is a valid xsd:decimal, and a number control clears it. Whether an
// exponent rescues the form varies by browser, so no trailing dot is
// offered one.
test('offers no number control for a mantissa ending in a dot', () => {
  for (const value of ['3.', '-3.', '0.', '1.e3']) {
    assert.strictEqual(controlKind({ kind: 'number', value }), 'text', value);
  }
});

// xsd:boolean has four lexical forms and a checkbox has two states. `1`
// means true; a checkbox would read it as false and silently flip it.
test('offers a checkbox only for true and false', () => {
  assert.strictEqual(controlKind({ kind: 'boolean', value: 'true' }), 'boolean');
  assert.strictEqual(controlKind({ kind: 'boolean', value: 'false' }), 'boolean');
  assert.strictEqual(controlKind({ kind: 'boolean', value: '1' }), 'text');
  assert.strictEqual(controlKind({ kind: 'boolean', value: '0' }), 'text');
});

// Hour 24 is a valid xsd:time and xsd:dateTime — the end of a day — and
// no clock control will hold it.
test('offers no clock control for the twenty-fourth hour', () => {
  assert.strictEqual(controlKind({ kind: 'time', value: '24:00:00' }), 'text');
  assert.strictEqual(controlKind({ kind: 'dateTime', value: '2025-01-01T24:00:00' }), 'text');
  assert.strictEqual(controlKind({ kind: 'time', value: '23:59:59' }), 'time');
  assert.strictEqual(controlKind({ kind: 'dateTime', value: '2025-01-01T23:59:59' }), 'dateTime');
});

// A query can hold a date that names no real day. The editor reports it;
// the form must hand it back rather than swallow it.
test('offers no date control for a month or day out of range', () => {
  for (const value of ['2025-13-01', '2025-00-01', '2025-01-32', '2025-01-00']) {
    assert.strictEqual(controlKind({ kind: 'date', value }), 'text', value);
  }
  assert.strictEqual(controlKind({ kind: 'date', value: '2025-01-01' }), 'date');
});

// xsd:time requires seconds, and a clock control may hand back a round
// time without them.
test('gives a time the seconds its datatype requires', () => {
  assert.strictEqual(literalFor({ quoted: true, suffix: '^^xsd:time', kind: 'time' }, '09:30'),
    '"09:30:00"^^xsd:time');
  assert.strictEqual(literalFor({ quoted: true, suffix: '^^xsd:time', kind: 'time' }, '09:30:15'),
    '"09:30:15"^^xsd:time');
});

// The point of falling back: the value comes out exactly as it went in.
test('a value shown as text is unchanged by a round trip', () => {
  const cases = [
    ['"INF"^^xsd:double', 'INF'],
    ['"NaN"^^xsd:double', 'NaN'],
    ['"1"^^xsd:boolean', '1'],
    ['"2024-11-04Z"^^xsd:date', '2024-11-04Z'],
  ];
  for (const [literal, value] of cases) {
    const text = query(`# ?v: V\nFILTER (?v = ${literal})`);
    const [parameter] = parametersOf(text);
    assert.strictEqual(controlKind(parameter.slots[0]), 'text', literal);
    assert.strictEqual(filled(text, [[value]]), text, literal);
  }
});

test('a value shown as text survives untouched', () => {
  const text = query('# ?d: D\nFILTER (?d = "2024-11-04T10:00:00Z"^^xsd:dateTime)');
  const [parameter] = parametersOf(text);
  assert.strictEqual(controlKind(parameter.slots[0]), 'text');
  // Refilled with what the field would hold, the query is unchanged.
  assert.strictEqual(filled(text, [[parameter.slots[0].value]]), text);
});
