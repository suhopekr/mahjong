// test/render.test.js
// game/render.js is DOM-only and is verified in a real browser
// (test/browser-check.mjs). starPoints() is the one pure function in it,
// so it is the only thing tested here — a deliberate line, not an
// oversight: asserting on canvas calls through a mock context tests the
// mock, not the drawing.
import { test, assertEqual, assertTrue } from "./harness.js";
import { starPoints } from "../src/game/render.js";

test("a 19-line board gets the conventional nine points", () => {
  const points = starPoints(19);
  assertEqual(points.length, 9);
  assertTrue(points.some(([x, y]) => x === 3 && y === 3), "4-4 corner point present");
  assertTrue(points.some(([x, y]) => x === 9 && y === 9), "tengen present");
});

test("the points are symmetric about the center", () => {
  for (const lines of [9, 13, 19]) {
    const points = starPoints(lines);
    const key = (p) => `${p[0]},${p[1]}`;
    const set = new Set(points.map(key));
    for (const [x, y] of points) {
      assertTrue(set.has(key([lines - 1 - x, y])), `${lines}: missing mirror of ${x},${y}`);
      assertTrue(set.has(key([x, lines - 1 - y])), `${lines}: missing mirror of ${x},${y}`);
    }
  }
});

test("a board too small for the inset gets no points rather than nonsense", () => {
  assertEqual(starPoints(4), []);
});
