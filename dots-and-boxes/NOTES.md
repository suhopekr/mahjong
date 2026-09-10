# Dots and Boxes — site build notes

`/dots-and-boxes/` on easymahjongsolitaire.com. Ported from the finished
CrazyGames portal build (`/home/claude/dab`), following
`site/CLAUDE.md` → "Adding a game (standalone, from a CrazyGames build)"
and `DESIGN.md` "Site navigation" §6.

## What it is

Join two dots to draw a line; close a box's fourth side and it is yours
**and you go again**. The whole game is in that second clause — a long
chain of three-sided boxes is a gift to whoever is made to open it, so
the interesting play is deciding when to stop taking.

- **Modes:** vs AI (Easy / Medium / Hard), two players on one device, and
  a Daily Challenge — one date-seeded board that is the same for
  everybody, with its own streak.
- **Boards:** 3×3, 5×5, 7×7, each with Quick Start (about 35% of the
  lines pre-drawn, so the first ten dull moves are gone) or Classic.
- **The AI** is chain/parity heuristics, not minimax: Hard plays the
  double cross (leaves the last two boxes of a long chain to hand the
  next one over). `src/game/ai.js` plans a whole turn at once — never
  call it move by move, see its own header.
- **Also:** turn-level undo (your move *and* the AI's), a free hint that
  highlights a safe move, 12 achievements, 4 board skins, procedural Web
  Audio sound with an on/off toggle, and no timer anywhere.

`src/` is the portal build's own structure: `core/` is game-agnostic
(grid, turn, input, audio, storage, ads), `game/` is this game
(rules, chains, ai, render, quickstart, achievements, daily, theme,
position). `src/main.js` is the only file that touches the DOM, which is
why it has no unit suite — browser QA below is what covers it.

## What changed from the portal build

Everything else is byte-for-byte the portal build. The game logic
modules (`rules`, `chains`, `ai`, `quickstart`, `turn`, `daily`,
`achievements`, `theme`, `position`, `storage`) were not touched at all,
and their 220 tests still pass unchanged.

1. **The CSP.** The inline `<style>` block moved to `./style.css`, linked
   at the same spot in the head; the `sdk.crazygames.com` script tag is
   gone. Nothing else had to change: this build never wrote a
   `style=""` attribute, in markup or through `innerHTML` (it sets
   `el.style.x`, which is CSSOM and allowed). `test/harness.js` gained
   `readPage()` — the page as a browser sees it, stylesheet inlined —
   because a couple of suites read index.html expecting the CSS in it.
2. **`src/core/ads.js` is the site's shim** (copied from
   `shuffleboard/`): every export `main.js` imports keeps its name and
   does nothing, except `requestRewardedHint()`, which resolves
   `"granted"` at once — the hint is simply free here. `main.js`'s one
   piece of ad copy, the "Ad not available" toast, is now "No hint
   available right now"; with the shim it is unreachable anyway.
   `test/ads.test.js` (5 tests) pins the shim instead of the SDK.
3. **The head block:** title (ending `| Easy Classics`), description,
   canonical, OG with `/dots-and-boxes/og-image.png`, an inline-SVG
   favicon (a 3×3 dot grid with one box closed), Vercel insights, gtag +
   `/ga-init.js`, `WebApplication` JSON-LD. The viewport meta lost
   `maximum-scale=1, user-scalable=no`: pinch zoom is a feature this
   site's 65+ audience uses.
4. **Analytics** (`trackEvent`, `game_name: "dots_and_boxes"`):
   `game_start` at the player's own entry — `startGame()` (Play,
   Rematch, "Play with a friend") and `startDailyChallenge()` — never at
   boot, because the page lands on a setup screen with a dead board
   preview behind the Play button. `game_win` fires from
   `playMoveSound()`'s `gameOver` branch (the one move that ends a game)
   when the player actually won: a draw is not a win, nor is the AI
   taking the board, but a finished two-player game is.
   `cross_game_click` comes from `wireCrossGameLinks()`, copied from the
   site's `game.js`, and `nav_open` from the two panel openers.
5. **The top bar** (DESIGN.md §6). The `<!-- games:nav -->` fence at the
   top of `<body>`, `/nav.js` loaded as a module, `body` a flex column
   with `#app` as its one flexible row. It **hides during play**
   (`body[data-nav="hidden"]`), set by `syncNav()` at the END of
   `updateHud()` — after the `hidden`/`disabled` toggles it has to
   measure against — which remeasures the canvas itself in the same
   frame whenever it changes anything. Mid-game the panel is still one
   tap away, from a word-labelled **Games** button in the game's own top
   row (`#games-btn`, hidden during setup, when the real bar is two rows
   up); it reports `nav_open` with `placement: "game_menu"`.
   `openGamesPanel()` reproduces `/nav.js`'s open steps rather than
   clicking the bar's own button, so the two placements stay
   distinguishable — closing, Escape, the focus trap and the language
   grid are all still `/nav.js`'s, keyed off the same `data-open`.
6. **The `<h1>`.** It was `<h1>Dots and Boxes</h1>` inside `#top-bar`
   next to the icon buttons. The site wants exactly one `h1`, first
   inside `<main>`, `.game-title` (§5, and `tools/nav-check.mjs`
   enforces it), so `#app` is now `<main id="app">` and the title is its
   own centred line above the actions row — which also let it grow from
   1.1rem to 17px/22px. It still disappears on a short landscape screen,
   as it did before.
