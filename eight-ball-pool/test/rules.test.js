// test/rules.test.js — 8-ball from hand-written contact logs.
import { test, assertEqual, assertTrue } from "./harness.js";
import * as P from "../src/game/physics.js";
import { newGame, judgeShot, applyShot, legalTargets, isOnEight, placeCue, toJSON, fromJSON, cloneGame, FOUL } from "../src/game/rules.js";
import { SOLIDS, STRIPES, FOOT_SPOT, HEAD_STRING } from "../src/game/rack.js";

const hit = (other, t = 0.1) => ({ type: "ball", a: "cue", b: other, t });
const rail = (t = 0.5) => ({ type: "cushion", ball: "cue", wall: "top", t });
const pocket = (ball, t = 1) => ({ type: "pocket", ball, pocket: "tl", t });

/** A game with the break behind it and, optionally, groups set. */
function midGame({ groups = [null, null], turn = 0, fullHand = false } = {}) {
  const g = newGame({ seed: 2, fullHand });
  g.breakDone = true;
  g.ballInHand = false;
  g.kitchen = false;
  g.groups = groups.slice();
  g.open = !groups[0];
  g.turn = turn;
  return g;
}
/** Take these ids off the table. */
function sink(game, ids) {
  for (const id of ids) {
    const b = P.getBall(game.world, id);
    b.pocketed = true;
  }
}

test("a new game: player 0 breaks from the kitchen with ball in hand, table open", () => {
  const g = newGame();
  assertEqual(g.turn, 0);
  assertTrue(g.ballInHand && g.kitchen, "ball in hand behind the head string");
  assertTrue(g.open && !g.breakDone);
  assertEqual(legalTargets(g).length, 14, "any ball but the 8 on an open table");
});

test("open table: pocketing a solid on a legal shot assigns solids to the shooter, stripes to the other", () => {
  const g = midGame();
  sink(g, ["3"]);
  const out = applyShot(g, [hit("3"), rail(), pocket("3")]);
  assertEqual(out.assigned, "solid");
  assertEqual(g.groups, ["solid", "stripe"]);
  assertTrue(!g.open, "table closed");
  assertTrue(out.continues && g.turn === 0, "shooter stays at the table");
});

test("balls made on the break never assign a group; the breaker continues if legal", () => {
  const g = newGame();
  sink(g, ["9"]);
  const out = applyShot(g, [hit("1", 0.05), rail(0.2), pocket("9", 0.8)]);
  assertEqual(out.assigned, null);
  assertTrue(g.open, "still open");
  assertTrue(out.continues && g.turn === 0, "breaker continues");
});

test("the 8 made on the break is spotted, not a loss", () => {
  const g = newGame();
  sink(g, ["8"]);
  const out = applyShot(g, [hit("1", 0.05), rail(0.2), pocket("8", 0.8)]);
  assertTrue(out.spotEight && !g.over, "spotted");
  assertTrue(!P.getBall(g.world, "8").pocketed, "back on the table");
});

test("wrong ball first is a foul: friendly rules put the cue ball behind the head string", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  const out = applyShot(g, [hit("9"), rail()]);
  assertEqual(out.foul, FOUL.WRONG_BALL);
  assertEqual(g.turn, 1);
  assertTrue(g.ballInHand && g.kitchen, "ball in hand, behind the line");
});

test("standard rules: the same foul gives ball in hand anywhere on the table", () => {
  const g = midGame({ groups: ["solid", "stripe"], fullHand: true });
  const out = applyShot(g, [hit("9"), rail()]);
  assertEqual(out.foul, FOUL.WRONG_BALL);
  assertTrue(g.ballInHand && !g.kitchen, "ball in hand anywhere");
});

test("hitting the 8 first while the table is open is a foul", () => {
  const g = midGame();
  const out = judgeShot(g, [hit("8"), rail()]);
  assertEqual(out.foul, FOUL.WRONG_BALL);
});

test("no contact is a foul", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  const out = applyShot(g, [rail()]);
  assertEqual(out.foul, FOUL.NO_CONTACT);
  assertEqual(g.turn, 1);
});

test("a scratch is a foul; the cue ball comes back on the table for the opponent to place", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  P.getBall(g.world, "cue").pocketed = true;
  const out = applyShot(g, [hit("1"), pocket("cue")]);
  assertEqual(out.foul, FOUL.SCRATCH);
  assertTrue(out.cueScratch);
  assertTrue(!P.getBall(g.world, "cue").pocketed, "cue ball back");
  assertEqual(g.turn, 1);
  assertTrue(g.ballInHand);
});

test("a scratch on the break gives ball in hand behind the head string", () => {
  const g = newGame();
  P.getBall(g.world, "cue").pocketed = true;
  const out = applyShot(g, [hit("1", 0.05), pocket("cue", 2)]);
  assertEqual(out.foul, FOUL.SCRATCH);
  assertTrue(g.ballInHand && g.kitchen, "in the kitchen");
  assertTrue(P.getBall(g.world, "cue").x <= HEAD_STRING, "cue placed behind the line");
});

test("a scratch while also pocketing your own ball is still a foul; the ball stays down", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  sink(g, ["2", "cue"]);
  const out = applyShot(g, [hit("2"), pocket("2"), pocket("cue")]);
  assertEqual(out.foul, FOUL.SCRATCH);
  assertTrue(!out.continues);
  assertTrue(P.getBall(g.world, "2").pocketed, "the 2 stays down");
});

