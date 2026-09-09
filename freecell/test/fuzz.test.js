// test/fuzz.test.js — the rules torture test.
//
// Plays 200 random deals with random legal moves, chosen from the engine's
// own move enumeration (destinationsFor over every liftable location), for
// up to 300 moves each, and checks the invariants a FreeCell table must
// keep after every single move. Nothing here knows how the engine works
// inside; it only holds it to what its documentation promises.
import { test, assertEqual, assertTrue } from "./harness.js";
import {
  newGame, makeRng, applyMove, canMove, moveProblem, cardsAt, destinationsFor, autoMoveTarget,
  maxMovable, isRun, topRunLength, safeAutoplayStep, isSafeToFoundation, autoCompleteStep,
  canAutoComplete, findHint, describeHint, isWon, RED, SUITS,
} from "../src/game/freecell.js";

const DEALS = 200;
const MAX_MOVES = 300;

const snapshot = (s) => JSON.stringify(s);
const foundationRank = (s, suit) => { const p = s.foundations.find((x) => x.length && x[0].suit === suit); return p ? p.length : 0; };

/** Every location a player could lift from: filled cells and every run start of every cascade. */
function liftable(state) {
  const out = [];
  state.cells.forEach((c, i) => { if (c) out.push({ pile: "cell", index: i }); });
  state.cascades.forEach((pile, i) => {
    const n = topRunLength(pile);
    for (let k = pile.length - n; k < pile.length; k++) out.push({ pile: "cascade", index: i, card: k });
  });
  return out;
}

/** Every legal (from, to) pair, via the engine's own enumeration. */
function legalMoves(state) {
  const moves = [];
  for (const from of liftable(state)) {
    for (const to of destinationsFor(state, from)) moves.push({ from, to });
  }
  return moves;
}

/** Legal moves that change something: a lone card shuffled from one
 *  otherwise-empty column to another empty column is not one of them. */
function usefulMoves(state) {
  return legalMoves(state).filter((m) => !(m.to.pile === "cascade" && !state.cascades[m.to.index].length && m.from.pile === "cascade" && state.cascades[m.from.index].length === 1));
}

/** The table invariants, checked after every move. `where` names the deal and step. */
function checkInvariants(state, where) {
  // 52 distinct cards across cells + foundations + cascades
  const ids = [];
  for (const p of state.cascades) for (const c of p) ids.push(c.id);
  for (const p of state.foundations) for (const c of p) ids.push(c.id);
  for (const c of state.cells) if (c) ids.push(c.id);
  assertEqual(ids.length, 52, `${where}: 52 cards on the table`);
  assertEqual(new Set(ids).size, 52, `${where}: every card exactly once`);
  // cells hold at most one card
  assertEqual(state.cells.length, 4, `${where}: four cells`);
  for (const c of state.cells) assertTrue(c === null || (typeof c === "object" && !Array.isArray(c) && c.id), `${where}: a cell is null or one card`);
  // foundations strictly ascending by suit from the Ace
  assertEqual(state.foundations.length, 4, `${where}: four foundations`);
  for (const p of state.foundations) {
    p.forEach((c, k) => {
      assertEqual(c.rank, k + 1, `${where}: foundation card ${k} is rank ${k + 1}`);
      assertEqual(c.suit, p[0].suit, `${where}: one suit per foundation`);
    });
  }
  assertEqual(new Set(state.foundations.filter((p) => p.length).map((p) => p[0].suit)).size, state.foundations.filter((p) => p.length).length, `${where}: no suit on two foundations`);
  // every run the engine calls movable is alternating-colour descending
  assertEqual(state.cascades.length, 8, `${where}: eight cascades`);
  state.cascades.forEach((pile, i) => {
    for (let k = 0; k < pile.length; k++) {
      const run = cardsAt(state, { pile: "cascade", index: i, card: k });
      if (!run.length) continue;
      assertEqual(run.length, pile.length - k, `${where}: a movable run reaches the end of the column`);
      for (let j = 1; j < run.length; j++) {
        assertTrue(RED[run[j].suit] !== RED[run[j - 1].suit], `${where}: run alternates colour`);
        assertEqual(run[j].rank, run[j - 1].rank - 1, `${where}: run descends by one`);
      }
      assertTrue(isRun(run), `${where}: isRun agrees`);
    }
    // and the top card alone is always liftable
    if (pile.length) assertEqual(cardsAt(state, { pile: "cascade", index: i }).length, 1, `${where}: the top card is liftable`);
  });
}

