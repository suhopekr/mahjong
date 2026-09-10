// test/ai.test.js
// Fixed-position fixtures for game/ai.js's chooseTurnMoves(). Every
// double-cross fixture is played out for real through rules.js's
// applyMove()/turnManager — not just inspected as a move list — because
// the thing actually worth verifying is what happens to the *turn*
// after the sacrifice, not just which edge got drawn.

import { parsePosition } from "../src/game/position.js";
import { createGameState, applyMove } from "../src/game/rules.js";
import { createTurnManager, pickStartingPlayer } from "../src/core/turn.js";
import { chooseTurnMoves } from "../src/game/ai.js";
import { generateQuickStart } from "../src/game/quickstart.js";
import { test, assertEqual, assertTrue } from "./harness.js";

function stateFromPosition(posStr) {
  const parsed = parsePosition(posStr);
  const state = createGameState(parsed.rows, parsed.cols);
  state.hEdges = parsed.hEdges;
  state.vEdges = parsed.vEdges;
  return state;
}

function play(state, tm, moves) {
  for (const m of moves) applyMove(state, tm, m.type, m.r, m.c);
}

// ---------------------------------------------------------------------
// THE scenario: a length-5 chain, single open end, plus a fully safe
// second row so the opponent has somewhere to play after the domino.
//
//   •──•──•  •  •──•──•──•──•──•
//                                (row 0: the chain, boxes (0,0)-(0,4))
//   •──•──•──•──•──•──•
//   |
//   •  •  •  •  •  •              (row 1: untouched safe territory)
//
// (diagram simplified — see the position string for exact edges)
// ---------------------------------------------------------------------
test("Hard double-crosses a length-5 chain: takes 3, sacrifices the FAR edge (not the between-edge)", () => {
  const state = stateFromPosition("2x5|h:0,1,2,3,4,5,6,7,8,9|v:0");
  const tm = createTurnManager(2);

  const moves = chooseTurnMoves(state, 0, "hard");
  assertEqual(moves.length, 4, "3 captures + 1 sacrifice");
  // The sacrifice must be v(0,5) — box (0,4)'s FAR/outer edge — never
  // v(0,4), the edge shared between the last 2 boxes (drawing that one
  // would capture box (0,3) for Hard instead of handing it off).
  assertEqual(moves[3], { type: "v", r: 0, c: 5 });

  play(state, tm, moves);
  assertEqual(state.scores, [3, 0], "Hard captured exactly 3 boxes");
  assertEqual(tm.current(), 1, "turn passed to the opponent after the sacrifice");

  // Opponent's free domino: one edge captures BOTH remaining boxes.
  const oppMoves = chooseTurnMoves(state, 1, "easy");
  play(state, tm, oppMoves);
  assertEqual(state.scores, [3, 2], "opponent captured exactly the 2 sacrificed boxes");
  assertEqual(tm.current(), 0, "*** turn returns to Hard after the opponent's capture + forced safe move ***");
});

// ---------------------------------------------------------------------
// A closed 2x2 loop, opened by one internal edge (making both boxes
// next to it capturable at once), plus 4 more safe boxes elsewhere so
// taking the loop wouldn't already guarantee the win.
// ---------------------------------------------------------------------
test("Hard double-crosses an opened loop: sacrifices ALL 4 immediately (leave-4, not leave-2)", () => {
  const state = createGameState(4, 2);
  state.hEdges[0][0] = true;
  state.hEdges[0][1] = true; // loop's top border
  state.vEdges[0][0] = true;
  state.vEdges[1][0] = true; // loop's left border
  state.vEdges[0][2] = true;
  state.vEdges[1][2] = true; // loop's right border
  state.hEdges[2][0] = true;
  state.hEdges[2][1] = true; // loop's bottom border (also seals off rows 2-3)
  state.vEdges[0][1] = true; // the opening move: both flanking boxes become capturable at once
  const tm = createTurnManager(2);

  const moves = chooseTurnMoves(state, 0, "hard");
  assertEqual(moves.length, 1, "a single non-capturing sacrifice — nothing taken first");
  assertEqual(moves[0], { type: "v", r: 1, c: 1 }, "the middle connector, splitting the loop into two dominoes");

  play(state, tm, moves);
  assertEqual(state.scores, [0, 0], "Hard took none of the loop");
  assertEqual(tm.current(), 1, "turn passed to the opponent");

  const oppMoves = chooseTurnMoves(state, 1, "easy");
  play(state, tm, oppMoves);
  assertEqual(state.scores, [0, 4], "opponent captured all 4 loop boxes (two dominoes)");
  assertEqual(tm.current(), 0, "turn returns to Hard after the loop hand-off");
});

