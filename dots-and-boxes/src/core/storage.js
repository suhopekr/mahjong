// core/storage.js
// Single-key, versioned persistence for player progress — sound
// preference, per-difficulty AI win streaks, achievement unlocks (schema
// version 2, milestone 13-2), the Daily Challenge's own facts (schema
// version 3, milestone 13-3: last date played, that day's result, its
// own separate win streak), and (as of schema version 4, milestone 13-4)
// which board skins are unlocked + which one is selected.
// Deliberately ONE storage key holding ONE JSON blob, not one key per
// field — scattered keys are what make a future migration a nightmare.
//
// Backing store, in priority order (milestone 15 — CrazyGames requires
// SOME progress-save integration "unless progress is not applicable,"
// per docs.crazygames.com/requirements/account-integration, and this
// game's progress clearly qualifies): the CrazyGames SDK's Data module
// (`SDK.data.*` — confirmed against the real live script, not just
// docs, to be a synchronous drop-in replacement for localStorage, same
// method names, same string-in/string-out shapes) when the SDK is
// present and usable, falling back to plain browser `localStorage`
// otherwise, falling back to in-memory-only if THAT also fails (Safari
// private browsing throws on setItem, some browsers disable storage
// entirely, quota can be exceeded). None of that may ever throw out of
// this module or leave the game in a broken state — on any failure this
// module just keeps running off its in-memory copy of `state`: reads and
// writes within the session still work exactly as normal, they just
// don't survive a reload. This split is entirely internal — every
// exported function below has the exact same synchronous signature it
// always did; nothing outside this file needs to know or care which
// backend(s) are actually active.
//
// The SDK path is asynchronous to even DETERMINE (SDK.init() must
// resolve before `environment` is trustworthy — see initSdkData() below,
// mirroring core/ads.js's own readyPromise gate), even though the
// individual data calls themselves are synchronous once that's settled.
// That's the one real wrinkle: the module-top-level `let state = load()`
// below MUST stay synchronous (main.js and every game module read from
// this at import time and beyond), so it always boots off localStorage
// first, exactly as before milestone 15. Once the SDK is confirmed
// ready, reconcileWithSdk() runs once and either adopts the SDK's own
// copy (a returning player, possibly with newer progress synced down
// from another device) or migrates this device's current localStorage
// state up into the SDK (first time this device has ever talked to the
// Data module). From then on, save() writes to localStorage
// unconditionally (kept as an always-current cache/fallback, never a
// stale first-session snapshot) and fire-and-forgets an additional write
// to the SDK whenever it's available.

const STORAGE_KEY = "dab-save";
const SCHEMA_VERSION = 4;

// Mirrors game/theme.js's THEMES ids — duplicated here rather than
// imported, same reasoning as DIFFICULTIES/GRID_SIZES below: this module
// owns its own persisted-shape validation independent of game logic.
// "paper" is always unlocked (the default skin) and is defended
// separately below (sanitizeSkins()) in case a tampered/corrupted blob
// dropped it from `unlocked`.
const SKIN_IDS = ["paper", "chalkboard", "neon", "blueprint"];

// "YYYY-MM-DD" — the same shape game/daily.js's utcDateString() produces.
// Duplicated here (not imported) for the same reason DIFFICULTIES/
// GRID_SIZES below aren't imported from anywhere: this module owns its
// own persisted-shape validation rather than reaching into game logic.
const DATE_STRING_RE = /^\d{4}-\d{2}-\d{2}$/;

// core/audio.js used to persist sound on/off under this key by itself,
// as a bare "0"/"1" string (not JSON, not versioned). Folded into the
// new blob once, then removed — see migrateLegacySound() below. Without
// this, everyone's sound preference would silently reset to "on" the
// first time this module shipped.
const LEGACY_SOUND_KEY = "dab-sound-enabled";

const DIFFICULTIES = ["easy", "medium", "hard"];

// Grid sizes this game offers (mirrors main.js's own GRID_SIZES — not
// imported from there on purpose, the same way DIFFICULTIES above isn't
// imported from anywhere: this module owns its own persisted-shape
// constants rather than reaching into UI code for them).
const GRID_SIZES = [3, 5, 7];

