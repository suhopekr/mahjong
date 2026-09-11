// game/rules.js
// Casual 8-ball, as a pure function of the contact log.
//
// physics.js records WHAT touched WHAT, which ball fell into which pocket
// and when; this file turns that log into "whose turn is it now, and
// why". No DOM, no rendering, deterministic — every rule here is unit
// tested in test/rules.test.js by handing it a hand-written log.
//
// THE RULES AS IMPLEMENTED (house 8-ball, WPA where it does not hurt):
//   - The table is OPEN after the break until someone pockets a ball on
//     a legal shot; then that player has that group (solids 1-7 or
//     stripes 9-15) and the opponent the other. Balls made on the break
//     never assign a group.
//   - The cue ball must hit one of your own balls first (any object ball
//     but the 8 while the table is open; the 8 once your group is gone).
//   - Pocketing one of your own balls keeps you at the table. Pocketing
//     only the opponent's balls ends your turn; they stay down.
//   - FOULS: cue ball pocketed (a scratch), wrong ball first, hitting
//     nothing, and — only with "Strict rules" on — no ball reaching a
//     cushion after the contact when nothing was pocketed. A foul hands
//     the opponent ball in hand, anywhere on the table (behind the head
//     string after a foul on the break).
//   - THE 8: pocket it after your group is cleared, without fouling, to
//     win. Pocket it early, or with a scratch, and you lose. On the break
//     it is simply spotted again (the friendly reading).
//   - No called pockets, no three-foul rule, no "8 in the wrong pocket".

import * as P from "./physics.js";
import {
  CUE,
  EIGHT,
  HEAD_SPOT,
  groupOf,
  newRackWorld,
  remaining,
  spotBall,
  nearestPlacement,
  isValidPlacement,
  colorOf,
} from "./rack.js";

export const FOUL = {
  SCRATCH: "scratch",
  WRONG_BALL: "wrongBall",
  NO_CONTACT: "noContact",
  NO_RAIL: "noRail",
};

/** The other group. */
export function otherGroup(g) {
  return g === "solid" ? "stripe" : g === "stripe" ? "solid" : null;
}

/**
 * A new game. `players` is ["human","ai"] or ["human","human"].
 * The breaker is player 0 (the human in a computer game).
 */
export function newGame({ seed = 1, players = ["human", "ai"], strict = false, fullHand = false } = {}) {
  return {
    seed,
    players,
    strict,
    /** "Standard rules": a foul gives the incoming player the cue ball
     *  ANYWHERE. "Friendly rules" (the default, and what this audience
     *  gets) keeps it behind the head string, which is a smaller, easier
     *  decision and cannot be turned into a punishment. */
    fullHand,
    world: newRackWorld(seed),
    turn: 0,
    groups: [null, null],
    open: true,
    breakDone: false,
    /** The incoming player may place the cue ball before shooting. */
    ballInHand: true,
    /** …and only behind the head string (the break, and after a break foul). */
    kitchen: true,
    over: false,
    winner: null,
    reason: null,
    shots: 0,
    last: null,
  };
}

/** Is this player shooting at the 8? True once their group is cleared. */
export function isOnEight(game, player = game.turn) {
  const g = game.groups[player];
  return Boolean(g) && remaining(game.world, g).length === 0;
}

/** Ball ids the current shooter may hit first. */
export function legalTargets(game, player = game.turn) {
  const g = game.groups[player];
  if (!g) {
    return game.world.balls
      .filter((b) => !b.pocketed && b.id !== CUE && b.id !== EIGHT)
      .map((b) => b.id);
  }
  const left = remaining(game.world, g);
  return left.length ? left : [EIGHT];
}

/**
 * Read one shot's log.
 *
 * @param {object} game   the game AS IT STOOD BEFORE THE SHOT (groups,
 *   turn, open, breakDone) — but with the world already simulated, since
 *   "is the group cleared" is read off the log rather than the table.
 * @param {Array} events  world.events, whole shot, in order
 * @param {{strict?:boolean}} [opts]
 */
