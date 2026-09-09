// game/arena.js
// Match rules on top of game/physics.js: whose turn it is, which flicks
// are legal, and who has won. Pure — it owns a physics world but never a
// canvas, so a whole match can be played out in Node (that is how
// test/arena.test.js and the AI's own search work).
//
// NO UNDO, AND NO MACHINERY FOR ONE
// The series' shared turn manager came over from the previous game to
// record a move LIST for undo and to support Dots and Boxes' extra-turn
// rule. Neither applies here: an alkkagi turn's result is a physics
// outcome, not a move that can be replayed backwards, and the rule below
// is strict alternation. It was never called, so it has been deleted
// rather than left sitting in every build — pickStartingPlayer() moved
// down to the bottom of this file and the rest went with the file.
// CLAUDE.md 6-8 has the design argument; the short version is that a
// stage is one to five shots, so Restart already IS undo.
//
// TURN ALTERNATION (decision, revisit later)
// Many house rules give you another turn for knocking a stone off. v1
// alternates strictly instead: with obstacles in play a lucky multi-hit
// already swings a stage hard, and stacking a free turn on top of it
// turns a good shot into an unrecoverable one. If playtesting says the
// game is too slow, this is the first knob to turn — it is one branch in
// endTurn() below and nothing else depends on it.

import {
  createWorld,
  beginShot,
  isAtRest,
  simulateToRest,
  stepWorld,
  countAlive,
  MAX_TURN_SECONDS,
  SUB_DT,
} from "./physics.js";
import { stonesForStage } from "./stages.js";

/** @typedef {"playing"|"won"|"lost"|"draw"} MatchStatus
 *  Status is written from PLAYER 0's point of view even in the
 *  two-player mode, where the UI relabels it — one convention beats two,
 *  and the campaign (the primary mode) always has the human as 0. */

/**
 * @param {{stage: object, startingPlayer?: 0|1, mode?: "campaign"|"versus"}} options
 */
export function createMatch({ stage, startingPlayer = 0, mode = "campaign" }) {
  return {
    mode,
    stageId: stage.id,
    world: createWorld({ stones: stonesForStage(stage), obstacles: stage.obstacles ?? [] }),
    current: startingPlayer,
    status: /** @type {MatchStatus} */ ("playing"),
    /** who flicked the shot currently in flight — needed by endTurn() to
     * decide a mutual wipeout, and null while nothing is moving */
    shooter: null,
    /** Seconds simulated since the CURRENT shot was fired, and the reason
     * this lives on the match rather than on the world.
     *
     * It used to read `world.elapsed`, which is an odometer that never
     * resets — so once a match had accumulated MAX_TURN_SECONDS of total
     * motion (a handful of turns), the timeout test was permanently true
     * and every subsequent shot ended its turn on the first frame. The
     * stone twitched and play passed to the other side, for both players,
     * with no error anywhere. A real bug found in play, on stage 8.
     *
     * It survived the tests because they all resolve turns through
     * resolveImmediately() -> simulateToRest(), which counts seconds in
     * its own local variable; only the browser's frame-by-frame advance()
     * path read the odometer. test/arena.test.js now plays a long match
     * through advance() specifically. */
    turnSeconds: 0,
    /**
     * Simulated time owed but not yet integrated — see advance().
     *
     * physics.js integrates only whole SUB_DT slices and says, in its own
     * comment, that the leftover is "carried by the caller's own
     * accumulator". Nobody was carrying it. At 60Hz that was invisible
     * (a 16.667ms frame is exactly five 300Hz substeps), which is why it
     * survived every measurement taken on this project — but on a 120Hz
     * display an 8.333ms frame is two substeps and 1.667ms thrown away,
     * so the world ran at 80% speed and, because the leftover alternates
     * between two and three steps as the frame time jitters, it stuttered
     * while doing it. Exactly the "the flight isn't smooth" report.
     */
    carry: 0,
    turnCount: 0,
    /**
     * OPPONENT stones removed by the shot currently in flight — the
     * number the multi-hit callout is built on.
     *
     * It lives here rather than in main.js because it needs to know who
     * shot, and main.js could not reliably find out: it called
     * `handleEvents(advance(...))`, so by the time it inspected the
     * events `advance()` had already ended the turn and set `shooter`
     * back to null. Comparing a stone's owner against null is true for
     * everyone, so a shot that took one enemy stone AND one of your own
     * was announced as a double. Counting it in here, at the moment the
     * events are produced and while the shooter is still known, is the
     * only version that cannot drift.
     */
    turnKills: 0,

    /**
     * The mirror of turnKills, kept for the whole match rather than for
     * one turn: how many of the shooter's OWN stones their own shots have
     * put off the board.
     *
     * Nothing in the rules reads it — a stone lost is a stone lost
     * whoever sent it — but it is the difference between "the computer
     * beat you" and "you did that", and game/tips.js cannot tell those
     * apart from the final position alone. Counted here for the same
     * reason turnKills is: the shooter is only known while the events are
     * being produced.
     */
    ownGoals: 0,
  };
}

