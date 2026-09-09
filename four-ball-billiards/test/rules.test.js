// test/rules.test.js
// Scoring, read off hand-written contact logs rather than simulated
// shots: a rule bug and a physics bug should never be able to hide each
// other, and these run in microseconds.
import { test, assertEqual, assertTrue } from "./harness.js";
import { judgeFourBall, judgeThreeCushion, FOUL, SCORE_KIND } from "../src/game/rules.js";

const hit = (a, b, t) => ({ type: "ball", a, b, t });
const rail = (ball, wall, t) => ({ type: "cushion", ball, wall, t });
const four = (events) =>
  judgeFourBall(events, {
    cueId: "cue",
    redIds: ["red1", "red2"],
    opponentId: "white",
    penalizeFoul: true,
  });

test("both reds is a point", () => {
  const r = four([hit("cue", "red1", 0.1), hit("cue", "red2", 0.4)]);
  assertTrue(r.scored, "scored");
  assertEqual(r.points, 1);
  assertEqual(r.kind, SCORE_KIND.NO_CUSHION);
});

test("one red is no point and no penalty", () => {
  const r = four([hit("cue", "red1", 0.1)]);
  assertTrue(!r.scored, "not scored");
  assertEqual(r.points, 0);
  assertEqual(r.foul, null);
});

test("hitting nothing is a foul", () => {
  const r = four([rail("cue", "left", 0.2), rail("cue", "top", 0.5)]);
  assertEqual(r.foul, FOUL.NO_CONTACT);
});

test("touching the other white is a foul and costs a point", () => {
  const r = four([hit("cue", "white", 0.1), hit("cue", "red1", 0.3), hit("cue", "red2", 0.5)]);
  assertTrue(!r.scored, "a carom does not survive touching the opponent");
  assertEqual(r.foul, FOUL.OPPONENT);
  assertEqual(r.points, -1);
});

test("the white fouls even when it is touched last", () => {
  const r = four([hit("cue", "red1", 0.1), hit("cue", "red2", 0.3), hit("cue", "white", 0.6)]);
  assertEqual(r.foul, FOUL.OPPONENT);
  assertTrue(!r.scored, "not scored");
});

test("the penalty is optional", () => {
  const r = judgeFourBall([hit("cue", "white", 0.1)], {
    cueId: "cue",
    redIds: ["red1", "red2"],
    opponentId: "white",
  });
  assertEqual(r.points, 0);
  assertEqual(r.foul, FOUL.OPPONENT);
});

test("only the cue ball's own rails are counted", () => {
  // The reds crashing around the table afterwards must not turn a plain
  // carom into a claimed 쓰리쿠션.
  const r = four([
    hit("cue", "red1", 0.1),
    rail("red1", "top", 0.2),
    rail("red1", "left", 0.3),
    rail("red1", "bottom", 0.4),
    hit("cue", "red2", 0.5),
  ]);
  assertEqual(r.kind, SCORE_KIND.NO_CUSHION);
});

test("the shot is named for the rails taken before the carom completes", () => {
  const r = four([
    rail("cue", "left", 0.1),
    hit("cue", "red1", 0.2),
    rail("cue", "top", 0.3),
    hit("cue", "red2", 0.4),
    rail("cue", "right", 0.9),
  ]);
  assertEqual(r.kind, SCORE_KIND.TWO_CUSHION);
  assertEqual(r.cushionsAtCarom, 2);
});

test("collisions between object balls are ignored", () => {
  const r = four([hit("red1", "red2", 0.2), hit("cue", "red1", 0.3), hit("cue", "red2", 0.6)]);
  assertTrue(r.scored, "scored");
});

test("3구 reads the same log with a cushion requirement", () => {
  const spec = { cueId: "cue", targetIds: ["red", "white"] };
  const short = judgeThreeCushion(
    [hit("cue", "red", 0.1), rail("cue", "top", 0.2), hit("cue", "white", 0.4)],
    spec
  );
  assertTrue(!short.scored, "one cushion is not three");
  const good = judgeThreeCushion(
    [
      hit("cue", "red", 0.1),
      rail("cue", "top", 0.2),
      rail("cue", "left", 0.3),
      rail("cue", "bottom", 0.4),
      hit("cue", "white", 0.6),
    ],
    spec
  );
  assertTrue(good.scored, "three cushions before the second ball scores");
});

// --- when a shot ends ----------------------------------------------------

test("a shot ends when the cue ball does", () => {
  // The rule that made three parts of the game agree. main.js decides a
  // shot is over once the cue ball has stopped, and used to claim that
  // was safe because "every clause of every rule is about what the cue
  // ball touched". It is not safe while the log keeps being read: a red
  // rolling into a STOPPED cue ball appends another contact. Measured
  // across 252 shots, two changed verdict after the cue ball had come to
  // rest — one of them from a point into a foul.
  const rest = { type: "rest", ball: "cue", t: 3 };
  const hitRed1 = { type: "ball", a: "cue", b: "red1", t: 1 };
  const hitRed2 = { type: "ball", a: "red2", b: "cue", t: 2 };

  const before = four([hitRed1, hitRed2, rest]);
  assertTrue(before.scored, "both reds before the cue ball stopped is a point");

  const after = four([hitRed1, rest, hitRed2]);
  assertTrue(!after.scored, "a red rolling into a resting cue ball is not a carom");
  assertTrue(after.contacted.length === 1, "the late contact is not counted at all");

  // And it cannot take a point away either.
  const late = four([hitRed1, hitRed2, rest, { type: "ball", a: "cue", b: "white", t: 4 }]);
  assertTrue(late.scored && late.foul === null, "a late yellow touch cannot undo the point");
});

test("only the cue ball's own rest ends the shot", () => {
  // A red stopping is not the end of anything.
  const v = four([
    { type: "ball", a: "cue", b: "red1", t: 1 },
    { type: "rest", ball: "red1", t: 2 },
    { type: "ball", a: "cue", b: "red2", t: 3 },
  ]);
  assertTrue(v.scored, "the carom completed while the cue ball was still moving");
});
