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
// Which of a query's values it offers to have changed (issue #72).
//
// A parameter must be offered only where the query says so: a field over
// the wrong literal edits something the reader did not mean, and
// `FILTER(lang(?country) = "en")` is the standing example.

import { test } from 'node:test';
import assert from 'node:assert';

import { rangeEnds, rangeWording, parameterRanges } from '../src/js/utils/parameterRanges.js';
import { PROLOGUE, query, parametersOf, shapeOf, filled } from './_parameterFixtures.js';

// ── what counts as a parameter ─────────────────────────────────────

test('offers the literal a declared variable is compared to', () => {
  assert.deepStrictEqual(
    shapeOf(query('# ?publicationDate: Published on\nFILTER (?publicationDate = "2024-11-04"^^xsd:date)')),
    [{ label: 'Published on', slots: ['date=2024-11-04'] }]);
});

test('offers nothing when the query declares nothing', () => {
  assert.deepStrictEqual(parametersOf(query('FILTER (?publicationDate = "2024-11-04"^^xsd:date)')), []);
});

// A form field over this literal would be labelled "Country" and hold "en".
// Typing a country into it returns nothing, because it asks for labels in a
// language of that name.
test('does not offer a literal compared to a function of the variable', () => {
  assert.deepStrictEqual(parametersOf(query('# ?country: Country\nFILTER (lang(?country) = "en")')), []);
  assert.deepStrictEqual(parametersOf(query('# ?country: Country\nFILTER (STR(?country) = "en")')), []);
});

// An expression may contain a literal without the variable being compared
// with it. Offering one would put a field over something the query never
// presented as a value.
test('offers nothing where the comparison is with an expression', () => {
  for (const body of [
    'FILTER (?d = IF(?flag, "yes", "no"))',
    'FILTER (?n = 1 + 2)',
    'FILTER (?d = STR("x"))',
    'FILTER (?d = CONCAT("a", "b"))',
    'FILTER (?d = ("x"))',
  ]) {
    assert.deepStrictEqual(parametersOf(query(`# ?d: D\n# ?n: N\n${body}`)), [], body);
  }
});

test('offers nothing for a variable that meets no literal', () => {
  assert.deepStrictEqual(parametersOf(query('# ?notice: Notice\n?notice a <http://example.org/Notice> .')), []);
});

// The annotation is read from the query's comments, so text that merely
// looks like one declares nothing.
test('ignores an annotation inside a string', () => {
  assert.deepStrictEqual(
    parametersOf(query('FILTER (?t = "# ?t: Title") ')),
    []);
});

test('reads several annotations written on consecutive lines', () => {
  const text = `${PROLOGUE}# ?startDate: Start\n# ?endDate: End\n`
    + 'SELECT * WHERE { VALUES (?startDate ?endDate) '
    + '{ ("2024-11-04"^^xsd:date "2024-11-05"^^xsd:date) } ?s ?p ?o }';
  assert.deepStrictEqual(shapeOf(text), [
    { label: 'Start', slots: ['date=2024-11-04'] },
    { label: 'End', slots: ['date=2024-11-05'] },
  ]);
});

test('keeps the first label when a variable is annotated twice', () => {
  assert.deepStrictEqual(
    shapeOf(query('# ?d: First\n# ?d: Second\nFILTER (?d = "2024-11-04"^^xsd:date)')),
    [{ label: 'First', slots: ['date=2024-11-04'] }]);
});

test('reads annotations whatever their spacing', () => {
  for (const line of ['#?d:Day', '#   ?d   :   Day', '# ?d: Day   ']) {
    assert.deepStrictEqual(shapeOf(query(`${line}\nFILTER (?d = "2024-11-04"^^xsd:date)`)),
      [{ label: 'Day', slots: ['date=2024-11-04'] }], line);
  }
});

test('ignores a comment that is not an annotation', () => {
  assert.deepStrictEqual(
    parametersOf(query('# Change the date below to query a different day.\n'
      + 'FILTER (?d = "2024-11-04"^^xsd:date)')),
    []);
});

// ── where the values are found ─────────────────────────────────────

