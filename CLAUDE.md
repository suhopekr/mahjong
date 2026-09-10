# easymahjongsolitaire.com

Static site, vanilla HTML/CSS/JS, no build step, deployed by Vercel from the
repo root. `.vercelignore` keeps `crazygames/`, `tools/` and every `test/`
off the deploy. Target audience is 65+ (the 55+ in the brief turned out to
be 65+ women in the ad data): big targets, words on buttons, no timers.

## Hard constraints

- **CSP** (`vercel.json`): `script-src 'self' + googletagmanager`,
  `style-src 'self'`. No inline `<style>`, no `style=""` attributes, no
  inline `<script>` other than JSON-LD, no `setAttribute("style", …)`.
  Setting `el.style.x` from JS is fine (CSSOM), a style attribute inside
  an `innerHTML` string is not.
- **Analytics** is one file, `/ga-init.js`, loaded by every page. Game code
  calls its own `trackEvent()` which adds `game_name` and checks that
  `window.gtag` exists first. Events: `game_start`, `game_win`,
  `cross_game_click {from, to, placement}`.
- **Nothing opens on top of the board by itself.** `/` and `/daily.html`
  resume a saved game silently — there is no "Welcome back — Continue / New
  game" prompt any more. That question had one answer, and this is the page
  ad traffic lands on, so a dialog between the visitor and the board is the
  most expensive thing on it. New Game is in the toolbar and the phone's
  menu sheet for anyone who wants a fresh board, and
  `#modal-newgame-confirm` still guards a game in progress. The one overlay
  a returning player can land on is the Paused screen they themselves left
  the game in (`shouldRestorePaused`, which honours `pausedByUser` and
  ignores automatic tab-switch pauses). The layout (wide turtle / tall
  tower) is fixed when a board is dealt and cannot be reflowed, so a save
  carries its shape between screens: `shouldRedealForScreen()` re-deals an
  UNTOUCHED board to fit the screen it is opened on, and restores a board
  with moves in it whatever the shape — losing progress is worse than
  looking a little wrong.
- No ad SDK on this site. The games ported from the CrazyGames builds keep
  their `src/core/ads.js` **as a shim** (every export a no-op,
  `requestRewardedHint()` resolves `"granted"` at once — previews are free).

## Games

`games.json` is the one list. `tools/sync-games.mjs` writes from it: the
Games column of every footer (`<!-- games:footer -->` fences), the More
Free Games cards on `index.html` (`<!-- games:cards -->`), and the game
entries in `sitemap.xml` (`<!-- games:sitemap -->`). Cross-game links
carry `data-crossgame-to` / `data-placement`; `game.js` and
`five-in-a-row/src/main.js` wire every `a[data-crossgame-to]`, so no JS
lists games either.

Two shapes of page:

- **site shell** (Mahjong, Daily, Solitaire, FreeCell, Word Search,
  Five in a Row, Backgammon, 8 Ball Pool): loads `/style.css`, has the site
  header, footer, FAQ content.
- **standalone** (Four Ball Billiards, StoneFlick, Shuffleboard): the
  portal build as-is, full-viewport, its own `./style.css`, no site
  footer — one `<a href="/" id="link-crossgame-home">More free games →</a>`
  on the home screen (Shuffleboard: in the ⋯ menu). 65+ adaptations for
  these are still to come.

### Adding a game (site shell, built for the site) — reference: `/solitaire/`

Solitaire is the template for simple classic games built directly for the
site. Copy its shape:

1. `/<slug>/index.html` — the `five-in-a-row/index.html` skeleton: head
   block (canonical/OG/favicon data-URI/insights/gtag + `/ga-init.js`,
   WebApplication + FAQPage JSON-LD), `.site-header`, `<main id="<slug>">`
   with a permanent one-line goal, an `aria-live` status line with reserved
   height, the board, a toolbar of site `.btn`s (Hint / Undo / New game /
   Settings, min-height 56px), the two ad-slot divs, `.content` intro + How
   to Play + FAQ (`.faq-item` h3/p pairs matching the JSON-LD one for one),
   the footer with the games fence, a `.settings-panel`, `.modal-overlay`
   modals, a toast container. Every block in `.content` carries a
   `data-i18n-content` key and the section declares
   `data-i18n-lang data-i18n-module="/<slug>/src/i18n/content.js"` — see
   `/i18n/TRANSLATING.md` for the key scheme; the `h1` is
   `data-i18n-content="game.<key>.name"`.