// --- SDK Data module bootstrap (milestone 15) ---------------------------
//
// A deliberately independent copy of core/ads.js's readyPromise pattern
// rather than an import from it — this module owns its own persistence
// concerns the same way it owns SKIN_IDS/DIFFICULTIES/GRID_SIZES above
// instead of importing them, and the two core modules stay decoupled.
// Calling SDK.init() from two separate modules is safe (confirmed against
// the real live SDK: concurrent AND sequential repeat calls all resolve
// cleanly, same `environment` both times) so there's no conflict with
// ads.js's own init() call.
//
// Resolves to true only once the SDK is confirmed present, initialized,
// AND actually has a `data` module (older/partial SDK builds might not).
// NEVER rejects. `environment === 'disabled'` (embedded on a non-
// CrazyGames, non-localhost domain) is treated identically to "no SDK at
// all" — every further SDK call throws in that environment.
const sdkReadyPromise = initSdkData();
let sdkAvailable = false;

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

// Confirmed synchronous against the real live SDK script (build served
// from sdk.crazygames.com as of this session) — setItem/getItem/
// removeItem all return plain values (getItem: string|null, the others:
// undefined), never a Promise, and a getItem() called immediately after
// setItem() (same tick, no await) already reflects the new value. Same
// "same API as localStorage" claim the docs make, verified rather than
// assumed (CLAUDE.md's milestone 10 precedent: docs and the real object
// have disagreed before — SDK.environment vs a documented-but-nonexistent
// getEnvironment(), caught only by loading the actual script).
function sdkGetItem(key) {
  try {
    return window.CrazyGames.SDK.data.getItem(key);
  } catch {
    return null; // best-effort — localStorage (written unconditionally either way) is the fallback
  }
}

function sdkSetItem(key, value) {
  try {
    window.CrazyGames.SDK.data.setItem(key, value);
  } catch {
    // best-effort, fire-and-forget — localStorage already has this same
    // write (save() below writes there unconditionally, never gated on
    // this succeeding), so a failure here costs nothing but the cloud sync.
  }
}

function defaultAchievementsState() {
  const hardWinsBySize = {};
  for (const size of GRID_SIZES) hardWinsBySize[size] = false;
  return { unlocked: [], hardWinsBySize, localGamesCompleted: 0 };
}

function defaultDailyState() {
  return { lastPlayedDate: null, lastResult: null, currentStreak: 0, bestStreak: 0 };
}

function defaultSkinsState() {
  return { selected: "paper", unlocked: ["paper"], hasHardWin: false };
}

function defaultState() {
  return {
    version: SCHEMA_VERSION,
    sound: { enabled: true },
    streaks: {
      easy: { current: 0, best: 0 },
      medium: { current: 0, best: 0 },
      hard: { current: 0, best: 0 },
    },
    achievements: defaultAchievementsState(),
    daily: defaultDailyState(),
    skins: defaultSkinsState(),
  };
}

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode, storage disabled, no `localStorage` global at all, ...
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota exceeded, private mode, storage disabled — the in-memory
    // `state` this module already updated is still correct for the rest
    // of the session; it just won't survive a reload. Nothing to do.
  }
}

function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup — if this fails the stale key just lingers,
    // harmlessly (nothing ever reads LEGACY_SOUND_KEY again either way).
  }
}

// One-time carry-over from the old standalone key, run only when we're
// about to hand back a fresh default state (see load() below) — an
// existing player's sound preference shouldn't reset to "on" just
// because the storage format changed under them.
function migrateLegacySound(state) {
  const legacy = safeGetItem(LEGACY_SOUND_KEY);
  if (legacy === "0" || legacy === "1") {
    state.sound.enabled = legacy === "1";
  }
  safeRemoveItem(LEGACY_SOUND_KEY);
  return state;
}

function sanitizeStreakEntry(entry) {
  const current = Number.isInteger(entry?.current) && entry.current >= 0 ? entry.current : 0;
  const rawBest = Number.isInteger(entry?.best) && entry.best >= 0 ? entry.best : 0;
  return { current, best: Math.max(rawBest, current) }; // invariant: best is never < current
}

function sanitizeAchievements(entry) {
  const unlocked = Array.isArray(entry?.unlocked)
    ? [...new Set(entry.unlocked.filter((id) => typeof id === "string"))] // string-typed, deduplicated
    : [];
  const hardWinsBySize = {};
  for (const size of GRID_SIZES) {
    hardWinsBySize[size] = typeof entry?.hardWinsBySize?.[size] === "boolean" ? entry.hardWinsBySize[size] : false;
  }
  const localGamesCompleted =
    Number.isInteger(entry?.localGamesCompleted) && entry.localGamesCompleted >= 0
      ? entry.localGamesCompleted
      : 0;
  return { unlocked, hardWinsBySize, localGamesCompleted };
}

