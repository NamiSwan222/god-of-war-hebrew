// Text pipeline tests on a synthetic r_lang_en.wad (no game files needed).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseWad, writeWad, findEntry, HEADER } = require('../wad');
const { parseMsgs, writeMsgs, splitTags } = require('../msgs');
const pipeline = require('../pipeline');

function entry(name, data, type = 0x00010002) {
  const h = Buffer.alloc(HEADER);
  h.writeUInt32LE(type, 0);
  h.writeUInt32LE(data.length, 4);
  h.writeUInt32LE(0xdeadbeef, 8); // unknown fields must survive untouched
  h.write(name, 0x18, 'latin1');
  const pad = data.length ? (16 - (data.length % 16)) % 16 : 0;
  return Buffer.concat([h, data, Buffer.alloc(pad)]);
}

const MSGS = [
  '*100000*', '[[S::vo_lvl_pro_s010_010_kra_stem:1537-3447]]Boy. Stay close.',
  '*100001*', 'Press R2 to throw the Leviathan Axe.',
  '*100002*', '{0}',
  '*100003*', 'Hacksilver: 250',
  '',
].join('\r\n');

function fakeWad() {
  return Buffer.concat([
    entry('WAD_R_LANG', Buffer.alloc(0)),
    entry('MSGS_TXT', Buffer.from(MSGS, 'utf8')),
    entry('OTHER_BLOB', Buffer.from([1, 2, 3, 4, 5])),
  ]);
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tirgumim-gow-text-'));
  const installDir = path.join(root, 'GodOfWar');
  fs.mkdirSync(path.join(installDir, path.dirname(pipeline.LANG_WAD)), { recursive: true });
  fs.writeFileSync(path.join(installDir, pipeline.LANG_WAD), fakeWad());
  const gameDir = path.join(root, 'plugin');
  fs.mkdirSync(path.join(gameDir, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'glossary.json'), path.join(gameDir, 'tools', 'glossary.json'));
  return { installDir, gameDir };
}

test('wad: parse + write of an untouched file is byte-identical', () => {
  const buf = fakeWad();
  const wad = parseWad(buf);
  assert.deepStrictEqual(wad.entries.map((e) => e.name), ['WAD_R_LANG', 'MSGS_TXT', 'OTHER_BLOB']);
  assert.ok(writeWad(wad).equals(buf));
});

test('wad: a grown payload gets a new size and 16-byte alignment, other entries intact', () => {
  const wad = parseWad(fakeWad());
  findEntry(wad, 'MSGS_TXT').data = Buffer.from('x'.repeat(37));
  const out = writeWad(wad);
  const again = parseWad(out);
  assert.strictEqual(findEntry(again, 'MSGS_TXT').data.toString(), 'x'.repeat(37));
  assert.deepStrictEqual([...findEntry(again, 'OTHER_BLOB').data], [1, 2, 3, 4, 5]);
  assert.strictEqual(again.entries[1].header.readUInt32LE(8), 0xdeadbeef);
  assert.strictEqual(out.length % 16, 0);
});

test('msgs: parse + write is byte-identical (CRLF, BOM)', () => {
  for (const text of [MSGS, `﻿${MSGS}`, MSGS.replace(/\r\n/g, '\n'), `header\n${MSGS.replace(/\r\n/g, '\n')}`]) {
    const buf = Buffer.from(text, 'utf8');
    assert.ok(writeMsgs(parseMsgs(buf)).equals(buf), JSON.stringify(text.slice(0, 20)));
  }
  const m = parseMsgs(Buffer.from(MSGS));
  assert.strictEqual(m.entries[0].value, '[[S::vo_lvl_pro_s010_010_kra_stem:1537-3447]]Boy. Stay close.');
  assert.deepStrictEqual(splitTags(m.entries[0].value), { tags: '[[S::vo_lvl_pro_s010_010_kra_stem:1537-3447]]', text: 'Boy. Stay close.' });
});

