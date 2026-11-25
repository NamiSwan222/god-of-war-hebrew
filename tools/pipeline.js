// Hebrew text pipeline for God of War (2018):
//   extract  : user's r_lang_en.wad -> work/source/en.json   (English, never committed)
//   queue    : next untranslated strings, for a translator (human or Claude session)
//   apply    : merge a batch of translations into translation/he.json
//   coverage : list every string still in English / missing / stale
//   build    : en wad + he.json -> work/build/r_lang_en.wad (visual RTL, wrapped, Hebrew font)
// he.json stores Hebrew in normal (logical) order, without the [[S::...]] subtitle tags;
// each entry keeps a hash of the English it was translated from, so game updates show as stale.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseWad, writeWad, findEntry } = require('./wad');
const { parseMsgs, writeMsgs, splitTags } = require('./msgs');
const { toVisual, wrap, codes } = require('./rtl');
const { applyHebrewFonts } = require('./font');

const LANG_WAD = path.join('exec', 'wad', 'pc_le', 'r_lang_en.wad');
const MSGS_ENTRY = 'MSGS_TXT';
const HEAP = 10485760; // memory budget the wad declares in its WAD_R_Lang entries
const HEBREW = String.fromCodePoint(...Array.from({ length: 27 }, (_, i) => 0x05d0 + i), 0x05be, 0x05f3, 0x05f4);

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const srcHash = (text) => crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);

// root = the repo folder (games/god-of-war).
function paths(root) {
  return {
    root,
    en: path.join(root, 'work', 'source', 'en.json'),
    he: path.join(root, 'translation', 'he.json'),
    glossary: path.join(root, 'tools', 'glossary.json'),
    config: path.join(root, 'tools', 'layout.json'),
    built: path.join(root, 'work', 'build', 'r_lang_en.wad'),
  };
}

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

