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
// Catching xsd:date literals that name a day that does not exist (issue #108).
//
// Reporting a date that is not there costs more than missing one, because
// the report disables the Run Query button: a false positive makes a good
// query un-runnable, while a miss only leaves things as they were. So the
// cases below lean towards text that resembles a date literal without being
// one.
//
// The queries are parsed by the same SPARQL grammar the editor uses, so
// what these tests exercise is what the editor sees.

import { test } from 'node:test';
import assert from 'node:assert';

import { EditorState } from '@codemirror/state';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { sparql } from 'codemirror-lang-sparql';

import { invalidMomentLiterals } from '../src/js/utils/validDate.js';

/**
 * The offending literals in a query, as the editor would find them.
 *
 * The parse is driven to the end of the document, as QueryEditor does:
 * left to itself the editor parses only as far as it needs to, and stops
 * a few thousand characters in.
 */
function findIn(query) {
  const state = EditorState.create({ doc: query, extensions: [sparql()] });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000) || syntaxTree(state);
  return invalidMomentLiterals(tree, state.doc);
}

/** Just the values, for the many cases that are only about which. */
const invalidIn = (query) => findIn(query).map(found => found.value);

/** A query body, with the prologue these tests would otherwise all repeat. */
const query = (body) =>
  `PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\nSELECT * WHERE { ${body} }`;

/** Whether a value passes as an xsd:date, asked as the editor asks it. */
const accepts = (value) =>
  invalidIn(query(`BIND("${value}"^^xsd:date AS ?a)`)).length === 0;

// ── the calendar ───────────────────────────────────────────────────

test('accepts real calendar dates', () => {
  assert.equal(accepts('2024-11-05'), true);
  assert.equal(accepts('2024-02-29'), true); // 2024 is a leap year
  assert.equal(accepts('2025-12-31'), true);
  assert.equal(accepts('2024-01-01'), true);
});

test('rejects impossible months and days', () => {
  assert.equal(accepts('2024-13-01'), false);
  assert.equal(accepts('2024-00-10'), false);
  assert.equal(accepts('2024-02-30'), false);
  assert.equal(accepts('2025-02-29'), false); // 2025 is not a leap year
  assert.equal(accepts('2024-04-31'), false); // April has 30 days
  assert.equal(accepts('2024-11-00'), false);
});

test('rejects malformed shapes', () => {
  assert.equal(accepts('2024-115-15'), false);
  assert.equal(accepts('2024-1-5'), false);
  assert.equal(accepts('2024/11/05'), false);
  assert.equal(accepts('not-a-date'), false);
  assert.equal(accepts(''), false);
});

// Date.UTC reads a year of 0-99 as 1900-1999, which is why the arithmetic
// here is its own.
test('judges early years by the year written', () => {
  assert.equal(accepts('0001-01-01'), true);
  assert.equal(accepts('0099-12-31'), true);
  assert.equal(accepts('0004-02-29'), true);  // year 4 is a leap year
  assert.equal(accepts('0001-02-29'), false); // year 1 is not
});

test('applies the century rule to February', () => {
  assert.equal(accepts('2000-02-29'), true);  // divisible by 400
  assert.equal(accepts('1900-02-29'), false); // divisible by 100 only
  assert.equal(accepts('2100-02-29'), false);
});

// ── finding the literals in a query ────────────────────────────────

test('finds the invalid date in the query the issue reports', () => {
  const text = query(`VALUES (?start ?end) { ("2024-15-04"^^xsd:date "2024-11-05"^^xsd:date) }`);
  const found = findIn(text);
  assert.equal(found.length, 1);
  assert.equal(found[0].value, '2024-15-04');
  assert.equal(text.slice(found[0].from, found[0].to), '"2024-15-04"^^xsd:date');
});

test('says nothing about a query whose dates are all real', () => {
  assert.deepEqual(
    invalidIn(query(`VALUES (?a ?b) { ("2024-11-04"^^xsd:date "2024-11-05"^^xsd:date) }`)), []);
});

test('reports every invalid literal, not just the first', () => {
  assert.deepEqual(
    invalidIn(query(`VALUES ?d { "2024-13-01"^^xsd:date "2024-11-05"^^xsd:date "2025-02-29"^^xsd:date }`)),
    ['2024-13-01', '2025-02-29']);
});

