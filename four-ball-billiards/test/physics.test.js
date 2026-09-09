// test/physics.test.js
// The physics module is the whole game, so these tests check PHYSICS, not
// plumbing: each one pins a fact about real billiards that a player would
// notice immediately if it broke, and several of them are results with a
// known closed form (5/7 of the speed after a stun, 2R/5 for natural
// roll) rather than numbers copied out of a previous run.
import { test, assertTrue, assertEqual } from "./harness.js";
import * as P from "../src/game/physics.js";

const R = P.BALL_RADIUS;

function table(balls) {
  return P.createWorld({ balls });
}
function twoInLine(gap) {
  return table([
    { id: "cue", x: 0.6, y: 0.71, color: "white" },
    { id: "obj", x: 0.6 + 2 * R + gap, y: 0.71, color: "red" },
  ]);
}
function run(world, seconds) {
  const n = Math.round(seconds / P.SUB_DT);
  for (let i = 0; i < n; i++) P.stepWorld(world, P.SUB_DT);
  return world;
}
const speed = (b) => Math.hypot(b.vx, b.vy);

// --- the stroke ------------------------------------------------------

test("striking 2R/5 above centre gives natural roll with no skid", () => {
  const w = table([{ id: "cue", x: 1, y: 0.7 }]);
  const cue = P.getBall(w, "cue");
  P.strike(cue, 1, 0, 2, 0, (2 * R) / 5);
  assertTrue(P.isRolling(cue), "expected rolling immediately after the stroke");
});

test("a centre-ball stroke is a pure skid: no spin at all", () => {
  const w = table([{ id: "cue", x: 1, y: 0.7 }]);
  const cue = P.getBall(w, "cue");
  P.strike(cue, 1, 0, 2, 0, 0);
  assertTrue(Math.abs(cue.wx) + Math.abs(cue.wy) + Math.abs(cue.wz) === 0, "no spin");
  const u = P.contactVelocity(cue);
  assertTrue(Math.abs(u.x - 2) < 1e-9, "contact point skids at the full shot speed");
});

test("a skidding ball settles at 5/7 of its launch speed", () => {
  // Textbook: sliding friction takes the centre from v0 to (5/7)v0 by the
  // time the skid becomes a roll. Checked before rolling resistance has
  // had time to matter.
  const w = table([{ id: "cue", x: 0.3, y: 0.7 }]);
  const cue = P.getBall(w, "cue");
  P.strike(cue, 1, 0, 2, 0, 0);
  run(w, 0.32);
  assertTrue(P.isRolling(cue), "should be rolling by now");
  const expected = (5 / 7) * 2;
  assertTrue(Math.abs(speed(cue) - expected) < 0.05, `expected ~${expected}, got ${speed(cue)}`);
});

test("the tip cannot be placed past the miscue limit", () => {
  const w = table([{ id: "cue", x: 1, y: 0.7 }]);
  const cue = P.getBall(w, "cue");
  P.strike(cue, 1, 0, 2, R, R); // way off the ball
  const wTotal = Math.hypot(cue.wx, cue.wy, cue.wz);
  const max = ((5 * 2) / (2 * R * R)) * P.MAX_TIP_OFFSET;
  assertTrue(wTotal <= max * 1.0001, "spin clamped to the miscue limit");
});

// --- the three strokes every player learns ---------------------------

test("stun: the cue ball stops dead on a full-ball hit", () => {
  const w = twoInLine(0.004);
  P.strike(P.getBall(w, "cue"), 1, 0, 2, 0, 0);
  run(w, 0.4);
  const cue = P.getBall(w, "cue");
  const obj = P.getBall(w, "obj");
  assertTrue(Math.abs(cue.x - 0.6) < 0.02, `cue should barely move, moved ${cue.x - 0.6}`);
  assertTrue(obj.vx > 1, "the object ball takes the speed");
});

test("follow: topspin carries the cue ball forward through the hit", () => {
  const w = twoInLine(0.004);
  P.strike(P.getBall(w, "cue"), 1, 0, 2, 0, 0.4 * R);
  run(w, 0.6);
  const cue = P.getBall(w, "cue");
  assertTrue(cue.x - 0.6 > 0.05, `expected the cue ball to follow, moved ${cue.x - 0.6}`);
  assertTrue(cue.vx > 0, "still travelling forward");
});