7. **The bar wears this game's skin.** Unlike the other three
   standalones, this page does **not** load `/style.css` — its own
   stylesheet restates the bar and the panel in the four variables the
   board skins already own (`--bg / --panel / --text / --muted /
   --accent`, set on `<html>` by `applyActiveTheme()`), so the bar
   follows Paper, Chalkboard, Neon and Blueprint with no per-skin CSS.
   Loading the site's stylesheet would have fixed the bar cream while
   the page went dark under it, and this build uses a dozen generic
   class names (`.dot`, `.score`, `.modal-overlay`, `.settings-row`,
   `.icon-btn`, …) that the site sheet also defines.
8. **65+ pass** (the site's audience is 65+, not the portal's general
   web): every touch target went from the portal's 44px floor to 48px
   (`.icon-btn`, `.small-btn`, `.seg-btn`, `.text-link-btn`,
   `.settings-link-row`), and nothing a player reads is under ~14px any
   more — the 0.62rem player label, the 0.78rem daily/achievement lines
   and the 0.8rem button labels all went up. `BOX_FILL_ALPHA_MAX` in
   `src/game/render.js` went from 0.2 to 0.3: who owns a box is this
   game's whole feedback loop, and at 0.2 the two washes read as two
   barely tinted greys at arm's length. The dots and drawn edges keep
   their measured contrast either way (they are drawn against the board
   background, not the fill).
9. **RTL.** Choosing Arabic in the panel puts `dir="rtl"` on `<html>`.
   The bar and the panel should mirror; the game must not — it has no
   i18n runtime, so its UI is English whatever the site language is, and
   mirrored English is broken. `dir="ltr"` is pinned on the game's own
   roots (`<main id="app">`, the toast container, the four modals), the
   same rule the site's boards follow.
10. **Small fixes found while porting:** an achievement toast at
    `top: 12px` landed on the wordmark while the bar was on screen (skin
    unlocks can fire at boot, on exactly that screen) — it drops below
    the bar now; and `.nav-panel-head` needed `flex: 0 0 auto`, or on a
    390px-tall landscape screen the sticky head shrank and pushed
    `Close` out past its own bottom border.

Not copied out of the portal build: `package.json`, `assets/` (covers,
screenshots, store listing, the submission ZIP), and its `CLAUDE.md` —
which is still the reference for every design decision in `src/` and is
worth reading before changing the AI, undo, or the hit testing.

## Known gaps

- **English only.** The bar and the Games panel translate (they use the
  site's `/i18n/` through `/nav.js`), the game does not — no
  `data-i18n`, no `src/i18n/strings.js`. Same gap as the other three
  standalone builds; DESIGN.md's open items track it.
- **The modals close with an X, not the word "Close".** The site's rule
  is words on buttons; the three portal modals (achievements, skins,
  settings) keep their 48px icon button with an `aria-label`. The
  panel's own Close is a word. Left for the wider 65+ pass these
  standalones still need.
- **The settings modal scrolls on a short landscape screen** (~390px
  tall) with no visible affordance that it does — the last row ("Start")
  sits below the fold. Portal behaviour, unchanged.
- **The board panel is much taller than the grid** on a phone: the grid
  is square and `#board-wrap` takes all the height left, so a 5×5 board
  sits in a tall cream panel with slack above and below. Portal
  behaviour; hiding the bar during play gives that slack, not the board.
- **No in-progress save.** `dab-save` (localStorage, versioned, v4)
  keeps the sound setting, per-difficulty streaks, achievements, the
  daily result/streak and skins — not the board. Closing the tab
  mid-game loses that game, as on the portal.
- **No `src/i18n`, no FAQ/`.content` article, no site footer.** This is
  a standalone page: full viewport, its own stylesheet, the bar as its
  only site chrome.

## How to run its QA

```
cd dots-and-boxes && node test/run.js        # 241 tests, no browser needed
npm --prefix tools test                      # every game's suite + the static site checks
npm --prefix tools run test:site             # the same plus Playwright under the real CSP
python3 tools/qa/dab_qa.py                   # this game's browser QA (from the site root)
python3 tools/qa/dab_qa.py 375x667           # one viewport: 375x667 | 390x844 | 844x390 | 1280x800 | ar
python3 tools/qa/dab_thumbs.py               # regenerate the card thumb and the OG image
```

`tools/qa/dab_qa.py` drives the real page under `tools/serve.mjs` (so
`vercel.json`'s CSP is in force) at four viewports plus one Arabic pass,
and grades: no console/page errors or failed same-origin requests, no
horizontal overflow on any screen, 48px controls in the bar and in the
settings modal, the bar present before a game and gone during play with
the canvas really remeasured (its box changes *and* its backing buffer
matches the new CSS size), exactly one `game_start` at the player's
entry, the panel opening from both the bar and the game's own row with
the right `nav_open` placements, all twelve cards in `games.json` order
with this one `aria-current` + "Playing now", a real game played to a
finish on a 3×3 board with exactly one `game_win`, and the sound
setting and achievement count surviving a reload. It writes
`tools/qa/out/dab-*.png` — the screenshots are half the point, look at
them.

`tools/qa/dab_thumbs.py` plays a seeded two-player game to a
half-claimed board and screenshots it, so `/dots-and-boxes-thumb.jpg`
(400×400, 12 KB) and `og-image.png` (1200×630) are the deployed game and
not an illustration. `Math.random` is seeded, so re-running it gives the
same picture.
