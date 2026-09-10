// game/render.js
// Canvas drawing for the Dots and Boxes board, plus edge hit-testing.
// Hit-testing lives here (not in core/grid.js) because it needs the
// edge-based data model from rules.js — it is Dots and Boxes specific,
// unlike the generic dot-grid geometry in core/grid.js.
//
// Milestone 13-4: every color used to be a hardcoded module constant.
// They're now a `theme` object (see game/theme.js — 4 board skins, all
// unlocked by in-game accomplishments, no purchases) passed through
// render()'s options, defaulting to DEFAULT_THEME (== the Paper skin's
// colors) so any caller that doesn't pass one renders exactly as this
// module always has. Nothing about HOW anything is drawn changed for
// this — animation timing, hit-testing, layout — only WHICH color gets
// used at each of the handful of places a color was ever chosen.
//
// Milestone 13-4 also added a faint guide line for every undrawn edge
// (theme.edgeUndrawn), so the whole grid's shape read clearly on the
// dark skins. Removed in a follow-up pass (asked for by name): it
// visually competed with actually-drawn edges and duplicated
// information the hover/touch ghost preview already gives — a player
// doesn't need the entire grid outlined to know an edge is clickable,
// they need to see what THEY'RE about to draw, which the preview
// already shows. `theme.edgeUndrawn` and drawUndrawnEdges() are gone;
// what's left (dots, drawn edges, box fills, hover/drag preview, last-
// move highlight, hint highlight) was verified to still have plenty of
// contrast without it — see game/theme.js's module comment for the
// numbers, none of which needed to change.

import { dotPosition, drawDots } from "../core/grid.js";

// Paper skin's player colors — player 0 (orange), player 1 (blue).
// Player 1's blue was darkened from the original #2e86ab (milestone
// 13-4 follow-up): the two colors' WCAG relative luminance was only
// Δ0.03 apart, distinguishable by hue alone but not by lightness —
// darkened-only, orange left byte-for-byte unchanged, since orange also
// doubles as --accent across the whole UI chrome (buttons, active
// states) and changing it would have shifted far more than the two
// player colors. See game/theme.js's module comment for the measured
// before/after numbers.
export const PLAYER_COLORS = ["#e4572e", "#1d546b"];
// SITE BUILD: 0.3, up from the portal build's 0.2. Who owns a box is
// the whole feedback loop of this game, and at 0.2 the two washes
// (orange, and Paper's deliberately dark blue) read as two barely
// tinted greys on a phone at arm's length — this site's audience is
// 65+. Still a wash, not a flat fill: the dots and the drawn edges on
// top of it keep their own contrast (game/theme.js measured those
// against the board background, not against the fill).
const BOX_FILL_ALPHA_MAX = 0.3;
const GHOST_ALPHA = "59"; // ~35% — the "about to draw this" preview

// The Paper skin's colors, used whenever a caller doesn't pass a
// `theme` option — keeps render() fully backward-compatible (e.g.
// nothing in test/render.test.js constructs a theme, since it never
// calls render() at all, only the theme-independent findEdgeAt()).
const DEFAULT_THEME = {
  background: "#faf7f2",
  dot: "#2b2b2b",
  edgeDrawn: "#2b2b2b",
  playerColors: PLAYER_COLORS,
  hint: "#22c55e",
  lastMoveGlow: "rgba(255, 210, 0, 0.9)",
};

/**
 * Key for looking an edge up in an `edgeProgress` map — {@link render}'s
 * animation option. Exported so callers (main.js) build map keys the
 * same way this file reads them, instead of duplicating the format.
 */
export function edgeKey(type, r, c) {
  return `${type},${r},${c}`;
}

/** Key for looking a box up in a `boxProgress` map — see {@link edgeKey}. */
export function boxKey(r, c) {
  return `${r},${c}`;
}