// The ranges are what the editor draws its markers from, so they have to
// cover the literal they are about and nothing else.
test('the reported range covers the literal and its datatype', () => {
  const text = query(`VALUES ?d { "2024-13-01"^^xsd:date "2024-02-30"^^xsd:date }`);
  for (const found of findIn(text)) {
    assert.equal(text.slice(found.from, found.to), `"${found.value}"^^xsd:date`);
  }
});

test('accepts every quoting SPARQL allows', () => {
  assert.deepEqual(invalidIn(query(`BIND('2024-13-01'^^xsd:date AS ?a)`)), ['2024-13-01']);
  assert.deepEqual(invalidIn(query(`BIND("""2024-13-01"""^^xsd:date AS ?a)`)), ['2024-13-01']);
  assert.deepEqual(invalidIn(query(`BIND('''2024-13-01'''^^xsd:date AS ?a)`)), ['2024-13-01']);
});

test('reports a value that is not even shaped like a date', () => {
  assert.deepEqual(invalidIn(query(`BIND("2024-115-15"^^xsd:date AS ?a)`)), ['2024-115-15']);
  assert.deepEqual(invalidIn(query(`BIND("tomorrow"^^xsd:date AS ?a)`)), ['tomorrow']);
  assert.deepEqual(invalidIn(query(`BIND(""^^xsd:date AS ?a)`)), ['']);
});

// ── text that only looks like a date literal ───────────────────────

// A comment is not part of the query. Reporting one would disable Run Query
// over text the endpoint never sees.
test('ignores a date inside a comment', () => {
  assert.deepEqual(
    invalidIn(`# "2024-13-01"^^xsd:date\n${query(`BIND(1 AS ?a)`)}`), []);
  assert.deepEqual(
    invalidIn(query(`BIND(1 AS ?a) # try "2024-13-01"^^xsd:date`)), []);
});

test('ignores a date inside a string', () => {
  assert.deepEqual(
    invalidIn(query(`BIND("a \\"2024-13-01\\"^^xsd:date b" AS ?a)`)), []);
});

test('leaves alone a date-shaped value that is not typed as a date', () => {
  assert.deepEqual(invalidIn(query(`BIND("2024-13-01" AS ?a)`)), []);
  assert.deepEqual(invalidIn(query(`BIND("2024-13-01"^^xsd:string AS ?a)`)), []);
  assert.deepEqual(invalidIn(query(`BIND("2024-13-01"@en AS ?a)`)), []);
});

// xsd:dateTime starts with xsd:date. It is a different datatype, and its
// values are not checked here.
test('holds each datatype to its own shape', () => {
  // A moment written under the wrong datatype is not that datatype's value,
  // however well formed it is under another.
  assert.deepStrictEqual(
    invalidIn(query(`BIND("2024-11-27T10:00:00"^^xsd:date AS ?a)`)), ['2024-11-27T10:00:00']);
  assert.deepStrictEqual(
    invalidIn(query(`BIND("2024-11-27"^^xsd:dateTime AS ?a)`)), ['2024-11-27']);
  assert.deepStrictEqual(
    invalidIn(query(`BIND("2024-11-27"^^xsd:time AS ?a)`)), ['2024-11-27']);
  // Nothing else is judged at all.
  assert.deepStrictEqual(invalidIn(query(`BIND("2024-13-01"^^xsd:gMonthDay AS ?a)`)), []);
  assert.deepStrictEqual(invalidIn(query(`BIND("2024-13-01" AS ?a)`)), []);
});

test('rejects year zero, written either way', () => {
  // XSD 1.0 had no year zero; XSD 1.1 added one. Nothing was procured in it
  // under either reading, and `-0000` is a year in neither.
  for (const value of ['0000-01-01', '-0000-01-01']) {
    assert.ok(!accepts(value), `${value} is not a date`);
    assert.ok(!acceptsDateTime(`${value}T10:00:00`), `${value} is not a dateTime either`);
  }
  // The years either side of it stand.
  assert.ok(accepts('0001-01-01'), '0001 is a year');
  assert.ok(accepts('-0001-01-01'), 'so is the one before it');
});

// ── the clock ──────────────────────────────────────────────────────

