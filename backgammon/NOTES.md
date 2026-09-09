# Backgammon — builder / tester notes

`/backgammon/` — one game of backgammon against the computer on the site
shell, for the 65+ phone audience: tap-to-move with every legal landing lit
in gold, big checkers, unlimited undo inside a turn, hints in words, a
14-language UI, no doubling cube, no clock and no score.

## What it does

- **Rules** live in `src/game/backgammon.js` and nothing else — no DOM, no
  storage, no English. One numbering system throughout, the *human's*:
  point 1 is the last point of the player's home board, point 24 the far
  corner; `points` is 24 signed counts (index = point − 1, positive =
  ivory/human, negative = the computer). The human runs 24 → 1, the
  computer 1 → 24.
- **The whole roll is solved, not one die at a time.** `legalSequences()`
  enumerates every complete way to play the two (or four, on doubles) dice,
  keeps only the longest, and when only one die can be played keeps the
  higher one. Everything the page draws is derived from that same set:
  `legalMoves()` (the next single moves), `movableFroms()` (which points
  may be tapped), `destinationsFrom()` (where a lifted checker may go,
  including two-dice landings, with the chain of moves that gets it there)
  and `soleDestination()`. That is deliberate — see *Decisions*.
- **Bearing off** starts only with all fifteen home and none on the bar; a
  die bears off its exact point, and a higher die may lift a checker only
  from the highest occupied point. The tray is a real tap target and glows
  like a point. Fifteen off ends the game — a gammon if the loser bore off
  nothing, a backgammon if the loser also has a checker on the bar or in
  the winner's home.
- **Gestures**: tap a checker (or its point, or the bar) to lift it, tap a
  glowing point or the Home tray to play it; a second tap on a checker with
  exactly one place to go plays it (DESIGN §5.4), otherwise it puts it
  down. Drag works too and falls back to a tap under 8px of travel. When a
  roll leaves exactly one move the checker is lifted for the player and the
  Hint slot becomes **Play my only move**; when it leaves none the slot
  becomes **Pass** and Roll relabels to **Pass turn**, with the status line
  saying which die cannot be played.
- **Layout** is measured, never guessed (`measure()` in `src/main.js`):
  portrait board when the board is under 600px wide, the classic horizontal
  board above that, with the dice and Roll on the felt bar in portrait and
  in a side panel from 860px (and on landscape phones). Point pitch never
  goes under 40px, checkers 36–64px, dice 44–56px, Roll is a real 56px
  `.btn`. Stacks of six or more compress to fit the point and carry a count
  badge on the top checker.
- **The computer** (`src/game/ai.js`) picks one of the engine's own complete
  legal sequences, so it can never play an illegal or a short turn; the QA
  asserts that after every one of its turns. Relaxed by default, Standard
  in Settings.
- **Analytics**: `game_start` once per game (including the automatic deal on
  first load, none when restoring a save), `game_win` once, and
  `cross_game_click` on every `a[data-crossgame-to]`. Hints go through
  `ads.requestRewardedHint()`; `showInterstitial("game_over")` runs between
  the celebrating board and the result modal, `showInterstitial("new_game")`
  before a confirmed re-deal.
- **Storage**: `backgammon.v1.save|settings|stats`, every field validated on
  read (`isValidState` insists on fifteen checkers a side). A save carries
  the dice still to play and the turn's starting position, so a reload
  mid-turn comes back with Undo still available. A finished game is cleared,
  never saved.
- **Languages**: `src/i18n/strings.js` is English only (the translator adds
  the other 13); every visible string goes through `i18n.t()` or
  `data-i18n`, the status line remembers its key and re-speaks itself on a
  language change, and the board keeps `dir="ltr"` under `dir="rtl"`.

## Decisions

- **One source of truth for the glow.** `destinationsFrom()` is built on
  `continuations()` — the legal sequences from the turn's start that begin
  with the moves already made — rather than on the dice left in hand. It is
  the only way the board can be right about the two rules that are not
  local to a single die: you must play both dice when any order lets you,
  and with only one playable you must play the higher. Both page bugs found
  in testing came from the destination set being worked out apart from the
  sequences (see *Tester findings*), so the tests now pin the invariant
  "every legal move's checker has somewhere to glow" directly.
- Portrait rows run 12 → 7 above the bar and 6 → 1 below on the left, 13 →
  18 / 19 → 24 on the right, with the point numbers in a centre gutter, so
  the player's home board is always the bottom-left quadrant, as on a real
  board turned on end.
- The dice and Roll live *on the bar*, not under the board: in portrait the
  board runs past the fold on a small phone and Roll must never scroll away.
- Disabled buttons are full-opacity paper with a dashed border, never 50%
  opacity — this audience should still be able to read a button that is not
  ready yet.
- A 1.1s pause after the player's last die (`HANDOFF_MS`) before the
  computer replies, so Undo is still there for a moment; any pending pause
  is cancelled by Undo, New game or a restore.
- "Game in progress" for the New-game confirm means a roll has happened
  (`moveCount > 0 || turnCount > 0`), so the question is never asked about a
  board nobody has touched.

## Known gaps

- Only English strings exist until the translator adds the other 13. Status
  sentences want to stay under ~70 characters: a three-line status grows its
  box and pushes the board down, which costs the most on a landscape phone.
