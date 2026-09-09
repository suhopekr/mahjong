// test/rules.test.js
import { test, assertEqual, assertTrue } from "./harness.js";
import * as P from "../src/game/physics.js";
import * as R from "../src/game/rules.js";

const L = P.BOARD_LENGTH;
const Rr = P.PUCK_RADIUS;
const puck = (owner, x, id = 0) => ({ id, owner, x, y: 0.25, vx: 0, vy: 0, off: false, foul: false });

test("zone values by the rear edge; touching a line takes the lower zone", () => {
  assertEqual(R.puckValue(puck(0, L - P.ZONE_3_DEPTH + Rr + 0.001)), 3, "clear of the 3 line");
  assertEqual(R.puckValue(puck(0, L - P.ZONE_3_DEPTH + Rr - 0.001)), 2, "touching the 3 line is a 2");
  assertEqual(R.puckValue(puck(0, L - P.ZONE_2_DEPTH + Rr + 0.001)), 2);
  assertEqual(R.puckValue(puck(0, L - P.ZONE_2_DEPTH + Rr - 0.001)), 1, "touching the 2 line is a 1");
  assertEqual(R.puckValue(puck(0, P.FOUL_X + Rr + 0.001)), 1, "just over the foul line");
  assertEqual(R.puckValue(puck(0, P.FOUL_X + Rr - 0.001)), 0, "touching the foul line is nothing");
});

test("a hanger is a 4, and over the edge is nothing", () => {
  assertEqual(R.puckValue(puck(0, L - Rr / 2)), 4, "rim over the edge, centre on");
  assertTrue(R.isHanger(puck(0, L - Rr / 2)));
  assertEqual(R.puckValue({ ...puck(0, L + 0.01), off: true }), 0);
  assertEqual(R.puckValue({ ...puck(0, L - 0.05), foul: true }), 0);
});

test("only the side with the farthest weight scores, and only past the other side's best", () => {
  const w = P.createWorld();
  w.pucks = [
    puck(0, L - 0.05, 1), // side 0: a 3
    puck(1, L - 0.30, 2), // side 1: a 2, the bar
    puck(0, L - 0.20, 3), // side 0: a 2, past the bar
    puck(0, L - 0.60, 4), // side 0: a 1, BEHIND the bar — does not count
    puck(1, L - 0.80, 5), // side 1: a 1
  ];
  const r = R.scoreFrame(w);
  assertEqual(r.winner, 0);
  assertEqual(r.points, 5);
  assertEqual(r.counted.sort(), [1, 3]);
});

test("a board with nothing live is a blank frame", () => {
  const w = P.createWorld();
  w.pucks = [{ ...puck(0, L - 0.1, 1), off: true }, { ...puck(1, 0.5, 2), foul: true }];
  assertEqual(R.scoreFrame(w), { winner: null, points: 0, counted: [] });
});

test("shots alternate and the frame ends after eight", () => {
  const m = R.createMatch(0);
  const order = [];
  for (let i = 0; i < 8; i++) {
    order.push(m.shooter);
    const next = R.recordShot(m);
    if (i < 7) assertEqual(next, m.shooter);
    else assertEqual(next, null, "eighth shot closes the frame");
  }
  assertEqual(order, [0, 1, 0, 1, 0, 1, 0, 1]);
  assertTrue(R.frameComplete(m));
});

test("the scorer leads off the next frame; a blank frame keeps the lead-off", () => {
  const m = R.createMatch(0);
  for (let i = 0; i < 8; i++) R.recordShot(m);
  R.endFrame(m, { winner: 1, points: 3, counted: [] });
  assertEqual(m.scores, [0, 3]);
  assertEqual(m.frame, 2);
  assertEqual(m.shooter, 1, "side 1 scored, side 1 leads off");
  for (let i = 0; i < 8; i++) R.recordShot(m);
  R.endFrame(m, { winner: null, points: 0, counted: [] });
  assertEqual(m.shooter, 1, "blank frame: same lead-off");
  assertEqual(m.frame, 3);
});

test("first to fifteen ends the match", () => {
  const m = R.createMatch(0);
  R.endFrame(m, { winner: 0, points: 8, counted: [] });
  assertTrue(!m.over);
  R.endFrame(m, { winner: 0, points: 7, counted: [] });
  assertTrue(m.over);
  assertEqual(m.winner, 0);
  assertEqual(m.scores, [15, 0]);
});