/**
 * Unlike streak/achievement fields (defended independently — one bad
 * number doesn't cost you the rest), a daily result is a single cohesive
 * display record: "won" without a "playerScore" isn't safely showable
 * ("You won! Score: undefined – 3"). So this is all-or-nothing —
 * anything short of every field being present and well-typed discards
 * the WHOLE result back to null rather than trying to salvage pieces of it.
 */
function sanitizeDailyResult(entry) {
  if (!entry || typeof entry !== "object") return null;
  const date = typeof entry.date === "string" && DATE_STRING_RE.test(entry.date) ? entry.date : null;
  const won = typeof entry.won === "boolean" ? entry.won : null;
  const playerScore = Number.isInteger(entry.playerScore) && entry.playerScore >= 0 ? entry.playerScore : null;
  const aiScore = Number.isInteger(entry.aiScore) && entry.aiScore >= 0 ? entry.aiScore : null;
  if (date === null || won === null || playerScore === null || aiScore === null) return null;
  return { date, won, playerScore, aiScore };
}

function sanitizeDaily(entry) {
  const lastPlayedDate =
    typeof entry?.lastPlayedDate === "string" && DATE_STRING_RE.test(entry.lastPlayedDate)
      ? entry.lastPlayedDate
      : null;
  const current = Number.isInteger(entry?.currentStreak) && entry.currentStreak >= 0 ? entry.currentStreak : 0;
  const rawBest = Number.isInteger(entry?.bestStreak) && entry.bestStreak >= 0 ? entry.bestStreak : 0;
  return {
    lastPlayedDate,
    lastResult: sanitizeDailyResult(entry?.lastResult),
    currentStreak: current,
    bestStreak: Math.max(rawBest, current), // same invariant as the vs-AI streaks above
  };
}

/**
 * `unlocked` is filtered to known skin ids only (an unrecognized id is
 * dropped silently, not preserved as some kind of forward-compat
 * placeholder — this game has exactly 4 skins, full stop) and "paper" is
 * force-included even if a tampered/corrupted blob dropped it, since
 * Paper must always be selectable. `selected` is the actual enforcement
 * point of "잠긴 스킨을 강제로 선택 시도해도 적용되지 않는다": it's only
 * honored if it's ALSO present in the (already-sanitized) `unlocked`
 * list computed on the line above it — a hand-edited blob claiming
 * `selected: "neon"` without "neon" in `unlocked` falls back to "paper"
 * right here, before this value is ever handed to anything that would
 * render it.
 */
function sanitizeSkins(entry) {
  const rawUnlocked = Array.isArray(entry?.unlocked)
    ? entry.unlocked.filter((id) => SKIN_IDS.includes(id))
    : [];
  const unlocked = [...new Set(["paper", ...rawUnlocked])];
  const selected = typeof entry?.selected === "string" && unlocked.includes(entry.selected) ? entry.selected : "paper";
  const hasHardWin = typeof entry?.hasHardWin === "boolean" ? entry.hasHardWin : false;
  return { selected, unlocked, hasHardWin };
}

// Defends every field independently instead of discarding the whole
// blob over one bad value — a corrupted streaks.hard.best shouldn't
// cost the player their Easy/Medium progress too, and a garbage
// sound.enabled shouldn't touch streaks, achievements, daily, OR skins.
function sanitize(parsed) {
  const fresh = defaultState();
  const streaks = {};
  for (const d of DIFFICULTIES) streaks[d] = sanitizeStreakEntry(parsed.streaks?.[d]);
  return {
    version: SCHEMA_VERSION,
    sound: { enabled: typeof parsed.sound?.enabled === "boolean" ? parsed.sound.enabled : fresh.sound.enabled },
    streaks,
    achievements: sanitizeAchievements(parsed.achievements),
    daily: sanitizeDaily(parsed.daily),
    skins: sanitizeSkins(parsed.skins),
  };
}

/**
 * Version mismatches go through here before load() falls back to
 * defaults. Three steps chained so far: v1 -> v2 (milestone 13-2 added
 * `achievements`), v2 -> v3 (milestone 13-3 added `daily`), v3 -> v4
 * (milestone 13-4 added `skins`). No step needs to synthesize its own
 * new field — sanitize() already treats a missing/malformed field as
 * "use defaults" for ANY field, so a step only needs to signal "yes,
 * this is upgradeable" by bumping the version tag; sanitize() does the
 * real field-by-field work either way. A v4 -> v5 step would chain on
 * the same way: `if (current.version === 4) current = { ...current, version: 5 };`
 * @returns {object | null} an object at SCHEMA_VERSION, or null if this
 *   version has no known migration path (falls back to full defaults)
 */
