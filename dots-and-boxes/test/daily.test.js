// test/daily.test.js
// game/daily.js's entire feature depends on one property above all
// others: the SAME date must always produce the EXACT same board, on
// any machine, any number of times. That's the first test below, and
// it's the one that matters most — see the milestone note in CLAUDE.md.

import {
  mulberry32,
  utcDateString,
  utcDateSeed,
  dailyConfigForDate,
  generateDailyBoard,
  isNextUtcDay,
  nextDailyStreak,
  hasPlayedDailyToday,
  msUntilNextUtcMidnight,
  formatCountdown,
} from "../src/game/daily.js";
import { analyze } from "../src/game/chains.js";
import { serializePosition } from "../src/game/position.js";
import { test, assertEqual, assertTrue } from "./harness.js";

function utcDate(y, m, d, h = 12, min = 0, s = 0) {
  return new Date(Date.UTC(y, m - 1, d, h, min, s));
}

// --- determinism (the most important property) ------------------------

test("generateDailyBoard: the SAME date produces a byte-for-byte identical board, every time", () => {
  const d = utcDate(2026, 8, 16);
  const a = generateDailyBoard(d);
  const b = generateDailyBoard(d);
  const c = generateDailyBoard(utcDate(2026, 8, 16, 23, 59, 59)); // same UTC calendar day, different time-of-day
  assertEqual(serializePosition(a.state), serializePosition(b.state));
  assertEqual(serializePosition(a.state), serializePosition(c.state));
  assertEqual(a.gridSize, b.gridSize);
  assertEqual(a.difficulty, b.difficulty);
  assertEqual(a.seed, b.seed);
  assertEqual(a.dateString, "2026-08-16");
});

test("generateDailyBoard: two different dates produce different boards (overwhelmingly likely, and true for these two)", () => {
  const a = generateDailyBoard(utcDate(2026, 8, 16));
  const b = generateDailyBoard(utcDate(2026, 8, 17));
  assertTrue(
    serializePosition(a.state) !== serializePosition(b.state) || a.gridSize !== b.gridSize,
    "different dates should not coincidentally produce the identical board"
  );
});

test("mulberry32: same seed -> identical sequence; different seed -> diverges immediately", () => {
  const a = mulberry32(20260816);
  const b = mulberry32(20260816);
  const c = mulberry32(20260817);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  const seqC = [c(), c(), c()];
  assertEqual(seqA, seqB);
  assertTrue(seqA[0] !== seqC[0], "a different seed should not coincidentally produce the same first value");
});

test("mulberry32: every value is within [0, 1)", () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 500; i++) {
    const v = rng();
    assertTrue(v >= 0 && v < 1, `value ${v} out of [0,1) range`);
  }
});

// --- the quickstart invariant must still hold --------------------------

test("generateDailyBoard: the generated board still has zero capturable boxes (quickstart.js's own invariant)", () => {
  for (const [y, m, dd] of [[2026, 8, 16], [2026, 12, 25], [2027, 1, 1], [2026, 2, 28]]) {
    const board = generateDailyBoard(utcDate(y, m, dd));
    assertEqual(analyze(board.state).capturableBoxes, [], `${y}-${m}-${dd}: a free box slipped through`);
  }
});

// --- seed / date-string derivation --------------------------------------

test("utcDateString: formats as YYYY-MM-DD, zero-padded, in UTC", () => {
  assertEqual(utcDateString(utcDate(2026, 1, 5)), "2026-01-05");
  assertEqual(utcDateString(utcDate(2026, 12, 31)), "2026-12-31");
});

test("utcDateString: uses UTC fields, not local ones (a date near local midnight doesn't shift)", () => {
  // 2026-08-16T00:30:00Z is still Aug 16 in UTC no matter what the host
  // machine's local timezone is -- new Date(...) with explicit UTC.
  const d = new Date(Date.UTC(2026, 7, 16, 0, 30, 0));
  assertEqual(utcDateString(d), "2026-08-16");
});

test("utcDateSeed: YYYYMMDD as an integer", () => {
  assertEqual(utcDateSeed(utcDate(2026, 8, 16)), 20260816);
  assertEqual(utcDateSeed(utcDate(2026, 1, 5)), 20260105);
});

test("dailyConfigForDate: every day of a week returns one of the known grid sizes and difficulties", () => {
  const validSizes = new Set([3, 5, 7]);
  const validDifficulties = new Set(["easy", "medium", "hard"]);
  for (let day = 16; day <= 22; day++) {
    const cfg = dailyConfigForDate(utcDate(2026, 8, day));
    assertTrue(validSizes.has(cfg.gridSize), `day ${day}: invalid gridSize ${cfg.gridSize}`);
    assertTrue(validDifficulties.has(cfg.difficulty), `day ${day}: invalid difficulty ${cfg.difficulty}`);
  }
});

test("dailyConfigForDate: the same weekday always gets the same config (deterministic by date)", () => {
  const a = dailyConfigForDate(utcDate(2026, 8, 16)); // a Sunday
  const b = dailyConfigForDate(utcDate(2026, 8, 23)); // the following Sunday
  assertEqual(a, b);
});

