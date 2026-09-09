// test/physics.test.js
// The physics module is the one place a wrong number is invisible until
// the game "feels off," so these tests check CONSERVATION and INVARIANTS
// rather than specific trajectories: a trajectory assertion would have to
// be regenerated every time a constant is tuned, which makes it a
// changelog, not a test.
import { test, assertEqual, assertTrue } from "./harness.js";
import {
  createWorld,
  flick,
  simulateToRest,
  isAtRest,
  stepWorld,
  countAlive,
  STONE_RADIUS,
  MAX_FLICK_SPEED,
  FRICTION_DECEL,
  BUMPER_MAX_SPEED,
  BUMPER_BOOST_BUDGET,
  beginShot,
  TIME_SCALE,
  SUB_DT,
  STOP_SPEED,
  MAX_TURN_SECONDS,
} from "../src/game/physics.js";

function stone(id, player, x, y) {
  return { id, player, x, y, radius: STONE_RADIUS };
}

test("a flicked stone eventually stops", () => {
  const world = createWorld({ stones: [stone(0, 0, 0.5, 0.9)] });
  flick(world.stones[0], 0, -1, 0.3);
  const { timedOut } = simulateToRest(world);
  assertTrue(!timedOut, "should come to rest well inside the turn budget");
  assertTrue(isAtRest(world), "at rest");
});

test("stopping distance matches v^2 / (2a) within a substep's slop", () => {
  // The one place an exact number IS worth asserting: this is the
  // relationship a player builds intuition on (double the power, four
  // times the distance), so a change to the integrator that quietly
  // breaks it would change how every stage plays.
  const world = createWorld({ stones: [stone(0, 0, 0.05, 0.5)] });
  const power = 0.5;
  flick(world.stones[0], 1, 0, power);
  const v = power * MAX_FLICK_SPEED;
  const expected = (v * v) / (2 * FRICTION_DECEL);
  simulateToRest(world);
  const travelled = world.stones[0].x - 0.05;
  assertTrue(Math.abs(travelled - expected) < 0.01, `travelled ${travelled}, expected ~${expected}`);
});

