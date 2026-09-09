// game/physics.js
// Pool physics: sixteen spheres rolling on cloth inside a rectangle with
// SIX POCKETS, with spin. Inherited from the site's Four Ball Billiards
// engine; the additions for 8-ball are the pocket geometry (cushion
// segments that END at the pocket jaws, jaw points the ball can rattle
// off, and a capture circle in each pocket that records a "pocket" event
// and takes the ball off the table). Everything else — cloth friction,
// spin, ball-ball throw, the above-centre cushion contact — is the
// four-ball model unchanged.
//
// WHY THIS IS NOT StoneFlick's physics.js WITH RAILS BOLTED ON
// StoneFlick models a stone as a point mass with Coulomb friction: one
// velocity vector, friction opposing it, elastic disc collisions. That is
// the right model for a go stone sliding on a board, and it is the WRONG
// model for a billiard ball, because in billiards the interesting state
// is not where the ball is going, it is how it is SPINNING while it goes
// there. Everything a player is actually doing at a billiard table —
// 밀어치기 (follow), 끌어치기 (draw), 오시/시끼, side english to change
// the rebound off a rail — is a statement about angular velocity, and a
// point-mass model has nowhere to put it. So the ball here carries a full
// angular velocity vector and the cloth is a friction CONTACT rather than
// a drag term. That single change is what makes this a billiards game
// instead of alkkagi on a rectangle.
//
// UNITS: SI. Metres, seconds, kilograms, radians/second. StoneFlick
// normalised its board to [0,1]^2 because nothing in alkkagi has a real
// physical size worth respecting. Billiards is the opposite case: every
// number below (sliding friction 0.2, cushion restitution ~0.75, the 2/5
// R offset that produces natural roll) is a MEASURED property of real
// cloth, real phenolic and real rubber, published in SI. Re-deriving them
// into normalised units is a pile of unit conversions for no benefit and
// several chances to be silently wrong, so the simulation is metric and
// game/layout.js is the single place metres become pixels.
//
// DETERMINISM: stepWorld() splits dt into fixed substeps and, within a
// substep, advances to the exact time of each impact rather than stepping
// through it. Same shot in, same result out, in Node and in the browser.
// Both the shot AI and (later) an authoritative online server depend on
// that, exactly as they did in StoneFlick.
//
// SOURCES for the model (all standard, none copied as code):
//   - Sliding/rolling transition and the (7/2)mu*g decay of contact-point
//     velocity: standard rigid-sphere-on-plane result, e.g. Marlow,
//     "The Physics of Pocket Billiards" (1994).
//   - Ball-ball throw as a Coulomb-limited tangential impulse: same.
//   - Speed-dependent cushion restitution: Mathavan, Jackson & Parkin,
//     "A theoretical analysis of billiard ball dynamics under cushion
//     impacts" (2010).
// The equations below were written out from those results rather than
// adapted from any implementation; see each derivation in place.

// ---------------------------------------------------------------------
// Table and ball
// ---------------------------------------------------------------------

/** Playing surface, inside the cushion noses, in metres.
 *
 * 2.54 x 1.27 is one table under two names: the European DEMI-MATCH
 * (outer 2.80 x 1.5275), which is what most carom clubs in France,
 * Belgium and the Netherlands actually have on the floor, and the Korean
 * 국제식 중대, which is the table 사구 is played on. The tournament
 * three-cushion table (2.84 x 1.42, the 국제식 대대) is bigger, but no
 * one plays four-ball on it, and on a phone it makes the ball smaller
 * than anything a player has ever seen.
 *
 * The 2:1 ratio is not decoration and every size keeps it: every cushion
 * system a player knows (5&1/2, 스리쿠션 diamond counting) is arithmetic
 * on that ratio, so a table of any other shape would make every learned
 * aim wrong. */
/** THE ONE NUMBER THAT WAS CHOSEN FOR THE SCREEN AND NOT THE SPEC SHEET.
 *
 * A seven-foot "bar box" is 1.98 x 0.99m of cloth and 34.6 ball diameters
 * long; a nine-foot table is 44. Either of those on a portrait phone is
 * arithmetic that does not come out: the table has to stand upright
 * (2:1 into a 1:2 window), the page above it spends about 180px on the
 * header, the goal line and the status line, and the shot controls want
 * another ~90 at the bottom. On a 375 x 667 phone that leaves roughly
 * 390px of height for the table, and 390px of a 34.6-diameter table is a
 * ball 11 pixels across — smaller than the numbers printed on it.
 *
 * So the CLOTH shrank rather than the ball: 1.5 x 0.75m keeps the 2:1
 * shape every pool player's eye is trained on (every angle, every rail
 * system, the rack, the spots) and makes the table 25 ball diameters
 * long instead of 34.6. The balls read a third larger relative to the
 * cloth, the pockets are proportionally more generous — which is the
 * right direction for this audience anyway — and the ball lands at 18px
 * on the smallest phone we ship to, which is the size BRIEF.md sets.
 *
 * Nothing else in this file depends on the absolute size: the friction
 * constants are per metre and the pocket geometry is all in ball radii,
 * so this is a smaller table, not a differently-behaved one. */
export const TABLE_LENGTH = 1.5;
export const TABLE_WIDTH = 0.75;

/** 65.5mm is the FOUR-BALL ball, a size that exists only in Korea;
 * three-cushion and European carom use 61.5mm and pool uses 57.2mm. We
 * ship the four-ball ball because we ship four-ball, and because the
 * larger ball on the smaller table is the single biggest readability win
 * available on a phone: 38.8 table-lengths to a ball instead of 46.2.
 *
 * The mass follows from the diameter at carom-ball density (61.5mm is
 * 205-220g): 0.21 * (65.5/61.5)^3. The heavier, larger billiard ball is
 * why these shots carry so much further than pool and why the cushions
 * feel livelier. */
