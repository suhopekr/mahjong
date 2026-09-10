import { createGameState, applyMove, undoMove, isValidMove } from "../src/game/rules.js";
import { createTurnManager } from "../src/core/turn.js";
import { computeLayout, dotPosition } from "../src/core/grid.js";
import { serializePosition } from "../src/game/position.js";
import { test, assertEqual, assertTrue } from "./harness.js";

test("1x1: drawing the 4th edge completes the box and grants an extra turn", () => {
  const state = createGameState(1, 1);
  const tm = createTurnManager(2);
  assertEqual(state.totalEdges, 4);

  applyMove(state, tm, "h", 0, 0);
  assertEqual(tm.current(), 1, "turn passes after a non-completing move");

  applyMove(state, tm, "v", 0, 0);
  assertEqual(tm.current(), 0);

  applyMove(state, tm, "v", 0, 1);
  assertEqual(tm.current(), 1);

  const r = applyMove(state, tm, "h", 1, 0);
  assertEqual(r.completedBoxes.length, 1);
  assertTrue(r.extraTurn, "completing a box grants an extra turn");
  assertEqual(tm.current(), 1, "extra turn keeps the same player");
  assertEqual(state.scores, [0, 1]);
  assertTrue(state.gameOver);
  assertEqual(state.winner, 1);
});

test("1x2: one edge can complete two boxes at once", () => {
  const state = createGameState(1, 2);
  const tm = createTurnManager(2);
  applyMove(state, tm, "h", 0, 0);
  applyMove(state, tm, "h", 0, 1);
  applyMove(state, tm, "h", 1, 0);
  applyMove(state, tm, "h", 1, 1);
  applyMove(state, tm, "v", 0, 0);
  applyMove(state, tm, "v", 0, 2);
  assertEqual(state.boxes[0][0], null);
  assertEqual(state.boxes[0][1], null);

  const scorer = tm.current();
  const r = applyMove(state, tm, "v", 0, 1);
  assertEqual(r.completedBoxes.length, 2, "the shared middle edge completes both boxes");
  assertEqual(state.scores[scorer], 2, "same player gets both boxes");
  assertTrue(state.gameOver);
});

test("invalid moves are rejected without mutating state", () => {
  const state = createGameState(2, 2);
  const tm = createTurnManager(2);
  assertTrue(isValidMove(state, "h", 0, 0));
  applyMove(state, tm, "h", 0, 0);
  assertTrue(!isValidMove(state, "h", 0, 0), "already-drawn edge is invalid");
  assertEqual(applyMove(state, tm, "h", 0, 0), null, "applyMove refuses a drawn edge");
  assertTrue(!isValidMove(state, "h", 5, 5), "out-of-bounds edge is invalid");
});

test("turn manager: undo restores whose turn it was", () => {
  const tm = createTurnManager(2);
  tm.recordMove({ x: 1 }, false);
  assertEqual(tm.current(), 1);
  tm.recordMove({ x: 2 }, true);
  assertEqual(tm.current(), 1, "extra turn keeps the mover");

  const popped = tm.undoLast();
  assertEqual(popped.move.x, 2);
  assertEqual(tm.current(), 1, "restored to whoever made the popped move");

  tm.undoLast();
  assertEqual(tm.current(), 0);
});

test("undoMove: a non-completing edge is un-drawn and edgesDrawn decrements", () => {
  const state = createGameState(2, 2);
  const tm = createTurnManager(2);
  applyMove(state, tm, "h", 0, 0);
  assertEqual(state.edgesDrawn, 1);

  const last = tm.peekLast();
  undoMove(state, last.move, last.player);
  assertTrue(isValidMove(state, "h", 0, 0), "the edge is undrawn again");
  assertEqual(state.edgesDrawn, 0);
});

test("undoMove: a box-completing move un-claims the box and refunds the score", () => {
  const state = createGameState(1, 1);
  const tm = createTurnManager(2);
  applyMove(state, tm, "h", 0, 0);
  applyMove(state, tm, "v", 0, 0);
  applyMove(state, tm, "v", 0, 1);
  applyMove(state, tm, "h", 1, 0);
  assertEqual(state.scores, [0, 1]);
  assertTrue(state.gameOver);

  const last = tm.peekLast();
  undoMove(state, last.move, last.player);
  assertEqual(state.boxes[0][0], null);
  assertEqual(state.scores, [0, 0]);
  assertTrue(!state.gameOver, "undoing the winning move reopens the game");
  assertEqual(state.winner, null);
});

test("undoMove: a move completing two boxes at once refunds both", () => {
  const state = createGameState(1, 2);
  const tm = createTurnManager(2);
  applyMove(state, tm, "h", 0, 0);
  applyMove(state, tm, "h", 0, 1);
  applyMove(state, tm, "h", 1, 0);
  applyMove(state, tm, "h", 1, 1);
  applyMove(state, tm, "v", 0, 0);
  applyMove(state, tm, "v", 0, 2);
  const scorer = tm.current();
  const r = applyMove(state, tm, "v", 0, 1);
  assertEqual(r.completedBoxes.length, 2);
  assertEqual(state.scores[scorer], 2);

  const last = tm.peekLast();
  undoMove(state, last.move, last.player);
  assertEqual(state.boxes[0][0], null);
  assertEqual(state.boxes[0][1], null);
  assertEqual(state.scores[scorer], 0);
});

test("turnManager.undoTurn() + rules.undoMove() together restore the EXACT pre-turn position", () => {
  // A full 1x1 game: the whole game is a single turn (the one move that
  // completes the only box never passes the turn). Undoing it via the
  // same pairing main.js uses should land back on an untouched board.
  const state = createGameState(1, 1);
  const tm = createTurnManager(2);
  applyMove(state, tm, "h", 0, 0); // -> player 1
  applyMove(state, tm, "v", 0, 0); // -> player 0
  applyMove(state, tm, "v", 0, 1); // -> player 1

  const before = serializePosition(state);
  applyMove(state, tm, "h", 1, 0); // completes the box, wins the game
  assertTrue(state.gameOver);

  tm.undoTurn((entry) => undoMove(state, entry.move, entry.player));

  assertEqual(serializePosition(state), before, "edges match the pre-completion position exactly");
  assertEqual(state.scores, [0, 0]);
  assertEqual(state.boxes[0][0], null);
  assertTrue(!state.gameOver);
  assertEqual(state.winner, null);
  assertEqual(tm.current(), 1, "turn handed back to whoever made the completing move");
});

test("grid layout: dot positions increase monotonically with row/col", () => {
  const layout = computeLayout(5, 5, 500, 500, 20);
  assertTrue(layout.cellSize > 0);
  const p00 = dotPosition(layout, 0, 0);
  const p55 = dotPosition(layout, 5, 5);
  assertTrue(p00.x < p55.x && p00.y < p55.y);
});
