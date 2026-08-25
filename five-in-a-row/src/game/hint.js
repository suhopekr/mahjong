// game/hint.js
// Hint-quality redesign pass. suggestHint() now walks an explicit
// priority LADDER instead of a single 1-ply evaluate() greedy pick — the
// old approach (still visible in this file's git history) could suggest
// a "solid-looking" developing move while completely missing that the
// opponent had a forced win sitting one move away, because evaluate()'s
// own huge pattern-tier gaps (game/evaluate.js's PATTERN_SCORES) only
// dominate CORRECTLY when every candidate is scored on equal footing —
// a single scalar comparison doesn't distinguish "this is somewhat
// better" from "this is the ONLY thing that matters right now." The
// ladder makes that distinction explicit: each rung is checked in
// strict order, and the first one that finds something wins outright,
// never blended with a lower rung's score.
//
//   1. My own win-in-1                          reason: "win"
//   2. Block the opponent's win-in-1             reason: "block-win"
//   3. Create my own open four (win-in-2, unblockable) reason: "open-four"
//   4. Block the opponent's open three            reason: "block-three"
//   5. Otherwise: a real (deterministic) search    reason: "develop"
//
// Still deliberately NOT game/ai.js's full Hard search (findBestMove at
// DEFAULT_DEPTH/DEFAULT_TIME_LIMIT_MS) for rung 5 — that remains this
// project's opponent-facing engine, and a hint that always played
// exactly as strong as Hard would stop being a "reasonable suggestion"
// and start being "just tell me the best possible move." Rung 5 instead
// calls findBestMove() (NOT chooseMove() — see that function's own
// rng()-driven "mistake" mechanism, which would make the SAME board
// produce a different hint from one call to the next; findBestMove()
// has no randomness at all) at Medium's own (maxDepth/timeLimitMs/
// maxBranching) tuning. Latency measured directly rather than assumed
// (empty board: well under 1ms; real 10-40-stone self-played mid-game
// positions across 15 seeds: max ~54ms, avg ~20-32ms — see this pass's
// own CLAUDE.md section for the full table) — comfortably inside what a
// button-press already tolerates elsewhere in this app (main.js's own
// MIN_AI_THINK_MS convention treats anything under a few hundred ms as
// "instant enough"), so Medium's depth was kept as specified rather than
// downgraded to depth 1.
//
// Rungs 1/2 use board.js's own checkWin() directly (never trust a
// pattern-score comparison to reliably outrank an actual win/loss,
// exactly the reasoning game/ai.js's own pre-search fast path already
// established). Rungs 3/4 use game/evaluate.js's countPatterns() — the
// same function evaluate() itself is built on — read for its NAMED
// counts (openFour/openThree) rather than its opaque scalar, so "does
// this move create/prevent this EXACT pattern" is asked directly instead
// of inferred from a score delta.
//
// Renju: every rung MUST skip a candidate that's forbidden for Black
// (game/renju.js's checkForbiddenForBlack()) before it can be returned —
// suggesting an illegal move as "the good move to play" would be the
// single worst outcome this feature could produce (CLAUDE.md milestone
// 9's own hint-pass framing: "금수를 힌트로 찍어주는 것은 최악의
// 케이스"). Rung 5 doesn't need a manual filter — findBestMove() already
// threads renjuEnabled through its own search exactly the way game/
// ai.js's header documents. Every other rung filters explicitly.
//
// Rung 1 in particular needs this filter for a reason that isn't obvious
// at first: board.js's checkWin() is freestyle-only — ANY run of 5 OR
// MORE counts as a win there, it has no concept of "overline." Renju's
// own five-exemption only covers a run of EXACTLY 5 (renju.js's own
// header: "completing a five is always legal... regardless of any other
// pattern it might also look like" — that sentence is about a *different*
// direction also looking bad, not about the SAME direction running past
// 5). A move that bridges a gap into 6-or-more in one placement — no
// intermediate "exactly 5" state ever exists, since this is one
// hypothetical placement, not a move-by-move history — is a real
// overline, forbidden for Black, and checkWin() will still happily
// report it as a win. Verified directly, not assumed: a constructed
// fixture (Black at columns 0-3 contiguous, a gap, Black again at column
// 5 — playing the gap bridges columns 0-5, a run of 6) makes
// checkForbiddenForBlack() return `{forbidden: true, reason:
// "overline"}` for the exact same point checkWin() reports as a win. Both
// rung 1 (`player`'s own win) and rung 2's opponent-win scan need this —
// rung 2 specifically because if `opponent` is Black, a "threat" that
// Black could only realize via an illegal overline was never a real
// threat `player` needs to block in the first place.
//
// UPDATE (a later pass — CLAUDE.md's own milestone for it has the full
// account): the SAME latent gap this comment originally found in game/
// ai.js's own findImmediateWin()/scoreCandidateMoves() has since been
// fixed AT THE SOURCE there too (that pass got an explicit, one-time
// exception to this project's usual "game/ai.js is import-only from
// here" rule specifically to fix it directly, reusing this exact same
// isLegalForHint()-style check). Every rung below is now, strictly
// speaking, double-filtered against this one specific edge case — this
// file's own filtering was NOT removed, and stays exactly as it was: a
// module that hands a UI feature the wrong move is a worse failure mode
// than one redundant legality check that (after the ai.js fix) should
// now always agree with what game/ai.js itself would have said anyway.
// Defense in depth, kept on purpose, not an oversight.
// test/hint.test.js's own renju fixtures (e)/(e2) are this exact case,
// and still pass unchanged against the now-fixed game/ai.js.
//
// Pure and Node-testable — no DOM, no storage, no randomness of its own.
// Never mutates `board`: every tentative placement made while scoring is
// undone before the next candidate is tried.

