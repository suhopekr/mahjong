// test/preview.test.js
// The preview's one promise is that it is not a prediction.
//
// It is sold to the player as "the line is the real path", which is a
// claim about determinism rather than about drawing: the same shot, run
// twice on the same position, must end in the same place. If that ever
// stopped being true the feature would be a lie the player paid for, so
// it is checked against the actual turn simulation rather than against a
// recorded fixture — a fixture would keep passing while both sides drifted
// together.
import { test, assertTrue, assertEqual } from "./harness.js";
import { createWorld, beginShot, simulateToRest, STONE_RADIUS } from "../src/game/physics.js";
import { simulateShotPath } from "../src/game/preview.js";

const open = () => createWorld({
  stones: [
    { id: 1, player: 0, x: 0.5, y: 0.8 },
    { id: 2, player: 1, x: 0.5, y: 0.25 },
  ],
  obstacles: [],
});

/** The same board with a peg planted squarely on the line between them. */
const blocked = () => createWorld({
  stones: [
    { id: 1, player: 0, x: 0.5, y: 0.8 },
    { id: 2, player: 1, x: 0.5, y: 0.25 },
  ],
  obstacles: [{ type: "peg", x: 0.5, y: 0.52, radius: 0.045 }],
});

function realOutcome(world, id, dx, dy, power) {
  const stone = world.stones.find((s) => s.id === id);
  beginShot(world, stone, dx, dy, power);
  simulateToRest(world);
  return stone;
}

test("the previewed path ends where the shot actually ends", () => {
  const preview = simulateShotPath(open(), 1, 0, -1, 0.75);
  const truth = realOutcome(open(), 1, 0, -1, 0.75);
  const last = preview.points[preview.points.length - 1];
  assertTrue(preview.points.length > 2, "a real shot produces a real path");
  // A tenth of a stone radius. The preview samples every third substep,
  // so its last recorded point is at most a couple of substeps of
  // crawling short of the true resting place.
  const gap = Math.hypot(last.x - truth.x, last.y - truth.y);
  assertTrue(gap < STONE_RADIUS * 0.1, `preview ended ${gap.toFixed(5)} from the real resting place`);
});

test("running the same preview twice gives the same path", () => {
  const a = simulateShotPath(open(), 1, 0.2, -1, 0.6);
  const b = simulateShotPath(open(), 1, 0.2, -1, 0.6);
  assertEqual(a.points.length, b.points.length);
  assertEqual(a.contactAt, b.contactAt);
  assertEqual(a.points[a.points.length - 1], b.points[b.points.length - 1]);
});

test("the preview never disturbs the world it was asked about", () => {
  const world = open();
  const before = world.stones.map((s) => ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy }));
  simulateShotPath(world, 1, 0, -1, 1);
  assertEqual(world.stones.map((s) => ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy })), before);
});

test("a blocked shot is drawn, not refused — and it bends at the peg", () => {
  // The question this whole feature had to answer: what does the preview
  // show when a prop is in the way and the shot can never reach what the
  // player is aiming at? It shows the truth, which is the most useful
  // thing it could possibly show — the angle is closed, before the turn
  // is spent finding that out.
  const preview = simulateShotPath(blocked(), 1, 0, -1, 0.8);
  assertTrue(preview.contactAt > 0, "the peg registers as a contact");
  assertTrue(
    preview.contactAt < preview.points.length - 1,
    "and there is still path to draw after it — the stone bounces, it does not vanish",
  );
  const last = preview.points[preview.points.length - 1];
  const truth = realOutcome(blocked(), 1, 0, -1, 0.8);
  const gap = Math.hypot(last.x - truth.x, last.y - truth.y);
  assertTrue(gap < STONE_RADIUS * 0.1, `blocked preview ended ${gap.toFixed(5)} from the truth`);
  // And the point of the exercise: it did NOT arrive where it was aimed.
  assertTrue(last.y > 0.32, "a shot into a peg does not reach the far stone");
});

test("a stone knocked off the board draws a path that stops at the rim", () => {
  const world = createWorld({
    stones: [{ id: 1, player: 0, x: 0.5, y: 0.5 }],
    obstacles: [],
  });
  const preview = simulateShotPath(world, 1, 0, -1, 1);
  assertEqual(preview.ending, "fellOff");
  const last = preview.points[preview.points.length - 1];
  assertTrue(last.y < 0.06, "the line ends at the edge it left by");
});

test("an unknown stone id is an empty path, not a crash", () => {
  const preview = simulateShotPath(open(), 99, 0, -1, 1);
  assertEqual(preview.points, []);
});
