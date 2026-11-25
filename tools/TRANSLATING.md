# Translating God of War (2018) into Hebrew

Every batch is a file `work/batches/in/<name>.json`:
`{ name, kind, items: [{ k, en, kind, speaker?, terms? }] }`.

- `kind` is `subtitle` (spoken line), `hint` (tutorial tip) or `ui` (menus, items, lore, quests).
- `speaker` is the voice: `KRATOS`, `SON` (Atreus), `MIMIR` / `MIMIRS HEAD`, `BROK`, `SINDRI`, `FREYA` / `HERMIT WITCH`,
  `BALDUR` / `STRANGER`, `MODI`, `MAGNI`, and others.
- `terms` lists the fixed Hebrew for terms that appear in the line. Use it exactly.

Write the answer to `work/batches/out/<name>.json` as **one JSON object** `{ "<k>": "<Hebrew>", ... }`, with every
`k` from the batch and nothing else. Then run `node tools/batches.js check <name>` in the `games/god-of-war` folder
and fix every problem it reports, until it says `OK`.

## Rules

1. **Natural, modern Hebrew.** Translate the meaning, not word for word. It must read like a real Hebrew game.
2. **Normal reading order.** Write Hebrew the normal way. The build reverses it for the game; never reverse it yourself.
3. **Keep the codes exactly**, the same number of times:
   - `%d`, `%s`, `%0`, `%1`: numbers or names inserted by the game.
   - Button tokens in square brackets: `[R3]`, `[EvadeButton]`, `[InteractButton]`.
   - The two characters `\n`: a line break in menus and descriptions. Keep the same count and roughly the same place.
   - In JSON, a literal backslash-n is written `\\n`. A real newline is `\n`. Keep exactly what the English has.
4. **No English words** in the Hebrew. Allowed: the codes above, and short all-caps abbreviations (HUD, HDR, DLSS,
   FSR, XP). Write names in Hebrew letters using `tools/glossary.json` (`terms`). For a name that is not there,
   transliterate it simply and consistently. Drop diacritics: Jötunheim → יוטונהיים, Týr → טיר.
5. **Glossary first.** Use `tools/glossary.json` (`terms`), `tools/terms.json` if it exists, and the item's `terms`.
   Item and skill names that appear inside descriptions must match their own translations.
6. **Voices.**
   - **Kratos:** few words, hard and formal. He calls Atreus "ילד" (Boy), never "בן".
   - **Atreus (SON):** a curious boy. He calls Kratos "אבא".
   - **Mimir:** witty, chatty, a bit cheeky. He calls Kratos "אח" (Brother).
   - **Brok:** rude and funny, curses mildly. Sindri: polite, fussy.
   - **Freya:** warm, but sharp when angry.
7. **UI** addresses the player in the masculine singular: לחץ, בחר, החזק. Keep menu items short (they must fit).
   Use the infinitive or a noun for settings and options.
8. **Item names** read as Hebrew noun phrases: "Etched Sigil of Frenzy" → "חותם חרוט של טירוף". Rarity and quality
   adjectives come after the noun.
9. **Punctuation:** use normal punctuation (`. , ! ? : - " '`). Use `'` for ג׳/צ׳/ז׳ sounds (ג'). No niqqud.
10. **Numbers** stay as digits. Roman numerals in item tiers (I, II, III, IV, V) stay as they are.
11. **Do not translate** placeholder or debug strings that are only an id or a code. If one slipped in, keep the
    codes and translate any words.

## Examples
| en | he |
|---|---|
| Press [R3] to grab stunned enemies. | לחץ [R3] כדי לתפוס אויבים מסוחררים. |
| Bones Collected: %d of %d \n\nThis ghost wants us to find... | עצמות שנאספו: %d מתוך %d \n\nהרוח הזאת רוצה שנמצא... |
| (Kratos) Boy. Stay close. | ילד. הישאר קרוב. |
| (Atreus) What's that up there? | מה זה שם למעלה? |
| Rough Leather Tunic | טוניקת עור גסה |
