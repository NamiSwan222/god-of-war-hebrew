#!/usr/bin/env node
// Splits the untranslated English into batch files for translators, checks and merges results.
//   node tools/batches.js make [--terms]      write work/batches/in/<name>.json
//   node tools/batches.js check <name>        validate work/batches/out/<name>.json
//   node tools/batches.js merge               merge every valid out file into translation/he.json
//   node tools/batches.js terms               rebuild tools/terms.json from translated short strings
// Each unique English text is translated once and applied to every id that uses it.
// in:  { name, kind: "terms"|"text", items: [{ k, en, speaker?, kind, terms? }] }
// out: { "<k>": "<Hebrew>" }   (k = hash of the English text)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pipeline = require('./pipeline');
const { splitTags } = require('./msgs');
const { codes } = require('./rtl');

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, 'work', 'batches', 'in');
const OUT = path.join(ROOT, 'work', 'batches', 'out');
const TERMS = path.join(__dirname, 'terms.json');
const key = (text) => crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 10);
const words = (t) => t.split(/\s+/).filter(Boolean).length;
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);

// unique English text -> { k, en, ids, speaker, kind }
function units() {
  const en = readJson(pipeline.paths(ROOT).en, null).strings;
  const he = readJson(pipeline.paths(ROOT).he, {});
  const map = new Map();
  for (const [id, value] of Object.entries(en)) {
    if (!pipeline.needsTranslation(value)) continue;
    const { tags, text } = splitTags(value);
    let u = map.get(text);
    if (!u) {
      const speaker = (tags.match(/^\[\[S:([^:]*):/) || [])[1];
      const kind = tags.startsWith('[[S:') ? 'subtitle' : tags.startsWith('[[D') ? 'hint' : 'ui';
      u = { k: key(text), en: text, ids: [], speaker: speaker || undefined, kind, done: true };
      map.set(text, u);
    }
    u.ids.push(id);
    const t = he[id];
    if (!t || t.src !== pipeline.srcHash(value)) u.done = false;
  }
  return [...map.values()];
}

function termHits(text, terms) {
  const lower = text.toLowerCase();
  const hits = {};
  for (const [en, he] of Object.entries(terms)) {
    if (en.length > 2 && lower.includes(en.toLowerCase())) hits[en] = he;
  }
  return Object.keys(hits).length ? hits : undefined;
}

function make(termsOnly) {
  fs.mkdirSync(IN, { recursive: true });
  const all = units().filter((u) => !u.done);
  const isTerm = (u) => u.kind === 'ui' && words(u.en) <= 5;
  const glossary = readJson(path.join(__dirname, 'glossary.json'), { terms: {} }).terms;
  const terms = { ...glossary, ...readJson(TERMS, {}) };
  const out = [];
  const emit = (prefix, list, maxWords, maxItems) => {
    let cur = [];
    let n = 0;
    let idx = 1;
    const flush = () => {
      if (!cur.length) return;
      const name = `${prefix}${String(idx++).padStart(2, '0')}`;
      fs.writeFileSync(path.join(IN, `${name}.json`), JSON.stringify({ name, kind: prefix === 'terms' ? 'terms' : 'text', items: cur }, null, 1));
      out.push({ name, items: cur.length, words: n });
      cur = [];
      n = 0;
    };
    for (const u of list) {
      const item = { k: u.k, en: u.en, kind: u.kind };
      if (u.speaker) item.speaker = u.speaker;
      if (prefix !== 'terms') item.terms = termHits(u.en, terms);
      cur.push(item);
      n += words(u.en);
      if (n >= maxWords || cur.length >= maxItems) flush();
    }
    flush();
  };
  emit('terms', all.filter(isTerm), 4000, 1300);
  if (!termsOnly) {
    emit('ui', all.filter((u) => !isTerm(u) && u.kind !== 'subtitle'), 5500, 700);
    emit('sub', all.filter((u) => u.kind === 'subtitle'), 5500, 900);
  }
  return out;
}

function check(name) {
  const keepLatin = new Set(readJson(path.join(__dirname, 'glossary.json'), { keepLatin: [] }).keepLatin || []);
  const input = readJson(path.join(IN, `${name}.json`), null);
  if (!input) throw new Error(`no batch ${name}`);
  const output = readJson(path.join(OUT, `${name}.json`), null);
  if (!output) return { name, ok: false, problems: ['no output file'] };
  const problems = [];
  for (const it of input.items) {
    const he = output[it.k];
    if (typeof he !== 'string' || !he.trim()) {
      problems.push(`${it.k}: missing`);
      continue;
    }
    if (codes(he) !== codes(it.en)) problems.push(`${it.k}: codes differ, en [${codes(it.en)}] he [${codes(he)}]`);
    if (!/[א-ת]/.test(he) && pipeline.needsTranslation(it.en)) problems.push(`${it.k}: no Hebrew letters`);
    const latin = (pipeline.readable(he).replace(/\\n/g, '').match(/[A-Za-z][A-Za-z']+/g) || []).filter((w) => !/^[A-Z0-9]{1,5}$/.test(w));
    if (latin.length) problems.push(`${it.k}: Latin words left: ${latin.join(' ')}`);
  }
  const extra = Object.keys(output).filter((k) => !input.items.some((it) => it.k === k));
  if (extra.length) problems.push(`unknown keys: ${extra.slice(0, 5).join(' ')}`);
  return { name, ok: problems.length === 0, items: input.items.length, problems };
}

function merge() {
  const byKey = new Map(units().map((u) => [u.k, u]));
  const batch = {};
  let files = 0;
  for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((x) => x.endsWith('.json')) : []) {
    const out = readJson(path.join(OUT, f), {});
    files++;
    for (const [k, he] of Object.entries(out)) {
      const u = byKey.get(k);
      if (!u || typeof he !== 'string' || !he.trim()) continue;
      for (const id of u.ids) batch[id] = he;
    }
  }
  const n = Object.keys(batch).length ? pipeline.apply(ROOT, batch) : 0;
  return { files, applied: n };
}

// Short translated strings become terms that later batches must reuse.
function terms() {
  const en = readJson(pipeline.paths(ROOT).en, null).strings;
  const he = readJson(pipeline.paths(ROOT).he, {});
  const out = {};
  for (const [id, t] of Object.entries(he)) {
    const text = splitTags(en[id] || '').text.trim();
    if (text && words(text) <= 5 && !/[.!?]$/.test(text)) out[text] = t.he;
  }
  fs.writeFileSync(TERMS, `${JSON.stringify(out, null, 1)}\n`);
  return Object.keys(out).length;
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'make') console.table(make(arg === '--terms'));
  else if (cmd === 'check') {
    const names = arg ? [arg] : fs.readdirSync(IN).map((f) => f.replace(/\.json$/, ''));
    for (const n of names) {
      const r = check(n);
      console.log(`${r.name}: ${r.ok ? 'OK' : `${r.problems.length} problems`}`);
      if (!r.ok) for (const p of r.problems.slice(0, 40)) console.log(`  ${p}`);
    }
  } else if (cmd === 'merge') console.log(merge());
  else if (cmd === 'terms') console.log(`${terms()} terms`);
  else console.log('usage: batches.js make [--terms] | check [name] | merge | terms');
}

module.exports = { units, make, check, merge, terms, key };
