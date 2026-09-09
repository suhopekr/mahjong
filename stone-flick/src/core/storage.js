// core/storage.js
// Single-key, versioned persistence for StoneFlick: sound preference,
// campaign progress (which stages are cleared and in how few turns),
// two-player mode usage, and the selected board theme.
//
// The ARCHITECTURE here — one storage key holding one JSON blob, a
// versioned schema with a migrate() chain, a sanitize() that defends
// every field independently, and a three-tier backing store (CrazyGames
// SDK Data module -> localStorage -> in-memory) — is inherited unchanged
// from Dots and Boxes and then Gomoku. The series' own audit note applies
// again and is worth repeating, because it is the mistake this file
// exists to avoid: the previous game's storage module LOOKED game-neutral
// and was not — its keys, its size lists and its per-feature fields were
// all hardcoded to that game. So the architecture is copied and the
// schema is written from scratch. Nothing below is a leftover.
//
// Backing store, in priority order: `SDK.data.*` (a synchronous
// localStorage-shaped API) when the CrazyGames SDK is present and
// usable; plain `localStorage` otherwise; in-memory only if that also
// fails (Safari private browsing throws on setItem, some browsers
// disable storage entirely, quota can be exceeded). None of that may
// ever throw out of this module: on any failure the game keeps running
// off the in-memory copy, and the only thing lost is durability across a
// reload. Every exported function is synchronous regardless of which
// backend is live.
//
// The one wrinkle, unchanged from Gomoku: determining SDK availability is
// asynchronous (SDK.init() must resolve first) but the module-top
// `let state = load()` must be synchronous, because main.js reads from
// this at import time. So it boots off localStorage and then, once the
// SDK is confirmed, reconcileWithSdk() runs exactly once. `storageSynced`
// is exported so the UI can re-render after that — a real shipped bug in
// the previous game was the first screen being built from pre-
// reconciliation data, which only ever reproduced on the live portal.

const STORAGE_KEY = "stoneflick-save";
// Exported so a test fixture can say "a save in the CURRENT schema"
// instead of pinning a number. Fixtures that pinned `version: 1` kept
// working after the campaign expanded and quietly became migration
// tests -- a seeded "cleared 1..14" arrived at the grid as a different
// set of stages, and the browser check spent thirty seconds clicking a
// locked card. Deliberate migration coverage in test/storage.test.js
// still writes the old number by hand, which is the point: there it is
// the subject, not the setting.
export const SCHEMA_VERSION = 2;

// Structural whitelist of theme ids. Deliberately duplicated here rather
// than imported from game/themes.js: this module owns its own persisted
// shape and must not depend on game logic. It answers only "is this a
// REAL theme id," never "has the player earned it" — that second
// question belongs to game/themes.js, and keeping the two apart is what
// makes a tampered save fail safe instead of unlocking Neon.
const THEME_IDS = ["wood", "slate", "paper", "neon"];
const DEFAULT_THEME_ID = "wood";

// The campaign's own id range. Stored here (rather than imported from
// game/stages.js) for the same reason as THEME_IDS, and used only to
// reject nonsense ids from a corrupted blob — adding a stage to the
// campaign means raising MAX_STAGE_ID, which is a one-line change with a
// test that catches forgetting it (test/storage.test.js asserts it
// matches game/stages.js's LAST_STAGE_ID).
const MAX_STAGE_ID = 100;

/** How many unspent shot previews a save may hold. One: the offer that
 * grants them (main.js) only appears when the player has none, so the
 * count is a boolean wearing a number, and the cap is what makes a
 * hand-edited save stay that way. */
const MAX_PREVIEWS_HELD = 1;

/**
 * SAVE MIGRATION, campaign expansion (16 stages -> 100).
 *
 * Every stage id in a save -- cleared, stars, hardCleared, hardStars,
 * lastStageId -- is a slot number, and the expansion moved the sixteen
 * original stages so that each element is introduced before it is used
 * (game/stages.js's HAND_SLOT is the same table). A save written before
 * the expansion therefore names stages that have moved, and reading it
 * unmigrated would credit a player for stages they never played.
 *
 * The blast radius is one save -- the game has not shipped -- but the
 * mechanism has to exist anyway, because the version field is what makes
 * the NEXT change survivable, and a migration written after a launch is
 * written against saves you cannot inspect.
 */
const SLOT_AFTER_EXPANSION = {
  1: 1, 2: 2, 3: 3, 6: 4, 4: 6, 8: 7, 11: 8, 5: 9,
  7: 10, 9: 11, 10: 12, 13: 13, 12: 15, 14: 16, 15: 19, 16: 100,
};

