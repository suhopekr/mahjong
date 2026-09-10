import { createGameState } from "../src/game/rules.js";
import { computeLayout } from "../src/core/grid.js";
import { findEdgeAt } from "../src/game/render.js";
import { test, assertTrue } from "./harness.js";

const state = createGameState(3, 3);
const layout = computeLayout(3, 3, 400, 400, 20); // cellSize = (400-40)/3

test("touch: dead center of a cell still resolves to an edge (zero dead zone)", () => {
  const cx = layout.originX + 0.5 * layout.cellSize;
  const cy = layout.originY + 0.5 * layout.cellSize;
  assertTrue(findEdgeAt(layout, state, cx, cy, "touch") !== null);
});

test("mouse: dead center of a cell exceeds the snap threshold", () => {
  const cx = layout.originX + 0.5 * layout.cellSize;
  const cy = layout.originY + 0.5 * layout.cellSize;
  assertTrue(findEdgeAt(layout, state, cx, cy, "mouse") === null);
});

test("snaps to the nearest horizontal edge near the grid's top row", () => {
  const px = layout.originX + 0.5 * layout.cellSize;
  const py = layout.originY + 0.05 * layout.cellSize;
  const edge = findEdgeAt(layout, state, px, py, "mouse");
  assertTrue(edge && edge.type === "h" && edge.r === 0 && edge.c === 0);
});

test("snaps to the nearest vertical edge near the grid's left column", () => {
  const px = layout.originX + 0.05 * layout.cellSize;
  const py = layout.originY + 0.5 * layout.cellSize;
  const edge = findEdgeAt(layout, state, px, py, "mouse");
  assertTrue(edge && edge.type === "v" && edge.r === 0 && edge.c === 0);
});

test("an already-drawn edge is never returned, even for touch", () => {
  const drawnState = createGameState(3, 3);
  drawnState.hEdges[0][0] = true;
  const px = layout.originX + 0.5 * layout.cellSize;
  const py = layout.originY + 0.02 * layout.cellSize;
  assertTrue(findEdgeAt(layout, drawnState, px, py, "touch") === null);
});

test("a point far off the grid returns null even for touch", () => {
  assertTrue(findEdgeAt(layout, state, -500, -500, "touch") === null);
});

// Border edges (the outer h-edge row, the outer v-edge column) only have
// grid on one side. Before BORDER_OVERHANG, a mouse click 0.3 cell-units
// PAST the border — same distance from the line as the click 0.05/0.02
// cell-units INTO the grid that the tests above already confirm snaps
// fine — would clear DESKTOP_SNAP_THRESHOLD (0.35) on raw distance, but
// used to get rejected anyway by the old hRow<=rows/vCol<=cols bounds
// check once it crossed the border into out-of-range index territory.
// One case per side, all "mouse" — touch never had this gap (its
// threshold is already Infinity).

test("border: a mouse click just above the top row still snaps to it", () => {
  const px = layout.originX + 0.5 * layout.cellSize;
  const py = layout.originY - 0.3 * layout.cellSize;
  const edge = findEdgeAt(layout, state, px, py, "mouse");
  assertTrue(edge && edge.type === "h" && edge.r === 0 && edge.c === 0, `got ${JSON.stringify(edge)}`);
});

test("border: a mouse click just below the bottom row still snaps to it", () => {
  const px = layout.originX + 2.5 * layout.cellSize;
  const py = layout.originY + (state.rows + 0.3) * layout.cellSize;
  const edge = findEdgeAt(layout, state, px, py, "mouse");
  assertTrue(edge && edge.type === "h" && edge.r === state.rows && edge.c === 2, `got ${JSON.stringify(edge)}`);
});

test("border: a mouse click just left of the leftmost column still snaps to it", () => {
  const px = layout.originX - 0.3 * layout.cellSize;
  const py = layout.originY + 0.5 * layout.cellSize;
  const edge = findEdgeAt(layout, state, px, py, "mouse");
  assertTrue(edge && edge.type === "v" && edge.r === 0 && edge.c === 0, `got ${JSON.stringify(edge)}`);
});

test("border: a mouse click just right of the rightmost column still snaps to it", () => {
  const px = layout.originX + (state.cols + 0.3) * layout.cellSize;
  const py = layout.originY + 1.5 * layout.cellSize;
  const edge = findEdgeAt(layout, state, px, py, "mouse");
  assertTrue(edge && edge.type === "v" && edge.r === 1 && edge.c === state.cols, `got ${JSON.stringify(edge)}`);
});

