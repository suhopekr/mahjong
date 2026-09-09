// game/ai.js
// The opponent. It plans by SHOOTING: every candidate shot is simulated
// on a copy of the board and judged by what the frame would then be
// worth, so the plan and the physics can never disagree.
//
// StoneFlick's lesson, carried over whole: an AI whose execution has
// jitter must SEARCH with that jitter. A shot that scores 3 when hit
// perfectly and falls off the end when hit 2% hard is a bad shot for a
// player who hits 2% hard, and a search that only tries the perfect
// version will keep choosing it — that is what "the AI picks knife-edge
// shots" looked like in the previous game. So every candidate is run
// several times with the AI's own noise applied, and the mean is the
// score.
//
// Levels differ ONLY in noise and in how many candidates they consider.
// The easy AI is not stupid, it is unsteady — Daily Five's beginners lost
// in seven moves to an opponent that never missed, and the fix there was
// an opponent that misses the way a person does. On this board a person
// misses on power far more than on line, so the power noise is the one
// that grows.

import * as P from "./physics.js";
import { scoreFrame, puckValue, PUCKS_PER_SIDE } from "./rules.js";

export const LEVELS = {
  easy: { sigmaPower: 0.075, sigmaAngle: 2.4, lanes: 3, trials: 2, greed: 0.6 },
  medium: { sigmaPower: 0.045, sigmaAngle: 1.5, lanes: 5, trials: 3, greed: 0.85 },
  hard: { sigmaPower: 0.022, sigmaAngle: 0.8, lanes: 7, trials: 3, greed: 1.0 },
};
export const LEVEL_IDS = Object.keys(LEVELS);

/** Small deterministic PRNG so tests can pin a plan. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  // Box–Muller, one value.
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const DEG = Math.PI / 180;

/**
 * Value of a still board for `me`: the frame result as a signed number,
 * plus a little for position. Position matters because most shots are
 * not the last of the frame — a weight sitting in the 3 is worth having
 * even when the other side currently leads.
 */
function boardValue(world, me) {
  const r = scoreFrame(world);
  let v = 0;
  if (r.winner !== null) v = r.winner === me ? r.points : -r.points;
  for (const p of P.livePucks(world)) {
    const pv = puckValue(p);
    v += (p.owner === me ? 0.25 : -0.25) * pv;
  }
  return v;
}

/** Aim from the apron at (START_X, y0) so the line passes through (x, y). */
function angleTo(y0, x, y) {
  return Math.atan2(y - y0, x - P.START_X);
}

/**
 * Candidate shots for this position. Each is { y, angle, power, kind }.
 * Kinds: "draw" — stop in a scoring zone; "knock" — hit an opposing
 * weight hard enough to take it off; "tap" — nudge an own weight deeper.
 */
export function candidates(world, me, level) {
  const out = [];
  const L = P.BOARD_LENGTH;
  const lanes = [];
  for (let i = 0; i < level.lanes; i++) {
    const t = level.lanes === 1 ? 0.5 : i / (level.lanes - 1);
    lanes.push(P.MIN_START_Y + t * (P.MAX_START_Y - P.MIN_START_Y));
  }
  // Draws: stop with the rear edge just inside the 3, the 2, or a hanger.
  const targets = [
    L - P.ZONE_3_DEPTH + P.PUCK_RADIUS + 0.03, // safely in the 3
    L - P.PUCK_RADIUS * 0.6, // hanger attempt
    L - P.ZONE_2_DEPTH + P.PUCK_RADIUS + 0.04, // in the 2
    L - P.ZONE_2_DEPTH - 0.12, // deep 1 as a guard
  ];
  for (const y of lanes) {
    for (const tx of targets) {
      out.push({ y, angle: 0, power: P.powerFor(tx - P.START_X), kind: "draw" });
    }
  }
  // Knocks and taps at what is on the board.
  for (const p of P.livePucks(world)) {
    for (const y of lanes) {
      const a = angleTo(y, p.x, p.y);
      if (Math.abs(a) > P.MAX_AIM_ANGLE) continue;
      if (p.owner !== me) {
        // Enough to reach it and carry on: aim to "stop" a board length past.
        out.push({ y, angle: a, power: P.powerFor(p.x - P.START_X + 1.2), kind: "knock" });
        out.push({ y, angle: a, power: P.powerFor(p.x - P.START_X + 0.5), kind: "knock" });
      } else {
        // A tap: arrive with just enough to move it a zone deeper.
        out.push({ y, angle: a, power: P.powerFor(p.x - P.START_X + 0.25), kind: "tap" });
      }
    }
  }
  return out;
}

/**
 * Pick a shot. Returns the shot to EXECUTE (noise already applied) along
 * with the plan it came from.
 * @param {World} world   a still board
 * @param {0|1} me
 * @param {object} level  one of LEVELS
 * @param {() => number} rng
 */
export function chooseShot(world, me, level, rng = Math.random) {
  const list = candidates(world, me, level);
  let best = null;
  let bestValue = -Infinity;
  const scored = [];
  for (const c of list) {
    let sum = 0;
    for (let t = 0; t < level.trials; t++) {
      const w = P.cloneWorld(world);
      const shot = jitter(c, level, rng);
      P.shoot(w, me, shot.y, shot.angle, shot.power);
      P.simulateToRest(w, 8);
      P.removeFouls(w);
      sum += boardValue(w, me);
    }
    const value = sum / level.trials;
    scored.push({ c, value });
    if (value > bestValue) {
      bestValue = value;
      best = c;
    }
  }
  // Greed below 1 sometimes takes a merely good shot instead of the best
  // one — the difference between an opponent who always finds the knock
  // and one who occasionally just draws.
  if (level.greed < 1 && rng() > level.greed) {
    scored.sort((a, b) => b.value - a.value);
    const k = Math.min(scored.length - 1, 1 + Math.floor(rng() * 2));
    best = scored[k].c;
  }
  return { plan: best, shot: jitter(best, level, rng), value: bestValue };
}

function jitter(c, level, rng) {
  return {
    y: c.y,
    angle: P.clamp(c.angle + gauss(rng) * level.sigmaAngle * DEG, -P.MAX_AIM_ANGLE, P.MAX_AIM_ANGLE),
    power: P.clamp(c.power * (1 + gauss(rng) * level.sigmaPower), 0.05, 1),
    kind: c.kind,
  };
}

/**
 * Level promotion, Daily Five's final rule: a player who has won any of
 * their last five matches moves up; one who has lost the last five moves
 * down. Never starts a new player against the hard AI.
 * @param {("W"|"L")[]} recent  most recent last
 */
export function nextLevel(current, recent) {
  const idx = LEVEL_IDS.indexOf(current);
  const last5 = recent.slice(-5);
  if (last5.length >= 3 && last5.filter((r) => r === "W").length >= 3) {
    return LEVEL_IDS[Math.min(LEVEL_IDS.length - 1, idx + 1)];
  }
  if (last5.length >= 5 && last5.every((r) => r === "L")) {
    return LEVEL_IDS[Math.max(0, idx - 1)];
  }
  return current;
}

export { PUCKS_PER_SIDE };
