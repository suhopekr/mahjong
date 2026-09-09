// game/layout.js
// The one place table metres become CSS pixels. Pure math, no DOM.
//
// THE ONE DECISION IN THIS FILE THAT MATTERS
// A billiard table is 2:1. A phone held upright is about 1:2. Drawn without
// thinking, a 2:1 table inside a 1:2 window is a letterboxed strip across
// the middle using a fifth of the screen — which is exactly the bug
// StoneFlick hit from the other direction (its square board squashed into
// a 215px band on a wide screen, kickoff note #4). So the table ROTATES:
// its long axis always runs along the screen's long axis. Portrait gets a
// vertical table, landscape a horizontal one, and both are as large as
// the window allows.
//
// Physics never hears about this. game/physics.js works in table
// coordinates — x along the 2.84m length, y across the 1.42m width — and
// rotation lives entirely in toPx/toTable. A shot simulated on a phone
// and the same shot on a desktop are the same shot, which is what makes
// the AI's plans and (later) a server's replay valid on both.

import { TABLE_LENGTH, TABLE_WIDTH, BALL_RADIUS } from "./physics.js";

/** Wooden rail width, in table metres, drawn outside the playing surface.
 * Real billiard rails are around 12cm from nose to outer edge; 0.11 leaves
 * room for the diamonds without stealing cloth. */
export const RAIL = 0.11;

/**
 * The 당점 dial's size and the strip of canvas it owns.
 *
 * The dial gets its own real estate rather than floating over the cloth.
 * The floating version was tried first and it is wrong for a reason that
 * only shows up once you place the balls: the corners of a billiard table
 * are where the hardest shots live, and a translucent widget sitting on
 * one is covering the exact ball the player is squinting at. Reserving a
 * strip costs about 8% of the table's size. Covering a corner costs the
 * shot.
 */
/**
 * Do the controls stand in a COLUMN beside the table, or a band under it?
 *
 * It used to be "landscape: column, portrait: band", which is the same
 * question as the table's orientation and not the same question at all.
 * A portrait TABLET proved it: at 768x1024 the 1:2 table is fitted to the
 * height the band leaves and then cannot use the width, so the game drew
 * a 292x541 table with 476px of black beside it — 20% of the window,
 * the worst of any shape we ship to.
 *
 * The real question is which way the screen has room to spare. A phone
 * held upright is about 1:1.9 and the table is 1:2, so the shapes nearly
 * match: there is no width to give a column, and the band under the
 * table is also where the thumbs are. A tablet held upright is 3:4 and
 * the table cannot use half of it, so the column is free.
 *
 * 0.72 is between the two: the widest portrait phone canvas we measure
 * is 0.68 and the narrowest portrait tablet is 0.78.
 */
/**
 * The spin dial's radius, and through it the whole control block: the
 * buttons are 0.92 of it, the padding 0.45, and the strip the table is
 * fitted around is what they add up to.
 *
 * It was 0.1 of the short side, clamped to 30..58, and that is a large
 * control: 78px across on a 390px phone, a fifth of the screen for a
 * thing the player touches once a shot — while the table, the thing they
 * look at for the whole shot, was 278px wide with a 6px ball. The dial
 * only has to be big enough to place a tip inside it, and the number
 * that decides whether it can be TOUCHED is the hit radius, which is
 * 1.35 of this and stays over 44px at every size we ship.
 */
const DIAL_R = (width, height) =>
  Math.max(28, Math.min(50, Math.min(width, height) * 0.085));

export function sideControls(width, height) {
  if (height <= width) return true;
  // Portrait: by SHAPE, not by which placement measures bigger. Measuring
  // was tried and it is worse where it matters — the two ways come out
  // within a few per cent on a phone, so a 360px phone got a column and
  // a 375px one got a band, which is a control layout that moves between
  // devices for no reason a player can see. Shape is monotone: the wider
  // the screen relative to its height, the more certainly the 1:2 table
  // cannot use that width, and 0.72 sits in the gap between the widest
  // portrait phone canvas we measure (0.68) and the narrowest portrait
  // tablet (0.78). trialScale() below is what found the number.
  return width / height >= 0.72;
}