test('extract -> queue -> apply -> coverage -> build', () => {
  const { installDir, gameDir } = setup();
  const before = fs.readFileSync(path.join(installDir, pipeline.LANG_WAD));
  pipeline.extract(installDir, gameDir);

  const q = pipeline.queue(gameDir, 10);
  assert.deepStrictEqual(q.map((i) => i.id), ['100000', '100001', '100003']); // '{0}' needs no translation
  assert.strictEqual(q[0].en, 'Boy. Stay close.');
  assert.strictEqual(q[0].subtitle, true);
  assert.strictEqual(q[1].glossary['Leviathan Axe'], 'גרזן הלוויתן');

  let cov = pipeline.coverage(gameDir);
  assert.strictEqual(cov.total, 3);
  assert.strictEqual(cov.complete, false);

  pipeline.apply(gameDir, [{ id: '100000', he: 'ילד. הישאר קרוב.' }, { id: '100001', he: 'לחץ R2 כדי להטיל את גרזן the הלוויתן.' }]);
  cov = pipeline.coverage(gameDir);
  assert.deepStrictEqual(cov.missing, ['100003']);
  assert.deepStrictEqual(cov.english, [{ id: '100001', words: ['the'] }]);

  pipeline.apply(gameDir, { 100001: 'לחץ R2 כדי להטיל את גרזן הלוויתן.', 100003: 'כסף שבור: 250' });
  cov = pipeline.coverage(gameDir);
  assert.strictEqual(cov.complete, true);
  assert.strictEqual(cov.percent, 100);

  const r = pipeline.build(installDir, gameDir);
  assert.strictEqual(r.replaced, 3);
  assert.ok(fs.readFileSync(path.join(installDir, pipeline.LANG_WAD)).equals(before), 'build must not modify the install');

  const built = parseWad(fs.readFileSync(path.join(gameDir, 'work', 'build', 'r_lang_en.wad')));
  const values = Object.fromEntries(parseMsgs(findEntry(built, 'MSGS_TXT').data).entries.map((e) => [e.id, e.value]));
  assert.strictEqual(values['100000'], '[[S::vo_lvl_pro_s010_010_kra_stem:1537-3447]].בורק ראשיה .דלי');
  assert.strictEqual(values['100001'], '.ןתיוולה ןזרג תא ליטהל ידכ R2 ץחל');
  assert.strictEqual(values['100002'], '{0}');
  assert.strictEqual(values['100003'], '250 :רובש ףסכ');

});

test('game update: changed English marks the translation stale and build skips it', () => {
  const { installDir, gameDir } = setup();
  pipeline.extract(installDir, gameDir);
  pipeline.apply(gameDir, { 100003: 'כסף שבור: 250' });
  const wadFile = path.join(installDir, pipeline.LANG_WAD);
  fs.writeFileSync(wadFile, fs.readFileSync(wadFile).toString('latin1').replace('250', '999'), 'latin1');
  pipeline.extract(installDir, gameDir);
  assert.deepStrictEqual(pipeline.coverage(gameDir).stale, ['100003']);
  assert.strictEqual(pipeline.build(installDir, gameDir).stale, 1);
});

test('long subtitles are wrapped before reversing, so lines read top to bottom', () => {
  const v = pipeline.toGameValue('[[S::x:0-1]]Long line', 'אחת שתיים שלוש', { subtitleLineChars: 9, textLineChars: 0 });
  assert.strictEqual(v, '[[S::x:0-1]]םייתש תחא\nשולש');
});

test('no subtitle tag or newline is lost: tags (with their newline) stay in front', () => {
  assert.deepStrictEqual(splitTags('[[S:SON:vo_x:1-2]]\nWhat is that?'), { tags: '[[S:SON:vo_x:1-2]]\n', text: 'What is that?' });
  assert.deepStrictEqual(splitTags('[[D::72::::::Combat]]\nPress [R3].'), { tags: '[[D::72::::::Combat]]\n', text: 'Press [R3].' });
  const v = pipeline.toGameValue('[[S:SON:vo_x:1-2]]\nWhat is that?', 'מה זה?', { subtitleLineChars: 48 });
  assert.strictEqual(v, '[[S:SON:vo_x:1-2]]\n?הז המ');
});
