# CrazyGames build

A separate, self-contained build of Mahjong Solitaire for submission to CrazyGames.
It never touches the main site's files — it only *reads* them and writes a derived
copy into `dist/`.

```
crazygames/
  build.js                      generator — reads the repo root, writes dist/
  src/crazygames-integration.js source for the one new file this build adds
  dist/                         generated output (rebuild any time with the command below)
  mahjong-solitaire-crazygames.zip   the actual upload — dist/'s contents zipped with index.html at the zip root
```

## Rebuilding

Whenever `index.html`, `style.css`, `tiles.js`, or `game.js` change on the main
site, regenerate this build:

```
node crazygames/build.js
```

This deletes and regenerates `crazygames/dist/` and re-zips it. If `index.html`'s
structure changes enough that the build script's string markers no longer match
(it removes a few specific blocks by exact text), the script throws a clear error
naming which marker it couldn't find, instead of silently producing a broken file
— open `build.js` and update the corresponding string when that happens.

## What's different from the main site

**Title/copy**: the header reads "Mahjong Solitaire" (not "Free Mahjong
Solitaire" — inside a portal, "free" is meaningless, every game there is
free), and the tagline is just "Match tiles, clear the board." (the "no
download, no time limit" clause and the Daily Challenge link are both gone —
the former is a given inside an iframe, the latter doesn't exist in this
build).

**Hint limit + rewarded ads** (CrazyGames-build-only feature, entirely in
`crazygames-integration.js` — `game.js` still ships with unlimited hints for
the main site): 3 free hints per game, shown as a "(n)" counter appended to
both Hint buttons. On the 4th attempt (button click or the `H` key), a dialog
appears — "Watch ad" requests a `rewarded` ad and grants +3 hints on
`adFinished`; "Not now" just closes it; any failure (`adError`, or the SDK
throwing synchronously in a non-CrazyGames "disabled" environment) grants
nothing and returns cleanly to the board. **Undo and auto-shuffle are
untouched and stay unlimited** — nothing in this feature ever attaches to
`#btn-undo` or the shuffle path.

Mechanically, this can't call into `game.js`'s own `doHint()` gate (it doesn't
have one) or block it from the outside in the usual way, since both this
file's listeners and `game.js`'s are registered on `click`/`keydown`. The
trick used: a **capturing-phase listener on `document`** for both events.
Capture-phase listeners on an ancestor always run before an at-target listener
on the descendant itself (`#btn-hint`'s own `click` handler, or `game.js`'s
`document` `keydown` handler which is registered without `capture: true`,
i.e. bubble phase) — this ordering is guaranteed by the event-dispatch spec
itself, not by script load order, so it holds regardless of which `<script>`
tag runs first. When hints are exhausted, this file's listener calls
`stopPropagation()` and the click/keydown never reaches `game.js`'s handler
at all — `doHint()` simply never runs. When hints remain, the counter is
decremented and the event is left alone to continue exactly as before.

The remaining count persists across reloads via a dedicated `localStorage`
key (`crazygamesMahjong.hintsRemaining.v1`, separate from the site's own
versioned schema) and resets to 3 at the same "a new board was actually
generated" boundary already used for the midgame-ad logic below (see
`onNewGameStarted()`).

The "out of hints" dialog reuses the exact same `.modal-overlay`/`.modal-box`/
`.modal-actions` classes as every other dialog (from the untouched
`style.css`), built at runtime with `createElement`/`textContent` only — no
`innerHTML`. The rewarded-ad request reuses the same input-blocking overlay
and `gameplayStop`/`gameplayStart` notification as the midgame ad below, so it
carries the identical known limitation: the elapsed timer keeps running and
sound isn't muted during the ad (see "Ad pause/mute" below) — acceptable here
too since it's the same brief-second gap at a screen the player is already
blocked from interacting with.

**Removed** (all from the generated `index.html` only — the source files are untouched):
- Google Analytics 4 and Vercel Web Analytics script tags — not needed inside the
  CrazyGames portal; CrazyGames has its own analytics for games on their platform.
- The sidebar/inline/footer AdSense placeholder slots — CrazyGames runs its own
  ad system around the game, so nothing of ours should be there.
- The SEO content section (long-form "How to play" / FAQ copy) and the two
  JSON-LD `<script>` blocks — irrelevant inside an iframe that Google never
  crawls directly.
- The site footer (About / Privacy / Contact / Daily Challenge links), the
  header's "Try today's Daily Challenge" link, the mobile menu's Daily Challenge
  entry, and the win screen's Daily Challenge call-to-action — this build is a
  single game with no other pages to link to.
- The "add to home screen" install-hint modal — meaningless inside a portal iframe.

