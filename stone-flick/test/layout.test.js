// test/layout.test.js
import { test, assertEqual, assertTrue } from "./harness.js";
import {
  boardLayout, toPx, toBoard, stoneAtPoint, dragToShot, shotToDrag,
  MAX_DRAG, MIN_DRAG, POWER_CURVE,
} from "../src/game/layout.js";
import { STONE_RADIUS } from "../src/game/physics.js";

test("the board reserves exactly one stone radius of margin on every side", () => {
  // The whole reason this file solves an equality rather than picking a
  // padding: a stone may legally hang half off the edge and must not be
  // clipped at the moment the player is watching it teeter.
  for (const [w, h] of [[320, 320], [390, 700], [900, 500], [1024, 1024]]) {
    const layout = boardLayout(w, h);
    const margin = Math.min(layout.originX, layout.originY);
    const needed = STONE_RADIUS * layout.size;
    assertTrue(margin >= needed - 1e-9, `${w}x${h}: margin ${margin} < needed ${needed}`);
    assertTrue(margin - needed < 1e-6, `${w}x${h}: margin ${margin} wastes space over ${needed}`);
  }
});

test("board <-> pixel conversion round-trips", () => {
  const layout = boardLayout(500, 500);
  for (const [bx, by] of [[0, 0], [0.5, 0.5], [1, 1], [-0.05, 1.05]]) {
    const p = toPx(layout, bx, by);
    const back = toBoard(layout, p.x, p.y);
    assertTrue(Math.abs(back.x - bx) < 1e-9 && Math.abs(back.y - by) < 1e-9, `${bx},${by}`);
  }
});

test("toBoard is deliberately unclamped", () => {
  // The pull-back drag routinely goes past the board's edge; clamping
  // here would silently cap power.
  const layout = boardLayout(400, 400);
  const outside = toBoard(layout, -50, -50);
  assertTrue(outside.x < 0 && outside.y < 0, "coordinates outside the board stay outside");
});

test("stone hit test picks the nearest stone and misses empty space", () => {
  const layout = boardLayout(400, 400);
  const stones = [
    { id: 7, x: 0.3, y: 0.3 },
    { id: 8, x: 0.34, y: 0.3 },
  ];
  const near7 = toPx(layout, 0.3, 0.3);
  assertEqual(stoneAtPoint(layout, stones, near7.x, near7.y).id, 7);
  const near8 = toPx(layout, 0.345, 0.3);
  assertEqual(stoneAtPoint(layout, stones, near8.x, near8.y).id, 8);
  const empty = toPx(layout, 0.8, 0.8);
  assertEqual(stoneAtPoint(layout, stones, empty.x, empty.y), null);
});

test("the grab radius is symmetric in every direction", () => {
  // Dots and Boxes shipped an asymmetric hit box (its edge-based test had
  // fewer candidates near a corner) and it was only ever found by hand in
  // a browser. A circular catchment around a point cannot have that bug,
  // and this test is what keeps it that way.
  const layout = boardLayout(400, 400);
  const stones = [{ id: 1, x: 0.5, y: 0.5 }];
  const r = STONE_RADIUS * 1.4 * layout.scale;
  for (let i = 0; i < 16; i++) {
    const angle = (Math.PI * 2 * i) / 16;
    const centre = toPx(layout, 0.5, 0.5);
    const hit = stoneAtPoint(layout, stones, centre.x + Math.cos(angle) * r, centre.y + Math.sin(angle) * r);
    assertTrue(hit !== null, `missed at angle ${angle.toFixed(2)}`);
  }
});

test("the shot fires opposite the drag, and power saturates at MAX_DRAG", () => {
  // minDrag 0 throughout this test and the next: they are about the CURVE,
  // and a floor would move every number in them for a reason that has
  // nothing to do with what they are checking. The floor has its own
  // tests below.
  const pulledDown = dragToShot(0.5, 0.5, 0.5, 0.5 + MAX_DRAG / 2, 0);
  assertTrue(pulledDown.dirY < 0, "pulling down shoots up");
  assertTrue(Math.abs(pulledDown.power - 0.5 ** POWER_CURVE) < 1e-9, `power ${pulledDown.power}`);
  const overdrawn = dragToShot(0.5, 0.5, 0.5, 0.5 + MAX_DRAG * 3, 0);
  assertEqual(overdrawn.power, 1, "power never exceeds 1");
});

// THE FLOOR IS PART OF THE MAPPING, not a test applied after it.
//
// It was a test applied after it, and that is what made the cancel zone
// unwidenable: every pixel given to the zone was a pixel of the dial
// thrown away. Subtracting it inside the mapping means the zone can be as
// wide as a thumb needs and the player still keeps every shot.
test("power starts at the floor and still reaches 1 at a full pull", () => {
  const floor = 0.06;
  const at = (d) => dragToShot(0.5, 0.5, 0.5, 0.5 + d, floor).power;
  // Floating point: 0.5 + 0.06 - 0.06 is not exactly 0.06, so "at the
  // floor" lands a few ulps either side of it. Under 1e-12 of power is a
  // stone that does not move.
  assertTrue(at(floor) < 1e-12, `exactly at the floor, got ${at(floor)}`);
  assertEqual(at(floor * 0.5), 0, "and inside it there is none at all");
  assertTrue(at(floor + 0.001) > 0, "a hair past it there is some");
  assertEqual(at(MAX_DRAG), 1, "a full pull is still a full pull");
  // The gentle end is the point: it exists now, where before it was
  // entirely inside the zone that threw shots away.
  assertTrue(at(floor + (MAX_DRAG - floor) * 0.1) < 0.05, "and the softest shots are genuinely soft");
});

test("shotToDrag is dragToShot's inverse, floor and all", () => {
  for (const floor of [0, MIN_DRAG, 0.06]) {
    for (const power of [0, 0.05, 0.25, 0.5, 0.75, 1]) {
      const drag = shotToDrag(power, floor);
      const back = dragToShot(0.5, 0.5, 0.5, 0.5 + drag, floor).power;
      assertTrue(Math.abs(back - power) < 1e-9, `floor ${floor} power ${power} came back ${back}`);
    }
  }
});

// The curve is what makes a soft shot LOOK soft: it is the whole reason
// POWER_CURVE exists, so a well-meaning "simplify this back to linear"
// has to fail here rather than pass quietly and flatten the game.
test("the power curve spends real travel on the slow half of the range", () => {
  const at = (fraction) => dragToShot(0.5, 0.5, 0.5, 0.5 + MAX_DRAG * fraction, 0).power;
  assertTrue(POWER_CURVE > 1, `POWER_CURVE ${POWER_CURVE}`);
  assertTrue(at(0.5) < 0.42, `half a pull should stay well under half power, got ${at(0.5)}`);
  // A quarter pull against a full one: linear gives 4:1, which is the
  // range players called indistinguishable.
  assertTrue(at(1) / at(0.25) > 6, `range only ${(at(1) / at(0.25)).toFixed(1)}:1`);
  // Still monotonic and still reaching exactly 1 at a full pull.
  let last = -1;
  for (let f = 0; f <= 1.0001; f += 0.05) {
    const p = at(f);
    assertTrue(p > last, `power fell at ${f.toFixed(2)}`);
    last = p;
  }
  assertEqual(at(1), 1, "a full pull is still full power");
});
