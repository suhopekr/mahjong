// game/ai.js
// The 3-stage decision pipeline (capture -> safe move -> sacrifice),
// built on top of game/chains.js's analyze(). No minimax, no parity —
// see CLAUDE.md section 6 for why chain heuristics are the whole plan.
//
// chooseTurnMoves(state, player, difficulty) plans a PLAYER'S ENTIRE
// TURN at once — every edge it will draw, in order, as an array —
// rather than one edge at a time against the live game state. That's
// not a style choice, it's required for the double-cross to be correct.
//
// Here's why: deciding to "take 3, sacrifice 2" out of a 5-chain has to
// be made knowing the chain was 5 long BEFORE any of it was eaten. Once
// 3 boxes are gone, analyze() on the live board reports the 2 that are
// left as an ordinary length-2 chain — structurally IDENTICAL to a
// fresh, never-touched 2-box chain (both present as "one capturable
// end, one degree-2 end"). Nothing in that position still says "this
// used to be 5 long." A per-move decision re-derived from the live
// board at that point cannot tell the two apart, and "take all of a
// length-2 chain" (correct for a fresh one) is exactly the wrong call
// for a double-cross tail. Planning the whole turn against a private
// scratch copy sidesteps this: the chain's true remaining length is
// looked up exactly once, the moment the plan for it is made, while it
// still remembers everything it's about to forget.

import { edgesOfBox, getEdgeGrid, getBoxesForEdge, isBoxComplete } from "./rules.js";
import { analyze } from "./chains.js";

/**
 * Plan every edge `player` will draw this turn, in order.
 *
 * @param {object} state - a rules.js game state (only rows/cols/hEdges/
 *   vEdges/boxes/scores are read — never mutated)
 * @param {0|1} player - which player is moving
 * @param {'easy'|'medium'|'hard'} difficulty
 * @param {() => number} [rng] - injected for deterministic tests;
 *   defaults to Math.random. Must return a value in [0, 1).
 * @returns {{type:'h'|'v', r:number, c:number}[]} at least one move
 */
export function chooseTurnMoves(state, player, difficulty, rng = Math.random) {
  if (state.gameOver) {
    throw new Error("chooseTurnMoves: called on a finished game — nothing left to move.");
  }

  const scratch = cloneState(state);
  const opponent = player === 0 ? 1 : 0;
  const moves = [];

  // Set once, the first time this turn's loop encounters a given chain
  // (identified by its original box set) — see the module comment for
  // why this can't be re-derived fresh on every iteration instead.
  let activePlan = null;

  while (true) {
    const board = analyze(scratch);

    if (board.capturableBoxes.length === 0) {
      if (board.safeMoves.length === 0 && board.chains.length === 0 && board.loops.length === 0) {
        // The capture(s) that just happened finished the entire board —
        // there is no edge left to draw at all, capturing or otherwise.
        break;
      }
      const edge = chooseNonCapturingMove(scratch, board, difficulty, rng);
      moves.push(edge);
      break; // never a capture, so the turn always ends here
    }

    const box = pickCapturableBox(board, activePlan);

    if (difficulty === "hard") {
      if (!activePlan || !activePlan.boxKeys.has(keyOf(box.r, box.c))) {
        activePlan = buildHardPlan(scratch, board, box, player, opponent);
      }

      if (activePlan.taken >= activePlan.takeCount) {
        const edge = sacrificeEdge(scratch, board, activePlan);
        moves.push(edge);
        applyScratchMove(scratch, edge, player);
        activePlan = null;
        break; // the sacrifice is always non-capturing -> turn ends
      }
    }

    const edge = edgeThatCaptures(scratch, box);
    const completed = applyScratchMove(scratch, edge, player);
    moves.push(edge);
    if (completed.length === 0) {
      throw new Error(
        `chooseTurnMoves: edge ${JSON.stringify(edge)} was supposed to capture box ` +
          `(${box.r},${box.c}) but completed nothing — algorithm invariant violated.`
      );
    }
    if (activePlan) activePlan.taken++;
  }

  return moves;
}

