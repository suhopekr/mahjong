// test/storage.test.js
// core/storage.js's `let state = load()` runs once at module import —
// the usual ES-module-singleton problem for testing something with
// top-level side effects. Every test here works around it the same way:
// replace `global.localStorage` with a mock, then call
// reloadFromStorage() (storage.js exports it specifically for this) to
// re-run the exact same load() logic the real module-load path uses,
// rather than trying to test the one-shot automatic load directly.

import {
  reloadFromStorage,
  isSoundEnabled,
  setSoundEnabled,
  getStreak,
  recordStreakResult,
  getUnlockedAchievements,
  unlockAchievement,
  getHardWinsBySize,
  recordHardWin,
  getLocalGamesCompleted,
  incrementLocalGamesCompleted,
  getDailyState,
  recordDailyResult,
  getSkinsState,
  setSelectedSkin,
  unlockSkin,
  recordHardWinForSkins,
} from "../src/core/storage.js";
import { test, assertEqual, assertTrue } from "./harness.js";

/**
 * A minimal in-memory localStorage stand-in.
 * @param {{initialData?: Record<string,string>, throwOnSetItem?: boolean, throwOnGetItem?: boolean}} [opts]
 */
function mockLocalStorage({ initialData = {}, throwOnSetItem = false, throwOnGetItem = false } = {}) {
  const store = new Map(Object.entries(initialData));
  return {
    getItem(key) {
      if (throwOnGetItem) throw new Error("simulated getItem failure");
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (throwOnSetItem) {
        const err = new Error("simulated QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    _store: store, // exposed so tests can assert on what actually got persisted
  };
}

function useMockStorage(opts) {
  const mock = mockLocalStorage(opts);
  global.localStorage = mock;
  reloadFromStorage();
  return mock;
}

// --- save/load round trip ------------------------------------------

test("round trip: sound preference and a streak survive a save + fresh reload", () => {
  const mock = useMockStorage({});
  setSoundEnabled(false);
  recordStreakResult("hard", true);
  recordStreakResult("hard", true);

  // simulate a brand new page load against whatever got persisted
  const raw = mock._store.get("dab-save");
  const freshMock = mockLocalStorage({ initialData: { "dab-save": raw } });
  global.localStorage = freshMock;
  reloadFromStorage();

  assertEqual(isSoundEnabled(), false);
  assertEqual(getStreak("hard"), { current: 2, best: 2 });
  assertEqual(getStreak("easy"), { current: 0, best: 0 }); // untouched difficulty stays default
});

// --- corrupted / malformed input ------------------------------------

test("corrupted JSON falls back to defaults", () => {
  useMockStorage({ initialData: { "dab-save": "{not valid json" } });
  assertEqual(isSoundEnabled(), true);
  assertEqual(getStreak("easy"), { current: 0, best: 0 });
});

test("an unrecognized version (no migration path for it) falls back to defaults", () => {
  useMockStorage({
    initialData: { "dab-save": JSON.stringify({ version: 99, sound: { enabled: false }, streaks: {} }) },
  });
  assertEqual(isSoundEnabled(), true, "the version-99 payload's sound value is discarded, not trusted");
});

test("missing version field falls back to defaults", () => {
  useMockStorage({ initialData: { "dab-save": JSON.stringify({ sound: { enabled: false } }) } });
  assertEqual(isSoundEnabled(), true);
});

test("wrong top-level type (array, not object) falls back to defaults", () => {
  useMockStorage({ initialData: { "dab-save": JSON.stringify([1, 2, 3]) } });
  assertEqual(isSoundEnabled(), true);
  assertEqual(getStreak("medium"), { current: 0, best: 0 });
});

test("wrong field types are sanitized individually, valid sibling fields survive", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 1,
        sound: { enabled: "yes" }, // wrong type -> falls back to default (true)
        streaks: {
          easy: { current: "three", best: 5 }, // wrong type on current -> current falls back to 0
          medium: { current: 3, best: 7 }, // valid -> preserved exactly
          // hard: missing entirely -> defaults
        },
      }),
    },
  });
  assertEqual(isSoundEnabled(), true);
  assertEqual(getStreak("easy"), { current: 0, best: 5 }, "current sanitized, but best (valid) is kept");
  assertEqual(getStreak("medium"), { current: 3, best: 7 }, "untouched by the corruption elsewhere");
  assertEqual(getStreak("hard"), { current: 0, best: 0 });
});

