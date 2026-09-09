// game/rules.js
// Scoring for table shuffleboard. Physics knows where the weights are;
// this file knows what they are worth. Nothing here moves anything.
//
// The rules are the common bar rules (Shuffleboard Federation "knock
// off" scoring): each side shoots four weights, alternating, from the
// same end. When the board is still, ONLY the side with the weight
// nearest the far edge scores, and it scores every one of its weights
// that lies beyond the other side's best. Zones from the end are worth
// 3, 2 and 1; a weight hanging over the far edge in the 3 is a "hanger"
// and worth 4. A weight touching a zone line takes the lower zone.
// First to 15 wins.

import {
  BOARD_LENGTH,
  PUCK_RADIUS,
  ZONE_3_DEPTH,
  ZONE_2_DEPTH,
  FOUL_X,
} from "./physics.js";

export const TARGET_SCORE = 15;
export const PUCKS_PER_SIDE = 4;

/**
 * Points a single resting weight is worth by position alone (before the
 * "only the leader scores" rule). 0 for a weight short of the foul line
 * or off the board.
 */
export function puckValue(p) {
  if (p.off || p.foul) return 0;
  const rear = p.x - PUCK_RADIUS;
  const front = p.x + PUCK_RADIUS;
  if (rear < FOUL_X) return 0;
  if (front > BOARD_LENGTH) return 4; // hanger: centre on, rim over
  if (rear >= BOARD_LENGTH - ZONE_3_DEPTH) return 3;
  if (rear >= BOARD_LENGTH - ZONE_2_DEPTH) return 2;
  return 1;
}

export function isHanger(p) {
  return !p.off && !p.foul && p.x + PUCK_RADIUS > BOARD_LENGTH && p.x <= BOARD_LENGTH;
}

/**
 * Score a still board.
 * @returns {{ winner: 0|1|null, points: number, counted: number[] }}
 *   winner  which side scores, or null when nobody has a live weight
 *   points  how much
 *   counted ids of the weights that scored
 */
export function scoreFrame(world) {
  const live = world.pucks.filter((p) => !p.off && !p.foul && puckValue(p) > 0);
  if (live.length === 0) return { winner: null, points: 0, counted: [] };
  // Farthest weight decides who scores.
  let lead = live[0];
  for (const p of live) if (p.x > lead.x) lead = p;
  const winner = lead.owner;
  // The other side's best weight is the bar.
  let bar = -Infinity;
  for (const p of live) if (p.owner !== winner && p.x > bar) bar = p.x;
  const counted = [];
  let points = 0;
  for (const p of live) {
    if (p.owner !== winner) continue;
    if (p.x > bar) {
      counted.push(p.id);
      points += puckValue(p);
    }
  }
  return { winner, points, counted };
}

/**
 * Match state. A frame is eight shots; the side that scored last frame
 * shoots FIRST in the next one (the "hammer" — shooting last — is the
 * advantage, and it goes to whoever is behind). On a scoreless frame the
 * same side leads off again.
 */
export function createMatch(firstShooter = 0) {
  return {
    scores: [0, 0],
    frame: 1,
    /** who shoots the next weight */
    shooter: firstShooter,
    /** who led off this frame */
    leadOff: firstShooter,
    /** weights shot so far this frame, per side */
    shot: [0, 0],
    over: false,
    winner: null,
    /** history of { frame, winner, points } */
    frames: [],
  };
}

/** Register that `shooter` has just shot. Returns the next shooter, or
 * null when the frame is complete. */
export function recordShot(match) {
  match.shot[match.shooter]++;
  const other = 1 - match.shooter;
  const total = match.shot[0] + match.shot[1];
  if (total >= PUCKS_PER_SIDE * 2) return null;
  // Alternate, unless the other side is out of weights.
  match.shooter = match.shot[other] < PUCKS_PER_SIDE ? other : match.shooter;
  return match.shooter;
}

export function frameComplete(match) {
  return match.shot[0] + match.shot[1] >= PUCKS_PER_SIDE * 2;
}

/**
 * Close the frame with a scored result. Advances scores, decides the
 * match, and sets up the next frame's shooter.
 */
export function endFrame(match, result) {
  if (result.winner !== null && result.points > 0) {
    match.scores[result.winner] += result.points;
  }
  match.frames.push({ frame: match.frame, winner: result.winner, points: result.points });
  if (match.scores[0] >= TARGET_SCORE || match.scores[1] >= TARGET_SCORE) {
    match.over = true;
    match.winner = match.scores[0] >= TARGET_SCORE ? 0 : 1;
    return match;
  }
  match.frame++;
  match.shot = [0, 0];
  // Scorer leads off next frame; on a blank frame the lead-off stays.
  if (result.winner !== null && result.points > 0) match.leadOff = result.winner;
  match.shooter = match.leadOff;
  return match;
}