/** Whether a value passes as an xsd:time, asked as the editor asks it. */
const acceptsTime = (value) =>
  invalidIn(query(`BIND("${value}"^^xsd:time AS ?a)`)).length === 0;

test('accepts times of day', () => {
  for (const value of ['00:00:00', '23:59:59', '12:30:45', '09:05:01']) {
    assert.ok(acceptsTime(value), `${value} is a time`);
  }
});

test('accepts the moment a day ends, and only as that moment', () => {
  // 24:00:00 is the close of a day rather than a 25th hour, so nothing
  // stands past it.
  assert.ok(acceptsTime('24:00:00'), '24:00:00 ends the day');
  assert.ok(acceptsTime('24:00:00.0'), 'a zero fraction is still that moment');
  for (const value of ['24:00:01', '24:01:00', '24:30:00', '24:00:00.5']) {
    assert.ok(!acceptsTime(value), `${value} is past the end of the day`);
  }
});

test('rejects hours, minutes and seconds that do not exist', () => {
  // 60 seconds included: XSD has no leap second, whatever the almanac says.
  for (const value of ['25:00:00', '99:00:00', '10:60:00', '10:00:60']) {
    assert.ok(!acceptsTime(value), `${value} is not a time`);
  }
});

test('rejects a time that is not written as one', () => {
  for (const value of ['1:00:00', '10:00', '10:00:00:00', '', 'noon', '10-00-00']) {
    assert.ok(!acceptsTime(value), `${value} is not a time`);
  }
});

test('accepts a fraction of a second', () => {
  for (const value of ['10:00:00.5', '10:00:00.000', '10:00:00.123456789']) {
    assert.ok(acceptsTime(value), `${value} is a time`);
  }
  assert.ok(!acceptsTime('10:00:00.'), 'a fraction needs a digit');
});

test('reads the timezone on a time by the same rule as on a date', () => {
  for (const value of ['10:00:00Z', '10:00:00+02:00', '10:00:00-05:30', '10:00:00+14:00']) {
    assert.ok(acceptsTime(value), `${value} is a time`);
  }
  for (const value of ['10:00:00+15:00', '10:00:00+14:30', '10:00:00+2:00', '10:00:00Q']) {
    assert.ok(!acceptsTime(value), `${value} has no such offset`);
  }
});

// ── the two together ───────────────────────────────────────────────

/** Whether a value passes as an xsd:dateTime, asked as the editor asks it. */
const acceptsDateTime = (value) =>
  invalidIn(query(`BIND("${value}"^^xsd:dateTime AS ?a)`)).length === 0;

test('accepts a day and a time of day with a T between them', () => {
  for (const value of [
    '2024-11-27T10:00:00',
    '2024-11-27T00:00:00Z',
    '2024-11-27T10:00:00.123+02:00',
    '-0044-03-15T12:00:00',
    '20024-11-27T10:00:00',
  ]) {
    assert.ok(acceptsDateTime(value), `${value} is a dateTime`);
  }
});

test('judges each half of a dateTime as it would on its own', () => {
  assert.ok(acceptsDateTime('2024-02-29T10:00:00'), '2024 has a 29 February');
  assert.ok(!acceptsDateTime('2023-02-29T10:00:00'), '2023 does not');
  assert.ok(!acceptsDateTime('2024-13-01T00:00:00'), 'there is no 13th month');
  assert.ok(!acceptsDateTime('2024-11-27T25:00:00'), 'there is no 25th hour');
});

test('accepts the end of a day, on the day it ends', () => {
  // The day is read as written: this names the close of a leap day, and
  // there is no such day to close in the year before it.
  assert.ok(acceptsDateTime('2024-02-29T24:00:00'), '29 February 2024 ends');
  assert.ok(!acceptsDateTime('2023-02-29T24:00:00'), '29 February 2023 never came');
});

test('rejects a dateTime missing either half or the T', () => {
  for (const value of [
    '2024-11-27',
    '10:00:00',
    '2024-11-27 10:00:00',
    '2024-11-27T',
    'T10:00:00',
    '2024-11-27t10:00:00',
  ]) {
    assert.ok(!acceptsDateTime(value), `${value} is not a dateTime`);
  }
});

