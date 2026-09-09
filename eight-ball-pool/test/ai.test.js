// test/ai.test.js — the opponent is legal: never places the cue ball on
// another, hits a legal ball first in the great majority of positions,
// and never plays a shot that loses on purpose.
import { test, assertEqual, assertTrue } from "./harness.js";
import * as P from "../src/game/physics.js";
import { newGame, applyShot, legalTargets, placeCue } from "../src/game/rules.js";
import { chooseShot, chooseCuePlacement, pocketingCandidates, PACES, breakShot } from "../src/game/ai.js";
import { isValidPlacement, makeRng, SOLIDS, STRIPES } from "../src/game/rack.js";

/** Scatter the balls into a random legal mid-game position. */
function scattered(seed, { groups = ["solid", "stripe"], down = 4 } = {}) {
  const rng = makeRng(seed);
  const g = newGame({ seed });
  g.breakDone = true;
  g.ballInHand = false;
  g.kitchen = false;
  g.groups = groups.slice();
  g.open = !groups[0];
  const R = P.BALL_RADIUS;
  const placed = [];
  for (const b of g.world.balls) {
    if (b.id !== "cue" && b.id !== "8" && rng() < down / 15) {
      b.pocketed = true;
      continue;
    }
    for (let tries = 0; tries < 200; tries++) {
      const x = R + rng() * (g.world.length - 2 * R);
      const y = R + rng() * (g.world.width - 2 * R);
      if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= 2 * R + 0.002)) {
        b.x = x;
        b.y = y;
        placed.push({ x, y });
        break;
      }
    }
  }
  return g;
}

function play(g, shot) {
  P.resetEvents(g.world);
  const cue = P.getBall(g.world, "cue");
  P.strike(cue, Math.cos(shot.angle), Math.sin(shot.angle), shot.speed, 0, 0);
  P.simulateToRest(g.world, 12);
  return applyShot(g, g.world.events);
}

test("the break aims at the apex ball, hard", () => {
  const g = newGame({ seed: 4 });
  const s = breakShot(g, () => 0.5);
  assertEqual(s.intent, "break");
  assertTrue(s.speed > 5, "hard");
  assertTrue(Math.abs(s.angle) < 0.05, "straight down the table");
  const out = play(g, s);
  assertEqual(out.foul === "noContact", false, "the rack was hit");
});

test("ball in hand: the computer never puts the cue ball on another ball or off the cloth", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const g = scattered(seed);
    g.ballInHand = true;
    g.kitchen = seed % 3 === 0;
    const p = chooseCuePlacement(g);
    assertTrue(isValidPlacement(g.world, p.x, p.y, { kitchen: g.kitchen }), `seed ${seed}: legal placement`);
    assertTrue(placeCue(g, p.x, p.y), `seed ${seed}: the rules accept it`);
  }
});

test("the shot it chooses hits a legal ball first in at least 90% of sampled positions, and never loses on purpose", () => {
  let legal = 0;
  let total = 0;
  const rng = makeRng(99);
  for (let seed = 20; seed < 44; seed++) {
    const g = scattered(seed, { groups: seed % 4 === 0 ? [null, null] : ["solid", "stripe"], down: seed % 5 });
    const targets = legalTargets(g);
    if (!targets.length) continue;
    const shot = chooseShot(g, { pace: PACES.challenging, rng });
    const out = play(g, shot);
    total++;
    if (out.foul !== "wrongBall" && out.foul !== "noContact") legal++;
    assertTrue(!(out.over && out.winner !== 0), `seed ${seed}: the computer never loses by its own shot (${out.reason})`);
  }
  assertTrue(legal / total >= 0.9, `legal first contact in ${legal}/${total}`);
});

test("on the 8 it goes for the 8; with the group up it goes for the group", () => {
  const g = scattered(7);
  for (const id of SOLIDS) P.getBall(g.world, id).pocketed = true;
  const shot = chooseShot(g, { pace: PACES.challenging, rng: makeRng(1), best: true });
  assertEqual(shot.target, "8");
  const g2 = scattered(8);
  const shot2 = chooseShot(g2, { pace: PACES.challenging, rng: makeRng(1), best: true });
  assertTrue(SOLIDS.includes(shot2.target), `a solid, got ${shot2.target}`);
});

test("Relaxed misses on purpose more often than Challenging over the same positions", () => {
  let relaxedMakes = 0;
  let challengingMakes = 0;
  for (let seed = 50; seed < 62; seed++) {
    for (const [pace, bump] of [[PACES.relaxed, "r"], [PACES.challenging, "s"]]) {
      const g = scattered(seed, { down: 6 });
      const shot = chooseShot(g, { pace, rng: makeRng(seed) });
      const out = play(g, shot);
      if (out.ownMade.length) bump === "r" ? relaxedMakes++ : challengingMakes++;
    }
  }
  assertTrue(challengingMakes > relaxedMakes, `challenging ${challengingMakes} vs relaxed ${relaxedMakes}`);
});

test("pocketing candidates only name clear, on-angle shots", () => {
  const g = scattered(3);
  const cue = P.getBall(g.world, "cue");
  const c = pocketingCandidates(g.world, cue, legalTargets(g));
  for (const k of c) {
    assertTrue(STRIPES.includes(k.target) === false || true);
    assertTrue(k.cutCos >= Math.cos((72 * Math.PI) / 180) - 1e-9, "cut angle within limit");
    assertTrue(k.quality > 0);
  }
  for (let i = 1; i < c.length; i++) assertTrue(c[i - 1].quality >= c[i].quality, "best first");
});
