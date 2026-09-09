// src/game/tips.js
//
// PRO TIPS: the things a player works out in their fortieth match, said
// out loud in their fourth.
//
// Not the same job as game/briefings.js, and the line between them is
// worth keeping sharp. A briefing states a RULE the player cannot deduce
// — "a pit takes anything that crosses it" — and it interrupts, because
// meeting a pit without knowing that is meeting a bug. A tip states a
// CONSEQUENCE of rules the player already has, and it never interrupts:
// it rides along on a card that was going to be shown anyway.
//
// Two consequences of that split, both load-bearing:
//
//   - No tip may be the only place a rule is stated. Anything here that
//     sounds like new information belongs in a briefing instead.
//   - Every tip is checked against the code, not against intuition. The
//     numbers quoted below come from game/physics.js and are cited where
//     they are not obvious, so a tuning change that makes one of them a
//     lie can be found by grepping for the constant.
//
// Each tip is shown at most once per player — see core/storage.js's
// `tips.seen` — which is what stops the loss card from turning into a
// lecture. There are sixteen; a player who reads them all has been
// given every one and will never be shown another.
import { kindsInStage } from "./briefings.js";

/**
 * The catalogue. Ids are persisted, so they are renamed only with a
 * migration; the text can change freely.
 *
 * Voice: one sentence of what to do, at most one of why. Second person,
 * present tense, no exclamation marks — the same register as the
 * briefings' rule lines, because they appear in the same places.
 */
export const TIPS = {
  // --- device ------------------------------------------------------------
  landscape: {
    id: "landscape",
    text: "Turn your phone sideways. The board comes out bigger, with more room to pull back.",
  },
  cancel: {
    id: "cancel",
    text: "Changed your mind mid-shot? Drag back onto the stone until the forward line disappears, then let go. The turn is not spent.",
  },

  // --- the shot ----------------------------------------------------------
  //
  // Stones are equal-mass discs at STONE_RESTITUTION 0.94, so a square
  // contact hands over nearly all the speed and the striker stops dead.
  // That is the single most useful thing to know about this game and it
  // is invisible until someone says it.
  thin: {
    id: "thin",
    text: "Hit a stone square and yours stops dead. Clip it thin and yours carries on — that is how one shot takes two.",
  },
  bank: {
    id: "bank",
    // WALL_RESTITUTION 0.62: a little over a third of the speed is gone
    // in the bounce. PEG_RESTITUTION is 0.72, which is why the peg gets
    // the concession rather than the wall.
    text: "A wall gives back barely half of what you throw at it. Take the straight line when there is one.",
  },
  bumper: {
    id: "bumper",
    // BUMPER_RESTITUTION 1.55, capped at BUMPER_MAX_SPEED, and
    // BUMPER_BOOST_BUDGET 3 boosts per turn.
    text: "A bumper throws a stone back faster than it arrived. Feed it a soft shot and let the brass do the work.",
  },

  // --- judgement ---------------------------------------------------------
  mutual: {
    id: "mutual",
    // game/arena.js endTurn(): a mutual wipeout is scored against the
    // shooter, deliberately.
    text: "Take their last stone and lose your own doing it and the match is theirs. The reckless finish is not a finish.",
  },
  pit: {
    id: "pit",
    text: "A pit swallows your stones exactly as easily as theirs. Before you fire, check which side of it you are pushing toward.",
  },
  overshoot: {
    id: "overshoot",
    text: "Your own stone leaving the board costs you the stone and the turn. When the target is already near an edge, use less power, not more.",
  },
  edge: {
    id: "edge",
    text: "Clear the stones already sitting near an edge first. They are the ones that need the least power to go.",
  },
  setup: {
    id: "setup",
    text: "No angle worth taking? Shove one of theirs toward a wall instead. Next turn is a much shorter shot.",
  },

  // --- ground ------------------------------------------------------------
  sand: {
    id: "sand",
    text: "In sand even a square hit only shoves. Drag a stone out of the patch rather than trying to fire it across.",
  },
  ice: {
    id: "ice",
    // The zone's friction multiplier is 0.32 — a shot across ice keeps
    // running long after it would have died on wood.
    text: "Ice takes almost nothing off a stone. Cross it with far less power than feels right.",
  },
  portal: {
    id: "portal",
    text: "A portal keeps your direction, not your aim. Draw the line coming out of the far one before you shoot.",
  },

  // --- the campaign ------------------------------------------------------
  par: {
    id: "par",
    // storage.js starsForShots(): <= par is three, <= par + 2 is two.
    text: "Par or better is three stars, within two shots of it is two. One shot saved is worth more than one more try.",
  },
  preview: {
    id: "preview",
    text: "A shot preview you have earned is kept. Close the game, open a different stage — it is still waiting.",
  },
  practice: {
    id: "practice",
    text: "Nothing in Practice touches your record. It is the place to try the shot you would not risk.",
  },
  hard: {
    id: "hard",
    text: "Hard is the same board with the aim line taken away. Warm up on a stage you have already cleared.",
  },
};

