// test/klondike.test.js — the rules, without a browser.
import { test, assertEqual, assertTrue } from "./harness.js";
import {
  newGame, makeDeck, canPlaceOnFoundation, canPlaceOnTableau, canMove, applyMove,
  drawFromStock, destinationsFor, autoMoveTarget, findHint, describeHint,
  isWon, canAutoComplete, autoCompleteStep, cardsAt, foundationIndexFor, makeRng, shuffle,
} from "../src/game/klondike.js";

const card = (suit, rank, faceUp = true) => ({ id: suit + rank, suit, rank, faceUp });

function emptyState(draw = 1) {
  return { seed: 0, draw, stock: [], waste: [], foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []], moves: 0, redeals: 0 };
}

test("a deck is 52 distinct cards", () => {
  const deck = makeDeck();
  assertEqual(deck.length, 52);
  assertEqual(new Set(deck.map((c) => c.id)).size, 52);
});

test("shuffle keeps every card and is reproducible from the seed", () => {
  const a = shuffle(makeDeck(), makeRng(42)).map((c) => c.id);
  const b = shuffle(makeDeck(), makeRng(42)).map((c) => c.id);
  const c = shuffle(makeDeck(), makeRng(43)).map((c) => c.id);
  assertEqual(a, b, "same seed, same order");
  assertTrue(a.join() !== c.join(), "different seed, different order");
  assertEqual([...a].sort(), makeDeck().map((x) => x.id).sort());
});

test("a new game deals 1..7 to the tableau, last card face up, 24 to the stock", () => {
  const s = newGame({ seed: 7 });
  assertEqual(s.tableau.map((p) => p.length), [1, 2, 3, 4, 5, 6, 7]);
  for (const pile of s.tableau) {
    pile.forEach((c, i) => assertEqual(c.faceUp, i === pile.length - 1, `only the last card is face up`));
  }
  assertEqual(s.stock.length, 24);
  assertTrue(s.stock.every((c) => !c.faceUp), "stock is face down");
  assertEqual(s.waste, []);
  assertEqual(s.foundations, [[], [], [], []]);
  const all = [...s.stock, ...s.tableau.flat()].map((c) => c.id);
  assertEqual(new Set(all).size, 52, "every card is somewhere exactly once");
});

test("same seed deals the same game; no seed gives a random one", () => {
  const a = newGame({ seed: 99 }), b = newGame({ seed: 99 });
  assertEqual(a.tableau, b.tableau);
  const c = newGame(), d = newGame();
  assertTrue(typeof c.seed === "number");
  assertTrue(JSON.stringify(c.tableau) !== JSON.stringify(d.tableau) || c.seed === d.seed);
});

test("foundation rule: Ace on empty, then same suit going up", () => {
  assertTrue(canPlaceOnFoundation(card("H", 1), []));
  assertTrue(!canPlaceOnFoundation(card("H", 2), []));
  assertTrue(canPlaceOnFoundation(card("H", 2), [card("H", 1)]));
  assertTrue(!canPlaceOnFoundation(card("S", 2), [card("H", 1)]), "different suit");
  assertTrue(!canPlaceOnFoundation(card("H", 3), [card("H", 1)]), "skips a rank");
});

test("tableau rule: King on empty, otherwise one lower and the other colour", () => {
  assertTrue(canPlaceOnTableau(card("S", 13), []));
  assertTrue(!canPlaceOnTableau(card("S", 12), []));
  assertTrue(canPlaceOnTableau(card("H", 12), [card("S", 13)]), "red Q on black K");
  assertTrue(canPlaceOnTableau(card("D", 12), [card("C", 13)]), "red Q on black K (clubs)");
  assertTrue(!canPlaceOnTableau(card("S", 12), [card("C", 13)]), "black on black");
  assertTrue(!canPlaceOnTableau(card("H", 11), [card("S", 13)]), "two lower");
  assertTrue(!canPlaceOnTableau(card("H", 12), [card("S", 13, false)]), "never onto a face-down card");
});

test("cardsAt: a face-up run moves together, a face-down card does not move", () => {
  const s = emptyState();
  s.tableau[0] = [card("S", 9, false), card("H", 8), card("C", 7), card("D", 6)];
  assertEqual(cardsAt(s, { pile: "tableau", index: 0, card: 1 }).map((c) => c.id), ["H8", "C7", "D6"]);
  assertEqual(cardsAt(s, { pile: "tableau", index: 0, card: 3 }).map((c) => c.id), ["D6"]);
  assertEqual(cardsAt(s, { pile: "tableau", index: 0, card: 0 }), [], "face-down card is not liftable");
  assertEqual(cardsAt(s, { pile: "tableau", index: 0 }).map((c) => c.id), ["D6"], "no card index = top card");
});

