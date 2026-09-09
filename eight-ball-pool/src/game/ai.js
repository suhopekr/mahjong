// game/ai.js
// The computer opponent, and the Hint (which is the same search asked
// for its best answer).
//
// The physics is deterministic, so the search is honest: a candidate
// shot is judged by PLAYING it on a copy of the table and reading the
// rules' own verdict off the log — the AI can never think a shot is legal
// that the game would call a foul. What keeps it affordable on a
// sixteen-ball table is that the candidates are chosen by geometry first
// (the ghost-ball line from the cue ball, through the object ball, into a
// pocket; the two paths must be clear and the cut not too thin) and only
// the best few are simulated.
//
// THE PACES are how often it converts, decided before the shot is chosen
// (four-ball's design, kept): a Relaxed miss is a real pocketing line
// turned just far enough off to fail, so it reads as a near thing rather
// than a random poke. Nothing here reads the player's group or the
// player's shots — it plays the table it is given.

import * as P from "./physics.js";
import { CUE, EIGHT, HEAD_STRING, isValidPlacement } from "./rack.js";
import { legalTargets, judgeShot, cloneGame } from "./rules.js";

export const PACES = {
  relaxed: { id: "relaxed", make: 0.42, err: 1.6 },
  standard: { id: "standard", make: 0.7, err: 0.8 },
  challenging: { id: "challenging", make: 0.92, err: 0.3 },
};
export const DEFAULT_PACE = "standard";

/** Simulated seconds a candidate may run. Long enough for a real shot to
 * finish; a cap so a rattling ball cannot stall the search. */
const SIM_SECONDS = 12;
/** How many geometric candidates get simulated. */
const SIM_BUDGET = 10;
/** Cut angles beyond this are not attempted. */
const MAX_CUT_COS = Math.cos((72 * Math.PI) / 180);

const deg = (d) => (d * Math.PI) / 180;
const R = P.BALL_RADIUS;

