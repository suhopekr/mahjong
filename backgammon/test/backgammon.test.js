// test/backgammon.test.js — the rules engine, without a browser.
//
// Index reminder: point p is index p − 1. The human (positive counts)
// moves 23 → 0 and bears off past 0; the computer (negative) moves
// 0 → 23. The human's home board is indices 0–5, the computer's 18–23.
import { test, assertEqual, assertTrue, assertThrows } from "./harness.js";
import * as G from "../src/game/backgammon.js";

import { START, pos, midTurn, sig, sigs } from "./helpers.js";

const { HUMAN: H, COMPUTER: C } = G;

// ---------------------------------------------------------------- setup
test("starting position: 15 checkers each in the 2/5/3/5 layout, mirrored, 167 pips each", () => {
  const p = G.startingPoints();
  assertEqual(p[23], 2); assertEqual(p[12], 5); assertEqual(p[7], 3); assertEqual(p[5], 5);
  assertEqual(p[0], -2); assertEqual(p[11], -5); assertEqual(p[16], -3); assertEqual(p[18], -5);
  const h = p.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const c = p.filter((v) => v < 0).reduce((a, b) => a - b, 0);
  assertEqual([h, c], [15, 15]);
  assertEqual(G.pipCount(pos({ points: START }), H), 167);
  assertEqual(G.pipCount(pos({ points: START }), C), 167);
});

test("newGame starts at the opening roll with nothing on the bar or off; 'first' can skip the opening", () => {
  const s = G.newGame({ seed: 7 });
  assertEqual(s.phase, "opening");
  assertEqual(s.turn, null);
  assertEqual(s.bar, { h: 0, c: 0 });
  assertEqual(s.off, { h: 0, c: 0 });
  assertEqual(s.difficulty, "relaxed");
  assertEqual(G.newGame({ seed: 1, difficulty: "nonsense" }).difficulty, "relaxed");
  assertEqual(G.newGame({ seed: 1, difficulty: "standard" }).difficulty, "standard");
  const me = G.newGame({ seed: 1, first: "h" });
  assertEqual([me.phase, me.turn], ["roll", H]);
  const cpu = G.newGame({ seed: 1, first: "c" });
  assertEqual([cpu.phase, cpu.turn], ["roll", C]);
  assertEqual(G.newGame({ seed: 1, first: "bogus" }).phase, "opening");
  assertTrue(G.isValidState(s), "a fresh game validates");
  assertTrue(!G.isValidState({ ...s, points: s.points.slice(1) }), "23 points is not a board");
  assertTrue(!G.isValidState({ ...s, off: { h: 3, c: 0 } }), "checker count must be 15 a side");
});

// ---------------------------------------------------------------- dice
test("dice are deterministic from the seed and always 1..6", () => {
  const a = G.newGame({ seed: 42 }), b = G.newGame({ seed: 42 });
  let sa = a, sb = b;
  for (let i = 0; i < 20; i++) {
    sa = G.rollOpening(sa); sb = G.rollOpening(sb);
    assertEqual(sa.opening, sb.opening, "same opening roll");
    if (sa.phase !== "opening") break;
  }
  const rng = G.makeRng(5);
  for (let i = 0; i < 200; i++) { const v = rng(); assertTrue(v >= 0 && v < 1); }
  let s = G.newGame({ seed: 99 });
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    s = { ...s, phase: "roll", turn: H };
    s = G.rollDice(s);
    for (const d of s.dice) { assertTrue(d >= 1 && d <= 6, "die in range"); seen.add(d); }
  }
  assertEqual(seen.size, 6, "every face turns up over 60 rolls");
  const forced = G.rollDice({ ...s, phase: "roll" }, [6, 6]);
  assertEqual(forced.dice, [6, 6]);
  assertEqual(forced.remaining, [6, 6, 6, 6]);
});

