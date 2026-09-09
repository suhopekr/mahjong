// test/freecell.test.js — the rules engine, exercised without a browser.
import { test, assertEqual, assertTrue } from "./harness.js";
import {
  newGame, msShuffle, msRand, makeRng, randomDealNumber, isValidDealNumber, formatDeal, UNSOLVABLE,
  canMove, moveProblem, applyMove, destinationsFor, autoMoveTarget, maxMovable, cardsAt, isRun,
  findHint, describeHint, isWon, canAutoComplete, autoCompleteStep, safeAutoplayStep, isSafeToFoundation,
  RANK_LABEL, SUITS,
} from "../src/game/freecell.js";
import { solve } from "./solver.js";

const short = (c) => RANK_LABEL[c.rank].replace("10", "T") + c.suit;
const card = (s) => { const r = s.slice(0, -1), suit = s.slice(-1); return { id: suit + (r === "T" ? 10 : RANK_LABEL.indexOf(r)), suit, rank: r === "T" ? 10 : RANK_LABEL.indexOf(r) }; };
const cards = (s) => (Array.isArray(s) ? s : s.split(" ").filter(Boolean).map(card));
/** A hand-built position: cascades as "AS 2H …" strings, cells as card codes or null. */
function position({ cascades = [], cells = [null, null, null, null], foundations = [[], [], [], []], deal = 1 } = {}) {
  while (cascades.length < 8) cascades.push("");
  return { deal, cascades: cascades.map(cards), cells: cells.map((c) => (c ? card(c) : null)), foundations: foundations.map(cards), moves: 0 };
}
const cas = (index, cardIdx) => ({ pile: "cascade", index, ...(cardIdx === undefined ? {} : { card: cardIdx }) });

// ---------------------------------------------------------------- deals

test("deal #1 is the classic Microsoft layout (row 1 = JD 2D 9H JC 5D 7H 7C 5H)", () => {
  const s = newGame({ deal: 1 });
  const row1 = s.cascades.map((p) => short(p[0])).join(" ");
  assertEqual(row1, "JD 2D 9H JC 5D 7H 7C 5H");
  assertEqual(s.cascades[0].map(short).join(" "), "JD KD 2S 4C 3S 6D 6S", "column 1 top-down");
  assertEqual(s.cascades[7].map(short).join(" "), "5H 3H 3C 7S 7D TC", "column 8 top-down");
  assertEqual(s.cascades.map((p) => p.length), [7, 7, 7, 7, 6, 6, 6, 6]);
});

test("deal #617 and #11982 match published layouts (first row)", () => {
  assertEqual(newGame({ deal: 617 }).cascades.map((p) => short(p[0])).join(" "), "7D AD 5C 3S 5S 8C 2D AH");
  assertEqual(newGame({ deal: 11982 }).cascades.map((p) => short(p[0])).join(" "), "AH AS 4H AC 2D 6S TS JS");
});

test("the Microsoft LCG is deterministic and the shuffle is a permutation of 52", () => {
  const a = msRand(5), b = msRand(5);
  for (let i = 0; i < 10; i++) assertEqual(a(), b());
  const r = msRand(1);
  assertEqual([r(), r(), r()], [41, 18467, 6334], "first rand() values of seed 1, as in C");
  const order = msShuffle(4217);
  assertEqual(new Set(order.map((c) => c.id)).size, 52);
  assertEqual(msShuffle(4217).map((c) => c.id).join(), order.map((c) => c.id).join(), "same deal twice");
  assertTrue(msShuffle(4218).map((c) => c.id).join() !== order.map((c) => c.id).join(), "different deal differs");
});

test("makeRng is reproducible; random deal numbers stay in 1–32000 and skip 11982", () => {
  const a = makeRng(7), b = makeRng(7);
  assertEqual([a(), a()], [b(), b()]);
  const rng = makeRng(3);
  for (let i = 0; i < 2000; i++) {
    const n = randomDealNumber(rng);
    assertTrue(n >= 1 && n <= 32000 && !UNSOLVABLE.has(n), "deal " + n);
  }
  assertTrue(isValidDealNumber(999999) && !isValidDealNumber(0) && !isValidDealNumber(1.5) && !isValidDealNumber(1000000));
  assertEqual(formatDeal(4217), "4,217");
  assertEqual(formatDeal(12), "12");
});