/**
 * Stable order, and the whitelist core/storage.js validates the save
 * against. Appending is free; reordering is not, because CHAPTER_TIPS
 * indexes into meaning rather than into this list.
 */
export const TIP_IDS = Object.keys(TIPS);

/**
 * One tip per chapter boundary, in the order the boundaries arrive.
 *
 * Ordered by when the player can USE it, not by how clever it is.
 * `thin` is first because it is the one that changes how every later shot
 * is aimed. The ground tips sit at chapters 6 and 7 because sand and ice
 * arrive at stage 19 and the player has had a chapter of them by then.
 * The last two are about modes, which is what is left to discover once
 * the campaign itself holds no surprises.
 *
 * Ten entries for ten chapters. If the campaign grows past chapter ten
 * the tail simply runs out and nothing is shown, which is the correct
 * failure: a repeat would read worse than a silence.
 */
export const CHAPTER_TIPS = [
  "thin", "edge", "bank", "par", "bumper",
  "ice", "sand", "setup", "preview", "hard",
];

/**
 * The tip for the chapter just finished, or null once they are spent.
 *
 * Falls forward rather than going silent: a loss card may already have
 * handed over this chapter's tip (several of them are in tipForLoss()'s
 * contextual branches), and a chapter card with an empty line under a
 * ten-stage tally reads as something failing to load. So the chapter's
 * own tip is preferred and the next unseen one is taken if it is gone.
 *
 * @param {number} chapter 1-based
 * @param {string[]} seen tip ids already shown
 */
export function chapterTip(chapter, seen = []) {
  const own = CHAPTER_TIPS[chapter - 1];
  if (own && !seen.includes(own)) return TIPS[own];
  const next = CHAPTER_TIPS.find((id) => !seen.includes(id));
  return next ? TIPS[next] : null;
}

/**
 * The tip to put on a LOSS card, chosen from what actually just happened.
 *
 * WHY CONTEXTUAL AND NOT A ROTATION. A random tip on a card the player
 * opened because they lost reads as filler and is skipped; a tip about
 * the pit they just fell into reads as the game having watched. The
 * information to do this is already sitting in finishMatch(), so the
 * only cost is the order of these branches.
 *
 * First match wins, and anything already shown is skipped — so a player
 * who keeps losing on the same stage gets a DIFFERENT tip each time
 * rather than the same one restated, and once the list is spent the card
 * quietly goes back to having no tip line at all.
 *
 * @param {object} ctx
 * @param {object} ctx.stage           the stage just played
 * @param {boolean} ctx.mutual         both sides were wiped out on one shot
 * @param {number} ctx.ownGoals        their own stones lost to their own shots
 * @param {number} ctx.opponentsLeft   their stones still standing
 * @param {number} ctx.lossStreak      consecutive losses on this stage
 * @param {number} ctx.shotsOverPar    playerShots - stage.par
 * @param {string[]} seen              tip ids already shown
 * @returns {{id: string, text: string} | null}
 */
export function tipForLoss(ctx, seen = []) {
  const kinds = kindsInStage(ctx.stage);
  const has = (kind) => kinds.includes(kind);
  const candidates = [
    // What killed them, if the board can say so — and the first two
    // branches are the ones worth having: they are the difference
    // between losing and beating yourself, which is not readable from
    // the final position and is the thing a player most wants named.
    ctx.mutual && "mutual",
    ctx.ownGoals >= 1 && has("hole") && "pit",
    ctx.ownGoals >= 1 && "overshoot",
    has("hole") && "pit",
    has("sand") && "sand",
    has("ice") && "ice",
    has("portal") && "portal",
    has("bumper") && "bumper",
    // Otherwise, how the match was going.
    ctx.opponentsLeft >= 3 && "edge",
    ctx.lossStreak >= 2 && "setup",
    ctx.shotsOverPar >= 2 && "thin",
    // And then whatever is left, so a player who loses often is still
    // being told things.
    ...TIP_IDS,
  ];
  for (const id of candidates) {
    if (!id || seen.includes(id)) continue;
    // `landscape` has its own surface — the toast — and a result card
    // telling the player to turn their phone would be the game losing
    // track of where it is.
    if (id === "landscape") continue;
    return TIPS[id];
  }
  return null;
}