/** The scale each control placement would leave for the table. */
function trialScale(side, width, height) {
  const r = DIAL_R(width, height);
  const pad = r * 0.45;
  const btn = r * 0.92;
  const laneRow = side ? 0 : btn * 0.86 + btn * 0.55;
  const reserve = 2 * r + 2 * pad + laneRow + EDGE_GUARD_PX;
  const m = playMargin(width, height);
  const availW = width - (side ? reserve + m : 2 * m);
  const availH = height - (side ? 2 * m : reserve + m);
  const rotated = height > width;
  const boxW = rotated ? TABLE_WIDTH + 2 * RAIL : TABLE_LENGTH + 2 * RAIL;
  const boxH = rotated ? TABLE_LENGTH + 2 * RAIL : TABLE_WIDTH + 2 * RAIL;
  return Math.max(1, Math.min(availW / boxW, availH / boxH));
}


export function dialMetrics(width, height) {
  const r = DIAL_R(width, height);
  const pad = r * 0.45;
  // Portrait gives the power lane a row of its own under the dial, and
  // that row is the reason this returns a third number.
  //
  // It was in the same row to begin with, tucked in beside the arrows,
  // and on the smallest phone we ship to that left it 71 pixels long —
  // a fader you cannot place your thumb on, let alone repeat a stroke
  // with. The row costs about a tenth of the table's height on that
  // phone and buys a lane the full width of the screen: 340 pixels of
  // travel, at the bottom edge, where the thumbs already are.
  //
  // Landscape pays nothing. There the controls have a whole column, so
  // the lane stands above the arrows in room that was already reserved.
  const btn = r * 0.92;
  const laneRow = sideControls(width, height) ? 0 : btn * 0.86 + btn * 0.55;
  // Both orientations reserve the strip the system keeps for itself. In
  // portrait the dial ends the block at the bottom of the screen; in
  // landscape it ends the column at the right of it. A drag that starts
  // in either strip is a drag that never reaches the game. See
  // EDGE_GUARD_PX.
  const guard = EDGE_GUARD_PX;
  return { r, pad, laneRow, reserve: 2 * r + 2 * pad + laneRow + guard };
}

/**
 * @returns {{scale:number, originX:number, originY:number, rotated:boolean,
 *            width:number, height:number, ballPx:number, railPx:number}}
 *   `scale` is px per table metre. (originX, originY) is the top-left of
 *   the PLAYING SURFACE (cushion nose), not of the wooden frame.
 */
/**
 * Room around the table for the stroke itself.
 *
 * Not a margin for looks. The pull is a real gesture with a real length,
 * and it starts wherever the player presses — so if the table runs to the
 * window edge, a cue ball near that edge has no room behind it for the
 * hand. Measured before this existed: full power was unreachable from 12%
 * of (position, direction) pairs on a phone and 9.8% in the portal's own
 * desktop frame. Nothing errors; the shot is simply not available, and
 * the player's report is "I cannot pull the cue back".
 *
 * The bottom strip the dial and nudges live in is drag surface too — only
 * the buttons themselves swallow a press — so this margin is on top of it.
 *
 * RAISED FROM 0.055 TO 0.11 while the pull-back drag still existed, and
 * kept afterwards. The pull is gone — power lives on its own lane now —
 * but the margin still buys the thing it was raised for: room for a hand
 * to work beside a ball sitting on the cushion, which the aim drag needs
 * exactly as much as the pull did.
 */
export function playMargin(width, height) {
  return Math.max(
    MARGIN_MIN,
    Math.min(MARGIN_MAX, MARGIN_FRACTION * Math.min(width, height))
  );
}

/** Tuned in one place — see the reachability measurements above. */
const MARGIN_FRACTION = 0.11;
const MARGIN_MIN = 22;
const MARGIN_MAX = 96;

export function tableLayout(width, height) {
  const rotated = height > width;
  const dial = dialMetrics(width, height);
  const m = playMargin(width, height);
  // The dial's strip comes off the short axis in landscape (where there
  // is width to spare next to a 2:1 table) and off the long axis in
  // portrait (where the table is width-limited and the spare room is
  // vertical). Either way it is taken BEFORE the table is measured, so
  // the table can never be drawn under it.
  // The margin is asymmetric on purpose. It exists to give the stroke
  // somewhere to happen, and the strip the dial and nudges live in is
  // already that — only the buttons themselves swallow a press, the rest
  // of it is drag surface. Reserving a margin on top of the strip is
  // paying twice for the same room, and on a phone it was costing 20% of
  // the table to do it.
  // The strip comes off whichever axis the controls stand on, which is
  // not the same question as which way the table is turned — see
  // sideControls(). Either way it is taken BEFORE the table is measured,
  // so the table can never be drawn under it.
  const side = sideControls(width, height);
  const availW = width - (side ? dial.reserve + m : 2 * m);
  const availH = height - (side ? 2 * m : dial.reserve + m);
  const along = TABLE_LENGTH + 2 * RAIL;
  const across = TABLE_WIDTH + 2 * RAIL;
  const boxW = rotated ? across : along;
  const boxH = rotated ? along : across;
  const scale = Math.max(1, Math.min(availW / boxW, availH / boxH));
  const drawnW = boxW * scale;
  const drawnH = boxH * scale;
  return {
    scale,
    rotated,
    side,
    width,
    height,
    // Centred in what is left, which the series has done since Dots and Boxes.
    originX: m + (availW - drawnW) / 2 + RAIL * scale,
    originY: m + (availH - drawnH) / 2 + RAIL * scale,
    ballPx: BALL_RADIUS * scale,
    railPx: RAIL * scale,
  };
}