test('finds a value bound in a one-variable VALUES block', () => {
  assert.deepStrictEqual(
    shapeOf(query('# ?d: Day\nVALUES ?d { "2024-11-04"^^xsd:date }')),
    [{ label: 'Day', slots: ['date=2024-11-04'] }]);
});

test('finds values in a multi-variable VALUES block, by position', () => {
  const text = `${PROLOGUE}# ?a: A\n# ?b: B\n`
    + 'SELECT * WHERE { VALUES (?a ?b) { ("first" "second") } ?s ?p ?o }';
  assert.deepStrictEqual(shapeOf(text), [
    { label: 'A', slots: ['text=first'] },
    { label: 'B', slots: ['text=second'] },
  ]);
});

// One variable, two comparisons: the form shows one label and two inputs.
// Which is which comes from the operators, so the query never has to say.
test('reads the ends of a range from the comparison operators', () => {
  assert.deepStrictEqual(
    shapeOf(query('# ?d: Publication date\n'
      + 'FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date)')),
    [{ label: 'Publication date', slots: ['date/lower==2025-01-01', 'date/upper==2025-12-31'] }]);
});

// A comparison reads the same written backwards, and so does its range end:
// a value no larger than the variable is the variable's lower bound.
test('reads a comparison written the other way round', () => {
  assert.deepStrictEqual(
    shapeOf(query('# ?d: Day\nFILTER ("2024-11-04"^^xsd:date = ?d)')),
    [{ label: 'Day', slots: ['date=2024-11-04'] }]);

  assert.deepStrictEqual(
    shapeOf(query('# ?d: D\n'
      + 'FILTER ("2025-01-01"^^xsd:date <= ?d && "2025-12-31"^^xsd:date >= ?d)')),
    [{ label: 'D', slots: ['date/lower==2025-01-01', 'date/upper==2025-12-31'] }]);
});

test('fills a comparison written the other way round', () => {
  assert.match(
    filled(query('# ?d: Day\nFILTER ("2024-11-04"^^xsd:date = ?d)'), [['2026-01-15']]),
    /FILTER \("2026-01-15"\^\^xsd:date = \?d\)/);
});

// Neither operand being a bare variable means there is nothing to offer,
// however many literals the comparison contains.
test('offers nothing when the variable is not an operand at all', () => {
  assert.deepStrictEqual(parametersOf(query('# ?d: D\nFILTER (STR(?d) = "2024-11-04")')), []);
  assert.deepStrictEqual(parametersOf(query('# ?d: D\nFILTER ("2024-11-04" = STR(?d))')), []);
});

// `>=` admits the value itself and `>` does not, which is a day of results.
// The distinction is carried so the form can say which it means.
test('distinguishes an inclusive bound from a strict one', () => {
  const inclusive = parametersOf(query('# ?d: D\n'
    + 'FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date)'))[0];
  assert.deepStrictEqual(inclusive.slots.map(s => [s.bound, s.inclusive]),
    [['lower', true], ['upper', true]]);

  const strict = parametersOf(query('# ?d: D\n'
    + 'FILTER (?d > "2025-01-01"^^xsd:date && ?d < "2025-12-31"^^xsd:date)'))[0];
  assert.deepStrictEqual(strict.slots.map(s => [s.bound, s.inclusive]),
    [['lower', false], ['upper', false]]);
});

test('leaves an equality with no end', () => {
  const [parameter] = parametersOf(query('# ?d: Day\nFILTER (?d = "2024-11-04"^^xsd:date)'));
  assert.strictEqual(parameter.slots[0].bound, null);
});

test('orders slots as they appear in the query', () => {
  const [parameter] = parametersOf(query('# ?d: Day\n'
    + 'FILTER (?d <= "2025-12-31"^^xsd:date && ?d >= "2025-01-01"^^xsd:date)'));
  assert.deepStrictEqual(parameter.slots.map(s => s.value), ['2025-12-31', '2025-01-01']);
  assert.deepStrictEqual(parameter.slots.map(s => s.bound), ['upper', 'lower']);
});

