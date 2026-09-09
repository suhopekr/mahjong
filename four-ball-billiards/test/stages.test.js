// test/stages.test.js
// A stage is only a stage if it can be cleared.
//
// The first draft of the campaign was placed by eye and every one of its
// eight positions turned out to have a scoring window under 0.6% of
// sampled shots — including one that was, as far as any search could
// tell, unwinnable. Nothing in the code was broken; the stages simply did
// not work, and no unit test of the kind that checks a ball is on the
// table would ever have said so.
//
// So each stage now carries the shot it was built from, and this file
// plays it. That makes the campaign self-verifying against the physics:
// change a friction constant or the cushion model and the stages fail
// here, loudly, instead of quietly becoming impossible for players.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, assertTrue } from "./harness.js";
import { STAGES, OPENING, ballsFrom, starsFor } from "../src/game/stages.js";
import * as P from "../src/game/physics.js";
import { judgeFourBall } from "../src/game/rules.js";
import { CASES, disprove, mk } from "../tools/stage-lab.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const R = P.BALL_RADIUS;

function play(stage, deltaDeg = 0) {
  const w = P.createWorld({ balls: ballsFrom(stage.balls) });
  const s = stage.solution;
  const a = ((s.deg + deltaDeg) * Math.PI) / 180;
  P.strike(P.getBall(w, "cue"), Math.cos(a), Math.sin(a), s.speed, (s.side || 0) * R, s.tip * R);
  let t = 0;
  while (t < 12 && !P.isAtRest(w)) {
    P.stepWorld(w, P.SUB_DT);
    t += P.SUB_DT;
  }
  return judgeFourBall(w.events, {
    cueId: "cue",
    redIds: ["red1", "red2"],
    opponentId: "yellow",
  });
}

for (const stage of [...STAGES, { id: "opening", name: "opening", balls: OPENING, par: 1 }]) {
  test(`${stage.id} places four legal balls`, () => {
    const balls = ballsFrom(stage.balls);
    assertTrue(balls.length === 4, "four balls");
    for (const b of balls) {
      assertTrue(b.x >= R && b.x <= P.TABLE_LENGTH - R, `${b.id} x on the table (${b.x})`);
      assertTrue(b.y >= R && b.y <= P.TABLE_WIDTH - R, `${b.id} y on the table (${b.y})`);
    }
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
        assertTrue(d > 2 * R * 1.05, `${balls[i].id}/${balls[j].id} too close (${d.toFixed(3)}m)`);
      }
    }
  });
}

for (const stage of STAGES) {
  test(`${stage.id} "${stage.name}" can be cleared by its own solution`, () => {
    const v = play(stage);
    assertTrue(v.scored, `the recorded solution does not score (foul: ${v.foul})`);
  });

  test(`${stage.id} forgives roughly the aim it claims`, () => {
    // Half the claimed window either way must still score. Half, not the
    // full number, because the window is not symmetric around the seed —
    // what is being pinned is that the stage did not silently become an
    // order of magnitude harder, not the exact edge.
    const half = stage.aimWindow / 4;
    assertTrue(play(stage, half).scored || play(stage, -half).scored,
      `no room either side of the solution (claimed window ${stage.aimWindow} deg)`);
  });
}

/**
 * Every stage still demands the thing it is named after.
 *
 * The check that pays for itself. The previous "Rail First" told the
 * player "every direct line is the wrong one" and had FOUR direct
 * solutions; it had been lying since the day it was built, and no test in
 * the old suite could have noticed, because every one of them asked
 * whether the stage COULD be cleared and none asked whether it could be
 * cleared the wrong way.
 *
 * It is also the check a physics change breaks first. Move the cushion
 * model and a two-rail route stops existing long before the direct route
 * does, so a rail stage quietly becomes a stage with a straight answer —
 * still green under "can be cleared", still a stage, no longer the stage.
 *
 * Only the stages that make a claim run it; `requires: "any"` is most of
 * the campaign and costs nothing. The route rules search the whole table
 * and are the slow ones, which is why the grid in stage-lab.mjs is as
 * coarse as it is: it can only miss a counterexample, never invent one.
 */
