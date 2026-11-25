# Fonts

The Hebrew glyphs are rendered from these fonts into the game's own SDF font atlases (see `tools/fonts.json`).

| game font | used for | Hebrew source (release) | licence |
|---|---|---|---|
| Sony | body text, subtitles, menus | Noto Sans Hebrew (variable, weight 500) | SIL OFL 1.1 |
| Copperplate | headings | Frank Ruhl Libre (variable, weight 600) | SIL OFL 1.1 |
| GodOfWar | titles | David Libre Bold | SIL OFL 1.1 |

The font files and their licence texts are in `fonts/src/` (downloaded from the official google/fonts repository).
`tools/fonts.json` picks the weight that matches each game font's stroke width.
