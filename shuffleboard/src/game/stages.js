// game/stages.js
// The campaign: board situations cut from real frames, each with a goal,
// a weight budget, and a machine-verified solution.
//
// WHY THE CAMPAIGN EXISTS. The first playtest's verdict on the plain
// match mode was: one match, and no wish for another. Diagnosis, in the
// player's own words: every frame starts the same, and there is no
// reason to win. This is the problem the series has solved twice already
// (StoneFlick, Four Ball) with the same shape — every round a NEW
// problem, progression as the reason — so the campaign is now the main
// mode and matches are the bosses at the end of each chapter.
//
// RULES OF STAGE-MAKING, inherited and paid for:
// - Placements are never trusted by eye. Four Ball's first eight stages
//   were all effectively unsolvable and LOOKED fine. Every stage here
//   carries a `solution` found by search (tools/stage-lab.mjs), and
//   test/stages.test.js replays it through the real physics on every
//   run — touch a friction constant and the campaign breaks loudly.
// - The hardest thing goes last, not first (Daily Five's lesson).
// - A hint names the shot the stage actually rewards, or says nothing.

import * as P from "./physics.js";
import { scoreFrame, puckValue, isHanger } from "./rules.js";
import { SOLUTIONS } from "./solutions.js";

export const GOAL_TYPES = ["score", "clear", "hanger", "place"];

/**
 * @typedef {object} Stage
 * @property {number} id        1-based, global across chapters
 * @property {number} chapter
 * @property {string} name
 * @property {string} hint      one line, shown on entry
 * @property {{x:number,y:number}[]} enemies    pre-placed, owner 1.
 *   All beyond the foul line by construction — removeFouls() must never
 *   touch a stage's furniture.
 * @property {{x:number,y:number}[]} friendlies pre-placed, owner 0
 * @property {number} budget    weights the player may shoot
 * @property {number} par       shots for three stars
 * @property {object} goal      { type, ... } see judgeGoal
 * @property {{y:number,angle:number,power:number}[]} solution
 */

/** Chapter bosses: beat the persona to open the next chapter. */
export const CHAPTERS = [
  { id: 1, name: "The Back Room", boss: "easy" },
  { id: 2, name: "League Night", boss: "medium" },
  { id: 3, name: "The Money Table", boss: "hard" },
];

const W = P.BOARD_WIDTH;
const MID = W / 2;

