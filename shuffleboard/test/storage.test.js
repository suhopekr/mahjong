// test/storage.test.js
// Runs in Node: localStorage does not exist, so the module lives on its
// in-memory tier — which is itself the thing being exercised: nothing
// may throw for lack of a browser.
import { test, assertEqual, assertTrue } from "./harness.js";
import * as S from "../src/core/storage.js";
import { LEVEL_IDS } from "../src/game/ai.js";
import { LAST_STAGE_ID, CHAPTERS } from "../src/game/stages.js";

test("storage's level whitelist agrees with game/ai.js", () => {
  assertEqual(S.AI_LEVELS, LEVEL_IDS);
});

test("a new player starts against the easy AI", () => {
  assertEqual(S.getAiLevel(), "easy");
});

test("recent results keep only the last five", () => {
  for (const r of ["W", "L", "W", "W", "L", "L", "W"]) S.recordMatch(r);
  const recent = S.getRecentResults();
  assertEqual(recent.length, S.RECENT_KEEP);
  assertEqual(recent, ["W", "W", "L", "L", "W"]);
});

test("stats count matches and wins, and remember the best margin", () => {
  const before = S.getStats();
  S.recordMatch("W", 9);
  S.recordMatch("L", 3);
  const after = S.getStats();
  assertEqual(after.matches, before.matches + 2);
  assertEqual(after.wins, before.wins + 1);
  assertTrue(after.bestMargin >= 9, "margin recorded");
  S.recordMatch("W", 4);
  assertTrue(S.getStats().bestMargin >= 9, "a smaller margin does not regress the best");
});

test("garbage results are ignored", () => {
  const before = S.getStats();
  S.recordMatch("X", 99);
  assertEqual(S.getStats(), before);
});

test("setAiLevel refuses ids the game does not have", () => {
  S.setAiLevel("impossible");
  assertTrue(S.AI_LEVELS.includes(S.getAiLevel()));
});

test("briefings are once-only and structurally whitelisted", () => {
  assertTrue(!S.hasSeenBriefing("first-hanger"));
  S.markBriefingSeen("first-hanger");
  assertTrue(S.hasSeenBriefing("first-hanger"));
  S.markBriefingSeen("not-a-card");
  assertTrue(!S.hasSeenBriefing("not-a-card"));
});

test("sound toggles and persists in memory", () => {
  const before = S.isSoundEnabled();
  assertEqual(S.toggleSound(), !before);
  S.setSoundEnabled(true);
  assertTrue(S.isSoundEnabled());
});

test("storage's campaign whitelists agree with game/stages.js", () => {
  // Static imports, not an async body: the harness runs tests
  // synchronously, and an async test that fails would report ok first
  // and explode later.
  assertEqual(S.MAX_STAGE_ID, LAST_STAGE_ID);
  assertEqual(S.CHAPTER_IDS, CHAPTERS.map((c) => c.id));
});

test("clearing the current stage advances the continue point; replays never regress stars", () => {
  S.setCurrentStageId(1);
  S.recordStageClear(1, 2);
  assertEqual(S.getCurrentStageId(), 2, "advanced");
  assertEqual(S.getStageStars(1), 2);
  S.recordStageClear(1, 3);
  assertEqual(S.getStageStars(1), 3, "improved");
  S.recordStageClear(1, 1);
  assertEqual(S.getStageStars(1), 3, "a worse replay keeps the best");
  assertEqual(S.getCurrentStageId(), 2, "replaying an old stage does not move the continue point");
});

test("garbage campaign writes are refused", () => {
  const cur = S.getCurrentStageId();
  S.setCurrentStageId(999);
  assertEqual(S.getCurrentStageId(), cur);
  S.recordStageClear(999, 3);
  assertEqual(S.getStageStars(999), 0);
  S.recordStageClear(2, 9);
  assertEqual(S.getStageStars(2), 0);
});

test("boss records are chapter-whitelisted", () => {
  assertTrue(!S.isBossBeaten(1));
  S.recordBossBeaten(1);
  assertTrue(S.isBossBeaten(1));
  S.recordBossBeaten(42);
  assertTrue(!S.isBossBeaten(42));
});

test("a held preview is capped at one and survives sanitize", () => {
  S.setPreviewsHeld(1);
  assertEqual(S.getPreviewsHeld(), 1);
  S.setPreviewsHeld(5);
  assertEqual(S.getPreviewsHeld(), 1, "hand-edited saves cannot stockpile");
  S.setPreviewsHeld(0);
  assertEqual(S.getPreviewsHeld(), 0);
});
