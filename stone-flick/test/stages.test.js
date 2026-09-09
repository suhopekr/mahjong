// test/stages.test.js
// A malformed stage is not a crash — it is a stage that is quietly
// impossible, or one where a stone starts inside a wall and jitters out
// on the first frame. Neither shows up in a screenshot, so every stage is
// checked structurally here.
import { test, assertTrue, assertEqual } from "./harness.js";
import { STAGES, HAND_SLOT, VERSUS_STONE_COUNTS, versusLayout, getStage, stageLabel, nextStageId, stonesForStage, LAST_STAGE_ID } from "../src/game/stages.js";
import { STONE_RADIUS as R } from "../src/game/physics.js";
import { STONE_RADIUS, createWorld, simulateToRest, countAlive } from "../src/game/physics.js";
import { MAX_STAGE_ID, VERSUS_STONE_COUNTS as STORED_COUNTS } from "../src/core/storage.js";

// Every campaign stage, plus every two-player layout the mode can
// actually produce — the count is a player choice, so "the 5-stone one is
// fine" says nothing about the 9-stone one.
const ALL = [...STAGES, ...VERSUS_STONE_COUNTS.map((n) => versusLayout(n))];

test("the two-player layout can seat either player on the near row", () => {
  const black = versusLayout(5, 0);
  const white = versusLayout(5, 1);
  const rowY = (layout, player) => layout.stones[player].map((p) => p.y);
  // Near row is 0.86, far row 0.14 — the same two rows either way, with
  // the sides exchanged. The seat is part of what a round swaps, because
  // pulling back toward yourself is steadier than pulling off the top of
  // the screen.
  assertEqual(rowY(black, 0), rowY(white, 1), "the near row is the near row whoever is on it");
  assertEqual(rowY(black, 1), rowY(white, 0));
  assertTrue(black.stones[0][0].y > black.stones[1][0].y, "player 0 is near by default");
  assertTrue(white.stones[1][0].y > white.stones[0][0].y, "and player 1 is near when asked");
  // Same stones, same columns — only the rows change hands.
  assertEqual(
    black.stones[0].map((p) => p.x),
    white.stones[1].map((p) => p.x),
    "swapping the seat must not reshape the row"
  );
});

test("stage ids are 1-based and contiguous", () => {
  STAGES.forEach((s, i) => assertEqual(s.id, i + 1, `stage at index ${i}`));
  assertEqual(nextStageId(LAST_STAGE_ID), null, "the last stage has no next");
  assertEqual(getStage(999), null);
});

test("core/storage.js's MAX_STAGE_ID matches the campaign", () => {
  // These are deliberately separate constants (storage must not import
  // game logic), which is exactly why they need a test to stay in step.
  assertEqual(MAX_STAGE_ID, LAST_STAGE_ID);
});

test("core/storage.js's stone-count whitelist matches the mode's own", () => {
  assertEqual(STORED_COUNTS, VERSUS_STONE_COUNTS);
});

test("every campaign stage declares a par a player could actually meet", () => {
  // A missing par silently caps the stage at one star (see
  // core/storage.js's starsForShots), which looks like a bug in the star
  // system rather than a missing field. And a par below the number of
  // opponents is unreachable: one shot cannot remove two stones reliably
  // enough to build a rating on.
  //
  // The upper bound used to be "opponents + 2", which assumed roughly one
  // shot per stone plus slack. That held while every stage was written by
  // hand at a gentle difficulty and broke the moment par started being
  // MEASURED: stage 98 needs eight shots for four opponents, because its
  // layout costs about two shots a stone, and the measurement is a better
  // authority on that than the assumption was. The bound is now twice the
  // opponents plus two -- still tight enough to catch a par of thirty,
  // loose enough to let a hard stage be hard.
  for (const stage of STAGES) {
    assertTrue(Number.isInteger(stage.par) && stage.par > 0, `stage ${stage.id} has no par`);
    const ceiling = stage.stones[1].length * 2 + 2;
    assertTrue(stage.par <= ceiling, `stage ${stage.id}: par ${stage.par} over the ${ceiling} ceiling`);
  }
});

test("every stage gives both sides at least one stone", () => {
  for (const stage of ALL) {
    assertTrue(stage.stones[0].length >= 1, `${stage.id}: player has no stones`);
    assertTrue(stage.stones[1].length >= 1, `${stage.id}: opponent has no stones`);
  }
});

