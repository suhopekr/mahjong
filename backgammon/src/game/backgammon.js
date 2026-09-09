// game/backgammon.js
// The rules of backgammon, and nothing else. No DOM, no storage, no
// timers, no English: every function takes a state and returns a new
// state (or a plain answer), so the whole file runs under node for the
// test suite and the page's main.js only ever renders what comes out.
// The computer's play lives next door in ai.js.
//
// Single games, no doubling cube, no match play. The standard rules:
//
//   - opening roll: each side rolls one die, higher goes first and plays
//     those two dice; ties re-roll
//   - a roll is two dice; doubles play four moves
//   - a checker moves the exact count of one die; a point holding two or
//     more of the other side's checkers is blocked
//   - both dice must be played when any way of doing so exists; when only
//     one can be played and either would do alone, the higher must be
//   - landing on a single enemy checker hits it to the bar; a side with
//     checkers on the bar must bring them in before moving anything else
//   - bearing off starts only when all fifteen are in the home board; a
//     higher die may bear off from the highest occupied point when no
//     checker sits on the exact point
//   - the game ends when a side has borne off all fifteen. If the loser
//     bore off nothing it is a gammon; a gammon with a loser's checker
//     still on the bar or in the winner's home board is a backgammon
//
// Numbering: one system for everything, the HUMAN's. Point 1 is the
// last point of the human's home board, point 24 the far corner. The
// human (ivory) moves 24 → 1 and bears off past 1; the computer moves
// 1 → 24 and bears off past 24. Internally `points` is an array of 24
// signed counts indexed 0..23 (point p is index p − 1): positive = human
// checkers, negative = computer checkers.
//
// Dice come from a mulberry32 word carried in the state (`rng`) so a game
// is reproducible from its seed — the tests need that, and the QA script
// leans on it.

export const HUMAN = "h";
export const COMPUTER = "c";
export const DIFFICULTIES = ["relaxed", "standard"];
export const FIRST = ["random", "h", "c"];

// ----------------------------------------------------------------------
// deterministic random numbers — mulberry32, as in solitaire/klondike.js,
// but as a pure step over a 32-bit word so the word can live in the state
// ----------------------------------------------------------------------
export function rngStep(word) {
  let a = (word + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    const [v, next] = rngStep(a);
    a = next;
    return v;
  };
}
function rollDie(word) {
  const [v, rng] = rngStep(word);
  return [1 + Math.floor(v * 6), rng];
}

// ----------------------------------------------------------------------
// positions
// ----------------------------------------------------------------------
export function startingPoints() {
  const p = new Array(24).fill(0);
  // human: 2 on 24, 5 on 13, 3 on 8, 5 on 6
  p[23] = 2; p[12] = 5; p[7] = 3; p[5] = 5;
  // computer: the mirror — 2 on 1, 5 on 12, 3 on 17, 5 on 19
  p[0] = -2; p[11] = -5; p[16] = -3; p[18] = -5;
  return p;
}

export function opponent(p) { return p === HUMAN ? COMPUTER : HUMAN; }
export const DIR = { h: -1, c: 1 };
/** Count of `player`'s checkers on index i (0 when the other side's). */
export function countAt(points, i, player) {
  const v = points[i];
  return player === HUMAN ? Math.max(0, v) : Math.max(0, -v);
}
/** Whose checkers sit on index i: "h", "c" or null. */
export function ownerAt(points, i) {
  return points[i] > 0 ? HUMAN : points[i] < 0 ? COMPUTER : null;
}
export function isHome(i, player) { return player === HUMAN ? i <= 5 : i >= 18; }
function entryIndex(die, player) { return player === HUMAN ? 24 - die : die - 1; }

export function clonePos(pos) {
  return { points: pos.points.slice(), bar: { ...pos.bar }, off: { ...pos.off } };
}
export function posOf(state) { return { points: state.points, bar: state.bar, off: state.off }; }

export function pipCount(pos, player) {
  let pips = pos.bar[player] * 25;
  for (let i = 0; i < 24; i++) {
    const n = countAt(pos.points, i, player);
    if (n) pips += n * (player === HUMAN ? i + 1 : 24 - i);
  }
  return pips;
}

/** All fifteen not yet off are in the home board (none on the bar). */
export function canBearOff(pos, player) {
  if (pos.bar[player] > 0) return false;
  for (let i = 0; i < 24; i++) {
    if (!isHome(i, player) && countAt(pos.points, i, player) > 0) return false;
  }
  return true;
}

// ----------------------------------------------------------------------
// single moves
// ----------------------------------------------------------------------
// A move is { from, to, die, hit }. `from` is an index 0..23 or "bar";
// `to` is an index or "off".