// ---------------------------------------------------------------------
test("Easy and Medium never double-cross — they always take a whole chain", () => {
  for (const difficulty of ["easy", "medium"]) {
    const state = stateFromPosition("2x5|h:0,1,2,3,4,5,6,7,8,9|v:0");
    const tm = createTurnManager(2);
    const moves = chooseTurnMoves(state, 0, difficulty);
    // 5 captures + 1 mandatory non-capturing move afterward (there's
    // still a safe row left, and the 5th capture grants an extra turn).
    assertEqual(moves.length, 6, `${difficulty}: 5 captures then 1 safe move`);
    play(state, tm, moves);
    assertEqual(state.scores[0], 5, `${difficulty} captured the whole chain`);
  }
});

// ---------------------------------------------------------------------
test("exception: a chain that IS the entire remaining board gets taken in full", () => {
  const state = createGameState(1, 5);
  for (let c = 0; c < 5; c++) {
    state.hEdges[0][c] = true;
    state.hEdges[1][c] = true;
  }
  state.vEdges[0][0] = true; // opener; nothing else on the board at all
  const moves = chooseTurnMoves(state, 0, "hard");
  assertEqual(moves.length, 5, "no double-cross — there's nothing left to hand control of");
});

// ---------------------------------------------------------------------
test("exception: taking a chain in full already guarantees the win", () => {
  // 2x6 board. Row 1 (6 boxes) already captured by Hard (score 6-0).
  // Row 0 cols 0-2: an open length-3 chain. Row 0 cols 3-5: untouched
  // safe boxes. remainingBoxes=6, chain.length=3 -> NOT the entire
  // board (the "last structure" exception stays out of this), but
  // 6+3=9 already beats the opponent's best possible 3, so the
  // guaranteed-win exception alone should fire.
  const state = createGameState(2, 6);
  for (let c = 0; c <= 2; c++) state.hEdges[0][c] = true;
  for (let c = 0; c < 6; c++) {
    state.hEdges[1][c] = true;
    state.hEdges[2][c] = true;
  }
  state.vEdges[0][0] = true; // chain opener
  for (let c = 0; c <= 6; c++) state.vEdges[1][c] = true; // row 1 fully closed
  for (let c = 0; c < 6; c++) state.boxes[1][c] = 0; // row 1 owned by Hard
  state.scores = [6, 0];

  const moves = chooseTurnMoves(state, 0, "hard");
  // 3 captures (the whole chain) + 1 mandatory safe move afterward.
  assertEqual(moves.length, 4, "takes the whole chain, no sacrifice");
  assertTrue(
    moves.slice(0, 3).every((m) => m.type === "v" && m.r === 0 && [1, 2, 3].includes(m.c)),
    "the first 3 moves are exactly the chain's own capturing edges"
  );
});

// ---------------------------------------------------------------------
test("rng injection is deterministic, for reproducible tests", () => {
  const state = createGameState(3, 3); // empty board, every edge "safe"
  const always0 = () => 0;
  const a = chooseTurnMoves(state, 0, "easy", always0);
  const b = chooseTurnMoves(state, 0, "easy", always0);
  assertEqual(a, b, "same rng function -> same move");
});

// ---------------------------------------------------------------------
// Two dormant chains (length 2 and length 4) filling the whole board —
// zero captures, zero safe moves anywhere, forcing step 3.
//
//   •──•──•  •  •  •──•──•──•
//            |
//   •──•──•──•──•──•──•
//
// (top-left/right of the wall left open on purpose so drawing the wall
// doesn't accidentally make either flanking box capturable)
// ---------------------------------------------------------------------
function dormantTwoChainBoard() {
  const state = createGameState(1, 6);
  for (let c = 0; c < 6; c++) state.hEdges[1][c] = true;
  state.hEdges[0][0] = true;
  state.hEdges[0][3] = true;
  state.hEdges[0][4] = true;
  state.hEdges[0][5] = true;
  state.vEdges[0][2] = true; // the wall
  return state;
}

test("step 3: Medium and Hard both open the SHORTEST dormant chain when no safe move exists", () => {
  for (const difficulty of ["medium", "hard"]) {
    const state = dormantTwoChainBoard();
    const moves = chooseTurnMoves(state, 0, difficulty);
    assertEqual(moves.length, 1, `${difficulty}: a single opening move`);
    assertEqual(
      moves[0],
      { type: "v", r: 0, c: 0 },
      `${difficulty} opens the length-2 chain (not the length-4 one) from its border edge`
    );
  }
});

test("step 3: a lone isolated dormant box (length-1 chain) is opened without crashing", () => {
  // Three boxes, each walled off from its neighbors, each with both
  // remaining edges leading straight to outer — three separate length-1
  // chains, no safe moves anywhere. openShortestStructure() has no
  // "second box" to compare against here, unlike a length->=2 chain.
  const state = createGameState(1, 3);
  for (let c = 0; c <= 3; c++) state.vEdges[0][c] = true; // wall every box off from its neighbors
  const moves = chooseTurnMoves(state, 0, "hard");
  assertEqual(moves.length, 1, "a single opening move, not a crash");
  assertTrue(
    moves[0].type === "h" && moves[0].r === 0 && moves[0].c === 0,
    "opens one of the (tied-shortest) isolated boxes"
  );
});

