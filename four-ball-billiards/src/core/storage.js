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

const STORAGE_KEY = "fourball-save";
const SCHEMA_VERSION = 3;

/**
 * HOW MANY DIFFICULTIES THE CAMPAIGN HAS, and why this is one number.
 *
 * Normal asks for one point from the dealt position. Hard asks for two —
 * the second played from wherever the balls stopped — and extreme for
 * three. So the level index IS the mode: a run needs `level + 1` points,
 * which is the only place that arithmetic is written down.
 *
 * v2 stored hard as its own three fields beside the normal three
 * (`hardCleared`, `hardBestTurns`, `hardStars`) and a `lastHard` boolean.
 * A third difficulty would have meant a third copy of all of it, and a
 * fourth a fourth — every function here growing another branch. So the
 * three records became an ARRAY indexed by level, `lastHard` became
 * `lastLevel`, and adding a fourth difficulty is now this constant plus
 * the stages to prove it.
 */
export const DIFFICULTIES = 3;

// Structural whitelist of theme ids. Deliberately duplicated here rather
// than imported from game/themes.js: this module owns its own persisted
// shape and must not depend on game logic. It answers only "is this a
// REAL theme id," never "has the player earned it" — that second
// question belongs to game/themes.js, and keeping the two apart is what
// makes a tampered save fail safe instead of unlocking Neon.
// Duplicated from game/themes.js for the same reason as every other
// whitelist in this file: storage owns its persisted shape and must not
// import game logic. test/storage.test.js asserts the two agree.
const THEME_IDS = ["simonis", "tournament", "cafe", "slate", "studio"];
const DEFAULT_THEME_ID = "simonis";

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
// The target scores a run can be played to. A real hall calls this the
// 수지 — the number of points a player has to reach — and it is per-player
// handicap there rather than a global setting. Here it is the length of a
// run, and 10 is the default because a 10-point run is three or four
// minutes, which is one sitting.
const TARGET_SCORES = [5, 10, 15, 20, 30];

// The obstacle briefings the game can show, structurally whitelisted for
// the same reason as THEME_IDS and MAX_STAGE_ID above: this module owns
// its persisted shape and must not import game logic. It answers only "is
// this a REAL briefing id," so a tampered save can put nothing into the
// seen list except ids the game already knows how to draw.
// test/storage.test.js asserts this list matches game/briefings.js's
// BRIEFING_IDS, which is the whole price of keeping them apart.
const BRIEFING_IDS = [
  // "first-shot" is the one-sentence card on the very first entry into
  // play. It lives here rather than in a module-level flag because a
  // module-level flag dies with the page: a player who came back for
  // stage 8 was being told again that the table has no pockets.
  "first-shot",
  // "preview-power" is the note that appears under the Preview button the
  // first time it is switched on: that a TAP on the power bar parks a
  // speed, which is what lets the route be drawn while the cue is still
  // being turned. It is here for the same reason as first-shot — a
  // module-level flag would tell a returning player again.
  "preview-power",
  "wall", "peg", "hole", "bumper", "portal", "sand", "ice", "aim-line",
];

// The AI levels practice offers. Duplicated from game/ai.js's DIFFICULTY
// keys for the same reason as everything else in this file's whitelists:
// storage owns its persisted shape and must not import game logic.
// test/storage.test.js asserts the two agree.
const AI_LEVELS = ["easy", "medium", "hard"];
const DEFAULT_AI_LEVEL = "medium";
const DEFAULT_TARGET_SCORE = 10;

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

/** One difficulty's record. Three of these live in `campaign.levels`. */
function defaultLevelState() {
  return {
    /** stage ids ever cleared AT THIS DIFFICULTY. A SET semantically;
     * stored as a sorted array because JSON has no set, and kept
     * monotonic (nothing ever removes from it) so a theme unlock can
     * never regress. */
    cleared: [],
    /** stageId -> fewest turns it has been cleared in. */
    bestTurns: {},
    /** stageId -> best star rating ever earned there, 1..3. The reason to
     * replay a stage you already beat: turns measure how fast you were,
     * stars measure how cleanly. */
    stars: {},
  };
}