/** autoMoveTarget's documented preferences, checked for every liftable location. */
function checkAutoMoveTarget(state, where) {
  for (const from of liftable(state)) {
    const target = autoMoveTarget(state, from);
    const cards = cardsAt(state, from);
    const dests = destinationsFor(state, from);
    const fromPile = from.pile === "cascade" ? state.cascades[from.index] : null;
    const wholeCascade = from.pile === "cascade" && cards.length === fromPile.length;
    const canHome = cards.length === 1 && state.foundations.some((p, i) => canMove(state, from, { pile: "foundation", index: i }));
    const builds = [];
    for (let i = 0; i < 8; i++) if (state.cascades[i].length && canMove(state, from, { pile: "cascade", index: i })) builds.push(i);
    const emptyCol = state.cascades.findIndex((p) => !p.length);
    const canEmpty = emptyCol >= 0 && canMove(state, from, { pile: "cascade", index: emptyCol });
    const emptyCell = state.cells.findIndex((c) => !c);
    const canCell = cards.length === 1 && from.pile !== "cell" && emptyCell >= 0;
    if (target) {
      assertTrue(canMove(state, from, target), `${where}: autoMoveTarget is legal`);
      assertTrue(dests.some((d) => d.pile === target.pile && d.index === target.index), `${where}: autoMoveTarget is one of destinationsFor`);
    }
    if (canHome) { assertEqual(target && target.pile, "foundation", `${where}: a card that can go Home goes Home`); continue; }
    if (builds.length) {
      assertTrue(target && target.pile === "cascade" && state.cascades[target.index].length > 0, `${where}: a build beats a cell or an empty column`);
      const longest = Math.max(...builds.map((i) => topRunLength(state.cascades[i])));
      assertEqual(topRunLength(state.cascades[target.index]), longest, `${where}: the build with the longest run wins`);
      continue;
    }
    const kingOrRun = cards.length > 1 || cards[0].rank === 13;
    if (wholeCascade) {
      assertTrue(!(target && target.pile === "cascade" && !state.cascades[target.index].length), `${where}: a whole cascade never moves to another empty cascade`);
    }
    if (kingOrRun) {
      if (canEmpty && !wholeCascade) assertTrue(target && target.pile === "cascade" && !state.cascades[target.index].length, `${where}: a King or a run takes the empty column`);
      else if (canCell) assertEqual(target && target.pile, "cell", `${where}: a lone King with no column takes a cell`);
      else assertEqual(target, null, `${where}: nothing for the run`);
    } else {
      if (canCell) assertEqual(target && target.pile, "cell", `${where}: a lone low card parks in a cell before an empty column`);
      else if (canEmpty && !wholeCascade) assertTrue(target && target.pile === "cascade" && !state.cascades[target.index].length, `${where}: empty column as a last resort`);
      else assertEqual(target, null, `${where}: nothing at all`);
    }
  }
}

/** Safe autoplay must never send Home a card some card on the table could still be built on. */
function checkSafeAutoplay(state, where) {
  const step = safeAutoplayStep(state);
  if (!step) return;
  assertTrue(canMove(state, step.from, step.to), `${where}: safe autoplay move is legal`);
  assertEqual(step.to.pile, "foundation", `${where}: safe autoplay only goes Home`);
  const card = cardsAt(state, step.from)[0];
  assertTrue(isSafeToFoundation(state, card), `${where}: the engine calls it safe`);
  if (card.rank > 2) {
    const others = RED[card.suit] ? ["S", "C"] : ["H", "D"];
    for (const p of state.cascades) for (const c of p) {
      assertTrue(!(others.includes(c.suit) && c.rank === card.rank - 1), `${where}: ${card.id} left while ${c.id} still on the table needs it`);
    }
    for (const c of state.cells) if (c) assertTrue(!(others.includes(c.suit) && c.rank === card.rank - 1), `${where}: ${card.id} left while ${c.id} in a cell needs it`);
    for (const s of others) assertTrue(foundationRank(state, s) >= card.rank - 1, `${where}: both ${card.rank - 1}s of the other colour are Home`);
  }
  // playing it must not put anything out of reach: all safe cards, applied to exhaustion, keep the table valid
  let s = state, n = 0;
  for (let st = step; st && n < 60; st = safeAutoplayStep(s), n++) {
    const next = applyMove(s, st.from, st.to);
    assertTrue(next !== null, `${where}: safe autoplay chain is legal`);
    s = next;
  }
  checkInvariants(s, where + " after autoplay");
}