/** Table metres -> canvas CSS px.
 * Rotated: the head of the table (x = 0) sits at the BOTTOM of a portrait
 * screen, because that is where the player is standing. */
export function toPx(L, x, y) {
  if (L.rotated) {
    return {
      x: L.originX + y * L.scale,
      y: L.originY + (TABLE_LENGTH - x) * L.scale,
    };
  }
  return { x: L.originX + x * L.scale, y: L.originY + y * L.scale };
}

/** Canvas CSS px -> table metres. Unclamped on purpose: the aiming drag
 * needs to know how far PAST the cushion the pointer went, and clamping
 * here would silently cap power near a rail — which is precisely where a
 * player most often needs a hard shot. */
export function toTable(L, px, py) {
  if (L.rotated) {
    return {
      x: TABLE_LENGTH - (py - L.originY) / L.scale,
      y: (px - L.originX) / L.scale,
    };
  }
  return { x: (px - L.originX) / L.scale, y: (py - L.originY) / L.scale };
}

/** A direction in table space -> the same direction in screen space.
 * Directions rotate but do not translate, so they need their own
 * conversion; using toPx on a vector is a classic and silent bug. */
export function dirToScreen(L, dx, dy) {
  return L.rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
}

/** A direction in screen space -> table space. */
export function dirToTable(L, dx, dy) {
  return L.rotated ? { x: -dy, y: dx } : { x: dx, y: dy };
}

/**
 * THE PLAYER PICKS UP THE CUE AND TURNS IT. THAT IS THE WHOLE CONTROL.
 *
 * Four attempts at this ended here. The slingshot mapped aim and power
 * onto one vector so they fought over it. Damping the aim as the pull
 * grew left the line moving and said nothing about when the player had
 * committed. Freezing it at 60px stopped the fighting and still asked a
 * hand to hold a position in two dimensions. Pointing the line AT the
 * finger was simple to explain and wrong in the hand: the stick is drawn
 * on the far side of the ball, so pressing on it threw it across the
 * table before the drag had begun.
 *
 * So the grab target is the STICK, and the turn is RELATIVE. The pointer
 * is a hand on the butt: wherever it presses, the cue does not move, and
 * turning that hand by five degrees around the ball turns the cue by
 * five degrees. Three things fall out of that and each one was a bug in
 * an earlier version.
 *
 * Nothing jumps on contact, because a press is worth zero rotation.
 *
 * Precision comes free with distance — a hand near the tip turns the cue
 * fast, a hand out at the butt turns it slowly — and it is the same
 * lever a real player uses, so nobody has to be told.
 *
 * And there is no direction the geometry can refuse. An absolute aim can
 * only point where the finger can physically go, so a ball frozen on the
 * bottom rail could not be aimed up the table: the hand would have to be
 * off the screen. A rotation has no such end — the aim is turned in as
 * many sweeps as it takes.
 */
export function angleAround(ballX, ballY, tableX, tableY) {
  return Math.atan2(tableY - ballY, tableX - ballX);
}

/** Fold an angle into (-pi, pi], so a turn across the back of the ball is
 * a small delta and not a lap. */
export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Closer to the ball's centre than this, the angle around it is all
 * jitter — one pixel across the middle is half a circle of aim — so the
 * turn is not read and the cue holds still. */
export const AIM_PIVOT_MIN_PX = 14;

/** The cue's drawn length in table metres. A real cue is 1.45m against a
 * 1.42m table and reads as a plank; 0.95 keeps the proportion believable.
 * Shared with render.drawCue(), because the thing you can grab and the
 * thing you can see have to be the same object. */
export const CUE_LENGTH_M = 0.95;

