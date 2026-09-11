// game/solver.js
// Can this deal be won at all? — a bounded search used by newGame() to
// throw away the deals that cannot, so nobody over 65 spends ten minutes
// on a hand that was lost before the first tap. Roughly a fifth of random
// Klondike deals are unwinnable however well they are played, and there
// is no rule in Klondike that rescues you from one; Mahjong on this site
// has only ever built solvable boards, and this brings Solitaire in line.
//
// Nothing here touches the DOM or localStorage, and it imports nothing,
// so it runs under node for the test suite. It is deliberately NOT the
// rules engine a second time: klondike.js is written for clarity and
// immutability (clone() on every move), which is exactly wrong for a
// search that visits tens of thousands of positions. This file keeps its
// own compact, MUTABLE copy of the position and undoes each move on the
// way back up, which is what makes the search fast enough to sit behind a
// button press.
//
// It has FULL knowledge of the face-down cards. That is on purpose: it is
// checking the DEAL, not playing the player's game. "Winnable" here means
// what it means in the literature — winnable by someone who can see
// everything ("thoughtful solitaire") — not winnable by a player guessing.
//
// ONE-SIDED BY DESIGN. Every approximation in this file makes the search
// find FEWER wins, never more, and a deal we cannot prove winnable is
// REJECTED rather than dealt. So the only mistake that can ship is "we
// threw away a perfectly good deal" — which costs one more shuffle and
// nothing else — never "we dealt an unwinnable one". The approximations,
// each commented where it happens, are:
//   - no card is ever taken back off a foundation onto the tableau;
//   - the only reason to turn the deck is to reach a card you can play,
//     so a draw jumps straight to a playable card rather than stopping on
//     every card in between;
//   - the transposition table remembers a position as a dead end for the
//     rest of that pass, which under a node budget can retire a position
//     a longer line would have got something out of;
//   - the position key is a 53-bit hash, so two unrelated positions can
//     in principle collide and one of them go unsearched.
// A "yes", by contrast, is never an approximation: solveDeal() hands back
// the actual sequence of moves, and test/solver.test.js replays it through
// klondike.js and checks the game really ends won.

// ----------------------------------------------------------------------
// the compact position
// ----------------------------------------------------------------------
// A card is one integer: suit * 13 + (rank - 1), suits in the order
// S H D C, so hearts and diamonds — the red ones — are suits 1 and 2.
const SUIT_ORDER = "SHDC";
const rankOf = (c) => (c % 13) + 1;
const suitOf = (c) => (c / 13) | 0;
const isRed = (c) => c >= 13 && c < 39;

// The two suits of the other colour, for the safe-move test below.
const OPPOSITE = [[1, 2], [0, 3], [0, 3], [1, 2]];

export const DRAW = 0, W2F = 1, W2T = 2, T2F = 3, T2T = 4;

/**
 * Build the search's own position from a klondike.js state.
 *
 * The stock and the waste become ONE array, `deck`, holding every card
 * still in either of them in the order the player meets them, plus `pos`,
 * how many of those cards are currently in the waste. That works because
 * the order is a cycle that turning the deck over does not disturb: the
 * engine draws off the END of the stock and turns the waste back over
 * reversed, so the card you see first after a redeal is the card you saw
 * first the time before. With that one array, drawing is `pos += 1` (or
 * 3), turning the deck over is `pos = 0`, and the only card you can touch
 * is `deck[pos - 1]` — and undoing any of it is restoring one number.
 */
function pack(state) {
  const code = (c) => SUIT_ORDER.indexOf(c.suit) * 13 + (c.rank - 1);
  const cols = [];
  const down = [];
  for (let i = 0; i < 7; i++) {
    cols.push(state.tableau[i].map(code));
    // Face-down cards sit at the bottom of a column and never move — they
    // only flip — so a count is all the search needs to know which they
    // are, and that makes the position key much smaller.
    let n = 0;
    while (n < state.tableau[i].length && !state.tableau[i][n].faceUp) n++;
    down.push(n);
  }
  const found = [0, 0, 0, 0];
  for (const pile of state.foundations) {
    if (pile.length) found[SUIT_ORDER.indexOf(pile[0].suit)] = pile[pile.length - 1].rank;
  }
  const deck = [...state.waste.map(code), ...state.stock.slice().reverse().map(code)];
  return { cols, down, found, deck, pos: state.waste.length, drawN: state.draw === 3 ? 3 : 1 };
}

const isWon = (S) => S.found[0] + S.found[1] + S.found[2] + S.found[3] === 52;