2. `/<slug>/style.css` — loaded after `/style.css`; every selector `.xx-`
   prefixed or scoped under `#<slug>`; never redefines a site selector; no
   bare element selectors; colours from the site `:root` custom properties.
3. `src/game/*.js` pure rules with no DOM (testable under node);
   `src/main.js` rendering/input/undo/save/settings/GA;
   `src/core/storage.js` the only file touching localStorage, keys
   `<camelSlug>.v1.save|settings|stats`; `src/core/audio.js` procedural
   Web Audio (copy the tone()/unlock code); `src/i18n/strings.js` the
   game's own words and `src/i18n/content.js` the article's translations
   (`export const content = {};` — no `en` key, ever).
4. `test/` — `harness.js` + `run.js` (copy from any game), a rules suite,
   and a `page.test.js` checking the CSP rules, JSON-LD ↔ FAQ, the footer
   fence and the stylesheet scoping.
5. `/<slug>/og-image.png` (1200×630) and `/<slug>-thumb.jpg` (400×400).
6. `games.json` entry (`check.play: null`, `shell: "site"`), then
   `npm --prefix tools run sync`, `npm --prefix tools test`,
   `npm --prefix tools run test:site`.

### Adding a game (standalone, from a CrazyGames build)

1. Copy `index.html`, `src/`, `assets/` and `test/` (only `*.test.js`,
   `harness.js`, `run.js`) into `/<slug>/`. Skip `dist/`, `store/`,
   `tools/` (copy a tool only if a test imports it), `CLAUDE.md`.
2. Move the inline `<style>` to `<slug>/style.css`; link it with
   `<link rel="stylesheet" href="./style.css" />` at the same spot. Fix any
   `style=""` attributes (classes) and any `innerHTML` that carries one
   (set `.style` after insertion). Drop the `sdk.crazygames.com` tag.
3. Replace `src/core/ads.js` with the shim (copy one from another game;
   keep every name `main.js` imports). Reword "Watch an ad" copy — the
   preview is free here. Replace `test/ads.test.js` with the shim version
   and add `readPage()` to `test/harness.js` (copy both from another game);
   `sed` the tests' `readFileSync(path.join(root, "index.html"), "utf8")`
   to `readPage(root)`.
4. Head: title/description/canonical/OG/favicon, Vercel insights,
   gtag + `/ga-init.js`, JSON-LD WebApplication — copy the block from
   another standalone page and edit.
5. `trackEvent` helper + `game_start` at the player's own entry (not a
   boot-time preload — see the `quiet` flag in Shuffleboard) and `game_win`
   at the clear. Home link on the home screen.
6. Thumb: `/<slug>-thumb.jpg`, 400×400, well under 100 KB.
7. Add the entry to `games.json` (with `check.play` = the selector that
   starts a game, or `null` if the page boots onto a board), then
   `npm --prefix tools run sync`.
8. `npm --prefix tools test`, then `npm --prefix tools run test:site`.

## Languages

Every site-shell game ships in 14 languages (English, Español, Português,
Français, Italiano, Deutsch, Русский, Türkçe, Indonesia, 한국어, 日本語,
简体中文, 繁體中文, العربية). The runtime is `/i18n/i18n.js`; shared words
live in `/i18n/common.js`, a game's own in `<slug>/src/i18n/strings.js`
(lookup: game[lang] → common[lang] → game.en → common.en → the key).

Mahjong and Daily are the exception in HOW they reach that runtime, not in
what they get. `game.js` is a classic script and cannot `import`, so
`/mahjong-i18n.js` — a module, therefore deferred, therefore run after
game.js is parsed and before `DOMContentLoaded` — builds the instance from
`/i18n/common.js` + `/i18n/mahjong.js`, puts it on `window.mahjongI18n`, and
`initApp()` picks it up. Inside game.js everything goes through `t(key, arg)`
and nothing is written in English; `tiles.js` takes the same function via
`MahjongTiles.setTranslator()` for the tiles' aria-labels. Constants that
would otherwise freeze English at parse time (the badges, the month names,
the install-hint copy) hold KEYS, not sentences.

