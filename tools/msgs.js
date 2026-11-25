// Parser/writer for the MSGS_TXT entry inside r_lang_*.wad (all player-visible text).
// Format (from the Habr article by Gaymocoder, 2025): a line "*<id>*" followed by the text,
// e.g.  *100000*\n[[S::vo_lvl_pro_s010_010_kra_stem:1537-3447]](angry scream)
// Subtitles start with a [[S::<sound event>:<startMs>-<endMs>]] tag that must be kept.
// The value of an id is everything up to the next "*<id>*" line. A UTF-8 BOM, CRLF line
// endings and anything before the first id are kept, so an untouched file is rebuilt
// byte-identical. Encoding is assumed UTF-8 (unverified on a real file).

const ID_LINE = /^\*(\d+)\*$/;

function parseMsgs(buf) {
  let text = buf.toString('utf8');
  const bom = text.startsWith('﻿') ? '﻿' : '';
  if (bom) text = text.slice(1);
  const crlf = text.includes('\r\n');
  if (crlf) text = text.replace(/\r\n/g, '\n');

  const entries = [];
  let preamble = null;
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(ID_LINE);
    if (m) {
      cur = { id: m[1], lines: [] };
      entries.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    } else {
      preamble = preamble === null ? line : `${preamble}\n${line}`;
    }
  }
  return { bom, crlf, preamble, entries: entries.map((e) => ({ id: e.id, value: e.lines.join('\n') })) };
}

function writeMsgs(msgs) {
  const lines = msgs.preamble === null ? [] : [msgs.preamble];
  for (const e of msgs.entries) lines.push(`*${e.id}*`, e.value);
  let text = lines.join('\n');
  if (msgs.crlf) text = text.replace(/\n/g, '\r\n');
  return Buffer.from(msgs.bom + text, 'utf8');
}

// Splits a value into the game markup that must stay first and the text the player reads:
// [[S:SPEAKER:sound:start-end]] (subtitles) or [[D::...]] (hints), plus the newline after them.
function splitTags(value) {
  const tags = value.match(/^(?:\[\[[^\]]*\]\])*\n?/)[0];
  return { tags, text: value.slice(tags.length) };
}

module.exports = { parseMsgs, writeMsgs, splitTags };