/** How far either side of the stick still counts as holding it. A cue is
 * about 8px wide on a phone and a finger is not, so the target is the
 * finger's size rather than the stick's — the drawing is the smaller,
 * prettier thing inside it. */
/**
 * Half the width of the band that counts as "on the cue", in px.
 *
 * 26 was a fingertip's half-width and no more, which is the right floor
 * for a target you can SEE and the wrong one for this: the stick is a
 * thin diagonal line whose direction changes every shot, so the player
 * is not aiming at a known place, they are reaching for something that
 * moved. Reported on a phone as the cue simply not answering. 36 makes
 * the band 72px across against a 128-177px stick on a phone — still
 * comfortably inside the cloth, and nothing else is hit-tested there:
 * the dial, the arrows and the lane are all tested first.
 */
export const CUE_GRAB_HALF_PX = 36;

/** In px, for this layout: never narrower than a fingertip, and never
 * narrower than the ball itself — on a big screen the ball is the thing
 * the eye is measuring the stick against. */
export const cueGrabHalf = (L) => Math.max(CUE_GRAB_HALF_PX, L.ballPx * 1.25);

/**
 * Is this press ON the cue?
 *
 * A capsule laid along the stick, from just behind the ball to the end of
 * the butt. It replaced a circle around the cue ball, which was the right
 * target while the gesture was a pull — you pull from where the ball is —
 * and the wrong one for a turn: a ring around the ball includes the
 * cloth in FRONT of it, where there is nothing to hold, and stops short
 * of the butt, which is where a hand actually goes.
 */
export function withinCue(L, ball, angle, power, px, py) {
  const p = toPx(L, ball.x, ball.y);
  const d = dirToScreen(L, -Math.cos(angle), -Math.sin(angle));
  const half = cueGrabHalf(L);
  const vx = px - p.x;
  const vy = py - p.y;
  const along = vx * d.x + vy * d.y;
  const across = Math.abs(-vx * d.y + vy * d.x);
  // From the ball's own edge, not from the tip: at rest the tip sits a
  // ball's width off the white and the gap between them is not a place
  // anyone would expect to be dead.
  // A little past the butt as well. A hand reaching for the end of a
  // stick lands where the stick ENDS, and the pixel after it was dead.
  const end = cueTipGap(L, power) + CUE_LENGTH_M * L.scale + half * 0.5;
  return along >= L.ballPx * 0.8 && along <= end && across <= half;
}

/** Ball centre to cue tip, in px. Tracks the PULL rather than the power,
 * which is what makes the draw-back legible — see render.drawCue(). */
export function cueTipGap(L, power) {
  return L.ballPx * (1.15 + pullForPower(power) * 12);
}

/**
 * THE POWER CURVE, IN TWO SEGMENTS, AND WHY THE KNEE MOVED.
 *
 * Almost every shot in the campaign is played between 1.4 and 3 m/s out
 * of a range that runs to 6, so the travel has to be spent where the
 * shots are: a linear fader would put the whole game in its first third
 * and sell the rest to a smash nobody plays.
 *
 * The knee used to be at 0.92 — the last 8% of the movement carried
 * everything above half power — and that was right for a PULL, where the
 * end of the travel is the part a hand can barely reach anyway, so
 * spending real distance on it bought nothing. A fader is not a pull.
 * Every part of it is equally reachable, so distance spent up there is
 * distance a thumb can actually use, and the old knee left the whole top
 * half of the range inside twelve pixels on a desktop.
 *
 * 0.72 / 0.42: the working range still gets nearly three quarters of the
 * lane, and the smash gets 40px on the shortest lane we ship instead of
 * 12. A test pins the 22-45% band at 40px on every screen.
 */
export const FINE_PULL = 0.72;
/** Power reached at the end of that band. */
export const FINE_POWER = 0.42;
/** Shape inside it. Slightly above 1 so the very softest taps stay soft. */
export const FINE_CURVE = 1.15;
/** Shape of the smash segment. Above 1 so the join has no slope jump. */
const SMASH_CURVE = 1.35;

/** Pull fraction (0-1) -> power (0-1). */
export function powerForPull(pull) {
  const p = Math.min(1, Math.max(0, pull));
  if (p <= FINE_PULL) return FINE_POWER * (p / FINE_PULL) ** FINE_CURVE;
  const t = (p - FINE_PULL) / (1 - FINE_PULL);
  return FINE_POWER + (1 - FINE_POWER) * t ** SMASH_CURVE;
}

