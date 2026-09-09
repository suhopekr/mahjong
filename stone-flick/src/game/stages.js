// game/stages.js
// The campaign: an ordered list of stage definitions, each one a starting
// position plus an obstacle layout plus an AI setting. Pure data + pure
// functions — no DOM, no storage, no randomness — so the whole campaign
// is Node-testable (every stage's legality is checked in
// test/stages.test.js: nothing overlapping, nothing off-board, both sides
// actually able to move).
//
// COORDINATES are board units, [0,1] x [0,1], matching game/physics.js
// exactly. y = 0 is the TOP edge (the AI's home side) and y = 1 is the
// BOTTOM edge (the player's), matching canvas convention so a stage
// literal reads the same way it looks on screen.
//
// PAR (the shot count worth three stars) is likewise measured, not
// guessed: it comes from the distribution of shots-to-clear that
// test/balance.mjs reports for its strongest player model. Set it by
// re-running that tool after any change to a layout or to the physics
// constants — a par carried over from a previous tuning pass is worse
// than no par at all, because it silently makes a stage's rating
// meaningless while still looking authoritative.
//
// STAGE ORDER was set by measurement, not by feel: `npm run balance`
// plays every stage a few hundred times at three player skill levels and
// prints the win rate for each. The order below is the result of
// reordering within each act so that the numbers actually descend — two
// pairs were swapped after the first run, where the "harder" stage was
// the easier one by 20 points.
//
// DIFFICULTY here is only the AI's aim/power noise (game/ai.js turns it
// into concrete numbers) — the real difficulty curve is the LAYOUT: how
// many stones the AI gets, how exposed the player's own stones start,
// and what the obstacles do to the straight lines between them. Bumping
// the AI's accuracy is the lazy knob and it produces stages that feel
// unfair rather than hard; each stage below has a note saying what it is
// actually asking the player to learn.

import { STONE_RADIUS } from "./physics.js";
import { GENERATED } from "./stages-generated.js";

/** Nudged in from the edge by more than a stone radius so no stage ever
 * starts with a stone already hanging off. */
const HOME = { player: 0.86, ai: 0.14 };

/** Evenly spaced x positions for `n` stones across the middle `spread`
 * fraction of the board. Written as a helper rather than literal numbers
 * so a row is impossible to get subtly asymmetric by hand — which is the
 * kind of thing nobody notices until a player complains the AI's side
 * "looks closer to the middle." */
function row(n, y, spread = 0.62) {
  if (n === 1) return [{ x: 0.5, y }];
  const start = 0.5 - spread / 2;
  const step = spread / (n - 1);
  return Array.from({ length: n }, (_, i) => ({ x: start + step * i, y }));
}

/** A vertical line of pegs — the basic "you cannot shoot straight at it"
 * obstacle. */
function pegColumn(x, y0, y1, count, radius = 0.022) {
  const step = count === 1 ? 0 : (y1 - y0) / (count - 1);
  return Array.from({ length: count }, (_, i) => ({
    type: "peg",
    x,
    y: count === 1 ? (y0 + y1) / 2 : y0 + step * i,
    radius,
  }));
}

