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

const result = {
  description: "Merged ePO terms from v3 (Standard Forms) and v4 (eForms). Each term maps to an array of versions where it is defined.",
  namespace: "http://data.europa.eu/a4g/ontology#",
  prefix: "epo",
  classes: mergeTerms(v3.classes, v4.classes),
  objectProperties: mergeTerms(v3.objectProperties, v4.objectProperties),
  datatypeProperties: mergeTerms(v3.datatypeProperties, v4.datatypeProperties),
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
