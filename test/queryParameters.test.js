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
// Offering a query's values as a form (issue #72).
//
// Two things have to hold. A parameter must be offered only where the query
// says so, because a field over the wrong literal edits something the user
// did not mean — `FILTER(lang(?country) = "en")` is the standing example.
// And a filled query must still be a query, whatever is typed into the form.
//
// The queries below are parsed by the same SPARQL grammar the editor uses,
// so what these tests exercise is what the application sees.

import { test } from 'node:test';
import assert from 'node:assert';

import { EditorState } from '@codemirror/state';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { sparql } from 'codemirror-lang-sparql';
import SparqlJs from 'sparqljs';

import {
  queryParameters, fillQuery, literalFor, valueProblem, controlKind, rangeEnds, rangeWording,
  compareValues, parameterRanges,
} from '../src/js/utils/queryParameters.js';

const PROLOGUE = 'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\n';

/** A query with the prologue these tests would otherwise all repeat. */
const query = (body) => `${PROLOGUE}SELECT * WHERE { ${body} ?s ?p ?o }`;

/** The parameters of a query, as the application reads them. */
function parametersOf(text) {
  const state = EditorState.create({ doc: text, extensions: [sparql()] });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000) || syntaxTree(state);
  return queryParameters(tree, state.doc);
}

/** Label, kind and value of every slot, for the many cases about shape alone. */
const shapeOf = (text) => parametersOf(text).map(parameter => ({
  label: parameter.label,
  slots: parameter.slots.map(slot => `${slot.kind}${slot.bound ? `/${slot.bound}${slot.inclusive ? '=' : ''}` : ''}=${slot.value}`),
}));

/** A query filled from a list of values per parameter, in slot order. */
function filled(text, valuesPerParameter) {
  const parameters = parametersOf(text);
  const values = new Map();
  parameters.forEach((parameter, i) => parameter.slots.forEach((slot, j) => {
    const value = valuesPerParameter[i]?.[j];
    if (value !== undefined) values.set(slot, value);
  }));
  return fillQuery(text, parameters, values);
}

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

// ── reading a range as a sentence ──────────────────────────────────

/** The wording a query's own comparisons produce. */
const wordingFor = (body) => {
  const [parameter] = parametersOf(query(`# ?d: Publication date\n${body}`));
  const ends = rangeEnds(parameter);
  const { opening, joining } = rangeWording(...ends);
  return `${opening} X ${joining} Y`;
};

// Each end is inclusive or not, and English says which: "between the 1st
// and the 31st" takes both days in, "after the 1st" leaves it out. The
// query already knows; the sentence just has to repeat it faithfully.
test('says the range the way the comparisons mean it', () => {
  assert.strictEqual(wordingFor('FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-01-31"^^xsd:date)'),
    'Between X and Y');
  assert.strictEqual(wordingFor('FILTER (?d >= "2025-01-01"^^xsd:date && ?d < "2025-01-31"^^xsd:date)'),
    'Since X and before Y');
  assert.strictEqual(wordingFor('FILTER (?d > "2025-01-01"^^xsd:date && ?d <= "2025-01-31"^^xsd:date)'),
    'After X until Y');
  assert.strictEqual(wordingFor('FILTER (?d > "2025-01-01"^^xsd:date && ?d < "2025-01-31"^^xsd:date)'),
    'After X and before Y');
});

test('reads a range the same when the comparisons are written backwards', () => {
  assert.strictEqual(wordingFor('FILTER ("2025-01-01"^^xsd:date <= ?d && "2025-01-31"^^xsd:date >= ?d)'),
    'Between X and Y');
  assert.strictEqual(wordingFor('FILTER ("2025-01-01"^^xsd:date < ?d && "2025-01-31"^^xsd:date > ?d)'),
    'After X and before Y');
});

