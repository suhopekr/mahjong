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

// --- orientation ---------------------------------------------------------
// The renderer paints a ball's number and stripe through `rot`, so these
// pin the four properties the picture depends on: a fresh rack faces up,
// rolling turns by exactly the angle the travel implies, the matrix stays
// a rotation over a long run, and pure english turns the ball about the
// vertical without tipping the number off the top.

/** Is this nine-number matrix a rotation? Rows orthonormal, determinant
 * +1 (a determinant of -1 is a reflection, which would turn the ball's
 * markings into their mirror images without ever failing an orthogonality
 * check). */
function rotationError(m) {
  let worst = 0;
  const row = (i) => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const a = row(i);
      const b = row(j);
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      worst = Math.max(worst, Math.abs(dot - (i === j ? 1 : 0)));
    }
  }
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  return Math.max(worst, Math.abs(det - 1));
}

test("a new world racks every ball with its number facing straight up", () => {
  const w = worldWith([
    { id: "cue", x: L * 0.25, y: W / 2 },
    { id: "8", x: L * 0.75, y: W / 2 },
  ]);
  for (const b of w.balls) {
    assertEqual(b.rot, [1, 0, 0, 0, 1, 0, 0, 0, 1], `${b.id} starts upright`);
  }
});

test("rolling in +x turns the ball about +y by exactly distance / R", () => {
  // +y in the TABLE frame, which has z pointing up out of the cloth. Read
  // the picture on screen instead, where y points down, and the same turn
  // is about -y. The relation under both names is the no-slip condition:
  // the contact point must stand still, so vx - R*wy = 0.
  const w = worldWith([{ id: "cue", x: L * 0.2, y: W / 2 }]);
  const b = P.getBall(w, "cue");
  const x0 = b.x;
  // Natural roll from the first instant: wy = vx/R is the no-slip state,
  // so nothing here is skidding and the whole journey is pure rolling.
  b.vx = 1.2;
  b.wy = b.vx / R;
  // Stepped for a fixed time rather than run to rest, so the ball never
  // reaches the far cushion — a rebound would be a second, opposite turn
  // and the total angle would no longer be the total distance.
  for (let i = 0; i < 240; i++) P.stepWorld(w, P.SUB_DT);
  const dist = b.x - x0;
  assertTrue(dist > 0.2, `it actually travelled (${dist.toFixed(3)}m)`);

  // The turn should be about the +y axis by theta = dist / R. Check the
  // matrix against the rotation that angle names, not just its trace, so
  // a turn about the wrong axis or the wrong way round cannot pass.
  const th = dist / R;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const want = [c, 0, s, 0, 1, 0, -s, 0, c];
  for (let i = 0; i < 9; i++) {
    assertTrue(
      Math.abs(b.rot[i] - want[i]) < 1e-6,
      `element ${i}: expected ${want[i].toFixed(6)}, got ${b.rot[i].toFixed(6)} (theta=${th.toFixed(3)})`
    );
  }
  // And the sense of it: the mark that started on top has moved FORWARD,
  // toward +x, which is what "rolling" means and what "sliding" does not.
  const topAfter = [b.rot[2], b.rot[5], b.rot[8]];
  assertTrue(Math.abs(topAfter[1]) < 1e-9, "the roll axis stayed put");
  assertEqual(Math.abs(Math.hypot(...topAfter) - 1) < 1e-9, true, "still a unit vector");
});

test("the orientation stays a rotation matrix over a long, messy run", () => {
  const balls = [{ id: "cue", x: L * 0.2, y: W * 0.3 }];
  for (let i = 1; i <= 6; i++) {
    balls.push({ id: String(i), x: L * (0.5 + i * 0.05), y: W * (0.3 + (i % 3) * 0.18) });
  }
  const w = worldWith(balls);
  // Ten hard shots in a row: cushions, ball-ball throw, english, draw —
  // thousands of matrix products per ball, which is where a naive
  // integrator's shear would show up.
  for (let shot = 0; shot < 10; shot++) {
    const cue = P.getBall(w, "cue");
    if (cue.pocketed) break;
    P.strike(cue, Math.cos(shot * 1.1), Math.sin(shot * 1.1), 4.5, 0.004, 0.006);
    P.simulateToRest(w);
  }
  for (const b of w.balls) {
    assertTrue(rotationError(b.rot) < 1e-9, `${b.id} is still a rotation (err ${rotationError(b.rot)})`);
  }
});

test("pure english spins the ball about the vertical and leaves its number facing up", () => {
  const w = worldWith([{ id: "9", x: L / 2, y: W / 2 }]);
  const b = P.getBall(w, "9");
  b.wz = 40;
  // isAtRest() does not count english — a ball spinning in place is at
  // rest as far as the RULES are concerned — so this is stepped by hand
  // rather than through simulateToRest, which would return at once.
  for (let i = 0; i < 300; i++) P.stepWorld(w, P.SUB_DT);
  assertTrue(Math.abs(b.x - L / 2) < 1e-12 && Math.abs(b.y - W / 2) < 1e-12, "it never moved");
  // The ball's own +z — the pole the number is printed on — is the third
  // COLUMN of the matrix, and a turn about the vertical leaves it exactly
  // where it was. A number that tipped here would be spin leaking into
  // the rolling axis.
  assertTrue(Math.abs(b.rot[2]) < 1e-12, "no tip in x");
  assertTrue(Math.abs(b.rot[5]) < 1e-12, "no tip in y");
  assertTrue(Math.abs(b.rot[8] - 1) < 1e-12, "the number still faces straight up");
  // But it DID turn: the ball's own x axis has swung away from the
  // table's, so the number is rotated in its own plane.
  assertTrue(Math.abs(b.rot[0] - 1) > 1e-6 || Math.abs(b.rot[1]) > 1e-6, "it actually spun");
});

test("a cloned world's orientation is its own, so previews cannot spin the real table", () => {
  const w = worldWith([{ id: "cue", x: L * 0.25, y: W / 2 }]);
  const copy = P.cloneWorld(w);
  P.strike(P.getBall(copy, "cue"), 1, 0, 3);
  P.simulateToRest(copy, 6);
  assertEqual(P.getBall(w, "cue").rot, [1, 0, 0, 0, 1, 0, 0, 0, 1], "the original never turned");
  assertTrue(rotationError(P.getBall(copy, "cue").rot) < 1e-9, "the clone's did");
});
