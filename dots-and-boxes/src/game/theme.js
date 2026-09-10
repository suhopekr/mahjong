// game/theme.js
// Board skins. All rendering is procedural Canvas 2D (CLAUDE.md's
// <100KB build budget rules out image assets entirely), so a "skin" is
// nothing more than a set of color constants — game/render.js takes a
// `theme` object instead of hardcoded colors (see its own module
// comment for the extraction).
//
// No currency, no purchases (CLAUDE.md section 11 rules out accounts/
// payments anyway) — every skin beyond the default unlocks from an
// accomplishment already tracked elsewhere: game/achievements.js's
// unlocked count, a Hard-difficulty win, core/storage.js's Daily
// Challenge streak. This module only decides WHETHER a given skin is
// unlocked given those facts (isThemeUnlocked) — it doesn't persist or
// track anything itself, same storage-is-dumb-facts / game-module-is-
// the-decider split established by achievements.js and daily.js.
//
// Unlock status is deliberately NOT cached as a one-time event the way
// achievement unlocks are — every skin's condition here is a function
// of CURRENT CUMULATIVE STATE (total achievements so far, whether Hard
// has ever been won, best daily streak), all of which are always fully
// re-derivable from persisted facts. So isThemeUnlocked() is a pure,
// stateless recomputation every time it's asked, and core/storage.js's
// `skins.unlocked` list exists only to know which ones have already
// been announced with a toast (see evaluateNewlyUnlockedThemes()) —
// not as the source of truth for whether a skin COULD be selected.
//
// --- accessibility: player-color distinguishability ---
//
// Every skin's two player colors are chosen for BOTH a hue difference
// (never a red/green pair — the single most common colorblind
// confusion) AND a meaningful relative-luminance gap, so the two are
// still tellable apart in grayscale or for a colorblind viewer relying
// on brightness rather than hue. Measured (WCAG relative luminance, see
// test/theme.test.js): Chalkboard Δ0.38, Neon Δ0.34, Blueprint Δ0.26,
// Paper Δ0.16 — every skin now clears the same ≥0.15 bar. Every skin's
// two player colors also clear a 3:1 contrast ratio against that skin's
// own background (WCAG 1.4.11's floor for non-text UI/graphics) — also
// test-covered.
//
// Paper's player 1 (blue) was darkened in a follow-up pass: it shipped
// since milestone 1 at #2e86ab, distinguishable from player 0's orange
// by hue alone (still not a red/green pair, so usably safe even then)
// but with almost no luminance gap (Δ0.03) — Paper is the DEFAULT skin,
// so this is what most players actually see. Fixed by darkening blue
// ONLY (#2e86ab -> #1d546b, L 0.206 -> 0.077) while leaving orange
// (#e4572e) byte-for-byte untouched: orange doubles as --accent across
// the whole UI chrome (buttons, active toggle states, the Start Game
// CTA), so changing it would have shifted far more of the app's look
// than the two player colors alone — keeping cover images/screenshots'
// overall impression close to unchanged was an explicit constraint.
// Before: L(orange)=0.235, L(blue)=0.206, Δ0.029. After: L(orange)=0.235
// (unchanged), L(blue)=0.077, Δ0.158 — comfortably past the 0.15 floor,
// and blue's own contrast against Paper's background actually IMPROVED
// (3.84:1 -> 7.76:1) as a side effect of darkening it.
//
// `board.edgeUndrawn` (a faint guide line for every not-yet-drawn edge)
// was removed in a follow-up pass — see game/render.js's module comment
// for why. Removing it changes nothing about dot/edgeDrawn legibility:
// those were never relying on the guide line for their own contrast,
// they're drawn at full strength regardless. Measured contrast against
// each skin's own background (WCAG, same formula as above) — every
// value already sat far above the 3:1 floor before this removal, so
// none of these needed to change either: Paper 13.25:1, Chalkboard
// 11.29:1, Neon dot 15.68:1 / edgeDrawn 18.12:1, Blueprint 11.74:1.