/** Real pool balls are 57.15mm. These are 60mm: a hair oversize on a
 * seven-foot table, which buys a readable number on a ball that is 18
 * pixels across on a phone — the readability rule outranks the spec
 * sheet here, and nobody can tell 5% by eye. Mass is phenolic density
 * at that size. */
export const BALL_RADIUS = 0.03;
export const BALL_MASS = 0.17;

export const GRAVITY = 9.81;

// ---------------------------------------------------------------------
// Cloth
// ---------------------------------------------------------------------

/** Sliding friction, ball against cloth, while the contact point is still
 * skidding. 0.2 is mid-range for the fast worsted cloth a billiard table is
 * covered with (measurements run 0.15–0.4; the low end is a new,
 * well-ironed cloth).
 *
 * What this number IS, in play: how long a struck ball keeps whatever
 * spin you gave it before the cloth converts that spin into rolling. Turn
 * it up and draw shots die before they reach the object ball; turn it
 * down and every ball skids across the table like it is on ice. */
export const MU_SLIDE = 0.2;

/** Rolling resistance once the ball is rolling without slipping. Two
 * orders of magnitude below MU_SLIDE, which is the whole reason a rolling
 * ball crosses the table three times and a skidding one does not.
 *
 * Consequence worth knowing before tuning: at 0.01 a ball rolling at
 * 1 m/s travels v^2/(2*mu*g) = 5.1 m, i.e. nearly two table lengths. That
 * is correct for real cloth and it is why four-ball is a slow-shot game. */
export const MU_ROLL = 0.01;

/** Spinning ("drilling") friction: how fast english left over on a ball
 * bleeds away while the ball sits or rolls. Modelled as a constant
 * angular deceleration 5*MU_SPIN*g/(2R), which at 0.01 is ~8 rad/s^2 —
 * so a heavy 40 rad/s english is gone in about five seconds, roughly what
 * it looks like on a table. Not derived from a contact-patch integral;
 * it is a one-constant stand-in for one, and it is honest to say so. */
export const MU_SPIN = 0.01;

// ---------------------------------------------------------------------
// Impacts
// ---------------------------------------------------------------------

/** Ball-on-ball restitution. Phenolic resin balls are very nearly
 * elastic; measured values sit at 0.92–0.96. */
export const BALL_RESTITUTION = 0.94;

/** Ball-on-ball friction. Small — polished resin on polished resin —
 * but not zero, and this is the entire source of THROW: a cut shot sends
 * the object ball a degree or two off the line of centres, and a ball
 * struck with english drags the object ball sideways. Players who have
 * never heard the word "throw" still aim for it by instinct, so a
 * simulation without it feels subtly dead. */
export const MU_BALL = 0.06;

/** Cushion friction. Measured values for rubber against resin sit around
 * 0.14–0.2; 0.16 here, now that the cushion is modelled at its real
 * height and no longer needs the coefficient inflated to compensate for
 * the geometry it was missing. */
export const MU_CUSHION = 0.2;

/**
 * How far ABOVE the ball's centre the cushion nose touches it.
 *
 * This one number is the difference between a table and a box, and
 * leaving it at zero was the worst bug in this file.
 *
 * With a centre-height contact, the normal impulse has no moment arm, so
 * a rolling ball keeps ALL of its topspin through the bounce. It then
 * comes off the rail spinning the way it was going and travelling the
 * way it now is, and cloth friction spends the next half second fighting
 * the ball's own spin. Measured on the flat model: a ball rolling into a
 * cushion at 1 m/s came away with 8% of its speed. Eight. It reads
 * exactly as the player described it — "sometimes it just stops dead at
 * the wall" — and no amount of tuning restitution fixes it, because the
 * energy is not being lost at the cushion, it is being lost afterwards to
 * a spin that should never have survived.
 *
 * A real nose sits at 62.5–64.5% of a ball's DIAMETER above the cloth
 * (WPA equipment spec), which is 0.25R–0.29R above centre. At that height
 * the normal impulse has a moment arm, reverses most of the topspin, and
 * the ball leaves already rolling in the new direction — which is what
 * everyone who has watched a table has seen.
 *
 * There is a tidy check on the number. Solve for the height at which a
 * rolling ball comes off PERFECTLY rolling and it is 2R/5 — the same 2/5
 * that gives natural roll from a cue tip, and for the same reason. The
 * real nose is a little below that, so a ball leaves a cushion very
 * slightly under-rolling and settles at about 60% of its incoming speed.
 * That is the number a player feels.
 *
 * (Full 3D treatments — Han 2005, Mathavan et al. 2010 — tilt the impulse
 * out of the horizontal plane as well, which is what makes a hard draw
 * shot hop off a rail. This model keeps the impulse horizontal and only
 * takes the moment arm, because a planar simulation has nowhere to put a
 * vertical velocity. The equations below were written from those results;
 * no implementation was copied.)
 */
export const CUSHION_HEIGHT = 0.27 * BALL_RADIUS;

/** Below this speed a ball is snapped to rest, so "all balls stopped" is
 * a state the turn loop reaches in finite time. 1 cm/s: slower than that
 * and a ball on real cloth is being carried by the nap, not by the shot. */
export const STOP_SPEED = 0.01;

/** A cue cannot strike further than half a radius off centre without
 * miscuing — the classic "miscue limit" at a/R = 0.5. The input layer
 * clamps to this so the player cannot ask for spin a real stroke could
 * not deliver. */
