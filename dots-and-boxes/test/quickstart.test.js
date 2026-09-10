import { generateQuickStart, QUICK_FILL_RATIO } from "../src/game/quickstart.js";
import { analyze } from "../src/game/chains.js";
import { test, assertTrue, assertEqual } from "./harness.js";

// Deterministic PRNG (mulberry32) so a run that fails is reproducible —
// same contract as game/ai.js's injected rng: () => number in [0, 1).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RUNS_PER_SIZE = 50;

for (const size of [3, 5, 7]) {
  test(`${size}x${size}: ${RUNS_PER_SIZE} runs never leave a capturable box`, () => {
    for (let i = 0; i < RUNS_PER_SIZE; i++) {
      const rng = mulberry32(size * 100000 + i);
      const state = generateQuickStart(size, size, rng);
      const result = analyze(state);
      assertEqual(
        result.capturableBoxes,
        [],
        `seed ${i}: capturableBoxes must be empty, got ${JSON.stringify(result.capturableBoxes)}`
      );
    }
  });
}

test("never draws more edges than QUICK_FILL_RATIO's target (only ever shrinks, never exceeds)", () => {
  // The target fill count only ever ratchets downward from the ratio's
  // value when attempts are exhausted — it can never end up ABOVE it.
  // (How far it actually shrinks in practice is a tuning question, not
  // a correctness one — a fixed "must land within N of the target"
  // check turned out to be flaky: even a 7x7 board can burn through 50
  // attempts at the full target fairly often, since a capturable box
  // anywhere among 49 boxes is enough to reject the whole attempt.)
  for (const size of [3, 5, 7]) {
    const totalEdges = (size + 1) * size + size * (size + 1);
    const expected = Math.round(totalEdges * QUICK_FILL_RATIO);
    const rng = mulberry32(size * 7 + 1);
    const state = generateQuickStart(size, size, rng);
    assertTrue(state.edgesDrawn > 0, `${size}x${size}: expected a non-trivial fill, got 0`);
    assertTrue(
      state.edgesDrawn <= expected,
      `${size}x${size}: expected at most the ${expected}-edge target, got ${state.edgesDrawn}`
    );
  }
});

// --- fallback path -----------------------------------------------------

test("fallback: an unreachable target ratio still returns a valid position (shrinks instead of hanging)", () => {
  // 3x3 has 24 total edges. A 0.95 ratio asks for 23 drawn — leaving
  // exactly 1 undrawn edge on the whole board. That's not just unlucky,
  // it's mathematically impossible to satisfy "no capturable boxes":
  // whichever box(es) touch that one remaining edge have only 1 undrawn
  // edge (everything else on the board is drawn), which is exactly the
  // definition of capturable. So this MUST engage the shrink fallback —
  // it can't succeed at the naive target no matter how many attempts.
  const rng = mulberry32(7);
  const state = generateQuickStart(3, 3, rng, 0.95);

  const result = analyze(state);
  assertEqual(result.capturableBoxes, [], "fallback position still has zero capturable boxes");
  assertTrue(
    state.edgesDrawn < 23,
    `expected the generator to shrink below the impossible target of 23, got ${state.edgesDrawn}`
  );
});

test("fallback: a target that lands exactly on the impossible count for a tiny board shrinks by exactly one", () => {
  // 1x1 (4 edges), single box: drawing exactly 3 of its 4 edges is the
  // ONE unreachable count (degree 1 = capturable) — 0, 1, 2, and 4 are
  // all fine (4 just completes the box outright, degree 0). A ratio of
  // 0.75 targets exactly 3, so this deterministically forces one shrink
  // step down to 2, which is trivially satisfiable by any 2-edge subset.
  const rng = mulberry32(99);
  const state = generateQuickStart(1, 1, rng, 0.75);
  assertEqual(analyze(state).capturableBoxes, []);
  assertEqual(state.edgesDrawn, 2, "shrank from the impossible target of 3 down to 2");
});

test("rng injection is deterministic, for reproducible tests", () => {
  const rngA = mulberry32(123);
  const rngB = mulberry32(123);
  const a = generateQuickStart(5, 5, rngA);
  const b = generateQuickStart(5, 5, rngB);
  assertEqual(a.hEdges, b.hEdges, "same rng seed -> identical hEdges");
  assertEqual(a.vEdges, b.vEdges, "same rng seed -> identical vEdges");
});

test("returns a state shaped exactly like createGameState()'s output", () => {
  const rng = mulberry32(1);
  const state = generateQuickStart(5, 5, rng);
  assertEqual(state.rows, 5);
  assertEqual(state.cols, 5);
  assertTrue(state.boxes.every((row) => row.every((v) => v === null)), "no box has an owner yet");
  assertEqual(state.scores, [0, 0]);
  assertEqual(state.gameOver, false);
  assertEqual(state.winner, null);
});