test("draw: backspin brings the cue ball back", () => {
  const w = twoInLine(0.004);
  P.strike(P.getBall(w, "cue"), 1, 0, 2, 0, -0.4 * R);
  run(w, 0.6);
  const cue = P.getBall(w, "cue");
  assertTrue(cue.x - 0.6 < -0.05, `expected the cue ball to draw back, moved ${cue.x - 0.6}`);
});

test("follow and draw differ by more than a nudge", () => {
  const f = twoInLine(0.004);
  P.strike(P.getBall(f, "cue"), 1, 0, 2, 0, 0.4 * R);
  P.simulateToRest(f);
  const d = twoInLine(0.004);
  P.strike(P.getBall(d, "cue"), 1, 0, 2, 0, -0.4 * R);
  P.simulateToRest(d);
  const spread = P.getBall(f, "cue").x - P.getBall(d, "cue").x;
  assertTrue(spread > 0.3, `follow/draw should open up the table, spread was ${spread}m`);
});

// --- throw -----------------------------------------------------------

test("a cut shot throws the object ball off the line of centres", () => {
  // Half-ball cut. With no ball-ball friction the object ball would leave
  // exactly along the line of centres; friction bends it, and that bend
  // is throw.
  const w = table([
    { id: "cue", x: 0.6, y: 0.71 },
    { id: "obj", x: 0.6 + 2 * R * Math.cos(Math.PI / 6) + 0.003, y: 0.71 + 2 * R * 0.5 },
  ]);
  P.strike(P.getBall(w, "cue"), 1, 0, 2, 0, 0);
  run(w, 0.05);
  const obj = P.getBall(w, "obj");
  const lineAngle = Math.atan2(2 * R * 0.5, 2 * R * Math.cos(Math.PI / 6));
  const travelAngle = Math.atan2(obj.vy, obj.vx);
  const throwDeg = ((travelAngle - lineAngle) * 180) / Math.PI;
  assertTrue(Math.abs(throwDeg) > 0.05, `expected some throw, got ${throwDeg} deg`);
  assertTrue(Math.abs(throwDeg) < 6, `throw should be small, got ${throwDeg} deg`);
});

// --- cushions --------------------------------------------------------

function cushionRebound(wz) {
  // A rolling ball into the right-hand cushion at 25 degrees off the
  // table's long axis, which is a fairly full hit on the rail.
  //
  // Not 45 degrees, and the reason is a limitation worth stating rather
  // than hiding: at shallow incidence the cushion's friction saturates
  // (the Coulomb cap binds), and a saturated impulse is the same impulse
  // whatever the ball is doing — so english can widen a shallow rebound
  // but not narrow it. That is a consequence of modelling the contact in
  // the plane; a full 3D treatment spends part of the same capped impulse
  // vertically and leaves a different share for the rail. Between about
  // 10 and 40 degrees, and again past 60, both directions bend properly.
  const a = (25 * Math.PI) / 180;
  const w = table([{ id: "cue", x: P.TABLE_LENGTH - 0.5, y: 0.4 }]);
  const cue = P.getBall(w, "cue");
  P.strike(cue, Math.cos(a), Math.sin(a), 2.2, 0, (2 * R) / 5);
  cue.wz = wz;
  const before = Math.atan2(Math.abs(cue.vy), Math.abs(cue.vx));
  let hit = false;
  for (let i = 0; i < 800 && !hit; i++) {
    P.stepWorld(w, P.SUB_DT);
    hit = w.events.some((e) => e.type === "cushion" && e.wall === "right");
  }
  const after = Math.atan2(Math.abs(cue.vy), Math.abs(cue.vx));
  return { before: (before * 180) / Math.PI, after: (after * 180) / Math.PI, hit };
}

test("with no english, a cushion returns the ball near angle-in = angle-out", () => {
  const r = cushionRebound(0);
  assertTrue(r.hit, "the ball reached the cushion");
  assertTrue(Math.abs(r.after - r.before) < 12, `in ${r.before} deg, out ${r.after} deg`);
});

