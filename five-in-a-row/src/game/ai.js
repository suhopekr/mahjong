// game/ai.js
// findBestMove() (milestone 4-2) is the single strong engine: negamax +
// alpha-beta on top of game/evaluate.js's pattern-recognition scoring.
// chooseMove() (milestone 4-3) is the difficulty-aware entry point most
// callers actually want — see that function's own comment block for the
// Easy/Medium/Hard design.
//
// --- candidate generation --------------------------------------------
//
// 15x15 is 225 cells, but only the empty cells near EXISTING stones are
// ever worth considering — without this restriction, search doesn't
// terminate in any useful time at all. A cell counts as a candidate if
// it's within CHEBYSHEV distance 2 of some occupied cell (Chebyshev, not
// Manhattan: Gomoku patterns run diagonally as often as orthogonally, and
// Chebyshev distance 2 is the same 5x5 square neighborhood in every
// direction including the diagonals — Manhattan distance 2 would be a
// diamond that excludes e.g. a cell 2 rows and 2 columns away, even
// though that's exactly the kind of square a diagonal four might need).
// An empty board has no stones to measure distance from, so the sole
// candidate is the center point.
//
// --- performance: an incrementally-maintained candidate set -----------
//
// Rebuilding the candidate set by rescanning all 225 cells at every node
// of a multi-thousand-node search tree is real, measurable overhead
// (game/evaluate.js's own worked example: a single evaluate() call is
// tens of microseconds, and search calls it once per candidate at every
// node). Instead, ONE Set of encoded cell indices is built once per
// findBestMove() call and threaded through the whole recursion:
// applyMove() below removes the cell just played and adds any of its
// newly-uncovered neighbors, returning an `undo` closure that reverses
// exactly that — the same "mutate the shared board, undo after
// recursing" pattern game/board.js and this project's test fixtures
// already use, just extended to the candidate set too.
//
// --- avoiding the two most obvious mistakes ----------------------------
//
// Handled BEFORE any tree search even starts, exactly as requested:
// leaving either of these to depth-limited search risks missing them
// entirely (a shallow search might not reach the ply where the win
// shows up) and wastes time re-deriving what a single checkWin() pass
// over the candidates already answers directly.
//   1. If `player` has an immediate winning move, play it. Don't search.
//   2. Otherwise, if the OPPONENT has an immediate winning move, block
//      it. Don't search (and don't let a bad heuristic score talk the
//      search out of blocking — this is a hard override).
//
// --- search: negamax + alpha-beta, iterative deepening -----------------
//
// negamax() returns {score, move, timedOut}, scored from the mover's own
// perspective (evaluate()'s existing convention — see game/evaluate.js),
// negated one level at a time exactly like negamax is supposed to work
// with a single evaluation function instead of separate max/min ones.
//
// A depth-N search alone can't bound wall-clock time (a wide-open board
// with a big candidate set can blow past any time budget even at a fixed
// depth) — so findBestMove() does ITERATIVE DEEPENING instead of a
// single fixed-depth call: search depth 1, then 2, then 3, ..., keeping
// the best move from the last FULLY COMPLETED depth. If the time budget
// runs out mid-search at some depth, that depth's (possibly biased,
// incomplete alpha-beta) result is discarded in favor of the previous
// depth's complete, trustworthy one — a raw "stop wherever the clock
// says stop" cutoff on a single fixed-depth search can't offer that
// guarantee, since an early candidate might get a more thorough
// look than a later one purely by timing accident.
//
// Winning scores are adjusted by ply-from-root (`five - ply`) so a
// faster win always outscores a slower one, and — since this flows
// through the same negation every other score does — a forced loss
// further away always outscores a nearer one. Both follow from the one
// adjustment; neither needs its own separate rule.
//
// --- performance: branching-factor cap ----------------------------------
//
// Measured (test/benchmark-ai.mjs), NOT assumed: a real mid-game position
// with ~44 Chebyshev-radius-2 candidates took roughly EIGHT SECONDS to
// finish depth 4 with the full candidate set at every node — wildly over
// CLAUDE.md's 500ms-in-a-browser target (section: milestone 4-2). Move
// ordering alone (see orderMoves()) wasn't enough; the fix that actually
// closed the gap is capping every node to its top `maxBranching`
// candidates by 1-ply static eval (DEFAULT_MAX_BRANCHING) — the standard
// "move-count reduction" a real engine uses, trading a small, measured
// amount of move quality for roughly 17x less search per that same
// fixture. Combined with the iterative-deepening time budget above (which
// remains the hard backstop for whatever positions the branching cap
// doesn't fully tame), this keeps findBestMove() reliably under 500ms —
// see test/benchmark-ai.mjs for the actual numbers this was tuned
// against, run across several points in real self-played games, not just
// one hand-picked position.
//
// One real consequence worth naming explicitly, found while building the
// depth-comparison test below: a full, un-time-boxed depth-4 search can
// legitimately DECLINE to complete an open two into an open three, if it
// can see (within its own 4-ply horizon) the opponent fully neutralizing
// it in exactly two replies (block one flank, then the other). That's a
// genuine deeper-search finding, not a bug — verified by tracing the
// actual best-play sequence move by move — but it does mean "does the
// engine recognize an immediate opportunity" is really a question about
// the shallow move-ordering/evaluation layer, not the full-depth search,
// which may reasonably trade an obvious-looking gain for something that
// survives more scrutiny. test/ai.test.js tests this at maxDepth: 1
// specifically because of that.

import { checkWin } from "./board.js";
import { evaluate, PATTERN_SCORES, countPatterns } from "./evaluate.js";
import { checkForbiddenForBlack } from "./renju.js";

// Milestone 9: every search entry point below (findBestMove/chooseMove/
// scoreCandidateMoves) grew a trailing `renjuEnabled` parameter,
// defaulting to `false` everywhere — freestyle behavior is 100%
// unchanged for every EXISTING call site that doesn't pass it. When
// true, orderMoves() (the one place every node of the recursive search
// actually pulls a player's candidates from) excludes anything
// checkForbiddenForBlack() flags — for BLACK only, at whatever board
// state that particular node of the recursion has reached (never a
// one-time root-level filter — a point forbidden now may not be
// forbidden three plies deep, and vice versa, so this has to be
// re-evaluated fresh at every node, exactly like evaluate() itself is).
// White's move generation never calls checkForbiddenForBlack at all
// (CLAUDE.md milestone 9: "백은 제약 없음") — isLegalCandidate() below
// short-circuits to `true` immediately whenever `player !== BLACK`.
//
// This also directly answers milestone 9's own "White 쪽 평가에 반영"
// question: no separate evaluation-function bonus was added for White
// "cornering Black into a forbidden point." None is needed — because
// filtering happens INSIDE the recursive search itself (not just at the
// root), negamax already correctly discovers that Black's best reply at
// some node is worse than it looks whenever Black's actually-best-
// looking candidates are illegal there; that discovery propagates up to
// White's own score through completely ordinary negamax minimaxing, the
// same way any other tactical finding does. Bolting on a hand-tuned
// "reward White for restricting Black" heuristic on top would either be
// redundant with what the search already finds correctly, or would risk
// double-counting/distorting scores relative to what a full search
// already proves is true.
//
// Follow-up bugfix (a later pass, CLAUDE.md's own milestone for it has
// the full account): the paragraph above covers orderMoves()/negamax()'s
// OWN candidate filtering, which was always correct — the actual bug
// this follow-up fixed lived in the three checkWin()-based "is this an
// immediate win" fast paths (findImmediateWin(), used by
// findBestMoveWithStats() and chooseMove(); and scoreCandidateMoves()'s
// own per-move win check), which used to trust checkWin()'s freestyle
// verdict directly. checkWin() calls ANY run of 5-or-more a win, with no
// concept of "overline" — it cannot by itself tell a genuine (Renju-
// exempt) exact five apart from a 6-or-more overline that only LOOKS
// like a win to freestyle rules but is actually forbidden for Black. All
// three now route through isLegalCandidate() (below) before trusting a
// checkWin()===true result — the same helper orderMoves() already used,
// not a second implementation of the same rule.
const BLACK = 0;

