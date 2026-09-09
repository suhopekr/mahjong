// game/preview.js
// The path a shot would actually take, computed by playing it.
//
// This exists because of a question that has one honest answer: what does
// a trajectory preview draw when the shot is BLOCKED — when there is a
// peg or a wall between the stone and everything the player was aiming
// at? The tempting answer is "nothing", or a line that stops at the
// obstacle with a cross on it. Both are worse than the truth, and the
// truth is free here: this game's physics is deterministic and stepped at
// a fixed substep (game/physics.js's SUB_DT), so the same inputs give the
// same result every time, and the preview does not have to PREDICT
// anything. It replays the shot on a copy of the world and reports where
// the stone went — off the peg, into the wall, down the pit, through the
// portal and out the other one.
//
// So a blocked shot is not a failure case for this feature. It is the
// single most valuable thing it can show: the player finds out that the
// angle is closed BEFORE spending the turn on it, which is exactly what
// they paid for.
//
// Two deliberate limits, both about not solving the stage outright:
//
//   - ONLY THE SHOOTER'S PATH. Every stone it hits moves too, and drawing
//     all of them would turn a hint into the answer. Where your own stone
//     ends up is a plan; where all five of theirs end up is the solution.
//   - CONFIDENCE DECAYS AT FIRST CONTACT. The line is solid up to the
//     first thing the stone touches and dotted after it, because after a
//     contact the outcome depends on a collision the player has not seen
//     yet. The maths is exact either side of that point; the DRAWING says
//     which half you should be planning around.
//
// Pure: no DOM, no canvas, no rendering decisions. game/render.js draws
// what this returns and test/preview.test.js checks it against the real
// simulation.

import {
  cloneWorld, flick, stepWorld, isAtRest, SUB_DT, MAX_TURN_SECONDS,
} from "./physics.js";

/** Substeps between recorded points. 3 at 300 substeps/second is a
 * sample every 10ms of simulated time — far finer than the line needs to
 * look smooth, and coarse enough that a full 7-second shot is a few
 * hundred points rather than a few thousand. */
const SAMPLE_EVERY = 3;

/** Did this event happen TO the stone we are tracking? */
function touches(event, id) {
  switch (event.type) {
    case "stoneHit": return event.a === id || event.b === id;
    case "obstacleHit":
    case "bumperHit":
    case "teleported":
    case "fellOff":
    case "sank": return event.stone === id;
    default: return false;
  }
}

/**
 * @param {object} world the LIVE world; it is cloned, never touched
 * @param {number} stoneId the stone being shot
 * @param {number} dirX @param {number} dirY @param {number} power 0..1
 * @returns {{points: {x:number,y:number}[], contactAt: number,
 *            ending: "rest"|"fellOff"|"sank"|"timeout"}}
 *   `points` are board units, in order. `contactAt` is the index of the
 *   point at which the stone first touched anything, or points.length-1
 *   if it never did (so a caller can always split the line at it without
 *   a null check). A teleport counts as a contact: what happens after a
 *   portal is exactly the part the player cannot see coming.
 */
export function simulateShotPath(world, stoneId, dirX, dirY, power) {
  const copy = cloneWorld(world);
  const stone = copy.stones.find((s) => s.id === stoneId);
  const points = [];
  if (!stone) return { points, contactAt: 0, ending: "rest" };

  // The same reset beginShot() does. Not beginShot() itself, because that
  // is the function with the side effect of starting a real turn; this
  // one only needs the bumper budget cleared so a preview through a
  // bumper matches the shot the player will actually take.
  for (const s of copy.stones) s.bumperBoosts = 0;
  flick(stone, dirX, dirY, power);

  points.push({ x: stone.x, y: stone.y });
  let contactAt = -1;
  let ending = "rest";
  let seconds = 0;
  let i = 0;
  while (!isAtRest(copy) && seconds < MAX_TURN_SECONDS) {
    const events = stepWorld(copy, SUB_DT);
    seconds += SUB_DT;
    i += 1;
    for (const e of events) {
      if (contactAt < 0 && touches(e, stoneId)) contactAt = points.length;
      if (e.type === "fellOff" && e.stone === stoneId) ending = "fellOff";
      if (e.type === "sank" && e.stone === stoneId) ending = "sank";
    }
    // A removed stone has no more path to draw — and the fact that the
    // line ENDS at the rim is the information.
    if (!stone.alive) break;
    if (i % SAMPLE_EVERY === 0) points.push({ x: stone.x, y: stone.y });
  }
  if (stone.alive && ending === "rest") {
    points.push({ x: stone.x, y: stone.y });
    if (!isAtRest(copy)) ending = "timeout";
  }
  return {
    points,
    contactAt: contactAt < 0 ? Math.max(0, points.length - 1) : Math.min(contactAt, points.length - 1),
    ending,
  };
}