/** The stones the side to move is allowed to flick. */
export function selectableStones(match) {
  if (match.status !== "playing" || match.shooter !== null) return [];
  return match.world.stones.filter((s) => s.alive && s.player === match.current);
}

export function isSelectable(match, stoneId) {
  return selectableStones(match).some((s) => s.id === stoneId);
}

/**
 * Launch a stone. Returns false (and changes nothing) for an illegal
 * shot rather than throwing: the input layer can call this optimistically
 * on any release without pre-validating, and a rejected flick should read
 * as "nothing happened," never as a crash.
 * @param {number} power 0..1
 */
export function shoot(match, stoneId, dirX, dirY, power) {
  if (!isSelectable(match, stoneId)) return false;
  if (power <= 0) return false;
  const stone = match.world.stones.find((s) => s.id === stoneId);
  if (!stone) return false;
  beginShot(match.world, stone, dirX, dirY, power);
  if (stone.vx === 0 && stone.vy === 0) return false; // zero-length direction
  match.shooter = match.current;
  match.turnSeconds = 0;
  match.carry = 0;
  match.turnKills = 0;
  return true;
}

/**
 * Advance a shot in flight by `dt` real seconds (the browser path).
 * Returns the physics events so the caller can play sounds; when the
 * world comes to rest it also finalizes the turn.
 */
/**
 * Count the opponent's losses from this shot. Your own stones going off
 * are never a combo — that is a disaster, not an achievement, and
 * celebrating it would be the game laughing at the player.
 */
function tallyKills(match, events) {
  for (const e of events) {
    if (e.type !== "fellOff" && e.type !== "sank") continue;
    if (e.player !== match.shooter) match.turnKills += 1;
    else match.ownGoals += 1;
  }
}

export function advance(match, dt) {
  if (match.shooter === null) return [];
  // Fixed-step with a carry: whatever does not fill a whole substep this
  // frame is kept for the next one, so the world advances at real time on
  // any refresh rate instead of losing a slice per frame.
  const budget = match.carry + Math.min(dt, 0.25);
  const steps = Math.floor(budget / SUB_DT);
  const simulated = steps * SUB_DT;
  match.carry = budget - simulated;
  const events = steps > 0 ? stepWorld(match.world, simulated) : [];
  tallyKills(match, events); // before endTurn() clears `shooter`
  // Simulated seconds, not wall-clock ones: the turn budget is an amount
  // of MOTION (see MAX_TURN_SECONDS), and counting frames that integrated
  // nothing against it would end turns early on a slow device.
  match.turnSeconds += simulated;
  if (isAtRest(match.world) || match.turnSeconds > MAX_TURN_SECONDS) {
    endTurn(match);
  }
  return events;
}

/**
 * Resolve a shot with no renderer (Node path: tests, AI search). Same
 * finalization as advance(), so the two paths cannot drift.
 */
export function resolveImmediately(match) {
  if (match.shooter === null) return [];
  const { events, seconds } = simulateToRest(match.world);
  tallyKills(match, events); // before endTurn() clears `shooter`
  match.turnSeconds = seconds;
  endTurn(match);
  return events;
}

/**
 * Apply the outcome of the shot that just came to rest: decide the match
 * if either side is wiped out, otherwise pass the turn.
 *
 * MUTUAL WIPEOUT: if the shooter cleared the opponent's last stone but
 * lost their own last stone doing it, the shooter loses. Knocking your
 * own stone off is your mistake, and "the reckless shot does not win the
 * game" is the reading a player expects. A genuine draw is therefore not
 * reachable through this branch; `status: "draw"` stays in the type for
 * the stall case below.
 */
function endTurn(match) {
  const shooter = match.shooter;
  match.shooter = null;
  match.turnCount += 1;

  const aliveP0 = countAlive(match.world, 0);
  const aliveP1 = countAlive(match.world, 1);

  if (aliveP0 === 0 && aliveP1 === 0) {
    match.status = shooter === 0 ? "lost" : "won";
    return;
  }
  if (aliveP1 === 0) {
    match.status = "won";
    return;
  }
  if (aliveP0 === 0) {
    match.status = "lost";
    return;
  }
  match.current = match.current === 0 ? 1 : 0;
}

/**
 * A coin flip for who opens.
 *
 * This is all that survived core/turn.js, which came over from the
 * previous game in the series as a full turn manager: a move stack,
 * recordMove/undoLast/undoTurn/getHistory, roughly 3.5KB of it. Nothing
 * in this game ever called any of it, because StoneFlick has no undo and
 * is not going to have one — a stage is one to five shots, so Restart
 * already IS undo, and a rewind that is not counted would make par and
 * the star rating mean nothing (CLAUDE.md 6-8 has the full argument).
 * The file was shipping in every build regardless, so it is gone and the
 * one function anybody used moved here, next to the turn order it
 * belongs to.
 *
 * @param {number} playerCount
 * @param {() => number} [rng] - injected for deterministic tests; must
 *   return a value in [0, 1), same contract as game/ai.js's rng.
 * @returns {number} a player index in [0, playerCount)
 */
export function pickStartingPlayer(playerCount, rng = Math.random) {
  return Math.floor(rng() * playerCount);
}

export { countAlive };