// TIME_SCALE plays the same game faster; it must not play a different
// game. Every constant it touches is speed- or time-dimensioned, and the
// scaling law below is what keeps a shot's PATH — and therefore every
// stage's par and every balance run — exactly where it was. Get one of
// these exponents wrong and nothing crashes: the game just quietly
// rebalances itself.
test("TIME_SCALE rescales time and nothing else", () => {
  assertTrue(TIME_SCALE > 0, `TIME_SCALE ${TIME_SCALE}`);
  const near = (a, b, what) => assertTrue(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
  near(SUB_DT * TIME_SCALE, 1 / 240, "the substep shrinks with the speed-up");
  near(FRICTION_DECEL / (TIME_SCALE * TIME_SCALE), 0.72, "deceleration goes as the square");
  near(MAX_FLICK_SPEED / TIME_SCALE, 1.65, "launch speed goes as the first power");
  near(BUMPER_MAX_SPEED / TIME_SCALE, 1.65, "so does the bumper cap");
  near(STOP_SPEED / TIME_SCALE, 0.004, "so does the resting threshold");
  near(MAX_TURN_SECONDS * TIME_SCALE, 9, "the turn budget is an amount of motion, not of clock");

  // The consequence worth stating outright: distance is invariant, time
  // is not. A 70% shot still crosses 0.93 board widths — the geometry the
  // campaign was balanced against — and simply gets there sooner. (70%
  // rather than full power only because a full-strength shot travels 1.9
  // board widths and would leave the board before stopping.)
  const world = createWorld({ stones: [stone(0, 0, 0.02, 0.5)] });
  flick(world.stones[0], 1, 0, 0.7);
  const { seconds } = simulateToRest(world);
  const travelled = world.stones[0].x - 0.02;
  assertTrue(Math.abs(travelled - 0.9264) < 0.01, `reach ${travelled.toFixed(3)} board widths`);
  assertTrue(Math.abs(seconds - 1.604 / TIME_SCALE) < 0.05, `took ${seconds.toFixed(2)}s at TIME_SCALE ${TIME_SCALE}`);
});

// A stone must never cross more than a fraction of its own radius in one
// substep, or a fast shot can pass clean through a stone it should have
// hit. This is the check that lets TIME_SCALE be raised at all.
test("even the fastest stone steps well inside its own radius", () => {
  const perSubstep = BUMPER_MAX_SPEED * SUB_DT;
  assertTrue(perSubstep < STONE_RADIUS * 0.25, `${perSubstep.toFixed(4)} vs radius ${STONE_RADIUS}`);
});

test("a stone whose center leaves the board is removed, one that merely overhangs is not", () => {
  const world = createWorld({ stones: [stone(0, 0, 0.5, 0.5), stone(1, 1, 0.5, 0.02)] });
  // Stone 1 starts already overhanging the top edge by most of its radius
  // and never moves — it must survive, because removal is by CENTER.
  flick(world.stones[0], 0, -1, 0.02);
  simulateToRest(world);
  assertTrue(world.stones[1].alive, "an overhanging stone stays in play");
  assertEqual(countAlive(world, 1), 1);
});

test("a head-on hit transfers momentum to the struck stone", () => {
  const world = createWorld({ stones: [stone(0, 0, 0.5, 0.8), stone(1, 1, 0.5, 0.5)] });
  flick(world.stones[0], 0, -1, 0.6);
  simulateToRest(world);
  assertTrue(world.stones[1].y < 0.5, "the struck stone moved away from the shooter");
  assertTrue(world.stones[0].y > world.stones[1].y, "the shooter stayed behind it");
});

test("total kinetic energy never increases during a collision", () => {
  // The classic bug in a hand-written impulse solver is resolving an
  // already-separating pair, which pumps energy in and makes stones
  // jitter apart forever. Restitution < 1 means energy must strictly
  // decrease across the whole run.
  const world = createWorld({ stones: [stone(0, 0, 0.5, 0.75), stone(1, 1, 0.5, 0.5), stone(2, 1, 0.53, 0.45)] });
  flick(world.stones[0], 0, -1, 1);
  const energy = (w) => w.stones.reduce((sum, s) => sum + (s.alive ? s.vx * s.vx + s.vy * s.vy : 0), 0);
  let previous = energy(world);
  for (let i = 0; i < 400; i++) {
    stepWorld(world, 1 / 60);
    const now = energy(world);
    assertTrue(now <= previous + 1e-9, `energy rose from ${previous} to ${now} at step ${i}`);
    previous = now;
  }
});

test("a stone that crosses a hole sinks", () => {
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.9)],
    obstacles: [{ type: "hole", x: 0.5, y: 0.5, radius: 0.06 }],
  });
  flick(world.stones[0], 0, -1, 1);
  const { events } = simulateToRest(world);
  assertTrue(events.some((e) => e.type === "sank"), "expected a sank event");
  assertTrue(!world.stones[0].alive, "sunk stone is out");
});

test("a peg deflects a stone that would otherwise fly straight", () => {
  const withPeg = createWorld({
    stones: [stone(0, 0, 0.5, 0.9)],
    obstacles: [{ type: "peg", x: 0.508, y: 0.6, radius: 0.03 }],
  });
  flick(withPeg.stones[0], 0, -1, 0.5);
  simulateToRest(withPeg);
  assertTrue(Math.abs(withPeg.stones[0].x - 0.5) > 0.01, "the stone was pushed off the straight line");
});

test("a wall stops a stone instead of letting it tunnel through", () => {
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.9)],
    obstacles: [{ type: "wall", x: 0.3, y: 0.55, w: 0.4, h: 0.04 }],
  });
  flick(world.stones[0], 0, -1, 1); // full power, straight at the wall
  simulateToRest(world);
  assertTrue(world.stones[0].y > 0.59, `stone ended at y=${world.stones[0].y}, past the wall`);
});