test("no stone starts off the board, overlapping another, or inside an obstacle", () => {
  for (const stage of ALL) {
    const stones = stonesForStage(stage);
    for (const s of stones) {
      assertTrue(
        s.x > STONE_RADIUS && s.x < 1 - STONE_RADIUS && s.y > STONE_RADIUS && s.y < 1 - STONE_RADIUS,
        `${stage.id}: stone ${s.id} starts at the very edge (${s.x}, ${s.y})`
      );
    }
    for (let i = 0; i < stones.length; i++) {
      for (let j = i + 1; j < stones.length; j++) {
        const d = Math.hypot(stones[i].x - stones[j].x, stones[i].y - stones[j].y);
        assertTrue(d > STONE_RADIUS * 2, `${stage.id}: stones ${i} and ${j} overlap (${d.toFixed(4)})`);
      }
    }
    for (const s of stones) {
      for (const o of stage.obstacles ?? []) {
        if (o.type === "wall") {
          const cx = Math.max(o.x, Math.min(s.x, o.x + o.w));
          const cy = Math.max(o.y, Math.min(s.y, o.y + o.h));
          assertTrue(Math.hypot(s.x - cx, s.y - cy) > STONE_RADIUS, `${stage.id}: stone ${s.id} starts inside a wall`);
        } else if (o.type === "zone") {
          // Deliberately allowed: a zone is floor, not an object, and
          // starting a side on ice could be a real design choice. Nothing
          // to check.
        } else {
          // A collider needs its own radius plus the stone's; a hole or a
          // portal only needs the stone's centre to be outside it, since
          // that is what they test.
          const collider = o.type === "peg" || o.type === "bumper";
          const clearance = collider ? o.radius + STONE_RADIUS : o.radius;
          assertTrue(Math.hypot(s.x - o.x, s.y - o.y) > clearance, `${stage.id}: stone ${s.id} starts in a ${o.type}`);
        }
      }
    }
  }
});

test("every portal is paired, and pairs are far enough apart to be worth using", () => {
  // An unpaired portal is inert (game/physics.js refuses to crash on
  // one), which means a typo produces a stage that looks like it has a
  // route and does not. Nothing but a test will catch that.
  for (const stage of ALL) {
    const links = {};
    for (const o of stage.obstacles ?? []) {
      if (o.type !== "portal") continue;
      (links[o.link] ??= []).push(o);
    }
    for (const [link, ends] of Object.entries(links)) {
      assertEqual(ends.length, 2, `${stage.id}: portal link ${link} has ${ends.length} end(s)`);
      const gap = Math.hypot(ends[0].x - ends[1].x, ends[0].y - ends[1].y);
      // Closer than their own radii and a stone would arrive at the exit
      // still inside the entry, which the re-entry lock handles but which
      // makes for an incomprehensible stage.
      assertTrue(gap > ends[0].radius + ends[1].radius + STONE_RADIUS * 2, `${stage.id}: portal link ${link} ends nearly overlap`);
    }
  }
});

test("every friction zone actually changes something", () => {
  for (const stage of ALL) {
    for (const o of stage.obstacles ?? []) {
      if (o.type !== "zone") continue;
      assertTrue(o.friction > 0, `${stage.id}: a zone with friction ${o.friction} would stop time`);
      assertTrue(Math.abs(o.friction - 1) > 0.15, `${stage.id}: a zone at friction ${o.friction} is indistinguishable from bare board`);
    }
  }
});

test("obstacles sit fully on the board", () => {
  for (const stage of ALL) {
    for (const o of stage.obstacles ?? []) {
      if (o.type === "wall") {
        assertTrue(o.x >= 0 && o.y >= 0 && o.x + o.w <= 1 && o.y + o.h <= 1, `${stage.id}: wall off board`);
      } else {
        assertTrue(o.x - o.radius >= 0 && o.x + o.radius <= 1, `${stage.id}: ${o.type} off board in x`);
        assertTrue(o.y - o.radius >= 0 && o.y + o.radius <= 1, `${stage.id}: ${o.type} off board in y`);
      }
    }
  }
});