test("applyMove moves a run, flips the card it uncovers, and leaves the old state alone", () => {
  const s = emptyState();
  s.tableau[0] = [card("S", 9, false), card("H", 8), card("C", 7)];
  s.tableau[1] = [card("S", 9)];
  const from = { pile: "tableau", index: 0, card: 1 }, to = { pile: "tableau", index: 1 };
  assertTrue(canMove(s, from, to));
  const n = applyMove(s, from, to);
  assertEqual(n.tableau[1].map((c) => c.id), ["S9", "H8", "C7"]);
  assertEqual(n.tableau[0].map((c) => c.id), ["S9"]);
  assertTrue(n.tableau[0][0].faceUp, "uncovered card turned face up");
  assertTrue(n.lastFlip, "reports the flip");
  assertEqual(n.moves, 1);
  assertEqual(s.tableau[0].length, 3, "input state untouched");
  assertTrue(!s.tableau[0][0].faceUp, "input state untouched (face)");
});

test("applyMove refuses an illegal move", () => {
  const s = emptyState();
  s.tableau[0] = [card("H", 8)];
  s.tableau[1] = [card("D", 9)];
  assertEqual(applyMove(s, { pile: "tableau", index: 0 }, { pile: "tableau", index: 1 }), null);
  assertEqual(applyMove(s, { pile: "tableau", index: 0 }, { pile: "tableau", index: 0 }), null, "onto itself");
});

test("only a single card goes to a foundation, and to the pile of its suit", () => {
  const s = emptyState();
  s.foundations[0] = [card("H", 1)];
  s.tableau[0] = [card("S", 3), card("H", 2)];
  assertEqual(foundationIndexFor(s, card("H", 2)), 0);
  assertEqual(foundationIndexFor(s, card("S", 1)), 1, "first empty pile for a new suit");
  const n = applyMove(s, { pile: "tableau", index: 0, card: 1 }, { pile: "foundation", index: 0 });
  assertEqual(n.foundations[0].map((c) => c.id), ["H1", "H2"]);
  assertEqual(applyMove(s, { pile: "tableau", index: 0, card: 0 }, { pile: "foundation", index: 0 }), null, "two cards can't go up");
});

test("Draw 1 turns one card; Draw 3 turns three with the third on top", () => {
  const s1 = newGame({ seed: 5, draw: 1 });
  const d1 = drawFromStock(s1);
  assertEqual(d1.waste.length, 1);
  assertEqual(d1.stock.length, 23);
  assertTrue(d1.waste[0].faceUp);
  assertEqual(d1.waste[0].id, s1.stock[23].id, "top of stock becomes the waste card");

  const s3 = newGame({ seed: 5, draw: 3 });
  const d3 = drawFromStock(s3);
  assertEqual(d3.waste.length, 3);
  assertEqual(d3.stock.length, 21);
  assertEqual(d3.waste.map((c) => c.id), [s3.stock[23].id, s3.stock[22].id, s3.stock[21].id]);
});

test("an empty stock turns the waste back over, in order, as often as you like", () => {
  let s = newGame({ seed: 11, draw: 3 });
  const order = s.stock.map((c) => c.id);
  while (s.stock.length) s = drawFromStock(s);
  assertEqual(s.waste.length, 24);
  const r = drawFromStock(s);
  assertEqual(r.waste, []);
  assertEqual(r.stock.map((c) => c.id), order, "same order as the first time through");
  assertTrue(r.stock.every((c) => !c.faceUp));
  assertEqual(r.redeals, 1);
  assertEqual(drawFromStock(emptyState()), null, "nothing to draw and nothing to turn over");
});

test("destinationsFor lists foundation first, then every tableau column that takes it", () => {
  const s = emptyState();
  s.foundations[0] = [card("H", 1)];
  s.waste = [card("H", 2)];
  s.tableau[0] = [card("S", 3)];
  s.tableau[1] = [card("C", 3)];
  s.tableau[2] = [card("D", 3)];
  const d = destinationsFor(s, { pile: "waste" });
  assertEqual(d, [{ pile: "foundation", index: 0 }, { pile: "tableau", index: 0 }, { pile: "tableau", index: 1 }]);
});

test("autoMoveTarget prefers the foundation, then a real build over an empty column", () => {
  const s = emptyState();
  s.tableau[0] = [card("D", 5)];
  s.tableau[1] = [card("S", 6)];
  s.tableau[2] = [];
  assertEqual(autoMoveTarget(s, { pile: "tableau", index: 0 }), { pile: "tableau", index: 1 });
  s.foundations[0] = [card("D", 1), card("D", 2), card("D", 3), card("D", 4)];
  assertEqual(autoMoveTarget(s, { pile: "tableau", index: 0 }), { pile: "foundation", index: 0 });
});

test("autoMoveTarget refuses to shuffle a lone King between empty columns", () => {
  const s = emptyState();
  s.tableau[0] = [card("S", 13), card("H", 12)];
  s.tableau[3] = [];
  assertEqual(autoMoveTarget(s, { pile: "tableau", index: 0, card: 0 }), null, "pointless");
  s.tableau[0] = [card("C", 2, false), card("S", 13), card("H", 12)];
  assertEqual(autoMoveTarget(s, { pile: "tableau", index: 0, card: 1 }), { pile: "tableau", index: 1 }, "reveals a card, so it counts (first empty column)");
});

