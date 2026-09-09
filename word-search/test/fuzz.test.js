// test/fuzz.test.js — the generator under torture: every theme × every
// size × both direction settings × 40 seeds, plus every day of a year of
// daily seeds. Nothing may throw or loop; every placed word must read
// back from the grid exactly where it says it is; no two placements may
// disagree about a cell; "Across and down" never places a diagonal or
// backward word; no word may be readable a second time anywhere in the
// grid (that would make the puzzle ambiguous); the finder must accept
// every placed word either way round and refuse anything misaligned.
import { test, assertEqual, assertTrue } from "./harness.js";
import {
  SIZES, DIRECTIONS, ALL_EIGHT, MIN_WORD, dailySeed, dailyThemeIndex, isDailySeed, makeRng,
  generate, pickWords, overlaps, letterAt, findAll, findWord, cellsOnLine, hintFor, endOf,
} from "../src/game/wordsearch.js";
import { THEMES } from "../src/game/words.js";

const SEED_COUNT = 40;
const SIZE_KEYS = Object.keys(SIZES);
const DIR_KEYS = Object.keys(DIRECTIONS);

function cellsOf(w) {
  const out = [];
  for (let i = 0; i < w.word.length; i++) out.push({ row: w.row + w.dy * i, col: w.col + w.dx * i });
  return out;
}

/** Every straight-line occurrence of `word` in the grid, in all eight
 *  directions, counted independently of the engine's own findAll: a
 *  start cell + direction whose letters spell the word forwards. A word
 *  read backwards along the same cells is the same occurrence, so the
 *  count is of unordered end-cell pairs. */
function occurrences(grid, n, word) {
  const keys = new Set();
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) for (const [dx, dy] of ALL_EIGHT) {
    const r2 = row + dy * (word.length - 1), c2 = col + dx * (word.length - 1);
    if (r2 < 0 || r2 >= n || c2 < 0 || c2 >= n) continue;
    let ok = true;
    for (let i = 0; i < word.length && ok; i++) if (grid[(row + dy * i) * n + (col + dx * i)] !== word[i]) ok = false;
    if (!ok) continue;
    const a = row * n + col, b = r2 * n + c2;
    keys.add(Math.min(a, b) + ":" + Math.max(a, b));
  }
  return keys.size;
}

/** The checks one generated puzzle must pass. Returns nothing; throws
 *  with a message naming the seed/size/theme on the first failure. */
