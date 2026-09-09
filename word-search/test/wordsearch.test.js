// test/wordsearch.test.js — the puzzle engine: every word placed without
// conflicts, the same seed giving the same puzzle, the direction setting
// respected, selections found forwards and backwards, the daily seed.
import { test, assertEqual, assertTrue, assertThrows } from "./harness.js";
import {
  SIZES, DIRECTIONS, makeRng, shuffle, dailySeed, dateOfSeed, isDailySeed, dailyThemeIndex, randomSeed,
  pickWords, placeWords, fillCells, findAll, generate, letterAt, cellsOnLine, findWord, isComplete, hintFor, endOf,
} from "../src/game/wordsearch.js";
import { THEMES } from "../src/game/words.js";

const SEEDS = [1, 2, 3, 7, 42, 318, 4217, 99999, 20260909, 20261225];

function readWord(p, w) {
  let s = "";
  for (let i = 0; i < w.word.length; i++) s += letterAt(p, w.row + w.dy * i, w.col + w.dx * i);
  return s;
}

// ---------------------------------------------------------------------
// word lists
// ---------------------------------------------------------------------
test("every theme has 20–30 uppercase A–Z words of 4–10 letters, no duplicates, an id and a name", () => {
  assertTrue(THEMES.length >= 12, "at least 12 themes");
  for (const th of THEMES) {
    assertTrue(/^theme[A-Z][A-Za-z]+$/.test(th.id), "id " + th.id);
    assertTrue(typeof th.name === "string" && th.name.length > 0, "name");
    assertTrue(th.words.length >= 20 && th.words.length <= 30, `${th.name}: ${th.words.length} words`);
    assertEqual(new Set(th.words).size, th.words.length, `${th.name}: duplicate word`);
    for (const w of th.words) assertTrue(/^[A-Z]{4,10}$/.test(w), `${th.name}: bad word ${w}`);
  }
  assertEqual(new Set(THEMES.map((t) => t.id)).size, THEMES.length, "unique ids");
});

test("every theme can supply words for every size (enough short words)", () => {
  for (const th of THEMES) for (const size of Object.values(SIZES)) {
    const ok = pickWords(th.words, size.words, size.maxLen, makeRng(1));
    assertTrue(ok && ok.length === size.words, `${th.name} ${size.key}`);
  }
});

// ---------------------------------------------------------------------
// rng
// ---------------------------------------------------------------------
test("makeRng is deterministic and in [0,1)", () => {
  const a = makeRng(123), b = makeRng(123);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assertEqual(x, b());
    assertTrue(x >= 0 && x < 1);
  }
  assertTrue(makeRng(1)() !== makeRng(2)(), "different seeds differ");
});

test("shuffle keeps the items and does not touch the input", () => {
  const input = ["A", "B", "C", "D", "E"];
  const out = shuffle(input, makeRng(5));
  assertEqual(input, ["A", "B", "C", "D", "E"]);
  assertEqual(out.slice().sort(), input);
});

// ---------------------------------------------------------------------
// generator
// ---------------------------------------------------------------------
test("generate places every word without conflicts, for every size, direction setting and theme", () => {
  for (const size of Object.keys(SIZES)) for (const directions of Object.keys(DIRECTIONS)) {
    for (let theme = 0; theme < THEMES.length; theme++) {
      const p = generate({ seed: 1000 + theme, size, directions, theme });
      const spec = SIZES[size];
      assertEqual(p.n, spec.n);
      assertEqual(p.words.length, spec.words, `${size}/${directions}/${THEMES[theme].name}: word count`);
      assertEqual(p.grid.length, spec.n * spec.n);
      assertTrue(/^[A-Z]+$/.test(p.grid), "grid is A–Z");
      assertEqual(p.theme, THEMES[theme].id);
      assertEqual(p.themeName, THEMES[theme].name);
      const seen = new Set();
      for (const w of p.words) {
        assertTrue(w.word.length <= spec.maxLen, `${w.word} too long for ${size}`);
        assertTrue(THEMES[theme].words.includes(w.word), `${w.word} is in the ${THEMES[theme].name} list`);
        assertTrue(!seen.has(w.word), "no repeated word");
        seen.add(w.word);
        assertEqual(readWord(p, w), w.word, `${w.word} reads back from the grid`);
        const e = endOf(w);
        assertTrue(e.row >= 0 && e.row < p.n && e.col >= 0 && e.col < p.n, `${w.word} inside the grid`);
      }
    }
  }
});

