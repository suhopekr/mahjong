import { createTurnManager, pickStartingPlayer } from "../src/core/turn.js";
import { test, assertEqual, assertTrue } from "./harness.js";

test("createTurnManager defaults to player 0 when no starting player is given", () => {
  const tm = createTurnManager(2);
  assertEqual(tm.current(), 0);
});

test("createTurnManager honors an explicit starting player", () => {
  const tm = createTurnManager(2, 1);
  assertEqual(tm.current(), 1);
  tm.recordMove({}, false);
  assertEqual(tm.current(), 0, "turn still alternates normally from there");
});

test("reset() restores the CONFIGURED starting player, not a hardcoded 0", () => {
  const tm = createTurnManager(2, 1);
  tm.recordMove({}, false); // -> player 0
  tm.recordMove({}, false); // -> player 1
  assertEqual(tm.current(), 1);
  tm.reset();
  assertEqual(tm.current(), 1, "resets back to the configured starting player (1), not 0");
});

test("pickStartingPlayer: rng near 0 picks the first player", () => {
  assertEqual(pickStartingPlayer(2, () => 0), 0);
});

test("pickStartingPlayer: rng near (but under) 1 picks the last player", () => {
  assertEqual(pickStartingPlayer(2, () => 0.999999), 1);
});

test("pickStartingPlayer: exactly 0.5 splits evenly for 2 players", () => {
  assertEqual(pickStartingPlayer(2, () => 0.5), 1);
  assertEqual(pickStartingPlayer(2, () => 0.4999999), 0);
});

test("pickStartingPlayer: rng injection is deterministic, for reproducible tests", () => {
  const always0 = () => 0;
  assertEqual(pickStartingPlayer(2, always0), pickStartingPlayer(2, always0));
});

test("undoTurn: a single-move turn pops exactly one entry", () => {
  const tm = createTurnManager(2);
  tm.recordMove({ x: 1 }, false); // -> player 1
  const undone = [];
  const ok = tm.undoTurn((entry) => undone.push(entry.move.x));
  assertTrue(ok);
  assertEqual(undone, [1]);
  assertEqual(tm.current(), 0, "restored to whoever made the undone move");
  assertEqual(tm.getHistory().length, 0);
});

test("undoTurn: a multi-move turn (extra turns) pops the whole run, not just the last move", () => {
  const tm = createTurnManager(2);
  tm.recordMove({ x: "p0-a" }, true); // extra turn: box completed
  tm.recordMove({ x: "p0-b" }, true); // extra turn again
  tm.recordMove({ x: "p0-c" }, false); // turn ends -> player 1
  assertEqual(tm.current(), 1);

  const undone = [];
  const ok = tm.undoTurn((entry) => undone.push(entry.move.x));
  assertTrue(ok);
  assertEqual(undone, ["p0-c", "p0-b", "p0-a"], "pops most-recent-first, all three moves of the turn");
  assertEqual(tm.current(), 0, "back to player 0, who made that whole turn");
  assertEqual(tm.getHistory().length, 0);
});

test("undoTurn: stops exactly at the player boundary, leaving the prior turn intact", () => {
  const tm = createTurnManager(2);
  tm.recordMove({ x: "p0" }, false); // -> player 1
  tm.recordMove({ x: "p1-a" }, true); // extra turn
  tm.recordMove({ x: "p1-b" }, false); // -> player 0

  const undone = [];
  tm.undoTurn((entry) => undone.push(entry.move.x));
  assertEqual(undone, ["p1-b", "p1-a"], "only player 1's turn is undone");
  assertEqual(tm.current(), 1, "turn handed back to player 1 to retry");
  assertEqual(tm.getHistory().length, 1, "player 0's earlier move is untouched");
  assertEqual(tm.peekLast().move.x, "p0");
});

test("undoTurn: empty history is a no-op that returns false", () => {
  const tm = createTurnManager(2);
  let called = false;
  const ok = tm.undoTurn(() => (called = true));
  assertTrue(!ok);
  assertTrue(!called);
  assertEqual(tm.current(), 0);
});

test("undoTurn: onUndo is optional", () => {
  const tm = createTurnManager(2);
  tm.recordMove({ x: 1 }, false);
  assertTrue(tm.undoTurn(), "does not throw when no callback is given");
});

test("pickStartingPlayer: distribution is roughly even across many coin flips", () => {
  // Not a statistical rigor test — just a sanity check that both
  // outcomes are actually reachable and neither dominates absurdly,
  // using a small deterministic PRNG (not Math.random) so this is
  // reproducible.
  let seed = 12345;
  function rng() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  let zeros = 0;
  let ones = 0;
  for (let i = 0; i < 200; i++) {
    (pickStartingPlayer(2, rng) === 0 ? zeros++ : ones++);
  }
  const min = Math.min(zeros, ones);
  const max = Math.max(zeros, ones);
  // With 200 flips, a fair coin should never realistically land past
  // roughly a 65/35 split — this just catches a badly broken rng usage
  // (e.g. always returning the same player), not fine-grained bias.
  assertTrue(min / max >= 0.4, `distribution too skewed: ${zeros} vs ${ones}`);
});