test("a new game has every card once, no cells, no foundations, 0 moves", () => {
  const s = newGame({ deal: 100 });
  const ids = s.cascades.flat().map((c) => c.id);
  assertEqual(ids.length, 52);
  assertEqual(new Set(ids).size, 52);
  assertEqual(s.cells, [null, null, null, null]);
  assertEqual(s.foundations, [[], [], [], []]);
  assertEqual(s.moves, 0);
  assertEqual(s.deal, 100);
});

// ---------------------------------------------------------------- rules

test("cascades build down in alternating colours; anything goes on an empty cascade", () => {
  const s = position({ cascades: ["7S", "6H", "6D", "8H", "", "KC"] });
  assertTrue(canMove(s, cas(1), cas(0)), "6H on 7S");
  assertTrue(!canMove(s, cas(2), cas(3)), "6D on 8H (not one lower)");
  assertEqual(moveProblem(s, cas(2), cas(3)).reason, "cascade");
  assertTrue(!canMove(s, cas(0), cas(5)), "7S on KC");
  const black6 = position({ cascades: ["7S", "6S"] });
  assertTrue(!canMove(black6, cas(1), cas(0)), "6S on 7S same colour");
  assertTrue(canMove(s, cas(1), cas(4)), "6H onto empty cascade");
  assertTrue(canMove(s, cas(5), cas(4)), "K onto empty cascade");
  assertTrue(!canMove(s, cas(0), cas(0)), "same place");
});

test("free cells hold one card each; foundations build up by suit from the Ace", () => {
  const s = position({ cascades: ["AS", "2S", "5S 4H 3S", "5D"], cells: ["9C", null, null, null] });
  const cell = (i) => ({ pile: "cell", index: i });
  const found = (i) => ({ pile: "foundation", index: i });
  assertEqual(moveProblem(s, cas(0), cell(0)).reason, "cellFull");
  assertTrue(canMove(s, cas(0), cell(1)));
  assertEqual(moveProblem(s, cas(2, 1), cell(1)).reason, "single", "a run cannot go into a cell");
  assertTrue(canMove(s, cas(0), found(0)), "Ace to an empty foundation");
  assertEqual(moveProblem(s, cas(1), found(0)).reason, "foundation", "2 before the Ace");
  let n = applyMove(s, cas(0), found(0));
  assertTrue(canMove(n, cas(1), found(0)), "2S on AS");
  assertTrue(!canMove(n, cas(1), found(1)), "2S on an empty foundation");
  n = applyMove(n, cas(1), found(0));
  assertEqual(n.foundations[0].map(short), ["AS", "2S"]);
  assertEqual(n.moves, 2);
  assertTrue(!canMove(n, { pile: "cell", index: 0 }, found(1)), "9C is not an Ace");
  assertTrue(canMove(n, { pile: "cell", index: 0 }, cas(1)), "cell card down to the now-empty cascade");
});

test("only a proper run can be lifted; a covered card is not liftable", () => {
  const s = position({ cascades: ["9S 8H 7C", "9S 4H 7C"] });
  assertEqual(cardsAt(s, cas(0, 0)).map(short), ["9S", "8H", "7C"]);
  assertEqual(cardsAt(s, cas(1, 0)), [], "9S 4H 7C is not a run");
  assertEqual(cardsAt(s, cas(1, 1)), [], "4H 7C is not a run");
  assertEqual(cardsAt(s, cas(1, 2)).map(short), ["7C"]);
  assertTrue(isRun(cards("QD JS TH")) && !isRun(cards("QD JD")) && !isRun(cards("QD TS")));
  assertEqual(cardsAt(s, { pile: "foundation", index: 0 }), [], "foundation cards never move back");
});

