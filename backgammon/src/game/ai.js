// game/ai.js
// The computer's play, and the Hint. One static heuristic scores a
// position (pip count, blots and the odds of their being hit, points
// made, home-board points, the bar, primes, bearing-off progress); every
// legal way to finish the turn is scored and the best is played.
//
// Two paces, chosen in Settings:
//   "standard" — the plain heuristic, deterministic.
//   "relaxed"  — the default. A cautious style (blots weigh more, the
//                race weighs less, hitting is less tempting) plus a
//                little noise drawn from the game's own rng among the
//                top few candidates, so games stay close and a seeded
//                game still replays exactly.
//
// Everything here is pure: no DOM, no timers, no Math.random.

import {
  HUMAN, COMPUTER, DIR, opponent, countAt, isHome, pipCount, posOf, applyToPos,
  continuations, rngStep,
} from "./backgammon.js";

function furthestBack(pos, player) {
  if (pos.bar[player] > 0) return player === HUMAN ? 24 : -1;
  if (player === HUMAN) { for (let i = 23; i >= 0; i--) if (countAt(pos.points, i, HUMAN) > 0) return i; return -1; }
  for (let i = 0; i < 24; i++) if (countAt(pos.points, i, COMPUTER) > 0) return i;
  return 24;
}
/** No contact left: the two sides have passed each other. */
export function isRace(pos) {
  return furthestBack(pos, HUMAN) < furthestBack(pos, COMPUTER);
}

/**
 * Chance (0..1) that `shooter` hits a lone checker of the other side on
 * index `blot` with their next roll, counting direct and combination
 * shots, with the blot owner's made points blocking the way.
 */
export function hitProbability(pos, blot, shooter) {
  const owner = opponent(shooter);
  const dir = DIR[shooter];
  const barPos = shooter === HUMAN ? 24 : -1;
  let shooters = [];
  if (pos.bar[shooter] > 0) shooters = [barPos];
  else for (let i = 0; i < 24; i++) if (countAt(pos.points, i, shooter) > 0) shooters.push(i);
  const open = (i) => i >= 0 && i <= 23 && countAt(pos.points, i, owner) < 2;
  const dist = (s) => (blot - s) * dir;
  const needsBoth = pos.bar[shooter] > 1;
  let hits = 0;
  for (let d1 = 1; d1 <= 6; d1++) for (let d2 = 1; d2 <= 6; d2++) {
    let hit = false;
    for (const s of shooters) {
      const d = dist(s);
      if (d <= 0) continue;
      if (d === d1 || d === d2) { hit = true; break; }
      if (needsBoth) continue;
      if (d1 !== d2) {
        if (d === d1 + d2 && (open(s + dir * d1) || open(s + dir * d2))) { hit = true; break; }
      } else {
        for (let k = 2; k <= 4; k++) {
          if (d !== d1 * k) continue;
          let clear = true;
          for (let j = 1; j < k; j++) if (!open(s + dir * d1 * j)) clear = false;
          if (clear) { hit = true; break; }
        }
        if (hit) break;
      }
    }
    if (hit) hits++;
  }
  return hits / 36;
}

/** Longest run of consecutive points held by `player` (2+ checkers). */
export function primeLength(pos, player) {
  let best = 0, run = 0;
  for (let i = 0; i < 24; i++) {
    if (countAt(pos.points, i, player) >= 2) { run++; best = Math.max(best, run); } else run = 0;
  }
  return best;
}

const STYLE = {
  standard: { race: 1.0, blot: 1.0, hit: 1.0, prime: 1.0 },
  relaxed: { race: 0.55, blot: 1.7, hit: 0.45, prime: 0.7 },
};

