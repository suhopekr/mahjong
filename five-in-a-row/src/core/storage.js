// core/storage.js
// localStorage-only persistence for Five in a Row.
//
// --- what changed from the Gomoku original -----------------------------
//
// The source module was 699 lines implementing a three-tier fallback:
// localStorage, plus the game-portal cloud-data module layered on top of
// it (an async readiness promise, a one-time reconcile-on-boot, a
// fire-and-forget mirror write on every save, plus a test-only hook to
// drive that path deterministically from Node). This site embeds no
// portal integration at all, so that entire layer is gone — there is
// exactly one backend here, and every setter is plainly synchronous.
//
// The other change is the key layout. Gomoku stored one JSON blob under
// `gomoku-save`. This follows the convention the rest of this site
// already uses (game.js's own key table) instead: one key per concern,
// namespaced and versioned.
//
//   fiveInARow.v1.save          in-progress game snapshot
//   fiveInARow.v1.settings      sound / renju / theme / board size / mode / difficulty
//   fiveInARow.v1.stats         win streaks + Hard-win records + local game count
//   fiveInARow.v1.achievements  which achievement ids are unlocked
//
// Splitting them is not cosmetic: a corrupted settings blob can no longer
// cost the player their achievements, because they aren't the same
// string any more. Each key parses, migrates and sanitizes independently
// (see readKey()), and a key that comes back missing or unusable falls
// back to that key's own defaults without touching the other three.
//
// This module NEVER reads or writes any `mahjongSolitaire.v1.*` key. The
// two games share an origin and therefore share a localStorage bucket;
// the namespace prefix is the only thing keeping them apart, so it is
// applied here in exactly one place (KEYS below) and nowhere else.

const KEY_PREFIX = "fiveInARow.v1";

const KEYS = {
  save: `${KEY_PREFIX}.save`,
  settings: `${KEY_PREFIX}.settings`,
  stats: `${KEY_PREFIX}.stats`,
  achievements: `${KEY_PREFIX}.achievements`,
};

// Bumped per key, not globally — see migrate() below. All four start at 1.
const SCHEMA_VERSION = 1;

// Board sizes this game offers — the ONE place this list exists. Every
// per-size field below (stats.hardWinsBySize) is built by iterating this
// array, never by writing out `{9: false, 11: false, 15: false}` a
// second time somewhere else.
//
// hardWinsBySize is a PURE STATISTIC. Nothing gates on it: themes are
// all available from the start (game/themes.js dropped its unlock
// concept entirely) and no achievement in game/achievements.js reads a
// board size. That is exactly why this list has to cover every size the
// game can actually be played at — a size missing from here isn't a
// locked reward, it's a silently unrecorded game, which is a data bug
// with no visible symptom. game/board.js's createGameState(size) still
// takes an arbitrary size; this array is "which sizes does the UI offer,
// and therefore which ones must be recorded."
export const BOARD_SIZES = [9, 11, 15];

const DEFAULT_BOARD_SIZE = 9;

const DIFFICULTIES = ["easy", "medium", "hard"];

const MODES = ["ai", "local"];

// This module owns its own persisted-shape whitelist independent of game
// logic (same reasoning as BOARD_SIZES/DIFFICULTIES above). It answers
// only "is this a structurally real theme id" — game/themes.js's own
// resolveActiveThemeId() is what decides what actually renders, and the
// two lists are deliberately allowed to disagree: a save naming a theme
// this version no longer ships (`neon`) survives sanitize here and gets
// resolved to wood at render time rather than being silently rewritten.
const THEME_IDS = ["wood", "slate", "paper"];

const DEFAULT_THEME_ID = "wood";

// --- raw localStorage access ---------------------------------------------

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
    // state this module already updated is still correct for the rest of
    // the session; it just won't survive a reload. Nothing to do.
  }
}

function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same as safeSetItem() — nothing useful to do about it.
  }
}