// --- bumpers ------------------------------------------------------------
//
// The bumper is the only thing here that adds energy, which means it is
// the only thing that can break termination. These three tests are the
// price of that: it must actually boost, it must never exceed the cap,
// and a world built to abuse it must still stop.

test("a bumper sends a stone back faster than it arrived", () => {
  const gentle = () => {
    const world = createWorld({
      stones: [stone(0, 0, 0.5, 0.9)],
      obstacles: [{ type: "bumper", x: 0.5, y: 0.5, radius: 0.03 }],
    });
    flick(world.stones[0], 0, -1, 0.72);
    simulateToRest(world);
    return world.stones[0].y;
  };
  const plainPeg = () => {
    const world = createWorld({
      stones: [stone(0, 0, 0.5, 0.9)],
      obstacles: [{ type: "peg", x: 0.5, y: 0.5, radius: 0.03 }],
    });
    flick(world.stones[0], 0, -1, 0.72);
    simulateToRest(world);
    return world.stones[0].y;
  };
  // Both are hit head-on and sent back down the board; the bumper's stone
  // must end up further along than the peg's.
  assertTrue(gentle() > plainPeg(), `bumper ${gentle().toFixed(3)} vs peg ${plainPeg().toFixed(3)}`);
});

test("a bumper never exceeds the speed cap", () => {
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.9)],
    obstacles: [{ type: "bumper", x: 0.5, y: 0.55, radius: 0.03 }],
  });
  flick(world.stones[0], 0, -1, 1); // arrive at the bumper already near full speed
  let peak = 0;
  for (let i = 0; i < 900; i++) {
    stepWorld(world, 1 / 60);
    peak = Math.max(peak, Math.hypot(world.stones[0].vx, world.stones[0].vy));
  }
  assertTrue(peak <= BUMPER_MAX_SPEED + 1e-6, `peaked at ${peak.toFixed(3)} against a ${BUMPER_MAX_SPEED} cap`);
});

test("a stone trapped between two bumpers still comes to rest", () => {
  // The scenario BUMPER_BOOST_BUDGET exists for. The speed cap alone does
  // NOT save this: capped, the stone settles into a perfect limit cycle
  // and buzzes between the two until the turn times out. Running this
  // test with the budget removed is how that was found.
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.5)],
    obstacles: [
      { type: "bumper", x: 0.5, y: 0.36, radius: 0.03 },
      { type: "bumper", x: 0.5, y: 0.64, radius: 0.03 },
    ],
  });
  beginShot(world, world.stones[0], 0, -1, 1);
  const { timedOut } = simulateToRest(world);
  assertTrue(!timedOut, "the pinball must run out of energy inside the turn budget");
  assertTrue(isAtRest(world), "at rest");
});

// --- portals ------------------------------------------------------------

test("the bumper budget is per shot, not per lifetime", () => {
  // A budget left over from a previous turn would make bumpers silently
  // stop working for a stone that had been around a while — the same
  // class of bug as the turn clock that never reset.
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.9)],
    obstacles: [{ type: "bumper", x: 0.5, y: 0.5, radius: 0.03 }],
  });
  world.stones[0].bumperBoosts = BUMPER_BOOST_BUDGET; // as if spent last turn
  beginShot(world, world.stones[0], 0, -1, 0.72);
  const { events } = simulateToRest(world);
  assertTrue(events.some((e) => e.type === "bumperHit"), "a new shot must start with a fresh budget");
});

test("a stone entering a portal comes out of its pair with its motion intact", () => {
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.9)],
    obstacles: [
      { type: "portal", x: 0.5, y: 0.6, radius: 0.045, link: 1 },
      { type: "portal", x: 0.15, y: 0.25, radius: 0.045, link: 1 },
    ],
  });
  flick(world.stones[0], 0, -1, 0.48);
  const { events } = simulateToRest(world);
  assertTrue(events.some((e) => e.type === "teleported"), "expected a teleport");
  const s0 = world.stones[0];
  assertTrue(s0.alive, "it should still be in play");
  // It left the entry travelling up the board and must still be travelling
  // up the board from the exit, i.e. it ends ABOVE the exit portal.
  assertTrue(s0.y < 0.25, `ended at y=${s0.y.toFixed(3)}, not past the exit`);
  assertTrue(Math.abs(s0.x - 0.15) < 0.06, `drifted sideways to x=${s0.x.toFixed(3)}`);
});