test("negative streak numbers are rejected back to 0", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({ version: 1, sound: { enabled: true }, streaks: { easy: { current: -5, best: -1 } } }),
    },
  });
  assertEqual(getStreak("easy"), { current: 0, best: 0 });
});

test("best < current in stored data is coerced up to current (invariant)", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({ version: 1, sound: { enabled: true }, streaks: { hard: { current: 5, best: 2 } } }),
    },
  });
  assertEqual(getStreak("hard"), { current: 5, best: 5 });
});

test("no fields at all beyond version still produces a fully-defaulted, usable state", () => {
  useMockStorage({ initialData: { "dab-save": JSON.stringify({ version: 1 }) } });
  assertEqual(isSoundEnabled(), true);
  assertEqual(getStreak("easy"), { current: 0, best: 0 });
  assertEqual(getStreak("medium"), { current: 0, best: 0 });
  assertEqual(getStreak("hard"), { current: 0, best: 0 });
});

// --- localStorage failures ------------------------------------------

test("setItem throwing (simulated QuotaExceededError) never throws out, and the in-memory value still updates", () => {
  useMockStorage({ throwOnSetItem: true });
  setSoundEnabled(false); // must not throw
  assertEqual(isSoundEnabled(), false, "memory-only fallback: this session still sees the change");

  const result = recordStreakResult("easy", true); // must not throw either
  assertEqual(result, { current: 1, best: 1, isNewBest: true });
  assertEqual(getStreak("easy"), { current: 1, best: 1 });
});

test("getItem throwing is treated the same as no data at all — defaults, no crash", () => {
  useMockStorage({ throwOnGetItem: true });
  assertEqual(isSoundEnabled(), true);
  assertEqual(getStreak("hard"), { current: 0, best: 0 });
});

test("localStorage itself undefined — every call still works off in-memory state", () => {
  global.localStorage = undefined;
  reloadFromStorage(); // must not throw
  assertEqual(isSoundEnabled(), true);
  setSoundEnabled(false); // must not throw
  assertEqual(isSoundEnabled(), false);
  const result = recordStreakResult("medium", true); // must not throw
  assertEqual(result, { current: 1, best: 1, isNewBest: true });
});

// --- legacy sound-key migration --------------------------------------

test("legacy dab-sound-enabled key is migrated into the new blob, then removed", () => {
  const mock = useMockStorage({ initialData: { "dab-sound-enabled": "0" } }); // old key, no new blob yet
  assertEqual(isSoundEnabled(), false, "old preference carried over");
  assertTrue(!mock._store.has("dab-sound-enabled"), "legacy key cleaned up");
  assertTrue(mock._store.has("dab-save"), "migrated into the new key");
});

test("legacy key is ignored once a real dab-save blob already exists", () => {
  useMockStorage({
    initialData: {
      "dab-sound-enabled": "0", // stale, should be irrelevant now
      "dab-save": JSON.stringify({ version: 1, sound: { enabled: true }, streaks: {} }),
    },
  });
  assertEqual(isSoundEnabled(), true, "the real blob wins, legacy key is not consulted");
});

// --- streak win/loss/draw transitions ---------------------------------

test("streak: consecutive wins increment current and track best", () => {
  useMockStorage({});
  assertEqual(recordStreakResult("medium", true), { current: 1, best: 1, isNewBest: true });
  assertEqual(recordStreakResult("medium", true), { current: 2, best: 2, isNewBest: true });
  assertEqual(recordStreakResult("medium", true), { current: 3, best: 3, isNewBest: true });
});

test("streak: a loss resets current to 0 but best is preserved", () => {
  useMockStorage({});
  recordStreakResult("hard", true);
  recordStreakResult("hard", true);
  recordStreakResult("hard", true); // current=3, best=3
  const afterLoss = recordStreakResult("hard", false);
  assertEqual(afterLoss, { current: 0, best: 3, isNewBest: false });
});

test("streak: a draw resets current exactly like a loss does", () => {
  useMockStorage({});
  recordStreakResult("easy", true);
  recordStreakResult("easy", true); // current=2, best=2
  const afterDraw = recordStreakResult("easy", false); // main.js calls this with won=false for a draw too
  assertEqual(afterDraw, { current: 0, best: 2, isNewBest: false });
});