const HAND = [
  {
    id: 1,
    act: 1,
    teaches: "Pull back, let go. Nothing in the way, one target.",
    // The only stage that is SUPPOSED to be a formality — it exists to
    // teach the control, and a tutorial the player can fail is a
    // tutorial that teaches them the game is unfair. test/balance.mjs
    // reads this flag and exempts the stage from its "too easy" finding
    // rather than having a magic `id === 1` buried in the tool.
    tutorial: true,
    difficulty: "easy",
    par: 1,
    stones: { 0: row(2, HOME.player, 0.3), 1: row(1, HOME.ai) },
    obstacles: [],
  },
  {
    id: 2,
    act: 1,
    teaches: "Power control — a full-strength shot overruns the target.",
    difficulty: "easy",
    // Par 1, i.e. take both opponents with a single shot. A par of 2 was
    // met by 97% of clears, which is not a target — this one is reached
    // about a third of the time and teaches the idea the whole game runs
    // on: line the shot up so the stone it hits carries into the next.
    par: 1,
    stones: { 0: row(2, HOME.player, 0.4), 1: row(2, HOME.ai, 0.4) },
    obstacles: [],
  },
  {
    id: 3,
    act: 1,
    teaches: "A wall across the middle: go around it, not through it.",
    difficulty: "easy",
    par: 4,
    stones: { 0: row(3, HOME.player, 0.5), 1: row(3, HOME.ai, 0.5) },
    obstacles: [{ type: "wall", x: 0.31, y: 0.47, w: 0.38, h: 0.045 }],
  },
  {
    id: 4,
    act: 1,
    teaches: "Two tall peg columns. Three lanes, and the AI has four stones.",
    difficulty: "easy",
    par: 3,
    stones: { 0: row(3, HOME.player, 0.55), 1: row(4, HOME.ai, 0.66) },
    obstacles: [
      ...pegColumn(0.34, 0.38, 0.62, 5),
      ...pegColumn(0.66, 0.38, 0.62, 5),
    ],
  },
  {
    id: 5,
    act: 2,
    teaches: "Holes swallow whatever crosses them — yours included.",
    difficulty: "medium",
    par: 2,
    stones: { 0: row(3, HOME.player, 0.55), 1: row(3, HOME.ai, 0.55) },
    obstacles: [{ type: "hole", x: 0.5, y: 0.5, radius: 0.075 }],
  },
  {
    id: 6,
    act: 2,
    teaches: "Walls turn the board into a funnel — bank shots start here.",
    difficulty: "medium",
    par: 3,
    stones: { 0: row(4, HOME.player, 0.4), 1: row(4, HOME.ai, 0.4) },
    obstacles: [
      { type: "wall", x: 0.12, y: 0.44, w: 0.22, h: 0.04 },
      { type: "wall", x: 0.66, y: 0.52, w: 0.22, h: 0.04 },
    ],
  },
  {
    id: 7,
    act: 2,
    teaches: "Two holes squeezing the center lane: the safe path is narrow.",
    difficulty: "medium",
    par: 3,
    stones: { 0: row(4, HOME.player, 0.62), 1: row(4, HOME.ai, 0.62) },
    obstacles: [
      { type: "hole", x: 0.37, y: 0.45, radius: 0.085 },
      { type: "hole", x: 0.63, y: 0.55, radius: 0.085 },
    ],
  },
  {
    id: 8,
    act: 2,
    teaches: "The AI starts spread wide; trading one-for-one loses.",
    difficulty: "medium",
    par: 3,
    stones: { 0: row(4, HOME.player, 0.45), 1: row(5, HOME.ai, 0.78) },
    obstacles: [
      { type: "peg", x: 0.5, y: 0.38, radius: 0.028 },
      { type: "peg", x: 0.5, y: 0.62, radius: 0.028 },
    ],
  },
  {
    id: 9,
    act: 3,
    teaches: "A line of holes guarding the AI's home row.",
    difficulty: "hard",
    par: 3,
    stones: { 0: row(5, HOME.player, 0.7), 1: row(4, HOME.ai, 0.5) },
    obstacles: [
      { type: "hole", x: 0.22, y: 0.3, radius: 0.06 },
      { type: "hole", x: 0.5, y: 0.34, radius: 0.06 },
      { type: "hole", x: 0.78, y: 0.3, radius: 0.06 },
    ],
  },
  {
    id: 10,
    act: 3,
    teaches: "The one gap in the peg wall is a pit.",
    difficulty: "hard",
    par: 4,
    stones: { 0: row(5, HOME.player, 0.7), 1: row(5, HOME.ai, 0.7) },
    obstacles: [
      // The column used to run straight through y = 0.5 with the hole at
      // exactly that point, so a peg sat dead centre in the pit and
      // nothing could ever fall in — reported by a player, and the reason
      // test/stages.test.js now actually checks for overlapping obstacles
      // instead of merely claiming to in its title.
      //
      // Splitting the column around the hole turns the accident into the
      // stage: the wall has one opening, straight down the middle, and
      // the opening is the thing that eats your stone.
      // Pulled in from the edges as well: at 0.82 the lowest peg was
      // inside the player's own home-row stone. The two columns are
      // symmetric about the hole, so the wall reads as one thing with a
      // hole in it rather than as scattered pegs.
      ...pegColumn(0.5, 0.26, 0.38, 2, 0.024),
      ...pegColumn(0.5, 0.62, 0.74, 2, 0.024),
      { type: "hole", x: 0.5, y: 0.5, radius: 0.055 },
    ],
  },
  {
    id: 11,
    act: 3,
    teaches: "Dense pegs: aim for a first bounce, not for a stone.",
    difficulty: "hard",
    par: 4,
    stones: { 0: row(5, HOME.player, 0.72), 1: row(5, HOME.ai, 0.72) },
    obstacles: [
      { type: "peg", x: 0.3, y: 0.36, radius: 0.026 },
      { type: "peg", x: 0.7, y: 0.36, radius: 0.026 },
      { type: "peg", x: 0.5, y: 0.5, radius: 0.026 },
      { type: "peg", x: 0.3, y: 0.64, radius: 0.026 },
      { type: "peg", x: 0.7, y: 0.64, radius: 0.026 },
    ],
  },
  {
    id: 12,
    act: 3,
    teaches: "Everything at once, and the AI outnumbers you.",
    difficulty: "hard",
    par: 4,
    stones: { 0: row(5, HOME.player, 0.72), 1: row(6, HOME.ai, 0.82) },
    obstacles: [
      { type: "wall", x: 0.08, y: 0.47, w: 0.2, h: 0.04 },
      { type: "hole", x: 0.5, y: 0.42, radius: 0.06 },
      { type: "peg", x: 0.35, y: 0.6, radius: 0.026 },
      { type: "peg", x: 0.65, y: 0.6, radius: 0.026 },
    ],
  },
  {
    id: 13,
    act: 4,
    teaches: "Bumpers throw a stone back faster than it arrived — yours and theirs.",
    difficulty: "medium",
    par: 4,
    stones: { 0: row(4, HOME.player, 0.6), 1: row(4, HOME.ai, 0.6) },
    obstacles: [
      // First draft of this stage put a wall across most of the middle
      // and a bumper in each of the two narrow lanes left over. It
      // STALLED: `npm run balance` ran 50 turns without a result and
      // neither side could reliably reach the other. A stage where the
      // sides cannot meet is broken in a way a win rate hides — it just
      // looks like a hard stage until you notice nobody ever finishes it.
      //
      // The block is now short enough that there are open routes on both
      // sides of every bumper. A bumper should be an option that makes a
      // shot better, never the only way through: the first stage that
      // teaches a mechanic is the worst possible place to also make it
      // mandatory.
      { type: "wall", x: 0.36, y: 0.48, w: 0.28, h: 0.045 },
      // Deliberately OFF the straight lanes, and at different heights. On
      // the first pass they sat square in the two main routes, so every
      // shot clipped one whether the player meant to or not — the balance
      // run showed an expert doing WORSE than an average player, which is
      // the signature of a stage decided by chance rather than by choice.
      // Set aside like this, hitting a bumper is something you aim to do.
      { type: "bumper", x: 0.19, y: 0.62, radius: 0.04 },
      { type: "bumper", x: 0.81, y: 0.38, radius: 0.04 },
    ],
  },
  {
    id: 14,
    act: 4,
    teaches: "A portal keeps your direction but not your place — you come out somewhere else, still going the same way.",
    difficulty: "medium",
    par: 4,
    stones: { 0: row(4, HOME.player, 0.62), 1: row(4, HOME.ai, 0.62) },
    obstacles: [
      // The first version put one portal pair dead centre behind a
      // full-width wall, so every stone from both sides funnelled through
      // the same hole and the result was a scramble: the balance run gave
      // a casual and an expert player the same win rate to within two
      // points, which means the stage was decided by luck.
      //
      // The fix is not more obstacles, it is CHOICE. The pair is now
      // offset — enter on the left and you emerge on the right, still
      // travelling the same way — so aiming into it is a real question
      // about where you will come out. The wall leaves a lane at each
      // edge, narrow enough to be a commitment, so the portal is the good
      // route rather than the only one.
      { type: "wall", x: 0.13, y: 0.48, w: 0.74, h: 0.045 },
      { type: "portal", x: 0.3, y: 0.71, radius: 0.05, link: 1 },
      { type: "portal", x: 0.7, y: 0.29, radius: 0.05, link: 1 },
    ],
  },
  {
    id: 15,
    act: 4,
    teaches: "Sand eats a shot; the ice lane is fast but narrow.",
    difficulty: "hard",
    par: 4,
    stones: { 0: row(5, HOME.player, 0.72), 1: row(5, HOME.ai, 0.72) },
    obstacles: [
      // `bounce` is the second half of what sand is, and it was missing
      // from the first version of this stage. Friction alone only slowed
      // a stone DOWN; a full-power shot landed on a stone sitting in the
      // sand still knocked it clean off the board, so the patch was
      // decoration rather than cover. 0.3 is measured, not picked: a
      // stone needs 0.96 board-widths/s to climb out of a patch this
      // draggy, and at 0.3 the hardest possible hit hands the target
      // 0.88 — it gets shoved deeper into the sand instead of across it.
      // See bounceScaleAt() in game/physics.js.
      { type: "zone", x: 0.24, y: 0.5, radius: 0.135, friction: 3.4, bounce: 0.3 },
      { type: "zone", x: 0.76, y: 0.5, radius: 0.115, friction: 3.4, bounce: 0.3 },
      // Ice gets NO bounce change. It is hard — it is the one surface
      // where a collision should ring exactly as it does on bare wood,
      // and the whole lesson of the lane is that nothing there slows you.
      { type: "zone", x: 0.5, y: 0.5, radius: 0.115, friction: 0.32 },
    ],
  },
  {
    id: 16,
    act: 4,
    teaches: "Everything at once, and the AI outnumbers you.",
    difficulty: "hard",
    par: 5,
    stones: { 0: row(5, HOME.player, 0.72), 1: row(6, HOME.ai, 0.82) },
    obstacles: [
      { type: "zone", x: 0.5, y: 0.66, radius: 0.125, friction: 2.8, bounce: 0.3 },
      { type: "wall", x: 0.08, y: 0.47, w: 0.2, h: 0.04 },
      { type: "bumper", x: 0.78, y: 0.47, radius: 0.04 },
      { type: "hole", x: 0.5, y: 0.4, radius: 0.06 },
      { type: "portal", x: 0.16, y: 0.62, radius: 0.045, link: 1 },
      { type: "portal", x: 0.84, y: 0.3, radius: 0.045, link: 1 },
    ],
  },
];