test("opening roll: a tie stays in the opening; otherwise the higher die starts and plays both dice", () => {
  let tie = null, decided = null;
  for (let seed = 1; seed < 200 && !(tie && decided); seed++) {
    const s = G.rollOpening(G.newGame({ seed }));
    if (s.phase === "opening") tie = s; else decided = s;
  }
  assertTrue(tie && tie.opening.h === tie.opening.c, "found a tie");
  assertEqual(tie.turn, null);
  assertTrue(decided, "found a decided opening");
  assertEqual(decided.phase, "move");
  assertEqual(decided.turn, decided.opening.h > decided.opening.c ? H : C);
  assertEqual(decided.dice.slice().sort(), [decided.opening.h, decided.opening.c].sort());
  assertEqual(decided.remaining.length, 2);
  assertThrows(() => G.rollOpening(decided), "not the opening");
});

test("doubles give four moves to play", () => {
  const s = midTurn(pos({ points: START }), H, [3, 3]);
  assertEqual(s.remaining, [3, 3, 3, 3]);
  assertEqual(G.diceDisplay(s).length, 4);
  const seqs = G.legalSequences(s.turnStart, H, [3, 3]);
  assertTrue(seqs.every((q) => q.length === 4), "every sequence plays four moves");
});

// ---------------------------------------------------------------- moves
test("single moves from the start: a 3 moves four checkers; a 5 from 24 is blocked, a 6 is not", () => {
  const p = pos({ points: START });
  const ms = G.singleMoves(p, H, 3);
  assertEqual(ms.map((m) => `${m.from}>${m.to}`).sort(), ["12>9", "23>20", "5>2", "7>4"]);
  // 24→19 lands on the computer's five checkers (index 18): blocked
  assertTrue(!G.singleMoves(p, H, 5).some((m) => m.from === 23), "24→19 is blocked");
  // 24→18 (index 17) is empty: the classic running play is open
  assertTrue(G.singleMoves(p, H, 6).some((m) => m.from === 23 && m.to === 17), "24→18 is open");
});

test("computer moves the other way and enters on its own side", () => {
  const p = pos({ points: { 0: -2 }, bar: { h: 0, c: 1 } });
  assertEqual(G.singleMoves(p, C, 4), [{ from: "bar", to: 3, die: 4, hit: false }]);
  const p2 = pos({ points: { 0: -2 } });
  assertEqual(G.singleMoves(p2, C, 4), [{ from: 0, to: 4, die: 4, hit: false }]);
});

test("must use both dice when possible: the play that strands the other die is not offered", () => {
  // Human checkers on 11 (idx 10) and 21 (idx 20), thirteen off. Dice 6-1.
  // idx 10: the 1 → idx 9 is open, the 6 → idx 4 is blocked.
  // idx 20: the 1 → idx 19 is open, the 6 → idx 14 is blocked.
  // Playing 11→10 first strands the 6 (9→3 blocked, 21→15 blocked);
  // playing 21→20 first lets the 6 follow (20→14). Only the latter is legal.
  const p = pos({ points: { 10: 1, 20: 1, 4: -2, 3: -2, 14: -2 }, off: { h: 13, c: 0 } });
  const seqs = G.legalSequences(p, H, [6, 1]);
  assertEqual(sigs(seqs), ["20>19/1 19>13/6"]);
  const s = midTurn(p, H, [6, 1]);
  const firsts = G.legalMoves(s);
  assertEqual(firsts.map((m) => m.from), [20], "the checker on 11 may not move first");
  for (const m of firsts) {
    const after = G.applyMove(s, m);
    assertTrue(G.legalMoves(after).length > 0, `after ${sig([m])} the other die still plays`);
  }
});

test("when only one die can be played and either could, the higher must be", () => {
  // Human on the bar; entry with the 6 → idx 18, with the 2 → idx 22. Both
  // open, but nothing can move afterwards (everything else is blocked), so
  // the only sequences are one move long and the 6 must be the one.
  const p = pos({
    points: { 23: 1, 17: -2, 16: -2, 20: -2, 21: -2, 12: 1, 6: -2, 10: -2 },
    bar: { h: 1, c: 0 }, off: { h: 12, c: 0 },
  });
  const seqs = G.legalSequences(p, H, [6, 2]);
  assertEqual(seqs.length, 1);
  assertEqual(sig(seqs[0]), "bar>18/6");
});

