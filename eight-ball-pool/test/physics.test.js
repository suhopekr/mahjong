// test/physics.test.js — pocket geometry: mouths, jaws, capture.
import { test, assertEqual, assertTrue } from "./harness.js";
import * as P from "../src/game/physics.js";

const R = P.BALL_RADIUS;
const L = P.TABLE_LENGTH;
const W = P.TABLE_WIDTH;

function worldWith(balls) {
  return P.createWorld({ balls });
}
function roll(world, id, vx, vy, seconds = 6) {
  const b = P.getBall(world, id);
  b.vx = vx;
  b.vy = vy;
  b.wy = vx / R;
  b.wx = -vy / R;
  P.simulateToRest(world, seconds);
  return world;
}

test("six pockets: four corners and two sides, side pockets on the long rails", () => {
  const w = worldWith([{ id: "cue", x: L / 2, y: W / 2 }]);
  assertEqual(w.pockets.length, 6);
  assertEqual(w.pockets.filter((p) => p.corner).length, 4);
  const sides = w.pockets.filter((p) => !p.corner);
  for (const s of sides) assertTrue(Math.abs(s.x - L / 2) < 1e-9, "side pocket at half length");
});

test("cushions: six segments with a gap at every mouth, twelve jaws", () => {
  const w = worldWith([{ id: "cue", x: L / 2, y: W / 2 }]);
  assertEqual(w.cushions.segs.length, 6);
  assertEqual(w.cushions.jaws.length, 12);
  for (const s of w.cushions.segs) assertTrue(s.b > s.a, "segment has length");
});

test("a ball rolling straight along the rail into a corner is pocketed", () => {
  const w = worldWith([{ id: "1", x: L * 0.3, y: R }]);
  roll(w, "1", -1.2, 0);
  const b = P.getBall(w, "1");
  assertTrue(b.pocketed, "pocketed");
  assertTrue(w.events.some((e) => e.type === "pocket" && e.ball === "1" && e.pocket === "tl"), "event names the top-left pocket");
});

test("a ball rolling into the middle of a long rail bounces back (cushion event, no pocket)", () => {
  const w = worldWith([{ id: "1", x: L * 0.3, y: W / 2 }]);
  roll(w, "1", 0, -1.0);
  const b = P.getBall(w, "1");
  assertTrue(!b.pocketed, "still on the table");
  assertTrue(w.events.some((e) => e.type === "cushion" && e.wall === "top"), "hit the top cushion");
  assertTrue(b.y > R * 1.5, "came back off the rail");
});

test("a ball aimed at a side pocket square-on drops in", () => {
  const w = worldWith([{ id: "1", x: L / 2, y: W / 2 }]);
  roll(w, "1", 0, -1.0);
  assertTrue(P.getBall(w, "1").pocketed, "pocketed");
  assertTrue(w.events.some((e) => e.type === "pocket" && e.pocket === "tm"), "top-middle pocket");
});

test("a ball crossing a side pocket along the rail at speed meets the far jaw", () => {
  const w = worldWith([{ id: "1", x: L / 2 - 0.25, y: R }]);
  roll(w, "1", 2.5, 0);
  // Either it drops (in real pool, it can) or it rattles off the jaw and
  // stays — but it must never end up outside the table, unpocketed.
  const b = P.getBall(w, "1");
  if (!b.pocketed) {
    assertTrue(b.x >= R - 1e-6 && b.x <= L - R + 1e-6 && b.y >= R - 1e-6 && b.y <= W - R + 1e-6, "inside the table");
    assertTrue(w.events.some((e) => e.type === "cushion" && e.wall === "jaw"), "touched a jaw");
  }
});

test("a centre crossing the rail line inside a corner mouth is already inside the capture circle (grazing the jaw)", () => {
  const w = worldWith([{ id: "1", x: L / 2, y: W / 2 }]);
  const tl = w.pockets.find((p) => p.id === "tl");
  // The closest a centre can pass to the jaw at (CORNER_MOUTH, 0) while
  // crossing y = 0 is one radius inside it.
  const x = P.CORNER_MOUTH - R;
  assertTrue(Math.hypot(x - tl.x, 0 - tl.y) < tl.r, "grazing crossing is captured");
  const tm = w.pockets.find((p) => p.id === "tm");
  const sx = L / 2 + P.SIDE_MOUTH - R;
  assertTrue(Math.hypot(sx - tm.x, 0 - tm.y) < tm.r, "side grazing crossing is captured");
});

test("a pocketed ball takes no part: nothing collides with it and the table can still come to rest", () => {
  const w = worldWith([
    { id: "1", x: L / 2, y: W / 2 },
    { id: "2", x: L / 2, y: W / 2 - 0.2 },
  ]);
  roll(w, "1", 0, -1.2, 8);
  assertTrue(P.getBall(w, "2").pocketed || P.getBall(w, "1").pocketed, "something went in");
  assertTrue(P.isAtRest(w), "at rest");
  // A ball fired at the pocket where the other sits is not stopped by it.
  const w2 = worldWith([{ id: "1", x: L / 2, y: W / 2, pocketed: true }, { id: "2", x: L / 2, y: W / 2 - 0.2 }]);
  P.getBall(w2, "1").x = w2.pockets[1].x;
  P.getBall(w2, "1").y = w2.pockets[1].y;
  roll(w2, "2", 0, -1.0);
  assertTrue(P.getBall(w2, "2").pocketed, "second ball still pockets past the first");
  assertTrue(!w2.events.some((e) => e.type === "ball"), "no contact with a pocketed ball");
});