test("no word hides inside another in the same puzzle, and each appears exactly once in the grid", () => {
  for (const seed of SEEDS) for (const size of Object.keys(SIZES)) {
    const p = generate({ seed, size, directions: "all" });
    const words = p.words.map((w) => w.word);
    for (const a of words) for (const b of words) if (a !== b) assertTrue(!a.includes(b), `${b} inside ${a}`);
    for (const w of words) assertEqual(findAll(p.grid, p.n, w).length, 1, `${w} appears once (seed ${seed} ${size})`);
  }
});

test("generate is deterministic per seed, and different seeds differ", () => {
  for (const seed of SEEDS) {
    const a = generate({ seed, size: "medium", directions: "all" });
    const b = generate({ seed, size: "medium", directions: "all" });
    assertEqual(a, b, "same seed, same puzzle");
  }
  const a = generate({ seed: 1, size: "small" }), b = generate({ seed: 2, size: "small" });
  assertTrue(a.grid !== b.grid, "different seeds give different grids");
});

test("Easy places words across and down only; All directions uses diagonals and backwards over many seeds", () => {
  let diag = 0, back = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const easy = generate({ seed, size: "medium", directions: "easy" });
    for (const w of easy.words) assertTrue((w.dx === 1 && w.dy === 0) || (w.dx === 0 && w.dy === 1), `easy: ${w.word} ${w.dx},${w.dy}`);
    const all = generate({ seed, size: "medium", directions: "all" });
    for (const w of all.words) {
      assertTrue(Math.abs(w.dx) <= 1 && Math.abs(w.dy) <= 1 && (w.dx || w.dy), "unit direction");
      if (w.dx && w.dy) diag++;
      if (w.dx < 0 || w.dy < 0) back++;
    }
  }
  assertTrue(diag > 0, "some diagonal words");
  assertTrue(back > 0, "some backwards words");
});

test("generate rejects bad input", () => {
  assertThrows(() => generate({ seed: 1.5 }), /seed/);
  assertThrows(() => generate({ seed: 1, size: "huge" }), /size/);
  assertThrows(() => generate({ seed: 1, directions: "sideways" }), /directions/);
});

test("placeWords returns null when a word cannot fit, and fillCells only fills blanks", () => {
  assertEqual(placeWords(4, ["ELEPHANT"], DIRECTIONS.easy, makeRng(1)), null);
  const placed = placeWords(5, ["ROSE", "LILY"], DIRECTIONS.easy, makeRng(3));
  assertTrue(placed !== null);
  const filled = fillCells(placed.cells, ["ROSE", "LILY"], makeRng(9));
  placed.cells.forEach((c, k) => { if (c !== "") assertEqual(filled[k], c); else assertTrue(/^[A-Z]$/.test(filled[k])); });
});

// ---------------------------------------------------------------------
// the calendar
// ---------------------------------------------------------------------
test("dailySeed is YYYYMMDD of the local date and round-trips through dateOfSeed", () => {
  assertEqual(dailySeed(new Date(2026, 8, 9)), 20260909);
  assertEqual(dailySeed(new Date(2026, 0, 1)), 20260101);
  assertEqual(dailySeed(new Date(2026, 11, 31)), 20261231);
  const d = dateOfSeed(20260909);
  assertEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 8, 9]);
  assertTrue(isDailySeed(20260909));
  assertTrue(!isDailySeed(20260931), "September 31 is not a date");
  assertTrue(!isDailySeed(318), "a puzzle number is not a date");
  assertTrue(!isDailySeed(20261301));
});