function isLegalCandidate(board, row, col, player, renjuEnabled) {
  if (!renjuEnabled || player !== BLACK) return true;
  return !checkForbiddenForBlack(board, row, col).forbidden;
}

export const DEFAULT_DEPTH = 4;
// Deliberately well under the 500ms-in-a-browser target (CLAUDE.md
// milestone 4-2), not just barely under it — test/benchmark-ai.mjs's
// numbers are measured in Node, which tends to run faster than mobile
// browser JS engines (older/budget phones especially, and this project's
// hard constraint explicitly covers mobile — CLAUDE.md section 2), so a
// margin is deliberately built in rather than tuning right up to the line.
export const DEFAULT_TIME_LIMIT_MS = 350;
// Branching-factor cap per node (see orderMoves()'s own comment) — tuned
// against test/benchmark-ai.mjs's measurements, not guessed. Without
// this, a mid-game position with a wide scattered candidate set (~44
// candidates measured on one real fixture) took SECONDS at depth 4, not
// milliseconds.
export const DEFAULT_MAX_BRANCHING = 12;
const CANDIDATE_RADIUS = 2;

function otherPlayer(player) {
  return player === 0 ? 1 : 0;
}

function encode(row, col, size) {
  return row * size + col;
}

function decode(index, size) {
  return [Math.floor(index / size), index % size];
}

/**
 * Builds the initial candidate set: every empty cell within Chebyshev
 * distance CANDIDATE_RADIUS of some occupied cell, or just the center
 * point if the board is empty.
 * @param {(0|1|null)[][]} board
 * @returns {Set<number>} encoded (row*size+col) indices
 */
function buildCandidateSet(board) {
  const size = board.length;
  const set = new Set();
  let hasStone = false;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === null) continue;
      hasStone = true;
      for (let dr = -CANDIDATE_RADIUS; dr <= CANDIDATE_RADIUS; dr++) {
        for (let dc = -CANDIDATE_RADIUS; dc <= CANDIDATE_RADIUS; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          if (board[nr][nc] !== null) continue;
          set.add(encode(nr, nc, size));
        }
      }
    }
  }
  if (!hasStone) {
    const center = Math.floor(size / 2);
    set.add(encode(center, center, size));
  }
  return set;
}

/**
 * @param {(0|1|null)[][]} board
 * @returns {[number, number][]} candidate cells as [row, col] pairs —
 *   exported mainly for tests; the search itself works with the raw Set.
 */
export function generateCandidates(board) {
  const size = board.length;
  return [...buildCandidateSet(board)].map((idx) => decode(idx, size));
}

/**
 * Plays `player` at (row, col), incrementally updates `candidateSet` in
 * place, and returns a function that undoes BOTH the board mutation and
 * the candidate-set mutation exactly. This is the one piece of shared
 * state every recursive call mutates and restores, matching the "mutate
 * the shared object, undo after" pattern already used throughout this
 * project's game logic and tests.
 */
function applyMove(board, candidateSet, row, col, player) {
  const size = board.length;
  board[row][col] = player;

  const selfIndex = encode(row, col, size);
  const hadSelf = candidateSet.delete(selfIndex);
  const added = [];
  for (let dr = -CANDIDATE_RADIUS; dr <= CANDIDATE_RADIUS; dr++) {
    for (let dc = -CANDIDATE_RADIUS; dc <= CANDIDATE_RADIUS; dc++) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      if (board[nr][nc] !== null) continue;
      const idx = encode(nr, nc, size);
      if (!candidateSet.has(idx)) {
        candidateSet.add(idx);
        added.push(idx);
      }
    }
  }

  return function undo() {
    for (const idx of added) candidateSet.delete(idx);
    if (hadSelf) candidateSet.add(selfIndex);
    board[row][col] = null;
  };
}

/**
 * Scores every candidate by hypothetically playing `player` there and
 * calling evaluate(), then sorts best-first and keeps only the top
 * `limit`. Move ordering is what makes alpha-beta pruning actually
 * effective — a search that happens to try the best move first prunes
 * far more of the tree than one that finds it last — but ordering alone
 * wasn't enough to hit the 500ms budget on a realistic mid-game
 * candidate set (measured: ~44 Chebyshev-radius-2 candidates, depth 4,
 * took multiple SECONDS — see CLAUDE.md's milestone 4-2 notes). Capping
 * the branching factor to the best `limit` candidates at every node is
 * the standard fix (real engines call this move-count reduction/beam
 * search): a candidate that doesn't even look decent by a 1-ply static
 * eval is exceedingly unlikely to be the search's actual best move, so
 * dropping the tail buys a large speedup for a small, measured accuracy
 * cost rather than an unbounded one.
 * @param {(0|1|null)[][]} board
 * @param {Set<number>} candidateSet
 * @param {0|1} player
 * @param {number} limit
 * @returns {[number, number][]}
 */