- **375×667 (iPhone SE)**: the portrait board is 652px tall at the 40px
  minimum pitch and cannot fit under the header, goal and status — 198px of
  it (the player's home board and tray) is below the fold and the page
  scrolls to it. DESIGN §5.3 accepts this; the dice and Roll are on screen.
- **844×390 (phone on its side)**: same story horizontally — the board is
  404px tall on a 390px screen. The chrome above it is compressed and the
  side panel is top-aligned so the dice, the caption and Roll are all above
  the fold, but the bottom half of the board needs a scroll. The 76px strip
  wraps "Roll dice" to two lines.
- The header's "Play Mahjong Solitaire →" link is pale blue on the dark
  green `.site-header` — barely legible, but it belongs to `/style.css` and
  every game has it, so it is out of this folder's scope.
- DESIGN §7 wants the OG board 600px tall; a horizontal backgammon board at
  that height is ~950px wide and would run under the title, so it is 610px
  wide (~385 tall) and centred in the right half instead.
- No doubling cube, no match play, no board flip (the player is always
  ivory, running to the bottom-left home).

## How to run

    node backgammon/test/run.js                  # rules, AI, page, strings (53 tests)
    python3 tools/qa/backgammon_qa.py            # the graded browser QA, port 8133
    python3 tools/qa/backgammon_play.py --games 3  # plays whole games through the page, port 8163
    python3 tools/qa/backgammon_shots.py         # the 7 graded viewports + Arabic, port 8143
    python3 tools/qa/backgammon_thumbs.py        # regenerates og-image.png and /backgammon-thumb.jpg

`backgammon_qa.py` drives the real buttons plus a `window.__bg` debug hook
that only exists with `?debug=1`: it can read the state, force a roll, load a
position and replay the page's own tap handler, which is how the near-won
bear-off and the "no legal move" board are reached deterministically.
`backgammon_play.py` is the deep tester: it plays complete games at 414×896
choosing randomly among the engine's own moves and, on every single one,
compares what the board *shows* (`.is-movable`, `.is-target`, the tray glow,
the dice caption, the Pass button, Undo) against what the rules engine says.

## Tester findings

**Found and fixed**

- **A lifted checker sometimes lit nothing** (`destinationsFrom`): after
  entering from the bar, and on a roll where only one die could be played,
  tapping a checker that had a legal move highlighted no destination, did
  not lift, and the following tap made no move — because the destinations
  were derived from the dice in hand rather than from the legal sequences,
  which are the only thing that knows a die is unplayable in one order and
  playable in the other. Destinations now come from `continuations()`.
  Pinned by *"every legal move's checker lights at least one destination"*
  in `test/backgammon.test.js`, which asserts the invariant on a bar-entry
  position, a forced higher-die position, and every position reached in
  four full seeded games.
- **Bearing off could not be finished** (same root cause, "off" side): the
  Home tray never took `.is-target`, so `soleDestination()` was null and a
  second tap on the last checker put it *down* instead of bearing it off —
  the game never ended, so there was no `game_win`, no result modal, the
  save was never cleared and the stats never recorded the win. Pinned by
  *"bearing off lights the home tray"* (exact die, higher die from the
  highest occupied point, a two-dice chain inside the home board, the last
  checker, and the two cases where the tray must **not** glow: a checker
  outside home, a checker on the bar) and by *"soleDestination …"*.
- **Roll scrolled off a landscape phone** (`style.css`): at 844×390 the
  goal and the status line pushed the board to y=182 and the side panel
  centred its contents on a board that runs 160px past the fold, leaving
  Roll 103px below it. A `(min-width: 600px) and (max-height: 599px)` block
  now tightens the goal and status (still 17px/600), and
  `.bg-board.is-side.is-short .bg-dice-panel` aligns to the top: the dice,
  the "To play" caption and Roll are all on screen with room to spare.
- **The goal sentence touched both screen edges at 414px**: under 480px the
  game root drops its side padding so the board can use the full width, and
  the goal paragraph went with it. `.bg-goal` now carries its own 14px of
  side padding.
- **`tools/qa/backgammon_play.py` was itself wrong** in two places (a list
  compared to an int, and a demand for the "that die can't be played"
  status when the turn was simply over with no dice left). Fixed; it now
  plays three complete games with no failures.

**Checked and left alone**

- The rules engine was fuzzed under node against an independent reference
  implementation of the single-move rules (entry, blocking, hitting, exact
  and higher-die bear-off): 60 complete games, ~21,000 positions, plus the
  invariants that `movableFroms` equals the legal moves' sources, that every
  advertised destination chain replays through `applyMove`, and that
  `legalSequences` never mixes lengths. No mismatches.
- The seven graded viewports were screenshotted and read one by one:
  no horizontal overflow anywhere, 24 points and both trays inside the board
  box, smallest point dimension 40–50px, checkers 40–46px, Roll 56px, dice
  44–56px, stacks of five sitting cleanly on their triangle, cream points
  outlined so they read against the oak, gold selection ring and dashed gold
  outlines on empty targets clearly distinguishable, and the Arabic page
  right-aligned with the board unmoved in the same pixels.
