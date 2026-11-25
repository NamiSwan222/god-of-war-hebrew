# God of War (2018): Hebrew translation (fan project)

A Hebrew translation of **God of War** (PC, Steam app 1593500, the 2022 port) for the
[Tirgumim launcher](https://github.com/NamiSwan222/tirgumim). It covers every string in the game's text table: menus,
settings, HUD, tutorials, items, skills, runes, armour, lore, map names, quests and all subtitles. That is 28,992
strings (19,408 unique texts, about 132,000 English words).

Unofficial fan project. Not affiliated with or endorsed by Sony Interactive Entertainment or Santa Monica Studio.
It claims no rights in the game; you need your own copy. This repository contains only our tools and our Hebrew
text. It contains no game files and no original English text.

## Status

| part | state |
|---|---|
| Text pipeline: extract → translate → coverage → build | ✅ works on the real game files (byte-identical rebuild) |
| Launch-only activation: proxy `version.dll` + Steam argument | ✅ tested in the real game (Steam build 11168363) |
| Hebrew font: glyphs added to the game's SDF fonts | ✅ seen in game: main menu renders correctly |
| Right to left: visual order, spaces, mixed text | ✅ seen in game (main menu) |
| Translation | ✅ 100%: 28,733 / 28,733 strings (`node tools/cli.js coverage`) |
| Subtitle and description line widths (`tools/layout.json`) | ⚠️ set from the font size, not yet checked in a cutscene |
| Text drawn into textures (logos, a few images) | ❌ not done |

Release 0.1.0 is the first complete version. Report lines that are too long or wrapped badly, and `tools/layout.json`
gets tuned.

## How it works

- **Text.** All player-visible text lives in one file, `exec/wad/pc_le/r_lang_en.wad`, in an uncompressed entry
  `MSGS_TXT`: `*<id>*` lines, each followed by its text. Subtitles start with `[[S:<speaker>:<sound>:<from>-<to>]]`,
  hints with `[[D::...]]`. Button icons are `[R3]` / `[EvadeButton]`, and menu line breaks are the two characters
  `\n`. Formats are in `tools/wad.js`, `tools/msgs.js`, and `tools/smf.js`; texture descriptor fields in `tools/font.js`.
- **Right to left.** The build wraps each line itself (`tools/layout.json`) and stores it reversed (`tools/rtl.js`).
  Button tokens, `%d`, numbers and Latin abbreviations stay readable. The engine still has the PS4 Arabic layout
  path, and it fires on any Hebrew-block character: it reorders runs, keeps letters in stored order, and drops the
  spaces between Hebrew words (tested in game). So the build stores each Hebrew letter as a Private Use Area character
  (U+E000-U+E01A, `tools/pua.js`). The fonts carry the Hebrew glyphs under those code points, and the engine lays
  the text out as plain left-to-right text.
- **Font.** The game's fonts (Sony = body text, Copperplate = headings, GodOfWar = titles) are signed-distance-field
  atlases inside the same wad. The build renders the missing Hebrew letters as SDF glyphs at the same size and edge
  as the game's own glyphs (`tools/font/glyphs.py`). It doubles each atlas to 1024×1024 and adds the glyph records
  (`tools/font.js`). Source fonts are set in `tools/fonts.json`.
- **Hebrew only from the launcher.** The pack adds two files and changes no game file:
  - `version.dll`: a proxy (Rust, `tools/proxy`) that passes every call to Windows' own `version.dll`. When the game
    runs with the argument `-tirgumim-he`, it redirects opens of `r_lang_en.wad` to the Hebrew copy. Without the
    argument it does nothing.
  - `tirgumim/he/r_lang_en.wad`: the Hebrew copy, made on your PC from your own file by a bsdiff patch.

  The launcher starts the game with `steam -applaunch 1593500 -tirgumim-he`. A normal Steam start has no argument,
  so the game is the original English one. The redirect hooks `ntdll` file opens, because the game does not open its
  wads through its import table. In game, keep **text language = English**.

## Translating

- Hebrew lives in `translation/he.json` as `{ id: { src, he } }`, in normal reading order. `src` is a hash of the
  English it was translated from, so a game update shows which lines changed.
- Rules, voices and examples: `tools/TRANSLATING.md`. Terms: `glossary.md`, built from `tools/glossary.json` and
  `tools/terms.json`.
- Work in batches: `node tools/batches.js make` → translate `work/batches/in/*.json` into `work/batches/out/` →
  `node tools/batches.js check` → `node tools/batches.js merge`.
- `node tools/cli.js coverage --list` lists every string that is still missing, stale, has English words left, or
  whose codes (`%d`, `[R3]`, `\n`) differ from the English. It exits 1 until coverage is 100%.

## Build (Windows)

Needs Node 20+, Python 3 with Pillow and numpy, Rust (MSVC toolchain), and the game installed from Steam.

```powershell
npm test
node tools/cli.js extract          # your English text -> work/source/en.json (never committed)
node tools/cli.js build            # -> work/build/r_lang_en.wad (Hebrew text + Hebrew font glyphs)
cargo build --release --manifest-path tools/proxy/Cargo.toml --target-dir work/proxy-target
# the launcher's pack tool: copy work/proxy-target/release/version.dll to pack/files/version.dll first
npm run make-pack --prefix <launcher> -- pack/pack.config.json --game-dir "<GodOfWar install>" --out out/god-of-war-he-0.1.0.zip
```

Rebuild after a game update.

## Licences and credits

- Code and Hebrew text: Tirgumim, MIT.
- Formats: WAD layout from [GOWTool](https://github.com/kainotoa/GOWTool) (MIT) and the QuickBMS script by
  NoobInCoding on ZenHAX. `MSGS_TXT` from Gaymocoder's Habr article (2025). SMF3 fonts and the texture descriptor
  fields were worked out here.
- Fonts: Noto Sans Hebrew, Frank Ruhl Libre and David Libre, all SIL Open Font License 1.1 (`fonts/src/OFL-*.txt`).
