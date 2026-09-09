// test/theme-surround.test.js
// The one rule the table behind the board has to obey.
//
// game/render.js's readability contract is built on a single physical
// assumption: the board is the brightest object on the screen, everything
// on it is lit from the upper left, and the page behind it is not
// competing for the eye. Every prop's body gradient, far-rim occlusion
// and specular core is tuned against that. Put a surround behind the
// board that is brighter than the board's own darkest surface and the
// whole model inverts — the board reads as a hole punched in a lit page,
// the props' rim shadows stop meaning "edge", and a 17px peg loses the
// only cue that separates it from a stone.
//
// The surround is a colour rather than an image precisely so this can be
// checked arithmetically instead of by looking at a hundred screenshots.
// It is checked at BOTH ends of the per-act ramp and at every point
// between, because main.js's applySurround() mixes the two.
import { test, assertTrue } from "./harness.js";
import { THEMES } from "../src/game/themes.js";
import { DEFAULT_THEME } from "../src/game/render.js";

/** WCAG relative luminance, 0..1. */
function relLuminance(hex) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** The same linear mix main.js's applySurround() does, kept here rather
 * than imported because main.js is a DOM module and this suite has no
 * browser. If the two ever disagree the test is checking the wrong
 * colours, so the mix is deliberately trivial in both places. */
function mixHex(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

/** The darkest tone the board itself paints — the number the surround has
 * to stay under. Not the average and not the gradient's top: a board is
 * read at its dimmest corner, and on wood that is the shaded bottom edge
 * rather than the lit face. */
function darkestBoardTone(colors) {
  const candidates = [
    colors.boardColor,
    // The surface tones are what the board is ACTUALLY painted with now
    // (game/render.js's paintBoardSurface). Leaving them out would have
    // meant this test guarding a colour no longer on screen — which is
    // exactly how a check like this quietly stops checking anything.
    colors.surfaceTop,
    colors.surfaceMid,
    colors.surfaceBottom,
    colors.boardEdgeColor,
  ].filter(Boolean);
  return Math.min(...candidates.map(relLuminance));
}

for (const theme of THEMES) {
  test(`${theme.id}: the table stays darker than the board, at every act`, () => {
    const c = theme.colors;
    const warm = c.surroundWarm ?? DEFAULT_THEME.surroundWarm;
    const cool = c.surroundCool ?? DEFAULT_THEME.surroundCool;
    const edge = c.surroundEdge ?? DEFAULT_THEME.surroundEdge;
    const board = darkestBoardTone(c);
    // Eleven samples: the ten acts plus the menu's own point on the ramp.
    for (let i = 0; i <= 10; i++) {
      const mixed = relLuminance(mixHex(warm, cool, i / 10));
      assertTrue(
        mixed < board,
        `${theme.id} act ${i + 1}: surround ${mixed.toFixed(4)} >= board ${board.toFixed(4)}`,
      );
    }
    assertTrue(
      relLuminance(edge) <= relLuminance(warm) && relLuminance(edge) <= relLuminance(cool),
      `${theme.id}: the vignette edge must be the darkest part of the table`,
    );
  });
}

test("every theme declares the material it is made of", () => {
  // A theme falling back to a flat fill would lose the texture the whole
  // surface pass exists for, and one falling back to wood's tones behind
  // a near-black board would break the rule above silently.
  for (const theme of THEMES) {
    const c = theme.colors;
    assertTrue(
      typeof c.surface === "string" && typeof c.surfaceTop === "string"
        && typeof c.surfaceBottom === "string",
      `${theme.id} is missing surface/surfaceTop/surfaceBottom`,
    );
  }
});

test("every theme actually declares a table", () => {
  // Falling back to wood's brown behind Neon's near-black board would
  // break the rule above silently, so the fallback is not allowed to be
  // the answer for a shipped theme.
  for (const theme of THEMES) {
    const c = theme.colors;
    assertTrue(
      typeof c.surroundWarm === "string" && typeof c.surroundCool === "string"
        && typeof c.surroundEdge === "string",
      `${theme.id} is missing surroundWarm/surroundCool/surroundEdge`,
    );
  }
});