test("autoMoveTarget: a King moves to an empty column from the waste", () => {
  const s = emptyState();
  s.waste = [card("H", 13)];
  assertEqual(autoMoveTarget(s, { pile: "waste" }), { pile: "tableau", index: 0 });
});

test("hint: foundation move first", () => {
  const s = emptyState();
  s.waste = [card("S", 7)];
  s.tableau[0] = [card("C", 1)];
  s.tableau[1] = [card("H", 8)];
  const h = findHint(s);
  assertEqual(h, { from: { pile: "tableau", index: 0, card: 0 }, to: { pile: "foundation", index: 0 } });
  assertEqual(describeHint(s, h), "Move the A of clubs up to its pile.");
});

test("hint: uncovering a face-down card beats playing from the waste", () => {
  const s = emptyState();
  s.waste = [card("S", 7)];
  s.tableau[0] = [card("C", 4, false), card("H", 6)];
  s.tableau[1] = [card("S", 7)];
  s.tableau[2] = [card("D", 8)];
  const h = findHint(s);
  assertEqual(h.from, { pile: "tableau", index: 0, card: 1 });
  assertEqual(h.to, { pile: "tableau", index: 1 });
  assertEqual(describeHint(s, h), "Move the 6 of hearts onto the 7 of spades.");
});

test("hint: falls back to the waste card, then to drawing, then to nothing", () => {
  const s = emptyState();
  s.waste = [card("S", 7)];
  s.tableau[2] = [card("D", 8)];
  assertEqual(findHint(s), { from: { pile: "waste" }, to: { pile: "tableau", index: 2 } });
  s.waste = [card("S", 2)];
  s.stock = [card("C", 9, false)];
  assertEqual(findHint(s), { draw: true });
  assertEqual(describeHint(s, { draw: true }), "Turn over the next card from the deck.");
  s.stock = [];
  assertEqual(describeHint(s, { draw: true }), "Turn the deck over and go through it again.");
  s.waste = [];
  assertEqual(findHint(s), null);
  assertEqual(describeHint(s, null), "No moves left — try a new game.");
});

test("hint never suggests a pointless King shuffle", () => {
  const s = emptyState();
  s.tableau[0] = [card("S", 13)];
  s.tableau[1] = [];
  assertEqual(findHint(s), null);
});

test("win and auto-complete detection", () => {
  const s = emptyState();
  assertTrue(!isWon(s));
  for (let i = 0; i < 4; i++) s.foundations[i] = Array.from({ length: 13 }, (_, r) => card("SHDC"[i], r + 1));
  assertTrue(isWon(s));
  assertTrue(!canAutoComplete(s), "a won game has nothing to complete");

  const t = emptyState();
  t.tableau[0] = [card("S", 2), card("H", 1)];
  t.tableau[1] = [card("S", 1)];
  assertTrue(canAutoComplete(t), "everything face up, stock empty");
  t.stock = [card("D", 9, false)];
  assertTrue(!canAutoComplete(t), "stock still has cards");
  t.stock = [];
  t.tableau[0][0].faceUp = false;
  assertTrue(!canAutoComplete(t), "a face-down card remains");
});

test("auto-complete plays the lowest available card up each step until the game is won", () => {
  let s = emptyState();
  s.tableau[0] = [card("S", 2), card("H", 1)];
  s.tableau[1] = [card("S", 1)];
  s.tableau[2] = [card("H", 2)];
  const step1 = autoCompleteStep(s);
  assertEqual(cardsAt(s, step1.from)[0].rank, 1, "an Ace goes first");
  let guard = 0;
  while (!isWon(s) && guard++ < 10) {
    const step = autoCompleteStep(s);
    if (!step) break;
    s = applyMove(s, step.from, step.to);
  }
  assertEqual(s.foundations.map((p) => p.length), [2, 2, 0, 0]);
  assertEqual(autoCompleteStep(s), null, "nothing left to play");
});

test("a full game can be won by following hints and auto-complete (seeded)", () => {
  // Not every seed is winnable by this greedy policy; the test only needs
  // one that is, to prove the pieces fit together end to end.
  let won = false;
  for (let seed = 1; seed <= 60 && !won; seed++) {
    let s = newGame({ seed, draw: 1 });
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      if (isWon(s)) { won = true; break; }
      const key = JSON.stringify([s.stock.map((c) => c.id), s.waste.map((c) => c.id), s.tableau.map((p) => p.map((c) => c.id + (c.faceUp ? "u" : "d")))]);
      if (seen.has(key) && !canAutoComplete(s)) break;
      seen.add(key);
      const h = findHint(s);
      if (!h) break;
      s = h.draw ? drawFromStock(s) : applyMove(s, h.from, h.to);
    }
  }
  assertTrue(won, "the hint policy wins at least one of the first 60 seeds");
});