/** The inverse. Used by the cue (which draws the HAND's travel, not the
 * power) and by the layout test's resolution measurements. */
export function pullForPower(power) {
  const q = Math.min(1, Math.max(0, power));
  if (q <= FINE_POWER) return FINE_PULL * (q / FINE_POWER) ** (1 / FINE_CURVE);
  const t = ((q - FINE_POWER) / (1 - FINE_POWER)) ** (1 / SMASH_CURVE);
  return FINE_PULL + (1 - FINE_PULL) * t;
}

export const MIN_SHOT_SPEED = 0.35;

/**
 * How far a press may travel and still count as a TAP.
 *
 * A tap on the cloth plays the shot that is lined up, and a drag near the
 * ball turns the line — the same press can be either, and this is the
 * line between them. Wide enough that a thumb resting on glass does not
 * turn a tap into a two-degree aim change, narrow enough that a real
 * turn of the hand is never mistaken for a tap.
 */
export const TAP_SLOP_PX = 9;

/**
 * Where the 당점 (tip offset) dial lives, in CSS px.
 *
 * It is a separate control rather than something layered onto the aiming
 * drag, and that is a deliberate cost. Every real billiards game on a
 * phone does it this way for one reason: aim and spin are different
 * decisions made at different moments, and a single gesture that sets
 * both makes it impossible to adjust one without disturbing the other.
 * Bottom-right in both orientations: that is where a thumb rests on a
 * phone held in either hand, and on a desktop it is the corner the eye
 * leaves alone while looking at the table.
 */
/**
 * Where the controls sit, as a GROUP.
 *
 * The first version put the dial in the window's corner and stacked the
 * arrows off it, which is the easy thing to compute and the wrong thing
 * to look at: on a desktop it left the whole upper two-thirds of the
 * reserved column empty and shoved every control into the bottom edge,
 * as far from the table as the screen allows.
 *
 * The controls belong to the TABLE, so they are placed against it. In
 * landscape the stack is centred on the table's own middle, so the
 * arrows sit at the height of the cloth rather than under it. In portrait
 * the band is already beside the table's short edge, so only the
 * alignment moves: the dial's outer edge lines up with the table's,
 * rather than with the window's, so the row reads as belonging to the
 * board instead of floating in the corner.
 *
 * Both fall back to the window's edge if the table is so large that the
 * stack would not fit — a clamp, not a layout.
 */
/** How long the power lane is along its own axis, in landscape, where it
 * stands in the column beside the table. Four buttons' worth: long enough
 * that the working range of speeds is a comfortable thumb sweep, short
 * enough that the dial and the arrows still fit under it. Portrait does
 * not use this — there the lane runs the width of the screen. */
const laneLong = (btn) => btn * 4.2;
/** And how wide across it. */
const laneWide = (btn) => btn * 0.86;