// --- streak transitions --------------------------------------------------

test("streak: a win the day right after a win extends the streak", () => {
  const next = nextDailyStreak({
    currentStreak: 3,
    lastPlayedDate: "2026-08-15",
    todayDateString: "2026-08-16",
    won: true,
  });
  assertEqual(next, 4);
});

test("streak: a win with no prior play (first ever daily) starts at 1", () => {
  const next = nextDailyStreak({ currentStreak: 0, lastPlayedDate: null, todayDateString: "2026-08-16", won: true });
  assertEqual(next, 1);
});

test("streak: skipping a day (a gap) resets a win to 1, not currentStreak+1", () => {
  const next = nextDailyStreak({
    currentStreak: 5,
    lastPlayedDate: "2026-08-10", // 6 days before today -- a big gap
    todayDateString: "2026-08-16",
    won: true,
  });
  assertEqual(next, 1);
});

test("streak: a loss resets to 0 even if yesterday's streak was long", () => {
  const next = nextDailyStreak({
    currentStreak: 9,
    lastPlayedDate: "2026-08-15",
    todayDateString: "2026-08-16",
    won: false,
  });
  assertEqual(next, 0);
});

test("streak: a loss resets to 0 regardless of whether yesterday was played at all", () => {
  const next = nextDailyStreak({ currentStreak: 0, lastPlayedDate: null, todayDateString: "2026-08-16", won: false });
  assertEqual(next, 0);
});

test("streak: winning again right after a broken streak starts over at 1, not +1", () => {
  // Yesterday's own result was a loss (so currentStreak is already 0
  // going in), and today is a win, played on the consecutive day.
  const next = nextDailyStreak({
    currentStreak: 0,
    lastPlayedDate: "2026-08-15",
    todayDateString: "2026-08-16",
    won: true,
  });
  assertEqual(next, 1);
});

// --- date-boundary (midnight) handling ------------------------------------

test("isNextUtcDay: consecutive calendar days across a month boundary", () => {
  assertTrue(isNextUtcDay("2026-01-31", "2026-02-01"));
  assertTrue(isNextUtcDay("2026-02-28", "2026-03-01")); // 2026 is not a leap year
});

test("isNextUtcDay: consecutive calendar days across a YEAR boundary", () => {
  assertTrue(isNextUtcDay("2025-12-31", "2026-01-01"));
});

test("isNextUtcDay: a leap-day February is handled correctly", () => {
  assertTrue(isNextUtcDay("2028-02-28", "2028-02-29")); // 2028 IS a leap year
  assertTrue(isNextUtcDay("2028-02-29", "2028-03-01"));
});

test("isNextUtcDay: same day, a 2-day gap, or reversed order are all false", () => {
  assertTrue(!isNextUtcDay("2026-08-16", "2026-08-16"));
  assertTrue(!isNextUtcDay("2026-08-14", "2026-08-16"));
  assertTrue(!isNextUtcDay("2026-08-16", "2026-08-15"), "today before prev -- not \"next\"");
});

test("isNextUtcDay: null/no prior play is never \"consecutive\"", () => {
  assertTrue(!isNextUtcDay(null, "2026-08-16"));
});

test("hasPlayedDailyToday: compares lastPlayedDate to today's date string exactly", () => {
  assertTrue(hasPlayedDailyToday({ lastPlayedDate: "2026-08-16" }, "2026-08-16"));
  assertTrue(!hasPlayedDailyToday({ lastPlayedDate: "2026-08-15" }, "2026-08-16"));
  assertTrue(!hasPlayedDailyToday({ lastPlayedDate: null }, "2026-08-16"));
});

// --- countdown -------------------------------------------------------------

test("msUntilNextUtcMidnight: exactly 24h when now is precisely UTC midnight", () => {
  const now = new Date(Date.UTC(2026, 7, 16, 0, 0, 0, 0));
  assertEqual(msUntilNextUtcMidnight(now), 24 * 3600 * 1000);
});

test("msUntilNextUtcMidnight: a few seconds when now is just before midnight", () => {
  const now = new Date(Date.UTC(2026, 7, 16, 23, 59, 55, 0));
  assertEqual(msUntilNextUtcMidnight(now), 5000);
});

test("msUntilNextUtcMidnight: correctly rolls over a month/year boundary", () => {
  const now = new Date(Date.UTC(2025, 11, 31, 23, 0, 0, 0)); // Dec 31, 23:00 UTC
  assertEqual(msUntilNextUtcMidnight(now), 3600 * 1000);
});

test("formatCountdown: zero-padded HH:MM:SS", () => {
  assertEqual(formatCountdown(5000), "00:00:05");
  assertEqual(formatCountdown(3661 * 1000), "01:01:01");
  assertEqual(formatCountdown(23 * 3600 * 1000 + 59 * 60 * 1000 + 59 * 1000), "23:59:59");
});

test("formatCountdown: never goes negative even if handed a negative ms value", () => {
  assertEqual(formatCountdown(-500), "00:00:00");
});
