// game/themes.js
// Board themes: 3 light, matte palettes, ALL available from the start.
//
// --- no unlock concept -------------------------------------------------
//
// The source project gated Slate/Paper/Neon behind unlock conditions
// (achievement count, a Hard win, a 3-day Daily Challenge streak). All of
// that is gone. Neon's condition depended on a Daily Challenge this port
// doesn't have, so it would have been a permanently un-earnable row; the
// theme was removed rather than re-conditioned, and Slate/Paper's
// conditions went with it. There is no check(), no UnlockContext, no
// isThemeUnlocked(), no getUnlockedThemeIds(). Picking a theme is just
// picking a theme — a lock is friction, and this audience has no reason
// to earn the right to a colour they can read more easily.
//
// --- why every board here is LIGHT and MATTE ---------------------------
//
// The source had a saturated wood board with a gradient and painted
// grain, plus a dark slate and a near-black neon. Two measured problems
// drove the change:
//
//   1. A white stone cannot reach 3:1 against any light board — measured
//      1.21-1.33:1 across all three boards here, and that is a property
//      of two light surfaces, not of these particular colours. The
//      contrast has to come from the stone's BORDER instead, which is why
//      every stone below declares edgeColor/edgeWidth (render.js's
//      drawStone() honours both). Those borders measure 9.48-11.79:1.
//   2. A gradient means every element sits on a RANGE of backgrounds, so
//      "3:1 against the board" stops being a single checkable number. The
//      old grid line measured 6.98:1 at the top of the board and 5.12:1
//      at the bottom. Flat boards make every ratio one value.
//
// Keeping all three boards light also means ONE set of stone colours and
// borders is correct on all of them. A dark board would flip which stone
// risks disappearing (black rather than white) and need a second, mirrored
// set of border decisions — more surface area, and more to get wrong.
//
// --- methodology -------------------------------------------------------
//
// Every ratio quoted below is a WCAG contrast RATIO (1-21), computed from
// linearized-sRGB relative luminance, by script rather than by eye. They
// are re-checkable: every element in every theme is asserted >= 3:1
// against its own board. Note this is the 3:1 non-text/UI threshold; the
// 4.5:1 text threshold applies to the page chrome, which is CSS, not this
// file.

/**
 * @typedef {Object} ThemeColors
 * @property {string} boardColor - flat fallback fill; still required, still
 *   what Slate/Paper actually render (game/render.js's paintBackground()
 *   only takes the gradient+grain path when boardGradientTop/Bottom are
 *   BOTH present)
 * @property {string} [boardGradientTop] - optional; wood-only, so this
 *   stays absent on every other theme rather than forcing them to also
 *   define a gradient
 * @property {string} [boardGradientBottom]
 * @property {string} [boardEdgeColor] - the board's own "thickness" strip
 * @property {string} [grainColor] - wood-grain wave lines
 * @property {string} lineColor
 * @property {string} starColor
 * @property {{0: {fill: string, highlight: string, rim?: string}, 1: {fill: string, highlight: string, rim?: string}}} stones -
 *   `rim` is optional — wood is the only theme that defines it
 *   explicitly; game/render.js's drawStone() derives one automatically
 *   (darkening `fill`) for any theme that doesn't, so Slate/Paper's own
 *   stored data below still renders with the glossy 3-stop gradient
 *   technique
 * @property {string} lastMoveMarker
 * @property {string} winLineColor
 */

// Kept separate from render.js's DEFAULT_THEME import below on purpose —
// this module still needs to name wood and describe it even though its
// colors are borrowed, not owned, by this file.
import { DEFAULT_THEME } from "./render.js";

export const THEMES = [
  {
    id: "wood",
    name: "Warm",
    description: "Soft sand — the default",
    colors: DEFAULT_THEME, // the exact same object render.js exports — not a copy
  },
  {
    id: "slate",
    name: "Cool",
    description: "Pale blue-grey",
    colors: {
      // Kept LIGHT rather than the source's dark #3a4750 slate. A dark
      // board flips which stone is at risk of disappearing (black
      // instead of white) and would need a whole second set of border
      // decisions; every theme here is a light, matte surface so the one
      // set of stone borders is correct on all of them.
      // Measured on #d5dade: line 9.48:1, black fill 12.36:1, white
      // stone border 9.48:1, last-move/win line 4.64:1, danger 6.33:1.
      boardColor: "#d5dade",
      boardEdgeColor: "#b3bcc2",
      lineColor: "#2b3033",
      starColor: "#2b3033",
      stones: {
        0: { fill: "#1a1a1a", highlight: "#8f8f8f", rim: "#000000", edgeColor: "#000000", edgeAlpha: 1, edgeWidth: 2, gradientExtent: 1.1, shadowBoost: 0.3 },
        1: { fill: "#f7f8f9", highlight: "#ffffff", rim: "#e6e8ea", rimStart: 0.82, edgeColor: "#2b3033", edgeAlpha: 1, edgeWidth: 3, gradientExtent: 1.1, shadowBoost: 0.08 },
      },
      lastMoveMarker: "#b3261e",
      winLineColor: "#b3261e",
      dangerColor: "#8f1d16",
    },
  },
  {
    id: "paper",
    name: "Paper",
    description: "Near-white, highest contrast",
    colors: {
      // The highest-contrast option, offered for anyone who finds even
      // the default board too warm/dim. Measured on #efe9dc: line
      // 11.79:1, black fill 15.23:1, white stone border 11.79:1,
      // last-move/win line 5.40:1, danger 7.37:1.
      boardColor: "#efe9dc",
      boardEdgeColor: "#cfc6ab",
      lineColor: "#2f2a20",
      starColor: "#2f2a20",
      stones: {
        0: { fill: "#141414", highlight: "#8a8a8a", rim: "#000000", edgeColor: "#000000", edgeAlpha: 1, edgeWidth: 2, gradientExtent: 1.1, shadowBoost: 0.3 },
        1: { fill: "#ffffff", highlight: "#ffffff", rim: "#f0f0ec", rimStart: 0.82, edgeColor: "#2f2a20", edgeAlpha: 1, edgeWidth: 3, gradientExtent: 1.1, shadowBoost: 0.08 },
      },
      lastMoveMarker: "#b3261e",
      winLineColor: "#b3261e",
      dangerColor: "#8f1d16",
    },
  },
];

/** @param {string} id
 * @returns {(typeof THEMES)[number]} falls back to THEMES[0] (wood) for
 *   an unrecognized id — wood always exists, so this is always a safe,
 *   renderable theme to fall back to */
export function getThemeById(id) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/**
 * The theme to actually RENDER with, given whatever core/storage.js's
 * getTheme() returned. With unlock conditions gone this is a pure
 * "is this a real theme id" check — but it is still a real check, and
 * still the one main.js calls, because a stored id can outlive the theme
 * it names: a save written before Neon was removed still says
 * `selected: "neon"`, and storage.js's own THEME_IDS whitelist is a
 * separate list that could drift from THEMES. Anything this file doesn't
 * recognize renders as wood rather than crashing or painting nothing.
 * @param {string} selectedId - core/storage.js's getTheme() return value
 * @returns {string} `selectedId` if it names a real theme, otherwise "wood"
 */
export function resolveActiveThemeId(selectedId) {
  return THEMES.some((t) => t.id === selectedId) ? selectedId : "wood";
}
