// game/physics.js
// 2D disc physics for alkkagi (알까기): equal-mass circular stones sliding
// on a flat board with Coulomb friction, bouncing off each other and off
// static obstacles, and falling off the board edge or into holes.
//
// WHY THIS IS HAND-WRITTEN AND NOT A LIBRARY
// The series' hard constraint is zero runtime dependencies (CLAUDE.md
// section 2, inherited from Dots and Boxes and Gomoku). A general 2D
// engine (matter.js ~90KB min) would blow the build-size budget on its
// own, and alkkagi needs exactly one collision shape pair (circle/circle)
// plus circle/AABB — the standard closed-form equal-mass elastic impulse,
// not a solver. A web search for an existing JS/Canvas alkkagi to start
// from found only Unity/C# projects with no stated license, so nothing
// was adapted; the equations below are the textbook ones.
//
// UNITS: everything here is in BOARD UNITS, where the playable board is
// the square [0,1] x [0,1]. Nothing in this file knows about pixels,
// canvas, or devicePixelRatio — game/layout.js maps board units to CSS
// px at draw time. That is what makes this module pure and Node-testable
// (CLAUDE.md section 5's rule), and it also means physics behaves
// IDENTICALLY on a 320px phone and a 900px desktop, which a pixel-space
// implementation would not (friction and restitution tuned at one size
// would feel wrong at another).
//
// DETERMINISM: stepWorld() takes an explicit dt and internally splits it
// into fixed substeps, so a headless simulate() run in Node and a
// requestAnimationFrame-driven run in the browser produce the same
// outcome for the same flick. The AI depends on this — it plans by
// actually simulating candidate flicks (game/ai.js), so "what the AI
// predicted" and "what the player sees" must not diverge.

/**
 * How fast the whole simulation plays, as a multiple of how it was tuned.
 *
 * This is a pure TIME rescale, not a retune. Scale every speed by k,
 * every acceleration by k^2 and the substep by 1/k, and each substep
 * advances a stone exactly as far as it did before: the same shot draws
 * the same path through the same collisions and ends on the same square,
 * it just gets there in 1/k of the time. So every stage's par, every
 * balance measurement and every AI plan survive this constant unchanged —
 * test/physics.test.js pins that invariance rather than trusting the
 * argument.
 *
 * 1.25 because at 1.0 the stones read as heavy: a full-strength shot took
 * 2.3s to come to rest, which is a long time to watch a disc slide.
 *
 * The substep shrinks with it, so this costs 25% more physics steps per
 * second (240 -> 300). That is the price of the invariance: keeping
 * SUB_DT fixed would coarsen collision detection at the new speeds and
 * the paths would quietly drift.
 */
export const TIME_SCALE = 1.25;

/** Fixed integration substep, seconds. Small enough that a stone moving
 * at MAX_FLICK_SPEED travels well under its own radius per substep, so a
 * fast stone can never tunnel through another one. */
export const SUB_DT = 1 / (240 * TIME_SCALE);

/** Coulomb friction: constant deceleration in board-units/s^2, applied
 * opposite the velocity vector regardless of speed (that is what makes a
 * sliding stone stop crisply instead of asymptotically creeping, which
 * exponential damping does and which reads as "the board is greasy").
 *
 * Raised from 0.62 together with MAX_FLICK_SPEED below after the first
 * real balance run (test/balance.mjs). Those two numbers only matter
 * through the quantity they define together — the distance a
 * full-strength shot travels, v^2 / 2a — and at 0.62 / 1.8 that was 2.6
 * BOARD WIDTHS. Any contact at all therefore sent the target clean off
 * the board, so every stage was a one-or-two-shot affair and power
 * control never mattered. 0.72 / 1.65 puts it at 1.9 board widths: still
 * enough to cross the board and knock something off, no longer enough
 * that a graze does it by accident. Measured effect on the campaign:
 * average shots to clear roughly doubled on the later stages, and the
 * spread between a casual and an expert player widened on nine of the
 * twelve. */
export const FRICTION_DECEL = 0.72 * TIME_SCALE * TIME_SCALE;

/** Below this speed a stone is snapped to a full stop, so "all stones at
 * rest" is a state the turn loop can actually reach in finite time. */
export const STOP_SPEED = 0.004 * TIME_SCALE;

/** Stone-vs-stone restitution. Real go stones are hard and lively; 0.94
 * keeps the satisfying transfer of momentum ("일타이피" is only possible
 * because the struck stone keeps almost all of what it was given). */