// The lower end comes first in the sentence however the query orders it.
test('puts the lower end first', () => {
  const [parameter] = parametersOf(query('# ?d: D\n'
    + 'FILTER (?d <= "2025-01-31"^^xsd:date && ?d >= "2025-01-01"^^xsd:date)'));
  const [from, to] = rangeEnds(parameter);
  assert.strictEqual(from.value, '2025-01-01');
  assert.strictEqual(to.value, '2025-01-31');
});

// Two values that are not the ends of a range have no sentence to make.
test('is not a range when the comparisons are not a pair', () => {
  const [equalities] = parametersOf(query('# ?d: D\n'
    + 'FILTER (?d = "2025-01-01"^^xsd:date || ?d = "2025-01-31"^^xsd:date)'));
  assert.strictEqual(rangeEnds(equalities), null);

  const [twoLower] = parametersOf(query('# ?d: D\n'
    + 'FILTER (?d >= "2025-01-01"^^xsd:date && ?d > "2024-01-01"^^xsd:date)'));
  assert.strictEqual(rangeEnds(twoLower), null);

  const [single] = parametersOf(query('# ?d: D\nFILTER (?d = "2025-01-01"^^xsd:date)'));
  assert.strictEqual(rangeEnds(single), null);
});

// A parameter with a third value is not a range, whatever two of its
// values look like: the form draws a range as exactly two boxes, and the
// third value would vanish from it while still sitting in the query.
test('is not a range when a third value is in play', () => {
  for (const body of [
    'VALUES ?d { "2025-06-01"^^xsd:date } '
      + 'FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-01-31"^^xsd:date)',
    'FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-01-31"^^xsd:date '
      + '&& ?d = "2025-06-01"^^xsd:date)',
  ]) {
    const [parameter] = parametersOf(query(`# ?d: D\n${body}`));
    assert.strictEqual(parameter.slots.length, 3, body);
    assert.strictEqual(rangeEnds(parameter), null, body);
  }
});

// The form and the check that follows it must agree. Two alternatives
// shown as "Between … and …" would read as a period the query never meant,
// and one the check would then decline to defend.
test('is not a range when the two bounds are alternatives', () => {
  const [parameter] = parametersOf(query('# ?d: D\n'
    + 'FILTER (?d <= "2025-01-01"^^xsd:date || ?d >= "2025-12-07"^^xsd:date)'));
  assert.strictEqual(parameter.slots.length, 2);
  assert.strictEqual(rangeEnds(parameter), null);
  assert.deepStrictEqual(parameterRanges([parameter]), []);
});

// ── which values form a range ──────────────────────────────────────

/** The ranges a query declares, as "lower … upper". */
const rangesIn = (text) => parameterRanges(parametersOf(text))
  .map(r => `${r.lower.value} … ${r.upper.value}${r.strict ? ' (strict)' : ''}`);

test('finds a range written as one variable against two literals', () => {
  assert.deepStrictEqual(
    rangesIn(query('# ?d: Publication date\n'
      + 'FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date)')),
    ['2025-01-01 … 2025-12-31']);
});

// The shape four library queries use: the ends are named variables, and
// neither ever meets a literal in a comparison.
test('finds a range the author declared as two variables', () => {
  const text = `${PROLOGUE}# ?startDate, ?endDate: Published\n`
    + 'SELECT * WHERE {\n'
    + '  VALUES (?startDate ?endDate) { ("2024-11-04"^^xsd:date "2024-11-05"^^xsd:date) }\n'
    + '  FILTER (?publicationDate >= ?startDate && ?publicationDate <= ?endDate)\n'
    + '  ?s ?p ?o }';
  assert.deepStrictEqual(rangesIn(text), ['2024-11-04 … 2024-11-05']);
});

// The same query without the declaration: two variables the author never
// said belonged together are two parameters, not a range.
test('does not guess a range from two separate declarations', () => {
  const text = `${PROLOGUE}# ?startDate: Published from\n# ?endDate: Published to\n`
    + 'SELECT * WHERE {\n'
    + '  VALUES (?startDate ?endDate) { ("2024-11-04"^^xsd:date "2024-11-05"^^xsd:date) }\n'
    + '  FILTER (?publicationDate >= ?startDate && ?publicationDate <= ?endDate)\n'
    + '  ?s ?p ?o }';
  assert.deepStrictEqual(rangesIn(text), []);
});

