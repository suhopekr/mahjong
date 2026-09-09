// core/storage.js
// localStorage persistence for Word Search — the only file that touches it.
//
// One key per concern, namespaced and versioned like the rest of the site
// (solitaire.v1.*, fiveInARow.v1.*): a corrupt save can never cost the
// player their settings or their solved count.
//
//   wordSearch.v1.save      the puzzle on the sheet + the words found so far
//   wordSearch.v1.settings  size / directions / letter case / sound
//   wordSearch.v1.stats     puzzles solved, days played, which dailies are done

const KEY_PREFIX = "wordSearch.v1";
const KEYS = {
  save: `${KEY_PREFIX}.save`,
  settings: `${KEY_PREFIX}.settings`,
  stats: `${KEY_PREFIX}.stats`,
};

export const SIZES = ["small", "medium", "large"];
export const DIRECTIONS = ["easy", "all"];
export const CASES = ["upper", "lower"];
// `size: null` means "not chosen yet": main.js picks Small on a phone and
// Medium elsewhere until the player chooses in Settings.
export const DEFAULT_SETTINGS = Object.freeze({ size: null, directions: "easy", letters: "upper", sound: true });
export const DEFAULT_STATS = Object.freeze({ solved: 0, played: 0, daysPlayed: 0, lastDay: 0, dailySolved: [] });

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
    size: SIZES.includes(s.size) ? s.size : null,
    directions: DIRECTIONS.includes(s.directions) ? s.directions : "easy",
    letters: CASES.includes(s.letters) ? s.letters : "upper",
    sound: s.sound !== false,
  };
}
export function saveSettings(settings) { return write(KEYS.settings, settings); }

export function loadStats() {
  const s = read(KEYS.stats) || {};
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const dailySolved = Array.isArray(s.dailySolved) ? s.dailySolved.filter((d) => Number.isInteger(d) && d > 0) : [];
  return { solved: n(s.solved), played: n(s.played), daysPlayed: n(s.daysPlayed), lastDay: n(s.lastDay), dailySolved };
}
export function saveStats(stats) {
  return write(KEYS.stats, { ...stats, dailySolved: stats.dailySolved.slice(-400) });
}

/** Is this a puzzle the page can render? Every field is checked, because
 *  a hand-edited or half-written save must not crash the page. */
export function validPuzzle(p) {
  if (!p || typeof p !== "object") return false;
  if (![8, 10, 12].includes(p.n)) return false;
  if (typeof p.grid !== "string" || p.grid.length !== p.n * p.n || !/^[A-Z]+$/.test(p.grid)) return false;
  if (!Number.isInteger(p.seed) || typeof p.theme !== "string") return false;
  if (!SIZES.includes(p.size) || !DIRECTIONS.includes(p.directions)) return false;
  if (!Array.isArray(p.words) || p.words.length === 0) return false;
  for (const w of p.words) {
    if (!w || typeof w.word !== "string" || !/^[A-Z]{2,}$/.test(w.word)) return false;
    for (const k of ["row", "col", "dx", "dy"]) if (!Number.isInteger(w[k])) return false;
    if (Math.abs(w.dx) > 1 || Math.abs(w.dy) > 1 || (w.dx === 0 && w.dy === 0)) return false;
    const r2 = w.row + w.dy * (w.word.length - 1), c2 = w.col + w.dx * (w.word.length - 1);
    if (w.row < 0 || w.col < 0 || w.row >= p.n || w.col >= p.n || r2 < 0 || c2 < 0 || r2 >= p.n || c2 >= p.n) return false;
  }
  return true;
}

/** The puzzle in progress: { puzzle, found: [{ word, r1, c1, r2, c2 }], hints }. */
export function loadGame() {
  const g = read(KEYS.save);
  if (!g || !validPuzzle(g.puzzle)) return null;
  const words = g.puzzle.words.map((w) => w.word);
  const n = g.puzzle.n;
  const inGrid = (v) => Number.isInteger(v) && v >= 0 && v < n;
  const found = [];
  if (Array.isArray(g.found)) {
    for (const f of g.found) {
      if (!f || !words.includes(f.word) || found.some((x) => x.word === f.word)) continue;
      if (!inGrid(f.r1) || !inGrid(f.c1) || !inGrid(f.r2) || !inGrid(f.c2)) continue;
      found.push({ word: f.word, r1: f.r1, c1: f.c1, r2: f.r2, c2: f.c2 });
    }
  }
  return { puzzle: g.puzzle, found, hints: Number.isInteger(g.hints) && g.hints >= 0 ? g.hints : 0 };
}
export function saveGame(puzzle, found, hints) {
  return write(KEYS.save, { puzzle, found, hints });
}
export function clearGame() { return write(KEYS.save, null); }
