// tools/stage-lab.mjs
// Search for stages that cover a named CASE, and prove each one needs the
// thing it is named after.
//
// WHY THIS EXISTS ON TOP OF build-stages.mjs
// build-stages.mjs constructs a stage backwards from a shot, which solves
// "does this position have an answer" and nothing else. It is driven by a
// hand-written list of specs, and most of them fail — fine when the target
// was seven stages, useless when the target is a curriculum that has to
// touch every corner of the physics.
//
// Two things are added here.
//
// SEARCH. A case is a range, not a spec: a cue-ball region, an angle band,
// a speed band, tip and side bands, leg lengths, cut fullnesses. The tool
// samples the range, builds each sample, throws away the ones that do not
// score or whose aim window is outside the band we want, and ranks what
// is left. That is the difference between "I guessed nine specs and two
// worked" and "I sampled two thousand and kept the best four".
//
// PROOF THAT THE STAGE TEACHES ITS LESSON. This is the part that matters
// and it came out of a real defect: the first "Rail First" was solved by
// eleven of the sixteen shots that scored, straight, no cushion. It was a
// rail stage in name only. A stage that is called Draw and can be cleared
// with a follow shot is not testing draw — it is a false green in the
// suite and a liar to the player.
//
// So every case carries a `requires` predicate that runs a sweep of
// ALTERNATIVE shots and demands they fail. `draw` requires that no
// follow or stun shot scores anywhere in the aim window; `english`
// requires that no centre-ball shot scores at all; `cushionFirst`
// requires that every shot that scores takes a rail before the first
// ball. The predicate is exported and the campaign's own test file runs
// the same check, so the property survives a physics change instead of
// being a fact about the afternoon it was generated.
import * as P from "../src/game/physics.js";
import { judgeFourBall } from "../src/game/rules.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const R = P.BALL_RADIUS;
const L = P.TABLE_LENGTH;
const W = P.TABLE_WIDTH;
const PARK = [L - 0.22, 0.2];

export const mk = (cue, red1, red2, yellow) => [
  { id: "cue", x: cue[0], y: cue[1], color: "white" },
  { id: "yellow", x: yellow[0], y: yellow[1], color: "yellow" },
  { id: "red1", x: red1[0], y: red1[1], color: "red" },
  { id: "red2", x: red2[0], y: red2[1], color: "red" },
];

const IDS = { cueId: "cue", redIds: ["red1", "red2"], opponentId: "yellow" };

/**
 * Play one shot and report both the verdict and the ROUTE.
 *
 * The route is what the `requires` predicates read: how many cushions the
 * cue ball took before it touched anything, how many it took in total,
 * and whether it ever hit the yellow. A verdict alone cannot tell a rail
 * stage from a stage that happens to be near a rail.
 */
export function play(balls, shot, seconds = 12) {
  const w = P.createWorld({ balls });
  P.strike(
    P.getBall(w, "cue"),
    Math.cos(shot.a),
    Math.sin(shot.a),
    shot.speed,
    (shot.side || 0) * R,
    (shot.tip || 0) * R
  );
  let t = 0;
  while (t < seconds && !P.isAtRest(w)) {
    P.stepWorld(w, P.SUB_DT);
    t += P.SUB_DT;
  }
  const v = judgeFourBall(w.events, IDS);
  let before = 0;
  let rails = 0;
  let seenBall = false;
  for (const e of w.events) {
    if (e.type === "cushion" && e.ball === "cue") {
      rails++;
      if (!seenBall) before++;
    } else if (e.type === "ball" && (e.a === "cue" || e.b === "cue")) {
      seenBall = true;
    }
  }
  return { ...v, railsBeforeFirst: before, rails };
}

/** Contiguous degrees of aim either side of `shot` that still score. */
export function tolerance(balls, shot, limit = 14) {
  const ok = (d) => play(balls, { ...shot, a: shot.a + (d * Math.PI) / 180 }).scored;
  let lo = 0;
  let hi = 0;
  for (let d = 0.25; d <= limit; d += 0.25) { if (ok(-d)) lo = d; else break; }
  for (let d = 0.25; d <= limit; d += 0.25) { if (ok(d)) hi = d; else break; }
  return { lo, hi, width: lo + hi };
}

/**
 * Look for a COUNTEREXAMPLE: a shot that scores but should not, if the
 * stage really is about the thing it claims to be about.
 *
 * Deliberately not "enumerate every solution and inspect them". That was
 * the first version and it cost eighteen seconds a candidate, because the
 * full space is angle x speed x tip x side and almost all of it is
 * irrelevant to any one question. Each rule instead names the small slice
 * that could disprove it — `draw` only has to try the tips at and above
 * centre, `english` only has to try centre ball — and searches that.
 *
 * The angle step is 3 degrees, coarser than any stage's aim window. That
 * is on purpose and it errs in the safe direction: a coarse grid can only
 * MISS a counterexample, never invent one, and anything that survives it
 * gets the fine grid run on it as a finalist.
 */