test('reads the offset on a dateTime as belonging to the whole value', () => {
  assert.ok(acceptsDateTime('2024-11-27T10:00:00-05:00'), 'an offset behind UTC');
  assert.ok(!acceptsDateTime('2024-11-27T10:00:00+15:00'), 'no offset reaches 15 hours');
  // The `-` inside the date is not the start of one.
  assert.ok(acceptsDateTime('2024-11-27T10:00:00'), 'no offset at all');
});

// ── the datatype, however the query writes it ──────────────────────

test('recognises the datatype written as a full IRI', () => {
  assert.deepEqual(
    invalidIn(`SELECT * WHERE { BIND("2024-13-01"^^<http://www.w3.org/2001/XMLSchema#date> AS ?a) }`),
    ['2024-13-01']);
});

test('is not fooled by an IRI that merely ends in date', () => {
  assert.deepEqual(
    invalidIn(`SELECT * WHERE { BIND("2024-13-01"^^<http://example.org/date> AS ?a) }`), []);
});

test('recognises whatever prefix the query binds to the XSD namespace', () => {
  assert.deepEqual(
    invalidIn(`PREFIX xs: <http://www.w3.org/2001/XMLSchema#>\nSELECT * WHERE { BIND("2024-13-01"^^xs:date AS ?a) }`),
    ['2024-13-01']);
});

// SPARQL prefixes are not limited to ASCII.
test('recognises a non-ASCII prefix', () => {
  assert.deepEqual(
    invalidIn(`PREFIX χ: <http://www.w3.org/2001/XMLSchema#>\nSELECT * WHERE { BIND("2024-13-01"^^χ:date AS ?a) }`),
    ['2024-13-01']);
});

test('handles the empty prefix', () => {
  assert.deepEqual(
    invalidIn(`PREFIX : <http://www.w3.org/2001/XMLSchema#>\nSELECT * WHERE { BIND("2024-13-01"^^:date AS ?a) }`),
    ['2024-13-01']);
});

// `xsd` is only the XML Schema namespace by convention. A query binding it
// elsewhere has said what it means, and its xsd:date is a different
// datatype whose values are none of our business.
test('honours a query that binds xsd to another namespace', () => {
  assert.deepEqual(
    invalidIn(`PREFIX xsd: <http://example.org/>\nSELECT * WHERE { BIND("2024-13-01"^^xsd:date AS ?a) }`),
    []);
});

test('does not treat an unrelated prefix as the XSD one', () => {
  assert.deepEqual(
    invalidIn(`PREFIX my: <http://example.org/>\nSELECT * WHERE { BIND("2024-13-01"^^my:date AS ?a) }`),
    []);
});

// A prefix declared twice is bound by the second declaration — which is
// what the endpoint will do, so it is what decides whether the query is
// asking about a date at all.
test('a repeated PREFIX takes its last binding', () => {
  assert.deepEqual(
    invalidIn(`PREFIX p: <http://example.org/>
PREFIX p: <http://www.w3.org/2001/XMLSchema#>
SELECT * WHERE { BIND("2024-13-01"^^p:date AS ?a) }`),
    ['2024-13-01']);

  assert.deepEqual(
    invalidIn(`PREFIX p: <http://www.w3.org/2001/XMLSchema#>
PREFIX p: <http://example.org/>
SELECT * WHERE { BIND("2024-13-01"^^p:date AS ?a) }`),
    []);
});

test('a repeated BASE takes its last declaration', () => {
  assert.deepEqual(
    invalidIn(`BASE <http://example.org/>
BASE <http://www.w3.org/2001/XMLSchema>
SELECT * WHERE { BIND("2024-13-01"^^<#date> AS ?a) }`),
    ['2024-13-01']);
});

// A prefix is resolved against the BASE standing where it is declared.
test('a prefix resolves against the BASE above it', () => {
  assert.deepEqual(
    invalidIn(`BASE <http://www.w3.org/2001/>
PREFIX p: <XMLSchema#>
SELECT * WHERE { BIND("2024-13-01"^^p:date AS ?a) }`),
    ['2024-13-01']);
});

// A relative datatype IRI resolves against the query's BASE.
test('resolves a datatype IRI against BASE', () => {
  assert.deepEqual(
    invalidIn(`BASE <http://www.w3.org/2001/XMLSchema>\nSELECT * WHERE { BIND("2024-13-01"^^<#date> AS ?a) }`),
    ['2024-13-01']);
});

