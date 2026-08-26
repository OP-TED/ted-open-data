/**
 * Merge epo-terms-v3.json and epo-terms-v4.json into a single epo-terms.json
 * where each term carries version information.
 *
 * Usage: node scripts/merge-epo-terms.js
 * Output: src/assets/epo-terms.json
 */

import { readFileSync, writeFileSync } from 'node:fs';

const v3 = JSON.parse(readFileSync('src/assets/epo-terms-v3.json', 'utf8'));
const v4 = JSON.parse(readFileSync('src/assets/epo-terms-v4.json', 'utf8'));

function mergeTerms(v3List, v4List) {
  const merged = {};
  for (const term of v3List) {
    merged[term] = ['v3'];
  }
  for (const term of v4List) {
    if (merged[term]) {
      merged[term].push('v4');
    } else {
      merged[term] = ['v4'];
    }
  }
  // Sort by key
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Union the two versions' class hierarchies.
 *
 * Unlike the term lists, edges carry no version marker. They are used to
 * answer whether one of a resource's declared types is a superclass of
 * another, and a relationship stated by either version is equally true of the
 * data that version produced. Taking the union also means a resource whose
 * types span the two — which the merged term list already anticipates — can
 * still be ranked.
 *
 * Classes are keyed by full IRI, because superclasses are often outside the
 * ePO namespace (epo:Business is a subclass of org:Organization).
 */
function mergeHierarchies(v3Map, v4Map) {
  const merged = {};
  for (const source of [v3Map || {}, v4Map || {}]) {
    for (const [child, parents] of Object.entries(source)) {
      merged[child] = [...new Set([...(merged[child] || []), ...parents])].sort();
    }
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

const result = {
  description: "Merged ePO terms from v3 (Standard Forms) and v4 (eForms). Each term maps to an array of versions where it is defined.",
  namespace: "http://data.europa.eu/a4g/ontology#",
  prefix: "epo",
  classes: mergeTerms(v3.classes, v4.classes),
  objectProperties: mergeTerms(v3.objectProperties, v4.objectProperties),
  datatypeProperties: mergeTerms(v3.datatypeProperties, v4.datatypeProperties),
  subClassOf: mergeHierarchies(v3.subClassOf, v4.subClassOf),
  prefixes: v4.prefixes,
  keywords: v4.keywords,
};

writeFileSync('src/assets/epo-terms.json', JSON.stringify(result, null, 2) + '\n');

const classCount = Object.keys(result.classes).length;
const objCount = Object.keys(result.objectProperties).length;
const dtCount = Object.keys(result.datatypeProperties).length;
console.log(`Merged: ${classCount} classes, ${objCount} object properties, ${dtCount} datatype properties`);
console.log(`  v3-only classes: ${Object.entries(result.classes).filter(([,v]) => v.length === 1 && v[0] === 'v3').length}`);
console.log(`  v4-only classes: ${Object.entries(result.classes).filter(([,v]) => v.length === 1 && v[0] === 'v4').length}`);
console.log(`  shared classes: ${Object.entries(result.classes).filter(([,v]) => v.length > 1).length}`);
const edges = Object.values(result.subClassOf).reduce((n, parents) => n + parents.length, 0);
console.log(`  class hierarchy: ${Object.keys(result.subClassOf).length} classes with a superclass, ${edges} edges`);
