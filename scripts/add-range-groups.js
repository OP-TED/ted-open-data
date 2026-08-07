import { readFileSync, writeFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('src/assets/query-parameters.json', 'utf8'));

let updated = 0;

for (const [filename, entry] of Object.entries(d)) {
  const params = entry.parameters;
  if (!params || params.length < 2) continue;

  for (let i = 0; i < params.length - 1; i++) {
    const a = params[i];
    const b = params[i + 1];

    // Identify start/end pairs by type or label
    const isPair =
      (a.type === 'month-start' && b.type === 'month-end') ||
      (a.type === 'year-start' && b.type === 'year-end') ||
      (a.type === 'date' && b.type === 'date' && a.label.toLowerCase().includes('start') && b.label.toLowerCase().includes('end')) ||
      (a.type === 'date-raw' && b.type === 'date-raw' && a.label.toLowerCase().includes('start') && b.label.toLowerCase().includes('end'));

    if (isPair) {
      const groupName = filename.replace('.sparql', '');
      a.rangeGroup = groupName;
      a.role = 'start';
      b.rangeGroup = groupName;
      b.role = 'end';
      updated++;
      console.log(`  ${filename}: paired "${a.label}" + "${b.label}" as group "${groupName}"`);
      i++; // skip the end param
    }
  }
}

writeFileSync('src/assets/query-parameters.json', JSON.stringify(d, null, 2) + '\n');
console.log(`\nDone. Updated ${updated} pairs.`);