test("step 3: Easy ignores chain length — a uniformly random edge, not necessarily the shortest chain", () => {
  const state = dormantTwoChainBoard();
  // rng biased to the far end of the undrawn-edge list, landing on the
  // long chain's own far border — proves Easy has no length preference.
  const moves = chooseTurnMoves(state, 0, "easy", () => 0.999999);
  assertEqual(moves.length, 1);
  assertTrue(
    !(moves[0].type === "v" && moves[0].r === 0 && moves[0].c === 0),
    "Easy is not guaranteed to pick the shorter chain the way medium/hard do"
  );
});

// ---------------------------------------------------------------------
test("a turn that finishes the entire board mid-cascade stops cleanly (no crash, no phantom move)", () => {
  // A lone length-3 chain with nothing else on the board at all: taking
  // the last box also ends the game. chooseTurnMoves must not try to
  // find a "next" move that doesn't exist.
  const state = createGameState(1, 3);
  for (let c = 0; c < 3; c++) {
    state.hEdges[0][c] = true;
    state.hEdges[1][c] = true;
  }
  state.vEdges[0][0] = true; // opener
  const moves = chooseTurnMoves(state, 0, "easy");
  assertEqual(moves.length, 3, "exactly the 3 capturing moves, nothing appended after the board is full");
});

// ---------------------------------------------------------------------
test("chooseTurnMoves refuses to run on an already-finished game", () => {
  const state = createGameState(1, 1);
  state.hEdges[0][0] = true;
  state.hEdges[1][0] = true;
  state.vEdges[0][0] = true;
  state.vEdges[0][1] = true;
  state.gameOver = true;
  let threw = false;
  try {
    chooseTurnMoves(state, 0, "easy");
  } catch (err) {
    threw = true;
    assertTrue(/finished game/.test(err.message));
  }
  assertTrue(threw, "expected chooseTurnMoves to throw");
});

// ---------------------------------------------------------------------
// The coin flip (core/turn.js's pickStartingPlayer) means the AI can be
// asked to make the very first move of the game, not just respond to
// one. chooseTurnMoves() has no special-casing for "am I moving first"
// — it just reads whatever state it's handed — but that's exactly the
// assumption worth pinning down with a real test, since main.js relies
// on it: whichever player the coin flip picks, if that's the AI, its
// turn has to fire correctly with zero moves played yet.
test("AI moving first on a totally empty board: a normal step-2 safe move, no captures to consider", () => {
  const state = createGameState(5, 5);
  const tm = createTurnManager(2, 0); // coin flip landed on the AI going first
  assertEqual(tm.current(), 0, "AI (player 0) is up before anyone has moved");

  const moves = chooseTurnMoves(state, 0, "medium", () => 0);
  assertEqual(moves.length, 1, "an empty board has no captures — a single safe move");
  assertTrue(state.edgesDrawn === 0, "chooseTurnMoves must not mutate the real state, only plan against a copy");

  const r = applyMove(state, tm, moves[0].type, moves[0].r, moves[0].c);
  assertTrue(!r.extraTurn, "a safe move on an empty board never completes a box");
  assertEqual(tm.current(), 1, "turn passes to the human after the AI's opening move");
});

test("AI moving first on a Quick Start board: still has to make a real decision, not just a random opener", () => {
  // Quick Start pre-fills edges but guarantees zero capturable boxes
  // (game/quickstart.js's whole contract), so the AI's very first move
  // must land in step 2 (safe move) or step 3 (sacrifice) — never a
  // capture — regardless of how much of the board is already drawn.
  const rng = (() => {
    let seed = 555;
    return () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  })();
  const state = generateQuickStart(5, 5, rng);
  const tm = createTurnManager(2, 0);

  const moves = chooseTurnMoves(state, 0, "hard", rng);
  assertTrue(moves.length >= 1, "the AI always finds a legal move as player 0 on move 1");

  const before = state.edgesDrawn;
  for (const m of moves) applyMove(state, tm, m.type, m.r, m.c);
  assertTrue(state.edgesDrawn > before, "at least one edge actually got drawn");
});

test("pickStartingPlayer feeding straight into chooseTurnMoves: whichever player it picks, that player can move", () => {
  for (const coinFlipRng of [() => 0, () => 0.999999]) {
    const startingPlayer = pickStartingPlayer(2, coinFlipRng);
    const state = createGameState(3, 3);
    const tm = createTurnManager(2, startingPlayer);
    assertEqual(tm.current(), startingPlayer);

    // Whichever player the coin flip picked, they should be able to
    // move immediately — including when that's player 0 (the AI, in
    // main.js's setup) on a completely untouched board.
    const moves = chooseTurnMoves(state, startingPlayer, "easy", () => 0);
    assertTrue(moves.length >= 1);
  }
});
