// game/layout.js
// The only place metres become pixels. Physics lives on a 2.4 m × 0.508 m
// surface with x running from the shooting end to the scoring end;
// this file decides where that rectangle sits on a given canvas and
// which way it points.
//
// ORIENTATION IS THE WHOLE JOB. The board is 4.7:1, so it fits a screen
// the way the screen is long: portrait draws it upright with the
// shooting end at the bottom (the player pushes away from themselves,
// which is what the real motion is), landscape lays it on its side with
// the shooting end at the left. Four Ball never did this and paid for it
// on landscape phones — a 2:1 table in a portrait column left the height
// unused, and the kickoff doc calls for the rotation to exist from day
// one rather than be retrofitted.

import { BOARD_LENGTH, BOARD_WIDTH, PUCK_RADIUS } from "./physics.js";

/** The wood around the playing surface, metres: the gutter a lost weight
 * falls into plus the outer rail. Drawn, and part of the fitted shape —
 * a board without its gutters reads as a floating plank. */
export const GUTTER_M = 0.075;
export const RAIL_M = 0.045;
export const APRON_M = GUTTER_M + RAIL_M;

/**
 * @param {number} viewW css px available to the board
 * @param {number} viewH
 * @returns layout with:
 *   orient      "portrait" | "landscape"
 *   scale       px per metre
 *   toScreen(x, y) board metres -> css px
 *   toBoard(sx, sy) css px -> board metres
 *   forward(sx, sy) screen delta -> {along, across} board metres
 *   boardRect   the playing surface in css px {x, y, w, h}
 *   tableRect   surface + gutters + rails in css px
 *   puckPx      weight radius in css px
 */
export function computeLayout(viewW, viewH) {
  const portrait = viewH >= viewW;
  const totalLong = BOARD_LENGTH + APRON_M * 2;
  const totalShort = BOARD_WIDTH + APRON_M * 2;
  // Fit the framed table into the view with a little air.
  const pad = 8;
  const availW = Math.max(40, viewW - pad * 2);
  const availH = Math.max(40, viewH - pad * 2);
  const scale = portrait
    ? Math.min(availH / totalLong, availW / totalShort)
    : Math.min(availW / totalLong, availH / totalShort);

  const tableW = (portrait ? totalShort : totalLong) * scale;
  const tableH = (portrait ? totalLong : totalShort) * scale;
  const tx = (viewW - tableW) / 2;
  const ty = (viewH - tableH) / 2;

  const apron = APRON_M * scale;
  const boardRect = portrait
    ? { x: tx + apron, y: ty + apron, w: BOARD_WIDTH * scale, h: BOARD_LENGTH * scale }
    : { x: tx + apron, y: ty + apron, w: BOARD_LENGTH * scale, h: BOARD_WIDTH * scale };

  // Portrait: board x (toward the scoring end) points UP the screen;
  // board y (across) points right. Landscape: board x points right;
  // board y points DOWN so the board is seen from the shooter's left,
  // and "aim a little right" still means a little right of centre.
  const toScreen = portrait
    ? (x, y) => ({ x: boardRect.x + y * scale, y: boardRect.y + boardRect.h - x * scale })
    : (x, y) => ({ x: boardRect.x + x * scale, y: boardRect.y + y * scale });
  const toBoard = portrait
    ? (sx, sy) => ({ x: (boardRect.y + boardRect.h - sy) / scale, y: (sx - boardRect.x) / scale })
    : (sx, sy) => ({ x: (sx - boardRect.x) / scale, y: (sy - boardRect.y) / scale });
  // A screen-space drag as board-space progress: `along` grows toward the
  // scoring end, `across` toward +y.
  const forward = portrait
    ? (dx, dy) => ({ along: -dy / scale, across: dx / scale })
    : (dx, dy) => ({ along: dx / scale, across: dy / scale });

  return {
    orient: portrait ? "portrait" : "landscape",
    scale,
    toScreen,
    toBoard,
    forward,
    boardRect,
    tableRect: { x: tx, y: ty, w: tableW, h: tableH },
    puckPx: PUCK_RADIUS * scale,
    gutterPx: GUTTER_M * scale,
    railPx: RAIL_M * scale,
  };
}