import { generateCandidates, findBestMove, scoreCandidateMoves, DIFFICULTIES } from "./ai.js";
import { evaluate, countPatterns } from "./evaluate.js";
import { checkWin } from "./board.js";
import { checkForbiddenForBlack } from "./renju.js";

const BLACK = 0;

function otherPlayer(player) {
  return player === 0 ? 1 : 0;
}

/** @returns {boolean} true unless renju is on, `player` is Black, AND the point is actually forbidden. */
function isLegalForHint(board, row, col, player, renjuEnabled) {
  if (!renjuEnabled || player !== BLACK) return true;
  return !checkForbiddenForBlack(board, row, col).forbidden;
}

/**
 * Rung 1: does any LEGAL candidate complete an outright win for `player`?
 * Legal-filtered (see file header on why checkWin() alone isn't enough —
 * the overline case).
 * @returns {[number, number] | null}
 */
function findWinIn1(board, player, candidates, renjuEnabled) {
  for (const [row, col] of candidates) {
    if (!isLegalForHint(board, row, col, player, renjuEnabled)) continue;
    board[row][col] = player;
    const wins = checkWin(board, row, col, player) !== null;
    board[row][col] = null;
    if (wins) return [row, col];
  }
  return null;
}

/**
 * Rung 2: every LEGAL candidate where the OPPONENT would win-in-1 — i.e.
 * every point that's a REAL threat `player` must block. Filtered by
 * whether `opponent` could legally play there (same overline reasoning
 * as findWinIn1() — a "threat" Black could only realize via an illegal
 * overline was never a real threat to begin with). Returns all of them
 * (not just the first), so the caller can rank by which one leaves
 * `player` best off, exactly as this pass's own spec asks ("복수라면...
 * 내 evaluate가 가장 높아지는 지점").
 * @returns {[number, number][]}
 */
function findAllOpponentWinPoints(board, opponent, candidates, renjuEnabled) {
  const points = [];
  for (const [row, col] of candidates) {
    if (!isLegalForHint(board, row, col, opponent, renjuEnabled)) continue;
    board[row][col] = opponent;
    const wins = checkWin(board, row, col, opponent) !== null;
    board[row][col] = null;
    if (wins) points.push([row, col]);
  }
  return points;
}

/**
 * Picks the legal point in `points` that maximizes evaluate(board,
 * player) after `player` plays there — shared by rung 2 (block-win, all
 * candidates already guaranteed relevant) and rungs 3/4 (open-four /
 * block-three, where `points` is prefiltered by the caller's own
 * pattern-count test before this ranks what's left).
 * @returns {[number, number] | null}
 */
function bestLegalByEvaluate(board, player, points, renjuEnabled) {
  let best = null;
  let bestScore = -Infinity;
  for (const [row, col] of points) {
    if (!isLegalForHint(board, row, col, player, renjuEnabled)) continue;
    board[row][col] = player;
    const score = evaluate(board, player);
    board[row][col] = null;
    if (score > bestScore) {
      bestScore = score;
      best = [row, col];
    }
  }
  return best;
}

/**
 * Rung 3: candidates where `player` playing there creates a brand-new
 * open four (countPatterns' own openFour count going from whatever it
 * was to a nonzero count as a DIRECT result of this one move) — i.e. a
 * win next move the opponent cannot block with any single reply. Legal-
 * filtered inline (unlike rungs 1/2, a move that merely builds an open
 * four is NOT automatically win-exempt from renju's forbidden-move
 * rules — it could simultaneously form a double-three/double-four
 * elsewhere on the same move).
 * @returns {[number, number] | null}
 */
function findOpenFourMove(board, player, candidates, renjuEnabled) {
  const points = [];
  for (const [row, col] of candidates) {
    if (!isLegalForHint(board, row, col, player, renjuEnabled)) continue;
    board[row][col] = player;
    const creates = countPatterns(board, player).openFour > 0;
    board[row][col] = null;
    if (creates) points.push([row, col]);
  }
  return bestLegalByEvaluate(board, player, points, renjuEnabled);
}

