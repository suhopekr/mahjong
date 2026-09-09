// game/preview.js
// The rewarded ad's reward: where THIS shot stops. Not a prediction —
// the physics is deterministic with fixed substeps, so the shot is
// simply played on a copy of the world and the answer is exact through
// every collision (Four Ball's preview, same argument).
//
// Two limits, inherited and still right:
// - Only the SHOT weight's path and stop. Everything it touches moves
//   too, and drawing all of it would be the answer key, not a hint.
// - It is bought (one at a time, persisted), never ambient. The power
//   gauge's memory is the game's skill axis; a free stop marker would
//   delete it.

import * as P from "./physics.js";

/**
 * Play the aimed shot on a copy of the world and report the shot
 * weight's journey.
 * @returns {{ x, y, off, foul, path: {x,y}[] }}
 */
export function previewShot(world, owner, y, angle, power) {
  const w = P.cloneWorld(world);
  const puck = P.shoot(w, owner, y, angle, power);
  const path = [{ x: puck.x, y: puck.y }];
  let t = 0;
  const SAMPLE = 1 / 30;
  while (!P.isAtRest(w) && t < 10) {
    P.stepWorld(w, SAMPLE);
    t += SAMPLE;
    if (!puck.off) path.push({ x: puck.x, y: puck.y });
  }
  P.removeFouls(w);
  return { x: puck.x, y: puck.y, off: puck.off, foul: puck.foul, path };
}