export const STONE_RESTITUTION = 0.94;

/** Static obstacles absorb more than a stone does — a peg is felt as an
 * unlucky deflection, not a trampoline. */
export const PEG_RESTITUTION = 0.72;
export const WALL_RESTITUTION = 0.62;

/** Speed cap for a flick, board-units/s. Together with FRICTION_DECEL
 * this sets the range of a full-strength shot to ~1.9 board widths — see
 * that constant's comment for why the pair was retuned and what it did
 * to the campaign. Change one of these two and you have changed the
 * whole game's balance; re-run `npm run balance` before believing
 * otherwise. */
export const MAX_FLICK_SPEED = 1.65 * TIME_SCALE;

/**
 * A bumper is the one thing on this board that ADDS energy: restitution
 * above 1, so a stone leaves faster than it arrived.
 *
 * That breaks the property everything else here quietly relies on. With
 * every restitution below 1 the world's total energy only ever falls, so
 * a turn is guaranteed to end. A bumper removes that guarantee, and a
 * stone caught between two of them would accelerate without limit.
 * BUMPER_MAX_SPEED is what puts the guarantee back: a bumper may raise a
 * stone's speed but never past the cap, and friction still bleeds it away
 * between bounces, so the world still comes to rest.
 *
 * The cap is MAX_FLICK_SPEED rather than some larger number on purpose.
 * It gives the bumper a rule a player can hold in their head: a bumper
 * can give you power you did not have, but never more power than your own
 * best shot.
 */
export const BUMPER_RESTITUTION = 1.55;
export const BUMPER_MAX_SPEED = 1.65 * TIME_SCALE;

/**
 * How many times one stone may be boosted by bumpers within a single
 * shot. After that a bumper is just a peg to it.
 *
 * This is the part that actually guarantees the turn ends, and the speed
 * cap alone is NOT enough — a fact this project learned from its own test
 * rather than from reasoning. Capping speed bounds a stone but does not
 * stop it: put two bumpers 0.15 apart and a stone settles into a perfect
 * limit cycle, arriving at 1.58, leaving at the 1.65 cap, arriving at
 * 1.58 again, forever. Friction removes a fixed amount per unit
 * DISTANCE, so for any restitution above 1 there is always a gap short
 * enough that the bumper puts back more than the board takes away.
 *
 * A budget fixes it by construction: once it is spent every restitution
 * in the world is below 1 again, total energy strictly decreases, and the
 * world provably comes to rest. It is also a rule a player can see
 * working — a stone rattling around a bumper nest eventually settles
 * instead of buzzing until the turn times out.
 */
export const BUMPER_BOOST_BUDGET = 3;

/** Stone radius in board units. A real go stone is very slightly smaller
 * than the 19-line goban's own 1/18 ~= 0.0556 spacing, which would put
 * this near 0.027 — and that is what it was until the first real mobile
 * screenshot, where a stone came out about 9px across on a 390px-wide
 * phone. That is smaller than a fingertip, and this game asks the player
 * to grab a specific stone and drag from it, which is a much harder
 * target than tapping an intersection was in the previous game. 0.034
 * makes the stone slightly larger than the grid spacing — visibly a game
 * piece rather than a scale model — and every stage layout still has
 * room to spare (test/stages.test.js checks the clearances). */
export const STONE_RADIUS = 0.034;

/** A turn can never run longer than this many simulated seconds. Not a
 * safety net for a bug — a genuinely possible state: two stones can
 * settle into a slow mutual nudge, and holding the turn hostage to it
 * would look like a freeze.
 *
 * Divided by TIME_SCALE so it stays the same amount of MOTION rather than
 * the same amount of clock: a faster world would otherwise get a quietly
 * more generous budget, and a shot that used to be cut off would now be
 * allowed to finish. That is exactly the kind of drift TIME_SCALE is
 * supposed not to have. */
export const MAX_TURN_SECONDS = 9 / TIME_SCALE;

/**
 * @typedef {Object} Stone
 * @property {number} id - stable across a turn; how events refer to stones
 * @property {0|1} player
 * @property {number} x - board units
 * @property {number} y
 * @property {number} vx - board units per second
 * @property {number} vy
 * @property {number} radius
 * @property {boolean} alive - false once it has left the board or sunk
 */

