// test/storage.test.js
// core/storage.js is the only module in the game that has to survive
// hostile input (a hand-edited save, a half-written blob, a browser that
// throws on every call), so these tests are mostly about what it does
// when things are wrong.
function mockLocalStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
    _data: data,
  };
}

const KEY = "stoneflick-save";
global.localStorage = mockLocalStorage();

const { test, assertEqual, assertTrue } = await import("./harness.js");
const storage = await import("../src/core/storage.js");

function reloadWith(raw) {
  global.localStorage = raw === undefined ? mockLocalStorage() : mockLocalStorage({ [KEY]: raw });
  storage.reloadFromStorage();
}

test("a fresh install starts with sound on, nothing cleared, wood selected", () => {
  reloadWith(undefined);
  assertEqual(storage.isSoundEnabled(), true);
  assertEqual(storage.getClearedStageIds(), []);
  assertEqual(storage.getTheme(), "wood");
  assertTrue(global.localStorage.getItem(KEY) !== null, "defaults are persisted immediately, not on first write");
});

test("progress round-trips", () => {
  reloadWith(undefined);
  storage.recordStageCleared(1, 4);
  storage.setTheme("wood");
  storage.setSoundEnabled(false);
  const raw = global.localStorage.getItem(KEY);
  global.localStorage = mockLocalStorage({ [KEY]: raw });
  storage.reloadFromStorage();
  assertEqual(storage.getClearedStageIds(), [1]);
  assertEqual(storage.getBestTurns(1), 4);
  assertEqual(storage.isSoundEnabled(), false);
});

test("a personal best only ever improves", () => {
  reloadWith(undefined);
  storage.recordStageCleared(3, 5);
  storage.recordStageCleared(3, 9);
  assertEqual(storage.getBestTurns(3), 5, "a worse replay must not overwrite the record");
  storage.recordStageCleared(3, 2);
  assertEqual(storage.getBestTurns(3), 2);
});

test("stars are awarded against the stage's par, in shots", () => {
  assertEqual(storage.starsForShots(3, 3), 3, "par exactly");
  assertEqual(storage.starsForShots(2, 3), 3, "under par");
  assertEqual(storage.starsForShots(4, 3), 2);
  assertEqual(storage.starsForShots(5, 3), 2, "the two-star band is deliberately two shots wide");
  assertEqual(storage.starsForShots(6, 3), 1);
  assertEqual(storage.starsForShots(99, 3), 1, "there is no zero-star clear — clearing is clearing");
  assertEqual(storage.starsForShots(1, undefined), 1, "a stage with no par cannot award more than one");
});

test("a star rating only ever improves", () => {
  reloadWith(undefined);
  storage.recordStageCleared(2, 4, 3);
  assertEqual(storage.getStars(2), 3);
  storage.recordStageCleared(2, 4, 1);
  assertEqual(storage.getStars(2), 3, "a sloppier replay must not take a star away");
  assertEqual(storage.getTotalStars(), 3);
  storage.recordStageCleared(3, 2, 2);
  assertEqual(storage.getTotalStars(), 5);
});

test("an uncleared stage has no stars", () => {
  reloadWith(undefined);
  assertEqual(storage.getStars(5), 0);
  assertEqual(storage.getTotalStars(), 0);
});

test("a tampered star count is discarded rather than rendered", () => {
  // Stars are drawn as a row of icons, so a stored 99 would paint 99 of
  // them across a stage card.
  reloadWith(JSON.stringify({ version: 1, campaign: { cleared: [1, 2], stars: { 1: 99, 2: 3, 5: 3 } } }));
  assertEqual(storage.getStars(1), 0, "out of range");
  assertEqual(storage.getStars(2), 3);
  assertEqual(storage.getStars(5), 0, "stage was never cleared");
  assertEqual(storage.getTotalStars(), 3);
});

test("the theme unlock context carries both progress measures", () => {
  reloadWith(undefined);
  storage.recordStageCleared(1, 1, 3);
  const context = storage.themeUnlockContext();
  assertEqual(context.stagesCleared, 1);
  assertEqual(context.totalStars, 3);
});

