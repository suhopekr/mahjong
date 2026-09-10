// test/chains.test.js
// Fixed-position fixtures for game/chains.js's dual-graph analyze(),
// built with the position loader (game/position.js) instead of playing
// out moves by hand. Each fixture's ASCII diagram was generated
// directly from parsePosition() (not hand-drawn), so what's in the
// comment is exactly what the test actually loads.
//
// Every returned chains[]/loops[] box order is deterministic (see
// chains.js's tracePath/traceCycle), so fixtures assert exact arrays,
// not just set membership — a box landing in the wrong position in the
// path is exactly the kind of bug this is meant to catch.

import { parsePosition } from "../src/game/position.js";
import { analyze } from "../src/game/chains.js";
import { test, assertEqual } from "./harness.js";

// ---------------------------------------------------------------------
// Fixture 1: initial state — no chains, no loops, everything is safe.
//
//   •  •  •  •
//
//   •  •  •  •
//
//   •  •  •  •
//
//   •  •  •  •
// ---------------------------------------------------------------------
test("fixture 1: empty board has no chains, no loops, no captures — everything is safe", () => {
  const pos = parsePosition("3x3");
  const result = analyze(pos);

  assertEqual(result.capturableBoxes, []);
  assertEqual(result.chains, []);
  assertEqual(result.loops, []);
  // (rows+1)*cols + rows*(cols+1) = 4*3 + 3*4 = 24, every edge touches
  // only degree-4 boxes, so every edge is safe.
  assertEqual(result.safeMoves.length, 24);
});

// ---------------------------------------------------------------------
// Fixture 2: exactly one length-1 chain — box (0,0) is already
// capturable, isolated (its one open edge is a border, not a link to
// another chain box).
//
//   •  •  •  •
//   |  |
//   •──•  •  •
//
//   •  •  •  •
//
//   •  •  •  •
// ---------------------------------------------------------------------
test("fixture 2: a single capturable box is a length-1 chain, nothing else", () => {
  const pos = parsePosition("3x3|h:3|v:0,1");
  const result = analyze(pos);

  assertEqual(result.capturableBoxes, [{ r: 0, c: 0 }]);
  assertEqual(result.chains, [{ boxes: [{ r: 0, c: 0 }], length: 1, isLoop: false }]);
  assertEqual(result.loops, []);
  // Every edge is safe except the one that captures box (0,0) itself.
  assertEqual(result.safeMoves.length, 20);
  assertEqual(
    result.safeMoves.some((e) => e.type === "h" && e.r === 0 && e.c === 0),
    false,
    "the capturing edge itself must not show up as a safe move"
  );
});

// ---------------------------------------------------------------------
// Fixture 3: one dormant length-3 chain — a sealed 1x3 corridor, both
// ends open to the boundary. No box is capturable yet (all degree 2).
//
//   •──•──•──•
//
//   •──•──•──•
// ---------------------------------------------------------------------
test("fixture 3: one dormant length-3 chain, no captures, no safe moves left", () => {
  const pos = parsePosition("1x3|h:0,1,2,3,4,5");
  const result = analyze(pos);

  assertEqual(result.capturableBoxes, []);
  assertEqual(result.chains, [
    {
      boxes: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }],
      length: 3,
      isLoop: false,
    },
  ]);
  assertEqual(result.loops, []);
  // Every remaining edge touches a degree-2 box (the chain itself) —
  // there's no untouched territory left on this tiny board.
  assertEqual(result.safeMoves, []);
});

// ---------------------------------------------------------------------
// Fixture 4: two separate dormant length-3 chains, split by a single
// drawn "wall" edge (the middle vertical line). Neither inner end is
// capturable because their tops are left open to the boundary instead
// of sealed.
//
//   •──•──•  •  •──•──•
//            |
//   •──•──•──•──•──•──•
// ---------------------------------------------------------------------
test("fixture 4: two dormant length-3 chains stay separate across the wall", () => {
  const pos = parsePosition("1x6|h:0,1,4,5,6,7,8,9,10,11|v:3");
  const result = analyze(pos);

  assertEqual(result.capturableBoxes, []);
  assertEqual(result.chains, [
    {
      boxes: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }],
      length: 3,
      isLoop: false,
    },
    {
      boxes: [{ r: 0, c: 3 }, { r: 0, c: 4 }, { r: 0, c: 5 }],
      length: 3,
      isLoop: false,
    },
  ]);
  assertEqual(result.loops, []);
  assertEqual(result.safeMoves, []);
});

