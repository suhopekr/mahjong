// game/render.js
// Canvas 2D rendering for the Gomoku board: grid lines, star points,
// stones, last-move marker, win-line highlight. Browser-only (Canvas2D
// context, devicePixelRatio) — per CLAUDE.md section 5's established
// rule, DOM-only drawing code isn't a Node test target (same reasoning as
// core/audio.js's playback functions). starPoints() and game/layout.js's
// boardLayout() are pure math with no DOM dependency and DO have Node
// tests; the actual draw*() functions are verified in-browser (see
// test/browser-check.mjs).
//
// Board vs D&B: this is the mirror image of Dots and Boxes' rendering.
// D&B draws boxes and lets the PLAYER draw the edges; Gomoku draws a
// fixed goban grid up front and the player fills INTERSECTIONS with
// stones. Nothing here reuses core/grid.js's drawDots() (that draws tiny
// corner dots meant to be clicked near, not a goban's ruled lines) —
// only its coordinate math, via game/layout.js's boardLayout() wrapper.
//
// Design-upgrade pass (milestone 9-3): adopts the shared visual grammar
// of top-tier mobile Gomoku apps (honey-wood board with grain, glossy 3D
// stones, a dot on the last move, a win streak that glows BEHIND the
// stones rather than a ring around each one) — the user's own explicit
// instruction was genre convention, not any one app's specific art
// (looking like one specific existing game is its own kind of problem).
// The exact same stone base colors the cover art uses, on purpose, so
// the artwork and the real game read as the same
// product. Every exported function's signature is unchanged from before
// this pass — only what happens inside them.

import { dotPosition } from "../core/grid.js";
import { STONE_RADIUS_FRACTION } from "./layout.js";

// --- color math (rim-color fallback for themes that don't define one) ---
//
// Only wood (DEFAULT_THEME, below) defines an explicit `rim` per stone —
// every other theme (game/themes.js's Slate/Paper/Neon) keeps exactly the
// {fill, highlight} shape it always had (CLAUDE.md's own "기존 언락
// 테마들은 색상만 다른 구조면 그대로 두되" instruction for this pass), and
// drawStone() below derives a rim for them automatically by darkening
// their own `fill`. This is the one place that darkening happens, so
// every theme gets the same glossy 3-stop gradient technique even though
// only wood's rim is hand-picked.
function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgbToHex(r, g, b) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;
}

const RIM_FALLBACK_DARKEN = 0.35; // fraction darker than `fill`, for themes with no explicit `rim`
function darkenHex(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = 1 - amount;
  return rgbToHex(r * f, g * f, b * f);
}

