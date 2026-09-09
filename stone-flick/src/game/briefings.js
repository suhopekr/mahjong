// game/briefings.js
// One short briefing per obstacle KIND, shown the first time a stage puts
// that kind in front of the player.
//
// WHY THIS FILE EXISTS. The campaign teaches six obstacle types across
// sixteen stages, and until now it taught them all the same way: by
// letting the player lose a stone to one. That works for the pit — the
// consequence is instant and unmistakable — and works badly for the
// bumper and the portal, whose rules are the opposite of what their
// shapes suggest to someone who has never seen them (a bumper gives back
// MORE speed than it took; a portal keeps your direction but not your
// place). A stage that introduces one of those reads as the physics
// having broken.
//
// WHY A DEMO RATHER THAN A SENTENCE. Each briefing carries a tiny scene
// that this game's own physics actually plays out — same constants, same
// solver, same renderer as the board. Three reasons it is written this
// way rather than as a hand-drawn diagram or a recorded clip:
//
//   1. It cannot go stale. Retune FRICTION_DECEL or BUMPER_RESTITUTION
//      and the demo retunes with it. A drawn diagram of a bumper would
//      quietly start lying the first time those numbers moved, and
//      nothing would fail.
//   2. It costs nothing to ship. No image, no video, no bytes beyond the
//      few hundred below — which matters under this series' size budget.
//   3. It is the same picture as the game. The player is learning the
//      obstacle's LOOK at the same time as its rule, and a stylised
//      illustration would teach a look that never appears again.
//
// The scenes are DATA, not animation: a starting position plus a flick.
// That keeps this module DOM-free and pure, so test/briefings.test.js can
// run every scene to completion in Node and assert it demonstrates what
// its text claims — that the sand stone really does stop short of the
// clear one, that the bumper stone really does come back faster than it
// arrived. A demo whose caption and behaviour disagree is worse than no
// demo, and that is exactly the failure a hand-tuned animation invites.

import { STONE_RADIUS } from "./physics.js";

/**
 * The obstacle kind a briefing is about. This is NOT the same as
 * `obstacle.type`: a friction `zone` is two completely different lessons
 * depending on which side of 1 its multiplier falls on, and calling both
 * of them "zone" would show the player a sand briefing and then drop them
 * onto ice with no warning. Everything else maps one-to-one.
 * @returns {string|null} null for a type with nothing to teach
 */
export function kindOf(obstacle) {
  if (!obstacle || typeof obstacle.type !== "string") return null;
  if (obstacle.type === "zone") return obstacle.friction >= 1 ? "sand" : "ice";
  return obstacle.type;
}

// Campaign order — the order the stages actually introduce these. Used
// as the display order when a single stage introduces more than one (only
// stage 15 does today: sand and ice arrive together), so a briefing
// sequence always reads in the same order the campaign teaches.
const ORDER = ["wall", "peg", "hole", "bumper", "portal", "sand", "ice"];

/** A demo stone. Player 0 (the human's colour) unless the scene needs a
 * second colour to tell two stones apart. */
const at = (x, y, player = 0) => ({ x, y, player, radius: STONE_RADIUS });

/**
 * Every briefing, keyed by kind.
 *
 * `rule` is one sentence and stays one sentence. The demo is the
 * explanation; the text is the label on it. Two sentences here and the
 * player reads instead of watching, which loses the only thing this
 * screen is good at.
 *
 * A scene's `seconds` is the point the loop restarts at, measured by
 * running it (test/briefings.test.js asserts every scene has come to rest
 * or resolved by then, so a scene can never be cut off mid-flight).
 */