/** Static score of a position from `player`'s side; higher is better. */
export function evaluate(pos, player, style = "standard") {
  const w = STYLE[style] || STYLE.standard;
  const opp = opponent(player);
  const myPips = pipCount(pos, player), oppPips = pipCount(pos, opp);
  let score = (oppPips - myPips) * w.race;
  score += (pos.off[player] - pos.off[opp]) * 2.5;
  const race = isRace(pos);
  let oppHomePoints = 0, myHomePoints = 0;
  for (let i = 0; i < 24; i++) {
    if (isHome(i, opp) && countAt(pos.points, i, opp) >= 2) oppHomePoints++;
    if (isHome(i, player) && countAt(pos.points, i, player) >= 2) myHomePoints++;
  }

  if (!race) {
    // blots: the expected cost of being hit (pips lost + tempo), worse
    // the stronger the other side's home board
    for (let i = 0; i < 24; i++) {
      if (countAt(pos.points, i, player) !== 1) continue;
      const p = hitProbability(pos, i, opp);
      if (p === 0) continue;
      const travelled = player === HUMAN ? 24 - i : i + 1;
      score -= p * (travelled + 6) * (1 + 0.2 * oppHomePoints) * w.blot;
    }
    // points made: home board strongest, outer board useful, anchors safe
    for (let i = 0; i < 24; i++) {
      const n = countAt(pos.points, i, player);
      if (n < 2) continue;
      if (isHome(i, player)) score += 4;
      else if (isHome(i, opp)) {
        const depth = player === HUMAN ? i - 18 : 23 - i; // 0 = deepest in their board
        score += depth >= 2 ? 4 : 2.5;
      } else score += 2.5;
      if (n > 4) score -= (n - 4) * 0.8;
    }
    // the bar
    score += pos.bar[opp] * (5 + 1.5 * myHomePoints) * w.hit;
    score -= pos.bar[player] * 3;
    // primes
    const pl = primeLength(pos, player);
    if (pl >= 3) {
      let behind = false;
      for (let i = 0; i < 24; i++) if (countAt(pos.points, i, opp) > 0 && ((player === HUMAN && i > 0) || player === COMPUTER)) behind = true;
      score += (pl - 2) * (pl - 2) * (behind ? 3 : 1.5) * w.prime;
    }
    const ol = primeLength(pos, opp);
    if (ol >= 3) score -= (ol - 2) * (ol - 2) * 2;
  } else {
    // a pure race: get home, avoid wasted pips and gaps
    for (let i = 0; i < 24; i++) {
      const n = countAt(pos.points, i, player);
      if (!n) continue;
      if (!isHome(i, player)) score -= 1.5 * n;
      else if (n > 3) score -= (n - 3) * 0.5;
    }
  }
  return score;
}

function positionKey(pos) {
  return pos.points.join(",") + "|" + pos.bar.h + "," + pos.bar.c + "|" + pos.off.h + "," + pos.off.c;
}

/**
 * Every distinct way to finish the current turn, scored. Returns
 * [{ moves, score }] sorted best first. Empty when nothing can be played.
 */
export function rankedContinuations(state, player = state.turn, style = "standard") {
  const seqs = continuations(state);
  const seen = new Map();
  for (const s of seqs) {
    if (!s.length) continue;
    const pos = s.reduce((p, m) => applyToPos(p, m, player), posOf(state));
    const key = positionKey(pos);
    if (seen.has(key)) continue;
    seen.set(key, { moves: s, score: evaluate(pos, player, style) });
  }
  return [...seen.values()].sort((x, y) => y.score - x.score);
}

/**
 * The computer's choice for its turn: the best-scoring sequence on
 * "standard"; on "relaxed" one of the top few, with noise drawn from
 * (and advancing) the state's rng so a seeded game replays exactly.
 * Works from mid-turn too (a restored save). Returns { moves, rng } —
 * moves is [] when nothing can be played.
 */
export function chooseComputerMoves(state) {
  const pace = state.difficulty === "standard" ? "standard" : "relaxed";
  const ranked = rankedContinuations(state, COMPUTER, pace);
  if (!ranked.length) return { moves: [], rng: state.rng };
  if (pace === "standard") return { moves: ranked[0].moves, rng: state.rng };
  const top = ranked.slice(0, 4);
  let rng = state.rng, best = null, bestScore = -Infinity;
  for (const c of top) {
    let v;
    [v, rng] = rngStep(rng);
    const noisy = c.score + v * 9;
    if (noisy > bestScore) { bestScore = noisy; best = c; }
  }
  return { moves: best.moves, rng };
}

/** The strongest way for the player to finish the turn (for Hint). */
export function bestHumanMoves(state) {
  const ranked = rankedContinuations(state, HUMAN, "standard");
  return ranked.length ? ranked[0].moves : [];
}