export const MAX_TIP_OFFSET = 0.5 * BALL_RADIUS;

/** Fastest legal cue-ball speed, m/s. A hard break is around
 * 6 m/s; anything much past that and the ball starts leaving the cloth,
 * which this planar model cannot represent. Capping here rather than in
 * the input layer means the AI and the server share the cap. */
export const MAX_SHOT_SPEED = 7.0;

/** Fixed integration substep. At MAX_SHOT_SPEED a ball covers 10mm per
 * substep, a third of its own radius, so the swept collision search below
 * never has to look more than one substep ahead. */
export const SUB_DT = 1 / 600;

/** A turn cannot run longer than this many simulated seconds. A rolling
 * ball genuinely can take 15s to stop on fast cloth; the cutoff exists so
 * a pathological state (a ball trapped in a corner by an impulse loop)
 * cannot hang the AI's search, not to shorten real shots. */
export const MAX_SHOT_SECONDS = 25;

// Derived, hoisted out of the inner loop.
const R = BALL_RADIUS;
const TWO_R = 2 * BALL_RADIUS;
const SPIN_DECEL = (5 * MU_SPIN * GRAVITY) / (2 * BALL_RADIUS);
const SIN_CUSHION = CUSHION_HEIGHT / BALL_RADIUS;
const COS_CUSHION = Math.sqrt(1 - SIN_CUSHION * SIN_CUSHION);
const SLIDE_DECEL = MU_SLIDE * GRAVITY;
const ROLL_DECEL = MU_ROLL * GRAVITY;

// ---------------------------------------------------------------------
// Pockets
// ---------------------------------------------------------------------
//
// The cushion is not one wall per side any more: each side is a set of
// SEGMENTS with gaps where the pockets are. Where a segment ends there is
// a JAW — a fixed point the ball can strike, which is what makes a ball
// rattle in the mouth of a pocket instead of sliding in along a wall.
// Past the rail line inside a mouth there is nothing to hold the ball,
// and a capture circle in the pocket takes it off the table.
//
// The mouth widths follow the WPA equipment spec: a corner opening of
// about two ball diameters between the noses (m√2 = 2.05 D gives m =
// 1.45 D along each rail) and a side opening of 2.25 diameters.

/** How far from a corner, along each rail, the cushion ends. */
export const CORNER_MOUTH = 2.9 * BALL_RADIUS;
/** Half the side pocket's opening along the rail. */
export const SIDE_MOUTH = 2.25 * BALL_RADIUS;
/** Capture circles. The corner's sits a little outside the corner and
 * is wide enough that any centre crossing the rail line inside the mouth
 * is already inside it (test/physics.test.js checks the grazing case);
 * the side's sits just outside the rail. A ball has to be deep in the
 * jaws before either circle reaches inside the cloth. */
const CORNER_IN = 0.9 * BALL_RADIUS;
const CORNER_R = 3.0 * BALL_RADIUS;
const SIDE_IN = 0.8 * BALL_RADIUS;
const SIDE_R = 1.9 * BALL_RADIUS;

/** The six pockets, in table metres, for a table of the given size. */
export function pocketsFor(length = TABLE_LENGTH, width = TABLE_WIDTH) {
  return [
    { id: "tl", x: -CORNER_IN, y: -CORNER_IN, r: CORNER_R, corner: true },
    { id: "tm", x: length / 2, y: -SIDE_IN, r: SIDE_R, corner: false },
    { id: "tr", x: length + CORNER_IN, y: -CORNER_IN, r: CORNER_R, corner: true },
    { id: "bl", x: -CORNER_IN, y: width + CORNER_IN, r: CORNER_R, corner: true },
    { id: "bm", x: length / 2, y: width + SIDE_IN, r: SIDE_R, corner: false },
    { id: "br", x: length + CORNER_IN, y: width + CORNER_IN, r: CORNER_R, corner: true },
  ];
}

/** The cushion segments and their jaw points. Each segment is one
 * straight run of cushion between two mouths: `axis` says which wall it
 * belongs to, [a, b] is its extent along that wall. */
export function cushionsFor(length = TABLE_LENGTH, width = TABLE_WIDTH) {
  const mc = CORNER_MOUTH;
  const ms = SIDE_MOUTH;
  const segs = [
    { wall: "top", a: mc, b: length / 2 - ms },
    { wall: "top", a: length / 2 + ms, b: length - mc },
    { wall: "bottom", a: mc, b: length / 2 - ms },
    { wall: "bottom", a: length / 2 + ms, b: length - mc },
    { wall: "left", a: mc, b: width - mc },
    { wall: "right", a: mc, b: width - mc },
  ];
  const jaws = [];
  for (const s of segs) {
    for (const t of [s.a, s.b]) {
      if (s.wall === "top") jaws.push({ x: t, y: 0 });
      else if (s.wall === "bottom") jaws.push({ x: t, y: width });
      else if (s.wall === "left") jaws.push({ x: 0, y: t });
      else jaws.push({ x: length, y: t });
    }
  }
  return { segs, jaws };
}

/** Is there cushion at this point along this wall? */
function onCushion(world, wall, t) {
  for (const s of world.cushions.segs) {
    if (s.wall === wall && t >= s.a && t <= s.b) return true;
  }
  return false;
}

/** Which pocket, if any, has this ball. The fallback clause — well past
 * the rail line and not inside a circle — cannot happen with the sizes
 * above (the jaws keep every crossing inside a circle), and is kept so a
 * ball can never be lost in the void if a size is ever retuned. */