test("a lower die alone is legal when the higher one has no play at all", () => {
  // One human checker on 24 (idx 23), fourteen off. 6 → idx 17 blocked;
  // 3 → idx 20 open; from 20 the 6 → idx 14 is blocked too, so the 3 alone.
  const p = pos({ points: { 23: 1, 17: -2, 14: -2, 18: -2 }, off: { h: 14, c: 0 } });
  const seqs = G.legalSequences(p, H, [6, 3]);
  assertEqual(sigs(seqs), ["23>20/3"]);
});

test("no legal move at all gives one empty sequence and turnComplete is true", () => {
  const p = pos({ points: { 23: 1, 17: -2, 18: -2, 19: -2, 20: -2, 21: -2, 22: -2 }, off: { h: 14, c: 0 } });
  const seqs = G.legalSequences(p, H, [4, 2]);
  assertEqual(seqs, [[]]);
  const s = midTurn(p, H, [4, 2]);
  assertEqual(G.legalMoves(s), []);
  assertTrue(G.turnComplete(s));
});

test("legal move enumeration from the opening with 3-1 includes the classic 8→5, 6→5 point", () => {
  const p = pos({ points: START });
  const seqs = G.legalSequences(p, H, [3, 1]);
  assertTrue(seqs.every((q) => q.length === 2));
  const found = seqs.some((q) => sig(q) === "7>4/3 5>4/1" || sig(q) === "5>4/1 7>4/3");
  assertTrue(found, "8→5 and 6→5 is among the sequences");
  // both orders of a non-double appear as separate sequences
  assertTrue(seqs.some((q) => q[0].die === 3) && seqs.some((q) => q[0].die === 1));
});

test("doubles: 6-6 from the start plays four moves, e.g. 24→18 twice and 13→7 twice", () => {
  const p = pos({ points: START });
  const seqs = G.legalSequences(p, H, [6, 6]);
  assertTrue(seqs.every((q) => q.length === 4), "four moves with doubles");
  assertTrue(seqs.some((q) => q.filter((m) => m.from === 23 && m.to === 17).length === 2 && q.filter((m) => m.from === 12 && m.to === 6).length === 2));
  // 4-4 with the back checker able to make only two hops (24→20→16, then
  // 12 is blocked) and two checkers on 6 that each play 6→2: still four
  const four = pos({ points: { 23: 1, 5: 2, 11: -2 }, off: { h: 12, c: 0 } });
  const s4 = G.legalSequences(four, H, [4, 4]);
  assertTrue(s4.every((q) => q.length === 4));
  // …and when only three hops exist in total, every sequence is three long
  const three = pos({ points: { 23: 1, 5: 1, 11: -2 }, off: { h: 13, c: 0 } });
  const s3 = G.legalSequences(three, H, [4, 4]);
  assertTrue(s3.length > 0 && s3.every((q) => q.length === 3), "three moves: " + sigs(s3).join(" ; "));
});

// ---------------------------------------------------------------- bar
test("with a checker on the bar only bar entries are offered, and a blocked board means no move", () => {
  const p = pos({ points: { 12: 3, 18: -2, 19: -2, 20: -2, 21: -2, 22: -2, 23: -1 }, bar: { h: 1, c: 0 }, off: { h: 11, c: 0 } });
  const ms = G.singleMoves(p, H, 1); // entry on 24 (idx 23) holds a lone burgundy: a hit
  assertEqual(ms, [{ from: "bar", to: 23, die: 1, hit: true }]);
  assertEqual(G.singleMoves(p, H, 3), [], "entry on 22 is blocked");
  assertEqual(G.singleMoves(p, H, 6), [], "even though 13 could move, the bar comes first");
});