function blocked(points, i, player) {
  return countAt(points, i, opponent(player)) >= 2;
}

/** Every legal single move for `player` with one die from this position. */
export function singleMoves(pos, player, die) {
  const { points, bar } = pos;
  const dir = DIR[player];
  const out = [];
  if (bar[player] > 0) {
    const to = entryIndex(die, player);
    if (!blocked(points, to, player)) {
      out.push({ from: "bar", to, die, hit: countAt(points, to, opponent(player)) === 1 });
    }
    return out;
  }
  const bearing = canBearOff(pos, player);
  for (let i = 0; i < 24; i++) {
    if (countAt(points, i, player) === 0) continue;
    const to = i + dir * die;
    if (to >= 0 && to <= 23) {
      if (!blocked(points, to, player)) {
        out.push({ from: i, to, die, hit: countAt(points, to, opponent(player)) === 1 });
      }
      continue;
    }
    if (!bearing) continue;
    const exact = player === HUMAN ? to === -1 : to === 24;
    if (exact) { out.push({ from: i, to: "off", die, hit: false }); continue; }
    // A higher die may bear off from the highest occupied point only.
    let higher = false;
    if (player === HUMAN) { for (let j = i + 1; j <= 5; j++) if (countAt(points, j, HUMAN) > 0) higher = true; }
    else { for (let j = 18; j < i; j++) if (countAt(points, j, COMPUTER) > 0) higher = true; }
    if (!higher) out.push({ from: i, to: "off", die, hit: false });
  }
  return out;
}

export function applyToPos(pos, move, player) {
  const next = clonePos(pos);
  const sign = player === HUMAN ? 1 : -1;
  if (move.from === "bar") next.bar[player] -= 1;
  else next.points[move.from] -= sign;
  if (move.to === "off") { next.off[player] += 1; return next; }
  if (countAt(next.points, move.to, opponent(player)) === 1) {
    next.points[move.to] = 0;
    next.bar[opponent(player)] += 1;
  }
  next.points[move.to] += sign;
  return next;
}

export function sameMove(a, b) {
  return a.from === b.from && a.to === b.to && a.die === b.die;
}

// ----------------------------------------------------------------------
// legal move sequences for a whole roll
// ----------------------------------------------------------------------
/**
 * Every legal way to play `dice` from `pos`, as arrays of moves in the
 * order they are made. Enforces "play as many dice as you can" and, when
 * only one die can be played, "the higher one if either could be".
 * Doubles come in as two equal dice and play up to four moves. When
 * nothing can be played the answer is [[]] — one empty sequence.
 */
export function legalSequences(pos, player, dice) {
  if (!dice || dice.length === 0) return [[]];
  const [a, b] = dice;
  const orders = a === b ? [[a, a, a, a]] : [[a, b], [b, a]];
  const seqs = [];
  const seen = new Set();
  const dfs = (p, order, k, acc) => {
    const moves = k < order.length ? singleMoves(p, player, order[k]) : [];
    if (moves.length === 0) {
      const key = acc.map((m) => `${m.from}-${m.to}-${m.die}`).join("|");
      if (!seen.has(key)) { seen.add(key); seqs.push(acc.slice()); }
      return;
    }
    for (const m of moves) {
      acc.push(m);
      dfs(applyToPos(p, m, player), order, k + 1, acc);
      acc.pop();
    }
  };
  for (const order of orders) dfs(pos, order, 0, []);
  const max = Math.max(...seqs.map((s) => s.length));
  let best = seqs.filter((s) => s.length === max);
  if (max === 1 && a !== b) {
    const hi = Math.max(a, b);
    const withHigh = best.filter((s) => s[0].die === hi);
    if (withHigh.length) best = withHigh;
  }
  return best;
}

/** The sequences (from the turn's start) that begin with the moves already made. */
export function continuations(state) {
  if (state.phase !== "move" || !state.turnStart) return [];
  const all = legalSequences(state.turnStart, state.turn, state.dice);
  const made = state.turnMoves;
  return all
    .filter((s) => s.length >= made.length && made.every((m, i) => sameMove(s[i], m)))
    .map((s) => s.slice(made.length));
}

/** Legal next single moves right now (deduped). */
export function legalMoves(state) {
  const out = [];
  for (const s of continuations(state)) {
    if (!s.length) continue;
    if (!out.some((m) => sameMove(m, s[0]))) out.push(s[0]);
  }
  return out;
}

/**
 * For the checker on `from` ("bar" or an index): every point it can reach
 * this turn, including by using several dice in a row, each with the run
 * of moves that gets it there. Used for the gold glow on the board.
 */
