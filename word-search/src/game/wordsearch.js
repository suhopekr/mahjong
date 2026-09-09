// game/wordsearch.js
// The puzzle and its rules, and nothing else. No DOM, no storage, no
// timers: everything here is a pure function of its arguments, so the
// whole file runs under node for the test suite and the page's main.js
// is only ever a renderer of what comes out.
//
//   generate()     builds a puzzle from a seed: picks the words, hides
//                  them, fills the gaps — the same seed always gives the
//                  same puzzle, which is what makes "Today's puzzle" one
//                  puzzle for everybody
//   findWord()     what a selection from one cell to another spells, and
//                  whether that is one of the hidden words (either way
//                  round — dragging a word backwards still counts)
//   hintFor()      the first letter of a word not yet found
//   dailySeed()    today's date as a number, the seed of today's puzzle

import { THEMES } from "./words.js";

export const SIZES = Object.freeze({
  small: Object.freeze({ key: "small", n: 8, words: 6, maxLen: 6 }),
  medium: Object.freeze({ key: "medium", n: 10, words: 8, maxLen: 8 }),
  large: Object.freeze({ key: "large", n: 12, words: 10, maxLen: 10 }),
});
export const SIZE_KEYS = Object.freeze(Object.keys(SIZES));
export const MIN_WORD = 4;

// Directions as [dx, dy]: dx across the columns, dy down the rows.
export const DIR_ACROSS = Object.freeze([1, 0]);
export const DIR_DOWN = Object.freeze([0, 1]);
export const DIRECTIONS = Object.freeze({
  // "Easy": words read left to right or top to bottom only.
  easy: Object.freeze([DIR_ACROSS, DIR_DOWN]),
  // "All directions": the eight compass points — diagonals and backwards too.
  all: Object.freeze([[1, 0], [0, 1], [1, 1], [-1, 1], [-1, 0], [0, -1], [-1, -1], [1, -1]]),
});
export const DIRECTION_KEYS = Object.freeze(Object.keys(DIRECTIONS));
export const ALL_EIGHT = DIRECTIONS.all;

// Deterministic RNG (mulberry32), the same one solitaire deals with, so
// a puzzle can be reproduced from its seed.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, rng) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------
// the calendar
// ---------------------------------------------------------------------

/** Today's seed: the local date as YYYYMMDD, e.g. 20260909. */
export function dailySeed(date = new Date()) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}
/** The date a daily seed stands for (local midnight). */
export function dateOfSeed(seed) {
  const y = Math.floor(seed / 10000), m = Math.floor(seed / 100) % 100, d = seed % 100;
  return new Date(y, m - 1, d);
}
export function isDailySeed(seed) {
  if (!Number.isInteger(seed) || seed < 20000101 || seed > 21001231) return false;
  const dt = dateOfSeed(seed);
  return dailySeed(dt) === seed;
}
/** Which theme today gets: one theme per day, in order, wrapping round. */
export function dailyThemeIndex(seed, themeCount = THEMES.length) {
  const dt = dateOfSeed(seed);
  const days = Math.round(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) / 86400000);
  return ((days % themeCount) + themeCount) % themeCount;
}
/** A seed for a "New puzzle": 1–99999, so it never collides with a date
 *  and reads as a short puzzle number. */
export function randomSeed(rand = Math.random) {
  return 1 + Math.floor(rand() * 99999);
}

// ---------------------------------------------------------------------
// building a puzzle
// ---------------------------------------------------------------------

const reverse = (s) => s.split("").reverse().join("");

/** Does one of the two words hide inside the other — read either way
 *  round? ROSE in PRIMROSE, and MOSS backwards in BLOSSOM: a word that
 *  can be selected backwards is found inside the other word's letters,
 *  so such a pair can never be told apart on the sheet. */
export function overlaps(a, b) {
  return a.includes(b) || b.includes(a) || a.includes(reverse(b)) || b.includes(reverse(a));
}

/** Words picked for one puzzle: `count` of them, none longer than
 *  `maxLen`, and none hiding inside another either way round (ROSE in
 *  PRIMROSE, MOSS in BLOSSOM read backwards), so every word can be found
 *  exactly once. */