test("streak: winning again after a broken streak does not immediately beat the old best", () => {
  useMockStorage({});
  recordStreakResult("hard", true);
  recordStreakResult("hard", true);
  recordStreakResult("hard", true); // best=3
  recordStreakResult("hard", false); // current=0, best=3
  const firstWinBack = recordStreakResult("hard", true);
  assertEqual(firstWinBack, { current: 1, best: 3, isNewBest: false });
});

test("streak: surpassing the old best flips isNewBest back on", () => {
  useMockStorage({});
  recordStreakResult("easy", true);
  recordStreakResult("easy", true);
  recordStreakResult("easy", false); // best=2, current reset
  recordStreakResult("easy", true); // current=1
  const surpassed = recordStreakResult("easy", true); // current=2 -- ties, not surpasses
  assertEqual(surpassed.isNewBest, false, "tying the old best is not a NEW best");
  const newBest = recordStreakResult("easy", true); // current=3 -- now it surpasses
  assertEqual(newBest, { current: 3, best: 3, isNewBest: true });
});

test("streak: each difficulty is tracked completely independently", () => {
  useMockStorage({});
  recordStreakResult("easy", true);
  recordStreakResult("easy", true);
  recordStreakResult("medium", true);
  recordStreakResult("hard", false);
  assertEqual(getStreak("easy"), { current: 2, best: 2 });
  assertEqual(getStreak("medium"), { current: 1, best: 1 });
  assertEqual(getStreak("hard"), { current: 0, best: 0 });
});

test("getStreak on an unknown difficulty returns a harmless zeroed value, not a crash", () => {
  useMockStorage({});
  assertEqual(getStreak("nightmare"), { current: 0, best: 0 });
});

test("recordStreakResult on an unknown difficulty is a no-op, not a crash", () => {
  useMockStorage({});
  const result = recordStreakResult("nightmare", true);
  assertEqual(result, { current: 0, best: 0, isNewBest: false });
  // and it must not have silently mutated some OTHER difficulty as a side effect
  assertEqual(getStreak("easy"), { current: 0, best: 0 });
  assertEqual(getStreak("medium"), { current: 0, best: 0 });
  assertEqual(getStreak("hard"), { current: 0, best: 0 });
});

// --- achievements (milestone 13-2) -------------------------------------

test("achievements: fresh state has nothing unlocked, no hard wins, zero local games", () => {
  useMockStorage({});
  assertEqual(getUnlockedAchievements(), []);
  assertEqual(getHardWinsBySize(), { 3: false, 5: false, 7: false });
  assertEqual(getLocalGamesCompleted(), 0);
});

test("achievements: unlockAchievement persists and survives a fresh reload", () => {
  const mock = useMockStorage({});
  assertTrue(unlockAchievement("first_win"), "newly unlocked -> true");
  assertEqual(getUnlockedAchievements(), ["first_win"]);

  const raw = mock._store.get("dab-save");
  global.localStorage = mockLocalStorage({ initialData: { "dab-save": raw } });
  reloadFromStorage();
  assertEqual(getUnlockedAchievements(), ["first_win"]);
});

test("achievements: unlocking the same id twice is a no-op the second time", () => {
  useMockStorage({});
  assertTrue(unlockAchievement("shutout"));
  assertTrue(!unlockAchievement("shutout"), "already unlocked -> false, and no duplicate entry");
  assertEqual(getUnlockedAchievements(), ["shutout"]);
});

test("achievements: unlocking multiple ids keeps them all, independently", () => {
  useMockStorage({});
  unlockAchievement("first_win");
  unlockAchievement("comeback");
  unlockAchievement("hot_streak");
  assertEqual(getUnlockedAchievements().sort(), ["comeback", "first_win", "hot_streak"]);
});

test("achievements: recordHardWin marks one size, leaves the others alone", () => {
  useMockStorage({});
  const record = recordHardWin(5);
  assertEqual(record, { 3: false, 5: true, 7: false });
  assertEqual(getHardWinsBySize(), { 3: false, 5: true, 7: false });
});

test("achievements: recordHardWin across all three sizes -> every size true", () => {
  useMockStorage({});
  recordHardWin(3);
  recordHardWin(7);
  const record = recordHardWin(5);
  assertEqual(record, { 3: true, 5: true, 7: true });
});

test("achievements: recordHardWin on an unrecognized size is ignored, not appended", () => {
  useMockStorage({});
  const record = recordHardWin(9);
  assertEqual(record, { 3: false, 5: false, 7: false });
  assertTrue(!Object.prototype.hasOwnProperty.call(record, 9), "no stray key added");
});