// t in [0, 1] -> eased [0, 1]. Fast start, gentle settle — reads as a
// quick, deliberate stroke/pop rather than a mechanical linear reveal.
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function alphaHex(alpha01) {
  return Math.round(Math.max(0, Math.min(1, alpha01)) * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * Full board render: background, box fills, dots, edges, ghost preview
 * of the pending move, and a highlight on the last move.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} layout - from core/grid.js computeLayout()
 * @param {object} state - from game/rules.js createGameState()
 * @param {{previewEdge?: {type:'h'|'v', r:number, c:number} | null,
 *          previewPlayer?: number,
 *          edgeProgress?: Map<string, number> | null,
 *          boxProgress?: Map<string, number> | null,
 *          hintEdge?: {type:'h'|'v', r:number, c:number} | null,
 *          theme?: {background, dot, edgeDrawn, playerColors,
 *            hint, lastMoveGlow}}} [options]
 *        edgeProgress/boxProgress map an {@link edgeKey}/{@link boxKey}
 *        to an animation progress in [0, 1); an edge/box with no entry
 *        renders fully drawn (progress 1) — this is what makes the
 *        animation options entirely optional for callers that don't
 *        animate (e.g. render.test.js's hit-testing, which never calls
 *        render() at all). hintEdge is a rewarded-ad-granted suggested
 *        move (main.js: a safe move from game/chains.js's analyze()) —
 *        drawn as a persistent highlight, unlike previewEdge which only
 *        shows while the pointer is actually over the board. `theme`
 *        (game/theme.js) picks the active skin's colors; omitted ->
 *        DEFAULT_THEME (Paper).
 */
export function render(ctx, layout, state, options = {}) {
  const {
    previewEdge = null,
    previewPlayer = 0,
    edgeProgress = null,
    boxProgress = null,
    hintEdge = null,
    theme = DEFAULT_THEME,
  } = options;

  ctx.save();
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, layout.width, layout.height);

  drawBoxFills(ctx, layout, state, boxProgress, theme);
  drawEdges(ctx, layout, state, edgeProgress, theme);
  if (hintEdge && isEdgeUndrawn(state, hintEdge.type, hintEdge.r, hintEdge.c)) {
    drawEdgeLine(ctx, layout, hintEdge.type, hintEdge.r, hintEdge.c, {
      color: theme.hint,
      width: Math.max(layout.cellSize * 0.14, 5),
    });
  }
  if (previewEdge && isEdgeUndrawn(state, previewEdge.type, previewEdge.r, previewEdge.c)) {
    // Ghost line in the current player's own color — it reads as "this is
    // what I'm about to draw," not a generic hover highlight.
    drawEdgeLine(ctx, layout, previewEdge.type, previewEdge.r, previewEdge.c, {
      color: theme.playerColors[previewPlayer] + GHOST_ALPHA,
      width: Math.max(layout.cellSize * 0.1, 4),
    });
  }
  drawDots(ctx, layout, theme.dot);

  ctx.restore();
}

function drawBoxFills(ctx, layout, state, boxProgress, theme) {
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const owner = state.boxes[r][c];
      if (owner === null) continue;
      const t = easeOutCubic(boxProgress?.get(boxKey(r, c)) ?? 1);
      const { x, y } = dotPosition(layout, r, c);
      // Grow-from-center + fade-in: a still-animating box shrinks its
      // fill inward from the cell edges as t rises, so the capture reads
      // as a small "pop" instead of an instant flat-fill.
      const margin = (1 - t) * layout.cellSize * 0.5;
      ctx.fillStyle = theme.playerColors[owner] + alphaHex(BOX_FILL_ALPHA_MAX * t);
      ctx.fillRect(x + margin, y + margin, layout.cellSize - margin * 2, layout.cellSize - margin * 2);
    }
  }
}

function drawEdges(ctx, layout, state, edgeProgress, theme) {
  const lineWidth = Math.max(layout.cellSize * 0.1, 4);

  for (let r = 0; r <= state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.hEdges[r][c]) {
        const progress = easeOutCubic(edgeProgress?.get(edgeKey("h", r, c)) ?? 1);
        drawEdgeLine(ctx, layout, "h", r, c, { color: edgeColor(state, "h", r, c, theme), width: lineWidth, progress });
      }
    }
  }
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c <= state.cols; c++) {
      if (state.vEdges[r][c]) {
        const progress = easeOutCubic(edgeProgress?.get(edgeKey("v", r, c)) ?? 1);
        drawEdgeLine(ctx, layout, "v", r, c, { color: edgeColor(state, "v", r, c, theme), width: lineWidth, progress });
      }
    }
  }
}

function edgeColor(state, type, r, c, theme) {
  const last = state.lastMove;
  if (last && last.type === type && last.r === r && last.c === c) {
    return theme.lastMoveGlow;
  }
  return theme.edgeDrawn;
}

function drawEdgeLine(ctx, layout, type, r, c, { color, width, progress = 1 }) {
  const { x1, y1, x2, y2 } = edgeEndpoints(layout, type, r, c);
  // progress < 1 draws only the leading fraction of the segment, from
  // the (row0,col0)/(row,col) endpoint toward the other one — the "line
  // growing in" stroke animation. progress === 1 (the common case: an
  // edge with no active animation) is exactly the old full-segment draw.
  const ex = x1 + (x2 - x1) * progress;
  const ey = y1 + (y2 - y1) * progress;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.restore();
}

