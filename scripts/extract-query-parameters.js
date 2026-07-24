/**
 * Extract query parameters from the remote SPARQL query library and generate
 * templates with {{placeholder}} syntax for unambiguous value injection.
 *
 * Downloads each .sparql file referenced in index.yaml, scans for xsd:date
 * typed literals, replaces them with named placeholders, and outputs
 * src/assets/query-parameters.json containing:
 *   - template: the query text with {{placeholders}} instead of literal dates
 *   - parameters: declared inputs with label, type, placeholder name, and default
 *
 * The output is meant to be reviewed and corrected by a human before
 * committing. On subsequent runs, existing entries are preserved — only
 * new queries (not yet in the JSON) are appended.
 *
 * Usage:
 *   node scripts/extract-query-parameters.js
 *
 * Output:
 *   src/assets/query-parameters.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const REMOTE_QUERIES_URL = 'https://raw.githubusercontent.com/OP-TED/ted-rdf-docs/main/docs/antora/modules/samples/queries/';
const OUTPUT_PATH = 'src/assets/query-parameters.json';

/**
 * Minimal YAML parser for the index.yaml structure.
 */
function parseIndexYaml(text) {
  const queries = [];
  let current = null;
  for (const line of text.split('\n')) {
    const entryMatch = line.match(/^\s*-\s+category:\s*(.+)/);
    if (entryMatch) {
      current = { category: entryMatch[1].trim() };
      queries.push(current);
      continue;
    }
    if (!current) continue;
    const kvMatch = line.match(/^\s+(title|description|sparql):\s*(.+)/);
    if (kvMatch) {
      current[kvMatch[1]] = kvMatch[2].trim();
    }
  }
  return { queries };
}

/**
 * Convert a camelCase/PascalCase name to a human-readable label.
 */
