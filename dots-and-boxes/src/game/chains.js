  // game/chains.js
// Dual-graph chain/loop analysis for Dots and Boxes: treat each box as a
// node, one shared "outer" node standing in for the boundary, and every
// UNDRAWN edge as a graph edge (border edges connect a box to outer). A
// box's degree in this graph is just its count of undrawn edges — never
// tracked as a separate counter, always read off hEdges/vEdges through
// the same edgesOfBox() mapping rules.js's isBoxComplete() uses.
//
//   degree 0 -> box already captured (no undrawn edges left)
//   degree 1 -> capturable right now
//   degree 2 -> chain/loop body
//   degree 3-4 -> still "safe" territory, not part of any chain
//
// A CHAIN is a maximal path through degree-{1,2} boxes, connected by
// undrawn box-to-box edges. A LOOP is a maximal CYCLE of degree-2 boxes.
//
// Loops never touch outer, and that's not a rule this file checks for —
// it falls straight out of how the graph is built. The adjacency graph
// used for chain/loop decomposition only ever contains box<->box edges
// (never box<->outer edges); outer isn't a node in it at all. A box on a
// true cycle has spent BOTH its remaining edges on its two cycle
// neighbors, so it never has a "spare" edge left to reach outer with —
// any box that DOES have an edge to outer therefore has at most one
// neighbor left inside this graph, which makes it a path endpoint, not
// a cycle member. So classifying each connected component by comparing
// its edge count to its node count (an N-node cycle has N internal
// edges; an N-node path has N-1) is sufficient on its own to tell chains
// and loops apart correctly — no separate "does this touch outer" check
// is needed anywhere.
//
// AI move selection is explicitly NOT here — this module only answers
// "what does the board look like," never "what should I play."

import { edgesOfBox, getEdgeGrid, getBoxesForEdge } from "./rules.js";

/**
 * @param {object} state - anything shaped like { rows, cols, hEdges, vEdges }
 *   (a full rules.js game state, or a bare position from game/position.js)
 * @returns {{
 *   capturableBoxes: {r:number,c:number}[],
 *   chains: {boxes:{r:number,c:number}[], length:number, isLoop:false}[],
 *   loops: {boxes:{r:number,c:number}[], length:number, isLoop:true}[],
 *   safeMoves: {type:'h'|'v', r:number, c:number}[],
 * }}
 */
export function analyze(state) {
  const degree = computeDegrees(state);

  const capturableBoxes = [];
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (degree[r][c] === 1) capturableBoxes.push({ r, c });
    }
  }

  const safeMoves = computeSafeMoves(state, degree);
  const { chains, loops } = decomposeChainsAndLoops(state, degree);

  return { capturableBoxes, chains, loops, safeMoves };
}

function computeDegrees(state) {
  const degree = [];
  for (let r = 0; r < state.rows; r++) {
    const row = [];
    for (let c = 0; c < state.cols; c++) {
      const undrawnCount = edgesOfBox(r, c).filter(
        ({ type, r: er, c: ec }) => getEdgeGrid(state, type)[er][ec] === false
      ).length;
      row.push(undrawnCount);
    }
    degree.push(row);
  }
  return degree;
}

/**
 * A move is safe iff it leaves every adjacent box at degree >= 2 —
 * equivalently, every box adjacent to the edge must currently be at
 * degree >= 3 before the draw. Degree 1 is excluded on purpose: an edge
 * next to a degree-1 box would COMPLETE that box (a capture, handled by
 * capturableBoxes, not a "safe filler" move). Degree 2 is excluded
 * because that's exactly "would create a new capturable box," the thing
 * "safe" rules out. Both fall out of the single `>= 3` check.
 */
function computeSafeMoves(state, degree) {
  const safe = [];
  for (let r = 0; r <= state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.hEdges[r][c]) continue;
      if (isSafeEdge(state, degree, "h", r, c)) safe.push({ type: "h", r, c });
    }
  }
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c <= state.cols; c++) {
      if (state.vEdges[r][c]) continue;
      if (isSafeEdge(state, degree, "v", r, c)) safe.push({ type: "v", r, c });
    }
  }
  return safe;
}

function isSafeEdge(state, degree, type, r, c) {
  return getBoxesForEdge(state, type, r, c).every((b) => degree[b.r][b.c] >= 3);
}

/**
 * Build box<->box adjacency — an edge only between two boxes that are
 * BOTH degree 1 or 2 ("chain-eligible") — then split it into connected
 * components. Every eligible box has at most 2 undrawn edges total, so
 * at most 2 neighbors in this graph; a connected graph with max degree
 * 2 has no shape other than a simple path or a simple cycle. Which one
 * a component is falls out of counting: N nodes with N-1 internal edges
 * is a path (a chain); N nodes with N internal edges is a cycle (a loop).
 */
