// test/physics.test.js
import { test, assertTrue, assertEqual } from "./harness.js";
import * as P from "../src/game/physics.js";
import { previewShot } from "../src/game/preview.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("a full-strength shot overshoots the board; a weak one stops short", () => {
  assertTrue(P.rangeFor(1) > P.BOARD_LENGTH, "max range clears the end");
  assertTrue(P.rangeFor(0.5) < P.BOARD_LENGTH - P.START_X, "half power stays on");
});

test("rangeFor and powerFor invert each other", () => {
  for (const d of [0.3, 1.0, 1.9, 2.3]) {
    assertTrue(near(P.rangeFor(P.powerFor(d)), d, 1e-9), `distance ${d}`);
  }
});

test("a lone weight stops where the closed form says", () => {
  const w = P.createWorld();
  const p = P.shoot(w, 0, P.BOARD_WIDTH / 2, 0, 0.7);
  P.simulateToRest(w);
  const expected = P.START_X + P.rangeFor(0.7);
  // Discrete integration lands within a couple of millimetres.
  assertTrue(Math.abs(p.x - expected) < 0.004, `stopped at ${p.x}, expected ${expected}`);
  assertTrue(p.vx === 0 && p.vy === 0, "fully at rest");
  assertTrue(near(p.y, P.BOARD_WIDTH / 2), "no lateral drift");
});

test("every shot comes to rest well inside the cutoff", () => {
  let worst = 0;
  for (let i = 0; i < 40; i++) {
    const w = P.createWorld();
    const power = 0.2 + (i / 40) * 0.8;
    P.shoot(w, i % 2, P.MIN_START_Y + (i / 40) * (P.MAX_START_Y - P.MIN_START_Y), (i % 7 - 3) * 0.03, power);
    const t = P.simulateToRest(w, 30);
    worst = Math.max(worst, t);
  }
  assertTrue(worst < 5, `worst time to rest ${worst.toFixed(2)}s`);
});

test("a weight sent off the end falls in the gutter and reports it", () => {
  const w = P.createWorld();
  const p = P.shoot(w, 0, P.BOARD_WIDTH / 2, 0, 1);
  P.simulateToRest(w);
  assertTrue(p.off, "off the end");
  const ev = w.events.find((e) => e.type === "off");
  assertEqual(ev && ev.where, "end");
});

test("a weight aimed wide leaves at the side, and short weights foul", () => {
  const w = P.createWorld();
  const wide = P.shoot(w, 0, P.MAX_START_Y, P.MAX_AIM_ANGLE, 0.9);
  P.simulateToRest(w);
  assertTrue(wide.off, "into the side gutter");
  assertEqual(w.events.find((e) => e.type === "off").where, "side");
  const w2 = P.createWorld();
  const short = P.shoot(w2, 1, P.BOARD_WIDTH / 2, 0, 0.35);
  P.simulateToRest(w2);
  const removed = P.removeFouls(w2);
  assertEqual(removed.length, 1);
  assertTrue(short.foul, "marked foul");
  assertEqual(P.livePucks(w2).length, 0);
});

test("a head-on hit hands almost all speed to the struck weight", () => {
  const w = P.createWorld();
  // Park a weight in the middle of the board, then hit it dead on.
  const target = P.shoot(w, 1, P.BOARD_WIDTH / 2, 0, P.powerFor(1.2));
  P.simulateToRest(w);
  const tx = target.x;
  const shooter = P.shoot(w, 0, P.BOARD_WIDTH / 2, 0, 0.8);
  P.simulateToRest(w);
  assertTrue(target.x > tx + 0.3, `target moved on from ${tx} to ${target.x}`);
  assertTrue(shooter.x < target.x, "shooter stays behind the weight it hit");
  assertTrue(shooter.x > tx - 0.1, "shooter followed to roughly the contact point");
  assertTrue(w.events.some((e) => e.type === "hit"), "a hit was reported");
});

test("the same shot lands on the same square: determinism", () => {
  const run = () => {
    const w = P.createWorld();
    P.shoot(w, 1, 0.2, 0.05, 0.72);
    P.simulateToRest(w);
    P.shoot(w, 0, 0.21, 0.04, 0.78);
    P.simulateToRest(w);
    P.shoot(w, 1, 0.3, -0.06, 0.8);
    P.simulateToRest(w);
    return w.pucks.map((p) => [p.x, p.y, p.off]);
  };
  assertEqual(run(), run());
});

test("frame-sized steps and substep-sized steps agree", () => {
  const a = P.createWorld();
  const b = P.createWorld();
  P.shoot(a, 0, 0.25, 0.02, 0.8);
  P.shoot(b, 0, 0.25, 0.02, 0.8);
  P.simulateToRest(a);
  let t = 0;
  while (!P.isAtRest(b) && t < 20) {
    P.stepWorld(b, 1 / 60);
    t += 1 / 60;
  }
  assertTrue(near(a.pucks[0].x, b.pucks[0].x, 1e-9) && near(a.pucks[0].y, b.pucks[0].y, 1e-9), "same landing");
});

test("weights never overlap at rest", () => {
  const w = P.createWorld();
  for (let i = 0; i < 8; i++) {
    P.shoot(w, i % 2, 0.2 + (i % 3) * 0.05, (i % 5 - 2) * 0.02, 0.66 + (i % 4) * 0.02);
    P.simulateToRest(w);
  }
  const live = P.livePucks(w);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const d = Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y);
      assertTrue(d >= P.PUCK_RADIUS * 2 - 1e-6, `weights ${i} and ${j} overlap by ${P.PUCK_RADIUS * 2 - d}`);
    }
  }
});

test("cloneWorld is independent of the original", () => {
  const w = P.createWorld();
  P.shoot(w, 0, 0.25, 0, 0.5);
  const c = P.cloneWorld(w);
  P.simulateToRest(c);
  assertTrue(w.pucks[0].vx > 0, "original untouched");
  assertTrue(c.pucks[0].vx === 0, "copy ran");
});

test("the bought preview replays exactly what the real shot does", () => {
  // Static import rather than an async body. That used to be forced:
  // the harness counted a pass the moment fn() RETURNED, so an async
  // test that failed reported ok and exploded later. test/harness.js
  // awaits now, so this is only a preference — one less moving part.
  const w = P.createWorld();
  P.shoot(w, 1, 0.3, 0.02, P.powerFor(2.0));
  P.simulateToRest(w);
  const pv = previewShot(w, 0, 0.25, 0.05, 0.8);
  const real = P.cloneWorld(w);
  const shot = P.shoot(real, 0, 0.25, 0.05, 0.8);
  P.simulateToRest(real, 10);
  assertTrue(Math.abs(pv.x - shot.x) < 1e-9 && Math.abs(pv.y - shot.y) < 1e-9, "same resting spot");
  assertEqual(pv.off, shot.off);
  assertTrue(pv.path.length > 5, "a path to draw");
});
