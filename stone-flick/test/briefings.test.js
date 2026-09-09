// test/briefings.test.js
// Two jobs, and the second is the interesting one.
//
//   1. The plumbing: which briefings a stage asks for, and how the seen
//      set suppresses them.
//   2. THE CAPTIONS ARE TRUE. Every briefing carries a scene that this
//      game's real physics plays out, and every scene's caption makes a
//      specific claim — "throws a stone back faster than it arrived",
//      "dies short", "runs long", "you leave the other". Each claim below
//      is re-derived from a full simulation rather than trusted.
//
// This matters more than it looks. A briefing is the one screen in the
// game that TELLS the player a rule instead of letting them find it, so a
// scene that has drifted out of agreement with its own text is worse than
// having no briefing at all — it teaches the wrong thing with the game's
// full authority behind it. And drift is easy: every one of these scenes
// is a hand-placed position tuned against FRICTION_DECEL,
// BUMPER_RESTITUTION and MAX_FLICK_SPEED as they stand today. Move any of
// those constants and a scene can quietly stop reaching its obstacle at
// all — which is exactly what the first draft of the peg scene did, and
// exactly what it looked like from the outside: nothing.

import { test, assertEqual, assertTrue } from "./harness.js";
import {
  BRIEFINGS,
  BRIEFING_IDS,
  ALL_BRIEFING_IDS,
  AIM_BRIEFING_ID,
  aimLineBriefing,
  kindOf,
  kindsInStage,
  briefingsForStage,
  getBriefing,
} from "../src/game/briefings.js";
import { BRIEFING_IDS as STORAGE_BRIEFING_IDS } from "../src/core/storage.js";
import { STAGES, getStage } from "../src/game/stages.js";
import { createWorld, stepWorld, flick, isAtRest, SUB_DT } from "../src/game/physics.js";

/** Run a briefing's scene to rest (or to its own cap) and report what
 * happened, using the same calls core/briefing-demo.js makes. */
function playScene(briefing) {
  const d = briefing.demo;
  const world = createWorld({
    stones: d.stones.map((s, i) => ({ id: i, ...s })),
    obstacles: d.obstacles,
  });
  for (const s of world.stones) s.bumperBoosts = 0;
  for (const shot of d.shots) flick(world.stones[shot.stone], shot.dx, shot.dy, shot.power);
  const launchSpeed = world.stones.map((s) => Math.hypot(s.vx, s.vy));

  const types = new Set();
  let restAt = null;
  let bumperIn = null;
  let bumperOut = null;
  let elapsed = 0;
  while (elapsed < d.seconds + 1) {
    const before = world.stones.map((s) => Math.hypot(s.vx, s.vy));
    const events = stepWorld(world, SUB_DT);
    for (const e of events) {
      types.add(e.type);
      if (e.type === "bumperHit" && bumperIn === null) {
        bumperIn = before[0];
        bumperOut = Math.hypot(world.stones[0].vx, world.stones[0].vy);
      }
    }
    elapsed += SUB_DT;
    if (isAtRest(world)) {
      restAt = elapsed;
      break;
    }
  }
  return { world, types, restAt, launchSpeed, bumperIn, bumperOut };
}

// --- the kind mapping ----------------------------------------------------

test("a friction zone is two kinds, split on the multiplier", () => {
  // The one obstacle type that is not one lesson. Sand and ice are the
  // same `type: "zone"` with the multiplier on opposite sides of 1, and
  // showing a player the sand card and then dropping them onto ice would
  // be worse than showing nothing.
  assertEqual(kindOf({ type: "zone", friction: 3.4 }), "sand");
  assertEqual(kindOf({ type: "zone", friction: 0.32 }), "ice");
  assertEqual(kindOf({ type: "zone", friction: 1 }), "sand");
});

test("every other obstacle type maps to itself", () => {
  for (const type of ["wall", "peg", "hole", "bumper", "portal"]) {
    assertEqual(kindOf({ type }), type);
  }
});

test("kindOf survives junk", () => {
  assertEqual(kindOf(null), null);
  assertEqual(kindOf({}), null);
  assertEqual(kindOf({ type: 7 }), null);
});