test("no obstacle overlaps another", () => {
  // This check used to be in the TITLE of the test above and nowhere in
  // its body, which is worse than having no test: the suite claimed the
  // property and never looked. It went unnoticed until a player found a
  // peg sitting exactly on the centre of a hole on stage 10, so the hole
  // could not be reached at all.
  //
  // Zones are exempt, and only zones: they have no collision, so a patch
  // of sand under a peg is a legal and sometimes deliberate arrangement.
  // Everything else either blocks a stone or consumes it, and two of
  // those in the same place means one of them silently does not work.
  const solid = (o) => o.type !== "zone";
  const distance = (a, b) => {
    if (a.type === "wall" && b.type === "wall") {
      const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
      const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
      return Math.hypot(dx, dy);
    }
    if (a.type === "wall" || b.type === "wall") {
      const [w, c] = a.type === "wall" ? [a, b] : [b, a];
      const cx = Math.max(w.x, Math.min(c.x, w.x + w.w));
      const cy = Math.max(w.y, Math.min(c.y, w.y + w.h));
      return Math.hypot(c.x - cx, c.y - cy) - c.radius;
    }
    return Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
  };

  for (const stage of ALL) {
    const obstacles = (stage.obstacles ?? []).filter(solid);
    for (let i = 0; i < obstacles.length; i++) {
      for (let j = i + 1; j < obstacles.length; j++) {
        const gap = distance(obstacles[i], obstacles[j]);
        assertTrue(
          gap > 0,
          `${stage.id}: ${obstacles[i].type} and ${obstacles[j].type} overlap (gap ${gap.toFixed(4)})`
        );
      }
    }
  }
});

// A "gap too narrow for a stone" check lived here briefly and was
// deleted on its first run: it flagged stage 4's peg COLUMNS, which are
// deliberately tight because they are a barrier, not a gate. Telling a
// wall of pegs apart from a doorway needs intent the data does not carry,
// and the failure it was aiming at — a stage whose only route does not
// exist — is already caught properly by `npm run balance`, which reports
// a stall rate from actually playing the stage rather than guessing at
// geometry.

test("nothing settles on its own: an untouched stage stays exactly as authored", () => {
  // If a layout is illegal in a way the checks above miss, the physics
  // will resolve the overlap on frame one and the stage the player sees
  // will not be the stage that was designed.
  for (const stage of ALL) {
    const world = createWorld({ stones: stonesForStage(stage), obstacles: stage.obstacles ?? [] });
    const before = world.stones.map((s) => `${s.x.toFixed(6)},${s.y.toFixed(6)}`).join("|");
    simulateToRest(world, 1);
    const after = world.stones.map((s) => `${s.x.toFixed(6)},${s.y.toFixed(6)}`).join("|");
    assertEqual(after, before, `stage ${stage.id} drifted at rest`);
    assertEqual(countAlive(world, 0) + countAlive(world, 1), world.stones.length, `stage ${stage.id} lost a stone at rest`);
  }
});

test("every two-player count keeps its stones individually grabbable", () => {
  // The reason 9 is the ceiling. game/layout.js grabs a stone within 1.5
  // radii, so once half the spacing falls below that, a tap between two
  // stones is a coin flip over which one it picks up — and picking up the
  // wrong stone costs a turn.
  const GRAB = R * 1.5;
  for (const count of VERSUS_STONE_COUNTS) {
    const stones = stonesForStage(versusLayout(count)).filter((s) => s.player === 0);
    for (let i = 1; i < stones.length; i++) {
      const gap = stones[i].x - stones[i - 1].x;
      assertTrue(gap / 2 > GRAB, `${count} stones: spacing ${gap.toFixed(4)} is too tight for a ${GRAB.toFixed(4)} grab radius`);
    }
  }
});

test("an unoffered two-player count falls back instead of breaking the mode", () => {
  // This value comes from a stored preference, so a hand-edited save must
  // not be able to produce a layout with 40 stones or none at all.
  for (const bogus of [0, 1, 4, 13, 999, -3, NaN, undefined]) {
    const layout = versusLayout(bogus);
    assertTrue(VERSUS_STONE_COUNTS.includes(layout.stoneCount), `${bogus} produced ${layout.stoneCount}`);
  }
});

