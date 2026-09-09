// src/game/series.js
// A two-player MATCH: two rounds, and how a winner is read out of them.
//
// WHY A MATCH IS NOT ONE ROUND.
//
// The player who shoots first wins far more than half. Measured with two
// identical models, 400 matches per cell, opening side alternated so the
// board's own asymmetry cancels:
//
//     3 stones  55.5%   (95% CI 50.6-60.4)
//     4 stones  60.3%   (55.5-65.0)
//     5 stones  60.0%   (55.2-64.8)
//     6 stones  56.5%   (51.6-61.4)
//
// Every interval clears 50%, so there is no stone count that happens to
// be fair — the advantage is structural and has to be answered
// structurally. A best-of-three with alternating openings does NOT answer
// it: at one round each, the decider hands one player a 60% board again.
//
// Two rounds, each player opening exactly one, cancels it by symmetry.
// Measured over 700 mirrored pairs: the player who opens round 1 wins the
// MATCH 49.3% of the time (CI 45.4-53.2). The important property is that
// this holds WITHOUT knowing the size of the advantage — our number comes
// from an AI and humans may differ, but a mirrored pair is fair for any
// value of it. `npm run fairness` re-measures both tables.
//
// The cost is that two rounds can end level, so the match needs a ladder
// of tiebreaks rather than a third round. Frequency of each rung, same
// 700 pairs:
//
//     rounds won      52.6%
//     stones kept     32.9%
//     shots used       5.6%
//     still level      9.0%
//
// The 9% is settled by a DRAW SHOT: one flick each at the centre of an
// empty board, closest wins. Curling decides the hammer the same way, and
// for the same reason — it is the one thing that can break a tie without
// being chance. Both shots are taken blind (each in its own empty world,
// so neither player ever sees the other's result before shooting), which
// is what keeps the second shooter from simply aiming to beat a number.
//
// Every rung is something the player did, and nothing here is chance —
// which was the whole point: a rating has to be climbable by playing
// better, not by winning a coin flip.

/** Rounds in a match. Two, because two is what makes it symmetric. */
export const ROUNDS_PER_MATCH = 2;

/**
 * @param {{stoneCount:number, opener:0|1}} options - `opener` is who
 *   shoots first in round 1. It IS chosen at random, and that is
 *   harmless: whoever it is, the other player opens round 2.
 */
export function createSeries({ stoneCount, opener }) {
  return { stoneCount, opener, rounds: [], draw: null };
}

/** Who opens the round about to be played. */
export function openerFor(series) {
  return series.rounds.length % 2 === 0 ? series.opener : /** @type {0|1} */ (1 - series.opener);
}

/** True while another round is owed. */
export function hasNextRound(series) {
  return series.rounds.length < ROUNDS_PER_MATCH;
}

/**
 * @param {{winner:0|1, alive:[number,number], shots:[number,number]}} result
 */
export function recordRound(series, result) {
  series.rounds.push({ opener: openerFor(series), ...result });
}

/**
 * Record the draw-shot decider: each player's distance from the centre of
 * the board, in board units. A stone that left the board is Infinity —
 * missing the board entirely loses to any shot that stayed on it.
 * @param {[number,number]} distances
 */
export function recordDrawShot(series, distances) {
  series.draw = { distances };
}

/**
 * Read the match out of the rounds played.
 *
 * Returns the whole LADDER, not just the answer: the result card shows
 * every rung with both players' numbers and marks the one that settled
 * it, because "you won" without "and here is why" is the thing that makes
 * a tiebreak feel arbitrary. Rungs above the decisive one are tied by
 * definition, and that is worth showing too — it is the evidence that the
 * match really was that close.
 *
 * @returns {{complete:boolean, winner:0|1|null, reason:string|null,
 *   ladder:{key:string, values:[number,number], lowerWins:boolean, decisive:boolean}[]}}
 */
export function seriesOutcome(series) {
  const rounds = [0, 0];
  const stones = [0, 0];
  const shots = [0, 0];
  for (const r of series.rounds) {
    rounds[r.winner] += 1;
    stones[0] += r.alive[0];
    stones[1] += r.alive[1];
    shots[0] += r.shots[0];
    shots[1] += r.shots[1];
  }

  const ladder = [
    { key: "rounds", values: /** @type {[number,number]} */ (rounds), lowerWins: false, decisive: false },
    { key: "stones", values: /** @type {[number,number]} */ (stones), lowerWins: false, decisive: false },
    // Fewer shots wins: taking six turns to do what the other player did
    // in four is the difference the previous two rungs could not see.
    { key: "shots", values: /** @type {[number,number]} */ (shots), lowerWins: true, decisive: false },
  ];

  const complete = series.rounds.length >= ROUNDS_PER_MATCH;
  if (!complete) return { complete, winner: null, reason: null, ladder };

  for (const rung of ladder) {
    const [a, b] = rung.values;
    if (a === b) continue;
    rung.decisive = true;
    const winner = /** @type {0|1} */ (rung.lowerWins ? (a < b ? 0 : 1) : a > b ? 0 : 1);
    return { complete, winner, reason: rung.key, ladder };
  }
  // Dead level: same rounds, same stones, same shots. Rare — 9% between
  // identical models, rarer between two different humans — and settled by
  // one blind flick each at the centre rather than by a coin.
  if (series.draw) {
    const [a, b] = series.draw.distances;
    const rung = { key: "draw", values: /** @type {[number,number]} */ ([a, b]), lowerWins: true, decisive: a !== b };
    ladder.push(rung);
    // Two stones the same distance out (both off the board, most likely)
    // decides nothing, so the shot is simply taken again.
    if (a === b) return { complete, winner: null, reason: "level", needsDraw: true, ladder };
    return { complete, winner: /** @type {0|1} */ (a < b ? 0 : 1), reason: "draw", ladder };
  }
  return { complete, winner: null, reason: "level", needsDraw: true, ladder };
}