test("energy never increases across a rail-and-jaw shot", () => {
  const w = worldWith([{ id: "1", x: 0.3, y: 0.3 }]);
  const b = P.getBall(w, "1");
  b.vx = 3;
  b.vy = -1.3;
  b.wy = b.vx / R;
  b.wx = -b.vy / R;
  let last = P.kineticEnergy(w);
  for (let i = 0; i < 600; i++) {
    P.stepWorld(w, P.SUB_DT);
    const e = P.kineticEnergy(w);
    assertTrue(e <= last + 1e-9, `energy rose at step ${i}: ${last} -> ${e}`);
    last = e;
  }
});

// ---- the definition of done: one ball into each of the six pockets ----

test("every one of the six pockets can be filled, and each one names itself", () => {
  // Aimed straight at the mouth from a ball's distance away, which is the
  // shot a player would call "in off the spot".
  const aimed = [
    { pocket: "tl", from: { x: 0.30, y: 0.30 }, dir: { x: -1, y: -1 } },
    { pocket: "tm", from: { x: L / 2, y: W * 0.55 }, dir: { x: 0, y: -1 } },
    { pocket: "tr", from: { x: L - 0.30, y: 0.30 }, dir: { x: 1, y: -1 } },
    { pocket: "bl", from: { x: 0.30, y: W - 0.30 }, dir: { x: -1, y: 1 } },
    { pocket: "bm", from: { x: L / 2, y: W * 0.45 }, dir: { x: 0, y: 1 } },
    { pocket: "br", from: { x: L - 0.30, y: W - 0.30 }, dir: { x: 1, y: 1 } },
  ];
  for (const a of aimed) {
    const w = worldWith([{ id: "1", x: a.from.x, y: a.from.y }]);
    const n = Math.hypot(a.dir.x, a.dir.y);
    roll(w, "1", (a.dir.x / n) * 1.1, (a.dir.y / n) * 1.1);
    const b = P.getBall(w, "1");
    assertTrue(b.pocketed, `${a.pocket}: the ball went down`);
    assertTrue(
      w.events.some((e) => e.type === "pocket" && e.ball === "1" && e.pocket === a.pocket),
      `${a.pocket}: the log names the pocket it fell into`
    );
  }
});

test("simulateToRest always terminates, and leaves a table nothing is still moving on", () => {
  // A full rack smashed at the cap, which is the worst case the game can
  // produce: sixteen balls, hundreds of contacts, several going down.
  const balls = [{ id: "cue", x: L * 0.17, y: W / 2 }];
  let n = 0;
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      balls.push({
        id: String(++n),
        x: L * 0.75 + row * 2 * R * 0.87,
        y: W / 2 + (k - row / 2) * (2 * R + 0.0003),
      });
    }
  }
  for (const speed of [P.MAX_SHOT_SPEED, 3.2, 0.4]) {
    const w = worldWith(balls.map((b) => ({ ...b })));
    const cue = P.getBall(w, "cue");
    P.strike(cue, 1, 0.013, speed);
    const t0 = Date.now();
    P.simulateToRest(w);
    assertTrue(Date.now() - t0 < 12000, `a ${speed} m/s break finished in time`);
    assertTrue(w.time < P.MAX_SHOT_SECONDS, `it reached rest inside the cutoff (${w.time.toFixed(2)}s)`);
    for (const b of w.balls) {
      assertEqual([b.vx, b.vy, b.wx, b.wy, b.wz], [0, 0, 0, 0, 0], `${b.id} is stopped`);
      if (b.pocketed) continue;
      assertTrue(b.x > -1e-9 && b.x < L + 1e-9 && b.y > -1e-9 && b.y < W + 1e-9, `${b.id} is on the table`);
    }
  }
});

test("energy never increases across a full break, substep by substep", () => {
  const balls = [{ id: "cue", x: L * 0.17, y: W / 2 }];
  let n = 0;
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      balls.push({ id: String(++n), x: L * 0.75 + row * 2 * R * 0.87, y: W / 2 + (k - row / 2) * (2 * R + 0.0003) });
    }
  }
  const w = worldWith(balls);
  P.strike(P.getBall(w, "cue"), 1, 0.02, 5.5);
  let last = P.kineticEnergy(w);
  for (let i = 0; i < 4000; i++) {
    P.stepWorld(w, P.SUB_DT);
    const e = P.kineticEnergy(w);
    // A pocketed ball's energy leaves the table with it, which is a drop,
    // never a rise. The tolerance is float noise on a 16-ball table.
    assertTrue(e <= last + 1e-9, `energy fell at substep ${i}: ${last} -> ${e}`);
    last = e;
    if (P.isAtRest(w)) break;
  }
});