export function destinationsFrom(state, from) {
  const found = new Map();
  for (const s of continuations(state)) {
    if (!s.length || s[0].from !== from) continue;
    const chain = [s[0]];
    let cur = s[0];
    const consider = () => {
      const key = String(cur.to);
      const prev = found.get(key);
      // Prefer the shortest chain to a point (one die over two).
      if (!prev || chain.length < prev.moves.length) found.set(key, { to: cur.to, moves: chain.slice() });
    };
    consider();
    for (let k = 1; k < s.length; k++) {
      if (s[k].from !== cur.to || cur.to === "off") break;
      cur = s[k];
      chain.push(cur);
      consider();
    }
  }
  return [...found.values()];
}

/**
 * When the checker on `from` can go to exactly one place this turn, that
 * chain of moves; otherwise null. A second tap on such a checker plays it
 * (DESIGN §5.4) instead of putting it down.
 */
export function soleDestination(state, from) {
  const dests = destinationsFrom(state, from);
  return dests.length === 1 ? dests[0].moves : null;
}

/** Points (and "bar") holding a checker the player may move right now. */
export function movableFroms(state) {
  const set = new Set();
  for (const m of legalMoves(state)) set.add(m.from);
  return [...set];
}

// ----------------------------------------------------------------------
// the game state
// ----------------------------------------------------------------------
/**
 * A fresh game. `first` decides who starts: "random" (the opening roll,
 * one die each), "h" (the player rolls first) or "c" (the computer does).
 */
export function newGame({ seed, difficulty = "relaxed", first = "random" } = {}) {
  if (seed === undefined) seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  if (!FIRST.includes(first)) first = "random";
  return {
    seed,
    rng: seed >>> 0,
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : "relaxed",
    first,
    points: startingPoints(),
    bar: { h: 0, c: 0 },
    off: { h: 0, c: 0 },
    turn: first === "random" ? null : first,
    phase: first === "random" ? "opening" : "roll",
    dice: [],
    remaining: [],
    turnMoves: [],
    turnStart: null,
    opening: null,
    winner: null,
    result: null,
    moveCount: 0,
    turnCount: 0,
  };
}

/** Put `player` on the move with `dice` from the state's current position. */
export function beginTurn(state, player, dice) {
  const [a, b] = dice;
  return {
    ...state,
    turn: player,
    phase: "move",
    dice: [a, b],
    remaining: a === b ? [a, a, a, a] : [Math.max(a, b), Math.min(a, b)],
    turnMoves: [],
    turnStart: clonePos(posOf(state)),
    turnCount: state.turnCount + 1,
  };
}

/** The opening roll: one die each. A tie leaves phase "opening" to roll again. */
export function rollOpening(state) {
  if (state.phase !== "opening") throw new Error("not the opening");
  let rng = state.rng;
  let h, c;
  [h, rng] = rollDie(rng);
  [c, rng] = rollDie(rng);
  const base = { ...state, rng, opening: { h, c } };
  if (h === c) return base;
  return beginTurn(base, h > c ? HUMAN : COMPUTER, [h, c]);
}

/** Roll for whoever's turn it is. `forced` (tests, QA) fixes the dice. */
export function rollDice(state, forced) {
  if (state.phase !== "roll") throw new Error("not time to roll");
  let rng = state.rng;
  let a, b;
  if (forced) [a, b] = forced;
  else { [a, rng] = rollDie(rng); [b, rng] = rollDie(rng); }
  return beginTurn({ ...state, rng }, state.turn, [a, b]);
}

/** Play one legal move (must be one of legalMoves(state)). */
export function applyMove(state, move) {
  if (state.phase !== "move") throw new Error("not time to move");
  const legal = legalMoves(state).find((m) => sameMove(m, move));
  if (!legal) throw new Error(`illegal move ${move.from}→${move.to} with ${move.die}`);
  const pos = applyToPos(posOf(state), legal, state.turn);
  const remaining = state.remaining.slice();
  remaining.splice(remaining.indexOf(legal.die), 1);
  let next = {
    ...state,
    points: pos.points, bar: pos.bar, off: pos.off,
    remaining,
    turnMoves: [...state.turnMoves, legal],
    moveCount: state.moveCount + 1,
  };
  if (pos.off[state.turn] === 15) {
    const w = state.turn, l = opponent(w);
    let result = "single";
    if (pos.off[l] === 0) {
      let inWinnersHome = false;
      for (let i = 0; i < 24; i++) if (isHome(i, w) && countAt(pos.points, i, l) > 0) inWinnersHome = true;
      result = pos.bar[l] > 0 || inWinnersHome ? "backgammon" : "gammon";
    }
    next = { ...next, phase: "over", winner: w, result, remaining: [] };
  }
  return next;
}