test("a stone does not ping-pong between a portal pair forever", () => {
  // Without the re-entry lock the stone arrives inside the exit and is
  // sent straight back, every substep, until the turn budget kills it.
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.9)],
    obstacles: [
      { type: "portal", x: 0.5, y: 0.6, radius: 0.05, link: 1 },
      { type: "portal", x: 0.5, y: 0.35, radius: 0.05, link: 1 },
    ],
  });
  flick(world.stones[0], 0, -1, 0.5);
  const { events, timedOut } = simulateToRest(world);
  assertTrue(!timedOut, "the shot must resolve");
  const teleports = events.filter((e) => e.type === "teleported").length;
  assertTrue(teleports >= 1 && teleports <= 4, `teleported ${teleports} times`);
});

test("an unpaired portal is inert rather than a crash", () => {
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.9)],
    obstacles: [{ type: "portal", x: 0.5, y: 0.6, radius: 0.05, link: 7 }],
  });
  flick(world.stones[0], 0, -1, 0.5);
  const { events } = simulateToRest(world);
  assertEqual(events.filter((e) => e.type === "teleported").length, 0);
  assertTrue(world.stones[0].alive);
});

// --- friction zones -----------------------------------------------------

test("a zone scales stopping distance by its own multiplier", () => {
  // The clearest possible statement of what a zone IS: sand is not a
  // different kind of surface, it is the same surface with more friction,
  // and the arithmetic should show that plainly.
  const travel = (zone) => {
    const world = createWorld({
      stones: [stone(0, 0, 0.05, 0.5)],
      obstacles: zone ? [{ type: "zone", x: 0.5, y: 0.5, radius: 0.45, friction: zone }] : [],
    });
    flick(world.stones[0], 1, 0, 0.6);
    simulateToRest(world);
    return world.stones[0].x - 0.05;
  };
  const plain = travel(null);
  const sand = travel(3);
  const ice = travel(0.35);
  assertTrue(sand < plain * 0.6, `sand travelled ${sand.toFixed(3)} against ${plain.toFixed(3)} on bare board`);
  assertTrue(ice > plain * 1.3, `ice travelled ${ice.toFixed(3)} against ${plain.toFixed(3)} on bare board`);
});

test("a zone is not a collider — it never deflects anything", () => {
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.9)],
    obstacles: [{ type: "zone", x: 0.5, y: 0.6, radius: 0.12, friction: 4 }],
  });
  flick(world.stones[0], 0, -1, 0.7);
  simulateToRest(world);
  assertTrue(Math.abs(world.stones[0].x - 0.5) < 1e-6, "a stone crossing a zone must not move sideways at all");
});

// --- sand deadens the contact, not just the roll ------------------------
//
// The bug these exist for was reported from play, and it is the kind a
// friction test cannot see: sand slowed a MOVING stone correctly, and did
// nothing at all to a stone that was standing still in it when something
// hit it. So a full-power shot into the middle of a sand patch still
// knocked the target clean off the board, and the patch — which looks
// soft, and which the game now shows the player a card about — behaved
// like a hard floor the instant anything touched anything.

/** Fire a stone from the bottom into a target sitting at the middle,
 * optionally with a zone centred on the target. Returns where the target
 * ends up, or null if it was pushed off. */
function strikeThrough(zone, power = 1) {
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.86), stone(1, 1, 0.5, 0.5)],
    obstacles: zone ? [zone] : [],
  });
  beginShot(world, world.stones[0], 0, -1, power);
  simulateToRest(world);
  return world.stones[1].alive ? world.stones[1].y : null;
}

const SAND = { type: "zone", x: 0.5, y: 0.5, radius: 0.19, friction: 3.4, bounce: 0.3 };