test("entering from the bar hits a blot and the hit checker goes to the other bar", () => {
  const p = pos({ points: { 23: -1, 12: 3 }, bar: { h: 1, c: 0 } });
  const s = midTurn(p, H, [1, 2]);
  const m = G.legalMoves(s).find((x) => x.from === "bar" && x.to === 23);
  assertTrue(m && m.hit, "entry hit is offered");
  const n = G.applyMove(s, m);
  assertEqual(n.bar, { h: 0, c: 1 });
  assertEqual(n.points[23], 1);
});

test("two on the bar: both must come in before anything else moves", () => {
  const p = pos({ points: { 12: 3 }, bar: { h: 2, c: 0 }, off: { h: 10, c: 0 } });
  const s = midTurn(p, H, [5, 2]);
  assertEqual(G.movableFroms(s), ["bar"]);
  const a = G.applyMove(s, { from: "bar", to: 19, die: 5 });
  assertEqual(G.movableFroms(a), ["bar"], "still one on the bar");
});

// ---------------------------------------------------------------- hitting
test("landing on a lone enemy checker sends it to the bar; two or more block", () => {
  const p = pos({ points: { 7: 2, 4: -1, 3: -2 } });
  const s = midTurn(p, H, [3, 4]);
  const hit = G.legalMoves(s).find((m) => m.from === 7 && m.to === 4);
  assertTrue(hit && hit.hit);
  assertTrue(!G.legalMoves(s).some((m) => m.from === 7 && m.to === 3), "8→4 blocked by two");
  const n = G.applyMove(s, hit);
  assertEqual(n.points[4], 1);
  assertEqual(n.bar.c, 1);
  assertEqual(n.remaining, [4]);
  assertEqual(n.turnMoves.length, 1);
});

// ---------------------------------------------------------------- bearing off
test("bearing off is only allowed with all fifteen in the home board", () => {
  const notYet = pos({ points: { 5: 5, 4: 4, 3: 3, 2: 2, 6: 1 } });
  assertTrue(!G.canBearOff(notYet, H));
  assertTrue(!G.singleMoves(notYet, H, 6).some((m) => m.to === "off"));
  const ready = pos({ points: { 5: 5, 4: 4, 3: 3, 2: 2, 0: 1 } });
  assertTrue(G.canBearOff(ready, H));
  assertTrue(G.singleMoves(ready, H, 6).some((m) => m.from === 5 && m.to === "off"), "exact 6 bears off from the 6 point");
  assertTrue(G.singleMoves(ready, H, 1).some((m) => m.from === 0 && m.to === "off"), "exact 1 bears off from the 1 point");
  const onBar = pos({ points: { 5: 5, 4: 4, 3: 3, 2: 2 }, bar: { h: 1, c: 0 } });
  assertTrue(!G.canBearOff(onBar, H), "a checker on the bar stops bearing off");
});

test("a higher die bears off from the highest occupied point only when no higher point is occupied", () => {
  const p = pos({ points: { 3: 2, 1: 3 }, off: { h: 10, c: 0 } });
  const six = G.singleMoves(p, H, 6);
  assertEqual(six, [{ from: 3, to: "off", die: 6, hit: false }], "6 takes the checker from the 4 point");
  const two = G.singleMoves(p, H, 2);
  // 2 from the 4 point moves to the 2 point (idx 1); 2 from the 2 point bears off exactly
  assertEqual(two.map((m) => `${m.from}>${m.to}`).sort(), ["1>off", "3>1"]);
  const three = G.singleMoves(p, H, 3);
  // 3 from the 4 point → 1 point; 3 from the 2 point: higher point (4) is occupied, so no bear-off
  assertEqual(three.map((m) => `${m.from}>${m.to}`).sort(), ["3>0"]);
});

