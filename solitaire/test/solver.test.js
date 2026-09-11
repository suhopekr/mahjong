// test/solver.test.js — the deal checker behind "only winnable games".
//
// The point of this suite is the replay: solveDeal() is a second, faster,
// mutable implementation of the rules, and the only thing that makes its
// "yes" trustworthy is that its winning line is handed back to
// klondike.js, played move by move through the real engine, and ends with
// four complete foundations. If the two ever disagree about the rules, a
// replay stops being legal and this fails.
import { test, assertEqual, assertTrue } from "./harness.js";
import { newGame, applyMove, drawFromStock, isWon, foundationIndexFor, cardsAt } from "../src/game/klondike.js";
import { solveDeal, isWinnable, DRAW, W2F, W2T, T2F } from "../src/game/solver.js";

/** Play one of the solver's moves on a real klondike.js state. */
function replayMove(state, m) {
  if (m.k === DRAW) {
    // The solver's `to` is how many cards end up in the waste; getting
    // there is drawing (and turning the deck over) until it does.
    let s = state;
    for (let guard = 0; guard < 60 && s.waste.length !== m.to; guard++) {
      const next = drawFromStock(s);
      if (!next) return null;
      s = next;
    }
    return s.waste.length === m.to ? s : null;
  }
  const from = m.k === W2F || m.k === W2T
    ? { pile: "waste" }
    : { pile: "tableau", index: m.k === T2F ? m.col : m.f, card: m.k === T2F ? state.tableau[m.col].length - 1 : state.tableau[m.f].length - m.n };
  if (m.k === W2F || m.k === T2F) {
    const card = cardsAt(state, from)[0];
    if (!card) return null;
    return applyMove(state, from, { pile: "foundation", index: foundationIndexFor(state, card) });
  }
  return applyMove(state, from, { pile: "tableau", index: m.t });
}

function replay(state, solution) {
  let s = state;
  for (const m of solution) {
    s = replayMove(s, m);
    if (!s) return null;
  }
  return s;
}

test("every win the solver reports is a real, legal, winning line", () => {
  let checked = 0;
  for (const draw of [1, 3]) {
    for (let seed = 1; seed <= 20; seed++) {
      const deal = newGame({ seed, draw, winnable: false });
      const r = solveDeal(deal);
      if (!r.solved) continue;
      const end = replay(deal, r.solution);
      assertTrue(end !== null, `draw ${draw} seed ${seed}: the line has an illegal move in it`);
      assertTrue(isWon(end), `draw ${draw} seed ${seed}: the line ends without a win`);
      checked++;
    }
  }
  assertTrue(checked >= 15, `only ${checked} wins to replay — the solver has stopped solving`);
});

test("a position with no win is refused, and the refusal is a proof", () => {
  // Hand-built to be airtight. Every column's top card is BLACK, so no
  // card on the table can be placed on any other (a tableau build has to
  // alternate colour), and no column is empty, so no King can move either.
  // The four Aces and every red card the black tops would accept — the red
  // Aces, threes, fives and sevens — are face down underneath. Nothing in
  // the deck can be played (the foundations are empty, so only an Ace
  // could go up, and all four are buried), which leaves the search with
  // one position and no moves out of it.
  const c = (id, faceUp) => ({ id, suit: id[0], rank: Number(id.slice(1)), faceUp });
  const tops = ["S2", "C2", "S4", "C4", "S6", "C6", "S8"];
  const buried = ["S1", "C1", "H1", "D1", "H3", "D3", "H5", "D5", "H7", "D7"];
  const tableau = tops.map((id) => [c(id, true)]);
  buried.forEach((id, i) => tableau[i % 7].unshift(c(id, false)));
  const placed = new Set([...tops, ...buried]);
  const stock = [];
  for (const suit of "SHDC") for (let r = 1; r <= 13; r++) if (!placed.has(suit + r)) stock.push(c(suit + r, false));
  const dead = { seed: 0, draw: 1, moves: 0, redeals: 0, stock, waste: [], foundations: [[], [], [], []], tableau };
  assertEqual(stock.length + placed.size, 52, "a whole deck");

  const r = solveDeal(dead);
  assertTrue(!r.solved, "there is no win here");
  assertTrue(!r.exhausted, "and the search proved it rather than running out of budget");
});

test("the search is deterministic and is a pure function of the deal", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const a = solveDeal(newGame({ seed, draw: 1, winnable: false }));
    const b = solveDeal(newGame({ seed, draw: 1, winnable: false }));
    assertEqual(a.solved, b.solved, `seed ${seed}: same answer`);
    assertEqual(a.nodes, b.nodes, `seed ${seed}: same amount of work`);
  }
});

test("a budget that has run out is never mistaken for an answer", () => {
  // One node is nowhere near enough to win anything; the result must say
  // exhausted, and isWinnable() must read that as "no".
  const deal = newGame({ seed: 3, draw: 1, winnable: false });
  const r = solveDeal(deal, { nodeBudget: 1, restarts: 1 });
  assertTrue(!r.solved, "no win claimed");
  assertTrue(r.exhausted, "the budget is reported as spent");
  assertTrue(!isWinnable(deal, { nodeBudget: 1, restarts: 1 }), "and that is not winnable");
});

test("an already-won deal solves in no moves", () => {
  const won = { seed: 0, draw: 1, stock: [], waste: [], moves: 0, redeals: 0, tableau: [[], [], [], [], [], [], []],
    foundations: ["S", "H", "D", "C"].map((s) => Array.from({ length: 13 }, (_, r) => ({ id: s + (r + 1), suit: s, rank: r + 1, faceUp: true }))) };
  const r = solveDeal(won);
  assertTrue(r.solved);
  assertEqual(r.solution, []);
});