// ── which control each value asks for ──────────────────────────────

test('takes the kind of input from the datatype', () => {
  const kinds = {
    '"2024-11-04"^^xsd:date': 'date',
    '"2024-11-04T10:00:00"^^xsd:dateTime': 'dateTime',
    '"10:00:00"^^xsd:time': 'time',
    '"42"^^xsd:integer': 'number',
    '"1.5"^^xsd:decimal': 'number',
    '"true"^^xsd:boolean': 'boolean',
    '"hello"^^xsd:string': 'text',
    '"hello"': 'text',
    '"hello"@en': 'text',
    '"x"^^<http://example.org/custom>': 'text',
  };
  for (const [literal, kind] of Object.entries(kinds)) {
    const [parameter] = parametersOf(query(`# ?v: V\nFILTER (?v = ${literal})`));
    assert.strictEqual(parameter.slots[0].kind, kind, literal);
  }
});

test('recognises the unquoted forms SPARQL allows', () => {
  for (const [literal, kind] of Object.entries({ '42': 'number', '-1.5': 'number', 'true': 'boolean' })) {
    const [parameter] = parametersOf(query(`# ?v: V\nVALUES ?v { ${literal} }`));
    assert.strictEqual(parameter.slots[0].kind, kind, literal);
    assert.strictEqual(parameter.slots[0].quoted, false, literal);
  }
});

test('resolves escapes in the value it offers', () => {
  const [parameter] = parametersOf(query('# ?d: Day\nFILTER (?d = "2024\\u002D11\\u002D04"^^xsd:date)'));
  assert.strictEqual(parameter.slots[0].value, '2024-11-04');
});

// ── a subquery is a scope of its own ───────────────────────────────

// A subquery's own `?a` must not describe the `?a` outside it: the outer
// query says `>=`, and letting the inner `>` speak would word the range
// as "After …" and then refuse two ends the query itself allows.
test('does not take a bound from a comparison in another scope', () => {
  const text = `${PROLOGUE}# ?a, ?b: Period\n`
    + 'SELECT * WHERE {\n'
    + '  VALUES (?a ?b) { ("2025-01-01"^^xsd:date "2025-12-31"^^xsd:date) }\n'
    + '  { SELECT ?n WHERE { ?s ?p2 ?n . ?s ?p3 ?a . FILTER (?n > ?a) } }\n'
    + '  FILTER (?p >= ?a && ?p <= ?b)\n'
    + '  ?s ?p ?o }';
  const [parameter] = parametersOf(text);
  assert.deepStrictEqual(rangeWording(...rangeEnds(parameter)), { opening: 'Between', joining: 'and' });
  assert.strictEqual(parameterRanges([parameter])[0].strict, false);
});

// A value a subquery keeps to itself is not one of the outer variable's
// values, so it must not be counted when deciding whether that variable
// has a single value to describe. Counting it left the ends of a strict
// range reading as inclusive, and equal ends were then allowed through.
test('does not count a shadowed value when reading a bound', () => {
  const text = `${PROLOGUE}# ?a, ?b: Period\n`
    + 'SELECT * WHERE {\n'
    + '  VALUES (?a ?b) { ("2025-01-01"^^xsd:date "2025-12-31"^^xsd:date) }\n'
    + '  FILTER (?p > ?a && ?p < ?b)\n'
    + '  { SELECT ?n WHERE { ?s ?p2 ?n .\n'
    + '      VALUES (?a ?b) { ("1999-01-01"^^xsd:date "1999-12-31"^^xsd:date) } } }\n'
    + '  ?s ?p ?o }';
  const [parameter] = parametersOf(text);
  assert.deepStrictEqual(parameter.slots.map(slot => slot.value), ['2025-01-01', '2025-12-31']);
  assert.deepStrictEqual(rangeWording(...rangeEnds(parameter)),
    { opening: 'After', joining: 'and before' });
  assert.strictEqual(parameterRanges([parameter])[0].strict, true);
});