export function pocketAt(world, b) {
  for (const p of world.pockets) {
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    if (dx * dx + dy * dy < p.r * p.r) return p;
  }
  const slack = 0.5 * R;
  if (b.x < -slack || b.x > world.length + slack || b.y < -slack || b.y > world.width + slack) {
    let best = world.pockets[0];
    let bd = Infinity;
    for (const p of world.pockets) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }
  return null;
}

// ---------------------------------------------------------------------
// World
// ---------------------------------------------------------------------

/**
 * A ball's state.
 *
 * (vx, vy) is the centre's velocity. (wx, wy, wz) is the angular velocity
 * about the three axes, with z pointing UP out of the cloth — so wz is
 * english (side) and (wx, wy) is the rolling/draw axis. Keeping all three
 * is what separates this from a point-mass model; wz in particular
 * survives collisions and rails and is the thing a good player is really
 * steering.
 *
 * @typedef {{id:string, x:number, y:number, vx:number, vy:number,
 *            wx:number, wy:number, wz:number, color:string}} Ball
 */

/**
 * @param {{balls: Array<{id:string,x:number,y:number,color?:string}>,
 *          length?:number, width?:number}} spec
 */
export function createWorld({ balls, length = TABLE_LENGTH, width = TABLE_WIDTH }) {
  return {
    length,
    width,
    pockets: pocketsFor(length, width),
    cushions: cushionsFor(length, width),
    balls: balls.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      vx: 0,
      vy: 0,
      wx: 0,
      wy: 0,
      wz: 0,
      color: b.color || "white",
      /** Off the table. A pocketed ball keeps its record (the tray
       * draws it) but takes no part in the simulation. */
      pocketed: Boolean(b.pocketed),
    })),
    /** Contacts in the order they happened, since the last resetEvents().
     * This is the raw material every scoring rule is written against —
     * 4구 asks "did the cue ball touch both reds", 3구 asks "and at least
     * three cushions in between" — so physics records WHAT touched WHAT
     * and in what order, and knows nothing about points. */
    events: [],
    /** Simulated seconds since the shot began. */
    time: 0,
  };
}

export function cloneWorld(world) {
  return {
    length: world.length,
    width: world.width,
    pockets: world.pockets,
    cushions: world.cushions,
    balls: world.balls.map((b) => ({ ...b })),
    events: world.events.map((e) => ({ ...e })),
    time: world.time,
  };
}

export function getBall(world, id) {
  return world.balls.find((b) => b.id === id) || null;
}

export function resetEvents(world) {
  world.events = [];
  world.time = 0;
}

/** True when every ball has stopped AND stopped skidding. The second
 * half matters: a ball sitting still under heavy backspin is about to
 * move, and a turn that ended there would end one moment before the most
 * interesting thing in the shot. */
export function isAtRest(world) {
  for (const b of world.balls) {
    if (b.pocketed) continue;
    if (b.vx * b.vx + b.vy * b.vy > STOP_SPEED * STOP_SPEED) return false;
    const u = contactVelocity(b);
    if (u.x * u.x + u.y * u.y > STOP_SPEED * STOP_SPEED) return false;
  }
  return true;
}

// ---------------------------------------------------------------------
// The stroke
// ---------------------------------------------------------------------

/**
 * Strike a ball with a cue.
 *
 * The cue delivers an impulse J along `dir` at a point offset from the
 * ball's centre by `side` across and `vertical` up. Since v = J/m and
 * omega = (r x J) / I with I = (2/5) m R^2:
 *
 *   omega = (5 / (2 R^2)) * (r x v)
 *
 * with r = side * t_hat + vertical * z_hat and t_hat = dir rotated +90 deg:
 *
 *   t_hat x dir_hat = -z_hat      ->  wz = -(5 * side * v) / (2 R^2)
 *   z_hat  x dir_hat = t_hat      ->  w_horizontal = (5 * vertical * v) / (2 R^2) * t_hat
 *
 * Two sanity checks that this is the real relation and not a plausible
 * one. Put `vertical` at 2R/5 and the horizontal spin comes out to
 * exactly v/R — the rolling condition, i.e. the textbook result that
 * striking two fifths of a radius above centre gives natural roll with no
 * skid. Put it at zero and you get a pure stun. Both are pinned in
 * test/physics.test.js.
 *
 * @param {Ball} ball
 * @param {number} dirX @param {number} dirY  direction of travel (need not be unit)
 * @param {number} speed  m/s, clamped to MAX_SHOT_SPEED
 * @param {number} side  tip offset across the shot line, metres. Positive
 *   is toward `dir` rotated +90 degrees in ordinary maths orientation.
 *   Which SIDE of the ball that is on screen depends on whether the
 *   renderer's y axis points up or down, so the UI layer owns that label,
 *   not this file.
 * @param {number} vertical  tip offset above centre, metres. Positive is
 *   follow (밀어치기), negative is draw (끌어치기).
 */
export function strike(ball, dirX, dirY, speed, side = 0, vertical = 0) {
  const len = Math.sqrt(dirX * dirX + dirY * dirY);
  if (len === 0) return;
  const nx = dirX / len;
  const ny = dirY / len;
  const v = Math.min(Math.abs(speed), MAX_SHOT_SPEED);

  // Clamp the tip offset to the miscue limit as a VECTOR, not per axis:
  // maximum side and maximum draw at once is off the ball entirely.
  let sx = side;
  let sy = vertical;
  const off = Math.sqrt(sx * sx + sy * sy);
  if (off > MAX_TIP_OFFSET) {
    const k = MAX_TIP_OFFSET / off;
    sx *= k;
    sy *= k;
  }

  ball.vx = nx * v;
  ball.vy = ny * v;

  const k = (5 * v) / (2 * R * R);
  ball.wz = -k * sx;
  // t_hat = (-ny, nx)
  ball.wx = k * sy * -ny;
  ball.wy = k * sy * nx;
}

