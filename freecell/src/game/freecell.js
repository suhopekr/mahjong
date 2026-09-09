// game/freecell.js
// The rules of FreeCell, and nothing else. No DOM, no storage, no text,
// no timers: every function takes a state and returns a new state (or a
// plain answer), so the whole file runs under node for the test suite and
// the page's main.js is only ever a renderer of what comes out.
//
// The rules are the standard, Microsoft-compatible ones:
//
//   - 52 cards, all face up, dealt one at a time left to right into 8
//     cascades (the first four end up with 7 cards, the last four with 6)
//   - 4 free cells, one card each; 4 foundations building Ace → King by suit
//   - cascades build DOWN in alternating colours; any card may go on an
//     empty cascade
//   - a run of N cards may move together only when
//       N ≤ (empty free cells + 1) × 2^(empty cascades not counting the
//       destination)
//     — the moves you could make one card at a time through the free
//     space, done in one go
//   - deals are numbered; the shuffle is the Microsoft / FreeCell Pro one,
//     so "Deal 11982" here is the same game it is everywhere else
//
// No scoring and no clock — this site does not keep either.
//
// Two pieces of judgement live here: autoMoveTarget() (the site's "tap a
// card and it goes where it should" gesture) and findHint(). Everything a
// player reads is composed by main.js from keys — describeHint() returns
// a descriptor, never a sentence — so the page can speak 14 languages.

export const SUITS = ["S", "H", "D", "C"];
export const RED = { H: true, D: true, S: false, C: false };
export const RANK_LABEL = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUIT_NAME = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
export const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };

/** Deals 1–32000 are the classic Microsoft set; #11982 is the one that
 *  cannot be won, so a random pick never lands on it. */
export const DEAL_MIN = 1;
export const DEAL_MAX = 999999;
export const RANDOM_DEAL_MAX = 32000;
export const UNSOLVABLE = new Set([11982]);

// Deterministic RNG (mulberry32), the site's standard, for anything that
// needs reproducible randomness other than the deal itself (the deal uses
// the Microsoft generator below so numbers match the classic games).
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
    for (let rank = 1; rank <= 13; rank++) deck.push({ id: suit + rank, suit, rank });
  }
  return deck;
}

/** "4,217" — deal numbers are always shown with a thousands separator. */
export function formatDeal(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ----------------------------------------------------------------------
// the Microsoft shuffle
// ----------------------------------------------------------------------

/** The deck the Microsoft dealer starts from: index i is rank (i >> 2) + 1
 *  (Aces first), suit i & 3 in the order clubs, diamonds, hearts, spades. */
export function msDeck() {
  const suits = ["C", "D", "H", "S"];
  const deck = [];
  for (let i = 0; i < 52; i++) {
    const suit = suits[i & 3], rank = (i >> 2) + 1;
    deck.push({ id: suit + rank, suit, rank });
  }
  return deck;
}

/** The C runtime's rand(): the LCG every Microsoft deal number is built on. */
export function msRand(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 214013) + 2531011) & 0x7fffffff; return s >> 16; };
}

/**
 * The 52 cards of deal `seed` in the order they are dealt (card i goes to
 * cascade i % 8) — exactly as FreeCell Pro documents Microsoft FreeCell:
 * "pick a random card from the ones left, then move the last one into its
 * hole".
 */
export function msShuffle(seed) {
  const rand = msRand(seed);
  const deck = msDeck();
  const out = [];
  let left = 52;
  for (let i = 0; i < 52; i++) {
    const j = rand() % left;
    out.push(deck[j]);
    deck[j] = deck[--left];
  }
  return out;
}

/** A deal number for "New game": 1–32000, never the unwinnable one. */
export function randomDealNumber(rng = Math.random) {
  let n;
  do { n = 1 + Math.floor(rng() * RANDOM_DEAL_MAX); } while (UNSOLVABLE.has(n));
  return n;
}

export function isValidDealNumber(n) {
  return Number.isInteger(n) && n >= DEAL_MIN && n <= DEAL_MAX;
}