test("stone counts climb through the hand-authored spine", () => {
  // A soft check on purpose — difficulty is mostly layout, not counts —
  // but a stage that hands the AI fewer stones than the one before it is
  // usually an editing mistake. Reset at each act boundary, because an
  // act that introduces a new mechanic SHOULD start gentler than the
  // finale of the one before it: the player is a beginner again for one
  // stage.
  //
  // SCOPED TO THE SPINE after the campaign went to a hundred. For the
  // sixteen hand-authored stages a rising count was the author's intent,
  // so a drop really is an editing mistake. For the generated ones it is
  // not: their order comes from what a decent player actually managed
  // against them, and a stage with two opponents behind a closed screen
  // measures harder than four in the open. Asserting counts climb there
  // would be asserting the wrong axis -- this file's own note above, and
  // stages.js's header, both say difficulty is layout.
  // Reset at an INTRODUCTION, not at a chapter boundary. The comment
  // above always meant "the player is a beginner again for one stage",
  // and what makes them a beginner is meeting a new element -- chapters
  // are every ten stages now and have nothing to do with it. The
  // five-peg stage hands the AI five stones and the pit introduction
  // right after it hands them three, which is the intent, not a slip.
  const spine = new Set(Object.values(HAND_SLOT));
  const introduces = new Set([3, 6, 9, 13, 16, 19]);
  let previous = 0;
  for (const stage of STAGES) {
    if (!spine.has(stage.id)) continue;
    if (introduces.has(stage.id)) previous = 0;
    const opponents = stage.stones[1].length;
    assertTrue(opponents >= previous - 1, `stage ${stage.id} drops from ${previous} to ${opponents} opponents`);
    previous = opponents;
  }
});

test("every sand patch declares how much it deadens a contact", () => {
  // Sand is two rules, not one — it drags a moving stone down AND it
  // takes the sting out of an impact landed in it. A patch that declares
  // only the first is the bug that was reported from play: it looks like
  // cover, and a full-power shot knocks your stone straight out of it.
  //
  // Enforced structurally rather than fixed twice, because the failure is
  // silent. A stage author adding a sand patch and forgetting `bounce`
  // gets a stage that reads as protective and is not, and nothing else in
  // the suite would notice.
  const offenders = [];
  for (const stage of STAGES) {
    for (const o of stage.obstacles ?? []) {
      if (o.type !== "zone" || o.friction <= 1) continue;
      if (!(o.bounce > 0 && o.bounce < 1)) offenders.push(`stage ${stage.id} at ${o.x},${o.y}`);
    }
  }
  assertEqual(offenders, []);
});

test("no ice lane deadens a contact", () => {
  // The other direction, and the reason the rule above is keyed on
  // friction rather than applied to every zone: ice is hard. A collision
  // on it should ring exactly as it does on bare wood, which is also what
  // its briefing card claims.
  const offenders = [];
  for (const stage of STAGES) {
    for (const o of stage.obstacles ?? []) {
      if (o.type === "zone" && o.friction < 1 && o.bounce !== undefined) {
        offenders.push(`stage ${stage.id} at ${o.x},${o.y}`);
      }
    }
  }
  assertEqual(offenders, []);
});

test("a campaign stage is identified by its number and nothing else", () => {
  // The sixteen hand-written names were deleted deliberately: they were
  // only affordable at sixteen, and the plan is thousands. A number is
  // how a player says where they are stuck and how a bug report
  // identifies a layout at any campaign size.
  assertEqual(stageLabel(getStage(16)), "Stage 16");
  assertEqual(stageLabel(getStage(1)), "Stage 1");
});

test("no campaign stage carries a name any more", () => {
  // Structural, because the failure is silent: one stage keeping a name
  // would put it in the balance report and nowhere else, and nothing
  // would ever say so.
  assertEqual(STAGES.filter((s) => s.name !== undefined).map((s) => s.id), []);
});

test("every stage still says what it teaches", () => {
  // `teaches` is what replaced the names: prose about the LAYOUT, which
  // stays honest at any campaign size in a way a name does not.
  for (const stage of STAGES) {
    assertTrue(typeof stage.teaches === "string" && stage.teaches.length > 20, `stage ${stage.id}: teaches`);
  }
});

test("a nameless or id-less stage still labels cleanly", () => {
  // The two-player layout has no id, and a future generated stage may
  // have no name worth printing. Neither should produce "Stage
  // undefined:" in the HUD.
  assertEqual(stageLabel(versusLayout(5)), "Two Players");
  assertEqual(stageLabel({ id: 4426 }), "Stage 4426");
  assertEqual(stageLabel({ id: 7, name: "ignored" }), "Stage 7");
  assertEqual(stageLabel(null), "");
});