function humanizeLabel(name) {
  let label = name.replace(/^(has|is|was)/, '');
  label = label.replace(/([a-z])([A-Z])/g, '$1 $2');
  label = label.trim();
  if (label.length === 0) return name;
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

/**
 * Extract date parameters from a SPARQL query and produce a template.
 *
 * Scans for xsd:date literals, assigns a placeholder name to each,
 * replaces the literal with {{placeholder}} in the template text,
 * and returns the parameters array.
 *
 * @returns {{ template: string, parameters: Array }}
 */
function extractAndTemplatize(sparqlText) {
  const params = [];
  const placeholderNames = new Set();
  let template = sparqlText;

  // Match xsd:date literals (both quote styles)
  const dateLiteralRegex = /(['"])(\d{4}-\d{2}-\d{2})\1(\s*\^\^\s*xsd:date)/g;
  const matches = [];
  let match;
  while ((match = dateLiteralRegex.exec(sparqlText)) !== null) {
    matches.push({
      fullMatch: match[0],
      quote: match[1],
      value: match[2],
      typeSuffix: match[3],
      index: match.index,
    });
  }

  if (matches.length === 0) return { template: null, parameters: [] };

  // Assign placeholder names based on context
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    let name = inferPlaceholderName(sparqlText, m.index, i, matches.length);

    // Ensure uniqueness
    let uniqueName = name;
    let counter = 2;
    while (placeholderNames.has(uniqueName)) {
      uniqueName = `${name}${counter++}`;
    }
    placeholderNames.add(uniqueName);

    params.push({
      label: humanizePlaceholder(uniqueName),
      type: 'date',
      placeholder: uniqueName,
      default: m.value,
    });
  }

  // Build template by replacing literals with {{placeholder}} (in reverse to preserve indices)
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const replacement = `{{${params[i].placeholder}}}`;
    template = template.substring(0, m.index) + replacement + template.substring(m.index + m.fullMatch.length);
  }

  return { template, parameters: params };
}

/**
 * Infer a camelCase placeholder name from context.
 */
function inferPlaceholderName(sparqlText, matchIndex, paramIndex, totalParams) {
  const contextStart = Math.max(0, matchIndex - 200);
  const before = sparqlText.substring(contextStart, matchIndex);

  // FILTER variable with operator
  const filterMatch = before.match(/\?(\w+)\s*(>=|<=|>|<|=)\s*$/);
  if (filterMatch) {
    const varName = filterMatch[1];
    const op = filterMatch[2];
    if (op === '>=' || op === '>') return varName + 'Start';
    if (op === '<=' || op === '<') return varName + 'End';
    return varName;
  }

  // Predicate
  const predMatch = before.match(/(?:epo:|:)(\w+)\s+$/);
  if (predMatch) {
    return predMatch[1].replace(/^has/, '').charAt(0).toLowerCase() +
           predMatch[1].replace(/^has/, '').slice(1);
  }

  // VALUES variable
  const textBefore = sparqlText.substring(0, matchIndex);
  const valuesMatch = textBefore.match(/VALUES\s*\(([^)]+)\)\s*\{\s*\(/i);
  if (valuesMatch) {
    const vars = valuesMatch[1].trim().split(/\s+/);
    const tupleOpen = sparqlText.indexOf('(', valuesMatch.index + valuesMatch[0].indexOf('{'));
    const tupleClose = sparqlText.indexOf(')', tupleOpen);
    if (tupleOpen !== -1 && matchIndex > tupleOpen && matchIndex < tupleClose) {
      const between = sparqlText.substring(tupleOpen, matchIndex);
      const priorCount = (between.match(/(['"])[^'"]*\1\s*\^\^\s*xsd:date/g) || []).length;
      if (priorCount < vars.length) {
        return vars[priorCount].replace(/^\?/, '');
      }
    }
  }

  // Fallback
  return `date${paramIndex + 1}`;
}

/**
 * Convert a camelCase placeholder name to a human label.
 * e.g. "publicationDateStart" → "Publication date start"
 */
function humanizePlaceholder(name) {
  // Handle "varNameStart" / "varNameEnd" pattern
  let label = name.replace(/^(has|is|was)/, '');
  label = label.replace(/([a-z])([A-Z])/g, '$1 $2');
  label = label.trim();
  if (label.length === 0) return name;
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

async function main() {
  console.log('Fetching index.yaml...');
  const indexResponse = await fetch(`${REMOTE_QUERIES_URL}index.yaml`);
  if (!indexResponse.ok) {
    throw new Error(`Failed to fetch index.yaml: HTTP ${indexResponse.status}`);
  }
  const indexText = await indexResponse.text();
  const data = parseIndexYaml(indexText);

  // Load existing parameters (preserve human-reviewed entries)
  let existing = {};
  if (existsSync(OUTPUT_PATH)) {
    existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
    console.log(`Loaded existing ${OUTPUT_PATH} with ${Object.keys(existing).length} entries.`);
  }

  let newCount = 0;
  let skippedCount = 0;

  for (const query of data.queries) {
    const filename = query.sparql;

    // Skip if already declared
    if (existing[filename]) {
      skippedCount++;
      continue;
    }

    // Fetch the .sparql file
    const url = `${REMOTE_QUERIES_URL}${filename}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`  WARNING: Failed to fetch ${filename}: HTTP ${response.status}`);
      continue;
    }
    const sparqlText = await response.text();

    // Extract parameters and generate template
    const { template, parameters } = extractAndTemplatize(sparqlText);

    existing[filename] = {
      title: query.title,
      template: template,
      parameters: parameters
    };

    if (parameters.length > 0) {
      console.log(`  + ${filename}: ${parameters.length} parameter(s), template generated`);
    } else {
      console.log(`  - ${filename}: no parameters`);
    }
    newCount++;
  }

  // Sort by filename for stable output
  const sorted = Object.fromEntries(
    Object.entries(existing).sort(([a], [b]) => a.localeCompare(b))
  );

  writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`\nDone. ${newCount} new, ${skippedCount} preserved.`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log('\nPlease review the generated labels and placeholders before committing.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
