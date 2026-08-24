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
// What makes two of a query's values the two ends of one range.
//
// A range is a promise that both ends hold, and the form makes it in
// words — "Between … and …" — before refusing values that would describe
// an empty period. Both halves of that rest on the same question, so
// they are answered in one place.
//
// Nothing here reads the query again. It works from what the slots
// already record: which end each bounds, whether it admits its own
// value, and which conjunction it belongs to.

/** @typedef {import('./queryParameters.js').ParameterSlot} ParameterSlot */
/** @typedef {import('./queryParameters.js').QueryParameter} QueryParameter */

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