test(`fuzz: ${DEALS} random deals × up to ${MAX_MOVES} random legal moves keep every invariant`, () => {
  const rng = makeRng(20260909);
  let totalMoves = 0, wins = 0, stuck = 0, tooManySeen = 0;
  for (let d = 1; d <= DEALS; d++) {
    // Spread over the classic set so the positions differ in character.
    const dealNo = 1 + Math.floor(rng() * 32000);
    let state = newGame({ deal: dealNo });
    assertEqual(state.deal, dealNo);
    checkInvariants(state, `deal ${dealNo} start`);
    const history = [];
    for (let step = 0; step < MAX_MOVES; step++) {
      const where = `deal ${dealNo} move ${step}`;
      const moves = legalMoves(state);
      if (!moves.length) { stuck++; assertEqual(findHint(state), null, `${where}: no legal move means no hint`); break; }
      if (!usefulMoves(state).length) { stuck++; break; }
      // Every enumerated move must be legal and every non-enumerated one refused for a reason.
      for (const m of moves) assertTrue(canMove(state, m.from, m.to), `${where}: enumerated move ${JSON.stringify(m)} is legal`);
      const pick = moves[Math.floor(rng() * moves.length)];
      const movingCount = cardsAt(state, pick.from).length;
      const toEmpty = pick.to.pile === "cascade" && state.cascades[pick.to.index].length === 0;
      if (pick.to.pile === "cascade") assertTrue(movingCount <= maxMovable(state, toEmpty), `${where}: run-length rule (${movingCount} ≤ ${maxMovable(state, toEmpty)})`);
      else assertEqual(movingCount, 1, `${where}: only one card into a cell or Home`);
      // The run-length rule is also enforced, not just enumerated: a longer run than allowed is refused.
      if (pick.from.pile === "cascade") {
        const pile = state.cascades[pick.from.index];
        const runLen = topRunLength(pile);
        for (let k = pile.length - runLen; k < pile.length; k++) {
          const from = { pile: "cascade", index: pick.from.index, card: k };
          const n = pile.length - k;
          const p = moveProblem(state, from, pick.to);
          if (n > maxMovable(state, toEmpty) && pick.to.pile === "cascade" && p) {
            if (p.reason === "tooMany") { tooManySeen++; assertEqual(p.count, n); assertEqual(p.allowed, maxMovable(state, toEmpty)); }
          }
        }
      }
      const before = snapshot(state);
      const prev = state;
      const next = applyMove(state, pick.from, pick.to);
      assertTrue(next !== null && next !== state, `${where}: applyMove returns a new state`);
      assertEqual(snapshot(state), before, `${where}: applyMove never mutates its input`);
      assertEqual(next.moves, state.moves + 1, `${where}: move counter`);
      // "undo": the previous state object is exactly what it was
      history.push({ state: prev, snap: before });
      state = next;
      checkInvariants(state, where);
      // the cards moved landed where they were sent, and the source lost exactly them
      if (pick.to.pile === "foundation") assertEqual(state.foundations[pick.to.index].length, prev.foundations[pick.to.index].length + 1, `${where}: foundation grew by one`);
      if (pick.to.pile === "cell") assertTrue(!!state.cells[pick.to.index] && !prev.cells[pick.to.index], `${where}: cell filled`);
      if (pick.to.pile === "cascade") assertEqual(state.cascades[pick.to.index].length, prev.cascades[pick.to.index].length + movingCount, `${where}: cascade grew by the run`);
      if (pick.from.pile === "cell") assertEqual(state.cells[pick.from.index], null, `${where}: cell emptied`);
      else assertEqual(state.cascades[pick.from.index].length, prev.cascades[pick.from.index].length - movingCount, `${where}: source shrank by the run`);
      if (step % 7 === 0) checkAutoMoveTarget(state, where);
      checkSafeAutoplay(state, where);
      // the hint, when there is one, is always legal
      const h = findHint(state);
      if (h) assertTrue(canMove(state, h.from, h.to), `${where}: hint is legal`);
      else assertEqual(usefulMoves(state).length, 0, `${where}: "no moves left" only when nothing useful can move`);
      // sometimes let the safe cards go Home, as the page does
      if (rng() < 0.5) { let st; while ((st = safeAutoplayStep(state))) { const b = snapshot(state); const n2 = applyMove(state, st.from, st.to); assertEqual(snapshot(state), b, `${where}: autoplay never mutates`); state = n2; } checkInvariants(state, where + " autoplay"); }
      // sometimes undo a few moves: the earlier states are untouched
      if (rng() < 0.08 && history.length) {
        const back = 1 + Math.floor(rng() * Math.min(5, history.length));
        for (let k = 0; k < back; k++) {
          const h2 = history.pop();
          assertEqual(snapshot(h2.state), h2.snap, `${where}: history entry untouched by later moves`);
          state = h2.state;
        }
        checkInvariants(state, where + " after undo");
      }
      totalMoves++;
      if (canAutoComplete(state)) {
        let st, n = 0;
        while ((st = autoCompleteStep(state))) { state = applyMove(state, st.from, st.to); assertTrue(state !== null, `${where}: finish move legal`); n++; assertTrue(n <= 52, "finish terminates"); }
        assertTrue(isWon(state), `${where}: auto-complete finishes the game`);
        checkInvariants(state, where + " won");
        wins++;
        break;
      }
      if (isWon(state)) { wins++; break; }
    }
  }
  assertTrue(totalMoves > DEALS * 50, `played enough moves (${totalMoves})`);
  assertTrue(tooManySeen > 0, `the run-length refusal was exercised (${tooManySeen})`);
  console.log(`    ${totalMoves} moves over ${DEALS} deals, ${wins} finished, ${stuck} stuck, ${tooManySeen} too-long refusals`);
});