function controlStack(L) {
  const { r, pad } = dialMetrics(L.width, L.height);
  const btn = r * 0.92;
  const gap = btn * 0.55;
  /** Between the arrows and the dial: more than the gap between arrow
   * rows, so the dial reads as its own thing rather than a third row. */
  const lead = pad * 1.4;
  const a = toPx(L, 0, 0);
  const b = toPx(L, TABLE_LENGTH, TABLE_WIDTH);
  const edge = {
    right: Math.max(a.x, b.x) + L.railPx,
    bottom: Math.max(a.y, b.y) + L.railPx,
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2,
  };
  if (!L.side) {
    const { laneRow } = dialMetrics(L.width, L.height);
    // THE BAR IS ABOVE THE DIAL, not below it. Both orders put the same
    // two rows under the table; this one puts the control you DRAG
    // furthest from the edge the system watches, and it matches the
    // landscape column, where the lane has always stood above the
    // arrows. The dial is a drag too, so the row it is in keeps its own
    // clearance — 1.35r because that, not r, is what controlAt() calls
    // the dial.
    const cy = Math.min(
      L.height - EDGE_GUARD_PX - r * 1.35,
      edge.bottom + pad + laneRow + r
    );
    const cx = Math.min(L.width - r - pad, edge.right - r);
    return { r, pad, btn, gap, lead, cx, cy };
  }
  // The lane takes what the column has left rather than a fixed multiple
  // of the button. btn scales with the SHORT side of the canvas, so on a
  // phone held sideways — 844x326 — it came out at 116px: a fader with
  // 40px under the 22-45% band, which is the floor, and below it on a
  // 780px phone. The rest of the column is a fixed height; the lane is
  // what the room is for.
  const fixed = gap + btn + lead + 2 * r;
  // Minus what the bottom owes: the guard, and the part of the dial's
  // target that reaches past its drawn edge.
  const room = L.height - pad - EDGE_GUARD_PX - 0.35 * r - fixed;
  // Floor and ceiling, and the floor is where it is because the 22-45%
  // band needs 40px of travel and this lane gives 0.345 of its length to
  // that band. The ceiling keeps every landscape lane one control: the
  // longest may not be more than about 1.5x the shortest, or a stroke
  // that was "halfway up" on one screen is somewhere else on another.
  const laneH = Math.min(190, Math.max(120, Math.max(laneLong(btn), room)));
  const stackH = laneH + fixed;
  // The dial ends the column, and it is a drag: the same clearance the
  // portrait one gets, against the same 1.35r controlAt() answers to.
  const top = Math.max(
    pad,
    Math.min(L.height - EDGE_GUARD_PX - stackH - 0.35 * r, edge.midY - stackH / 2)
  );
  // Beside the table, not against the window. On a 2000px screen the
  // column pinned to the right edge left 155px of black between the rail
  // and the controls, so they read as belonging to the browser rather
  // than to the board. The reserve guarantees this can never overlap the
  // cloth: the table's right edge is at most width - 2r - 2pad.
  // And clear of the side the phone watches too: at width - r - pad the
  // dial's 1.35r target ran past the right edge of the window, which on
  // iOS is Safari's forward swipe.
  const cx = Math.min(L.width - EDGE_GUARD_PX - r * 1.35, edge.right + pad + r);
  return { r, pad, btn, gap, lead, cx, cy: top + stackH - r, laneH };
}

export function spinDialLayout(L) {
  const s = controlStack(L);
  return { cx: s.cx, cy: s.cy, r: s.r };
}

/**
 * How far one press of the nudge control turns the aim, in degrees.
 *
 * 0.2 because the tightest stage in the campaign forgives 2.5 degrees
 * either side of its solution: a step has to be small enough that a
 * player can sit inside that window deliberately rather than stepping
 * over it, and large enough that walking a few degrees is not a chore.
 * Twelve presses crosses the Draw stage's whole window.
 */
export const NUDGE_DEGREES = 0.2;

/**
 * The controls that live in the strip dialMetrics() reserved.
 *
 * There used to be a SHOOT button here and there is not any more, which
 * is worth writing down because it was deliberate in both directions.
 *
 * The two-step shot — release to arm, tap to play — existed so that a
 * slower control could live in the gap, since a release cannot be a fine
 * control and the tightest stage forgives 2.5 degrees. It worked. It also
 * charged every single shot an extra tap, and on a portal where a session
 * is a dozen-odd attempts and the metric is whether anyone starts at all,
 * that is the wrong thing to charge for. So the default is back to one
 * gesture: pull, let go, the ball goes.
 *
 * The nudge survives as an OPT-IN. Pressing an arrow rotates the standing
 * aim by a fifth of a degree and arms it; a tap then plays it. A player
 * who never touches the arrows never meets the two-step, and a player
 * lining up a draw shot still has something finer than their thumb.
 *
 * There are FOUR arrows, not two, and the second pair is new. Aim had a
 * fine control and power did not — power had only the release, which is
 * a gesture, and a gesture cannot be repeated exactly. Two percent a
 * press, against the percentage the cue now prints next to the ball, is
 * the same deal the aim nudge offers: the drag gets you close, the
 * arrows get you exact, and nobody who does not want them pays for them.
 *
 * They are drawn on the canvas rather than as DOM buttons because they
 * sit in a strip whose position is computed from the table layout, and
 * keeping that arithmetic in one place beats synchronising an absolutely
 * positioned overlay with it on every resize.
 */
/**
 * How far the power lane keeps away from the window's edges, in px.
 *
 * NOT a margin for looks — it is the strip the operating system has
 * already claimed. On an iPhone a drag that starts within about 20pt of
 * the bottom is the home gesture, and one that starts within about 20pt
 * of either side is Safari's back/forward swipe. The portrait lane ran
 * the full width of the screen along its bottom edge, which is three of
 * those strips at once: pulling the bar threw the player out of the game.
 *
 * The lane loses about 14% of its travel on a 390px phone to this, which
 * is worth it — the remaining 307px still puts 118px under the 22-45%
 * band, three times the floor the resolution test asks for.
 *
 * 24 rather than 20: the system strips are approximate, undocumented and
 * have changed with iOS versions, and the cost of being four pixels
 * generous is nothing next to the cost of being one pixel short.
 */
