// test/theme.test.js
// game/theme.js is pure data + pure decision functions — no persistence,
// no DOM. Two kinds of coverage here: (1) the unlock-condition logic
// itself (isThemeUnlocked/evaluateNewlyUnlockedThemes), and (2) the
// accessibility requirement CLAUDE.md's milestone note calls out
// explicitly — every skin's two player colors need a real luminance
// separation, not just a hue difference, "especially in Neon and
// Blueprint."

import { THEMES, getTheme, unlockDescription, isThemeUnlocked, evaluateNewlyUnlockedThemes } from "../src/game/theme.js";
import { test, assertEqual, assertTrue } from "./harness.js";

// --- data shape --------------------------------------------------------

test("THEMES has exactly 4 skins with distinct ids", () => {
  assertEqual(THEMES.length, 4);
  assertEqual(new Set(THEMES.map((t) => t.id)).size, 4);
});

test("getTheme returns the matching theme, or Paper for an unknown id", () => {
  assertEqual(getTheme("neon").id, "neon");
  assertEqual(getTheme("nonexistent").id, "paper");
  assertEqual(getTheme(undefined).id, "paper");
});

test("Paper is always unlocked by default; the other three are not", () => {
  const noFacts = { unlockedAchievementCount: 0, hasHardWin: false, bestDailyStreak: 0 };
  assertTrue(isThemeUnlocked(getTheme("paper"), noFacts));
  assertTrue(!isThemeUnlocked(getTheme("chalkboard"), noFacts));
  assertTrue(!isThemeUnlocked(getTheme("neon"), noFacts));
  assertTrue(!isThemeUnlocked(getTheme("blueprint"), noFacts));
});

// --- unlock conditions ---------------------------------------------------

test("Chalkboard: unlocks at exactly 3 unlocked achievements, not before", () => {
  const at2 = { unlockedAchievementCount: 2, hasHardWin: false, bestDailyStreak: 0 };
  const at3 = { unlockedAchievementCount: 3, hasHardWin: false, bestDailyStreak: 0 };
  assertTrue(!isThemeUnlocked(getTheme("chalkboard"), at2));
  assertTrue(isThemeUnlocked(getTheme("chalkboard"), at3));
});

test("Neon: unlocks on hasHardWin, independent of everything else", () => {
  const facts = { unlockedAchievementCount: 0, hasHardWin: true, bestDailyStreak: 0 };
  assertTrue(isThemeUnlocked(getTheme("neon"), facts));
});

test("Blueprint: unlocks at exactly a 3-day daily streak, not before", () => {
  const at2 = { unlockedAchievementCount: 0, hasHardWin: false, bestDailyStreak: 2 };
  const at3 = { unlockedAchievementCount: 0, hasHardWin: false, bestDailyStreak: 3 };
  assertTrue(!isThemeUnlocked(getTheme("blueprint"), at2));
  assertTrue(isThemeUnlocked(getTheme("blueprint"), at3));
});

test("unlockDescription: every skin has a non-empty, distinct-enough description", () => {
  for (const theme of THEMES) {
    const desc = unlockDescription(theme);
    assertTrue(typeof desc === "string" && desc.length > 0, `${theme.id} has no unlock description`);
  }
  assertEqual(unlockDescription(getTheme("chalkboard")), "Unlock 3 achievements.");
  assertEqual(unlockDescription(getTheme("neon")), "Win a game on Hard difficulty.");
  assertEqual(unlockDescription(getTheme("blueprint")), "Reach a 3-day Daily Challenge streak.");
});

// --- evaluateNewlyUnlockedThemes -----------------------------------------

test("evaluateNewlyUnlockedThemes: returns only what's unlocked now AND not already known", () => {
  const facts = { unlockedAchievementCount: 5, hasHardWin: true, bestDailyStreak: 0 };
  // Paper, Chalkboard, Neon all satisfied; Blueprint is not.
  const newly = evaluateNewlyUnlockedThemes(facts, new Set(["paper"]));
  assertEqual(
    newly.map((t) => t.id).sort(),
    ["chalkboard", "neon"]
  );
});

test("evaluateNewlyUnlockedThemes: everything already known -> nothing newly returned", () => {
  const facts = { unlockedAchievementCount: 99, hasHardWin: true, bestDailyStreak: 99 };
  const newly = evaluateNewlyUnlockedThemes(facts, new Set(["paper", "chalkboard", "neon", "blueprint"]));
  assertEqual(newly, []);
});

test("evaluateNewlyUnlockedThemes: accepts a plain array too, not just a Set", () => {
  const facts = { unlockedAchievementCount: 3, hasHardWin: false, bestDailyStreak: 0 };
  const newly = evaluateNewlyUnlockedThemes(facts, ["paper"]);
  assertEqual(newly.map((t) => t.id), ["chalkboard"]);
});

// --- accessibility: player-color distinguishability ----------------------
//
// WCAG relative luminance (sRGB), computed straight from the spec
// formula — no dependency, just arithmetic, same spirit as
// game/daily.js's mulberry32 being a few lines of self-contained math.

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA, hexB) {
  const l1 = Math.max(relativeLuminance(hexA), relativeLuminance(hexB));
  const l2 = Math.min(relativeLuminance(hexA), relativeLuminance(hexB));
  return (l1 + 0.05) / (l2 + 0.05);
}

test("accessibility: every skin's two player colors clear a 3:1 contrast ratio against that skin's own background (WCAG 1.4.11 floor for non-text UI/graphics)", () => {
  for (const theme of THEMES) {
    const [p0, p1] = theme.board.playerColors;
    const bg = theme.board.background;
    assertTrue(
      contrastRatio(p0, bg) >= 3.0,
      `${theme.id}: player 0 (${p0}) only has ${contrastRatio(p0, bg).toFixed(2)}:1 against its background`
    );
    assertTrue(
      contrastRatio(p1, bg) >= 3.0,
      `${theme.id}: player 1 (${p1}) only has ${contrastRatio(p1, bg).toFixed(2)}:1 against its background`
    );
  }
});

// The three NEW skins (Chalkboard/Neon/Blueprint) were deliberately
// color-picked for a real luminance GAP between the two player colors —
// not just a hue difference — so they're still distinguishable in
// grayscale or by a colorblind viewer relying on brightness rather than
// hue. CLAUDE.md's milestone note calls this out for Neon and Blueprint
// especially, and Chalkboard/Paper were both held to the same bar.
// Paper's blue was darkened in a follow-up pass specifically to bring it
// up to this bar (it originally shipped at Δ0.03 — see game/theme.js's
// module comment for the exact before/after numbers and why only blue
// moved, not orange) — ALL FOUR skins are checked here now, not three.
test("accessibility: every skin has a real luminance gap between its two player colors (>= 0.15), not just a hue difference", () => {
  for (const theme of THEMES) {
    const [p0, p1] = theme.board.playerColors;
    const delta = Math.abs(relativeLuminance(p0) - relativeLuminance(p1));
    assertTrue(delta >= 0.15, `${theme.id}: luminance delta is only ${delta.toFixed(3)}`);
  }
});

test("accessibility: no skin reuses the exact same hex for both player colors", () => {
  for (const theme of THEMES) {
    const [p0, p1] = theme.board.playerColors;
    assertTrue(p0.toLowerCase() !== p1.toLowerCase(), `${theme.id}: both player colors are identical`);
  }
});
