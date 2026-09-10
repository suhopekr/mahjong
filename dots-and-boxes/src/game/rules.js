// game/rules.js
// Dots and Boxes game-specific rules: the edge-based data model, box
// completion, scoring, and win/loss. State is tracked per EDGE, never
// per box-with-a-counter — box completion is always derived by checking
// the box's four edges directly. This makes undo trivial: rewind the
// edge flags and everything else (score, ownership) is recomputed.
//
// See CLAUDE.md section 4 for the exact model this implements.

/**
 * @param {number} rows
 * @param {number} cols
 * @returns {object} fresh game state
 */
export function createGameState(rows, cols) {
  const hEdges = makeGrid(rows + 1, cols, false); // hEdges[r][c], 0<=r<=rows, 0<=c<cols
  const vEdges = makeGrid(rows, cols + 1, false); // vEdges[r][c], 0<=r<rows, 0<=c<=cols
  const boxes = makeGrid(rows, cols, null); // boxes[r][c]: null | 0 | 1

  return {
    rows,
    cols,
    hEdges,
    vEdges,
    boxes,
    scores: [0, 0],
    edgesDrawn: 0,
    totalEdges: (rows + 1) * cols + rows * (cols + 1),
    gameOver: false,
    winner: null, // null while in progress, 0 | 1, or 'draw'
    lastMove: null, // {type, r, c} for highlighting the last-drawn edge
  };
}

function makeGrid(numRows, numCols, fill) {
  return Array.from({ length: numRows }, () => Array(numCols).fill(fill));
}

/**
 * True if (type, r, c) refers to an edge within bounds and not yet drawn.
 */
export function isValidMove(state, type, r, c) {
  const edge = getEdgeGrid(state, type);
  if (!edge) return false;
  if (r < 0 || c < 0 || r >= edge.length || c >= edge[0].length) return false;
  return edge[r][c] === false;
}

export function getEdgeGrid(state, type) {
  if (type === "h") return state.hEdges;
  if (type === "v") return state.vEdges;
  return null;
}

/**
 * The four edges bounding box (r, c), as {type, r, c} descriptors in the
 * same coordinate system as hEdges/vEdges. Order: top, bottom, left,
 * right. This is the one place that mapping is written down — chain
 * analysis (game/chains.js) reuses it for degree counting instead of
 * re-deriving the same four coordinates a second way.
 */
export function edgesOfBox(r, c) {
  return [
    { type: "h", r, c }, // top
    { type: "h", r: r + 1, c }, // bottom
    { type: "v", r, c }, // left
    { type: "v", r, c: c + 1 }, // right
  ];
}

/**
 * Boxes adjacent to a given edge (1 or 2 of them, fewer on the border).
 * Returns an array of {r, c} box coordinates.
 */
export function getBoxesForEdge(state, type, r, c) {
  const result = [];
  if (type === "h") {
    // hEdges[r][c] borders box above (r-1,c) and box below (r,c)
    if (r - 1 >= 0) result.push({ r: r - 1, c });
    if (r < state.rows) result.push({ r, c });
  } else {
    // vEdges[r][c] borders box left (r,c-1) and box right (r,c)
    if (c - 1 >= 0) result.push({ r, c: c - 1 });
    if (c < state.cols) result.push({ r, c });
  }
  return result;
}

/**
 * A box is complete when all four of its bounding edges are drawn.
 * Always derived on demand — no separate counter is maintained.
 */
export function isBoxComplete(state, r, c) {
  return edgesOfBox(r, c).every(({ type, r: er, c: ec }) => getEdgeGrid(state, type)[er][ec] === true);
}

/**
 * Apply a move: draw the edge, claim any boxes it completes, update the
 * turn manager (extra turn iff at least one box was completed), and
 * check for game over.
 *
 * @param {object} state - game state from createGameState()
 * @param {object} turnManager - from core/turn.js createTurnManager()
 * @param {'h'|'v'} type
 * @param {number} r
 * @param {number} c
 * @returns {{completedBoxes: {r:number,c:number}[], extraTurn: boolean, gameOver: boolean} | null}
 *          null if the move was invalid (should not normally happen if
 *          the caller checked isValidMove()/hit-testing first)
 */
export function applyMove(state, turnManager, type, r, c) {
  if (!isValidMove(state, type, r, c)) return null;

  const player = turnManager.current();
  const edgeGrid = getEdgeGrid(state, type);
  edgeGrid[r][c] = true;
  state.edgesDrawn++;
  state.lastMove = { type, r, c, player };

  const completedBoxes = [];
  for (const box of getBoxesForEdge(state, type, r, c)) {
    if (state.boxes[box.r][box.c] === null && isBoxComplete(state, box.r, box.c)) {
      state.boxes[box.r][box.c] = player;
      state.scores[player]++;
      completedBoxes.push(box);
    }
  }

  const extraTurn = completedBoxes.length > 0;
  turnManager.recordMove({ type, r, c, completedBoxes }, extraTurn);

  if (state.edgesDrawn === state.totalEdges) {
    state.gameOver = true;
    const [s0, s1] = state.scores;
    state.winner = s0 === s1 ? "draw" : s0 > s1 ? 0 : 1;
  }

  return { completedBoxes, extraTurn, gameOver: state.gameOver };
}

/**
 * Inverse of a single applyMove(): un-draw the edge and un-claim any
 * boxes it had completed. This is deliberately the mirror image of
 * applyMove — same edge-grid write, same completedBoxes list — because
 * that's what "state is edges, not counters" (CLAUDE.md section 4) buys:
 * undo never has to reconstruct anything, it just replays the recorded
 * move backwards.
 *
 * Only reverts board state (edges/boxes/scores/gameOver/winner) — it
 * does not touch the turn manager. Callers undoing a whole turn should
 * use core/turn.js's `undoTurn()`, which pops the move-stack entries and
 * hands each one to this function.
 *
 * @param {object} state
 * @param {{type:'h'|'v', r:number, c:number, completedBoxes:{r:number,c:number}[]}} move
 *        - the `move` payload recorded by applyMove()'s recordMove() call
 * @param {number} player - who made this move (owned the completed boxes)
 */
export function undoMove(state, move, player) {
  const { type, r, c, completedBoxes } = move;
  const edgeGrid = getEdgeGrid(state, type);
  edgeGrid[r][c] = false;
  state.edgesDrawn--;

  for (const box of completedBoxes) {
    state.boxes[box.r][box.c] = null;
    state.scores[player]--;
  }

  // Undoing can only ever leave a game IN PROGRESS — a full board
  // (gameOver) requires edgesDrawn === totalEdges, and this always
  // strictly decreases edgesDrawn.
  state.gameOver = false;
  state.winner = null;
}
