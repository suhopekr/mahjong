// game/klondike.js
// The rules of Klondike, and nothing else. No DOM, no storage, no
// timers: every function here takes a state and returns a new state (or
// a plain answer), so the whole file runs under node for the test suite
// and the page's main.js is only ever a renderer of what comes out.
//
// The rules are the standard ones every desktop Klondike agrees on
// (Aisleriot, KPatience, the Windows original):
//
//   - 7 tableau columns dealt 1..7 cards, only the last card face up
//   - the other 24 cards form the stock; Draw 1 or Draw 3 at a time
//   - the stock may be turned over again as often as you like
//   - tableau builds DOWN in alternating colours; only a King may go on
//     an empty column
//   - foundations build UP from Ace, one suit each
//   - a face-up run in a column moves as a unit; the top card of the
//     waste or of a foundation moves alone
//
// No scoring and no clock — this site does not keep either.
//
// The one piece of judgement in the file is autoMoveTarget(): the site's
// "tap a card and it goes where it should" gesture. Foundation first,
// then the tableau column that does the most for you.

export const SUITS = ["S", "H", "D", "C"];
export const RED = { H: true, D: true, S: false, C: false };
export const RANK_LABEL = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUIT_NAME = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
export const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };

// Deterministic RNG (mulberry32) so a deal can be reproduced from its
// seed: the tests need that, and "Replay this deal" is a one-liner later.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ id: suit + rank, suit, rank, faceUp: false });
    }
  }
  return deck;
}

