# 8 Ball Pool — build notes

`/eight-ball-pool/` on easymahjongsolitaire.com. Site-shell page (the
`solitaire/` pattern: site header, goal line, `aria-live` status, board,
56px toolbar, ad slots, article + FAQ, footer fence, settings sheet,
modals, toasts), with a real physics engine underneath.

    node eight-ball-pool/test/run.js          # 67 tests, 0 failures
    python3 tools/qa/pool_qa.py               # browser QA on port 8134
    python3 tools/qa/pool_thumbs.py           # og-image.png + the 400px thumb

## What the game does

Eight-ball against the computer. Fifteen numbered balls racked on the foot
spot with a seeded jitter, a white cue ball in hand behind the head string
for the break. The first ball potted on a legal shot decides the group;
pot one of yours and you shoot again; clear your seven and the black 8 is
yours to win with. Fouls are a scratch, no contact, hitting the other
group or the 8 first, and — under the standard rules only — a shot that
sends nothing to a cushion. **No call shot:** any pocket counts, always.

Aiming is drag-anywhere-on-the-cloth (the white ball points at your
finger) with a long dashed guide, a ghost ball at the contact point and a
second line for where the object ball will go. **Tapping one of your own
balls** sets the aim at that ball's easiest pocket, which is the friendlier
gesture on a phone and is why nothing here needs a steady hand. Power is a
56px slider labelled **Soft / Medium / Firm** — never a number — and one
74px **Take the shot** button fires it. Arrow keys nudge the aim by half a
degree and Enter shoots, for anyone on a keyboard.

Undo takes back your shot **and the computer's reply together**: they are
one exchange as far as the player is concerned. Hint runs the same search
the computer uses, asked for its best answer, and draws the whole predicted
cue-ball path; with ball in hand it also puts the ball down for you, since
where to place it is half the advice.

## What was reused, and what is new

Reused from `four-ball-billiards/` (copied into this folder and adapted —
nothing imports across game folders):

| file | what changed |
|---|---|
| `src/game/physics.js` | **the big one.** Cloth, spin, ball-ball throw, above-centre cushion contact, the swept solver — all four-ball's, unchanged. New: six pockets, cushions cut into six segments with a gap at each mouth, twelve jaw points, and a capture circle per pocket that logs a `pocket` event and takes the ball off the table. Table size retuned (below). |
| `src/game/render.js` | the cached table bitmap, the per-pixel shaded ball sprite, the cue, the preview line. New: pockets cut into the rails, numbered and striped balls, the head string, the kitchen shading, the ghost ball, three cloths. |
| `src/game/surface.js` | cloth/rail/sight painting, byte for byte. |
| `src/game/layout.js` | metres → pixels, the rotation, the power curve. |
| `src/game/preview.js` | the replay-the-shot hint line, unchanged. |
| `src/game/ai.js` | four-ball's "sample candidates and simulate" shape, rewritten to score 8-ball: geometric pocketing candidates first (ghost line clear, cut under 72°, entry angle sane), then simulate the best ten and read `judgeShot`'s own verdict. |
| `src/core/input.js` | pointer handling, unchanged. |
| `src/core/ads.js` | the shim. |

