// test/ai.test.js
// The AI is judged on BEHAVIOUR, not on picking a particular shot: it
// plans by sampling, so any single choice is legitimately variable. What
// must not vary is that it takes a free kill when one exists, that it
// does not throw its own stones away, and that it gets meaningfully
// better with difficulty.
import { test, assertTrue, assertEqual } from "./harness.js";
import { chooseShot, DIFFICULTY } from "../src/game/ai.js";
import { createWorld, cloneWorld, flick, simulateToRest, countAlive, STONE_RADIUS } from "../src/game/physics.js";

/** A deterministic RNG so a flaky run is a real regression, not luck. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function stone(id, player, x, y) {
  return { id, player, x, y, radius: STONE_RADIUS };
}

function playShot(world, shot) {
  const next = cloneWorld(world);
  const s = next.stones.find((st) => st.id === shot.stoneId);
  flick(s, shot.dirX, shot.dirY, shot.power);
  simulateToRest(next);
  return next;
}

test("every difficulty is defined with the knobs the AI reads", () => {
  for (const level of ["easy", "medium", "hard"]) {
    const config = DIFFICULTY[level];
    assertTrue(config.candidates > 0 && config.angleJitter >= 0 && config.powerJitter >= 0, level);
  }
  assertTrue(DIFFICULTY.hard.candidates > DIFFICULTY.easy.candidates, "hard searches more");
  assertTrue(DIFFICULTY.hard.angleJitter < DIFFICULTY.easy.angleJitter, "hard aims straighter");
});

test("it returns null only when it has nothing to shoot with", () => {
  const empty = createWorld({ stones: [stone(0, 0, 0.5, 0.5)] });
  assertEqual(chooseShot(empty, 1, "hard", seeded(1)), null);
});

test("hard takes a stone sitting on the edge", () => {
  // The opponent stone is one nudge from the top edge and directly in
  // front of an AI stone. Missing this is not "a weaker AI," it is a
  // broken one.
  const world = createWorld({
    stones: [stone(0, 1, 0.5, 0.5), stone(1, 0, 0.5, 0.04)],
  });
  let kills = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const shot = chooseShot(world, 1, "hard", seeded(seed));
    const after = playShot(world, shot);
    if (countAlive(after, 0) === 0) kills++;
  }
  assertTrue(kills >= 9, `hard converted only ${kills}/10`);
});

test("hard beats easy over a run of the same position", () => {
  const world = createWorld({
    stones: [stone(0, 1, 0.5, 0.2), stone(1, 1, 0.35, 0.2), stone(2, 0, 0.5, 0.82), stone(3, 0, 0.62, 0.86)],
  });
  const score = (level) => {
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const after = playShot(world, chooseShot(world, 1, level, seeded(seed * 7)));
      total += (2 - countAlive(after, 0)) * 2 - (2 - countAlive(after, 1));
    }
    return total;
  };
  const hard = score("hard");
  const easy = score("easy");
  assertTrue(hard > easy, `hard ${hard} did not beat easy ${easy}`);
});

test("it does not fire its own stone off the board when a safe shot exists", () => {
  // The AI stone is close to the top edge with the target below it, so
  // the tempting straight-line shot is backwards and suicidal.
  const world = createWorld({
    stones: [stone(0, 1, 0.5, 0.1), stone(1, 1, 0.5, 0.35), stone(2, 0, 0.5, 0.8)],
  });
  let suicides = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const after = playShot(world, chooseShot(world, 1, "hard", seeded(seed * 13)));
    if (countAlive(after, 1) < 2) suicides++;
  }
  assertTrue(suicides <= 2, `hard threw away a stone ${suicides}/15 times`);
});

test("planning is fast enough to run inside the pre-move pause", () => {
  // The UI waits ~620ms before the AI moves, for legibility. If planning
  // ever costs more than that, the pause stops being a choice.
  const stones = [];
  for (let i = 0; i < 7; i++) stones.push(stone(i, 1, 0.1 + i * 0.13, 0.14));
  for (let i = 0; i < 5; i++) stones.push(stone(10 + i, 0, 0.15 + i * 0.17, 0.86));
  const world = createWorld({
    stones,
    obstacles: [
      { type: "peg", x: 0.35, y: 0.6, radius: 0.026 },
      { type: "hole", x: 0.5, y: 0.42, radius: 0.06 },
    ],
  });
  const started = Date.now();
  chooseShot(world, 1, "hard", seeded(3));
  const elapsed = Date.now() - started;
  assertTrue(elapsed < 400, `planning took ${elapsed}ms on the largest stage`);
});