/**
 * WHERE EACH HAND-AUTHORED STAGE LANDS in the hundred-stage campaign, and
 * therefore also the save migration: the key is the id a save from before
 * the expansion holds, the value is the id it means now.
 *
 * The order is not the old order. Each element's FIRST APPEARANCE has to
 * be the stage that introduces it, and the old sixteen did not satisfy
 * that once other stages were interleaved -- the five-peg stage would
 * have arrived before the one-peg one. Reading down the values gives the
 * teaching spine: nothing at 1-2, then wall, peg, pit, bumper, portal,
 * and the clay/ice contrast, one every three stages.
 */
export const HAND_SLOT = {
  1: 1, 2: 2, 3: 3, 6: 4, 4: 6, 8: 7, 11: 8, 5: 9,
  7: 10, 9: 11, 10: 12, 13: 13, 12: 15, 14: 16, 15: 19, 16: 100,
};

/**
 * The campaign: sixteen hand-authored stages holding the teaching spine,
 * and eighty-four generated ones filling the curve between and after them.
 *
 * The generated stages are not decoration. Each was played a few hundred
 * times by three player models before it was allowed in, and the ones
 * that nobody could win, that stalled, that anybody could win, or -- the
 * one that matters -- where a casual player and an expert won equally
 * often, were thrown away. See tools/make-campaign.mjs. Their par is
 * measured too: the shot count a strong player beats about a quarter of
 * the time.
 *
 * `id` is the slot. Nothing carries its old number, which is why
 * HAND_SLOT above exists.
 */
