// Adds Hebrew glyphs to the game's SDF fonts inside r_lang_en.wad.
// For each font in tools/fonts.json: render the missing characters with tools/font/glyphs.py
// (signed distance field, same scale and edge as the game's glyphs), double the atlas height,
// pack the new glyphs into the new half, and add their records to the font's SMF3 metrics.
// Texture layout: linear 8-bit (the PS4 tile-mode field is ignored on PC), width*height bytes + 12 trailing bytes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { parseSmf, writeSmf } = require('./smf');

const TEX = 0x80a1001d; // texture payload entry type
const DESC = 0x80210001; // texture descriptor entry type

// Descriptor fields that depend on the texture size (found by comparing 512 KB, 2 MB, 4 MB atlases).
function resizeDescriptor(desc, width, height) {
  const d = Buffer.from(desc);
  const size = width * height;
  if (size % 0x40000) throw new Error(`font: atlas ${width}x${height} is not a multiple of 256 KB`);
  d.fill(size / 0x40000, 0x4c, 0x5c);
  d.writeUInt16LE(size >>> 16, 0x62);
  d.writeUInt32LE(size, 0x70);
  d.writeUInt32LE(size, 0x90);
  const dw2 = d.readUInt32LE(0x7c);
  d.writeUInt32LE(((dw2 & 0xf0000000) | ((height - 1) << 14) | (width - 1)) >>> 0, 0x7c);
  return d;
}

function renderGlyphs(root, job) {
  const key = crypto.createHash('sha1').update(JSON.stringify(job)).update(fs.readFileSync(path.join(__dirname, 'font', 'glyphs.py'))).digest('hex').slice(0, 16);
  const dir = path.join(root, 'work', 'fonts');
  const out = path.join(dir, `${key}.json`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(dir, { recursive: true });
    const jobFile = path.join(dir, `${key}.job.json`);
    fs.writeFileSync(jobFile, JSON.stringify(job));
    const py = process.env.PYTHON || 'py';
    const args = py === 'py' ? ['-3', path.join(__dirname, 'font', 'glyphs.py'), jobFile, out] : [path.join(__dirname, 'font', 'glyphs.py'), jobFile, out];
    execFileSync(py, args, { stdio: 'pipe' });
  }
  return JSON.parse(fs.readFileSync(out, 'utf8')).glyphs;
}

// Simple shelf packer inside [0,width) x [top,height).
function pack(glyphs, width, top, height) {
  const order = [...glyphs].sort((a, b) => b.h - a.h);
  let x = 0;
  let y = top;
  let shelf = 0;
  const pos = new Map();
  for (const g of order) {
    if (x + g.w > width) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    if (y + g.h > height) throw new Error('font: Hebrew glyphs do not fit in the atlas');
    pos.set(g, { x, y });
    x += g.w;
    shelf = Math.max(shelf, g.h);
  }
  return pos;
}

/**
 * wad: parsed wad (modified in place). chars: string of characters the text needs.
 * fontsConfig: { "<SMF font name>": { font, weight } }. Returns a report per font.
 */
function applyHebrewFonts(wad, root, chars, fontsConfig) {
  const report = [];
  for (const smfEntry of wad.entries.filter((e) => e.name.startsWith('SMF_'))) {
    const smf = parseSmf(smfEntry.data);
    const cfg = fontsConfig[smf.name];
    if (!cfg) continue;
    const texName = `${smf.name.toLowerCase()}_en`;
    const tex = wad.entries.find((e) => e.name === texName && e.type === TEX);
    const desc = wad.entries.find((e) => e.name === texName && e.type === DESC);
    if (!tex || !desc) throw new Error(`font: no texture ${texName} for font ${smf.name}`);

    const have = new Set(smf.glyphs.map((g) => g.cp));
    const missing = [...new Set(chars)].filter((c) => !have.has(c.codePointAt(0)) && c.trim());
    if (!missing.length) continue;
    const capH = smf.glyphs.find((g) => g.cp === 72).h / 8;
    const fontPath = path.isAbsolute(cfg.font) ? cfg.font : path.join(root, cfg.font);
    const glyphs = renderGlyphs(root, { font: fontPath, axes: cfg.axes, capHeight: capH, chars: missing.join(''), weight: cfg.weight || 0, slope: 17, pad: 8 });

    const W = smf.atlasWidth;
    const H = smf.atlasHeight;
    const H2 = H * 2;
    const pos = pack(glyphs, W, H, H2);
    const pixels = Buffer.alloc(W * H2 + 12);
    tex.data.copy(pixels, 0, 0, W * H);
    tex.data.copy(pixels, W * H2, W * H, W * H + 12);
    for (const g of glyphs) {
      const { x, y } = pos.get(g);
      const bmp = Buffer.from(g.data, 'base64');
      for (let r = 0; r < g.h; r++) bmp.copy(pixels, (y + r) * W + x, r * g.w, (r + 1) * g.w);
      smf.glyphs.push({
        x: Math.round((x + g.inkX) * 8),
        y: Math.round((y + g.inkY) * 8),
        h: Math.round(g.top * 8),
        a: Math.round(-g.bottom * 8),
        b: Math.round(-g.left * 8),
        w: Math.round(g.right * 8),
        advance: Math.round(g.advance * 8),
        pad: 0,
        cp: g.cp,
        kernCount: 0,
        kernStart: 0,
      });
    }
    smf.header.writeUInt16LE(H2, 0x4a);
    smfEntry.data = writeSmf(smf);
    tex.data = pixels;
    desc.data = resizeDescriptor(desc.data, W, H2);
    report.push({ font: smf.name, added: glyphs.length, atlas: `${W}x${H2}` });
  }
  return report;
}

module.exports = { applyHebrewFonts, resizeDescriptor, pack };