function orderMoves(board, candidateSet, player, limit, renjuEnabled = false) {
  const size = board.length;
  const scored = [];
  for (const idx of candidateSet) {
    const [r, c] = decode(idx, size);
    if (!isLegalCandidate(board, r, c, player, renjuEnabled)) continue;
    board[r][c] = player;
    const score = evaluate(board, player);
    board[r][c] = null;
    scored.push({ r, c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > limit) scored.length = limit;
  return scored.map(({ r, c }) => [r, c]);
}

/**
 * Checks every LEGAL candidate for an immediate win for `player` — the
 * pre-search fast path (see file header). Returns the FIRST winning
 * move found (candidate order is otherwise irrelevant here: any winning
 * move is equally final).
 *
 * Renju bugfix (this file's own header has the full account): filtered
 * through isLegalCandidate() — this file's own existing helper, itself
 * built directly on renju.js's checkForbiddenForBlack(), not a new rule
 * reimplemented here — before ever asking checkWin() about a candidate.
 * checkWin() is freestyle-only: it calls ANY run of 5-OR-MORE a win,
 * with no concept of "overline" at all, so it cannot by itself
 * distinguish a genuine (renju-exempt) exact five from a 6-or-more
 * overline that only LOOKS like a win to freestyle rules but is actually
 * forbidden for Black. isLegalCandidate() already no-ops to `true`
 * whenever `renjuEnabled` is false or `player` isn't Black, so this
 * costs nothing and changes nothing outside that one specific
 * (renjuEnabled, player===Black) combination.
 * @param {(0|1|null)[][]} board
 * @param {0|1} player
 * @param {[number, number][]} candidates
 * @param {boolean} [renjuEnabled]
 * @returns {[number, number]|null}
 */
function findImmediateWin(board, player, candidates, renjuEnabled = false) {
  for (const [r, c] of candidates) {
    if (!isLegalCandidate(board, r, c, player, renjuEnabled)) continue;
    board[r][c] = player;
    const win = checkWin(board, r, c, player);
    board[r][c] = null;
    if (win) return [r, c];
  }
  return null;
}

/**
 * The block counterpart of findImmediateWin(): every point where
 * `opponent` would win-in-1 (legal-filtered for the OPPONENT, same
 * overline reasoning as above), ranked by evaluate() for `player` and
 * filtered by whether `player` may legally play there. Two separate
 * legality questions, deliberately: a point White could win at may be
 * a forbidden point for Black (overline/3-3/4-4 — e.g. a White four
 * whose blocking cell sits in the middle of a Black column), and the
 * old "play whatever findImmediateWin(opponent) returned" shortcut made
 * Black place exactly that stone. main.js's commitMove() does NO renju
 * check of its own, so the forbidden stone landed on the real board —
 * and a forbidden overline was then even declared a Black WIN by the
 * freestyle checkWin(). Same shape as game/hint.js's own rung 2.
 * @returns {[number, number]|null} null when the opponent has no
 *   immediate win, OR every block is forbidden for `player` (the caller
 *   falls through to normal search — there is no legal way to stop it).
 */
function findBestLegalBlock(board, player, opponent, candidates, renjuEnabled = false) {
  let best = null;
  let bestScore = -Infinity;
  for (const [r, c] of candidates) {
    if (!isLegalCandidate(board, r, c, opponent, renjuEnabled)) continue;
    board[r][c] = opponent;
    const threat = checkWin(board, r, c, opponent) !== null;
    board[r][c] = null;
    if (!threat) continue;
    if (!isLegalCandidate(board, r, c, player, renjuEnabled)) continue;
    board[r][c] = player;
    const score = evaluate(board, player);
    board[r][c] = null;
    if (score > bestScore) {
      bestScore = score;
      best = [r, c];
    }
  }
  return best;
}

/**
 * Negamax with alpha-beta pruning. Scored from `player`'s perspective at
 * every node (evaluate()'s own convention), negated one level per ply —
 * the single-evaluation-function form of minimax. See the file header
 * for the ply-adjusted win score and the timeout/undo bookkeeping.
 * @param {(0|1|null)[][]} board
 * @param {Set<number>} candidateSet
 * @param {number} depthRemaining
 * @param {number} plyFromRoot
 * @param {number} alpha
 * @param {number} beta
 * @param {0|1} player
 * @param {number} deadline - Date.now()-comparable timestamp
 * @param {number} branchingLimit
 * @returns {{score: number, move: [number, number]|null, timedOut: boolean}}
 */
function negamax(board, candidateSet, depthRemaining, plyFromRoot, alpha, beta, player, deadline, branchingLimit, renjuEnabled = false) {
  if (Date.now() > deadline) {
    return { score: evaluate(board, player), move: null, timedOut: true };
  }
  if (depthRemaining === 0 || candidateSet.size === 0) {
    return { score: evaluate(board, player), move: null, timedOut: false };
  }

  const opponent = otherPlayer(player);
  const ordered = orderMoves(board, candidateSet, player, branchingLimit, renjuEnabled);
  if (ordered.length === 0) {
    // Black has candidate CELLS left, but every one is renju-forbidden —
    // an astronomically rare "no legal move" position (see
    // findBestMove()'s own note on this same edge case). Nothing to
    // recurse into from here; report this node as a dead end rather than
    // returning a nonsensical null move from an empty `ordered[0]`.
    return { score: evaluate(board, player), move: null, timedOut: false };
  }
  let bestScore = -Infinity;
  let bestMove = ordered[0] ?? null;
  let timedOut = false;

  for (const [r, c] of ordered) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }

    const undo = applyMove(board, candidateSet, r, c, player);
    let score;
    // No isLegalCandidate() check needed here, unlike the two checkWin()
    // sites this same follow-up pass had to fix (findImmediateWin(),
    // scoreCandidateMoves()) — `[r, c]` came from `ordered`, which is
    // orderMoves()'s own output just above, and orderMoves() ALREADY
    // filters through isLegalCandidate() before a candidate can appear
    // in it at all. A candidate that's illegal for Black here was never
    // offered to this loop to begin with, so checkWin() can only ever
    // be asked about a point that's already confirmed legal.
    if (checkWin(board, r, c, player)) {
      // A faster win always outscores a slower one — see file header.
      score = PATTERN_SCORES.five - (plyFromRoot + 1);
    } else {
      const child = negamax(board, candidateSet, depthRemaining - 1, plyFromRoot + 1, -beta, -alpha, opponent, deadline, branchingLimit, renjuEnabled);
      score = -child.score;
      if (child.timedOut) timedOut = true;
    }
    undo();

    if (score > bestScore) {
      bestScore = score;
      bestMove = [r, c];
    }
    if (bestScore > alpha) alpha = bestScore;
    if (alpha >= beta) break; // alpha-beta cutoff
    if (timedOut) break;
  }

  return { score: bestScore, move: bestMove, timedOut };
}

/**
 * Scores specific candidate moves at a given search depth — how good
 * `player` playing (row, col) is, per a depth-ply negamax search from
 * the resulting position. Exported for analysis/tests: `findBestMove()`
 * only ever surfaces its single best move, but confirming search depth
 * actually changes a decision (rather than just producing A different
 * move) means comparing what two different depths think of the SAME
 * candidates directly (see test/ai.test.js's depth-comparison test).
 * @param {(0|1|null)[][]} board
 * @param {0|1} player
 * @param {[number, number][]} moves
 * @param {number} depth
 * @param {number} [timeLimitMs]
 * @param {number} [maxBranching]
 * @param {boolean} [renjuEnabled] - milestone 9; see this file's own header note
 * @returns {{move: [number, number], score: number}[]} same order as `moves`
 */