test("computer bears off past 24 with the same rules", () => {
  const p = pos({ points: { 20: -2, 22: -3 }, off: { h: 0, c: 10 } });
  assertEqual(G.singleMoves(p, C, 6), [{ from: 20, to: "off", die: 6, hit: false }]);
  assertEqual(G.singleMoves(p, C, 4).map((m) => `${m.from}>${m.to}`).sort(), ["20>off"]);
  assertEqual(G.singleMoves(p, C, 2).map((m) => `${m.from}>${m.to}`).sort(), ["20>22", "22>off"]);
});

// ---------------------------------------------------------------- game end
test("bearing off the fifteenth checker ends the game as a single win", () => {
  const p = pos({ points: { 0: 1, 20: -3 }, off: { h: 14, c: 12 } });
  const s = midTurn(p, H, [1, 2]);
  const m = G.legalMoves(s).find((x) => x.to === "off");
  const n = G.applyMove(s, m);
  assertEqual(n.phase, "over");
  assertEqual(n.winner, H);
  assertEqual(n.result, "single");
  assertEqual(n.off.h, 15);
  assertThrows(() => G.applyMove(n, m), "not time to move");
});

test("gammon when the loser bore off nothing; backgammon when it also has a checker on the bar or in the winner's home", () => {
  const gam = midTurn(pos({ points: { 0: 1, 12: -15 }, off: { h: 14, c: 0 } }), H, [1, 3]);
  let n = G.applyMove(gam, G.legalMoves(gam).find((x) => x.to === "off"));
  assertEqual([n.winner, n.result], [H, "gammon"]);

  const bgBar = midTurn(pos({ points: { 0: 1, 12: -14 }, bar: { h: 0, c: 1 }, off: { h: 14, c: 0 } }), H, [1, 3]);
  n = G.applyMove(bgBar, G.legalMoves(bgBar).find((x) => x.to === "off"));
  assertEqual([n.winner, n.result], [H, "backgammon"]);

  const bgHome = midTurn(pos({ points: { 0: 1, 12: -14, 3: -1 }, off: { h: 14, c: 0 } }), H, [1, 3]);
  n = G.applyMove(bgHome, G.legalMoves(bgHome).find((x) => x.to === "off"));
  assertEqual([n.winner, n.result], [H, "backgammon"]);

  // the computer winning a backgammon against a human checker in its home board (19–24)
  const cWin = midTurn(pos({ points: { 23: -1, 20: 1, 12: 14 }, off: { h: 0, c: 14 } }), C, [1, 3]);
  n = G.applyMove(cWin, G.legalMoves(cWin).find((x) => x.to === "off"));
  assertEqual([n.winner, n.result], [C, "backgammon"]);
});

// ---------------------------------------------------------------- turn flow
test("applyMove refuses a move that is not in the legal set", () => {
  const s = midTurn(pos({ points: START }), H, [6, 1]);
  assertThrows(() => G.applyMove(s, { from: 23, to: 18, die: 5 }), "illegal move");   // die not rolled
  assertThrows(() => G.applyMove(s, { from: 12, to: 8, die: 4 }), "illegal move");    // die not rolled
  assertThrows(() => G.applyMove(s, { from: 0, to: 6, die: 6 }), "illegal move");     // not my checker
  assertThrows(() => G.applyMove(s, { from: 12, to: 6, die: 1 }), "illegal move");    // wrong distance
});

test("undoMove restores the position and the dice; endTurn hands over the roll", () => {
  const s = midTurn(pos({ points: START }), H, [3, 1]);
  const a = G.applyMove(s, { from: 7, to: 4, die: 3 });
  const b = G.applyMove(a, { from: 5, to: 4, die: 1 });
  assertEqual(b.remaining, []);
  assertTrue(G.turnComplete(b));
  const u = G.undoMove(b);
  assertEqual(u.points, a.points);
  assertEqual(u.remaining, [1]);
  assertEqual(u.turnMoves.length, 1);
  const u2 = G.undoMove(u);
  assertEqual(u2.points, s.points);
  assertEqual(u2.remaining, [3, 1]);
  assertEqual(G.undoMove(u2), u2, "nothing to undo is a no-op");
  const e = G.endTurn(b);
  assertEqual([e.turn, e.phase, e.dice, e.turnMoves], [C, "roll", [], []]);
  assertThrows(() => G.endTurn(e), "no turn to end");
});

