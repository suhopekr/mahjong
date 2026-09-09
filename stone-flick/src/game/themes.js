// game/themes.js
// Board themes, ported from Gomoku (Daily Five) with the color data kept
// byte-for-byte and only the UNLOCK RULES rewritten. That split is the
// whole point of the port: the four palettes were tuned against real
// measured luminance numbers over several passes in that project, and
// re-picking colors here would throw that work away for no reason. What
// does not carry over is what earns them — Gomoku unlocked themes with
// achievements, Hard wins and daily streaks, none of which exist in this
// game. Here the campaign is the only progression, so the campaign is the
// only unlock currency.
//
// From Gomoku's own header, still true here and still the reason Neon
// works at all: on a near-black board a literal near-black stone is
// invisible on fill contrast alone. Every dark-board theme leans on the
// `highlight` slot of the stone's radial gradient (game/render.js's
// drawStone) to give the dark stone a bright glinting rim instead. That
// is not a workaround; it is how a real stone looks under directional
// light.
//
// "명도차" figures in Gomoku's version were WCAG relative luminance
// differences computed with a script, not eyeballed. Nothing here
// changes a single color channel, so those numbers still hold and are
// not restated.

import { DEFAULT_THEME } from "./render.js";

/**
 * @typedef {Object} UnlockContext
 * @property {number} stagesCleared - how many campaign stages have ever
 *   been cleared (core/storage.js's getClearedStageIds().length). Counted
 *   rather than "highest id" so it can only ever go up, which is what
 *   keeps an unlock from regressing.
 * @property {number} totalStars - every star ever earned, out of 36. Also
 *   monotonic: core/storage.js only ever raises a stage's stored star
 *   count, never lowers it.
 */