test('does not report a relative datatype that BASE resolves elsewhere', () => {
  assert.deepEqual(
    invalidIn(`BASE <http://example.org/>\nSELECT * WHERE { BIND("2024-13-01"^^<date> AS ?a) }`),
    []);
});

// ── escapes ────────────────────────────────────────────────────────

// What a literal holds is what its escapes mean, not how they are written.
test('resolves escapes before judging the date', () => {
  // - is a hyphen: this is 2024-11-05, a real date.
  assert.deepEqual(invalidIn(query(`BIND("2024\\u002D11\\u002D05"^^xsd:date AS ?a)`)), []);
  // and this is 2024-13-01, which is not.
  assert.deepEqual(invalidIn(query(`BIND("2024\\u002D13\\u002D01"^^xsd:date AS ?a)`)), ['2024-13-01']);
});

test('reports the date the query means, not the text it wrote', () => {
  const found = findIn(query(`BIND("2024\\u002D13\\u002D01"^^xsd:date AS ?a)`));
  assert.equal(found[0].value, '2024-13-01');
});

test('an escaped backslash is a backslash, not the start of an escape', () => {
  assert.deepEqual(
    invalidIn(query(`BIND("2024\\\\u002D11\\u002D05"^^xsd:date AS ?a)`)),
    ['2024\\u002D11-05']);
});

// String.fromCodePoint throws above the last code point. An escape naming
// no character is left as written, which is not a date either way.
test('survives an escape outside the Unicode range', () => {
  assert.doesNotThrow(() => findIn(query(`BIND("2024\\U00110000-01"^^xsd:date AS ?a)`)));
  assert.equal(invalidIn(query(`BIND("2024\\U00110000-01"^^xsd:date AS ?a)`)).length, 1);
});

test('survives an escape naming half a surrogate pair', () => {
  assert.doesNotThrow(() => findIn(query(`BIND("2024\\uD800-01"^^xsd:date AS ?a)`)));
});

// ── the years XSD allows that a date picker never produces ──────────

test('accepts an expanded year', () => {
  assert.deepEqual(invalidIn(query(`BIND("12024-01-01"^^xsd:date AS ?a)`)), []);
  assert.deepEqual(invalidIn(query(`BIND("12024-02-30"^^xsd:date AS ?a)`)), ['12024-02-30']);
});

test('accepts a negative year', () => {
  assert.deepEqual(invalidIn(query(`BIND("-0045-03-15"^^xsd:date AS ?a)`)), []);
  assert.deepEqual(invalidIn(query(`BIND("-0045-02-30"^^xsd:date AS ?a)`)), ['-0045-02-30']);
});

test('rejects a year padded past four digits', () => {
  assert.deepEqual(invalidIn(query(`BIND("012024-01-01"^^xsd:date AS ?a)`)), ['012024-01-01']);
});

test('rejects a year of fewer than four digits', () => {
  assert.deepEqual(invalidIn(query(`BIND("024-01-01"^^xsd:date AS ?a)`)), ['024-01-01']);
});

// XSD puts no limit on the length of a year, and past 2^53 a Number stops
// telling one year from the next. The arithmetic is done on BigInt, so the
// answer is exact however long the year is.
test('judges a year too large for a Number', () => {
  // 9007199254740993 is odd, so it is not a leap year and has no 29 February.
  assert.deepEqual(
    invalidIn(query(`BIND("9007199254740993-02-29"^^xsd:date AS ?a)`)),
    ['9007199254740993-02-29']);
  assert.deepEqual(invalidIn(query(`BIND("9007199254740996-02-29"^^xsd:date AS ?a)`)), []);
});

// The bail-out this replaced accepted anything with a long enough year,
// including months and days that cannot exist under any calendar.
test('rejects an impossible month or day whatever the year', () => {
  assert.deepEqual(
    invalidIn(query(`BIND("9007199254740993-13-99"^^xsd:date AS ?a)`)),
    ['9007199254740993-13-99']);
});

// ── timezones ──────────────────────────────────────────────────────