function checkPuzzle(p, { seed, size, directions, themeIndex }) {
  const tag = `seed ${seed} ${size} ${directions} ${THEMES[themeIndex].name}`;
  const spec = SIZES[size];
  assertEqual(p.n, spec.n, tag + ": n");
  assertEqual(p.size, size, tag + ": size");
  assertEqual(p.directions, directions, tag + ": directions");
  assertEqual(p.themeIndex, themeIndex, tag + ": theme");
  assertEqual(p.grid.length, p.n * p.n, tag + ": grid length");
  assertTrue(/^[A-Z]+$/.test(p.grid), tag + ": grid A–Z only");
  assertEqual(p.words.length, spec.words, tag + ": word count");

  const owner = new Map(); // cell index → letter it must hold
  const seen = new Set();
  for (const w of p.words) {
    assertTrue(!seen.has(w.word), `${tag}: ${w.word} listed twice`);
    seen.add(w.word);
    assertTrue(w.word.length >= MIN_WORD && w.word.length <= spec.maxLen, `${tag}: ${w.word} length ${w.word.length} outside ${MIN_WORD}–${spec.maxLen}`);
    assertTrue(THEMES[themeIndex].words.includes(w.word), `${tag}: ${w.word} not in the theme list`);
    assertTrue(Math.abs(w.dx) <= 1 && Math.abs(w.dy) <= 1 && (w.dx !== 0 || w.dy !== 0), `${tag}: ${w.word} has a bad direction ${w.dx},${w.dy}`);
    if (directions === "easy") assertTrue((w.dx === 1 && w.dy === 0) || (w.dx === 0 && w.dy === 1), `${tag}: ${w.word} is diagonal or backward (${w.dx},${w.dy}) in Across-and-down`);
    // Readable in the grid in exactly its placement.
    const cells = cellsOf(w);
    cells.forEach((c, i) => {
      assertTrue(c.row >= 0 && c.row < p.n && c.col >= 0 && c.col < p.n, `${tag}: ${w.word} leaves the grid`);
      assertEqual(letterAt(p, c.row, c.col), w.word[i], `${tag}: ${w.word} letter ${i} at ${c.row},${c.col}`);
      // No two placements conflict: a shared cell must want the same letter.
      const k = c.row * p.n + c.col;
      if (owner.has(k)) assertEqual(owner.get(k), w.word[i], `${tag}: two words disagree at ${c.row},${c.col}`);
      owner.set(k, w.word[i]);
    });
    // Exactly one straight-line occurrence, by an independent count and by the engine's.
    assertEqual(occurrences(p.grid, p.n, w.word), 1, `${tag}: ${w.word} is readable more than once — ambiguous puzzle`);
    assertEqual(findAll(p.grid, p.n, w.word).length, 1, `${tag}: findAll disagrees for ${w.word}`);
    // The finder accepts the word forwards and backwards along its line…
    const e = endOf(w);
    const fwd = findWord(p, w.row, w.col, e.row, e.col);
    assertTrue(fwd && fwd.word === w.word && fwd.reversed === false, `${tag}: ${w.word} not found forwards`);
    const bwd = findWord(p, e.row, e.col, w.row, w.col);
    assertTrue(bwd && bwd.word === w.word && bwd.reversed === true, `${tag}: ${w.word} not found backwards`);
    // …and refuses a misaligned selection: one cell short, one cell long
    // (when in the grid), and a knight's-move end cell.
    const short = findWord(p, w.row, w.col, e.row - w.dy, e.col - w.dx);
    assertTrue(short && !short.word, `${tag}: ${w.word} minus its last letter counted as a word`);
    const lr = e.row + w.dy, lc = e.col + w.dx;
    if (lr >= 0 && lr < p.n && lc >= 0 && lc < p.n) {
      const long = findWord(p, w.row, w.col, lr, lc);
      assertTrue(long && !long.word, `${tag}: ${w.word} plus one letter counted as a word`);
    }
    // A crooked end: step the end cell one off the line, sideways.
    const side = w.dx === 0 ? { row: e.row, col: e.col + (e.col + 1 < p.n ? 1 : -1) } : { row: e.row + (e.row + 1 < p.n ? 1 : -1), col: e.col };
    if (w.word.length >= 3) {
      const crooked = findWord(p, w.row, w.col, side.row, side.col);
      assertTrue(!crooked || !crooked.word, `${tag}: ${w.word} found on a crooked line to ${side.row},${side.col}`);
    }
  }
  // No word hides inside another word of the same puzzle.
  const words = p.words.map((w) => w.word);
  for (const a of words) for (const b of words) if (a !== b) assertTrue(!overlaps(a, b), `${tag}: ${b} hides inside ${a} (one way round)`);
}

test(`generate: every theme × size × directions × ${SEED_COUNT} seeds — never throws, every placement sound, never ambiguous`, () => {
  let count = 0;
  for (let themeIndex = 0; themeIndex < THEMES.length; themeIndex++) {
    for (const size of SIZE_KEYS) for (const directions of DIR_KEYS) {
      for (let s = 1; s <= SEED_COUNT; s++) {
        const seed = s * 7919 + themeIndex * 131 + (size === "large" ? 3 : size === "medium" ? 2 : 1);
        let p;
        try { p = generate({ seed, size, directions, theme: themeIndex }); }
        catch (err) { throw new Error(`generate threw for seed ${seed} ${size} ${directions} ${THEMES[themeIndex].name}: ${err.message}`); }
        checkPuzzle(p, { seed, size, directions, themeIndex });
        count++;
      }
    }
  }
  assertEqual(count, THEMES.length * SIZE_KEYS.length * DIR_KEYS.length * SEED_COUNT, "every combination ran");
});

test("pickWords never pairs a word with one that hides it read either way round (MOSS in BLOSSOM backwards)", () => {
  assertTrue(overlaps("MOSS", "BLOSSOM"), "MOSS reversed is inside BLOSSOM");
  assertTrue(overlaps("BLOSSOM", "MOSS"), "symmetric");
  assertTrue(overlaps("ROSE", "PRIMROSE"));
  assertTrue(!overlaps("ROSE", "TULIP"));
  for (const th of THEMES) for (let seed = 1; seed <= 60; seed++) {
    const words = pickWords(th.words, SIZES.large.words, SIZES.large.maxLen, makeRng(seed));
    assertTrue(words && words.length === SIZES.large.words, `${th.name} seed ${seed}: picked a full set`);
    for (const a of words) for (const b of words) if (a !== b) assertTrue(!overlaps(a, b), `${th.name} seed ${seed}: ${a} and ${b} overlap`);
  }
});

test("generate never takes long: the slowest of 400 large puzzles (after warm-up) is under 80 ms", () => {
  for (let seed = 1; seed <= 30; seed++) generate({ seed, size: "large", directions: "all" });
  let worst = 0;
  for (let seed = 50000; seed < 50400; seed++) {
    for (const directions of DIR_KEYS) {
      const t0 = performance.now();
      generate({ seed, size: "large", directions });
      worst = Math.max(worst, performance.now() - t0);
    }
  }
  assertTrue(worst < 80, `slowest generate took ${worst.toFixed(1)} ms (a MOSS/BLOSSOM pick used to cost ~300 ms)`);
});