test("today's theme rotates one per day and wraps", () => {
  const a = dailyThemeIndex(20260909), b = dailyThemeIndex(20260910), c = dailyThemeIndex(20260909 + 0);
  assertEqual(a, c);
  assertEqual(b, (a + 1) % THEMES.length);
  for (let d = 1; d <= 28; d++) {
    const i = dailyThemeIndex(20260200 + d);
    assertTrue(i >= 0 && i < THEMES.length);
  }
});

test("a daily seed picks the day's theme and is flagged daily; a random seed is not", () => {
  const p = generate({ seed: 20260909, size: "small" });
  assertTrue(p.daily);
  assertEqual(p.themeIndex, dailyThemeIndex(20260909));
  const q = generate({ seed: 318, size: "small" });
  assertTrue(!q.daily);
  for (let i = 0; i < 50; i++) { const s = randomSeed(); assertTrue(s >= 1 && s <= 99999 && !isDailySeed(s)); }
});

// ---------------------------------------------------------------------
// playing
// ---------------------------------------------------------------------
test("cellsOnLine: across, down, diagonal; null otherwise", () => {
  assertEqual(cellsOnLine(0, 0, 0, 2), [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }]);
  assertEqual(cellsOnLine(2, 1, 0, 1), [{ row: 2, col: 1 }, { row: 1, col: 1 }, { row: 0, col: 1 }]);
  assertEqual(cellsOnLine(0, 0, 2, 2).length, 3);
  assertEqual(cellsOnLine(3, 3, 1, 5), [{ row: 3, col: 3 }, { row: 2, col: 4 }, { row: 1, col: 5 }]);
  assertEqual(cellsOnLine(0, 0, 1, 2), null);
  assertEqual(cellsOnLine(1, 1, 1, 1), [{ row: 1, col: 1 }]);
});

test("findWord accepts a word selected forwards and backwards, refuses part of a word, a crooked line, and filler", () => {
  for (const seed of SEEDS) {
    const p = generate({ seed, size: "large", directions: "all" });
    for (const w of p.words) {
      const e = endOf(w);
      const fwd = findWord(p, w.row, w.col, e.row, e.col);
      assertEqual(fwd.word, w.word, "forwards");
      assertEqual(fwd.reversed, false);
      const bwd = findWord(p, e.row, e.col, w.row, w.col);
      assertEqual(bwd.word, w.word, "backwards");
      assertEqual(bwd.reversed, true);
      // One letter short is never a word (no word hides inside another).
      const part = findWord(p, w.row, w.col, e.row - w.dy, e.col - w.dx);
      assertTrue(part && !part.word, "part of a word is not a word");
    }
  }
  const p = generate({ seed: 5, size: "small", directions: "easy" });
  assertEqual(findWord(p, 0, 0, 1, 2), null, "crooked");
});

test("isComplete and hintFor", () => {
  const p = generate({ seed: 11, size: "small" });
  const words = p.words.map((w) => w.word);
  assertTrue(!isComplete(p, []));
  assertTrue(!isComplete(p, words.slice(1)));
  assertTrue(isComplete(p, words));
  assertTrue(isComplete(p, words.slice().reverse()));
  const h = hintFor(p, []);
  assertEqual(h.word, words[0]);
  assertEqual(h.letter, words[0][0]);
  assertEqual(letterAt(p, h.row, h.col), words[0][0]);
  assertEqual(hintFor(p, [words[0]]).word, words[1], "skips found words");
  assertEqual(hintFor(p, [], words[0]).word, words[1], "walks on from the last hint");
  assertEqual(hintFor(p, [], words[words.length - 1]).word, words[0], "wraps round");
  assertEqual(hintFor(p, words), null);
});
