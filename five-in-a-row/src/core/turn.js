// core/turn.js
// Generic turn manager: whose turn it is, and a stack of past moves.
// Game-agnostic: it does not know what a "move" contains, only whether
// the current player keeps their turn (extraTurn) or it passes. Dots and
// Boxes uses extraTurn when a box is completed; Gomoku will simply never
// pass extraTurn = true.
//
// The move stack is the foundation for undo: undoLast() pops the most
// recent move and restores whose turn it was. Wiring undo into the UI is
// a later milestone; the mechanism lives here from the start so game code
// never has to touch a separate "box count" or duplicate state for it.

export function createTurnManager(playerCount = 2, startingPlayer = 0) {
  let currentPlayer = startingPlayer;
  const history = [];

  function current() {
    return currentPlayer;
  }

  /**
   * Record a completed move and advance turn unless extraTurn is true.
   * `move` is an opaque payload owned by the game layer (e.g. edge type
   * + coordinates + which boxes it completed).
   */
  function recordMove(move, extraTurn) {
    const entry = { move, player: currentPlayer, extraTurn: !!extraTurn };
    history.push(entry);
    if (!extraTurn) {
      currentPlayer = (currentPlayer + 1) % playerCount;
    }
    return entry;
  }

  /**
   * Undo the most recent move: pops it off the stack and restores
   * currentPlayer to whoever made that move. Returns the popped entry
   * (or null if history is empty) so the game layer can revert its own
   * board state accordingly.
   */
  function undoLast() {
    const entry = history.pop();
    if (!entry) return null;
    currentPlayer = entry.player;
    return entry;
  }

  function peekLast() {
    return history.length ? history[history.length - 1] : null;
  }

  function getHistory() {
    return history;
  }

  function reset() {
    currentPlayer = startingPlayer;
    history.length = 0;
  }

  /**
   * Undo an entire TURN, not just the last move. Dots and Boxes turns can
   * span several moves — every captured box grants another move — so
   * undoing a single edge can leave a chain or a double-cross half
   * reverted. This pops entries with undoLast() repeatedly until the
   * player changes, i.e. exactly until the whole run of moves made by
   * whoever moved last has been undone (CLAUDE.md's design notes call
   * for this precise loop). Each popped entry is handed to `onUndo` so
   * the game layer can revert its own board state for it (this module
   * doesn't know what a move contains).
   *
   * Game-agnostic: a game that never grants extra turns (e.g. a future
   * Gomoku) always has exactly one entry per turn, so this degrades to
   * undoing a single move.
   *
   * @param {(entry: {move: any, player: number, extraTurn: boolean}) => void} [onUndo]
   * @returns {boolean} true if anything was undone, false if history was empty
   */
  function undoTurn(onUndo) {
    const last = peekLast();
    if (!last) return false;
    const targetPlayer = last.player;
    let entry;
    while ((entry = peekLast()) && entry.player === targetPlayer) {
      undoLast();
      if (onUndo) onUndo(entry);
    }
    return true;
  }

  return {
    current,
    recordMove,
    undoLast,
    undoTurn,
    peekLast,
    getHistory,
    reset,
  };
}

/**
 * Randomly choose who goes first among `playerCount` players — a coin
 * flip for the 2-player case. Exists because turn-based games like Dots
 * and Boxes can have a structural first-player (dis)advantage — here,
 * it's the long-chain rule interacting with grid parity — that's too
 * subtle to explain to a casual player. Randomizing who starts sidesteps
 * needing a compensation rule (a pie rule, say) that nobody would
 * understand without an explainer they won't read.
 *
 * @param {number} playerCount
 * @param {() => number} [rng] - injected for deterministic tests;
 *   defaults to Math.random. Must return a value in [0, 1) — same
 *   contract as game/ai.js's and game/quickstart.js's rng parameter.
 * @returns {number} a player index in [0, playerCount)
 */
export function pickStartingPlayer(playerCount, rng = Math.random) {
  return Math.floor(rng() * playerCount);
}