function buildCampaign() {
  const bySlot = new Map();
  for (const stage of HAND) bySlot.set(HAND_SLOT[stage.id], stage);
  for (const gen of GENERATED) bySlot.set(gen.slot, gen);
  const out = [];
  for (let slot = 1; slot <= 100; slot++) {
    const stage = bySlot.get(slot);
    if (!stage) throw new Error(`campaign slot ${slot} is empty`);
    const { slot: _drop, ...rest } = stage;
    // The act is the chapter, and the chapter is where the stage sits
    // now -- a hand-authored stage's old act number described a
    // sixteen-stage campaign and means nothing in a hundred-stage one.
    out.push({ ...rest, id: slot, act: Math.ceil(slot / 10) });
  }
  return out;
}

export const STAGES = buildCampaign();


// --- two-player mode ----------------------------------------------------
//
// Obstacle-free on purpose: a shared-device match is about the two people
// playing it, not about a puzzle one of them has already solved.
//
// The one thing it does offer is the stone count, and the ceiling below
// is a measured limit rather than a round number. Two things could have
// forced it:
//
//   1. Stones overlapping in the home row. Not the binding constraint —
//      at the current radius a row of 13 would still fit across 90% of
//      the board.
//   2. Two stones' GRAB areas overlapping. game/layout.js gives each
//      stone a catchment of 1.5x its radius, because on a phone a
//      fingertip is bigger than a stone and an unresponsive first tap
//      reads as a broken game. Once half the spacing drops below that
//      radius, tapping between two stones becomes a coin flip over which
//      one you picked up — and picking up the wrong stone is a wasted
//      turn, which is far worse than a slightly cramped board.
//
// (2) binds first, at 11 per side. So 9 is the largest count offered.
//
// SHRINKING THE STONES to fit more is the obvious alternative and it is
// the wrong trade. At the current radius a stone is already only ~24px
// across on a 390px phone, with a ~36px grab area — under the ~44px
// touch-target guidance. Making them smaller to fit 13 would buy a
// number nobody asked for at the cost of the control working at all on
// the device most players are using. So the stone size is fixed and the
// count is capped instead.
export const VERSUS_STONE_COUNTS = [3, 5, 7, 9];
export const DEFAULT_VERSUS_STONES = 5;