test('reads that shape backwards too', () => {
  const text = `${PROLOGUE}# ?a, ?b: A to B\n`
    + 'SELECT * WHERE {\n'
    + '  VALUES (?a ?b) { ("2024-11-04"^^xsd:date "2024-11-05"^^xsd:date) }\n'
    + '  FILTER (?a <= ?d && ?b >= ?d)\n'
    + '  ?s ?p ?o }';
  assert.deepStrictEqual(rangesIn(text), ['2024-11-04 … 2024-11-05']);
});

// A strict comparison at either end leaves nothing between two equal values.
test('marks a range strict when either end excludes its value', () => {
  const both = '# ?d: D\nFILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-01-31"^^xsd:date)';
  const lower = '# ?d: D\nFILTER (?d > "2025-01-01"^^xsd:date && ?d <= "2025-01-31"^^xsd:date)';
  const upper = '# ?d: D\nFILTER (?d >= "2025-01-01"^^xsd:date && ?d < "2025-01-31"^^xsd:date)';
  assert.deepStrictEqual(rangesIn(query(both)), ['2025-01-01 … 2025-01-31']);
  assert.deepStrictEqual(rangesIn(query(lower)), ['2025-01-01 … 2025-01-31 (strict)']);
  assert.deepStrictEqual(rangesIn(query(upper)), ['2025-01-01 … 2025-01-31 (strict)']);
});

// A value already bounding something by way of a literal keeps that
// reading. A later comparison merely mentioning its variable must not
// quietly move it to the other end of a different range.
test('does not re-bind a value that already bounds something', () => {
  const text = `${PROLOGUE}# ?a: A\n`
    + 'SELECT * WHERE {\n'
    + '  FILTER (?a >= "2025-01-01"^^xsd:date)\n'
    + '  FILTER (?b <= ?a)\n'
    + '  ?s ?p ?o }';
  const [parameter] = parametersOf(text);
  assert.strictEqual(parameter.slots.length, 1);
  assert.strictEqual(parameter.slots[0].bound, 'lower');
});

// Two bounds are a range only if the query asks for both at once.
// `?d >= A || ?d <= B` asks for everything outside a period; reading it as
// a range would call a perfectly good query backwards and refuse to run it.
// A range is a promise that both ends hold. Inside an OPTIONAL neither
// end has to: the block simply matches nothing and the query answers
// anyway, so ends that look backwards there cost nothing and refusing to
// run would block a query that works.
// ── declaring a range ──────────────────────────────────────────────

test('reads two variables on one line as one range', () => {
  const [parameter] = parametersOf(query('# ?a, ?b: Published\n'
    + 'VALUES (?a ?b) { ("2025-01-01"^^xsd:date "2025-12-31"^^xsd:date) }'
    + ' FILTER (?d >= ?a && ?d <= ?b)'));
  assert.deepStrictEqual(parameter.variables, ['a', 'b']);
  assert.strictEqual(parameter.label, 'Published');
  assert.deepStrictEqual(rangeEnds(parameter).map(slot => slot.value), ['2025-01-01', '2025-12-31']);
});

// The declaration says which end is which, so a query that names them the
// other way round is read the way it was declared.
test('takes the start from the declaration, not the query', () => {
  const [parameter] = parametersOf(query('# ?b, ?a: Published\n'
    + 'VALUES (?a ?b) { ("2025-01-01"^^xsd:date "2025-12-31"^^xsd:date) }'
    + ' FILTER (?d >= ?a && ?d <= ?b)'));
  assert.deepStrictEqual(rangeEnds(parameter).map(slot => slot.value), ['2025-12-31', '2025-01-01']);
});

