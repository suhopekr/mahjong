// src/game/scoreboard.js
// The bead counter every Korean billiard hall has on the wall: a wooden
// rack, a steel rod, and discs you push across as you score.
//
// IT COUNTS DOWN, NOT UP. This is the part that matters and the part a
// scoreboard built from a progress bar gets backwards. Your handicap is
// set out on the LEFT at the start of the game, and every point you make
// pushes one bead across to the right. You are not filling anything; you
// are clearing the rod, and the game ends when your side of it is empty.
//
// It also runs backwards when you deserve it. Miss everything, or hit the
// opponent's ball, and a bead comes back — but never past the handicap
// you started with. A rod that keeps growing makes a bad run unwinnable,
// and a game that gets further away the longer you play is not a game.
//
// It replaces a number, and that is the argument for it. "7 points" is
// read; four beads still waiting on the left is SEEN, from across the
// table, without looking away from the shot. It says what the number
// could not: how much is left.
//
// DOM rather than canvas. The beads sit in the header, which the grid
// lays out, and a canvas there would need its own resize handling to stay
// aligned with the type beside it.
const NS = "scoreboard";

/**
 * @param {HTMLElement} host
 * @param {{label?:string, target:number, tone?:"player"|"opponent"}} spec
 */
export function createRow(host, spec) {
  const row = document.createElement("div");
  row.className = `${NS}-row${spec.tone === "opponent" ? " opponent" : ""}`;
  // The rod and its beads live in their own box so the count can sit
  // BESIDE the rack rather than on top of the rod.
  const track = document.createElement("div");
  track.className = `${NS}-track`;
  const rod = document.createElement("div");
  rod.className = `${NS}-rod`;
  const left = document.createElement("div");
  left.className = `${NS}-side`;
  const gap = document.createElement("div");
  gap.className = `${NS}-gap`;
  const right = document.createElement("div");
  right.className = `${NS}-side done`;
  const count = document.createElement("span");
  count.className = `${NS}-count`;
  track.append(rod, left, gap, right);
  row.append(track, count);
  row.setAttribute("role", "img");
  host.appendChild(row);
  const state = { row, left, right, count, target: spec.target, beads: [], label: spec.label || "" };
  grow(state, spec.target);
  setRemaining(state, spec.target);
  return state;
}

/** Beads are made once and then moved between the two groups. */
function grow(state, count) {
  while (state.beads.length < count) {
    const b = document.createElement("i");
    // Banded in tens, which is how a rack is read rather than counted:
    // a full band plus three is seen, thirteen beads in a row is not.
    const band = Math.floor(state.beads.length / 10) % 2 === 1 ? " ten" : "";
    b.className = `${NS}-bead${band}`;
    state.beads.push(b);
  }
}

/**
 * @param {number} remaining  beads still to be cleared, 0 .. target. A
 *   foul at a full rack has nothing to push back and moves nothing.
 */
export function setRemaining(state, remaining) {
  const total = state.target;
  const left = Math.min(total, Math.max(0, Math.round(remaining)));
  grow(state, total);
  state.left.replaceChildren(...state.beads.slice(0, left));
  state.right.replaceChildren(...state.beads.slice(left, total));
  for (let i = 0; i < total; i++) state.beads[i].classList.toggle("done", i >= left);
  // The count beside the rack. The beads say how much is left at a
  // glance; the number is for the player who wants to be sure.
  state.count.textContent = String(left);
  state.row.setAttribute("aria-label", `${state.label} ${left} to go`.trim());
}

export function destroy(state) {
  state.row.remove();
}
