# FreeCell — builder notes

`/freecell/` — standard FreeCell on the Solitaire site shell, for the 65+
phone audience: tap-to-move, big cards, numbered deals, unlimited undo and
hints, 14-language UI, no timer.

## What it does

- **Deals** use the Microsoft algorithm (`msRand` / `msShuffle` in
  `src/game/freecell.js`): the C runtime LCG, deck A♣ A♦ A♥ A♠ 2♣ …, dealt
  round-robin. Deal #1 therefore reads `JD 2D 9H JC 5D 7H 7C 5H` across the
  first row (column 1 top-down is `JD KD 2S 4C 3S 6D 6S`) — the widely
  published layout; #617 and #11982 are checked too. New game picks 1–32000
  and never #11982 (the unwinnable one); Settings accepts 1–999,999 and
  has **Replay this deal**; the win modal offers **Choose a deal**.
- **Rules**: cascades build down in alternating colours, anything on an
  empty cascade, one card per cell, foundations up by suit. Run moves obey
  `(empty cells + 1) × 2^(empty cascades not counting the destination)`;
  the plate under the table says "You can move N cards at once", and a
  too-long run tapped shakes and explains how many can move.
- **Tap** (Move it for me): foundation → a build onto an occupied cascade
  (longest run first) → for a lone card a free cell, for a King or a run
  the empty column → the empty column as a last resort. A cell is never
  chosen while a build exists; a whole cascade is never moved into another
  empty cascade. The status says where the card went. "Let me choose"
  and drag work exactly as in Solitaire; tapping a tray / Home pile /
  empty column places the picked-up card.
- **Safe autoplay** after every move (Ace/2 always; higher cards only when
  both opposite-colour cards one lower are Home), and a full auto-finish
  once every cascade runs downward.
- **Hint** priority: foundation → a move that empties a cascade or frees a
  cell → a build that uncovers something (cards a foundation needs first)
  → a King/run to an empty column → a single card into a cell. Hints are
  routed through `ads.requestRewardedHint()`; `showInterstitial("game_over")`
  runs before the win modal, `showInterstitial("new_game")` before a
  confirmed re-deal.
- **Languages**: `src/i18n/strings.js` (English only, translator adds the
  rest), `/i18n/common.js` for shared words. Every string on screen goes
  through `i18n.t()` / `data-i18n`; the engine returns hint *descriptors*
  (`describeHint` → `{ key, card, count, dest }`) and main.js composes the
  sentence, so no English lives in JS. The status line remembers its key
  and re-speaks itself on a language change. The board is `dir="ltr"`.
- **Analytics**: `game_start` once per deal (and on first load without a
  save; none on restore), `game_win`, `cross_game_click`.
- **Storage**: `freecell.v1.save|settings|stats`, every field validated
  (a save must hold all 52 cards exactly once).

## Decisions

- "Game in progress" (for the New-game confirm) means the player has made
  a move (`history.length > 0`), not that cards flew Home by themselves
  after the deal.
- On short screens (wide but < 600px tall) the felt panel is narrowed to
  hug the height-capped 44px cards instead of leaving a field of felt.
- The site's `.skip-link { left:-9999px }` makes the document scrollable
  leftward under `dir="rtl"` (the page slid 1000px sideways in Arabic);
  `#fc-skip` parks it on the inline-start side instead. Nothing outside
  the game folder was changed.
- Toasts sit at the bottom of the screen so "Your game is back" never
  covers the status line on a phone.
- The plate never claims more movable cards than remain on the table.

## Known gaps

- Only English strings exist until the translator adds the other 13.
- Landscape phones (844×390) fit the table but the toolbar is below the
  fold, as DESIGN.md accepts. Laptops and iPad landscape (vh < 900) now
  cap the cards from the measured height so the toolbar is on screen.
- The thumbnail shows a 34px band of dark felt under the table because a
  phone-width table is wider than it is tall.

## How to run

    node freecell/test/run.js                 # rules, fuzz, page, strings (37 tests)
    python3 tools/qa/freecell_qa.py           # browser QA, port 8131, screenshots in scratchpad/fc
    python3 tools/qa/freecell_qa.py --shots   # only the 7 viewports + Arabic/German
    python3 tools/qa/freecell_thumbs.py       # regenerates og-image.png and /freecell-thumb.jpg

`test/solver.js` is a dev-only best-first solver used by the tests to
prove deal #1 is winnable under these rules (a scripted solution replayed
through `applyMove`); hint-following alone wins deals 18 and 28 of the
first 50.

## Tester findings

Torture-tested the rules under node (`test/fuzz.test.js`: 200 random
deals × up to 300 random legal moves from the engine's own enumeration,
every table invariant checked after every move, plus `autoMoveTarget`'s
stated preferences and the safe-autoplay rule on every position) and the
page with Playwright at the seven viewports, with drags, both tap modes,
junk deal numbers and language switching. Everything below was fixed in
this folder and has a unit test or a QA assertion.

**Found and fixed**

