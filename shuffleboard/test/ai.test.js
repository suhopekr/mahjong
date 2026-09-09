// test/ai.test.js
import { test, assertTrue, assertEqual } from "./harness.js";
import * as P from "../src/game/physics.js";
import * as AI from "../src/game/ai.js";
import { scoreFrame } from "../src/game/rules.js";

test("the same seed plans the same shot", () => {
  const w = P.createWorld();
  const a = AI.chooseShot(w, 1, AI.LEVELS.medium, AI.makeRng(7));
  const b = AI.chooseShot(w, 1, AI.LEVELS.medium, AI.makeRng(7));
  assertEqual(a.shot, b.shot);
});

test("on an empty board the hard AI scores more often than not", () => {
  // Not "always": the profitable draws sit a hand's width from the far
  // edge, so even a 2% power miss sometimes pays the gutter. That risk
  // is the game, and an AI that only ever played the safe 2 would be
  // dull to beat. What is pinned here is that the hard AI comes out of
  // an open board with points clearly more often than it comes out empty.
  const rng = AI.makeRng(11);
  let scoring = 0;
  const N = 20;
  for (let i = 0; i < N; i++) {
    const w = P.createWorld();
    const { shot } = AI.chooseShot(w, 1, AI.LEVELS.hard, rng);
    P.shoot(w, 1, shot.y, shot.angle, shot.power);
    P.simulateToRest(w, 8);
    P.removeFouls(w);
    const r = scoreFrame(w);
    if (r.winner === 1 && r.points > 0) scoring++;
  }
  assertTrue(scoring >= N * 0.6, `hard AI scored on ${scoring}/${N} open boards`);
});

test("the easy AI misses meaningfully more than the hard AI", () => {
  const spread = (level, seed) => {
    const rng = AI.makeRng(seed);
    let sum = 0;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const w = P.createWorld();
      const { shot } = AI.chooseShot(w, 1, level, rng);
      P.shoot(w, 1, shot.y, shot.angle, shot.power);
      P.simulateToRest(w, 8);
      P.removeFouls(w);
      const r = scoreFrame(w);
      sum += r.winner === 1 ? r.points : 0;
    }
    return sum / N;
  };
  const easy = spread(AI.LEVELS.easy, 3);
  const hard = spread(AI.LEVELS.hard, 3);
  assertTrue(hard > easy + 0.4, `hard ${hard.toFixed(2)} vs easy ${easy.toFixed(2)} points per open shot`);
});

test("with an opposing weight parked in the 3, the AI finds a shot that deals with it", () => {
  // Park a side-0 weight well into the 3-zone, middle lane.
  const w = P.createWorld();
  P.shoot(w, 0, P.BOARD_WIDTH / 2, 0, P.powerFor(P.BOARD_LENGTH - P.ZONE_3_DEPTH + P.PUCK_RADIUS + 0.03 - P.START_X));
  P.simulateToRest(w);
  const before = scoreFrame(w);
  assertEqual(before.winner, 0, "setup: side 0 leads with a 3");
  const rng = AI.makeRng(5);
  let dealt = 0;
  const N = 12;
  for (let i = 0; i < N; i++) {
    const trial = P.cloneWorld(w);
    const { shot } = AI.chooseShot(trial, 1, AI.LEVELS.hard, rng);
    P.shoot(trial, 1, shot.y, shot.angle, shot.power);
    P.simulateToRest(trial, 8);
    P.removeFouls(trial);
    const r = scoreFrame(trial);
    // Dealt with it: side 0 no longer scores that 3 uncontested.
    if (r.winner !== 0 || r.points < before.points) dealt++;
  }
  assertTrue(dealt >= N * 0.6, `hard AI answered the 3 in ${dealt}/${N} tries`);
});

test("promotion needs three recent wins; five straight losses demote", () => {
  assertEqual(AI.nextLevel("easy", ["W", "W", "W"]), "medium");
  assertEqual(AI.nextLevel("easy", ["W", "L", "L", "L", "L"]), "easy");
  assertEqual(AI.nextLevel("medium", ["L", "L", "L", "L", "L"]), "easy");
  assertEqual(AI.nextLevel("easy", []), "easy");
  assertEqual(AI.nextLevel("hard", ["W", "W", "W", "W", "W"]), "hard", "nowhere above hard");
  assertEqual(AI.nextLevel("easy", ["L", "L", "L", "L", "L"]), "easy", "nowhere below easy");
});