A language change reloads the page (`/i18n/switch.js`, shared by `/nav.js`
and the two Settings grids) — game.js reads the language once and draws 144
tiles from it, so a live swap would leave half a board in each language.

- One choice for the whole site, stored under `site.v1.lang`; first visit
  follows the browser language.
- Static markup carries `data-i18n="key"` (`data-i18n-html` where our own
  `<strong>` is in the string, `data-i18n-attr="aria-label:key"` for
  attributes); `i18n.applyStatic()` swaps them and re-runs on change.
- Nothing a player reads is written in main.js — it is all `i18n.t(key)`.
  The status line keeps its key so it can re-speak itself in the new
  language. `i18n.onChange()` re-renders anything the game draws itself.
- Settings carries the language grid too (`i18n.renderPicker`): first row in
  the six module games, LAST row on the Mahjong pages — fourteen 56px
  buttons are seven rows on a phone, and at the top they push Tile size,
  which is what people open the panel for, off the first screen.
- Arabic sets `<html dir="rtl">`; boards carry `dir="ltr"` because their
  layout is in px.
- Each game's `test/strings.test.js` enforces key parity across languages.
  A shared key that exists in English only is listed in `common.js`'s
  `PENDING` array, which exempts it from parity until it is filled in —
  and `tools/i18n-check.mjs` fails if a key stays on that list after every
  language has it.

The long-form text a visitor reads (the `.content` article — intro, How to
Play, every FAQ pair, the section headings, the `h1`) works the OTHER way
round, because it is the SEO copy and a crawler sets no `localStorage`:

- **English lives in the markup, only there.** The block carries
  `data-i18n-content="introP1"`, and a translation REPLACES it — no `en`
  dictionary, so there is no second copy to drift from what Google reads.
- Translations sit in `<slug>/src/i18n/content.js` (game pages) or
  `/i18n/pages/<page>.js` (index, daily, about, contact), with **no `en`
  key**, declared in the markup as
  `<section class="content" lang="en" dir="ltr" data-i18n-lang
  data-i18n-module="/…/content.js">`. `/nav.js` registers it — it is the
  one module every page loads — and `/i18n/i18n.js` `import()`s it only
  when the language is not English, so an English visitor fetches nothing
  extra. A module that fails to load leaves the page in English.
- A language in a content module must carry EVERY key that page uses; half
  a page translated fails the build rather than shipping.
- Game names and card descriptions are chrome and translate too, out of
  `/i18n/games.js` — whose `en` block `tools/sync-games.mjs` generates from
  `games.json`, so the registry stays the one list. The generator also
  writes the `data-i18n-content` attributes onto the footer links and the
  card/panel markup.
- `<title>`, `<meta>` and the JSON-LD stay English. `privacy.html` and
  `terms.html` stay English entirely — a mistranslated policy misstates
  what data the site collects; each says so at the top of the file.
- `/i18n/TRANSLATING.md` is the translator's guide: the mechanism, the key
  scheme, the tone, and the exact list of files and keys.
  `node tools/i18n-check.mjs --keys` prints that list live.
- `python3 tools/qa/mahjong_i18n_qa.py` drives a real browser over `/` and
  `/daily.html` in six languages under the real CSP. It is the only check
  that can see the one thing the bridge rests on — that `window.mahjongI18n`
  exists by `DOMContentLoaded` — because if it does not, every string
  renders as its own key and nothing static notices.

## Ads (not live yet)

Every new game has `src/core/ads.js`, a no-op shim with the shape Google's
H5 Games Ads (AdSense Ad Placement API) will need: `preloadInterstitial()`,
`showInterstitial(reason)`, `requestRewardedHint()`. Games already call
`showInterstitial("game_over")` before the win modal and route hints
through `requestRewardedHint()`, so turning ads on later is one file per
game plus the CSP. The two fixed-size `.ad-slot` divs sit after the
controls and before `.content`, hidden by `body.ads-off`.

## Commands

```
npm --prefix tools install          once (Playwright, for the browser run)
npm --prefix tools test             every game's unit suite + static site checks
npm --prefix tools run test:site    the same plus the Playwright run under the real CSP
npm --prefix tools run sync         rewrite footers/cards/sitemap from games.json
npm --prefix tools run serve        http://localhost:8080 with vercel.json's headers
```

A game's own suite alone: `cd <slug> && node test/run.js`.