/**
 * Rung 4: candidates that reduce the OPPONENT's own openThree count —
 * i.e. genuinely block at least one of their open threes (the two-sided
 * "either flank" nature of an open three means more than one candidate
 * can legitimately qualify; diffing the opponent's own pattern count
 * before/after is what actually proves a given point sits on one of
 * those flanks, without needing any new line-geometry helper beyond what
 * evaluate.js already exports). Only worth running at all if the
 * opponent currently HAS an open three to begin with.
 * @returns {[number, number] | null}
 */
function findOpenThreeBlock(board, player, opponent, candidates, renjuEnabled) {
  const before = countPatterns(board, opponent).openThree;
  if (before === 0) return null;

  const points = [];
  for (const [row, col] of candidates) {
    if (!isLegalForHint(board, row, col, player, renjuEnabled)) continue;
    board[row][col] = player;
    const after = countPatterns(board, opponent).openThree;
    board[row][col] = null;
    if (after < before) points.push([row, col]);
  }
  return bestLegalByEvaluate(board, player, points, renjuEnabled);
}

/**
 * Suggests one move for `player` on `board`, walking the priority ladder
 * described in this file's header. Never mutates `board`.
 * @param {(0|1|null)[][]} board
 * @param {0|1} player
 * @param {boolean} [renjuEnabled] - milestone 9's own convention (game/
 *   ai.js/game/renju.js): only ever restricts Black, defaults to off.
 * @returns {{row: number, col: number, reason: 'win'|'block-win'|'open-four'|'block-three'|'develop'} | null}
 *   null only if the board is already full, or (renjuEnabled,
 *   player===Black, astronomically rare per game/renju.js's own notes)
 *   Black has no legal point left at all.
 */
export function suggestHint(board, player, renjuEnabled = false) {
  const candidates = generateCandidates(board);
  if (candidates.length === 0) return null; // board is full

  const opponent = otherPlayer(player);

  const win = findWinIn1(board, player, candidates, renjuEnabled);
  if (win) return { row: win[0], col: win[1], reason: "win" };

  const opponentWinPoints = findAllOpponentWinPoints(board, opponent, candidates, renjuEnabled);
  if (opponentWinPoints.length > 0) {
    const block = bestLegalByEvaluate(board, player, opponentWinPoints, renjuEnabled);
    // If every blocking point happens to be forbidden for Black, there is
    // no legal way to stop this loss — fall through to the rest of the
    // ladder rather than returning nothing; a real reachable position is
    // still owed the best legal suggestion the rest of the ladder can
    // find, even though it can't undo what rung 2 couldn't do.
    if (block) return { row: block[0], col: block[1], reason: "block-win" };
  }

  const openFour = findOpenFourMove(board, player, candidates, renjuEnabled);
  if (openFour) return { row: openFour[0], col: openFour[1], reason: "open-four" };

  const blockThree = findOpenThreeBlock(board, player, opponent, candidates, renjuEnabled);
  if (blockThree) return { row: blockThree[0], col: blockThree[1], reason: "block-three" };

  // Rung 5: findBestMove() first — fast, and correct in every case except
  // one: its OWN internal fast-path win-check (game/ai.js's own
  // findImmediateWin(), called on an UNFILTERED candidate list, exactly
  // like this file's own findWinIn1() used to before the fixture at the
  // top of this file disproved the "always exempt" assumption) can, in
  // the same astronomically rare renju-overline-masquerading-as-win
  // scenario this file's header documents, hand back an illegal point.
  // That can ONLY happen through ai.js's fast path — its recursive
  // search proper already filters correctly at every node (orderMoves()
  // re-checks legality fresh every time, per ai.js's own header) — so
  // checking the fast result's own legality here and falling back only
  // when it actually fails costs nothing in the overwhelming common
  // case, rather than always paying for the slower, uncapped path below.
  const fast = findBestMove(board, player, {
    maxDepth: DIFFICULTIES.medium.maxDepth,
    timeLimitMs: DIFFICULTIES.medium.timeLimitMs,
    maxBranching: DIFFICULTIES.medium.maxBranching,
    renjuEnabled,
  });
  if (fast && isLegalForHint(board, fast[0], fast[1], player, renjuEnabled)) {
    return { row: fast[0], col: fast[1], reason: "develop" };
  }

  // Fallback: score only an ALREADY-legal candidate list directly (never
  // letting an illegal point enter scoreCandidateMoves() at all, so its
  // own per-move checkWin() check — same shape as ai.js's fast path —
  // never gets asked about one).
  const legalCandidates = candidates.filter(([row, col]) => isLegalForHint(board, row, col, player, renjuEnabled));
  if (legalCandidates.length === 0) return null; // no legal move at all — see game/renju.js's own notes on how rare this is
  const scored = scoreCandidateMoves(
    board,
    player,
    legalCandidates,
    DIFFICULTIES.medium.maxDepth,
    DIFFICULTIES.medium.timeLimitMs,
    DIFFICULTIES.medium.maxBranching,
    renjuEnabled
  );
  scored.sort((a, b) => b.score - a.score);
  const [devRow, devCol] = scored[0].move;
  return { row: devRow, col: devCol, reason: "develop" };
}