export function pickWords(list, count, maxLen, rng) {
  const pool = shuffle(list.filter((w) => w.length <= maxLen && w.length >= MIN_WORD), rng);
  const picked = [];
  for (const w of pool) {
    if (picked.length === count) break;
    if (picked.some((p) => overlaps(p, w))) continue;
    picked.push(w);
  }
  return picked.length === count ? picked : null;
}

function fits(n, word, col, row, dx, dy) {
  const endC = col + dx * (word.length - 1), endR = row + dy * (word.length - 1);
  return endC >= 0 && endC < n && endR >= 0 && endR < n;
}

/** Hide every word in an n×n grid. Returns { cells, placements } or null
 *  when this attempt got stuck (the caller retries with fresh randomness).
 *  Longest words first, because they have the fewest places to go. */
export function placeWords(n, words, dirs, rng) {
  const cells = new Array(n * n).fill("");
  const order = words.slice().sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const placements = [];
  for (const word of order) {
    let placed = null;
    for (let attempt = 0; attempt < 80 && !placed; attempt++) {
      const [dx, dy] = dirs[Math.floor(rng() * dirs.length)];
      const col = Math.floor(rng() * n), row = Math.floor(rng() * n);
      if (!fits(n, word, col, row, dx, dy)) continue;
      let ok = true;
      for (let i = 0; i < word.length && ok; i++) {
        const k = (row + dy * i) * n + (col + dx * i);
        if (cells[k] !== "" && cells[k] !== word[i]) ok = false;
      }
      if (!ok) continue;
      for (let i = 0; i < word.length; i++) cells[(row + dy * i) * n + (col + dx * i)] = word[i];
      placed = { word, row, col, dx, dy };
    }
    if (!placed) return null;
    placements.push(placed);
  }
  // Report the words in the order they were asked for, not longest first.
  placements.sort((a, b) => words.indexOf(a.word) - words.indexOf(b.word));
  return { cells, placements };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Fill the empty cells. The filler is drawn from the words' own letters
 *  (twice over) plus the alphabet once, so the hidden words don't stand
 *  out as the only cells with common letters. */
export function fillCells(cells, words, rng) {
  const pool = ALPHABET.split("");
  for (const w of words) for (const ch of w) pool.push(ch, ch);
  return cells.map((c) => (c === "" ? pool[Math.floor(rng() * pool.length)] : c));
}

/** Every place `word` can be read in the grid, in any of the eight
 *  directions. A word read backwards along the same cells is the same
 *  occurrence, so each entry is one unordered pair of end cells. */
export function findAll(grid, n, word) {
  const seen = new Set();
  const out = [];
  const rev = word.split("").reverse().join("");
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    for (const [dx, dy] of ALL_EIGHT) {
      if (!fits(n, word, col, row, dx, dy)) continue;
      let s = "";
      for (let i = 0; i < word.length; i++) s += grid[(row + dy * i) * n + (col + dx * i)];
      if (s !== word && s !== rev) continue;
      const r2 = row + dy * (word.length - 1), c2 = col + dx * (word.length - 1);
      const a = row * n + col, b = r2 * n + c2;
      const key = Math.min(a, b) + ":" + Math.max(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s === word ? { row, col, dx, dy } : { row: r2, col: c2, dx: -dx, dy: -dy });
    }
  }
  return out;
}

/**
 * A whole puzzle from a seed. `size` is a SIZES key, `directions` a
 * DIRECTIONS key. The theme comes from the seed: the day's theme for a
 * daily seed, a random one otherwise — unless `theme` names one.
 *
 * Returns { seed, daily, size, n, directions, theme, themeName,
 * themeIndex, grid, words } where theme is the i18n key of the theme's
 * name (themeName its English), grid is one string of n×n letters, row
 * by row, and words is [{ word, row, col, dx, dy }] in the order the list
 * shows them.
 */
