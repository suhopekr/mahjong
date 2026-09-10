// test/achievements.test.js
// game/achievements.js has two independent things worth pinning down:
//   1. isDeliberateHandoff() — the Double Cross detection heuristic,
//      checked both against small hand-built fixtures AND against a
//      REAL Hard AI double-cross plan from game/ai.js (chosen because
//      that's the actual, already-trusted source of a genuine
//      "declined an available capture on purpose" moment in this
//      codebase — see ai.test.js's matching fixture).
//   2. evaluateTurnEnd()/evaluateGameOver() — pure functions over a ctx
//      object, so every achievement gets a fixture as a plain ctx rather
//      than a simulated full game (main.js, which is what would
//      normally assemble that ctx, is DOM-dependent and untested by
//      design — see CLAUDE.md section 9). Testing evaluateGameOver()
//      directly against its documented ctx shape is exactly the module's
//      real public contract.

import { parsePosition } from "../src/game/position.js";
import { createGameState, applyMove } from "../src/game/rules.js";
import { createTurnManager } from "../src/core/turn.js";
import { chooseTurnMoves } from "../src/game/ai.js";
import {
  isDeliberateHandoff,
  createDeficitTracker,
  updateDeficitTracking,
  evaluateTurnEnd,
  evaluateGameOver,
  ACHIEVEMENTS,
} from "../src/game/achievements.js";
import { test, assertEqual, assertTrue } from "./harness.js";

function idsOf(defs) {
  return defs.map((d) => d.id).sort();
}

// --- isDeliberateHandoff -------------------------------------------------

// box (0,0): top/bottom/left drawn, only the shared edge v(0,1) missing
// -> capturable. box (0,1): top/bottom drawn, degree 2, not capturable.
const ONE_CAPTURABLE_BOX = "1x2|h:0,1,2,3|v:0";

test("isDeliberateHandoff: no capturable boxes at all -> never a handoff", () => {
  const state = parsePosition("1x2|h:0,1"); // both boxes still degree 3
  assertTrue(!isDeliberateHandoff(state, { type: "h", r: 1, c: 0 }));
});

test("isDeliberateHandoff: move completes the ONLY capturable box -> not a handoff", () => {
  const state = parsePosition(ONE_CAPTURABLE_BOX);
  assertTrue(!isDeliberateHandoff(state, { type: "v", r: 0, c: 1 }), "v(0,1) is exactly box (0,0)'s missing edge");
});

test("isDeliberateHandoff: a capturable box exists but the move played is a different edge -> a handoff", () => {
  const state = parsePosition(ONE_CAPTURABLE_BOX);
  assertTrue(
    isDeliberateHandoff(state, { type: "v", r: 0, c: 2 }),
    "box (0,0) is left capturable while an unrelated edge gets drawn instead"
  );
});

test("isDeliberateHandoff: integration check against a REAL Hard double-cross domino (see ai.test.js)", () => {
  const parsed = parsePosition("2x5|h:0,1,2,3,4,5,6,7,8,9|v:0");
  const state = createGameState(parsed.rows, parsed.cols);
  state.hEdges = parsed.hEdges;
  state.vEdges = parsed.vEdges;
  const tm = createTurnManager(2);

  const moves = chooseTurnMoves(state, 0, "hard");
  assertEqual(moves.length, 4, "3 captures + 1 sacrifice");

  for (let i = 0; i < 3; i++) {
    assertTrue(!isDeliberateHandoff(state, moves[i]), `move ${i} is a genuine capture, not a handoff`);
    applyMove(state, tm, moves[i].type, moves[i].r, moves[i].c);
  }
  assertTrue(isDeliberateHandoff(state, moves[3]), "the domino sacrifice IS a deliberate handoff");
});

// --- deficit tracking ----------------------------------------------------

test("deficit tracker: starts at zero for both players", () => {
  assertEqual(createDeficitTracker(), { maxDeficit0: 0, maxDeficit1: 0 });
});

test("deficit tracker: tracks the WORST deficit seen so far, not just the latest", () => {
  const tracker = createDeficitTracker();
  updateDeficitTracking(tracker, [0, 3]); // player 0 down by 3
  updateDeficitTracking(tracker, [2, 3]); // down by 1 -- improved, but max stays 3
  updateDeficitTracking(tracker, [2, 7]); // down by 5 -- new worst
  updateDeficitTracking(tracker, [6, 7]); // down by 1 again
  assertEqual(tracker.maxDeficit0, 5);
  assertEqual(tracker.maxDeficit1, 0, "player 1 was never behind");
});

// --- evaluateTurnEnd (Chain Reaction / Chain Master) ----------------------

test("evaluateTurnEnd: below both thresholds unlocks nothing", () => {
  const result = evaluateTurnEnd({ boxesThisTurn: 4, creditable: true }, new Set());
  assertEqual(result, []);
});

test("evaluateTurnEnd: exactly 5 unlocks Chain Reaction only", () => {
  const result = evaluateTurnEnd({ boxesThisTurn: 5, creditable: true }, new Set());
  assertEqual(idsOf(result), ["chain_reaction"]);
});