test("undo after a hit puts the hit checker back off the bar", () => {
  const s = midTurn(pos({ points: { 7: 2, 4: -1 } }), H, [3, 1]);
  const a = G.applyMove(s, { from: 7, to: 4, die: 3 });
  assertEqual(a.bar.c, 1);
  const u = G.undoMove(a);
  assertEqual(u.bar.c, 0);
  assertEqual(u.points[4], -1);
});

test("diceDisplay greys out the die that was used", () => {
  const s = midTurn(pos({ points: START }), H, [5, 2]);
  assertEqual(G.diceDisplay(s), [{ face: 5, used: false }, { face: 2, used: false }]);
  const a = G.applyMove(s, { from: 12, to: 7, die: 5 });
  assertEqual(G.diceDisplay(a), [{ face: 5, used: true }, { face: 2, used: false }]);
});

test("destinationsFrom lists one-die and two-dice landings for a checker, with the chain of moves", () => {
  const s = midTurn(pos({ points: START }), H, [4, 2]);
  const d = G.destinationsFrom(s, 23);
  const tos = d.map((x) => x.to).sort((a, b) => a - b);
  assertEqual(tos, [17, 19, 21], "24→20, 24→22 and 24→18 (via 20 or 22)");
  const far = d.find((x) => x.to === 17);
  assertEqual(far.moves.length, 2);
  assertEqual(far.moves[0].from, 23);
  assertEqual(far.moves[1].to, 17);
  assertEqual(G.destinationsFrom(s, 3), [], "no checker there");
});

test("movableFroms is the bar alone when a checker waits there", () => {
  const s = midTurn(pos({ points: { 12: 3, 7: 2 }, bar: { h: 1, c: 0 } }), H, [4, 2]);
  assertEqual(G.movableFroms(s), ["bar"]);
});

// ---------------------------------------------------------------- outline of a turn
test("summarizeMoves collapses chains, counts hits and points made, all as data", () => {
  const before = pos({ points: START });
  const moves = [{ from: 16, to: 19, die: 3, hit: false }, { from: 18, to: 19, die: 1, hit: false }];
  const after = moves.reduce((p, m) => G.applyToPos(p, m, C), before);
  assertEqual(G.summarizeMoves(moves, before, after, C), { entered: [], moved: [[16, 19], [18, 19]], off: [], hits: 0, made: 1, empty: false });
  const chain = [{ from: 23, to: 19, die: 4, hit: false }, { from: 19, to: 17, die: 2, hit: false }];
  const after2 = chain.reduce((p, m) => G.applyToPos(p, m, H), before);
  assertEqual(G.summarizeMoves(chain, before, after2, H).moved, [[23, 19, 17]]);
  const hitB = pos({ points: { 7: 2, 4: -1 } });
  const hitM = [{ from: 7, to: 4, die: 3, hit: true }];
  assertEqual(G.summarizeMoves(hitM, hitB, G.applyToPos(hitB, hitM[0], H), H).hits, 1);
  const barB = pos({ points: { 20: 1 }, bar: { h: 1, c: 0 } });
  const barS = G.summarizeMoves([{ from: "bar", to: 20, die: 4, hit: false }], barB, G.applyToPos(barB, { from: "bar", to: 20 }, H), H);
  assertEqual([barS.entered, barS.made], [[[20]], 1]);
  const offB = pos({ points: { 2: 1 }, off: { h: 14, c: 0 } });
  assertEqual(G.summarizeMoves([{ from: 2, to: "off", die: 3, hit: false }], offB, G.applyToPos(offB, { from: 2, to: "off" }, H), H).off, [2]);
  assertTrue(G.summarizeMoves([], offB, offB, H).empty);
});