export const BRIEFINGS = {
  wall: {
    id: "wall",
    title: "Wall",
    rule: "A block laid across the lane. Nothing goes through it — go around, or bank off it.",
    demo: {
      obstacles: [{ type: "wall", x: 0.2, y: 0.44, w: 0.6, h: 0.05 }],
      stones: [at(0.5, 0.88)],
      shots: [{ stone: 0, dx: 0, dy: -1, power: 0.55 }],
      seconds: 3.2,
    },
  },
  peg: {
    id: "peg",
    title: "Peg",
    rule: "It will not move. A stone that clips one comes away at an angle, and slower.",
    demo: {
      // Offset from dead centre on purpose: a stone that hits a peg
      // square just stops, which demonstrates nothing. The lesson is the
      // deflection, so the scene is aimed to graze.
      obstacles: [{ type: "peg", x: 0.5, y: 0.48, radius: 0.024 }],
      stones: [at(0.46, 0.9)],
      shots: [{ stone: 0, dx: 0, dy: -1, power: 0.62 }],
      seconds: 3.2,
    },
  },
  hole: {
    id: "hole",
    title: "Pit",
    rule: "Cut clean through the board. Anything that crosses it is gone — yours as easily as theirs.",
    demo: {
      obstacles: [{ type: "hole", x: 0.5, y: 0.42, radius: 0.07 }],
      stones: [at(0.5, 0.9)],
      shots: [{ stone: 0, dx: 0, dy: -1, power: 0.55 }],
      seconds: 2.4,
    },
  },
  bumper: {
    id: "bumper",
    title: "Bumper",
    rule: "Sprung brass: it throws a stone back faster than it arrived — yours and theirs alike.",
    demo: {
      obstacles: [{ type: "bumper", x: 0.5, y: 0.4, radius: 0.045 }],
      // Deliberately a GENTLE shot. The whole point is that the stone
      // leaves quicker than it came, and that reads only if it arrived
      // slowly enough for the difference to be visible.
      stones: [at(0.5, 0.86)],
      shots: [{ stone: 0, dx: 0, dy: -1, power: 0.55 }],
      seconds: 3.6,
    },
  },
  portal: {
    id: "portal",
    title: "Portal",
    rule: "A linked pair: go into one and you leave the other, still travelling the same way.",
    demo: {
      obstacles: [
        { type: "portal", x: 0.28, y: 0.55, radius: 0.055, link: 1 },
        { type: "portal", x: 0.74, y: 0.78, radius: 0.055, link: 1 },
      ],
      stones: [at(0.28, 0.9)],
      shots: [{ stone: 0, dx: 0, dy: -1, power: 0.55 }],
      seconds: 3.4,
    },
  },
  sand: {
    id: "sand",
    title: "Sand",
    rule: "Loose grit: a shot across it dies short, and a stone struck inside it is shoved rather than fired.",
    demo: {
      // The same shot fired at the same target twice, side by side, with
      // only the patch different. The right pair is what happens on bare
      // wood — the target goes off the board. The left pair is the same
      // hit landed in sand, and the target barely moves.
      //
      // It shows BOTH halves of what sand is in one picture, which is the
      // reason it is four stones rather than the simpler two-stone race
      // ice uses below: the striker on the left visibly runs out of speed
      // crossing the patch (the drag), and then fails to carry the target
      // even at contact (the deadening). The second half is the one a
      // player gets wrong — it was reported from play as "I hit them
      // dead-on in the mud and they still flew off," which was true, and
      // was a bug.
      obstacles: [{ type: "zone", x: 0.3, y: 0.5, radius: 0.19, friction: 3.4, bounce: 0.3 }],
      stones: [at(0.3, 0.9, 0), at(0.3, 0.5, 1), at(0.72, 0.9, 0), at(0.72, 0.5, 1)],
      shots: [
        { stone: 0, dx: 0, dy: -1, power: 0.7 },
        { stone: 2, dx: 0, dy: -1, power: 0.7 },
      ],
      seconds: 3.4,
    },
  },
  ice: {
    id: "ice",
    title: "Ice",
    rule: "Almost nothing to slow a stone down: a shot that crosses it runs long.",
    demo: {
      // Two stones, same shot, one through the lane and one beside it. A
      // single stone running long looks like a hard flick; the pair is
      // what makes the lane the cause. Ice gets no `bounce` term and so
      // no collision to show — it is hard, and a contact on it rings
      // exactly as it does on bare wood.
      obstacles: [{ type: "zone", x: 0.3, y: 0.52, radius: 0.19, friction: 0.32 }],
      stones: [at(0.3, 0.9, 0), at(0.72, 0.9, 1)],
      shots: [
        { stone: 0, dx: 0, dy: -1, power: 0.4 },
        { stone: 1, dx: 0, dy: -1, power: 0.4 },
      ],
      seconds: 3.4,
    },
  },
};