/**
 * @typedef {{type:"peg", x:number, y:number, radius:number}
 *   | {type:"bumper", x:number, y:number, radius:number}
 *   | {type:"wall", x:number, y:number, w:number, h:number}
 *   | {type:"hole", x:number, y:number, radius:number}
 *   | {type:"portal", x:number, y:number, radius:number, link:number}
 *   | {type:"zone", x:number, y:number, radius:number, friction:number}} Obstacle
 *
 * Three of these are colliders and three are not, and that split is the
 * thing to keep straight when adding a fourth of either kind.
 *
 * `peg`    - a fixed post; stones bounce off it. Infinite mass.
 * `bumper` - a peg that throws the stone back FASTER than it arrived.
 *            See BUMPER_RESTITUTION for why it needs a speed cap.
 * `wall`   - an axis-aligned rectangle: a peg with a different shape, so
 *            a stage can build corridors and pockets rather than only
 *            scatter dots.
 * `hole`   - a pit. Not a collider at all: a stone whose CENTER enters it
 *            is removed exactly like one that left the board. Modeled as
 *            "center in" rather than "fully contained" so a hole smaller
 *            than a stone still swallows one, which is how a real pit
 *            works and is easier to read at a glance than an edge case
 *            about overlap fractions.
 * `portal` - comes in pairs sharing a `link` id. A stone whose center
 *            enters one is moved to its pair with velocity unchanged — a
 *            translation, not a rotation, because a portal that also
 *            turns the stone is very nearly impossible to aim through.
 *            Not a collider.
 * `zone`   - a patch of board with different friction and no collision at
 *            all: `friction` multiplies FRICTION_DECEL while a stone's
 *            center is inside it (above 1 for sand, below 1 for ice).
 *            The only obstacle that changes which ROUTE is worth taking
 *            rather than merely deflecting whatever crosses it.
 */

/**
 * @param {{stones: Stone[], obstacles?: Obstacle[]}} init
 * @returns {{stones: Stone[], obstacles: Obstacle[], elapsed: number}}
 */
export function createWorld({ stones, obstacles = [] }) {
  return {
    stones: stones.map((s) => ({
      vx: 0,
      vy: 0,
      radius: STONE_RADIUS,
      alive: true,
      ...s,
    })),
    obstacles: obstacles.map((o) => ({ ...o })),
    // A plain odometer of everything this world has ever simulated.
    // Deliberately NOT the turn clock — game/arena.js keeps that on the
    // match, because a per-turn budget compared against a never-resetting
    // counter is true forever after the first few turns. That was a real
    // shipped bug; see arena.js's `turnSeconds`.
    elapsed: 0,
  };
}

/** Deep-ish copy, enough for the AI to explore a candidate flick without
 * disturbing the real world. Obstacles are shared by reference on
 * purpose: nothing in this file ever mutates one. */
export function cloneWorld(world) {
  return {
    stones: world.stones.map((s) => ({ ...s })),
    obstacles: world.obstacles,
    elapsed: world.elapsed,
  };
}

/** True once every surviving stone has stopped — the turn-end condition. */
export function isAtRest(world) {
  return world.stones.every((s) => !s.alive || (s.vx === 0 && s.vy === 0));
}

/**
 * Start a shot: clear every stone's per-shot bumper budget, then launch
 * one of them.
 *
 * The reset has to cover the WHOLE world, not just the stone being
 * flicked — a stone knocked into a bumper nest by someone else needs its
 * own budget too, and a budget left over from a previous turn would make
 * bumpers silently stop working for that stone. Every caller that begins
 * a turn goes through here (game/arena.js's shoot, game/ai.js's rollout);
 * flick() below stays as the raw primitive.
 */
export function beginShot(world, stone, dirX, dirY, power) {
  for (const s of world.stones) s.bumperBoosts = 0;
  flick(stone, dirX, dirY, power);
}

/**
 * Launch `stone` along (dirX, dirY) at `power` in [0, 1].
 * The direction is normalized here rather than by the caller so an
 * un-normalized drag vector from the input layer can be passed straight
 * through; a zero-length direction is a no-op rather than a NaN.
 */
export function flick(stone, dirX, dirY, power) {
  const len = Math.hypot(dirX, dirY);
  if (len === 0) return;
  const speed = Math.max(0, Math.min(1, power)) * MAX_FLICK_SPEED;
  stone.vx = (dirX / len) * speed;
  stone.vy = (dirY / len) * speed;
}