test("malformed JSON falls back to defaults instead of throwing", () => {
  reloadWith("{not json");
  assertEqual(storage.getClearedStageIds(), []);
  assertEqual(storage.isSoundEnabled(), true);
});

test("one corrupt field does not cost the player the others", () => {
  reloadWith(JSON.stringify({ version: 1, sound: { enabled: "yes please" }, campaign: { cleared: [2, 3] }, theme: { selected: "wood" } }));
  assertEqual(storage.isSoundEnabled(), true, "the bad field falls back");
  assertEqual(storage.getClearedStageIds(), [2, 3], "the good field survives");
});

test("nonsense stage ids and out-of-range values are dropped", () => {
  // v2, so the campaign-expansion migration does not renumber these on
  // the way in. What is under test here is the sanitizer.
  reloadWith(JSON.stringify({ version: 2, campaign: { cleared: [1, 1, 999, -4, "3", 2], bestTurns: { 1: 3, 999: 1, 2: -5 } } }));
  assertEqual(storage.getClearedStageIds(), [1, 2], "deduplicated, filtered, sorted");
  assertEqual(storage.getBestTurns(1), 3);
  assertEqual(storage.getBestTurns(2), null, "a non-positive turn count is not a record");
});

test("a bestTurns entry for a stage that was never cleared is discarded", () => {
  // Otherwise the two fields can disagree, and "cleared" stops being the
  // single source of truth for progress.
  reloadWith(JSON.stringify({ version: 1, campaign: { cleared: [1], bestTurns: { 1: 2, 5: 1 } } }));
  assertEqual(storage.getBestTurns(5), null);
});

test("the two-player stone count round-trips and rejects nonsense", () => {
  reloadWith(undefined);
  assertEqual(storage.getVersusStoneCount(), 5, "default");
  storage.setVersusStoneCount(9);
  assertEqual(storage.getVersusStoneCount(), 9);
  storage.setVersusStoneCount(4);
  assertEqual(storage.getVersusStoneCount(), 9, "an unoffered count is ignored, not stored");
  reloadWith(JSON.stringify({ version: 1, versus: { stoneCount: 40 } }));
  assertEqual(storage.getVersusStoneCount(), 5, "a tampered count falls back");
});

test("a save written before the stone count existed still loads", () => {
  // The field was added without a schema bump, on the strength of
  // sanitize() defaulting every missing field. This is the test that
  // makes that claim true rather than merely intended.
  reloadWith(JSON.stringify({ version: 1, campaign: { cleared: [1, 2] }, versus: { gamesCompleted: 3 } }));
  assertEqual(storage.getVersusStoneCount(), 5);
  assertEqual(storage.getVersusGamesCompleted(), 3, "the rest of the blob is untouched");
  assertEqual(storage.getClearedStageIds(), [1, 2]);
});

test("a tampered theme id falls back to wood", () => {
  reloadWith(JSON.stringify({ version: 1, theme: { selected: "gold-plated" } }));
  assertEqual(storage.getTheme(), "wood");
});

test("an unknown schema version is discarded, a missing one is migrated", () => {
  reloadWith(JSON.stringify({ version: 99, campaign: { cleared: [1, 2, 3] } }));
  assertEqual(storage.getClearedStageIds(), [], "no known migration path");
  reloadWith(JSON.stringify({ campaign: { cleared: [1, 2] } }));
  assertEqual(storage.getClearedStageIds(), [1, 2], "a versionless blob is promoted");
});

test("stage unlocking is derived from clears, never stored", () => {
  reloadWith(undefined);
  assertTrue(storage.isStageUnlocked(1), "stage 1 is always open");
  assertTrue(!storage.isStageUnlocked(2));
  storage.recordStageCleared(1, 3);
  assertTrue(storage.isStageUnlocked(2));
  assertEqual(storage.getContinueStageId(), 2);
});

test("a storage backend that throws on every call does not break the game", () => {
  global.localStorage = {
    getItem() {
      throw new Error("private browsing");
    },
    setItem() {
      throw new Error("quota exceeded");
    },
  };
  storage.reloadFromStorage();
  storage.recordStageCleared(1, 2);
  assertEqual(storage.getClearedStageIds(), [1], "the in-memory copy still works for this session");
});

