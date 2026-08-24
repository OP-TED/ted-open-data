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

// Offering a query's values as a form, so that someone can change the date
// a query asks about without editing SPARQL (issue #72).
//
// A query says which of its variables are meant to be varied by annotating
// them in a comment:
//
//     # ?publicationDate: Published on
//     ...
//     FILTER (?publicationDate = "2024-11-04"^^xsd:date)
//
// The annotation carries the label and nothing else, because nothing else
// has to be said twice: the literal beside the variable is the current
// value, and its datatype is the kind of input to offer. The query stays a
// complete, runnable query with a real value in it — the same text whether
// it is read on GitHub, copied into another client, or filled in here.
//
// A variable annotated but never compared to a literal yields no field, and
// a literal whose variable is not annotated is left alone. Nothing is
// guessed: `FILTER(lang(?country) = "en")` compares a *function* of
// ?country, so annotating ?country does not offer to edit "en".

import {
  XSD_NAMESPACE, textReader, literalValue, escapeLiteral, readPrologue,
  datatypeOf, applyEdits,
} from './sparqlTree.js';

/**
 * A place in the query holding one value the form can replace.
 *
 * @typedef {object} ParameterSlot
 * @property {number} from       start of the literal in the query text
 * @property {number} to         end of it
 * @property {string} value      the value as it stands, escapes resolved
 * @property {'date'|'dateTime'|'time'|'number'|'boolean'|'text'} kind
 *   which input to offer
 * @property {'lower'|'upper'|null} bound
 *   which end of a range this is
 * @property {string} scope
 *   which scope the occurrence belongs to; a subquery that does not
 *   project a name holds a different variable of the same spelling
 * @property {number|null} conjunction
 *   which `&&` this value's comparison belongs to; two bounds of one
 *   variable are a range when they belong to the same one
 * @property {boolean} inclusive
 *   whether that end admits the value itself: `>=` does, `>` does not.
 *   True until a comparison says otherwise, so that a range whose ends the
 *   query never compares is read as taking both in — the reading that
 *   claims least
 * @property {boolean} quoted    whether the literal is written in quotes
 * @property {string} suffix     what follows the closing quote: `^^xsd:date`,
 *   `@en`, or nothing. Re-emitted verbatim, so the query keeps the author's
 *   own spelling of its datatype.
 */

/**
 * One value a query offers to have changed.
 *
 * @typedef {object} QueryParameter
 * @property {string[]} variables  the names declared, without the `?`; two
 *   of them where the author declared a range
 * @property {string} label      what to call it on the form
 * @property {ParameterSlot[]} slots  in the order they appear in the query,
 *   or start then end where the author declared a range
 * @property {boolean} declaredRange  whether two names were declared and
 *   each of them has exactly one value, which is what makes them two ends
 */

// ── reading the query ─────────────────────────────────────────────
//
// What the query says: which variables are declared, which literals
// they meet, and what each of those literals holds.

/** Datatypes whose values are numbers. */
const NUMERIC_TYPES = new Set([
  'integer', 'decimal', 'float', 'double', 'long', 'int', 'short', 'byte',
  'nonPositiveInteger', 'negativeInteger', 'nonNegativeInteger', 'positiveInteger',
  'unsignedLong', 'unsignedInt', 'unsignedShort', 'unsignedByte',
].map(name => XSD_NAMESPACE + name));

/** The input a datatype asks for. */
function kindOfDatatype(datatype) {
  if (!datatype) return 'text';
  if (NUMERIC_TYPES.has(datatype)) return 'number';
  switch (datatype) {
    case `${XSD_NAMESPACE}date`: return 'date';
    case `${XSD_NAMESPACE}dateTime`: return 'dateTime';
    case `${XSD_NAMESPACE}time`: return 'time';
    case `${XSD_NAMESPACE}boolean`: return 'boolean';
    default: return 'text';
  }
}

/** One `# ?variable: Label` line, or `# ?start, ?end: Label` for a range. */
const DECLARATION = /^#\s*\?([A-Za-z_][\w.-]*)\s*(?:,\s*\?([A-Za-z_][\w.-]*)\s*)?:\s*(\S.*?)\s*$/;

