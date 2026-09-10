// game/daily.js
// Daily Challenge: every player on Earth gets the SAME board on the same
// day, with no server involved at all. The whole trick is a deterministic
// PRNG seeded from the date, fed into game/quickstart.js's ALREADY
// EXISTING rng-injection point — this file adds zero new board-generation
// logic of its own, it only decides what seed/size/difficulty to hand
// quickstart.js for a given date.
//
// --- UTC, not local time (see CLAUDE.md's design-decision note for the
// full reasoning) ---
//
// Local time was rejected: a player who flies (or just changes their
// system clock) across a time zone boundary can see the SAME calendar
// date twice, or NEVER see one at all, which would either let them
// replay a day's challenge or silently skip one — undermining the one
// property this whole feature exists to guarantee (everyone gets
// today's board exactly once). UTC has a real cost too — a player in,
// say, UTC+9 sees their challenge flip over at 9am local time, not
// midnight — but that's a UX quirk, not a correctness bug, and it's the
// same quirk every worldwide-daily game (Wordle included) already
// accepts. Determinism beats a locally-intuitive midnight.
//
// --- Anti-cheat: deliberately not attempted ---
//
// Nothing here stops a player from changing their device clock and
// replaying. There's no server to notice, so this is only ever
// enforceable client-side, and client-side enforcement against a player
// who controls their own clock is a fight this project isn't going to
// try to win (CLAUDE.md's build size / no-server / no-login constraints
// rule out the only approaches that would actually work). This is a
// casual portal game, not a competitive one — not worth the effort.

import { generateQuickStart } from "./quickstart.js";

// One size+difficulty pair per UTC day-of-week (Date#getUTCDay(): 0 =
// Sunday ... 6 = Saturday), ramping up toward the weekend. This is
// literally "결정된 by the date" (today's weekday IS a deterministic
// function of the date), just without spending extra draws from the same
// rng that generates the board — keeping the rng's entire sequence
// dedicated to one job (the board) makes it trivial to reason about and
// test in isolation from "which size/difficulty did we pick."
const DAILY_WEEKLY_PATTERN = [
  { gridSize: 5, difficulty: "medium" }, // Sunday
  { gridSize: 3, difficulty: "easy" }, // Monday
  { gridSize: 3, difficulty: "medium" }, // Tuesday
  { gridSize: 5, difficulty: "easy" }, // Wednesday
  { gridSize: 5, difficulty: "medium" }, // Thursday
  { gridSize: 5, difficulty: "hard" }, // Friday
  { gridSize: 7, difficulty: "hard" }, // Saturday
];

/**
 * mulberry32: a small, fast, deterministic PRNG (public-domain algorithm,
 * commonly attributed to Tommy Ettinger). Same seed -> the exact same
 * infinite sequence of [0,1) values, on every browser/device/JS engine,
 * forever. That guarantee is the entire feature — Math.random() gives no
 * such promise (its algorithm is explicitly implementation-defined by
 * spec), which is exactly why CLAUDE.md-established convention across
 * this codebase (game/ai.js, game/quickstart.js, core/turn.js) already
 * threads an injectable `rng` parameter everywhere instead of calling
 * Math.random() directly deep inside game logic — this is that same
 * pattern, just seeded from the date instead of left at its default.
 * @param {number} seed - any integer; only the low 32 bits are used
 * @returns {() => number} an rng function, same [0,1) contract as every
 *   other rng parameter in this codebase
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {Date} [date]
 * @returns {string} "YYYY-MM-DD" in UTC — the canonical key for "which
 *   day's challenge is this," used for storage and streak comparisons.
 */
