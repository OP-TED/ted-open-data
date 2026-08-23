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

/**
 * Extract ePO ontology terms from OWL Turtle files into the JSON the editor's
 * autocomplete and linter read.
 *
 * The ontology is parsed rather than pattern-matched. Turtle allows a term to
 * be written several ways — the subject on a preceding line, objects in comma
 * lists, prefixes bound differently per file — and a term missed by a pattern
 * disappears from autocomplete with no signal that anything went wrong.
 *
 * The same files also declare classes belonging to foaf, org, dct and owl,
 * which are not ePO terms and are excluded by the namespace check.
 *
 * Pass every ontology module, not just the core. Classes the data actually
 * uses are defined across several — epo:ContractAmendment lives in eContract —
 * and a module left out is a term the editor will flag as unknown.
 *
 * The `*_restrictions.ttl` files are not needed: their subClassOf statements
 * point at blank-node restrictions rather than named classes.
 *
 * Usage:
 *   node scripts/extract-epo-terms.js <version> <output-file> <ttl-file>...
 *
 * Example, from a checkout of OP-TED/ePO at the tag matching <version>, where
 * <module> expands to each of eAccess, eCatalogue, eContract, … , ePO_core:
 *   node scripts/extract-epo-terms.js 4.2.0 src/assets/epo-terms-v4.json \
 *     ePO/implementation/<module>/owl_ontology/<module>.ttl
 *
 * Terms are selected by namespace rather than by prefix, so the same command
 * works across versions that bind the ontology differently — v3 uses the
 * default prefix, v4 uses a4g:, v5 uses epo:.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import N3 from 'n3';

const EPO_NAMESPACE = 'http://data.europa.eu/a4g/ontology#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const OWL = 'http://www.w3.org/2002/07/owl#';

// Shipped verbatim in the output so the editor can offer prefix declarations.
const COMMON_PREFIXES = {
  epo: 'http://data.europa.eu/a4g/ontology#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  adms: 'http://www.w3.org/ns/adms#',
  dc: 'http://purl.org/dc/elements/1.1/',
  m8g: 'http://data.europa.eu/m8g/',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  dcterms: 'http://purl.org/dc/terms/',
  org: 'http://www.w3.org/ns/org#',
  cdm: 'http://publications.europa.eu/ontology/cdm#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  owl: 'http://www.w3.org/2002/07/owl#',
  foaf: 'http://xmlns.com/foaf/0.1/',
};

const SPARQL_KEYWORDS = [
  'SELECT', 'CONSTRUCT', 'DESCRIBE', 'ASK',
  'WHERE', 'FILTER', 'OPTIONAL', 'UNION', 'MINUS',
  'GRAPH', 'SERVICE', 'BIND', 'VALUES',
  'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'DISTINCT', 'REDUCED', 'AS', 'FROM', 'NAMED',
  'PREFIX', 'BASE',
  'COUNT', 'SUM', 'MIN', 'MAX', 'AVG', 'SAMPLE', 'GROUP_CONCAT',
  'BOUND', 'IF', 'COALESCE', 'EXISTS', 'NOT EXISTS',
  'STR', 'LANG', 'LANGMATCHES', 'DATATYPE', 'IRI', 'URI',
  'STRSTARTS', 'STRENDS', 'CONTAINS', 'STRLEN', 'SUBSTR', 'REPLACE',
  'UCASE', 'LCASE', 'CONCAT', 'REGEX',
  'YEAR', 'MONTH', 'DAY', 'HOURS', 'MINUTES', 'SECONDS',
  'NOW', 'RAND', 'ABS', 'CEIL', 'FLOOR', 'ROUND',
  'ASC', 'DESC', 'true', 'false', 'IN', 'NOT IN', 'a',
];

const isEpoTerm = (iri) => iri.startsWith(EPO_NAMESPACE);
const localName = (iri) => iri.slice(EPO_NAMESPACE.length);

/**
 * Parse the given Turtle files into one array of quads. Each file is parsed on
 * its own because prefix bindings are file-scoped; concatenating the text
 * first would let one file's bindings leak into another's.
 */
function parseAll(paths) {
  const quads = [];
  for (const path of paths) {
    const parser = new N3.Parser({ baseIRI: `file://${path}` });
    quads.push(...parser.parse(readFileSync(path, 'utf8')));
    console.log(`  Read: ${path}`);
  }
  return quads;
}

/** Local names of every ePO term declared as the given OWL kind, sorted. */
function termsOfKind(quads, owlClass) {
  const found = new Set();
  for (const quad of quads) {
    if (quad.predicate.value !== RDF_TYPE) continue;
    if (quad.object.value !== OWL + owlClass) continue;
    if (!isEpoTerm(quad.subject.value)) continue;
    found.add(localName(quad.subject.value));
  }
  return [...found].sort();
}

/**
 * Direct superclasses of each class, as declared by rdfs:subClassOf.
 *
 * Classes are identified by full IRI on both sides, unlike the term lists
 * above, because a superclass is frequently not an ePO term: the ontology
 * declares `epo:Business rdfs:subClassOf org:Organization`, and resources in
 * the data carry both `org:Organization` and `epo:Business` as their types.
 * Recording either side by local name would make those indistinguishable from
 * an ePO class of the same name, and dropping the foreign parents would hide
 * the very relationships that a resource's own types depend on.
 *
 * Blank-node parents are skipped. `epo:X rdfs:subClassOf [ a owl:Restriction
 * ; … ]` constrains X's properties; it does not name a class X specialises.
 *
 * The result answers one question: given the several types a resource
 * declares, which of them is a superclass of another? That is what lets the
 * most specific be identified from the ontology rather than guessed.
 */
function classHierarchy(quads) {
  const parents = new Map();
  for (const quad of quads) {
    if (quad.predicate.value !== RDFS_SUBCLASS_OF) continue;
    if (quad.object.termType !== 'NamedNode') continue;

    const child = quad.subject.value;
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child).add(quad.object.value);
  }

  return Object.fromEntries(
    [...parents]
      .map(([child, set]) => [child, [...set].sort()])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function extractTerms(quads, version) {
  return {
    version,
    namespace: EPO_NAMESPACE,
    prefix: 'epo',
    classes: termsOfKind(quads, 'Class'),
    objectProperties: termsOfKind(quads, 'ObjectProperty'),
    datatypeProperties: termsOfKind(quads, 'DatatypeProperty'),
    subClassOf: classHierarchy(quads),
    prefixes: COMMON_PREFIXES,
    keywords: SPARQL_KEYWORDS,
  };
}

const [version, outputPath, ...ttlPaths] = process.argv.slice(2);
if (!version || !outputPath || ttlPaths.length === 0) {
  console.error('Usage: node scripts/extract-epo-terms.js <version> <output-file> <ttl-file>...');
  process.exit(1);
}

const data = extractTerms(parseAll(ttlPaths), version);
writeFileSync(outputPath, JSON.stringify(data, null, 2));

console.log(
  `ePO ${version}: ${data.classes.length} classes, ` +
  `${data.objectProperties.length} object properties, ` +
  `${data.datatypeProperties.length} datatype properties -> ${outputPath}`,
);