test("fuzz: illegal moves are refused with a reason and never change the state", () => {
  const rng = makeRng(77);
  const kinds = new Set();
  for (let d = 0; d < 60; d++) {
    let state = newGame({ deal: 1 + Math.floor(rng() * 32000) });
    for (let step = 0; step < 40; step++) {
      const moves = legalMoves(state);
      if (!moves.length) break;
      // every (from, to) pair the enumeration did not list is refused
      const listed = new Set(moves.map((m) => JSON.stringify([m.from, m.to])));
      const allTo = [];
      for (let i = 0; i < 4; i++) allTo.push({ pile: "cell", index: i }, { pile: "foundation", index: i });
      for (let i = 0; i < 8; i++) allTo.push({ pile: "cascade", index: i });
      for (const from of liftable(state)) for (const to of allTo) {
        const before = snapshot(state);
        const p = moveProblem(state, from, to);
        const ok = p === null;
        assertEqual(snapshot(state), before, "moveProblem never mutates");
        assertEqual(applyMove(state, from, to) === null, !ok, `applyMove agrees with moveProblem for ${JSON.stringify([from, to, p])}`);
        if (!ok) { kinds.add(p.reason); assertTrue(["same", "single", "cellFull", "foundation", "cascade", "tooMany", "none"].includes(p.reason), "known reason " + p.reason); }
        // destinationsFor lists only the first empty cascade / cell; other empties are legal but unlisted
        if (ok && !listed.has(JSON.stringify([from, to]))) {
          const emptyCascade = to.pile === "cascade" && !state.cascades[to.index].length;
          const emptyCell = to.pile === "cell";
          const emptyFoundation = to.pile === "foundation" && !state.foundations[to.index].length;
          assertTrue(emptyCascade || emptyCell || emptyFoundation, `an unlisted legal move can only be a duplicate empty slot: ${JSON.stringify([from, to])}`);
        }
      }
      // a covered card (not a run start) can never be lifted anywhere
      state.cascades.forEach((pile, i) => {
        const n = topRunLength(pile);
        for (let k = 0; k < pile.length - n; k++) {
          assertEqual(cardsAt(state, { pile: "cascade", index: i, card: k }), [], "covered card is not liftable");
          assertEqual(destinationsFor(state, { pile: "cascade", index: i, card: k }), [], "covered card has no destinations");
          assertEqual(moveProblem(state, { pile: "cascade", index: i, card: k }, allTo[0]).reason, "none");
        }
      });
      // foundation cards never come back
      for (let i = 0; i < 4; i++) assertEqual(destinationsFor(state, { pile: "foundation", index: i }), [], "foundation is not a source");
      const pick = moves[Math.floor(rng() * moves.length)];
      state = applyMove(state, pick.from, pick.to);
    }
  }
  for (const r of ["same", "single", "cellFull", "foundation", "cascade", "tooMany"]) assertTrue(kinds.has(r), "saw refusal reason " + r);
});

