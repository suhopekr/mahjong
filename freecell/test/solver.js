// test/solver.js — a small best-first FreeCell solver, dev-only. It plays
// the game purely through the engine's own canMove/applyMove, so a
// solution it finds is a scripted proof that the rules let a deal be won
// and that autoplay / isWon agree with them. Not shipped.
import { applyMove, cardsAt, canMove, isWon, topRunLength, safeAutoplayStep, RED } from "../src/game/freecell.js";

function key(state) {
  const casc = state.cascades.map((p) => p.map((c) => c.id).join(",")).sort().join("|");
  const cells = state.cells.map((c) => (c ? c.id : "-")).sort().join(",");
  const f = state.foundations.map((p) => p.length).join(",");
  return casc + "#" + cells + "#" + f;
}

function foundationRank(state, suit) {
  const p = state.foundations.find((x) => x.length && x[0].suit === suit);
  return p ? p.length : 0;
}

/** Lower is better. Cards left, plus how deeply the next needed cards are buried. */
function score(state) {
  let left = 52;
  for (const p of state.foundations) left -= p.length;
  let buried = 0;
  for (const p of state.cascades) {
    for (let k = 0; k < p.length; k++) {
      const c = p[k];
      if (c.rank === foundationRank(state, c.suit) + 1) buried += (p.length - 1 - k) * (c.rank <= 4 ? 2 : 1);
    }
  }
  const cellsUsed = state.cells.filter(Boolean).length;
  const emptyCols = state.cascades.filter((p) => !p.length).length;
  let unsorted = 0;
  for (const p of state.cascades) unsorted += p.length - topRunLength(p);
  return left * 8 + buried * 2 + cellsUsed * 3 - emptyCols * 4 + unsorted;
}

function moves(state) {
  const out = [];
  const emptyCol = state.cascades.findIndex((p) => !p.length);
  const emptyCell = state.cells.findIndex((c) => !c);
  const froms = [];
  state.cells.forEach((c, i) => { if (c) froms.push({ pile: "cell", index: i }); });
  state.cascades.forEach((p, i) => {
    const n = topRunLength(p);
    for (let start = p.length - n; start < p.length; start++) froms.push({ pile: "cascade", index: i, card: start });
  });
  for (const from of froms) {
    const cards = cardsAt(state, from);
    if (!cards.length) continue;
    for (let f = 0; f < 4; f++) if (canMove(state, from, { pile: "foundation", index: f })) out.push({ from, to: { pile: "foundation", index: f } });
    for (let i = 0; i < 8; i++) {
      if (!state.cascades[i].length && i !== emptyCol) continue;
      if (!state.cascades[i].length && from.pile === "cascade" && from.card === 0) continue;
      if (canMove(state, from, { pile: "cascade", index: i })) out.push({ from, to: { pile: "cascade", index: i } });
    }
    if (emptyCell >= 0 && from.pile !== "cell" && canMove(state, from, { pile: "cell", index: emptyCell })) out.push({ from, to: { pile: "cell", index: emptyCell } });
  }
  return out;
}

/** Best-first search. Returns the list of { from, to } moves or null. */
export function solve(start, { maxNodes = 60000 } = {}) {
  const seen = new Set([key(start)]);
  const open = [{ state: start, path: [], s: score(start) }];
  let nodes = 0;
  while (open.length && nodes < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].s < open[bi].s) bi = i;
    const cur = open.splice(bi, 1)[0];
    nodes++;
    if (isWon(cur.state)) return cur.path;
    for (const m of moves(cur.state)) {
      let next = applyMove(cur.state, m.from, m.to);
      if (!next) continue;
      const path = cur.path.concat([m]);
      // Safe cards go home on their own in the game; do the same here so
      // the search space stays small.
      let step;
      while ((step = safeAutoplayStep(next))) { next = applyMove(next, step.from, step.to); path.push(step); }
      const k = key(next);
      if (seen.has(k)) continue;
      seen.add(k);
      open.push({ state: next, path, s: score(next) + path.length * 0.05 });
    }
    if (open.length > 20000) { open.sort((a, b) => a.s - b.s); open.length = 10000; }
  }
  return null;
}

export { RED };
