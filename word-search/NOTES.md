# Word Search — builder notes

`/word-search/` · GA `game_name: "word_search"` · CSS prefix `ws-` · storage
`wordSearch.v1.*` · port 8132 for QA.

## What it does

A themed word-search on a paper sheet laid on the site's felt table.
"Today's puzzle" (seed = local `YYYYMMDD`, theme rotating one per day) is
dealt on first visit; "New puzzle" makes a random one (seed 1–99999, shown
as "Puzzle 4,217"). Sizes: Small 8×8 (6 words ≤ 6 letters), Medium 10×10
(8 ≤ 8), Large 12×12 (10 ≤ 10). Directions: "Across and down" (default) or
"All directions" (diagonals and backwards). Sixteen English themes of 30
words in `src/game/words.js`.

Gestures: drag across a word (pointer capture, snap to the allowed
directions, nearest-centre hit-testing) **or** tap the first letter (gold
ring + gold disc, status says what to do) then the last letter. A word can
be selected either way round. Wrong selection: a short muted flash, plain
status, no penalty. Found words get a pastel capsule (DESIGN.md's eight, in
order) and the chip in the list takes the same colour and a strike-through.
Hint (through `ads.requestRewardedHint()`) pulses the first letter of an
unfound word and its chip, walking through the list on repeated presses;
unlimited. Keyboard: arrows move a cursor (drawn only under `:focus-visible`),
Enter/Space taps.

Win: status "You found them all!", `game_win`, 600 ms pause,
`showInterstitial("game_over")`, then the win modal (Play another /
Today's puzzle (hidden once today is solved) / Look at the puzzle + the
cross-game link). Save/restore in progress including found words and hint
count; the daily's completion is remembered per day in stats, and a solved
daily is shown solved (not replayed) when asked for again.

## Structure (mirrors /solitaire/)

- `index.html` — site shell; every static string carries `data-i18n`; the
  board has `dir="ltr"`; Language is the first Settings row.
- `style.css` — all `.ws-`/`#ws-`/`#word-search` scoped; textures and
  pastels declared on `#word-search`; the language grid is scoped to
  `#ws-settings-panel .lang-grid` (the settings sheet sits outside `<main>`
  as in solitaire, so `#word-search .lang-grid` would not match).
- `src/game/wordsearch.js` — pure engine: `generate(seed,size,directions)`,
  `findWord`, `hintFor`, `dailySeed`, `makeRng` (mulberry32).
- `src/game/words.js` — themes `{ id, name, words }`; `id` is the i18n key.
- `src/main.js` — layout (`measure()`), gestures, capsules, save, settings,
  language, win, analytics, `?debug=1` hook (`window.__ws`).
- `src/core/{storage,audio,ads}.js`, `src/i18n/strings.js` (English only).
- `test/` — `wordsearch.test.js`, `page.test.js`, `strings.test.js`.

## Layout decisions (measure())

- Phones (W < 480): side padding dropped, cells `floor(inner/8)` → 44px at
  375, 46 at 390, 49 at 414; letters `clamp(24, cell×0.6, 40)`.
- Landscape phone (W ≥ 600, vh < 600): cells from the height (33px for
  8×8), list beside in two columns; Small is the default whenever either
  viewport side is under 600.
- Tablets/laptops (W ≥ 600, vh < 900): cells solved from the measured
  height budget (header + goal + status + title row + toolbar) so sheet and
  toolbar share one screen; chips beside the sheet in **two** columns
  (ten stacked chips are taller than a height-capped sheet). 1024×768 →
  38px, 1280×800 → 41px.
- Portrait tablet (vh > 1.25 × W, e.g. 820×1180): the list goes *below*
  and the sheet takes the full 760px, 56px cells — DESIGN.md's "list
  beside at 820" cannot give 46px cells inside the 760px cap, so bigger
  letters won.
- Large 12×12 is offered only when the sheet's inner width ≥ 420px (32px
  cells); elsewhere the radio is present but dashed/disabled with a note.
- Closing Settings / modals focuses the toolbar button with
  `preventScroll` so a phone never scrolls the letters away.

## Site-level things worked around inside this folder

- The site's `.skip-link { left: -9999px }` is 9999px of leftward overflow
  in an RTL page, and a phone browser scrolls the whole page off to it.
  This page's skip link carries `.ws-skip` and is hidden with the clip
  pattern instead. Worth fixing in `/style.css` for every page.
- The header's cross-game link renders in browser blue on the green;
  `.ws-tagline-link` gives it the header's ivory. Same on solitaire.
- The site's `.btn { display: inline-flex }` beats the UA `[hidden]` rule;
  `#ws-win-today[hidden] { display: none }` covers the one button we hide.

## Known gaps / next steps

- **Words are English in v1.** Theme *names* translate (keys
  `themeGarden` …); the letters and the chips do not. Next content step:
  per-language word lists in `words.js` (`words: { en: [...], ko: [...] }`)
  chosen by `i18n.lang` at generate time — the engine is alphabet-agnostic
  as long as the list is single-code-point letters; the `validPuzzle`
  check in storage.js (`/^[A-Z]+$/`) and the lowercase option would need
  to follow.
- Only English strings exist; the translator adds the other 13 to
  `src/i18n/strings.js` (strings.test.js then guards the key set).
- `role="grid"` cells have no `row` wrappers; screen-reader navigation of
  the letters is by the keyboard cursor + status line rather than a true
  grid model.
- No undo (nothing to undo — a found word is never wrong).

## QA

```
node word-search/test/run.js                 # engine + page + strings (32 tests)
python3 tools/qa/wordsearch_qa.py            # play-through at 390×844 + 1280×800,
                                             # screenshots at the 7 viewports + Arabic
python3 tools/qa/wordsearch_qa.py play|shots # either half
python3 tools/qa/wordsearch_thumbs.py        # og-image.png + /word-search-thumb.jpg
```
Screenshots land in the scratchpad `ws-shots/` (override with `WS_QA_OUT`).
