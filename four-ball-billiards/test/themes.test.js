// test/themes.test.js
// The five tables, and the two lists that have to agree about them.
import { test, assertTrue, assertEqual } from "./harness.js";
import { THEMES, THEME_IDS, DEFAULT_THEME, themeById, isThemeUnlocked } from "../src/game/themes.js";
import { THEME_IDS as STORED_IDS } from "../src/core/storage.js";
import { COLORS, CUE } from "../src/game/render.js";

test("storage's theme whitelist agrees with the themes", () => {
  // storage.js keeps its own copy because it owns its persisted shape and
  // must not import game logic. The price of that rule is this test: a
  // theme added to one list and not the other either cannot be saved or
  // cannot be drawn, and both failures are silent.
  assertEqual(STORED_IDS.join(","), THEME_IDS.join(","));
});

test("the default table is the one that needs no stages", () => {
  const d = themeById(DEFAULT_THEME);
  assertEqual(d.unlockAt, 0);
  assertTrue(
    THEMES.filter((t) => t.unlockAt === 0).length === 1,
    "exactly one table should be free"
  );
});

test("every theme paints every colour the renderer reads", () => {
  // COLORS is mutated in place by applyTheme, so a theme missing a key
  // does not fail — it silently keeps the PREVIOUS table's value for
  // that one thing, which is the worst kind of wrong: a blue cloth with
  // a green cushion, and nothing in the console.
  const need = ["cloth", "clothLamp", "clothDark", "clothLine", "cushion", "rail", "railLight", "railDark"];
  for (const t of THEMES) {
    for (const k of need) {
      assertTrue(typeof t.colors[k] === "string", `${t.id} is missing colors.${k}`);
    }
    assertTrue(k_ok(t), `${t.id} is missing a cue material`);
  }
  function k_ok(t) {
    return ["shaft", "butt", "wrap", "collar", "ferrule", "tip", "grain"].every(
      (k) => t.cue[k] !== undefined
    );
  }
  // And every key the renderer's defaults have is a key a theme supplies,
  // so no theme can be relying on a leftover.
  for (const k of need) assertTrue(k in COLORS, `COLORS has no ${k}`);
  for (const k of ["shaft", "butt", "wrap", "collar", "ferrule", "tip", "grain"]) {
    assertTrue(k in CUE, `CUE has no ${k}`);
  }
});

test("the sights are legible on their own rail", () => {
  // A sight is inlaid INTO the rail, so it has to be lighter than the
  // rail is. On the steel table the brass sights were the one thing that
  // could have gone the other way.
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  };
  for (const t of THEMES) {
    const face = lum(t.sight.stops[1]);
    const rail = lum(t.colors.rail);
    assertTrue(face - rail > 0.15, `${t.id}: sight ${face.toFixed(2)} vs rail ${rail.toFixed(2)}`);
  }
});

test("unlocks are ordered and reachable", () => {
  // Absolute stage counts, not a fraction of the campaign: a fraction
  // would RE-LOCK a table the day the campaign grows, and a cosmetic
  // reward that can be taken away is worse than no reward.
  let last = -1;
  for (const t of THEMES) {
    assertTrue(Number.isInteger(t.unlockAt) && t.unlockAt >= 0, `${t.id} has no unlockAt`);
    assertTrue(t.unlockAt > last || t.unlockAt === 0, `${t.id} unlocks out of order`);
    last = t.unlockAt;
  }
  assertTrue(!isThemeUnlocked(THEMES[1].id, { stagesCleared: 0 }), "the second table is not free");
  assertTrue(
    isThemeUnlocked(THEMES[THEMES.length - 1].id, { stagesCleared: 1000 }),
    "the last table is reachable"
  );
});

test("every theme says what it is", () => {
  for (const t of THEMES) {
    assertTrue(/^[\x20-\x7E]+$/.test(t.name), `${t.id}: name must be English`);
    assertTrue(/^[\x20-\x7E]+$/.test(t.blurb), `${t.id}: blurb must be English`);
    assertTrue(t.blurb.length < 90, `${t.id}: blurb is too long for a card`);
  }
});