const THEMES = [
  {
    id: "paper",
    name: "Paper",
    unlock: { type: "default" },
    board: {
      background: "#faf7f2",
      dot: "#2b2b2b",
      edgeDrawn: "#2b2b2b",
      playerColors: ["#e4572e", "#1d546b"],
      hint: "#22c55e",
      lastMoveGlow: "rgba(255, 210, 0, 0.9)",
    },
    cssVars: {
      "--bg": "#f4efe6",
      "--panel": "#ffffff",
      "--text": "#2b2b2b",
      "--muted": "#8a8478",
      "--accent": "#e4572e",
      "--daily-accent": "#2b6cb0",
    },
  },
  {
    id: "chalkboard",
    name: "Chalkboard",
    unlock: { type: "achievementCount", count: 3 },
    board: {
      background: "#1e3a2f",
      dot: "#f5f5f0",
      edgeDrawn: "#f5f5f0",
      playerColors: ["#ffc857", "#5b8fb0"],
      hint: "#f472b6",
      lastMoveGlow: "rgba(255, 255, 255, 0.85)",
    },
    cssVars: {
      "--bg": "#16281f",
      "--panel": "#24463a",
      "--text": "#f0ede4",
      "--muted": "#9fb3a8",
      "--accent": "#ffc857",
      "--daily-accent": "#5b8fb0",
    },
  },
  {
    id: "neon",
    name: "Neon",
    unlock: { type: "hardWin" },
    board: {
      background: "#0a0a0f",
      dot: "#e5e5e5",
      edgeDrawn: "#f5f5f5",
      playerColors: ["#ff5f1f", "#00e5ff"],
      hint: "#ff2ec4",
      lastMoveGlow: "rgba(253, 224, 71, 0.9)",
    },
    cssVars: {
      "--bg": "#0a0a0f",
      "--panel": "#14141c",
      "--text": "#f5f5f5",
      "--muted": "#8a8a99",
      "--accent": "#ff5f1f",
      "--daily-accent": "#00e5ff",
    },
  },
  {
    id: "blueprint",
    name: "Blueprint",
    unlock: { type: "dailyStreak", days: 3 },
    board: {
      background: "#0e3a5f",
      dot: "#ffffff",
      edgeDrawn: "#ffffff",
      playerColors: ["#ff6b35", "#7dd3fc"],
      hint: "#f472b6",
      lastMoveGlow: "rgba(255, 210, 0, 0.9)",
    },
    cssVars: {
      "--bg": "#0a2f4d",
      "--panel": "#123f66",
      "--text": "#eaf4ff",
      "--muted": "#8fb4d9",
      "--accent": "#ff6b35",
      "--daily-accent": "#7dd3fc",
    },
  },
];

export { THEMES };

/**
 * @param {string} id
 * @returns {object} the matching theme, or Paper if `id` is unknown —
 *   Paper is always unlocked, so this can never hand back something the
 *   caller isn't allowed to render.
 */
export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/**
 * @param {object} theme
 * @returns {string} human-readable unlock requirement, for the locked-skin UI
 */
export function unlockDescription(theme) {
  switch (theme.unlock.type) {
    case "default":
      return "Unlocked from the start.";
    case "achievementCount":
      return `Unlock ${theme.unlock.count} achievements.`;
    case "hardWin":
      return "Win a game on Hard difficulty.";
    case "dailyStreak":
      return `Reach a ${theme.unlock.days}-day Daily Challenge streak.`;
    default:
      return "";
  }
}

/**
 * @param {object} theme
 * @param {{unlockedAchievementCount: number, hasHardWin: boolean, bestDailyStreak: number}} facts
 * @returns {boolean}
 */
export function isThemeUnlocked(theme, facts) {
  switch (theme.unlock.type) {
    case "default":
      return true;
    case "achievementCount":
      return facts.unlockedAchievementCount >= theme.unlock.count;
    case "hardWin":
      return facts.hasHardWin;
    case "dailyStreak":
      return facts.bestDailyStreak >= theme.unlock.days;
    default:
      return false;
  }
}

/**
 * Themes that are unlocked right now (per `facts`) but not yet in
 * `alreadyKnownUnlocked` — i.e. newly earned since the last check. The
 * caller (main.js) persists each returned id via core/storage.js's
 * unlockSkin() and queues a toast for it, reusing game/achievements.js's
 * toast plumbing verbatim (CLAUDE.md's milestone note: "업적 토스트와
 * 같은 시스템 재사용").
 * @param {{unlockedAchievementCount: number, hasHardWin: boolean, bestDailyStreak: number}} facts
 * @param {Set<string> | string[]} alreadyKnownUnlocked
 * @returns {typeof THEMES}
 */
export function evaluateNewlyUnlockedThemes(facts, alreadyKnownUnlocked) {
  const known = alreadyKnownUnlocked instanceof Set ? alreadyKnownUnlocked : new Set(alreadyKnownUnlocked);
  return THEMES.filter((t) => !known.has(t.id) && isThemeUnlocked(t, facts));
}
