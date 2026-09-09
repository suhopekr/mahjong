// test/ai.test.js — the computer's play: always legal, deterministic
// from the seed, and sensible on the positions where the right answer
// is well known.
import { test, assertEqual, assertTrue } from "./harness.js";
import * as G from "../src/game/backgammon.js";
import * as AI from "../src/game/ai.js";
import { START, pos, midTurn, sig } from "./helpers.js";

const { HUMAN: H, COMPUTER: C } = G;

/** A random but consistent position: 15 checkers a side over points, bar and off,
 *  never both colours on one point. */
function randomPosition(rng) {
  const points = new Array(24).fill(0);
  const bar = { h: 0, c: 0 }, off = { h: 0, c: 0 };
  for (const player of [H, C]) {
    const sign = player === H ? 1 : -1;
    let left = 15;
    off[player] = Math.floor(rng() * 6); left -= off[player];
    bar[player] = rng() < 0.3 ? 1 + Math.floor(rng() * 2) : 0; left -= bar[player];
    while (left > 0) {
      const i = Math.floor(rng() * 24);
      if (points[i] * sign < 0) continue; // the other colour holds it
      const n = Math.min(left, 1 + Math.floor(rng() * 4));
      points[i] += sign * n;
      left -= n;
    }
  }
  return { points, bar, off };
}

function isLegalSequence(turnStart, player, dice, moves) {
  const legal = G.legalSequences(turnStart, player, dice);
  return legal.some((q) => q.length === moves.length && q.every((m, i) => G.sameMove(m, moves[i])));
}

test("500 random rolls from random positions: the computer always answers with a legal sequence, on both paces", () => {
  const rng = G.makeRng(2024);
  let nonEmpty = 0;
  for (let n = 0; n < 500; n++) {
    const p = randomPosition(rng);
    const dice = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
    const difficulty = n % 2 ? "standard" : "relaxed";
    const s = midTurn(p, C, dice, { difficulty });
    const { moves } = AI.chooseComputerMoves(s);
    assertTrue(isLegalSequence(s.turnStart, C, dice, moves), `#${n} ${difficulty} dice ${dice}: ${sig(moves)} is legal`);
    const best = G.legalSequences(s.turnStart, C, dice);
    if (best[0].length > 0) { assertTrue(moves.length > 0, `#${n}: a move exists, so one is played`); nonEmpty++; }
    // the answer can be applied move by move through the rules
    const after = G.applyMoves(s, moves);
    assertTrue(after.phase === "over" || G.turnComplete(after), `#${n}: the turn is fully played`);
  }
  assertTrue(nonEmpty > 400, "most random positions had a move");
});

test("the computer picks up mid-turn (a restored save) and finishes legally", () => {
  const rng = G.makeRng(77);
  for (let n = 0; n < 60; n++) {
    const p = randomPosition(rng);
    const dice = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
    const s = midTurn(p, C, dice, { difficulty: "standard" });
    const first = G.legalMoves(s);
    if (!first.length) continue;
    const mid = G.applyMove(s, first[Math.floor(rng() * first.length)]);
    const { moves } = AI.chooseComputerMoves(mid);
    const after = G.applyMoves(mid, moves);
    assertTrue(after.phase === "over" || G.turnComplete(after), `#${n}: finishes the turn`);
  }
});

test("standard is deterministic; relaxed draws its noise from the state rng and is reproducible", () => {
  const s = midTurn(pos({ points: START }), C, [3, 1], { difficulty: "standard" });
  const a = AI.chooseComputerMoves(s), b = AI.chooseComputerMoves(s);
  assertEqual(sig(a.moves), sig(b.moves));
  assertEqual(a.rng, s.rng, "standard leaves the rng alone");
  const r = AI.chooseComputerMoves({ ...s, difficulty: "relaxed" });
  assertTrue(r.rng !== s.rng, "relaxed advances the rng");
  assertEqual(sig(AI.chooseComputerMoves({ ...s, difficulty: "relaxed" }).moves), sig(r.moves), "and is reproducible");
});