for (const stage of STAGES.filter((s) => s.requires !== "any")) {
  test(`${stage.id} "${stage.name}" still demands ${stage.requires}`, () => {
    const b = stage.balls;
    const shot = {
      a: (stage.solution.deg * Math.PI) / 180,
      speed: stage.solution.speed,
      tip: stage.solution.tip,
      side: stage.solution.side || 0,
    };
    const why = disprove(mk(b.cue, b.red1, b.red2, b.yellow), stage.requires, shot);
    assertTrue(!why, `${stage.name} claims ${stage.requires} but ${why}`);
  });
}

test("the campaign covers every case the generator can build", () => {
  // Coverage is the point of a twenty-one stage campaign, not variety.
  // Each of these is a corner of the physics or of the rules that some
  // stage has to exercise, or a whole branch of the model ships untested
  // by anything a player will ever do.
  // Taken from the generator itself rather than copied: the test's name
  // is a claim about CASES, and a hand-kept list can only drift away from
  // it. A case added to the lab is a case the campaign must cover from
  // that moment, and this fails until it does.
  const need = Object.keys(CASES);
  const have = new Set(STAGES.map((s) => s.covers));
  for (const c of need) assertTrue(have.has(c), `nothing in the campaign covers "${c}"`);
});

test("every stroke and every route appears in some solution", () => {
  // The same coverage question asked of the DATA rather than the labels,
  // so that renaming a case cannot fake it.
  const sols = STAGES.map((s) => s.solution);
  assertTrue(sols.some((s) => Math.abs(s.tip) < 0.1), "no stage is played centre-ball");
  assertTrue(sols.some((s) => s.tip > 0.3), "no stage is played with follow");
  assertTrue(sols.some((s) => s.tip < -0.3), "no stage is played with draw");
  assertTrue(sols.some((s) => Math.abs(s.side || 0) > 0.2), "no stage is played with side");
  assertTrue(sols.some((s) => s.speed < 1.5), "no stage is a soft shot");
  assertTrue(sols.some((s) => s.speed > 3), "no stage is a hard shot");
});

test("the campaign uses the whole table", () => {
  // A campaign of clusters in one corner tests one corner. These bounds
  // are deliberately loose — the point is that no whole region of the
  // cloth is unused, not that the stages are evenly spread.
  // In FRACTIONS of the table, not metres. These bounds outlived one
  // table size already; written in metres they would have passed on a
  // 2.84m table and quietly meant something else on a 2.54m one.
  const xs = STAGES.flatMap((s) => Object.values(s.balls).map((b) => b[0] / P.TABLE_LENGTH));
  const ys = STAGES.flatMap((s) => Object.values(s.balls).map((b) => b[1] / P.TABLE_WIDTH));
  assertTrue(Math.min(...xs) < 0.13 && Math.max(...xs) > 0.88, `x range ${Math.min(...xs)}..${Math.max(...xs)}`);
  assertTrue(Math.min(...ys) < 0.15 && Math.max(...ys) > 0.85, `y range ${Math.min(...ys)}..${Math.max(...ys)}`);
  // And at least one cue ball genuinely against a rail.
  const edge = Math.min(
    ...STAGES.map((s) =>
      Math.min(s.balls.cue[0], P.TABLE_LENGTH - s.balls.cue[0], s.balls.cue[1], P.TABLE_WIDTH - s.balls.cue[1])
    )
  );
  assertTrue(edge < 3 * P.BALL_RADIUS, `the closest any cue ball gets to a rail is ${edge.toFixed(3)}m`);
});