// XSD allows a date to carry a timezone. The date in front of it still has
// to exist.
test('checks the date in a literal that carries a timezone', () => {
  assert.deepEqual(invalidIn(query(`BIND("2024-13-01Z"^^xsd:date AS ?a)`)), ['2024-13-01Z']);
  assert.deepEqual(invalidIn(query(`BIND("2024-02-30+02:00"^^xsd:date AS ?a)`)), ['2024-02-30+02:00']);
});

test('accepts a real date with a timezone', () => {
  assert.deepEqual(invalidIn(query(`BIND("2024-11-05Z"^^xsd:date AS ?a)`)), []);
  assert.deepEqual(invalidIn(query(`BIND("2024-11-05+02:00"^^xsd:date AS ?a)`)), []);
  assert.deepEqual(invalidIn(query(`BIND("2024-11-05-05:00"^^xsd:date AS ?a)`)), []);
});

test('rejects a timezone outside the range XSD allows', () => {
  assert.deepEqual(invalidIn(query(`BIND("2024-11-05+15:00"^^xsd:date AS ?a)`)), ['2024-11-05+15:00']);
  assert.deepEqual(invalidIn(query(`BIND("2024-11-05+14:30"^^xsd:date AS ?a)`)), ['2024-11-05+14:30']);
  assert.deepEqual(invalidIn(query(`BIND("2024-11-05+14:00"^^xsd:date AS ?a)`)), []);
});

// ── queries that are still being typed ─────────────────────────────

// The tree is built from whatever is in the editor, including text that
// does not parse. Nothing here may throw, whatever state it is caught in.
test('survives a query that does not parse', () => {
  const halfWritten = [
    'SELECT * WHERE { ?s ?p "2024-13-01',
    'SELECT * WHERE { BIND("2024-13-01"^^',
    'SELECT * WHERE { BIND("2024-13-01"^^xsd:',
    'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#',
    'SELECT * WHERE { ?s <http://example.org "2024-13-01"^^xsd:date',
    '{{{',
    '',
  ];
  for (const text of halfWritten) {
    assert.doesNotThrow(() => findIn(text), text);
  }
});

// A prefix is not bound until its declaration is typed. Reading `xsd` by
// convention keeps the marker steady while the prologue is being written.
test('reads an as-yet undeclared xsd by convention', () => {
  assert.deepEqual(
    invalidIn(`SELECT * WHERE { BIND("2024-13-01"^^xsd:date AS ?a) }`), ['2024-13-01']);
});

// ── a query longer than the parser reads on its own ────────────────

// The editor parses lazily. Left alone it stops a few thousand characters
// in, so a date past that point is in a part of the query the tree does
// not describe. Every caller has to drive the parse to the end.
test('finds a date past the point lazy parsing stops at', () => {
  const filler = Array.from(
    { length: 250 },
    (_, i) => `  ?s${i} <http://example.org/p${i}> ?o${i} .`,
  ).join('\n');
  const text = `PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT * WHERE {
${filler}
  FILTER (?d = "2024-13-01"^^xsd:date)
}`;

  // The premise: this document really is longer than the parser reads.
  const state = EditorState.create({ doc: text, extensions: [sparql()] });
  assert.ok(
    syntaxTree(state).length < state.doc.length,
    'expected a document long enough that lazy parsing stops short of the end',
  );

  assert.deepEqual(invalidIn(text), ['2024-13-01']);
});

// ── a query as it actually appears in the library ──────────────────

test('says nothing about a well-formed query from the library', () => {
  const text = `# Retrieve notices published on a specific date.
PREFIX epo: <http://data.europa.eu/a4g/ontology#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT ?publicationDate ?publicationNumber
WHERE {
  # the day of interest
  FILTER (?publicationDate = "2024-11-06"^^xsd:date)
  GRAPH ?g {
    ?notice a epo:Notice ;
            epo:hasPublicationDate ?publicationDate ;
            epo:hasNoticePublicationNumber ?publicationNumber .
  }
}`;
  assert.deepEqual(invalidIn(text), []);
});

test('catches a mistyped date in that same query', () => {
  const text = `PREFIX epo: <http://data.europa.eu/a4g/ontology#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?publicationDate WHERE {
  FILTER (?publicationDate = "2024--11-06"^^xsd:date)
  GRAPH ?g { ?notice epo:hasPublicationDate ?publicationDate . }
}`;
  assert.deepEqual(invalidIn(text), ['2024--11-06']);
});