/** How wide the home row spreads, per count — wider rows for more stones
 * so the spacing stays even rather than the stones bunching in the
 * middle. Table rather than a formula because the small counts want to
 * look deliberately grouped, not merely "not touching". */
const VERSUS_SPREAD = { 3: 0.5, 5: 0.72, 7: 0.82, 9: 0.88 };

/**
 * @param {number} count - stones per side; anything not offered falls
 *   back to the default rather than throwing, since this value can come
 *   from a stored preference and a hand-edited save must not break the
 *   mode.
 */
/**
 * @param {0|1} [bottom] - which player sits on the NEAR row.
 *
 * It is a parameter because the seat is worth something. Two people at
 * one device both reach across the same table, and shooting from the
 * bottom of the board — pulling back toward yourself, into open space —
 * is steadier than shooting from the top, where the pull goes away from
 * you and off the edge of the screen. A match that swaps who opens but
 * leaves both players in the same seat has only cancelled half of the
 * asymmetry it set out to cancel, so game/series.js swaps this too.
 */
export function versusLayout(count = DEFAULT_VERSUS_STONES, bottom = 0) {
  const n = VERSUS_STONE_COUNTS.includes(count) ? count : DEFAULT_VERSUS_STONES;
  const spread = VERSUS_SPREAD[n];
  const near = row(n, HOME.player, spread);
  const far = row(n, HOME.ai, spread);
  return {
    id: "versus",
    // The one layout that keeps a name: it has no number, because it is
    // not part of the campaign's sequence.
    name: "Two Players",
    stoneCount: n,
    stones: bottom === 1 ? { 0: far, 1: near } : { 0: near, 1: far },
    obstacles: [],
  };
}

/**
 * How a stage names itself in the UI: "Stage 16".
 *
 * A NUMBER AND NOTHING ELSE, and the campaign's sixteen hand-written
 * names — First Flick, Gauntlet, Quicksand — were deleted to get here.
 * They were good names. They were also only affordable at sixteen: the
 * plan is thousands, and a thousand names is not a generation problem but
 * a QUALITY one. Past the first few hundred they become "Sandy Pass 47",
 * and a name that means nothing is worse than no name at all, because it
 * promises the stage is distinctive and then is not.
 *
 * A number never stops working. It is how a player says where they are
 * stuck, how a bug report identifies a layout ("stage 4426 is broken"),
 * and how anyone finds their way back. What each stage is FOR is carried
 * by `teaches`, which is per-stage prose that stays honest because it
 * describes the layout instead of decorating it.
 *
 * The two-player layout has no number and so keeps its name.
 */
export function stageTitleParts(stage) {
  if (!stage) return { label: "", value: "" };
  if (typeof stage.id !== "number") return { label: "", value: stage.name ?? "" };
  return { label: "Stage", value: String(stage.id) };
}

export function stageLabel(stage) {
  const { label, value } = stageTitleParts(stage);
  return label ? `${label} ${value}` : value;
}

/** @param {number} id @returns {(typeof STAGES)[number] | null} */
export function getStage(id) {
  return STAGES.find((s) => s.id === id) ?? null;
}

/** Stage ids are 1-based and contiguous; this is the single place that
 * assumption is written down, so a later inserted stage only has to keep
 * the array ordered. */
export function nextStageId(id) {
  const index = STAGES.findIndex((s) => s.id === id);
  return index >= 0 && index + 1 < STAGES.length ? STAGES[index + 1].id : null;
}

export const FIRST_STAGE_ID = STAGES[0].id;
export const LAST_STAGE_ID = STAGES[STAGES.length - 1].id;

/**
 * Turn a stage definition into the flat stone list game/physics.js wants.
 * Ids are assigned here (player stones first, then AI) and are stable for
 * the life of a match — the renderer keys its per-stone animation state
 * off them.
 * @param {{stones: {0: {x:number,y:number}[], 1: {x:number,y:number}[]}}} stage
 */
export function stonesForStage(stage) {
  let id = 0;
  const out = [];
  for (const player of [0, 1]) {
    for (const p of stage.stones[player]) {
      out.push({ id: id++, player, x: p.x, y: p.y, radius: STONE_RADIUS });
    }
  }
  return out;
}
