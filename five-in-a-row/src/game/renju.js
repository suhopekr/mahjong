// game/renju.js
// Milestone 9: Renju forbidden-move rules (금수), Black only — double-
// three (삼삼), double-four (사사), overline (장목, 6+ in a row). White
// has no restrictions at all (CLAUDE.md milestone 9's own scope). Pure
// logic, no DOM, no storage — mirrors game/achievements.js/game/
// themes.js's own shape: a module that only ANSWERS questions about a
// board, never mutates anything the caller didn't ask it to.
//
// Layered entirely on top of game/board.js rather than inside it —
// board.js's checkWin() stays exactly freestyle (any run >= 5 wins) and
// needed ZERO changes for this milestone. That's not an oversight: a
// forbidden move, under Renju rules, is something Black is never ALLOWED
// to place in the first place (blocked at input time — main.js's click
// handling, game/ai.js's own candidate generation) — checkWin() simply
// never gets asked to evaluate a move that was never placed. White's
// overlines still win exactly as freestyle already handles (Renju has no
// "White overline" rule at all — only Black's is forbidden), so
// checkWin() being freestyle-shaped is already exactly correct for
// White under Renju too.
//
// --- the recursion question (CLAUDE.md milestone 9's own framing) ------
//
// A precise Renju double-three ruling is recursive in general: a "three"
// only counts if the point that would complete it into an open four is
// itself a LEGAL point for Black to play — if that completion point is
// itself forbidden (say, it would create its own double-three), the
// original "three" isn't a real threat and shouldn't count.
//
// This module implements DEPTH-LIMITED recursion, exactly one level
// deep — not unlimited, not zero:
//   - Overline and double-four need NO recursion at all. Completing
//     either to an exact five is an immediate win, and completing a
//     five is ALWAYS legal for Black regardless of any other pattern it
//     might also look like (the five-in-a-row exemption) — so a four's
//     completion point can never itself be "illegal" in a way that
//     matters here. This isn't a simplification for casualness; it's
//     just correct.
//   - Only double-three needs the check, because a three's completion
//     point makes an OPEN FOUR — not a win yet, just a strong
//     intermediate shape — which genuinely CAN be forbidden for Black
//     under the normal rules.
//   - When validating a completion point found while checking a
//     candidate move for double-three, this module checks that point's
//     OWN legality using the plain, non-recursive pattern definition
//     (no further chasing into THAT point's own completion points'
//     legality). This is "depth 2" in CLAUDE.md milestone 9's own
//     a/b/c framing: the original move (level 1) plus one validation
//     pass on each candidate three's completion point (level 2), never
//     deeper.
//
// Why stop at depth 2, not go deeper (option c, full recursion): a
// three's completion point being ITSELF invalidated by a THIRD level of
// recursion is a genuinely rare, deeply constructed position — the kind
// that shows up in composed Renju problems, not in casual play this
// project is built for (a casual, mostly first-time audience). Depth 2
// already resolves the overwhelmingly
// common real case (an apparent double-three where one prong's
// completion point turns out to already be forbidden for some other
// reason) without the added complexity/performance cost of a genuinely
// unbounded recursive search whose payoff, for this audience, is
// vanishingly small.

const DIRECTIONS = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal \
  [1, -1], // diagonal /
];

const BLACK = 0;

function inBounds(row, col, size) {
  return row >= 0 && row < size && col >= 0 && col < size;
}

/**
 * Assumes board[row][col] === player already. Returns how far the
 * consecutive run of `player` stones extends in direction (dr, dc),
 * expressed as offsets `k` from (row, col) (k=0 is always included).
 * @returns {{length: number, minK: number, maxK: number}}
 */
function runExtent(board, row, col, dr, dc, player) {
  const size = board.length;
  let maxK = 0;
  let r = row + dr, c = col + dc, k = 1;
  while (inBounds(r, c, size) && board[r][c] === player) {
    maxK = k;
    r += dr;
    c += dc;
    k++;
  }
  let minK = 0;
  r = row - dr;
  c = col - dc;
  k = 1;
  while (inBounds(r, c, size) && board[r][c] === player) {
    minK = -k;
    r -= dr;
    c -= dc;
    k++;
  }
  return { length: maxK - minK + 1, minK, maxK };
}

function offsetToCell(row, col, dr, dc, k) {
  return { row: row + dr * k, col: col + dc * k };
}