test("achievements: incrementLocalGamesCompleted counts up and persists", () => {
  const mock = useMockStorage({});
  assertEqual(incrementLocalGamesCompleted(), 1);
  assertEqual(incrementLocalGamesCompleted(), 2);
  assertEqual(getLocalGamesCompleted(), 2);

  const raw = mock._store.get("dab-save");
  global.localStorage = mockLocalStorage({ initialData: { "dab-save": raw } });
  reloadFromStorage();
  assertEqual(getLocalGamesCompleted(), 2);
});

test("achievements: corrupted achievements block sanitizes to defaults, sibling fields untouched", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 2,
        sound: { enabled: false },
        streaks: { hard: { current: 3, best: 3 } },
        achievements: { unlocked: "not-an-array", hardWinsBySize: { 3: "yes", 5: true }, localGamesCompleted: -4 },
      }),
    },
  });
  assertEqual(isSoundEnabled(), false, "sibling field survives the corrupted achievements block");
  assertEqual(getStreak("hard"), { current: 3, best: 3 }, "sibling field survives the corrupted achievements block");
  assertEqual(getUnlockedAchievements(), []);
  assertEqual(getHardWinsBySize(), { 3: false, 5: true, 7: false }, "field-by-field: the valid `5: true` survives");
  assertEqual(getLocalGamesCompleted(), 0);
});

test("achievements: unlocked list drops non-string entries and de-duplicates", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 2,
        sound: {},
        streaks: {},
        achievements: { unlocked: ["first_win", "first_win", 42, null, "shutout"] },
      }),
    },
  });
  assertEqual(getUnlockedAchievements().sort(), ["first_win", "shutout"]);
});

test("achievements: a v1 blob (no achievements field at all) migrates to v2 with sound/streaks intact", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 1,
        sound: { enabled: false },
        streaks: { easy: { current: 2, best: 4 }, medium: { current: 0, best: 0 }, hard: { current: 0, best: 0 } },
      }),
    },
  });
  assertEqual(isSoundEnabled(), false, "v1 data carried through the migration");
  assertEqual(getStreak("easy"), { current: 2, best: 4 }, "v1 data carried through the migration");
  assertEqual(getUnlockedAchievements(), [], "v1 had no achievements block -> defaulted, not crashed");
  assertEqual(getHardWinsBySize(), { 3: false, 5: false, 7: false });
  assertEqual(getLocalGamesCompleted(), 0);
});

// --- daily challenge (milestone 13-3) -----------------------------------

test("daily: fresh state has never been played and no streak", () => {
  useMockStorage({});
  assertEqual(getDailyState(), { lastPlayedDate: null, lastResult: null, currentStreak: 0, bestStreak: 0 });
});

test("daily: recordDailyResult persists a win and survives a fresh reload", () => {
  const mock = useMockStorage({});
  const result = recordDailyResult({
    dateString: "2026-08-16",
    won: true,
    playerScore: 15,
    aiScore: 10,
    newStreak: 1,
  });
  assertEqual(result, {
    lastPlayedDate: "2026-08-16",
    lastResult: { date: "2026-08-16", won: true, playerScore: 15, aiScore: 10 },
    currentStreak: 1,
    bestStreak: 1,
  });

  const raw = mock._store.get("dab-save");
  global.localStorage = mockLocalStorage({ initialData: { "dab-save": raw } });
  reloadFromStorage();
  assertEqual(getDailyState(), result);
});

test("daily: bestStreak only ever increases, even after a later loss drops currentStreak", () => {
  useMockStorage({});
  recordDailyResult({ dateString: "2026-08-14", won: true, playerScore: 5, aiScore: 3, newStreak: 3 });
  const afterLoss = recordDailyResult({
    dateString: "2026-08-15",
    won: false,
    playerScore: 2,
    aiScore: 8,
    newStreak: 0,
  });
  assertEqual(afterLoss, {
    lastPlayedDate: "2026-08-15",
    lastResult: { date: "2026-08-15", won: false, playerScore: 2, aiScore: 8 },
    currentStreak: 0,
    bestStreak: 3,
  });
});

