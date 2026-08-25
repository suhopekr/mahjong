// game/board.js
// Gomoku data model: board state, move stack (for undo), and win
// detection. Freestyle rules (CLAUDE.md milestone 1): no forbidden moves,
// first to get an unbroken line of FIVE OR MORE stones (an "overline" of
// 6+ also counts) horizontally, vertically, or diagonally wins. This is
// exactly what distinguishes Freestyle from Renju — Renju specifically
// nullifies Black's overlines as a forbidden-move variant, along with
// double-three/double-four restrictions. That distinction is out of scope
// until a later Renju milestone; this file's checkWin() intentionally
// does NOT special-case "exactly 5."
//
// Board size is always a parameter, never a module-level constant — the
// GRID_SIZES-hardcoded-in-storage.js mistake inherited from Dots and
// Boxes (CLAUDE.md section 3) is exactly what this file avoids: a 9x9
// "quick game" and the 15x15 default both just pass `size` into
// createGameState().

const DIRECTIONS = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal \
  [1, -1], // diagonal /
];

/**
 * @param {number} size - points per side (e.g. 15 for a standard board)
 * @returns {(0|1|null)[][]}
 */
export function createBoard(size) {
  const board = [];
  for (let r = 0; r < size; r++) board.push(new Array(size).fill(null));
  return board;
}

/**
 * @param {number} [size=15]
 * @returns {{
 *   size: number,
 *   board: (0|1|null)[][],
 *   moves: {row:number, col:number, player:0|1}[],
 *   winner: 0|1|'draw'|null,
 *   winLine: [number,number][]|null
 * }}
 */
export function createGameState(size = 15) {
  return {
    size,
    board: createBoard(size),
    moves: [],
    winner: null,
    winLine: null,
  };
}

/**
 * Places `player`'s stone at (row, col), checks for a win/draw, and
 * mutates + returns `state`. Throws on an illegal move (out of bounds,
 * an occupied cell, or the game already having a winner) rather than
 * silently ignoring it — callers (input handling, a future AI) are
 * expected to validate a move BEFORE calling if they want a non-throwing
 * check; keeping this strict here means a bug elsewhere can't corrupt
 * the board silently.
 * @param {ReturnType<typeof createGameState>} state
 * @param {number} row
 * @param {number} col
 * @param {0|1} player
 */
export function placeStone(state, row, col, player) {
  if (state.winner !== null) throw new Error("game is already over");
  if (row < 0 || row >= state.size || col < 0 || col >= state.size) {
    throw new Error(`(${row}, ${col}) is out of bounds for a ${state.size}x${state.size} board`);
  }
  if (state.board[row][col] !== null) {
    throw new Error(`(${row}, ${col}) is already occupied`);
  }

  state.board[row][col] = player;
  state.moves.push({ row, col, player });

  const winLine = checkWin(state.board, row, col, player);
  if (winLine) {
    state.winner = player;
    state.winLine = winLine;
  } else if (countOccupied(state.board) === state.size * state.size) {
    // Counted from the BOARD, not `moves.length`: a Daily Challenge
    // starts with prefilled opening stones that are never pushed onto
    // the move stack (they can't be undone), so on those games the
    // stack could never reach size*size and a full board never ended.
    // Undo is unaffected — it clears the cell, so the count drops too.
    state.winner = "draw";
  }
  return state;
}

/** @returns {number} how many cells of `board` hold a stone */
function countOccupied(board) {
  let count = 0;
  for (const row of board) for (const cell of row) if (cell !== null) count++;
  return count;
}

/**
 * Undoes the most recent move: clears its cell and pops it off the move
 * stack. A win can only ever be produced by the LAST move placed (the
 * game stops accepting moves once state.winner is set — placeStone()
 * throws otherwise), so undoing that move always makes winner/winLine
 * correct again by just clearing them; there's never a need to re-run
 * win detection on whatever remains.
 * @param {ReturnType<typeof createGameState>} state
 * @returns {{row:number, col:number, player:0|1}|null} the undone move,
 *   or null if there was nothing to undo
 */
export function undoMove(state) {
  const last = state.moves.pop();
  if (!last) return null;
  state.board[last.row][last.col] = null;
  state.winner = null;
  state.winLine = null;
  return last;
}

/**
 * Checks whether the stone just placed at (row, col) by `player` completes
 * a winning line. Only checks the 4 directions THROUGH that point — never
 * rescans the whole board — since a move can only ever create a new win
 * through the point it was just placed on.
 * @param {(0|1|null)[][]} board
 * @param {number} row
 * @param {number} col
 * @param {0|1} player
 * @returns {[number,number][]|null} every coordinate in the winning run,
 *   in order along the line (length 5 for an exact five, more for an
 *   overline — freestyle counts both, see file header), or null if this
 *   move didn't complete a line of 5+
 */
export function checkWin(board, row, col, player) {
  const size = board.length;
  for (const [dr, dc] of DIRECTIONS) {
    const line = [[row, col]];

    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < size && c >= 0 && c < size && board[r][c] === player) {
      line.push([r, c]);
      r += dr;
      c += dc;
    }

    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < size && c >= 0 && c < size && board[r][c] === player) {
      line.unshift([r, c]);
      r -= dr;
      c -= dc;
    }

    if (line.length >= 5) return line;
  }
  return null;
}