export function scoreCandidateMoves(
  board,
  player,
  moves,
  depth,
  timeLimitMs = DEFAULT_TIME_LIMIT_MS,
  maxBranching = DEFAULT_MAX_BRANCHING,
  renjuEnabled = false
) {
  const deadline = Date.now() + timeLimitMs;
  const candidateSet = buildCandidateSet(board);
  const opponent = otherPlayer(player);
  return moves.map(([r, c]) => {
    // Renju bugfix, same reasoning as findImmediateWin() above: this
    // function's own `moves` list is caller-supplied, and while both of
    // ITS current internal callers (orderMoves()'s own output in
    // chooseMove(), and game/hint.js's own pre-filtered candidate list)
    // already only pass legal moves in practice, this function has no
    // way to know that about a list handed to it from outside — checking
    // isLegalCandidate() here directly, rather than trusting every
    // present and future caller to have filtered first, is what makes
    // this genuinely safe by construction rather than safe by
    // convention. Checked BEFORE applyMove() places the stone, not
    // after — checkForbiddenForBlack() (which this is built on) treats
    // an already-occupied cell as "not a real placement question" and
    // trivially returns not-forbidden, so checking after placement would
    // silently defeat this filter (an actual mistake this pass's own
    // regression test caught — see game/ai.js's own CLAUDE.md milestone
    // for the account: the first version of this fix checked AFTER
    // applyMove() and the new test still failed).
    const legal = isLegalCandidate(board, r, c, player, renjuEnabled);
    const undo = applyMove(board, candidateSet, r, c, player);
    let score;
    // A move that's illegal here still gets scored normally below
    // (depth<=1 eval / recursive search) instead of the win shortcut —
    // it just can't claim credit for a win it can't legally complete.
    if (legal && checkWin(board, r, c, player)) {
      score = PATTERN_SCORES.five - 1;
    } else if (depth <= 1) {
      score = evaluate(board, player);
    } else {
      score = -negamax(board, candidateSet, depth - 1, 1, -Infinity, Infinity, opponent, deadline, maxBranching, renjuEnabled).score;
    }
    undo();
    return { move: [r, c], score };
  });
}

/**
 * Picks a move for `player` on `board`. Never mutates `board` — every
 * temporary placement made while searching is undone before returning.
 * @param {(0|1|null)[][]} board
 * @param {0|1} player
 * @param {{maxDepth?: number, timeLimitMs?: number, maxBranching?: number, renjuEnabled?: boolean}} [options]
 *   `renjuEnabled` — milestone 9; see this file's own header note.
 * @returns {[number, number]|null} null only if the board is already full,
 *   or (renjuEnabled, player===Black, astronomically rare) Black has no
 *   legal move left at all
 */
export function findBestMove(board, player, options = {}) {
  return findBestMoveWithStats(board, player, options).move;
}

/**
 * Same search as findBestMove(), plus diagnostics: how deep iterative
 * deepening actually got before the time budget ran out, and whether a
 * fast path (immediate win/block) or the depth-1..maxDepth loop produced
 * the answer. Exported for exactly the same reason scoreCandidateMoves()
 * is (analysis/tests) — added specifically to investigate a user-reported
 * anomaly (Hard vs Hard producing a near-0% first-move win rate, the
 * opposite of Gomoku's known first-move advantage): whether reached
 * search depth differs systematically between the two colors. See
 * CLAUDE.md milestone 9's follow-up section for what this found.
 * @param {(0|1|null)[][]} board
 * @param {0|1} player
 * @param {{maxDepth?: number, timeLimitMs?: number, maxBranching?: number, renjuEnabled?: boolean}} [options]
 * @returns {{move: [number, number]|null, depthReached: number, fastPath: 'win'|'block'|null}}
 *   `depthReached` is 0 if a fast path answered, or if depth 1 itself
 *   never completed within the budget.
 */
export function findBestMoveWithStats(board, player, options = {}) {
  const { maxDepth = DEFAULT_DEPTH, timeLimitMs = DEFAULT_TIME_LIMIT_MS, maxBranching = DEFAULT_MAX_BRANCHING, renjuEnabled = false } = options;
  const deadline = Date.now() + timeLimitMs;

  const candidateSet = buildCandidateSet(board);
  if (candidateSet.size === 0) return { move: null, depthReached: 0, fastPath: null }; // board is full
  const allCandidates = [...candidateSet].map((idx) => decode(idx, board.length));

  const opponent = otherPlayer(player);

  // Renju bugfix (this file's own header): win detection used to scan the
  // UNFILTERED candidate list on the (wrong) assumption that "completes
  // an exact five" and "checkWin() returns true" were the same question
  // — they aren't. checkWin() is freestyle-only and calls ANY run of 5+
  // a win; Renju's own exemption only covers a run of EXACTLY 5, and a
  // move that bridges a gap into 6-or-more in one placement satisfies
  // checkWin() just as readily as a real five does, while actually being
  // a forbidden overline for Black. findImmediateWin() now filters
  // through isLegalCandidate() itself (game/renju.js's own
  // checkForbiddenForBlack(), not a rule reimplemented here) — both
  // calls below thread `renjuEnabled` through so this applies to
  // whichever of the two candidates is actually Black (myWin when
  // `player` is Black, opponentWin when `opponent` is; White is never
  // filtered, matching this file's own "White has no restrictions at
  // all" rule everywhere else).
  const myWin = findImmediateWin(board, player, allCandidates, renjuEnabled);
  if (myWin) return { move: myWin, depthReached: 0, fastPath: "win" };
  // Must block — but only at a point `player` may legally occupy; see
  // findBestLegalBlock() for why the opponent's win point isn't
  // automatically one of those. No legal block → normal search below.
  const block = findBestLegalBlock(board, player, opponent, allCandidates, renjuEnabled);
  if (block) return { move: block, depthReached: 0, fastPath: "block" };

  const legalCandidates =
    renjuEnabled && player === BLACK ? allCandidates.filter(([r, c]) => isLegalCandidate(board, r, c, player, true)) : allCandidates;
  if (legalCandidates.length === 0) return { move: null, depthReached: 0, fastPath: null }; // no legal move at all — see game/renju.js's own notes on how rare this is
  if (legalCandidates.length === 1) return { move: legalCandidates[0], depthReached: 0, fastPath: null };

  let bestMove = legalCandidates[0];
  let depthReached = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    if (Date.now() >= deadline) break;
    const result = negamax(board, candidateSet, depth, 0, -Infinity, Infinity, player, deadline, maxBranching, renjuEnabled);
    if (result.timedOut) break; // discard this depth's incomplete result, keep the previous depth's
    if (result.move) bestMove = result.move;
    depthReached = depth;
  }
  return { move: bestMove, depthReached, fastPath: null };
}

