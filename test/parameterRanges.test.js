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
// What makes two of a query's values the two ends of one range.
//
// A range is a promise that both ends hold. Reading one where the query
// does not make that promise means refusing to run a query that works, so
// everything not plainly a range is left as ordinary values.

import { test } from 'node:test';
import assert from 'node:assert';

import { sparql } from 'codemirror-lang-sparql';

import { rangeEnds, rangeWording, parameterRanges } from '../src/js/utils/parameterRanges.js';
import { PROLOGUE, query, parametersOf, shapeOf } from './_parameterFixtures.js';

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