- **Hint said "No moves left — try Undo" while moves existed**
  (`src/game/freecell.js findHint`, found by the fuzz on deal 21035): with
  all four cells full, one empty column and no build anywhere, the hint
  had no step for a King parked in a cell (step 4 only looked at
  cascades) and nothing at all for a single card into the empty column
  (step 5 needs a free cell). Step 4 now takes a cell King first; a new
  step 6 offers the card covering the lowest needed card, then a cell
  card, then the lowest top card, into the empty column; a final fallback
  returns any legal, non-pointless move. "No moves left" is only ever
  said when it is true. Regression test in `fuzz.test.js`.
- **Toolbar below the fold on laptops** (`src/main.js measure()`): the
  height cap for wide screens under 900px tall was `(vh − 120) / 8`,
  which ignores the real header + goal + status and left Undo at y ≈ 844
  on 1024×768 and 1280×800. The cap now solves the card width from the
  measured table top per DESIGN §2 (`availH = vh − tableTop − 56 − 32`,
  table ≈ 66 + 6.45·cardW), floor 64px. Cards go 79 → 64 / 69 px on those
  two sizes and the whole game, controls included, fits without a scroll.
  When the height (not the width) sets the size the felt panel now hugs
  the eight columns, as it already did on landscape phones, instead of
  floating a 64px deck in a 744px field of green. QA asserts the toolbar
  bottom ≤ innerHeight there.
- **Plate could cover a long column in long languages** (`render()`):
  the table height used the plate height measured once at layout time
  (34px); German / Russian / Indonesian wrap the plate to two lines
  (46–48px on a phone). The plate is now measured after its words are
  set, on every render. QA forces a tall plate and checks no card sits
  under it.
- **Toolbar labels clipped from 560px up** (`style.css .fc-controls`):
  `flex: 1 1 0; min-width: 0; white-space: nowrap` cut "Rückgängig
  machen" / "Einstellungen" at the button edge on every wide viewport.
  Now `min-width: auto; white-space: normal`: a label wraps to two lines
  inside its 56px button, a single word too wide for a quarter row pushes
  the last button to a second row, nothing is ever clipped. (Solitaire's
  `.sol-controls` has the same latent issue — outside this folder.) QA
  injects the German labels at every viewport and checks
  `scrollWidth ≤ clientWidth` and no page overflow.
- **A picked-up card lost its gold ring on rotate / resize / language
  change** (`render()` called `clearHighlights()` and kept `selected`
  set, so the next tap placed an invisible selection). Render re-applies
  the selection and its targets. QA resizes mid-pick and checks.
- **Safe cards left waiting after a restore**: a save written just
  before autoplay ran (tab closed mid-flight) restored with an Ace on top
  of a column and no autoplay until the next move. Restore now runs the
  safe autoplay like a move does. QA restores such a save and checks the
  Aces go Home with no `game_start`.
- **Plate text 15px on phones** → 16px everywhere (DESIGN §1.2 / §3.3
  floor for a line read at a glance). It still fits one line at 375px.
- **Empty-column target ring**: the solid gold `border-color` swallowed
  the dashed "empty place" outline on Home piles and empty columns; the
  border goes transparent under `.is-target.is-empty` so dashed = empty
  slot everywhere, as on the trays.

**Design grade (55+ checklist, all seven viewports)**

Passes: toolbar 56px with ≥ 16px gaps, words on every button; goal 18px
and status 19px/600 with reserved height; card index 16.3px at 375px
(spec ≥ 14), 24–30px on tablets; captions Georgia 15px/700 uppercase
≈ 4.2:1 on felt; plate 16px/600 ivory on the dark band, well over 4.5:1;
trays read as sunken and Home piles as raised outlines with the faint A —
unmistakably two kinds of place; selection is gold and only gold, legal
targets glow, hint pulses; illegal moves shake and explain in words; no
timer; disabled buttons dashed and legible; court cards at 40–45px show
the framed letter clearly; no horizontal overflow anywhere; RTL keeps the
board LTR; reduced-motion block present.

**Remains / notes for the translator and the site**

- Only English strings exist. Status sentences must stay ≤ ~70
  characters: a three-line status (tested with a long German sentence)
  grows the box and pushes the table down. The `.fc-controls` wrap rule
  above copes with long button labels; captions "Free cells" / "Home"
  have room for ≈ 4 columns' width (a 12-letter uppercase word at 375px).
- Under `dir="rtl"` with English strings the sentence punctuation flips
  ("!Deal 617 … Good luck") — an artefact of English in an RTL page that
  disappears once Arabic strings exist.
- The header's "Play Mahjong Solitaire →" link is a site-stylesheet
  element (pale blue on green, small); out of this folder's scope.
- Choose mode: tapping a card that cannot take the picked-up card picks
  that card up instead (same as Solitaire); the status names the new
  card, so nothing is silent, but it does not say why the first move was
  refused.
- On the iPhone SE (375×667) the second toolbar row's bottom 12px sit
  under the fold; the phone scrolls, as DESIGN accepts.