// --- difficulty tiers (milestone 4-3, non-determinism redesign in a ------
// --- later pass — see CLAUDE.md's own milestone for the full account) ----
//
// chooseMove(board, player, difficulty, rng) picks a move calibrated to
// one of 3 tiers. The design principle behind all three (per CLAUDE.md's
// milestone 4-3 notes, not just "vary the search depth"): search depth
// alone makes a bad difficulty knob, because even depth 1 already plays
// the two moves that matter most to a beginner (take a free win, block
// an obvious loss) — depth alone can't produce a weak-but-not-broken
// opponent. What actually reads as "beginner" to a human is occasionally
// making a plausible-but-not-best move, not a shallower search per se.
//
// Every tier shares ONE hard rule, with no exception: a move that wins
// immediately is ALWAYS played. An engine that sometimes declines a free
// win doesn't look "easy," it looks broken — the game would just never
// end. This is checked directly against candidates (not left to depth-
// limited search, which might not even reach the ply where the win
// shows up) exactly like findBestMove()'s own pre-search fast path.
//
// EASY keeps its original milestone-4-3 mechanism completely unchanged
// (maxDepth 1, mistakeProbability 0.3, rank-weighted mistake pool among
// the top MISTAKE_POOL_SIZE candidates via weightedRandomChoice()) —
// deliberately NOT given the new "never randomize" floor below, since
// Easy's whole point is a real, TESTED chance of missing even an
// opponent's immediate winning move (CLAUDE.md milestone 4-3's own "Easy:
// 83/100 시드에서만 차단" — that's Easy being Easy, not a bug).
//
// MEDIUM and HARD share a NEW mechanism instead of their old one (Medium
// used to share Easy's rank-weighted mistake pool at a lower probability;
// Hard used to delegate straight to findBestMove() with zero randomness
// ever, which let a determined player memorize its exact response to any
// fixed position). The problem this solves: Hard using NO rng meant the
// SAME board always produced the SAME reply — genuinely exploitable, not
// just "hard to beat." The fix is a "never randomize the moves that
// matter, vary the ones that don't" floor, in the SAME priority order
// game/hint.js's own suggestion ladder already established (a separate
// module, not reused here — this pass is scoped to ai.js only, so this
// mirrors that ladder's LOGIC using ai.js's own existing primitives
// rather than importing it):
//   1. my own immediate win — findImmediateWin(), unconditional, a plain
//      fact (checkWin()) — always the literal move it finds
//   2. block the opponent's immediate win — findBestLegalBlock(), same
//      fact, at whichever legal block point evaluates best for me
//   3. a move that would hand ME a brand-new open four is AVAILABLE
//   4. a move that would genuinely block the opponent's developing open
//      three (reduces their own openThree count) is available
// Rungs 3/4 are GATES, not forced picks (an earlier version of this
// function forced the greedy 1-ply candidate directly — measured against
// the real depth search on real self-play positions, that disagreed with
// it a large fraction of the time and measurably weakened Hard; see
// chooseMove()'s own comment for the numbers and the fix): when either
// kind of opportunity exists, randomization is skipped and the full
// search's own single best move is played instead — still never left to
// chance, but never a shallow override of the search's own better
// judgment either. Only once NONE of the four rungs apply (a genuinely
// "quiet" position) does the near-top-score weighted-random pick
// (weightedRandomByScore(), below) get a say — candidates are ranked by
// their own 1-ply evaluate() score (rankByOnePlyEval() — zero wall-clock
// dependency, see chooseMove()'s own comment for why NOT a per-candidate
// re-search), and the pick is drawn from whichever land within
// `randomThreshold` of the search's own best score. Hard's own 0.97 vs
// Medium's 0.92 is deliberately narrow for Hard — the goal is
// "not memorizable," not "weaker": see this pass's own CLAUDE.md section
// for the tournament-ai.mjs numbers this was checked against before/after.
//
// A "mistake"/random pick is NEVER a uniformly random cell on the board —
// that reads as obviously broken even to a beginner (CLAUDE.md's own
// note: "완전 랜덤은 초보에게도 이상하게 보인다"). Easy's own pool is
// weighted by RANK (best gets the most weight); the new near-top-score
// pool is weighted by closeness to the top SCORE instead (see
// weightedRandomByScore()'s own comment for why raw score can't be used
// as a weight directly).
//
// `rng` defaults to Math.random but is always the last parameter and
// always injectable, matching core/turn.js's pickStartingPlayer(count,
// rng) convention already established in this codebase — deterministic
// replay from a fixed seed matters for tests and (per CLAUDE.md's
// explicit note) preview-video/screenshot capture, exactly as it did for
// the previous project in this series. main.js's own runAiTurn() already
// calls chooseMove(..., Math.random, ...) — real, un-seeded randomness on
// every call, including in Daily Challenge — so this pass needed no
// changes there: the SAME injection point already existed.

export const DIFFICULTIES = {
  // "Relaxed" in the UI. Retuned for this site's audience — a first-time
  // player who has never played a five-in-a-row game before. The original
  // {mistakeProbability: 0.3} left a modelled beginner (takes an
  // immediate win, blocks an immediate loss, otherwise plays beside its
  // own last stone) winning only 9% of games on 9x9 — a losing streak
  // that long is the single biggest reason this audience quits.
  //
  // Raising mistakeProbability ALONE barely helped (28% even at 0.8),
  // because the "mistake" was still drawn from only the top 5 of 15
  // scored moves — i.e. still a good move. The pool width is the real
  // lever: widening both the scored set (preFilterSize) and the pool
  // drawn from it (mistakePoolSize) to 24 and raising the probability to
  // 0.85 lands at 56.7% over 240 measured games (3 independent seeds).
  // Slightly above even is deliberate: the modelled beginner ALWAYS
  // blocks an immediate loss, which a real first-timer frequently
  // misses, so it is a stronger opponent than the person this is for.
  easy: {
    maxDepth: 1,
    timeLimitMs: 100,
    maxBranching: DEFAULT_MAX_BRANCHING,
    mistakeProbability: 0.85,
    mistakePoolSize: 24,
    preFilterSize: 24,
  },
  medium: { maxDepth: 2, timeLimitMs: 150, maxBranching: DEFAULT_MAX_BRANCHING, randomThreshold: 0.92, randomApplyProbability: 0.35 },
  hard: { maxDepth: DEFAULT_DEPTH, timeLimitMs: DEFAULT_TIME_LIMIT_MS, maxBranching: DEFAULT_MAX_BRANCHING, randomThreshold: 0.97, randomApplyProbability: 0.15 },
};

