// game/evaluate.js
// Position evaluation for a future Gomoku AI — milestone 4-1, search is
// explicitly out of scope (no minimax/alpha-beta here yet, see CLAUDE.md
// section 7 for that decision). A Gomoku engine's strength comes from
// PATTERN RECOGNITION, not search depth: a weak evaluator stays weak no
// matter how deep the search goes, so this file is worth getting right
// before any tree search is built on top of it.
//
// evaluate(board, player) scores a position from `player`'s perspective:
// positive means good for `player`, negative means good for the
// opponent. It's built from countPatterns(), which is exported
// separately specifically so tests can assert exact pattern counts
// rather than reverse-engineering meaning from a single scalar score.
//
// --- pattern taxonomy -----------------------------------------------
//
//   five        - some line has a run of 5+ of player's stones          - already won (freestyle: 5+ counts, see game/board.js)
//   openFour    - some line has 2+ distinct cells that would win if     - unstoppable: opponent can only block one
//                 filled ("winning cells")
//   closedFour  - some line has exactly 1 winning cell                  - forcing: MUST be blocked immediately or the game is lost
//   openThree   - length == 3 contiguous run, both sides open           - developing: becomes an openFour next move if left alone
//   closedThree - length == 3 contiguous run, exactly one side open     - weak: can become at most a closedFour, easy to ignore
//   openTwo     - length == 2 contiguous run, both sides open           - early development, lowest tier scored
//
// FOUR is defined by WINNING CELLS, not by a fixed run shape — this is
// what makes both contiguous fours (".XXXX.") AND "broken" fours with a
// single internal gap ("XXX.X", "X.XXX", "XX.XX") fall out of the exact
// same check: for every empty cell in a line, "if I play here, does the
// resulting run reach length >= 5?" A pure single-gap-bridge (leftRun +
// rightRun == 4, e.g. "XXX.X") only ever has exactly ONE such cell — the
// gap itself — so it's always CLOSED-tier, never open (there's no
// "open broken four": filling the one gap wins, and no other cell in
// that shape does). An OPEN four-tier threat, whether from a plain
// ".XXXX." or from a gap-shape sitting next to an independently-open
// stone ("X.XXXX." has 2 winning cells: the gap AND the far flank),
// falls out of the same "count winning cells" rule with no special case.
//
// THREE and TWO are still classified as contiguous runs only (the
// pre-existing, simpler method) — recognizing "broken threes" (a gap
// that would turn a developing three into an open four) needs a genuine
// one-ply-lookahead definition of "open" to avoid conflicting with the
// existing immediate-neighbor-based three classifier, which is a
// materially bigger change than fours needed. Deliberately left as a
// known, flagged gap rather than half-built: broken FOURS are handled as
// of this milestone; broken THREES are not yet.
//
// --- avoiding double counting ----------------------------------------
//
// The most common bug in a Gomoku evaluator: the same stones getting
// counted more than once. Two different mechanisms are at play here, so
// two different guarantees are needed:
//   1. Horizontal/vertical/diagonal-\/diagonal-/ lines are, by
//      construction, 4 disjoint ways of grouping the board's cells — a
//      horizontal line and a vertical line can share at most ONE cell
//      (their intersection), never a whole run, so different DIRECTIONS
//      can never double-count the same run. (A single stone legitimately
//      contributing to up to 4 different patterns — one per direction —
//      is correct and exactly how a real fork/double-threat is
//      represented, not a bug — confirmed with a cross/plus fixture in
//      test/evaluate.test.js.)
//   2. WITHIN one line, the contiguous-run scanner (for five/three/two)
//      and the winning-cell scanner (for four) are two SEPARATE passes
//      over the SAME cells, which creates a real risk the naive version
//      of this file didn't have: "XXX.X" has both a genuine closedFour
//      (the gap is a winning cell) AND, if the contiguous scanner is run
//      independently, the "XXX" portion ALSO looks like a run with an
//      open right flank (the gap is empty) — i.e. ALSO a closedThree.
//      That's not two separate threats, it's the SAME shape described
//      twice. The fix: computeWinningCells() runs FIRST, and the
//      contiguous scanner treats a flank as "open" only if it's empty
//      AND NOT a winning cell — a flank already absorbed into a
//      four-tier threat can't also count as a three-tier "opening."
//      (This never affects a plain ".XXX." with no adjacent bonus stone:
//      its flanks only reach length 4 if filled, never length 5, so
//      they're never winning cells to begin with — see
//      test/evaluate.test.js's regression test for this exact
//      interaction.)