/**
 * Would filling the empty cell at offset `k` (from (row,col), direction
 * (dr,dc)) connect into a run of EXACTLY 5 through (row,col)? (Anchoring
 * the extent check at (row,col) — not at the filled cell — is exactly
 * what makes this "must connect back to the candidate move," not some
 * unrelated four elsewhere on the same line: if there's a gap between
 * the filled cell and (row,col)'s own run, the extent through (row,col)
 * simply doesn't reach it, so this correctly returns false.)
 */
function fillConnectsToExactFive(board, row, col, dr, dc, k, player) {
  const size = board.length;
  const { row: r, col: c } = offsetToCell(row, col, dr, dc, k);
  if (!inBounds(r, c, size) || board[r][c] !== null) return false;
  board[r][c] = player;
  const extent = runExtent(board, row, col, dr, dc, player);
  board[r][c] = null;
  return extent.length === 5;
}

// A four's completing point(s) can be at most 4 cells from the anchor in
// either direction (4 existing stones + 1 new one span at most 5
// consecutive cells) — see game/evaluate.js's own identical reasoning
// for gapped four detection (milestone 4-1's follow-up).
const SCAN_RADIUS = 4;

/**
 * How many DISTINCT "fours" (row,col) participates in along this
 * direction — a four being a set of 4 stones that one more stone turns
 * into an exact five. Needs no recursive legality check on the
 * completing point at all (see this file's header — completing to five
 * is always legal).
 *
 * Counted as distinct five-SPANS, not as completion points, because the
 * two aren't the same thing: a straight open four ".XXXX." has TWO
 * completion points but is ONE four under RIF rules (both resulting
 * fives share the same 4 stones — the spans are offset by exactly one
 * cell). "X.XXX.X", by contrast, also has two completion points but its
 * two fives share only 3 stones — two genuinely separate fours on one
 * line, the classic single-line double-four this function exists to
 * catch (a previous version returned a boolean per direction, so that
 * shape slipped through as "one direction, one four"). Every span here
 * is length 5 and contains the anchor, so "shares 4 stones" is exactly
 * "starts one cell apart"; no three spans can chain that way (the
 * middle one's stones force both flanks empty), so pairs are the only
 * grouping that ever needs merging.
 * @returns {number}
 */
function countDirectionFours(board, row, col, dr, dc, player) {
  const size = board.length;
  const starts = [];
  for (let k = -SCAN_RADIUS; k <= SCAN_RADIUS; k++) {
    if (k === 0) continue;
    const { row: r, col: c } = offsetToCell(row, col, dr, dc, k);
    if (!inBounds(r, c, size) || board[r][c] !== null) continue;
    board[r][c] = player;
    const extent = runExtent(board, row, col, dr, dc, player);
    board[r][c] = null;
    if (extent.length === 5) starts.push(extent.minK);
  }
  starts.sort((a, b) => a - b);
  let fours = 0;
  for (let i = 0; i < starts.length; i++) {
    if (i === 0 || starts[i] - starts[i - 1] > 1) fours++;
  }
  return fours;
}

/**
 * Finds every empty point along this direction that, if ALSO filled with
 * `player` (on top of (row,col) already being filled), would form an
 * OPEN four anchored on (row,col) — a clean run of exactly 4 with BOTH
 * flanks empty AND each flank's own completion reaching exactly 5 (not
 * an overline, and not disconnected). Returns the list of such
 * completion points — empty if this direction has no genuine "three."
 * @returns {{row: number, col: number}[]}
 */
function findOpenFourCompletionPoints(board, row, col, dr, dc, player) {
  const size = board.length;
  const points = [];
  for (let k = -SCAN_RADIUS; k <= SCAN_RADIUS; k++) {
    if (k === 0) continue;
    const { row: r, col: c } = offsetToCell(row, col, dr, dc, k);
    if (!inBounds(r, c, size) || board[r][c] !== null) continue;

    board[r][c] = player;
    const extent = runExtent(board, row, col, dr, dc, player);
    let isOpenFour = false;
    // The probe stone itself must be PART of the resulting four — a
    // probe that lands beyond a gap leaves the run through (row,col)
    // untouched, so "extent is an open four" would then be describing
    // a four that already existed WITHOUT the probe (i.e. the move made
    // an open four, not a three). Without this, a legal 4-3 — the move
    // completing ".XXXX." — was also counted as a "three" in that same
    // direction and wrongly flagged as a double-three.
    if (extent.length === 4 && k >= extent.minK && k <= extent.maxK) {
      const leftK = extent.minK - 1;
      const rightK = extent.maxK + 1;
      isOpenFour = fillConnectsToExactFive(board, row, col, dr, dc, leftK, player) && fillConnectsToExactFive(board, row, col, dr, dc, rightK, player);
    }
    board[r][c] = null;

    if (isOpenFour) points.push({ row: r, col: c });
  }
  return points;
}