/**
 * The parameters a query declares, in the order it declares them.
 *
 * Read from the comment nodes rather than from the text, so that a line
 * which merely looks like an annotation — inside a string, say — declares
 * nothing.
 *
 * Two variables on one line are the two ends of a range, the first the
 * start. Saying so is the author's business: they wrote the query and know
 * whether the two bounds hold together, which is not something reading the
 * query can always settle.
 *
 * @param {import('@lezer/common').Tree} tree
 * @param {(node: {from: number, to: number}) => string} text
 * @returns {Array<{variables: string[], label: string}>}
 */
function readAnnotations(tree, text) {
  const declarations = [];
  const declared = new Set();
  tree.iterate({
    enter(node) {
      if (node.name !== 'Comment') return;
      // Comment lines that follow one another are one node, so a query
      // declaring two parameters in a row arrives here as a single string.
      for (const line of text(node).split('\n')) {
        const match = line.match(DECLARATION);
        if (!match) continue;
        const [, first, second, label] = match;
        const variables = second ? [first, second] : [first];
        // A variable declared twice keeps its first label; a later line is
        // more likely a second thought left behind than a correction. The
        // same name twice on one line is not a range but a typo.
        if (variables.some(name => declared.has(name)) || first === second) continue;
        variables.forEach(name => declared.add(name));
        declarations.push({ variables, label });
      }
    },
  });
  return declarations;
}

/** The innermost node on the left of an expression, unwrapping the grammar's layers. */
function innermost(node) {
  let deepest = node;
  for (let child = node; child; child = child.firstChild) deepest = child;
  return deepest;
}

/** Whether a node is a literal of any of SPARQL's three written forms. */
const isLiteralNode = (name) =>
  name === 'RDFLiteral' || name === 'NumericLiteral' || name === 'BooleanLiteral';

/**
 * The literal a node is, or null if it is anything more than one.
 *
 * The grammar wraps a literal in a stack of expression layers, so finding
 * one is a matter of descending to it. Containing a literal is not the same
 * as being one, though: `IF(?flag, "yes", "no")` and `1 + 2` both hold
 * literals that the query never presented as values, and a field over one
 * of those would rewrite the query into something else entirely. So the
 * node has to be the literal and nothing besides — which is to say the two
 * have to cover the same text.
 */
function literalOf(node, text) {
  let current = node.node ?? node;
  while (current && !isLiteralNode(current.name)) current = current.firstChild;
  if (!current) return null;
  return text(node) === text(current) ? current : null;
}

/**
 * Describe a literal node as a slot the form can fill.
 *
 * @param {import('@lezer/common').SyntaxNode} literal
 * @param {(node: {from: number, to: number}) => string} text
 * @param {{base: string|null, prefixes: Map<string, string|null>}} prologue
 * @returns {ParameterSlot|null}
 */
function slotFor(literal, text, prologue) {
  if (literal.name === 'NumericLiteral') {
    return {
      from: literal.from, to: literal.to, value: text(literal),
      kind: 'number', bound: null, inclusive: true, scope: '', conjunction: null, quoted: false, suffix: '',
    };
  }
  if (literal.name === 'BooleanLiteral') {
    return {
      from: literal.from, to: literal.to, value: text(literal),
      kind: 'boolean', bound: null, inclusive: true, scope: '', conjunction: null, quoted: false, suffix: '',
    };
  }

  const string = literal.getChild('String');
  if (!string) return null;
  return {
    from: literal.from,
    to: literal.to,
    value: literalValue(text(string)),
    kind: kindOfDatatype(datatypeOf(literal, text, prologue)),
    bound: null,
    inclusive: true,
    scope: '',
    conjunction: null,
    quoted: true,
    // Whatever follows the closing quote — `^^xsd:date`, `@en` — kept as
    // written so that filling the form never restates the datatype.
    suffix: text({ from: string.to, to: literal.to }),
  };
}

/**
 * Slots reached by comparing a variable to a literal, as
 * `FILTER (?publicationDate >= "2024-11-04"^^xsd:date)`.
 *
 * The variable must be the operand itself. `lang(?country) = "en"` compares
 * a function of the variable, and its literal belongs to the function.
 */