// A declared range is the author's word, so it holds wherever the two ends
// are written — the query never has to be asked whether they belong.
test('honours a declared range whose ends sit apart', () => {
  assert.deepStrictEqual(
    rangesIn(query('# ?a, ?b: Published\n'
      + 'VALUES ?a { "2025-01-01"^^xsd:date }'
      + ' OPTIONAL { VALUES ?b { "2025-12-31"^^xsd:date } }')),
    ['2025-01-01 … 2025-12-31']);
});

// The wording still comes from the comparisons, since only they say
// whether an end admits its own value.
test('words a declared range from its comparisons', () => {
  const [parameter] = parametersOf(query('# ?a, ?b: Published\n'
    + 'VALUES (?a ?b) { ("2025-01-01"^^xsd:date "2025-12-31"^^xsd:date) }'
    + ' FILTER (?d > ?a && ?d < ?b)'));
  assert.deepStrictEqual(rangeWording(...rangeEnds(parameter)),
    { opening: 'After', joining: 'and before' });
});

test('needs both ends of a declared range to have a value', () => {
  const [parameter] = parametersOf(query('# ?a, ?b: Published\n'
    + 'VALUES ?a { "2025-01-01"^^xsd:date }'));
  assert.deepStrictEqual(parameter.slots.map(slot => slot.value), ['2025-01-01']);
  assert.strictEqual(rangeEnds(parameter), null);
});

// Two names are two ends only if each of them has a value. Two values
// belonging to one of the names are not the two ends of anything, however
// many the pair adds up to.
test('needs one value from each end of a declared range', () => {
  const [parameter] = parametersOf(query('# ?a, ?b: Period\n'
    + 'FILTER (?a >= "2025-12-31"^^xsd:date && ?a <= "2025-01-01"^^xsd:date)'));
  assert.strictEqual(parameter.slots.length, 2);
  assert.strictEqual(rangeEnds(parameter), null);
  assert.deepStrictEqual(parameterRanges([parameter]), []);
});