/** A stand-in for the portal's data module, so a test can say what the
 * cloud is holding and then read back what was written to it. */
function mockSdk(initial = {}) {
  const sdkData = { ...initial };
  global.window = {
    CrazyGames: {
      SDK: {
        environment: "crazygames",
        init: async () => {},
        data: {
          getItem: (k) => sdkData[k] ?? null,
          setItem: (k, v) => {
            sdkData[k] = v;
          },
        },
      },
    },
  };
  return sdkData;
}

test("cloud progress from another device is adopted", async () => {
  global.localStorage = mockLocalStorage({ [KEY]: JSON.stringify({ version: 2, campaign: { cleared: [1] } }) });
  storage.reloadFromStorage();
  assertEqual(storage.getClearedStageIds(), [1]);
  mockSdk({ [KEY]: JSON.stringify({ version: 2, campaign: { cleared: [1, 2, 3] } }) });
  assertEqual(await storage.reinitSdkForTesting(), true);
  assertEqual(storage.getClearedStageIds(), [1, 2, 3]);
  delete global.window;
});

// THE BUG THAT REACHED PLAYERS. Reported twice as "Progress Lost" before
// it was understood, and it was not the portal's fault: reconciliation
// took the cloud copy WHOLESALE, so a cloud copy that was behind — which
// is the normal state of affairs, since the data module debounces its
// writes by a second and may take thirty to land — rolled the player
// back, and then wrote that rollback over the good local save.
test("a cloud save that is BEHIND cannot roll the player back", async () => {
  global.localStorage = mockLocalStorage({
    [KEY]: JSON.stringify({
      version: 2,
      campaign: { cleared: [1, 2, 3, 4, 5], stars: { 5: 3 }, bestTurns: { 5: 2 } },
    }),
  });
  storage.reloadFromStorage();
  const sdkData = mockSdk({
    [KEY]: JSON.stringify({ version: 2, campaign: { cleared: [1, 2] } }),
  });
  await storage.reinitSdkForTesting();
  assertEqual(storage.getClearedStageIds(), [1, 2, 3, 4, 5], "the newer local run survives");
  assertEqual(storage.getStars(5), 3);
  // And the merged result goes back UP, so the next device sees it too.
  assertEqual(JSON.parse(sdkData[KEY]).campaign.cleared, [1, 2, 3, 4, 5], "and is pushed to the cloud");
  delete global.window;
});

test("two devices that both played keep everything either of them did", async () => {
  global.localStorage = mockLocalStorage({
    [KEY]: JSON.stringify({
      version: 2,
      campaign: {
        cleared: [1, 2, 3],
        stars: { 1: 3, 2: 1 },
        bestTurns: { 1: 2, 2: 6 },
        hardCleared: [1],
        hardStars: { 1: 2 },
      },
      briefings: { seen: ["wall"] },
      tips: { seen: ["thin"] },
    }),
  });
  storage.reloadFromStorage();
  mockSdk({
    [KEY]: JSON.stringify({
      version: 2,
      campaign: {
        cleared: [1, 4, 5],
        stars: { 1: 1, 4: 2 },
        bestTurns: { 1: 5, 4: 3 },
        hardCleared: [],
        hardStars: {},
      },
      briefings: { seen: ["peg"] },
      tips: { seen: ["bank"] },
    }),
  });
  await storage.reinitSdkForTesting();
  assertEqual(storage.getClearedStageIds(), [1, 2, 3, 4, 5], "cleared is a union");
  assertEqual(storage.getStars(1), 3, "stars take the better result");
  assertEqual(storage.getBestTurns(1), 2, "but turns take the FEWER, which is the better one");
  assertEqual(storage.getBestTurns(4), 3, "and a record only one side has is kept");
  assertEqual(storage.isHardCleared(1), true, "hard progress is not dropped by the side that has none");
  assertEqual(storage.getSeenBriefings(), ["wall", "peg"], "shown-once lists are unions");
  assertEqual(storage.getSeenTips(), ["thin", "bank"]);
  delete global.window;
});