/**
 * The friction multiplier where this stone currently is. Zones are tested
 * by the stone's CENTER, matching how holes and portals decide, so all
 * three read the same way to a player: what matters is where the middle
 * of the stone is, not how much of it overlaps. Multiplied rather than
 * picked, so overlapping zones compose instead of one silently winning.
 */
function frictionScaleAt(world, stone) {
  let scale = 1;
  for (const o of world.obstacles) {
    if (o.type !== "zone") continue;
    const dx = stone.x - o.x;
    const dy = stone.y - o.y;
    if (dx * dx + dy * dy < o.radius * o.radius) scale *= o.friction;
  }
  return scale;
}

/**
 * How much of its bounce a contact keeps at this stone's position.
 *
 * Sand does two things, and until now the engine modelled only one of
 * them. It drags a MOVING stone down — that is frictionScaleAt above —
 * but it also deadens an IMPACT that happens inside it: grains take the
 * energy, so a stone struck while sitting in sand gets shoved rather
 * than fired. Without this a full-power hit landed in the middle of a
 * sand patch still knocked the target clean off the board, which made
 * the patch useless as cover and made the material a lie: it looked soft
 * and behaved like a hard floor the moment anything touched anything.
 *
 * MIN rather than the product frictionScaleAt uses. Friction composes —
 * two overlapping patches really are draggier than one. Deadness does
 * not: a contact is only as soft as the softest thing at it, and
 * multiplying would make two overlapping sand patches produce a
 * collision with essentially no impulse at all.
 */
function bounceScaleAt(world, stone) {
  let scale = 1;
  for (const o of world.obstacles) {
    if (o.type !== "zone" || o.bounce === undefined) continue;
    const dx = stone.x - o.x;
    const dy = stone.y - o.y;
    if (dx * dx + dy * dy < o.radius * o.radius) scale = Math.min(scale, o.bounce);
  }
  return scale;
}

function applyFriction(stone, dt, frictionScale = 1) {
  const speed = Math.hypot(stone.vx, stone.vy);
  if (speed === 0) return;
  if (speed <= STOP_SPEED) {
    stone.vx = 0;
    stone.vy = 0;
    return;
  }
  const drop = FRICTION_DECEL * frictionScale * dt;
  if (drop >= speed) {
    stone.vx = 0;
    stone.vy = 0;
    return;
  }
  const scale = (speed - drop) / speed;
  stone.vx *= scale;
  stone.vy *= scale;
}

/**
 * Equal-mass elastic impulse along the contact normal, plus a positional
 * correction that separates the pair. Both stones move half the overlap:
 * with equal masses there is no reason to prefer one, and splitting it
 * keeps a stack of three touching stones from drifting as a group.
 */
function resolveStonePair(a, b, events, bounceScale = 1) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  const minDist = a.radius + b.radius;
  if (distSq >= minDist * minDist) return;

  // Exactly-concentric stones have no defined normal; nudge along x so
  // the pair still separates instead of producing NaN. Only reachable
  // from a malformed stage layout, but a stage author should see stones
  // pop apart rather than the whole board vanish.
  let dist = Math.sqrt(distSq);
  let nx;
  let ny;
  if (dist === 0) {
    dist = 1e-6;
    nx = 1;
    ny = 0;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }

  const overlap = minDist - dist;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn > 0) return; // already separating — resolving again would add energy

  const j = (-(1 + STONE_RESTITUTION * bounceScale) * vn) / 2; // equal unit masses
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;

  events.push({ type: "stoneHit", a: a.id, b: b.id, impact: Math.abs(vn) });
}

function resolvePeg(stone, peg, events, restitution = PEG_RESTITUTION, maxSpeed = null) {
  const dx = stone.x - peg.x;
  const dy = stone.y - peg.y;
  const minDist = stone.radius + peg.radius;
  const distSq = dx * dx + dy * dy;
  if (distSq >= minDist * minDist) return;

  let dist = Math.sqrt(distSq);
  let nx;
  let ny;
  if (dist === 0) {
    dist = 1e-6;
    nx = 1;
    ny = 0;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }
  stone.x = peg.x + nx * minDist;
  stone.y = peg.y + ny * minDist;

  const vn = stone.vx * nx + stone.vy * ny;
  if (vn > 0) return;
  // A bumper that has spent this stone's budget behaves as a plain peg.
  // See BUMPER_BOOST_BUDGET: this is what makes the turn end.
  const boosting = maxSpeed !== null && (stone.bumperBoosts ?? 0) < BUMPER_BOOST_BUDGET;
  const appliedRestitution = maxSpeed !== null && !boosting ? PEG_RESTITUTION : restitution;
  const j = -(1 + appliedRestitution) * vn; // infinite mass on the obstacle's side
  stone.vx += j * nx;
  stone.vy += j * ny;
  if (boosting) {
    stone.bumperBoosts = (stone.bumperBoosts ?? 0) + 1;
    // The bumper's energy cap — not a polish detail. Without it this
    // world has no guarantee of ever coming to rest. See
    // BUMPER_RESTITUTION.
    const speed = Math.hypot(stone.vx, stone.vy);
    if (speed > maxSpeed) {
      const damp = maxSpeed / speed;
      stone.vx *= damp;
      stone.vy *= damp;
    }
  }
  events.push({
    type: boosting ? "bumperHit" : "obstacleHit",
    stone: stone.id,
    impact: Math.abs(vn),
  });
}