/**
 * The variable an operand is, or null if it is anything more than one.
 *
 * The operand has to be the variable and nothing else. `lang(?country)`
 * reaches the same innermost node, and the literal it is compared to
 * belongs to the function rather than to the variable.
 */
function variableOperand(operand, text) {
  const node = innermost(operand);
  const isBareVariable = node.name === 'Var' && text(operand).trim() === text(node);
  return isBareVariable ? text(node).slice(1) : null;
}

// ── where a value stands in the query ─────────────────────────────
//
// The same literal means different things in different places. Under a
// negation it is subtracted rather than required; in a subquery it may
// belong to another variable of the same name. These record enough of
// that for the range rules to be sound without reading SPARQL whole.

/** Whether a node wraps a single child, adding nothing of its own but syntax. */
const wrapsOne = (node) => node.firstChild !== null && node.firstChild.nextSibling === null;

/**
 * Whether a node turns the meaning of what it holds around.
 *
 * SPARQL negates in two registers — `!` over an expression, MINUS and NOT
 * EXISTS over a pattern — and they come to the same thing here. Under any
 * of them, ends that look backwards describe an empty set that is then
 * subtracted, so the query matches more rather than less.
 */
const negates = (node, text) =>
  node.name === 'MinusGraphPattern'
  || node.name === 'NotExistsFunc'
  || (node.name === 'UnaryExpression' && text(node).trimStart().startsWith('!'));

/**
 * Which conjunction a comparison belongs to, or null if the query does not
 * simply require it.
 *
 * Two bounds are the ends of one range when the query requires both of
 * them together, and `&&` is how it says so. That holds wherever the
 * FILTER sits: inside an OPTIONAL or one arm of a UNION, the two ends
 * still belong to each other — what changes is whether the query insists
 * on the range, not whether it is one.
 *
 * Within the expression, though, what sits above the `&&` can undo it.
 * `!(?d >= A && ?d <= B)` asks for everything outside the period, and
 * `IF(?d >= A && ?d <= B, …)` asks a question rather than filtering. So
 * the walk goes up to the FILTER the conjunction is the condition of, and
 * anything on the way that is more than a wrapper — a negation, a call, an
 * arm of a `||` — means the answer is no. A conjunction of conjunctions is
 * still required, and passes.
 *
 * @param {import('@lezer/common').SyntaxNode} node
 * @param {(node: {from: number, to: number}) => string} text
 * @returns {number|null} an identity shared by conjuncts of the same `&&`
 */
function conjunctionOf(node, text) {
  let conjunction = null;
  let current = node.parent;   // its own two operands say nothing about this

  // Up through the expression, to the FILTER the conjunction is the
  // condition of. Anything on the way that is more than a wrapper — a
  // negation, a call, an arm of a `||` — means the query does not simply
  // require it.
  for (; current; current = current.parent) {
    // The innermost `&&` names the pair; the ones above it only have to
    // leave the requirement standing.
    if (current.name === 'ConditionalAndExpression') {
      if (conjunction === null) conjunction = current.from;
      continue;
    }
    if (current.name === 'Filter') break;
    if (negates(current, text) || !wrapsOne(current)) return null;
  }
  // A conjunction outside any FILTER — in HAVING, or bound by BIND — is
  // not one the query filters on, so it is not offered as a range.
  if (!current) return null;

  // Up through the patterns the FILTER sits in. Where they put it does not
  // matter — an OPTIONAL or one arm of a UNION leaves the two ends each
  // other's ends — but a negation around it does.
  for (; current; current = current.parent) {
    if (negates(current, text)) return null;
  }
  return conjunction;
}

/**
 * Which scope an occurrence of a variable belongs to.
 *
 * A subquery is a scope of its own, and this treats it as one whatever it
 * projects. Reading the projection would mean reading `SELECT *` against
 * `COUNT(*)`, `DISTINCT`, aliases, aggregates and comments — a large piece
 * of SPARQL to understand for a question the form barely asks. No query in
 * the library needs a single parameter to reach across a subquery, so the
 * boundary is drawn at the subquery itself.
 *
 * The cost is a name that genuinely travels out of a subquery: only its
 * occurrences outside are offered. That is the harmless direction, and it
 * needs no projection rules to get right.
 *
 * @param {import('@lezer/common').SyntaxNode} node
 * @returns {string} shared by occurrences in one and the same scope
 */