export const EDGE_GUARD_PX = 24;

export function controlsLayout(L) {
  const stack = controlStack(L);
  const { r, pad, btn, gap, lead } = stack;
  const dial = spinDialLayout(L);
  if (!L.side) {
    // Bottom band, two rows. The dial sits at the right of the upper one
    // with the aim nudges to its left — the corner a thumb rests in gets
    // the control it reaches for most — and the power lane runs the whole
    // width of the lower one, along the bottom edge.
    const cy = dial.cy;
    const rightCx = dial.cx - r - pad - btn / 2;
    const leftCx = rightCx - btn - gap;
    const laneH = laneWide(btn);
    return {
      dial,
      left: { cx: leftCx, cy, w: btn, h: btn },
      right: { cx: rightCx, cy, w: btn, h: btn },
      lane: {
        // Inset from the side edges the system reserves — Safari's
        // back/forward swipe lives there at every height, not only at
        // the bottom — and standing above the dial row rather than under
        // it. See EDGE_GUARD_PX.
        x: pad + EDGE_GUARD_PX,
        y: cy - r - pad - laneH,
        w: L.width - 2 * (pad + EDGE_GUARD_PX),
        h: laneH,
        vertical: false,
      },
    };
  }
  // Right column: dial at the bottom of the group, aim nudges above it,
  // the power lane standing above those — and the group is centred on the
  // table. Vertical, because up is more everywhere.
  const cx = dial.cx;
  const ny = dial.cy - r - lead - btn / 2;
  const laneH = stack.laneH;
  const laneW = laneWide(btn);
  return {
    dial,
    left: { cx: cx - btn * 0.62, cy: ny, w: btn, h: btn },
    right: { cx: cx + btn * 0.62, cy: ny, w: btn, h: btn },
    lane: {
      x: cx - laneW / 2,
      y: ny - btn / 2 - gap - laneH,
      w: laneW,
      h: laneH,
      vertical: true,
    },
  };
}

/**
 * The handle's travel: where its CENTRE may go, which is not the whole
 * track.
 *
 * Inset from each end, because a handle centred on the very end of its
 * own track is a disc hanging half off it — and at zero, which is where
 * every shot now starts, that is the first thing anyone sees. The
 * mapping is inset with it rather than separately, so the handle stays
 * exactly under the finger; a slider whose knob leads or lags the thumb
 * by twenty pixels feels broken in a way nobody can name.
 *
 * 0.6 of the thickness, which is a hair more than the handle's own
 * resting radius (0.58). That is the whole reason for the number: the
 * fill runs from the end of the track to the handle, so at zero there is
 * a sliver of fill with nothing to show — and at this inset the handle
 * is sitting exactly on top of it.
 */
export const LANE_THUMB = 0.6;

export function laneTravel(lane) {
  const inset = (lane.vertical ? lane.w : lane.h) * LANE_THUMB;
  return lane.vertical
    ? { from: lane.y + lane.h - inset, to: lane.y + inset, vertical: true }
    : { from: lane.x + inset, to: lane.x + lane.w - inset, vertical: false };
}

/**
 * Where along the lane is this, as a power from 0 to 1.
 *
 * Zero is the end nearest the table — the bottom of a vertical lane, the
 * left of a horizontal one — so "further from the ball" is "harder" in
 * both orientations, which is the same sentence the old pull-back
 * gesture was telling.
 */
export function laneToPower(lane, px, py) {
  const t = laneTravel(lane);
  const p = t.vertical ? py : px;
  return Math.min(1, Math.max(0, (p - t.from) / (t.to - t.from)));
}

/** And back: where the handle for this power sits, in canvas px. */
export function laneToPx(lane, power) {
  const t = laneTravel(lane);
  const at = t.from + (t.to - t.from) * Math.min(1, Math.max(0, power));
  return t.vertical ? { x: lane.x + lane.w / 2, y: at } : { x: at, y: lane.y + lane.h / 2 };
}

/** Is this press on the lane? Generous across its short axis, which is
 * the one a thumb misses. */
