// game/preview.js
// The path the shot would actually take, computed by playing it.
//
// It does not PREDICT anything. game/physics.js is deterministic and
// stepped at a fixed substep, so the same stroke gives the same result
// every time; this replays it on a copy of the world and reports where
// the cue ball went. That is why the line can be trusted through two
// cushions and a carom — it is not an approximation of the shot, it is
// the shot.
//
// WHY THIS IS THE RIGHT REWARD FOR THIS GAME IN PARTICULAR
// StoneFlick's version of this was a good hint. Here it is a much
// stronger one, and the reason is honest: alkkagi is played in straight
// lines that a player can already see, and four-ball is not. A ball
// leaving a cushion at a slightly different angle than you expected, and
// then leaving the next one, is genuinely invisible to the eye — the
// whole skill of the game is holding that path in your head. Handing it
// over is worth an ad in a way that "where would this stone slide to"
// never quite was.
//
// TWO DELIBERATE LIMITS, both inherited and both still right:
//
//   - ONLY THE CUE BALL'S PATH. Every ball it touches moves too, and
//     drawing all of them turns a hint into a solved stage. Where YOUR
//     ball goes is a plan; where all four go is the answer.
//   - THE LINE STOPS WHEN THE CUE BALL STOPS. Not when the table stops.
//     Every clause in game/rules.js reads what the CUE BALL touched, so
//     once it is at rest the shot is decided and the rest of the path
//     does not exist. Drawing reds rattling on afterwards would be
//     drawing noise.
//
// Pure: no DOM, no canvas, no rendering decisions. game/render.js draws
// what this returns.

import {
  cloneWorld,
  strike,
  stepWorld,
  contactVelocity,
  SUB_DT,
  STOP_SPEED,
  MAX_SHOT_SECONDS,
} from "./physics.js";

/** Substeps between recorded points. 6 at 600 substeps/second samples
 * every 10ms of simulated time — finer than the line needs to look
 * smooth, coarse enough that a long shot is a few hundred points. */
const SAMPLE_EVERY = 6;

/**
 * @param {object} world the LIVE world; it is cloned, never touched
 * @param {string} cueId
 * @param {{dirX:number,dirY:number,speed:number,side:number,vertical:number}} shot
 * @returns {{points:{x:number,y:number}[], contactAt:number, cushions:number,
 *            touched:string[]}}
 *   `points` in table metres, in order. `contactAt` is the index at which
 *   the cue ball first touched another ball, or points.length-1 if it
 *   never did — so a caller can always split the line there without a
 *   null check. `touched` is the object balls it met, in order, which is
 *   what lets the renderer say whether this shot scores without the
 *   player counting contacts off the drawing.
 */
export function simulateShotPath(world, cueId, shot) {
  const copy = cloneWorld(world);
  const cue = copy.balls.find((b) => b.id === cueId);
  const points = [];
  if (!cue) return { points, contactAt: 0, cushions: 0, touched: [] };

  strike(cue, shot.dirX, shot.dirY, shot.speed, shot.side || 0, shot.vertical || 0);
  points.push({ x: cue.x, y: cue.y });

  let contactAt = -1;
  let seen = 0;
  let seconds = 0;
  let i = 0;
  while (seconds < MAX_SHOT_SECONDS) {
    stepWorld(copy, SUB_DT);
    seconds += SUB_DT;
    i += 1;

    for (; seen < copy.events.length; seen++) {
      const e = copy.events[seen];
      if (contactAt < 0 && e.type === "ball" && (e.a === cueId || e.b === cueId)) {
        contactAt = points.length;
      }
    }
    if (i % SAMPLE_EVERY === 0) points.push({ x: cue.x, y: cue.y });

    // Stop with the cue ball, not with the table. Both halves of the
    // rest test, for the same reason physics.isAtRest() has both: a ball
    // sitting still under heavy draw is about to move.
    const u = contactVelocity(cue);
    if (
      Math.hypot(cue.vx, cue.vy) < STOP_SPEED &&
      Math.hypot(u.x, u.y) < STOP_SPEED
    ) {
      break;
    }
  }
  points.push({ x: cue.x, y: cue.y });

  const touched = [];
  for (const e of copy.events) {
    if (e.type !== "ball") continue;
    const other = e.a === cueId ? e.b : e.b === cueId ? e.a : null;
    if (other && !touched.includes(other)) touched.push(other);
  }
  const cushions = copy.events.filter((e) => e.type === "cushion" && e.ball === cueId).length;

  return {
    points,
    contactAt: contactAt < 0 ? Math.max(0, points.length - 1) : Math.min(contactAt, points.length - 1),
    cushions,
    touched,
  };
}