// ---------------------------------------------------------------- second tap plays a sole move
test("soleDestination: the chain when a lifted checker has exactly one place to go, else null (bug: second tap put the last checker down)", () => {
  // the QA near-won save: one checker on the 1 point, 2-1 rolled — the 2 bears it off, nothing else
  const last = midTurn(pos({ points: { 0: 1, 20: -5 }, off: { h: 14, c: 10 } }), H, [2, 1]);
  assertEqual(G.legalMoves(last).length, 1);
  const sole = G.soleDestination(last, 0);
  assertTrue(sole && sole.length === 1 && sole[0].to === "off" && sole[0].die === 2, "one chain, bearing off with the 2");
  const won = G.applyMoves(last, sole);
  assertEqual([won.phase, won.winner], ["over", H]);
  // from the start, 24 has three landings with 4-2: not a sole destination
  const open = midTurn(pos({ points: START }), H, [4, 2]);
  assertEqual(G.soleDestination(open, 23), null);
  assertEqual(G.soleDestination(open, 3), null, "no checker there");
  // a checker on the bar with one open entry point
  const bar = midTurn(pos({ points: { 12: 3, 18: -2, 19: -2, 20: -2, 21: -2, 22: -2 }, bar: { h: 1, c: 0 }, off: { h: 11, c: 0 } }), H, [1, 3]);
  const entry = G.soleDestination(bar, "bar");
  assertTrue(entry && entry[0].from === "bar" && entry[0].to === 23, "the single entry");
});

// ------------------------------------------------- the glow the page draws
// Two page bugs came from the destinations of a lifted checker being worked
// out apart from the legal sequences: after entering from the bar, and when
// only one die could be played, tapping a checker lit nothing at all. These
// pin the rule that every legal move's checker has somewhere to glow, and
// that the glow set is exactly what the sequences allow.
test("every legal move's checker lights at least one destination (bug: after entering from the bar, or with only one die playable, tapping a checker glowed nothing)", () => {
  const lights = (s) => {
    for (const m of G.legalMoves(s)) {
      const d = G.destinationsFrom(s, m.from);
      assertTrue(d.length > 0, `no destination for a legal move from ${m.from}`);
      assertTrue(d.some((x) => String(x.to) === String(m.to)), `${m.to} missing from the glow of ${m.from}`);
    }
    assertEqual(
      G.movableFroms(s).map(String).sort(),
      [...new Set(G.legalMoves(s).map((m) => String(m.from)))].sort(),
      "the movable points are exactly the legal moves' sources",
    );
  };

  // 1. a checker on the bar: the 6 entry is blocked, so only the 3 comes in,
  //    and that checker may carry straight on with the 6.
  const onBar = midTurn(pos({ points: { 12: 3, 18: -2 }, bar: { h: 1, c: 0 }, off: { h: 11, c: 0 } }), H, [6, 3]);
  lights(onBar);
  assertEqual(G.movableFroms(onBar), ["bar"], "with a checker on the bar nothing else may move");
  assertEqual(G.destinationsFrom(onBar, "bar").map((d) => d.to).sort((a, b) => a - b), [15, 21],
    "the entry point, and where the same checker can carry on with the other die");
  // 2. and after it has entered, the rest of the roll still glows
  const entered = G.applyMove(onBar, G.legalMoves(onBar)[0]);
  lights(entered);
  assertEqual(G.movableFroms(entered).sort((a, b) => a - b), [12, 21]);

  // 3. only one die can be played: the higher one must be, and only its
  //    checker glows — the checker that could have played the 4 must not.
  const forced = midTurn(pos({ points: { 23: 1, 17: -1, 18: -2, 19: -2, 21: -2, 22: -2 }, off: { h: 14, c: 5 } }), H, [6, 4]);
  lights(forced);
  assertEqual(G.legalMoves(forced).length, 1);
  assertEqual(G.legalMoves(forced)[0].die, 6);
  assertEqual(G.destinationsFrom(forced, 23).map((d) => d.to).sort((a, b) => a - b), [13, 17],
    "24→18 with the 6, and on to 14 with the 4");

  // 4. a sweep of real games: the invariant holds at every position reached
  for (let seed = 1; seed <= 4; seed++) {
    let s = G.newGame({ seed, first: seed % 2 ? H : C });
    for (let guard = 0; guard < 160 && s.phase !== "over"; guard++) {
      if (s.phase === "opening") { s = G.rollOpening(s); continue; }
      if (s.phase === "roll") s = G.rollDice(s);
      lights(s);
      let moves = G.legalMoves(s);
      while (moves.length && s.phase === "move") {
        s = G.applyMove(s, moves[guard % moves.length]);
        if (s.phase !== "move") break;
        lights(s);
        moves = G.legalMoves(s);
      }
      if (s.phase === "move") s = G.endTurn(s);
    }
  }
});