test('reads a declared range when each end has exactly one value', () => {
  const [parameter] = parametersOf(query('# ?a, ?b: Period\n'
    + 'VALUES ?a { "2025-01-01"^^xsd:date } VALUES ?b { "2025-12-31"^^xsd:date }'));
  assert.deepStrictEqual(rangeEnds(parameter).map(slot => slot.value), ['2025-01-01', '2025-12-31']);
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

// ── which values form a range ──────────────────────────────────────

test('does not pair bounds that reach no conjunction together', () => {
  for (const body of [
    'FILTER (?d >= "2025-12-31"^^xsd:date) OPTIONAL { FILTER (?d <= "2025-01-01"^^xsd:date) }',
    'FILTER (?d >= "2025-12-31"^^xsd:date) MINUS { FILTER (?d <= "2025-01-01"^^xsd:date) }',
    'FILTER (?d >= "2025-12-31"^^xsd:date '
      + '&& NOT EXISTS { FILTER (?d <= "2025-01-01"^^xsd:date) })',
    'FILTER (?d >= "2025-12-31"^^xsd:date '
      + '&& EXISTS { FILTER (?d <= "2025-01-01"^^xsd:date) })',
    'FILTER (?d >= "2025-12-31"^^xsd:date) OPTIONAL { VALUES ?d { "2025-01-01"^^xsd:date } }',
    // Both bounds are conjuncts of the outer &&, but each sits inside a
    // || of its own, so neither is required on its own account.
    'FILTER ((?d >= "2025-12-31"^^xsd:date || ?x = 1) '
      + '&& (?d <= "2025-01-01"^^xsd:date || ?x = 2))',
  ]) {
    assert.deepStrictEqual(rangesIn(query(`# ?d: D\n# ?x: X\n${body}`)), [], body);
  }
});

// Where the conjunction sits does not change what it says. Both ends of
// this one are equally optional, so they are still each other's ends —
// the OPTIONAL decides whether the query insists on the range, not
// whether it is one.
test('reads a conjunction wherever the query puts it', () => {
  for (const body of [
    'OPTIONAL { FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date) }',
    '{ FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date) }'
      + ' UNION { FILTER (?x = 1) }',
    'GRAPH ?g { FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date) }',
  ]) {
    assert.deepStrictEqual(rangesIn(query(`# ?d: D\n# ?x: X\n${body}`)),
      ['2025-01-01 … 2025-12-31'], body);
  }
});

// Not required is not the same as not offered: the value is still the
// reader's to change.
test('still offers a value the query does not require', () => {
  const [parameter] = parametersOf(query('# ?d: D\n'
    + 'FILTER (?d >= "2025-01-01"^^xsd:date) OPTIONAL { FILTER (?d <= "2025-12-31"^^xsd:date) }'));
  assert.deepStrictEqual(parameter.slots.map(s => s.value), ['2025-01-01', '2025-12-31']);
});

// GRAPH and SERVICE say where to look, not whether to insist.
test('reads a range inside GRAPH or SERVICE', () => {
  for (const body of [
    'GRAPH ?g { FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date) }',
    'SERVICE <http://example.org/sparql> '
      + '{ FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date) }',
  ]) {
    assert.deepStrictEqual(rangesIn(query(`# ?d: D\n${body}`)), ['2025-01-01 … 2025-12-31'], body);
  }
});

// UNION is the other way SPARQL says "either of these". Bounds in two of
// its arms are no more a range than bounds either side of `||`.
test('does not read UNION arms as a range', () => {
  assert.deepStrictEqual(
    rangesIn(query('# ?d: D\n'
      + '{ FILTER (?d >= "2025-12-31"^^xsd:date) }'
      + ' UNION { FILTER (?d <= "2025-01-01"^^xsd:date) }')),
    []);
});

test('reads a range inside one arm of a UNION', () => {
  assert.deepStrictEqual(
    rangesIn(query('# ?d: D\n# ?x: X\n'
      + '{ FILTER (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date) }'
      + ' UNION { FILTER (?x = 1) }')),
    ['2025-01-01 … 2025-12-31']);
});

// A group is wrapped in the same node whether or not a UNION follows it,
// so a plain group must go on pairing.
// Two filters do both hold, but nothing in the query says they are two
// ends of one thing rather than two separate limits. An author who means
// a range says so, with one `&&` or with two declared variables.
test('does not pair bounds in two plain groups', () => {
  assert.deepStrictEqual(
    rangesIn(query('# ?d: D\n'
      + '{ FILTER (?d >= "2025-01-01"^^xsd:date) }'
      + ' { FILTER (?d <= "2025-12-31"^^xsd:date) }')),
    []);
});

test('does not read nested UNION arms as a range', () => {
  assert.deepStrictEqual(
    rangesIn(query('# ?d: D\n# ?x: X\n'
      + '{ { FILTER (?d >= "2025-12-31"^^xsd:date) }'
      + '  UNION { FILTER (?d <= "2025-01-01"^^xsd:date) } }'
      + ' UNION { FILTER (?x = 2) }')),
    []);
});

test('does not read a disjunction as a range', () => {
  assert.deepStrictEqual(
    rangesIn(query('# ?d: D\n'
      + 'FILTER (?d >= "2025-12-31"^^xsd:date || ?d <= "2025-01-01"^^xsd:date)')),
    []);
});

// Where the FILTER sits does not matter, but what sits above the `&&`
// inside the expression does. A conjunction in one arm of a `||` is not
// something the query requires — the other arm can satisfy it alone.
test('does not read a conjunction the expression may skip', () => {
  for (const body of [
    'FILTER ((?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date) || ?x = 1)',
    'FILTER (!(?d >= "2025-12-31"^^xsd:date && ?d <= "2025-01-01"^^xsd:date))',
    'FILTER (IF(?d >= "2025-12-31"^^xsd:date && ?d <= "2025-01-01"^^xsd:date, true, false))',
    'FILTER ((?d >= "2025-12-31"^^xsd:date && ?d <= "2025-01-01"^^xsd:date) = true)',
  ]) {
    assert.deepStrictEqual(rangesIn(query(`# ?d: D\n# ?x: X\n${body}`)), [], body);
  }
});

// SPARQL negates in two registers — `!` over an expression, MINUS and NOT
// EXISTS over a pattern. Under any of them, ends that look backwards make
// an empty set that is then subtracted, so the query matches more rather
// than less, and refusing to run it would be refusing a query that works.
test('does not read a conjunction a negation turns around', () => {
  for (const body of [
    'FILTER NOT EXISTS { FILTER (?d >= "2025-12-31"^^xsd:date '
      + '&& ?d <= "2025-01-01"^^xsd:date) }',
    'MINUS { FILTER (?d >= "2025-12-31"^^xsd:date && ?d <= "2025-01-01"^^xsd:date) }',
    'FILTER (!EXISTS { FILTER (?d >= "2025-12-31"^^xsd:date '
      + '&& ?d <= "2025-01-01"^^xsd:date) })',
    // The negation need not be the FILTER's immediate surroundings.
    'FILTER NOT EXISTS { OPTIONAL { FILTER (?d >= "2025-12-31"^^xsd:date '
      + '&& ?d <= "2025-01-01"^^xsd:date) } }',
  ]) {
    assert.deepStrictEqual(rangesIn(query(`# ?d: D\n${body}`)), [], body);
  }
});

// EXISTS asks the same question without turning it around.
test('reads a conjunction inside EXISTS', () => {
  assert.deepStrictEqual(
    rangesIn(query('# ?d: D\n'
      + 'FILTER EXISTS { FILTER (?d >= "2025-01-01"^^xsd:date '
      + '&& ?d <= "2025-12-31"^^xsd:date) }')),
    ['2025-01-01 … 2025-12-31']);
});

// A conjunction of conjunctions still requires all of them.
test('reads a conjunction nested in another', () => {
  assert.deepStrictEqual(
    rangesIn(query('# ?d: D\n# ?x: X\n'
      + 'FILTER (?x = 1 && (?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date))')),
    ['2025-01-01 … 2025-12-31']);
});

// Doubled brackets change nothing about what the FILTER tests.
test('reads a conjunction through redundant brackets', () => {
  assert.deepStrictEqual(
    rangesIn(query('# ?d: D\n'
      + 'FILTER ((?d >= "2025-01-01"^^xsd:date && ?d <= "2025-12-31"^^xsd:date))')),
    ['2025-01-01 … 2025-12-31']);
});

// A conjunction outside any FILTER is not one the query filters on.
test('does not read a conjunction outside a filter', () => {
  assert.deepStrictEqual(
    rangesIn(query('# ?d: D\n'
      + 'BIND((?d >= "2025-12-31"^^xsd:date && ?d <= "2025-01-01"^^xsd:date) AS ?ok)')),
    []);
});

// Bounds in separate FILTER statements must both hold, so they are a range.
test('does not pair bounds in separate filters', () => {
  const text = query('# ?d: D\n'
    + 'FILTER (?d >= "2025-01-01"^^xsd:date) FILTER (?d <= "2025-12-31"^^xsd:date)');
  assert.deepStrictEqual(rangesIn(text), []);
  // Both values are still the reader's to change; only the range is gone.
  assert.deepStrictEqual(parametersOf(text)[0].slots.map(slot => slot.value),
    ['2025-01-01', '2025-12-31']);
});

test('finds no range where there is none', () => {
  assert.deepStrictEqual(rangesIn(query('# ?d: D\nFILTER (?d = "2025-01-01"^^xsd:date)')), []);
  // Two lower bounds are not a range.
  assert.deepStrictEqual(
    rangesIn(query('# ?d: D\nFILTER (?d >= "2025-01-01"^^xsd:date && ?d > "2024-01-01"^^xsd:date)')), []);
  // Nor is a variable bound in VALUES that nothing compares.
  assert.deepStrictEqual(rangesIn(query('# ?d: D\nVALUES ?d { "2025-01-01"^^xsd:date }')), []);
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