New for this game: `src/game/rack.js` (the triangle, the spots, placement
legality), `src/game/rules.js` (all of 8-ball as a pure function of the
contact log), `src/main.js`, `src/i18n/strings.js`, `index.html`,
`style.css`, `src/core/storage.js`, and a compact procedural
`src/core/audio.js` (solitaire's tone engine plus noise-burst impacts
shaped by the collision's own speed). Four-ball's 1,350-line sampled-audio
stack and its portal shell were **not** carried over.

## Decisions worth knowing

**The cloth is 1.5 × 0.75 m, not a real 1.98 × 0.99 bar table.** This is
the one number chosen for the screen rather than the spec sheet, and the
comment at `TABLE_LENGTH` explains it in full. A real table is 34.6 ball
diameters long; on a 375 × 667 phone, with the header, goal line, status
line and shot controls taking their share, that puts the ball at about
11px — smaller than the number printed on it. At 25 diameters the ball
lands at 18px on the smallest phone and 20–27px everywhere else. The 2:1
shape, the rack, the spots and every angle a player's eye knows are
unchanged; the pockets are proportionally a little more generous, which
for this audience is the right direction anyway. Nothing in the physics
depends on the absolute size (the friction constants are per metre, the
pocket geometry is in ball radii).

**Height budget.** `measure()` computes three candidate sizes: the table
that needs no scrolling at all, the table whose balls are 18px, and the
table that fits once the header and goal line are scrolled off. It grows
from the first toward the second and stops at the third. From 390 × 844
up nothing ever scrolls. On 375 × 667 and on a phone held sideways the
table is deliberately taller than the fold: the status line pins to the
top of the window, the shot row pins to the bottom, and one flick of the
thumb gives status + the whole cloth + the controls. `revealTable()` does
that flick once at boot so the player never lands on a table with the cue
ball off the bottom.

**Pocket geometry.** Corner mouths are 2.9 ball radii along each rail
(≈2 ball diameters between the noses, the WPA figure), side mouths 2.25
radii either side of centre. Each capture circle sits just outside the
rail line and is wide enough that any centre crossing inside a mouth is
already inside it — so a ball can never be lost in the void between the
jaws — while a ball rolling *along* the rail past a side pocket stays a
ball's width clear of the circle. Both cases are pinned in
`test/physics.test.js`, along with one ball into each of the six pockets.

**Friendly vs standard rules.** Friendly is the default: a foul passes the
turn and the cue ball goes behind the head string, which is a smaller and
less punishing decision than free placement. Standard turns on full ball
in hand *and* the no-cushion foul. One Settings row switches both, because
they are one idea ("play it properly") and two toggles would be two
chances to end up in a state nobody asked for.

**Side spin is off by default** and appears as a Left / Middle / Right row
under the power bar when Settings turns it on. There are no follow/draw
controls at all — the engine models them, but a second dial is a second
thing to get wrong.

**Analytics.** `game_start` fires exactly once per rack (including the
automatic first rack, and never on a restore); `game_win` fires once when
the game ends, carrying `result: "player" | "computer"` — for a
two-sided game the event is "this game finished", not "this game was won",
and firing it only on a player win would silently lose half the funnel.
`showInterstitial("game_over")` is awaited after the status line already
says who won and before the result modal opens, so the ad lands on a pause
and the player comes back to a screen that celebrates.

## Known gaps

- **The toolbar (Hint / Undo / New game / Settings) sits just below the
  fold on phones.** The shot controls are always on screen — that is what
  the sticky row is for — but the four buttons need a short scroll. They
  are one row of four rather than a 2×2 grid so that scroll is as small as
  possible. Fixing it properly would cost about 60px of table.
- **The goal line scrolls away on 375 × 667** after `revealTable()`. It is
  on screen at load and on every viewport 390 × 844 and larger.
- **The drawn cue is mostly off-canvas when the cue ball is near a rail** —
  which at the break it always is. The canvas is exactly the table box, so
  there is no room around it for a stick that in real life hangs off the
  end of the table. The guide line and the ghost ball carry the aiming;
  the cue is decoration.
- **No two-player pass-and-play.** `rules.js` already supports
  `players: ["human", "human"]` and it would be a Settings row plus a
  handful of status strings, but it doubles the wording surface and was
  left out of this pass.
- **No shot clock, no call pocket, no three-foul rule** — deliberate.
- Balls are drawn at a 60mm diameter against real pool's 57.15mm. Nobody
  can see 5%, and it buys a readable number.
- `src/i18n/strings.js` is **English only**. Every user-visible string
  goes through `i18n.t()` or `data-i18n`; a translator agent adds the
  other thirteen languages and `test/strings.test.js` will then guard
  them.

## How the QA runs

`tools/qa/pool_qa.py` starts `tools/serve.mjs` on **port 8134** (the real
CSP headers) and does three passes:

- `shots` — the seven BRIEF.md viewports, one screenshot each plus the
  settings sheet, asserting no console/page errors, no sideways scroll,
  the shot row on screen, and the ball at least 17px on a phone.
- `play` — a whole rack driven to its end at 390 × 844 and 1280 × 800,
  asserting exactly one `game_start` on a fresh load and none on a
  restore, one `game_win`, that the table comes back identical after a
  reload, and that Hint, Undo, Settings and the win modal's new rack all
  work.
- `arabic` — `<html dir="rtl">`, the board still `ltr`, the article still
  English and `ltr`, nothing overflowing.

Run one pass at a time with `python3 tools/qa/pool_qa.py shots` (etc.); a
full run takes several minutes because two racks are played shot by shot
through the real physics.