test("english changes where the ball comes off the rail", () => {
  const plain = cushionRebound(0);
  const running = cushionRebound(40);
  const reverse = cushionRebound(-40);
  assertTrue(
    Math.abs(running.after - plain.after) > 1.5 || Math.abs(reverse.after - plain.after) > 1.5,
    `english did nothing: ${reverse.after} / ${plain.after} / ${running.after}`
  );
  assertTrue(
    (running.after - plain.after) * (reverse.after - plain.after) < 0,
    "left and right english should bend the rebound opposite ways"
  );
});

test("a plain rail-first shot picks up english off the cushion", () => {
  const w = table([{ id: "cue", x: P.TABLE_LENGTH - 0.35, y: 0.5 }]);
  const cue = P.getBall(w, "cue");
  P.strike(cue, 1, 1, 2.2, 0, (2 * R) / 5);
  run(w, 0.6);
  assertTrue(Math.abs(cue.wz) > 1, `expected the rail to impart spin, wz=${cue.wz}`);
});

// --- invariants ------------------------------------------------------

test("no interaction ever adds energy to the table", () => {
  const w = table([
    { id: "cue", x: 0.5, y: 0.4 },
    { id: "b", x: 1.4, y: 0.75 },
    { id: "c", x: 2.1, y: 0.5 },
    { id: "d", x: 1.9, y: 1.1 },
  ]);
  P.strike(P.getBall(w, "cue"), 1, 0.45, 5, 0.3 * R, -0.3 * R);
  let last = P.kineticEnergy(w);
  for (let i = 0; i < 6000; i++) {
    P.stepWorld(w, P.SUB_DT);
    const now = P.kineticEnergy(w);
    assertTrue(now <= last + 1e-9, `energy rose at step ${i}: ${last} -> ${now}`);
    last = now;
  }
});

test("balls stay on the table and never overlap", () => {
  const w = table([
    { id: "cue", x: 0.5, y: 0.4 },
    { id: "b", x: 1.4, y: 0.75 },
    { id: "c", x: 2.1, y: 0.5 },
    { id: "d", x: 1.9, y: 1.1 },
  ]);
  P.strike(P.getBall(w, "cue"), 1, 0.3, 6, 0.4 * R, 0.2 * R);
  for (let i = 0; i < 8000; i++) {
    P.stepWorld(w, P.SUB_DT);
    for (const b of w.balls) {
      assertTrue(b.x >= R - 1e-9 && b.x <= P.TABLE_LENGTH - R + 1e-9, `x out of bounds: ${b.x}`);
      assertTrue(b.y >= R - 1e-9 && b.y <= P.TABLE_WIDTH - R + 1e-9, `y out of bounds: ${b.y}`);
    }
    for (let a = 0; a < w.balls.length; a++) {
      for (let c = a + 1; c < w.balls.length; c++) {
        const d = Math.hypot(w.balls[a].x - w.balls[c].x, w.balls[a].y - w.balls[c].y);
        assertTrue(d > 2 * R - 1e-6, `balls overlapped by ${2 * R - d}m`);
      }
    }
  }
});

test("every shot comes to rest well inside the cutoff", () => {
  // NOT written as "simulateToRest then assert isAtRest" — that cannot
  // fail, because simulateToRest zeroes the velocities on its way out.
  // The thing worth knowing is how long the table takes to settle, both
  // because a shot that never settles hangs the turn loop and because the
  // number decides how fast playback has to run to be watchable.
  const hardest = [];
  for (const [dx, dy, side, vert] of [
    [1, 0.2, 0.4 * R, 0.4 * R],
    [1, -0.6, -0.4 * R, -0.4 * R],
    [0.2, 1, 0, 0],
    [-1, 0.3, 0.3 * R, -0.2 * R],
  ]) {
    const w = table([
      { id: "cue", x: 0.5, y: 0.4 },
      { id: "b", x: 1.4, y: 0.75 },
      { id: "c", x: 2.1, y: 0.5 },
      { id: "d", x: 1.9, y: 1.1 },
    ]);
    P.strike(P.getBall(w, "cue"), dx, dy, P.MAX_SHOT_SPEED, side, vert);
    let t = 0;
    while (t < P.MAX_SHOT_SECONDS && !P.isAtRest(w)) {
      P.stepWorld(w, P.SUB_DT);
      t += P.SUB_DT;
    }
    assertTrue(P.isAtRest(w), `did not settle in ${P.MAX_SHOT_SECONDS}s`);
    hardest.push(t);
  }
  const worst = Math.max(...hardest);
  assertTrue(worst < 15, `hardest shot took ${worst.toFixed(1)}s to settle`);
});

