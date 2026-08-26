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

// Reading a parsed SPARQL query.
//
// The editor parses SPARQL continuously in order to colour it, and that
// parse answers questions no amount of reading the text can: a literal
// inside a comment is not in the query, `xsd` means whatever the query's
// own PREFIX says it means, and an escape sequence is the character it
// stands for rather than the characters it is written with.
//
// What follows is the part of that reading which is not about any one
// question — the prologue, IRIs, and the value a literal holds. Modules
// that ask a particular question of a query build on it.

/** The namespace `xsd` stands for when a query does not say otherwise. */
export const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema#';

/** The characters SPARQL's \-escapes stand for, apart from \u and \U. */
const ESCAPES = { t: '\t', b: '\b', n: '\n', r: '\r', f: '\f', '"': '"', "'": "'", '\\': '\\' };

/**
 * A reader of the source text behind a syntax node.
 *
 * @param {import('@codemirror/state').Text} doc
 * @returns {(node: {from: number, to: number}) => string}
 */
export function textReader(doc) {
  return (node) => doc.sliceString(node.from, node.to);
}

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
export function literalValue(text) {
  const quote = text.startsWith('"""') || text.startsWith("'''") ? 3 : 1;
  const body = text.slice(quote, -quote);
  if (!body.includes('\\')) return body;
  return body.replace(
    /\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[tbnrf"'\\])/g,
    (whole, escape) => {
      if (escape[0] !== 'u' && escape[0] !== 'U') return ESCAPES[escape];
      const code = parseInt(escape.slice(1), 16);
      // Beyond the last code point, or a lone surrogate: not a character.
      // The escape is left as written, which no value will match.
      if (code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return whole;
      return String.fromCodePoint(code);
    },
  );
}

/**
 * A string as the body of a SPARQL double-quoted literal.
 *
 * The inverse of {@link literalValue} for the quoting this application
 * writes. Only the three characters that would end the literal or start an
 * escape are touched; everything else, including any character outside
 * ASCII, is left as it stands.
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeLiteral(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
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
export function readPrologue(tree, text) {
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
 * @param {import('@lezer/common').SyntaxNode} literal an RDFLiteral node
 * @param {(node: {from: number, to: number}) => string} text
 * @param {{base: string|null, prefixes: Map<string, string|null>}} prologue
 * @returns {string|null}
 */
export function datatypeOf(literal, text, prologue) {
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
 * Replace ranges of a query's text.
 *
 * Applied last-first so that each range still describes the text it was
 * measured against. The ranges must not overlap.
 *
 * @param {string} text
 * @param {Array<{from: number, to: number, insert: string}>} edits
 * @returns {string}
 */
export function applyEdits(text, edits) {
  return [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce((result, edit) => result.slice(0, edit.from) + edit.insert + result.slice(edit.to), text);
}
