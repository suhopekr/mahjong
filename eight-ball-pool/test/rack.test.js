// test/rack.test.js — the triangle, the spots, placement validity.
import { test, assertEqual, assertTrue } from "./harness.js";
import * as P from "../src/game/physics.js";
import {
  rackPositions,
  newRackWorld,
  FOOT_SPOT,
  HEAD_SPOT,
  HEAD_STRING,
  isValidPlacement,
  nearestPlacement,
  spotBall,
  groupOf,
  SOLIDS,
  STRIPES,
  makeRng,
} from "../src/game/rack.js";

const R = P.BALL_RADIUS;

test("the rack has fifteen balls, the 8 in the middle of the third row, apex on the foot spot", () => {
  const rack = rackPositions(5);
  assertEqual(rack.length, 15);
  const ids = rack.map((b) => b.id).sort();
  assertEqual(ids, [...SOLIDS, ...STRIPES, "8"].sort());
  assertEqual(rack[4].id, "8", "slot 4 is the 8");
  assertTrue(Math.abs(rack[4].x - (FOOT_SPOT.x + 2 * (2 * R + 0.0003) * Math.sqrt(3) / 2)) < 1e-9, "third row");
  assertTrue(Math.abs(rack[4].y - FOOT_SPOT.y) < 1e-9, "on the long string");
  assertTrue(Math.abs(rack[0].x - FOOT_SPOT.x) < 1e-9 && Math.abs(rack[0].y - FOOT_SPOT.y) < 1e-9, "apex on the foot spot");
});

test("the back corners hold one solid and one stripe", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const rack = rackPositions(seed);
    const corners = [groupOf(rack[10].id), groupOf(rack[14].id)].sort();
    assertEqual(corners, ["solid", "stripe"], `seed ${seed}`);
  }
});

test("no two racked balls overlap and every ball is on the cloth", () => {
  const w = newRackWorld(11);
  for (let i = 0; i < w.balls.length; i++) {
    const a = w.balls[i];
    assertTrue(a.x >= R && a.x <= w.length - R && a.y >= R && a.y <= w.width - R, `${a.id} on the cloth`);
    for (let j = i + 1; j < w.balls.length; j++) {
      const b = w.balls[j];
      assertTrue(Math.hypot(a.x - b.x, a.y - b.y) >= 2 * R - 1e-9, `${a.id} and ${b.id} apart`);
    }
  }
  assertEqual(w.balls[0].id, "cue");
  assertTrue(Math.abs(w.balls[0].x - HEAD_SPOT.x) < 1e-9, "cue on the head spot");
});

test("racks are deterministic by seed and differ between seeds", () => {
  assertEqual(rackPositions(9).map((b) => b.id), rackPositions(9).map((b) => b.id));
  const a = rackPositions(1).map((b) => b.id).join();
  const b = rackPositions(2).map((b) => b.id).join();
  assertTrue(a !== b, "different seeds, different racks");
  const rng = makeRng(42);
  const x = rng();
  assertTrue(x >= 0 && x < 1);
});

test("placement: off other balls, on the cloth, in the kitchen when asked", () => {
  const w = newRackWorld(1);
  assertTrue(!isValidPlacement(w, FOOT_SPOT.x, FOOT_SPOT.y), "on the apex ball");
  assertTrue(!isValidPlacement(w, FOOT_SPOT.x - 1.5 * R, FOOT_SPOT.y), "overlapping the apex ball");
  assertTrue(isValidPlacement(w, 0.3, 0.3), "open cloth");
  assertTrue(!isValidPlacement(w, R * 0.5, 0.3), "off the cloth");
  assertTrue(!isValidPlacement(w, 0.3, w.width - R * 0.5), "off the cloth (far rail)");
  assertTrue(!isValidPlacement(w, HEAD_STRING + 0.01, 0.3, { kitchen: true }), "past the head string");
  assertTrue(isValidPlacement(w, HEAD_STRING - 0.01, 0.3, { kitchen: true }), "behind it");
  const near = nearestPlacement(w, FOOT_SPOT.x, FOOT_SPOT.y);
  assertTrue(near && isValidPlacement(w, near.x, near.y), "nearest placement is legal");
});

test("spotting the 8 uses the foot spot, or the next free point down the long string", () => {
  const w = newRackWorld(1);
  const eight = P.getBall(w, "8");
  eight.pocketed = true;
  // The foot spot is under the apex ball, so it has to go further down.
  assertTrue(spotBall(w, "8"), "spotted");
  assertTrue(!eight.pocketed, "back on the table");
  assertTrue(isValidPlacement(w, eight.x, eight.y, { ignoreId: "8" }), "legal spot");
  assertTrue(Math.abs(eight.y - FOOT_SPOT.y) < 1e-9, "on the long string");
  // With the rack gone it takes the spot itself.
  const w2 = P.createWorld({ balls: [{ id: "cue", x: 0.3, y: 0.3 }, { id: "8", x: 1, y: 0.5, pocketed: true }] });
  spotBall(w2, "8");
  assertTrue(Math.abs(P.getBall(w2, "8").x - FOOT_SPOT.x) < 1e-9, "foot spot");
});