/** The contact-point ("relative surface") velocity of a ball against the
 * cloth. Zero means the ball is rolling without slipping; non-zero means
 * it is skidding and MU_SLIDE applies.
 *
 * Derivation: the contact point sits at r = (0,0,-R) below the centre, so
 * its velocity is v + omega x r = (vx - R*wy, vy + R*wx). */
export function contactVelocity(b) {
  return { x: b.vx - R * b.wy, y: b.vy + R * b.wx };
}

/** True when the ball is rolling without slipping (to within a hair). */
export function isRolling(b) {
  const u = contactVelocity(b);
  return Math.hypot(u.x, u.y) < 1e-4;
}

// ---------------------------------------------------------------------
// Cloth interaction for one substep
// ---------------------------------------------------------------------

function applyCloth(b, dt, world) {
  const speed2 = b.vx * b.vx + b.vy * b.vy;
  const moving = speed2 > 0 || b.wz !== 0;
  if (!moving) return;

  const ux = b.vx - R * b.wy;
  const uy = b.vy + R * b.wx;
  const u = Math.sqrt(ux * ux + uy * uy);

  if (u > 1e-4) {
    // SLIDING. Friction acts on the contact point, opposing u, and does
    // two things at once: it decelerates the centre and it torques the
    // ball. Both come from the same force, which is why they cannot be
    // tuned independently and why "spin" is not a separate system here.
    //
    //   dv/dt      = -mu*g * u_hat
    //   dw_x/dt    = -(5*mu*g)/(2R) * u_hat_y
    //   dw_y/dt    = +(5*mu*g)/(2R) * u_hat_x
    //
    // Substituting those into du/dt gives du/dt = -(7/2)*mu*g*u_hat: the
    // standard result that the SKID dies 3.5x faster than the centre
    // slows down. That factor is the reason a stun shot keeps almost all
    // its speed and a draw shot comes back.
    const uhx = ux / u;
    const uhy = uy / u;

    // Do not overshoot: the skid may end partway through the substep.
    const tSkid = u / ((7 / 2) * SLIDE_DECEL);
    const h = Math.min(dt, tSkid);

    b.vx -= SLIDE_DECEL * uhx * h;
    b.vy -= SLIDE_DECEL * uhy * h;
    const aw = (5 * SLIDE_DECEL) / (2 * R);
    b.wx -= aw * uhy * h;
    b.wy += aw * uhx * h;

    if (h < dt) {
      // Skid ended inside this substep: snap to the exact rolling state
      // (floating point will not land on it by itself, and a ball that
      // "almost" rolls keeps burning sliding friction forever) and spend
      // the remainder rolling.
      lockRolling(b);
      applyRolling(b, dt - h);
    }
  } else {
    lockRolling(b);
    applyRolling(b, dt);
  }

  // English drills away against the cloth whatever else the ball is doing.
  if (b.wz !== 0) {
    const dec = SPIN_DECEL * dt;
    if (Math.abs(b.wz) <= dec) b.wz = 0;
    else b.wz -= Math.sign(b.wz) * dec;
  }

  // A ball is only at rest when its CENTRE has stopped AND its contact
  // point has too. Testing the centre alone looks right and is a bug with
  // a name: a draw shot passes through vx = 0 on its way back, and
  // zeroing the spin there deletes the draw at the exact instant the shot
  // is about to work. The skid is what is still driving the ball, so the
  // skid is what has to be gone before we call it stopped.
  const cx = b.vx - R * b.wy;
  const cy = b.vy + R * b.wx;
  if (
    b.vx * b.vx + b.vy * b.vy < STOP_SPEED * STOP_SPEED &&
    cx * cx + cy * cy < STOP_SPEED * STOP_SPEED
  ) {
    // The transition is an EVENT, not just a state change, and it is
    // recorded because rules.js needs it: a shot is the cue ball's
    // journey, and a red rolling into a cue ball that has already
    // finished is not part of it. Only the moment of stopping is logged,
    // never the frames after — a ball already at rest re-satisfies this
    // condition every substep.
    if (world && (b.vx || b.vy || b.wx || b.wy)) {
      world.events.push({ type: "rest", ball: b.id, t: world.time });
    }
    b.vx = 0;
    b.vy = 0;
    b.wx = 0;
    b.wy = 0;
  }
}

function lockRolling(b) {
  b.wy = b.vx / R;
  b.wx = -b.vy / R;
}

function applyRolling(b, dt) {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp === 0) return;
  const drop = Math.min(sp, ROLL_DECEL * dt);
  const k = (sp - drop) / sp;
  b.vx *= k;
  b.vy *= k;
  lockRolling(b);
}

// ---------------------------------------------------------------------
// Impacts
// ---------------------------------------------------------------------

/**
 * Ball against ball, equal masses.
 *
 * Normal: the textbook restitution impulse.
 *
 * Tangential: this is throw, and it is worth the paragraph. The two
 * surfaces are sliding across each other during the touch at a relative
 * speed made of BOTH the cut angle and the balls' english:
 *
 *   u_t = (v1 - v2).t + R*(wz1 + wz2)
 *
 * (both wz terms add, because at the contact point the two balls' side
 * spins move their surfaces the same way relative to each other). A
 * tangential impulse Jt kills that at a rate of 7*Jt/m — one part from
 * each centre and five parts from the two rotations — so the impulse that
 * would exactly stop the sliding is Jt = -u_t * m/7, and Coulomb caps it
 * at MU_BALL * Jn. In practice the cap almost always binds, which is why
 * throw is a degree or two and not a wild deflection.
 */
