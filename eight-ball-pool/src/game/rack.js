// game/rack.js
// The fifteen balls, the triangle they start in, and the spots on the
// cloth. Pure geometry, no DOM, deterministic (makeRng) so a rack can be
// reproduced from its seed.

import { TABLE_LENGTH, TABLE_WIDTH, BALL_RADIUS, createWorld, getBall } from "./physics.js";

/** mulberry32 — the site's deterministic RNG (klondike.js uses the same). */
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

/** Ball colours by number: 1/9 yellow, 2/10 blue, 3/11 red, 4/12 purple,
 * 5/13 orange, 6/14 green, 7/15 maroon, 8 black. Deliberately a little
 * brighter than a real set — they are read at 18px on green cloth. */
export const BALL_COLORS = {
  1: "#f2c530",
  2: "#1f5fd0",
  3: "#d9302a",
  4: "#7a3fb8",
  5: "#f07b23",
  6: "#1f8f4a",
  7: "#8c2a2a",
  8: "#141414",
};

export const SOLIDS = ["1", "2", "3", "4", "5", "6", "7"];
export const STRIPES = ["9", "10", "11", "12", "13", "14", "15"];
export const EIGHT = "8";
export const CUE = "cue";

export function isSolid(id) {
  return SOLIDS.includes(id);
}
export function isStripe(id) {
  return STRIPES.includes(id);
}
/** "solid" | "stripe" | "eight" | "cue" */
export function groupOf(id) {
  if (id === CUE) return "cue";
  if (id === EIGHT) return "eight";
  return isSolid(id) ? "solid" : "stripe";
}
export function ballsOfGroup(group) {
  return group === "solid" ? SOLIDS : group === "stripe" ? STRIPES : [];
}
export function colorOf(id) {
  if (id === CUE) return "#f7f4ec";
  const n = Number(id);
  return BALL_COLORS[n > 8 ? n - 8 : n];
}

/** The head spot (where the cue ball breaks from) and the foot spot (the
 * apex of the rack). The head string is the line at a quarter length;
 * everything behind it is "the kitchen". */
/** The break spot sits BEHIND the head string, not on it. On a real table
 * the head spot is on the line and "behind the head string" includes it,
 * but drawn on a screen a white ball sitting exactly on the line that the
 * status text calls "behind the line" reads as a contradiction — so it
 * starts a comfortable ball's width inside the kitchen. */
export const HEAD_SPOT = { x: TABLE_LENGTH * 0.17, y: TABLE_WIDTH / 2 };
export const FOOT_SPOT = { x: (TABLE_LENGTH * 3) / 4, y: TABLE_WIDTH / 2 };
export const HEAD_STRING = TABLE_LENGTH / 4;

/**
 * The triangle: apex on the foot spot, rows toward the foot rail, the 8
 * in the middle of the third row, one solid and one stripe on the two back
 * corners, the rest shuffled. That is the WPA rack, and the one fixed
 * thing every player checks before they break.
 *
 * Balls are placed a hair apart (GAP) so the physics never starts from an
 * overlap: the swept solver resolves a touching pair at t = 0 and a pair
 * that overlaps gets nudged, and a nudge on the first substep of a break
 * is a rack that jumps before the cue ball arrives.
 */
const GAP = 0.0003;

export function rackPositions(seed = 1) {
  const rng = makeRng(seed);
  const R = BALL_RADIUS;
  const pitch = 2 * R + GAP;
  const rowStep = pitch * Math.sqrt(3) / 2;
  // Slot order: row by row from the apex.
  const slots = [];
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      slots.push({
        row,
        k,
        x: FOOT_SPOT.x + row * rowStep,
        y: FOOT_SPOT.y + (k - row / 2) * pitch,
      });
    }
  }
  // Fixed seats: 8 in the middle of row 3 (slot index 4 = row 2, k 1);
  // back corners are slots 10 (row 4, k 0) and 14 (row 4, k 4).
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const solids = shuffle(SOLIDS);
  const stripes = shuffle(STRIPES);
  const cornerSolid = solids.pop();
  const cornerStripe = stripes.pop();
  const rest = shuffle(solids.concat(stripes));
  const ids = new Array(15);
  ids[4] = EIGHT;
  if (rng() < 0.5) {
    ids[10] = cornerSolid;
    ids[14] = cornerStripe;
  } else {
    ids[10] = cornerStripe;
    ids[14] = cornerSolid;
  }
  let r = 0;
  for (let i = 0; i < 15; i++) if (!ids[i]) ids[i] = rest[r++];
  return slots.map((s, i) => ({ id: ids[i], x: s.x, y: s.y, color: colorOf(ids[i]) }));
}

/** A fresh table: fifteen racked balls plus the cue on the head spot. */
export function newRackWorld(seed = 1) {
  return createWorld({
    balls: [{ id: CUE, x: HEAD_SPOT.x, y: HEAD_SPOT.y, color: colorOf(CUE) }].concat(rackPositions(seed)),
  });
}

/** Is a cue-ball position legal for ball in hand: fully on the cloth, not
 * overlapping any other ball on the table, and inside the kitchen when
 * that is required (after a scratch on the break). */
export function isValidPlacement(world, x, y, { kitchen = false, ignoreId = CUE } = {}) {
  const R = BALL_RADIUS;
  if (x < R || x > world.length - R || y < R || y > world.width - R) return false;
  if (kitchen && x > HEAD_STRING) return false;
  for (const b of world.balls) {
    if (b.pocketed || b.id === ignoreId) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < 2 * R + 1e-6) return false;
  }
  return true;
}

/** Nearest legal position to (x, y): the requested point when it is
 * fine, otherwise the closest point a short spiral search finds. */
export function nearestPlacement(world, x, y, opts = {}) {
  if (isValidPlacement(world, x, y, opts)) return { x, y };
  const R = BALL_RADIUS;
  for (let ring = 1; ring <= 40; ring++) {
    const rad = ring * R * 0.25;
    const n = 8 + ring * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (isValidPlacement(world, px, py, opts)) return { x: px, y: py };
    }
  }
  return null;
}

/** Put a ball back on the table on the foot spot — or, if that is taken,
 * the nearest free point along the long string toward the foot rail, then
 * toward the head. (The 8 made on the break is re-spotted this way.) */
export function spotBall(world, id) {
  const b = getBall(world, id);
  if (!b) return false;
  const R = BALL_RADIUS;
  const tryAt = (x, y) => {
    if (isValidPlacement(world, x, y, { ignoreId: id })) {
      b.x = x;
      b.y = y;
      b.pocketed = false;
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      return true;
    }
    return false;
  };
  if (tryAt(FOOT_SPOT.x, FOOT_SPOT.y)) return true;
  for (let d = R * 0.5; FOOT_SPOT.x + d <= world.length - R; d += R * 0.5) {
    if (tryAt(FOOT_SPOT.x + d, FOOT_SPOT.y)) return true;
  }
  for (let d = R * 0.5; FOOT_SPOT.x - d >= R; d += R * 0.5) {
    if (tryAt(FOOT_SPOT.x - d, FOOT_SPOT.y)) return true;
  }
  return false;
}

/** The ids still on the table, by group. */
export function remaining(world, group) {
  return ballsOfGroup(group).filter((id) => {
    const b = getBall(world, id);
    return b && !b.pocketed;
  });
}