export function generate({ seed, size = "small", directions = "easy", theme } = {}) {
  if (!Number.isInteger(seed)) throw new Error("generate: seed must be an integer");
  const spec = SIZES[size];
  if (!spec) throw new Error("generate: unknown size " + size);
  const dirs = DIRECTIONS[directions];
  if (!dirs) throw new Error("generate: unknown directions " + directions);
  const rng = makeRng(seed);
  const daily = isDailySeed(seed);
  let themeIndex = Number.isInteger(theme) ? theme : daily ? dailyThemeIndex(seed) : Math.floor(rng() * THEMES.length);
  themeIndex = ((themeIndex % THEMES.length) + THEMES.length) % THEMES.length;
  const list = THEMES[themeIndex].words;
  const n = spec.n;
  for (let round = 0; round < 40; round++) {
    const words = pickWords(list, spec.words, spec.maxLen, rng);
    if (!words) continue;
    for (let attempt = 0; attempt < 25; attempt++) {
      const placed = placeWords(n, words, dirs, rng);
      if (!placed) continue;
      // The placed letters alone must not already spell a word twice
      // (two crossings can) — no filler could mend that, so place again.
      if (!words.every((w) => findAll(placed.cells, n, w).length === 1)) continue;
      // Fill, then make sure the filler did not spell a second copy of a
      // word somewhere; a few refills fix that almost always.
      for (let fill = 0; fill < 12; fill++) {
        const grid = fillCells(placed.cells, words, rng).join("");
        if (words.every((w) => findAll(grid, n, w).length === 1)) {
          const t = THEMES[themeIndex];
          return { seed, daily, size, n, directions, theme: t.id, themeName: t.name, themeIndex, grid, words: placed.placements };
        }
      }
    }
  }
  throw new Error(`generate: could not build a ${n}×${n} puzzle for ${THEMES[themeIndex].name} from seed ${seed}`);
}

// ---------------------------------------------------------------------
// playing
// ---------------------------------------------------------------------

export function letterAt(puzzle, row, col) {
  return puzzle.grid[row * puzzle.n + col];
}

/** The cells on a straight line from one cell to another (either end
 *  included), or null when the two are not in a straight line — across,
 *  down or on a true diagonal. */
export function cellsOnLine(r1, c1, r2, c2) {
  const dr = r2 - r1, dc = c2 - c1;
  if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
  const len = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
  const dy = Math.sign(dr), dx = Math.sign(dc);
  const out = [];
  for (let i = 0; i < len; i++) out.push({ row: r1 + dy * i, col: c1 + dx * i });
  return out;
}

/** What a selection spells, and whether it is one of the hidden words.
 *  Returns { word, cells, reversed } when the letters from (r1,c1) to
 *  (r2,c2) spell a word forwards or backwards, { cells } when they are in
 *  a line but spell nothing, and null when they are not in a line. */
export function findWord(puzzle, r1, c1, r2, c2) {
  const cells = cellsOnLine(r1, c1, r2, c2);
  if (!cells) return null;
  const s = cells.map((p) => letterAt(puzzle, p.row, p.col)).join("");
  const rev = s.split("").reverse().join("");
  for (const p of puzzle.words) {
    if (p.word === s) return { word: p.word, cells, reversed: false };
    if (p.word === rev) return { word: p.word, cells, reversed: true };
  }
  return { cells };
}

export function isComplete(puzzle, found) {
  return puzzle.words.every((p) => found.includes(p.word));
}

/** A word not yet found, with the cell of its first letter. `after` is
 *  the word the last hint pointed at, so repeated hints walk through the
 *  list instead of naming the same word every time. */
export function hintFor(puzzle, found, after = null) {
  const left = puzzle.words.filter((w) => !found.includes(w.word));
  if (!left.length) return null;
  const k = after ? left.findIndex((w) => w.word === after) : -1;
  const p = left[(k + 1) % left.length];
  return { word: p.word, row: p.row, col: p.col, letter: p.word[0] };
}

/** The last cell of a placed word. */
export function endOf(w) {
  return { row: w.row + w.dy * (w.word.length - 1), col: w.col + w.dx * (w.word.length - 1) };
}