// --- coverage ------------------------------------------------------------

test("every obstacle the campaign uses has a briefing", () => {
  // The check that makes this feature stay finished. Add a seventh
  // obstacle type to a stage and this fails immediately, rather than the
  // stage shipping with an unexplained thing on it.
  const missing = new Set();
  for (const stage of STAGES) {
    for (const o of stage.obstacles ?? []) {
      const kind = kindOf(o);
      if (!kind || !(kind in BRIEFINGS)) missing.add(kind ?? o.type);
    }
  }
  assertEqual([...missing], []);
});

test("every briefing is actually reachable in the campaign", () => {
  // The other direction: a briefing for something no stage contains is
  // dead weight in a build with a size budget.
  const used = new Set();
  for (const stage of STAGES) for (const o of stage.obstacles ?? []) used.add(kindOf(o));
  assertEqual(
    BRIEFING_IDS.filter((id) => !used.has(id)),
    []
  );
});

test("the aim-line card is shown once and is not an obstacle", () => {
  // It rides in BRIEFINGS so it can use the same card and the same seen
  // set, but it must never be selected by a stage: kindsInStage looks at
  // obstacle types, and nothing on a board is an "aim-line".
  assertTrue(!BRIEFING_IDS.includes(AIM_BRIEFING_ID), "obstacle ids must not include it");
  assertEqual(
    aimLineBriefing([]).map((b) => b.id),
    [AIM_BRIEFING_ID],
    "offered to a player who has not seen it"
  );
  assertEqual(aimLineBriefing([AIM_BRIEFING_ID]), [], "and never twice");
  const card = BRIEFINGS[AIM_BRIEFING_ID];
  assertTrue(card.demo.aim?.seconds > 0, "it holds on the aim, which is the thing it explains");
  assertTrue(card.demo.shots.length > 0, "and then actually takes the shot");
});

test("storage's briefing whitelist matches the game's", () => {
  // core/storage.js duplicates this list on purpose (it must not import
  // game logic). This is the price of that, same as THEME_IDS.
  assertEqual([...STORAGE_BRIEFING_IDS].sort(), [...ALL_BRIEFING_IDS].sort());
});

test("every briefing has a title, a one-sentence rule and a scene", () => {
  for (const id of BRIEFING_IDS) {
    const b = getBriefing(id);
    assertTrue(b.title.length > 0 && b.title.length <= 12, `${id}: title`);
    assertTrue(b.rule.length > 20 && b.rule.length < 130, `${id}: rule length ${b.rule.length}`);
    assertTrue(b.demo.stones.length > 0 && b.demo.shots.length > 0, `${id}: scene`);
  }
});

// --- what a stage asks for -----------------------------------------------

test("a stage asks for its obstacles in campaign order", () => {
  // The introduction slots, which the campaign's own spine defines: wall
  // at 3, peg at 6, pit at 9. Named by what they introduce rather than by
  // a number, because the numbers moved once already when the campaign
  // went from sixteen stages to a hundred.
  assertEqual(kindsInStage(getStage(3)), ["wall"]);
  assertEqual(kindsInStage(getStage(9)), ["hole"]);
  assertEqual(kindsInStage(getStage(13)), ["wall", "bumper"]);
  assertEqual(kindsInStage(getStage(19)), ["sand", "ice"]);
});

test("duplicates collapse", () => {
  // Slot 8 is the peg field; the player is told about pegs once.
  assertEqual(kindsInStage(getStage(8)), ["peg"]);
});

test("a stage with no obstacles asks for nothing", () => {
  assertEqual(kindsInStage(getStage(1)), []);
  assertEqual(kindsInStage({ obstacles: [] }), []);
  assertEqual(kindsInStage(undefined), []);
});

test("the seen set suppresses a briefing", () => {
  assertEqual(
    briefingsForStage(getStage(13), []).map((b) => b.id),
    ["wall", "bumper"]
  );
  // By the time the player reaches 13 they have met walls on stage 3.
  assertEqual(
    briefingsForStage(getStage(13), ["wall"]).map((b) => b.id),
    ["bumper"]
  );
  assertEqual(briefingsForStage(getStage(13), ["wall", "bumper"]), []);
});