test("daily: corrupted daily block sanitizes to defaults, sibling fields untouched", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 3,
        sound: { enabled: false },
        streaks: {},
        achievements: {},
        daily: { lastPlayedDate: "not-a-date", lastResult: { won: true }, currentStreak: -2, bestStreak: "nine" },
      }),
    },
  });
  assertEqual(isSoundEnabled(), false, "sibling field survives the corrupted daily block");
  assertEqual(getDailyState(), { lastPlayedDate: null, lastResult: null, currentStreak: 0, bestStreak: 0 });
});

test("daily: a well-formed lastResult round-trips exactly; a partial one is discarded entirely (not salvaged field-by-field)", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 3,
        sound: {},
        streaks: {},
        achievements: {},
        daily: {
          lastPlayedDate: "2026-08-16",
          lastResult: { date: "2026-08-16", won: true, playerScore: 12 }, // missing aiScore
          currentStreak: 1,
          bestStreak: 1,
        },
      }),
    },
  });
  const daily = getDailyState();
  assertEqual(daily.lastResult, null, "a half-populated result isn't safely displayable -> discarded whole");
  assertEqual(daily.lastPlayedDate, "2026-08-16", "sibling fields in the same daily block are untouched");
});

test("daily: best < current in stored data is coerced up to current (same invariant as vs-AI streaks)", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 3,
        sound: {},
        streaks: {},
        achievements: {},
        daily: { lastPlayedDate: null, lastResult: null, currentStreak: 5, bestStreak: 2 },
      }),
    },
  });
  assertEqual(getDailyState().bestStreak, 5);
});

test("daily: a v2 blob (no daily field at all) migrates to v3 with sound/streaks/achievements intact", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 2,
        sound: { enabled: false },
        streaks: { easy: { current: 1, best: 1 }, medium: { current: 0, best: 0 }, hard: { current: 0, best: 0 } },
        achievements: { unlocked: ["first_win"], hardWinsBySize: { 3: true, 5: false, 7: false }, localGamesCompleted: 4 },
      }),
    },
  });
  assertEqual(isSoundEnabled(), false, "v2 data carried through the migration");
  assertEqual(getStreak("easy"), { current: 1, best: 1 }, "v2 data carried through the migration");
  assertEqual(getUnlockedAchievements(), ["first_win"], "v2 data carried through the migration");
  assertEqual(getLocalGamesCompleted(), 4, "v2 data carried through the migration");
  assertEqual(getDailyState(), { lastPlayedDate: null, lastResult: null, currentStreak: 0, bestStreak: 0 });
});

test("daily: a v1 blob (two migration hops, v1 -> v2 -> v3) ends up fully defaulted for achievements AND daily", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 1,
        sound: { enabled: true },
        streaks: { easy: { current: 0, best: 0 }, medium: { current: 0, best: 0 }, hard: { current: 7, best: 9 } },
      }),
    },
  });
  assertEqual(getStreak("hard"), { current: 7, best: 9 }, "v1 data survives a two-hop migration");
  assertEqual(getUnlockedAchievements(), []);
  assertEqual(getDailyState(), { lastPlayedDate: null, lastResult: null, currentStreak: 0, bestStreak: 0 });
});

// --- board skins (milestone 13-4) -----------------------------------

test("skins: fresh state has only Paper unlocked and selected", () => {
  useMockStorage({});
  assertEqual(getSkinsState(), { selected: "paper", unlocked: ["paper"], hasHardWin: false });
});

test("skins: setSelectedSkin refuses a locked skin — selection stays unchanged", () => {
  useMockStorage({});
  const applied = setSelectedSkin("neon");
  assertTrue(!applied, "neon isn't unlocked yet");
  assertEqual(getSkinsState().selected, "paper");
});

test("skins: unlockSkin then setSelectedSkin succeeds once it's actually unlocked", () => {
  const mock = useMockStorage({});
  assertTrue(unlockSkin("chalkboard"));
  assertTrue(setSelectedSkin("chalkboard"));
  assertEqual(getSkinsState(), { selected: "chalkboard", unlocked: ["paper", "chalkboard"], hasHardWin: false });

  const raw = mock._store.get("dab-save");
  global.localStorage = mockLocalStorage({ initialData: { "dab-save": raw } });
  reloadFromStorage();
  assertEqual(getSkinsState().selected, "chalkboard", "selection survives a fresh reload");
});