function keyOf(r, c) {
  return `${r},${c}`;
}

/**
 * Which capturable box to process next. If we're mid-plan for a
 * specific chain (Hard only), stay on that chain even if a different,
 * unrelated chain also has a capturable box right now — otherwise
 * `activePlan`'s take-count would get attributed to the wrong chain.
 */
function pickCapturableBox(board, activePlan) {
  if (activePlan) {
    const match = board.capturableBoxes.find((b) => activePlan.boxKeys.has(keyOf(b.r, b.c)));
    if (match) return match;
  }
  return board.capturableBoxes[0];
}

/**
 * Decide, once, what Hard is doing with the chain `box` belongs to:
 * take it all, or take all-but-N and hand the rest over. N is 2 for a
 * plain chain, 4 for a chain that was still a closed loop the moment
 * this turn started (see isLoopOrigin for how that's told apart from
 * an ordinary chain of the same length).
 */
function buildHardPlan(scratch, board, box, player, opponent) {
  const chain = findChainContaining(board, box);
  const boxKeys = new Set(chain.boxes.map((b) => keyOf(b.r, b.c)));
  const isLoop = isLoopOrigin(scratch, chain);
  const sacrificeSize = isLoop ? 4 : 2;

  // Chains of length <= 2 always get taken outright (CLAUDE.md's table:
  // "체인 길이≤2 → 전부 딴다") — sacrificing a 2-chain isn't a trade,
  // it's just giving it away. Loops don't get that exemption at their
  // minimum size (4): even a bare 4-loop is still worth the full
  // points-for-control trade, so a loop only needs length >= 4 (not
  // strictly greater) to be double-cross eligible — a length-4 loop's
  // plan is simply "take 0, sacrifice all 4 immediately."
  const eligibleToDoubleCross = isLoop ? chain.length >= sacrificeSize : chain.length > sacrificeSize;

  const shouldDoubleCross =
    eligibleToDoubleCross &&
    !isEntireRemainingBoard(scratch, chain) && // exception 1: nothing left to hand control of -> take all
    !wouldAlreadyGuaranteeWin(scratch, chain, player, opponent); // exception 2: already won -> take all

  return {
    boxKeys,
    takeCount: shouldDoubleCross ? chain.length - sacrificeSize : chain.length,
    taken: 0,
  };
}

/**
 * A chain is loop-derived iff BOTH its current endpoints are already
 * capturable simultaneously. A live loop (still closed) never appears
 * here at all — the moment anyone draws one of its edges it stops being
 * a pure cycle and analyze() reports it as an ordinary chain (see
 * chains.js's module comment). But that first opening move makes BOTH
 * boxes adjacent to it capturable at once — two simultaneously-open
 * ends is not something an ordinary (never-was-a-loop) chain produces
 * under normal play, since opening one end of a plain chain is a
 * non-capturing move that ends the opener's turn immediately, so they
 * can't also open the far end in the same turn.
 */
function isLoopOrigin(scratch, chain) {
  if (chain.boxes.length < 4) return false; // loops are never shorter than 4
  const first = chain.boxes[0];
  const last = chain.boxes[chain.boxes.length - 1];
  return degreeOf(scratch, first) === 1 && degreeOf(scratch, last) === 1;
}

function degreeOf(scratch, box) {
  return edgesOfBox(box.r, box.c).filter(
    ({ type, r, c }) => getEdgeGrid(scratch, type)[r][c] === false
  ).length;
}

/**
 * Exception 1: this structure IS every remaining box on the board — no
 * other chain, loop, or untouched safe territory exists to hand control
 * of. Note this is deliberately stricter than "is it the only chain
 * analyze() currently reports": leftover safe (degree 3-4) territory
 * still counts as "something to hand off," even though it hasn't been
 * shaped into a chain yet, because it eventually will be. Only an empty
 * board beyond this one structure makes the sacrifice truly pointless.
 */