// How many of the top-ranked candidates Easy's own mistake draw is
// allowed to land on — small enough that every option in the pool still
// looks like a plausible human move, per CLAUDE.md's own framing of what
// makes a mistake read as natural rather than random.
const MISTAKE_POOL_SIZE = 5;
// Medium/hard's own equivalent cap on the near-top-score pool (see
// chooseMove()'s own "quiet position" branch) — added after measuring a
// real gap the pure percentage tolerance can't close on its own: a
// symmetric-ish early-game position can have its ENTIRE candidate set
// tied at a 1-ply score of exactly 0 (nothing has developed a pattern
// yet), which makes `tolerance = (1-threshold)*|topScore|` also exactly
// 0 — correctly admitting only the true ties, not "too wide" by the
// tolerance math itself — but a same-score tie can still span dozens of
// candidates 1-ply eval genuinely can't tell apart, even though the deep
// search likely still has a real preference among them for reasons a
// single ply can't see. Capping the pool the same way Easy's own
// MISTAKE_POOL_SIZE already does keeps that scenario from injecting more
// variety than "matches a slightly different opponent" calls for, without
// touching the tolerance filter itself (which still correctly narrows a
// pool with genuine score differentiation).
const RANDOM_POOL_CAP = 5;
// How many candidates get fully scored at all, for either Easy's own
// mistake pool or medium/hard's own near-top-score pool. Unlike Hard's
// per-node maxBranching (which bounds branching at EVERY depth of a
// multi-ply search), this bounds the ROOT candidate list itself before
// any scoring.
const PRE_FILTER_SIZE = 15;

/**
 * Weighted-random pick from `rankedMoves` (best-first). Weight is linear
 * in rank: the first item gets weight N, the last gets weight 1. Easy's
 * own mechanism only — see weightedRandomByScore() below for medium/hard's
 * own pool, which is NOT rank-weighted.
 * @param {[number, number][]} rankedMoves
 * @param {() => number} rng
 * @returns {[number, number]}
 */
function weightedRandomChoice(rankedMoves, rng) {
  const n = rankedMoves.length;
  if (n === 1) return rankedMoves[0];
  const weights = rankedMoves.map((_, i) => n - i);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < n; i++) {
    roll -= weights[i];
    if (roll <= 0) return rankedMoves[i];
  }
  return rankedMoves[n - 1]; // floating-point fallback, should be unreachable
}

/**
 * Medium/hard's own near-top-score weighted-random pick — every entry in
 * `pool` is already known to be within `tolerance` of `topScore` (the
 * caller's own filter, see chooseMove()'s own "quiet position" branch).
 * Weight is proportional to CLOSENESS to the top score (`tolerance -
 * (topScore - score)`), not the raw score itself — a real quiet
 * position's own evaluate() scores can be small, zero, or negative
 * (openTwo tier is 1, a slightly-behind position can score negative), so
 * "weight = score" would need ad-hoc sign-shifting to stay a valid
 * (positive) weight; weighting by distance-from-the-top instead achieves
 * the same "closer to best = more likely" spirit called for
 * ("가중치는 점수 비례") while staying strictly positive by construction,
 * for any sign of topScore. A tiny epsilon keeps even the
 * furthest-from-top entry in the pool (right at the tolerance boundary)
 * at a small but nonzero weight, rather than exactly 0.
 * @param {{move: [number, number], score: number}[]} pool
 * @param {number} topScore
 * @param {number} tolerance
 * @param {() => number} rng
 * @returns {[number, number]}
 */
function weightedRandomByScore(pool, topScore, tolerance, rng) {
  const n = pool.length;
  if (n === 1) return pool[0].move;
  const EPSILON = 1e-6;
  const weights = pool.map((entry) => tolerance - (topScore - entry.score) + EPSILON);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < n; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i].move;
  }
  return pool[n - 1].move; // floating-point fallback, should be unreachable
}

/**
 * Rung 3 of the "never randomize" floor (see the file's own difficulty-
 * tier comment above): does any candidate hand `player` a brand-new open
 * four? Checked directly (place, countPatterns(), undo — evaluate.js's
 * own existing tool, unmodified) rather than left to the depth search's
 * own ranking, matching game/hint.js's own reasoning for its equivalent
 * rung: an immediate, concrete tactical gain like this shouldn't be left
 * to chance even in the new "vary quiet positions" mechanism. Ties (more
 * than one candidate creates an open four) broken by evaluate() score,
 * same as every other multi-candidate rung in this file.
 * @param {(0|1|null)[][]} board
 * @param {0|1} player
 * @param {[number, number][]} candidates - already renju-filtered
 * @returns {[number, number]|null}
 */
function findOpenFourMove(board, player, candidates) {
  let best = null;
  let bestScore = -Infinity;
  for (const [r, c] of candidates) {
    board[r][c] = player;
    const createsOpenFour = countPatterns(board, player).openFour > 0;
    const score = createsOpenFour ? evaluate(board, player) : null;
    board[r][c] = null;
    if (createsOpenFour && score > bestScore) {
      bestScore = score;
      best = [r, c];
    }
  }
  return best;
}

/**
 * Rung 4: does any candidate genuinely reduce the OPPONENT's own
 * openThree count — a real before/after diff, not merely "is this cell
 * near their three" — proving the placement actually interferes with a
 * developing pattern rather than just sitting close to one (same
 * before/after-diff idea game/achievements.js's own live-pattern
 * tracking and game/hint.js's own block-three rung both already use).
 * Ties broken by evaluate() score.
 * @param {(0|1|null)[][]} board
 * @param {0|1} player
 * @param {0|1} opponent
 * @param {[number, number][]} candidates - already renju-filtered
 * @returns {[number, number]|null}
 */
function findBlockThreeMove(board, player, opponent, candidates) {
  const before = countPatterns(board, opponent).openThree;
  if (before === 0) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const [r, c] of candidates) {
    board[r][c] = player;
    const after = countPatterns(board, opponent).openThree;
    const blocks = after < before;
    const score = blocks ? evaluate(board, player) : null;
    board[r][c] = null;
    if (blocks && score > bestScore) {
      bestScore = score;
      best = [r, c];
    }
  }
  return best;
}

/**
 * Ranks every legal candidate in `candidateSet` by its own 1-ply
 * evaluate() score, keeping the top `limit` — the identical ranking
 * orderMoves() already computes internally, except THIS keeps each
 * move's own score alongside it instead of discarding it (orderMoves()'s
 * own return type is move-only, used by negamax() at every recursive
 * node where carrying scores around would be wasted allocation — not
 * worth changing that widely-used internal contract just for this one
 * caller). Used by chooseMove()'s own "quiet position" branch below —
 * see that branch's own comment for why 1-ply eval, not a deeper
 * re-search, is what near-top alternatives are compared by.
 * @param {(0|1|null)[][]} board
 * @param {Set<number>} candidateSet
 * @param {0|1} player
 * @param {number} limit
 * @param {boolean} renjuEnabled
 * @returns {{move: [number, number], score: number}[]} best-first
 */
