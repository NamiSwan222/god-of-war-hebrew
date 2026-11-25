// The game draws text left-to-right only, so Hebrew is stored "visually": each line reversed,
// so it reads right-to-left on screen. Kept in normal order inside a line:
//   Latin words/digits (R2, 100, DLSS), placeholders (%d, %0, %s), button tokens ([R3],
//   [EvadeButton]), markup ([[...]], <...>, {...}). Brackets around Hebrew are mirrored.
// Line breaks in the game text are a real newline or the two characters "\n" (UI strings);
// both are kept as they are, and lines stay in their order. Text the game would wrap itself
// would show its lines bottom-up, so wrap() breaks long lines first.

const LTR_RUN = /\[\[[^\]]*\]\]|\[[A-Za-z0-9_ ]+\]|<[^>]*>|\{[^}]*\}|%[0-9]*[a-z]|%[0-9]+|[A-Za-z0-9][A-Za-z0-9.,:%'+\-/]*[A-Za-z0-9%]|[A-Za-z0-9]/g;
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '<': '>', '>': '<', '{': '}', '}': '{', '«': '»', '»': '«' };
const BREAK = /(\\n\n|\\n|\n)/; // capture keeps the separators in split()

function lineToVisual(line) {
  const tokens = [];
  let last = 0;
  for (const m of line.matchAll(LTR_RUN)) {
    for (const ch of line.slice(last, m.index)) tokens.push(MIRROR[ch] || ch);
    tokens.push(m[0]);
    last = m.index + m[0].length;
  }
  for (const ch of line.slice(last)) tokens.push(MIRROR[ch] || ch);
  return tokens.reverse().join('');
}

function toVisual(text) {
  return text.split(BREAK).map((part, i) => (i % 2 ? part : lineToVisual(part))).join('');
}

// Breaks logical (not yet reversed) text into lines of at most maxChars at spaces, inserting
// `brk` ("\n" or the two characters "\\n"). Existing breaks are kept.
function wrap(text, maxChars, brk = '\n') {
  if (!maxChars) return text;
  return text
    .split(BREAK)
    .map((part, i) => {
      if (i % 2) return part;
      const lines = [];
      let line = '';
      for (const word of part.split(' ')) {
        if (line && line.length + 1 + word.length > maxChars) {
          lines.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      lines.push(line);
      return lines.join(brk);
    })
    .join('');
}

// Codes that must appear in a translation exactly as often as in the English.
function codes(text) {
  const found = text.match(/%[0-9]*[a-z]|%[0-9]+|\[[A-Za-z0-9_ ]+\]|\\n/g) || [];
  return found.sort().join(' ');
}

module.exports = { toVisual, wrap, codes };