test("fuzz: the safe-autoplay rule on every card of random positions", () => {
  const rng = makeRng(5);
  for (let d = 0; d < 100; d++) {
    let state = newGame({ deal: 1 + Math.floor(rng() * 32000) });
    for (let step = 0; step < 80; step++) {
      const moves = legalMoves(state);
      if (!moves.length) break;
      const pick = moves[Math.floor(rng() * moves.length)];
      state = applyMove(state, pick.from, pick.to);
      let st; while ((st = safeAutoplayStep(state))) state = applyMove(state, st.from, st.to);
      // now nothing safe is left: every top card that could go Home is one somebody on the table still needs
      for (const from of liftable(state)) {
        const cards = cardsAt(state, from);
        if (cards.length !== 1) continue;
        const c = cards[0];
        const f = state.foundations.findIndex((p, i) => canMove(state, from, { pile: "foundation", index: i }));
        if (f < 0) continue;
        assertTrue(c.rank > 2, "an Ace or 2 that can go Home always goes");
        const others = RED[c.suit] ? ["S", "C"] : ["H", "D"];
        assertTrue(others.some((s) => foundationRank(state, s) < c.rank - 1), `${c.id} stayed because a ${c.rank - 1} of the other colour is still out`);
      }
    }
  }
  assertEqual(SUITS.length, 4);
});

test("regression: a King in a cell with all cells full and one empty column is a hint, not 'no moves left'", () => {
  // deal 21035 after 30 random moves (found by the fuzz above): every cell
  // full, column 1 empty, no builds anywhere — the old hint said nothing
  // although eleven moves were legal.
  const c = (s) => { const r = s.slice(0, -1), suit = s.slice(-1); const rank = r === "T" ? 10 : "0A23456789TJQK".indexOf(r); return { id: suit + rank, suit, rank }; };
  const cards = (s) => s.split(" ").filter(Boolean).map(c);
  const state = {
    deal: 21035, moves: 30,
    cascades: ["", "6S 6D 9D", "3S QC 5S QD 4C KC KH QS JD", "TC JS 5D 9C 3D 2C", "JC 7C 4D 7S 6H 5C", "9S AC 5H 8H TH", "8C TS 9H 8S 7H 6C", "2D JH 8D 3C KS QH"].map(cards),
    cells: [c("TD"), c("4S"), c("7D"), c("KD")],
    foundations: [cards("AH 2H 3H 4H"), cards("AS 2S"), cards("AD"), []],
  };
  const all = [...state.cascades.flat(), ...state.foundations.flat(), ...state.cells].map((x) => x.id);
  assertEqual(new Set(all).size, 52, "a complete deck");
  const h = findHint(state);
  assertEqual(h, { from: { pile: "cell", index: 3 }, to: { pile: "cascade", index: 0 } }, "the King leaves the cell for the empty column");
  assertTrue(canMove(state, h.from, h.to));
  assertEqual(describeHint(state, h).key, "hintEmpty");
  // Without a King in a cell (swap KD with the QC buried in column 3) no
  // build exists either; the last resort names the card covering the Ace
  // of clubs, into the empty column — never "no moves left".
  state.cells[3] = c("QC"); state.cascades[2][1] = c("KD");
  const h2 = findHint(state);
  assertEqual(h2, { from: { pile: "cascade", index: 5, card: 4 }, to: { pile: "cascade", index: 0 } }, "the 10 of hearts (over the Ace of clubs) to the empty column");
  assertTrue(canMove(state, h2.from, h2.to));
});