test("bearing off lights the home tray — exact die, a higher die from the highest point, and after a move inside home (bug: the tray never glowed, so the last checker could not be borne off)", () => {
  const offs = (s, from) => G.destinationsFrom(s, from).some((d) => d.to === "off");

  // exact die and higher die from the highest occupied point, in one roll
  const ready = midTurn(pos({ points: { 3: 2, 1: 3 }, off: { h: 10, c: 0 } }), H, [6, 2]);
  assertTrue(offs(ready, 3), "the 6 bears off from the 4 point, the highest one occupied");
  assertTrue(offs(ready, 1), "the 2 bears off the 2 point exactly");
  assertEqual(G.singleMoves(G.posOf(ready), H, 3).filter((m) => m.to === "off"), [],
    "a 3 may not lift the 2 point while the 4 point is occupied");

  // no die bears this checker off on its own — it takes both, and the tray
  // must still glow when the checker is lifted
  const chain = midTurn(pos({ points: { 2: 1 }, off: { h: 14, c: 0 } }), H, [2, 1]);
  assertTrue(offs(chain, 2), "3 point → 1 point → off with the 2 and the 1");
  assertEqual(G.soleDestination(chain, 2), null, "and it can also just move inside home, so it is not a sole move");

  // the last checker: one move, one glow, and it ends the game
  const last = midTurn(pos({ points: { 0: 1, 20: -5 }, off: { h: 14, c: 10 } }), H, [2, 1]);
  assertTrue(offs(last, 0), "the tray glows for the last checker");
  assertEqual(G.destinationsFrom(last, 0).length, 1);
  assertEqual(G.applyMoves(last, G.soleDestination(last, 0)).winner, H);

  // never offered when the fifteen are not all home, or one waits on the bar
  const away = midTurn(pos({ points: { 2: 1, 8: 1 }, off: { h: 13, c: 0 } }), H, [3, 1]);
  assertTrue(!G.canBearOff(G.posOf(away), H));
  assertTrue(!offs(away, 2) && !offs(away, 8), "a checker outside home stops the tray glowing");
  const barred = midTurn(pos({ points: { 2: 1 }, bar: { h: 1, c: 0 }, off: { h: 13, c: 0 } }), H, [1, 2]);
  assertTrue(!G.canBearOff(G.posOf(barred), H));
  assertEqual(G.destinationsFrom(barred, 2), [], "a checker on the bar comes in before anything else moves");
  assertTrue(!G.destinationsFrom(barred, "bar").some((d) => d.to === "off"));

  // the computer's tray follows the same rules, mirrored
  const cReady = midTurn(pos({ points: { 20: -2, 22: -3 }, off: { h: 0, c: 10 } }), C, [6, 2]);
  assertTrue(G.destinationsFrom(cReady, 20).some((d) => d.to === "off"), "a 6 lifts the computer's highest point");
  assertEqual(G.singleMoves(G.posOf(cReady), C, 2).filter((m) => m.to === "off").map((m) => m.from), [22],
    "the exact 2 bears off from the 23 point only");
});