// A variable holding several values is not one end of anything, so no
// comparison against it describes an end either.
test('reads no bound for a variable with more than one value', () => {
  const [parameter] = parametersOf(query('# ?a: A\n'
    + 'VALUES ?a { "2025-01-01"^^xsd:date "2025-06-01"^^xsd:date } FILTER (?p > ?a)'));
  assert.deepStrictEqual(parameter.slots.map(slot => slot.bound), [null, null]);
});

// One end shadowed is enough to have got the wording wrong.
test('does not count a shadowed value at one end only', () => {
  const text = `${PROLOGUE}# ?a, ?b: Period\n`
    + 'SELECT * WHERE {\n'
    + '  VALUES (?a ?b) { ("2025-01-01"^^xsd:date "2025-12-31"^^xsd:date) }\n'
    + '  FILTER (?p > ?a && ?p < ?b)\n'
    + '  { SELECT ?n WHERE { ?s ?p2 ?n . VALUES ?a { "1999-01-01"^^xsd:date } } }\n'
    + '  ?s ?p ?o }';
  const [parameter] = parametersOf(text);
  assert.deepStrictEqual(rangeWording(...rangeEnds(parameter)),
    { opening: 'After', joining: 'and before' });
});

// Two comparisons can name the same end. The first the query makes is the
// one kept, so the reading does not depend on which is met last.
test('keeps the first comparison that names an end', () => {
  const text = `${PROLOGUE}# ?a, ?b: Period\n`
    + 'SELECT * WHERE {\n'
    + '  VALUES (?a ?b) { ("2025-01-01"^^xsd:date "2025-12-31"^^xsd:date) }\n'
    + '  FILTER (?p >= ?a && ?q > ?a && ?p <= ?b)\n'
    + '  ?s ?p ?o }';
  const [parameter] = parametersOf(text);
  assert.deepStrictEqual(rangeWording(...rangeEnds(parameter)), { opening: 'Between', joining: 'and' });
});


// `?d` inside a subquery that does not project it is a different variable.
// Offering it under the outer name would put the reader's value somewhere
// they were never shown.
test('ignores a variable a subquery keeps to itself', () => {
  const [parameter] = parametersOf(query('# ?d: D\n'
    + 'FILTER (?d = "2025-01-01"^^xsd:date)'
    + ' { SELECT ?s WHERE { ?s ?p ?o FILTER (?d = "1999-01-01"^^xsd:date) } }'));
  assert.deepStrictEqual(parameter.slots.map(slot => slot.value), ['2025-01-01']);
});

test('takes a variable a subquery projects', () => {
  for (const clause of ['SELECT ?d', 'SELECT *', 'SELECT DISTINCT ?d']) {
    const [parameter] = parametersOf(query('# ?d: D\n'
      + `{ ${clause} WHERE { ?s ?p ?d FILTER (?d = "1999-01-01"^^xsd:date) } }`));
    assert.deepStrictEqual(parameter.slots.map(slot => slot.value), ['1999-01-01'], clause);
  }
});

// `(MAX(?d) AS ?m)` names ?d inside the clause, which changes nothing:
// the outer ?d is still the one the annotation means.
test('does not count a variable named only inside a projection', () => {
  const [parameter] = parametersOf(query('# ?d: D\n'
    + 'FILTER (?d = "2025-01-01"^^xsd:date)'
    + ' { SELECT (MAX(?d) AS ?m) WHERE { ?s ?p ?d FILTER (?d = "1999-01-01"^^xsd:date) } }'));
  assert.deepStrictEqual(parameter.slots.map(slot => slot.value), ['2025-01-01']);
});

// A name used in one place means what the query says there, however
// deeply it is nested. Several queries in the library declare a variable
// that only ever appears inside a subquery.
test('takes a variable that lives only inside a subquery', () => {
  const [parameter] = parametersOf(query('# ?d: D\n'
    + '{ SELECT ?n WHERE { ?s ?p ?d FILTER (?d = "1999-01-01"^^xsd:date) } }'));
  assert.deepStrictEqual(parameter.slots.map(slot => slot.value), ['1999-01-01']);
});

