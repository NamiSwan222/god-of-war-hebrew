// SMF3 font metrics (wad entries SMF_0..SMF_3 in r_lang_*.wad), worked out from the English
// files. Little-endian. Coordinates and sizes are in 1/8 pixel of the font's atlas texture.
//   0x00  "SMF3" + font name (NUL padded) ... 0x44 u32 magic 0xBE969697
//   0x48  u16 atlas width, u16 atlas height
//   0x4C..0x4F unknown, kept
//   0x50  u16 glyph count, 0x52..0x57 unknown, kept, 0x58 u16 kerning pair count
//   0x5A  glyph records, 24 bytes each, sorted by code point:
//         u16 x, u16 y, u16 h, s16 a, s16 b, u16 w, u16 advance, u16 pad,
//         u32 code point, u16 kernCount, u16 kernStart
//   then kerning pairs, 4 bytes each: u16 next code point, s16 adjust.
// The meaning of a/b (offsets) is not settled; new glyphs copy them from a similar glyph.
const HEADER = 0x5a;
const REC = 24;

function parseSmf(buf) {
  if (buf.toString('latin1', 0, 4) !== 'SMF3') throw new Error('smf: not an SMF3 file');
  const count = buf.readUInt16LE(0x50);
  const kernCount = buf.readUInt16LE(0x58);
  const glyphs = [];
  for (let i = 0; i < count; i++) {
    const o = HEADER + i * REC;
    glyphs.push({
      x: buf.readUInt16LE(o),
      y: buf.readUInt16LE(o + 2),
      h: buf.readUInt16LE(o + 4),
      a: buf.readInt16LE(o + 6),
      b: buf.readInt16LE(o + 8),
      w: buf.readUInt16LE(o + 10),
      advance: buf.readUInt16LE(o + 12),
      pad: buf.readUInt16LE(o + 14),
      cp: buf.readUInt32LE(o + 16),
      kernCount: buf.readUInt16LE(o + 20),
      kernStart: buf.readUInt16LE(o + 22),
    });
  }
  const kOff = HEADER + count * REC;
  const kerning = [];
  for (let i = 0; i < kernCount; i++) kerning.push({ cp: buf.readUInt16LE(kOff + i * 4), adjust: buf.readInt16LE(kOff + i * 4 + 2) });
  const tail = Buffer.from(buf.subarray(kOff + kernCount * 4));
  return { header: Buffer.from(buf.subarray(0, HEADER)), atlasWidth: buf.readUInt16LE(0x48), atlasHeight: buf.readUInt16LE(0x4a), name: buf.toString('latin1', 4, buf.indexOf(0, 4)), glyphs, kerning, tail };
}

function writeSmf(smf) {
  const glyphs = [...smf.glyphs].sort((p, q) => p.cp - q.cp);
  const out = Buffer.alloc(HEADER + glyphs.length * REC + smf.kerning.length * 4 + smf.tail.length);
  smf.header.copy(out, 0);
  out.writeUInt16LE(glyphs.length, 0x50);
  out.writeUInt16LE(smf.kerning.length, 0x58);
  glyphs.forEach((g, i) => {
    const o = HEADER + i * REC;
    out.writeUInt16LE(g.x, o);
    out.writeUInt16LE(g.y, o + 2);
    out.writeUInt16LE(g.h, o + 4);
    out.writeInt16LE(g.a, o + 6);
    out.writeInt16LE(g.b, o + 8);
    out.writeUInt16LE(g.w, o + 10);
    out.writeUInt16LE(g.advance, o + 12);
    out.writeUInt16LE(g.pad || 0, o + 14);
    out.writeUInt32LE(g.cp, o + 16);
    out.writeUInt16LE(g.kernCount, o + 20);
    out.writeUInt16LE(g.kernStart, o + 22);
  });
  const kOff = HEADER + glyphs.length * REC;
  smf.kerning.forEach((k, i) => {
    out.writeUInt16LE(k.cp, kOff + i * 4);
    out.writeInt16LE(k.adjust, kOff + i * 4 + 2);
  });
  smf.tail.copy(out, kOff + smf.kerning.length * 4);
  return out;
}

module.exports = { parseSmf, writeSmf };
