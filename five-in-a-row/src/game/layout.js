// game/layout.js
// Thin wrapper around core/grid.js's computeLayout() that translates
// between two different counting conventions. core/grid.js counts in
// CELLS (an r x c grid of boxes has (r+1) x (c+1) corner dots — that's
// Dots and Boxes' own vocabulary, baked into computeLayout's signature).
// Gomoku boards are conventionally sized in POINTS/intersections instead
// (a "15x15 board" means 15x15 places a stone can go, not 15x15 boxes),
// so every game-layer call site should go through boardLayout(size, ...)
// here rather than calling core/grid.js's computeLayout() directly and
// having to remember the off-by-one. dotPosition()/nearestDot() from
// core/grid.js still work unchanged on the layout this returns — row/col
// range over [0, size - 1] inclusive, exactly `size` values per axis.
import { computeLayout, nearestDot } from "../core/grid.js";

// How big a stone's radius is, as a fraction of cellSize — the single
// source of truth for that number. render.js imports this (rather than
// hardcoding 0.45 a second time) so drawStone()/drawGhostStone() and the
// padding floor below can never drift apart.
export const STONE_RADIUS_FRACTION = 0.45;

// Grid line stroke width in CSS px, matching render.js's drawGridLines().
// A stone at an edge/corner point needs the line's own half-width of
// clearance too, on top of its radius — tiny at 1px, but it's what the
// "+ 선 두께" half of the padding floor below accounts for.
const GRID_LINE_WIDTH = 1;

/**
 * The minimum padding that keeps a stone drawn AT an edge or corner point
 * from extending past the canvas edge. Unlike Dots and Boxes — which only
 * ever drew LINES at the outermost dots, never anything with real radius
 * — Gomoku places a full stone directly on every point, edges and
 * corners included, so padding has to reserve at least the stone's own
 * radius (plus half the grid line's stroke width) there.
 *
 * This can't be checked by simply comparing a requested padding against
 * a stone radius computed from cellSize, because cellSize itself is
 * DERIVED from padding (computeLayout() carves padding out of the same
 * width the grid has to fit in) — shrinking padding grows cellSize (and
 * so the very radius padding needs to clear), and growing padding shrinks
 * it back. "padding >= radiusFraction * cellSize(padding) + lineWidth/2"
 * is a self-referential inequality; solved for its exact fixed point
 * instead of iterating:
 *   p >= f * (W - 2p)/n + m        (n = size-1 cells, f = radiusFraction, m = lineWidth/2)
 *   p >= (f*W + m*n) / (n + 2f)
 * @param {number} size - points per side
 * @param {number} width - canvas CSS width (assumes a square board, as
 *   every call site in this project uses — see boardLayout below)
 * @param {number} [radiusFraction]
 * @param {number} [lineWidth]
 */
export function minPaddingForRadius(size, width, radiusFraction = STONE_RADIUS_FRACTION, lineWidth = GRID_LINE_WIDTH) {
  const n = size - 1;
  const m = lineWidth / 2;
  return (radiusFraction * width + m * n) / (n + 2 * radiusFraction);
}

/**
 * @param {number} size - points per side (15 for a standard board, 9 for
 *   the quick-game size — never hardcoded here, see CLAUDE.md section 3
 *   on storage.js's GRID_SIZES mistake in the previous project)
 * @param {number} width - canvas CSS width in px
 * @param {number} height - canvas CSS height in px
 * @param {number} [padding] - a REQUESTED padding; silently raised to
 *   minPaddingForRadius()'s floor if it's too small to fit an edge stone
 *   (a caller trying to save every pixel on a small screen — see main.js's
 *   paddingFor() — should never have to also remember this floor itself;
 *   real bug this fixed, caught from an actual mobile screenshot where
 *   edge/corner stones were clipped against the canvas bounds)
 */
export function boardLayout(size, width, height, padding = 40) {
  const safePadding = Math.max(padding, minPaddingForRadius(size, width));
  return computeLayout(size - 1, size - 1, width, height, safePadding);
}

/**
 * Resolves a raw pointer position to the intersection it should snap to,
 * or null if the pointer is too far from every intersection to count as
 * "on the board." The catchment around each point is a circle of radius
 * cellSize/2 — because Gomoku's hit target is a POINT rather than an
 * edge, this radius is identical in every direction for every point,
 * corners and border points included. Dots and Boxes' edge-based hit
 * test had no such guarantee (a corner has fewer plausible edge
 * candidates than a mid-board vertex, producing an asymmetric dead zone)
 * — this function is exactly why Gomoku milestone 2 doesn't have that
 * problem, and it's plain geometry with no DOM dependency, so it's
 * Node-tested directly (see test/layout.test.js's symmetric-radius
 * sampling) rather than only checked by hand in a browser.
 * @param {ReturnType<typeof boardLayout>} layout
 * @param {number} x
 * @param {number} y
 * @returns {{row:number, col:number}|null}
 */
export function pointToIntersection(layout, x, y) {
  const { row, col, dist } = nearestDot(layout, x, y);
  return dist <= layout.cellSize / 2 ? { row, col } : null;
}