/**
 * Version mismatches go through here before readKey() falls back to
 * defaults. This is the first schema version of every key, so there's no
 * real history to chain yet — the only case handled today is a blob
 * missing `version` entirely (treated as "version 0," i.e. older/
 * foreign/corrupted-in-a-specific-way data), promoted straight to the
 * current shape. A future v1 -> v2 step chains on the same way:
 * `if (current.version === 1) current = { ...current, version: 2 };` — no
 * step needs to synthesize its own new field, since every sanitizer
 * already treats a missing/malformed field as "use the default"; a step
 * only signals "yes, this is upgradeable" by bumping the version tag.
 * @returns {object | null} an object at SCHEMA_VERSION, or null if this
 *   version has no known migration path (caller falls back to defaults)
 */
function migrate(parsed) {
  let current = parsed;
  if (current.version === undefined) current = { ...current, version: SCHEMA_VERSION };
  return current.version === SCHEMA_VERSION ? current : null;
}

/**
 * Read -> parse -> version-check -> migrate -> sanitize, for one key.
 * Every failure mode along the way (key absent, malformed JSON, a
 * non-object, an unmigratable version) lands on the same outcome: this
 * key's own defaults, persisted immediately so corrupted data is healed
 * on the spot rather than staying broken until the next setter call.
 * @param {string} key
 * @param {(parsed: object) => object} sanitizeFn
 * @param {() => object} defaultFn
 */
function readKey(key, sanitizeFn, defaultFn) {
  const raw = safeGetItem(key);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const migrated = parsed.version === SCHEMA_VERSION ? parsed : migrate(parsed);
        if (migrated) return sanitizeFn(migrated);
      }
    } catch {
      // malformed JSON — falls through to defaults below
    }
  }
  const fresh = defaultFn();
  safeSetItem(key, JSON.stringify(fresh));
  return fresh;
}

// --- settings -------------------------------------------------------------

function defaultSettings() {
  return {
    version: SCHEMA_VERSION,
    sound: { enabled: true },
    // Default OFF — freestyle is the default "just play five in a row"
    // experience, and Renju's forbidden-move rules are an opt-in for
    // players who already know they want them. The setting stays
    // available; it just doesn't greet a first-time player with
    // forbidden-point markers they never asked about.
    renju: { enabled: false },
    theme: { selected: DEFAULT_THEME_ID },
    boardSize: DEFAULT_BOARD_SIZE,
    mode: "ai",
    difficulty: "medium",
  };
}

function sanitizeSettings(parsed) {
  const d = defaultSettings();
  return {
    version: SCHEMA_VERSION,
    sound: { enabled: typeof parsed.sound?.enabled === "boolean" ? parsed.sound.enabled : d.sound.enabled },
    renju: { enabled: typeof parsed.renju?.enabled === "boolean" ? parsed.renju.enabled : d.renju.enabled },
    theme: { selected: THEME_IDS.includes(parsed.theme?.selected) ? parsed.theme.selected : DEFAULT_THEME_ID },
    boardSize: BOARD_SIZES.includes(parsed.boardSize) ? parsed.boardSize : DEFAULT_BOARD_SIZE,
    mode: MODES.includes(parsed.mode) ? parsed.mode : d.mode,
    difficulty: DIFFICULTIES.includes(parsed.difficulty) ? parsed.difficulty : d.difficulty,
  };
}

// --- stats ----------------------------------------------------------------

function defaultStats() {
  const streaks = {};
  for (const d of DIFFICULTIES) streaks[d] = { current: 0, best: 0 };
  const hardWinsBySize = {};
  for (const size of BOARD_SIZES) hardWinsBySize[size] = false;
  return {
    version: SCHEMA_VERSION,
    streaks,
    hardWinsBySize,
    // Keyed by board-index/color (0=black, 1=white) — same numeric
    // convention as everywhere else in this app (render.js's stone
    // colors, main.js's humanPlayer/aiPlayer), not a separate
    // "black"/"white" string vocabulary invented just for this field.
    hardWinsByColor: { 0: false, 1: false },
    localGamesCompleted: 0,
  };
}

function sanitizeStreakEntry(entry) {
  const current = Number.isInteger(entry?.current) && entry.current >= 0 ? entry.current : 0;
  const rawBest = Number.isInteger(entry?.best) && entry.best >= 0 ? entry.best : 0;
  return { current, best: Math.max(rawBest, current) }; // invariant: best is never < current
}

