// Font pieces on synthetic data (no game files needed).
const test = require('node:test');
const assert = require('node:assert');
const { parseSmf, writeSmf } = require('../smf');
const { resizeDescriptor, pack } = require('../font');
const { toVisual, wrap, codes } = require('../rtl');

function fakeSmf(glyphs, kerning) {
  const buf = Buffer.alloc(0x5a + glyphs.length * 24 + kerning.length * 4);
  buf.write('SMF3Sony', 0, 'latin1');
  buf.writeUInt32LE(0xbe969697, 0x44);
  buf.writeUInt16LE(1024, 0x48);
  buf.writeUInt16LE(512, 0x4a);
  buf.writeUInt16LE(glyphs.length, 0x50);
  buf.writeUInt16LE(kerning.length, 0x58);
  glyphs.forEach((cp, i) => {
    const o = 0x5a + i * 24;
    buf.writeUInt16LE(100 + i, o);
    buf.writeUInt16LE(200, o + 2);
    buf.writeUInt16LE(349, o + 4);
    buf.writeInt16LE(-3, o + 8);
    buf.writeUInt32LE(cp, o + 16);
    buf.writeUInt16LE(i === 0 ? kerning.length : 0, o + 20);
  });
  kerning.forEach((k, i) => {
    buf.writeUInt16LE(k, 0x5a + glyphs.length * 24 + i * 4);
    buf.writeInt16LE(-7, 0x5a + glyphs.length * 24 + i * 4 + 2);
  });
  return buf;
}

test('smf: parse + write is byte-identical, new glyphs are sorted in', () => {
  const buf = fakeSmf([0x20, 0x41, 0x42], [0x41, 0x42]);
  const smf = parseSmf(buf);
  assert.strictEqual(smf.name, 'Sony');
  assert.deepStrictEqual(smf.glyphs.map((g) => g.cp), [0x20, 0x41, 0x42]);
  assert.ok(writeSmf(smf).equals(buf));
  smf.glyphs.push({ x: 1, y: 2, h: 3, a: 0, b: 0, w: 4, advance: 5, cp: 0x05d0, kernCount: 0, kernStart: 0 });
  smf.glyphs.push({ x: 1, y: 2, h: 3, a: 0, b: 0, w: 4, advance: 5, cp: 0x30, kernCount: 0, kernStart: 0 });
  const again = parseSmf(writeSmf(smf));
  assert.deepStrictEqual(again.glyphs.map((g) => g.cp), [0x20, 0x30, 0x41, 0x42, 0x05d0]);
  assert.strictEqual(again.kerning.length, 2);
});

test('texture descriptor: 1024x512 -> 1024x1024 changes exactly the size fields', () => {
  const d = Buffer.alloc(356);
  d.write('GNF ', 100, 'latin1');
  d.fill(2, 0x4c, 0x5c);
  d.writeUInt32LE(0x00080164, 0x60);
  d.writeUInt32LE(0x80000, 0x70);
  d.writeUInt32LE(0x707fc3ff, 0x7c); // values from the English sony_en descriptor
  d.writeUInt32LE(0x007fe000, 0x84);
  d.writeUInt32LE(0x80000, 0x90);
  const r = resizeDescriptor(d, 1024, 1024);
  assert.strictEqual(r.readUInt32LE(0x60), 0x00100164);
  assert.strictEqual(r.readUInt32LE(0x70), 0x100000);
  assert.strictEqual(r.readUInt32LE(0x90), 0x100000);
  assert.strictEqual(r.readUInt32LE(0x7c), 0x70ffc3ff); // same pattern as the 2048x1024 icons atlas (0x70ffc7ff)
  assert.strictEqual(r.readUInt32LE(0x84), 0x007fe000);
  assert.deepStrictEqual([...r.subarray(0x4c, 0x5c)], new Array(16).fill(4));
  // the Japanese 2048x2048 atlas, as a cross-check of the formula
  const ja = resizeDescriptor(d, 2048, 2048);
  assert.strictEqual(ja.readUInt32LE(0x7c), 0x71ffc7ff);
  assert.strictEqual(ja.readUInt32LE(0x60), 0x00400164);
});

test('pack: glyph cells never overlap and stay inside the new half', () => {
  const glyphs = Array.from({ length: 40 }, (_, i) => ({ w: 40 + (i % 7) * 5, h: 50 + (i % 5) * 4 }));
  const pos = pack(glyphs, 1024, 512, 1024);
  const rects = glyphs.map((g) => ({ ...pos.get(g), w: g.w, h: g.h }));
  for (const r of rects) assert.ok(r.x >= 0 && r.x + r.w <= 1024 && r.y >= 512 && r.y + r.h <= 1024);
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `cells ${i} and ${j} overlap`);
    }
});

test('rtl: Hebrew reversed per line; codes, buttons, numbers and line breaks kept', () => {
  assert.strictEqual(toVisual('שלום'), 'םולש');
  assert.strictEqual(toVisual('לחץ [R3] כדי לתפוס'), 'סופתל ידכ [R3] ץחל');
  assert.strictEqual(toVisual('נאספו: %d מתוך %d'), '%d ךותמ %d :ופסאנ');
  assert.strictEqual(toVisual('(קרטוס)'), '(סוטרק)');
  assert.strictEqual(toVisual('שורה א\\nשורה ב'), 'א הרוש\\nב הרוש');
  assert.strictEqual(toVisual('שורה א\nשורה ב'), 'א הרוש\nב הרוש');
  assert.strictEqual(wrap('אחת שתיים שלוש', 9, '\\n'), 'אחת שתיים\\nשלוש');
  assert.strictEqual(codes('Press [R3] %d \\n'), '%d [R3] \\n');
  assert.strictEqual(toVisual('[Icons:STRENGTH] כוח'), 'חוכ [Icons:STRENGTH]');
  assert.strictEqual(codes('Convert 100 [Icons:XP]'), '[Icons:XP]');
});
