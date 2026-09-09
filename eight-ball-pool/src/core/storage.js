// core/storage.js — the only file that touches localStorage.
//
// Keys: eightBallPool.v1.save | settings | stats. Every key is validated
// on read: a corrupted or hand-edited blob falls back to defaults rather
// than reaching the game. Nothing here may throw — Safari private mode
// throws on setItem, and some browsers disable storage outright; the
// game keeps running off an in-memory copy in that case.

const PREFIX = "eightBallPool.v1";
const KEYS = { save: `${PREFIX}.save`, settings: `${PREFIX}.settings`, stats: `${PREFIX}.stats` };

const memory = new Map();

function read(key) {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    /* unavailable */
  }
  return memory.has(key) ? memory.get(key) : null;
}
function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota, private mode: the in-memory copy carries on */
  }
}
function remove(key) {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
function parse(key) {
  const raw = read(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- settings ---------------------------------------------------------

export const PACE_IDS = ["relaxed", "standard", "challenging"];
export const CLOTH_IDS = ["green", "blue", "burgundy"];
export const RULE_IDS = ["friendly", "standard"];

const DEFAULT_SETTINGS = {
  sound: true,
  pace: "standard",
  cloth: "green",
  guide: true,
  /** "friendly": a foul hands over the turn and the cue ball goes behind
   *  the head string. "standard": full ball in hand, and a shot that
   *  reaches no cushion is a foul. */
  rules: "friendly",
  /** Side (English) spin controls. Off by default — one more dial is one
   *  more thing to get wrong for the player this game is drawn for. */
  spin: false,
};

export function isValidSettings(s) {
  return Boolean(
    s &&
      typeof s === "object" &&
      typeof s.sound === "boolean" &&
      PACE_IDS.includes(s.pace) &&
      CLOTH_IDS.includes(s.cloth) &&
      typeof s.guide === "boolean" &&
      RULE_IDS.includes(s.rules) &&
      typeof s.spin === "boolean"
  );
}

let settings = (() => {
  const s = parse(KEYS.settings);
  const merged = { ...DEFAULT_SETTINGS, ...(s && typeof s === "object" ? s : {}) };
  return isValidSettings(merged) ? merged : { ...DEFAULT_SETTINGS };
})();

export function getSettings() {
  return { ...settings };
}
export function setSetting(key, value) {
  const next = { ...settings, [key]: value };
  if (!isValidSettings(next)) return settings;
  settings = next;
  write(KEYS.settings, JSON.stringify(settings));
  return settings;
}

/** Used by core/audio.js. */
export function isSoundEnabled() {
  return settings.sound;
}
export function setSoundEnabled(value) {
  setSetting("sound", Boolean(value));
}

// --- the game in progress -----------------------------------------------

/**
 * A save is {game, undo}: the game's plain form (game/rules.js toJSON)
 * and the undo stack in the same form. The shape check is structural;
 * rules.fromJSON does the deep validation and returns null for junk.
 */
export function isValidSave(s) {
  if (!s || typeof s !== "object") return false;
  if (!s.game || typeof s.game !== "object" || !Array.isArray(s.game.balls)) return false;
  if (s.undo !== undefined && !Array.isArray(s.undo)) return false;
  return true;
}

export function loadSave() {
  const s = parse(KEYS.save);
  return isValidSave(s) ? s : null;
}
export function saveGame(save) {
  if (!isValidSave(save)) return;
  write(KEYS.save, JSON.stringify(save));
}
export function clearSave() {
  remove(KEYS.save);
}

// --- stats ------------------------------------------------------------

const DEFAULT_STATS = { played: 0, won: 0, streak: 0, best: 0 };

export function isValidStats(s) {
  return Boolean(
    s &&
      typeof s === "object" &&
      ["played", "won", "streak", "best"].every((k) => Number.isInteger(s[k]) && s[k] >= 0)
  );
}

export function loadStats() {
  const s = parse(KEYS.stats);
  return isValidStats(s) ? { ...s } : { ...DEFAULT_STATS };
}
export function recordResult(won) {
  const s = loadStats();
  s.played += 1;
  if (won) {
    s.won += 1;
    s.streak += 1;
    s.best = Math.max(s.best, s.streak);
  } else {
    s.streak = 0;
  }
  write(KEYS.stats, JSON.stringify(s));
  return s;
}

export { KEYS };