// Defends every field independently instead of discarding the whole blob
// over one bad value — a corrupted streaks.hard.best shouldn't cost the
// player their Easy/Medium progress too.
function sanitizeStats(parsed) {
  const streaks = {};
  for (const d of DIFFICULTIES) streaks[d] = sanitizeStreakEntry(parsed.streaks?.[d]);
  const hardWinsBySize = {};
  for (const size of BOARD_SIZES) {
    hardWinsBySize[size] = typeof parsed.hardWinsBySize?.[size] === "boolean" ? parsed.hardWinsBySize[size] : false;
  }
  return {
    version: SCHEMA_VERSION,
    streaks,
    hardWinsBySize,
    hardWinsByColor: {
      0: typeof parsed.hardWinsByColor?.[0] === "boolean" ? parsed.hardWinsByColor[0] : false,
      1: typeof parsed.hardWinsByColor?.[1] === "boolean" ? parsed.hardWinsByColor[1] : false,
    },
    localGamesCompleted:
      Number.isInteger(parsed.localGamesCompleted) && parsed.localGamesCompleted >= 0 ? parsed.localGamesCompleted : 0,
  };
}

// --- achievements ---------------------------------------------------------

function defaultAchievements() {
  return { version: SCHEMA_VERSION, unlocked: [] };
}

function sanitizeAchievements(parsed) {
  return {
    version: SCHEMA_VERSION,
    unlocked: Array.isArray(parsed.unlocked)
      ? [...new Set(parsed.unlocked.filter((id) => typeof id === "string"))] // string-typed, deduplicated
      : [],
  };
}

// --- in-progress game save ------------------------------------------------
//
// Reserved slot, matching the rest of this site's key layout. Nothing
// calls saveGame() yet — this port doesn't restore an interrupted game —
// so the key normally doesn't exist at all. The accessors are here so
// that wiring it up later is a main.js change only, with the shape
// already validated and namespaced.

function sanitizeSavedGame(parsed) {
  const size = BOARD_SIZES.includes(parsed.size) ? parsed.size : null;
  if (size === null) return null;
  // The board must be exactly size x size, every cell null/0/1 — a board
  // of the wrong dimensions would throw deep inside render/AI code far
  // from here, so it's rejected outright rather than patched up.
  const board = parsed.board;
  if (!Array.isArray(board) || board.length !== size) return null;
  for (const row of board) {
    if (!Array.isArray(row) || row.length !== size) return null;
    for (const cell of row) {
      if (cell !== null && cell !== 0 && cell !== 1) return null;
    }
  }
  if (!Array.isArray(parsed.moves)) return null;
  const moves = [];
  for (const move of parsed.moves) {
    if (!Number.isInteger(move?.row) || !Number.isInteger(move?.col)) return null;
    if (move.player !== 0 && move.player !== 1) return null;
    if (move.row < 0 || move.row >= size || move.col < 0 || move.col >= size) return null;
    moves.push({ row: move.row, col: move.col, player: move.player });
  }
  return {
    version: SCHEMA_VERSION,
    size,
    board: board.map((row) => row.slice()),
    moves,
    mode: MODES.includes(parsed.mode) ? parsed.mode : "ai",
    difficulty: DIFFICULTIES.includes(parsed.difficulty) ? parsed.difficulty : "medium",
    humanPlayer: parsed.humanPlayer === 1 ? 1 : 0,
  };
}

/**
 * @returns {object | null} the sanitized snapshot, or null if there
 *   isn't one (or it didn't survive validation — an unusable save is
 *   indistinguishable from no save to every caller, on purpose)
 */
export function loadSavedGame() {
  const raw = safeGetItem(KEYS.save);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const migrated = parsed.version === SCHEMA_VERSION ? parsed : migrate(parsed);
    return migrated ? sanitizeSavedGame(migrated) : null;
  } catch {
    return null;
  }
}

/** Persists an in-progress game. A snapshot that fails validation is
 * dropped rather than written, so loadSavedGame() can never be handed
 * something this module wouldn't accept back. */
export function saveGame(snapshot) {
  const clean = sanitizeSavedGame({ ...snapshot, version: SCHEMA_VERSION });
  if (!clean) return false;
  safeSetItem(KEYS.save, JSON.stringify(clean));
  return true;
}