test("merging cannot produce a save the sanitizer would reject", async () => {
  // The union of two valid saves is not automatically valid. Here the
  // cloud claims a hard clear on a stage it never cleared normally, which
  // is the invariant the whole schema leans on.
  global.localStorage = mockLocalStorage({
    [KEY]: JSON.stringify({ version: 2, campaign: { cleared: [1] } }),
  });
  storage.reloadFromStorage();
  mockSdk({
    [KEY]: JSON.stringify({
      version: 2,
      campaign: { cleared: [1], hardCleared: [7], hardStars: { 7: 3 }, stars: { 9: 3 } },
    }),
  });
  await storage.reinitSdkForTesting();
  assertEqual(storage.getHardClearedStageIds(), [], "a hard clear without a normal one is dropped");
  assertEqual(storage.getStars(9), 0, "and stars for a stage never cleared go with it");
  assertEqual(storage.getClearedStageIds(), [1]);
  delete global.window;
});

// --- obstacle briefings --------------------------------------------------

test("a fresh install has seen no briefings", () => {
  reloadWith(undefined);
  assertEqual(storage.getSeenBriefings(), []);
  assertEqual(storage.hasSeenBriefing("bumper"), false);
});

test("seen briefings round-trip", () => {
  reloadWith(undefined);
  storage.markBriefingsSeen(["bumper", "wall"]);
  const raw = global.localStorage.getItem(KEY);
  global.localStorage = mockLocalStorage({ [KEY]: raw });
  storage.reloadFromStorage();
  assertEqual(storage.hasSeenBriefing("bumper"), true);
  assertEqual(storage.hasSeenBriefing("wall"), true);
  assertEqual(storage.hasSeenBriefing("portal"), false);
});

test("marking is a set, stored in a stable order", () => {
  // Not insertion order: the blob is rewritten on every save, and a list
  // that reshuffles makes two identical saves produce two different
  // strings — which matters on the portal, where every write is a network
  // call the SDK may or may not coalesce.
  reloadWith(undefined);
  storage.markBriefingsSeen(["portal", "wall"]);
  storage.markBriefingsSeen(["wall", "peg"]);
  assertEqual(storage.getSeenBriefings(), ["wall", "peg", "portal"]);
});

test("an unknown briefing id is refused", () => {
  // Same rule as every other field here: a hand-edited save can only ever
  // put ids into this list that the game already knows how to draw.
  reloadWith(undefined);
  storage.markBriefingsSeen(["bumper", "laser", 7, null]);
  assertEqual(storage.getSeenBriefings(), ["bumper"]);
});

test("a save from before briefings existed simply has seen none", () => {
  // The no-version-bump claim in sanitize(), asserted. An existing player
  // gets every briefing explained once, which is correct — the briefings
  // did not exist when they played those stages.
  // Written as a v2 save. As a v1 one it would be migrated on load -- the
  // campaign expansion moved every stage id -- and this test is about the
  // briefings field, not about migration.
  reloadWith(JSON.stringify({ version: 2, campaign: { cleared: [1, 2, 3, 4, 5] } }));
  assertEqual(storage.getSeenBriefings(), []);
  assertEqual(storage.getClearedStageIds(), [1, 2, 3, 4, 5]);
});

test("a garbage briefings field costs nothing else", () => {
  reloadWith(
    JSON.stringify({
      version: 1,
      briefings: { seen: "all of them" },
      campaign: { cleared: [2] },
    })
  );
  assertEqual(storage.getSeenBriefings(), []);
  assertEqual(storage.getClearedStageIds(), [2]);
});

// --- pro tips ------------------------------------------------------------

test("a fresh install has been told nothing", () => {
  reloadWith(undefined);
  assertEqual(storage.getSeenTips(), []);
  assertEqual(storage.hasSeenTip("thin"), false);
});

test("a tip is marked once and stays marked", () => {
  reloadWith(undefined);
  storage.markTipSeen("thin");
  storage.markTipSeen("thin");
  const raw = global.localStorage.getItem(KEY);
  global.localStorage = mockLocalStorage({ [KEY]: raw });
  storage.reloadFromStorage();
  assertEqual(storage.getSeenTips(), ["thin"]);
  assertEqual(storage.hasSeenTip("bank"), false);
});

