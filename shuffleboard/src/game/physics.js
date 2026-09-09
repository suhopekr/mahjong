// game/physics.js
// Table shuffleboard: equal-mass discs ("weights") sliding on a long
// waxed board with Coulomb friction, colliding with each other, and
// falling into the gutter when they leave the playing surface at the
// sides or the far end.
//
// This is StoneFlick's model — a point mass under constant deceleration,
// closed-form equal-mass impulse on contact — and not Four Ball's,
// because a weight SLIDES. It has no rolling state, no spin that turns
// into speed later, no cushion to leave it rotating. Everything
// interesting about a shuffleboard shot is where it stops and what it
// pushed on the way, and a point mass says both exactly.
//
// UNITS ARE SI (metres, seconds), like Four Ball and unlike StoneFlick.
// The friction number below is what a waxed maple board actually does to
// a weight, and the board and weight sizes are real ones, so the range
// of a full shot and the size of the scoring zones come out in the
// proportions a player who has stood at a real table expects.
// game/layout.js is the only place metres become pixels.
//
// COORDINATES: x runs along the board, 0 at the shooting end and
// BOARD_LENGTH at the scoring end. y runs across it, 0..BOARD_WIDTH.
// Nothing here knows which way is up on a screen.
//
// DETERMINISM: stepWorld() takes a dt and cuts it into fixed substeps,
// so a headless run in Node and a requestAnimationFrame run in a browser
// land every weight on the same square. game/ai.js plans by simulating,
// and the AI's prediction and the player's picture must not disagree.

/** Playing surface, metres. A short bar table; real ones run 9–22 ft.
 * Chosen with the phone in mind: the board is drawn whole, so its aspect
 * (4.7:1) is what decides how wide a weight can be drawn on a 390px
 * screen. Width and weight diameter are the real ones, so 8.5 weights
 * fit across, as on any regulation board. */
export const BOARD_LENGTH = 2.4;
export const BOARD_WIDTH = 0.508;

/** Weight radius, metres. Regulation "medium" weights are 2 5/16 in
 * across; 30 mm is that, rounded. */
export const PUCK_RADIUS = 0.0295;

/** Distances from the SCORING end, metres. A weight lying with its whole
 * body past a line is in that zone; a weight touching a line counts the
 * lower zone — the rule every bar plays by, and the one that makes the
 * 3 so hard to hold. */
export const ZONE_3_DEPTH = 0.15;
export const ZONE_2_DEPTH = 0.36;
/** The foul line. A weight that does not clear it entirely is dead and
 * comes off the board once everything stops. About 40% of the board,
 * the proportion of a short table. */
export const FOUL_DEPTH = 0.95;
export const FOUL_X = BOARD_LENGTH - FOUL_DEPTH;

/** Where a weight is set down to be shot: its centre, from the shooting
 * end. Real players shoot from the end apron; this leaves a hand's
 * width behind the weight. */
export const START_X = 0.12;

/** Coulomb friction: constant deceleration, m/s², opposite the velocity
 * regardless of speed. Constant (not proportional) deceleration is what
 * makes a weight stop crisply instead of creeping to a halt; the creep
 * is what exponential damping produces and it reads as a greasy board.
 * 0.5 with MAX_SPEED below puts a full-strength shot at ~1.1 board
 * lengths, so overshooting the end is always possible and never
 * necessary. */
export const FRICTION_DECEL = 0.5;

/** Below this a weight is snapped to rest, so "everything stopped" is a
 * state the turn loop reaches in finite time. */
export const STOP_SPEED = 0.006;

/** Fastest a weight can be sent, m/s. Range = v²/2a = 2.72 m against a
 * 2.4 m board. */
export const MAX_SPEED = 1.65;

/** Weight-on-weight restitution. Metal weights under plastic caps: hard,
 * but not go-stone hard. */
export const RESTITUTION = 0.86;

/** Fixed substep. At MAX_SPEED a weight moves 0.7 mm per substep — less
 * than 3% of a radius — so nothing can tunnel through anything. */
export const SUB_DT = 1 / 240;

/** Where a weight can be shot from, across the board. */
export const MIN_START_Y = PUCK_RADIUS * 1.2;
export const MAX_START_Y = BOARD_WIDTH - PUCK_RADIUS * 1.2;

/** How far off dead ahead a shot may be aimed, radians. A real player
 * has the whole apron but the board is narrow; ±14° reaches either
 * gutter from the middle well before the foul line. */
export const MAX_AIM_ANGLE = (14 * Math.PI) / 180;

/**
 * A weight.
 * @typedef {object} Puck
 * @property {number} id       unique within a world
 * @property {0|1} owner       player index
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {boolean} off     fell into the gutter — no longer on the board
 * @property {boolean} foul    stopped short of the foul line — removed at rest
 */

/** @typedef {{ pucks: Puck[], nextId: number, events: object[] }} World */

export function createWorld() {
  return { pucks: [], nextId: 1, events: [] };
}

/** Deep copy — the AI simulates on copies, never on the live world. */
export function cloneWorld(world) {
  return {
    pucks: world.pucks.map((p) => ({ ...p })),
    nextId: world.nextId,
    events: [],
  };
}

/** Weights still in play (on the board, not fouled). */
export function livePucks(world) {
  return world.pucks.filter((p) => !p.off && !p.foul);
}