function migrate(parsed) {
  let current = parsed;
  if (current.version === 1) current = { ...current, version: 2 };
  if (current.version === 2) current = { ...current, version: 3 };
  if (current.version === 3) current = { ...current, version: 4 };
  return current.version === SCHEMA_VERSION ? current : null;
}

/**
 * Shared by load() (localStorage) and reconcileWithSdk() (the SDK Data
 * module) — same parse -> version-check -> migrate -> sanitize dance
 * regardless of which backend the raw string came from, so a corrupted
 * blob is handled identically either way (falls through to null, never
 * partially-applied).
 * @param {string | null} raw
 * @returns {object | null} a fully sanitized state at SCHEMA_VERSION, or
 *   null if `raw` was missing, malformed, or an unmigratable version
 */
function parseAndNormalize(raw) {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version === SCHEMA_VERSION) return sanitize(parsed);
    const migrated = migrate(parsed);
    return migrated ? sanitize(migrated) : null;
  } catch {
    return null; // malformed JSON
  }
}

function load() {
  const normalized = parseAndNormalize(safeGetItem(STORAGE_KEY));
  if (normalized) return normalized;
  // Every fallback-to-defaults path (missing key, corrupted JSON, an
  // unmigratable version) lands here. Persisting it immediately matters
  // most for the legacy-sound-migration case: migrateLegacySound()
  // already deleted the old key, so if this fresh state only lived in
  // memory and the player closed the tab without ever calling a setter,
  // the NEXT load would find neither the old key (deleted) nor a new one
  // (never written) and silently lose the migrated preference. Writing
  // it now — not just on the next setSoundEnabled()/recordStreakResult()
  // — also means corrupted data gets healed on the spot rather than
  // staying broken indefinitely.
  const fresh = migrateLegacySound(defaultState());
  safeSetItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

// Always boots synchronously off localStorage (see the module-top comment
// for why this can't wait on the SDK) — reconcileWithSdk() below may
// replace this shortly after, once the SDK's own readiness is known.
let state = load();

// Runs exactly once, whenever the SDK first becomes available (never, if
// it isn't). By the time this microtask fires, every synchronous
// module-load-time mutation (e.g. main.js's startup skin-unlock backfill)
// has already happened — JS guarantees the current synchronous call stack
// finishes before any promise callback runs — so this never races that.
// A real but narrow gap remains: a genuine USER action (e.g. toggling
// sound) in the brief window before the SDK's own init() resolves could
// still be overwritten if the SDK turns out to already hold different
// data for this player. Accepted as a one-time, best-effort reconciliation
// rather than building real conflict resolution for it — the same kind of
// tradeoff this file already makes elsewhere (e.g. undo not rewinding
// deficitTracker/handoffTracker in game logic, or achievements.js's
// isDeliberateHandoff() heuristic).
sdkReadyPromise.then((ready) => {
  sdkAvailable = ready;
  if (ready) reconcileWithSdk();
});

/**
 * One-time reconciliation between localStorage's already-loaded `state`
 * and whatever the SDK Data module has for this key. The SDK wins if it
 * has anything usable (a returning player, possibly with progress synced
 * down from another device via CrazyGames' own cloud sync) — this
 * device's localStorage cache is then overwritten to match, so it never
 * goes stale relative to the now-authoritative SDK copy. If the SDK has
 * nothing yet (first time this device/session has ever talked to the
 * Data module), this device's current state — already loaded from
 * localStorage above, which may be a real existing player's progress —
 * is pushed up into the SDK once, so it isn't silently invisible to
 * cloud sync going forward.
 */
function reconcileWithSdk() {
  const fromSdk = parseAndNormalize(sdkGetItem(STORAGE_KEY));
  if (fromSdk) {
    state = fromSdk;
    safeSetItem(STORAGE_KEY, JSON.stringify(state)); // keep the local cache in sync with the now-authoritative SDK copy
    return;
  }
  sdkSetItem(STORAGE_KEY, JSON.stringify(state)); // migrate this device's existing progress up, once
}

function save() {
  const json = JSON.stringify(state);
  // Unconditional, synchronous, durable — the fallback AND the always-
  // current cache reconcileWithSdk() re-syncs from on a future session
  // where the SDK isn't available yet (or at all).
  safeSetItem(STORAGE_KEY, json);
  // Fire-and-forget, best-effort — never awaited (every exported setter
  // below stays synchronous, unchanged public API), never required to
  // succeed. A failure here costs nothing: localStorage above already
  // has the same write.
  if (sdkAvailable) sdkSetItem(STORAGE_KEY, json);
}

/**
 * Re-reads state from localStorage right now, discarding any in-memory
 * value. The module already does this once naturally at import time;
 * this just makes that step callable on demand — primarily for tests
 * (seed a mock localStorage, call this, then assert), since ES modules
 * are otherwise singletons and only ever load() once per process.
 */
export function reloadFromStorage() {
  state = load();
}

// --- sound preference ----------------------------------------------

export function isSoundEnabled() {
  return state.sound.enabled;
}

export function setSoundEnabled(value) {
  state.sound.enabled = !!value;
  save();
}

// --- per-difficulty AI win streaks -----------------------------------

/**
 * @param {'easy'|'medium'|'hard'} difficulty
 * @returns {{current: number, best: number}}
 */
export function getStreak(difficulty) {
  const s = state.streaks[difficulty];
  return s ? { current: s.current, best: s.best } : { current: 0, best: 0 };
}

/**
 * Records one vs-AI game's outcome for `difficulty`'s streak. `won`
 * covers exactly the human-won case; everything else (a loss OR a draw)
 * resets the streak to 0 — the caller is the one place that knows
 * whether a game happened at all, which mode it was, and who won, so
 * it's the caller's job to only call this for vs-AI games and never for
 * one abandoned mid-game (New Game).
 * @param {'easy'|'medium'|'hard'} difficulty
 * @param {boolean} won
 * @returns {{current: number, best: number, isNewBest: boolean}}
 */
export function recordStreakResult(difficulty, won) {
  const s = state.streaks[difficulty];
  if (!s) return { current: 0, best: 0, isNewBest: false }; // unknown difficulty — no-op, nothing to record
  let isNewBest = false;
  if (won) {
    s.current += 1;
    if (s.current > s.best) {
      s.best = s.current;
      isNewBest = true;
    }
  } else {
    s.current = 0;
  }
  save();
  return { current: s.current, best: s.best, isNewBest };
}

// --- achievements (milestone 13-2) -------------------------------------
//
// This module only ever stores FACTS (which ids are unlocked, which grid
// sizes Hard has been beaten on, how many local games have finished) — it
// has no idea what a "Chain Reaction" or a "Grid Master" is. Deciding
// which facts unlock which achievement is game/achievements.js's job
// entirely; this file just remembers whatever that module concludes.

export function getUnlockedAchievements() {
  return state.achievements.unlocked.slice();
}

/**
 * Marks `id` unlocked and persists. Idempotent: unlocking an id that's
 * already present is a no-op (returns false, no duplicate entry, no
 * extra save). In practice callers (game/achievements.js's evaluate*()
 * functions) already filter out already-unlocked ids before ever getting
 * here, so this check rarely fires — but it means this function is still
 * safe to call blindly.
 * @param {string} id
 * @returns {boolean} true iff this call newly unlocked it
 */
export function unlockAchievement(id) {
  if (state.achievements.unlocked.includes(id)) return false;
  state.achievements.unlocked.push(id);
  save();
  return true;
}

/** @returns {Record<number, boolean>} a copy — mutate the return value all you like */
export function getHardWinsBySize() {
  return { ...state.achievements.hardWinsBySize };
}

/**
 * Records a Hard-difficulty vs-AI win on `gridSize`. Unknown sizes are
 * ignored (defensive — this game only ever offers 3/5/7, but a caller
 * passing something else shouldn't silently grow the object). Returns
 * the updated per-size record so the caller (Grid Master's "every size
 * now true?" check) doesn't need a second read.
 * @param {number} gridSize
 * @returns {Record<number, boolean>}
 */
export function recordHardWin(gridSize) {
  if (Object.prototype.hasOwnProperty.call(state.achievements.hardWinsBySize, gridSize)) {
    state.achievements.hardWinsBySize[gridSize] = true;
    save();
  }
  return { ...state.achievements.hardWinsBySize };
}

export function getLocalGamesCompleted() {
  return state.achievements.localGamesCompleted;
}

/** @returns {number} the updated total */
export function incrementLocalGamesCompleted() {
  state.achievements.localGamesCompleted += 1;
  save();
  return state.achievements.localGamesCompleted;
}

// --- daily challenge (milestone 13-3) -----------------------------------
//
// Same split as achievements above: this module only remembers WHAT
// happened (which date, won or not, the score, the streak number) — it
// has no idea what "consecutive" means or what today's date is. Deciding
// the new streak number is game/daily.js's nextDailyStreak(); the caller
// (main.js) computes it and hands the finished number to
// recordDailyResult() below.

/**
 * @returns {{lastPlayedDate: string|null, lastResult: object|null, currentStreak: number, bestStreak: number}}
 */
export function getDailyState() {
  return {
    lastPlayedDate: state.daily.lastPlayedDate,
    lastResult: state.daily.lastResult ? { ...state.daily.lastResult } : null,
    currentStreak: state.daily.currentStreak,
    bestStreak: state.daily.bestStreak,
  };
}

/**
 * Records the outcome of the daily challenge dated `dateString` (the
 * date the CHALLENGE was generated for, not necessarily "today" by wall
 * clock — a game started just before UTC midnight and finished just
 * after still belongs to the day it was generated for). `newStreak` is
 * computed by the caller via game/daily.js's nextDailyStreak() — this
 * function only persists it and keeps bestStreak in sync.
 * @param {{dateString: string, won: boolean, playerScore: number, aiScore: number, newStreak: number}} args
 * @returns {ReturnType<typeof getDailyState>}
 */
export function recordDailyResult({ dateString, won, playerScore, aiScore, newStreak }) {
  state.daily.lastPlayedDate = dateString;
  state.daily.lastResult = { date: dateString, won, playerScore, aiScore };
  state.daily.currentStreak = newStreak;
  if (newStreak > state.daily.bestStreak) state.daily.bestStreak = newStreak;
  save();
  return getDailyState();
}

// --- board skins (milestone 13-4) ---------------------------------------
//
// Same split as everywhere else in this file: this module only remembers
// WHICH skin is selected, WHICH ones have already been unlocked (so a
// toast never fires twice for the same skin), and the one extra raw fact
// (hasHardWin) game/theme.js's Neon skin needs that nothing else already
// tracks. It has no idea what "Chalkboard" or "3 achievements" means —
// game/theme.js's isThemeUnlocked()/evaluateNewlyUnlockedThemes() decide
// that from these facts plus achievements/daily state read elsewhere.

/**
 * @returns {{selected: string, unlocked: string[], hasHardWin: boolean}}
 */
export function getSkinsState() {
  return { selected: state.skins.selected, unlocked: state.skins.unlocked.slice(), hasHardWin: state.skins.hasHardWin };
}

/**
 * Selects `id` as the active skin — but ONLY if it's already unlocked.
 * This is the actual enforcement point for "a locked skin can never be
 * applied, no matter how the selection was attempted": every caller
 * (main.js's skin picker UI, and defensively anything else) goes through
 * this function rather than writing `state.skins.selected` directly, so
 * there is exactly one place a locked id could sneak through, and it
 * refuses right here.
 * @param {string} id
 * @returns {boolean} true iff the selection was actually applied
 */
export function setSelectedSkin(id) {
  if (!state.skins.unlocked.includes(id)) return false;
  state.skins.selected = id;
  save();
  return true;
}

/**
 * Marks `id` unlocked (idempotent — already-unlocked or unrecognized ids
 * are a no-op, same shape as unlockAchievement()).
 * @param {string} id
 * @returns {boolean} true iff this call newly unlocked it
 */
export function unlockSkin(id) {
  if (!SKIN_IDS.includes(id) || state.skins.unlocked.includes(id)) return false;
  state.skins.unlocked.push(id);
  save();
  return true;
}

/**
 * Records that the player has won at least one game on Hard difficulty
 * (in ANY mode that has an AI opponent — vs AI or Daily Challenge; see
 * main.js's hasAiOpponent() — deliberately broader than
 * achievements.js's per-grid-size hardWinsBySize, which stays vs-AI-only
 * for Grid Master's own reasons). Idempotent — permanently true once set.
 * @returns {boolean} true iff this call newly set it
 */
export function recordHardWinForSkins() {
  if (state.skins.hasHardWin) return false;
  state.skins.hasHardWin = true;
  save();
  return true;
}