test("tips are stored in a stable order, not in the order they were shown", () => {
  // Same reason as the briefings above: an unstable list makes two
  // identical saves serialize differently, and on the portal every write
  // is a network call.
  reloadWith(undefined);
  storage.markTipSeen("par");
  storage.markTipSeen("thin");
  storage.markTipSeen("bank");
  const seen = storage.getSeenTips();
  assertEqual(seen, ["thin", "bank", "par"]);
});

test("an unknown tip id is refused", () => {
  reloadWith(undefined);
  storage.markTipSeen("git-gud");
  storage.markTipSeen(null);
  assertEqual(storage.getSeenTips(), []);
});

test("a save from before tips existed has been told nothing, and loses nothing", () => {
  reloadWith(JSON.stringify({ version: 2, campaign: { cleared: [1, 2, 3] }, tips: { seen: 17 } }));
  assertEqual(storage.getSeenTips(), []);
  assertEqual(storage.getClearedStageIds(), [1, 2, 3]);
});

test("the tip whitelist here matches the catalogue in game/tips.js", async () => {
  // storage.js owns its persisted shape and must not import game logic,
  // so the id list is duplicated — the same trade as THEME_IDS,
  // BRIEFING_IDS and AI_LEVELS. This assertion is the whole price of it,
  // and the failure it prevents is silent: a tip added to the catalogue
  // but not here would be shown once, written, and dropped on the next
  // load, so the player would be told it again forever.
  const tips = await import("../src/game/tips.js");
  const known = tips.TIP_IDS;
  reloadWith(undefined);
  for (const id of known) storage.markTipSeen(id);
  assertEqual([...storage.getSeenTips()].sort(), [...known].sort());
});

test("the fresh-install defaults and the sanitizer agree on the shape", () => {
  // This module has TWO sources of a default state — defaultState() for a
  // first launch, and sanitize()'s per-field fallbacks for a save that is
  // missing something — and nothing forced them to agree. Adding the
  // briefings field to sanitize() and forgetting defaultState() produced
  // exactly one symptom: a brand new player crashed on their first stage
  // with an obstacle, while every existing save was fine. This assertion
  // is what makes the next added field impossible to get half-right.
  reloadWith(undefined);
  const fresh = JSON.parse(global.localStorage.getItem(KEY));
  reloadWith(JSON.stringify({ version: 1 }));
  storage.setSoundEnabled(true); // a normalized load does not re-save; force one
  const sanitized = JSON.parse(global.localStorage.getItem(KEY));
  const shape = (o) =>
    o && typeof o === "object" && !Array.isArray(o)
      ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, shape(o[k])]))
      : Array.isArray(o)
        ? []
        : typeof o;
  assertEqual(shape(sanitized), shape(fresh));
});

// --- hard mode -----------------------------------------------------------

test("hard progress is refused on a stage never beaten normally", () => {
  // The schema's load-bearing invariant: hardCleared is a SUBSET of
  // cleared. Writing a record that sanitize() would throw away on the
  // next load is worse than not writing one, so it is refused here too.
  reloadWith(undefined);
  storage.recordStageCleared(3, 2, 3, true);
  assertEqual(storage.isHardCleared(3), false);
  assertEqual(storage.getStars(3, true), 0);
});

test("the two difficulties keep separate records for the same stage", () => {
  reloadWith(undefined);
  storage.recordStageCleared(1, 1, 3);
  storage.recordStageCleared(1, 4, 1, true);
  assertEqual(storage.getStars(1, false), 3);
  assertEqual(storage.getStars(1, true), 1);
  assertEqual(storage.getBestTurns(1, false), 1);
  assertEqual(storage.getBestTurns(1, true), 4);
});

test("hard opens on a stage the moment it is beaten normally", () => {
  reloadWith(undefined);
  assertEqual(storage.isHardUnlocked(1), false);
  storage.recordStageCleared(1, 2, 2);
  assertEqual(storage.isHardUnlocked(1), true);
  assertEqual(storage.isHardUnlocked(2), false);
});

