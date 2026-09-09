// src/game/ai.js
// The opponent.
//
// The physics here is deterministic, which means a perfect opponent is
// trivial to write and worthless to play: sweep the angles, take the first
// one that scores, run out fifteen points without ever handing the table
// back. So the whole design problem of this mode is not "can the AI find a
// shot" — it can, in about eighty simulations — it is WHICH shots it
// declines to make, and what it leaves behind when it does.
//
// Two knobs, and they are deliberately independent.
//
// MAKE RATE is how often it converts. Decided BEFORE the shot is chosen,
// then a shot is built to match: a miss is a real scoring line rotated just
// past its own window, so it reads as an attempt that shaved the ball
// rather than as a random flail. Doing it the other way round — adding
// noise and hoping the score rate lands somewhere — gives no control over
// the one number that decides whether the mode is fun.
//
// THE LEAVE is what the player finds when it is their turn, and it is the
// half that most opponents get wrong. An AI that always leaves a mess is
// exhausting; one that always leaves a gift is transparent. So the leave is
// a rate too: on easy the opponent plays the shot that leaves an open
// position seven times in ten, on medium five, on hard two.
import * as P from "./physics.js";
import { judgeFourBall } from "./rules.js";

/**
 * @typedef {{make:number, easyLeave:number, cool:number, label:string}} Level
 */
export const LEVELS = {
  // Makes fewer than half its shots and nearly always leaves something
  // open. A player who has never held a cue should win this and believe
  // they earned it.
  easy: { make: 0.42, easyLeave: 0.7, cool: 0.8, label: "Easy" },
  medium: { make: 0.66, easyLeave: 0.5, cool: 0.78, label: "Medium" },
  // Not perfect, on purpose. A 15-point game against an opponent that
  // never misses is not a game, it is a demonstration.
  hard: { make: 0.85, easyLeave: 0.2, cool: 0.7, label: "Hard" },
};

/**
 * WHY A RUN GETS HARDER AS IT GOES — and why there is no cap.
 *
 * Measured over 30 visits per level, before this existed: easy scored
 * 0.33 points a visit, medium 0.80 and hard 2.53, with one visit in
 * eight running to six or more. Hard was not beating the player shot by
 * shot, it was beating them in one turn.
 *
 * The obvious fix is a ceiling — "no more than three a visit" — and it is
 * the wrong one. A ceiling plays a perfect opponent and then, at exactly
 * the same count every time, an opponent that fans an easy ball; players
 * read that pattern in two games and it is the one thing that does feel
 * like the game cheating.
 *
 * `cool` instead multiplies the chance of making the NEXT ball for every
 * ball already made this visit, which is the shape a real run has: the
 * cue ball drifts a little further out of line each time, and the shot
 * that ends a break is usually the fourth one, not a random one. Nothing
 * is capped and no count is special — a long run stays possible, it is
 * just as unlikely as the position deserves.
 */
export const DEFAULT_LEVEL = "medium";

/** Speeds the opponent will consider, in m/s. Deliberately short of the
 *  6 m/s cap: a human opponent does not smash, and a slow ball leaves a
 *  position rather than scattering one. */
const SPEEDS = [1.1, 1.7, 2.4, 3.2];
/** Angles either side of a straight line to each red. A carom needs the
 *  cut angle, not the full circle, and searching the full circle spends
 *  ten times the simulations to find the same shots. */
const SPREAD = 42;
const STEP = 3;

const deg = (d) => (d * Math.PI) / 180;

function clone(world) {
  return P.createWorld({ balls: world.balls.map((b) => ({ ...b })) });
}

/** One shot, simulated to rest. Returns the verdict and the resulting
 *  position, because the position is half of what the caller is choosing
 *  between. */
function play(world, cueId, angle, speed, spec) {
  const w = clone(world);
  const cue = P.getBall(w, cueId);
  P.strike(cue, Math.cos(angle), Math.sin(angle), speed, 0, 0);
  P.simulateToRest(w);
  return { verdict: judgeFourBall(w.events, spec), rest: w };
}

/** Straight-line bearings from the shooter to each target. */
function bearings(world, cueId, redIds) {
  const cue = P.getBall(world, cueId);
  return redIds.map((id) => {
    const b = P.getBall(world, id);
    return Math.atan2(b.y - cue.y, b.x - cue.x);
  });
}