function resolveBallBall(a, b, world) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1e-9;
  const nx = dx / d;
  const ny = dy / d;
  const tx = -ny;
  const ty = nx;

  const rvn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rvn <= 0) return; // separating already; nothing to resolve

  const m = BALL_MASS;
  const jn = ((1 + BALL_RESTITUTION) * rvn * m) / 2;
  a.vx -= (jn / m) * nx;
  a.vy -= (jn / m) * ny;
  b.vx += (jn / m) * nx;
  b.vy += (jn / m) * ny;

  const ut = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty + R * (a.wz + b.wz);
  let jt = (-ut * m) / 7;
  const cap = MU_BALL * Math.abs(jn);
  if (Math.abs(jt) > cap) jt = Math.sign(jt) * cap;

  a.vx += (jt / m) * tx;
  a.vy += (jt / m) * ty;
  b.vx -= (jt / m) * tx;
  b.vy -= (jt / m) * ty;
  // Both balls' english changes by the same amount and in the same
  // direction: the impulse acts on opposite sides of the two centres, and
  // the two sign flips cancel. (This is how a ball with right english
  // "gives" english to the object ball.)
  const dwz = (5 * jt) / (2 * m * R);
  a.wz += dwz;
  b.wz += dwz;

  world.events.push({ type: "ball", a: a.id, b: b.id, t: world.time, speed: rvn });
}

/**
 * Ball against cushion.
 *
 * Normal: restitution falls as the ball hits harder — rubber is not
 * linear. Mathavan et al.'s empirical fit e = 0.39 + 0.257*vn -
 * 0.044*vn^2 gives ~0.73 at 2 m/s and is clamped to a sane band because
 * the quadratic turns over past ~3 m/s.
 *
 * THE CONTACT IS ABOVE CENTRE, which is the whole point of this function
 * and is explained at CUSHION_HEIGHT. Working in the cushion's own frame
 * — n out of the wall, t = z x n along it, z up — the contact sits at
 *
 *   r = R * (-cos(theta) * n + sin(theta) * z),   sin(theta) = height / R
 *
 * and everything follows from that offset:
 *
 *   - the normal impulse Jn now exerts a torque R*sin(theta)*Jn about t,
 *     which is the axis a ball rolling into the rail is spinning about.
 *     That is what strips the topspin and lets the ball leave rolling the
 *     new way instead of fighting itself.
 *   - the surface velocity along the rail picks up a term from the spin
 *     about n as well as the usual english:
 *       u_t = v.t - R*(sin(theta)*w_n + cos(theta)*w_z)
 *   - the friction impulse still cancels u_t at a rate of 7*Jt/(2m) —
 *     the sin^2 + cos^2 from the two new moment arms sums back to one —
 *     and is still capped at mu*Jn, which is what keeps a shallow angle
 *     shallow and lets a steep one grip.
 *
 * So a plain rail-first shot still picks up running english out of
 * nowhere (real), english still bends the rebound both ways (real), and a
 * rolling ball no longer dies at the wall (the bug).
 */
function resolveCushion(ball, nx, ny, world, wall) {
  const tx = -ny;
  const ty = nx;
  const vn = ball.vx * nx + ball.vy * ny; // negative = moving into the wall
  if (vn >= 0) return;

  const speed = -vn;
  let e = 0.39 + 0.257 * speed - 0.044 * speed * speed;
  if (e < 0.5) e = 0.5;
  if (e > 0.95) e = 0.95;

  const m = BALL_MASS;

  // Spin in the cushion's frame.
  const wn = ball.wx * nx + ball.wy * ny;
  const wz = ball.wz;
  const wt = ball.wx * tx + ball.wy * ty;

  // RESTITUTION BELONGS TO THE CONTACT POINT, NOT THE CENTRE.
  //
  // The nose touches the ball above its equator, so the impulse has a
  // moment arm — that is the whole reason this function turns a rolling
  // ball's topspin into speed, and it is right. But the impulse itself
  // used to be sized from the CENTRE's approach speed, (1+e)*speed*m,
  // while being applied at that offset point. An impulse sized for one
  // velocity and applied at another does unbudgeted work, and the sign
  // of the error follows the ball's spin about the rail-tangent axis:
  // topspin lost energy, backspin GAINED it.
  //
  // Measured before this fix: a 3 m/s ball with maximum draw arrived at
  // the rail at 2.82 m/s, left at 2.15, and then accelerated to 3.44 —
  // faster than it arrived — and ran 1.75 m back up a table it would
  // otherwise have crossed 8 cm of. 22% of draw shots ended with more
  // energy on the table than the cue put into them, worst case 1.72x,
  // and the model produced 395 rad/s of english against a miscue limit
  // of 229. A light draw into a rail is a beginner's shot, and a ball
  // speeding up after hitting a wall reads as broken, not as physics.
  //
  // The contact point's own normal velocity is un = vn + R sin(theta) wt,
  // and an impulse there moves it against an effective mass that
  // includes the arm: 1/m_eff = 1/m + (R sin(theta))^2 / I, which for a
  // solid sphere is (1 + 5/2 sin^2(theta))/m. Sizing the impulse from
  // those two makes the normal energy change exactly
  // -(1 - e^2)/2 * m_eff * un^2, which cannot be positive. Nothing else
  // changes: the moment arm, and so the topspin-into-speed behaviour
  // this file was built for, is untouched.
  const un = vn + R * SIN_CUSHION * wt;

  // THE CONTACT POINT SEPARATES WHILE THE CENTRE STILL GOES IN.
  //
  // With enough spin about the rail-tangent axis, R sin(theta) w_t can
  // exceed the approach speed and the contact point is already moving
  // away from the rail — the model has nothing to compress and so no
  // impulse to give. This used to return, and returning was a bug with
  // teeth: the ball is still travelling into the wall, so the swept
  // solver finds the same contact again at t = 0, resolves it to
  // nothing, and burns its sixteen-iteration guard on zero-length steps.
  // The substep then ends with NO BALL HAVING MOVED — every ball on the
  // table, not just this one — and it repeats every substep until cloth
  // friction changes the spin enough to let the contact resolve. Bo
  // found it as "hit it hard and the ball stops dead at the rail for a
  // moment, same every time from the same angle": measured at up to
  // 1.1 seconds of a frozen table, on a ball still carrying 1.4 m/s.
  //
  // A rail cannot be passed through whatever the spin is doing, so the
  // degenerate case takes away exactly the motion into it and nothing
  // else: no restitution (there is no compression to give any back), no
  // torque (the impulse acts at the centre, so it cannot pretend to a
  // moment arm the contact model has just said is separating), no
  // friction. The ball keeps its speed along the cushion and runs down
  // it, which is what a ball climbing the nose does. Energy strictly
  // falls, by exactly the normal half of it.
  if (un >= 0) {
    ball.vx -= vn * nx;
    ball.vy -= vn * ny;
    world.events.push({ type: "cushion", ball: ball.id, wall, t: world.time, speed });
    return;
  }

  const mEff = m / (1 + 2.5 * SIN_CUSHION * SIN_CUSHION);
  const jn = (1 + e) * -un * mEff;

  const vt = ball.vx * tx + ball.vy * ty;
  const ut = vt - R * (SIN_CUSHION * wn + COS_CUSHION * wz);
  let jt = (-ut * 2 * m) / 7;
  const cap = MU_CUSHION * jn;
  if (Math.abs(jt) > cap) jt = Math.sign(jt) * cap;

  ball.vx += (jn / m) * nx + (jt / m) * tx;
  ball.vy += (jn / m) * ny + (jt / m) * ty;

  // Spin changes, in the cushion frame, then rotated back out.
  const k = 5 / (2 * m * R);
  const dwn = -k * SIN_CUSHION * jt;
  const dwt = k * SIN_CUSHION * jn;
  const dwz = -k * COS_CUSHION * jt;
  ball.wx += dwn * nx + dwt * tx;
  ball.wy += dwn * ny + dwt * ty;
  ball.wz += dwz;

  world.events.push({ type: "cushion", ball: ball.id, wall, t: world.time, speed });
}