test("border: a click beyond the overhang (0.7 cell past the border) is still ignored, mouse or touch", () => {
  const px = layout.originX + 0.5 * layout.cellSize;
  const py = layout.originY - 0.7 * layout.cellSize;
  assertTrue(findEdgeAt(layout, state, px, py, "mouse") === null);
  assertTrue(findEdgeAt(layout, state, px, py, "touch") === null);
});

// Regression suite for a bug where horizontal-edge hits were narrower
// than vertical-edge hits on the browser's ACTUAL up/down axis — not a
// findEdgeAt() bug (it was always symmetric, confirmed by direct
// in-browser calls with the same layout numbers a real click used), but
// main.js was computing `layout` from the canvas's stale, pre-DOM-
// update size (see CLAUDE.md's design-decision note). Since findEdgeAt()
// itself was never the culprit, these are here as a permanent guard —
// one entry per edge (an interior h, an interior v, and all four
// borders), each checked in all four cardinal directions from its own
// midpoint by 0.3 cell-units. For an h-edge, up/down crosses the line
// (the axis the real bug hit); left/right stays inside its own column
// span. For a v-edge, it's the other way around. Border cases push
// outward past the grid on purpose ("격자 밖 방향도 포함해서").
const FOUR_DIR_CASES = [
  { label: "interior h(1,1)", type: "h", r: 1, c: 1, midGx: 1.5, midGy: 1 },
  { label: "interior v(1,1)", type: "v", r: 1, c: 1, midGx: 1, midGy: 1.5 },
  { label: "top border h(0,1)", type: "h", r: 0, c: 1, midGx: 1.5, midGy: 0 },
  { label: "bottom border h(3,1)", type: "h", r: 3, c: 1, midGx: 1.5, midGy: 3 },
  { label: "left border v(1,0)", type: "v", r: 1, c: 0, midGx: 0, midGy: 1.5 },
  { label: "right border v(1,3)", type: "v", r: 1, c: 3, midGx: 3, midGy: 1.5 },
];
const DIRECTIONS = {
  up: [0, -0.3],
  down: [0, 0.3],
  left: [-0.3, 0],
  right: [0.3, 0],
};

for (const edgeCase of FOUR_DIR_CASES) {
  for (const [dirName, [dgx, dgy]] of Object.entries(DIRECTIONS)) {
    test(`four-direction snap: ${edgeCase.label}, 0.3 cell ${dirName} of its midpoint`, () => {
      const px = layout.originX + (edgeCase.midGx + dgx) * layout.cellSize;
      const py = layout.originY + (edgeCase.midGy + dgy) * layout.cellSize;
      const edge = findEdgeAt(layout, state, px, py, "mouse");
      assertTrue(
        edge && edge.type === edgeCase.type && edge.r === edgeCase.r && edge.c === edgeCase.c,
        `expected ${edgeCase.type}(${edgeCase.r},${edgeCase.c}), got ${JSON.stringify(edge)}`
      );
    });
  }
}

test("h-edges and v-edges have the same average snap-target area (no axis is systematically narrower)", () => {
  // Directly measures what the earlier per-point tests only sample:
  // sweep every canvas-local point on a grid and bucket it by which
  // edge it resolves to, then compare the average bucket size across
  // all h-edges vs all v-edges. A narrowed axis (like the bug this
  // guards against) shows up here as a lopsided ratio even if no single
  // hand-picked point happens to catch it.
  const step = 1; // px
  const hAreas = new Map();
  const vAreas = new Map();
  for (let py = -30; py <= layout.height + 30; py += step) {
    for (let px = -30; px <= layout.width + 30; px += step) {
      const edge = findEdgeAt(layout, state, px, py, "mouse");
      if (!edge) continue;
      const bucket = edge.type === "h" ? hAreas : vAreas;
      const key = `${edge.r},${edge.c}`;
      bucket.set(key, (bucket.get(key) || 0) + step * step);
    }
  }
  const avg = (map) => [...map.values()].reduce((a, b) => a + b, 0) / map.size;
  const hAvg = avg(hAreas);
  const vAvg = avg(vAreas);
  const ratio = hAvg / vAvg;
  assertTrue(
    ratio > 0.9 && ratio < 1.1,
    `h/v average area ratio ${ratio.toFixed(3)} is too skewed (h avg=${hAvg.toFixed(1)}, v avg=${vAvg.toFixed(1)}) — one axis is narrower than the other`
  );
});