export function shuffle(deck, rng) {
  const cards = deck.slice();
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function cardName(card) {
  return `${RANK_LABEL[card.rank]} of ${SUIT_NAME[card.suit]}`;
}

/**
 * A fresh deal. `draw` is 1 or 3. `seed` picks the shuffle; omit it for a
 * random one (Date + Math.random, so two New games in the same
 * millisecond still differ).
 */
export function newGame({ draw = 1, seed } = {}) {
  if (seed === undefined) seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const rng = makeRng(seed);
  const deck = shuffle(makeDeck(), rng);
  const tableau = [];
  let k = 0;
  for (let col = 0; col < 7; col++) {
    const pile = [];
    for (let row = 0; row <= col; row++) {
      const card = deck[k++];
      card.faceUp = row === col;
      pile.push(card);
    }
    tableau.push(pile);
  }
  const stock = deck.slice(k);
  return {
    seed,
    draw,
    stock,
    waste: [],
    foundations: [[], [], [], []],
    tableau,
    moves: 0,
    // How many times the stock has been turned over — for the FAQ's
    // "you can go through the deck as often as you like" promise and the
    // hint text, nothing else.
    redeals: 0,
  };
}

export function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

// ----------------------------------------------------------------------
// rules
// ----------------------------------------------------------------------

export function canPlaceOnFoundation(card, pile) {
  if (pile.length === 0) return card.rank === 1;
  const top = pile[pile.length - 1];
  return top.suit === card.suit && top.rank + 1 === card.rank;
}

export function canPlaceOnTableau(card, pile) {
  if (pile.length === 0) return card.rank === 13;
  const top = pile[pile.length - 1];
  if (!top.faceUp) return false;
  return RED[top.suit] !== RED[card.suit] && top.rank - 1 === card.rank;
}

/** Which foundation pile takes this suit, given the piles already started. */
export function foundationIndexFor(state, card) {
  const idx = state.foundations.findIndex((p) => p.length && p[0].suit === card.suit);
  if (idx >= 0) return idx;
  return state.foundations.findIndex((p) => p.length === 0);
}

/** The cards a location refers to: a run from `card` to the end of a
 *  tableau column, or the single top card of the waste / a foundation. */
export function pileAt(state, loc) {
  if (loc.pile === "tableau") return state.tableau[loc.index];
  if (loc.pile === "foundation") return state.foundations[loc.index];
  if (loc.pile === "waste") return state.waste;
  if (loc.pile === "stock") return state.stock;
  throw new Error("unknown pile " + loc.pile);
}

export function cardsAt(state, loc) {
  const pile = pileAt(state, loc);
  if (loc.pile === "tableau") {
    const from = loc.card === undefined ? pile.length - 1 : loc.card;
    if (from < 0 || from >= pile.length || !pile[from].faceUp) return [];
    return pile.slice(from);
  }
  if (loc.pile === "stock") return [];
  return pile.length ? [pile[pile.length - 1]] : [];
}

/** Can the cards at `from` be dropped on `to`? */
export function canMove(state, from, to) {
  const cards = cardsAt(state, from);
  if (!cards.length) return false;
  if (from.pile === to.pile && from.index === to.index) return false;
  if (to.pile === "foundation") {
    if (cards.length !== 1) return false;
    return canPlaceOnFoundation(cards[0], state.foundations[to.index]);
  }
  if (to.pile === "tableau") {
    return canPlaceOnTableau(cards[0], state.tableau[to.index]);
  }
  return false;
}

/** Every legal destination for the cards at `from`, foundations first. */
export function destinationsFor(state, from) {
  const out = [];
  const cards = cardsAt(state, from);
  if (!cards.length) return out;
  if (cards.length === 1) {
    const f = foundationIndexFor(state, cards[0]);
    if (f >= 0 && canMove(state, from, { pile: "foundation", index: f })) {
      out.push({ pile: "foundation", index: f });
    }
  }
  for (let i = 0; i < 7; i++) {
    const to = { pile: "tableau", index: i };
    if (canMove(state, from, to)) out.push(to);
  }
  return out;
}

/**
 * Where a tapped card should go. Foundation if it can; otherwise the
 * tableau column that helps most. Two tableau moves are refused as
 * "pointless" so a tap never shuffles a card sideways for nothing: a
 * King (with whatever is under it) from one empty-bottomed column to
 * another empty column, and a run whose parent card is face up moving to
 * a column where it would sit on the very same rank and colour it already
 * sits on (nothing gained, and the tap feels broken).
 */
export function autoMoveTarget(state, from) {
  const dests = destinationsFor(state, from);
  if (!dests.length) return null;
  if (dests[0].pile === "foundation") return dests[0];
  const cards = cardsAt(state, from);
  const head = cards[0];
  const fromPile = pileAt(state, from);
  const fromIdx = from.pile === "tableau" ? (from.card === undefined ? fromPile.length - 1 : from.card) : -1;
  const useful = dests.filter((to) => {
    const dest = state.tableau[to.index];
    if (head.rank === 13 && from.pile === "tableau" && fromIdx === 0 && dest.length === 0) return false;
    return true;
  });
  if (!useful.length) return null;
  // Prefer the column whose exposed card is face up (a real build) over an
  // empty column, and among real builds the one with the longest run so
  // long runs stay together. For a King, an empty column is the point.
  useful.sort((a, b) => {
    const pa = state.tableau[a.index], pb = state.tableau[b.index];
    const ea = pa.length === 0 ? 1 : 0, eb = pb.length === 0 ? 1 : 0;
    if (head.rank !== 13 && ea !== eb) return ea - eb;
    return pb.length - pa.length;
  });
  return useful[0];
}

// ----------------------------------------------------------------------
// actions — each returns a NEW state and never touches the one passed in
// ----------------------------------------------------------------------

export function applyMove(state, from, to) {
  if (!canMove(state, from, to)) return null;
  const next = clone(state);
  const source = pileAt(next, from);
  const count = cardsAt(state, from).length;
  const moving = source.splice(source.length - count, count);
  const target = pileAt(next, to);
  target.push(...moving);
  let flipped = false;
  if (from.pile === "tableau" && source.length && !source[source.length - 1].faceUp) {
    source[source.length - 1].faceUp = true;
    flipped = true;
  }
  next.moves += 1;
  next.lastFlip = flipped;
  return next;
}

/** Turn cards from the stock onto the waste, or turn the waste back over. */
export function drawFromStock(state) {
  if (!state.stock.length && !state.waste.length) return null;
  const next = clone(state);
  if (!next.stock.length) {
    next.stock = next.waste.reverse().map((c) => ({ ...c, faceUp: false }));
    next.waste = [];
    next.redeals += 1;
  } else {
    const n = Math.min(next.draw, next.stock.length);
    const drawn = next.stock.splice(next.stock.length - n, n).reverse().map((c) => ({ ...c, faceUp: true }));
    next.waste.push(...drawn);
  }
  next.moves += 1;
  next.lastFlip = false;
  return next;
}

export function isWon(state) {
  return state.foundations.every((p) => p.length === 13);
}

/** Every card is face up and the stock is spent: the rest is bookkeeping. */
export function canAutoComplete(state) {
  if (isWon(state)) return false;
  if (state.stock.length) return false;
  if (state.waste.length > 1) return false;
  return state.tableau.every((pile) => pile.every((c) => c.faceUp));
}

/** One step of auto-complete: the lowest card that can go up, goes up. */
export function autoCompleteStep(state) {
  let best = null;
  const consider = (from) => {
    const cards = cardsAt(state, from);
    if (cards.length !== 1) return;
    const dests = destinationsFor(state, from);
    if (!dests.length || dests[0].pile !== "foundation") return;
    if (!best || cards[0].rank < best.rank) best = { from, to: dests[0], rank: cards[0].rank };
  };
  if (state.waste.length) consider({ pile: "waste" });
  for (let i = 0; i < 7; i++) {
    if (state.tableau[i].length) consider({ pile: "tableau", index: i, card: state.tableau[i].length - 1 });
  }
  return best ? { from: best.from, to: best.to } : null;
}

// ----------------------------------------------------------------------
// hint — the move a patient friend would point at
// ----------------------------------------------------------------------

/**
 * Returns { from, to } for a card move, { draw: true } when the useful
 * thing is to turn the stock, or null when nothing at all is possible.
 *
 * Priority:
 *   1. anything to a foundation (waste first, then tableau tops)
 *   2. a tableau run whose move turns a face-down card face up
 *   3. the waste card onto the tableau
 *   4. a King onto an empty column, if that reveals a card
 *   5. any other tableau-to-tableau move that is not pointless
 *   6. draw
 */
export function findHint(state) {
  const tops = [];
  for (let i = 0; i < 7; i++) {
    const pile = state.tableau[i];
    if (pile.length) tops.push({ pile: "tableau", index: i, card: pile.length - 1 });
  }
  const waste = state.waste.length ? { pile: "waste" } : null;

  // 1. foundations
  const toFoundation = (from) => {
    const d = destinationsFor(state, from);
    return d.length && d[0].pile === "foundation" ? { from, to: d[0] } : null;
  };
  if (waste) { const h = toFoundation(waste); if (h) return h; }
  for (const t of tops) { const h = toFoundation(t); if (h) return h; }

  // 2. reveal a face-down card
  for (let i = 0; i < 7; i++) {
    const pile = state.tableau[i];
    const first = pile.findIndex((c) => c.faceUp);
    if (first <= 0) continue; // nothing face down underneath
    const from = { pile: "tableau", index: i, card: first };
    const dests = destinationsFor(state, from).filter((d) => d.pile === "tableau");
    if (dests.length) return { from, to: dests[0] };
  }

  // 3. waste onto the tableau
  if (waste) {
    const dests = destinationsFor(state, waste).filter((d) => d.pile === "tableau");
    if (dests.length) return { from: waste, to: dests[0] };
  }

  // 4./5. other tableau moves that are not pointless
  for (let i = 0; i < 7; i++) {
    const pile = state.tableau[i];
    const first = pile.findIndex((c) => c.faceUp);
    if (first < 0) continue;
    const from = { pile: "tableau", index: i, card: first };
    const to = autoMoveTarget(state, from);
    if (to && to.pile === "tableau") return { from, to };
  }

  // 6. draw
  if (state.stock.length || state.waste.length) return { draw: true };
  return null;
}

/** Plain-English description of a hint, for the status line. */
export function describeHint(state, hint) {
  if (!hint) return "No moves left — try a new game.";
  if (hint.draw) return state.stock.length ? "Turn over the next card from the deck." : "Turn the deck over and go through it again.";
  const card = cardsAt(state, hint.from)[0];
  const name = cardName(card);
  if (hint.to.pile === "foundation") return `Move the ${name} up to its pile.`;
  const dest = state.tableau[hint.to.index];
  if (!dest.length) return `Move the ${name} to the empty column.`;
  return `Move the ${name} onto the ${cardName(dest[dest.length - 1])}.`;
}