// ---------------------------------------------------------------------
// Stepping
// ---------------------------------------------------------------------

/** Earliest time in [0, dt] at which two balls touch, or Infinity. */
function ballTOI(a, b, dt) {
  const px = b.x - a.x;
  const py = b.y - a.y;
  const vx = b.vx - a.vx;
  const vy = b.vy - a.vy;
  const A = vx * vx + vy * vy;
  if (A === 0) return Infinity;
  const B = 2 * (px * vx + py * vy);
  if (B >= 0) return Infinity; // separating
  const C = px * px + py * py - TWO_R * TWO_R;
  if (C < 0) return 0; // already overlapping: resolve now
  const disc = B * B - 4 * A * C;
  if (disc < 0) return Infinity;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= dt ? t : Infinity;
}

function cushionTOI(b, world, dt) {
  let best = Infinity;
  let hit = null;
  // A wall counts only where there is cushion at the point the ball
  // would reach it; inside a pocket mouth the ball carries on past the
  // rail line, toward the capture circle.
  const check = (t, nx, ny, wall) => {
    if (!(t >= 0 && t <= dt && t < best)) return;
    const along = wall === "left" || wall === "right" ? b.y + b.vy * t : b.x + b.vx * t;
    if (!onCushion(world, wall, along)) return;
    best = t;
    hit = { nx, ny, wall };
  };
  if (b.vx < 0) check((R - b.x) / b.vx, 1, 0, "left");
  if (b.vx > 0) check((world.length - R - b.x) / b.vx, -1, 0, "right");
  if (b.vy < 0) check((R - b.y) / b.vy, 0, 1, "top");
  if (b.vy > 0) check((world.width - R - b.y) / b.vy, 0, -1, "bottom");

  // The jaws: fixed points the ball meets at one radius. Ray against a
  // circle of radius R around each, taking only approaching contacts.
  const A = b.vx * b.vx + b.vy * b.vy;
  if (A > 0) {
    for (const j of world.cushions.jaws) {
      const px = b.x - j.x;
      const py = b.y - j.y;
      const B = 2 * (px * b.vx + py * b.vy);
      if (B >= 0) continue;
      const C = px * px + py * py - R * R;
      let t;
      if (C < 0) t = 0;
      else {
        const disc = B * B - 4 * A * C;
        if (disc < 0) continue;
        t = (-B - Math.sqrt(disc)) / (2 * A);
      }
      if (t >= 0 && t <= dt && t < best) {
        const qx = b.x + b.vx * t - j.x;
        const qy = b.y + b.vy * t - j.y;
        const d = Math.hypot(qx, qy) || 1e-9;
        best = t;
        hit = { nx: qx / d, ny: qy / d, wall: "jaw" };
      }
    }
  }
  return { t: best, hit };
}

/**
 * Advance the world by dt seconds.
 *
 * Structure per substep: apply cloth friction once (velocities), then
 * move positions with a swept solver that advances to the exact instant
 * of each impact and resolves it before continuing. StoneFlick could get
 * away with move-then-push-apart because a stone that overlaps by a
 * millimetre still leaves the board; here a millimetre of overlap is a
 * fraction of a degree of cut angle, and a fraction of a degree is the
 * difference between a score and a miss three cushions later. The swept
 * step is the cheapest way to not have that error.
 */
