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

import { isWinnable } from "./solver.js";

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

/** The card's English name ("7 of hearts") — for tests and debugging. The
 *  page names cards through i18n (strings.js cardName/rankN/suitX). */
export function cardName(card) {
  return `${RANK_LABEL[card.rank]} of ${SUIT_NAME[card.suit]}`;
}

/** The plain deal a seed gives: shuffle, 1..7 to the tableau, 24 to the stock. */
function dealSeed(seed, draw) {
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

/**
 * The nth candidate seed for a requested seed, mixed with a 32-bit
 * avalanche so consecutive attempts land nowhere near each other.
 *
 * Derived from the REQUESTED seed and nothing else — never the clock —
 * because the whole point is that `newGame({ seed })` is the same game
 * every time: the Draw 1/Draw 3 switch re-deals an untouched board by
 * handing its own seed back (see main.js), and that has to bring back the
 * same cards.
 */
function candidateSeed(seed, n) {
  let h = (seed ^ Math.imul(n, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// How many candidate deals to look at before giving up and dealing an
// ordinary shuffle. At the solver's measured acceptance rate (81% of
// Draw 1 deals, 56% of Draw 3 ones) thirty rejections in a row is a
// once-in-the-lifetime-of-the-universe event, so the fallback below is
// there to make a hang impossible rather than because it will ever run.
const MAX_DEAL_ATTEMPTS = 30;

/**
 * A fresh deal that can actually be won. `draw` is 1 or 3. `seed` picks
 * the shuffle; omit it for a random one (Date + Math.random, so two New
 * games in the same millisecond still differ). Pass `winnable: false` for
 * a plain shuffle — the tests use it to build positions on purpose.
 *
 * Candidates are tried in a fixed order starting with the requested seed
 * itself, and `state.seed` is the seed of the deal actually KEPT. Those
 * two facts together are what make this reproducible: the kept seed is by
 * definition one the solver accepts, so asking for it again accepts it on
 * the first attempt and deals the same cards.
 */
export function newGame({ draw = 1, seed, winnable = true } = {}) {
  if (seed === undefined) seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  seed = seed >>> 0;
  if (!winnable) return dealSeed(seed, draw);
  for (let attempt = 0; attempt < MAX_DEAL_ATTEMPTS; attempt++) {
    const state = dealSeed(attempt === 0 ? seed : candidateSeed(seed, attempt), draw);
    if (isWinnable(state)) return state;
  }
  // Escape hatch: deal the requested seed and let the player have an
  // ordinary hand rather than spin here. Part 1 (isStuck / "No moves
  // left") is what covers a hand that turns out to be lost, which is why
  // it is not enough to only do Part 2 — a winnable deal is still
  // losable by playing it badly.
  return dealSeed(seed, draw);
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
 * The one move in Klondike that provably changes nothing: a whole column
 * — a King and whatever is already on it, with no face-down card
 * underneath — moving into an ANOTHER empty column. The position
 * afterwards is the position before it with two columns renamed, so the
 * set of games reachable from it is identical.
 *
 * It is deliberately the ONLY thing called pointless, because isStuck()
 * shares this test and "no moves left" is a much stronger claim than "not
 * what you meant by that tap". The tempting second entry is the move that
 * only shuffles a run between two columns and reveals nothing — say a red
 * seven moving off one black eight onto another. That is NOT pointless:
 * it leaves a different card exposed at the bottom of the column it came
 * from, of a different SUIT, which may be exactly the card a foundation
 * is waiting for, and it can free a run to be picked up in one piece
 * later. Anything waved away here is a move a player might have been
 * able to use, so the list stays at one.
 */
function isPointlessMove(state, from, to) {
  if (to.pile !== "tableau" || from.pile !== "tableau") return false;
  if (state.tableau[to.index].length) return false;
  const pile = state.tableau[from.index];
  const idx = from.card === undefined ? pile.length - 1 : from.card;
  return idx === 0;
}

/**
 * Where a tapped card should go. Foundation if it can; otherwise the
 * tableau column that helps most, skipping the one move that is
 * pointless (isPointlessMove) so a tap never shuffles a King between two
 * empty columns for nothing.
 */
export function autoMoveTarget(state, from) {
  const dests = destinationsFor(state, from);
  if (!dests.length) return null;
  if (dests[0].pile === "foundation") return dests[0];
  const cards = cardsAt(state, from);
  const head = cards[0];
  const useful = dests.filter((to) => !isPointlessMove(state, from, to));
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

// The closure below is tiny in practice — a handful of arrangements, since
// every rearrangement needs a matching rank and colour — but this cap is
// here so that a freak position cannot stall a phone. Hitting it answers
// "not stuck", which is the safe direction.
const STUCK_SEARCH_CAP = 600;

/**
 * Is this position dead — is there nothing left that can get anywhere?
 *
 * Being blocked in Klondike is simply a loss: no rule rescues you, and
 * about a fifth of random deals cannot be won however well they are
 * played (which is why newGame() no longer deals those). The game used to
 * have no way to SAY that. findHint()'s last resort was an unconditional
 * "turn the deck over and go through it again", so a single unplayable
 * card sitting in the waste made it promise a move forever.
 *
 * WHAT COUNTS AS A MOVE. The obvious test — "no legal move exists" — is
 * far too strict to be useful, because a blocked position usually still
 * has a run that can slide from one column to another and slide straight
 * back. So the question this asks is not "can anything move" but "can
 * anything GET anywhere", and the answer is exact rather than a judgement
 * call about which moves look pointless:
 *
 *   PROGRESS is a move that changes something a later move can use — a
 *   card to a foundation, a move that turns a face-down card face up, a
 *   move that leaves a column empty, or a card from the stock or the
 *   waste that can be placed at all.
 *
 *   A REARRANGEMENT is a tableau move that does none of those: a face-up
 *   run lifted off a face-up card and dropped on another face-up card.
 *   It leaves the foundations, every face-down card and the whole deck
 *   exactly as they were, and only changes which face-up cards are on
 *   top of which columns.
 *
 * The position is dead when NO progress move can be reached by any
 * sequence of rearrangements. That is the honest version of the claim:
 * whatever the player slides around, they cannot turn a card, empty a
 * column, play to a foundation, or use the deck. Note that nothing is
 * disabled when this returns true — the board stays fully playable and
 * the player can go on sliding runs about if they like. The message is
 * advice, not a lock.
 *
 * A rearrangement never changes which cards are face down, so the search
 * only has to walk the face-up parts of the seven columns.
 *
 * Two things are deliberately NOT counted as moves:
 *
 *   - Turning the deck. Redeals are unlimited (drawFromStock turns the
 *     waste back over as often as you like), so in Draw 1 EVERY card in
 *     the stock and the waste reaches the top of the waste if the player
 *     keeps turning: asking whether any of them can be placed is exactly
 *     right. In Draw 3 only some of them ever reach the top, so the same
 *     question is stricter than it needs to be — which can leave a dead
 *     position unreported but can never report a live one as dead.
 *
 *   - Taking a card back off a foundation onto the tableau. The page
 *     allows it, and in the position this was written for (see
 *     test/klondike.test.js) it is the one thing left to do: both red
 *     fives are out of reach, so the 4 of clubs in the waste can only be
 *     parked on a five pulled back down — after which the position is
 *     frozen again with one card fewer on the foundations. Counting it
 *     would put us back to offering the player a move that leads nowhere,
 *     which is the bug this function exists to fix.
 */
export function isStuck(state) {
  if (isWon(state)) return false;

  // A rearrangement cannot change any of these, so they are read once.
  const hidden = state.tableau.map((pile) => pile.filter((c) => !c.faceUp).length);
  const deck = [...state.stock, ...state.waste];

  /** Can `card` be dropped on column `t` of this arrangement? */
  const canDropOn = (up, card, t) => {
    if (up[t].length) return canPlaceOnTableau(card, up[t]);
    // A column with nothing face up is either truly empty (a King may go
    // there) or still has face-down cards on top, which take nothing.
    return hidden[t] === 0 && card.rank === 13;
  };

  const canGoUp = (card) => {
    const f = foundationIndexFor(state, card);
    return f >= 0 && canPlaceOnFoundation(card, state.foundations[f]);
  };

  function hasProgress(up) {
    for (let i = 0; i < 7; i++) {
      if (up[i].length && canGoUp(up[i][up[i].length - 1])) return true;
    }
    for (let i = 0; i < 7; i++) {
      if (!up[i].length) continue;
      const head = up[i][0]; // the whole face-up run: moving it flips or empties
      for (let t = 0; t < 7; t++) {
        if (t === i || !canDropOn(up, head, t)) continue;
        // A face-down card underneath turns over; otherwise the column is
        // left empty, unless the destination was empty too, in which case
        // this is the pointless King shuffle (isPointlessMove) and the two
        // columns have merely swapped names.
        if (hidden[i] > 0 || up[t].length > 0) return true;
      }
    }
    for (const card of deck) {
      if (canGoUp(card)) return true;
      for (let t = 0; t < 7; t++) if (canDropOn(up, card, t)) return true;
    }
    return false;
  }

  const keyOf = (up) => up.map((pile, i) => hidden[i] + ":" + pile.map((c) => c.id).join(",")).sort().join("|");

  const start = state.tableau.map((pile) => pile.filter((c) => c.faceUp));
  const seen = new Set([keyOf(start)]);
  const queue = [start];
  let visited = 0;
  while (queue.length) {
    const up = queue.pop();
    if (hasProgress(up)) return false;
    if (++visited >= STUCK_SEARCH_CAP) return false;
    for (let f = 0; f < 7; f++) {
      // j starts at 1: lifting the whole face-up run (j === 0) either
      // flips a card or empties a column, so it is progress, not a
      // rearrangement, and hasProgress() has already said no to it.
      for (let j = 1; j < up[f].length; j++) {
        for (let t = 0; t < 7; t++) {
          if (t === f || !up[t].length || !canPlaceOnTableau(up[f][j], up[t])) continue;
          const next = up.slice();
          next[f] = up[f].slice(0, j);
          next[t] = up[t].concat(up[f].slice(j));
          const k = keyOf(next);
          if (seen.has(k)) continue;
          seen.add(k);
          queue.push(next);
        }
      }
    }
  }
  return true;
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
 *   4. a run from part-way down a column, when it frees a card for a
 *      foundation
 *   5. the whole face-up run, anywhere it is not pointless
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

  // 4. A RUN FROM PART-WAY DOWN A COLUMN, WHEN IT FREES A CARD FOR A
  //    FOUNDATION.
  //
  // This step is here because of a hand that was reported as stuck and was
  // not. Column one held the whole of K♣ Q♦ J♣ 10♥ 9♠ 8♦ 7♣ 6♥ 5♣ 4♦ 3♣
  // face up, the six of diamonds sat alone on another column, and the move
  // was 5♣ 4♦ 3♣ onto that six — which uncovers the 6♥, and hearts were
  // already built to the five. A real move, on the table, in plain sight.
  //
  // Every step below step 3 used to start from `pile.findIndex(faceUp)` —
  // the first face-up card — so the only tableau move any of them ever
  // considered was the WHOLE face-up run. In that column the whole run is
  // headed by a King that already has a column to itself, so there was
  // nothing to try and the hint fell through to "turn the deck over and go
  // through it again". Telling a player that about a board with a move on
  // it is worse than saying nothing: they believe it.
  //
  // Every face-up card is a candidate head. The face-up part of a Klondike
  // column is always a valid descending alternating run — a card only ever
  // lands there by a legal build, and a card only turns over once
  // everything above it has gone — so any slice of it is a legal run and
  // needs no extra check.
  //
  // ONLY when the card it uncovers can go straight to a foundation. That
  // restriction is not timidity, it is what keeps two promises:
  //
  //   - isStuck() true must mean findHint() returns null, or the status
  //     line and the Hint button contradict each other. Uncovering a card
  //     that plays to a foundation IS progress by isStuck's definition, so
  //     a move this step offers can never exist in a hand isStuck calls
  //     dead.
  //   - a hint is advice, and "shuffle this run onto that one because the
  //     card underneath could then move somewhere" is advice that
  //     ping-pongs. The test that plays a whole game by following hints is
  //     what catches that, and it did.
  for (let i = 0; i < 7; i++) {
    const pile = state.tableau[i];
    const first = pile.findIndex((c) => c.faceUp);
    if (first < 0) continue;
    for (let j = first + 1; j < pile.length; j++) {
      const under = pile[j - 1];
      const f = foundationIndexFor(state, under);
      if (f < 0 || !canPlaceOnFoundation(under, state.foundations[f])) continue;
      const from = { pile: "tableau", index: i, card: j };
      const to = autoMoveTarget(state, from);
      if (to && to.pile === "tableau") return { from, to };
    }
  }

  // 5. the whole face-up run, anywhere it is not pointless — a King onto
  //    an empty column, or a run onto a build.
  for (let i = 0; i < 7; i++) {
    const pile = state.tableau[i];
    const first = pile.findIndex((c) => c.faceUp);
    if (first < 0) continue;
    const from = { pile: "tableau", index: i, card: first };
    const to = autoMoveTarget(state, from);
    if (to && to.pile === "tableau") return { from, to };
  }

  // 6. draw — but only when the deck can still change something. This
  // used to be the unconditional last line, which is how a dead position
  // came to promise "turn the deck over and go through it again" forever:
  // one unplayable card in the waste was enough to satisfy it.
  if ((state.stock.length || state.waste.length) && !isStuck(state)) return { draw: true };
  return null;
}

/**
 * What a hint means, for the status line — as a message `{ key, args }`
 * rather than a sentence, so the page can say it in whichever language
 * the player chose (the keys are in src/i18n/strings.js and /i18n/common.js;
 * `args.card` / `args.target` are card objects the page turns into names):
 *
 *   { key: "noMoves" }
 *   { key: "hintDrawNext" } | { key: "hintDrawAgain" }
 *   { key: "hintToFoundation", args: { card } }
 *   { key: "hintToEmpty",      args: { card } }
 *   { key: "hintOnto",         args: { card, target } }
 */
export function describeHint(state, hint) {
  if (!hint) return { key: "noMoves" };
  if (hint.draw) return { key: state.stock.length ? "hintDrawNext" : "hintDrawAgain" };
  const card = cardsAt(state, hint.from)[0];
  if (hint.to.pile === "foundation") return { key: "hintToFoundation", args: { card } };
  const dest = state.tableau[hint.to.index];
  if (!dest.length) return { key: "hintToEmpty", args: { card } };
  return { key: "hintOnto", args: { card, target: dest[dest.length - 1] } };
}