/** Play a run of moves (a chain from destinationsFrom, or a whole AI turn). */
export function applyMoves(state, moves) {
  let s = state;
  for (const m of moves) { if (s.phase !== "move") break; s = applyMove(s, m); }
  return s;
}

/** Take back the last move of the turn (the turn's start is kept). */
export function undoMove(state) {
  if (state.phase !== "move" || state.turnMoves.length === 0) return state;
  const moves = state.turnMoves.slice(0, -1);
  const [a, b] = state.dice;
  let s = {
    ...state,
    points: state.turnStart.points.slice(), bar: { ...state.turnStart.bar }, off: { ...state.turnStart.off },
    remaining: a === b ? [a, a, a, a] : [Math.max(a, b), Math.min(a, b)],
    turnMoves: [],
    moveCount: state.moveCount - state.turnMoves.length,
  };
  for (const m of moves) s = applyMove(s, m);
  return s;
}

/** True when nothing more can be played this turn. */
export function turnComplete(state) {
  return state.phase === "move" && legalMoves(state).length === 0;
}

/** Hand the roll to the other side. */
export function endTurn(state) {
  if (state.phase !== "move") throw new Error("no turn to end");
  return { ...state, turn: opponent(state.turn), phase: "roll", dice: [], remaining: [], turnMoves: [], turnStart: null };
}

/** Dice not yet played this turn, as a display list (four for doubles). */
export function diceDisplay(state) {
  const [a, b] = state.dice;
  if (a === undefined) return [];
  const faces = a === b ? [a, a, a, a] : [a, b];
  const left = state.remaining.slice();
  return faces.map((f) => {
    const k = left.indexOf(f);
    if (k >= 0) { left.splice(k, 1); return { face: f, used: false }; }
    return { face: f, used: true };
  });
}

/** A save blob that came back from storage is a plausible game state. */
export function isValidState(s) {
  if (!s || typeof s !== "object") return false;
  if (!Array.isArray(s.points) || s.points.length !== 24 || !s.points.every(Number.isInteger)) return false;
  if (!s.bar || !s.off) return false;
  const n = (v) => Number.isInteger(v) && v >= 0 && v <= 15;
  if (!n(s.bar.h) || !n(s.bar.c) || !n(s.off.h) || !n(s.off.c)) return false;
  let h = s.bar.h + s.off.h, c = s.bar.c + s.off.c;
  for (const v of s.points) { if (v > 0) h += v; else c -= v; }
  if (h !== 15 || c !== 15) return false;
  if (!["opening", "roll", "move", "over"].includes(s.phase)) return false;
  if (s.phase !== "opening" && s.turn !== HUMAN && s.turn !== COMPUTER) return false;
  if (!Array.isArray(s.dice) || !Array.isArray(s.remaining) || !Array.isArray(s.turnMoves)) return false;
  if (s.phase === "move" && (!s.turnStart || !Array.isArray(s.turnStart.points))) return false;
  if (!Number.isInteger(s.rng)) return false;
  return true;
}

// ----------------------------------------------------------------------
// a turn in outline — for the status line (words are main.js's job)
// ----------------------------------------------------------------------
/**
 * What a run of moves did, as data: which checkers came in from the bar,
 * which moved (chains of the same checker collapsed: 24→20→18), which
 * were borne off, how many hits, how many points newly made. Locations
 * are indices, "bar" or "off"; `before` is the position at the turn's
 * start, `after` the position now.
 */
export function summarizeMoves(moves, before, after, player) {
  const groups = [];
  for (const m of moves) {
    const g = groups[groups.length - 1];
    if (g && g.to === m.from && m.from !== "bar") { g.to = m.to; g.stops.push(m.to); }
    else groups.push({ from: m.from, to: m.to, stops: [m.to] });
  }
  const entered = [], moved = [], off = [];
  for (const g of groups) {
    if (g.from === "bar") entered.push(g.stops);
    else if (g.stops.length === 1 && g.to === "off") off.push(g.from);
    else moved.push([g.from, ...g.stops]);
  }
  const made = new Set();
  for (const g of groups) {
    if (g.to === "off") continue;
    if (countAt(before.points, g.to, player) < 2 && countAt(after.points, g.to, player) >= 2) made.add(g.to);
  }
  return { entered, moved, off, hits: moves.filter((m) => m.hit).length, made: made.size, empty: moves.length === 0 };
}