function scopeOf(node) {
  const enclosing = [];
  for (let current = node; current; current = current.parent) {
    if (current.name === 'SubSelect') enclosing.push(current.from);
  }
  return enclosing.join(',');
}

/**
 * The occurrences of one declared variable, where they all mean the same
 * thing.
 *
 * A name used in one place means whatever the query says there, however
 * deeply that place is nested — an annotation on a query whose only
 * `?publicationDate` lives inside a subquery still means that one. What
 * cannot be offered is a name standing for two different variables at
 * once: filling the field would reach into a part of the query the reader
 * was never shown.
 *
 * So the outermost scope wins, and a tie between scopes at the same depth
 * — two subqueries, each with a `?d` of its own — is left alone.
 *
 * @param {ParameterSlot[]} slots every occurrence found, in any scope
 * @returns {ParameterSlot[]}
 */
function oneScope(slots) {
  const scopes = new Map();
  for (const slot of slots) {
    if (!scopes.has(slot.scope)) scopes.set(slot.scope, []);
    scopes.get(slot.scope).push(slot);
  }
  const depth = (scope) => (scope === '' ? 0 : scope.split(',').length);
  const shallowest = Math.min(...[...scopes.keys()].map(depth));
  const outermost = [...scopes.keys()].filter(scope => depth(scope) === shallowest);
  return outermost.length === 1 ? scopes.get(outermost[0]) : [];
}

/** The two operands of a comparison, with the operator between them. */
function comparison(node, text) {
  const left = node.firstChild;
  const right = left && left.nextSibling;
  if (!left || !right) return null;
  return { left, right, operator: text({ from: left.to, to: right.from }).trim() };
}

function comparisonSlots(tree, text, prologue, wanted, into) {
  const variableOf = (operand) => variableOperand(operand, text);

  tree.iterate({
    enter(node) {
      if (node.name !== 'RelationalExpression') return;
      const parts = comparison(node.node, text);
      if (!parts) return;
      const { left, right } = parts;

      // Either order reads the same: `?d >= "2024-11-04"` and
      // `"2024-11-04" <= ?d` both put a lower bound on ?d.
      const leftVariable = variableOf(left);
      const variable = leftVariable ?? variableOf(right);
      if (variable === null || !wanted.has(variable)) return;

      const literal = literalOf(leftVariable === null ? left : right, text);
      if (!literal) return;
      const slot = slotFor(literal, text, prologue);
      if (!slot) return;

      // The operator says which end of a range the value is, so that a
      // variable compared twice can be offered as "from" and "to" without
      // the query having to say so. Reading the comparison backwards turns
      // it round: a variable at least as large as a value, or a value no
      // larger than the variable, are the same lower bound.
      const { operator } = parts;
      const lower = leftVariable === null ? operator.startsWith('<') : operator.startsWith('>');
      const upper = leftVariable === null ? operator.startsWith('>') : operator.startsWith('<');
      slot.bound = lower ? 'lower' : upper ? 'upper' : null;
      // `>=` admits the value itself, `>` does not, and the difference is
      // a day of results.
      slot.inclusive = operator.endsWith('=');
      slot.conjunction = conjunctionOf(node.node, text);

      slot.scope = scopeOf(node.node);
      into(variable, slot);
    },
  });
}

/**
 * Read the comparisons that put one parameter's value against another's.
 *
 * A query often names its two ends and compares them to a third variable:
 *
 *     VALUES (?startDate ?endDate) { (...) }
 *     FILTER (?publicationDate >= ?startDate && ?publicationDate <= ?endDate)
 *
 * Which of the two is the start comes from the declaration, not from here.
 * What the query alone can say is whether each end admits its own value —
 * `>=` does, `>` does not — and that is the difference between "between
 * the 1st and the 31st" and "after the 1st", which is a day of results.
 *
 * @param {import('@lezer/common').Tree} tree
 * @param {(node: {from: number, to: number}) => string} text
 * @param {Map<string, ParameterSlot[]>} found slots collected so far, by variable
 */