// A subquery is a boundary whatever it projects. Reading the projection
// would mean reading `SELECT *` against `COUNT(*)`, aliases, aggregates
// and comments; drawing the line at the subquery needs none of that, and
// errs towards offering the outer values alone.
test('treats a subquery as a boundary whatever it projects', () => {
  for (const clause of [
    'SELECT ?d', 'SELECT *', 'SELECT DISTINCT *', 'SELECT REDUCED *',
    'SELECT (COUNT(*) AS ?n)', 'SELECT (?x * ?y AS ?n)', 'SELECT ?s',
    'SELECT # project everything\n    *',
  ]) {
    const [parameter] = parametersOf(query('# ?d: D\n'
      + 'FILTER (?d = "2025-01-01"^^xsd:date)'
      + ` { ${clause} WHERE { ?s ?p ?d FILTER (?d = "1999-01-01"^^xsd:date) } }`));
    assert.deepStrictEqual(parameter.slots.map(slot => slot.value), ['2025-01-01'], clause);
  }
});

// Two subqueries with a `?d` apiece are two variables, and neither has a
// better claim to the name than the other.
test('offers nothing when two scopes tie for the name', () => {
  assert.deepStrictEqual(
    shapeOf(query('# ?d: D\n'
      + '{ SELECT ?n WHERE { ?s ?p ?d FILTER (?d = "1999-01-01"^^xsd:date) } }'
      + '{ SELECT ?m WHERE { ?s ?p ?d FILTER (?d = "2000-01-01"^^xsd:date) } }')),
    []);
});

test('ignores a VALUES a subquery keeps to itself', () => {
  const [parameter] = parametersOf(query('# ?d: D\n'
    + 'VALUES ?d { "2025-01-01"^^xsd:date }'
    + ' { SELECT ?s WHERE { ?s ?p ?o VALUES ?d { "1999-01-01"^^xsd:date } } }'));
  assert.deepStrictEqual(parameter.slots.map(slot => slot.value), ['2025-01-01']);
});

// One name written twice is a slip, not a range from a variable to itself.
test('ignores a line naming the same variable twice', () => {
  assert.deepStrictEqual(shapeOf(query('# ?d, ?d: D\nFILTER (?d = "2025-01-01"^^xsd:date)')), []);
});

test('reads a declaration with no comma as one parameter', () => {
  const [parameter] = parametersOf(query('# ?d: D\nFILTER (?d = "2025-01-01"^^xsd:date)'));
  assert.deepStrictEqual(parameter.variables, ['d']);
});

// ── queries that are still being typed ─────────────────────────────

test('survives a query that does not parse', () => {
  for (const text of [
    '# ?d: D\nSELECT * WHERE { FILTER (?d = "2024-11-04',
    '# ?d: D\nSELECT * WHERE {',
    '# ?d: D\n',
    '',
  ]) {
    assert.doesNotThrow(() => parametersOf(text), JSON.stringify(text));
  }
});

// ── a query as it actually appears in the library ──────────────────

test('reads a library query annotated with one line', () => {
  const text = `# Retrieve the broad place of performance of procedures published on a specific date.
# Change the date below to query a different day.
# ?publicationDate: Published on

PREFIX epo: <http://data.europa.eu/a4g/ontology#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT DISTINCT ?publicationDate ?broadPlaceOfPerformance ?country
WHERE {
  FILTER (?publicationDate = "2024-11-04"^^xsd:date)
  GRAPH ?g {
    ?notice a epo:Notice ;
            epo:hasPublicationDate ?publicationDate .
  }
  ?uri skos:prefLabel ?broadPlaceOfPerformance .
  FILTER(lang(?broadPlaceOfPerformance) = "en")
  OPTIONAL {
    ?location epo:hasCountryCode / skos:prefLabel ?country .
    FILTER(lang(?country) = "en")
  }
}`;
  // One field, despite three literals compared to variables in the query.
  assert.deepStrictEqual(shapeOf(text), [{ label: 'Published on', slots: ['date=2024-11-04'] }]);
  assert.match(filled(text, [['2026-01-15']]), /FILTER \(\?publicationDate = "2026-01-15"\^\^xsd:date\)/);
});
