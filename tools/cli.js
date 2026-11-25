#!/usr/bin/env node
// node games/god-of-war/tools/cli.js <command>
//   extract [installDir]     English text from your install -> work/source/en.json
//   queue [count]            print the next untranslated strings as JSON
//   apply <batch.json>       merge translations ([{id, he}] or {id: he}) into translation/he.json
//   coverage [--list]        how much is translated; exits 1 until 100%
//   build [installDir]       build work/build/r_lang_en.wad
// installDir defaults to the Steam install of app 1593500.
const fs = require('fs');
const path = require('path');
const { findGame } = require('./steam');
const pipeline = require('./pipeline');

const ROOT = path.join(__dirname, '..');

function installDir(arg) {
  const dir = arg || findGame();
  if (!dir) throw new Error('God of War (Steam app 1593500) is not installed. Pass the install folder as an argument.');
  return dir;
}

function main([cmd, arg, ...rest]) {
  switch (cmd) {
    case 'extract': {
      const out = pipeline.extract(installDir(arg), ROOT);
      console.log(`Extracted ${out.count} strings to work/source/en.json`);
      return 0;
    }
    case 'queue':
      console.log(JSON.stringify(pipeline.queue(ROOT, Number(arg) || 100), null, 2));
      return 0;
    case 'apply': {
      const n = pipeline.apply(ROOT, JSON.parse(fs.readFileSync(arg, 'utf8')));
      console.log(`Applied ${n} translations`);
      return 0;
    }
    case 'coverage': {
      const r = pipeline.coverage(ROOT);
      console.log(`Translated ${r.translated}/${r.total} (${r.percent}%) - missing ${r.missing.length}, stale ${r.stale.length}, still English ${r.english.length}, codes differ ${r.codes.length}, unknown ids ${r.unknownIds.length}`);
      if (arg === '--list' || rest.includes('--list')) {
        for (const id of r.missing) console.log(`missing  ${id}`);
        for (const id of r.stale) console.log(`stale    ${id}`);
        for (const e of r.english) console.log(`english  ${e.id}: ${e.words.join(', ')}`);
        for (const e of r.codes) console.log(`codes    ${e.id}: en [${e.en}] he [${e.he}]`);
        for (const id of r.unknownIds) console.log(`unknown  ${id}`);
      }
      return r.complete ? 0 : 1;
    }
    case 'build': {
      const r = pipeline.build(installDir(arg), ROOT);
      console.log(`Built work/build/r_lang_en.wad: ${r.replaced}/${r.total} strings in Hebrew, ${r.stale} stale skipped (${r.sizeBefore} -> ${r.sizeAfter} bytes)`);
      for (const f of r.fonts) console.log(`  font ${f.font}: +${f.added} glyphs, atlas ${f.atlas}`);
      return 0;
    }
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 8).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      return cmd ? 1 : 0;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