// The two-player stone counts the mode offers. Duplicated from
// game/stages.js's VERSUS_STONE_COUNTS for the same reason as THEME_IDS
// and MAX_STAGE_ID above — this module owns its persisted shape and must
// not import game logic. test/storage.test.js asserts the two lists
// agree, which is the whole price of keeping them apart.
const VERSUS_STONE_COUNTS = [3, 5, 7, 9];

// The obstacle briefings the game can show, structurally whitelisted for
// the same reason as THEME_IDS and MAX_STAGE_ID above: this module owns
// its persisted shape and must not import game logic. It answers only "is
// this a REAL briefing id," so a tampered save can put nothing into the
// seen list except ids the game already knows how to draw.
// test/storage.test.js asserts this list matches game/briefings.js's
// BRIEFING_IDS, which is the whole price of keeping them apart.
const BRIEFING_IDS = ["wall", "peg", "hole", "bumper", "portal", "sand", "ice", "aim-line"];

// The pro tips, whitelisted for the same reason and tested the same way
// (test/storage.test.js asserts this matches game/tips.js's TIP_IDS).
// Order does not matter here — this list only answers "is this a real tip
// id"; game/tips.js owns which tip is shown when.
const TIP_IDS = [
  "landscape", "cancel", "thin", "bank", "bumper", "mutual", "pit", "overshoot", "edge",
  "setup", "sand", "ice", "portal", "par", "preview", "practice", "hard",
];

// The AI levels practice offers. Duplicated from game/ai.js's DIFFICULTY
// keys for the same reason as everything else in this file's whitelists:
// storage owns its persisted shape and must not import game logic.
// test/storage.test.js asserts the two agree.
const AI_LEVELS = ["easy", "medium", "hard"];
const DEFAULT_AI_LEVEL = "medium";
const DEFAULT_VERSUS_STONES = 5;

// --- SDK Data module bootstrap ------------------------------------------
// An independent copy of core/ads.js's readyPromise pattern rather than
// an import: the two core modules stay decoupled, and calling SDK.init()
// from both was verified safe against the real live SDK (concurrent and
// sequential repeat calls both resolve cleanly, same `environment`).
// Never rejects. `environment === "disabled"` (embedded on a non-
// CrazyGames, non-localhost domain) is treated exactly like "no SDK":
// every further SDK call throws there.
async function initSdkData() {
  try {
    if (typeof window === "undefined" || !window.CrazyGames?.SDK?.data) return false;
    const sdk = window.CrazyGames.SDK;
    await sdk.init();
    return sdk.environment !== "disabled";
  } catch {
    return false;
  }
}

let sdkReadyPromise = initSdkData();
let sdkAvailable = false;

function sdkGetItem(key) {
  try {
    return window.CrazyGames.SDK.data.getItem(key);
  } catch {
    return null;
  }
}

function sdkSetItem(key, value) {
  try {
    window.CrazyGames.SDK.data.setItem(key, value);
  } catch {
    // Fire-and-forget: localStorage already has this same write.
  }
}

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota exceeded / private mode / storage disabled. The in-memory
    // state is still correct for the rest of the session.
  }
}

// --- schema -------------------------------------------------------------

function defaultCampaignState() {
  return {
    /** stage ids ever cleared. A SET semantically; stored as a sorted
     * array because JSON has no set, and kept monotonic (nothing ever
     * removes from it) so a theme unlock can never regress. */
    cleared: [],
    /** stageId -> fewest turns it has been cleared in. */
    bestTurns: {},
    /** stageId -> best star rating ever earned there, 1..3. The reason to
     * replay a stage you already beat: turns measure how fast you were,
     * stars measure how cleanly, and "I cleared it but lost three stones"
     * is a result a player wants to go back and fix. */
    stars: {},
    /** where the player was, so "Continue" is honest */
    lastStageId: 1,
    /** and in which difficulty */
    lastHard: false,
    /** HARD MODE — the same layouts with the aim guide removed, tracked
     * separately because it is a separate result. Kept as a subset of
     * `cleared`: hard only opens on a stage already beaten normally. */
    hardCleared: [],
    hardBestTurns: {},
    hardStars: {},
  };
}

function defaultState() {
  return {
    version: SCHEMA_VERSION,
    sound: { enabled: true },
    campaign: defaultCampaignState(),
    versus: { gamesCompleted: 0, stoneCount: DEFAULT_VERSUS_STONES },
    theme: { selected: DEFAULT_THEME_ID },
    settings: { pvpAimGuide: true, practiceLevel: DEFAULT_AI_LEVEL },
    briefings: { seen: [] },
    tips: { seen: [] },
    previews: { held: 0 },
  };
}