/**
 * Checks whether placing Black at (row, col) would be a forbidden move
 * under Renju rules. Never mutates `board` — every hypothetical
 * placement made while checking is undone before returning.
 * @param {(0|1|null)[][]} board
 * @param {number} row
 * @param {number} col
 * @param {{ recursive?: boolean }} [options] - `recursive` (default
 *   true) controls whether a candidate three's completion point gets its
 *   own legality check (this file's header: the ONE level of recursion
 *   this module implements). Internally set to `false` when THIS
 *   function calls itself to check a completion point's own legality —
 *   never any deeper than that single level.
 * @returns {{ forbidden: boolean, reason: 'overline'|'double-four'|'double-three'|null }}
 */
export function checkForbiddenForBlack(board, row, col, options = {}) {
  const { recursive = true } = options;
  const size = board.length;
  if (!inBounds(row, col, size) || board[row][col] !== null) {
    return { forbidden: false, reason: null }; // not a real placement question — nothing to forbid
  }

  board[row][col] = BLACK;
  try {
    // A move that completes an exact five in ANY direction is an
    // immediate win, exempt from every forbidden-move rule — checked
    // FIRST and short-circuits everything else, even if some OTHER
    // direction independently looks like an overline or a double-four.
    let anyExactFive = false;
    let anyOverline = false;
    for (const [dr, dc] of DIRECTIONS) {
      const length = runExtent(board, row, col, dr, dc, BLACK).length;
      if (length === 5) anyExactFive = true;
      if (length >= 6) anyOverline = true;
    }
    if (anyExactFive) return { forbidden: false, reason: null };
    if (anyOverline) return { forbidden: true, reason: "overline" };

    // Summed across directions, not "directions with a four" — a
    // double-four can live entirely on ONE line (see countDirectionFours).
    let fourCount = 0;
    for (const [dr, dc] of DIRECTIONS) {
      fourCount += countDirectionFours(board, row, col, dr, dc, BLACK);
    }
    if (fourCount >= 2) return { forbidden: true, reason: "double-four" };

    let threeDirections = 0;
    for (const [dr, dc] of DIRECTIONS) {
      const completionPoints = findOpenFourCompletionPoints(board, row, col, dr, dc, BLACK);
      const hasRealThree = recursive
        ? completionPoints.some((p) => !checkForbiddenForBlack(board, p.row, p.col, { recursive: false }).forbidden)
        : completionPoints.length > 0;
      if (hasRealThree) threeDirections++;
    }
    if (threeDirections >= 2) return { forbidden: true, reason: "double-three" };

    return { forbidden: false, reason: null };
  } finally {
    board[row][col] = null;
  }
}

/**
 * Convenience wrapper for UI highlighting / AI candidate filtering:
 * checks every point in `candidates` and returns just the forbidden
 * ones. Callers pass an already-scoped candidate list (game/ai.js's own
 * generateCandidates(), typically) rather than every empty cell on the
 * board — a forbidden pattern always needs nearby Black stones to form
 * at all, so scoping to the same Chebyshev-2 neighborhood the AI already
 * searches is both correct and cheap.
 * @param {(0|1|null)[][]} board
 * @param {[number, number][]} candidates
 * @returns {{row: number, col: number, reason: 'overline'|'double-four'|'double-three'}[]}
 */
export function findForbiddenPointsForBlack(board, candidates) {
  const forbidden = [];
  for (const [row, col] of candidates) {
    const result = checkForbiddenForBlack(board, row, col);
    if (result.forbidden) forbidden.push({ row, col, reason: result.reason });
  }
  return forbidden;
}

/** Human-readable reason text for the UI toast/tooltip (CLAUDE.md
 * milestone 9's own example wording: "Double three - not allowed for
 * Black"). */
export function forbiddenReasonText(reason) {
  if (reason === "double-three") return "Double three — not allowed for Black";
  if (reason === "double-four") return "Double four — not allowed for Black";
  if (reason === "overline") return "Overline (6 in a row) — not allowed for Black";
  return "Not allowed for Black";
}
