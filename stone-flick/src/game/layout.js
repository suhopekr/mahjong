// game/layout.js
// The one place board units ([0,1] x [0,1], game/physics.js's world) are
// converted to CSS pixels. Pure math, no DOM — Node-tested.
//
// Gomoku's equivalent file wrapped core/grid.js because its board was
// counted in intersections and its layout had to solve a self-referential
// padding inequality (a stone sits ON an edge point, so padding had to
// reserve the stone's own radius, but the radius came from a cellSize
// that padding itself determined). The same problem exists here for a
// different reason and has the same shape of answer, so the reasoning is
// worth restating rather than re-deriving:
//
//   A stone is only removed once its CENTER leaves the board
//   (game/physics.js's checkRemoval), so a stone teetering half over the
//   side is legal, on-screen, and the most dramatic moment in the game.
//   The canvas therefore has to reserve a full stone radius OUTSIDE the
//   wooden square on every side, or that stone gets clipped at exactly
//   the moment the player is staring at it.
//
//   size = min(w, h) - 2 * (STONE_RADIUS * size)
//     =>  size = min(w, h) / (1 + 2 * STONE_RADIUS)
//
// Solved as an equality rather than iterated, and with no slack, so the
// board stays as large as it can on a phone.
//
// core/grid.js is deliberately NOT used: its computeLayout() counts cells
// and its nearestDot() snaps to a lattice. Alkkagi stones live at
// continuous positions, so a lattice hit test would be actively wrong —
// the grid here is decoration (it is what makes the surface read as a
// goban), not a coordinate system.

import { STONE_RADIUS } from "./physics.js";

/** Goban lines drawn on the board surface. 19 is the real thing; it is
 * purely cosmetic here, which is why it is a plain constant and not a
 * per-stage option. */
export const GRID_LINES = 19;

/** How far the ruled grid is inset from the wooden square's own edge, in
 * board units — a real goban's lines stop short of the wood. */
export const GRID_INSET = 0.055;

/**
 * @param {number} width - canvas CSS width
 * @param {number} height - canvas CSS height
 * @returns {{size:number, originX:number, originY:number, scale:number,
 *            width:number, height:number, stoneRadiusPx:number}}
 *   `size` is the wooden square's side in px; (originX, originY) its
 *   top-left corner; `scale` px per board unit (identical to `size`,
 *   exported under its own name because call sites that convert a
 *   VELOCITY or a drag length are not talking about the board's size).
 */
export function boardLayout(width, height) {
  const size = Math.max(1, Math.min(width, height) / (1 + 2 * STONE_RADIUS));
  return {
    size,
    scale: size,
    originX: (width - size) / 2,
    originY: (height - size) / 2,
    width,
    height,
    stoneRadiusPx: STONE_RADIUS * size,
  };
}

/** Board units -> canvas CSS px. */
export function toPx(layout, bx, by) {
  return { x: layout.originX + bx * layout.scale, y: layout.originY + by * layout.scale };
}

/** Canvas CSS px -> board units. Deliberately unclamped: the input layer
 * needs to know how far PAST the board the pointer has been dragged (that
 * is the pull-back distance), so clamping here would silently cap power. */
export function toBoard(layout, px, py) {
  return { x: (px - layout.originX) / layout.scale, y: (py - layout.originY) / layout.scale };
}

/**
 * The stone under a pointer, or null. Uses a generous grab radius (1.5x
 * the stone) because on a phone the finger is bigger than the stone and
 * an unresponsive first tap reads as a broken game; ties are broken by
 * true distance so overlapping stones still resolve to the nearer one.
 * @param {{id:number,x:number,y:number,alive:boolean}[]} stones - already
 *   filtered to the ones the caller considers legal to pick
 */