test("both difficulties count toward one star total", () => {
  // Deliberate: the theme thresholds in game/themes.js were left where
  // they are, so hard is a second route to the same rewards rather than
  // a reason to move a goalpost a player has already passed.
  reloadWith(undefined);
  storage.recordStageCleared(1, 1, 3);
  assertEqual(storage.getTotalStars(), 3);
  storage.recordStageCleared(1, 3, 2, true);
  assertEqual(storage.getTotalStars(), 5);
  assertEqual(storage.MAX_STARS, 100 * 3 * 2);
});

test("hard records round-trip, and a personal best still only improves", () => {
  reloadWith(undefined);
  storage.recordStageCleared(2, 3, 2);
  storage.recordStageCleared(2, 5, 1, true);
  storage.recordStageCleared(2, 9, 3, true); // worse turns, better stars
  const raw = global.localStorage.getItem(KEY);
  global.localStorage = mockLocalStorage({ [KEY]: raw });
  storage.reloadFromStorage();
  assertEqual(storage.getBestTurns(2, true), 5);
  assertEqual(storage.getStars(2, true), 3);
});

test("a save claiming hard clears it never earned is pruned on load", () => {
  reloadWith(
    JSON.stringify({
      version: 1,
      campaign: {
        cleared: [1],
        hardCleared: [1, 2, 3],
        hardStars: { 1: 3, 2: 3, 3: 3 },
        hardBestTurns: { 1: 1, 2: 1, 3: 1 },
      },
    })
  );
  assertEqual(storage.isHardCleared(1), true);
  assertEqual(storage.isHardCleared(2), false);
  assertEqual(storage.getTotalStars(), 3, "only the legitimate hard star survives");
});

test("Continue remembers which difficulty, but never into a locked one", () => {
  reloadWith(undefined);
  storage.setLastStageId(3, true);
  assertEqual(storage.getLastHard(), false, "stage 3 was never cleared, so hard is not open there");
  storage.recordStageCleared(3, 2, 2);
  storage.setLastStageId(3, true);
  assertEqual(storage.getLastHard(), true);
});

test("Continue points at whatever is actually left to beat", () => {
  reloadWith(undefined);
  assertEqual(storage.getContinuePoint(), { id: 1, hard: false }, "a new save starts at the beginning");

  // Mid-campaign, on normal: the next unbeaten stage.
  storage.recordStageCleared(1, 3, 3);
  storage.recordStageCleared(2, 3, 3);
  assertEqual(storage.getContinuePoint(), { id: 3, hard: false });

  // Still mid-campaign, but they went and played hard: their choice wins.
  storage.recordStageCleared(1, 2, 3, true);
  storage.setLastStageId(1, true);
  assertEqual(storage.getContinuePoint(), { id: 2, hard: true }, "hard 1 is done, so hard 2 is next");

  // The case this rule was written for: every stage beaten on normal, a
  // few on hard. The campaign is not over — hard is what is left — and
  // sending them back to replay the finale would say otherwise.
  const ids = [];
  for (let id = 1; id <= 100; id++) ids.push(id);
  // version 2, deliberately: a save with no version field is treated as
  // pre-expansion and renumbered on load, which is correct and is what
  // this fixture is not testing.
  reloadWith(JSON.stringify({ version: 2, campaign: { cleared: ids, hardCleared: [1, 2, 3], lastStageId: 100, lastHard: false } }));
  assertEqual(storage.getContinuePoint(), { id: 4, hard: true }, "normal is finished; hard 4 is the frontier");

  // Only when BOTH tracks are exhausted does Continue become a replay.
  reloadWith(JSON.stringify({ version: 2, campaign: { cleared: ids, hardCleared: ids, lastStageId: 100, lastHard: true } }));
  assertEqual(storage.getContinuePoint(), { id: 100, hard: true }, "nothing left but the finale");
});

test("the aim guide setting defaults ON and round-trips", () => {
  reloadWith(undefined);
  // On by default: a first board with no line drawn on it reads as broken
  // rather than as harder, and the briefing card is what tells a player
  // the switch exists at all.
  assertEqual(storage.isPvpAimGuideOn(), true);
  storage.setPvpAimGuide(false);
  const raw = global.localStorage.getItem(KEY);
  global.localStorage = mockLocalStorage({ [KEY]: raw });
  storage.reloadFromStorage();
  assertEqual(storage.isPvpAimGuideOn(), false, "an explicit off survives a reload");
  storage.setPvpAimGuide(true);
  assertEqual(storage.isPvpAimGuideOn(), true);
  // A save written before the setting existed has no field at all, and
  // must land on the default rather than on false.
  reloadWith(JSON.stringify({ version: 2, campaign: { cleared: [1] } }));
  assertEqual(storage.isPvpAimGuideOn(), true, "an old save with no settings block");
});

