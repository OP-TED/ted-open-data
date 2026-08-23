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

/** The namespace `xsd` stands for when a query does not say otherwise. */
const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema#';

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

/** The characters SPARQL's \-escapes stand for, apart from \u and \U. */
const ESCAPES = { t: '\t', b: '\b', n: '\n', r: '\r', f: '\f', '"': '"', "'": "'", '\\': '\\' };

/**
 * A SPARQL string literal's value: its quotes removed and its escapes
 * resolved.
 *
 * What a literal holds is what its escapes mean, not how they are written.
 * "2024\u002D11\u002D05" is the date 2024-11-05, and judging it as written
 * would report a good query as a bad one.
 *
 * @param {string} text the literal as it appears in the query, quotes included
 * @returns {string}
 */
function literalValue(text) {
  const quote = text.startsWith('"""') || text.startsWith("'''") ? 3 : 1;
  const body = text.slice(quote, -quote);
  if (!body.includes('\\')) return body;
  return body.replace(
    /\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[tbnrf"'\\])/g,
    (whole, escape) => {
      if (escape[0] !== 'u' && escape[0] !== 'U') return ESCAPES[escape];
      const code = parseInt(escape.slice(1), 16);
      // Beyond the last code point, or a lone surrogate: not a character.
      // The escape is left as written, which no date will match.
      if (code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return whole;
      return String.fromCodePoint(code);
    },
  );
}

/**
 * The IRI a `<...>` in the query denotes, resolved against BASE if it is
 * relative, or null if it cannot be resolved.
 *
 * @param {string} text the IRI as written, angle brackets included
 * @param {string|null} base
 * @returns {string|null}
 */
function resolveIri(text, base) {
  const iri = literalValue(`"${text.slice(1, -1)}"`);
  try {
    return base ? new URL(iri, base).href : new URL(iri).href;
  } catch {
    return null;
  }
}

/**
 * Read a query's prologue: the BASE it resolves relative IRIs against and
 * the namespace each prefix is bound to.
 *
 * @param {import('@lezer/common').Tree} tree
 * @param {(node: {from: number, to: number}) => string} text
 * @returns {{base: string|null, prefixes: Map<string, string|null>}}
 */
function readPrologue(tree, text) {
  const prefixes = new Map();
  let base = null;

  tree.iterate({
    enter(node) {
      if (node.name === 'BaseDecl') {
        const iri = node.node.getChild('IriRef');
        // A second BASE replaces the first, and a relative one resolves
        // against it.
        if (iri) base = resolveIri(text(iri), base);
        return;
      }
      if (node.name !== 'PrefixDecl') return;
      const label = node.node.getChild('Pname_ns');
      const iri = node.node.getChild('IriRef');
      if (!label || !iri) return;
      // Pname_ns includes its colon; the prefix is what comes before it.
      const prefix = text(label).slice(0, -1);
      // Declaring a prefix twice binds it to the second namespace, which is
      // what the endpoint will use. The tree is walked in source order, so
      // the later declaration simply overwrites the earlier one — resolved
      // against whatever BASE is in force where it stands.
      prefixes.set(prefix, resolveIri(text(iri), base));
    },
  });

  return { base, prefixes };
}

/**
 * The datatype of an RDFLiteral node, as a full IRI, or null when the
 * literal has no datatype or its datatype cannot be resolved.
 *
 * @param {import('@lezer/common').SyntaxNode} literal
 * @param {(node: {from: number, to: number}) => string} text
 * @param {{base: string|null, prefixes: Map<string, string>}} prologue
 * @returns {string|null}
 */
function datatypeOf(literal, text, prologue) {
  const iri = literal.getChild('Iri');
  if (!iri) return null; // a plain or language-tagged literal

  const prefixed = iri.getChild('PrefixedName');
  if (!prefixed) return resolveIri(text(iri), prologue.base);

  const name = text(prefixed);
  const colon = name.indexOf(':');
  const prefix = name.slice(0, colon);
  const local = name.slice(colon + 1);

  const namespace = prologue.prefixes.get(prefix);
  if (namespace !== undefined) return namespace === null ? null : namespace + local;
  // An undeclared prefix does not parse, so a query reaching here has one
  // only while it is being typed. `xsd` is worth reading by convention
  // until the declaration arrives; anything else is left alone.
  return prefix === 'xsd' ? XSD_NAMESPACE + local : null;
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
  const text = (node) => doc.sliceString(node.from, node.to);
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
