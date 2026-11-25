// The game's text engine still has the PS4 Arabic layout path: any character from the Hebrew
// block (U+0590-U+05FF) switches a line into it. That path reverses the order of runs, keeps
// the letters inside a run in stored order, spaces letters by their ink width and drops the
// spaces between Hebrew words (tested in game, 2026-11-25). So the game never sees Hebrew code
// points: the build stores each Hebrew letter as a Private Use Area character, and the fonts
// carry the Hebrew glyphs under those PUA code points. To the engine it is plain left-to-right
// text; tools/rtl.js already puts it in visual order.
const BASE = 0xe000;
const EXTRA = { 0x05be: 0xe020, 0x05f3: 0xe021, 0x05f4: 0xe022 }; // maqaf, geresh, gershayim

function toPua(cp) {
  if (cp >= 0x05d0 && cp <= 0x05ea) return BASE + (cp - 0x05d0);
  return EXTRA[cp] || cp;
}

function fromPua(cp) {
  if (cp >= BASE && cp <= BASE + 26) return 0x05d0 + (cp - BASE);
  for (const [he, pua] of Object.entries(EXTRA)) if (pua === cp) return Number(he);
  return cp;
}

const encode = (text) => String.fromCodePoint(...[...text].map((c) => toPua(c.codePointAt(0))));
const decode = (text) => String.fromCodePoint(...[...text].map((c) => fromPua(c.codePointAt(0))));

module.exports = { toPua, fromPua, encode, decode };
