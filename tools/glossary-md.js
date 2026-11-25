#!/usr/bin/env node
// Writes glossary.md (for people) from tools/glossary.json and tools/terms.json (for the tools).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const g = JSON.parse(fs.readFileSync(path.join(__dirname, 'glossary.json'), 'utf8'));
const termsFile = path.join(__dirname, 'terms.json');
const terms = fs.existsSync(termsFile) ? JSON.parse(fs.readFileSync(termsFile, 'utf8')) : {};
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\\n/g, ' ');
const lines = [
  '# God of War – glossary',
  '',
  'Fixed Hebrew for names and game terms. Every translation uses these.',
  'Source of truth: `tools/glossary.json` (hand-picked) and `tools/terms.json` (translated item, skill and place names).',
  'Regenerate this page with `node tools/glossary-md.js`.',
  '',
  '## Style',
  '',
  ...Object.entries(g.style || {}).map(([k, v]) => `- **${k}:** ${v}`),
  '',
  '## Fixed terms',
  '',
  '| English | עברית |',
  '|---|---|',
  ...Object.entries(g.terms).sort(([a], [b]) => a.localeCompare(b)).map(([en, he]) => `| ${esc(en)} | ${esc(he)} |`),
  '',
];
if (Object.keys(terms).length) {
  lines.push('## Names from the game (items, skills, places)', '', '| English | עברית |', '|---|---|');
  for (const [en, he] of Object.entries(terms).sort(([a], [b]) => a.localeCompare(b))) lines.push(`| ${esc(en)} | ${esc(he)} |`);
  lines.push('');
}
fs.writeFileSync(path.join(root, 'glossary.md'), lines.join('\n'));
console.log(`glossary.md: ${Object.keys(g.terms).length} fixed terms, ${Object.keys(terms).length} game names`);