// Classic black/white stones rather than theme-tinted ones — a
// recommendation, not yet confirmed with the user; revisit once a skin
// milestone exists. Reasoning: Gomoku/Baduk stones being black/white is
// close to a universal convention, so a first-time player already knows
// "black moved first, white is the other player" without reading a
// legend — Dots and Boxes had no equivalent convention to lean on, which
// is why its arbitrary per-player theme colors worked fine there but
// wouldn't carry the same information here. Kept as a plain parameter
// (not hardcoded into the draw calls) so a later skin milestone can
// override it without touching this file's logic.
//
// boardGradientTop/boardGradientBottom/boardEdgeColor/grainColor are all
// OPTIONAL (paintBackground() below falls back to the flat `boardColor`
// fill milestone 1 always had, if a theme doesn't define them) — wood is
// the only theme that currently sets them; game/themes.js's own header
// comment explains why the other 3 stay exactly as they were.
export const DEFAULT_THEME = {
  boardColor: "#dcb35c", // flat fallback — no longer what wood actually renders, kept as the shape every theme still has
  boardGradientTop: "#e0b26a",
  boardGradientBottom: "#c69650",
  boardEdgeColor: "#a67a3c",
  grainColor: "#7a5a2e",
  lineColor: "#3a2b1a",
  starColor: "#3a2b1a",
  // Feedback pass 2: white was reading as a gray marble, not a white
  // stone — the old -48 rim attenuation (from a #d0d0cc base) ate too
  // much of the circle. Fixed at the source (a lighter base) plus a
  // narrower, weaker rim (`rimStart` pushed from the default 0.55 to
  // 0.78 — see drawStone()'s own use of it — so the darkening band only
  // occupies the outer 22% of the circle instead of 45%), matching
  // store/scripts/cover-scene.mjs's identical fix exactly. `edgeColor`/
  // `edgeAlpha`/`shadowBoost` are white-only too — see drawStone()'s own
  // comment on each.
  stones: {
    // White-brightness-vs-cover pass: black's own interior-disc average
    // (this file's own measurement methodology, see drawStone()'s own
    // comment) also read darker than the cover's black — 50 in-game vs
    // 60 cover, at the exact same inset — a smaller gap than white's had
    // (proportionally about a quarter of it), but real. The SAME two
    // structural fixes (gradientExtent, damped shadowBoost) close it: 50
    // -> 62 (now essentially matching cover's own 60, within this file's
    // own measurement noise) — kept at a milder shadowBoost than white's
    // own (0.3 vs 0.08) since black's fill is already dark and doesn't
    // need nearly as much shadow suppression to stop reading muddy.
    0: { fill: "#262626", highlight: "#bcbcbc", rim: "#101010", gradientExtent: 1.1, shadowBoost: 0.3 },
    1: {
      fill: "#f2f2ee",
      highlight: "#ffffff",
      rim: "#dcdcd8",
      rimStart: 0.78,
      edgeColor: "#b8b8b4",
      edgeAlpha: 0.6,
      // 1.1 = cover-scene.mjs's own r="55%"-of-bbox gradient reach
      // (55% x 2 = 110% of the visible radius) — see drawStone()'s own
      // comment for the derivation. shadowBoost flipped from 1.125
      // (amplifying) to 0.08 (nearly eliminating it) — tuned against
      // real screenshots (0.3 -> 0.15 -> 0.08, each re-measured, not
      // guessed once) until the interior-disc average landed inside
      // +-8 of the cover's own value at the same inset; see this pass's
      // own CLAUDE.md section for the full iteration table.
      gradientExtent: 1.1,
      shadowBoost: 0.08,
    },
  },
  lastMoveMarker: "#d2362d",
  winLineColor: "#d2362d",
};

/**
 * Resizes `canvas`'s backing store to match devicePixelRatio so lines and
 * stones stay crisp on high-DPI screens — skipping this was a real bug in
 * Dots and Boxes (CLAUDE.md section 6 calls it out as "필수"). Sets the
 * canvas's CSS size to (cssWidth, cssHeight) and scales the drawing
 * context to match; safe to call on every resize since setTransform()
 * replaces the previous scale rather than compounding it.
 * @param {HTMLCanvasElement} canvas
 * @param {number} cssWidth
 * @param {number} cssHeight
 * @returns {CanvasRenderingContext2D}
 */