export function judgeShot(game, events, opts = {}) {
  const strict = opts.strict ?? game.strict;
  const shooter = game.turn;
  const isBreak = !game.breakDone;

  let firstContact = null;
  let firstContactT = -1;
  let railAfter = false;
  const pocketed = [];
  for (const e of events) {
    if (e.type === "ball" && (e.a === CUE || e.b === CUE) && firstContact === null) {
      firstContact = e.a === CUE ? e.b : e.a;
      firstContactT = e.t;
    } else if (e.type === "cushion" && firstContact !== null && e.t >= firstContactT) {
      railAfter = true;
    } else if (e.type === "pocket") {
      pocketed.push(e.ball);
    }
  }
  const cueScratch = pocketed.includes(CUE);
  const objects = pocketed.filter((id) => id !== CUE);
  const eightPocketed = objects.includes(EIGHT);

  // What was legal is judged against the table BEFORE the shot: the balls
  // that fell during it were still up when the cue ball set off. (The
  // world has already been simulated, so they are put back on paper.)
  const g = game.groups[shooter];
  let targets;
  let onEight = false;
  if (!g) {
    targets = game.world.balls
      .filter((b) => b.id !== CUE && b.id !== EIGHT && (!b.pocketed || objects.includes(b.id)))
      .map((b) => b.id);
  } else {
    const left = remaining(game.world, g).concat(objects.filter((id) => groupOf(id) === g));
    onEight = left.length === 0;
    targets = onEight ? [EIGHT] : left;
  }

  const fouls = [];
  if (cueScratch) fouls.push(FOUL.SCRATCH);
  if (firstContact === null) fouls.push(FOUL.NO_CONTACT);
  else if (!targets.includes(firstContact)) fouls.push(FOUL.WRONG_BALL);
  if (strict && firstContact !== null && !railAfter && objects.length === 0 && !cueScratch) {
    fouls.push(FOUL.NO_RAIL);
  }
  const foul = fouls[0] || null;

  // The 8 decides the game before anything else is read.
  let over = false;
  let winner = null;
  let reason = null;
  let spotEight = false;
  if (eightPocketed) {
    if (isBreak) {
      spotEight = true;
    } else if (onEight && !foul) {
      over = true;
      winner = shooter;
      reason = "eightMade";
    } else {
      over = true;
      winner = 1 - shooter;
      reason = onEight ? (cueScratch ? "eightScratch" : "eightFoul") : "eightEarly";
    }
  }

  // Group assignment: the first object ball made on a legal, non-break
  // shot while the table is open.
  let assigned = null;
  if (!over && game.open && !isBreak && !foul) {
    const first = objects.find((id) => id !== EIGHT);
    if (first) assigned = groupOf(first);
  }
  const myGroup = assigned || game.groups[shooter];
  const ownMade = objects.filter((id) => id !== EIGHT && (myGroup ? groupOf(id) === myGroup : true));
  const oppMade = objects.filter((id) => id !== EIGHT && myGroup && groupOf(id) !== myGroup);

  const continues = !over && !foul && ownMade.length > 0;

  return {
    foul,
    fouls,
    firstContact,
    pocketed: objects,
    ownMade,
    oppMade,
    cueScratch,
    eightPocketed,
    spotEight,
    assigned,
    continues,
    over,
    winner,
    reason,
    ballInHand: !over && Boolean(foul),
    // Behind the head string on the break always, and on every foul when
    // the friendly rules are on.
    kitchen: !over && Boolean(foul) && (isBreak || !game.fullHand),
  };
}

/**
 * Apply a judged shot to the game: groups, turn, ball in hand, the 8 back
 * on its spot, the cue ball back on the cloth after a scratch. Returns
 * the outcome so the UI can say what happened.
 */