/** Removes the in-progress save — a finished or abandoned game has
 * nothing left to resume. */
export function clearSavedGame() {
  safeRemoveItem(KEYS.save);
}

// --- module state ---------------------------------------------------------
//
// All three long-lived keys are read once at import time and kept in
// memory; every setter mutates the in-memory copy and writes only the
// one key it touched. `save` is deliberately NOT cached — it's written
// far more often than read and has no getters that need to be fast.

let settings = readKey(KEYS.settings, sanitizeSettings, defaultSettings);
let stats = readKey(KEYS.stats, sanitizeStats, defaultStats);
let achievements = readKey(KEYS.achievements, sanitizeAchievements, defaultAchievements);

function saveSettings() {
  safeSetItem(KEYS.settings, JSON.stringify(settings));
}

function saveStats() {
  safeSetItem(KEYS.stats, JSON.stringify(stats));
}

function saveAchievements() {
  safeSetItem(KEYS.achievements, JSON.stringify(achievements));
}

/**
 * Re-reads every key from localStorage right now, discarding the
 * in-memory copies. The module already does this once naturally at
 * import time; this makes it callable on demand — primarily for tests
 * (seed a mock localStorage, call this, then assert), since ES modules
 * are otherwise singletons and only ever initialize once per process.
 */
export function reloadFromStorage() {
  settings = readKey(KEYS.settings, sanitizeSettings, defaultSettings);
  stats = readKey(KEYS.stats, sanitizeStats, defaultStats);
  achievements = readKey(KEYS.achievements, sanitizeAchievements, defaultAchievements);
}

// --- sound preference -----------------------------------------------------

export function isSoundEnabled() {
  return settings.sound.enabled;
}

export function setSoundEnabled(value) {
  settings.sound.enabled = !!value;
  saveSettings();
}

// --- Renju rules toggle ---------------------------------------------------
// A GLOBAL preference, not per-mode — applies to vs-AI and local
// 2-player alike whenever it's on (Black is Black in both, and the rule
// exists to balance Black's advantage regardless of who is playing that
// side). Default off; see defaultSettings().

export function isRenjuEnabled() {
  return settings.renju.enabled;
}

export function setRenjuEnabled(value) {
  settings.renju.enabled = !!value;
  saveSettings();
}

// --- board size -----------------------------------------------------------
// Was a hardcoded `const BOARD_SIZE = 15` in the Gomoku original. It's a
// persisted preference here, so the size survives a reload the same way
// mode/difficulty/theme do.

/** @returns {number} always one of BOARD_SIZES */
export function getBoardSize() {
  return settings.boardSize;
}

/** Unknown sizes are ignored, same defensive shape as setTheme() below —
 * the UI only ever offers BOARD_SIZES, and a caller passing something
 * else must not be able to persist a size the rest of the app would
 * then have to defend against. */
export function setBoardSize(size) {
  if (!BOARD_SIZES.includes(size)) return;
  settings.boardSize = size;
  saveSettings();
}

// --- mode / difficulty ----------------------------------------------------

export function getMode() {
  return settings.mode;
}

export function setMode(value) {
  if (!MODES.includes(value)) return;
  settings.mode = value;
  saveSettings();
}

export function getDifficulty() {
  return settings.difficulty;
}

export function setDifficulty(value) {
  if (!DIFFICULTIES.includes(value)) return;
  settings.difficulty = value;
  saveSettings();
}

// --- board theme ----------------------------------------------------------
// No unlock concept — game/themes.js dropped it (see that file's header).
// setTheme() only validates that the id is structurally real.

export function getTheme() {
  return settings.theme.selected;
}

export function setTheme(id) {
  if (!THEME_IDS.includes(id)) return;
  settings.theme.selected = id;
  saveSettings();
}

// --- per-difficulty AI win streaks ----------------------------------------

/**
 * @param {'easy'|'medium'|'hard'} difficulty
 * @returns {{current: number, best: number}}
 */
export function getStreak(difficulty) {
  const s = stats.streaks[difficulty];
  return s ? { current: s.current, best: s.best } : { current: 0, best: 0 };
}