// ---------------------------------------------------------------------
// Fixture 5: one loop — a sealed 2x2 block with all four internal walls
// open, all four boundary walls drawn. isLoop true, length 4 (the
// minimum possible — grid box-adjacency is bipartite, so no shorter
// cycle can exist).
//
//   •──•──•
//   |     |
//   •  •  •
//   |     |
//   •──•──•
// ---------------------------------------------------------------------
test("fixture 5: a sealed 2x2 block is a single loop of length 4, not a chain", () => {
  const pos = parsePosition("2x2|h:0,1,4,5|v:0,2,3,5");
  const result = analyze(pos);

  assertEqual(result.capturableBoxes, []);
  assertEqual(result.chains, []);
  assertEqual(result.loops, [
    {
      boxes: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 1 }, { r: 1, c: 0 }],
      length: 4,
      isLoop: true,
    },
  ]);
  assertEqual(result.safeMoves, []);
});

// ---------------------------------------------------------------------
// Fixture 6: a loop and a chain coexist on the same board, with an
// untouched "gap" column of safe territory (degree 3) separating them —
// the gap is what keeps this from becoming one tangled component, and
// it's also the only source of safe moves in this fixture.
//
//   •──•──•  •──•──•──•
//   |     |
//   •  •  •  •──•──•──•
//   |     |
//   •──•──•  •  •  •  •
// ---------------------------------------------------------------------
test("fixture 6: a loop and a chain are detected independently, with safe moves in the gap", () => {
  const pos = parsePosition("2x6|h:0,1,3,4,5,9,10,11,12,13|v:0,2,7,9");
  const result = analyze(pos);

  assertEqual(result.capturableBoxes, []);
  assertEqual(result.chains, [
    {
      boxes: [{ r: 0, c: 3 }, { r: 0, c: 4 }, { r: 0, c: 5 }],
      length: 3,
      isLoop: false,
    },
  ]);
  assertEqual(result.loops, [
    {
      boxes: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 1 }, { r: 1, c: 0 }],
      length: 4,
      isLoop: true,
    },
  ]);
  assertEqual(result.safeMoves.length, 10);
  // Spot-check: the gap column's edges are safe; the chain's own internal
  // edges are not (drawing one would immediately create a capturable box).
  assertEqual(
    result.safeMoves.some((e) => e.type === "h" && e.r === 1 && e.c === 2),
    true,
    "an edge between two degree-3 gap boxes is safe"
  );
  assertEqual(
    result.safeMoves.some((e) => e.type === "v" && e.r === 0 && e.c === 3),
    false,
    "the edge between the gap and the chain's degree-2 end is not safe"
  );
});

// ---------------------------------------------------------------------
// Fixture 7: zero safe moves anywhere, with two chains already opened at
// the middle (both boxes flanking the wall are capturable). This is the
// realistic "no safe moves left" position — captures are on the table,
// but nothing is left to play as a quiet filler move.
//
//   •──•──•──•──•──•──•
//            |
//   •──•──•──•──•──•──•
// ---------------------------------------------------------------------
test("fixture 7: no safe moves anywhere, even though captures are available", () => {
  const pos = parsePosition("1x6|h:0,1,2,3,4,5,6,7,8,9,10,11|v:3");
  const result = analyze(pos);

  assertEqual(result.capturableBoxes, [{ r: 0, c: 2 }, { r: 0, c: 3 }]);
  assertEqual(result.chains, [
    {
      boxes: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }],
      length: 3,
      isLoop: false,
    },
    {
      boxes: [{ r: 0, c: 3 }, { r: 0, c: 4 }, { r: 0, c: 5 }],
      length: 3,
      isLoop: false,
    },
  ]);
  assertEqual(result.loops, []);
  assertEqual(result.safeMoves, [], "not one edge on the whole board is safe");
});