function defaultCampaignState() {
  return {
    /** Indexed by difficulty: 0 normal, 1 hard, 2 extreme. Each level's
     * cleared list is a SUBSET of the one below it — hard opens on a
     * stage beaten normally, extreme on one beaten on hard — and
     * sanitizeCampaign() enforces that chain rather than trusting it. */
    levels: Array.from({ length: DIFFICULTIES }, defaultLevelState),
    /** where the player was, so "Continue" is honest */
    lastStageId: 1,
    /** and in which difficulty. A player deep in hard being dropped back
     * into normal is the kind of small forgetfulness that reads as the
     * game losing their place. */
    lastLevel: 0,
  };
}

function defaultState() {
  return {
    version: SCHEMA_VERSION,
    sound: { enabled: true },
    campaign: defaultCampaignState(),
    // Best TIMES, in milliseconds, keyed by target score. A run is a
    // record attempt and the record is what brings anyone back to it.
    records: { practice: {} },
    match: { target: DEFAULT_TARGET_SCORE, level: DEFAULT_AI_LEVEL },
    theme: { selected: DEFAULT_THEME_ID },

    briefings: { seen: [] },
    previews: { held: 0 },
  };
}

function isStageId(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_STAGE_ID;
}

/**
 * One difficulty's record, defended field by field.
 *
 * `allowed` is the level below's cleared list — the subset invariant.
 * Hard only opens once the stage has been cleared normally, so a save
 * claiming a hard clear on a stage that was never cleared is corrupt,
 * not just unusual, and dropping it keeps the level below the single
 * source of truth for what has been beaten.
 */
function sanitizeLevel(entry, allowed) {
  const cleared = Array.isArray(entry?.cleared)
    ? [...new Set(entry.cleared.filter((id) => isStageId(id) && (allowed === null || allowed.includes(id))))]
      .sort((a, b) => a - b)
    : [];
  const bestTurns = {};
  const stars = {};
  for (const [source, target, check] of [
    // A best-turns entry for a stage that was never cleared is
    // meaningless, so it is dropped rather than kept — that keeps
    // `cleared` the single source of truth for progress and makes the
    // two fields impossible to disagree.
    [entry?.bestTurns, bestTurns, (v) => Number.isInteger(v) && v > 0],
    // Same rule, plus a hard 1..3 range: a star count is shown as a row
    // of icons, and a tampered 99 would render 99 of them across the tile.
    [entry?.stars, stars, (v) => Number.isInteger(v) && v >= 1 && v <= 3],
  ]) {
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      const id = Number(key);
      if (isStageId(id) && cleared.includes(id) && check(value)) target[id] = value;
    }
  }
  return { cleared, bestTurns, stars };
}

function sanitizeCampaign(entry) {
  // Down the chain, each level filtered against the one below it, so a
  // save cannot claim extreme on a stage it never beat on hard even if
  // it claims the hard clear too — that hard clear is dropped first, and
  // the extreme one is then dropped against the smaller list.
  const levels = [];
  for (let n = 0; n < DIFFICULTIES; n++) {
    levels.push(sanitizeLevel(entry?.levels?.[n], n === 0 ? null : levels[n - 1].cleared));
  }
  const lastStageId = isStageId(entry?.lastStageId) ? entry.lastStageId : 1;
  // Only claimed when that difficulty has actually been reached; a save
  // that resumed into a locked one would be a dead Continue button.
  const lastLevel =
    Number.isInteger(entry?.lastLevel) &&
    entry.lastLevel > 0 &&
    entry.lastLevel < DIFFICULTIES &&
    levels[entry.lastLevel - 1].cleared.length > 0
      ? entry.lastLevel
      : 0;
  return { levels, lastStageId, lastLevel };
}

