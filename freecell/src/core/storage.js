// core/storage.js
// localStorage persistence for FreeCell — the only file that touches it.
//
// One key per concern, namespaced and versioned like the rest of the site
// (solitaire.v1.*, fiveInARow.v1.*): a corrupt save can never cost the
// player their settings or their win count.
//
//   freecell.v1.save      the game on the table + its undo history
//   freecell.v1.settings  tap behaviour / sound / card back
//   freecell.v1.stats     games played, won, streaks

const KEY_PREFIX = "freecell.v1";
const KEYS = {
  save: `${KEY_PREFIX}.save`,
  settings: `${KEY_PREFIX}.settings`,
  stats: `${KEY_PREFIX}.stats`,
};

export const BACKS = ["burgundy", "navy", "onyx", "plum"];
export const DEFAULT_SETTINGS = Object.freeze({ tap: "auto", sound: true, back: "burgundy" });
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

const isCard = (c) => c && typeof c.id === "string" && /^[SHDC]$/.test(c.suit) && Number.isInteger(c.rank) && c.rank >= 1 && c.rank <= 13 && c.id === c.suit + c.rank;

/** A state is usable only if it is shaped like one and holds every card
 *  of the deck exactly once — anything else is thrown away. */
export function isValidState(s) {
  if (!s || typeof s !== "object") return false;
  if (!Array.isArray(s.cascades) || s.cascades.length !== 8) return false;
  if (!Array.isArray(s.cells) || s.cells.length !== 4) return false;
  if (!Array.isArray(s.foundations) || s.foundations.length !== 4) return false;
  if (!Number.isInteger(s.deal) || s.deal < 1 || !Number.isInteger(s.moves) || s.moves < 0) return false;
  const all = [];
  for (const p of [...s.cascades, ...s.foundations]) {
    if (!Array.isArray(p)) return false;
    for (const c of p) { if (!isCard(c)) return false; all.push(c.id); }
  }
  for (const c of s.cells) {
    if (c === null) continue;
    if (!isCard(c)) return false;
    all.push(c.id);
  }
  return all.length === 52 && new Set(all).size === 52;
}

/** The game in progress. `history` is capped so the blob stays small. */
export function loadGame() {
  const g = read(KEYS.save);
  if (!g || !isValidState(g.state)) return null;
  const history = Array.isArray(g.history) ? g.history.filter(isValidState) : [];
  return { state: g.state, history };
}
export function saveGame(state, history) {
  return write(KEYS.save, { state, history: history.slice(-60) });
}
export function clearGame() { return write(KEYS.save, null); }