/**
 * How open is this position for whoever shoots next?
 *
 * A sampled score rate, not a formula. Anything cheaper — distances
 * between balls, whether they are roughly in line — is a guess about a
 * table whose real answer the simulation already knows, and the guesses
 * are wrong exactly where it matters, on the clusters.
 *
 * Coarse on purpose: eight angles at two speeds is enough to tell an open
 * position from a dead one, and this runs once per candidate.
 */
function openness(world, cueId, spec) {
  const angles = bearings(world, cueId, spec.redIds);
  let tried = 0;
  let made = 0;
  for (const base of angles) {
    for (let d = -30; d <= 30; d += 15) {
      for (const speed of [1.4, 2.4]) {
        tried++;
        if (play(world, cueId, base + deg(d), speed, spec).verdict.scored) made++;
      }
    }
  }
  return made / tried;
}

/**
 * Choose the opponent's shot.
 *
 * `budget` is a simulation count rather than a time, so the same table
 * gives the same shot on a phone as on a desktop. A search that quietly
 * gets weaker on slower hardware is a difficulty setting nobody chose.
 *
 * @param {object} world           the table as it stands
 * @param {object} opts
 * @param {string} opts.cueId      the ball the opponent is playing
 * @param {string[]} opts.redIds
 * @param {string} opts.opponentId the player's ball, which is a foul to hit
 * @param {Level} opts.level
 * @param {number} [opts.run]      points already made this visit
 * @param {() => number} [opts.rng]
 * @returns {{angle:number, speed:number, intent:"make"|"miss"}}
 */
export function chooseShot(world, { cueId, redIds, opponentId, level, run = 0, rng = Math.random }) {
  const spec = { cueId, redIds, opponentId, penalizeFoul: false };
  const wantsToMake = rng() < level.make * Math.pow(level.cool, run);
  const wantsOpenLeave = rng() < level.easyLeave;

  // Every shot that scores, found by sweeping around the line to each red
  // rather than around the whole circle.
  const scoring = [];
  const misses = [];
  for (const base of bearings(world, cueId, redIds)) {
    for (let d = -SPREAD; d <= SPREAD; d += STEP) {
      for (const speed of SPEEDS) {
        const angle = base + deg(d);
        const r = play(world, cueId, angle, speed, spec);
        if (r.verdict.scored) scoring.push({ angle, speed, rest: r.rest });
        else if (!r.verdict.foul) misses.push({ angle, speed });
      }
    }
  }

  if (!scoring.length) {
    // Nothing on. Play the most plausible non-foul shot rather than
    // conceding — which is what a person does, and it keeps the table
    // moving instead of parking three balls in a corner.
    const pick = misses.length ? misses[Math.floor(rng() * misses.length)] : null;
    const base = bearings(world, cueId, redIds)[0];
    return pick
      ? { angle: pick.angle, speed: pick.speed, intent: "miss" }
      : { angle: base, speed: SPEEDS[1], intent: "miss" };
  }

  if (!wantsToMake) {
    // A near miss: a real line, turned just far enough off to fail. The
    // shot the player watches is the one they would have played, arriving
    // a ball's width wide.
    const shot = scoring[Math.floor(rng() * scoring.length)];
    for (const off of [2.5, 3.5, 5, 7, 9]) {
      for (const sign of rng() < 0.5 ? [1, -1] : [-1, 1]) {
        const angle = shot.angle + deg(off * sign);
        if (!play(world, cueId, angle, shot.speed, spec).verdict.scored) {
          return { angle, speed: shot.speed, intent: "miss" };
        }
      }
    }
    return { angle: shot.angle, speed: shot.speed, intent: "make" };
  }

  // It is going to score; the only question left is what it leaves. Only a
  // handful of candidates are measured, because openness() costs sixteen
  // simulations each and the difference between the best leave and the
  // fourth best is not worth eighty.
  const sample = [];
  const stride = Math.max(1, Math.floor(scoring.length / 5));
  for (let i = 0; i < scoring.length && sample.length < 5; i += stride) sample.push(scoring[i]);
  for (const c of sample) c.open = openness(c.rest, opponentId, { ...spec, cueId: opponentId, opponentId: cueId });

  sample.sort((a, b) => b.open - a.open);
  const chosen = wantsOpenLeave ? sample[0] : sample[Math.min(sample.length - 1, 1 + Math.floor(rng() * 2))];
  return { angle: chosen.angle, speed: chosen.speed, intent: "make" };
}