/** A fresh game of deal `deal` (random when omitted or invalid). */
export function newGame({ deal } = {}) {
  if (!isValidDealNumber(deal)) deal = randomDealNumber();
  const cards = msShuffle(deal);
  const cascades = [[], [], [], [], [], [], [], []];
  cards.forEach((c, i) => cascades[i % 8].push({ ...c }));
  return {
    deal,
    cascades,
    cells: [null, null, null, null],
    foundations: [[], [], [], []],
    moves: 0,
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

export function canPlaceOnCascade(card, pile) {
  if (pile.length === 0) return true;
  const top = pile[pile.length - 1];
  return RED[top.suit] !== RED[card.suit] && top.rank - 1 === card.rank;
}

/** Alternating colours, each one lower than the last. */
export function isRun(cards) {
  for (let i = 1; i < cards.length; i++) {
    if (RED[cards[i].suit] === RED[cards[i - 1].suit] || cards[i].rank !== cards[i - 1].rank - 1) return false;
  }
  return true;
}

/** Which foundation pile takes this suit, given the piles already started. */
export function foundationIndexFor(state, card) {
  const idx = state.foundations.findIndex((p) => p.length && p[0].suit === card.suit);
  if (idx >= 0) return idx;
  return state.foundations.findIndex((p) => p.length === 0);
}

export function emptyCells(state) { return state.cells.filter((c) => !c).length; }
export function emptyCascades(state) { return state.cascades.filter((p) => p.length === 0).length; }

/** How many cards may move together right now. `toEmpty` when the
 *  destination is an empty cascade (it cannot count as free space). */
export function maxMovable(state, toEmpty = false) {
  const empties = emptyCascades(state) - (toEmpty ? 1 : 0);
  return (emptyCells(state) + 1) * Math.pow(2, Math.max(0, empties));
}

export function pileAt(state, loc) {
  if (loc.pile === "cascade") return state.cascades[loc.index];
  if (loc.pile === "foundation") return state.foundations[loc.index];
  if (loc.pile === "cell") return state.cells[loc.index] ? [state.cells[loc.index]] : [];
  throw new Error("unknown pile " + loc.pile);
}

/** The cards a location refers to: a run from `card` to the end of a
 *  cascade (empty when those cards are not in sequence), or the single
 *  card in a free cell. Foundation cards never move back. */
export function cardsAt(state, loc) {
  if (loc.pile === "foundation") return [];
  const pile = pileAt(state, loc);
  if (loc.pile === "cascade") {
    const from = loc.card === undefined ? pile.length - 1 : loc.card;
    if (from < 0 || from >= pile.length) return [];
    const run = pile.slice(from);
    return isRun(run) ? run : [];
  }
  return pile.length ? [pile[pile.length - 1]] : [];
}

/** Length of the run sitting on top of a cascade (0 when empty). */
export function topRunLength(pile) {
  let n = pile.length ? 1 : 0;
  while (n < pile.length && isRun(pile.slice(pile.length - n - 1))) n++;
  return n;
}

/**
 * Why the cards at `from` cannot go to `to` — null when they can. The
 * reasons are what the status line needs to say something helpful:
 *   { reason: "none" }                      nothing liftable at `from`
 *   { reason: "same" }                      same place
 *   { reason: "single" }                    a run cannot go to a cell or foundation
 *   { reason: "cellFull" }                  that free cell has a card in it
 *   { reason: "foundation" }                not the next card of that suit
 *   { reason: "cascade" }                   not one lower and the other colour
 *   { reason: "tooMany", count, allowed }   the run is longer than the free space allows
 */
export function moveProblem(state, from, to) {
  const cards = cardsAt(state, from);
  if (!cards.length) return { reason: "none" };
  if (from.pile === to.pile && from.index === to.index) return { reason: "same" };
  if (to.pile === "cell") {
    if (cards.length !== 1) return { reason: "single" };
    return state.cells[to.index] ? { reason: "cellFull" } : null;
  }
  if (to.pile === "foundation") {
    if (cards.length !== 1) return { reason: "single" };
    return canPlaceOnFoundation(cards[0], state.foundations[to.index]) ? null : { reason: "foundation" };
  }
  if (to.pile === "cascade") {
    const dest = state.cascades[to.index];
    if (!canPlaceOnCascade(cards[0], dest)) return { reason: "cascade" };
    const allowed = maxMovable(state, dest.length === 0);
    if (cards.length > allowed) return { reason: "tooMany", count: cards.length, allowed };
    return null;
  }
  return { reason: "none" };
}

export function canMove(state, from, to) {
  return moveProblem(state, from, to) === null;
}

/** Every legal destination for the cards at `from`: foundation first,
 *  then occupied cascades, then the first empty cascade, then the first
 *  empty cell. (Every empty cascade / cell is the same destination, so
 *  only the first of each is listed.) */
export function destinationsFor(state, from) {
  const out = [];
  const cards = cardsAt(state, from);
  if (!cards.length) return out;
  if (cards.length === 1) {
    const f = foundationIndexFor(state, cards[0]);
    if (f >= 0 && canMove(state, from, { pile: "foundation", index: f })) out.push({ pile: "foundation", index: f });
  }
  const occupied = [], empty = [];
  for (let i = 0; i < 8; i++) {
    const to = { pile: "cascade", index: i };
    if (!canMove(state, from, to)) continue;
    (state.cascades[i].length ? occupied : empty).push(to);
  }
  out.push(...occupied);
  if (empty.length) out.push(empty[0]);
  if (cards.length === 1 && from.pile !== "cell") {
    const c = state.cells.findIndex((x) => !x);
    if (c >= 0) out.push({ pile: "cell", index: c });
  }
  return out;
}

/**
 * Where a tapped card should go. In order:
 *   1. its foundation, if it can go up;
 *   2. a real build — an occupied cascade that takes it (the one with the
 *      longest run on top, so long runs stay together);
 *   3. for a King (or a run), the empty cascade; for a lone lower card the
 *      free cell first — a cell is the cheaper parking space, and an empty
 *      column is worth keeping for a King or a long run;
 *   4. the empty cascade as a last resort.
 * A free cell is never chosen while a build exists. Moving a whole cascade
 * into another empty cascade is refused as pointless. Returns null when
 * nothing is possible.
 */
export function autoMoveTarget(state, from) {
  const dests = destinationsFor(state, from);
  if (!dests.length) return null;
  if (dests[0].pile === "foundation") return dests[0];
  const cards = cardsAt(state, from);
  const fromPile = pileAt(state, from);
  const wholeCascade = from.pile === "cascade" && cards.length === fromPile.length;
  const builds = dests.filter((d) => d.pile === "cascade" && state.cascades[d.index].length);
  builds.sort((a, b) => {
    const pa = state.cascades[a.index], pb = state.cascades[b.index];
    return topRunLength(pb) - topRunLength(pa) || pb.length - pa.length;
  });
  if (builds.length) return builds[0];
  const empty = wholeCascade ? null : dests.find((d) => d.pile === "cascade" && !state.cascades[d.index].length);
  const cell = dests.find((d) => d.pile === "cell");
  const kingOrRun = cards.length > 1 || cards[0].rank === 13;
  if (kingOrRun) return empty || cell || null;
  return cell || empty || null;
}

// ----------------------------------------------------------------------
// actions — each returns a NEW state and never touches the one passed in
// ----------------------------------------------------------------------

export function applyMove(state, from, to) {
  if (!canMove(state, from, to)) return null;
  const next = clone(state);
  const moving = cardsAt(state, from).map((c) => ({ ...c }));
  if (from.pile === "cell") next.cells[from.index] = null;
  else {
    const source = pileAt(next, from);
    source.splice(source.length - moving.length, moving.length);
  }
  if (to.pile === "cell") next.cells[to.index] = moving[0];
  else pileAt(next, to).push(...moving);
  next.moves += 1;
  return next;
}

export function isWon(state) {
  return state.foundations.every((p) => p.length === 13);
}

// ----------------------------------------------------------------------
// safe autoplay and the finish
// ----------------------------------------------------------------------

function foundationRank(state, suit) {
  const pile = state.foundations.find((p) => p.length && p[0].suit === suit);
  return pile ? pile.length : 0;
}

/**
 * The standard "safe autoplay" test: a card may go home by itself when
 * nothing still on the table could ever need it as a base — an Ace or a 2
 * always; a higher card when both cards of the other colour one rank lower
 * are already home.
 */
export function isSafeToFoundation(state, card) {
  if (card.rank <= 2) return true;
  const others = RED[card.suit] ? ["S", "C"] : ["H", "D"];
  return others.every((s) => foundationRank(state, s) >= card.rank - 1);
}

/** The single top cards a player could lift: every filled cell and every
 *  cascade top. */
export function topLocations(state) {
  const out = [];
  state.cells.forEach((c, i) => { if (c) out.push({ pile: "cell", index: i }); });
  state.cascades.forEach((p, i) => { if (p.length) out.push({ pile: "cascade", index: i, card: p.length - 1 }); });
  return out;
}

function foundationMove(state, from) {
  const cards = cardsAt(state, from);
  if (cards.length !== 1) return null;
  const f = foundationIndexFor(state, cards[0]);
  if (f < 0 || !canMove(state, from, { pile: "foundation", index: f })) return null;
  return { from, to: { pile: "foundation", index: f }, card: cards[0] };
}

/** One safe move home, lowest card first, or null. */
export function safeAutoplayStep(state) {
  let best = null;
  for (const loc of topLocations(state)) {
    const m = foundationMove(state, loc);
    if (!m || !isSafeToFoundation(state, m.card)) continue;
    if (!best || m.card.rank < best.card.rank) best = m;
  }
  return best ? { from: best.from, to: best.to } : null;
}

/** Every cascade runs downward (top card lowest), so every move left is a
 *  card going home: the rest is bookkeeping. */
export function canAutoComplete(state) {
  if (isWon(state)) return false;
  return state.cascades.every((p) => p.every((c, k) => k === 0 || c.rank < p[k - 1].rank));
}
export const canAutoFinish = canAutoComplete;

/** One step of the finish: the lowest card that can go home, goes home. */
export function autoCompleteStep(state) {
  let best = null;
  for (const loc of topLocations(state)) {
    const m = foundationMove(state, loc);
    if (m && (!best || m.card.rank < best.card.rank)) best = m;
  }
  return best ? { from: best.from, to: best.to } : null;
}
export const autoFinishStep = autoCompleteStep;

// ----------------------------------------------------------------------
// hint — the move a patient friend would point at
// ----------------------------------------------------------------------

/** The next card each foundation is waiting for, lowest rank first. */
export function neededCards(state) {
  const out = [];
  for (const suit of SUITS) {
    const rank = foundationRank(state, suit) + 1;
    if (rank <= 13) out.push({ id: suit + rank, suit, rank });
  }
  out.sort((a, b) => a.rank - b.rank);
  return out;
}

function findInCascades(state, id) {
  for (let i = 0; i < 8; i++) {
    const k = state.cascades[i].findIndex((c) => c.id === id);
    if (k >= 0) return { index: i, card: k };
  }
  return null;
}

/** Every liftable run start in a cascade: the top run's cards, longest
 *  run first (moving the whole run keeps it together). */
function runStarts(state, i) {
  const pile = state.cascades[i];
  const out = [];
  const n = topRunLength(pile);
  for (let start = pile.length - n; start < pile.length; start++) out.push({ pile: "cascade", index: i, card: start });
  return out;
}

/** True when the card under the run at `from` already holds it as a
 *  build — moving it then gains nothing (and can loop). */
function sitsOnBuild(state, from) {
  if (from.pile !== "cascade" || from.card === 0) return false;
  const pile = state.cascades[from.index];
  return canPlaceOnCascade(pile[from.card], [pile[from.card - 1]]);
}

/**
 * Returns { from, to } or null when nothing at all can move.
 *
 * Priority:
 *   1. any card to a foundation (lowest rank first)
 *   2. a move that empties a cascade or frees a cell: a whole cascade
 *      onto another cascade, or a cell card onto a cascade
 *   3. a build onto an occupied cascade that uncovers something
 *      (a run sitting on a card that already holds it is left alone;
 *      runs covering a card a foundation needs come first)
 *   4. a King or a run to an empty cascade
 *   5. a single card into a free cell — the one covering the lowest card
 *      a foundation is waiting for, else the lowest top card
 */
export function findHint(state) {
  // 1. foundations
  let home = null;
  for (const loc of topLocations(state)) {
    const m = foundationMove(state, loc);
    if (m && (!home || m.card.rank < home.card.rank)) home = m;
  }
  if (home) return { from: home.from, to: home.to };

  const buildsFor = (from) => destinationsFor(state, from).filter((d) => d.pile === "cascade" && state.cascades[d.index].length);

  // 2a. a whole cascade onto another cascade
  for (let i = 0; i < 8; i++) {
    const pile = state.cascades[i];
    if (!pile.length || topRunLength(pile) !== pile.length) continue;
    const from = { pile: "cascade", index: i, card: 0 };
    const dests = buildsFor(from);
    if (dests.length) return { from, to: dests[0] };
  }
  // 2b. a cell card onto a cascade
  for (let i = 0; i < 4; i++) {
    if (!state.cells[i]) continue;
    const from = { pile: "cell", index: i };
    const dests = buildsFor(from);
    if (dests.length) return { from, to: dests[0] };
  }

  // 3. a build that uncovers something — the card a foundation is waiting
  //    for first, then anything else
  const needed = neededCards(state).map((c) => findInCascades(state, c.id)).filter(Boolean);
  const uncovering = (from) => !sitsOnBuild(state, from);
  for (const at of needed) {
    for (const from of runStarts(state, at.index)) {
      if (from.card <= at.card || !uncovering(from)) continue;
      const dests = buildsFor(from);
      if (dests.length) return { from, to: dests[0] };
    }
  }
  for (let i = 0; i < 8; i++) {
    for (const from of runStarts(state, i)) {
      if (!uncovering(from)) continue;
      const dests = buildsFor(from);
      if (dests.length) return { from, to: dests[0] };
    }
  }

  // 4. a King, or a run that is covering something, to an empty cascade.
  //    A King parked in a cell goes first: it frees the cell and the
  //    column could not be put to better use.
  const emptyCol = state.cascades.findIndex((p) => !p.length);
  if (emptyCol >= 0) {
    for (let i = 0; i < 4; i++) {
      if (state.cells[i] && state.cells[i].rank === 13) return { from: { pile: "cell", index: i }, to: { pile: "cascade", index: emptyCol } };
    }
    for (let i = 0; i < 8; i++) {
      const pile = state.cascades[i];
      if (pile.length < 2) continue;
      for (const from of runStarts(state, i)) {
        if (from.card === 0 || !uncovering(from)) continue;
        const cards = cardsAt(state, from);
        if (cards.length < 2 && cards[0].rank !== 13) continue;
        const to = { pile: "cascade", index: emptyCol };
        if (canMove(state, from, to)) return { from, to };
      }
    }
  }

  // 5. a single card into a free cell
  const cell = state.cells.findIndex((c) => !c);
  if (cell >= 0) {
    const to = { pile: "cell", index: cell };
    for (const at of needed) {
      const pile = state.cascades[at.index];
      if (at.card === pile.length - 1) continue;
      return { from: { pile: "cascade", index: at.index, card: pile.length - 1 }, to };
    }
    let best = null;
    for (let i = 0; i < 8; i++) {
      const pile = state.cascades[i];
      if (!pile.length) continue;
      const top = pile[pile.length - 1];
      if (!best || top.rank < best.rank) best = { rank: top.rank, from: { pile: "cascade", index: i, card: pile.length - 1 } };
    }
    if (best) return { from: best.from, to };
  }

  // 6. the last resort — every cell is full and only the empty column is
  //    left: a single card into it, the one covering the lowest card a
  //    foundation is waiting for first, then a cell card (it frees the
  //    cell), then the lowest top card. "No moves left" is only ever said
  //    when it is true.
  if (emptyCol >= 0) {
    const to = { pile: "cascade", index: emptyCol };
    for (const at of needed) {
      const pile = state.cascades[at.index];
      if (at.card === pile.length - 1 || pile.length < 2) continue;
      const from = { pile: "cascade", index: at.index, card: pile.length - 1 };
      if (canMove(state, from, to)) return { from, to };
    }
    for (let i = 0; i < 4; i++) {
      const from = { pile: "cell", index: i };
      if (state.cells[i] && canMove(state, from, to)) return { from, to };
    }
    let best = null;
    for (let i = 0; i < 8; i++) {
      const pile = state.cascades[i];
      if (pile.length < 2) continue;
      const top = pile[pile.length - 1];
      if (!best || top.rank < best.rank) best = { rank: top.rank, from: { pile: "cascade", index: i, card: pile.length - 1 } };
    }
    if (best && canMove(state, best.from, to)) return { from: best.from, to };
  }
  // Anything at all that is legal and not pointless (a lone card from one
  // empty-but-for-it column to another empty column changes nothing).
  for (const from of topLocations(state)) {
    for (const to of destinationsFor(state, from)) {
      const pointless = to.pile === "cascade" && !state.cascades[to.index].length && from.pile === "cascade" && state.cascades[from.index].length === 1;
      if (!pointless) return { from, to };
    }
  }
  return null;
}

/**
 * What a hint means, as a descriptor for main.js to put into words:
 *   { key: "hintNone" }
 *   { key: "hintHome" | "hintCell" | "hintEmpty" | "hintOnto", card, count, dest }
 * `card` is the head card, `count` the number of cards moving, `dest` the
 * card the run lands on (hintOnto only).
 */
export function describeHint(state, hint) {
  if (!hint) return { key: "hintNone" };
  const cards = cardsAt(state, hint.from);
  const card = cards[0], count = cards.length;
  if (hint.to.pile === "foundation") return { key: "hintHome", card, count };
  if (hint.to.pile === "cell") return { key: "hintCell", card, count };
  const dest = state.cascades[hint.to.index];
  if (!dest.length) return { key: "hintEmpty", card, count };
  return { key: "hintOnto", card, count, dest: dest[dest.length - 1] };
}