// Every field is defended independently rather than the whole blob being
// discarded over one bad value: a corrupted bestTurns entry must not cost
// the player their cleared list, and a garbage sound flag must not touch
// either.
/** Times keyed by target score. A record is a number of milliseconds, so
 *  anything that is not a positive finite number is not a record. */
function sanitizeRecords(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const target of TARGET_SCORES) {
    const v = raw[target];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[target] = Math.round(v);
  }
  return out;
}

function sanitize(parsed) {
  return {
    version: SCHEMA_VERSION,
    sound: { enabled: typeof parsed.sound?.enabled === "boolean" ? parsed.sound.enabled : true },
    campaign: sanitizeCampaign(parsed.campaign),
    records: {
      practice: sanitizeRecords(parsed.records?.practice),
    },
    match: {
      target: TARGET_SCORES.includes(parsed.match?.target)
        ? parsed.match.target
        : DEFAULT_TARGET_SCORE,
      level: AI_LEVELS.includes(parsed.match?.level) ? parsed.match.level : DEFAULT_AI_LEVEL,
    },
    theme: { selected: THEME_IDS.includes(parsed.theme?.selected) ? parsed.theme.selected : DEFAULT_THEME_ID },
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
 * v2 -> v3: one difficulty beside another became a list of difficulties.
 *
 * v2 held hard mode in three fields parallel to the normal three, plus a
 * `lastHard` boolean. Extreme would have made it nine fields and a
 * tri-state, so the records moved into `campaign.levels[]` indexed by
 * difficulty. Nothing is thrown away and nothing is renumbered: every
 * v2 field lands in the level it always meant, and a player who had
 * cleared forty stages on normal and six on hard still has exactly that.
 *
 * Extreme starts empty for everyone, which is correct — it did not exist
 * to be played.
 */
function toV3(save) {
  const campaign = save.campaign;
  if (!campaign || typeof campaign !== "object") return save;
  const level = (cleared, bestTurns, stars) => ({
    cleared: Array.isArray(cleared) ? cleared : [],
    bestTurns: bestTurns && typeof bestTurns === "object" ? bestTurns : {},
    stars: stars && typeof stars === "object" ? stars : {},
  });
  return {
    ...save,
    campaign: {
      levels: [
        level(campaign.cleared, campaign.bestTurns, campaign.stars),
        level(campaign.hardCleared, campaign.hardBestTurns, campaign.hardStars),
        level([], {}, {}),
      ],
      lastStageId: campaign.lastStageId,
      lastLevel: campaign.lastHard === true ? 1 : 0,
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
  if (current.version === 2) current = { ...toV3(current), version: 3 };
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
 * One-time reconciliation. The SDK wins if it has anything usable (a
 * returning player, possibly with progress synced from another device);
 * this device's localStorage is then overwritten so it never goes stale.
 * If the SDK has nothing yet, this device's existing progress is pushed
 * up once so it is not invisible to cloud sync going forward.
 */
function reconcileWithSdk() {
  const fromSdk = parseAndNormalize(sdkGetItem(STORAGE_KEY));
  if (fromSdk) {
    state = fromSdk;
    safeSetItem(STORAGE_KEY, JSON.stringify(state));
    return;
  }
  sdkSetItem(STORAGE_KEY, JSON.stringify(state));
}

function save() {
  const json = JSON.stringify(state);
  safeSetItem(STORAGE_KEY, json); // unconditional: the durable fallback and always-current cache
  if (sdkAvailable) sdkSetItem(STORAGE_KEY, json); // best-effort cloud copy
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

/** @param {number} [level] 0 normal, 1 hard, 2 extreme */
export function isStageCleared(id, level = 0) {
  return track(level).cleared.includes(id);
}

/** The record for one difficulty. Out-of-range levels answer with an
 * empty record rather than throwing: every caller of these getters is a
 * painter, and a screen that renders nothing beats a screen that dies. */
function track(level) {
  return state.campaign.levels[level] ?? defaultLevelState();
}

/**
 * Records a clear. Both `turns` and `stars` are kept only when they beat
 * what is already stored, so replaying a stage badly can never make a
 * player's record worse — a rule that has to live here rather than at
 * the call site, because the call site is the place most likely to
 * forget it.
 */
export function recordStageCleared(id, turns, stars, level = 0) {
  if (!isStageId(id)) return;
  if (!Number.isInteger(level) || level < 0 || level >= DIFFICULTIES) return;
  // Refused on a stage that has never been beaten at the difficulty
  // below, because that is the rule the whole schema leans on: each
  // level's cleared list is a subset of the one under it, and sanitize()
  // drops anything that breaks it. A caller that got here without the
  // unlock is a bug, and silently writing a record that sanitize would
  // throw away on the next load is worse than not writing one.
  if (level > 0 && !state.campaign.levels[level - 1].cleared.includes(id)) return;
  const { cleared, bestTurns, stars: starsMap } = state.campaign.levels[level];

  if (!cleared.includes(id)) {
    cleared.push(id);
    cleared.sort((a, b) => a - b);
  }
  if (Number.isInteger(turns) && turns > 0) {
    const previous = bestTurns[id];
    if (!previous || turns < previous) bestTurns[id] = turns;
  }
  if (Number.isInteger(stars) && stars >= 1 && stars <= 3) {
    const previous = starsMap[id] ?? 0;
    if (stars > previous) starsMap[id] = stars;
  }
  save();
}

/** @returns {0|1|2|3} 0 for a stage never cleared at that difficulty */
export function getStars(id, level = 0) {
  return track(level).stars[id] ?? 0;
}

/** @returns {number|0} fewest turns, 0 for a stage never cleared there */
export function getBestTurns(id, level = 0) {
  return track(level).bestTurns[id] ?? 0;
}

/**
 * A difficulty opens on a stage the moment the one below it has been
 * beaten there: normal by the previous stage, hard by this stage on
 * normal, extreme by this stage on hard.
 *
 * Derived rather than stored, for the same reason isStageUnlocked() is:
 * a stored list is a second source of truth that can disagree with the
 * first one.
 */
export function isLevelUnlocked(id, level = 0) {
  if (!isStageId(id)) return false;
  if (!Number.isInteger(level) || level < 0 || level >= DIFFICULTIES) return false;
  return level === 0 ? isStageUnlocked(id) : isStageCleared(id, level - 1);
}

/**
 * ALL DIFFICULTIES COUNT TOWARD ONE TOTAL, and the thresholds in
 * game/themes.js were left where they are.
 *
 * The alternative was raising them in proportion, which would have taken
 * a theme away from a player who had already unlocked it — the one
 * outcome a progression change must never produce. So the ceiling grows
 * and the harder difficulties become a second and third route to the
 * same rewards, which is also what makes replaying a cleared stage worth
 * something beyond the star itself.
 */
export function getTotalStars() {
  let total = 0;
  for (const level of state.campaign.levels) {
    for (const n of Object.values(level.stars)) total += n;
  }
  return total;
}

/** Every star the campaign can award — what the totals are shown out of.
 * Three difficulties, three stars each. */
export const MAX_STARS = MAX_STAGE_ID * 3 * DIFFICULTIES;

/**
 * Stage 1 is always open; every other stage opens when the one before it
 * has been cleared. Written as a derivation rather than a stored
 * "unlocked" list on purpose — a stored list is a second source of truth
 * that can disagree with `cleared`, and this is the exact bug class the
 * sanitize step above already drops bestTurns entries to avoid.
 *
 * Normal only. The harder difficulties do not have their own ladder:
 * they open per stage, off the difficulty below (isLevelUnlocked).
 */
export function isStageUnlocked(id) {
  if (!isStageId(id)) return false;
  return id === 1 || isStageCleared(id - 1, 0);
}

/**
 * Where "Continue" should drop the player: the next thing they have left
 * to beat, not merely the last stage they touched.
 *
 * Three tracks run in parallel and each has its own frontier — normal
 * opens by the previous stage, hard and extreme open by the SAME stage
 * at the difficulty below — so "next" is a choice between three
 * candidates rather than one number. The rules, in order:
 *
 *   - The difficulty they were last playing still has something left: go
 *     there. Someone working through hard while normal still has stages
 *     open chose that, and Continue should not undo the choice.
 *   - Otherwise the easiest difficulty that has anything left. A player
 *     who has finished all hundred normally is not "done"; hard 1 is
 *     what they have left, and offering them a replay of normal 100
 *     reads as the game having nothing more for them.
 *   - Nothing left anywhere: replay the finale, in the difficulty they
 *     last played.
 *
 * @returns {{id:number, level:number}}
 */
export function getContinuePoint() {
  const frontier = [];
  for (let level = 0; level < DIFFICULTIES; level++) {
    let next = null;
    for (let id = 1; id <= MAX_STAGE_ID && next === null; id++) {
      if (isLevelUnlocked(id, level) && !isStageCleared(id, level)) next = id;
    }
    frontier[level] = next;
  }
  const last = state.campaign.lastLevel;
  if (frontier[last] !== null) return { id: frontier[last], level: last };
  for (let level = 0; level < DIFFICULTIES; level++) {
    if (frontier[level] !== null) return { id: frontier[level], level };
  }
  return { id: MAX_STAGE_ID, level: last };
}

/** The stage id half of getContinuePoint(), for callers that only label. */
export function getContinueStageId() {
  return getContinuePoint().id;
}

export function setLastStage(id, level = 0) {
  if (!isStageId(id)) return;
  state.campaign.lastStageId = id;
  // Only claimed when that difficulty really is open on that stage; a
  // save that resumed into a locked one would be a dead Continue button.
  state.campaign.lastLevel = isLevelUnlocked(id, level) ? level : 0;
  save();
}

// --- obstacle briefings --------------------------------------------------

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
 * so no call site has to remember which stored facts feed unlock rules.
 *
 * `stagesCleared` is NORMAL clears only, which is what the thresholds in
 * game/themes.js were written against — a theme that asks for twenty
 * stages must not be handed to someone who has beaten seven of them three
 * ways. Stars are the opposite and deliberately so: getTotalStars() adds
 * up all three difficulties, which is what makes replaying a cleared
 * stage on hard worth something.
 *
 * This line read `state.campaign.cleared` until the save grew a third
 * difficulty and the field moved into levels[]. Nothing in the suite
 * called it, so the tables screen threw on open — in a build that
 * shipped. test/campaign.test.js now calls every getter this module
 * exports for exactly that reason. */
export function themeUnlockContext() {
  return { stagesCleared: track(0).cleared.length, totalStars: getTotalStars() };
}

export { MAX_STAGE_ID, THEME_IDS, TARGET_SCORES, DEFAULT_TARGET_SCORE, BRIEFING_IDS, AI_LEVELS };

/** The target score and opponent level a run will be played to. Held
 *  together because they are set together, on the same card. */
export function getMatchSetup() {
  return { ...state.match };
}

export function setMatchSetup({ target, level }) {
  if (TARGET_SCORES.includes(target)) state.match.target = target;
  if (AI_LEVELS.includes(level)) state.match.level = level;
  save();
  return { ...state.match };
}

/** Best time for a practice run to `target`, in ms, or null. */
export function getPracticeRecord(target) {
  const v = state.records.practice[target];
  return typeof v === "number" ? v : null;
}

/** Keeps only what beats the record. Returns true if this run set one. */
export function recordPracticeTime(target, ms) {
  if (!TARGET_SCORES.includes(target)) return false;
  if (!Number.isFinite(ms) || ms <= 0) return false;
  const best = state.records.practice[target];
  if (typeof best === "number" && best <= ms) return false;
  state.records.practice[target] = Math.round(ms);
  save();
  return true;
}
