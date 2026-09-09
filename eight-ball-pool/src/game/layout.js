// game/layout.js
// The one place table metres become CSS pixels. Pure math, no DOM.
//
// A pool table is 2:1 and a phone held upright is 1:2, so the table
// ROTATES: its long axis runs along the screen's long axis (the head of
// the table — where the player breaks from — at the bottom of a portrait
// screen). Physics never hears about it: game/physics.js works in table
// coordinates and the rotation lives entirely in toPx/toTable.
//
// Unlike four-ball, the controls are DOM (a power slider, a Shoot button,
// the toolbar) rather than painted on the canvas, so this file only has
// to fit the table itself into the canvas it is given.

import { TABLE_LENGTH, TABLE_WIDTH, BALL_RADIUS } from "./physics.js";

/** Wooden rail width, in table metres, drawn outside the playing surface. */
export const RAIL = 0.08;

/** The canvas keeps this much clear around the frame, in px — room for
 * the cue's butt to show past the rail and for a finger to land on the
 * rail itself. */
export const MARGIN_PX = 4;

/** The frame's outer size in table metres. */
export const BOX_ALONG = TABLE_LENGTH + 2 * RAIL;
export const BOX_ACROSS = TABLE_WIDTH + 2 * RAIL;

/**
 * Fit the table into a canvas of width x height CSS px.
 * @param {boolean} rotated  long axis vertical (portrait phones)
 * @returns {{scale:number, rotated:boolean, width:number, height:number,
 *            originX:number, originY:number, ballPx:number, railPx:number}}
 *   `scale` is px per table metre; (originX, originY) is the top-left of
 *   the PLAYING SURFACE (cushion nose), not of the wooden frame.
 */
export function tableLayout(width, height, rotated) {
  const m = MARGIN_PX;
  const availW = Math.max(1, width - 2 * m);
  const availH = Math.max(1, height - 2 * m);
  const boxW = rotated ? BOX_ACROSS : BOX_ALONG;
  const boxH = rotated ? BOX_ALONG : BOX_ACROSS;
  const scale = Math.max(1, Math.min(availW / boxW, availH / boxH));
  const drawnW = boxW * scale;
  const drawnH = boxH * scale;
  return {
    scale,
    rotated,
    width,
    height,
    originX: m + (availW - drawnW) / 2 + RAIL * scale,
    originY: m + (availH - drawnH) / 2 + RAIL * scale,
    ballPx: BALL_RADIUS * scale,
    railPx: RAIL * scale,
  };
}

/** The canvas size (CSS px) that shows the table at its largest inside a
 * box of maxW x maxH, so the canvas element can be sized exactly to the
 * frame and nothing else on the page has to guess where the wood ends. */
export function canvasSizeFor(maxW, maxH, rotated) {
  const boxW = rotated ? BOX_ACROSS : BOX_ALONG;
  const boxH = rotated ? BOX_ALONG : BOX_ACROSS;
  const scale = Math.max(1, Math.min((maxW - 2 * MARGIN_PX) / boxW, (maxH - 2 * MARGIN_PX) / boxH));
  return {
    width: Math.floor(boxW * scale + 2 * MARGIN_PX),
    height: Math.floor(boxH * scale + 2 * MARGIN_PX),
    scale,
  };
}

/** Table metres -> canvas CSS px. Rotated: the head of the table (x = 0)
 * sits at the BOTTOM of a portrait screen, where the player stands. */
export function toPx(L, x, y) {
  if (L.rotated) {
    return { x: L.originX + y * L.scale, y: L.originY + (TABLE_LENGTH - x) * L.scale };
  }
  return { x: L.originX + x * L.scale, y: L.originY + y * L.scale };
}

/** Canvas CSS px -> table metres. Unclamped on purpose. */
export function toTable(L, px, py) {
  if (L.rotated) {
    return { x: TABLE_LENGTH - (py - L.originY) / L.scale, y: (px - L.originX) / L.scale };
  }
  return { x: (px - L.originX) / L.scale, y: (py - L.originY) / L.scale };
}

/** A direction in table space -> screen space. Directions rotate but do
 * not translate; using toPx on a vector is a classic silent bug. */
export function dirToScreen(L, dx, dy) {
  return L.rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
}

export function dirToTable(L, dx, dy) {
  return L.rotated ? { x: -dy, y: dx } : { x: dx, y: dy };
}

/** The angle of (tableX, tableY) around the ball, in table space. The
 * aim is turned by the DIFFERENCE between two of these: a hand anywhere on
 * the cloth turns the cue around the ball, and a press is worth zero
 * rotation. */
export function angleAround(ballX, ballY, tableX, tableY) {
  return Math.atan2(tableY - ballY, tableX - ballX);
}

/** Fold an angle into (-pi, pi]. */
export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Closer to the ball's centre than this, the angle around it is all
 * jitter, so the turn is not read. */
export const AIM_PIVOT_MIN_PX = 14;

/** The cue's drawn length in table metres. */
export const CUE_LENGTH_M = 0.95;

/** How far a press may travel and still count as a TAP (which places the
 * cue ball when it is in hand). */
export const TAP_SLOP_PX = 9;

/** How far one press of the aim nudge turns the cue, in degrees. */
export const NUDGE_DEGREES = 0.5;

/**
 * THE POWER CURVE: the slider's travel is spent where the shots are.
 * Almost every shot is played between a fifth and half of the range, so
 * the first 72% of the slider covers up to 42% power and the last 28%
 * covers the rest. (Four-ball's curve, kept: it was tuned by hand.)
 */
export const FINE_PULL = 0.72;
export const FINE_POWER = 0.42;
const FINE_CURVE = 1.15;
const SMASH_CURVE = 1.35;

/** Slider fraction (0-1) -> power (0-1). */
export function powerForPull(pull) {
  const p = Math.min(1, Math.max(0, pull));
  if (p <= FINE_PULL) return FINE_POWER * (p / FINE_PULL) ** FINE_CURVE;
  const t = (p - FINE_PULL) / (1 - FINE_PULL);
  return FINE_POWER + (1 - FINE_POWER) * t ** SMASH_CURVE;
}

/** The inverse. */
export function pullForPower(power) {
  const q = Math.min(1, Math.max(0, power));
  if (q <= FINE_POWER) return FINE_PULL * (q / FINE_POWER) ** (1 / FINE_CURVE);
  const t = ((q - FINE_POWER) / (1 - FINE_POWER)) ** (1 / SMASH_CURVE);
  return FINE_PULL + (1 - FINE_PULL) * t;
}

export const MIN_SHOT_SPEED = 0.35;

/** The table's outer edge in canvas pixels. */
export function tableFrame(L) {
  const a = toPx(L, 0, 0);
  const b = toPx(L, TABLE_LENGTH, TABLE_WIDTH);
  return {
    left: Math.min(a.x, b.x) - L.railPx,
    right: Math.max(a.x, b.x) + L.railPx,
    top: Math.min(a.y, b.y) - L.railPx,
    bottom: Math.max(a.y, b.y) + L.railPx,
  };
}