/**
 * LOCAL rules ask about the line the stage teaches; GLOBAL rules ask about
 * the whole table.
 *
 * The first draft made every rule global — "no stun shot anywhere on this
 * table at any angle may score" — and almost nothing survived it, which
 * was the search telling the truth about billiards rather than a bug. A
 * four-ball position nearly always has more than one answer, and demanding
 * that a follow stage have no other answer at all mostly selects for
 * positions where the reds are somewhere unreachable.
 *
 * The property that actually matters for a stroke is LOCAL: if you aim
 * where the hint points you, does the spin decide it? So the stroke rules
 * sweep a band around the stage's own solution and demand the alternative
 * tips fail there. The stage still teaches follow; the table is merely
 * allowed to have another answer somewhere else, which is what a real
 * table is like.
 *
 * ROUTE rules stay global, because there the global claim is the point.
 * "Every direct line is the wrong one" is a promise about the whole table,
 * and the first Rail First broke exactly that promise: eleven of its
 * sixteen scoring shots went straight to the red.
 */
const LOCAL = {
  draw:   { tips: [0, 0.24, 0.44] },
  follow: { tips: [0, -0.24, -0.44] },
  english: { tips: [-0.42, -0.2, 0, 0.2, 0.42], sides: [0] },
  // Speed only, and a narrow band. `soft` is a claim about ONE line —
  // "the aim that works softly misses when you hit it hard" — so sweeping
  // eight degrees of alternative aims was asking a different question and
  // always finding an answer to it.
  soft:   { speedMul: [1.7, 2.4], span: 2.5 },
};
const GLOBAL = {
  cushionFirst:    { tips: [-0.42, 0, 0.42], sides: [-0.4, 0, 0.4], speeds: [1.8, 2.6] },
  twoCushionFirst: { tips: [-0.42, 0, 0.42], sides: [-0.4, 0, 0.4], speeds: [1.8, 2.6, 3.4] },
  someCushion:     { tips: [-0.42, 0, 0.42], sides: [-0.4, 0, 0.4], speeds: [1.5, 2.2, 3.0] },
};

/** Every shot in a global grid that scores on this position. */
export function scoringShots(balls, grid, step = 3) {
  const out = [];
  for (let deg = -180; deg < 180; deg += step) {
    const a = (deg * Math.PI) / 180;
    for (const speed of grid.speeds)
      for (const tip of grid.tips)
        for (const side of grid.sides) {
          const v = play(balls, { a, speed, tip, side });
          if (v.scored) out.push({ deg, speed, tip, side, kind: v.kind, railsBeforeFirst: v.railsBeforeFirst, rails: v.rails });
        }
  }
  return out;
}

/** Every alternative shot NEAR `shot` that scores. */
function nearbyShots(balls, shot, { tips, sides, speedMul = [0.78, 1, 1.28], span = 8, step = 0.5 }) {
  const out = [];
  const base = (shot.a * 180) / Math.PI;
  for (let d = -span; d <= span; d += step) {
    const a = ((base + d) * Math.PI) / 180;
    for (const m of speedMul)
      for (const tip of tips ?? [shot.tip])
        for (const side of sides ?? [shot.side]) {
          const v = play(balls, { a, speed: shot.speed * m, tip, side });
          if (v.scored) out.push({ d, tip, side, m });
        }
  }
  return out;
}

/**
 * Does this position actually DEMAND `rule`?
 * @returns null if it does, or a sentence saying how it does not.
 *
 * Exported and re-run by test/stages.test.js, so each stage's claim is
 * checked against the physics of the day rather than being a fact about
 * the afternoon it was generated.
 */
export function disprove(balls, rule, shot, step = 3) {
  if (rule === "any") return null;
  if (LOCAL[rule]) {
    const hits = nearbyShots(balls, shot, LOCAL[rule]);
    if (!hits.length) return null;
    const what = {
      draw: "a stun or follow shot",
      follow: "a stun or draw shot",
      english: "a centre-ball shot",
      soft: "a hard shot",
    }[rule];
    return `${what} scores on the same line (${hits.length} of them)`;
  }
  const grid = GLOBAL[rule];
  if (!grid) throw new Error(`unknown rule ${rule}`);
  const hits = scoringShots(balls, grid, step);
  if (rule === "cushionFirst") {
    const direct = hits.filter((h) => h.railsBeforeFirst < 1);
    return direct.length ? `${direct.length} direct shots score` : null;
  }
  if (rule === "twoCushionFirst") {
    const few = hits.filter((h) => h.railsBeforeFirst < 2);
    return few.length ? `${few.length} shots score off fewer than two rails` : null;
  }
  const none = hits.filter((h) => h.rails < 1);
  return none.length ? `${none.length} shots score without touching a cushion` : null;
}

// --- construction --------------------------------------------------------