test("run length rule: (empty cells + 1) × 2^(empty cascades not counting the destination)", () => {
  // 5-card run, 4 empty cells, no empty cascades: 5 allowed
  const FILL = ["AS", "AH", "AD", "AC", "2S"];
  let s = position({ cascades: ["KS", "TH 9C 8D 7S 6H", "JC", ...FILL] });
  assertEqual(maxMovable(s), 5);
  assertTrue(canMove(s, cas(1, 0), cas(2)), "5 cards with 4 free cells");
  // fill three cells: only 2 may move
  s = position({ cascades: ["KS", "TH 9C 8D 7S 6H", "JC", ...FILL], cells: ["2S", "3S", "4S", null] });
  assertEqual(maxMovable(s), 2);
  const p = moveProblem(s, cas(1, 0), cas(2));
  assertEqual(p, { reason: "tooMany", count: 5, allowed: 2 });
  assertTrue(canMove(s, cas(1, 3), cas(2)) === false, "7S 6H does not go on JC anyway");
  // one empty cascade doubles it, but not when the empty cascade is the destination
  s = position({ cascades: ["KS", "TH 9C 8D 7S 6H", "TD", "", "AS", "AH", "AD", "AC"], cells: ["2S", "3S", "4S", null] });
  assertEqual(maxMovable(s), 4);
  assertEqual(maxMovable(s, true), 2);
  assertTrue(canMove(s, cas(1, 1), cas(2)), "4 cards (9C down) to TD with an empty column helping");
  assertTrue(!canMove(s, cas(1, 0), cas(2)), "TH does not go on TD");
  assertTrue(!canMove(s, cas(1, 1), cas(3)), "4 cards to the empty column itself: only 2");
  assertTrue(canMove(s, cas(1, 3), cas(3)), "2 cards to the empty column");
  // two empty cascades, no cells: 4 to an occupied cascade
  s = position({ cascades: ["KS", "TH 9C 8D 7S 6H", "JC", "", "", "AS", "AH", "AD"], cells: ["2S", "3S", "4S", "5S"] });
  assertEqual(maxMovable(s), 4);
  assertEqual(maxMovable(s, true), 2);
});

test("applyMove never mutates its input and refuses an illegal move", () => {
  const s = position({ cascades: ["7S", "6H"] });
  const before = JSON.stringify(s);
  const n = applyMove(s, cas(1), cas(0));
  assertEqual(JSON.stringify(s), before);
  assertEqual(n.cascades[0].map(short), ["7S", "6H"]);
  assertEqual(n.cascades[1], []);
  assertEqual(applyMove(s, cas(0), cas(1)), null);
});

// ---------------------------------------------------------------- tap targets

test("autoMoveTarget: foundation before a build, a build before a cell, a cell only for a lone card", () => {
  // AS can go Home and also onto 2H: Home wins
  let s = position({ cascades: ["AS", "2H"] });
  assertEqual(autoMoveTarget(s, cas(0)), { pile: "foundation", index: 0 });
  // 6H can go onto 7S; the free cells are all empty but never chosen
  s = position({ cascades: ["7S", "6H", "9C"] });
  assertEqual(autoMoveTarget(s, cas(1)), cas(0));
  // 9C has no build: a lone card goes to a free cell before an empty column
  s = position({ cascades: ["7S", "6H", "9C", ""] });
  assertEqual(autoMoveTarget(s, cas(2)), { pile: "cell", index: 0 });
  // a King goes to the empty column (a lone King that IS the column stays put)
  s = position({ cascades: ["7S", "6H", "3D KC", ""] });
  assertEqual(autoMoveTarget(s, cas(2, 1)), cas(3));
  s = position({ cascades: ["7S", "6H", "KC", ""] });
  assertEqual(autoMoveTarget(s, cas(2)), { pile: "cell", index: 0 });
  // a run cannot go to a cell: it takes the empty column
  s = position({ cascades: ["7S", "3H 9D 8C", "", "2S"] });
  assertEqual(autoMoveTarget(s, cas(1, 1)), cas(2));
  // nothing at all: no cells, no empty column, no build
  s = position({ cascades: ["7S", "9C"], cells: ["2S", "3S", "4S", "5S"] });
  assertEqual(autoMoveTarget(s, cas(1)), null);
  // a whole cascade into another empty cascade is pointless
  s = position({ cascades: ["KC", "", "3H"] });
  assertEqual(autoMoveTarget(s, cas(0)), { pile: "cell", index: 0 });
});