test("a stone struck inside sand is shoved, not fired", () => {
  // On bare wood the hardest shot in the game clears the target off the
  // board. In sand the same shot must not: cover that stops working the
  // moment it matters is not cover.
  assertEqual(strikeThrough(null), null, "on bare wood a full-power hit should still clear the target");
  const inSand = strikeThrough(SAND);
  assertTrue(inSand !== null, "a full-power hit landed in sand pushed the target off the board");
  assertTrue(inSand > 0.5 - SAND.radius, `target left the sand entirely, ending at y=${inSand?.toFixed(3)}`);
});

test("the deadening is in the impulse, not in the friction", () => {
  // Same patch, same drag, with and without the bounce term — so this
  // fails if the effect above is really just the friction that was
  // already there.
  const { bounce, ...frictionOnly } = SAND;
  const withoutBounce = strikeThrough(frictionOnly);
  const withBounce = strikeThrough(SAND);
  assertEqual(withoutBounce, null, "friction alone should NOT save the target — that is the reported bug");
  assertTrue(withBounce !== null, "the bounce term is what saves it");
});

test("a softer position on either side of the contact is enough", () => {
  // The striker is on bare wood and only the target is buried. The
  // contact still has to be soft, because the give is where the target
  // is — a rule keyed on the shooter would let the AI dodge it by
  // shooting from outside.
  const offset = { ...SAND, x: 0.5, y: 0.44, radius: 0.1 };
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.86), stone(1, 1, 0.5, 0.46)],
    obstacles: [offset],
  });
  beginShot(world, world.stones[0], 0, -1, 1);
  simulateToRest(world);
  assertTrue(world.stones[1].alive, "the target was fired off despite being struck inside the patch");
});

test("a zone with no bounce term rings exactly like bare wood", () => {
  // Ice. The lane's whole lesson is that nothing there slows a stone
  // down, and a collision that went dull on it would contradict that.
  const ice = { type: "zone", x: 0.5, y: 0.5, radius: 0.19, friction: 0.32 };
  assertEqual(strikeThrough(ice), null, "a collision on ice must carry the target off, as on bare wood");
});

test("sand never deadens a bumper", () => {
  // Deliberate exemption, and worth a test because it is the kind of
  // consistency a later refactor would happily "fix": a bumper is a
  // sprung mechanism rather than a surface, and the game shows the
  // player a card promising it returns a stone faster than it arrived.
  const world = createWorld({
    stones: [stone(0, 0, 0.5, 0.86)],
    obstacles: [
      { type: "zone", x: 0.5, y: 0.5, radius: 0.25, friction: 3.4, bounce: 0.3 },
      { type: "bumper", x: 0.5, y: 0.5, radius: 0.045 },
    ],
  });
  beginShot(world, world.stones[0], 0, -1, 0.9);
  let hit = null;
  let before = 0;
  for (let i = 0; i < 2000 && hit === null; i++) {
    before = Math.hypot(world.stones[0].vx, world.stones[0].vy);
    const events = stepWorld(world, 1 / 240);
    if (events.some((e) => e.type === "bumperHit")) hit = Math.hypot(world.stones[0].vx, world.stones[0].vy);
  }
  assertTrue(hit !== null, "the stone never reached the bumper");
  assertTrue(hit > before, `bumper returned ${hit?.toFixed(2)} for an arrival of ${before.toFixed(2)}`);
});

test("simulation is deterministic for identical inputs", () => {
  // The AI plans by simulating; if this were false its plan and the
  // player's screen would disagree.
  const run = () => {
    const world = createWorld({
      stones: [stone(0, 0, 0.5, 0.85), stone(1, 1, 0.46, 0.4), stone(2, 1, 0.55, 0.35)],
      obstacles: [{ type: "peg", x: 0.5, y: 0.62, radius: 0.026 }],
    });
    flick(world.stones[0], 0.1, -1, 0.8);
    simulateToRest(world);
    return world.stones.map((s) => `${s.alive}:${s.x.toFixed(9)}:${s.y.toFixed(9)}`).join("|");
  };
  assertEqual(run(), run());
});