/** Distance from point (px,py) to segment a-b. */
function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Is the run from a to b (a ball's centre path) clear of every ball but
 * the ones named? */
function pathClear(world, ax, ay, bx, by, ignore) {
  for (const b of world.balls) {
    if (b.pocketed || ignore.includes(b.id)) continue;
    if (segDist(ax, ay, bx, by, b.x, b.y) < 2 * R - 1e-4) return false;
  }
  return true;
}

/** Where to send an object ball for this pocket: the capture circle's
 * centre for a corner, a point just inside the mouth for a side. */
function pocketAimPoint(p) {
  return { x: p.x, y: p.y };
}

/** The pocket's inward direction, for judging the entry angle. */
function pocketInward(world, p) {
  const cx = world.length / 2;
  const cy = world.width / 2;
  if (p.corner) {
    const dx = cx - p.x;
    const dy = cy - p.y;
    const d = Math.hypot(dx, dy);
    return { x: dx / d, y: dy / d };
  }
  return { x: 0, y: p.y < cy ? 1 : -1 };
}

/**
 * Every geometrically plausible pocketing shot from this position, best
 * first. Pure geometry; nothing is simulated here.
 * @returns {{target:string, pocket:string, angle:number, dist:number,
 *            cutCos:number, quality:number}[]}
 */
export function pocketingCandidates(world, cue, targets) {
  const out = [];
  for (const id of targets) {
    const t = P.getBall(world, id);
    if (!t || t.pocketed) continue;
    for (const p of world.pockets) {
      const aim = pocketAimPoint(p);
      const ux = aim.x - t.x;
      const uy = aim.y - t.y;
      const dTP = Math.hypot(ux, uy);
      if (dTP < 1e-6) continue;
      const nx = ux / dTP;
      const ny = uy / dTP;
      const inward = pocketInward(world, p);
      // Entering against the pocket's own direction: a side pocket taken
      // along the rail, or a corner along one cushion, is not a shot.
      const entry = -(nx * inward.x + ny * inward.y);
      if (entry < (p.corner ? 0.35 : 0.55)) continue;
      const gx = t.x - nx * 2 * R;
      const gy = t.y - ny * 2 * R;
      const vx = gx - cue.x;
      const vy = gy - cue.y;
      const dCG = Math.hypot(vx, vy);
      if (dCG < 1e-6) continue;
      const cutCos = (vx * nx + vy * ny) / dCG;
      if (cutCos < MAX_CUT_COS) continue;
      if (!pathClear(world, cue.x, cue.y, gx, gy, [CUE, id])) continue;
      if (!pathClear(world, t.x, t.y, aim.x, aim.y, [CUE, id])) continue;
      const quality = (Math.pow(cutCos, 1.5) * entry) / (0.35 + dCG + 0.8 * dTP);
      out.push({ target: id, pocket: p.id, angle: Math.atan2(vy, vx), dist: dCG + dTP, cutCos, quality });
    }
  }
  out.sort((a, b) => b.quality - a.quality);
  return out;
}

/** Play one shot on a copy and read the rules' verdict. */
function trial(game, angle, speed) {
  const g = cloneGame(game);
  P.resetEvents(g.world);
  const cue = P.getBall(g.world, CUE);
  P.strike(cue, Math.cos(angle), Math.sin(angle), speed, 0, 0);
  P.simulateToRest(g.world, SIM_SECONDS);
  const verdict = judgeShot(g, g.world.events);
  return { verdict, rest: g };
}

/** How many easy shots the NEXT shooter would have on this table: a
 * cheap geometric count, not a simulation. */
function openness(game, player) {
  const cue = P.getBall(game.world, CUE);
  const targets = legalTargets(game, player);
  const c = pocketingCandidates(game.world, cue, targets);
  return c.length ? Math.min(3, c.length) + c[0].quality : 0;
}

function score(game, r) {
  const v = r.verdict;
  const shooter = game.turn;
  if (v.over) return v.winner === shooter ? 1000 : -1000;
  let s = 0;
  if (v.foul) s -= 40;
  if (v.cueScratch) s -= 20;
  s += v.ownMade.length * 20;
  s -= v.oppMade.length * 6;
  // What it leaves: my next shot if I stay, the opponent's if I do not.
  if (v.continues) s += 2 * openness(r.rest, shooter);
  else s -= 2 * openness(r.rest, 1 - shooter);
  return s;
}

/** A speed that gets the object ball there with a little to spare. */
function speedFor(c) {
  return Math.min(P.MAX_SHOT_SPEED, 1.1 + 0.9 * c.dist / Math.max(0.35, c.cutCos));
}

/**
 * The opponent's shot.
 *
 * @param {object} game     the game as it stands (never mutated)
 * @param {object} opts
 * @param {{make:number,err:number}} [opts.pace]
 * @param {() => number} [opts.rng]
 * @param {boolean} [opts.best]  true for the Hint: always the best make
 * @returns {{angle:number, speed:number, intent:"make"|"miss"|"safety"|"break",
 *            target:string|null, pocket:string|null}}
 */
export function chooseShot(game, { pace = PACES.standard, rng = Math.random, best = false } = {}) {
  const cue = P.getBall(game.world, CUE);
  if (!game.breakDone) return breakShot(game, rng);

  const targets = legalTargets(game);
  const cands = pocketingCandidates(game.world, cue, targets);
  const results = [];
  let sims = 0;
  for (const c of cands) {
    if (sims >= SIM_BUDGET) break;
    const s1 = speedFor(c);
    for (const speed of [s1, Math.min(P.MAX_SHOT_SPEED, s1 * 1.45)]) {
      sims++;
      const r = trial(game, c.angle, speed);
      const made = r.verdict.pocketed.includes(c.target) && !r.verdict.foul;
      results.push({ ...c, speed, made, score: score(game, r), verdict: r.verdict });
      if (made) break;
    }
  }
  results.sort((a, b) => b.score - a.score);
  const makes = results.filter((r) => r.made && r.score > -100);

  if (makes.length) {
    const wantsToMake = best || rng() < pace.make;
    const pick = makes[0];
    if (wantsToMake) {
      // A little human error even on a make; Challenging barely has any.
      const angle = best ? pick.angle : pick.angle + deg((rng() - 0.5) * pace.err * 0.6);
      return { angle, speed: pick.speed, intent: "make", target: pick.target, pocket: pick.pocket };
    }
    // A near miss: the same line, turned just past its window, and never
    // into a foul the rules would punish — a miss is a handed-over turn,
    // not a gift.
    for (const off of [pace.err * 1.6, pace.err * 2.4, pace.err * 3.5, 6]) {
      for (const sign of rng() < 0.5 ? [1, -1] : [-1, 1]) {
        const angle = pick.angle + deg(off * sign);
        const r = trial(game, angle, pick.speed);
        if (!r.verdict.foul && !r.verdict.pocketed.includes(pick.target) && !r.verdict.over) {
          return { angle, speed: pick.speed, intent: "miss", target: pick.target, pocket: pick.pocket };
        }
      }
    }
    return { angle: pick.angle, speed: pick.speed, intent: "make", target: pick.target, pocket: pick.pocket };
  }

  // Nothing on. The best legal outcome among what was tried, else a
  // soft straight hit on the nearest legal ball.
  const safe = results.filter((r) => !r.verdict.foul && r.score > -100);
  if (safe.length) {
    const s = safe[0];
    return { angle: s.angle, speed: Math.max(0.8, s.speed * 0.6), intent: "safety", target: s.target, pocket: null };
  }
  return straightHit(game, targets, rng);
}

/** A slow, direct hit on a legal ball, the first one whose line is clear
 * and whose trial does not foul. Always returns something. */
function straightHit(game, targets, rng) {
  const cue = P.getBall(game.world, CUE);
  const options = [];
  for (const id of targets) {
    const t = P.getBall(game.world, id);
    if (!t || t.pocketed) continue;
    const d = Math.hypot(t.x - cue.x, t.y - cue.y);
    options.push({ id, d, angle: Math.atan2(t.y - cue.y, t.x - cue.x), clear: pathClear(game.world, cue.x, cue.y, t.x, t.y, [CUE, id]) });
  }
  options.sort((a, b) => Number(b.clear) - Number(a.clear) || a.d - b.d);
  for (const o of options) {
    for (const off of [0, 4, -4, 9, -9]) {
      const angle = o.angle + deg(off);
      const speed = Math.min(2.2, 0.8 + o.d);
      const r = trial(game, angle, speed);
      if (!r.verdict.foul && !r.verdict.over) return { angle, speed, intent: "safety", target: o.id, pocket: null };
    }
  }
  const o = options[0] || { angle: 0, id: null, d: 0.5 };
  return { angle: o.angle + deg((rng() - 0.5) * 6), speed: 1.2, intent: "safety", target: o.id, pocket: null };
}

/** The break: straight into the apex, hard. */
export function breakShot(game, rng = Math.random) {
  const cue = P.getBall(game.world, CUE);
  let apex = null;
  for (const b of game.world.balls) {
    if (b.id === CUE || b.pocketed) continue;
    if (!apex || b.x < apex.x) apex = b;
  }
  const angle = apex ? Math.atan2(apex.y - cue.y, apex.x - cue.x) : 0;
  return { angle: angle + deg((rng() - 0.5) * 1.2), speed: P.MAX_SHOT_SPEED * 0.92, intent: "break", target: apex?.id || null, pocket: null };
}

/**
 * Where to put the cue ball for ball in hand: the legal spot with the
 * best pocketing geometry. A grid over the table (or the kitchen), each
 * point checked with the same validity test the player's tap gets, so
 * the computer can never set the ball on top of another.
 */
export function chooseCuePlacement(game) {
  const world = game.world;
  const targets = legalTargets(game);
  const step = R * 2.2;
  const maxX = game.kitchen ? HEAD_STRING : world.length - R;
  let best = null;
  for (let x = R * 1.2; x <= maxX; x += step) {
    for (let y = R * 1.2; y <= world.width - R; y += step) {
      if (!isValidPlacement(world, x, y, { kitchen: game.kitchen })) continue;
      const c = pocketingCandidates(world, { x, y }, targets);
      const q = c.length ? c[0].quality * (1 + 0.15 * Math.min(3, c.length)) : 0;
      if (!best || q > best.q) best = { x, y, q };
    }
  }
  if (best) return { x: best.x, y: best.y };
  // Every grid point blocked (cannot happen on a real table): fall back to
  // the nearest legal spot to the middle of the allowed area.
  for (let r = 0; r < 60; r++) {
    const x = R + Math.random() * (maxX - 2 * R);
    const y = R + Math.random() * (world.width - 2 * R);
    if (isValidPlacement(world, x, y, { kitchen: game.kitchen })) return { x, y };
  }
  return { x: HEAD_STRING / 2, y: world.width / 2 };
}
