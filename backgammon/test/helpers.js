// test/helpers.js — position builders shared by the rules and AI suites.
import * as G from "../src/game/backgammon.js";

export const START = { 23: 2, 12: 5, 7: 3, 5: 5, 0: -2, 11: -5, 16: -3, 18: -5 };

/** A bare position: points from a {index: signedCount} map. */
export function pos({ points = {}, bar = { h: 0, c: 0 }, off = { h: 0, c: 0 } } = {}) {
  const p = new Array(24).fill(0);
  for (const [k, v] of Object.entries(points)) p[Number(k)] = v;
  return { points: p, bar: { ...bar }, off: { ...off } };
}
/** A state in the middle of a turn for `player` with `dice` from `position`. */
export function midTurn(position, player, dice, extra = {}) {
  const s = { ...G.newGame({ seed: 1 }), ...position, ...extra };
  return G.beginTurn(s, player, dice);
}
export const sig = (s) => s.map((m) => `${m.from}>${m.to}/${m.die}`).join(" ");
export const sigs = (seqs) => seqs.map(sig).sort();