export function utcDateString(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * @param {Date} [date]
 * @returns {number} the UTC calendar date as a YYYYMMDD integer, used
 *   directly as the PRNG seed.
 */
export function utcDateSeed(date = new Date()) {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/**
 * @param {Date} [date]
 * @returns {{gridSize: number, difficulty: 'easy'|'medium'|'hard'}}
 */
export function dailyConfigForDate(date = new Date()) {
  return DAILY_WEEKLY_PATTERN[date.getUTCDay()];
}

/**
 * Generate today's (or `date`'s) shared board. Everything about the
 * result is a pure function of the calendar date — same date in, byte-
 * for-byte identical hEdges/vEdges/gridSize/difficulty out, on any
 * machine.
 * @param {Date} [date]
 * @returns {{state: object, gridSize: number, difficulty: 'easy'|'medium'|'hard', dateString: string, seed: number}}
 */
export function generateDailyBoard(date = new Date()) {
  const dateString = utcDateString(date);
  const seed = utcDateSeed(date);
  const { gridSize, difficulty } = dailyConfigForDate(date);
  const rng = mulberry32(seed);
  // Reuses game/quickstart.js's existing rng-injection point verbatim —
  // this file adds no board-generation logic of its own, and inherits
  // that module's "never hands out a free capturable box" guarantee for
  // free (see quickstart.js's own module comment).
  const state = generateQuickStart(gridSize, gridSize, rng);
  return { state, gridSize, difficulty, dateString, seed };
}

// --- streak logic ---------------------------------------------------
//
// Pure decision logic only — this module has no idea storage.js exists.
// The caller (main.js) reads/writes core/storage.js's daily facts and
// asks THIS function what the new streak number should be, the same
// storage-is-dumb-facts / game-module-is-the-decider split established
// by game/achievements.js in milestone 13-2.

function utcDayNumber(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * True iff `todayDateString` is exactly the UTC calendar day immediately
 * after `prevDateString` — the one thing that has to be handled with
 * real date arithmetic (Date.UTC), not string manipulation, since "the
 * next day" crosses month and year boundaries (Jan 31 -> Feb 1, Dec 31 ->
 * Jan 1) that a naive string increment would get wrong.
 * @param {string | null} prevDateString
 * @param {string} todayDateString
 * @returns {boolean}
 */
export function isNextUtcDay(prevDateString, todayDateString) {
  if (!prevDateString) return false;
  return utcDayNumber(todayDateString) - utcDayNumber(prevDateString) === 1;
}

/**
 * The new currentStreak after today's daily result. A loss (or a draw —
 * "beat the AI" means an outright win, see CLAUDE.md's daily rules)
 * always resets to 0, matching the spec's "실패해도 리셋." A win only
 * EXTENDS the streak if yesterday's challenge was also played (and, by
 * the invariant this function itself maintains, therefore also won —
 * currentStreak is already 0 after any loss, so a non-consecutive OR
 * loss-preceded win both correctly land on exactly 1, not 0+1-from-a-
 * loss vs 1-from-a-gap needing to be told apart).
 * @param {{currentStreak: number, lastPlayedDate: string|null, todayDateString: string, won: boolean}} args
 * @returns {number}
 */
export function nextDailyStreak({ currentStreak, lastPlayedDate, todayDateString, won }) {
  if (!won) return 0;
  return isNextUtcDay(lastPlayedDate, todayDateString) ? currentStreak + 1 : 1;
}

/**
 * @param {{lastPlayedDate: string|null}} dailyState - core/storage.js's getDailyState()
 * @param {string} todayDateString
 * @returns {boolean}
 */
export function hasPlayedDailyToday(dailyState, todayDateString) {
  return dailyState.lastPlayedDate === todayDateString;
}

// --- "next challenge" countdown --------------------------------------

/**
 * @param {Date} [now]
 * @returns {number} milliseconds until the next UTC midnight (always >= 0)
 */
export function msUntilNextUtcMidnight(now = new Date()) {
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(0, nextMidnight - now.getTime());
}

/**
 * @param {number} ms - non-negative
 * @returns {string} "HH:MM:SS", zero-padded
 */
export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