test("autoMoveTarget prefers the build with the longest run so runs stay together", () => {
  const s = position({ cascades: ["5H", "TS 9H 8S 7H 6S", "6C", "3D"] });
  assertEqual(autoMoveTarget(s, cas(0)), cas(1));
  assertEqual(destinationsFor(s, cas(0)).map((d) => d.pile), ["cascade", "cascade", "cascade", "cell"], "builds, one empty column, one cell");
});

// ---------------------------------------------------------------- autoplay

test("safe autoplay: Aces and 2s always; a higher card only when both opposite-colour cards one lower are Home", () => {
  let s = position({ cascades: ["AS", "2S", "3S"], foundations: [[], [], [], []] });
  assertTrue(isSafeToFoundation(s, card("AS")) && isSafeToFoundation(s, card("2S")));
  assertEqual(safeAutoplayStep(s), { from: cas(0, 0), to: { pile: "foundation", index: 0 } });
  s = applyMove(s, cas(0, 0), { pile: "foundation", index: 0 });
  s = applyMove(s, cas(1, 0), { pile: "foundation", index: 0 });
  assertTrue(!isSafeToFoundation(s, card("3S")), "3S needs 2H and 2D Home first");
  assertEqual(safeAutoplayStep(s), null);
  s = position({ cascades: ["3S"], foundations: ["AS 2S", "AH 2H", "AD 2D", []] });
  assertTrue(isSafeToFoundation(s, card("3S")));
  assertEqual(safeAutoplayStep(s).to, { pile: "foundation", index: 0 });
  s = position({ cascades: ["3S"], foundations: ["AS 2S", "AH 2H", "AD", []] });
  assertEqual(safeAutoplayStep(s), null, "2D still on the table");
  // the lowest safe card goes first, and a cell card counts
  s = position({ cascades: ["2H"], cells: ["AC", null, null, null], foundations: ["AH", [], [], []] });
  assertEqual(safeAutoplayStep(s).from, { pile: "cell", index: 0 });
});

test("auto-complete when every cascade runs downward, and it finishes the game", () => {
  let s = position({
    cascades: ["KS QS JS TS 9S 8S 7S 6S 5S 4S 3S 2S", "KH QH JH", "KD QD JD TD", "KC"],
    cells: ["AS", null, null, null],
    foundations: [[], "AH 2H 3H 4H 5H 6H 7H 8H 9H TH", "AD 2D 3D 4D 5D 6D 7D 8D 9D", "AC 2C 3C 4C 5C 6C 7C 8C 9C TC JC QC"],
  });
  assertEqual(s.cascades.flat().length + 1 + s.foundations.flat().length, 52, "a complete deck");
  assertTrue(canAutoComplete(s));
  let n = 0;
  for (let step; (step = autoCompleteStep(s)); n++) s = applyMove(s, step.from, step.to);
  assertTrue(isWon(s), "won after " + n + " steps");
  assertEqual(n, 21);
  assertTrue(!canAutoComplete(s), "not offered once won");
  assertTrue(!canAutoComplete(position({ cascades: ["3S 9H"] })), "a 9 under a 3 is not in order");
  assertTrue(canAutoComplete(position({ cascades: ["9H 3S"] })), "same colour is fine as long as it runs down");
});

// ---------------------------------------------------------------- hints