test("the practice AI level whitelist matches the AI's own difficulties", async () => {
  // storage.js duplicates this list rather than importing game logic, the
  // same trade as THEME_IDS and BRIEFING_IDS. This is the price of it.
  const ai = await import("../src/game/ai.js");
  assertEqual([...storage.AI_LEVELS].sort(), Object.keys(ai.DIFFICULTY).sort());
});

test("the practice level defaults to medium and refuses nonsense", () => {
  reloadWith(undefined);
  assertEqual(storage.getPracticeLevel(), "medium");
  storage.setPracticeLevel("hard");
  assertEqual(storage.getPracticeLevel(), "hard");
  storage.setPracticeLevel("impossible");
  assertEqual(storage.getPracticeLevel(), "hard", "an unknown level leaves the stored one alone");
  reloadWith(JSON.stringify({ version: 1, settings: { practiceLevel: "brutal" } }));
  assertEqual(storage.getPracticeLevel(), "medium");
});

// --- shot previews -------------------------------------------------------
// The one thing in the save the player PAID for, which is why it is in the
// save at all rather than in a variable.

test("an earned preview survives closing the game", () => {
  reloadWith(undefined);
  assertEqual(storage.getPreviewsHeld(), 0);
  storage.setPreviewsHeld(1);
  // A different tab, a different day: the same blob, read fresh.
  const raw = global.localStorage.getItem(KEY);
  reloadWith(raw);
  assertEqual(storage.getPreviewsHeld(), 1, "an ad watched yesterday is still worth something today");
});

test("spending one puts it back to zero, and that persists too", () => {
  reloadWith(undefined);
  storage.setPreviewsHeld(1);
  storage.setPreviewsHeld(0);
  reloadWith(global.localStorage.getItem(KEY));
  assertEqual(storage.getPreviewsHeld(), 0);
});

test("a save claiming a stack of previews is clamped to one", () => {
  // The single number in this file a hand edit could turn into an
  // unlimited hint. main.js only ever grants when the count is 0, so the
  // cap is what keeps that true against a save it did not write.
  reloadWith(JSON.stringify({ version: 2, previews: { held: 99 } }));
  assertEqual(storage.getPreviewsHeld(), 1);
  reloadWith(JSON.stringify({ version: 2, previews: { held: -4 } }));
  assertEqual(storage.getPreviewsHeld(), 0);
  reloadWith(JSON.stringify({ version: 2, previews: { held: "lots" } }));
  assertEqual(storage.getPreviewsHeld(), 0);
  reloadWith(JSON.stringify({ version: 2, previews: "yes" }));
  assertEqual(storage.getPreviewsHeld(), 0);
});

test("a save written before previews existed simply has none", () => {
  // Added after v2 shipped and deliberately WITHOUT a version bump: an
  // absent field means "use the default" everywhere in this file, and the
  // correct default for an existing player is zero.
  reloadWith(JSON.stringify({
    version: 2,
    campaign: { cleared: [1, 2, 3], stars: { 1: 3 }, lastStageId: 4 },
  }));
  assertEqual(storage.getPreviewsHeld(), 0);
  assertEqual(storage.getClearedStageIds(), [1, 2, 3], "and the rest of the save is untouched");
});

test("setting the count it already has writes nothing", () => {
  // Every write is a localStorage write AND a portal Data-module sync;
  // main.js calls this on a path that runs per shot.
  reloadWith(undefined);
  storage.setPreviewsHeld(1);
  const before = global.localStorage.getItem(KEY);
  global.localStorage.setItem(KEY, "SENTINEL");
  storage.setPreviewsHeld(1);
  assertEqual(global.localStorage.getItem(KEY), "SENTINEL", "no re-write when nothing changed");
  global.localStorage.setItem(KEY, before);
});