function isEntireRemainingBoard(scratch, structure) {
  const totalBoxes = scratch.rows * scratch.cols;
  const capturedSoFar = scratch.scores[0] + scratch.scores[1];
  const remainingBoxes = totalBoxes - capturedSoFar;
  return structure.length === remainingBoxes;
}

/** Exception 2: taking this whole structure already guarantees the win,
 * even in the opponent's best case (they get every other remaining box
 * on the board) — no need to fight for control anymore. */
function wouldAlreadyGuaranteeWin(scratch, structure, player, opponent) {
  const totalBoxes = scratch.rows * scratch.cols;
  const capturedSoFar = scratch.scores[0] + scratch.scores[1];
  const remainingBoxes = totalBoxes - capturedSoFar;
  const myScoreIfTakeAll = scratch.scores[player] + structure.length;
  const opponentBestCase = scratch.scores[opponent] + (remainingBoxes - structure.length);
  return myScoreIfTakeAll > opponentBestCase;
}

function findChainContaining(board, box) {
  const chain = board.chains.find((c) => c.boxes.some((b) => b.r === box.r && b.c === box.c));
  if (!chain) {
    // A capturable (degree-1) box can never be part of a loop entry —
    // loops are pure degree-2 cycles by construction (see chains.js) —
    // so it must always be found here.
    throw new Error(
      `chooseTurnMoves: capturable box (${box.r},${box.c}) wasn't found in any chain — algorithm invariant violated.`
    );
  }
  return chain;
}

/**
 * The edge that finishes off an already-capturable (degree-1) box: its
 * one remaining undrawn edge.
 */
function edgeThatCaptures(scratch, box) {
  const undrawn = edgesOfBox(box.r, box.c).filter(
    ({ type, r, c }) => getEdgeGrid(scratch, type)[r][c] === false
  );
  if (undrawn.length !== 1) {
    throw new Error(
      `chooseTurnMoves: box (${box.r},${box.c}) has ${undrawn.length} undrawn edges, expected exactly 1.`
    );
  }
  return undrawn[0];
}

/**
 * Compute the sacrifice ("domino") move for the chain/loop `activePlan`
 * is currently finishing. This is the move CLAUDE.md's design notes
 * warned is easy to get backwards: for a plain chain's last 2 boxes,
 * the edge to draw is the FAR end's outer edge — the one that does NOT
 * touch the already-capturable box — never the edge BETWEEN the two
 * remaining boxes. Drawing the between-edge would complete the near box
 * immediately (it's that box's last edge), capturing it for yourself
 * and keeping your own turn — the opposite of a hand-off.
 */
function sacrificeEdge(scratch, board, activePlan) {
  const near = board.capturableBoxes.find((b) => activePlan.boxKeys.has(keyOf(b.r, b.c)));
  const chain = findChainContaining(board, near);

  if (chain.boxes.length === 2) {
    const far = chain.boxes.find((b) => !(b.r === near.r && b.c === near.c));
    const dominoEdge = sharedEdgeBetween(scratch, near, far);
    const farUndrawn = edgesOfBox(far.r, far.c).filter(
      ({ type, r, c }) => getEdgeGrid(scratch, type)[r][c] === false
    );
    const sacrifice = farUndrawn.find((e) => !edgesEqual(e, dominoEdge));
    if (!sacrifice) {
      throw new Error(
        `chooseTurnMoves: could not find a far-end sacrifice edge for the last 2 boxes of a chain — algorithm invariant violated.`
      );
    }
    return sacrifice;
  }

  if (chain.boxes.length === 4) {
    // Loop leave-4: draw the edge between the two MIDDLE boxes, splitting
    // the remaining 4 into two independent 2-box dominoes for the
    // opponent — neither middle box gets completed by this move (both
    // go from degree 2 to degree 1), so it's non-capturing, same as the
    // plain 2-box case.
    return sharedEdgeBetween(scratch, chain.boxes[1], chain.boxes[2]);
  }

  throw new Error(
    `chooseTurnMoves: sacrificeEdge called with a ${chain.boxes.length}-box remainder — expected 2 (chain) or 4 (loop).`
  );
}