/**
 * Records one vs-AI game's outcome for `difficulty`'s streak. `won`
 * covers exactly the human-won case; everything else (a loss OR a draw)
 * resets the streak to 0.
 * @param {'easy'|'medium'|'hard'} difficulty
 * @param {boolean} won
 * @returns {{current: number, best: number, isNewBest: boolean}}
 */
export function recordStreakResult(difficulty, won) {
  const s = stats.streaks[difficulty];
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
  saveStats();
  return { current: s.current, best: s.best, isNewBest };
}

// --- achievements ---------------------------------------------------------
// This module only ever stores FACTS (which ids are unlocked, which board
// sizes/colors Hard has been beaten with, how many LOCAL games have
// finished) — it has no idea what any particular achievement MEANS.
// Deciding which facts unlock which achievement is game/achievements.js's
// job entirely; this file just remembers whatever that module concludes.

export function getUnlockedAchievements() {
  return achievements.unlocked.slice();
}

/**
 * Marks `id` unlocked and persists. Idempotent: unlocking an id that's
 * already present is a no-op (returns false, no duplicate entry, no
 * extra write).
 * @param {string} id
 * @returns {boolean} true iff this call newly unlocked it
 */
export function unlockAchievement(id) {
  if (achievements.unlocked.includes(id)) return false;
  achievements.unlocked.push(id);
  saveAchievements();
  return true;
}

// --- Hard-win records (statistics only) -----------------------------------
//
// Nothing gates on these any more — themes are all available from the
// start and no achievement reads a board size. They're kept because
// they're the only per-size record of what the player has actually
// managed, and dropping them would make the data unrecoverable later.

/** @returns {Record<number, boolean>} a copy — mutate the return value all you like */
export function getHardWinsBySize() {
  return { ...stats.hardWinsBySize };
}

/**
 * Records a Hard-difficulty vs-AI win on `boardSize`.
 *
 * An unrecognized size is not silently dropped: because nothing gates on
 * this data, a size missing from BOARD_SIZES would produce no visible
 * symptom at all — the game would play fine and simply never record
 * those wins. That's precisely the kind of bug that survives to
 * production, so it gets a console warning naming the offending size and
 * the list it needs to be added to.
 * @param {number} boardSize
 * @returns {Record<number, boolean>}
 */
export function recordHardWin(boardSize) {
  if (!Object.prototype.hasOwnProperty.call(stats.hardWinsBySize, boardSize)) {
    console.warn(
      `[five-in-a-row] recordHardWin(${boardSize}): not a tracked board size, this win was NOT recorded. ` +
        `Add ${boardSize} to BOARD_SIZES in core/storage.js.`,
    );
    return { ...stats.hardWinsBySize };
  }
  stats.hardWinsBySize[boardSize] = true;
  saveStats();
  return { ...stats.hardWinsBySize };
}

/** @returns {Record<number, boolean>} a copy, keyed 0 (black)/1 (white) */
export function getHardWinsByColor() {
  return { ...stats.hardWinsByColor };
}

/**
 * Records a Hard-difficulty vs-AI win while playing as `color` (0=black,
 * the board-index the human happened to be assigned that game — see
 * main.js's coin flip). Unlike recordHardWin() above this genuinely
 * cannot receive an unexpected value (there are only two colors, and the
 * caller passes humanPlayer, which is always 0 or 1), so it keeps the
 * plain defensive no-op rather than warning.
 * @param {0|1} color
 * @returns {Record<number, boolean>}
 */
export function recordHardWinByColor(color) {
  if (Object.prototype.hasOwnProperty.call(stats.hardWinsByColor, color)) {
    stats.hardWinsByColor[color] = true;
    saveStats();
  }
  return { ...stats.hardWinsByColor };
}

// "Local" specifically (the "Local Legend" achievement) — a vs-AI game
// completing doesn't touch this counter, it has its own per-difficulty
// streak tracking above instead. Named precisely rather than generically,
// so a future "total games including vs-AI" need gets its own field
// instead of overloading this one's meaning after the fact.
export function getLocalGamesCompleted() {
  return stats.localGamesCompleted;
}

/** @returns {number} the updated total */
export function incrementLocalGamesCompleted() {
  stats.localGamesCompleted += 1;
  saveStats();
  return stats.localGamesCompleted;
}
