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

/**
 * The tap catchment around each intersection, as a fraction of cellSize.
 * 0.65 makes the hit circle 1.3x the visual cell width — deliberately
 * LARGER than the gap between neighbouring points, so the catchments of
 * adjacent intersections overlap slightly and there is no dead zone
 * anywhere on the board. nearestDot() resolves the overlap by picking the
 * genuinely closest point, so a wider radius never mis-assigns a tap that
 * was clearly nearer some other point; all it does is stop a tap that
 * landed between two points from being discarded entirely.
 *
 * This was 0.5 (exactly half a cell, i.e. catchments that tile the board
 * without overlapping). That is the right number if you assume the tap
 * lands where the player intended. For this site's audience — where a
 * tremor or an imprecise touch routinely lands a few px off — a discarded
 * tap reads as "the game ignored me," which is worse than snapping to the
 * nearest point. Widening to 0.65 is what makes the effective touch
 * target clear 44px on the default 9x9 board at phone widths: 40.8px
 * cells become a 53px catchment at a 380px viewport. See boardLayout()'s
 * own note on why the edge points are safe despite their catchment
 * extending past the canvas.
 */
export const HIT_RADIUS_FRACTION = 0.65;

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
 *   minPaddingForRadius()'s floor if it's too small to fit an edge stone.
 *   Because that floor is derived from the stone radius, which is itself
 *   a fraction of cellSize, the resulting padding is always PROPORTIONAL
 *   to the cell — measured at 0.458-0.470 x cellSize across every board
 *   size (9/11/15) and every viewport width, not a fixed pixel value.
 *   That is what keeps an edge stone fully on-canvas at any size.
 *
 *   Note this padding is smaller than HIT_RADIUS_FRACTION, so an edge
 *   point's tap catchment reaches ~0.19 x cellSize PAST the canvas edge.
 *   That is harmless and in fact desirable: the part of the catchment
 *   that falls outside the canvas simply can't receive a pointer event
 *   (the canvas is the event target), while every pixel of canvas near
 *   an edge point resolves to that point. The practical effect is that
 *   the entire outer margin of the board is live for the edge row — the
 *   place this audience most often taps short.
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
 * or null if the pointer is genuinely nowhere near the board.
 *
 * Two acceptance rules, in order:
 *
 *   1. Within HIT_RADIUS_FRACTION x cellSize of the nearest point. Because
 *      that radius exceeds half a cell, neighbouring catchments overlap
 *      and the interior of the board has no dead zone at all.
 *   2. Anywhere inside the canvas at all. This is what covers the four
 *      CORNERS, and it is not a theoretical case — it was measured: on a
 *      9x9 board at a 364px canvas the corner point sits at (18.9, 18.9),
 *      so a tap on the literal canvas corner (0, 0) is 26.7px away while
 *      the rule-1 radius is 26.5px. Rule 1 alone rejected it by 0.2px.
 *      A player aiming at the corner stone and landing slightly outside
 *      it would have been ignored, and the corner is exactly where an
 *      imprecise tap lands short.
 *
 * Rule 2 is safe to state that broadly because the canvas IS the board
 * and carries nothing else: every pixel of it belongs to some
 * intersection, and nearestDot() already picks the genuinely closest one.
 * The null return therefore only ever fires for coordinates outside the
 * canvas — which a canvas-targeted pointer event cannot produce, but
 * which callers (and tests) can still pass in.
 *
 * Plain geometry, no DOM dependency, so it is Node-tested directly rather
 * than only checked by hand in a browser.
 * @param {ReturnType<typeof boardLayout>} layout
 * @param {number} x
 * @param {number} y
 * @returns {{row:number, col:number}|null}
 */
export function pointToIntersection(layout, x, y) {
  const { row, col, dist } = nearestDot(layout, x, y);
  if (dist <= layout.cellSize * HIT_RADIUS_FRACTION) return { row, col };
  const insideCanvas = x >= 0 && y >= 0 && x <= layout.width && y <= layout.height;
  return insideCanvas ? { row, col } : null;
}