const DIRECTIONS = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal \
  [1, -1], // diagonal /
];

// Ratio of 1000x between every tier. On a 15x15 board there are at most
// ~88 lines total (15 rows + 15 cols + up to 58 diagonals of any length)
// and no line can plausibly hold more than a handful of non-overlapping
// instances of any one pattern — a generous upper bound of "440 total
// instances of one tier" is still 1000x/2.27 short of one instance of
// the next tier up, and the shortfall compounds favorably for every tier
// above that (see CLAUDE.md's milestone 4-1 notes for the worked-out
// bound). `five` is effectively a sentinel — if it's ever nonzero the
// game is already over — kept in the same geometric sequence for
// consistency rather than needing a special "infinity" case.
export const PATTERN_SCORES = {
  openTwo: 1,
  closedThree: 1_000,
  openThree: 1_000_000,
  closedFour: 1_000_000_000,
  openFour: 1_000_000_000_000,
  five: 1_000_000_000_000_000,
};

function emptyCounts() {
  return { five: 0, openFour: 0, closedFour: 0, openThree: 0, closedThree: 0, openTwo: 0 };
}

/**
 * Classifies one maximal CONTIGUOUS run by its exact length and which
 * sides are open. Only handles five/three/two — four is no longer a
 * fixed-shape case here at all (see computeWinningCells() below), so
 * length === 4 always returns null: a plain ".XXXX." contributes nothing
 * from this function, its openFour comes entirely from the winning-cell
 * count instead.
 * @returns {string|null} a key into PATTERN_SCORES, or null for a run
 *   with no scoring pattern (dead three, or any length-2-or-under run
 *   that isn't a fully open two)
 */
function classifyRun(length, leftOpen, rightOpen) {
  if (length >= 5) return "five";
  if (length === 3) {
    if (leftOpen && rightOpen) return "openThree";
    if (leftOpen || rightOpen) return "closedThree";
    return null;
  }
  if (length === 2 && leftOpen && rightOpen) return "openTwo";
  return null;
}

/**
 * @param {(0|1|null)[]} cells
 * @param {0|1} player
 * @returns {boolean} true if this line already has an actual run of 5+
 */
function lineHasFive(cells, player) {
  let run = 0;
  for (const cell of cells) {
    run = cell === player ? run + 1 : 0;
    if (run >= 5) return true;
  }
  return false;
}

/**
 * For every EMPTY cell in the line, checks whether `player` playing
 * there would immediately create a run of 5+ — i.e. whether it's a
 * "winning cell." This is the single mechanism that recognizes both
 * contiguous fours (a plain run's flank) and broken fours (a single gap
 * bridging two separate sub-runs) uniformly: it doesn't care HOW the
 * stones on either side of the empty cell are arranged, only how many
 * of them are contiguously adjacent to it.
 * @param {(0|1|null)[]} cells
 * @param {0|1} player
 * @returns {boolean[]} same length as `cells`; true at indices that are
 *   winning cells (always false at non-empty indices)
 */
function computeWinningCells(cells, player) {
  const n = cells.length;
  const winning = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (cells[i] !== null) continue;
    let leftLen = 0;
    for (let k = i - 1; k >= 0 && cells[k] === player; k--) leftLen++;
    let rightLen = 0;
    for (let k = i + 1; k < n && cells[k] === player; k++) rightLen++;
    if (leftLen + rightLen + 1 >= 5) winning[i] = true;
  }
  return winning;
}

