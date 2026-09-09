// test/campaign.test.js
// The three-difficulty campaign: what the save promises about it, and
// what main.js does with a run that owes more than one point.
//
// Every storage test here imports core/storage.js under a FRESH query
// string. The module reads localStorage once, at import time, into a
// module-level `state` — which is the right design for the game (main.js
// reads from it synchronously at import) and useless for a test that
// wants to see a different save. `?case=n` gives each case its own
// module instance, loaded after its own stub is in place.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, assertEqual, assertTrue, readPage } from "./harness.js";
import { STAGES, parFor, starsFor } from "../src/game/stages.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A localStorage that holds exactly one blob and nothing else. */
function stubStorage(blob) {
  const store = blob === null ? {} : { "fourball-save": JSON.stringify(blob) };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
    raw: () => (store["fourball-save"] ? JSON.parse(store["fourball-save"]) : null),
  };
  return globalThis.localStorage;
}

let cases = 0;
async function loadWith(blob) {
  const disk = stubStorage(blob);
  const mod = await import(`../src/core/storage.js?case=${++cases}`);
  return { mod, disk };
}

// --- the migration ------------------------------------------------------

const v2 = await loadWith({
  version: 2,
  campaign: {
    cleared: [1, 2, 3], stars: { 1: 3, 2: 2, 3: 1 }, bestTurns: { 1: 1, 2: 4 },
    hardCleared: [1, 2], hardStars: { 1: 2, 2: 3 }, hardBestTurns: { 1: 5 },
    lastStageId: 3, lastHard: true,
  },
  theme: { selected: "cafe" },
});

test("a v2 save keeps every result it had when the schema grows a third difficulty", () => {
  const s = v2.mod;
  // v2 held hard mode in three fields beside the normal three. Nothing
  // may be lost in the move into levels[]: a player who had forty stages
  // on normal and six on hard still has exactly that, or the update ate
  // their campaign.
  assertEqual([1, 2, 3].map((id) => s.isStageCleared(id, 0)), [true, true, true], "normal clears");
  assertEqual([1, 2, 3].map((id) => s.isStageCleared(id, 1)), [true, true, false], "hard clears");
  assertEqual(s.getStars(1, 0), 3, "normal stars");
  assertEqual(s.getStars(2, 1), 3, "hard stars");
  assertEqual(s.getBestTurns(1, 1), 5, "hard best turns");
  // Extreme did not exist to be played, so it starts empty for everyone.
  assertEqual(s.isStageCleared(1, 2), false, "extreme starts empty");
  assertEqual(s.getTotalStars(), 3 + 2 + 1 + 2 + 3, "every difficulty counts toward one total");
});

test("a v2 save resumes in the difficulty it was left in", () => {
  // lastHard was a boolean; lastLevel is an index. A player deep in hard
  // being dropped back into normal is the game losing their place.
  assertEqual(v2.mod.getContinuePoint(), { id: 3, level: 1 }, "next hard stage");
});

// --- the invariant ------------------------------------------------------

const tampered = await loadWith({
  version: 3,
  campaign: {
    levels: [
      { cleared: [1], stars: { 1: 3 }, bestTurns: {} },
      // Claims hard on a stage never cleared normally, and extreme on a
      // stage whose hard claim is itself about to be dropped.
      { cleared: [1, 7], stars: { 7: 3 }, bestTurns: {} },
      { cleared: [1, 7], stars: { 7: 3 }, bestTurns: {} },
    ],
    lastStageId: 7,
    lastLevel: 2,
  },
});

test("each difficulty's progress is a subset of the one below it", () => {
  const s = tampered.mod;
  // Stage 7 was never cleared on normal, so the hard claim goes — and
  // the extreme claim is then filtered against the SHRUNKEN hard list,
  // which is the part a per-level check would miss.
  assertEqual(s.isStageCleared(7, 1), false, "hard on a stage never beaten normally");
  assertEqual(s.isStageCleared(7, 2), false, "extreme behind a dropped hard clear");
  assertEqual(s.getStars(7, 1), 0, "stars go with the clear they belonged to");
  assertEqual(s.isStageCleared(1, 2), true, "a legitimate chain survives");
});

// --- writing ------------------------------------------------------------

const fresh = await loadWith(null);