function trace(balls, shot, seconds = 10) {
  const w = P.createWorld({ balls });
  const cue = P.getBall(w, "cue");
  P.strike(cue, Math.cos(shot.a), Math.sin(shot.a), shot.speed, (shot.side || 0) * R, (shot.tip || 0) * R);
  const path = [];
  let travel = 0;
  let last = { x: cue.x, y: cue.y };
  let t = 0;
  while (t < seconds && !P.isAtRest(w)) {
    P.stepWorld(w, P.SUB_DT);
    t += P.SUB_DT;
    travel += Math.hypot(cue.x - last.x, cue.y - last.y);
    last = { x: cue.x, y: cue.y };
    path.push({
      x: cue.x,
      y: cue.y,
      vx: cue.vx,
      vy: cue.vy,
      travel,
      cushions: w.events.filter((e) => e.type === "cushion" && e.ball === "cue").length,
      contacted: w.events.filter((e) => e.type === "ball").length,
    });
  }
  return path;
}

function pick(path, { after, cushions = 0, contacts = 0, awayFrom = null, clear = 0, edge = 0 }) {
  const base = path.find((p) => p.contacted >= contacts);
  if (!base) return null;
  const m = Math.max(R * 2.2, edge);
  return (
    path.find(
      (p) =>
        p.contacted >= contacts &&
        p.cushions >= cushions &&
        p.travel - base.travel >= after &&
        (!awayFrom || Math.hypot(p.x - awayFrom[0], p.y - awayFrom[1]) >= clear) &&
        p.x > m && p.x < L - m && p.y > m && p.y < W - m
    ) || null
  );
}

function placeOn(p, cut, sign) {
  const s = Math.hypot(p.vx, p.vy) || 1;
  return [p.x + (-p.vy / s) * 2 * R * cut * sign, p.y + (p.vx / s) * 2 * R * cut * sign];
}

const spaced = (balls, gap = 2.35 * R) => {
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.x < 1.6 * R || b.x > L - 1.6 * R || b.y < 1.6 * R || b.y > W - 1.6 * R) return false;
    for (let j = i + 1; j < balls.length; j++)
      if (Math.hypot(b.x - balls[j].x, b.y - balls[j].y) < gap) return false;
  }
  return true;
};

/** Build one candidate from a fully-resolved spec. */
export function build(spec) {
  const shot = { a: (spec.deg * Math.PI) / 180, speed: spec.speed, tip: spec.tip || 0, side: spec.side || 0 };
  const solo = trace(mk(spec.cue, PARK, [PARK[0] - 0.35, PARK[1]], PARK), shot);
  // `after` is PATH length, which is the right measure for "how far has
  // the shot gone" and the wrong one for "how far away is it" — a shot
  // that has bounced can be 1.5m along its path and 20cm from where it
  // started. `clear1` is the straight-line room, and without it the
  // long-range case kept producing short shots with long routes.
  const p1 = pick(solo, {
    after: spec.d1, cushions: spec.c1 || 0, edge: spec.edge1 || 0,
    awayFrom: spec.clear1 ? spec.cue : null, clear: spec.clear1 || 0,
  });
  if (!p1) return null;
  const red1 = placeOn(p1, spec.k1, spec.s1);

  const two = trace(mk(spec.cue, red1, PARK, PARK), shot);
  const p2 = pick(two, {
    after: spec.d2,
    cushions: spec.c2 || 0,
    contacts: 1,
    awayFrom: spec.cue,
    clear: spec.clear || 0.1,
    edge: spec.edge2 || 0,
  });
  if (!p2) return null;
  const red2 = placeOn(p2, spec.k2, spec.s2);

  let yellow = spec.yellow;
  if (yellow === "block") {
    const dx = red1[0] - spec.cue[0];
    const dy = red1[1] - spec.cue[1];
    // Halfway, and the line has to be long enough that halfway is not
    // touching both ends: a yellow wedged between two balls a hand apart
    // is not a screen, it is a clump.
    if (Math.hypot(dx, dy) < (spec.blockRoom || 5 * R)) return null;
    yellow = [spec.cue[0] + dx * 0.5, spec.cue[1] + dy * 0.5];
  } else if (yellow === "between") {
    // ON the line from the first red to the second: the short way home,
    // closed. The requirement does the proving — nothing scores without a
    // rail — and this placement does the SEEING, so the player can look
    // at the table and understand why the obvious answer is not there.
    const dx = red2[0] - red1[0];
    const dy = red2[1] - red1[1];
    const len = Math.hypot(dx, dy) || 1;
    // Long enough that a ball halfway along is a screen and not a clump.
    if (len < (spec.blockRoom || 7 * R)) return null;
    const t = spec.blockAt ?? 0.5;
    yellow = [
      red1[0] + dx * t + (-dy / len) * (spec.blockOff || 0) * R,
      red1[1] + dy * t + (dx / len) * (spec.blockOff || 0) * R,
    ];
  } else if (yellow === "far") {
    // Diagonally opposite whatever the shot is doing, so it is never in
    // the way: for cases whose subject is not the yellow.
    const mid = solo[Math.floor(solo.length * 0.5)] || solo[0];
    yellow = [
      Math.min(L - 0.22, Math.max(0.22, L - mid.x)),
      Math.min(W - 0.22, Math.max(0.22, W - mid.y)),
    ];
  }
  // A minimum distance BETWEEN THE REDS. Everything else in a spec
  // constrains the route; this constrains the picture, which is the whole
  // point of the open cases: a stage whose two reds sit a hand apart in
  // one corner looks like a cluster no matter how long the route to it
  // was.
  if (spec.minRedGap && Math.hypot(red1[0] - red2[0], red1[1] - red2[1]) < spec.minRedGap) return null;
  const balls = mk(spec.cue, red1, red2, yellow);
  if (!spaced(balls, spec.gap ?? 2.35 * R)) return null;
  const seed = play(balls, shot);
  if (!seed.scored) return null;
  return { balls, shot, spec, kind: seed.kind, railsBeforeFirst: seed.railsBeforeFirst, rails: seed.rails };
}