/**
 * Scans one line for `player`'s patterns and adds them into `counts`.
 * Runs the winning-cell pass first (four-tier — see file header for why
 * this has to happen before the contiguous-run pass), then the
 * contiguous-run pass for five/three/two, where a flank only counts as
 * "open" if it's both empty AND not already a winning cell (the
 * double-counting fix — see file header's "XXX.X" walkthrough).
 * @param {(0|1|null)[]} cells
 * @param {0|1} player
 * @param {ReturnType<typeof emptyCounts>} counts
 */
function scanLine(cells, player, counts) {
  const n = cells.length;

  // --- four-tier: winning-cell count, skipped entirely if this line
  // already has an actual five (an existing five's own flanks are
  // trivially "winning cells" too — extending a five to a six is still
  // a win — which would otherwise inflate openFour alongside an already-
  // won five for no reason).
  const winningCells = computeWinningCells(cells, player);
  if (!lineHasFive(cells, player)) {
    const winningCellCount = winningCells.reduce((sum, w) => sum + (w ? 1 : 0), 0);
    if (winningCellCount === 1) counts.closedFour++;
    else if (winningCellCount >= 2) counts.openFour++;
  }

  // --- five/three/two: contiguous runs, flank "open" excludes winning cells
  let i = 0;
  while (i < n) {
    if (cells[i] !== player) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && cells[j] === player) j++;
    const length = j - i;
    const leftOpen = i - 1 >= 0 && cells[i - 1] === null && !winningCells[i - 1];
    const rightOpen = j < n && cells[j] === null && !winningCells[j];
    const pattern = classifyRun(length, leftOpen, rightOpen);
    if (pattern) counts[pattern]++;
    i = j; // jump past the whole run — these cells are never revisited
  }
}

/**
 * Extracts every line on the board in one direction as arrays of cell
 * values, ready for scanLine(). `size` lines for horizontal/vertical;
 * up to `2*size - 1` lines (of varying length) for either diagonal.
 * @param {(0|1|null)[][]} board
 * @param {number} dr
 * @param {number} dc
 * @returns {(0|1|null)[][]}
 */
function extractLines(board, dr, dc) {
  const size = board.length;
  const lines = [];
  if (dr === 0) {
    // horizontal: each row is already a full line
    for (let r = 0; r < size; r++) lines.push(board[r]);
  } else if (dc === 0) {
    // vertical
    for (let c = 0; c < size; c++) {
      const line = [];
      for (let r = 0; r < size; r++) line.push(board[r][c]);
      lines.push(line);
    }
  } else if (dc === 1) {
    // diagonal \: constant r - c
    for (let k = -(size - 1); k <= size - 1; k++) {
      const line = [];
      for (let r = 0; r < size; r++) {
        const c = r - k;
        if (c >= 0 && c < size) line.push(board[r][c]);
      }
      lines.push(line);
    }
  } else {
    // diagonal /: constant r + c
    for (let k = 0; k <= 2 * (size - 1); k++) {
      const line = [];
      for (let r = 0; r < size; r++) {
        const c = k - r;
        if (c >= 0 && c < size) line.push(board[r][c]);
      }
      lines.push(line);
    }
  }
  return lines;
}

/**
 * Counts every scoring pattern `player` has on the whole board, across
 * all 4 directions. This is the function tests assert against directly
 * (exact counts, not a derived score) — see test/evaluate.test.js.
 * @param {(0|1|null)[][]} board
 * @param {0|1} player
 * @returns {{five:number, openFour:number, closedFour:number, openThree:number, closedThree:number, openTwo:number}}
 */
export function countPatterns(board, player) {
  const counts = emptyCounts();
  for (const [dr, dc] of DIRECTIONS) {
    for (const line of extractLines(board, dr, dc)) {
      scanLine(line, player, counts);
    }
  }
  return counts;
}

function scoreFromCounts(counts) {
  let score = 0;
  for (const key in PATTERN_SCORES) score += counts[key] * PATTERN_SCORES[key];
  return score;
}

/**
 * @param {(0|1|null)[][]} board
 * @param {0|1} player
 * @returns {number} positive favors `player`, negative favors the opponent
 */
export function evaluate(board, player) {
  const opponent = player === 0 ? 1 : 0;
  return scoreFromCounts(countPatterns(board, player)) - scoreFromCounts(countPatterns(board, opponent));
}