test("evaluateTurnEnd: exactly 8 unlocks BOTH Chain Reaction and Chain Master at once", () => {
  const result = evaluateTurnEnd({ boxesThisTurn: 8, creditable: true }, new Set());
  assertEqual(idsOf(result), ["chain_master", "chain_reaction"]);
});

test("evaluateTurnEnd: not creditable (e.g. the AI's own big turn, vs AI mode) unlocks nothing", () => {
  const result = evaluateTurnEnd({ boxesThisTurn: 9, creditable: false }, new Set());
  assertEqual(result, []);
});

test("evaluateTurnEnd: already-unlocked ids are never re-evaluated", () => {
  const result = evaluateTurnEnd({ boxesThisTurn: 9, creditable: true }, new Set(["chain_reaction", "chain_master"]));
  assertEqual(result, []);
});

// --- evaluateGameOver ------------------------------------------------------

// A minimal, fully-specified baseline ctx -- every test below overrides
// only the fields relevant to what it's checking, so a missing field
// elsewhere in this file's fixtures can never accidentally satisfy an
// unrelated achievement.
function baseCtx(overrides = {}) {
  return {
    mode: "ai",
    gridSize: 5,
    difficulty: "medium",
    humanWon: false,
    creditableWin: false,
    winnerScore: null,
    opponentScore: null,
    maxDeficitForWinner: 0,
    handoffByWinner: false,
    hintsUsed: 0,
    currentStreak: 0,
    allHardSizesWon: false,
    localGamesCompletedTotal: 0,
    ...overrides,
  };
}

test("first_win: unlocks on any vs-AI human win, any difficulty", () => {
  const won = evaluateGameOver(baseCtx({ humanWon: true }), new Set());
  assertTrue(idsOf(won).includes("first_win"));

  const lost = evaluateGameOver(baseCtx({ humanWon: false }), new Set());
  assertTrue(!idsOf(lost).includes("first_win"));
});

test("double_cross: needs BOTH a creditable win AND that winner having handed off a box", () => {
  const both = evaluateGameOver(baseCtx({ creditableWin: true, handoffByWinner: true }), new Set());
  assertTrue(idsOf(both).includes("double_cross"));

  const handoffButLost = evaluateGameOver(baseCtx({ creditableWin: false, handoffByWinner: true }), new Set());
  assertTrue(!idsOf(handoffButLost).includes("double_cross"), "handed off, but didn't win -- no credit");

  const wonNoHandoff = evaluateGameOver(baseCtx({ creditableWin: true, handoffByWinner: false }), new Set());
  assertTrue(!idsOf(wonNoHandoff).includes("double_cross"), "won, but never handed anything off");
});

test("shutout: opponent must score exactly 0, and the win must be creditable", () => {
  const shutout = evaluateGameOver(baseCtx({ creditableWin: true, opponentScore: 0 }), new Set());
  assertTrue(idsOf(shutout).includes("shutout"));

  const notShutout = evaluateGameOver(baseCtx({ creditableWin: true, opponentScore: 1 }), new Set());
  assertTrue(!idsOf(notShutout).includes("shutout"));

  const uncreditedShutout = evaluateGameOver(baseCtx({ creditableWin: false, opponentScore: 0 }), new Set());
  assertTrue(!idsOf(uncreditedShutout).includes("shutout"), "opponent (e.g. the AI) got the shutout, not you");
});

test("comeback: deficit of exactly 5 unlocks, 4 does not", () => {
  const at5 = evaluateGameOver(baseCtx({ creditableWin: true, maxDeficitForWinner: 5 }), new Set());
  assertTrue(idsOf(at5).includes("comeback"));

  const at4 = evaluateGameOver(baseCtx({ creditableWin: true, maxDeficitForWinner: 4 }), new Set());
  assertTrue(!idsOf(at4).includes("comeback"));
});

test("comeback: a big deficit that the OPPONENT faced (not the winner) doesn't count", () => {
  // maxDeficitForWinner is already computed (by the caller) as "how far
  // behind the WINNER fell" -- this fixture just confirms the achievement
  // trusts that field as-is rather than re-deriving anything.
  const result = evaluateGameOver(baseCtx({ creditableWin: true, maxDeficitForWinner: 0 }), new Set());
  assertTrue(!idsOf(result).includes("comeback"));
});

test("no_help_needed: Hard win with zero hints used", () => {
  const clean = evaluateGameOver(baseCtx({ humanWon: true, difficulty: "hard", hintsUsed: 0 }), new Set());
  assertTrue(idsOf(clean).includes("no_help_needed"));

  const usedHint = evaluateGameOver(baseCtx({ humanWon: true, difficulty: "hard", hintsUsed: 1 }), new Set());
  assertTrue(!idsOf(usedHint).includes("no_help_needed"));

  const wrongDifficulty = evaluateGameOver(baseCtx({ humanWon: true, difficulty: "medium", hintsUsed: 0 }), new Set());
  assertTrue(!idsOf(wrongDifficulty).includes("no_help_needed"));
});