export function applyShot(game, events, opts = {}) {
  const outcome = judgeShot(game, events, opts);
  const shooter = game.turn;
  game.shots += 1;
  game.breakDone = true;
  if (outcome.assigned) {
    game.groups[shooter] = outcome.assigned;
    game.groups[1 - shooter] = otherGroup(outcome.assigned);
    game.open = false;
  }
  if (outcome.spotEight) spotBall(game.world, EIGHT);
  if (outcome.cueScratch) {
    // Back on the cloth so the table is never missing its cue ball; the
    // incoming player moves it wherever they like.
    const cue = P.getBall(game.world, CUE);
    const spot = nearestPlacement(game.world, HEAD_SPOT.x, HEAD_SPOT.y, { kitchen: false }) || HEAD_SPOT;
    cue.pocketed = false;
    cue.x = spot.x;
    cue.y = spot.y;
    cue.vx = cue.vy = cue.wx = cue.wy = cue.wz = 0;
    P.resetOrientation(cue);
  }
  if (outcome.over) {
    game.over = true;
    game.winner = outcome.winner;
    game.reason = outcome.reason;
    game.ballInHand = false;
    game.kitchen = false;
  } else {
    if (!outcome.continues) game.turn = 1 - shooter;
    game.ballInHand = outcome.ballInHand;
    game.kitchen = outcome.kitchen;
    if (game.kitchen) {
      const cue = P.getBall(game.world, CUE);
      const spot = nearestPlacement(game.world, HEAD_SPOT.x, HEAD_SPOT.y, { kitchen: true });
      if (spot) {
        cue.x = spot.x;
        cue.y = spot.y;
      }
    }
  }
  game.last = outcome;
  return outcome;
}

/** Move the cue ball for ball in hand. Returns false if the spot is not
 * legal (the caller says so in words and nothing moves). */
export function placeCue(game, x, y) {
  if (!game.ballInHand) return false;
  if (!isValidPlacement(game.world, x, y, { kitchen: game.kitchen })) return false;
  const cue = P.getBall(game.world, CUE);
  cue.x = x;
  cue.y = y;
  cue.vx = cue.vy = cue.wx = cue.wy = cue.wz = 0;
  // Ball in hand is the referee lifting the ball and setting it down, so
  // its markings start over too — the same reason its spin is cleared.
  P.resetOrientation(cue);
  cue.pocketed = false;
  return true;
}

/** A plain object for storage. */
export function toJSON(game) {
  return {
    seed: game.seed,
    players: game.players.slice(),
    strict: game.strict,
    fullHand: game.fullHand,
    turn: game.turn,
    groups: game.groups.slice(),
    open: game.open,
    breakDone: game.breakDone,
    ballInHand: game.ballInHand,
    kitchen: game.kitchen,
    over: game.over,
    winner: game.winner,
    reason: game.reason,
    shots: game.shots,
    balls: game.world.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, pocketed: b.pocketed })),
  };
}

/** The inverse. Returns null for anything that is not a saved game. */
export function fromJSON(o) {
  if (!o || typeof o !== "object" || !Array.isArray(o.balls) || o.balls.length !== 16) return null;
  const ids = new Set(o.balls.map((b) => b.id));
  if (ids.size !== 16 || !ids.has(CUE) || !ids.has(EIGHT)) return null;
  for (const b of o.balls) {
    if (typeof b.x !== "number" || typeof b.y !== "number" || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return null;
  }
  const players = Array.isArray(o.players) && o.players.length === 2 && o.players.every((p) => p === "human" || p === "ai")
    ? o.players.slice()
    : ["human", "ai"];
  const group = (g) => (g === "solid" || g === "stripe" ? g : null);
  const game = newGame({ seed: Number(o.seed) || 1, players, strict: Boolean(o.strict), fullHand: Boolean(o.fullHand) });
  game.world = P.createWorld({
    balls: o.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, pocketed: Boolean(b.pocketed), color: colorOf(b.id) })),
  });
  game.turn = o.turn === 1 ? 1 : 0;
  game.groups = [group(o.groups?.[0]), group(o.groups?.[1])];
  game.open = o.open !== false;
  game.breakDone = Boolean(o.breakDone);
  game.ballInHand = Boolean(o.ballInHand);
  game.kitchen = Boolean(o.kitchen);
  game.over = Boolean(o.over);
  game.winner = o.winner === 0 || o.winner === 1 ? o.winner : null;
  game.reason = typeof o.reason === "string" ? o.reason : null;
  game.shots = Number.isInteger(o.shots) && o.shots >= 0 ? o.shots : 0;
  return game;
}

/** A deep copy, for undo. */
export function cloneGame(game) {
  const g = { ...game, players: game.players.slice(), groups: game.groups.slice(), world: P.cloneWorld(game.world) };
  return g;
}