function edgeEndpoints(layout, type, r, c) {
  if (type === "h") {
    const p1 = dotPosition(layout, r, c);
    const p2 = dotPosition(layout, r, c + 1);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }
  const p1 = dotPosition(layout, r, c);
  const p2 = dotPosition(layout, r + 1, c);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

function isEdgeUndrawn(state, type, r, c) {
  const grid = type === "h" ? state.hEdges : state.vEdges;
  return grid?.[r]?.[c] === false;
}

// Desktop gets a modest threshold (in cell-fraction units) so a click
// near the grid's dead center doesn't snap to a far-away edge. Touch
// gets none: finger accuracy is already the limiting factor, and an
// extra threshold would only reject taps that landed close enough to
// mean something. Zero dead zone, not a bigger hitbox — see the
// snapping approach below.
const DESKTOP_SNAP_THRESHOLD = 0.35;

// An outer border row/column (h-edges' row 0 or `rows`; v-edges' column
// 0 or `cols`) only has grid on ONE side. Left as-is, that gives it HALF
// an interior edge's click target: a point past the border, out in the
// canvas's own padding margin, has no "other row/column" to be
// equidistant from and might snap to instead — it's unambiguously meant
// for that border — but DESKTOP_SNAP_THRESHOLD would still reject it
// once it's more than 0.35 cell-units past the line. BORDER_OVERHANG (a
// full half-cell, matching how far an interior row/column can be
// approached from its far side) is how far past the outermost row/col a
// point is still accepted; findEdgeAt() clamps it back onto the border
// and treats it as dead-center on the line so the threshold above never
// rejects it. A point further out than the overhang is still ignored —
// the canvas's padding margin (however large the grid's own cells are)
// shouldn't make an edge clickable from arbitrarily far away.
const BORDER_OVERHANG = 0.5;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Snap a canvas-local point to the nearest edge, by grid coordinate —
 * not by distance to a line segment. Every point on the board maps to
 * *some* edge (nearest row for horizontal, nearest column for vertical,
 * whichever axis is closer), so there is no dead zone between edges the
 * way a segment-distance hit test would have. This is what makes taps
 * that land nowhere near the actual line still register correctly.
 *
 * @param {object} layout - from core/grid.js computeLayout()
 * @param {object} state - from game/rules.js createGameState()
 * @param {number} x - canvas-local x
 * @param {number} y - canvas-local y
 * @param {'mouse'|'touch'|'pen'} [pointerType]
 * @returns {{type:'h'|'v', r:number, c:number} | null} null if the
 *          nearest edge is out of bounds (or past BORDER_OVERHANG beyond
 *          a border), past the desktop threshold, or already drawn
 *          (drawn edges get no preview and ignore input).
 */
export function findEdgeAt(layout, state, x, y, pointerType = "mouse") {
  const gx = (x - layout.originX) / layout.cellSize;
  const gy = (y - layout.originY) / layout.cellSize;
  const threshold = pointerType === "touch" ? Infinity : DESKTOP_SNAP_THRESHOLD;

  // Horizontal-edge candidate: snap row to the nearest gridline, column
  // to the cell it falls in. gyForRow is gy clamped into [0, rows] —
  // equal to gy itself anywhere inside the grid (identical behavior to
  // before), but pinned exactly onto a border row once gy runs past it,
  // which makes hDist exactly 0 out there (see BORDER_OVERHANG above).
  const hRowAccepted = gy >= -BORDER_OVERHANG && gy <= state.rows + BORDER_OVERHANG;
  const gyForRow = clamp(gy, 0, state.rows);
  const hRow = Math.round(gyForRow);
  const hCol = Math.floor(gx);
  const hDist = Math.abs(gyForRow - hRow);
  const hInBounds = hRowAccepted && hCol >= 0 && hCol < state.cols;

  // Vertical-edge candidate, axes swapped.
  const vColAccepted = gx >= -BORDER_OVERHANG && gx <= state.cols + BORDER_OVERHANG;
  const gxForCol = clamp(gx, 0, state.cols);
  const vCol = Math.round(gxForCol);
  const vRow = Math.floor(gy);
  const vDist = Math.abs(gxForCol - vCol);
  const vInBounds = vColAccepted && vRow >= 0 && vRow < state.rows;

  let type = null, r = null, c = null, dist = Infinity;
  if (hInBounds && hDist <= threshold) {
    type = "h"; r = hRow; c = hCol; dist = hDist;
  }
  if (vInBounds && vDist <= threshold && vDist < dist) {
    type = "v"; r = vRow; c = vCol; dist = vDist;
  }
  if (type === null) return null;

  const grid = type === "h" ? state.hEdges : state.vEdges;
  if (grid[r][c] === true) return null;

  return { type, r, c };
}