function isStageId(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_STAGE_ID;
}

function sanitizeCampaign(entry) {
  const cleared = Array.isArray(entry?.cleared)
    ? [...new Set(entry.cleared.filter(isStageId))].sort((a, b) => a - b)
    : [];
  const bestTurns = {};
  if (entry?.bestTurns && typeof entry.bestTurns === "object") {
    for (const [key, value] of Object.entries(entry.bestTurns)) {
      const id = Number(key);
      // A best-turns entry for a stage that was never cleared is
      // meaningless, so it is dropped rather than kept — that keeps
      // "cleared" the single source of truth for progress and makes the
      // two fields impossible to disagree.
      if (isStageId(id) && cleared.includes(id) && Number.isInteger(value) && value > 0) {
        bestTurns[id] = value;
      }
    }
  }
  const stars = {};
  if (entry?.stars && typeof entry.stars === "object") {
    for (const [key, value] of Object.entries(entry.stars)) {
      const id = Number(key);
      // Same rule as bestTurns, plus a hard 1..3 range: a star count is
      // shown as a row of icons, and a tampered 99 would render 99 of
      // them across the stage card.
      if (isStageId(id) && cleared.includes(id) && Number.isInteger(value) && value >= 1 && value <= 3) {
        stars[id] = value;
      }
    }
  }
  const lastStageId = isStageId(entry?.lastStageId) ? entry.lastStageId : 1;

  // HARD MODE keeps its own three fields rather than sharing the ones
  // above. It is the same layout with the aim guide removed, so it is a
  // genuinely separate result: a player can be three stars on normal and
  // one on hard, and a single record could not say that.
  //
  // The invariant enforced here is that hard progress is a SUBSET of
  // normal progress — hard only opens once the stage has been cleared
  // normally, so a save claiming a hard clear on a stage that was never
  // cleared is corrupt, not just unusual. Dropping it keeps `cleared` the
  // single source of truth for what has been beaten, in the same way
  // bestTurns is already pinned to it.
  const hardCleared = Array.isArray(entry?.hardCleared)
    ? [...new Set(entry.hardCleared.filter((id) => isStageId(id) && cleared.includes(id)))].sort((a, b) => a - b)
    : [];
  const hardBestTurns = {};
  const hardStars = {};
  for (const [source, target, check] of [
    [entry?.hardBestTurns, hardBestTurns, (v) => Number.isInteger(v) && v > 0],
    [entry?.hardStars, hardStars, (v) => Number.isInteger(v) && v >= 1 && v <= 3],
  ]) {
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      const id = Number(key);
      if (isStageId(id) && hardCleared.includes(id) && check(value)) target[id] = value;
    }
  }
  return {
    cleared,
    bestTurns,
    stars,
    lastStageId,
    // Which difficulty "Continue" should resume in. A player deep in hard
    // mode being dropped back into normal is the kind of small
    // forgetfulness that reads as the game losing their place.
    lastHard: entry?.lastHard === true && hardCleared.length > 0,
    hardCleared,
    hardBestTurns,
    hardStars,
  };
}