/**
 * Move any stone that has entered a portal to its pair.
 *
 * `portalLock` is the whole difficulty here. Without it a stone arrives
 * at the exit already inside a portal and is sent straight back, forever.
 * The lock records which portal the stone was just placed in, and is
 * cleared only once the stone has genuinely left every portal — checked
 * by position rather than by a timer, because a slow stone can sit inside
 * an exit for a long time and a timer would expire while it was still
 * standing in it.
 */
function resolvePortals(world, events) {
  for (const stone of world.stones) {
    if (!stone.alive) continue;
    let inside = false;
    for (let i = 0; i < world.obstacles.length; i++) {
      const portal = world.obstacles[i];
      if (portal.type !== "portal") continue;
      if (Math.hypot(stone.x - portal.x, stone.y - portal.y) >= portal.radius) continue;
      inside = true;
      if (stone.portalLock === i) break; // this is the one it just came out of
      const exitIndex = world.obstacles.findIndex(
        (other, j) => j !== i && other.type === "portal" && other.link === portal.link
      );
      // An unpaired portal is inert rather than a crash: a malformed
      // stage should look wrong, not take the game down.
      if (exitIndex === -1) break;
      const exit = world.obstacles[exitIndex];
      stone.x = exit.x;
      stone.y = exit.y;
      stone.portalLock = exitIndex;
      events.push({ type: "teleported", stone: stone.id });
      break;
    }
    if (!inside) stone.portalLock = undefined;
  }
}

function resolveWall(stone, wall, events, bounceScale = 1) {
  // Closest point on the AABB to the stone's center; the normal is the
  // vector from it back to the center. This handles face, edge and
  // corner contacts with one code path — a per-face reflection would
  // pick the wrong axis at a corner and shoot the stone along the wall.
  const closestX = Math.max(wall.x, Math.min(stone.x, wall.x + wall.w));
  const closestY = Math.max(wall.y, Math.min(stone.y, wall.y + wall.h));
  const dx = stone.x - closestX;
  const dy = stone.y - closestY;
  const distSq = dx * dx + dy * dy;
  if (distSq >= stone.radius * stone.radius) return;

  let dist = Math.sqrt(distSq);
  let nx;
  let ny;
  if (dist === 0) {
    // Center is inside the rectangle (only reachable if a stage places a
    // stone overlapping a wall). Eject along the shallowest axis.
    const left = stone.x - wall.x;
    const right = wall.x + wall.w - stone.x;
    const top = stone.y - wall.y;
    const bottom = wall.y + wall.h - stone.y;
    const min = Math.min(left, right, top, bottom);
    nx = min === left ? -1 : min === right ? 1 : 0;
    ny = min === top ? -1 : min === bottom ? 1 : 0;
    if (nx === 0 && ny === 0) ny = 1;
    dist = 0;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }
  stone.x = closestX + nx * stone.radius;
  stone.y = closestY + ny * stone.radius;

  const vn = stone.vx * nx + stone.vy * ny;
  if (vn > 0) return;
  const j = -(1 + WALL_RESTITUTION * bounceScale) * vn;
  stone.vx += j * nx;
  stone.vy += j * ny;
  events.push({ type: "obstacleHit", stone: stone.id, impact: Math.abs(vn) });
}

/**
 * A stone is out when its CENTER leaves [0,1]^2 — not when it first
 * touches the edge. That is both the real rule (a stone half over the
 * side is still in play, and the tension of watching one teeter there is
 * most of the game's appeal) and the reason the renderer must not clip
 * the board to its own square.
 */