export function withinLane(lane, px, py) {
  // Generous across the short axis, which is the one a thumb misses —
  // but never generous enough to put the TARGET back in the strip the
  // lane was just moved out of. Both margins are capped below the guard,
  // so a press that iOS would answer first is a press this control does
  // not claim either.
  const cap = EDGE_GUARD_PX - 6;
  // The horizontal lane is inset from the side edges by its own x, so
  // the margin may not spend more than the part of that inset which is
  // NOT the guard. (The vertical one sits in the column, far enough from
  // the right edge that the flat cap is already inside it.)
  const room = lane.vertical ? cap : Math.max(0, lane.x - EDGE_GUARD_PX);
  const mx = Math.min(lane.vertical ? lane.w * 0.9 : lane.w * 0.06, cap, room);
  const my = Math.min(lane.vertical ? lane.h * 0.06 : lane.h * 0.9, cap);
  return (
    px >= lane.x - mx &&
    px <= lane.x + lane.w + mx &&
    py >= lane.y - my &&
    py <= lane.y + lane.h + my
  );
}

/**
 * Below this a release on the lane is not a shot — the cancel, and the
 * same idea as the ring the pull-back gesture had: a way to change your
 * mind that costs nothing and needs no aiming.
 *
 * It was 0.06, and 0.06 is a SHOT. Four-ball is a game of soft position
 * play and the bar reads out a percentage, so a player who pulls to 5%
 * and lets go has asked for a 0.63 m/s roll — and got a cancel, with the
 * bar snapping back to zero and nothing happening. That is indis-
 * tinguishable from the control being broken, and it was reported as
 * exactly that.
 *
 * At 0.02 the cancel is where it should be: the bottom of the bar. It is
 * 0.46 m/s, a ball that moves about a foot, and it costs four pixels of
 * travel on the shortest lane we ship — so sliding back to the end stop
 * still cancels, and every percentage the bar can print above it plays.
 */
export const LANE_MIN_POWER = 0.02;

/**
 * How far the thumb must slide ALONG the lane before a release plays the
 * shot instead of parking the power.
 *
 * Smaller than TAP_SLOP_PX, and measured on one axis rather than two,
 * because the two gestures are not the same problem. The cue's slop
 * protects a rotation from a resting thumb rolling in any direction; the
 * lane is a fader, where a five-pixel slide along its length is nothing
 * but a deliberate pull. At nine pixels, on the 87px lane a landscape
 * phone gets, the whole soft end of the bar was inside the slop: a pull
 * to 5% travels 9.9px there, so the release parked a power and fired
 * nothing.
 */
export const LANE_PULL_PX = 5;

/** The table's outer edge in canvas pixels, so the chrome outside the
 * canvas can line up with the thing inside it. */
export function tableFrame(L) {
  const a = toPx(L, 0, 0);
  const b = toPx(L, TABLE_LENGTH, TABLE_WIDTH);
  return {
    left: Math.min(a.x, b.x) - L.railPx,
    right: Math.max(a.x, b.x) + L.railPx,
    top: Math.min(a.y, b.y) - L.railPx,
    bottom: Math.max(a.y, b.y) + L.railPx,
  };
}

/** Which control the pointer is on, or null. Generous hit areas: the
 * nudge is pressed repeatedly and a miss reads as the game ignoring you. */
export function controlAt(L, px, py) {
  const c = controlsLayout(L);
  // 1.45, not 1.25: the buttons shrank with the dial and the drawing is
  // now under a fingertip at 30px. The target is the finger's size and
  // the drawing is the smaller, prettier thing inside it — the same
  // trade the cue's grab capsule makes.
  const inside = (b, grow = 1.45) =>
    Math.abs(px - b.cx) <= (b.w / 2) * grow && Math.abs(py - b.cy) <= (b.h / 2) * grow;
  if (Math.hypot(px - c.dial.cx, py - c.dial.cy) <= c.dial.r * 1.35) return "dial";
  if (inside(c.left)) return "left";
  if (inside(c.right)) return "right";
  if (withinLane(c.lane, px, py)) return "lane";
  return null;
}

/** Pointer px -> tip offset in metres, clamped to the miscue limit by
 * physics.strike(). Returns null when the pointer is nowhere near the
 * dial, so the caller can tell "adjusting spin" from "aiming".
 * The dial's y axis points DOWN on screen and UP on the ball, so top of
 * the dial = follow. */
export function dialToTip(dial, px, py, maxOffset) {
  const dx = (px - dial.cx) / dial.r;
  const dy = (py - dial.cy) / dial.r;
  const d = Math.hypot(dx, dy);
  if (d > 1.6) return null;
  const k = d > 1 ? 1 / d : 1;
  return { side: dx * k * maxOffset, vertical: -dy * k * maxOffset };
}