**Hidden, not removed** — the Full Screen buttons (desktop toolbar + mobile
menu). CrazyGames' own requirements page is explicit that *"Custom in-game
fullscreen buttons are prohibited... fullscreen mode is automatically provided by
CrazyGames."* The button elements have to stay in the DOM though: `game.js` wires
them up with an unguarded `document.getElementById('btn-fullscreen').addEventListener(...)`
(same for `-mobile`), so deleting the elements would throw and crash `initApp()`
before the board ever renders. Instead, `crazygames.css` (new, tiny, additive —
`style.css` itself is an untouched copy) just sets `display: none !important` on
both. Zero effect on `game.js`.

**Kept, unchanged**: both board layouts (turtle/portrait), undo/hint/shuffle,
Settings (tile size/style, timer, sound), achievements, Backup & Restore, and all
progress in `localStorage` — this is the exact same game engine
(`game.js`/`tiles.js` are byte-identical copies of the site's own files).

## CrazyGames SDK integration

Researched from the official docs — see Sources at the bottom.

- **Script**: `<script src="https://sdk.crazygames.com/crazygames-sdk-v2.js"></script>`
  in `<head>`, plain (no async/defer) so `window.CrazyGames` is guaranteed to
  exist by the time the next script tag runs. No explicit `init()` call needed.
- **`sdkGameLoadingStart()`**: called from an inline `<script>` immediately after
  the SDK tag — as early as possible, before `style.css`/`tiles.js`/`game.js`
  even start downloading, since this marks the start of the load-time measurement
  CrazyGames' QA uses (target: reach gameplay in ≤ 20s).
- **`sdkGameLoadingStop()`** and **`gameplayStart()`**: called from
  `crazygames-integration.js`, loaded *after* `game.js`. Both files register a
  `DOMContentLoaded` listener; listeners for the same event fire in registration
  order, so by the time this file's listener runs, `game.js`'s own listener
  (`initApp`, which renders the full board synchronously) has already finished.
  No polling, no arbitrary timeout — this ordering guarantee is exact.
- **`gameplayStart()` / `gameplayStop()`** during play: `game.js` was not
  modified to expose its internal state, so this build watches the `data-open`
  attribute on every `.modal-overlay`, the settings panel, and the mobile menu
  sheet via a `MutationObserver`. Any one of them open → `gameplayStop()`; all
  closed → `gameplayStart()`. This also correctly handles the initial page load,
  since a returning player's "Welcome back" resume prompt is itself one of the
  watched elements.
- **Midgame ads** (`window.CrazyGames.SDK.ad.requestAd('midgame', callbacks)`):
  requested only at the exact moment a *new board* is actually generated — never
  mid-round. Every button/shortcut that can lead to `startNewGame()` is covered:
  the ones that always start a game immediately when clicked (post-win, stuck/
  unsolvable, resume-prompt "New Game", the newgame-confirm dialog's own "New
  Game") fire directly; `btn-new-game`/`-mobile` and the `N` keyboard shortcut
  route through `requestNewGame()`, which *may* first ask for confirmation — for
  those, the integration checks one tick later whether the confirm dialog
  actually opened, and only proceeds if it didn't (meaning the game already
  started for real). The very first explicit "New Game" of a session is skipped
  entirely (`SKIP_FIRST_N_NEW_GAMES` in the source), matching CrazyGames'
  "never at game start" rule with margin to spare — the auto-loaded first board
  on page load isn't caught by this logic at all, since it's not a click/keydown.
  A local 3-minute cooldown (`MIDGAME_AD_MIN_INTERVAL_MS`) is enforced on top of
  whatever frequency capping the SDK itself does.
- **Rewarded ads**: intentionally not used in this v1, per the brief.
- **Ad pause/mute**: on `adStarted`, a full-viewport transparent overlay is
  inserted to block all clicks and keyboard interaction with the board
  underneath (removed on `adFinished`/`adError`). **Known limitation**: this
  does *not* pause `game.js`'s internal elapsed-timer interval or mute its Web
  Audio sound effects, because both live in `game.js`'s private closure and this
  build deliberately never modifies that file. In practice the gap is small —
  ads only ever fire at a fresh-board boundary (never mid-round), interaction is
  already blocked, so the only visible effect is the new game's timer gaining a
  few extra seconds while the ad plays. A real fix would mean adding two or
  three tiny additive exports to `game.js` (e.g. exposing `pauseElapsedTimer`/
  `resumeElapsedTimer`) — worth doing, but it's a change to the shared engine
  file, so it's deliberately left as a follow-up rather than done silently here.
- **`hasAdblock()`**: not wired up in v1 — not requested, and the game is fully
  playable either way.

All SDK calls go through a single `safeSdkCall()` wrapper (try/catch) — the
official docs note that on a non-CrazyGames domain the SDK methods may throw
("disabled" environment), and the game must never depend on any of this
succeeding.

## Verified

- Puppeteer, with a mocked `window.CrazyGames.SDK` (the real CDN script was
  blocked so the mock stays in control) driving actual clicks: load produces
  exactly `loadingStart → loadingStop → gameplayStart` in order; opening/closing
  Settings produces exactly `gameplayStop → gameplayStart`; the first explicit
  New Game click produces no ad request, the second produces
  `gameplayStop → requestAd('midgame')`; the blocking overlay is confirmed
  present (via `elementFromPoint` at the board's center) while the mocked ad is
  pending, and gone with `gameplayStart` firing again once `adFinished` runs.
- Full game playthrough (hint → match → ... → win) inside the built `dist/`
  works end to end; a 144-tile board renders on load in every test.
- Both fullscreen buttons still exist in the DOM (so `game.js` doesn't throw)
  and are confirmed `display: none` via `getComputedStyle`.
- No horizontal scroll and the board fits at every viewport CrazyGames'
  technical requirements list (800×450, 1024×576, 1280×720, 1366×768, 1600×900,
  1920×1080, plus the two 4:3 sizes and a mobile-portrait check).
- Achievements grid (6 badges) and Backup & Restore both still generate/render
  correctly inside this build.
- `game.js`/`tiles.js`/`style.css` in `dist/` are confirmed byte-identical
  (`diff`) to the site's own copies.
- Zero console/page errors in every run above.
- Hint limit + rewarded ads (mocked SDK, real clicks/keypresses): badge shows
  "(3)" on load; 3 real hint clicks decrement to "(0)" and each one actually
  highlights a pair (`doHint()` ran); the 4th click *and* the 4th `H` keypress
  both open the dialog with zero pairs highlighted (`doHint()` did NOT run —
  confirms the capture-phase interception actually blocks it, not just hides
  the effect); "Not now" closes with no `requestAd` call; "Watch ad" →
  `adFinished` grants +3 (back to "(3)"); a second drain → `adError` grants
  nothing (stays "(0)"); a third drain → the SDK throwing synchronously from
  `requestAd` is recovered cleanly (dialog closed, overlay removed, no stuck
  state) — all three paths call `gameplayStop`/`gameplayStart` correctly
  around the ad. Undo stays completely unaffected (disabled only when its own
  history is empty, never touched by any of the above).
- Midgame + hint-limit interaction verified together: 1st explicit New Game
  of the session skips the ad, 2nd requests it, hint count resets to "(3)" at
  that same boundary, and a 3rd New Game inside the 3-minute cooldown window
  correctly skips the ad again.
- Confirmed via direct source diff that neither `game.js` nor the root
  `index.html` contain any of this feature's code (`cg-hint-count`,
  `modal-cg-hint-limit`, etc.) — it exists only in `crazygames/`.
- Package: 6 files, ~180 KB uncompressed / ~58 KB zipped — comfortably under
  CrazyGames' 50 MB / 1500-file limit. `index.html` sits at the zip root.

## Before you actually submit

- [ ] Rebuild once more right before zipping (`node crazygames/build.js`) so the
      upload reflects the latest `game.js`/`style.css`.
- [ ] **Do this on the real CrazyGames domain**, not just locally: the "other
      domains: disabled environment" note in the docs means local/preview
      testing can't fully exercise the ad flow — verify the actual ad request/
      pause/resume cycle once it's live in a CrazyGames preview build.
- [ ] Fill in the developer-portal metadata (title, description, thumbnail,
      category, controls description, tags) — none of that lives in this repo.
- [ ] Confirm PEGI 12 compliance (trivially true for a tile-matching game — no
      violence/sexual content/gambling).
- [ ] Double-check no cross-promotion / external store links exist anywhere in
      this build (there are none as of this writing — the whole point of this
      build was removing every outbound link).
- [ ] Decide whether to invest in the `pauseElapsedTimer`/`resumeElapsedTimer`
      export follow-up described above before Full Launch review.
- [ ] After Basic Launch feedback (if any is given on load time, ad cadence,
      etc.), re-check against the specific numbers in this README, since
      CrazyGames' own thresholds are the source of truth if anything drifts.

## Sources

- [HTML5 v2 SDK — Introduction](https://docs.crazygames.com/sdk/html5-v2/intro/)
- [HTML5 v2 SDK — Game module](https://docs.crazygames.com/sdk/html5-v2/game/)
- [HTML5 v2 SDK — Video ads](https://docs.crazygames.com/sdk/html5-v2/video-ads/)
- [Requirements — Gameplay / Technical](https://docs.crazygames.com/requirements/gameplay/)
- [Requirements — Advertisement](https://docs.crazygames.com/requirements/ads/)
- [Requirements — Introduction](https://docs.crazygames.com/requirements/intro/)
- [Requirements — Quality guidelines](https://docs.crazygames.com/requirements/quality/)
