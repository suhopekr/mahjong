// game/quickstart.js
// QUICK GAME pre-placement: start with a chunk of edges already drawn so
// the first 10-20 "nothing happens yet" moves are skipped. This is the
// single highest-priority UX feature in the project — portal players
// decide whether to stay in the first 30 seconds (see CLAUDE.md section 5).
//
// The one hard rule: the generated position must never hand the player
// a free box. analyze().capturableBoxes must be empty — chains already
// forming is fine (that's the point, it's what makes the mid-game
// interesting sooner), but nobody should be able to complete a box on
// their very first move.

import { createGameState } from "./rules.js";
import { analyze } from "./chains.js";

// How much of the board to pre-fill, as a fraction of total edges.
// Kept as a named constant specifically because this needs real
// playtesting to tune — 30-40% is a starting guess, not a final answer.
export const QUICK_FILL_RATIO = 0.35;

// Random fill + reject-if-capturable is a "generate and test" strategy,
// not a constructive one, so it needs a retry budget. Bounded on two
// axes: attempts at the current target count, then a shrinking target
// count if every attempt at that count keeps failing — see
// generateQuickStart() below for why a fixed count can be provably
// unreachable (not just unlucky) on small boards.
const MAX_ATTEMPTS_PER_TARGET = 50;

/**
 * Build a fresh game state with QUICK_FILL_RATIO of its edges already
 * drawn at random, guaranteed to leave zero immediately-capturable boxes.
 *
 * @param {number} rows
 * @param {number} cols
 * @param {() => number} [rng] - injected for deterministic tests;
 *   defaults to Math.random. Must return a value in [0, 1), same
 *   contract as game/ai.js's rng parameter.
 * @param {number} [fillRatio] - overrides QUICK_FILL_RATIO; exists
 *   mainly so tests can force the fallback path deterministically
 *   without waiting on module-constant surgery.
 * @returns {object} a full state, same shape as createGameState()
 */
export function generateQuickStart(rows, cols, rng = Math.random, fillRatio = QUICK_FILL_RATIO) {
  const totalEdges = (rows + 1) * cols + rows * (cols + 1);
  let targetCount = Math.round(totalEdges * fillRatio);

  while (targetCount > 0) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TARGET; attempt++) {
      const state = tryFill(rows, cols, targetCount, rng);
      if (state) return state;
    }
    // Every attempt at this count produced a capturable box. Rather than
    // retry forever, shrink the target and try again — fewer drawn
    // edges only ever makes a capturable box LESS likely, so this is
    // guaranteed to terminate (worst case at 0, see below).
    targetCount -= 1;
  }

  // Last-resort fallback: an empty board trivially satisfies "no
  // capturable boxes" (there are no drawn edges to create one), so this
  // branch can never itself fail. In practice this is only reachable on
  // pathologically small boards — see quickstart.test.js for a 3x3 case
  // that's mathematically forced to shrink several steps before landing.
  return createGameState(rows, cols);
}

function tryFill(rows, cols, targetCount, rng) {
  const state = createGameState(rows, cols);
  const edges = allEdges(state);
  shuffle(edges, rng);

  for (let i = 0; i < targetCount; i++) {
    const edge = edges[i];
    const grid = edge.type === "h" ? state.hEdges : state.vEdges;
    grid[edge.r][edge.c] = true;
  }
  state.edgesDrawn = targetCount;

  if (analyze(state).capturableBoxes.length > 0) return null;
  return state;
}

function allEdges(state) {
  const edges = [];
  for (let r = 0; r <= state.rows; r++) {
    for (let c = 0; c < state.cols; c++) edges.push({ type: "h", r, c });
  }
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c <= state.cols; c++) edges.push({ type: "v", r, c });
  }
  return edges;
}

// Fisher-Yates, using the injected rng — same shuffle-by-swap shape as
// any textbook implementation, just parameterized so tests can seed it.
function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}