// --- the cases -----------------------------------------------------------

const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const one = (xs) => xs[Math.floor(Math.random() * xs.length)];
const near = (edge) => (edge === "low" ? rnd(1.7 * R, 2.6 * R) : rnd(W - 2.6 * R, W - 1.7 * R));

/**
 * Every case the campaign is meant to cover.
 *
 * `sample()` draws one spec from the case's range. `window` is the aim
 * tolerance band we want the finished stage to land in — that IS the
 * difficulty, and asking for a band rather than a maximum is what keeps
 * the set from being seven variations on "very hard".
 */
export const CASES = {
  // --- the opening ---
  cluster: {
    // The forgiving end of the curriculum, and the reason it is a case
    // rather than a hand placement: what makes a four-ball position easy
    // is the three balls being CLOSE, and close positions are exactly
    // what a real table looks like after a few shots. Short legs, nearly
    // full contacts, and a window wide enough that a beginner who aims
    // roughly at the near red still scores.
    note: "the three balls are close together",
    window: [8, 15],
    requires: "any",
    sample: () => ({
      cue: [rnd(0.3, 2.2), rnd(0.22, 1.05)],
      deg: rnd(-180, 180), speed: rnd(1.2, 1.9), tip: rnd(0, 0.45), side: 0,
      d1: rnd(0.1, 0.3), k1: rnd(0.05, 0.35), s1: one([1, -1]),
      d2: rnd(0.08, 0.24), k2: rnd(0.05, 0.4), s2: one([1, -1]),
      clear: 0.05, yellow: "far",
    }),
  },
  // --- strokes ---
  stun: {
    note: "centre ball, no help from the tip",
    window: [4, 9],
    requires: "any",
    sample: () => ({
      cue: [rnd(0.4, 2.4), rnd(0.35, 1.07)],
      deg: rnd(-180, 180), speed: rnd(1.4, 2.2), tip: 0, side: 0,
      d1: rnd(0.2, 0.45), k1: rnd(0.25, 0.6), s1: one([1, -1]),
      d2: rnd(0.15, 0.35), k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.1, yellow: "far",
    }),
  },
  followOnly: {
    // The two knobs that make topspin NECESSARY rather than merely
    // useful, and both were found by the search failing without them:
    // a SHORT first leg, so the cue ball has not yet picked up natural
    // roll on its own (the skid decays fast — give it half a metre and
    // every shot is a follow shot), and a nearly FULL contact, where a
    // ball with no topspin stops close to dead. Then a long second leg
    // that only a carrying ball reaches.
    note: "must be played with topspin",
    window: [3, 8],
    requires: "follow",
    sample: () => ({
      cue: [rnd(0.4, 2.4), rnd(0.35, 1.07)],
      deg: rnd(-180, 180), speed: rnd(1.3, 2.0), tip: rnd(0.36, 0.46), side: 0,
      d1: rnd(0.07, 0.2), k1: rnd(0, 0.1), s1: one([1, -1]),
      d2: rnd(0.3, 0.75), k2: rnd(0.15, 0.5), s2: one([1, -1]),
      clear: 0.18, yellow: "far",
    }),
  },
  drawOnly: {
    note: "must be played with backspin",
    window: [2, 7],
    requires: "draw",
    sample: () => ({
      cue: [rnd(0.5, 2.3), rnd(0.35, 1.07)],
      deg: rnd(-180, 180), speed: rnd(1.4, 2.4), tip: rnd(-0.46, -0.34), side: 0,
      d1: rnd(0.15, 0.4), k1: rnd(0.0, 0.25), s1: one([1, -1]),
      d2: rnd(0.12, 0.3), k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.1, yellow: "far",
    }),
  },
  englishOnly: {
    note: "must be played with side spin",
    window: [2, 7],
    requires: "english",
    sample: () => ({
      cue: [rnd(0.4, 2.4), rnd(0.3, 1.12)],
      deg: rnd(-180, 180), speed: rnd(1.8, 3.0), tip: rnd(-0.2, 0.3), side: one([1, -1]) * rnd(0.34, 0.46),
      d1: rnd(0.4, 1.1), c1: 1, k1: rnd(0.2, 0.5), s1: one([1, -1]),
      d2: rnd(0.16, 0.4), k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.12, edge1: 0.26, yellow: "far",
    }),
  },
  // --- routes ---
  railFirst: {
    note: "a cushion before the first red",
    window: [2, 6],
    requires: "cushionFirst",
    sample: () => ({
      cue: [rnd(0.4, 2.4), rnd(0.3, 1.12)],
      deg: rnd(-180, 180), speed: rnd(2.0, 3.0), tip: rnd(0.1, 0.4), side: 0,
      d1: rnd(0.35, 0.9), c1: 1, k1: rnd(0.25, 0.5), s1: one([1, -1]),
      d2: rnd(0.18, 0.4), k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.12, edge1: 0.3, edge2: 0.14, yellow: "block",
    }),
  },
  twoCushion: {
    // The rule is `cushionFirst`, not `twoCushionFirst`, and that is a
    // retreat with a reason. Demanding that NO shot on the table score
    // off fewer than two rails found nothing in 1,200 samples, which is
    // the search reporting a fact about billiards: a table where the reds
    // can only be reached the long way round twice is a table where they
    // are almost unreachable. What is both true and achievable is the
    // pair below — the stage's own answer goes two rails (seedRails), and
    // no direct shot scores at all. The player is genuinely sent round
    // the table; they are merely allowed to find a shorter way round than
    // the one the hint describes.
    note: "the shot goes two rails; nothing direct works",
    window: [1.5, 6],
    requires: "cushionFirst",
    seedRails: 2,
    sample: () => ({
      cue: [rnd(0.3, 2.5), rnd(0.25, 1.17)],
      deg: rnd(-180, 180), speed: rnd(2.4, 3.6), tip: rnd(0, 0.4), side: rnd(-0.4, 0.4),
      d1: rnd(0.7, 1.8), c1: 2, k1: rnd(0.2, 0.5), s1: one([1, -1]),
      d2: rnd(0.18, 0.4), k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.12, edge1: 0.3, edge2: 0.14, yellow: "block",
    }),
  },
  yellowBetween: {
    // The one Bo asked for by name: the opponent's ball parked between
    // the two reds, closing the short route. `someCushion` is what makes
    // it true rather than decorative — no shot on the table scores
    // without a rail — and c2 makes the stage's own answer take one.
    note: "the yellow sits between the reds; the short way is closed",
    window: [2, 7],
    requires: "someCushion",
    sample: () => ({
      cue: [rnd(0.4, 2.3), rnd(0.3, 1.1)],
      deg: rnd(-180, 180), speed: rnd(1.9, 3.0), tip: rnd(-0.1, 0.4), side: 0,
      d1: rnd(0.25, 0.6), k1: rnd(0.25, 0.6), s1: one([1, -1]),
      d2: rnd(0.5, 1.3), c2: 1, k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.2, edge2: 0.18,
      yellow: "between", blockAt: rnd(0.36, 0.64), blockOff: rnd(-1.1, 1.1),
      blockRoom: 8 * R,
    }),
  },
  tightCorner: {
    note: "all three balls wedged into one corner",
    window: [6, 13],
    requires: "any",
    sample: () => {
      const cx = one([rnd(1.8 * R, 0.15), rnd(L - 0.15, L - 1.8 * R)]);
      const cy = one([rnd(1.8 * R, 0.15), rnd(W - 0.15, W - 1.8 * R)]);
      return {
        cue: [cx, cy],
        deg: rnd(-180, 180), speed: rnd(1.2, 2.0), tip: rnd(0, 0.4), side: 0,
        d1: rnd(0.1, 0.28), k1: rnd(0.05, 0.4), s1: one([1, -1]),
        d2: rnd(0.08, 0.24), k2: rnd(0.05, 0.4), s2: one([1, -1]),
        clear: 0.05, yellow: "far",
      };
    },
  },
  longThin: {
    note: "a long run, and a feather at the end of it",
    window: [1.5, 5],
    requires: "any",
    sample: () => ({
      cue: [rnd(0.25, 0.7), rnd(0.25, 1.15)],
      deg: rnd(-75, 75), speed: rnd(2.4, 3.8), tip: rnd(0, 0.4), side: 0,
      d1: rnd(1.1, 1.9), k1: rnd(0.66, 0.85), s1: one([1, -1]),
      d2: rnd(0.2, 0.5), k2: rnd(0.62, 0.86), s2: one([1, -1]),
      clear: 0.14, clear1: 1.1, edge1: 0.22, yellow: "far",
    }),
  },
  sideRail: {
    note: "a cushion first, and side spin to make the angle off it",
    window: [1.5, 5],
    requires: "cushionFirst",
    sample: () => ({
      cue: [rnd(0.35, 2.35), rnd(0.28, 1.12)],
      deg: rnd(-180, 180), speed: rnd(2.2, 3.4), tip: rnd(0, 0.35),
      side: one([1, -1]) * rnd(0.3, 0.46),
      d1: rnd(0.4, 1.0), c1: 1, k1: rnd(0.25, 0.5), s1: one([1, -1]),
      d2: rnd(0.18, 0.45), k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.12, edge1: 0.28, edge2: 0.14, yellow: "block",
    }),
  },
  cushionBetween: {
    note: "straight into the first red, then a rail to reach the second",
    window: [2, 7],
    requires: "someCushion",
    sample: () => ({
      cue: [rnd(0.4, 2.4), rnd(0.3, 1.12)],
      deg: rnd(-180, 180), speed: rnd(1.9, 3.0), tip: rnd(-0.1, 0.4), side: 0,
      d1: rnd(0.2, 0.5), k1: rnd(0.3, 0.65), s1: one([1, -1]),
      d2: rnd(0.5, 1.3), c2: 1, k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.2, edge2: 0.2, yellow: "far",
    }),
  },
  longRange: {
    note: "the cue ball crosses the table to get there",
    window: [1.5, 5],
    requires: "any",
    sample: () => ({
      cue: [rnd(0.25, 0.6), rnd(0.25, 1.17)],
      deg: rnd(-70, 70), speed: rnd(2.4, 3.8), tip: rnd(0, 0.4), side: 0,
      d1: rnd(1.4, 2.2), k1: rnd(0.15, 0.45), s1: one([1, -1]),
      d2: rnd(0.18, 0.45), k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.14, clear1: 1.3, edge1: 0.24, yellow: "far",
    }),
  },
  // --- awkward positions ---
  cueOnRail: {
    note: "the cue ball is against a cushion",
    window: [3, 9],
    requires: "any",
    sample: () => ({
      cue: [rnd(0.5, 2.3), near(one(["low", "high"]))],
      deg: rnd(-180, 180), speed: rnd(1.5, 2.6), tip: rnd(-0.2, 0.4), side: 0,
      d1: rnd(0.2, 0.6), k1: rnd(0.2, 0.55), s1: one([1, -1]),
      d2: rnd(0.15, 0.4), k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.1, yellow: "far",
    }),
  },
  cueInCorner: {
    note: "wedged into a corner with almost no cue room",
    window: [3, 9],
    requires: "any",
    sample: () => {
      const cx = one([rnd(1.75 * R, 0.16), rnd(L - 0.16, L - 1.75 * R)]);
      const cy = one([rnd(1.75 * R, 0.16), rnd(W - 0.16, W - 1.75 * R)]);
      return {
        cue: [cx, cy],
        deg: rnd(-180, 180), speed: rnd(1.5, 2.6), tip: rnd(-0.1, 0.4), side: 0,
        d1: rnd(0.25, 0.6), k1: rnd(0.2, 0.55), s1: one([1, -1]),
        d2: rnd(0.15, 0.4), k2: rnd(0.2, 0.5), s2: one([1, -1]),
        clear: 0.1, yellow: "far",
      };
    },
  },
  frozenPair: {
    note: "the two reds are touching each other",
    window: [3, 9],
    requires: "any",
    // 2.12R, not the 2.05R this started at. test/stages.test.js refuses
    // any pair closer than 2R * 1.05 — a floor that protects the solver
    // from balls that load already overlapping — and 2.05R sits under it,
    // so the case could emit a stage its own suite rejected. At 2.12R the
    // gap is under four millimetres on a 65.5mm ball, which is still
    // "frozen" to everything except the collision code.
    gap: 2.12 * R,
    sample: () => ({
      cue: [rnd(0.4, 2.4), rnd(0.3, 1.12)],
      deg: rnd(-180, 180), speed: rnd(1.5, 2.6), tip: rnd(-0.2, 0.4), side: 0,
      d1: rnd(0.25, 0.6), k1: rnd(0.3, 0.7), s1: one([1, -1]),
      d2: rnd(0.05, 0.12), k2: rnd(0.05, 0.35), s2: one([1, -1]),
      clear: 0.05, gap: 2.12 * R, yellow: "far",
    }),
  },
  thinBoth: {
    note: "both contacts are feathers",
    window: [1.5, 6],
    requires: "any",
    sample: () => ({
      cue: [rnd(0.4, 2.4), rnd(0.3, 1.12)],
      deg: rnd(-180, 180), speed: rnd(1.6, 2.8), tip: rnd(-0.1, 0.35), side: 0,
      d1: rnd(0.2, 0.5), k1: rnd(0.72, 0.88), s1: one([1, -1]),
      d2: rnd(0.15, 0.4), k2: rnd(0.7, 0.88), s2: one([1, -1]),
      clear: 0.1, yellow: "far",
    }),
  },
  yellowTrap: {
    note: "the opponent ball sits in the obvious line",
    window: [2, 7],
    requires: "any",
    sample: () => ({
      cue: [rnd(0.4, 2.4), rnd(0.3, 1.12)],
      deg: rnd(-180, 180), speed: rnd(1.6, 2.8), tip: rnd(-0.2, 0.4), side: 0,
      d1: rnd(0.5, 1.1), k1: rnd(0.2, 0.55), s1: one([1, -1]),
      d2: rnd(0.15, 0.4), k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.12, clear1: 0.55, blockRoom: 0.55, gap: 0.1, yellow: "block",
    }),
  },
  softTouch: {
    // A rail in the second leg is what makes speed matter at all. Without
    // one, "the same line, hit harder" reaches the same two balls — the
    // cue ball simply passes the same places faster — and 900 samples
    // produced no position where a hard shot failed. With a cushion in
    // the route the rebound angle moves with speed (the restitution is
    // speed-dependent and the spin the rail strips is not), so the hard
    // version of the same aim comes off the rail somewhere else.
    note: "a slow roll off a cushion; power sends it somewhere else",
    window: [2, 8],
    requires: "soft",
    sample: () => ({
      cue: [rnd(0.4, 2.4), rnd(0.3, 1.12)],
      deg: rnd(-180, 180), speed: rnd(1.0, 1.5), tip: rnd(-0.2, 0.35), side: 0,
      d1: rnd(0.12, 0.4), k1: rnd(0.2, 0.6), s1: one([1, -1]),
      d2: rnd(0.35, 0.9), c2: 1, k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.14, edge2: 0.14, yellow: "far",
    }),
  },
  // --- open tables ---
  //
  // These two exist because of a measurement, not a hunch: of the first
  // hundred stages, 67 had every ball inside a quarter of the table and
  // NONE had the two reds more than 0.43 of a table apart. The campaign
  // is ordered by how much aim a stage forgives, and the only open
  // positions in the pool were narrow-window ones, so every wide picture
  // sorted to the last quarter and the first fifty stages were fifty
  // photographs of the same corner.
  //
  // The fix is not to reorder — it is to search the band nobody searched.
  // An open position is not inherently unforgiving: three balls strung
  // out along a line give a wide window and a long, satisfying route.
  //
  // Measured while writing them: a LONG first leg cannot be forgiving —
  // 500 samples with both legs over half a metre had a median window of
  // half a degree and never once reached 4.5. Distance amplifies an aim
  // error, and that is geometry, not tuning. So the forgiving open stage
  // is the one with the near red close to hand and the far red a table
  // away: the picture is wide, the first contact is not.
  openTable: {
    note: "a red at hand and a red down the table; the picture is open, the first ball is not",
    window: [4.5, 11],
    requires: "any",
    sample: () => ({
      cue: [rnd(0.3, 2.4), rnd(0.24, 1.18)],
      deg: rnd(-180, 180), speed: rnd(1.8, 3.2), tip: rnd(0, 0.4), side: 0,
      d1: rnd(0.14, 0.42), k1: rnd(0.08, 0.4), s1: one([1, -1]),
      d2: rnd(0.9, 2.0), c2: one([0, 1]), k2: rnd(0.1, 0.45), s2: one([1, -1]),
      clear: 0.4, edge1: 0.14, edge2: 0.18,
      gap: 0.26, minRedGap: 0.9, yellow: "far",
    }),
  },
  redsApart: {
    note: "one red near, one red at the far end of the table",
    window: [3.5, 9],
    requires: "any",
    sample: () => ({
      cue: [rnd(0.3, 1.1), rnd(0.24, 1.18)],
      deg: rnd(-180, 180), speed: rnd(2.0, 3.4), tip: rnd(0, 0.4), side: rnd(-0.2, 0.2),
      d1: rnd(0.3, 0.9), k1: rnd(0.15, 0.5), s1: one([1, -1]),
      d2: rnd(1.1, 2.2), c2: one([0, 1]), k2: rnd(0.15, 0.5), s2: one([1, -1]),
      clear: 0.5, edge1: 0.16, edge2: 0.2,
      gap: 0.3, minRedGap: 1.15, yellow: "far",
    }),
  },
  spread: {
    note: "all four balls far apart; the whole table is in play",
    window: [1, 4],
    requires: "any",
    sample: () => ({
      cue: [rnd(0.3, 0.8), rnd(0.25, 1.17)],
      deg: rnd(-180, 180), speed: rnd(2.6, 3.8), tip: rnd(0, 0.4), side: rnd(-0.3, 0.3),
      d1: rnd(1.0, 2.0), c1: one([0, 1]), k1: rnd(0.2, 0.5), s1: one([1, -1]),
      d2: rnd(0.6, 1.4), k2: rnd(0.2, 0.5), s2: one([1, -1]),
      clear: 0.5, edge1: 0.26, edge2: 0.2, gap: 0.42, yellow: "far",
    }),
  },
};