function decomposeChainsAndLoops(state, degree) {
  const eligible = (r, c) => degree[r][c] === 1 || degree[r][c] === 2;
  const keyOf = (r, c) => `${r},${c}`;

  const neighbors = new Map(); // "r,c" -> [{r,c}, ...], chain-eligible box-box links only
  function link(a, b) {
    const k = keyOf(a.r, a.c);
    if (!neighbors.has(k)) neighbors.set(k, []);
    neighbors.get(k).push(b);
  }

  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (!eligible(r, c)) continue;
      // Only ever look right/down so each internal edge is considered
      // once; link() records both directions.
      if (c + 1 < state.cols && eligible(r, c + 1) && getEdgeGrid(state, "v")[r][c + 1] === false) {
        link({ r, c }, { r, c: c + 1 });
        link({ r, c: c + 1 }, { r, c });
      }
      if (r + 1 < state.rows && eligible(r + 1, c) && getEdgeGrid(state, "h")[r + 1][c] === false) {
        link({ r, c }, { r: r + 1, c });
        link({ r: r + 1, c }, { r, c });
      }
    }
  }

  const visited = new Set();
  const chains = [];
  const loops = [];

  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const startKey = keyOf(r, c);
      if (!eligible(r, c) || visited.has(startKey)) continue;

      const componentKeys = collectComponent(startKey, neighbors);
      for (const k of componentKeys) visited.add(k);

      const nodeCount = componentKeys.size;
      const edgeCount =
        [...componentKeys].reduce((sum, k) => sum + (neighbors.get(k) || []).length, 0) / 2;

      if (nodeCount === 1 && edgeCount === 0) {
        chains.push({ boxes: [{ r, c }], length: 1, isLoop: false });
      } else if (edgeCount === nodeCount - 1) {
        const boxes = tracePath(componentKeys, neighbors, keyOf);
        chains.push({ boxes, length: boxes.length, isLoop: false });
      } else if (edgeCount === nodeCount) {
        const boxes = traceCycle(componentKeys, neighbors, keyOf);
        if (boxes.length < 4) {
          throw new Error(
            `chain analysis: found a loop of length ${boxes.length} (<4), which is geometrically ` +
              `impossible on a grid (all cycles in the box-adjacency graph are even, minimum 4) — ` +
              `this indicates an algorithm bug, not a real position.`
          );
        }
        loops.push({ boxes, length: boxes.length, isLoop: true });
      } else {
        throw new Error(
          `chain analysis: component with ${nodeCount} boxes and ${edgeCount} internal edges is ` +
            `neither a path nor a cycle (max degree 2 per node should make this impossible) — ` +
            `algorithm invariant violated.`
        );
      }
    }
  }

  return { chains, loops };
}

function collectComponent(startKey, neighbors) {
  const seen = new Set([startKey]);
  const queue = [startKey];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of neighbors.get(cur) || []) {
      const nk = `${nb.r},${nb.c}`;
      if (!seen.has(nk)) {
        seen.add(nk);
        queue.push(nk);
      }
    }
  }
  return seen;
}

function parseKey(key) {
  const [r, c] = key.split(",").map(Number);
  return { r, c };
}

function compareKeys(a, b) {
  const pa = parseKey(a);
  const pb = parseKey(b);
  return pa.r - pb.r || pa.c - pb.c;
}

/** Walk a path component from one endpoint (a component-degree-1 node) to the other. */
function tracePath(componentKeys, neighbors, keyOf) {
  let startKey = null;
  for (const k of componentKeys) {
    if ((neighbors.get(k) || []).length === 1) {
      startKey = k;
      break;
    }
  }

  const boxes = [];
  let prevKey = null;
  let curKey = startKey;
  while (curKey) {
    boxes.push(parseKey(curKey));
    const next = (neighbors.get(curKey) || []).find((nb) => keyOf(nb.r, nb.c) !== prevKey);
    prevKey = curKey;
    curKey = next ? keyOf(next.r, next.c) : null;
  }
  return boxes;
}

/** Walk a cycle component all the way around, starting at its smallest (r,c) for determinism. */
function traceCycle(componentKeys, neighbors, keyOf) {
  const startKey = [...componentKeys].sort(compareKeys)[0];
  const boxes = [];
  let prevKey = null;
  let curKey = startKey;
  do {
    boxes.push(parseKey(curKey));
    const options = neighbors.get(curKey) || [];
    const next =
      prevKey === null
        ? [...options].sort((a, b) => compareKeys(keyOf(a.r, a.c), keyOf(b.r, b.c)))[0]
        : options.find((nb) => keyOf(nb.r, nb.c) !== prevKey);
    prevKey = curKey;
    curKey = keyOf(next.r, next.c);
  } while (curKey !== startKey);
  return boxes;
}
