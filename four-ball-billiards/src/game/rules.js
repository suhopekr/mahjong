// game/rules.js
// Turning a list of contacts into a score.
//
// physics.js records WHAT touched WHAT and in what order and knows nothing
// about points; this file knows about points and nothing about physics.
// The seam matters more here than it did in StoneFlick, because the two
// games we are shipping share every line of the simulation and differ
// ONLY in this file: four-ball asks "did my ball touch both reds, and did it
// stay away from the other white", three-cushion asks "did it touch both other
// balls with at least three cushions in between". Same table, same
// stroke, same rails — different sentence read off the same log.
//
// RULES AS IMPLEMENTED (Korean four-ball, 사구), with sources:
//   - A point is scored when the cue ball caroms off BOTH red balls in one
//     shot. The shooter then continues.
//     https://en.wikipedia.org/wiki/Four-ball_billiards
//   - Touching the opponent's cue ball is a foul and costs a point (the
//     Korean variant penalises it; the Japanese one does not).
//     https://en.wikipedia.org/wiki/Four-ball_billiards
//     https://www.mk2info.com/2026/02/four-ball-billiards-rule.html
//   - Contacting only one red scores nothing and ends the inning.
//
// The point penalty is behind an option because it is the one rule real
// tables disagree about: house play below 50점 usually just ends the
// inning, and a campaign stage should not quietly dock a beginner a point
// for a rule the game has not taught yet.

/** How the cue ball got there. Korean players name these (노쿠션,
 * 원쿠션, 투쿠션, 쓰리쿠션) and so does every four-ball scoreboard, but the
 * strings here are the ones shown on screen, so they are English —
 * counting rails is the one piece of billiards vocabulary an English
 * player already has, and "Two Cushions" needs no glossary. Used for
 * stage goals ("score with a cushion first") and for the result banner. */
export const SCORE_KIND = {
  NO_CUSHION: "No cushion",
  ONE_CUSHION: "One cushion",
  TWO_CUSHION: "Two cushions",
  THREE_CUSHION: "Three cushions",
};

export const FOUL = {
  /** Cue ball touched the opponent's white. */
  OPPONENT: "opponent",
  /** Cue ball touched nothing at all. */
  NO_CONTACT: "no-contact",
};

/**
 * @param {Array} events - world.events from physics.js, in order
 * @param {object} spec
 * @param {string} spec.cueId - the ball the player struck
 * @param {string[]} spec.targetIds - the balls that must BOTH be hit
 * @param {string[]} [spec.forbiddenIds] - balls that must not be touched
 *   (four-ball: the opponent's white. three-cushion: none.)
 * @param {number} [spec.minCushions] - cushions the cue ball must contact
 *   before completing the carom (three-cushion: 3. four-ball: 0.)
 * @param {boolean} [spec.penalizeFoul]
 * @returns {{scored:boolean, foul:string|null, points:number,
 *            cushions:number, kind:string|null, contacted:string[],
 *            firstContact:string|null}}
 */
export function judgeShot(events, spec) {
  const {
    cueId,
    targetIds,
    forbiddenIds = [],
    minCushions = 0,
    penalizeFoul = false,
  } = spec;

  /** Cushions the CUE BALL has touched so far. Only the cue ball's own
   * rails count — an object ball rattling around the table after the fact
   * is not part of the shot's shape, and counting it would let a player
   * claim a 쓰리쿠션 they did not play. */
  let cushions = 0;
  /** Cushions at the moment the second target was struck. This, not the
   * total, is what a cushion requirement is about: the rails have to come
   * BEFORE the carom is completed, or you have simply hit two balls and
   * then hit a wall. */
  let cushionsAtCarom = 0;

  const contacted = [];
  let firstContact = null;
  let foul = null;

  for (const e of events) {
    // THE SHOT IS THE CUE BALL'S JOURNEY, and it ends when the cue ball
    // does. Everything after that is the reds finishing their own roll.
    //
    // This is a rule, not an optimisation, and it was written down after
    // it was found to be assumed in three places that disagreed.
    // main.js's shotDecided() claimed "every clause of every rule in
    // rules.js is about what the cue ball touched, so once it is at rest
    // the result is fixed" — which is false as long as this loop keeps
    // reading: a red rolling back into a STOPPED cue ball appends another
    // contact, and measured across 252 shots two of them changed verdict
    // afterwards, one from a point into a foul. The game fast-forwarded
    // through those frames and then read a different answer out of them.
    //
    // Real carom rules would count that late contact — the shot there
    // ends when every ball stops. This does not, and the reason is that
    // a player cannot see it as their doing: the cue ball is sitting
    // still, they have already read the result, and a point that arrives
    // (or is taken away) two seconds later by a red they cannot influence
    // is indistinguishable from a bug. Ending the shot with the cue ball
    // makes the rule, the "is it decided" test and what is on screen the
    // same statement.
    if (e.type === "rest" && e.ball === cueId) break;
    if (e.type === "cushion") {
      if (e.ball === cueId) cushions++;
      continue;
    }
    if (e.type !== "ball") continue;
    if (e.a !== cueId && e.b !== cueId) continue; // object balls colliding: not our business
    const other = e.a === cueId ? e.b : e.a;

    if (firstContact === null) firstContact = other;

    if (forbiddenIds.includes(other)) {
      // First touch wins: once the cue ball has hit the wrong ball the
      // shot is over as far as scoring goes, whatever happens next.
      if (foul === null) foul = FOUL.OPPONENT;
      continue;
    }
    if (targetIds.includes(other) && !contacted.includes(other)) {
      contacted.push(other);
      if (contacted.length === targetIds.length) cushionsAtCarom = cushions;
    }
  }

  if (foul === null && firstContact === null) foul = FOUL.NO_CONTACT;

  const carom = contacted.length === targetIds.length;
  const scored = carom && foul === null && cushionsAtCarom >= minCushions;

  let points = 0;
  if (scored) points = 1;
  // BOTH fouls cost a point, not just the opponent's ball. A stroke that
  // touches nothing is the other half of what a hall counts as a foul, and
  // on a rack you are trying to EMPTY the two are the same event: a bead
  // comes back. Missing the carom while still hitting a red is not a foul
  // and costs nothing — it is just a shot that did not go in.
  else if (penalizeFoul && (foul === FOUL.OPPONENT || foul === FOUL.NO_CONTACT)) points = -1;

  return {
    scored,
    foul,
    points,
    cushions,
    cushionsAtCarom,
    kind: scored ? cushionKind(cushionsAtCarom) : null,
    contacted,
    firstContact,
  };
}

function cushionKind(n) {
  if (n <= 0) return SCORE_KIND.NO_CUSHION;
  if (n === 1) return SCORE_KIND.ONE_CUSHION;
  if (n === 2) return SCORE_KIND.TWO_CUSHION;
  return SCORE_KIND.THREE_CUSHION;
}

/** The four-ball reading of a shot. */
export function judgeFourBall(events, { cueId, redIds, opponentId, penalizeFoul = false }) {
  return judgeShot(events, {
    cueId,
    targetIds: redIds,
    forbiddenIds: opponentId ? [opponentId] : [],
    minCushions: 0,
    penalizeFoul,
  });
}

/** The three-cushion reading of the SAME shot log. Kept here from the
 * start, unused by the shipped four-ball game, because it is the proof that the seam is in
 * the right place — if adding it had needed a change in physics.js, the
 * split was wrong. */
export function judgeThreeCushion(events, { cueId, targetIds }) {
  return judgeShot(events, { cueId, targetIds, minCushions: 3 });
}
