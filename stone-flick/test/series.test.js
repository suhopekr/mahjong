// test/series.test.js
// The match format exists to remove an advantage, so the tests are about
// SYMMETRY and about the ladder being readable — not about any one score.
import { test, assertEqual, assertTrue } from "./harness.js";
import {
  createSeries,
  openerFor,
  hasNextRound,
  recordRound,
  recordDrawShot,
  seriesOutcome,
  ROUNDS_PER_MATCH,
} from "../src/game/series.js";

const round = (winner, alive, shots) => ({ winner, alive, shots });

test("each player opens exactly one round", () => {
  for (const opener of [0, 1]) {
    const series = createSeries({ stoneCount: 5, opener });
    const openers = [];
    while (hasNextRound(series)) {
      openers.push(openerFor(series));
      recordRound(series, round(0, [3, 0], [4, 4]));
    }
    assertEqual(openers.length, ROUNDS_PER_MATCH);
    assertEqual(new Set(openers).size, 2, `both sides must open once, got ${openers}`);
  }
});

test("a match is not decided until both rounds are in", () => {
  const series = createSeries({ stoneCount: 5, opener: 0 });
  recordRound(series, round(0, [4, 0], [3, 3]));
  const half = seriesOutcome(series);
  assertEqual(half.complete, false);
  assertEqual(half.winner, null, "one round is not a match");
});

test("rounds won settles it when it can", () => {
  const series = createSeries({ stoneCount: 5, opener: 0 });
  recordRound(series, round(0, [2, 0], [5, 5]));
  recordRound(series, round(0, [1, 0], [6, 6]));
  const out = seriesOutcome(series);
  assertEqual(out.winner, 0);
  assertEqual(out.reason, "rounds");
});

test("one round each falls to stones kept", () => {
  const series = createSeries({ stoneCount: 5, opener: 0 });
  recordRound(series, round(0, [1, 0], [5, 5])); // squeaked it
  recordRound(series, round(1, [0, 4], [4, 4])); // took it comfortably
  const out = seriesOutcome(series);
  assertEqual(out.winner, 1, "4 stones kept beats 1");
  assertEqual(out.reason, "stones");
});

test("level on stones falls to shots, and FEWER wins", () => {
  const series = createSeries({ stoneCount: 5, opener: 0 });
  recordRound(series, round(0, [3, 0], [4, 4]));
  recordRound(series, round(1, [0, 3], [7, 6]));
  const out = seriesOutcome(series);
  assertEqual(out.winner, 1, "11 shots beats 12");
  assertEqual(out.reason, "shots");
});

test("a genuinely level match asks for a draw shot rather than picking someone", () => {
  const series = createSeries({ stoneCount: 5, opener: 0 });
  recordRound(series, round(0, [3, 0], [4, 4]));
  recordRound(series, round(1, [0, 3], [4, 4]));
  const out = seriesOutcome(series);
  assertEqual(out.winner, null);
  assertEqual(out.reason, "level");
  assertEqual(out.needsDraw, true);
});

test("the draw shot settles it, and closer wins", () => {
  const level = () => {
    const series = createSeries({ stoneCount: 5, opener: 0 });
    recordRound(series, round(0, [3, 0], [4, 4]));
    recordRound(series, round(1, [0, 3], [4, 4]));
    return series;
  };
  const series = level();
  recordDrawShot(series, [0.19, 0.07]);
  const out = seriesOutcome(series);
  assertEqual(out.winner, 1, "0.07 from the centre beats 0.19");
  assertEqual(out.reason, "draw");
  assertEqual(out.ladder.find((r) => r.decisive).key, "draw");

  // A stone that left the board is Infinity, so any shot that stayed on
  // it wins — including a bad one.
  const missed = level();
  recordDrawShot(missed, [Infinity, 0.42]);
  assertEqual(seriesOutcome(missed).winner, 1, "staying on the board beats missing it");

  // Both off the board decides nothing; the shot is taken again rather
  // than resolved by whoever missed less.
  const bothMissed = level();
  recordDrawShot(bothMissed, [Infinity, Infinity]);
  const retry = seriesOutcome(bothMissed);
  assertEqual(retry.winner, null);
  assertEqual(retry.needsDraw, true);
});

// The card shows the whole ladder, so the ladder has to be complete and
// have exactly one rung marked — a card with two "this is why" rows, or
// none, is worse than no explanation at all.
test("the ladder always carries every rung and marks at most one", () => {
  const series = createSeries({ stoneCount: 5, opener: 0 });
  recordRound(series, round(0, [1, 0], [5, 5]));
  recordRound(series, round(1, [0, 4], [4, 4]));
  const out = seriesOutcome(series);
  assertEqual(
    out.ladder.map((r) => r.key),
    ["rounds", "stones", "shots"],
    "every rung is shown, decisive or not"
  );
  assertEqual(out.ladder.filter((r) => r.decisive).length, 1);
  assertEqual(out.ladder.find((r) => r.decisive).key, "stones");
  const rungs = Object.fromEntries(out.ladder.map((r) => [r.key, r.values]));
  assertEqual(rungs.rounds, [1, 1], "the tied rungs are shown with their numbers too");
  assertEqual(rungs.stones, [1, 4]);
  assertEqual(rungs.shots, [9, 9]);
});

// The property the whole format exists for: swap which side did what and
// the match swaps with it. If this ever fails, one seat is worth more
// than the other and the rating built on top of it is not measuring skill.
test("mirroring the match mirrors the result", () => {
  const mirror = (r) => round(r.winner === 0 ? 1 : 0, [r.alive[1], r.alive[0]], [r.shots[1], r.shots[0]]);
  const played = [round(0, [2, 0], [5, 4]), round(1, [0, 2], [6, 5])];
  const a = createSeries({ stoneCount: 5, opener: 0 });
  const b = createSeries({ stoneCount: 5, opener: 1 });
  for (const r of played) {
    recordRound(a, r);
    recordRound(b, mirror(r));
  }
  const outA = seriesOutcome(a);
  const outB = seriesOutcome(b);
  assertEqual(outA.reason, outB.reason);
  assertEqual(outB.winner, outA.winner === null ? null : 1 - outA.winner);
});