// Every field is defended independently rather than the whole blob being
// discarded over one bad value: a corrupted bestTurns entry must not cost
// the player their cleared list, and a garbage sound flag must not touch
// either.
function sanitize(parsed) {
  return {
    version: SCHEMA_VERSION,
    sound: { enabled: typeof parsed.sound?.enabled === "boolean" ? parsed.sound.enabled : true },
    campaign: sanitizeCampaign(parsed.campaign),
    versus: {
      gamesCompleted:
        Number.isInteger(parsed.versus?.gamesCompleted) && parsed.versus.gamesCompleted >= 0
          ? parsed.versus.gamesCompleted
          : 0,
      // Added after v1 shipped its schema. No version bump: migrate()'s
      // own comment already records that a step never has to synthesize a
      // field, because sanitize() treats a missing one as "use the
      // default" for every field. An older save simply arrives here
      // without this key and gets 5.
      stoneCount: VERSUS_STONE_COUNTS.includes(parsed.versus?.stoneCount)
        ? parsed.versus.stoneCount
        : DEFAULT_VERSUS_STONES,
    },
    theme: { selected: THEME_IDS.includes(parsed.theme?.selected) ? parsed.theme.selected : DEFAULT_THEME_ID },
    settings: {
      // Defaults ON, so an absent field means on: a first-time player
      // meeting a board with no line drawn for them reads it as broken,
      // not as harder. The card in game/briefings.js tells them the
      // switch exists; turning it off is then their choice.
      pvpAimGuide: parsed.settings?.pvpAimGuide !== false,
      practiceLevel: AI_LEVELS.includes(parsed.settings?.practiceLevel)
        ? parsed.settings.practiceLevel
        : DEFAULT_AI_LEVEL,
    },
    // Which obstacle briefings the player has already been shown. Added
    // after v1 shipped, and like versus.stoneCount above it needs no
    // version bump: an older save arrives without the key and gets an
    // empty list, which simply means the next stage carrying an obstacle
    // explains it once. That is the correct behaviour for an existing
    // player too — they have never seen the briefing, because it did not
    // exist.
    //
    // Order is NOT preserved: this is a set, and game/briefings.js
    // decides display order. Sorting into the whitelist's own order keeps
    // the persisted blob stable, so re-saving without a change does not
    // churn the stored string.
    briefings: {
      seen: Array.isArray(parsed.briefings?.seen)
        ? BRIEFING_IDS.filter((id) => parsed.briefings.seen.includes(id))
        : [],
    },
    // Which pro tips have been handed over. Same shape and same rules as
    // briefings.seen above, and a missing key means "none yet", which is
    // right for an existing player too: they have never been shown one,
    // because they did not exist.
    tips: {
      seen: Array.isArray(parsed.tips?.seen)
        ? TIP_IDS.filter((id) => parsed.tips.seen.includes(id))
        : [],
    },
    // Shot previews the player is holding but has not spent. PERSISTED,
    // and that is the point: it is paid for with a rewarded ad, so it has
    // to survive closing the tab the same way a cleared stage does — a
    // reward that evaporates when the game is shut is a reward the player
    // was cheated out of. It also carries to whatever stage they play
    // next, because it was earned by the player and not by a stage.
    //
    // Clamped to MAX_PREVIEWS_HELD rather than trusted: this is the one
    // number in the save that a hand edit could turn into an unlimited
    // hint, and main.js only ever grants when the count is 0 anyway.
    // Added after v2 shipped, and like versus.stoneCount and
    // briefings.seen it needs no version bump — an older save arrives
    // without the key and gets 0, which is exactly right.
    previews: {
      held: Number.isInteger(parsed.previews?.held)
        ? Math.max(0, Math.min(MAX_PREVIEWS_HELD, parsed.previews.held))
        : 0,
    },
  };
}

/**
 * Steps chain: a blob with no `version` is treated as v1, then each step
 * runs in turn. No step has to synthesize a missing field, since
 * sanitize() already treats any absent field as "use the default" — a
 * step only has to move what is there.
 * @returns {object|null} null when there is no known migration path
 */
function migrate(parsed) {
  let current = parsed;
  if (current.version === undefined) current = { ...current, version: 1 };
  if (current.version === 1) current = { ...toV2(current), version: 2 };
  return current.version === SCHEMA_VERSION ? current : null;
}

/**
 * v1 -> v2: the campaign went from 16 stages to 100, and the original
 * sixteen moved so that every element is introduced before it is used.
 * Ids in a v1 save therefore name stages that are now somewhere else, and
 * loading one unmigrated would credit a player for stages they never
 * played -- stage 11 in a v1 save is the five-peg stage, and stage 11 now
 * is three pits.
 */
function toV2(save) {
  const move = (id) => SLOT_AFTER_EXPANSION[id] ?? null;
  const list = (xs) => (Array.isArray(xs) ? xs.map(move).filter((v) => v !== null) : xs);
  const table = (obj) => {
    if (!obj || typeof obj !== "object") return obj;
    const out = {};
    for (const [id, value] of Object.entries(obj)) {
      const slot = move(Number(id));
      if (slot !== null) out[slot] = value;
    }
    return out;
  };
  const campaign = save.campaign;
  if (!campaign || typeof campaign !== "object") return save;
  return {
    ...save,
    campaign: {
      ...campaign,
      cleared: list(campaign.cleared),
      hardCleared: list(campaign.hardCleared),
      stars: table(campaign.stars),
      hardStars: table(campaign.hardStars),
      lastStageId: typeof campaign.lastStageId === "number"
        ? (move(campaign.lastStageId) ?? 1)
        : campaign.lastStageId,
    },
  };
}

/** Shared by load() (localStorage) and reconcileWithSdk() (SDK), so a
 * corrupted blob is handled identically whichever backend produced it. */
function parseAndNormalize(raw) {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (parsed.version === SCHEMA_VERSION) return sanitize(parsed);
    const migrated = migrate(parsed);
    return migrated ? sanitize(migrated) : null;
  } catch {
    return null;
  }
}