test("playing the campaign in order shows each briefing exactly once", () => {
  // The whole point, stated as one assertion: no stage ever re-explains
  // something, and nothing is ever missed.
  const seen = [];
  const shownOn = new Map();
  for (const stage of STAGES) {
    for (const b of briefingsForStage(stage, seen)) {
      assertTrue(!shownOn.has(b.id), `${b.id} explained twice`);
      shownOn.set(b.id, stage.id);
      seen.push(b.id);
    }
  }
  assertEqual([...shownOn.keys()].sort(), [...BRIEFING_IDS].sort());
  // And each one lands on the stage that first uses it.
  // The introduction slots, one every three stages. These numbers are the
  // teaching spine (game/stages.js's HAND_SLOT) and a change to either
  // has to move both.
  assertEqual(shownOn.get("wall"), 3);
  assertEqual(shownOn.get("peg"), 6);
  assertEqual(shownOn.get("hole"), 9);
  assertEqual(shownOn.get("bumper"), 13);
  assertEqual(shownOn.get("portal"), 16);
  assertEqual(shownOn.get("sand"), 19);
  assertEqual(shownOn.get("ice"), 19);
});

test("a player who skipped ahead still gets the explanation", () => {
  // The reason this is a seen SET and not a stage-number table: jumping
  // straight to 14 must still explain the portal.
  assertEqual(
    briefingsForStage(getStage(16), ["wall"]).map((b) => b.id),
    ["portal"]
  );
});

// --- the scenes actually demonstrate their captions -----------------------

test("every scene comes to rest inside its own cap", () => {
  // core/briefing-demo.js treats `seconds` as a hard cap and freezes the
  // scene there. A scene that has not finished by then is shown cut off,
  // which is the one thing a demo must not do.
  for (const id of BRIEFING_IDS) {
    const { restAt } = playScene(BRIEFINGS[id]);
    assertTrue(restAt !== null, `${id}: never came to rest`);
    assertTrue(restAt < BRIEFINGS[id].demo.seconds, `${id}: rest at ${restAt?.toFixed(2)}s`);
  }
});

test("every scene's stone actually reaches its obstacle", () => {
  // The failure this exists for. The peg scene's first draft passed the
  // peg by 0.007 board units — no error, no event, just a stone rolling
  // across an empty board under the caption "it will not move."
  const contact = {
    wall: "obstacleHit",
    peg: "obstacleHit",
    hole: "sank",
    bumper: "bumperHit",
    portal: "teleported",
  };
  for (const [id, type] of Object.entries(contact)) {
    const { types } = playScene(BRIEFINGS[id]);
    assertTrue(types.has(type), `${id}: expected a ${type}, got [${[...types]}]`);
  }
});

test("the wall scene turns the stone back", () => {
  const { world } = playScene(BRIEFINGS.wall);
  const stone = world.stones[0];
  assertTrue(stone.alive, "stone survived");
  // Started at 0.88 heading up, the wall's near face is at 0.49.
  assertTrue(stone.y > 0.49, `ended below the wall at y=${stone.y.toFixed(2)}`);
});

test("the peg scene deflects the stone sideways", () => {
  const { world } = playScene(BRIEFINGS.peg);
  const stone = world.stones[0];
  const startX = BRIEFINGS.peg.demo.stones[0].x;
  // Fired straight up. Any sideways travel at all is the peg's doing, and
  // the caption promises it is visible, not marginal.
  assertTrue(Math.abs(stone.x - startX) > 0.15, `x moved only ${(stone.x - startX).toFixed(3)}`);
});

test("the pit scene swallows the stone", () => {
  const { world, types } = playScene(BRIEFINGS.hole);
  assertTrue(types.has("sank"), "sank");
  assertTrue(!world.stones[0].alive, "stone is gone");
});

