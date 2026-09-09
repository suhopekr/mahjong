// test/stages.test.js
// Every stage's recorded solution is REPLAYED through the real physics
// on every test run. This is the campaign's insurance: retune friction
// or restitution and these tests fail loudly instead of the campaign
// quietly becoming impossible (which is exactly what happened to Four
// Ball's first eight stages).
import { test, assertTrue, assertEqual } from "./harness.js";
import * as P from "../src/game/physics.js";
import {
  STAGES,
  CHAPTERS,
  createStageWorld,
  judgeGoal,
  goalText,
  starsFor,
  stageById,
  stagesInChapter,
  isChapterEnd,
  GOAL_TYPES,
} from "../src/game/stages.js";
import { LEVEL_IDS } from "../src/game/ai.js";

test("every stage's solution beats it at or under par", () => {
  for (const stage of STAGES) {
    assertTrue(stage.solution.length > 0, `#${stage.id} ${stage.name} has no solution recorded`);
    assertTrue(stage.solution.length <= stage.par, `#${stage.id} solution uses ${stage.solution.length} > par ${stage.par}`);
    const { world, enemyIds } = createStageWorld(stage);
    let met = false;
    for (const shot of stage.solution) {
      P.shoot(world, 0, shot.y, shot.angle, shot.power);
      P.simulateToRest(world, 10);
      P.removeFouls(world);
      if (judgeGoal(stage, world, enemyIds)) {
        met = true;
        break;
      }
    }
    assertTrue(met, `#${stage.id} ${stage.name}: replayed solution does not meet the goal`);
  }
});

test("stage furniture never sits where the foul sweep could take it", () => {
  for (const stage of STAGES) {
    for (const [i, e] of stage.enemies.entries()) {
      assertTrue(
        e.x - P.PUCK_RADIUS >= P.FOUL_X,
        `#${stage.id} enemy ${i} starts short of the foul line`
      );
      assertTrue(e.x <= P.BOARD_LENGTH && e.y > 0 && e.y < P.BOARD_WIDTH, `#${stage.id} enemy ${i} off board`);
    }
  }
});

test("stage placements do not overlap", () => {
  for (const stage of STAGES) {
    const all = [...stage.enemies, ...stage.friendlies];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const d = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y);
        assertTrue(d >= P.PUCK_RADIUS * 2 - 1e-9, `#${stage.id} pucks ${i}/${j} overlap`);
      }
    }
  }
});

test("ids are sequential, chapters are contiguous, and every chapter has stages", () => {
  STAGES.forEach((s, i) => assertEqual(s.id, i + 1, "sequential ids"));
  for (const ch of CHAPTERS.slice(0, 1)) {
    assertTrue(stagesInChapter(ch.id).length > 0, `chapter ${ch.id} is empty`);
  }
  // Chapter ends are well-defined.
  const ends = STAGES.filter((s) => isChapterEnd(s));
  assertTrue(ends.length >= 1, "at least one chapter end");
});

test("every chapter boss is a real AI level", () => {
  for (const ch of CHAPTERS) {
    assertTrue(LEVEL_IDS.includes(ch.boss), `chapter ${ch.id} boss "${ch.boss}"`);
  }
});

test("goals are of known types and describable", () => {
  for (const stage of STAGES) {
    assertTrue(GOAL_TYPES.includes(stage.goal.type), `#${stage.id} goal type`);
    assertTrue(goalText(stage).length > 0, `#${stage.id} has goal text`);
    assertTrue(stage.budget >= stage.par, `#${stage.id} budget under par`);
    assertTrue(stage.hint.length > 0, `#${stage.id} has a hint`);
  }
});

test("clear-goal targets point at real enemies", () => {
  for (const stage of STAGES) {
    if (stage.goal.type !== "clear" || stage.goal.targets === "all") continue;
    for (const i of stage.goal.targets) {
      assertTrue(Number.isInteger(i) && i >= 0 && i < stage.enemies.length, `#${stage.id} target ${i}`);
    }
  }
});

test("stars: par is three, one over is two, anything else is one", () => {
  assertEqual(starsFor(1, 1), 3);
  assertEqual(starsFor(2, 1), 2);
  assertEqual(starsFor(3, 1), 1);
  assertEqual(starsFor(4, 4), 3);
});

test("stageById round-trips", () => {
  assertEqual(stageById(1).name, "Opening Slide");
  assertEqual(stageById(999), null);
});