function load() {
  const normalized = parseAndNormalize(safeGetItem(STORAGE_KEY));
  if (normalized) return normalized;
  // Persist the fresh defaults immediately so corrupted data is healed on
  // the spot rather than staying broken until the next setter call.
  const fresh = defaultState();
  safeSetItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

let state = load();

/**
 * Resolves once SDK detection and the one-time reconciliation have
 * finished — i.e. once `state` is final for this session. The UI must
 * re-render on this: on a portal page inside a cross-origin iframe,
 * localStorage can legitimately be empty or partitioned away, so the
 * first screen would otherwise be built from the wrong data. Never
 * rejects.
 */
export const storageSynced = sdkReadyPromise.then((ready) => {
  sdkAvailable = ready;
  if (ready) reconcileWithSdk();
});

/**
 * Merge two saves so that NOTHING A PLAYER EARNED CAN BE LOST.
 *
 * This function exists because the version that did not have it lost
 * people's campaigns, and it was reported twice before we knew why.
 * Reconciliation used to be "whatever the cloud has wins", which sounds
 * right and is wrong in two ordinary situations:
 *
 *   - THE CLOUD IS BEHIND. The portal's data module debounces its writes
 *     by a second and, by its own documentation, may take up to thirty to
 *     land. A player who clears three stages and closes the tab has a
 *     cloud copy that never received the last of them. On their next
 *     visit "the cloud wins" hands them the older save AND writes it over
 *     the good local one, so the rollback is permanent rather than
 *     cosmetic.
 *   - THE PLAYER STARTED BEFORE THE SDK ANSWERED. `state` is loaded
 *     synchronously at import; SDK.init() is a network round trip. Every
 *     stage cleared in that window existed only in the local copy, and
 *     the same overwrite threw it away.
 *
 * Merging removes the question. Progress here is all monotonic or
 * best-of, so there is a correct answer for every field and no need to
 * know which save is "newer": cleared lists are unions, stars take the
 * higher, turn records take the LOWER (fewer turns is the better clear).
 *
 * Preferences are not progress and are not merged — sound, theme,
 * settings and stone count take the incoming copy, which is what makes
 * them sync across devices at all, and none of them can lose anything
 * that cannot be set again in two taps.
 *
 * The result goes through sanitize() rather than being trusted: the union
 * of two valid saves is not automatically valid (hardCleared has to stay
 * a subset of cleared, stars have to stay pinned to a cleared stage), and
 * sanitize already knows every one of those rules.
 */
function mergeSaves(mine, theirs) {
  const union = (a, b) => [...new Set([...(a ?? []), ...(b ?? [])])];
  const bestOf = (a, b, better) => {
    const out = { ...(a ?? {}) };
    for (const [key, value] of Object.entries(b ?? {})) {
      out[key] = key in out ? better(out[key], value) : value;
    }
    return out;
  };
  const a = mine.campaign;
  const b = theirs.campaign;
  return sanitize({
    ...theirs,
    campaign: {
      cleared: union(a.cleared, b.cleared),
      // FEWER turns is the better record, so this one minimises. Getting
      // it the wrong way round would quietly award every player their
      // worst clear of each stage.
      bestTurns: bestOf(a.bestTurns, b.bestTurns, Math.min),
      stars: bestOf(a.stars, b.stars, Math.max),
      hardCleared: union(a.hardCleared, b.hardCleared),
      hardBestTurns: bestOf(a.hardBestTurns, b.hardBestTurns, Math.min),
      hardStars: bestOf(a.hardStars, b.hardStars, Math.max),
      // Where to resume is a position, not an achievement: take the other
      // device's, since it is the one that just played.
      lastStageId: b.lastStageId,
      lastHard: b.lastHard,
    },
    versus: {
      ...theirs.versus,
      gamesCompleted: Math.max(mine.versus?.gamesCompleted ?? 0, theirs.versus?.gamesCompleted ?? 0),
    },
    // Shown-once lists, so a union means nobody is told the same thing
    // twice on a second device.
    briefings: { seen: union(mine.briefings?.seen, theirs.briefings?.seen) },
    tips: { seen: union(mine.tips?.seen, theirs.tips?.seen) },
    // An unspent preview was paid for with an ad. sanitize() clamps it.
    previews: { held: Math.max(mine.previews?.held ?? 0, theirs.previews?.held ?? 0) },
  });
}

/**
 * One-time reconciliation, once the SDK has answered.
 *
 * Both copies are kept: the merged result is written back to BOTH stores,
 * so whichever one the next session reads first is already whole.
 */
function reconcileWithSdk() {
  const fromSdk = parseAndNormalize(sdkGetItem(STORAGE_KEY));
  if (fromSdk) state = mergeSaves(state, fromSdk);
  const json = JSON.stringify(state);
  safeSetItem(STORAGE_KEY, json);
  sdkSetItem(STORAGE_KEY, json);
}

function save() {
  const json = JSON.stringify(state);
  safeSetItem(STORAGE_KEY, json); // unconditional: the durable fallback and always-current cache
  if (sdkAvailable) sdkSetItem(STORAGE_KEY, json); // best-effort cloud copy
}

/** Re-reads from localStorage now, discarding the in-memory value.
 * Primarily for tests: ES modules are singletons and otherwise only
 * load() once per process. */
export function reloadFromStorage() {
  state = load();
}

/** Test-only: re-runs SDK detection and reconciliation against whatever
 * `window.CrazyGames` currently is, and waits for it. Node tests cannot
 * get a real SDK script to load asynchronously at import time, so they
 * mock `global.window.CrazyGames` and drive this code path directly
 * rather than racing a promise from module load. */
export async function reinitSdkForTesting() {
  sdkReadyPromise = initSdkData();
  sdkAvailable = await sdkReadyPromise;
  if (sdkAvailable) reconcileWithSdk();
  return sdkAvailable;
}

// --- sound ---------------------------------------------------------------

export function isSoundEnabled() {
  return state.sound.enabled;
}

export function setSoundEnabled(value) {
  state.sound.enabled = !!value;
  save();
}

export function toggleSound() {
  setSoundEnabled(!state.sound.enabled);
  return state.sound.enabled;
}

// --- campaign ------------------------------------------------------------

/** @returns {number[]} a copy — callers must not be able to mutate state */
export function getClearedStageIds() {
  return [...state.campaign.cleared];
}

export function isStageCleared(id) {
  return state.campaign.cleared.includes(id);
}

/**
 * How many stars a clear is worth, from how many shots it took against
 * the stage's own par.
 *
 * WHY SHOTS AND NOT STONES LOST
 * The first version of this scored a clear by how many of your own stones
 * you lost — 0 lost being three stars. `npm run balance` says that is
 * nearly free: across the campaign a competent player loses an average of
 * 0.2 stones per match, so most clears lose none at all and three stars
 * would have been the DEFAULT result rather than something to go back
 * for. Shots per clear, by contrast, ranges from 1 to well past 5 and
 * tracks skill closely — which makes it the thing worth measuring, and
 * the pars in game/stages.js are set from those measured distributions
 * rather than guessed.
 *
 * The +2 band for two stars is deliberately generous: missing par by one
 * shot is usually one unlucky bounce, and a system that punishes bad luck
 * as harshly as bad play stops reading as a score.
 * @param {number} shots - the player's own shots, AI replies excluded
 * @param {number} par - game/stages.js's par for the stage
 * @returns {1|2|3}
 */
export function starsForShots(shots, par) {
  if (!Number.isFinite(par) || par <= 0) return 1;
  if (shots <= par) return 3;
  if (shots <= par + 2) return 2;
  return 1;
}

/**
 * Records a clear. Both `turns` and `stars` are kept only when they beat
 * what is already stored, so replaying a stage badly can never make a
 * player's record worse — a rule that has to live here rather than at
 * the call site, because the call site is the place most likely to
 * forget it.
 */
export function recordStageCleared(id, turns, stars, hard = false) {
  if (!isStageId(id)) return;
  // Hard is refused on a stage that has never been beaten normally,
  // because that is the rule the whole schema leans on: hardCleared is a
  // subset of cleared, and sanitize() drops anything that breaks it. A
  // caller that got here without the unlock is a bug, and silently
  // writing a record sanitize would throw away next load is worse than
  // not writing one.
  if (hard && !state.campaign.cleared.includes(id)) return;
  const clearedList = hard ? state.campaign.hardCleared : state.campaign.cleared;
  const turnsMap = hard ? state.campaign.hardBestTurns : state.campaign.bestTurns;
  const starsMap = hard ? state.campaign.hardStars : state.campaign.stars;

  if (!clearedList.includes(id)) {
    clearedList.push(id);
    clearedList.sort((a, b) => a - b);
  }
  if (Number.isInteger(turns) && turns > 0) {
    const previous = turnsMap[id];
    if (!previous || turns < previous) turnsMap[id] = turns;
  }
  if (Number.isInteger(stars) && stars >= 1 && stars <= 3) {
    const previous = starsMap[id] ?? 0;
    if (stars > previous) starsMap[id] = stars;
  }
  save();
}

/** @returns {number|null} */
export function getBestTurns(id, hard = false) {
  return (hard ? state.campaign.hardBestTurns : state.campaign.bestTurns)[id] ?? null;
}

/** @returns {0|1|2|3} 0 for a stage never cleared */
export function getStars(id, hard = false) {
  return (hard ? state.campaign.hardStars : state.campaign.stars)[id] ?? 0;
}

export function isHardCleared(id) {
  return state.campaign.hardCleared.includes(id);
}

/** @returns {number[]} a copy — callers must not be able to mutate state */
export function getHardClearedStageIds() {
  return [...state.campaign.hardCleared];
}

/**
 * Hard opens on a stage the moment it has been beaten normally.
 *
 * Derived from `cleared` rather than stored, for the same reason
 * isStageUnlocked() is: a stored list is a second source of truth that
 * can disagree with the first one.
 */
export function isHardUnlocked(id) {
  return isStageCleared(id);
}

/**
 * BOTH difficulties count toward one total, and the thresholds in
 * game/themes.js were left where they are.
 *
 * The alternative was raising them in proportion, which would have taken
 * a theme away from a player who had already unlocked it — the one
 * outcome a progression change must never produce. So the ceiling doubles
 * and hard mode becomes a second route to the same rewards, which is also
 * what makes replaying a cleared stage on hard worth something beyond the
 * star itself.
 */
export function getTotalStars() {
  const sum = (map) => Object.values(map).reduce((total, n) => total + n, 0);
  return sum(state.campaign.stars) + sum(state.campaign.hardStars);
}

/** Every star the campaign can award — what the totals are shown out of.
 * Two difficulties, three stars each. */
export const MAX_STARS = MAX_STAGE_ID * 3 * 2;

/**
 * Stage 1 is always open; every other stage opens when the one before it
 * has been cleared. Written as a derivation rather than a stored
 * "unlocked" list on purpose — a stored list is a second source of truth
 * that can disagree with `cleared`, and this is the exact bug class the
 * sanitize step above already drops bestTurns entries to avoid.
 */
export function isStageUnlocked(id) {
  if (!isStageId(id)) return false;
  return id === 1 || state.campaign.cleared.includes(id - 1);
}

/**
 * Where "Continue" should drop the player: the next thing they have left
 * to beat, not merely the last stage they touched.
 *
 * Two tracks run in parallel and each has its own frontier — normal opens
 * by the previous stage, hard opens by the SAME stage having been beaten
 * normally — so "next" is a choice between two candidates rather than one
 * number. The rules, in order:
 *
 *   - Only one track has anything left: go there. A player who has
 *     finished all sixteen normally is not "done"; hard 4 is what they
 *     have left, and offering them a replay of normal 16 reads as the
 *     game having nothing more for them.
 *   - Both have something left: resume the difficulty they were last
 *     playing. Someone working through hard while normal still has
 *     stages open chose that, and Continue should not undo the choice.
 *   - Nothing left anywhere: replay the finale, in the difficulty they
 *     last played.
 *
 * @returns {{id:number, hard:boolean}}
 */
export function getContinuePoint() {
  let normal = null;
  let hard = null;
  for (let id = 1; id <= MAX_STAGE_ID; id++) {
    const beaten = state.campaign.cleared.includes(id);
    if (normal === null && !beaten) normal = isStageUnlocked(id) ? id : 1;
    // A hard stage is only offered once its normal twin is beaten, which
    // is exactly isHardUnlocked() — spelled out here rather than called so
    // the two frontiers are found in one pass.
    if (hard === null && beaten && !state.campaign.hardCleared.includes(id)) hard = id;
  }
  const wasHard = state.campaign.lastHard === true;
  if (normal === null && hard === null) return { id: MAX_STAGE_ID, hard: wasHard };
  if (normal === null) return { id: hard, hard: true };
  if (hard === null) return { id: normal, hard: false };
  return wasHard ? { id: hard, hard: true } : { id: normal, hard: false };
}

/** The stage id half of getContinuePoint(), for callers that only label. */
export function getContinueStageId() {
  return getContinuePoint().id;
}

export function getLastStageId() {
  return state.campaign.lastStageId;
}

export function getLastHard() {
  return state.campaign.lastHard === true;
}

export function setLastStageId(id, hard = false) {
  if (!isStageId(id)) return;
  state.campaign.lastStageId = id;
  // Only claimed when the stage really is open on hard; a save that
  // resumed into a locked difficulty would be a dead Continue button.
  state.campaign.lastHard = hard === true && state.campaign.cleared.includes(id);
  save();
}

// --- two-player mode -----------------------------------------------------

export function getVersusGamesCompleted() {
  return state.versus.gamesCompleted;
}

export function incrementVersusGamesCompleted() {
  state.versus.gamesCompleted += 1;
  save();
}

/** Stones per side in two-player mode — a preference, so it survives
 * across sessions and the second player never has to re-pick. */
export function getVersusStoneCount() {
  return state.versus.stoneCount;
}

export function setVersusStoneCount(count) {
  if (!VERSUS_STONE_COUNTS.includes(count)) return;
  state.versus.stoneCount = count;
  save();
}

// --- obstacle briefings --------------------------------------------------

/** The briefing ids already shown to this player. */
export function getSeenBriefings() {
  return [...state.briefings.seen];
}

export function hasSeenBriefing(id) {
  return state.briefings.seen.includes(id);
}

/**
 * Mark briefings as shown. Takes a list rather than one id because a
 * single stage can introduce more than one obstacle (stage 15 brings sand
 * and ice together) and the whole sequence is dismissed as a unit — one
 * write instead of one per page, and no half-seen state if the player
 * closes the game mid-sequence... which is deliberate: a sequence
 * abandoned halfway is re-shown in full next time, because the pages the
 * player did not reach are exactly the ones they still need.
 * @param {string[]} ids
 */
/** @returns {string[]} a copy — callers must not be able to mutate state */
export function getSeenTips() {
  return [...state.tips.seen];
}

export function hasSeenTip(id) {
  return state.tips.seen.includes(id);
}

/**
 * Mark one tip as handed over.
 *
 * Singular where markBriefingsSeen() is plural, because tips are shown
 * one at a time by construction: a card carries at most one, and the
 * whole point of `seen` is that the next card carries a different one.
 */
export function markTipSeen(id) {
  if (!TIP_IDS.includes(id) || state.tips.seen.includes(id)) return;
  state.tips.seen = TIP_IDS.filter((t) => state.tips.seen.includes(t) || t === id);
  save();
}

export function markBriefingsSeen(ids) {
  const added = (Array.isArray(ids) ? ids : []).filter(
    (id) => BRIEFING_IDS.includes(id) && !state.briefings.seen.includes(id)
  );
  if (added.length === 0) return;
  state.briefings.seen = BRIEFING_IDS.filter(
    (id) => state.briefings.seen.includes(id) || added.includes(id)
  );
  save();
}

// --- settings ------------------------------------------------------------

/**
 * Whether the aim indicator extrapolates the shot in PERSON-VERSUS-PERSON
 * play — two on one device today, solo practice and online later.
 *
 * Default OFF. Playing against another person without the line drawn for
 * you is what this game's versus mode is FOR, so that is the state a
 * player should meet first; the toggle exists as a way out for people who
 * find it too much, not as the norm they have to find and switch off.
 *
 * The campaign is not affected either way, and neither is hard mode —
 * hard is DEFINED by having no guide, so letting a setting restore it
 * would make its star ratings mean nothing.
 */
export function isPvpAimGuideOn() {
  return state.settings.pvpAimGuide === true;
}

export function setPvpAimGuide(value) {
  state.settings.pvpAimGuide = value === true;
  save();
}

/** Which AI the practice board plays against. Remembered because it is a
 * statement about the player's own level, not about one match. */
export function getPracticeLevel() {
  return state.settings.practiceLevel;
}

export function setPracticeLevel(level) {
  if (!AI_LEVELS.includes(level)) return;
  state.settings.practiceLevel = level;
  save();
}

// --- shot previews -------------------------------------------------------
//
// Earned from a rewarded ad on the loss card, spent on a shot. Stored
// rather than held in memory because it was paid for: it survives closing
// the game and it follows the player to any stage, since it belongs to
// them and not to the stage they happened to lose.

export function getPreviewsHeld() {
  return state.previews.held;
}

/** @param {number} n clamped into [0, MAX_PREVIEWS_HELD] */
export function setPreviewsHeld(n) {
  const next = Number.isInteger(n) ? Math.max(0, Math.min(MAX_PREVIEWS_HELD, n)) : 0;
  if (next === state.previews.held) return; // no write, no portal sync, no churn
  state.previews.held = next;
  save();
}

// --- theme ---------------------------------------------------------------

export function getTheme() {
  return state.theme.selected;
}

export function setTheme(id) {
  if (!THEME_IDS.includes(id)) return;
  state.theme.selected = id;
  save();
}

/** The exact object game/themes.js's check() functions expect. Built here
 * so no call site has to remember which stored facts feed unlock rules. */
export function themeUnlockContext() {
  return { stagesCleared: state.campaign.cleared.length, totalStars: getTotalStars() };
}

export { MAX_STAGE_ID, THEME_IDS, VERSUS_STONE_COUNTS, BRIEFING_IDS, AI_LEVELS };
