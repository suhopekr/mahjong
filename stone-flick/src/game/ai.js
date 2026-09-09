// game/ai.js
// The opponent. Pure — no DOM, no timers — so a whole AI game can be run
// in Node (test/ai.test.js, and the stage-balance script).
//
// WHY SIMULATION SEARCH AND NOT A MINIMAX
// Gomoku's AI was minimax + alpha-beta over a discrete board, and the
// series' notes warn against copying the PREVIOUS game's AI approach
// blindly — that warning applies in this direction too. Alkkagi's move
// space is continuous (any stone, any angle, any power) and the outcome
// of a single move is a chaotic physics rollout, so there is no useful
// static evaluation of a position and no branching factor to prune. What
// there IS, uniquely, is a perfect forward model: game/physics.js is
// deterministic, so the AI can simply TRY a candidate shot and look at
// what actually happened. That makes this a sampled one-ply rollout
// search, and one ply is genuinely enough — a two-ply search would be
// predicting the human's aim, which is noise.
//
// DIFFICULTY IS NOISE, NOT DEPTH — WITH TWO EXCEPTIONS
// Easy/Medium/Hard differ in (a) how many candidates get sampled and (b)
// how much error is added to the chosen shot before it is actually
// fired. Adding error to the FINAL shot rather than to the search is
// deliberate: the AI still knows a good idea when it sees one, it just
// executes it imperfectly, which is what a weaker human player looks
// like. An AI that searches badly instead plays incoherently, which
// reads as broken rather than as beatable.
//
// Exception 1: every difficulty is allowed to see that a shot loses its
// own stone. Self-destruction is the one mistake that makes an opponent
// look stupid rather than weak, so it is penalized hard at all levels.
//
// Exception 2 — and this one was a real, measured bug, not a
// precaution. Scoring candidates on a NOISELESS rollout and only then
// adding execution noise makes the AI systematically pick the most
// fragile shot available: the search finds the minimum power that just
// barely reaches, because nothing rewards having margin, and then the
// jitter it is about to apply pushes that shot below the threshold. On a
// straight "knock the edge stone off" position, Hard converted 5 out of
// 10 — worse than Easy has any business being — while every noiseless
// candidate in the set succeeded. The fix is the refineUnderNoise() pass
// below: the top few candidates are re-scored across several rollouts
// that each include the difficulty's own jitter, so the AI chooses the
// shot with the best EXPECTED outcome given how accurately it can
// actually shoot. A strong player picks the shot they can make, not the
// shot that would work if they were perfect.

import { cloneWorld, simulateToRest, beginShot, countAlive } from "./physics.js";

/** Search budget and execution noise per difficulty.
 * `angleJitter` is in radians, `powerJitter` in absolute power units. */
export const DIFFICULTY = {
  easy: { candidates: 26, angleJitter: 0.20, powerJitter: 0.22, blunderChance: 0.18 },
  medium: { candidates: 70, angleJitter: 0.10, powerJitter: 0.12, blunderChance: 0.06 },
  hard: { candidates: 150, angleJitter: 0.035, powerJitter: 0.05, blunderChance: 0 },
};

/** Search rollouts are capped shorter than a real turn: a shot still
 * crawling after 4.5 simulated seconds has already spent its energy, and
 * the tail costs as much to simulate as the interesting part. */
const SEARCH_SECONDS = 4.5;

/** How many of the best noiseless candidates get re-scored under noise,
 * and how many jittered rollouts each one gets. 6 x 5 = 30 extra
 * rollouts, which on the largest stage costs well under the pause the UI
 * already takes before the AI moves. */
const REFINE_CANDIDATES = 6;
const REFINE_SAMPLES = 5;

const POWERS = [0.42, 0.62, 0.8, 1];
const ANGLE_SPREAD = [0, 0.07, -0.07, 0.16, -0.16];

/**
 * Score one rollout from `player`'s point of view.
 *
 * The weights encode the priority order the game actually rewards:
 * knocking an enemy stone off is worth far more than position, losing
 * your own is worth slightly MORE than a kill is worth (so a 1-for-1
 * trade is never chosen when anything else is available — you cannot
 * win a trading war you did not start ahead), and everything else is a
 * small tiebreak so the AI does something purposeful when no shot scores.
 */
function scoreOutcome(before, after, player) {
  const opponent = player === 0 ? 1 : 0;
  const killed = countAlive(before, opponent) - countAlive(after, opponent);
  const lost = countAlive(before, player) - countAlive(after, player);

  let score = killed * 100 - lost * 130;

  // Wiping the opponent out ends the match — worth more than the sum of
  // its kills, or the AI would weigh the last kill like any other.
  if (countAlive(after, opponent) === 0 && countAlive(after, player) > 0) score += 400;

  // Positional tiebreak: prefer ending with your stones AWAY from the
  // board edge (a stone near the rim is one nudge from gone) and near
  // enough to the enemy to threaten next turn.
  for (const s of after.stones) {
    if (!s.alive) continue;
    const edge = Math.min(s.x, 1 - s.x, s.y, 1 - s.y);
    const safety = Math.min(edge, 0.25) * 12; // saturates — center is not better than "safe"
    if (s.player === player) score += safety;
    else score -= safety * 0.5;
  }

  const mine = after.stones.filter((s) => s.alive && s.player === player);
  const theirs = after.stones.filter((s) => s.alive && s.player === opponent);
  if (mine.length && theirs.length) {
    let closest = Infinity;
    for (const a of mine) {
      for (const b of theirs) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    }
    score += (1 - Math.min(closest, 1)) * 8;
  }
  return score;
}