function checkRemoval(world, events) {
  for (const s of world.stones) {
    if (!s.alive) continue;
    if (s.x < 0 || s.x > 1 || s.y < 0 || s.y > 1) {
      s.alive = false;
      s.vx = 0;
      s.vy = 0;
      events.push({ type: "fellOff", stone: s.id, player: s.player });
      continue;
    }
    for (const o of world.obstacles) {
      if (o.type !== "hole") continue;
      if (Math.hypot(s.x - o.x, s.y - o.y) < o.radius) {
        s.alive = false;
        s.vx = 0;
        s.vy = 0;
        events.push({ type: "sank", stone: s.id, player: s.player });
        break;
      }
    }
  }
}

function substep(world, dt, events) {
  for (const s of world.stones) {
    if (!s.alive) continue;
    applyFriction(s, dt, frictionScaleAt(world, s));
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
  // Teleport BEFORE resolving collisions, so a stone that lands on an
  // exit overlapping something gets pushed apart in this same substep
  // instead of being left interpenetrating for a frame.
  resolvePortals(world, events);
  const live = world.stones.filter((s) => s.alive);
  // Computed once per stone per substep rather than inside each contact:
  // a pinball stage resolves dozens of contacts a frame and this is a
  // scan of every obstacle.
  const bounce = live.map((s) => bounceScaleAt(world, s));
  for (let i = 0; i < live.length; i++) {
    for (const o of world.obstacles) {
      if (o.type === "peg") resolvePeg(live[i], o, events, PEG_RESTITUTION * bounce[i]);
      // The BUMPER is deliberately exempt. It is a sprung mechanism, not
      // a surface, so sand piled around it would not soften its spring —
      // and more to the point, the game now shows the player a card
      // promising a bumper returns a stone faster than it arrived. A
      // bumper that quietly stopped doing that inside a sand patch would
      // make that card a lie, which is worse than any realism it buys.
      else if (o.type === "bumper") resolvePeg(live[i], o, events, BUMPER_RESTITUTION, BUMPER_MAX_SPEED);
      else if (o.type === "wall") resolveWall(live[i], o, events, bounce[i]);
    }
    for (let j = i + 1; j < live.length; j++) {
      resolveStonePair(live[i], live[j], events, Math.min(bounce[i], bounce[j]));
    }
  }
  checkRemoval(world, events);
  world.elapsed += dt;
}

/**
 * Advance the world by `dt` real seconds, in fixed SUB_DT slices.
 * The leftover slice is carried by the caller's own accumulator (see
 * main.js's animation loop) rather than integrated as a short step here,
 * because a variable final step is exactly what makes browser and Node
 * runs diverge.
 * @returns {Array} events emitted during this advance
 */
export function stepWorld(world, dt) {
  const events = [];
  // COUNTED, not subtracted. The old form subtracted SUB_DT from a
  // remaining float until it no longer fit, which loses a whole substep
  // whenever the division lands a hair under an integer — and 1/60 over
  // 1/300 is exactly the kind of value that does. That single missing
  // step is a fifth of the frame's motion, every frame, which is what a
  // player sees as a shot that stutters and drifts slow. The epsilon is
  // there for the same reason.
  const steps = Math.floor(Math.min(dt, 0.25) / SUB_DT + 1e-9); // a backgrounded tab can hand us seconds
  for (let i = 0; i < steps; i++) substep(world, SUB_DT, events);
  return events;
}

/**
 * Run to rest with no renderer attached — used by tests and by the AI's
 * candidate search. Returns everything the caller needs to score the
 * outcome without replaying the event list itself.
 * @returns {{events: Array, seconds: number, timedOut: boolean}}
 */
export function simulateToRest(world, maxSeconds = MAX_TURN_SECONDS) {
  const events = [];
  let seconds = 0;
  while (!isAtRest(world) && seconds < maxSeconds) {
    substep(world, SUB_DT, events);
    seconds += SUB_DT;
  }
  const timedOut = !isAtRest(world);
  if (timedOut) {
    // Freeze whatever is still crawling, so the turn can end. Losing the
    // last few thousandths of a board unit of travel is invisible; a
    // turn that never ends is not.
    for (const s of world.stones) {
      s.vx = 0;
      s.vy = 0;
    }
  }
  return { events, seconds, timedOut };
}

/** Surviving stones belonging to `player`. */
export function countAlive(world, player) {
  return world.stones.filter((s) => s.alive && s.player === player).length;
}