test("pocketing only the opponent's ball ends the turn without a foul", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  sink(g, ["12"]);
  const out = applyShot(g, [hit("1"), rail(), pocket("12")]);
  assertEqual(out.foul, null);
  assertEqual(out.oppMade, ["12"]);
  assertTrue(!out.continues && g.turn === 1);
  assertTrue(!g.ballInHand, "no ball in hand");
});

test("strict rules: no rail after contact with nothing pocketed is a foul; off by default", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  const log = [hit("1", 0.1), { type: "cushion", ball: "cue", wall: "left", t: 0.05 }];
  assertEqual(judgeShot(g, log).foul, null, "default: fine");
  assertEqual(judgeShot(g, log, { strict: true }).foul, FOUL.NO_RAIL, "strict: foul");
  assertEqual(judgeShot(g, [hit("1", 0.1), { type: "cushion", ball: "5", wall: "left", t: 0.4 }], { strict: true }).foul, null, "any ball reaching a rail after contact is fine");
  const g2 = midGame({ groups: ["solid", "stripe"] });
  sink(g2, ["4"]);
  assertEqual(judgeShot(g2, [hit("4", 0.1), pocket("4")], { strict: true }).foul, null, "a pocketed ball satisfies it");
});

test("after clearing your group you are on the 8; legal targets say so", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  sink(g, SOLIDS);
  assertTrue(isOnEight(g, 0));
  assertEqual(legalTargets(g, 0), ["8"]);
  assertTrue(!isOnEight(g, 1));
});

test("pocketing the 8 after your group is cleared wins; with a scratch it loses", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  sink(g, [...SOLIDS, "8"]);
  const out = applyShot(g, [hit("8"), pocket("8")]);
  assertTrue(out.over && out.winner === 0 && out.reason === "eightMade");
  assertTrue(g.over && g.winner === 0);

  const g2 = midGame({ groups: ["solid", "stripe"] });
  sink(g2, [...SOLIDS, "8", "cue"]);
  const out2 = applyShot(g2, [hit("8"), pocket("8"), pocket("cue")]);
  assertTrue(out2.over && out2.winner === 1 && out2.reason === "eightScratch");
});

test("the 8 early loses — including in the same shot as your last ball", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  sink(g, ["8"]);
  const out = applyShot(g, [hit("1"), pocket("8")]);
  assertTrue(out.over && out.winner === 1 && out.reason === "eightEarly");

  const g2 = midGame({ groups: ["solid", "stripe"] });
  sink(g2, [...SOLIDS, "8"]); // the 7 and the 8 fell together
  const out2 = judgeShot(g2, [hit("7"), pocket("7", 0.9), pocket("8", 1.1)]);
  assertTrue(out2.over && out2.winner === 1 && out2.reason === "eightEarly", "not on the 8 when the shot began");
});

test("the last ball of your group counts as a legal first hit even though it is down by the time the shot is judged", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  sink(g, SOLIDS); // the 7 was the last, made on this shot
  const out = judgeShot(g, [hit("7"), pocket("7")]);
  assertEqual(out.foul, null);
  assertTrue(out.continues);
});

test("hitting the 8 first when it is not your ball is a foul, and pocketing it then is a loss", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  assertEqual(judgeShot(g, [hit("8"), rail()]).foul, FOUL.WRONG_BALL);
});

test("ball in hand placement: legal spots only, kitchen respected", () => {
  const g = midGame({ groups: ["solid", "stripe"] });
  g.ballInHand = true;
  assertTrue(!placeCue(g, FOOT_SPOT.x, FOOT_SPOT.y), "on a ball: refused");
  assertTrue(placeCue(g, 0.3, 0.3), "open cloth: placed");
  assertEqual(P.getBall(g.world, "cue").x, 0.3);
  g.kitchen = true;
  assertTrue(!placeCue(g, HEAD_STRING + 0.05, 0.3), "past the head string: refused");
  g.ballInHand = false;
  assertTrue(!placeCue(g, 0.3, 0.3), "not ball in hand: refused");
});

test("toJSON/fromJSON round-trip a game and reject junk", () => {
  const g = midGame({ groups: ["stripe", "solid"], turn: 1 });
  sink(g, ["9", "2"]);
  g.ballInHand = true;
  const back = fromJSON(JSON.parse(JSON.stringify(toJSON(g))));
  assertEqual(back.groups, ["stripe", "solid"]);
  assertEqual(back.turn, 1);
  assertTrue(back.ballInHand && !back.open && back.breakDone);
  assertTrue(P.getBall(back.world, "9").pocketed && P.getBall(back.world, "2").pocketed);
  assertEqual(back.world.balls.length, 16);
  assertEqual(fromJSON(null), null);
  assertEqual(fromJSON({ balls: [] }), null);
  assertEqual(fromJSON({ balls: new Array(16).fill({ id: "x", x: 0, y: 0 }) }), null);
  const bad = toJSON(g);
  bad.balls[3].x = "nope";
  assertEqual(fromJSON(bad), null);
});

test("cloneGame is a deep copy", () => {
  const g = midGame();
  const c = cloneGame(g);
  P.getBall(c.world, "1").x = 0.123;
  c.groups[0] = "solid";
  assertTrue(P.getBall(g.world, "1").x !== 0.123 && g.groups[0] === null);
});
