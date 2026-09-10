// game/achievements.js
// Achievement DEFINITIONS as data — one array, each entry an
// {id, title, description, moment, check(ctx)} record — never a
// hardcoded if/else ladder. Adding a 13th achievement later means
// appending one object to ACHIEVEMENTS, nothing else in this file
// changes. Deciding WHEN to unlock things (and remembering that they
// already have been) is main.js's job, wired through core/storage.js;
// this module only ever answers "given these facts, is this achievement
// satisfied?" — it doesn't persist anything itself.
//
// Two distinct evaluation MOMENTS, because they genuinely need different
// inputs and different timing:
//
//   'turn'     — must be judged the instant a turn ends, not deferred to
//                game over. "Capture 5+ boxes in one turn" is a fact
//                about THAT turn; by the time the game ends, nothing in
//                the final board state remembers how many boxes came off
//                any one particular turn (same reason game/ai.js's
//                double-cross planning can't be re-derived from a live
//                board after the fact — see that file's module comment).
//   'gameOver' — judged once, in bulk, right when a game ends. Most
//                achievements live here: they're about the game's final
//                outcome (who won, by how much, whether a streak
//                continued) plus a handful of facts that had to be
//                tracked incrementally DURING play and are handed in as
//                part of the context object (see below) — a deliberate
//                hand-off at some point (Double Cross), the worst
//                deficit ever faced (Comeback), whether a hint was used
//                (No Help Needed). Tracking those incrementally is the
//                caller's job (main.js); this module only consumes the
//                final tallies.
//
// evaluateTurnEnd()/evaluateGameOver() both take an `unlocked` set of
// already-earned ids and skip those entirely — check() is never even
// called for an id already unlocked, so no predicate here has to worry
// about being safe to re-run.
//
// --- Double Cross detection (see isDeliberateHandoff() below) ---
//
// The strict definition of a double-cross — declining the last two
// boxes of a chain specifically to force the opponent to open the next
// one — needs to know a chain's ORIGINAL length, which is exactly the
// thing game/ai.js's module comment explains can't be read off a live
// board after the fact. Reimplementing that bookkeeping here just to
// detect it for an achievement would duplicate a subtle, already-solved
// problem. Instead this uses the simpler heuristic the milestone asks
// for: at the moment a move is about to be played, were there any
// capturable boxes available, and does the move about to be drawn fail
// to complete ANY of them? That covers the textbook "take 3, leave 2 as
// a domino" case (right before the domino move, the near box IS
// capturable, and the move drawn is the far edge, not the one that
// would take it) without needing to reconstruct chain history — and it
// also covers the more casual case of a player just declining an open
// box from the start of their turn, which is a strictly EASIER bar to
// clear, so the achievement is if anything more attainable than the
// strict definition, never less.

import { edgesOfBox, getEdgeGrid } from "./rules.js";
import { analyze } from "./chains.js";

/**
 * True if, immediately before `move` is played from `state` (not yet
 * mutated by it), the mover had at least one capturable box available
 * and `move` completes none of them. Call this once per move, BEFORE
 * rules.js's applyMove() mutates `state` — capturableBoxes only exists
 * while the box is still open.
 * @param {object} state - a rules.js game state, not yet mutated by `move`
 * @param {{type:'h'|'v', r:number, c:number}} move
 * @returns {boolean}
 */
export function isDeliberateHandoff(state, move) {
  const { capturableBoxes } = analyze(state);
  if (capturableBoxes.length === 0) return false;
  return !capturableBoxes.some((box) => moveCompletesBox(state, move, box));
}

function moveCompletesBox(state, move, box) {
  const undrawn = edgesOfBox(box.r, box.c).filter(
    ({ type, r, c }) => getEdgeGrid(state, type)[r][c] === false
  );
  // A capturable box is degree 1 by definition, so this is always
  // exactly one edge — but written as a filter+length check rather than
  // "trust there's exactly one" so a violated invariant fails loud
  // elsewhere (isBoxComplete/analyze) rather than silently here.
  return (
    undrawn.length === 1 && undrawn[0].type === move.type && undrawn[0].r === move.r && undrawn[0].c === move.c
  );
}

/**
 * Running tracker for Comeback: the largest deficit either player has
 * faced at any point so far this game. Call updateDeficitTracking()
 * after every move, once the scores it reads have already been updated
 * by applyMove() — a single big multi-box capture can itself swing who's
 * behind, so this has to be sampled after every move, not just at turn
 * boundaries.
 * @returns {{maxDeficit0: number, maxDeficit1: number}}
 */
export function createDeficitTracker() {
  return { maxDeficit0: 0, maxDeficit1: 0 };
}

/**
 * @param {{maxDeficit0: number, maxDeficit1: number}} tracker
 * @param {[number, number]} scores - state.scores, already updated for this move
 * @returns {{maxDeficit0: number, maxDeficit1: number}} the same tracker, mutated
 */
export function updateDeficitTracking(tracker, scores) {
  const diff = scores[1] - scores[0]; // positive => player 0 is behind by `diff`
  tracker.maxDeficit0 = Math.max(tracker.maxDeficit0, diff);
  tracker.maxDeficit1 = Math.max(tracker.maxDeficit1, -diff);
  return tracker;
}