test("daily seeds: every day of 2026 generates for every size and direction, is stable, and differs from the day before", () => {
  let prev = null;
  for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const seed = dailySeed(d);
    assertTrue(isDailySeed(seed), `${seed} is a daily seed`);
    assertEqual(dailySeed(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)), seed, "the seed holds all day");
    const themeIndex = dailyThemeIndex(seed);
    for (const size of SIZE_KEYS) for (const directions of DIR_KEYS) {
      const a = generate({ seed, size, directions });
      assertTrue(a.daily, `${seed} flagged daily`);
      checkPuzzle(a, { seed, size, directions, themeIndex });
      const b = generate({ seed, size, directions });
      assertEqual(a, b, `${seed} ${size} ${directions}: same puzzle twice`);
    }
    const today = generate({ seed, size: "small", directions: "easy" });
    if (prev) {
      assertTrue(prev.grid !== today.grid, `${seed}: differs from the day before`);
      assertEqual(today.themeIndex, (prev.themeIndex + 1) % THEMES.length, `${seed}: next theme in the rotation`);
    }
    prev = today;
  }
});

test("hintFor on a fuzzed puzzle always points at the first letter of an unfound word and walks the whole list", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const p = generate({ seed, size: "medium", directions: "all" });
    const found = [];
    let last = null;
    const visited = new Set();
    for (let i = 0; i < p.words.length * 2; i++) {
      const h = hintFor(p, found, last);
      assertTrue(h && !found.includes(h.word), "hint names an unfound word");
      assertEqual(letterAt(p, h.row, h.col), h.word[0], "hint cell holds the first letter");
      const placed = p.words.find((w) => w.word === h.word);
      assertEqual([placed.row, placed.col], [h.row, h.col], "hint cell is the placed start");
      visited.add(h.word);
      last = h.word;
    }
    assertEqual(visited.size, p.words.length, `seed ${seed}: repeated hints reach every word`);
    // Finding words one at a time never strands the hint.
    for (const w of p.words) { found.push(w.word); const h = hintFor(p, found, last); assertTrue(found.length === p.words.length ? h === null : h && !found.includes(h.word)); }
  }
});

// ---------------------------------------------------------------------
// the word lists
// ---------------------------------------------------------------------
test("word lists: uppercase A–Z only, unique within a theme, 4–10 letters, and every theme can fill every size without a word hiding inside another", () => {
  for (const th of THEMES) {
    const set = new Set();
    for (const w of th.words) {
      assertTrue(/^[A-Z]+$/.test(w), `${th.name}: ${w} is not A–Z`);
      assertTrue(w.length >= MIN_WORD && w.length <= SIZES.large.maxLen, `${th.name}: ${w} length`);
      assertTrue(!set.has(w), `${th.name}: ${w} listed twice`);
      set.add(w);
    }
    for (const size of Object.values(SIZES)) {
      // Enough words fit the size even after refusing every pair where
      // one hides inside the other: a greedy pick from the longest
      // substring-free set must reach the count.
      const fit = th.words.filter((w) => w.length <= size.maxLen);
      const free = [];
      for (const w of fit) if (!free.some((f) => f.includes(w) || w.includes(f))) free.push(w);
      assertTrue(free.length >= size.words + 2, `${th.name} ${size.key}: only ${free.length} substring-free words for ${size.words} needed`);
    }
  }
});

test("cellsOnLine and findWord refuse every non-straight pair on a 6×6 board, and the engine's line matches a brute-force one", () => {
  const p = generate({ seed: 77, size: "small", directions: "all" });
  for (let r1 = 0; r1 < p.n; r1++) for (let c1 = 0; c1 < p.n; c1++) for (let r2 = 0; r2 < p.n; r2++) for (let c2 = 0; c2 < p.n; c2++) {
    const dr = r2 - r1, dc = c2 - c1;
    const straight = dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc);
    const line = cellsOnLine(r1, c1, r2, c2);
    assertEqual(line !== null, straight, `line ${r1},${c1}→${r2},${c2}`);
    const f = findWord(p, r1, c1, r2, c2);
    assertEqual(f !== null, straight, `findWord ${r1},${c1}→${r2},${c2}`);
    if (straight) {
      assertEqual(line.length, Math.max(Math.abs(dr), Math.abs(dc)) + 1);
      assertEqual(line[0], { row: r1, col: c1 });
      assertEqual(line[line.length - 1], { row: r2, col: c2 });
    }
  }
});