export function stepWorld(world, dt) {
  let remaining = dt;
  while (remaining > 1e-12) {
    const h = Math.min(SUB_DT, remaining);
    remaining -= h;

    for (const b of world.balls) if (!b.pocketed) applyCloth(b, h, world);

    let t = 0;
    let guard = 0;
    while (t < h && guard++ < 16) {
      let best = h - t;
      let kind = null;
      let ia = -1;
      let ib = -1;
      let cushionHit = null;

      const balls = world.balls;
      for (let i = 0; i < balls.length; i++) {
        if (balls[i].pocketed) continue;
        // A ball at rest meets nothing on its own; only the moving ones
        // are swept, which is most of the saving on a sixteen-ball table
        // where twelve are usually still.
        const moving = balls[i].vx !== 0 || balls[i].vy !== 0;
        if (moving) {
          const c = cushionTOI(balls[i], world, best);
          if (c.t < best) {
            best = c.t;
            kind = "cushion";
            ia = i;
            cushionHit = c.hit;
          }
        }
        for (let j = i + 1; j < balls.length; j++) {
          if (balls[j].pocketed) continue;
          if (!moving && balls[j].vx === 0 && balls[j].vy === 0) continue;
          const tb = ballTOI(balls[i], balls[j], best);
          if (tb < best) {
            best = tb;
            kind = "ball";
            ia = i;
            ib = j;
          }
        }
      }

      for (const b of balls) {
        if (b.pocketed) continue;
        b.x += b.vx * best;
        b.y += b.vy * best;
      }
      t += best;
      world.time += best;

      if (kind === "cushion") {
        resolveCushion(balls[ia], cushionHit.nx, cushionHit.ny, world, cushionHit.wall);
      } else if (kind === "ball") {
        resolveBallBall(balls[ia], balls[ib], world);
      } else {
        break;
      }
    }

    // THE GUARD MUST NOT COST THE SUBSTEP.
    //
    // Sixteen contacts inside one 1/600s substep means something is
    // wrong, and the guard is right to stop iterating. What it must not
    // do is leave here with time unspent: every ball would stand still
    // for the whole substep, and a degenerate contact on ONE ball would
    // freeze the entire table (it did — see resolveCushion's note on
    // un >= 0). Spend what is left at the velocities we have. The worst
    // case is one substep of overlap, which clampPositions below nudges
    // out; the alternative is a table that stops.
    if (t < h) {
      const rest = h - t;
      for (const b of world.balls) {
        if (b.pocketed) continue;
        b.x += b.vx * rest;
        b.y += b.vy * rest;
      }
      world.time += rest;
    }

    capture(world);

    // Belt and braces: numerical drift can still leave a ball a hair
    // outside or a hair overlapped. Nudge, do not bounce — bouncing here
    // would double-count an impulse the swept step already applied.
    clampPositions(world);
  }
  return world;
}

/**
 * Take off the table any ball whose centre is inside a pocket's circle.
 * Recorded as an event, because rules.js reads the log: which ball, which
 * pocket, when — and in particular whether it was the cue ball.
 */
function capture(world) {
  for (const b of world.balls) {
    if (b.pocketed) continue;
    if (b.vx === 0 && b.vy === 0) continue;
    const p = pocketAt(world, b);
    if (!p) continue;
    b.pocketed = true;
    b.vx = 0;
    b.vy = 0;
    b.wx = 0;
    b.wy = 0;
    b.wz = 0;
    b.x = p.x;
    b.y = p.y;
    world.events.push({ type: "pocket", ball: b.id, pocket: p.id, t: world.time });
  }
}

function clampPositions(world) {
  for (const b of world.balls) {
    if (b.pocketed) continue;
    // Only where there is cushion to clamp against: inside a mouth the
    // ball is allowed past the rail line, that is what a mouth is.
    if (b.x < R && onCushion(world, "left", b.y)) b.x = R;
    else if (b.x > world.length - R && onCushion(world, "right", b.y)) b.x = world.length - R;
    if (b.y < R && onCushion(world, "top", b.x)) b.y = R;
    else if (b.y > world.width - R && onCushion(world, "bottom", b.x)) b.y = world.width - R;
  }
  const balls = world.balls;
  for (let i = 0; i < balls.length; i++) {
    if (balls[i].pocketed) continue;
    for (let j = i + 1; j < balls.length; j++) {
      if (balls[j].pocketed) continue;
      const a = balls[i];
      const b = balls[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < TWO_R) {
        const push = (TWO_R - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }
}

/** Run to rest (or the cutoff) and return the world. Used by the AI and
 * by every test that asks "where did this shot end up". */
export function simulateToRest(world, maxSeconds = MAX_SHOT_SECONDS) {
  let elapsed = 0;
  while (elapsed < maxSeconds && !isAtRest(world)) {
    stepWorld(world, SUB_DT);
    elapsed += SUB_DT;
  }
  for (const b of world.balls) {
    b.vx = 0;
    b.vy = 0;
    b.wx = 0;
    b.wy = 0;
    b.wz = 0;
  }
  return world;
}

/** Total kinetic energy, translational + rotational. Tests use it to
 * assert that nothing in here ever adds energy to the table. */
export function kineticEnergy(world) {
  let e = 0;
  for (const b of world.balls) {
    if (b.pocketed) continue;
    const v2 = b.vx * b.vx + b.vy * b.vy;
    const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
    e += 0.5 * BALL_MASS * v2 + 0.5 * (2 / 5) * BALL_MASS * R * R * w2;
  }
  return e;
}