/**
 * The one briefing that is not about an obstacle.
 *
 * WHY IT EXISTS. Two-player and vs-AI can hide the forward aim line, and
 * that is the single biggest difficulty cliff in the game — the campaign
 * draws the shot for you on every stage, and the first board that does
 * not feels broken rather than harder. The line is ON by default now, and
 * this card is how a player learns there is a switch at all: a setting
 * nobody knows about is not an option, it is a secret.
 *
 * It carries an `aim` pose, held before the shot fires, so the card shows
 * the exact thing it is talking about rather than describing it.
 */
export const AIM_BRIEFING_ID = "aim-line";

BRIEFINGS[AIM_BRIEFING_ID] = {
  id: AIM_BRIEFING_ID,
  eyebrow: "Playing another person",
  title: "The aim line",
  rule: "Pull back and the dashed line shows where the stone will go. Against a person or the computer you can switch it off in Settings — then judging the line is yours, which is the real game.",
  demo: {
    obstacles: [],
    stones: [at(0.34, 0.88), at(0.62, 0.28, 1)],
    shots: [{ stone: 0, dx: 0.28, dy: -0.6, power: 0.72 }],
    // Held on the aim before the stone is released, so the card shows the
    // line rather than describing it.
    aim: { seconds: 1.5 },
    seconds: 3.2,
  },
};

/** Obstacle briefings, in the order the campaign teaches them. */
export const BRIEFING_IDS = ORDER.filter((id) => id in BRIEFINGS);

/** Every briefing id the save file may legitimately hold. */
export const ALL_BRIEFING_IDS = [...BRIEFING_IDS, AIM_BRIEFING_ID];

/**
 * The aim-line card, if this player has not been shown it yet. Called
 * when a mode that can hide the line is opened, rather than from a stage,
 * because it belongs to the MODE and not to anything on the board.
 * @returns {object[]} one briefing, or none
 */
export function aimLineBriefing(seenIds = []) {
  return [...seenIds].includes(AIM_BRIEFING_ID) ? [] : [BRIEFINGS[AIM_BRIEFING_ID]];
}

/** @returns {object|null} */
export function getBriefing(id) {
  return BRIEFINGS[id] ?? null;
}

/**
 * The obstacle kinds a stage contains, in campaign order and without
 * duplicates.
 * @returns {string[]}
 */
export function kindsInStage(stage) {
  const present = new Set();
  for (const o of stage?.obstacles ?? []) {
    const kind = kindOf(o);
    if (kind && kind in BRIEFINGS) present.add(kind);
  }
  return BRIEFING_IDS.filter((id) => present.has(id));
}

/**
 * The briefings this stage should show, given what the player has already
 * been shown.
 *
 * Driven by a SEEN SET rather than by stage number, which matters in two
 * cases that a "stage 13 introduces bumpers" table gets wrong: replaying
 * a cleared stage must not re-explain anything, and a player who reaches
 * a late stage having skipped the one that introduced a mechanic (the
 * stage grid unlocks by stars, not strictly in sequence) must still be
 * told what a portal is when one finally appears in front of them.
 *
 * @param {object} stage
 * @param {Iterable<string>} seenIds
 * @returns {object[]} briefing objects, campaign order, possibly empty
 */
export function briefingsForStage(stage, seenIds = []) {
  const seen = new Set(seenIds);
  return kindsInStage(stage)
    .filter((id) => !seen.has(id))
    .map((id) => BRIEFINGS[id]);
}
