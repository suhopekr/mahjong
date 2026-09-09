// test/themes.test.js
// Themes are cosmetic, but their unlock rules are the campaign's only
// long-range goal, so the rules themselves are worth pinning down —
// especially the two-layer defense against a locked theme being forced
// into use by a hand-edited save.
import { test, assertEqual, assertTrue } from "./harness.js";
import { THEMES, isThemeUnlocked, getUnlockedThemeIds, getThemeById, resolveActiveThemeId } from "../src/game/themes.js";

const nothing = { stagesCleared: 0, totalStars: 0 };
// A hundred stages, three stars each, on both difficulties.
const everything = { stagesCleared: 100, totalStars: 600 };

test("wood is available from the very first launch", () => {
  assertEqual(getUnlockedThemeIds(nothing), ["wood"]);
});

test("finishing the campaign unlocks everything", () => {
  assertEqual(getUnlockedThemeIds(everything).length, THEMES.length);
});

test("Neon asks for stars, not merely for finishing", () => {
  // The distinction is the point: a player can clear all twelve stages
  // scraping through, and Neon is the reward for going back and doing
  // them cleanly.
  assertTrue(!isThemeUnlocked("neon", { stagesCleared: 100, totalStars: 150 }), "clearing every stage alone is not enough");
  assertTrue(isThemeUnlocked("neon", { stagesCleared: 100, totalStars: 200 }));
});

test("an unknown theme id is locked, not crashed on", () => {
  assertEqual(isThemeUnlocked("gold-plated", everything), false);
  assertEqual(getThemeById("gold-plated").id, "wood", "and resolves to a theme that can actually render");
});

test("a stored selection the player has not earned falls back to wood", () => {
  // core/storage.js's own whitelist only asks "is this a real theme id",
  // deliberately knowing nothing about unlock rules — this is the layer
  // that checks EARNED status, and the reason a tampered save cannot
  // simply hand itself Neon.
  assertEqual(resolveActiveThemeId("neon", nothing), "wood");
  assertEqual(resolveActiveThemeId("neon", everything), "neon");
  assertEqual(resolveActiveThemeId("wood", nothing), "wood");
});

test("every theme defines the colors the renderer reads", () => {
  for (const theme of THEMES) {
    assertTrue(typeof theme.colors.boardColor === "string", `${theme.id}: boardColor`);
    assertTrue(typeof theme.colors.lineColor === "string", `${theme.id}: lineColor`);
    for (const player of [0, 1]) {
      assertTrue(typeof theme.colors.stones[player]?.fill === "string", `${theme.id}: stone ${player} fill`);
      assertTrue(typeof theme.colors.stones[player]?.highlight === "string", `${theme.id}: stone ${player} highlight`);
    }
    assertTrue(typeof theme.colors.aimColor === "string", `${theme.id}: aimColor`);
    for (const key of ["holeColor", "bumperColor", "bumperEdge", "sandColor", "iceColor"]) {
      assertTrue(typeof theme.colors[key] === "string", `${theme.id}: ${key}`);
    }
    // Portal ends are matched by hue, so a theme that ran out of colors
    // would silently give two different pairs the same one.
    assertTrue(Array.isArray(theme.colors.portalColors) && theme.colors.portalColors.length >= 3, `${theme.id}: portalColors`);
    // The portal's rim is the only emissive object on the board, so a
    // theme that forgot to re-tint it would light its own board with
    // another theme's fire. Three stops, hot to cold.
    for (const key of ["emberCore", "emberMid", "emberOut"]) {
      assertTrue(typeof theme.colors[key] === "string", `${theme.id}: ${key}`);
    }
  }
});
