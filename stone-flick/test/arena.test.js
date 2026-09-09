// test/arena.test.js
import { test, assertEqual, assertTrue } from "./harness.js";
import { createMatch, selectableStones, shoot, resolveImmediately, isSelectable, advance } from "../src/game/arena.js";
import { countAlive, MAX_TURN_SECONDS } from "../src/game/physics.js";
import { getStage, versusLayout, STAGES } from "../src/game/stages.js";

const twoOnOne = {
  id: 1,
  stones: { 0: [{ x: 0.5, y: 0.9 }, { x: 0.35, y: 0.9 }], 1: [{ x: 0.5, y: 0.2 }] },
  obstacles: [],
};

test("a shot travels at the same SPEED whatever the refresh rate", () => {
  // physics.js integrates whole substeps and hands the remainder back to
  // the caller. Nobody carried it, and at 60Hz nobody could tell: a
  // 16.667ms frame is exactly five 300Hz substeps. At 120Hz it is two
  // substeps and 1.667ms dropped, every frame — the world ran at 80%
  // speed and stuttered between two and three steps as the frame time
  // moved. That is the "the flight isn't smooth" report, and it is
  // invisible to a resting-position test: dropping time changes how LONG
  // a stone takes to stop, never where it stops. So this measures where
  // it has got to after a fixed amount of WALL time.
  const travelAfter = (hz, seconds) => {
    const match = createMatch({ stage: versusLayout(3), startingPlayer: 0, mode: "versus" });
    const stone = match.world.stones.find((s) => s.player === 0);
    const from = { x: stone.x, y: stone.y };
    shoot(match, stone.id, 0.2, -1, 0.7);
    const dt = 1 / hz;
    for (let i = 0; i < Math.round(hz * seconds); i++) advance(match, dt);
    const after = match.world.stones.find((s) => s.id === stone.id);
    return Math.hypot(after.x - from.x, after.y - from.y);
  };
  const at60 = travelAfter(60, 0.25);
  const at120 = travelAfter(120, 0.25);
  const at144 = travelAfter(144, 0.25);
  assertTrue(at60 > 0.2, `nothing to compare: only ${at60.toFixed(3)} board widths in 0.25s`);
  // Within one substep of travel, not within one frame's worth.
  assertTrue(Math.abs(at120 - at60) < 0.01, `0.25s of play: ${at60.toFixed(3)} at 60Hz, ${at120.toFixed(3)} at 120Hz`);
  assertTrue(Math.abs(at144 - at60) < 0.01, `0.25s of play: ${at60.toFixed(3)} at 60Hz, ${at144.toFixed(3)} at 144Hz`);
});

test("only the side to move can be flicked", () => {
  const match = createMatch({ stage: twoOnOne });
  assertEqual(selectableStones(match).map((s) => s.player), [0, 0]);
  assertTrue(!isSelectable(match, 2), "the opponent's stone is not selectable");
});

test("an illegal shot changes nothing and reports false rather than throwing", () => {
  const match = createMatch({ stage: twoOnOne });
  assertEqual(shoot(match, 2, 0, -1, 1), false, "wrong side's stone");
  assertEqual(shoot(match, 0, 0, -1, 0), false, "zero power");
  assertEqual(shoot(match, 0, 0, 0, 1), false, "zero-length direction");
  assertEqual(match.shooter, null, "nothing is in flight");
  assertEqual(match.turnCount, 0);
});

test("the turn passes after a shot resolves", () => {
  const match = createMatch({ stage: twoOnOne });
  shoot(match, 1, 1, 0, 0.15); // a gentle sideways nudge that hits nothing
  resolveImmediately(match);
  assertEqual(match.current, 1, "it is now the opponent's turn");
  assertEqual(match.turnCount, 1);
  assertEqual(match.status, "playing");
});

test("clearing the opponent's last stone wins", () => {
  const match = createMatch({ stage: twoOnOne });
  shoot(match, 0, 0, -1, 1); // straight up the board, through the lone opponent
  resolveImmediately(match);
  assertEqual(countAlive(match.world, 1), 0);
  assertEqual(match.status, "won");
});

test("losing your own last stone loses, even on the shot that clears theirs", () => {
  // A GLANCING full-power shot: a head-on hit between equal masses stops
  // the shooter dead (that is the physics, and test/physics.test.js
  // asserts it), so the only way to lose your own stone on the same shot
  // is to keep most of your speed — which is exactly what an off-center
  // hit does. The target sits just below the top edge, so the sideways
  // nudge is enough to put it out, and the shooter carries on off the
  // same edge.
  const suicide = {
    id: 2,
    stones: { 0: [{ x: 0.5, y: 0.9 }], 1: [{ x: 0.53, y: 0.06 }] },
    obstacles: [],
  };
  const match = createMatch({ stage: suicide });
  shoot(match, 0, 0, -1, 1);
  resolveImmediately(match);
  assertEqual(countAlive(match.world, 0), 0, "the shooter's own stone also left the board");
  assertEqual(countAlive(match.world, 1), 0, "so did the target");
  assertEqual(match.status, "lost", "the reckless shot does not win the game");
});