test("the bumper scene sends the stone away faster than it arrived", () => {
  // The caption's exact claim, and the one rule in the game that is the
  // opposite of what everyday intuition supplies — which is why it is
  // worth a card of its own and worth asserting here.
  const { bumperIn, bumperOut, world } = playScene(BRIEFINGS.bumper);
  assertTrue(bumperOut > bumperIn * 1.3, `${bumperIn?.toFixed(2)} -> ${bumperOut?.toFixed(2)}`);
  // And it must be visible, not merely true: the stone ends up further
  // back than it was fired from.
  assertTrue(world.stones[0].alive, "stone survived");
  assertTrue(world.stones[0].y > BRIEFINGS.bumper.demo.stones[0].y, "came back past its start");
});

test("the portal scene puts the stone out the other side, still going the same way", () => {
  const { world, types } = playScene(BRIEFINGS.portal);
  const stone = world.stones[0];
  const [entry, exit] = BRIEFINGS.portal.demo.obstacles;
  assertTrue(types.has("teleported"), "teleported");
  assertTrue(stone.alive, "stone stayed on the board");
  // Came out at the far portal, on the far side of the board...
  assertTrue(Math.abs(stone.x - exit.x) < 0.06, `ended at x=${stone.x.toFixed(2)}, exit ${exit.x}`);
  assertTrue(Math.abs(stone.x - entry.x) > 0.3, "clearly not where it went in");
  // ...and kept travelling upward, which is the half of the rule a player
  // gets wrong.
  assertTrue(stone.y < exit.y, `ended at y=${stone.y.toFixed(2)}, exit ${exit.y}`);
});

test("the sand scene shows the same hit landing twice, with opposite results", () => {
  // Four stones: two identical shots at two identical targets, one pair
  // in the patch and one on bare wood. Both halves of the caption have to
  // be visible in the picture or the caption is doing work the demo does
  // not support.
  const demo = BRIEFINGS.sand.demo;
  assertEqual(demo.shots[0].power, demo.shots[1].power, "both shots must be identical or the scene proves nothing");
  assertEqual(
    demo.stones[0].y,
    demo.stones[2].y,
    "both strikers must start level"
  );
  assertEqual(demo.stones[1].y, demo.stones[3].y, "both targets must start level");

  const { world } = playScene(BRIEFINGS.sand);
  const [sandStriker, sandTarget, , woodTarget] = world.stones;
  // On bare wood the hit carries the target off the board...
  assertTrue(!woodTarget.alive, "the wood-side target should have been knocked off");
  // ...and in the sand the same hit barely moves it.
  assertTrue(sandTarget.alive, "the sand-side target was knocked off — the scene shows the opposite of its caption");
  assertTrue(
    Math.abs(sandTarget.y - demo.stones[1].y) < 0.12,
    `the sand target moved ${(demo.stones[1].y - sandTarget.y).toFixed(2)} — too far to read as "shoved"`
  );
  // The drag half: the striker crossing the patch stops inside it rather
  // than following the target through.
  assertTrue(sandStriker.alive && sandStriker.y > 0.45, `sand striker ended at y=${sandStriker.y.toFixed(2)}`);
});

test("the ice scene runs one stone past its twin", () => {
  const { world } = playScene(BRIEFINGS.ice);
  const [through, clear] = world.stones;
  assertEqual(BRIEFINGS.ice.demo.shots[0].power, BRIEFINGS.ice.demo.shots[1].power);
  const travelledThrough = BRIEFINGS.ice.demo.stones[0].y - through.y;
  const travelledClear = BRIEFINGS.ice.demo.stones[1].y - clear.y;
  assertTrue(travelledThrough - travelledClear > 0.15, `${travelledThrough.toFixed(2)} vs ${travelledClear.toFixed(2)}`);
});

test("no scene starts a stone or an obstacle off the board", () => {
  for (const id of BRIEFING_IDS) {
    const d = BRIEFINGS[id].demo;
    for (const s of d.stones) {
      assertTrue(s.x > 0.05 && s.x < 0.95 && s.y > 0.05 && s.y < 0.97, `${id}: stone at ${s.x},${s.y}`);
    }
    for (const o of d.obstacles) {
      const r = o.radius ?? 0;
      assertTrue(o.x - r >= -0.01 && o.x + (o.w ?? r) <= 1.01, `${id}: obstacle x`);
      assertTrue(o.y - r >= -0.01 && o.y + (o.h ?? r) <= 1.01, `${id}: obstacle y`);
    }
  }
});