// Text the player reads, with markup removed. Empty result = nothing to translate.
function readable(text) {
  return text.replace(/\[\[[^\]]*\]\]|\[[A-Za-z0-9_ :]+\]|<[^>]*>|\{[^}]*\}|%[0-9]*[a-z]|%[0-9]+/g, '').trim();
}
const needsTranslation = (en) => (readable(splitTags(en).text).match(/[A-Za-z][A-Za-z']+/g) || []).some((w) => !/^[A-Z0-9]{1,5}$/.test(w));

function extract(installDir, gameDir) {
  const wadFile = path.join(installDir, LANG_WAD);
  const buf = fs.readFileSync(wadFile);
  const msgs = parseMsgs(findEntry(parseWad(buf), MSGS_ENTRY).data);
  const strings = {};
  for (const e of msgs.entries) strings[e.id] = e.value;
  const out = { gameFile: LANG_WAD, gameFileSha256: sha256(buf), count: msgs.entries.length, strings };
  writeJson(paths(gameDir).en, out);
  return out;
}

function loadEn(gameDir) {
  const en = readJson(paths(gameDir).en, null);
  if (!en) throw new Error('No English source yet: run "extract" with the game installed.');
  return en.strings;
}

// One string per item: { id, en (text without subtitle tags), subtitle, glossaryHits }.
function queue(gameDir, limit = 100) {
  const en = loadEn(gameDir);
  const he = readJson(paths(gameDir).he, {});
  const glossary = readJson(paths(gameDir).glossary, { terms: {} }).terms;
  const items = [];
  for (const [id, value] of Object.entries(en)) {
    if (!needsTranslation(value)) continue;
    const done = he[id] && he[id].src === srcHash(value);
    if (done) continue;
    const { tags, text } = splitTags(value);
    const hits = Object.keys(glossary).filter((term) => text.toLowerCase().includes(term.toLowerCase()));
    items.push({ id, en: text, subtitle: tags.startsWith('[[S:'), speaker: (tags.match(/^\[\[S:([^:]*):/) || [])[1] || undefined, glossary: Object.fromEntries(hits.map((t) => [t, glossary[t]])) });
    if (items.length >= limit) break;
  }
  return items;
}

// batch: [{ id, he }] or { id: he }.
function apply(gameDir, batch) {
  const en = loadEn(gameDir);
  const file = paths(gameDir).he;
  const he = readJson(file, {});
  const list = Array.isArray(batch) ? batch : Object.entries(batch).map(([id, text]) => ({ id, he: text }));
  let applied = 0;
  for (const { id, he: text } of list) {
    if (!(id in en)) throw new Error(`apply: unknown string id ${id}`);
    if (typeof text !== 'string' || !text.trim()) throw new Error(`apply: empty translation for ${id}`);
    he[id] = { src: srcHash(en[id]), he: text };
    applied++;
  }
  const sorted = Object.fromEntries(Object.keys(he).sort((a, b) => Number(a) - Number(b)).map((k) => [k, he[k]]));
  writeJson(file, sorted);
  return applied;
}

// Latin words allowed inside Hebrew (button names, tech terms): glossary.keepLatin + short caps.
function latinLeftovers(text, keepLatin) {
  const words = readable(text).match(/[A-Za-z][A-Za-z0-9']*/g) || [];
  return words.filter((w) => !keepLatin.has(w) && !/^[A-Z0-9]{1,5}$/.test(w));
}

function coverage(gameDir) {
  const en = loadEn(gameDir);
  const he = readJson(paths(gameDir).he, {});
  const keepLatin = new Set(readJson(paths(gameDir).glossary, { keepLatin: [] }).keepLatin || []);
  const report = { total: 0, translated: 0, missing: [], stale: [], english: [], codes: [], unknownIds: [] };
  for (const [id, value] of Object.entries(en)) {
    if (!needsTranslation(value)) continue;
    report.total++;
    const t = he[id];
    if (!t) report.missing.push(id);
    else if (t.src !== srcHash(value)) report.stale.push(id);
    else if (latinLeftovers(t.he, keepLatin).length) report.english.push({ id, words: latinLeftovers(t.he, keepLatin) });
    else if (codes(t.he) !== codes(splitTags(value).text)) report.codes.push({ id, en: codes(splitTags(value).text), he: codes(t.he) });
    else report.translated++;
  }
  report.unknownIds = Object.keys(he).filter((id) => !(id in en));
  report.percent = report.total ? Math.floor((report.translated / report.total) * 10000) / 100 : 0;
  report.complete = report.total > 0 && report.translated === report.total && !report.unknownIds.length;
  return report;
}

// Hebrew value as stored in the game: the English tags first, then wrapped visual-order text.
// Subtitles/hints break lines with a real newline, UI strings with the two characters \n.
function toGameValue(enValue, heText, config) {
  const { tags } = splitTags(enValue);
  const isSubtitle = tags.startsWith('[[S:');
  const max = isSubtitle ? config.subtitleLineChars : config.textLineChars;
  const brk = tags ? '\n' : '\\n';
  return tags + toVisual(wrap(heText, max || 0, brk));
}

function build(installDir, gameDir) {
  const p = paths(gameDir);
  const config = { subtitleLineChars: 48, textLineChars: 0, ...readJson(p.config, {}) };
  const wadFile = path.join(installDir, LANG_WAD);
  const original = fs.readFileSync(wadFile);
  const wad = parseWad(original);
  const entry = findEntry(wad, MSGS_ENTRY);
  const msgs = parseMsgs(entry.data);
  const he = readJson(p.he, {});

  let replaced = 0;
  let stale = 0;
  for (const e of msgs.entries) {
    const t = he[e.id];
    if (!t) continue;
    if (t.src !== srcHash(e.value)) { stale++; continue; }
    e.value = toGameValue(e.value, t.he, config);
    replaced++;
  }
  entry.data = writeMsgs(msgs);
  const chars = HEBREW + Object.values(he).map((t) => t.he).join('');
  const fonts = applyHebrewFonts(wad, gameDir, chars, readJson(path.join(gameDir, 'tools', 'fonts.json'), {}));
  const patched = writeWad(wad);
  if (patched.length > HEAP) throw new Error(`build: ${patched.length} bytes is over the game's ${HEAP}-byte budget for this file`);

  fs.mkdirSync(path.dirname(p.built), { recursive: true });
  fs.writeFileSync(p.built, patched);
  return { replaced, stale, fonts, total: msgs.entries.length, sizeBefore: original.length, sizeAfter: patched.length, originalSha256: sha256(original), patchedSha256: sha256(patched), out: p.built };
}

module.exports = { readable, extract, queue, apply, coverage, build, toGameValue, needsTranslation, srcHash, LANG_WAD, paths };