/** Fisher-Yates against a supplied rng, so a test can make the AI
 * reproducible without the AI itself being deterministic in play. */
/** One rollout of `shot` with `jitter` applied, scored. Shared by the
 * noiseless first pass (zero jitter) and the refinement pass, so the two
 * cannot disagree about what a shot is worth. */
function rollout(world, player, shot, angleJitter, powerJitter, rng) {
  const trial = cloneWorld(world);
  const stone = trial.stones.find((s) => s.id === shot.stoneId);
  if (!stone) return -Infinity;
  const angle = shot.angle + (angleJitter ? (rng() * 2 - 1) * angleJitter : 0);
  const power = Math.max(0.15, Math.min(1, shot.power + (powerJitter ? (rng() * 2 - 1) * powerJitter : 0)));
  beginShot(trial, stone, Math.cos(angle), Math.sin(angle), power);
  simulateToRest(trial, SEARCH_SECONDS);
  return scoreOutcome(world, trial, player);
}

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Every candidate shot worth trying: each of our stones aimed at each
 * TARGET, at a spread of angles around the direct line and a handful of
 * powers.
 *
 * A target is an opponent's stone — and also a portal mouth or a bumper.
 * Those two were added after a balance run made the omission visible: on
 * the portal stage a casual and an expert player scored within two points
 * of each other, because with a wall across the middle every enemy-ward
 * ray is blocked and the AI was effectively shooting blind at both skill
 * levels. A stage measured by a player model that cannot see its main
 * route is not measured at all.
 *
 * Aiming at a portal or a bumper is not assumed to be GOOD — the rollout
 * scores what actually happens, so a bad route through one scores badly.
 * All this does is put the routes that exist into the candidate set.
 * Everything else is still ruled out: a blind angular sweep would spend
 * the whole budget on shots into empty board.
 */
function candidateShots(world, player) {
  const mine = world.stones.filter((s) => s.alive && s.player === player);
  const targets = [
    ...world.stones.filter((s) => s.alive && s.player !== player),
    ...world.obstacles.filter((o) => o.type === "portal" || o.type === "bumper"),
  ];
  const out = [];
  for (const from of mine) {
    for (const target of targets) {
      const base = Math.atan2(target.y - from.y, target.x - from.x);
      for (const da of ANGLE_SPREAD) {
        for (const power of POWERS) {
          out.push({ stoneId: from.id, angle: base + da, power });
        }
      }
    }
  }
  return out;
}

/**
 * Choose a shot.
 * @param {object} world - the live world; never mutated (rollouts run on clones)
 * @param {0|1} player
 * @param {"easy"|"medium"|"hard"|{candidates:number,angleJitter:number,powerJitter:number,blunderChance:number}} difficulty
 *   A named level, or an explicit config. The object form exists for
 *   test/balance.mjs, which needs to stand in for a HUMAN of a given
 *   skill rather than for one of the game's three opponents — a human
 *   aims better than they evaluate, which is not a point on the
 *   easy/medium/hard line.
 * @param {() => number} [rng]
 * @returns {{stoneId:number, dirX:number, dirY:number, power:number}|null}
 *   null only when the side to move has no stones left, which the match
 *   layer will already have turned into a result.
 */
export function chooseShot(world, player, difficulty = "medium", rng = Math.random) {
  const config = typeof difficulty === "object" && difficulty !== null ? difficulty : DIFFICULTY[difficulty] ?? DIFFICULTY.medium;
  const all = candidateShots(world, player);
  if (all.length === 0) return null;

  const sample = shuffle(all.slice(), rng).slice(0, config.candidates);

  // Pass 1: noiseless, to find which ideas are worth anything at all.
  const scored = sample
    .map((cand) => ({ cand, score: rollout(world, player, cand, 0, 0, rng) }))
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;

  // Pass 2: re-score the shortlist under this difficulty's own execution
  // noise and take the best AVERAGE. With no jitter (Hard's angleJitter
  // is small but nonzero, so this always does something) the two passes
  // agree and this is a cheap no-op.
  let best = scored[0].cand;
  if (config.angleJitter > 0 || config.powerJitter > 0) {
    let bestExpected = -Infinity;
    for (const { cand } of scored.slice(0, REFINE_CANDIDATES)) {
      let total = 0;
      for (let i = 0; i < REFINE_SAMPLES; i++) {
        total += rollout(world, player, cand, config.angleJitter, config.powerJitter, rng);
      }
      const expected = total / REFINE_SAMPLES;
      if (expected > bestExpected) {
        bestExpected = expected;
        best = cand;
      }
    }
  }

  // A deliberate blunder: at the easier levels, sometimes throw the plan
  // away and take a random sampled shot instead. Pure jitter alone
  // produces an opponent that always has the right idea and merely
  // misses, which an observant player reads as "the AI is cheating and
  // pretending not to." Occasionally having the wrong idea is what makes
  // Easy feel like a person.
  if (config.blunderChance > 0 && rng() < config.blunderChance) {
    best = sample[Math.floor(rng() * sample.length)];
  }

  const angle = best.angle + (rng() * 2 - 1) * config.angleJitter;
  const power = Math.max(0.15, Math.min(1, best.power + (rng() * 2 - 1) * config.powerJitter));
  return { stoneId: best.stoneId, dirX: Math.cos(angle), dirY: Math.sin(angle), power };
}