function readVariableBounds(tree, text, found) {
  tree.iterate({
    enter(node) {
      if (node.name !== 'RelationalExpression') return;
      const parts = comparison(node.node, text);
      if (!parts) return;
      const { left, right, operator } = parts;

      const leftVariable = variableOperand(left, text);
      const rightVariable = variableOperand(right, text);
      if (leftVariable === null || rightVariable === null) return;

      // `A >= B` bounds A from below by B; read from B's side, B is the
      // lower end of a range on A. The other way round for `<`.
      const sides = [
        { variable: rightVariable, lower: operator.startsWith('>') },
        { variable: leftVariable, lower: operator.startsWith('<') },
      ];
      // Where the comparison stands. A subquery's own `?a` is a different
      // variable: it neither describes the `?a` outside nor counts among
      // its values, so it is filtered out before anything is counted.
      const here = scopeOf(node.node);
      for (const side of sides) {
        if (!operator.startsWith('>') && !operator.startsWith('<')) continue;
        const slots = (found.get(side.variable) ?? []).filter(slot => slot.scope === here);
        // Only a parameter with a single unattached value can be an end:
        // one already compared to literals has its own ends, and one this
        // has already spoken for keeps what the first comparison said.
        if (slots.length !== 1 || slots[0].bound !== null) continue;
        slots[0].bound = side.lower ? 'lower' : 'upper';
        slots[0].inclusive = operator.endsWith('=');
      }
    },
  });
}

/**
 * Slots reached by binding a variable in a VALUES block.
 *
 * `VALUES ?d { … }` gives one variable a column of values; `VALUES (?a ?b)
 * { (…) (…) }` gives several variables a row each, matched by position.
 */
function inlineDataSlots(tree, text, prologue, wanted, into) {
  tree.iterate({
    enter(node) {
      if (node.name !== 'InlineDataOneVar' && node.name !== 'InlineDataFull') return;
      const variables = node.node.getChildren('Var').map(v => text(v).slice(1));
      const values = node.node.getChildren('DataBlockValue');
      if (variables.length === 0) return;

      values.forEach((value, index) => {
        const variable = variables[index % variables.length];
        if (!wanted.has(variable)) return;
        const literal = literalOf(value, text);
        if (!literal) return; // UNDEF, or an IRI
        const slot = slotFor(literal, text, prologue);
        if (!slot) return;
        slot.scope = scopeOf(node.node);
        into(variable, slot);
      });
    },
  });
}

// ── the parameters, and their ranges ──────────────────────────────
//
// What the form is built from: one entry per declaration, and the two
// ends of a range where the query or its author says there is one.

/**
 * The values a query offers to have changed.
 *
 * @param {import('@lezer/common').Tree} tree the query's syntax tree, as the
 *   editor has already parsed it
 * @param {import('@codemirror/state').Text} doc the document the tree is of
 * @returns {QueryParameter[]} in the order the annotations declare them
 */
export function queryParameters(tree, doc) {
  const text = textReader(doc);
  const declarations = readAnnotations(tree, text);
  if (declarations.length === 0) return [];

  const prologue = readPrologue(tree, text);
  const names = declarations.flatMap(declaration => declaration.variables);
  const found = new Map(names.map(name => [name, []]));
  const collect = (variable, slot) => found.get(variable).push(slot);

  comparisonSlots(tree, text, prologue, found, collect);
  inlineDataSlots(tree, text, prologue, found, collect);
  // Which end of a range a variable stands for, where a query names its
  // ends rather than writing them out.
  readVariableBounds(tree, text, found);

  const parameters = [];
  for (const { variables, label } of declarations) {
    const perVariable = variables.map(name => oneScope(found.get(name)));
    // A declared range keeps its ends in the order they were declared; a
    // single variable keeps its values in the order the query has them.
    const slots = variables.length > 1
      ? perVariable.flat()
      : [...perVariable[0]].sort((a, b) => a.from - b.from);
    // Two names are the ends of a range only if each of them has exactly
    // one value. Two values belonging to one of the names are not the two
    // ends of anything, however many of them the pair adds up to.
    const declaredRange = variables.length === 2 && perVariable.every(one => one.length === 1);
    // A variable nothing compares to a literal has nothing to offer, and a
    // field with no value behind it would be a lie.
    if (slots.length > 0) parameters.push({ variables, label, slots, declaredRange });
  }
  return parameters;
}