function rankByOnePlyEval(board, candidateSet, player, limit, renjuEnabled) {
  const size = board.length;
  const scored = [];
  for (const idx of candidateSet) {
    const [r, c] = decode(idx, size);
    if (!isLegalCandidate(board, r, c, player, renjuEnabled)) continue;
    board[r][c] = player;
    const score = evaluate(board, player);
    board[r][c] = null;
    scored.push({ move: [r, c], score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > limit) scored.length = limit;
  return scored;
}

/**
 * Picks a move for `player` on `board`, calibrated to `difficulty`. Never
 * mutates `board`. See the file's difficulty-tier comment block above for
 * the full design.
 * @param {(0|1|null)[][]} board
 * @param {0|1} player
 * @param {'easy'|'medium'|'hard'} difficulty
 * @param {() => number} [rng] - returns a value in [0, 1); defaults to
 *   Math.random, injectable for deterministic replay (matches core/
 *   turn.js's pickStartingPlayer(count, rng) convention)
 * @param {boolean} [renjuEnabled] - milestone 9; see game/ai.js's own
 *   header note on how this threads through every tier
 * @returns {[number, number]|null} null only if the board is already
 *   full, or (renjuEnabled, player===Black, astronomically rare) Black
 *   has no legal move left at all
 */
export function chooseMove(board, player, difficulty, rng = Math.random, renjuEnabled = false) {
  const config = DIFFICULTIES[difficulty];
  if (!config) throw new Error(`unknown difficulty: "${difficulty}" (expected easy, medium, or hard)`);

  const candidateSet = buildCandidateSet(board);
  if (candidateSet.size === 0) return null; // board is full
  const allCandidates = [...candidateSet].map((idx) => decode(idx, board.length));

  // Rung 1 — never skipped, at any difficulty (see file header) — renju-
  // filtered the same way findBestMoveWithStats() now is (see this
  // file's own header and findImmediateWin()'s own comment for the
  // overline-vs-win bugfix this used to be missing).
  const myWin = findImmediateWin(board, player, allCandidates, renjuEnabled);
  if (myWin) return myWin;

  const candidates =
    renjuEnabled && player === BLACK ? allCandidates.filter(([r, c]) => isLegalCandidate(board, r, c, player, true)) : allCandidates;
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  if (difficulty === "easy") {
    // Easy's own mechanism, byte-for-byte unchanged by this pass — see
    // the file's own header for why it's exempt from the new floor.
    const pool = orderMoves(board, candidateSet, player, config.preFilterSize ?? PRE_FILTER_SIZE, renjuEnabled);
    const scored = scoreCandidateMoves(board, player, pool, config.maxDepth, config.timeLimitMs, config.maxBranching, renjuEnabled);
    scored.sort((a, b) => b.score - a.score);
    if (rng() >= config.mistakeProbability) return scored[0].move;
    // Pool size is per-difficulty now, not the fixed MISTAKE_POOL_SIZE it
    // used to be. Measured reason: raising `mistakeProbability` alone
    // barely moved the outcome, because a "mistake" drawn from only the
    // top 5 scored moves is still a strong move — a modelled beginner
    // (takes an immediate win, blocks an immediate loss, otherwise plays
    // beside its own last stone) won just 9% of 80 games at 0.3 and only
    // 28% even at 0.8. Widening the pool is what actually converts a
    // mistake into a real one; see DIFFICULTIES.easy's own comment for
    // the tuned values and the resulting win rate.
    const poolSize = config.mistakePoolSize ?? MISTAKE_POOL_SIZE;
    const mistakePool = scored.slice(0, poolSize).map((s) => s.move);
    return weightedRandomChoice(mistakePool, rng);
  }

  // Medium/hard — rungs 2-4 of the "never randomize" floor, always
  // checked before any randomization enters the picture (see file header).
  const opponent = otherPlayer(player);
  // Rung 2: a plain fact (checkWin()), no search needed to confirm it —
  // but the block must be a point `player` may legally play (see
  // findBestLegalBlock()); if none is, the search below decides.
  const block = findBestLegalBlock(board, player, opponent, allCandidates, renjuEnabled);
  if (block) return block;

  // Rungs 3/4 as originally implemented (an EARLIER version of this
  // function) picked whichever candidate their OWN 1-ply heuristic liked
  // best and played THAT directly — measured against the real depth
  // search on real self-play positions (not assumed), that disagreed
  // with findBestMoveWithStats()'s own pick 8/10 times for rung 3 and
  // 11/28 times for rung 4: a 1-ply "does this immediately create/block
  // a pattern" check has no way to see that the opponent has a faster
  // reply, or that some OTHER move addresses this same tactical need
  // more efficiently while ALSO doing something else useful — exactly
  // the kind of multi-ply reasoning the full search exists for. Forcing
  // the greedy pick anyway measurably weakened Hard (tournament-ai.mjs:
  // see this pass's own CLAUDE.md section for the before/after numbers)
  // — directly against the user's own explicit "Hard가 약해지면 안 됨."
  //
  // Fixed by using these two rungs as a GATE on randomization instead of
  // a forced move: if either kind of opportunity exists at all, skip the
  // near-top-score randomization entirely and defer to the full search's
  // own single best move (below) — still "그 수를 그대로 둘 것" in
  // spirit (this decisive a moment is never left to chance), but the
  // ACTUAL move played is whatever the search proves is truly best, not
  // a shallow stand-in for it.
  const hasOpenFourOpportunity = findOpenFourMove(board, player, candidates) !== null;
  const hasBlockThreeOpportunity = !hasOpenFourOpportunity && findBlockThreeMove(board, player, opponent, candidates) !== null;

  const stats = findBestMoveWithStats(board, player, {
    maxDepth: config.maxDepth,
    timeLimitMs: config.timeLimitMs,
    maxBranching: config.maxBranching,
    renjuEnabled,
  });
  const topMove = stats.move;

  // Follow-up bugfix (a later investigation — see this file's own
  // CLAUDE.md section for the full account, including how it was
  // reproduced and confirmed to PRE-DATE this pass entirely, via a
  // git-history comparison against the pre-PASS-B engine): the pure
  // "gate, then trust the search's own topMove unconditionally" design
  // above has a real, confirmed blind spot, distinct from the 8/10 and
  // 11/28 disagreement rates that motivated NOT forcing the greedy pick
  // in the first place. evaluate() is a symmetric "my patterns minus
  // your patterns" SNAPSHOT — it has no concept of whose turn comes
  // next. When the opponent has a developing open three and `player`
  // ALSO happens to have material nearby that a move could turn into an
  // equally large pattern of its OWN (e.g. two isolated stones that a
  // single move connects into a three), evaluate() can score "ignore
  // their three and build my own" as a TIE with or even BETTER than
  // "block their three" — the two roughly-equal-sized patterns cancel
  // out in the subtraction — even though the opponent's threat is
  // strictly more advanced (already three, one move from an unstoppable
  // open four) and will resolve into their own win before `player`'s
  // brand-new mirror threat ever could. Traced by hand on a real
  // fixture: the search's own topMove scored EXACTLY 0 at the position's
  // actual reached depth (an apparent tie with blocking), while manually
  // playing out the "ignore and mirror" line to its actual conclusion
  // showed it walks straight into a lost game — a genuine horizon
  // artifact of finite-depth search, not a legitimate strategic
  // preference. A 12/12-genuine-failure-rate stress test across
  // realistic scattered mid-game positions (this file's own CLAUDE.md
  // section has the numbers) confirmed this isn't a rare corner case.
  //
  // Fixed with a narrow, EVIDENCE-BASED asymmetry, not a blanket
  // "always force" reversal (that would just re-trigger the 8/10 rung-3
  // regression this pass's own gate redesign was built to avoid): only
  // rung 4 (block the opponent's developing three) gets a verify-and-
  // fallback safety net, because only rung 4 has a CONFIRMED blind-spot
  // instance — rung 3's own measured disagreement (8/10) was the search
  // finding something genuinely BETTER than the greedy open-four pick
  // most of the time, so forcing a fallback there would very likely
  // reintroduce that exact regression instead of fixing anything. If
  // `topMove` doesn't reduce the opponent's own openThree count (the
  // SAME before/after diff findBlockThreeMove() itself already uses to
  // find the block in the first place — not a new rule invented here)
  // and doesn't win outright, the search's pick provably left the
  // detected threat completely unaddressed, and findBlockThreeMove()'s
  // own verified answer is used instead.
  if (hasBlockThreeOpportunity) {
    const opponentThreeBefore = countPatterns(board, opponent).openThree;
    board[topMove[0]][topMove[1]] = player;
    const topMoveWins = checkWin(board, topMove[0], topMove[1], player) !== null;
    const opponentThreeAfter = countPatterns(board, opponent).openThree;
    board[topMove[0]][topMove[1]] = null;
    const topMoveAddressesThreat = topMoveWins || opponentThreeAfter < opponentThreeBefore;
    if (!topMoveAddressesThreat) {
      return findBlockThreeMove(board, player, opponent, candidates);
    }
    return topMove;
  }

  if (hasOpenFourOpportunity) return topMove;

  // A genuinely quiet position: near-top-score weighted-random pick
  // among candidates within `randomThreshold` of the search's own best
  // score — see weightedRandomByScore()'s own comment for the exact
  // weighting shape. Alternatives are ranked by their own 1-ply
  // evaluate() score (rankByOnePlyEval() — the identical ranking
  // orderMoves() already computes internally), not by an independent
  // per-candidate re-search — an EARLIER version of this branch tried
  // exactly that (scoreCandidateMoves() on the whole pool at full
  // search depth) and measured it as too expensive to complete reliably
  // inside the time budget: ~15 independent depth-3 sub-searches
  // routinely blew past 350ms and got silently truncated by the shared
  // deadline mid-list, which made WHICH candidates counted as "near-top"
  // depend on exactly how much wall-clock time had elapsed by the time
  // each one's own sub-search started — the SAME 350ms-timebox non-
  // determinism CLAUDE.md milestone 9 already documents for the raw
  // engine, but freshly reintroduced (and amplified, ~15 chances instead
  // of 1) into the SELECTION step itself, which is supposed to be the
  // one part of this a fixed rng input can reproduce. 1-ply eval has
  // zero timing dependency, so this reads consistently no matter how
  // fast or slow the device is — the depth search still decides what
  // "best" IS (topMove), 1-ply eval only decides which OTHER already-
  // plausible candidates are close enough to occasionally stand in for
  // it. topMove is explicitly folded into the ranked pool even on the
  // rare chance the search's own pick isn't already inside the top
  // PRE_FILTER_SIZE by 1-ply eval — never silently dropped from
  // consideration.
  board[topMove[0]][topMove[1]] = player;
  const topScore = evaluate(board, player);
  board[topMove[0]][topMove[1]] = null;

  const ranked = rankByOnePlyEval(board, candidateSet, player, PRE_FILTER_SIZE, renjuEnabled);
  const pool = ranked.some(({ move }) => move[0] === topMove[0] && move[1] === topMove[1]) ? ranked : [...ranked, { move: topMove, score: topScore }];

  // Real gap found while tracing an actual tournament-ai.mjs loss (not
  // assumed): in the OPENING specifically, 1-ply eval is nearly
  // uninformative (no pattern exists yet for evaluate() to see AT ALL),
  // so a wide same-score tie can include a cell like a literal board
  // corner just as "tied" as a near-center one, even though the deep
  // search clearly prefers the center (more future potential, visible
  // to it via look-ahead in a way a single ply can't be). The traced
  // loss was exactly this: Hard's own early moves wandered to (2,2),
  // (1,1), (0,0) — each still a LEGITIMATE candidate (within
  // CANDIDATE_RADIUS of some existing stone) but a real strategic
  // downgrade from the center-hugging move the search actually wanted.
  // Fixed by additionally requiring a candidate be within
  // CANDIDATE_RADIUS of topMove ITSELF, not merely of any stone already
  // on the board — "close enough to substitute for the actual best
  // move," not "anywhere the broader candidate set happens to reach."
  const spatiallyClose = pool.filter(
    (entry) => Math.max(Math.abs(entry.move[0] - topMove[0]), Math.abs(entry.move[1] - topMove[1])) <= CANDIDATE_RADIUS
  );

  const tolerance = (1 - config.randomThreshold) * Math.abs(topScore);
  // Re-sorted (not just filtered) before capping — `pool` may have
  // topMove appended at the very end rather than in sorted position (see
  // the line above), and topMove must never be the one entry a
  // RANDOM_POOL_CAP slice cuts off; sorting descending by score puts it
  // back at (a tie for) the front, since its own score IS topScore.
  const nearTop = spatiallyClose.filter((entry) => topScore - entry.score <= tolerance).sort((a, b) => b.score - a.score);

  // randomApplyProbability: a second real gap found via large-sample
  // (not small-sample-noisy, see this pass's own CLAUDE.md section for
  // the methodology mistake that first hid this) tournament-ai.mjs
  // measurement — a "quiet" position is the OVERWHELMING majority of a
  // real game's own moves (rungs 1-4 only cover forcing/tactical
  // moments), so ALWAYS drawing a near-top alternative whenever more
  // than one exists compounds across dozens of moves per game. Gomoku is
  // chaotically sensitive to early/mid-game move choices (CLAUDE.md
  // milestone 9's own finding: "한 수만 달라져도 그 뒤 전체 궤적이
  // 갈리는 카오스적 게임"), so that per-move compounding measurably
  // weakened Hard even with the tolerance/spatial/cap filters above all
  // in place — this was the actual missing piece, not the pool
  // filtering itself. This gate makes "occasionally a different move"
  // (the user's own stated goal) literal rather than "every quiet move
  // is a fresh coin flip": most quiet moves still play topMove exactly,
  // and only a `randomApplyProbability` fraction of them ever consult
  // the near-top pool at all.
  if (nearTop.length <= 1 || rng() >= config.randomApplyProbability) return topMove;

  const capped = nearTop.length > RANDOM_POOL_CAP ? nearTop.slice(0, RANDOM_POOL_CAP) : nearTop;
  return weightedRandomByScore(capped, topScore, tolerance, rng);
}