export const STAGES = [
  {
    id: 1,
    chapter: 1,
    name: "Opening Slide",
    hint: "Anything past the line counts. Off the end counts for nobody.",
    enemies: [],
    friendlies: [],
    budget: 2,
    par: 1,
    goal: { type: "score", target: 1 },
  },
  {
    id: 2,
    chapter: 1,
    name: "Deep Three",
    hint: "Park one past the last line — the edge is right there.",
    enemies: [],
    friendlies: [],
    budget: 3,
    par: 1,
    goal: { type: "place", zone: 3, count: 1 },
  },
  {
    id: 3,
    chapter: 1,
    name: "Beat the Blue",
    hint: "Only weights past his best one count.",
    enemies: [{ x: 2.1, y: MID }],
    friendlies: [],
    budget: 2,
    par: 1,
    goal: { type: "score", target: 2 },
  },
  {
    id: 4,
    chapter: 1,
    name: "Knock Off",
    hint: "Hit it square. The board keeps nothing.",
    enemies: [{ x: 2.31, y: MID }],
    friendlies: [],
    budget: 2,
    par: 1,
    goal: { type: "clear", targets: "all" },
  },
  {
    id: 5,
    chapter: 1,
    name: "The Gap",
    hint: "His guards cannot cover every lane.",
    enemies: [
      { x: 1.75, y: 0.16 },
      { x: 1.75, y: 0.35 },
      { x: 2.28, y: MID },
    ],
    friendlies: [],
    budget: 3,
    par: 2,
    goal: { type: "clear", targets: [2] },
  },
  {
    id: 6,
    chapter: 1,
    name: "Hang It",
    hint: "Over the edge but not off it. Nerve, mostly.",
    enemies: [],
    friendlies: [],
    budget: 4,
    par: 2,
    goal: { type: "hanger" },
  },
  {
    id: 7,
    chapter: 1,
    name: "Bodyguard",
    hint: "You can't reach the hanger. Something else can.",
    enemies: [
      { x: 2.2, y: MID },
      { x: 2.385, y: MID },
    ],
    friendlies: [],
    budget: 3,
    par: 1,
    goal: { type: "clear", targets: [1] },
  },
  {
    id: 8,
    chapter: 1,
    name: "Crowd the Top",
    hint: "Two of yours up high. His weight is in the way — or is it a backstop?",
    enemies: [{ x: 2.15, y: 0.2 }],
    friendlies: [],
    budget: 4,
    par: 3,
    goal: { type: "place", zone: 2, count: 2 },
  },
  {
    id: 9,
    chapter: 2,
    name: "Promotion",
    hint: "Your own weight takes a push kindly.",
    enemies: [],
    friendlies: [{ x: 1.85, y: MID }],
    budget: 3,
    par: 2,
    goal: { type: "place", zone: 2, count: 2 },
  },
  {
    id: 10,
    chapter: 2,
    name: "Two Birds",
    hint: "They are close enough to share a fate.",
    enemies: [
      { x: 2.28, y: 0.2 },
      { x: 2.34, y: 0.3 },
    ],
    friendlies: [],
    budget: 3,
    par: 2,
    goal: { type: "clear", targets: "all" },
  },
  {
    id: 11,
    chapter: 2,
    name: "Top That",
    hint: "He sits on a three. Be past him, or be rid of him.",
    enemies: [{ x: 2.35, y: MID }],
    friendlies: [],
    budget: 3,
    par: 2,
    goal: { type: "score", target: 3 },
  },
  {
    id: 12,
    chapter: 2,
    name: "Through Traffic",
    hint: "Three men make a wall with two doors.",
    enemies: [
      { x: 1.95, y: 0.1 },
      { x: 1.95, y: 0.25 },
      { x: 1.95, y: 0.4 },
    ],
    friendlies: [],
    budget: 3,
    par: 1,
    goal: { type: "place", zone: 2, count: 1 },
  },
  {
    id: 13,
    chapter: 2,
    name: "Backstop",
    hint: "Too hard is fine — if something is there to stop you.",
    enemies: [{ x: 2.32, y: MID }],
    friendlies: [],
    budget: 3,
    par: 1,
    goal: { type: "place", zone: 3, count: 1 },
  },
  {
    id: 14,
    chapter: 2,
    name: "Sweep the Porch",
    hint: "One each. No discounts.",
    enemies: [
      { x: 2.3, y: 0.12 },
      { x: 2.3, y: 0.39 },
    ],
    friendlies: [],
    budget: 3,
    par: 2,
    goal: { type: "clear", targets: "all" },
  },
  {
    id: 15,
    chapter: 2,
    name: "Hang It Anyway",
    hint: "The straight road is parked in. Hangers do not need the middle.",
    enemies: [{ x: 2.28, y: MID }],
    friendlies: [],
    budget: 4,
    par: 2,
    goal: { type: "hanger" },
  },
  {
    id: 16,
    chapter: 2,
    name: "Add It Up",
    hint: "No single weight is worth five.",
    enemies: [],
    friendlies: [],
    budget: 4,
    par: 3,
    goal: { type: "score", target: 5 },
  },
  {
    id: 17,
    chapter: 3,
    name: "Clip It",
    hint: "A hair too thick and you follow it over.",
    enemies: [{ x: 2.385, y: 0.12 }],
    friendlies: [],
    budget: 2,
    par: 1,
    goal: { type: "clear", targets: "all" },
  },
  {
    id: 18,
    chapter: 3,
    name: "House Money",
    hint: "He has five on the board already.",
    enemies: [
      { x: 2.35, y: 0.18 },
      { x: 2.15, y: 0.33 },
    ],
    friendlies: [],
    budget: 3,
    par: 2,
    goal: { type: "score", target: 4 },
  },
  {
    id: 19,
    chapter: 3,
    name: "Keyhole",
    hint: "There is a door. It is not wide.",
    enemies: [
      { x: 2.0, y: 0.185 },
      { x: 2.0, y: 0.32 },
      { x: 2.33, y: MID },
    ],
    friendlies: [],
    budget: 3,
    par: 2,
    goal: { type: "clear", targets: [2] },
  },
  {
    id: 20,
    chapter: 3,
    name: "Cold Draw",
    hint: "Twice into the three. The second one has company.",
    enemies: [],
    friendlies: [],
    budget: 4,
    par: 3,
    goal: { type: "place", zone: 3, count: 2 },
  },
  {
    id: 21,
    chapter: 3,
    name: "Chain",
    hint: "Send the message down the line.",
    enemies: [
      { x: 2.05, y: MID },
      { x: 2.22, y: MID },
      { x: 2.385, y: MID },
    ],
    friendlies: [],
    budget: 3,
    par: 2,
    goal: { type: "clear", targets: [2] },
  },
  {
    id: 22,
    chapter: 3,
    name: "Eviction",
    hint: "Both of them. The edge is patient.",
    enemies: [
      { x: 2.385, y: 0.3 },
      { x: 2.33, y: 0.18 },
    ],
    friendlies: [],
    budget: 3,
    par: 2,
    goal: { type: "clear", targets: "all" },
  },
  {
    id: 23,
    chapter: 3,
    name: "Riding Shotgun",
    hint: "Your partner is parked on a one. Promote him.",
    enemies: [{ x: 2.31, y: MID }],
    friendlies: [{ x: 2.0, y: MID }],
    budget: 4,
    par: 3,
    goal: { type: "score", target: 5 },
  },
  {
    id: 24,
    chapter: 3,
    name: "The Last Inch",
    hint: "Between his men, past the paint, short of the fall.",
    enemies: [
      { x: 2.3, y: 0.15 },
      { x: 2.3, y: 0.36 },
    ],
    friendlies: [],
    budget: 4,
    par: 2,
    goal: { type: "hanger" },
  },
];