test("grid_master: only unlocks once allHardSizesWon is true, and only on a Hard win", () => {
  const notAllYet = evaluateGameOver(
    baseCtx({ humanWon: true, difficulty: "hard", allHardSizesWon: false }),
    new Set()
  );
  assertTrue(!idsOf(notAllYet).includes("grid_master"));

  const allDone = evaluateGameOver(baseCtx({ humanWon: true, difficulty: "hard", allHardSizesWon: true }), new Set());
  assertTrue(idsOf(allDone).includes("grid_master"));
});

test("grid_master: cumulative across three separate games (3x3, then 5x5, then 7x7)", () => {
  // Mirrors how main.js actually drives this: recordHardWin() persists
  // one size per call, and allHardSizesWon is only true once all three
  // have landed -- simulated here purely through the ctx flag, since
  // that bookkeeping itself lives in core/storage.js (see its own tests).
  const unlocked = new Set();

  let result = evaluateGameOver(
    baseCtx({ humanWon: true, difficulty: "hard", gridSize: 3, allHardSizesWon: false }),
    unlocked
  );
  assertTrue(!idsOf(result).includes("grid_master"), "only 3x3 done so far");

  result = evaluateGameOver(
    baseCtx({ humanWon: true, difficulty: "hard", gridSize: 5, allHardSizesWon: false }),
    unlocked
  );
  assertTrue(!idsOf(result).includes("grid_master"), "3x3 and 5x5 done, 7x7 still missing");

  result = evaluateGameOver(
    baseCtx({ humanWon: true, difficulty: "hard", gridSize: 7, allHardSizesWon: true }),
    unlocked
  );
  assertTrue(idsOf(result).includes("grid_master"), "all three sizes now done -- unlocks on this call");
  for (const d of result) unlocked.add(d.id);

  // A 4th Hard win (any size) must NOT re-unlock it.
  result = evaluateGameOver(
    baseCtx({ humanWon: true, difficulty: "hard", gridSize: 5, allHardSizesWon: true }),
    unlocked
  );
  assertTrue(!idsOf(result).includes("grid_master"), "already unlocked -- not re-evaluated");
});

test("hot_streak / unstoppable: thresholds at exactly 5 and 10", () => {
  assertTrue(!idsOf(evaluateGameOver(baseCtx({ humanWon: true, currentStreak: 4 }), new Set())).includes("hot_streak"));
  assertTrue(idsOf(evaluateGameOver(baseCtx({ humanWon: true, currentStreak: 5 }), new Set())).includes("hot_streak"));
  assertTrue(
    !idsOf(evaluateGameOver(baseCtx({ humanWon: true, currentStreak: 9 }), new Set())).includes("unstoppable")
  );
  const at10 = evaluateGameOver(baseCtx({ humanWon: true, currentStreak: 10 }), new Set());
  assertTrue(idsOf(at10).includes("hot_streak") && idsOf(at10).includes("unstoppable"), "10 clears both bars at once");
});

test("perfectionist: 7x7 AND at least double the opponent's score", () => {
  const exactlyDouble = evaluateGameOver(
    baseCtx({ creditableWin: true, gridSize: 7, winnerScore: 20, opponentScore: 10 }),
    new Set()
  );
  assertTrue(idsOf(exactlyDouble).includes("perfectionist"));

  const justUnder = evaluateGameOver(
    baseCtx({ creditableWin: true, gridSize: 7, winnerScore: 19, opponentScore: 10 }),
    new Set()
  );
  assertTrue(!idsOf(justUnder).includes("perfectionist"));

  const wrongSize = evaluateGameOver(
    baseCtx({ creditableWin: true, gridSize: 5, winnerScore: 20, opponentScore: 10 }),
    new Set()
  );
  assertTrue(!idsOf(wrongSize).includes("perfectionist"), "the ratio is right but the grid isn't 7x7");
});

test("local_legend: only in local mode, only once 10 completed games are reached", () => {
  const notYet = evaluateGameOver(baseCtx({ mode: "local", localGamesCompletedTotal: 9 }), new Set());
  assertTrue(!idsOf(notYet).includes("local_legend"));

  const reached = evaluateGameOver(baseCtx({ mode: "local", localGamesCompletedTotal: 10 }), new Set());
  assertTrue(idsOf(reached).includes("local_legend"));

  const aiModeSameCount = evaluateGameOver(baseCtx({ mode: "ai", localGamesCompletedTotal: 10 }), new Set());
  assertTrue(!idsOf(aiModeSameCount).includes("local_legend"), "count only means something in local mode");
});

test("all 12 achievements are distinct ids, and every check is exercised by SOME test above", () => {
  const ids = ACHIEVEMENTS.map((a) => a.id);
  assertEqual(ids.length, 12);
  assertEqual(new Set(ids).size, 12, "no duplicate ids");
});