function sharedEdgeBetween(scratch, boxA, boxB) {
  const undrawnA = edgesOfBox(boxA.r, boxA.c).filter(
    ({ type, r, c }) => getEdgeGrid(scratch, type)[r][c] === false
  );
  const shared = undrawnA.find((edge) =>
    getBoxesForEdge(scratch, edge.type, edge.r, edge.c).some((b) => b.r === boxB.r && b.c === boxB.c)
  );
  if (!shared) {
    throw new Error(
      `chooseTurnMoves: no shared undrawn edge between (${boxA.r},${boxA.c}) and (${boxB.r},${boxB.c}) — algorithm invariant violated.`
    );
  }
  return shared;
}

function edgesEqual(a, b) {
  return a.type === b.type && a.r === b.r && a.c === b.c;
}

/**
 * Step 2 (safe move) / step 3 (sacrifice), reached once there's nothing
 * left to capture this turn.
 *
 *   Easy:          random safe move; if none, a fully random edge.
 *   Medium / Hard: random safe move; if none, open the shortest
 *                  remaining chain/loop (least boxes handed over).
 *
 * Medium and Hard share the same sacrifice choice here — CLAUDE.md's
 * "손해 적은 쪽 끝에서" nuance for Hard would need the parity-style
 * reasoning the design notes explicitly say to skip, so both just pick
 * the shortest structure and open it from an arbitrary end.
 */
function chooseNonCapturingMove(scratch, board, difficulty, rng) {
  if (board.safeMoves.length > 0) {
    return pickRandom(board.safeMoves, rng);
  }
  if (difficulty === "easy") {
    return pickRandom(allUndrawnEdges(scratch), rng);
  }
  return openShortestStructure(scratch, board);
}

function pickRandom(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function allUndrawnEdges(scratch) {
  const edges = [];
  for (let r = 0; r <= scratch.rows; r++) {
    for (let c = 0; c < scratch.cols; c++) {
      if (!scratch.hEdges[r][c]) edges.push({ type: "h", r, c });
    }
  }
  for (let r = 0; r < scratch.rows; r++) {
    for (let c = 0; c <= scratch.cols; c++) {
      if (!scratch.vEdges[r][c]) edges.push({ type: "v", r, c });
    }
  }
  return edges;
}

function openShortestStructure(scratch, board) {
  const structures = [...board.chains, ...board.loops].sort(
    (a, b) => a.length - b.length || Number(a.isLoop) - Number(b.isLoop)
  );
  const target = structures[0];
  const first = target.boxes[0];
  const undrawn = edgesOfBox(first.r, first.c).filter(
    ({ type, r, c }) => getEdgeGrid(scratch, type)[r][c] === false
  );

  if (target.boxes.length === 1) {
    // An isolated dormant box, both remaining edges leading to outer or
    // a safe neighbor — neither is "more internal" than the other, so
    // just draw either one.
    return undrawn[0];
  }

  const second = target.boxes[1];
  const internal = sharedEdgeBetween(scratch, first, second);
  return undrawn.find((e) => !edgesEqual(e, internal)) || undrawn[0];
}

function cloneState(state) {
  return {
    rows: state.rows,
    cols: state.cols,
    hEdges: state.hEdges.map((row) => row.slice()),
    vEdges: state.vEdges.map((row) => row.slice()),
    boxes: state.boxes.map((row) => row.slice()),
    scores: state.scores.slice(),
  };
}

function applyScratchMove(scratch, edge, player) {
  const grid = getEdgeGrid(scratch, edge.type);
  grid[edge.r][edge.c] = true;
  const completed = [];
  for (const box of getBoxesForEdge(scratch, edge.type, edge.r, edge.c)) {
    if (scratch.boxes[box.r][box.c] === null && isBoxComplete(scratch, box.r, box.c)) {
      scratch.boxes[box.r][box.c] = player;
      scratch.scores[player]++;
      completed.push(box);
    }
  }
  return completed;
}