/**
 * How to read a pair of comparisons as a sentence.
 *
 * Each end of a range is inclusive or not, and English has words that say
 * so: "between the 1st and the 31st" takes both days in, "after the 1st"
 * leaves it out. Getting this wrong is a day of results, and the query
 * already says which is meant.
 *
 * @param {ParameterSlot} from
 * @param {ParameterSlot} to
 * @returns {{opening: string, joining: string}}
 */
export function rangeWording(from, to) {
  if (from.inclusive && to.inclusive) return { opening: 'Between', joining: 'and' };
  if (from.inclusive) return { opening: 'Since', joining: 'and before' };
  if (to.inclusive) return { opening: 'After', joining: 'until' };
  return { opening: 'After', joining: 'and before' };
}

/**
 * The two slots of a range, lower end first, or null if the parameter is
 * not one — two equalities, say, which nothing can sensibly join.
 *
 * This asks {@link parameterRanges}, rather than deciding for itself, so
 * that the form and the check that follows it cannot disagree about what
 * a range is. Presenting two alternatives as "Between … and …" would read
 * as a period the query never meant, and one the check would then decline
 * to defend.
 *
 * @param {QueryParameter} parameter
 * @returns {[object, object]|null}
 */
export function rangeEnds(parameter) {
  const range = rangeOf(parameter);
  return range ? [range.lower, range.upper] : null;
}

/**
 * The two ends of a parameter's range, lower first, or null if it is not
 * one.
 *
 * There are two ways to be a range, and the query says which in both.
 *
 * The author may declare it: two variables on one annotation line are the
 * start and the end, and nothing else needs deciding — they wrote the
 * query and know whether it asks for both.
 *
 * Or one variable may be bounded from each side by the same `&&`, which is
 * how SPARQL says the query needs both at once. Bounds that do not share a
 * conjunction are not paired, whatever else is true of them: separate
 * FILTERs, the two arms of a `||`, and opposite arms of a UNION all fail
 * that test without anything having to know what a UNION is.
 *
 * @param {QueryParameter} parameter
 * @returns {{lower: ParameterSlot, upper: ParameterSlot, strict: boolean}|null}
 *   where a strict range is one whose ends may not be equal, because at
 *   least one comparison excludes the value itself
 */
function rangeOf(parameter) {
  if (parameter.slots.length !== 2) return null;
  const [first, second] = parameter.slots;

  // Declared: the first variable is the start, whatever the query's own
  // order. A declaration that does not hold makes no range at all, rather
  // than some other pair of values wearing its label.
  if (parameter.variables.length === 2) return parameter.declaredRange ? ends(first, second) : null;

  if (first.conjunction === null || first.conjunction !== second.conjunction) return null;
  const lower = parameter.slots.find(slot => slot.bound === 'lower');
  const upper = parameter.slots.find(slot => slot.bound === 'upper');
  return lower && upper ? ends(lower, upper) : null;
}

/** A pair of ends, with the wording their comparisons call for. */
function ends(lower, upper) {
  // `>` or `<` at either end leaves nothing between two equal values.
  return { lower, upper, strict: !lower.inclusive || !upper.inclusive };
}

/**
 * Every range among a query's parameters: two values that would describe
 * an empty period if they were the wrong way round.
 *
 * @param {QueryParameter[]} parameters
 * @returns {Array<{lower: ParameterSlot, upper: ParameterSlot, strict: boolean}>}
 */
export function parameterRanges(parameters) {
  return parameters.map(rangeOf).filter(Boolean);
}

// ── values, in and out of the form ────────────────────────────────
//
// Which control can carry a value without altering it, what may be
// typed into one, how two of them compare, and how one is written back
// into the query.

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
