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

- **site shell** (Mahjong, Daily, Five in a Row): loads `/style.css`, has
  the site header, footer, FAQ content.
- **standalone** (Four Ball Billiards, StoneFlick, Shuffleboard): the
  portal build as-is, full-viewport, its own `./style.css`, no site
  footer — one `<a href="/" id="link-crossgame-home">More free games →</a>`
  on the home screen (Shuffleboard: in the ⋯ menu). 65+ adaptations for
  these are still to come.

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

## Commands

```
npm --prefix tools install          once (Playwright, for the browser run)
npm --prefix tools test             every game's unit suite + static site checks
npm --prefix tools run test:site    the same plus the Playwright run under the real CSP
npm --prefix tools run sync         rewrite footers/cards/sitemap from games.json
npm --prefix tools run serve        http://localhost:8080 with vercel.json's headers
```

A game's own suite alone: `cd <slug> && node test/run.js`.