export const THEMES = [
  {
    id: "wood",
    name: "Wood",
    description: "Available from the start",
    colors: DEFAULT_THEME, // the same object render.js exports — not a copy
    check: () => true,
  },
  {
    id: "slate",
    name: "Slate",
    description: "Finish Chapter 1",
    colors: {
      boardColor: "#3a4750",
      // Slate is stone, and now says so. Honed rather than polished:
      // a polished slab would carry a highlight, and on this board the
      // lit things are the props.
      surface: "stone",
      surfaceTop: "#46545e",
      surfaceMid: "#3d4a54",
      surfaceBottom: "#303b44",
      speckleLight: "#c3d3dc",
      speckleDark: "#1d262c",
      bevelStrength: 0.85,
      // Slate's board is the darkest of the three lit themes, so its
      // table is pulled down to match — the contract is relative to
      // each board, not a global number.
      surroundWarm: "#241f1b",
      surroundCool: "#141c23",
      surroundEdge: "#080a0c",
      lineColor: "#dce6ea",
      starColor: "#dce6ea",
      stones: {
        0: { fill: "#1a1e22", highlight: "#6b7a84" },
        1: { fill: "#f2f5f6", highlight: "#ffffff" },
      },
      aimColor: "#e4572e",
      // Lifted well clear of the black stone (#1a1e22). It used to sit
      // almost on top of it, which was survivable while a peg wore a
      // bright metal collar and is not now that a peg is a plain dome in
      // this colour and nothing else: an obstacle that reads as a stone
      // is the one confusion on this board that costs a player a turn.
      obstacleColor: "#6d818e",
      obstacleEdge: "#8fa3ae",
      holeColor: "#12171a",
      // Slate's board is cool and dark, so brass reads too warm against
      // it — steel instead, same material story (the one metal), adjusted
      // to the theme's own light.
      bumperColor: "#b9c6cf",
      bumperEdge: "#4a565f",
      portalColors: ["#4fb0ff", "#ff9a3c", "#4fc08a"],
      // Fire stays WARM here even though the board is cool, and that is
      // the point: slate's bumper is steel, so a cold portal flame would
      // put the board's only two bright objects in the same temperature.
      emberCore: "#ffe0a4", emberMid: "#ff9330", emberOut: "#c33a0a",
      sandColor: "#293238",
      iceColor: "#d3e9f2",
    },
    // MOVED ONTO A CHAPTER BOUNDARY. It was 3 stages, chosen so the first
    // reward would arrive early enough to tell the player rewards exist —
    // still the point, and ten stages is still inside a first sitting.
    // What ten buys is that the reward lands ON the chapter-complete card
    // rather than three stages before it, so the FIRST chapter boundary a
    // player crosses is also the one that teaches them boundaries give
    // things. A boundary that hands you nothing the first time is a
    // boundary nobody looks for the second time.
    //
    // `stagesCleared >= 10` rather than a chapter test, and they are the
    // same thing here: stages unlock strictly in order (storage's
    // isStageUnlocked), so a count of ten IS stages 1-10. The count is
    // used because it is monotonic — an unlock can only ever go forward.
    check: (ctx) => ctx.stagesCleared >= 10,
  },
  {
    id: "paper",
    name: "Paper",
    description: "Finish Chapter 3",
    colors: {
      boardColor: "#efe3c8",
      // Paper is a printed board, so its surface is a SHEET: the fine
      // horizontal laid lines a mould's wires leave, the widely spaced
      // vertical chain lines that hold them, and loose fibre in the
      // pulp. The one surface here with a visible repeating structure,
      // which is right for paper and would be wrong for anything else.
      surface: "paper",
      surfaceTop: "#f3e8d2",
      surfaceMid: "#ece0c5",
      surfaceBottom: "#e2d4b4",
      poreColor: "#8a7a5f",
      bevelStrength: 0.6,
      // Paper is a printed board on a desk: the table can be a real
      // wood tone here because the sheet is the brightest thing in the
      // game by a wide margin.
      surroundWarm: "#33241a",
      surroundCool: "#1b242c",
      surroundEdge: "#0c0a08",
      // Softer/lower-contrast ink tone rather than a stark black rule —
      // reads as "thin, hand-drawn" through TONE rather than literal line
      // width, since theme data here is color constants only.
      lineColor: "#a89676",
      starColor: "#8a7a5f",
      stones: {
        0: { fill: "#2b2620", highlight: "#57503f" },
        1: { fill: "#fffdf9", highlight: "#ffffff" },
      },
      aimColor: "#c2442d",
      obstacleColor: "#c9b48c",
      obstacleEdge: "#8a7a5f",
      holeColor: "#6b5f47",
      bumperColor: "#c9922f",
      bumperEdge: "#6b4a14",
      portalColors: ["#2a86d8", "#e06a12", "#3d9e6c"],
      // Paper is a printed board: its fire is ink-vermilion rather than
      // a photographic flame, a shade softer than wood's.
      emberCore: "#ffd9a0", emberMid: "#f2762a", emberOut: "#a8300a",
      sandColor: "#8f7648",
      iceColor: "#b8d4de",
    },
    // Was 7 of 16, then 12 — a little past the teaching spine, so it lands
    // when the player has met every element rather than partway through.
    // 30 keeps that (every element is introduced by stage 19) and puts it
    // on a chapter boundary, which is now where rewards are handed out.
    // Chapter 3 rather than 2 so the two theme unlocks are not back to
    // back: one at the end of the first sitting, one at the point where
    // the campaign stops teaching and starts asking.
    check: (ctx) => ctx.stagesCleared >= 30,
  },
  {
    id: "neon",
    name: "Neon",
    // The one unlock that asks for QUALITY rather than progress. It was 40
    // of 96 (42%) when the campaign was sixteen stages; the total is 600
    // now, and holding the percentage would have meant 250 stars, which
    // past a certain point stops being an incentive and becomes a wall.
    // 200 is a third of them — still unreachable by walking the campaign
    // once, which is the whole point: it takes going back to the ones you
    // scraped through and doing them properly.
    description: "Earn 200 stars",
    colors: {
      boardColor: "#0d0f14",
      // A lit panel, and the quietest surface of the four by a wide
      // margin. Neon's board is near-black and is read by its glowing
      // rules rather than by its brightness, so grit here turns into
      // noise faster than anywhere else — and the tones are nudged UP
      // rather than down, because the table behind this theme is
      // already darker than the board (see surroundWarm below) and the
      // board has to stay the brighter of the two.
      surface: "matte",
      surfaceTop: "#151a24",
      surfaceMid: "#101520",
      surfaceBottom: "#0c1017",
      bevelStrength: 0.5,
      // Neon's board is ALREADY near-black — it is read by its glowing
      // rules, not by its brightness. A lifted table here would be the
      // brightest surface on the screen and the board would read as a
      // hole in it, so the surround goes darker than the board instead
      // and the vignette does all the work.
      surroundWarm: "#0a0709",
      surroundCool: "#06090e",
      surroundEdge: "#000000",
      lineColor: "#35e0ff",
      starColor: "#35e0ff",
      stones: {
        // NOT literal black — a dark graphite fill plus a genuinely bright
        // cyan highlight, so the fill/highlight gradient is what makes
        // this stone read against a near-black board.
        0: { fill: "#262c35", highlight: "#7ce9ff" },
        1: { fill: "#f5f5ff", highlight: "#ffffff" },
      },
      aimColor: "#ff5ca8",
      // Same fix as slate: the old value sat between the board (#0d0f14)
      // and the dark stone (#262c35) and read as neither.
      obstacleColor: "#41596e",
      obstacleEdge: "#35e0ff",
      holeColor: "#05070a",
      // Neon is the one theme where a lit, saturated obstacle belongs —
      // its whole board is already a dark surface with glowing rules, so
      // metal here is chrome under coloured light rather than brass.
      bumperColor: "#ff5fa8",
      bumperEdge: "#5a0a2c",
      portalColors: ["#35e0ff", "#ff8a3c", "#3dffa8"],
      // The one theme where the flame is not fire. Neon's board is
      // already a dark surface full of glowing rules, so an orange flame
      // would read as the only naturalistic object in a synthetic scene —
      // and its bumper is pink, so cyan keeps the two apart.
      emberCore: "#e4fbff", emberMid: "#35e0ff", emberOut: "#0d4fa8",
      sandColor: "#22303c",
      iceColor: "#7ce9ff",
    },
    check: (ctx) => ctx.totalStars >= 200,
  },
];

/** @returns {boolean} false for an unknown id too, not just a locked one */
export function isThemeUnlocked(id, context) {
  const theme = THEMES.find((t) => t.id === id);
  return theme ? theme.check(context) : false;
}

/** @returns {string[]} every currently-unlocked theme id */
export function getUnlockedThemeIds(context) {
  return THEMES.filter((t) => t.check(context)).map((t) => t.id);
}

/** Falls back to THEMES[0] (wood, always unlocked) for an unknown id. */
export function getThemeById(id) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/**
 * The load-time half of the two-layer defense against a locked theme
 * being forced into use. core/storage.js's own THEME_IDS whitelist only
 * asks "is this a REAL theme id" — it deliberately knows nothing about
 * unlock rules, so a hand-edited save sails straight through it. This is
 * the one place EARNED status is checked before a stored selection is
 * trusted.
 */
export function resolveActiveThemeId(selectedId, context) {
  return isThemeUnlocked(selectedId, context) ? selectedId : "wood";
}
