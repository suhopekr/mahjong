# DESIGN.md

> This file did not exist in this working copy — the conventions it records live
> in `CLAUDE.md` and the comment blocks of `style.css`. The section below sits
> alongside them: the 65+ rules (48px+ targets, words on buttons, never colour
> alone, system fonts only), the `:root` palette, the CSP (no inline `<style>`,
> no `style=""`).

## Site navigation

The green per-game banner (`.site-header` = `h1` + `.tagline` + a cross-game
link) is replaced by one top bar on every page and every width, and a
full-screen Games panel behind it. The site is renamed **Easy Classics**;
the domain and every page `<title>` stay as they are.

### 1. The bar — anatomy, height, sticky

**The pixel budget first.** Measured at 375×667 on `/`, `/solitaire/`,
`/word-search/`: `.site-header` is **39.75px** today (the tagline is already
`display:none` under 640px). A 56px bar plus a small `h1` is +43px at scroll
0. It only balances because the bar **scrolls away** on phones and the `h1`
block is 27px against the banner's 40px — after the first flick the phone is
**13px better off**; at scroll 0 it is 43px worse. Say that out loud in
review.

Order, left to right (logical order; §7 mirrors it for Arabic): **mark**
(24px inline SVG, 28px ≥768px, hidden under 360px) · **"Easy Classics"**
(`clamp()` 17–19px on the phone, 22px on desktop) · spacer · **Games** ·
**Language** (label = the current language's native name). Both buttons are
48px tall with a 17px label under 768px, 52px/18px above.

`--nav-h` is **56px** under 768px (48px control + 4px above/below) and **64px**
at 768px and up (52px + 6px). Nothing else goes in it — no search, no Settings
(Settings stays in the game's own toolbar).

**It scrolls away below 768px; it is sticky at 768px and up.** On a 667px
phone 56px is 8.4% of the viewport forever, it would sit over the board on the
pages that scroll to fit their table, and a fixed band along the top edge of a
canvas you drag on (pool cue, StoneFlick) is a mis-tap generator. Two existing
behaviours would also fight it: `/eight-ball-pool/` scrolls its own header off
screen at boot (`revealTable()`), and `recomputeBoardLayout()` in `game.js`
measures live element heights. Meanwhile "always reachable" is already
satisfied twice on a site-shell page — the footer's full Games column with
`aria-current`, and the win modal's cross-game links. On an iPad or desktop
none of that pressure exists, so it sticks there.

```css
:root { --nav-h: 56px; --nav-bg: var(--paper); --nav-ink: var(--ink); --nav-border: var(--felt-dark); }
@media (min-width: 768px) { :root { --nav-h: 64px; } }

.site-nav { background: var(--nav-bg); color: var(--nav-ink);
            border-bottom: 1.5px solid var(--nav-border); }
@media (min-width: 768px) {
  .site-nav { position: sticky; top: 0; z-index: 60;  /* over page, under settings(100) */
              padding-top: env(safe-area-inset-top); }  /* notch matters only when pinned */
}
.site-nav-inner {
  max-width: 1280px; margin-inline: auto;   /* same axis as .game-shell */
  min-height: var(--nav-h);
  display: flex; align-items: center; gap: 8px; flex-wrap: nowrap;
  padding-inline: max(clamp(10px, 3vw, 24px), env(safe-area-inset-left))
                  max(clamp(10px, 3vw, 24px), env(safe-area-inset-right));
}
```

The bar is **cream, not green**: the owner just deleted a green banner, so one
calm cream field with the bar reading as chrome is the point — and it lets the
two controls be ordinary site `.btn`s (ivory on deep green, 9.19:1) with no new
colour rules. The dark standalone pages override the three `--nav-*` values
only (§6). Landscape phones keep the existing short-screen rule
(`@media (max-height: 500px) and (orientation: landscape) { :root { --nav-h: 48px } }`,
44px controls) — the one place we go under 48px, and only where the
alternative is no board.

### 2. The wordmark

Text only, system font, no image, no webfont. It is an `<a href="/">`.

```css
.nav-brand {
  display: inline-flex; align-items: center; gap: 8px; min-height: 48px; padding-inline: 2px;
  min-width: 0;                             /* the ONLY flexible item in the bar */
  font-size: clamp(17px, 4.4vw, 22px); letter-spacing: 0.005em;
  color: var(--felt-dark); text-decoration: none; white-space: nowrap;
}
.nav-brand .b-easy { font-weight: 800; }
.nav-brand .b-classics { font-weight: 500; }
.nav-brand:hover .b-classics { text-decoration: underline; text-underline-offset: 3px; }
.nav-mark { width: 24px; height: 24px; flex: 0 0 24px; }
@media (min-width: 768px) { .nav-mark { width: 28px; height: 28px; flex-basis: 28px; } }
@media (max-width: 359px) { .nav-mark { display: none; } }
```

Markup: `<a class="nav-brand" href="/" id="link-crossgame-home"
data-crossgame-to="mahjong" data-placement="top_nav_brand" dir="ltr"><svg
class="nav-mark" …/><span class="b-easy">Easy</span> <span
class="b-classics">Classics</span></a>`

The mark is a 24px `rx="6"` rounded square in `--felt-dark` holding a cream
circle and an offset cream rounded rect — a piece and a card, inline SVG like
every favicon here. **The words never degrade; the mark is what goes** at
360px: a 65+ visitor recognises a name, not a glyph, and "Easy" alone is not a
brand. `dir="ltr"` because the brand is not translated and must not reorder
inside an Arabic run.

### 3. The Games button and the panel

**Button** — a plain site `.btn`, word label, never icon-only:

```html
<button class="btn nav-btn" id="nav-games" type="button" aria-haspopup="dialog"
        aria-expanded="false" aria-controls="nav-panel" data-i18n="games">Games</button>
```
```css
.nav-btn { min-height: 48px; padding: 10px 16px; font-size: 17px; white-space: nowrap; flex: 0 0 auto; }
@media (min-width: 768px) { .nav-btn { min-height: 52px; font-size: 18px; padding: 12px 20px; } }
```

**Panel** — `data-open` exactly like `.settings-panel` / `.modal-overlay`:

```css
.nav-panel { position: fixed; inset: 0; z-index: 160; display: none; background: rgba(15,36,25,0.6); }
.nav-panel[data-open="true"] { display: flex; }
.nav-panel-sheet { background: var(--paper); width: 100%; max-width: 1040px; margin-inline: auto;
                   display: flex; flex-direction: column; max-height: 100%; }
@media (min-width: 1040px) {
  .nav-panel { align-items: center; padding: 24px; }
  .nav-panel-sheet { border-radius: var(--radius-lg); max-height: calc(100vh - 48px); box-shadow: var(--shadow-md); }
}
.nav-panel-head {   /* sticky so Close survives 11 cards */
  position: sticky; top: 0; z-index: 1; min-height: var(--nav-h);
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  background: var(--paper); border-bottom: 1.5px solid var(--felt-dark);
  padding: 8px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left)); }
.nav-panel-head h2 { margin: 0; font-size: 20px; }
.nav-panel-close { margin-inline-start: auto; min-height: 48px; white-space: nowrap; }
.nav-panel-body { overflow-y: auto; overscroll-behavior: contain;
  padding: 16px max(20px, env(safe-area-inset-right))
           calc(24px + env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); }
.nav-card-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px;
                 grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
```

z-index 160 is above the mobile menu sheet (120) and settings panel (100) so
Games always wins, and below the modals (200/210) so a win modal is never
covered. Opening the panel closes settings and the menu sheet first; it is
refused while `#modal-win` is open.

**Columns** — no media queries needed: `minmax(280px, 1fr)` with 40px padding
and a 16px gap switches at **616px** (2 up) and **912px** (3 up). At 375px it
is 1 up, which is the existing horizontal `.game-card` (88px thumb, name,
one-line description, `min-height: 88px`) reused verbatim.

**Card anatomy** — the whole card is one `<a>` (house rule: no small button
inside a big clickable block). `.game-card-title` 20px/600, `.game-card-desc`
16px/500 straight from `games.json` `card.desc`, thumb 88px with
`width`/`height` attributes *and* CSS so CLS is zero.

```css
.nav-card-grid a[aria-current="page"] { border-color: var(--felt); background: #e4f2ea; }
.nav-now { display: inline-block; margin-top: 2px; font-size: 14px; font-weight: 700; color: var(--felt-dark); }
```

The current game gets `aria-current="page"` plus the words **"Playing now"**
(`.nav-now`, i18n key `playingNow`) — never the tint alone — and stays a live
link so nothing on screen is dead.

**Markup source.** `tools/sync-games.mjs` writes the panel's `<li>`s into
every page between `<!-- games:nav -->` fences, exactly as it already does for
the footer and the front-page cards. No JS lists games; `/nav.js` only opens,
closes, traps focus and runs the language grid.

**Closing.** The `Close` button in the sticky head (48px, the word, existing
i18n key `close`), Escape, and — at 1040px and up — the backdrop (counted only
when the click target is `.nav-panel` itself). Below 1040px the sheet is edge
to edge and **there is no backdrop to tap**, which is why Close is sticky and
must never scroll out of reach.

**Scrolling and focus.** 11 cards one-up is ~1150px, so the phone scrolls:
`body.nav-open { overflow: hidden }`, and the panel always opens at scroll 0 —
same order every time is what makes the list learnable. On open,
`aria-expanded="true"` and focus moves to the sheet (`role="dialog"
aria-modal="true" aria-labelledby="nav-panel-title" tabindex="-1"`) so it
announces "Games, dialog"; next Tab is Close, then card 1. Tab is trapped. On
close focus returns to `#nav-games`. Motion: a 120ms opacity fade, nothing
under `prefers-reduced-motion: reduce`, never a slide.

### 4. Language inside the panel

The bar's Language button opens the panel **and jumps to the language
section**; the authoritative 14-button grid lives **after the game cards**.

The argument for "after": the button says *Games*, so what the person tapped
for has to be under their thumb. A 14-button grid above the cards is ~340px on
a phone — it would push game 1 below the fold every single time, to serve a
setting chosen once and then stored site-wide (`site.v1.lang`). The discovery
problem "after" normally creates is already solved by the bar's permanent
language control, labelled with the **current language's own native name**
("English", "Español", "한국어") — self-describing in every language, no icon
needed — which scrolls the panel straight to the grid.

```css
.nav-lang { margin-top: 28px; padding-top: 20px; border-top: 1.5px solid var(--tile-edge); }
.nav-lang h3 { margin: 0 0 10px; font-size: 18px; }
.nav-lang .lang-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 480px) { .nav-lang .lang-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 780px) { .nav-lang .lang-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.nav-lang .lang-btn { min-height: 56px; min-width: 0; padding: 10px 8px; font-size: 17px; white-space: nowrap; overflow: hidden; }
.nav-lang .lang-btn[aria-pressed="true"] { box-shadow: 0 0 0 3px var(--accent); border-color: var(--felt); background: #e4f2ea; }
```

That is `i18n.renderPicker()` unchanged (it already emits `.btn.lang-btn` with
`aria-pressed`) and the same 2/3-up geometry the games use, so 14 names at
375px are 7 rows of 56px. The current language reads three ways:
`aria-pressed="true"`, the amber ring + green fill, and the bar's own button
already showing that name.

**The reload.** Changing the language calls `i18n.setLang()` and then reloads,
because the standalone builds and some board renderers read `site.v1.lang` at
boot. Making that not feel like a fault, in order:

1. The tapped button flips to `aria-pressed="true"` **before** anything moves,
   so the tap is acknowledged first.
2. A line under the grid, `aria-live="polite"`, in the **new** language:
   `languageReload` → "Switching to English — the page will refresh." Reserve
   its height so the grid does not jump.
3. A 250ms hold so that acknowledgement is actually seen, then
   `window.scrollTo(0, 0)` and `location.reload()` — scrolling first means the
   page comes back at the top rather than at a remembered board offset, which
   is the part that reads as a crash.
4. The panel stays open through the reload: it is opaque and full-screen, so
   the person sees a solid surface, not a flash of half-drawn board.

Worth testing per game — site-shell pages already re-render live through
`i18n.applyStatic()` + `i18n.onChange()`, so several may not need the reload at
all. Ship it as the safe default and drop it per game where the board proves
it re-renders.

### 5. What replaces the green banner

```css
.game-title { margin: 10px 0 2px; text-align: center; color: var(--felt-dark);
              font-size: 17px; font-weight: 700; letter-spacing: 0.02em; }
@media (min-width: 768px) { .game-title { font-size: 22px; margin: 14px 0 4px; } }
```

`<h1 class="game-title">Solitaire</h1>` is the first element inside `<main>`,
directly above the existing goal line. **Yes: visually small, still first in
the reading order** — the hierarchy is board-first and the h1's remaining jobs
are SEO and orientation. Not `visually-hidden`, though: someone arriving from
an ad needs to see in the page what they landed on. The two-headings risk is
handled by setting it *smaller* than the goal line (17px vs `.sol-goal`'s
18px), in `--felt-dark` rather than `--ink`, 2px apart, so they read as one
two-line block: name, then rule. Hard rule: **the h1 must not repeat a word
the goal line already carries** — where a game's `goal` string opens with its
own name, delete it from the string (all 14 languages).

Deleted from `style.css`: `.site-header`, `.site-header h1`, `.site-header
.tagline` and their link/landscape overrides; `.site-header .back-link` on
About/Privacy/Contact is replaced by the bar itself. The `tagline` i18n key
becomes unused in the header; `playMahjong` / `tryOther` stay (win modal and
`.content`). `.skip-link` moves above `.site-nav` and still targets the board.

### 6. The three standalone builds

Four Ball Billiards, StoneFlick and Shuffleboard are `html, body { height:
100%; overflow: hidden }` with `#app { height: 100% }` and their own dark
stylesheet. There is no scroll, so the bar cannot scroll away — it takes a real
row and the game gets what is left:

```css
/* in each standalone style.css, after the existing rules */
body { display: flex; flex-direction: column; }
#app { flex: 1 1 auto; height: auto; min-height: 0; }        /* was height: 100% */
.site-nav { flex: 0 0 auto; padding-top: var(--notch);       /* their capped notch var */
  --nav-bg: #131c20; --nav-ink: var(--ink); --nav-border: rgba(232,238,240,0.25); }
.site-nav .btn { background: rgba(232,238,240,0.08); color: var(--ink);
                 border-color: rgba(232,238,240,0.45); box-shadow: none; }
.site-nav .nav-brand { color: var(--ink); }
```

Flex column rather than `calc(100vh - var(--nav-h))`: these pages already lost
pixels to `100vh` on iOS once, and the notch padding makes that arithmetic
wrong twice.

**It hides during play.** `body[data-nav="hidden"] .site-nav { display: none }`,
set by each `main.js` when a table screen opens and cleared on return to
home / stage select. Two reasons: the canvas geometry is measured in JS, and a
permanent band above a surface you drag on is a mis-tap hazard. Because it is
measured, **every toggle must be followed by that game's own remeasure**
(`remeasure()` / the `ResizeObserver` path) in the same frame. Mid-game the
nav stays reachable: each game's `⋯` / pause overlay gains a `Games` item that
opens the same panel.

**`#link-crossgame-home`** ("More free games →") is deleted from the three
home screens; its id, `href="/"` and tracking move onto the bar's wordmark
(§2) — same destination, same event, better placement. These pages have no
`a[data-crossgame-to]` wiring, so copy `wireCrossGameLinks()` from `game.js`
into each `main.js`. ~~They also have no i18n runtime, so their bar is
English-only until `/i18n/` is wired in — a known gap, flagged below.~~
**Corrected after doing it:** `/nav.js` imports `/i18n/i18n.js` itself, so the
bar, the panel, the 14-language grid and the acknowledge-then-reload all work
here exactly as on a shell page — measured on all three. What stays English is
the GAME's own words, which is the real remaining gap. It is also why
`/nav.js` setting `<html dir="rtl">` has to be fenced off (see 6a).

#### 6a. What the conversion actually cost (Four Ball, StoneFlick, Shuffleboard)

Written after doing three of them, in the order the problems appeared. Every
one of these is a thing the snippet above does not say and the build needs.

**The bar's CSS was not on these pages at all.** They deliberately do not load
`/style.css` ("the game is a full-viewport layout and the two would fight"),
so `.site-nav`, `.nav-panel` and `.game-card` simply did not exist here — and
the block above is a set of *overrides* that assumes they do. The three
options were: load `/style.css`, move the nav block out of it, or copy ~300
lines into each build. Copying loses the one-implementation property the whole
bar rests on, so: **`/style.css` first, the game's own second**, the same order
every site-shell game uses. The fight is settled by cascade ORDER, not by
`@layer` — a `@layer` makes the site's `.btn` weaker than these files' own bare
`button {}` rule, which is exactly backwards. Measured, only four things leak
through and each is neutralised by name at the end of the game's stylesheet:

- `body { padding-bottom: calc(64px + …) }` under 640px (the phone action bar
  Mahjong owns) — `html, body { padding: 0 }`.
- `body { font-size: 18px/17px; line-height: 1.5 }` — the two builds that set
  `font: 15px/1.45` already win; StoneFlick sized everything at the browser
  default and has to pin `font-size: 16px; line-height: normal`.
- the notch, below.
- `--ink` and `--accent`, below.

**The panel needs `color`, not just `--ink`.** These files redefine `--ink` to
a near-white, so on the cream sheet every rule that *names* `var(--ink)` had to
be put back — but `.nav-panel-head h2` and `.nav-lang h3` have no colour of
their own and inherit from `body`. The word "Games" was invisible on its own
panel. So: `.nav-panel { --ink: #0f2419; --accent: #f2b705; color: var(--ink); }`.
Leave the MARK's two colours alone — the deep-green tile with two cream shapes
is the badge on every other page, and re-tinting it per game makes one brand
look like three.

**The notch gets paid twice.** `.site-nav { padding-top: <capped notch> }` is
right, and the game's own `#app` is still spending the same inset in its top
padding. Neutralise it *while the bar is on screen only*, and neutralise the
variable the layout maths reads rather than the padding:

```css
body:not([data-nav="hidden"]) #app { --notch: 0px; }        /* Four Ball */
body:not([data-nav="hidden"]) #app { --app-pad-t: 14px; }   /* StoneFlick */
```

**`align-self: stretch` on `.site-nav`.** StoneFlick's `body` was already
`display: flex; flex-direction: column; align-items: center` — the bar came out
shrink-wrapped to its own content, centred, floating.

**`#app { position: relative }` if the game positions chrome absolutely.**
Shuffleboard's `⋯` and its menu resolve against the initial containing block,
which used to be the top of the page; with a row above them `top: 6px` puts the
button on the bar.

**THE REMEASURE GOES LAST, not first.** This is the one that actually bit. In
Four Ball's `showScreen()` the natural place for `setNavHidden()` is the top,
next to `state.screen = name` — and there it is wrong, because the box is not
final until the rest of the function has run: taking `.front` off `#app` puts
the header row back, which is another 42px out of the board. Called first, the
canvas was measured 42px too tall and came out at **2.14 device pixels per CSS
pixel instead of 2** — every frame stretched until the next redraw. So the
toggle-and-remeasure call belongs after every other layout change the screen
switch makes. `tools/qa/standalone_nav_qa.py` catches this by reading the
canvas in the **same JavaScript task as the click** (`el.click()` then
`getBoundingClientRect()` on the next line, which forces layout): a remeasure
deferred by even one frame shows up as a bitmap that does not fit its box.

**Not every canvas grows by `--nav-h`.** StoneFlick's board is a square whose
side is `min(box width, box height, what the pull-back still has room for)`, so
on a phone the narrow axis binds and the row the bar gives back does not make
the square any bigger. It still has to be re-measured; it does not have to
grow. Assert *the remeasure* (bitmap tracks box on both axes) plus `#app`
gaining exactly `--nav-h`; assert canvas growth only for a canvas that fills
its row.

**`nav.js` has no parameterised open path.** Its public surface is the bar's own
button, so the `⋯` item does `document.getElementById("nav-games").click()` —
which means `nav_open` reports `placement: "top_nav"` from the game menu, not
the `"game_menu"` §8 asks for. Left as is rather than duplicating the open /
focus-trap / analytics logic; giving `/nav.js` an exported `open(placement)` is
the fix when someone owns that file. Two consequences to handle locally: that
button is `display: none` during play, so `/nav.js`'s "focus back to
`#nav-games`" lands nowhere — watch `#nav-panel`'s `data-open` with a
`MutationObserver` and put focus back on the menu item that was pressed.

**`dir="ltr"` on the game's root.** `/nav.js` boots the shared i18n runtime,
whose `applyStatic()` sets `<html dir="rtl">` for a visitor whose stored
`site.v1.lang` is Arabic — on a page with no i18n runtime of its own, that
flips the game's whole layout. The bar and the panel should mirror; the board
must not. `#app` gets `dir="ltr"`, and so does any overlay that lives outside
it (StoneFlick has three).

**The bar really is translated here.** `/nav.js` brings the i18n runtime with
it, so `data-i18n` on the fence's own five nodes resolves, the 14-language grid
renders, and the reload lands with the bar in the new language — verified on all
three, no console errors. Two things follow. `i18n.setLang()` calls
`applyStatic()` on the whole DOCUMENT, so any `data-i18n` attribute a portal
build happens to carry would be rewritten from the common table alone (none of
these three has one — check yours). And a bar in Korean above a game in English
is now the visible state of the gap, which is a better place for it than an
English bar on a Korean site.

**A game with no home screen.** Shuffleboard boots straight onto the board, so
"home / stage select" is not a screen there — it is the home card, the stage
picker, and the arrival screen up to the player's first shot. Deliberately NOT
the stage-clear card, which arrives every couple of minutes: the board growing
and shrinking around every result is worse than the bar being one tap away in
`⋯`. Note the home card starts its board *quietly*, so the "Play / Continue"
button on it has to hide the bar itself — there is no `startStage()` on that
path to do it.

**Two test-harness traps.**

- Never write the literal string `<body>` in a comment in the game's
  stylesheet. Several of these suites read the page with the stylesheet inlined
  and slice it at `indexOf("<body")`; a CSS comment mentioning it moves that
  index into the `<head>` and the suite starts asserting things about JSON-LD.
- The generated fence describes the OTHER games, in their words. Shuffleboard's
  "this game says nothing about a deck or a cue" check went red on two card
  `alt` texts ("white cue ball"). Slice the fence out before any assertion
  about the words *this* game chose.

**And in the checkers:** `tools/nav-check.mjs` asks its shell-shaped questions
(one `h1.game-title` first in `<main>`, a skip link, no `.site-header`) of
site-shell pages only — a portal build has no `<main>` and an `h1` per screen —
and asks standalone pages their own set instead (bar above the game, the row
given back during play, the `--nav-*` override, `#app` as the flex row, no
"More free games" left). `tools/site-check.mjs`'s standalone check now looks
for `#link-crossgame-home` on the wordmark and expects
`cross_game_click {to: "mahjong", placement: "top_nav_brand"}` where it used to
expect `to: "site_home"`. And a panel-card count in a game's own `page.test.js`
must come from `games.json`, not from the word "eleven".

### 7. RTL and 14 languages

The runtime already sets `<html dir="rtl">` for Arabic, so the bar mirrors for
free provided it uses **logical properties only** — `padding-inline`,
`margin-inline-start: auto`, `gap`; never `left`/`right`/`margin-left`. In
Arabic: wordmark on the right, Games then Language on the left, `Close` on the
left of the panel head. `.game-card` is a flex row with `gap`, so the thumb
moves to the right of the text by itself. Boards keep their `dir="ltr"`.

The bar cannot clip, by construction: `flex-wrap: nowrap`, both buttons
`flex: 0 0 auto; white-space: nowrap`, and `.nav-brand` is the only item with
`min-width: 0` and a `clamp()` size — **the brand shrinks, the controls never
do.** Worst cases (`close` / `language` are the real strings in
`/i18n/common.js`; `games` is a new key, so those are proposals):

| | en | de | ru | id | tr | ar |
|---|---|---|---|---|---|---|
| games | Games | Spiele | Игры | Permainan | Oyunlar | ألعاب |
| close | Close | Schließen | Закрыть | Tutup | Kapat | إغلاق |
| language | Language | Sprache | Язык | Bahasa | Dil | اللغة |

The 1.6× worry lands on "Permainan" (~85px at 17px) and "Schließen" — both
inside 48px-tall buttons under 100px wide. At 320px: brand at clamp's 17px
floor ≈ 104px + Games 85 + Language 85 (worst native name, "Português") + 16
gaps + 20 padding = **310px**. It fits, with the mark already dropped at
360px. Only under 320px does the language button fall back to the 2-letter
uppercase code with the full name in `aria-label`. `.nav-panel-head` is
`flex-wrap: wrap`, so a long title plus a long Close take two rows rather than
clip.

Only three new keys are needed in `/i18n/common.js`, all 14 languages, in the
file's existing order: `games`, `playingNow`, `languageReload`. The panel's
language heading and its Close button reuse `language` and `close`, which are
already there. Each game's `test/strings.test.js` enforces parity.

### 8. Analytics

- **`cross_game_click { from, to, placement: "top_nav" }`** — every card tap
  in the panel. New `placement` value alongside the existing
  `footer` / `card_section` / `win_modal` / `content`.
- **`cross_game_click { from, to: "mahjong", placement: "top_nav_brand" }`** —
  the wordmark, heir to `#link-crossgame-home`.
- **`nav_open { from, placement: "top_nav" | "game_menu" }`** — so the owner
  can compute open → click and see a panel that gets opened and abandoned.
- **`language_change { from_lang, to_lang, placement: "nav_panel" | "settings" }`** —
  add `placement: "settings"` to the existing in-game language row at the same
  time, or the panel's share is unreadable.

The panel's cards are plain `a[data-crossgame-to][data-placement="top_nav"]`,
so `game.js`'s `wireCrossGameLinks()` and `five-in-a-row/src/main.js` pick them
up with **zero new code** on site-shell pages. House rule holds: the card is a
real `<a>`, the event fires on click, the browser navigates whether or not the
beacon made it.

### 9. Nav checklist

Grade every page against this at 375×667 and 1280×800, in English and Arabic.

1. Bar on all 11 games plus `/`, `/daily.html`, `/about.html`, `/privacy.html`,
   `/terms.html`, `/contact.html`, `/guides/`.
2. Bar is 56px under 768px, 64px above; every control in it hit-tests 48px+
   (52px+ above 768px) — measured, not read off a computed style.
3. Scrolls away under 768px, sticks above. Nothing pinned over a phone board.
4. `env(safe-area-inset-*)` left/right/top; nothing under the notch in
   landscape; standalone pages use their capped `--notch`.
5. No `.site-header` anywhere. Exactly one `h1` per page, first in `<main>`,
   17px on the phone, not repeating a word of the goal line.
6. Games opens the panel; `aria-expanded` flips; focus lands on the sheet, Tab
   is trapped, Escape and Close both work, focus returns to `#nav-games`.
7. All 11 cards present in `games.json` order, each thumb carrying
   `width`/`height` attributes. CLS on open is 0.
8. The current card has `aria-current="page"` **and** the words "Playing now".
9. 1 column at 375px, 2 at 616px, 3 at 912px; Close stays visible while
   scrolling the whole list on a 667px screen.
10. Language grid after the cards; the bar's Language button jumps to it; the
    current language shows `aria-pressed="true"`.
11. A language change acknowledges the tap, says what is happening in the new
    language, then reloads at scroll 0 with the panel still on screen.
12. Arabic: bar and panel mirrored, boards still LTR; nothing clipped at 320px
    in German, Russian, Indonesian or Turkish.
13. Standalone: bar on the home screen, gone during play, game remeasured on
    every toggle, `Games` in the `⋯` menu, no "More free games →" line left.
14. GA4 realtime shows `nav_open`, `cross_game_click` with `top_nav` and
    `top_nav_brand`, and `language_change` from both placements.
15. CSP clean — no inline `<style>`, no `style=""`, no style attribute inside
    any `innerHTML` in `/nav.js`; `npm --prefix tools run test:site` passes.

### Open items for the owner

- **`games.json` has no `card` block for `mahjong` or `daily`.** The panel
  needs 11 thumbs and there are 9. Blocking: `/mahjong-thumb.jpg` 400×400,
  plus a Daily entry (own thumb, or the mahjong thumb with its own `alt`/`desc`).
- **This reverses a written decision.** `style.css` argues at length against a
  top nav: *"상단 네비바는 만들지 않는다 … 광고로 들어온 사용자가 보드에 닿기
  전에 다른 곳으로 나갈 구실을 만들면 안 된다."* The bar is a pre-board exit
  for ad traffic. Keep the footer and card-section links, and watch
  `game_start` per landing page for 2–3 weeks before removing anything.
- **Brand and domain disagree in the SERP.** Add `WebSite`/`Organization`
  JSON-LD with `name: "Easy Classics"`, `alternateName: "Easy Mahjong
  Solitaire"`, and keep the front page's `<h1>` as "Free Mahjong Solitaire" —
  the brand belongs in the bar, not in the ranking heading.
- **The standalone builds have no i18n runtime.** Either wire `/i18n/` into
  all three, or accept an English bar on three of eleven games and say so.
- **Eleven cards is comfortable; sixteen is not.** At ~16 games the panel needs
  groups (Cards / Board / Table). A `group` field in `games.json` now costs
  nothing and saves a migration later.

### 10. What the cross-page design review changed (and what it left)

Written after driving all eighteen pages at 375×667 / 390×844 / 820×1180 /
1280×800 and looking at every screenshot (`tools/qa/design_review.py`, output
under `tools/qa/out/review/<page>/`). The full per-page table is in
`DESIGN-REVIEW.md`; what belongs *here* is the places where the sections above
now disagree with the code, so the next person does not "fix" them back.

**§6 vs `/dots-and-boxes/`: there is one build shape, not two.** §6 was written
for three permanently-dark portal builds and its snippet is a set of
*overrides*; §6a then settled that the sheet being overridden has to be
`/style.css`, loaded first. Dots and Boxes was converted the other way — the
whole bar restated locally in the board skins' variables — and within a day
that fork had become a second brand (mark re-tinted `--accent` orange, a
`--muted` hairline instead of the deep-green rule, beige pills, grey card
borders, "Playing now" orange on cream at 3.22:1). **Every standalone build
loads `/style.css` first.** A local block may own the row, the notch, the
hide-during-play rule, the stacking order against the game's own overlays, and
the `--nav-*` palette — and nothing else. `tools/nav-check.mjs` now enforces
the palette as all-three-or-none and forbids `--nav-mark-*` outright.

**The `--nav-*` palette is optional.** Overriding it is for a page that is
dark all the time. Dots and Boxes has four skins, three of them dark, and its
bar is the site's cream chrome on all four: the bar is site chrome (§1), and
it is only ever on screen on the setup screen because it hides during play.
A cream band above a Chalkboard board is the picture `/backgammon/` already
is.

**§2's 360px is 400px in the code, on purpose.** §2's budget assumed ~85px
controls. Measured, they are 92px (Games) and 97px (English), so the mark is
dropped under 400px, not 360px. Re-measured with the mark forced on at 375px
in all fourteen languages: twelve fit, `es` is 4px over and `pt` 13px over,
and English fits with **1px** to spare. 1px is not shippable for a wordmark
that clips rather than wraps, so the mark stays a ≥400px element — i.e. it is
on the iPad and the laptop and not on the phone. That is a real cost (most of
the traffic is phones) and buying it back means shortening the bar's language
control on the phone, which §4 argues against. Owner's call; the table is in
`DESIGN-REVIEW.md`.

**§5 splits in two.** `.game-title` (17/22px, centred, quiet) is for a page
with a **board**: its whole justification is "the hierarchy is board-first".
The six pages with no board — About, Contact, Privacy, Terms, `/guides/` and
a guide itself — get **`.page-title`** instead: the `.article-title` ramp
(`clamp(26px, 4vw, 34px)`), `--ink`, and `.content`'s own width cap and side
padding so it lines up with the body copy. Applied wholesale, `.game-title`
made "Privacy Policy" the smallest heading on its own page and smaller than
the body text, centred on the viewport while the text column sat left of it.
`tools/nav-check.mjs` accepts `game-title` on a game page and
`page-title` / `article-title` on a content page.

**§3, two corrections from looking at it.** (1) The grid stretches the `<li>`
but the border is drawn by the `<a>` inside it, so cards in the same row were
up to 27px out of line at 2- and 3-up. The card now fills its row, and from
616px (where the second column appears) the card's content is top-aligned so
the titles line up across a row too. (2) `.nav-now` is **16px**, not 14px:
it was the smallest type in the panel while carrying the most important state.

**The two new thumbs are re-shot.** Made from wide desktop screenshots, they
were the same picture — `/` and `/daily.html` render the same board — with the
board floating in dead felt and the tiles illegible at 88px. `tools/qa/
make_thumbs.py` now shoots portrait and cover-crops, and Daily carries this
page's own month calendar (cropped above the month name, so the asset does not
date) as a corner card over the board.

**RTL: the panel's card text is `dir="ltr"`.** The card copy comes from
`games.json` and is English in every language, so inside an Arabic run its
full stop jumped to the head of the line (".— no timer", on all twelve cards).
`[dir="rtl"] .game-card-body { direction: ltr; text-align: start }`. The card
itself still mirrors — it is a flex row with `gap`.
