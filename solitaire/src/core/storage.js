// core/storage.js
// localStorage persistence for Solitaire — the only file that touches it.
//
// One key per concern, namespaced and versioned like the rest of the site
// (mahjongSolitaire.v1.*, fiveInARow.v1.*): a corrupt save can never
// cost the player their settings or their win count.
//
//   solitaire.v1.save      the game on the table + its undo history
//   solitaire.v1.settings  draw count / tap behaviour / sound / card back
//   solitaire.v1.stats     games played, won, streaks

const KEY_PREFIX = "solitaire.v1";
const KEYS = {
  save: `${KEY_PREFIX}.save`,
  settings: `${KEY_PREFIX}.settings`,
  stats: `${KEY_PREFIX}.stats`,
};

export const BACKS = ["burgundy", "navy", "onyx", "plum"];
export const DEFAULT_SETTINGS = Object.freeze({ draw: 1, tap: "auto", sound: true, back: "burgundy" });
export const DEFAULT_STATS = Object.freeze({ played: 0, won: 0, streak: 0, best: 0 });

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private mode / quota — the game plays on without saving
  }
}

export function loadSettings() {
  const s = read(KEYS.settings) || {};
  return {
    draw: s.draw === 3 ? 3 : 1,
    tap: s.tap === "choose" ? "choose" : "auto",
    sound: s.sound !== false,
    back: BACKS.includes(s.back) ? s.back : "burgundy",
  };
}
export function saveSettings(settings) { return write(KEYS.settings, settings); }

export function loadStats() {
  const s = read(KEYS.stats) || {};
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return { played: n(s.played), won: n(s.won), streak: n(s.streak), best: n(s.best) };
}
export function saveStats(stats) { return write(KEYS.stats, stats); }

/** The game in progress. `history` is capped so the blob stays small. */
export function loadGame() {
  const g = read(KEYS.save);
  if (!g || !g.state || !Array.isArray(g.state.tableau) || g.state.tableau.length !== 7) return null;
  return { state: g.state, history: Array.isArray(g.history) ? g.history : [] };
}
export function saveGame(state, history) {
  return write(KEYS.save, { state, history: history.slice(-60) });
}
export function clearGame() { return write(KEYS.save, null); }