test("par tracks how much aim the stage forgives", () => {
  // A stage that forgives two degrees is not a one-attempt stage, and a
  // ten-degree one should not be handing out three stars for four tries.
  for (const s of STAGES) {
    if (s.aimWindow >= 8) assertTrue(s.par <= 1, `${s.id} is generous but par ${s.par}`);
    if (s.aimWindow < 4) assertTrue(s.par >= 3, `${s.id} is a ${s.aimWindow} deg shot at par ${s.par}`);
  }
});

test("the campaign opens with its most forgiving stage", () => {
  assertTrue(
    STAGES[0].aimWindow === Math.max(...STAGES.map((s) => s.aimWindow)),
    "stage 1 should be the widest window on the list"
  );
});

test("stars reward playing the stage's own shot", () => {
  const s = STAGES[0];
  assertTrue(starsFor(s, s.par) === 3, "par is three stars");
  assertTrue(starsFor(s, s.par + 1) === 2, "one over is two");
  assertTrue(starsFor(s, s.par + 5) === 1, "clearing it at all is one");
});

/** How wide the position LOOKS, in table lengths. */
function shape(s) {
  const b = s.balls;
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) / P.TABLE_LENGTH;
  return {
    redGap: d(b.red1, b.red2),
    spread: Math.max(d(b.cue, b.red1), d(b.cue, b.red2), d(b.red1, b.red2)),
  };
}
const isOpen = (s) => shape(s).redGap >= 0.3 || shape(s).spread >= 0.42;

test("the campaign does not look like one photograph", () => {
  // The campaign is ordered by how much aim each stage forgives, and
  // close positions forgive the most — so left alone, the order puts
  // every wide picture at the end. The shipped-before-this version had
  // 67 of 100 stages with every ball inside a quarter of the table and
  // nothing at all with the reds a third of a table apart before stage
  // 75. It played like the same shot fifty times.
  //
  // The first ten stay close on purpose: that is where four-ball is
  // taught. After that every block of five has to show the player a
  // table that is open.
  for (let i = 0; i < 10; i++) {
    assertTrue(!isOpen(STAGES[i]), `stage ${i + 1} is an open table inside the teaching run`);
  }
  for (let start = 10; start + 5 <= STAGES.length; start += 5) {
    const block = STAGES.slice(start, start + 5);
    assertTrue(
      block.some(isOpen),
      `stages ${start + 1}-${start + 5} are all tight positions`
    );
  }
});

test("some stages put the reds at opposite ends", () => {
  // The shape a four-ball player meets most often at a real table, and
  // the one the first campaign never showed: one red at hand, one a
  // table away. Counted rather than assumed, because it is generated.
  const far = STAGES.filter((s) => shape(s).redGap >= 0.42);
  assertTrue(far.length >= 8, `only ${far.length} stages have the reds far apart`);
  assertTrue(
    far.some((s) => STAGES.indexOf(s) < 30),
    "the player should meet a long table before stage 30"
  );
});

test("every stage can be run for three points", () => {
  // Hard mode is "score twice in a row from where the balls stop", and
  // extreme is three — which is a property of the POSITION, not of the
  // mode: a table with nothing left after the first carom cannot host
  // either. test/chain-report.json is the committed answer, produced by
  // tools/chain-check.mjs, because the search behind it takes about an
  // hour and does not belong in this suite.
  //
  // What this test is for is the stage ADDED LATER. A new stage has no
  // row in the report, and an unproved position is exactly what must not
  // ship — so the failure here says "run the tool", not "the campaign is
  // broken".
  const report = JSON.parse(
    readFileSync(path.join(root, "test", "chain-report.json"), "utf8")
  );
  const rows = new Map(report.stages.map((r) => [r.id, r]));
  for (const s of STAGES) {
    const row = rows.get(s.id);
    assertTrue(row, `${s.id} has never been chain-checked — run: node tools/chain-check.mjs --deep`);
    assertTrue(row.hard, `${s.id} cannot be run for two points`);
    assertTrue(row.extreme, `${s.id} cannot be run for three`);
  }
});