test("a clear is refused at a difficulty that is not open", () => {
  const s = fresh.mod;
  // Silently writing a record that sanitize() would throw away on the
  // next load is worse than not writing one: the player sees a star,
  // closes the tab, and it is gone.
  s.recordStageCleared(1, 2, 3, 2);
  assertEqual(s.isStageCleared(1, 2), false, "extreme before hard");
  s.recordStageCleared(1, 2, 3, 0);
  s.recordStageCleared(1, 5, 2, 1);
  s.recordStageCleared(1, 9, 1, 2);
  assertEqual([0, 1, 2].map((n) => s.getStars(1, n)), [3, 2, 1], "one stage, three results");
  assertEqual(s.isLevelUnlocked(2, 1), false, "stage 2 hard is not open off stage 1");
});

test("a difficulty opens per stage, off the difficulty below it", () => {
  const s = fresh.mod;
  assertEqual(s.isLevelUnlocked(1, 1), true, "hard opens on a stage beaten normally");
  assertEqual(s.isLevelUnlocked(1, 2), true, "extreme opens on a stage beaten on hard");
  assertEqual(s.isLevelUnlocked(1, s.DIFFICULTIES), false, "there is no fourth difficulty");
});

// --- par ----------------------------------------------------------------

test("par grows with the difficulty, and it grows by more than the point count", () => {
  const st = { par: 3 };
  assertEqual([0, 1, 2].map((n) => parFor(st, n)), [3, 7, 11], "par 3 at each difficulty");
  // The multiplier is the honest part; the +1 and +2 are the legs the
  // stage did not design. Only the stage's OWN position was built
  // backwards from a measured shot — the tables a run leaves behind were
  // proved playable, not proved forgiving.
  assertEqual(starsFor(st, 7, 1), 3, "par on hard is still three stars");
  assertEqual(starsFor(st, 9, 1), 2, "two over is two stars");
  assertEqual(starsFor(st, 10, 1), 1, "beyond that is one");
  for (const stage of STAGES) {
    assertTrue(parFor(stage, 2) > parFor(stage, 1), `${stage.id} extreme must cost more than hard`);
  }
});

// --- the run loop -------------------------------------------------------

test("a run that still owes points plays on from where the balls stopped", () => {
  const main = readFileSync(path.join(root, "src", "main.js"), "utf8");
  const at = main.indexOf("if (state.points < need())");
  assertTrue(at > 0, "main.js never checks whether the run still owes points");
  const block = main.slice(at, at + 400);
  // The stopped position becomes the leg. Anything else here — a
  // resetBalls(), a dealStage() — would delete the point just scored.
  assertTrue(/state\.leg = snapshotBalls\(\)/.test(block), "the stopped table must become the leg");
  assertTrue(!/dealStage\(\)/.test(block), "an unfinished run must not be re-dealt");

  // And a miss goes back to the leg, not to the deal.
  const reset = main.slice(main.indexOf("function resetBalls()"), main.indexOf("function updateHud()"));
  assertTrue(/state\.leg \?\?/.test(reset), "resetBalls must return to the current leg");

  // Retry is the one place that goes further back than the leg: the
  // whole run, with the points given back. Both buttons that offer it —
  // the header one and the menu one — call the same function, which is
  // what this slice is: an assertion against the handler wherever the
  // wiring moves it.
  const at2 = main.indexOf("function restartStage()");
  assertTrue(at2 > 0, "restart is not a single named path any more");
  const retry = main.slice(at2, at2 + 900);
  assertTrue(/dealStage\(\)/.test(retry), "retry must re-deal the stage");
  for (const id of ["el.retry", "el.restartNow"]) {
    assertTrue(main.includes(`${id}.addEventListener("click", restartStage)`),
      `${id} must go through the same restart`);
  }
});

test("the stage map can reach every difficulty, and locks the ones not earned", () => {
  const main = readFileSync(path.join(root, "src", "main.js"), "utf8");
  const html = readPage(root);
  for (let level = 0; level < 3; level++) {
    assertTrue(html.includes(`data-level="${level}"`), `no tab for difficulty ${level}`);
  }
  const paint = main.slice(main.indexOf("function paintStageMap()"), main.indexOf("function goHome()"));
  assertTrue(/isLevelUnlocked\(id, mapLevel\)/.test(paint), "tiles must open per difficulty");
  assertTrue(/isStageCleared\(id, mapLevel\)/.test(paint), "tiles must be marked per difficulty");
  assertTrue(/getStars\(id, mapLevel\)/.test(paint), "stars must be read per difficulty");
  // A locked tab stays on screen: what the game still has is worth
  // seeing, and a tab that vanishes reads as a tab that broke.
  assertTrue(/tab\.disabled = !open/.test(paint), "an unreachable difficulty must be disabled, not hidden");
});