function fitsFoundation(S, c) {
  return S.found[suitOf(c)] === rankOf(c) - 1;
}
function fitsColumn(S, c, i) {
  const col = S.cols[i];
  if (col.length === 0) return rankOf(c) === 13;
  const top = col[col.length - 1];
  return rankOf(top) === rankOf(c) + 1 && isRed(top) !== isRed(c);
}
/** Is this card playable anywhere at all right now? */
function playableSomewhere(S, c) {
  if (fitsFoundation(S, c)) return true;
  for (let i = 0; i < 7; i++) if (fitsColumn(S, c, i)) return true;
  return false;
}

/**
 * A foundation move that can never cost you the game, so the search plays
 * it and considers nothing else from that position. The only reason to
 * hold a card back from its foundation is to park the opposite-coloured
 * card one rank below it on top of it; once BOTH foundations of the other
 * colour have reached that rank, no such card is left to park and the
 * move is free. Aces and twos are always free. This is the standard
 * safe-move rule and it provably keeps a winnable position winnable,
 * which is why collapsing it into a single forced move is not one of the
 * approximations listed at the top of the file.
 */
function isSafeToPlayUp(S, c) {
  const r = rankOf(c);
  if (r <= 2) return true;
  const [a, b] = OPPOSITE[suitOf(c)];
  return S.found[a] >= r - 1 && S.found[b] >= r - 1;
}

// ----------------------------------------------------------------------
// moves
// ----------------------------------------------------------------------

/**
 * Where the deck could be turned to: every `pos` within two trips round
 * the cycle whose waste card can actually be played somewhere.
 *
 * Stopping on the cards in between is left out on purpose (it is the
 * second approximation in the header): turning the deck changes nothing
 * on the table, so a position whose waste card is unplayable offers the
 * search exactly what its predecessor offered plus a wasted node — and
 * there are up to 24 of them between one useful card and the next.
 *
 * Two trips, not one, because in Draw 3 turning the deck over re-aligns
 * which cards land on top of the waste, so the second pass reaches cards
 * the first one dealt into the middle of a batch of three.
 */
function drawTargets(S) {
  const out = [];
  const len = S.deck.length;
  if (!len) return out;
  let pos = S.pos;
  const steps = 2 * Math.ceil(len / S.drawN) + 2;
  for (let s = 0; s < steps; s++) {
    if (pos >= len) pos = 0; // the deck is spent: turn it over
    else pos = Math.min(len, pos + S.drawN);
    if (pos === S.pos) break; // all the way round, back where we started
    if (pos > 0 && playableSomewhere(S, S.deck[pos - 1])) out.push(pos);
  }
  return out;
}

/**
 * The moves worth trying from this position, best first.
 *
 * If a safe foundation move exists this returns that move ALONE — see
 * isSafeToPlayUp. Otherwise the order is the one a good player uses:
 * uncover a face-down card, empty a column, play the waste, then
 * everything else, and turn the deck last. The search takes the first win
 * it finds and never looks for a shorter one, so this ordering is most of
 * what makes it fast.
 *
 * `rnd`, when given, shuffles within each of those groups. That is what
 * the restarts in solveDeal() vary: depth-first search on Klondike is
 * prone to disappearing down one bad branch for its whole budget, and
 * several short passes down different branches prove far more deals than
 * one long pass down the first (78% against 64% at the same total number
 * of nodes, measured over 300 deals).
 */
function genMoves(S, rnd) {
  for (let i = 0; i < 7; i++) {
    const col = S.cols[i];
    if (!col.length) continue;
    const c = col[col.length - 1];
    if (fitsFoundation(S, c) && isSafeToPlayUp(S, c)) return [{ k: T2F, col: i }];
  }
  if (S.pos > 0) {
    const c = S.deck[S.pos - 1];
    if (fitsFoundation(S, c) && isSafeToPlayUp(S, c)) return [{ k: W2F }];
  }

  const reveal = [], empty = [], wasteToCol = [], up = [], shuffleRun = [];

  for (let f = 0; f < 7; f++) {
    const col = S.cols[f];
    if (col.length === S.down[f]) continue; // nothing face up here
    const firstUp = S.down[f];
    for (let j = firstUp; j < col.length; j++) {
      const head = col[j];
      for (let t = 0; t < 7; t++) {
        if (t === f || !fitsColumn(S, head, t)) continue;
        // Moving the whole of a column into an empty column is the
        // pointless King shuffle: the position afterwards is the position
        // before it with two columns renamed. Never worth a node.
        const emptiesColumn = j === 0;
        if (emptiesColumn && S.cols[t].length === 0) continue;
        const move = { k: T2T, f, t, n: col.length - j };
        if (j === firstUp && firstUp > 0) reveal.push(move);
        else if (emptiesColumn) empty.push(move);
        else shuffleRun.push(move);
      }
    }
    const top = col[col.length - 1];
    if (fitsFoundation(S, top)) up.push({ k: T2F, col: f });
  }

  if (S.pos > 0) {
    const c = S.deck[S.pos - 1];
    for (let t = 0; t < 7; t++) if (fitsColumn(S, c, t)) wasteToCol.push({ k: W2T, t });
    if (fitsFoundation(S, c)) up.push({ k: W2F });
  }

  // Dig the column with the most still buried first: those cards are what
  // the deal is hiding, and nothing else can be done about them.
  reveal.sort((a, b) => S.down[b.f] - S.down[a.f]);

  const draws = drawTargets(S);
  if (rnd) {
    for (const group of [reveal, empty, wasteToCol, up, shuffleRun, draws]) shuffleInPlace(group, rnd);
  }
  const moves = [...reveal, ...empty, ...wasteToCol, ...up, ...shuffleRun];
  for (const to of draws) moves.push({ k: DRAW, to });
  return moves;
}