// Solutions are machine-found and live in their own generated file;
// attaching them here keeps a stage and its proof in one object.
for (const stage of STAGES) {
  stage.solution = SOLUTIONS[stage.id] ?? [];
}

export const LAST_STAGE_ID = STAGES.length;

export function stageById(id) {
  return STAGES.find((s) => s.id === id) ?? null;
}

export function stagesInChapter(chapter) {
  return STAGES.filter((s) => s.chapter === chapter);
}

/** The chapter whose boss follows this stage, if it is the chapter's last. */
export function isChapterEnd(stage) {
  const peers = stagesInChapter(stage.chapter);
  return peers[peers.length - 1].id === stage.id;
}

/**
 * Build a world for a stage. Enemy order is preserved so `clear` goals
 * can name targets by index.
 * @returns {{ world: World, enemyIds: number[] }}
 */
export function createStageWorld(stage) {
  const world = P.createWorld();
  const enemyIds = [];
  for (const e of stage.enemies) {
    const p = {
      id: world.nextId++,
      owner: 1,
      x: e.x,
      y: e.y,
      vx: 0,
      vy: 0,
      off: false,
      foul: false,
    };
    world.pucks.push(p);
    enemyIds.push(p.id);
  }
  for (const f of stage.friendlies) {
    world.pucks.push({
      id: world.nextId++,
      owner: 0,
      x: f.x,
      y: f.y,
      vx: 0,
      vy: 0,
      off: false,
      foul: false,
    });
  }
  return { world, enemyIds };
}

/**
 * Is the stage's goal met on this (resting) board?
 * @param {Stage} stage
 * @param {World} world
 * @param {number[]} enemyIds ids from createStageWorld, same order as stage.enemies
 */
export function judgeGoal(stage, world, enemyIds) {
  const g = stage.goal;
  if (g.type === "score") {
    const r = scoreFrame(world);
    return r.winner === 0 && r.points >= g.target;
  }
  if (g.type === "clear") {
    const ids = g.targets === "all" ? enemyIds : g.targets.map((i) => enemyIds[i]);
    return ids.every((id) => {
      const p = world.pucks.find((q) => q.id === id);
      return p && p.off;
    });
  }
  if (g.type === "hanger") {
    return P.livePucks(world).some((p) => p.owner === 0 && isHanger(p));
  }
  if (g.type === "place") {
    const n = P.livePucks(world).filter((p) => p.owner === 0 && puckValue(p) >= g.zone).length;
    return n >= g.count;
  }
  return false;
}

/** One line for the goal bar. */
export function goalText(stage) {
  const g = stage.goal;
  if (g.type === "score") return g.target === 1 ? "End the frame with a point" : `End the frame scoring ${g.target}+`;
  if (g.type === "clear") {
    const n = g.targets === "all" ? stage.enemies.length : g.targets.length;
    return n === 1 ? "Knock the blue weight off" : "Knock the blue weights off";
  }
  if (g.type === "hanger") return "Hang one over the edge";
  if (g.type === "place") return `Get ${g.count} into the ${g.zone} or better`;
  return "";
}

/** Stars: at or under par is the clean three. */
export function starsFor(used, par) {
  if (used <= par) return 3;
  if (used <= par + 1) return 2;
  return 1;
}
