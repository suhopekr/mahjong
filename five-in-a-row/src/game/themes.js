// game/themes.js
// Board themes: 3 color palettes, ALL available from the start.
//
// The Gomoku original gated Slate/Paper/Neon behind unlock conditions
// (achievement count, a Hard win, a 3-day Daily Challenge streak). This
// port drops that entire concept:
//
//   - Neon's condition depended on the Daily Challenge, which isn't part
//     of this port at all — it would have been a permanently un-earnable
//     row sitting in the theme list forever. The theme is gone, not
//     re-conditioned.
//   - Slate/Paper's conditions were removed along with it, so the module
//     has no unlock concept left to be inconsistent about: there is no
//     check(), no UnlockContext, no isThemeUnlocked(), no
//     getUnlockedThemeIds(). Every theme in THEMES is selectable.
//
// What that means for callers: main.js no longer builds an unlock
// context, no longer diffs before/after unlock sets to toast a newly
// earned theme, and no longer renders locked rows. Picking a theme is
// just picking a theme.
//
// Each theme's `colors` object is exactly game/render.js's DEFAULT_THEME
// shape (that module's own doc comment: "Kept as a plain parameter... so
// a later skin milestone can override it without touching this file's
// logic") — selecting a theme in main.js just means passing a different
// one of these objects as drawBoard()'s/drawGhostStone()'s own `theme`
// option instead of DEFAULT_THEME.
//
// --- stone colors: black/white is a real constraint here, not just a
// --- reskin -----------------------------------------------------------
//
// Black-moved-first is close to universal in this game, so every theme
// still needs a color that reads as "the black one" and a color that
// reads as "the white one," with black always legible as the darker/
// other of the pair — literal black vs. literal white was never actually
// a hard requirement, just wood's own default choice (see DEFAULT_THEME's
// own comment in render.js).
//
// Slate's dark board is where that gets tight: drawStone() paints every
// stone with a radial gradient from a `highlight` color to a `fill`
// color, so the existing highlight slot alone is enough to give a dark
// stone a genuinely bright glinting rim against a dark board, without
// any render.js change. This is also how a real black stone actually
// looks under directional light (a bright highlight, a nearly-black
// shadow side).
//
// --- luminance methodology --------------------------------------------
//
// "명도차" below is WCAG relative luminance (linearized sRGB, standard
// L = 0.2126*R + 0.7152*G + 0.0722*B formula), NOT a raw 0-255 brightness
// average and NOT the WCAG contrast RATIO (which is unbounded, 1-21) —
// relative luminance is bounded [0, 1] per color, so a plain absolute
// difference between two colors' L values is itself a 0-1 number. Every
// value below was computed with a script, not eyeballed.

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
    name: "Wood",
    description: "Warm goban wood",
    colors: DEFAULT_THEME, // the exact same object render.js has always exported — not a copy
  },
  {
    id: "slate",
    name: "Slate",
    description: "Cool dark stone",
    colors: {
      boardColor: "#3a4750",
      lineColor: "#dce6ea",
      starColor: "#dce6ea",
      stones: {
        0: { fill: "#1a1e22", highlight: "#6b7a84" },
        1: { fill: "#f2f5f6", highlight: "#ffffff" },
      },
      lastMoveMarker: "#e4572e",
      winLineColor: "#e4572e",
    },
  },
  {
    id: "paper",
    name: "Paper",
    description: "Soft ink on paper",
    colors: {
      boardColor: "#efe3c8",
      // Softer/lower-contrast ink tone rather than a stark black rule —
      // reads as "thin, hand-drawn" through TONE (a color choice) rather
      // than literal line width, since render.js's grid line width isn't
      // theme data.
      lineColor: "#a89676",
      starColor: "#8a7a5f",
      stones: {
        0: { fill: "#2b2620", highlight: "#57503f" },
        1: { fill: "#fffdf9", highlight: "#ffffff" },
      },
      lastMoveMarker: "#e4572e",
      winLineColor: "#e4572e",
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