function shuffleInPlace(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd() % (i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
}

// Each move records what it needs for unapply() the moment it is applied,
// so a move object is apply-once: genMoves() builds fresh ones per node.
function apply(S, m) {
  switch (m.k) {
    case DRAW:
      m.was = S.pos;
      S.pos = m.to;
      return;
    case W2F: {
      const c = S.deck[S.pos - 1];
      m.card = c;
      S.deck.splice(S.pos - 1, 1);
      S.pos--;
      S.found[suitOf(c)]++;
      return;
    }
    case W2T: {
      const c = S.deck[S.pos - 1];
      m.card = c;
      S.deck.splice(S.pos - 1, 1);
      S.pos--;
      S.cols[m.t].push(c);
      return;
    }
    case T2F: {
      const col = S.cols[m.col];
      const c = col.pop();
      m.card = c;
      S.found[suitOf(c)]++;
      m.flip = col.length === S.down[m.col] && S.down[m.col] > 0;
      if (m.flip) S.down[m.col]--;
      return;
    }
    case T2T: {
      const src = S.cols[m.f], dst = S.cols[m.t];
      for (let i = src.length - m.n; i < src.length; i++) dst.push(src[i]);
      src.length -= m.n;
      m.flip = src.length === S.down[m.f] && S.down[m.f] > 0;
      if (m.flip) S.down[m.f]--;
      return;
    }
  }
}

function unapply(S, m) {
  switch (m.k) {
    case DRAW:
      S.pos = m.was;
      return;
    case W2F:
      S.found[suitOf(m.card)]--;
      S.deck.splice(S.pos, 0, m.card);
      S.pos++;
      return;
    case W2T:
      S.cols[m.t].pop();
      S.deck.splice(S.pos, 0, m.card);
      S.pos++;
      return;
    case T2F:
      if (m.flip) S.down[m.col]++;
      S.found[suitOf(m.card)]--;
      S.cols[m.col].push(m.card);
      return;
    case T2T: {
      if (m.flip) S.down[m.f]++;
      const src = S.cols[m.f], dst = S.cols[m.t];
      for (let i = dst.length - m.n; i < dst.length; i++) src.push(dst[i]);
      dst.length -= m.n;
      return;
    }
  }
}

/**
 * A number that is the same for two positions that play the same.
 *
 * The seven per-column hashes are SORTED before being folded together,
 * because the columns are interchangeable — a position with a King in
 * column 2 and an empty column 5 plays exactly like its mirror — and that
 * symmetry is where a great deal of the duplicate work is. Face-down
 * cards go in as a count: which cards they are is fixed by the column.
 *
 * 53 bits of hash in a plain number, rather than a string key: the
 * transposition table is touched once per node and building a string per
 * node cost about a third of the whole search. Collisions are possible
 * and would make the search skip a position, which can only lose a win —
 * the safe direction, as the header explains.
 */
function key(S) {
  const marks = [];
  for (let i = 0; i < 7; i++) {
    const col = S.cols[i];
    let a = (0x9e3779b1 ^ Math.imul(S.down[i] + 1, 2654435761)) >>> 0;
    for (let j = S.down[i]; j < col.length; j++) a = (Math.imul(a ^ (col[j] + 1), 2246822519) + j) >>> 0;
    marks.push(a >>> 0);
  }
  marks.sort((x, y) => x - y);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const mix = (v) => {
    h1 = Math.imul(h1 ^ v, 16777619) >>> 0;
    h2 = (Math.imul(h2 + v, 2246822519) ^ (h2 >>> 13)) >>> 0;
  };
  for (const m of marks) mix(m);
  mix(S.pos);
  mix(S.found[0] | (S.found[1] << 4) | (S.found[2] << 8) | (S.found[3] << 12));
  return h1 * 2097152 + (h2 >>> 11);
}

// ----------------------------------------------------------------------
// the search
// ----------------------------------------------------------------------

// The budget is a NODE count, never a clock. Two devices have to agree on
// whether a deal is winnable: newGame() derives its next candidate seed
// from the answer, so a time budget would deal different cards on a tired
// phone than on a desktop and break "the same seed is the same game".
//
// 8000 positions spread over 8 short passes is about 20 ms of work on this
// container and proves 81% of Draw 1 deals and 56% of Draw 3 ones (300
// deals each). Draw 1's own ceiling is around 82%, so almost nothing
// winnable is being thrown away there; Draw 3 is a far harder search and
// we reject plenty of deals that could have been won, which costs another
// shuffle and no correctness. Raising the budget past this buys about one
// percentage point per doubling — the plateau is the search, not the
// budget — and doubles the price of every rejection, so it is not worth
// it behind a button press.
export const DEFAULT_NODE_BUDGET = 8000;
export const DEFAULT_RESTARTS = 8;

/**
 * Search for a win.
 *
 * Returns { solved, nodes, exhausted, solution }. `exhausted: true` means
 * the budget ran out — "no proof either way" — and callers MUST treat it
 * exactly like `solved: false`. `exhausted: false` with `solved: false` is
 * the stronger answer: every position the search can reach was looked at
 * and there is no win among them.
 *
 * `solution` is the winning move list, for the test that replays it
 * through the real engine. Nothing in the game needs it.
 */
export function solveDeal(state, { nodeBudget = DEFAULT_NODE_BUDGET, restarts = DEFAULT_RESTARTS } = {}) {
  let nodes = 0;
  const per = Math.max(1, Math.ceil(nodeBudget / Math.max(1, restarts)));
  for (let pass = 0; pass < Math.max(1, restarts); pass++) {
    const r = searchPass(state, per, pass);
    nodes += r.nodes;
    if (r.solved) return { solved: true, nodes, exhausted: false, solution: r.solution };
    // A pass that finished inside its budget searched the whole reachable
    // space, and the restarts only reorder that same space — so there is
    // nothing for another pass to find. Stop and say so.
    if (!r.exhausted) return { solved: false, nodes, exhausted: false, solution: null };
  }
  return { solved: false, nodes, exhausted: true, solution: null };
}

/**
 * One depth-first pass. `pass` 0 uses the plain move ordering; later ones
 * shuffle within each priority group (see genMoves) from a generator
 * seeded only by `pass`, so the whole search stays a pure function of the
 * deal.
 *
 * An explicit stack rather than recursion: the transposition table is
 * what stops the search going round in circles, so a line can run for
 * thousands of moves before it is cut off — more frames than a phone's JS
 * stack is willing to give us.
 */
function searchPass(state, nodeBudget, pass) {
  let a = (Math.imul(pass + 1, 0x9e3779b1) + 0x6d2b79f5) >>> 0;
  const rnd = pass === 0 ? null : () => {
    a = (Math.imul(a ^ (a >>> 15), 2246822519) + 0x6d2b79f5) >>> 0;
    return a >>> 3;
  };
  const S = pack(state);
  if (isWon(S)) return { solved: true, nodes: 0, exhausted: false, solution: [] };
  const seen = new Set([key(S)]);
  const stack = [{ moves: genMoves(S, rnd), i: 0, m: null }];
  let nodes = 0;

  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.i >= frame.moves.length) {
      stack.pop();
      if (frame.m) unapply(S, frame.m);
      continue;
    }
    const m = frame.moves[frame.i++];
    apply(S, m);
    if (isWon(S)) {
      const solution = stack.map((f) => f.m).filter(Boolean);
      solution.push(m);
      return { solved: true, nodes, exhausted: false, solution };
    }
    if (++nodes >= nodeBudget) {
      unapply(S, m);
      return { solved: false, nodes, exhausted: true, solution: null };
    }
    const k = key(S);
    if (seen.has(k)) { unapply(S, m); continue; }
    seen.add(k);
    stack.push({ moves: genMoves(S, rnd), i: 0, m });
  }
  return { solved: false, nodes, exhausted: false, solution: null };
}

/** True only when a win was actually found. See solveDeal. */
export function isWinnable(state, options) {
  return solveDeal(state, options).solved;
}