/**
 * Put a weight on the board at the shooting end and send it.
 * @param {World} world
 * @param {0|1} owner
 * @param {number} y      lateral position of the weight's centre
 * @param {number} angle  radians off dead ahead; positive toward +y
 * @param {number} power  0..1 of MAX_SPEED
 */
export function shoot(world, owner, y, angle, power) {
  const yy = clamp(y, MIN_START_Y, MAX_START_Y);
  const a = clamp(angle, -MAX_AIM_ANGLE, MAX_AIM_ANGLE);
  const v = clamp(power, 0, 1) * MAX_SPEED;
  const puck = {
    id: world.nextId++,
    owner,
    x: START_X,
    y: yy,
    vx: Math.cos(a) * v,
    vy: Math.sin(a) * v,
    off: false,
    foul: false,
  };
  world.pucks.push(puck);
  return puck;
}

export function isAtRest(world) {
  for (const p of world.pucks) {
    if (p.off || p.foul) continue;
    if (p.vx !== 0 || p.vy !== 0) return false;
  }
  return true;
}

/**
 * Advance the world by dt seconds in fixed substeps. Appends to
 * world.events: { type: "hit", a, b, speed } for weight contacts and
 * { type: "off", id, owner, where: "side"|"end" } when one leaves.
 */
export function stepWorld(world, dt) {
  let remaining = dt;
  while (remaining > 1e-9) {
    const h = Math.min(SUB_DT, remaining);
    substep(world, h);
    remaining -= h;
  }
}

function substep(world, h) {
  const pucks = world.pucks;
  // Integrate.
  for (const p of pucks) {
    if (p.off || p.foul) continue;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed === 0) continue;
    const drop = FRICTION_DECEL * h;
    if (speed <= drop || speed - drop < STOP_SPEED) {
      p.vx = 0;
      p.vy = 0;
      continue;
    }
    const k = (speed - drop) / speed;
    p.vx *= k;
    p.vy *= k;
    p.x += p.vx * h;
    p.y += p.vy * h;
  }
  // Contacts. Two passes so a weight pushed into a third gets resolved
  // against it in the same substep; at these speeds that is plenty.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < pucks.length; i++) {
      const a = pucks[i];
      if (a.off || a.foul) continue;
      for (let j = i + 1; j < pucks.length; j++) {
        const b = pucks[j];
        if (b.off || b.foul) continue;
        resolveContact(world, a, b, pass === 0);
      }
    }
  }
  // Gutter. A weight whose centre crosses the edge tips in.
  for (const p of pucks) {
    if (p.off || p.foul) continue;
    let where = null;
    if (p.x > BOARD_LENGTH) where = "end";
    else if (p.y < 0 || p.y > BOARD_WIDTH) where = "side";
    else if (p.x < 0) where = "back";
    if (where) {
      p.off = true;
      p.vx = 0;
      p.vy = 0;
      world.events.push({ type: "off", id: p.id, owner: p.owner, where });
    }
  }
}

function resolveContact(world, a, b, emit) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = PUCK_RADIUS * 2;
  if (dist >= minDist || dist === 0) return;
  const nx = dx / dist;
  const ny = dy / dist;
  // Separate first, half each, so resting weights never sink into one
  // another over many substeps.
  const overlap = minDist - dist;
  a.x -= (nx * overlap) / 2;
  a.y -= (ny * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.y += (ny * overlap) / 2;
  // Relative velocity along the normal; only resolve if closing.
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return;
  // Equal masses: impulse magnitude j = -(1+e)·vn / 2 per body.
  const j = (-(1 + RESTITUTION) * vn) / 2;
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;
  if (emit) world.events.push({ type: "hit", a: a.id, b: b.id, speed: -vn });
}

/**
 * Run until everything stops (or maxSeconds). Returns seconds elapsed.
 * The AI and the tests use this; the browser steps frame by frame.
 */
export function simulateToRest(world, maxSeconds = 12) {
  let t = 0;
  while (!isAtRest(world) && t < maxSeconds) {
    stepWorld(world, SUB_DT);
    t += SUB_DT;
  }
  return t;
}

/**
 * Once the board is still, weights that never cleared the foul line are
 * dead. Marks them and returns them. The turn loop calls this after
 * every shot; rules.js never sees a fouled weight.
 */
export function removeFouls(world) {
  const removed = [];
  for (const p of world.pucks) {
    if (p.off || p.foul) continue;
    if (p.x - PUCK_RADIUS < FOUL_X) {
      p.foul = true;
      p.vx = 0;
      p.vy = 0;
      removed.push(p);
    }
  }
  return removed;
}

/**
 * The stopping distance of a shot at `power`, metres from START_X, with
 * nothing in the way. Closed form: v²/2a. The layout draws the power
 * meter against this, so the meter's marks can be board zones rather
 * than percentages.
 */
export function rangeFor(power) {
  const v = clamp(power, 0, 1) * MAX_SPEED;
  return (v * v) / (2 * FRICTION_DECEL);
}

/** The power that stops a weight `distance` metres past START_X. Inverse
 * of rangeFor; the AI aims with it. */
export function powerFor(distance) {
  const v = Math.sqrt(Math.max(0, 2 * FRICTION_DECEL * distance));
  return clamp(v / MAX_SPEED, 0, 1);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