// --- the search ----------------------------------------------------------
//
// TWO STAGES, and the split is a cost decision that changed the tool from
// unusable to usable. Building a candidate and measuring its aim window
// costs about eighty milliseconds; proving it demands its lesson costs one
// to three SECONDS. Running the expensive check on every sample meant a
// hundred and fifty candidates took longer than this project's entire
// test suite. So: build and measure everything, keep the ones whose
// window lands in the case's band, and only then spend the seconds on the
// handful still standing.

/**
 * Does the stage's OWN shot take the route the case claims?
 *
 * This gate is not redundant with disprove() and leaving it out produced
 * a real false pass: a `someCushion` candidate came back clean whose own
 * solution used no cushion at all. disprove() searches a coarse grid of
 * OTHER shots, and a grid that steps speed in three values simply never
 * tried the seed's own 2.667 m/s — so it truthfully reported "nothing in
 * the grid scores without a rail" about a position whose answer does.
 * A rule has to bind the shot the player is being taught first.
 */
function seedTakesTheRoute(rule, built, want = 0) {
  if (built.railsBeforeFirst < want) return false;
  if (rule === "cushionFirst") return built.railsBeforeFirst >= 1;
  if (rule === "twoCushionFirst") return built.railsBeforeFirst >= 2;
  if (rule === "someCushion") return built.rails >= 1;
  return true;
}

