// test/layout.test.js
import { test, assertTrue, assertEqual } from "./harness.js";
import { computeLayout } from "../src/game/layout.js";
import * as P from "../src/game/physics.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// The kickoff doc's viewport list, portal frame included.
const VIEWS = [
  [390, 780],
  [375, 667],
  [1160, 610],
  [1920, 1080],
  [844, 390],
  [900, 900],
];

test("toScreen and toBoard invert each other everywhere", () => {
  for (const [w, h] of VIEWS) {
    const lay = computeLayout(w, h);
    for (const [x, y] of [[0, 0], [P.BOARD_LENGTH, P.BOARD_WIDTH], [1.2, 0.25], [P.START_X, 0.1]]) {
      const s = lay.toScreen(x, y);
      const b = lay.toBoard(s.x, s.y);
      assertTrue(near(b.x, x, 1e-9) && near(b.y, y, 1e-9), `${w}x${h} round trip (${x},${y})`);
    }
  }
});

test("portrait shoots up the screen, landscape shoots right", () => {
  const p = computeLayout(390, 780);
  assertEqual(p.orient, "portrait");
  assertTrue(p.toScreen(P.BOARD_LENGTH, 0.25).y < p.toScreen(0, 0.25).y, "scoring end is higher");
  const l = computeLayout(1160, 610);
  assertEqual(l.orient, "landscape");
  assertTrue(l.toScreen(P.BOARD_LENGTH, 0.25).x > l.toScreen(0, 0.25).x, "scoring end is right");
});

test("a forward screen drag is a forward board move in both orientations", () => {
  const p = computeLayout(390, 780);
  assertTrue(p.forward(0, -100).along > 0, "portrait: dragging up is forward");
  assertTrue(p.forward(30, -100).across > 0, "portrait: right of the line is +y");
  const l = computeLayout(1160, 610);
  assertTrue(l.forward(100, 0).along > 0, "landscape: dragging right is forward");
});

test("the whole table fits inside every supported viewport", () => {
  for (const [w, h] of VIEWS) {
    const lay = computeLayout(w, h);
    const t = lay.tableRect;
    assertTrue(t.x >= 0 && t.y >= 0 && t.x + t.w <= w && t.y + t.h <= h, `${w}x${h}`);
  }
});

test("a weight is never drawn smaller than a visible thing", () => {
  // 6px radius is the floor below which the weights stop reading as
  // objects. Every supported viewport must clear it.
  for (const [w, h] of VIEWS) {
    const lay = computeLayout(w, h);
    assertTrue(lay.puckPx >= 6, `${w}x${h}: puck radius ${lay.puckPx.toFixed(1)}px`);
  }
});