export function stoneAtPoint(layout, stones, px, py, grabFactor = 1.5) {
  const { x: bx, y: by } = toBoard(layout, px, py);
  const grab = STONE_RADIUS * grabFactor;
  let best = null;
  let bestDist = Infinity;
  for (const s of stones) {
    const d = Math.hypot(s.x - bx, s.y - by);
    if (d <= grab && d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/**
 * How far the pointer must be dragged, in board units, for a full-power
 * shot.
 *
 * This is NOT a feel preference — it is a reachability constraint, and
 * the first version got it wrong. At 0.33 a player on a desktop could not
 * reach full power at all, which is a bug of the worst kind: nothing
 * errors, the game just quietly refuses to do its loudest thing.
 *
 * The arithmetic, from a real 850px board in a 1300px-tall window. Your
 * stones start on the bottom home row (y = 0.86) and shoot UP, so the
 * pull-back goes DOWN, and the room below them is:
 *
 *   inside the canvas   (1 + STONE_RADIUS) - 0.86 = 0.174 board widths
 *   below the canvas    113px / 850px           = 0.133 board widths
 *   ------------------------------------------------------------------
 *   total                                         0.307 board widths
 *
 * Against a 0.33 requirement that caps out at 93% power, and worse for
 * any stone that has been knocked back toward the edge — exactly the
 * stone that most needs a full-strength shot to reach anything.
 *
 * 0.16 clears it at every viewport the screen check covers (the pointer
 * is captured, so the drag may leave the canvas; what it cannot leave is
 * the window). test/screens.mjs measures the real reachable distance from
 * a real home-row stone rather than trusting this comment.
 *
 * The cost is drag resolution on a small board — 0.16 is only ~56px on a
 * 390px phone. That is the right side of the trade: a coarse power dial
 * is a usability complaint, an unreachable one is a broken control.
 */
export const MAX_DRAG = 0.16;

/** Below this the release is treated as a mis-tap, not a shot. */
export const MIN_DRAG = 0.02;

/**
 * The same escape hatch, sized for a finger.
 *
 * MIN_DRAG is 0.02 of the board, which is ~16px under a mouse on a
 * desktop board and ~6px on a phone — and the whole of that 6px is
 * underneath the fingertip that is drawing it. So on a phone the cancel
 * zone was, in practice, invisible AND unreachable: a player who changed
 * their mind pulled back toward the stone, could not see whether they
 * were inside it, twitched, and spent the turn on a dribble.
 *
 * Expressed as a FRACTION OF THE FULL-POWER PULL rather than as a pixel
 * count, because the thing it has to stay in proportion to is the range
 * it is eating. At 0.35 the softest shot still available is
 * 0.35 ** POWER_CURVE = 21% power — a gentle nudge is still on the dial —
 * and the boundary sits ~17px out on a phone, which is the edge of a
 * contact patch rather than the middle of one.
 *
 * Touch only. A mouse pointer is a pixel and hides nothing, so the
 * desktop threshold stays where it was: widening it there would delete
 * soft shots to solve a problem that does not exist.
 */
export const MIN_DRAG_TOUCH = MAX_DRAG * 0.35;

/**
 * How the drag distance is bent before it becomes power.
 *
 * WHY IT IS NOT 1 (linear). The simulation's speed range is wide — a
 * struck stone leaves at 6 px/frame at a quarter pull and 25 at a full
 * one on a 900px board — but a LINEAR dial spends most of its travel in
 * the top half of that range, because reaching anything at all wants a
 * long pull. In play that meant nearly every shot was thrown somewhere
 * between half and full power, and half to full is only a two-to-one
 * speed difference: not enough for the eye to call one shot hard and
 * another soft. The complaint "they all move about the same" was a
 * complaint about the CONTROL CURVE, not about the physics.
 *
 * An exponent above 1 pushes the same drag travel down into the slow end:
 * a half pull now launches at 35% rather than 50%, so a gentle shot is
 * genuinely gentle, while a full pull is untouched. The range a player
 * actually uses widens from about 2:1 to about 6:1.
 *
 * The top of the curve is fixed at 1 on purpose. MAX_FLICK_SPEED and
 * FRICTION_DECEL — and therefore every stage's par, every balance
 * measurement and everything the AI can do — are unchanged by anything in
 * here: this is the human's input mapping and nothing else reads it.
 */
export const POWER_CURVE = 1.5;

/**
 * How far past the cancel zone the pointer has to come back out before
 * the shot is live again, as a fraction of the full-power pull.
 *
 * THE CANCEL ZONE IS A SCHMITT TRIGGER, and it has to be, because the
 * signal is a thumb. Measured on the device this was reported from —
 * an iPhone 16 Pro, 402pt across 67mm — the whole power dial is 8.3mm of
 * travel and the centroid of a thumb moves 2 to 3mm just in being lifted
 * off the glass. A cancel zone drawn as a single radius therefore cannot
 * work at any size: small enough to leave room for the dial and the
 * release itself walks out of it, large enough to survive the release and
 * there is no dial left.
 *
 * Two thresholds instead of one. Coming within `minDrag` of the stone
 * ARMS the cancel — a deliberate act, you pulled back and came home — and
 * it then stays armed across everything up to this much travel, so the
 * lift-off wobble cannot undo it. Pulling back out past this disarms it
 * again, which is what keeps changing your mind twice possible.
 *
 * 0.6 of full power is 31pt, about 5mm: comfortably outside the noise and
 * unmistakably a decision.
 */
export const CANCEL_RELEASE = 0.6;

/**
 * Turn a pull-back drag into a shot. The slingshot convention: the stone
 * flies OPPOSITE the drag, so pulling down-left shoots up-right.
 *
 * `minDrag` is where power starts, not merely where it stops being
 * ignored. The dead zone used to be a separate test applied afterwards,
 * which meant the first 35% of a touch player's travel produced shots
 * between 0 and 21% power that were then thrown away as mis-taps — the
 * gentlest third of the dial existed and was unreachable. Subtracting it
 * here instead spreads the whole 0..1 range over the travel that is
 * actually usable, so widening the cancel zone costs no shots at all.
 *
 * @param {number} [minDrag] the drag at which power is still zero
 * @returns {{dirX:number, dirY:number, power:number, dragLength:number}}
 */
export function dragToShot(stoneX, stoneY, pointerBoardX, pointerBoardY, minDrag = MIN_DRAG) {
  const dx = pointerBoardX - stoneX;
  const dy = pointerBoardY - stoneY;
  const dragLength = Math.hypot(dx, dy);
  const span = Math.max(1e-6, MAX_DRAG - minDrag);
  const pull = Math.min(1, Math.max(0, (dragLength - minDrag) / span));
  const power = pull ** POWER_CURVE;
  return { dirX: -dx, dirY: -dy, power, dragLength };
}

/**
 * dragToShot()'s inverse: the drag that produces a given power.
 *
 * Exported because three places synthesise a shot rather than receiving
 * one — the briefing demos, the trailer recorder and the shot search —
 * and each of them had its own copy of `MAX_DRAG * power ** (1/CURVE)`.
 * That was correct until the line above gained a floor, at which point
 * every copy quietly started drawing a pull-back that did not match the
 * shot it was labelled with.
 */
export function shotToDrag(power, minDrag = MIN_DRAG) {
  const span = Math.max(0, MAX_DRAG - minDrag);
  return minDrag + span * Math.max(0, Math.min(1, power)) ** (1 / POWER_CURVE);
}