function measure(name, spec) {
  const built = build(spec);
  if (!built) return null;
  const c = CASES[name];
  if (!seedTakesTheRoute(c.requires, built, c.seedRails || 0)) return null;
  const tol = tolerance(built.balls, built.shot, c.window[1] + 3);
  if (tol.width < c.window[0] || tol.width > c.window[1]) return null;
  return { ...built, tol };
}

const f = (n) => Number(n.toFixed(3));

function run(names, tries, finalists, probeCap) {
  const out = [];
  for (const name of names) {
    const c = CASES[name];
    const t0 = Date.now();
    const built = [];
    for (let i = 0; i < tries; i++) {
      const r = measure(name, c.sample());
      if (r) built.push(r);
    }
    const mid = (c.window[0] + c.window[1]) / 2;
    built.sort((a, b) => Math.abs(a.tol.width - mid) - Math.abs(b.tol.width - mid));
    const kept = [];
    let probed = 0;
    for (const h of built) {
      if (kept.length >= finalists || probed >= probeCap) break;
      probed++;
      // Round FIRST, then prove. stages.js stores three decimals, and a
      // stage proved at full precision and shipped rounded is a stage
      // whose proof is about a position that is not on the table: the
      // first campaign built this way had a "cushion between" stage that
      // the suite could beat with a straight shot, purely because the
      // reds had moved half a millimetre on the way out.
      const balls = h.balls.map((b) => ({ ...b, x: f(b.x), y: f(b.y) }));
      const shot = {
        ...h.shot,
        a: (f((h.shot.a * 180) / Math.PI) * Math.PI) / 180,
        speed: f(h.shot.speed),
        tip: f(h.shot.tip),
        side: f(h.shot.side || 0),
      };
      if (disprove(balls, c.requires, shot)) continue;
      kept.push({ ...h, balls, shot });
    }
    console.log(
      `\n### ${name} — ${c.note}\n    ${built.length}/${tries} in window, ` +
        `${kept.length}/${probed} probed survive "${c.requires}", ${((Date.now() - t0) / 1000).toFixed(0)}s`
    );
    for (const h of kept) {
      const b = Object.fromEntries(h.balls.map((x) => [x.id, [f(x.x), f(x.y)]]));
      const rec = {
        case: name,
        requires: c.requires,
        aimWindow: h.tol.width,
        kind: h.kind,
        railsBeforeFirst: h.railsBeforeFirst,
        solution: { deg: f((h.shot.a * 180) / Math.PI), speed: f(h.shot.speed), tip: f(h.shot.tip), side: f(h.shot.side) },
        balls: { cue: b.cue, red1: b.red1, red2: b.red2, yellow: b.yellow },
      };
      out.push(rec);
      console.log(`  aim=${h.tol.width}  kind=${h.kind}  railsFirst=${h.railsBeforeFirst}`);
      console.log(`    ${JSON.stringify(rec.solution)}`);
      console.log(`    ${JSON.stringify(rec.balls)}`);
    }
  }
  const dest = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1];
  if (dest) {
    const prev = existsSync(dest) ? JSON.parse(readFileSync(dest, "utf8")) : [];
    writeFileSync(dest, JSON.stringify([...prev, ...out], null, 1));
    console.log(`\nwrote ${out.length} (total ${prev.length + out.length}) to ${dest}`);
  }
}

// Only when run as a command. build/tolerance/disprove are imported by
// test/stages.test.js and by the assembler, and a module that starts a
// two-minute search on import is not importable.
if (process.argv[1] && process.argv[1].endsWith("stage-lab.mjs")) {
  const args = process.argv.slice(2);
  const num = (k, d) => Number(args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] || d);
  const names = args.filter((a) => !a.startsWith("--"));
  run(names.length ? names : Object.keys(CASES), num("tries", 400), num("keep", 2), num("probe", 40));
}