test("the same shot simulates identically twice", () => {
  const shot = () => {
    const w = table([
      { id: "cue", x: 0.5, y: 0.4 },
      { id: "b", x: 1.4, y: 0.75 },
      { id: "c", x: 2.1, y: 0.5 },
      { id: "d", x: 1.9, y: 1.1 },
    ]);
    P.strike(P.getBall(w, "cue"), 1, 0.37, 4.2, -0.25 * R, 0.3 * R);
    P.simulateToRest(w);
    return w;
  };
  const a = shot();
  const b = shot();
  assertEqual(
    a.balls.map((x) => [x.id, x.x, x.y]),
    b.balls.map((x) => [x.id, x.x, x.y]),
    "final positions"
  );
  assertEqual(
    a.events.map((e) => [e.type, e.a || e.ball, e.b || e.wall]),
    b.events.map((e) => [e.type, e.a || e.ball, e.b || e.wall]),
    "contact sequence"
  );
});

test("contacts are recorded in the order they happen", () => {
  const w = table([
    { id: "cue", x: 0.4, y: 0.71 },
    { id: "red1", x: 1.0, y: 0.71 },
    { id: "red2", x: 1.9, y: 0.71 },
  ]);
  P.strike(P.getBall(w, "cue"), 1, 0, 3.5, 0, (2 * R) / 5);
  P.simulateToRest(w);
  const balls = w.events.filter((e) => e.type === "ball");
  assertTrue(balls.length >= 2, `expected at least two ball contacts, got ${balls.length}`);
  assertTrue(balls[0].a === "cue" && balls[0].b === "red1", "cue hits the near red first");
  for (let i = 1; i < w.events.length; i++) {
    assertTrue(w.events[i].t >= w.events[i - 1].t - 1e-9, "event times are monotonic");
  }
});

test("a rolling ball travels about as far as v^2/(2*mu_roll*g)", () => {
  // 0.6 m/s, not more: the closed form only describes an uninterrupted
  // roll, and at 0.8 m/s the ball reaches the far cushion first. (That it
  // does is itself worth noticing — rolling resistance is so low that a
  // gentle shot crosses the whole table.)
  const w = table([{ id: "cue", x: 0.2, y: 0.71 }]);
  const cue = P.getBall(w, "cue");
  P.strike(cue, 1, 0, 0.6, 0, (2 * R) / 5);
  P.simulateToRest(w);
  const expected = (0.6 * 0.6) / (2 * P.MU_ROLL * P.GRAVITY);
  const travelled = cue.x - 0.2;
  assertTrue(
    Math.abs(travelled - expected) < 0.15 * expected,
    `rolled ${travelled.toFixed(2)}m, closed form says ${expected.toFixed(2)}m`
  );
});


test("a rolling ball comes off a cushion instead of dying on it", () => {
  // The bug this pins, in the player's words: "sometimes it just stops
  // dead at the wall". With the cushion modelled at centre height the
  // normal impulse had no moment arm, so a rolling ball kept every bit of
  // its topspin through the bounce and then spent the next half second
  // fighting it. Measured then: a ball rolling in at 1 m/s came away with
  // 8% of its speed. A real rail returns something over half.
  for (const speed of [1.6, 2.4, 3.2]) {
    const w = table([{ id: "cue", x: P.TABLE_LENGTH - 0.9, y: 0.71 }]);
    const cue = P.getBall(w, "cue");
    P.strike(cue, 1, 0, speed, 0, (2 * R) / 5);
    let hit = false;
    for (let i = 0; i < 900 && !hit; i++) {
      P.stepWorld(w, P.SUB_DT);
      hit = w.events.some((e) => e.type === "cushion");
    }
    assertTrue(hit, "reached the cushion");
    // Let it settle back into a roll before measuring.
    for (let i = 0; i < 400; i++) P.stepWorld(w, P.SUB_DT);
    const kept = Math.hypot(cue.vx, cue.vy) / speed;
    assertTrue(kept > 0.4, `only ${(kept * 100).toFixed(0)}% of the shot came back`);
    assertTrue(kept < 0.8, `${(kept * 100).toFixed(0)}% came back — a rail is not free`);
  }
});

