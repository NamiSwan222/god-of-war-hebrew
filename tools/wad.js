// Reader/writer for God of War (2018, PC) .wad archives such as exec/wad/pc_le/r_lang_en.wad.
// Layout (from GOWTool Wad.cpp, MIT, and the QuickBMS script by NoobInCoding on zenhax):
//   no file header; entries back to back, each:
//     0x00 u32 type (u16 group + u16 type)   0x04 u32 payload size
//     0x08 16 bytes unknown (kept as-is)     0x18 name, NUL-terminated, up to 0x48 bytes
//     0x60 payload, then zero padding to the next 16-byte boundary.
// Little-endian. Unverified on a real file: the unknown 16 bytes might hold sizes/offsets that
// need updating when a payload grows. parseWad keeps every byte so writeWad(parseWad(b)) === b.
const HEADER = 0x60;
const align16 = (n) => (n + 15) & ~15;

function parseWad(buf) {
  const entries = [];
  let off = 0;
  while (off + HEADER <= buf.length) {
    const header = Buffer.from(buf.subarray(off, off + HEADER));
    const size = header.readUInt32LE(4);
    const nameEnd = header.indexOf(0, 0x18);
    const name = header.toString('latin1', 0x18, nameEnd === -1 || nameEnd > HEADER ? HEADER : nameEnd);
    const start = off + HEADER;
    if (start + size > buf.length) throw new Error(`wad: entry "${name}" at 0x${off.toString(16)} runs past end of file`);
    const next = size ? align16(start + size) : start;
    entries.push({
      name,
      type: header.readUInt32LE(0),
      header,
      origSize: size,
      data: Buffer.from(buf.subarray(start, start + size)),
      pad: Buffer.from(buf.subarray(start + size, Math.min(next, buf.length))),
    });
    off = next;
  }
  const tail = Buffer.from(buf.subarray(off));
  return { entries, tail };
}

// "autopad" entries are zero filler that makes the next entry start on a 64 KB boundary
// (textures need it). When an earlier payload grows, their size is recomputed so every entry
// after them is still 64 KB aligned. For an untouched file this gives the original sizes.
const AUTOPAD = 'autopad';
const BLOCK = 0x10000;

function writeWad(wad) {
  const parts = [];
  let off = 0;
  for (const e of wad.entries) {
    if (e.name === AUTOPAD) {
      let size = BLOCK - ((off + HEADER) % BLOCK);
      if (size === BLOCK) size = 0;
      if (size !== e.data.length) e.data = Buffer.alloc(size);
    }
    const header = Buffer.from(e.header);
    header.writeUInt32LE(e.data.length, 4);
    parts.push(header, e.data);
    const padLen = e.data.length ? align16(e.data.length) - e.data.length : 0;
    // Keep the original padding bytes when the payload size did not change.
    const pad = e.data.length === e.origSize ? e.pad : Buffer.alloc(padLen);
    parts.push(pad);
    off += HEADER + e.data.length + pad.length;
  }
  parts.push(wad.tail);
  return Buffer.concat(parts);
}

function findEntry(wad, name) {
  const found = wad.entries.filter((e) => e.name === name && e.data.length);
  if (found.length !== 1) throw new Error(`wad: expected one non-empty "${name}" entry, found ${found.length}`);
  return found[0];
}

module.exports = { parseWad, writeWad, findEntry, HEADER };