test("hint priority: foundation → emptying a cascade / freeing a cell → a build → a free cell", () => {
  // 1. foundation first even when a build exists
  let s = position({ cascades: ["AS", "2H", "7C", "8D"] });
  let h = findHint(s);
  assertEqual(h, { from: cas(0, 0), to: { pile: "foundation", index: 0 } });
  assertEqual(describeHint(s, h).key, "hintHome");
  // 2a. a whole cascade onto another cascade (empties a column) beats a mid-column build
  s = position({ cascades: ["8D", "9S 5H", "6C", "7H"] });
  h = findHint(s);
  assertEqual(h, { from: cas(2, 0), to: cas(3) }, "6C (whole cascade) onto 7H");
  // 2b. a cell card onto a cascade (frees a cell) beats a build
  s = position({ cascades: ["8D", "9S 5H", "6C 4D", "7H"], cells: ["7S", null, null, null] });
  h = findHint(s);
  assertEqual(h, { from: { pile: "cell", index: 0 }, to: cas(0) }, "7S from the cell onto 8D");
  // 3. a build that uncovers a card
  s = position({ cascades: ["8D", "9S 5S", "6C 4D", "KH"] });
  h = findHint(s);
  assertEqual(h.to.pile, "cascade");
  assertTrue(!!s.cascades[h.to.index].length, "onto an occupied cascade");
  assertEqual(short(cardsAt(s, h.from)[0]), "4D");
  assertEqual(describeHint(s, h), { key: "hintOnto", card: card("4D"), count: 1, dest: card("5S") });
  // 4. no build possible: a free cell — the card covering the lowest needed card first
  s = position({ cascades: ["9S 9H", "AC 8H", "KD"] });
  h = findHint(s);
  assertEqual(h, { from: cas(1, 1), to: { pile: "cell", index: 0 } }, "8H (covering the Ace) into a cell");
  assertEqual(describeHint(s, h).key, "hintCell");
  // nothing at all
  s = position({ cascades: ["9C", "9H", "9S", "9D", "AS 7S", "7H", "7D", "7C"], cells: ["2S", "3S", "4S", "5S"] });
  assertEqual(findHint(s), null);
  assertEqual(describeHint(s, null), { key: "hintNone" });
});

test("hint describes a run with its count, and an empty column", () => {
  const s = position({ cascades: ["KC 9D 8C", "TS", ""] });
  const h = findHint(s);
  assertEqual(h, { from: cas(0, 1), to: cas(1) });
  const d = describeHint(s, h);
  assertEqual([d.key, short(d.card), d.count, short(d.dest)], ["hintOnto", "9D", 2, "TS"]);
  const e = position({ cascades: ["3C KD QS", "5H", "", "9D"] });
  const he = findHint(e);
  assertEqual(he, { from: cas(0, 1), to: cas(2) }, "the K Q run to the empty column");
  assertEqual(describeHint(e, he).key, "hintEmpty");
});

test("a hint is always a legal move on 200 random positions from real deals", () => {
  const rng = makeRng(99);
  for (let d = 1; d <= 200; d++) {
    let s = newGame({ deal: d });
    for (let i = 0; i < 12; i++) {
      const h = findHint(s);
      if (!h) break;
      assertTrue(canMove(s, h.from, h.to), `deal ${d} step ${i}`);
      s = applyMove(s, h.from, h.to);
      let st;
      while ((st = safeAutoplayStep(s))) s = applyMove(s, st.from, st.to);
      if (rng() < 0.2) break;
    }
  }
});

// ---------------------------------------------------------------- winnable

test("at least one of the first 50 deals is won by following hints alone", () => {
  const wins = [];
  for (let d = 1; d <= 50; d++) {
    let s = newGame({ deal: d });
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const h = findHint(s);
      if (!h) break;
      s = applyMove(s, h.from, h.to);
      let st;
      while ((st = safeAutoplayStep(s))) s = applyMove(s, st.from, st.to);
      if (canAutoComplete(s)) while ((st = autoCompleteStep(s))) s = applyMove(s, st.from, st.to);
      if (isWon(s)) { wins.push(d); break; }
      const k = JSON.stringify([s.cascades, s.cells]);
      if (seen.has(k)) break;
      seen.add(k);
    }
  }
  assertTrue(wins.length >= 1, "hint-following wins: " + wins.join(","));
});

test("deal #1 is won by a scripted solution replayed through applyMove", () => {
  const start = newGame({ deal: 1 });
  const solution = solve(start);
  assertTrue(Array.isArray(solution), "the solver found a line");
  let s = start;
  for (const m of solution) {
    assertTrue(canMove(s, m.from, m.to), "every scripted move is legal");
    s = applyMove(s, m.from, m.to);
  }
  assertTrue(isWon(s));
  assertEqual(s.foundations.map((p) => p.length), [13, 13, 13, 13]);
  assertEqual(s.moves, solution.length);
  assertEqual(SUITS.length, 4);
});