export function fitCanvasToDisplaySize(canvas, cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * Conventional 5-point star markers (화점): the 4 points symmetrically
 * inset from each edge, plus dead center on an odd-sized board. Inset is
 * 3 lines for boards >= 13 points per side (matches the common 15x15
 * Gomoku/Renju diagram convention — 4th-line points plus tengen) and 2
 * lines for smaller boards (e.g. a 9x9 quick-game size) so the points
 * don't crowd the edge. This is a display convention, not a rule, so
 * there's no source of truth to get "wrong" — pure function, Node-tested.
 * @param {number} size
 * @returns {[number,number][]}
 */
export function starPoints(size) {
  const margin = size >= 13 ? 3 : 2;
  const near = margin;
  const far = size - 1 - margin;
  if (far <= near) return []; // board too small for this margin to make sense

  const points = [
    [near, near],
    [near, far],
    [far, near],
    [far, far],
  ];
  if (size % 2 === 1) {
    const center = (size - 1) / 2;
    points.push([center, center]);
  }
  return points;
}

// Ease-out cubic: fast start, gentle settle — used for both the stone
// pop-in and the win-line sweep so the two share one "feel" rather than
// each inventing its own curve.
function easeOutCubic(t) {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

/**
 * Draws the full board: background, grid, star points, the win streak
 * (behind the stones), every placed stone, a marker on the last move,
 * and a faint win-streak "overbloom" on top (so the glow still reads
 * where a stone's own opaque body sits directly over the streak's core —
 * see drawWinStreakBehind()/drawWinStreakOverbloom()'s own comments).
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import("./layout.js").boardLayout>} layout
 * @param {ReturnType<import("./board.js").createGameState>} state
 * @param {{
 *   theme?: typeof DEFAULT_THEME,
 *   animatingCell?: {row: number, col: number, progress: number} | null,
 *   winLineProgress?: number
 * }} [options]
 */
export function drawBoard(ctx, layout, state, { theme = DEFAULT_THEME, animatingCell = null, winLineProgress = 1 } = {}) {
  drawBackground(ctx, layout, theme);
  drawGridLines(ctx, layout, state.size, theme);
  drawStarPoints(ctx, layout, state.size, theme);
  if (state.winLine) drawWinStreakBehind(ctx, layout, state.winLine, theme, winLineProgress);
  drawStones(ctx, layout, state.board, theme, animatingCell);
  const lastMove = state.moves[state.moves.length - 1] || null;
  if (lastMove) drawLastMoveMarker(ctx, layout, lastMove, theme);
  if (state.winLine) drawWinStreakOverbloom(ctx, layout, state.winLine, theme, winLineProgress);
}

// --- board background: honey-wood gradient + grain, cached offscreen ----
//
// 2d's own performance requirement: grain/gradient must NOT add per-frame
// cost — the animation loop (main.js's ensureAnimationLoop) redraws the
// whole board on every rAF tick during a stone pop-in or the win-line
// sweep, so anything recomputed inside drawBackground() runs at up to
// 60fps. The fix: paint the gradient+grain+edge ONCE into an offscreen
// canvas, cached at (layout.width, layout.height, theme) — every
// subsequent drawBackground() call is a single drawImage(), the same
// cost a flat fillRect() always was. The cache key is checked on every
// call (cheap: 2 number comparisons + 1 reference comparison) and only
// actually repaints when the board resizes or the theme changes, exactly
// the "resize 때만 재생성" requirement.
let backgroundCache = { canvas: null, theme: null, width: 0, height: 0 };

function paintWoodGrain(ctx, layout, theme) {
  const count = 7;
  const w = layout.width;
  const h = layout.height;
  const marginY = h * 0.06;
  const span = h - marginY * 2;
  const segments = 32;
  ctx.save();
  ctx.strokeStyle = theme.grainColor;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < count; i++) {
    const baseY = marginY + (span / (count - 1)) * i;
    const amplitude = 2 + (i % 3); // 2-4px, per spec's "2~3px" (kept close, varied slightly so the 7 lines don't look mechanically identical)
    const wavelength = w / 3;
    ctx.globalAlpha = 0.08 + (i % 3) * 0.02; // 8-12%
    ctx.beginPath();
    for (let s = 0; s <= segments; s++) {
      const x = (w / segments) * s;
      const y = baseY + Math.sin((x / wavelength) * Math.PI * 2 + i) * amplitude;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function paintBackground(ctx, layout, theme) {
  if (theme.boardGradientTop && theme.boardGradientBottom) {
    const gradient = ctx.createLinearGradient(0, 0, 0, layout.height);
    gradient.addColorStop(0, theme.boardGradientTop);
    gradient.addColorStop(1, theme.boardGradientBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, layout.width, layout.height);
    if (theme.grainColor) paintWoodGrain(ctx, layout, theme);
    if (theme.boardEdgeColor) {
      const edgeHeight = Math.max(layout.height * 0.012, 4);
      ctx.fillStyle = theme.boardEdgeColor;
      ctx.fillRect(0, layout.height - edgeHeight, layout.width, edgeHeight);
    }
  } else {
    // Every non-wood theme today (game/themes.js: Slate/Paper/Neon) — kept
    // exactly as flat-color as milestone 1 always drew it.
    ctx.fillStyle = theme.boardColor;
    ctx.fillRect(0, 0, layout.width, layout.height);
  }
}

function getCachedBackgroundCanvas(layout, theme) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(layout.width * dpr));
  const h = Math.max(1, Math.round(layout.height * dpr));
  if (backgroundCache.canvas && backgroundCache.theme === theme && backgroundCache.width === w && backgroundCache.height === h) {
    return backgroundCache.canvas;
  }
  const offscreen = document.createElement("canvas");
  offscreen.width = w;
  offscreen.height = h;
  const offCtx = offscreen.getContext("2d");
  offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintBackground(offCtx, layout, theme);
  backgroundCache = { canvas: offscreen, theme, width: w, height: h };
  return offscreen;
}

function drawBackground(ctx, layout, theme) {
  ctx.save();
  const cached = getCachedBackgroundCanvas(layout, theme);
  // Destination size in CSS px (layout.width/height) — correct 1:1
  // physical-pixel mapping falls out automatically: `ctx` already has the
  // dpr scale applied (fitCanvasToDisplaySize's own setTransform), and
  // `cached` was painted at that same dpr's physical resolution.
  ctx.drawImage(cached, 0, 0, layout.width, layout.height);
  ctx.restore();
}

function drawGridLines(ctx, layout, size, theme) {
  ctx.save();
  ctx.strokeStyle = theme.lineColor;
  ctx.lineWidth = 1;
  const first = dotPosition(layout, 0, 0);
  const last = dotPosition(layout, size - 1, size - 1);
  for (let i = 0; i < size; i++) {
    const h = dotPosition(layout, i, 0);
    ctx.beginPath();
    ctx.moveTo(first.x, h.y);
    ctx.lineTo(last.x, h.y);
    ctx.stroke();

    const v = dotPosition(layout, 0, i);
    ctx.beginPath();
    ctx.moveTo(v.x, first.y);
    ctx.lineTo(v.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStarPoints(ctx, layout, size, theme) {
  ctx.save();
  ctx.fillStyle = theme.starColor;
  const radius = Math.max(layout.cellSize * 0.09, 2.5);
  for (const [row, col] of starPoints(size)) {
    const { x, y } = dotPosition(layout, row, col);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import("./layout.js").boardLayout>} layout
 * @param {(0|1|null)[][]} board
 * @param {typeof DEFAULT_THEME} theme
 * @param {{row: number, col: number, progress: number} | null} animatingCell -
 *   the just-placed stone still popping in (scale + fade from 0 to full
 *   over STONE_ANIMATION_MS — see main.js), or null once it's settled /
 *   for every other stone on the board.
 */
function drawStones(ctx, layout, board, theme, animatingCell = null) {
  const radius = layout.cellSize * STONE_RADIUS_FRACTION;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const player = board[r][c];
      if (player === null) continue;
      const isAnimating = animatingCell && animatingCell.row === r && animatingCell.col === c;
      const eased = isAnimating ? easeOutCubic(animatingCell.progress) : 1;
      drawStone(ctx, layout, r, c, player, theme, radius * eased, eased);
    }
  }
}

/**
 * Glossy 3D stone: a 3-stop radial gradient (bright offset highlight ->
 * mid-tone base -> darker rim, matching store/scripts/cover-scene.mjs's
 * own stoneSVG() design exactly), plus a soft shadow clipped INSIDE the
 * stone's own circle rather than a true Canvas2D shadowBlur/shadowOffset
 * (which extends past the shape casting it, by definition). That's a
 * deliberate departure from a literal drop shadow: this project's own
 * padding math (game/layout.js's minPaddingForRadius(), CLAUDE.md
 * milestone 2) gives an edge/corner stone EXACTLY enough clearance for
 * its own radius and not one pixel more — solved as an equality, no
 * slack built in on purpose, so the board can stay as large as possible
 * on small screens. A shadow that bleeds outward past that radius
 * reintroduces the exact edge-clipping bug milestone 2 fixed (confirmed
 * by actually re-running that regression check while iterating on this:
 * a directional offset shadow tripped it immediately at 320-390px on the
 * board's bottom edge). Clipping the shadow to the stone's own circle
 * keeps the "grounded, dimensional" look with zero risk of that
 * regression, by construction, rather than by tuning blur numbers and
 * hoping.
 * @param {number} alpha - fully opaque (1) once settled; fading in
 *   during the placement pop (see drawStones' animatingCell)
 */
function drawStone(ctx, layout, row, col, player, theme, radius, alpha = 1) {
  if (radius <= 0) return; // nothing to draw at progress 0
  const { x, y } = dotPosition(layout, row, col);
  const colors = theme.stones[player];
  const rim = colors.rim ?? darkenHex(colors.fill, RIM_FALLBACK_DARKEN);
  // Feedback pass 2: white pushes this from the 0.55 default out to
  // 0.78 (theme.stones[1].rimStart) — narrows the darkening band to the
  // outer 22% of the circle instead of 45%, since -48-style rim
  // attenuation was reading as "gray marble," not "white stone."
  const rimStart = colors.rimStart ?? 0.55;
  // White-brightness-vs-cover pass: real screenshots measured the
  // in-game white stone's own interior disc averaging ~204 (this file's
  // own measurement, inset 0.85r; an earlier external review's separate
  // methodology got 191) against the cover's ~245 (same inset) for the
  // IDENTICAL base/highlight/rim/rimStart/edgeColor/edgeAlpha values —
  // the color DATA was never the problem (store/scripts/cover-scene.mjs's
  // own COLORS.white is byte-for-byte the same object this file's
  // DEFAULT_THEME.stones[1] already had). Two structural differences in
  // HOW those same values get applied, both traced by hand from the two
  // files' own gradient/shadow code, account for the gap:
  //
  // (1) cover-scene.mjs's SVG radialGradient uses r="55%" of the stone's
  // own 2r-wide bounding box — i.e. an ACTUAL gradient radius of 1.1x
  // the visible circle's radius (55% x 2 = 110%), not 100%. That means
  // the stone's own visible EDGE only ever reaches gradient offset
  // 1/1.1 ≈ 90.9%, still short of the 100%-offset `rim` stop — the
  // outer ring stays a soft blend toward rim, never fully there. This
  // file's own `createRadialGradient(..., radius)` outer circle instead
  // matches the visible radius EXACTLY, so the outer ring sweeps all
  // the way to the FULL `rim` color right at the edge — a harsher,
  // darker outer band than the cover ever shows. `gradientExtent`
  // (white-only, DEFAULT_THEME.stones[1]) replicates cover's own exact
  // 1.1x reach so the two renderers' gradients behave identically, not
  // just share the same color stops.
  const gradientExtent = colors.gradientExtent ?? 1;
  // (2) cover-scene.mjs's own "shadow" is a separate <ellipse> drawn
  // BEHIND the stone's own opaque circle (stoneSVG()'s own comment: the
  // ellipse element comes before the <circle> in its returned markup) —
  // since the stone is fully opaque, that shadow is entirely hidden
  // underneath it and never touches the stone's own visible fill at
  // all; it only ever shows as a soft drop shadow around the stone's
  // outside edge. This file's own inner shadow is the opposite: clipped
  // to the SAME circle and painted ON TOP of the fill (a deliberate
  // milestone 9-3 choice — see this function's own doc comment — to
  // avoid a true Canvas2D drop shadow bleeding past the stone's radius
  // and re-triggering the edge-clipping regression at 320-390px), which
  // directly darkens the stone's own lower half by blending toward
  // black at up to `shadowAlpha` — a much bigger contributor to the
  // brightness gap than (1) above. Per this pass's own principle ("돌은
  // 하얗게, 분리는 엣지+그림자가 담당" — the stone's OWN fill should
  // read white; boundary definition is `edgeColor`'s job, and the
  // shadow's job is only a light grounding cue, not a second coat of
  // gray) white's own `shadowBoost` flips from AMPLIFYING the shadow
  // (the old 1.125, i.e. even stronger than black's) to damping it hard
  // — tuned against real screenshots (this pass's own CLAUDE.md section
  // has the iteration numbers) rather than picked once and assumed.
  const shadowAlpha = 0.32 * (colors.shadowBoost ?? 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  // Offset focal point (36%, 32% from the stone's own top-left) — same
  // "light from the upper-left" position cover-scene.mjs's SVG
  // radialGradient fx/fy uses, expressed here as a 2-circle Canvas2D
  // gradient (this API's own native equivalent).
  const gradient = ctx.createRadialGradient(x - radius * 0.28, y - radius * 0.36, radius * 0.05, x, y, radius * gradientExtent);
  gradient.addColorStop(0, colors.highlight);
  gradient.addColorStop(rimStart, colors.fill);
  gradient.addColorStop(1, rim);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Inner shadow: clipped to the exact same circle (own inner save/
  // restore, so undoing the clip afterward doesn't also undo the outer
  // globalAlpha — the edge stroke below still needs it), so nothing it
  // paints can ever land outside the stone's own radius.
  ctx.save();
  ctx.clip();
  const shadow = ctx.createRadialGradient(x, y + radius * 0.35, radius * 0.15, x, y + radius * 0.35, radius * 1.05);
  shadow.addColorStop(0, `rgba(0, 0, 0, ${shadowAlpha})`);
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();

  // Feedback pass 2: a thin cool-gray hairline (white only —
  // theme.stones[1].edgeColor) drawn UNCLIPPED on top of the fill, so
  // the stone/board boundary stays crisp now that the fill itself reads
  // as genuinely white rather than mid-gray. A fresh stroked path (not
  // reusing the fill's own circle path as a stroke, which would straddle
  // the clip boundary above and end up visually inset/half-width).
  //
  // `radius - 0.5` clamped at 0: a REAL crash, not a theoretical one —
  // drawStones() animates a just-placed stone's radius up from 0
  // (STONE_ANIMATION_MS's own eased pop-in), so this runs with
  // sub-0.5px radius on every single white stone's first couple of
  // animation frames; `ctx.arc()` throws IndexSizeError on a negative
  // radius, which surfaced immediately as a real page error the first
  // time an AI (White) move was actually clicked through, not found by
  // inspection.
  if (colors.edgeColor && radius > 0.5) {
    ctx.strokeStyle = colors.edgeColor;
    ctx.globalAlpha = alpha * colors.edgeAlpha;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius - 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draws a semi-transparent "ghost" stone at (row, col) — the pointer's
 * current candidate placement (milestone 2: desktop hover preview / touch
 * press-drag preview), shown before the player commits. Reuses the same
 * fill color as a real stone of `player`; only alpha differs, so
 * committing reads as the ghost simply solidifying in place rather than a
 * different shape appearing. Deliberately still flat (not the glossy
 * gradient drawStone() now uses) — a ghost is meant to read as
 * insubstantial/provisional, and staying simple is itself part of how it
 * visually differs from a committed stone, on top of the alpha. Caller is
 * responsible for only calling this when the candidate cell is actually
 * empty and the game isn't over — this function just draws whatever it's
 * told to.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import("./layout.js").boardLayout>} layout
 * @param {number} row
 * @param {number} col
 * @param {0|1} player
 * @param {typeof DEFAULT_THEME} [theme]
 */
export function drawGhostStone(ctx, layout, row, col, player, theme = DEFAULT_THEME) {
  const { x, y } = dotPosition(layout, row, col);
  const radius = layout.cellSize * STONE_RADIUS_FRACTION;
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = theme.stones[player].fill;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Milestone 9: a small, faint X over a point Black is forbidden to play
 * (double-three, double-four, or overline) — CLAUDE.md milestone 9's own
 * explicit intent: "설명 없이 눈으로 배우게 하는 게 목적" (learn by seeing,
 * no explanation needed up front). Deliberately muted (low alpha, thin
 * stroke) rather than a bold red X — this marks points on an otherwise
 * ordinary board during Black's own turn, and a harsh mark on ~dozens of
 * candidate cells at once would visually dominate the board it's meant
 * to just quietly annotate. Uses the same lineColor every theme already
 * defines (no new theme field) so it always reads as "part of the grid's
 * own vocabulary," not a foreign color.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import("./layout.js").boardLayout>} layout
 * @param {number} row
 * @param {number} col
 * @param {typeof DEFAULT_THEME} [theme]
 */
export function drawForbiddenMarker(ctx, layout, row, col, theme = DEFAULT_THEME) {
  const { x, y } = dotPosition(layout, row, col);
  const half = layout.cellSize * STONE_RADIUS_FRACTION * 0.55;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = theme.lineColor;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - half, y - half);
  ctx.lineTo(x + half, y + half);
  ctx.moveTo(x + half, y - half);
  ctx.lineTo(x - half, y + half);
  ctx.stroke();
  ctx.restore();
}

/**
 * Milestone 8-1: a ring around the Hint feature's suggested cell —
 * deliberately a hollow outline, not a filled/ghost stone, so it's never
 * confused with the hover-preview ghost (drawGhostStone() above) or an
 * actual placed stone; a player should be able to tell at a glance "this
 * is a suggestion, not something already on the board or about to be
 * committed by my own cursor." Reuses theme.winLineColor (the same red
 * the win streak below uses) rather than adding a new theme color field —
 * one fewer thing every future theme has to define, and it's already
 * established as this app's "something notable is here" accent.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import("./layout.js").boardLayout>} layout
 * @param {number} row
 * @param {number} col
 * @param {typeof DEFAULT_THEME} [theme]
 */
export function drawHintMarker(ctx, layout, row, col, theme = DEFAULT_THEME) {
  const { x, y } = dotPosition(layout, row, col);
  const radius = layout.cellSize * STONE_RADIUS_FRACTION * 1.2; // slightly larger than a stone, so it reads as "around" it
  ctx.save();
  ctx.strokeStyle = theme.winLineColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Design-upgrade pass: a small solid dot (radius = stone radius * 0.12)
 * on the last-placed stone, replacing the old hollow ring — top-tier
 * Gomoku apps mark the last move this way. It's recomputed fresh from
 * `state.moves` on every render() call (main.js), so it only ever "moves"
 * because a new render() happened to run with a different last move —
 * there's no separate animation/tween state to get out of sync with the
 * actual game state.
 */
function drawLastMoveMarker(ctx, layout, lastMove, theme) {
  const { x, y } = dotPosition(layout, lastMove.row, lastMove.col);
  const radius = layout.cellSize * STONE_RADIUS_FRACTION * 0.12;
  ctx.save();
  ctx.fillStyle = theme.lastMoveMarker;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The win line's endpoints, extended past the first/last stone by a
 * proportional overhang (so the streak visibly runs PAST the ends, the
 * same reason store/scripts/cover-scene.mjs's own win-line bar does —
 * a beam that stops exactly at a stone's center can look like separate
 * peeking segments once stones are close together; one that clearly
 * overshoots both ends reads as one continuous streak), then interpolated
 * by `progress` (0..1, WIN_LINE_ANIMATION_MS — main.js) from the
 * extended start toward the extended end. Shared by both
 * drawWinStreakBehind() and drawWinStreakOverbloom() so they always
 * trace the exact same path.
 * @returns {{x1:number,y1:number,x2:number,y2:number}}
 */
function computeWinLineSegment(layout, winLine, progress) {
  const rawStart = dotPosition(layout, winLine[0][0], winLine[0][1]);
  const rawEnd = dotPosition(layout, winLine[winLine.length - 1][0], winLine[winLine.length - 1][1]);
  const dx = rawEnd.x - rawStart.x;
  const dy = rawEnd.y - rawStart.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const overhang = layout.cellSize * 0.5;
  const extStart = { x: rawStart.x - ux * overhang, y: rawStart.y - uy * overhang };
  const extEnd = { x: rawEnd.x + ux * overhang, y: rawEnd.y + uy * overhang };
  const clamped = Math.max(0, Math.min(1, progress));
  return {
    x1: extStart.x,
    y1: extStart.y,
    x2: extStart.x + (extEnd.x - extStart.x) * clamped,
    y2: extStart.y + (extEnd.y - extStart.y) * clamped,
  };
}

/**
 * The win streak's own glow, drawn BEHIND the stones (called before
 * drawStones() in drawBoard()) — two layered strokes along the same path
 * (a wide, low-alpha, heavily-blurred halo, then a narrower solid core
 * with a tighter blur of its own), both using Canvas2D's native
 * shadowColor/shadowBlur rather than manually drawing separate blurred
 * copies (this API's own idiomatic way to get a glow — cheaper than
 * simulating it, and simpler than store/scripts/cover-scene.mjs's SVG
 * version needed, since SVG has no equivalent to a shadow-on-a-stroke).
 * @param {number} progress - see computeWinLineSegment()
 */
function drawWinStreakBehind(ctx, layout, winLine, theme, progress) {
  const seg = computeWinLineSegment(layout, winLine, progress);
  const cellSize = layout.cellSize;

  ctx.save();
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = theme.winLineColor;
  ctx.shadowColor = theme.winLineColor;
  ctx.shadowBlur = cellSize * 0.55;
  ctx.lineWidth = cellSize * 0.85;
  ctx.beginPath();
  ctx.moveTo(seg.x1, seg.y1);
  ctx.lineTo(seg.x2, seg.y2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = theme.winLineColor;
  ctx.shadowColor = theme.winLineColor;
  ctx.shadowBlur = cellSize * 0.22;
  ctx.lineWidth = cellSize * 0.34;
  ctx.beginPath();
  ctx.moveTo(seg.x1, seg.y1);
  ctx.lineTo(seg.x2, seg.y2);
  ctx.stroke();
  ctx.restore();
}

/**
 * A faint, wider repeat of the same path, drawn AFTER the stones (called
 * at the end of drawBoard()) — without this, the parts of the core streak
 * that fall directly under an opaque stone body would be completely
 * hidden (drawWinStreakBehind() runs before drawStones() specifically so
 * per-stone rings are gone — "돌마다 링 금지" — and the streak reads as
 * running THROUGH the line, not around each stone). Low alpha so it
 * doesn't wash out the stones themselves.
 */
function drawWinStreakOverbloom(ctx, layout, winLine, theme, progress) {
  const seg = computeWinLineSegment(layout, winLine, progress);
  const cellSize = layout.cellSize;
  ctx.save();
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = theme.winLineColor;
  ctx.shadowColor = theme.winLineColor;
  ctx.shadowBlur = cellSize * 0.4;
  ctx.lineWidth = cellSize * 0.5;
  ctx.beginPath();
  ctx.moveTo(seg.x1, seg.y1);
  ctx.lineTo(seg.x2, seg.y2);
  ctx.stroke();
  ctx.restore();
}