/**
 * All 12 achievements. `check(ctx)` reads whatever shape of context
 * object the corresponding evaluate*() function below builds — see each
 * function's doc comment for exactly which fields are required for
 * which moment. Every check for a "win-flavored" achievement is careful
 * to only credit a win that's actually the tracked player's own: in vs
 * AI mode that's always the human (player 0 — see main.js's AI_PLAYER
 * comment), never a win the AI happened to score FOR itself; in local
 * mode either seat counts, since there's no fixed "you" to distinguish
 * from an opponent on the same device.
 */
export const ACHIEVEMENTS = [
  {
    id: "first_win",
    title: "First Win",
    description: "Win a game against the AI, any difficulty.",
    moment: "gameOver",
    check: (ctx) => ctx.humanWon,
  },
  {
    id: "chain_reaction",
    title: "Chain Reaction",
    description: "Capture 5 or more boxes in a single turn.",
    moment: "turn",
    check: (ctx) => ctx.creditable && ctx.boxesThisTurn >= 5,
  },
  {
    id: "chain_master",
    title: "Chain Master",
    description: "Capture 8 or more boxes in a single turn.",
    moment: "turn",
    check: (ctx) => ctx.creditable && ctx.boxesThisTurn >= 8,
  },
  {
    id: "double_cross",
    title: "Double Cross",
    description: "Deliberately hand boxes to your opponent, then win that game.",
    moment: "gameOver",
    check: (ctx) => ctx.creditableWin && ctx.handoffByWinner,
  },
  {
    id: "shutout",
    title: "Shutout",
    description: "Win a game while your opponent scores zero boxes.",
    moment: "gameOver",
    check: (ctx) => ctx.creditableWin && ctx.opponentScore === 0,
  },
  {
    id: "comeback",
    title: "Comeback",
    description: "Win after trailing by 5 or more boxes at some point in the game.",
    moment: "gameOver",
    check: (ctx) => ctx.creditableWin && ctx.maxDeficitForWinner >= 5,
  },
  {
    id: "no_help_needed",
    title: "No Help Needed",
    description: "Beat Hard difficulty without using a single hint.",
    moment: "gameOver",
    check: (ctx) => ctx.humanWon && ctx.difficulty === "hard" && ctx.hintsUsed === 0,
  },
  {
    id: "grid_master",
    title: "Grid Master",
    description: "Beat Hard difficulty on 3×3, 5×5, and 7×7 grids.",
    moment: "gameOver",
    check: (ctx) => ctx.humanWon && ctx.difficulty === "hard" && ctx.allHardSizesWon,
  },
  {
    id: "hot_streak",
    title: "Hot Streak",
    description: "Win 5 vs-AI games in a row.",
    moment: "gameOver",
    check: (ctx) => ctx.humanWon && ctx.currentStreak >= 5,
  },
  {
    id: "unstoppable",
    title: "Unstoppable",
    description: "Win 10 vs-AI games in a row.",
    moment: "gameOver",
    check: (ctx) => ctx.humanWon && ctx.currentStreak >= 10,
  },
  {
    id: "perfectionist",
    title: "Perfectionist",
    description: "Win a 7×7 game with at least double your opponent's score.",
    moment: "gameOver",
    check: (ctx) => ctx.creditableWin && ctx.gridSize === 7 && ctx.winnerScore >= ctx.opponentScore * 2,
  },
  {
    id: "local_legend",
    title: "Local Legend",
    description: "Complete 10 games in 2-player local mode.",
    moment: "gameOver",
    check: (ctx) => ctx.mode === "local" && ctx.localGamesCompletedTotal >= 10,
  },
];

function evaluateMoment(moment, ctx, unlocked) {
  const unlockedSet = unlocked instanceof Set ? unlocked : new Set(unlocked);
  return ACHIEVEMENTS.filter((a) => a.moment === moment && !unlockedSet.has(a.id) && a.check(ctx));
}

/**
 * Evaluate the 'turn'-moment achievements (Chain Reaction, Chain
 * Master). Call once per turn, right when a turn ends (not per move —
 * a turn can span several captures).
 * @param {{boxesThisTurn: number, creditable: boolean}} ctx
 *   - boxesThisTurn: total boxes captured over the whole turn that just ended
 *   - creditable: whether this turn's mover is the one the achievement
 *     should be credited to (in vs AI mode: only the human; in local
 *     mode: always true, either seat counts)
 * @param {Set<string> | string[]} unlocked - already-unlocked ids
 * @returns {typeof ACHIEVEMENTS} newly satisfied achievement definitions
 */
export function evaluateTurnEnd(ctx, unlocked) {
  return evaluateMoment("turn", ctx, unlocked);
}

/**
 * Evaluate the 'gameOver'-moment achievements. Call once when a game
 * ends, after any cumulative facts it depends on (Hard win per grid
 * size, local games completed) have already been updated for THIS
 * game's own contribution.
 * @param {{
 *   mode: 'local'|'ai',
 *   gridSize: number,
 *   difficulty: 'easy'|'medium'|'hard',
 *   humanWon: boolean,
 *   creditableWin: boolean,
 *   winnerScore: number|null,
 *   opponentScore: number|null,
 *   maxDeficitForWinner: number,
 *   handoffByWinner: boolean,
 *   hintsUsed: number,
 *   currentStreak: number,
 *   allHardSizesWon: boolean,
 *   localGamesCompletedTotal: number,
 * }} ctx
 * @param {Set<string> | string[]} unlocked - already-unlocked ids
 * @returns {typeof ACHIEVEMENTS} newly satisfied achievement definitions
 */
export function evaluateGameOver(ctx, unlocked) {
  return evaluateMoment("gameOver", ctx, unlocked);
}