test("skins: unlockSkin is idempotent and rejects unknown ids", () => {
  useMockStorage({});
  assertTrue(unlockSkin("neon"));
  assertTrue(!unlockSkin("neon"), "already unlocked -> false, no duplicate");
  assertTrue(!unlockSkin("gold-plated"), "not a real skin id -> false, not appended");
  assertEqual(getSkinsState().unlocked, ["paper", "neon"]);
});

test("skins: recordHardWinForSkins is idempotent and persists", () => {
  const mock = useMockStorage({});
  assertTrue(recordHardWinForSkins());
  assertTrue(!recordHardWinForSkins(), "already true -> false the second time");
  assertEqual(getSkinsState().hasHardWin, true);

  const raw = mock._store.get("dab-save");
  global.localStorage = mockLocalStorage({ initialData: { "dab-save": raw } });
  reloadFromStorage();
  assertEqual(getSkinsState().hasHardWin, true);
});

test("skins: a tampered blob claiming `selected: \"neon\"` without \"neon\" in `unlocked` is rejected at load time", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 4,
        sound: {},
        streaks: {},
        achievements: {},
        daily: {},
        skins: { selected: "neon", unlocked: ["paper"], hasHardWin: false },
      }),
    },
  });
  assertEqual(getSkinsState().selected, "paper", "tampered selection is not honored");
});

test("skins: a tampered blob can't even smuggle 'neon' into `unlocked` to bypass the check that way -- unlocking still has to go through the real facts (this just proves sanitize() trusts a well-formed unlocked list literally, which is fine: the ATTACK surface is `selected` without a matching `unlocked` entry, covered above)", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 4,
        sound: {},
        streaks: {},
        achievements: {},
        daily: {},
        skins: { selected: "neon", unlocked: ["paper", "neon"], hasHardWin: false },
      }),
    },
  });
  // This IS honored -- storage.js has no way to know whether "neon"
  // being in `unlocked` is legitimate (game/theme.js decided it, main.js
  // called unlockSkin()) or hand-edited; it only enforces internal
  // consistency (selected must be a member of unlocked), which this blob
  // satisfies. Real anti-tamper for "the achievement wasn't actually
  // earned" is out of scope for a client-only, no-server casual game
  // (same stance as game/daily.js's explicit no-anti-cheat decision).
  assertEqual(getSkinsState().selected, "neon");
});

test("skins: garbage/unknown ids in `unlocked` are dropped, and \"paper\" is force-included even if missing", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 4,
        sound: {},
        streaks: {},
        achievements: {},
        daily: {},
        skins: { selected: "paper", unlocked: ["chalkboard", "not-a-real-skin", 42, null], hasHardWin: "yes" },
      }),
    },
  });
  assertEqual(getSkinsState().unlocked.sort(), ["chalkboard", "paper"]);
  assertEqual(getSkinsState().hasHardWin, false, "wrong type -> sanitized to default");
});

test("skins: a v3 blob (no skins field at all) migrates to v4 with sound/streaks/achievements/daily intact", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 3,
        sound: { enabled: false },
        streaks: { easy: { current: 2, best: 2 }, medium: { current: 0, best: 0 }, hard: { current: 0, best: 0 } },
        achievements: { unlocked: ["shutout"], hardWinsBySize: { 3: false, 5: false, 7: true }, localGamesCompleted: 1 },
        daily: { lastPlayedDate: "2026-08-16", lastResult: null, currentStreak: 0, bestStreak: 2 },
      }),
    },
  });
  assertEqual(isSoundEnabled(), false, "v3 data carried through the migration");
  assertEqual(getStreak("easy"), { current: 2, best: 2 }, "v3 data carried through the migration");
  assertEqual(getUnlockedAchievements(), ["shutout"], "v3 data carried through the migration");
  assertEqual(getDailyState().bestStreak, 2, "v3 data carried through the migration");
  assertEqual(getSkinsState(), { selected: "paper", unlocked: ["paper"], hasHardWin: false });
});

test("skins: a v1 blob (three migration hops, v1 -> v2 -> v3 -> v4) ends up fully defaulted for skins too", () => {
  useMockStorage({
    initialData: {
      "dab-save": JSON.stringify({
        version: 1,
        sound: { enabled: true },
        streaks: { easy: { current: 0, best: 0 }, medium: { current: 0, best: 0 }, hard: { current: 0, best: 0 } },
      }),
    },
  });
  assertEqual(getSkinsState(), { selected: "paper", unlocked: ["paper"], hasHardWin: false });
});