test("whole seeded games are reproducible and always end", () => {
  const play = (seed, difficulty) => {
    let s = G.newGame({ seed, difficulty });
    while (s.phase === "opening") s = G.rollOpening(s);
    let guard = 0;
    const log = [];
    while (s.phase !== "over" && guard++ < 800) {
      if (s.phase === "roll") s = G.rollDice(s);
      if (s.turn === C) {
        const { moves, rng } = AI.chooseComputerMoves(s);
        s = G.applyMoves({ ...s, rng }, moves);
        log.push("c:" + sig(moves));
      } else {
        const best = AI.bestHumanMoves(s);
        s = G.applyMoves(s, best);
        log.push("h:" + sig(best));
      }
      if (s.phase === "move") { assertTrue(G.turnComplete(s), "turn fully played"); s = G.endTurn(s); }
    }
    assertEqual(s.phase, "over", `seed ${seed} ${difficulty} finishes`);
    assertEqual(s.off[s.winner], 15);
    return log.join("\n");
  };
  for (const difficulty of ["relaxed", "standard"]) {
    for (let seed = 1; seed <= 6; seed++) assertEqual(play(seed, difficulty), play(seed, difficulty), `seed ${seed} replays`);
  }
});

test("relaxed and standard differ in style over many games (relaxed is not just standard)", () => {
  let differ = 0;
  const rng = G.makeRng(9);
  for (let n = 0; n < 40; n++) {
    const p = randomPosition(rng);
    const dice = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
    const a = AI.chooseComputerMoves(midTurn(p, C, dice, { difficulty: "standard" })).moves;
    const b = AI.chooseComputerMoves(midTurn(p, C, dice, { difficulty: "relaxed" })).moves;
    if (sig(a) !== sig(b)) differ++;
  }
  assertTrue(differ >= 5, `relaxed chose differently in ${differ} of 40 positions`);
});

test("evaluation prefers making a point to leaving blots, and hitting to not hitting", () => {
  const s = midTurn(pos({ points: START }), C, [3, 1], { difficulty: "standard" });
  const { moves } = AI.chooseComputerMoves(s);
  // The computer's mirror of 8/5 6/5 is 17→20 and 19→20 (indices 16→19, 18→19).
  assertEqual(sig(moves.slice().sort((x, y) => x.from - y.from)), "16>19/3 18>19/1");
  const withBlot = pos({ points: { 10: 1, 3: -2, 12: 5, 20: -2 } });
  const s2 = midTurn(withBlot, C, [6, 1], { difficulty: "standard" });
  const pick = AI.chooseComputerMoves(s2).moves;
  assertTrue(pick.some((m) => m.hit), "hits the blot on 11");
});

test("the hint is the best human sequence and is always legal", () => {
  const s = midTurn(pos({ points: START }), H, [3, 1]);
  const best = AI.bestHumanMoves(s);
  assertEqual(sig(best.slice().sort((x, y) => x.from - y.from)), "5>4/1 7>4/3", "3-1: make the 5 point");
  assertTrue(isLegalSequence(s.turnStart, H, [3, 1], best));
  const stuck = midTurn(pos({ points: { 23: 1, 17: -2, 18: -2, 19: -2, 20: -2, 21: -2, 22: -2 }, off: { h: 14, c: 0 } }), H, [4, 2]);
  assertEqual(AI.bestHumanMoves(stuck), []);
});

test("bearing off: with all home the computer bears off rather than shuffling", () => {
  const p = pos({ points: { 18: -3, 20: -2, 22: -1, 5: 2, 3: 2 }, off: { h: 11, c: 9 } });
  const s = midTurn(p, C, [6, 2], { difficulty: "standard" });
  const { moves } = AI.chooseComputerMoves(s);
  assertTrue(moves.some((m) => m.to === "off"), "bears a checker off: " + sig(moves));
});

test("hitProbability: a direct 6 is 17/36; combination shots count only along open routes", () => {
  const p = pos({ points: { 10: 1, 4: -1 } });
  assertEqual(Math.round(AI.hitProbability(p, 10, C) * 36), 17);
  // distance 8, every intermediate point held by the blot's owner: nothing gets through
  const p2 = pos({ points: { 10: 1, 2: -1, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2 } });
  assertEqual(AI.hitProbability(p2, 10, C), 0);
  const p3 = pos({ points: { 10: 1, 2: -1 } }); // distance 8: 6-2, 2-6, 5-3, 3-5, 4-4, 2-2 = 6 rolls
  assertEqual(Math.round(AI.hitProbability(p3, 10, C) * 36), 6);
});

test("primeLength and isRace", () => {
  const p = pos({ points: { 5: 2, 4: 2, 3: 2, 2: 2, 0: 2, 23: -2 } });
  assertEqual(AI.primeLength(p, H), 4);
  assertTrue(AI.isRace(p), "the sides have passed each other");
  assertTrue(!AI.isRace(pos({ points: START })), "the start is contact");
  assertTrue(AI.isRace(pos({ points: { 5: 5, 20: -5 } })));
});