test("a long match keeps resolving shots properly through the frame path", () => {
  // THE regression test for a bug that reached a real player: the turn
  // timeout was compared against a world odometer that never reset, so
  // once a match had accumulated MAX_TURN_SECONDS of total motion — a
  // handful of turns — every later shot ended its turn on the very first
  // frame. Stones twitched, play passed, nobody could do anything, and no
  // error was raised anywhere.
  //
  // It hid because every other test in this file resolves through
  // resolveImmediately(), which counts seconds locally. Only the browser's
  // advance() path read the odometer — so this test drives advance()
  // frame by frame, exactly as main.js's animation loop does, and plays
  // long enough to pass the old threshold several times over.
  // CHOSEN BY CONTENT, not by number. This used to name stage 12, which
  // was a wall-and-pegs stage when it was written and became a stage with
  // a pit when the campaign went to a hundred -- at which point the gentle
  // shots below started sinking stones and the match ended long before the
  // bug's threshold. The test needs a board where forty nudges toward the
  // middle change nothing, so it asks for one: no pit to fall into, no
  // portal to be moved by, and enough stones that nothing runs out.
  const stage = STAGES.find((s) =>
    s.stones[0].length >= 4 && s.stones[1].length >= 4 &&
    !(s.obstacles ?? []).some((o) => o.type === "hole" || o.type === "portal"));
  assertTrue(Boolean(stage), "the campaign has no pit-free stage big enough for this test");
  const match = createMatch({ stage });
  const FRAME = 1 / 60;
  let shotsFired = 0;
  let shotsThatMoved = 0;

  for (let turn = 0; turn < 40 && match.status === "playing"; turn++) {
    const mine = selectableStones(match);
    if (mine.length === 0) break;
    const stone = mine[0];
    const before = { x: stone.x, y: stone.y };
    // Gently, toward the middle of the board: the point is to accumulate
    // SIMULATED TIME across many turns, so nothing must actually be
    // knocked off or the match ends before the bug's threshold is
    // anywhere near reached.
    assertTrue(shoot(match, stone.id, 0.5 - stone.x, 0.5 - stone.y, 0.3), `turn ${turn}: shot rejected`);
    shotsFired += 1;

    let frames = 0;
    while (match.shooter !== null && frames < 1200) {
      advance(match, FRAME);
      frames += 1;
    }
    assertTrue(match.shooter === null, `turn ${turn}: shot never resolved`);
    if (Math.hypot(stone.x - before.x, stone.y - before.y) > 0.02) shotsThatMoved += 1;
  }

  assertTrue(shotsFired >= 20, `only ${shotsFired} shots were fired`);
  // Proof the scenario was actually reproduced rather than merely
  // attempted: the world's own odometer has to have passed the per-turn
  // budget that the old code compared it against.
  assertTrue(
    match.world.elapsed > MAX_TURN_SECONDS,
    `total simulated time ${match.world.elapsed.toFixed(1)}s never passed the ${MAX_TURN_SECONDS}s budget, so this run would not have caught the bug`
  );
  assertEqual(
    shotsThatMoved,
    shotsFired,
    "every shot must actually travel — a turn that ends on frame one is the bug this test exists for"
  );
});

// The narration buffer this used to guard is gone: `lastEvents` was a
// per-match copy of every event, appended to on every frame, and the only
// reader of it (drainEvents) was never called — main.js has always taken
// the events straight off advance()'s return value. A buffer that grows
// and that nobody reads is not a feature with a bug in it, so the buffer
// went rather than the test around it.

test("a combo counts only the OPPONENT's stones", () => {
  // The bug this exists for: a shot that took one enemy stone and one of
  // your own was announced as a "Double!". main.js was counting from
  // `handleEvents(advance(...))`, so advance() had already ended the turn
  // and set `shooter` back to null — and every stone's owner differs from
  // null, so everything counted. Reported from real play.
  //
  // The glancing setup from the mutual-wipeout test above: the shooter
  // keeps most of its speed, clips the opponent off the top edge, and
  // carries on off the same edge itself. One enemy stone, one of yours.
  const both = {
    id: 3,
    stones: { 0: [{ x: 0.5, y: 0.9 }, { x: 0.2, y: 0.9 }], 1: [{ x: 0.53, y: 0.06 }, { x: 0.8, y: 0.5 }] },
    obstacles: [],
  };
  const match = createMatch({ stage: both });
  shoot(match, 0, 0, -1, 1);
  resolveImmediately(match);
  assertEqual(countAlive(match.world, 0), 1, "the shooter went off the board too");
  assertEqual(countAlive(match.world, 1), 1, "one opponent stone went off");
  assertEqual(match.turnKills, 1, "one enemy stone is one kill, however many of your own went with it");
});

test("a genuine double counts two", () => {
  // Side by side near the top edge, so one shot up the middle clips both
  // and pushes them apart and off. Note it is NOT a straight line of two:
  // an equal-mass head-on chain stops the first stone dead and only the
  // LAST one moves, which is correct physics and a single kill.
  const lineUp = {
    id: 4,
    stones: { 0: [{ x: 0.5, y: 0.9 }], 1: [{ x: 0.47, y: 0.05 }, { x: 0.55, y: 0.05 }] },
    obstacles: [],
  };
  const match = createMatch({ stage: lineUp });
  shoot(match, 0, 0, -1, 1);
  resolveImmediately(match);
  assertEqual(countAlive(match.world, 1), 0);
  assertEqual(match.turnKills, 2);
});

test("the combo count resets with each shot", () => {
  const match = createMatch({ stage: twoOnOne });
  shoot(match, 0, 0, -1, 1);
  resolveImmediately(match);
  assertTrue(match.turnKills >= 1, "the first shot scored");
  const next = createMatch({ stage: twoOnOne });
  shoot(next, 1, 1, 0, 0.12); // a nudge that hits nothing
  resolveImmediately(next);
  assertEqual(next.turnKills, 0);
});

test("a resolved match cannot be shot again", () => {
  const match = createMatch({ stage: twoOnOne });
  shoot(match, 0, 0, -1, 1);
  resolveImmediately(match);
  assertEqual(match.status, "won");
  assertEqual(shoot(match, 1, 0, -1, 1), false);
});