test("the cushion strips the topspin it should", () => {
  // The mechanism behind the test above, checked directly: a ball rolling
  // into a rail must come off spinning the NEW way, not the old one.
  const w = table([{ id: "cue", x: P.TABLE_LENGTH - 0.6, y: 0.71 }]);
  const cue = P.getBall(w, "cue");
  P.strike(cue, 1, 0, 2.4, 0, (2 * R) / 5);
  let hit = false;
  for (let i = 0; i < 900 && !hit; i++) {
    P.stepWorld(w, P.SUB_DT);
    hit = w.events.some((e) => e.type === "cushion");
  }
  assertTrue(cue.vx < 0, "travelling back up the table");
  assertTrue(cue.wy < 0, `spin should have reversed with the ball, wy=${cue.wy.toFixed(1)}`);
});

test("no ball ever stops dead at a rail, and no ball freezes the table", () => {
  // BO'S BUG, AND THE SHAPE OF IT.
  //
  // "Hit it hard and when it reaches the wall it doesn't bounce straight
  // away — it stops for a moment and then goes on, and the same angle
  // does it again." What he was watching was the swept solver spending a
  // whole substep on zero-length steps: with enough spin about the
  // rail-tangent axis the cushion model found the contact point already
  // separating, declined to give an impulse, and left the ball still
  // travelling into the wall — so the same contact came back at t = 0
  // until the sixteen-iteration guard gave up, and the substep ended with
  // NOTHING having moved. Not just the stuck ball: every ball on the
  // table stood still, which is why it reads as the game hanging rather
  // than as one ball behaving oddly.
  //
  // The shots below are the ones a sweep found doing it worst — up to
  // 1.1s of frozen table on a ball still carrying 1.4 m/s. Maximum draw
  // plus side at speed, which is a real shot, not a synthetic one.
  const shots = [
    { deg: 144, speed: 6, side: 0.5, tip: -0.5 },
    { deg: 150, speed: 6, side: -0.5, tip: -0.5 },
    { deg: 138, speed: 5, side: 0.5, tip: -0.5 },
    { deg: 18, speed: 6, side: -0.5, tip: -0.5 },
    { deg: 72, speed: 6, side: 0.5, tip: -0.5 },
  ];
  for (const s of shots) {
    const w = table([
      { id: "cue", x: 1.71, y: 0.73, color: "white" },
      { id: "red1", x: 1.66, y: 0.58, color: "red" },
      { id: "red2", x: 1.73, y: 0.5, color: "red" },
      { id: "yellow", x: 1.34, y: 0.22, color: "yellow" },
    ]);
    const a = (s.deg * Math.PI) / 180;
    P.strike(P.getBall(w, "cue"), Math.cos(a), Math.sin(a), s.speed, s.side * R, s.tip * R);
    let stalled = 0;
    let worst = 0;
    for (let i = 0; i < 3000 && !P.isAtRest(w); i++) {
      const before = w.balls.map((b) => [b.x, b.y]);
      P.stepWorld(w, P.SUB_DT);
      // "Moving but not moved": a ball with speed that travelled less
      // than 2% of what that speed says it should have in this substep.
      const frozen = w.balls.some((b, k) => {
        const v = Math.hypot(b.vx, b.vy);
        const moved = Math.hypot(b.x - before[k][0], b.y - before[k][1]);
        return v > 0.05 && moved < v * P.SUB_DT * 0.02;
      });
      stalled = frozen ? stalled + 1 : 0;
      if (stalled > worst) worst = stalled;
    }
    // One substep of standstill is a contact being resolved. Three in a
    // row is the table having stopped.
    assertTrue(worst < 3, `${s.deg}deg at ${s.speed}m/s froze for ${worst} substeps`);
  }
});
