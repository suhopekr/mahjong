// game/render.js
// All canvas drawing. Reads state, writes pixels, owns no game logic.
//
// Inherited from the site's Four Ball Billiards renderer: the cached
// table bitmap, the per-pixel shaded ball sprite, the cue, the preview
// line. New for pool: six pockets cut into the rails, numbered and
// striped balls, the head string and the ghost cue ball for ball in
// hand, and three cloth colours instead of five whole tables.

import { TABLE_LENGTH, TABLE_WIDTH, BALL_RADIUS, CORNER_MOUTH, SIDE_MOUTH, pocketsFor } from "./physics.js";
import { toPx, dirToScreen, RAIL, pullForPower } from "./layout.js";
import { paintCloth, paintRail, paintSight, paintShelf } from "./surface.js";
import { colorOf, isStripe, CUE as CUE_ID, HEAD_STRING, FOOT_SPOT } from "./rack.js";

/** The three cloths. Only the cloth changes; the rails, the balls and the
 * cue are the same furniture, so the three read as one table re-covered
 * rather than three games. */
export const CLOTHS = {
  green: { cloth: "#2c8763", clothLamp: "#3daa7c", clothDark: "#14543f", clothLine: "#43a37f", cushion: "#1c6a4d" },
  blue: { cloth: "#26707d", clothLamp: "#35909f", clothDark: "#123f4a", clothLine: "#37909e", cushion: "#1a5b68" },
  burgundy: { cloth: "#7d2a3a", clothLamp: "#9a3a4c", clothDark: "#4a1622", clothLine: "#8f3a4a", cushion: "#5c1f2c" },
};
export const CLOTH_IDS = Object.keys(CLOTHS);
export const DEFAULT_CLOTH = "green";

export const COLORS = {
  ...CLOTHS.green,
  rail: "#4a2a17",
  railLight: "#7d4827",
  railDark: "#200f06",
  white: "#f7f4ec",
};

export function applyCloth(id) {
  Object.assign(COLORS, CLOTHS[id] || CLOTHS.green);
  tableCache = null;
  spriteCache.clear();
}

/** Set up a crisp canvas: back it with devicePixelRatio pixels but let
 * every drawing call below speak in CSS pixels. */
export function prepareCanvas(canvas, ctx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: w, height: h };
}

/** How the rail's width is split between wood and cushion. */
const WOOD_SHARE = 0.6;

/** The table, painted once per size and cached. */
let tableCache = null;

export function drawTable(ctx, L) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const key = `${Math.round(L.width)}x${Math.round(L.height)}@${dpr}:${Math.round(L.scale)}:${L.rotated}:${COLORS.cloth}`;
  if (!tableCache || tableCache.key !== key) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(L.width * dpr));
    c.height = Math.max(1, Math.round(L.height * dpr));
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintTable(g, L);
    tableCache = { key, canvas: c };
  }
  ctx.drawImage(tableCache.canvas, 0, 0, L.width, L.height);
}

function paintTable(ctx, L) {
  const a = toPx(L, 0, 0);
  const b = toPx(L, TABLE_LENGTH, TABLE_WIDTH);
  const bed = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  const railPx = RAIL * L.scale;
  const wood = railPx * WOOD_SHARE;
  const cush = railPx - wood;
  const nose = { x: bed.x - cush, y: bed.y - cush, w: bed.w + cush * 2, h: bed.h + cush * 2 };
  const out = { x: nose.x - wood, y: nose.y - wood, w: nose.w + wood * 2, h: nose.h + wood * 2 };
  const mouths = pocketMouths();
  const runs = cushionRuns();

  // --- the shadow the whole table casts ---------------------------------
  // Outside the footprint clip below, because it is the shadow and not the
  // table: it is the one thing that is meant to fall on the page.
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.filter = "blur(" + (railPx * 0.5).toFixed(1) + "px)";
  roundRect(ctx, out.x + railPx * 0.1, out.y + railPx * 0.3, out.w, out.h, railPx * 0.35);
  ctx.fill();
  ctx.restore();

  // NOTHING BELOW MAY LEAVE THE TABLE'S FOOTPRINT. The pocket mouths run
  // out into the wood and their soft rims spread further still, and at a
  // corner the mouth ends less than a third of a ball's radius inside the
  // outer edge — so a rim allowed to spread freely put a dark smudge on
  // the cream page beyond the corner. One clip here is cheaper and safer
  // than asking every gradient below to be careful, and it costs nothing
  // per frame because the table is painted once per size.
  ctx.save();
  ctx.beginPath();
  ctx.rect(out.x, out.y, out.w, out.h);
  ctx.clip();

  // --- four rails, mitred, with a bite taken out at each mouth ----------
  // Two clips, because canvas intersects successive clips and that is the
  // only way to subtract a UNION of shapes: the wood keeps only what is
  // outside both the hole and the bite, so its inner edge curves around
  // each pocket instead of running dead straight past behind it. What is
  // cut away is repainted below — slate in the bite, the well itself in
  // the mouth — from these very same paths, so there is no seam.
  ctx.save();
  clipOutMouths(ctx, L, mouths, "mouth");
  clipOutMouths(ctx, L, mouths, "bite");
  const pieces = [
    { box: { x: out.x, y: out.y, w: out.w, h: wood }, pts: [[out.x, out.y], [out.x + out.w, out.y], [nose.x + nose.w, nose.y], [nose.x, nose.y]], axis: "h", flip: false },
    { box: { x: out.x, y: nose.y + nose.h, w: out.w, h: wood }, pts: [[out.x, out.y + out.h], [out.x + out.w, out.y + out.h], [nose.x + nose.w, nose.y + nose.h], [nose.x, nose.y + nose.h]], axis: "h", flip: true },
    { box: { x: out.x, y: out.y, w: wood, h: out.h }, pts: [[out.x, out.y], [out.x, out.y + out.h], [nose.x, nose.y + nose.h], [nose.x, nose.y]], axis: "v", flip: false },
    { box: { x: nose.x + nose.w, y: out.y, w: wood, h: out.h }, pts: [[out.x + out.w, out.y], [out.x + out.w, out.y + out.h], [nose.x + nose.w, nose.y + nose.h], [nose.x + nose.w, nose.y]], axis: "v", flip: true },
  ];
  const woodColors = { light: COLORS.railLight, base: COLORS.rail, dark: COLORS.railDark };
  for (const piece of pieces) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(piece.pts[0][0], piece.pts[0][1]);
    for (const [px, py] of piece.pts.slice(1)) ctx.lineTo(px, py);
    ctx.closePath();
    ctx.clip();
    paintRail(ctx, piece.box, piece.axis, woodColors, piece.flip);
    ctx.restore();
  }
  ctx.save();
  ctx.strokeStyle = "rgba(20,10,3,0.45)";
  ctx.lineWidth = 1;
  for (const [ox, oy, nx2, ny2] of [
    [out.x, out.y, nose.x, nose.y],
    [out.x + out.w, out.y, nose.x + nose.w, nose.y],
    [out.x, out.y + out.h, nose.x, nose.y + nose.h],
    [out.x + out.w, out.y + out.h, nose.x + nose.w, nose.y + nose.h],
  ]) {
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(nx2, ny2);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,228,190,0.22)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(out.x, out.y + out.h);
  ctx.lineTo(out.x, out.y);
  ctx.lineTo(out.x + out.w, out.y);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.moveTo(out.x + out.w, out.y);
  ctx.lineTo(out.x + out.w, out.y + out.h);
  ctx.lineTo(out.x, out.y + out.h);
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // --- the slate shelf inside each mouth ---------------------------------
  // What a player actually recognises as a pocket is not the hole, it is
  // the slate showing between two cut-back cushion ends. Two regions per
  // pocket: the shelf proper, clipped out of the bed so the cloth painted
  // below owns every pixel it should and the two meet without a step; and
  // the bite the pocket takes out of the rail, where the same slate shows
  // under the cut-back wood.
  for (const m of mouths) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(out.x, out.y, out.w, out.h);
    ctx.rect(bed.x, bed.y, bed.w, bed.h);
    ctx.clip("evenodd");
    ctx.beginPath();
    tracePx(ctx, L, m.shelf);
    ctx.clip();
    paintShelf(ctx, out, { edge: COLORS.clothDark });
    ctx.restore();
    // And the same slate again in the bite, where the rail is cut back.
    // Inside a mouth the rail is simply GONE, so what you look down on
    // between the jaws is one continuous piece of slate running from the
    // cloth to the drop: filling the bite with anything else — leather,
    // or the wood's own tone — put a hard straight line along the nose
    // across the open mouth, which is the defect this is here to remove.
    // The rail's cut edge is drawn as an edge below, not as a change of
    // material.
    ctx.save();
    ctx.beginPath();
    tracePx(ctx, L, m.bite);
    ctx.clip();
    paintShelf(ctx, out, { edge: COLORS.clothDark });
    ctx.restore();
    // The rail's own cut edge: the wood has thickness, so where it has
    // been taken away there is a shadowed face. Clipped to the wood band
    // so only the half of the stroke that lies in the wood shows, which
    // is what makes it an edge rather than an outline.
    ctx.save();
    ctx.beginPath();
    ctx.rect(out.x, out.y, out.w, out.h);
    ctx.rect(nose.x, nose.y, nose.w, nose.h);
    ctx.clip("evenodd");
    ctx.strokeStyle = "rgba(18,9,3,0.6)";
    ctx.lineWidth = Math.max(1.5, wood * 0.16);
    ctx.lineJoin = "round";
    ctx.beginPath();
    tracePx(ctx, L, m.bite);
    ctx.stroke();
    ctx.restore();
  }

  // --- the cushions: six runs that END at the jaws ----------------------
  // Six polygons rather than one band with holes punched in it, because
  // the jaw IS the pocket: each run stops exactly where physics stops
  // cushioning the ball (cushionRuns uses CORNER_MOUTH and SIDE_MOUTH,
  // the constants cushionsFor() ends its segments at) and its end face is
  // cut back so the mouth funnels outward.
  ctx.save();
  ctx.beginPath();
  for (const run of runs) tracePx(ctx, L, run);
  ctx.fillStyle = COLORS.cushion;
  ctx.fill();
  ctx.clip();
  const faces = [
    [nose.x, nose.y, nose.w, cush, 0, 1],
    [nose.x, bed.y + bed.h, nose.w, cush, 0, -1],
    [nose.x, nose.y, cush, nose.h, 1, 0],
    [bed.x + bed.w, nose.y, cush, nose.h, -1, 0],
  ];
  for (const [fx, fy, fw, fh, dx, dy] of faces) {
    const g = ctx.createLinearGradient(
      dx !== 0 ? (dx > 0 ? fx : fx + fw) : fx,
      dy !== 0 ? (dy > 0 ? fy : fy + fh) : fy,
      dx !== 0 ? (dx > 0 ? fx + fw : fx) : fx,
      dy !== 0 ? (dy > 0 ? fy + fh : fy) : fy
    );
    g.addColorStop(0, "rgba(255,255,255,0.16)");
    g.addColorStop(0.45, "rgba(255,255,255,0.02)");
    g.addColorStop(1, "rgba(0,0,0,0.34)");
    ctx.fillStyle = g;
    ctx.fillRect(fx, fy, fw, fh);
  }
  // The cut faces, given thickness by an inner shadow and a lit lip. A
  // cushion end with no edge on it reads as a flat wedge of colour, and
  // the jaws are the whole point of the exercise.
  ctx.lineJoin = "round";
  for (const run of runs) {
    for (const [i, j] of [[1, 2], [3, 0]]) {
      const p = toPx(L, run[i][0], run[i][1]);
      const q = toPx(L, run[j][0], run[j][1]);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = Math.max(1.5, cush * 0.22);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,246,228,0.16)";
      ctx.lineWidth = Math.max(1, cush * 0.07);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
  }
  ctx.restore();

  // --- the bed -----------------------------------------------------------
  paintCloth(ctx, bed, { base: COLORS.cloth, lamp: COLORS.clothLamp, edge: COLORS.clothDark });
  // The cloth-meets-cushion seam exists only where there IS cushion, so it
  // is clipped to the runs. Drawn as a full rect before, it crossed every
  // mouth — the same mistake as the brass fillet below, one layer down.
  ctx.save();
  clipToRuns(ctx, L, runs);
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(1, railPx * 0.05);
  ctx.strokeRect(bed.x, bed.y, bed.w, bed.h);
  ctx.restore();

  drawSpots(ctx, L);

  // A brass fillet where the wood meets the cushion.
  //
  // Clipped to the cushion runs. It used to be a plain strokeRect, drawn
  // after the pockets, so a gold line ran straight across every hole —
  // reported as "the pockets have a line through them", and it is the one
  // thing that made the table read as a drawing rather than a table. A
  // pocket is a hole through the cushion and the wood, so nothing that
  // belongs to either may cross it.
  ctx.save();
  clipToRuns(ctx, L, runs);
  ctx.strokeStyle = "rgba(201,164,92,0.75)";
  ctx.lineWidth = Math.max(1, wood * 0.07);
  ctx.strokeRect(nose.x, nose.y, nose.w, nose.h);
  ctx.restore();

  // --- the lamp ----------------------------------------------------------
  // BEFORE the pockets, and over the shelves as well as the bed.
  //
  // This warm gradient used to be the last thing painted and was clipped
  // to `bed` alone. The lower half of a side pocket and the inner quarter
  // of a corner pocket lie inside `bed`, so the lamp lightened them, and
  // the edge of the clip — the straight line y = bed.y — showed as a step
  // drawn across the black. Painting it before the pockets means the hole
  // can never be lightened at all; including the shelves means the light
  // does not stop at the nose line in the middle of an open mouth either.
  const lampGrad = (() => {
    const cx = bed.x + bed.w / 2;
    const cy = bed.y + bed.h / 2;
    const rr = Math.max(bed.w, bed.h) * 0.62;
    const lg = ctx.createRadialGradient(cx, cy, rr * 0.12, cx, cy, rr);
    lg.addColorStop(0, "rgba(255,244,214,0.14)");
    lg.addColorStop(0.55, "rgba(255,240,205,0.04)");
    lg.addColorStop(1, "rgba(0,0,0,0)");
    return lg;
  })();
  ctx.save();
  ctx.beginPath();
  ctx.rect(bed.x, bed.y, bed.w, bed.h);
  ctx.clip();
  ctx.fillStyle = lampGrad;
  ctx.fillRect(bed.x, bed.y, bed.w, bed.h);
  ctx.restore();
  // The shelves one at a time: a single path of all seven regions would
  // have the bed rect and a shelf polygon wound against each other, and
  // nonzero fill would then cancel where they overlap.
  for (const m of mouths) {
    ctx.save();
    ctx.beginPath();
    tracePx(ctx, L, m.shelf);
    ctx.clip();
    ctx.fillStyle = lampGrad;
    ctx.fillRect(out.x, out.y, out.w, out.h);
    ctx.restore();
  }

  // --- the shadow inside each mouth --------------------------------------
  // One radial darkening per pocket, painted over the shelf, the bite AND
  // the cloth, in that order and with no hard edge anywhere in between.
  // It was inside paintShelf at first, and stopping it at the shelf's
  // boundary put a straight dark step along the nose line right across
  // the open mouth of every side pocket: the shadow has to cross the seam
  // for the seam to disappear.
  for (const m of mouths) {
    const c = toPx(L, m.cx, m.cy);
    // How far the shadow may reach is set by the jaws, not by taste: it
    // has to have died to nothing by the time it arrives at a cushion's
    // cut face, because THAT edge is a hard one and a shadow ending on it
    // would draw a line along it. The corner's jaws stand further off, so
    // its shadow gets more room.
    const reach = BALL_RADIUS * L.scale * (m.corner ? 3.6 : 2.6);
    const sh = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, reach);
    sh.addColorStop(0, "rgba(0,0,0,0.66)");
    sh.addColorStop(0.72, "rgba(0,0,0,0.5)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    for (const region of [m.shelf, m.bite, null]) {
      ctx.save();
      ctx.beginPath();
      if (region) tracePx(ctx, L, region);
      else ctx.rect(bed.x, bed.y, bed.w, bed.h);
      ctx.clip();
      ctx.fillStyle = sh;
      ctx.fillRect(c.x - reach, c.y - reach, reach * 2, reach * 2);
      ctx.restore();
    }
  }

  drawPockets(ctx, L, railPx, mouths);
  drawSights(ctx, L, out, nose, wood);
  ctx.restore();
}

// --- the six pocket mouths -----------------------------------------------
//
// A POCKET IS A GAP IN THE CUSHION, NOT A CIRCLE PAINTED ON ONE.
//
// The first version of this file drew a black disc on top of an unbroken
// cushion band, and no amount of shading rescued it: the cushion never
// ENDED, so the hole read as a circle on a drawing of a table rather than
// as a pocket in one. And a real mouth is not round — it is a wedge at a
// corner and a flared trapezoid at a side pocket.
//
// So each mouth is laid out here, once, in TABLE METRES:
//
//   mouth  the hole. A rounded wedge pointing out along the diagonal at a
//          corner; a rounded trapezoid, narrow at the cloth and wide at
//          the rail, at a side pocket.
//   shelf  the slate that shows inside the mouth, bounded by the two
//          cut-back cushion ends.
//
// and the cushion is built as six runs ending at those same jaws. Table
// metres rather than pixels because then one set of numbers is right at
// every size and rotates with the table for free through toPx; the shapes
// are sampled into points rather than arcs for the same reason.
//
// THE DRAWN MOUTH STAYS INSIDE THE CAPTURE CIRCLE, deliberately: a ball
// hanging on the lip has to still look like it is on the table. Measured
// against the circles pocketsFor() captures with, the farthest point of a
// drawn mouth is at 0.79 of the capture radius at a corner and 0.92 at a
// side pocket — where the old plain circles were at 0.70 and 0.92, so the
// mouth grew where there was room and nowhere else.

/** The cushion's depth and the wood's width, in table metres. */
const CUSH_M = RAIL * (1 - WOOD_SHARE);

/** How far the cushion's end face retreats from the pocket over the depth
 * of the cushion. At a corner that is a 45 degree cut, which is what a
 * corner pocket's facings are; at a side pocket it is much gentler,
 * because a steep cut there would leave an end so thin it reads as a
 * spike at phone size. Both make the mouth wider at the rail than at the
 * cloth, which is the funnel that says "in here". */
const CORNER_CUT = CUSH_M;
const SIDE_CUT = CUSH_M * 0.4;

/** The corner wedge: the convex hull of two discs on the diagonal, wide
 * at the cloth and tapering to a rounded point under the rail, in ball
 * radii from the pocket's own centre.
 *
 * The fat disc sits almost a ball TOWARD THE CLOTH of that centre, not on
 * it. The first pass had it centred and the pocket came out as a dark
 * blob sitting in the corner of the rail with a wide shelf between it and
 * the bed — the corner of the table has to BE the pocket, so the mouth
 * has to reach into the cloth. Outward it is the table's own edge that
 * sets the limit: the tip stops a fifth of a ball inside it. */
const CORNER_WEDGE = { dBed: 0.8, rBed: 1.85, dTip: 1.06, rTip: 0.72 };

/** The side trapezoid, in ball radii as (along the rail, outward from the
 * nose line): narrow at the cloth, flaring past the cushion's back edge,
 * then closed off with a rounded back. */
const SIDE_TRAPEZOID = [
  [-1.24, -0.46],
  [1.24, -0.46],
  [1.7, 1.15],
  [1.05, 1.78],
  [-1.05, 1.78],
  [-1.7, 1.15],
];
/** The rounding, per corner. The two at the cloth are deliberately the
 * tightest: the physics' mouth between the jaws is 4.5 ball radii wide
 * and the capture circle only lets the hole be 3.4 across, so there is
 * shelf on both sides whatever happens, and every radius spent rounding
 * the cloth edge is width taken off the one part of the hole a player
 * aims at. */
const SIDE_ROUND = [0.3, 0.3, 0.36, 0.42, 0.42, 0.36];

/** THE BITE: the same two shapes, grown, and used only to cut the WOOD
 * back around each pocket. It is a separate shape from the mouth because
 * the hole has to stay well inside the capture circle and the rail's
 * inner edge does not: a rail that runs dead straight past a pocket and
 * meets the slate in a hard line is the rail visibly passing BEHIND the
 * hole, which is most of why these read as circles on a drawing. The side
 * bite is flared far enough to reach the backs of both jaws, so between
 * them there is no straight rail edge left at all; at a corner the mouth
 * already eats most of the corner and the table's own outer edge is only
 * a fifth of a ball past it, so there the bite can only curve the edge a
 * little further round the hole. */
const CORNER_DEPTH = 0.7;
const SIDE_BITE = [
  [-1.6, -0.48],
  [1.6, -0.48],
  [2.72, 1.02],
  [2.0, 1.95],
  [-2.0, 1.95],
  [-2.72, 1.02],
];
const SIDE_BITE_ROUND = [0.5, 0.5, 0.45, 0.5, 0.5, 0.45];

function dist2(p, q) {
  return Math.hypot(q[0] - p[0], q[1] - p[1]);
}

/** A point `d` from `v` along the way to `t`. */
function toward(v, t, d) {
  const len = dist2(v, t) || 1;
  return [v[0] + ((t[0] - v[0]) / len) * d, v[1] + ((t[1] - v[1]) / len) * d];
}

/** A closed polygon with every corner rounded, sampled as points. */
function roundLoop(poly, radii, steps) {
  const n = poly.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i + n - 1) % n];
    const v = poly[i];
    const next = poly[(i + 1) % n];
    const r = Math.min(radii[i], dist2(prev, v) / 2, dist2(v, next) / 2);
    const s = toward(v, prev, r);
    const e = toward(v, next, r);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      pts.push([u * u * s[0] + 2 * u * t * v[0] + t * t * e[0], u * u * s[1] + 2 * u * t * v[1] + t * t * e[1]]);
    }
  }
  return pts;
}

/** The convex hull of two discs, as points: the small disc's cap pointing
 * out along (ux, uy), the two external tangents, and the large disc's cap
 * facing the cloth. */
function wedgeLoop(cx, cy, ux, uy, spec) {
  const R = BALL_RADIUS;
  const bx = cx - ux * spec.dBed * R;
  const by = cy - uy * spec.dBed * R;
  const tx = cx + ux * spec.dTip * R;
  const ty = cy + uy * spec.dTip * R;
  const d = (spec.dBed + spec.dTip) * R;
  const th = Math.acos(Math.max(-1, Math.min(1, ((spec.rBed - spec.rTip) * R) / d)));
  const base = Math.atan2(uy, ux);
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const A = base - th + (2 * th * i) / 14;
    pts.push([tx + spec.rTip * R * Math.cos(A), ty + spec.rTip * R * Math.sin(A)]);
  }
  for (let i = 0; i <= 26; i++) {
    const A = base + th + (2 * (Math.PI - th) * i) / 26;
    pts.push([bx + spec.rBed * R * Math.cos(A), by + spec.rBed * R * Math.sin(A)]);
  }
  return pts;
}

/** The six mouths and their shelves, in table metres. Geometry only — it
 * never changes, so it is built once. */
let mouthCache = null;
export function pocketMouths() {
  if (mouthCache) return mouthCache;
  const R = BALL_RADIUS;
  const len = TABLE_LENGTH;
  const wid = TABLE_WIDTH;
  const caps = {};
  for (const p of pocketsFor()) caps[p.id] = p;
  const list = [];
  for (const [id, X, Y] of [["tl", 0, 0], ["tr", len, 0], ["bl", 0, wid], ["br", len, wid]]) {
    const ix = X === 0 ? 1 : -1;
    const iy = Y === 0 ? 1 : -1;
    const cap = caps[id];
    list.push({
      id,
      corner: true,
      cx: cap.x,
      cy: cap.y,
      pr: cap.r,
      mouth: wedgeLoop(cap.x, cap.y, -ix / Math.SQRT2, -iy / Math.SQRT2, CORNER_WEDGE),
      bite: roundLoop(
        [
          [X + ix * (CORNER_MOUTH + CORNER_CUT), Y - iy * CUSH_M],
          [X + ix * (CORNER_MOUTH + CORNER_CUT), Y - iy * (CUSH_M + CORNER_DEPTH * R)],
          [X - ix * (CUSH_M + CORNER_DEPTH * R), Y - iy * (CUSH_M + CORNER_DEPTH * R)],
          [X - ix * (CUSH_M + CORNER_DEPTH * R), Y + iy * (CORNER_MOUTH + CORNER_CUT)],
          [X - ix * CUSH_M, Y + iy * (CORNER_MOUTH + CORNER_CUT)],
        ],
        [0.45 * R, 0.6 * R, 2.2 * R, 0.6 * R, 0.45 * R],
        7
      ),
      shelf: [
        [X + ix * CORNER_MOUTH, Y],
        [X + ix * (CORNER_MOUTH + CORNER_CUT), Y - iy * CUSH_M],
        [X - ix * CUSH_M, Y - iy * CUSH_M],
        [X - ix * CUSH_M, Y + iy * (CORNER_MOUTH + CORNER_CUT)],
        [X, Y + iy * CORNER_MOUTH],
      ],
    });
  }
  for (const [id, Y] of [["tm", 0], ["bm", wid]]) {
    const iy = Y === 0 ? 1 : -1;
    const cap = caps[id];
    const mx = len / 2;
    // (along the rail, outward) -> table metres. The along-rail axis is
    // the outward one turned a quarter, which mirrors the shape on the
    // bottom rail — harmless, it is symmetric about the rail's normal.
    const ux = 0;
    const uy = -iy;
    const vx = -uy;
    const vy = ux;
    const local = (pair) => pair.map(([al, t]) => [mx + vx * al * R + ux * t * R, Y + vy * al * R + uy * t * R]);
    list.push({
      id,
      corner: false,
      cx: cap.x,
      cy: cap.y,
      pr: cap.r,
      mouth: roundLoop(local(SIDE_TRAPEZOID), SIDE_ROUND.map((r) => r * R), 5),
      bite: roundLoop(local(SIDE_BITE), SIDE_BITE_ROUND.map((r) => r * R), 5),
      shelf: [
        [mx - SIDE_MOUTH, Y],
        [mx - SIDE_MOUTH - SIDE_CUT, Y - iy * CUSH_M],
        [mx + SIDE_MOUTH + SIDE_CUT, Y - iy * CUSH_M],
        [mx + SIDE_MOUTH, Y],
      ],
    });
  }
  mouthCache = list;
  return list;
}

/** The six runs of cushion, in table metres: one straight piece between
 * two mouths, with both ends cut back. The nose-line extents are
 * cushionsFor()'s segment extents, so the cushion a player sees ends
 * exactly where the cushion a ball bounces off ends. */
export function cushionRuns() {
  const len = TABLE_LENGTH;
  const wid = TABLE_WIDTH;
  const c = CUSH_M;
  const mc = CORNER_MOUTH;
  const ms = SIDE_MOUTH;
  const kc = CORNER_CUT;
  const ks = SIDE_CUT;
  return [
    [[mc, 0], [len / 2 - ms, 0], [len / 2 - ms - ks, -c], [mc + kc, -c]],
    [[len / 2 + ms, 0], [len - mc, 0], [len - mc - kc, -c], [len / 2 + ms + ks, -c]],
    [[mc, wid], [len / 2 - ms, wid], [len / 2 - ms - ks, wid + c], [mc + kc, wid + c]],
    [[len / 2 + ms, wid], [len - mc, wid], [len - mc - kc, wid + c], [len / 2 + ms + ks, wid + c]],
    [[0, mc], [0, wid - mc], [-c, wid - mc - kc], [-c, mc + kc]],
    [[len, mc], [len, wid - mc], [len + c, wid - mc - kc], [len + c, mc + kc]],
  ];
}

/** Trace a closed loop of table-metre points as a canvas path. `grow`
 * scales it about (gx, gy) in table space, which is how a line is made to
 * stop just OUTSIDE a mouth rather than exactly on its edge. */
function tracePx(ctx, L, pts, gx = 0, gy = 0, grow = 1) {
  for (let i = 0; i < pts.length; i++) {
    const tx = grow === 1 ? pts[i][0] : gx + (pts[i][0] - gx) * grow;
    const ty = grow === 1 ? pts[i][1] : gy + (pts[i][1] - gy) * grow;
    const q = toPx(L, tx, ty);
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  }
  ctx.closePath();
}

/**
 * Clip to everything EXCEPT the six mouths, so a surface or a line that
 * belongs to the wood or the cushion stops where the hole starts instead
 * of running behind it.
 *
 * `evenodd` with a full-canvas rectangle first: canvas has no boolean
 * subtract, so the outer rect and the mouths wind together and the fill
 * rule does the rest.
 */
function clipOutMouths(ctx, L, mouths, which = "mouth") {
  ctx.beginPath();
  ctx.rect(0, 0, L.width, L.height);
  for (const m of mouths) tracePx(ctx, L, m[which]);
  ctx.clip("evenodd");
}

/** Clip to the cushion itself — the six runs and nothing between them. */
function clipToRuns(ctx, L, runs) {
  ctx.beginPath();
  for (const run of runs) tracePx(ctx, L, run);
  ctx.clip();
}

/**
 * The pockets: the dark well and the leather rim that rings it, fitted to
 * the mouth shapes rather than to a circle.
 *
 * The rim is a blurred fill of the mouth's own outline rather than a ring
 * of gradient stops, because the mouths are not round and a radial
 * gradient around a wedge is thick at the tip and thin at the sides. A
 * blur follows whatever shape it is given, which is the whole reason the
 * rim can now be the same width all the way round a pocket.
 */
function drawPockets(ctx, L, railPx, mouths) {
  const R = BALL_RADIUS * L.scale;
  for (const m of mouths) {
    const c = toPx(L, m.cx, m.cy);
    const reach = m.pr * L.scale;
    ctx.save();
    // The rim, in two blurs: a wide soft one that reads as the shadow the
    // mouth casts into the wood, and a tight one that reads as the edge
    // of the leather.
    ctx.filter = `blur(${(R * 0.42).toFixed(2)}px)`;
    ctx.fillStyle = "#241708";
    ctx.beginPath();
    tracePx(ctx, L, m.mouth, m.cx, m.cy, 1.1);
    ctx.fill();
    ctx.filter = `blur(${(R * 0.14).toFixed(2)}px)`;
    ctx.fillStyle = "#120c06";
    ctx.beginPath();
    tracePx(ctx, L, m.mouth, m.cx, m.cy, 1.02);
    ctx.fill();
    ctx.filter = "none";
    // The well. Lit from the top left like everything else on the table,
    // so the near wall of the cavity is the lightest thing in it and the
    // hole still reads as a hole and not as a sticker.
    ctx.beginPath();
    tracePx(ctx, L, m.mouth);
    const g = ctx.createRadialGradient(c.x - reach * 0.22, c.y - reach * 0.26, 0, c.x, c.y, reach * 1.15);
    g.addColorStop(0, "#0a0705");
    g.addColorStop(0.55, "#060504");
    g.addColorStop(1, "#0f0a05");
    ctx.fillStyle = g;
    ctx.fill();
    // The lip: a leather edge, bright where it faces the lamp and lost in
    // shadow on the far side.
    const lip = ctx.createLinearGradient(c.x - reach, c.y - reach, c.x + reach, c.y + reach);
    lip.addColorStop(0, "rgba(150,120,78,0.55)");
    lip.addColorStop(0.45, "rgba(60,44,26,0.4)");
    lip.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.strokeStyle = lip;
    ctx.lineWidth = Math.max(1, railPx * 0.055);
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  }
}

/** Pocket centres in canvas px, with the reach of the drawn mouth. Kept
 * as the one place anything outside this file can ask where a pocket is. */
export function pocketsPx(L, world) {
  const list = world ? world.pockets : pocketsFor();
  return list.map((p) => {
    const q = toPx(L, p.x, p.y);
    return { id: p.id, x: q.x, y: q.y, r: p.r * L.scale * (p.corner ? 0.79 : 0.92), corner: p.corner };
  });
}

/** The head string (the kitchen's edge) and the foot spot. */
function drawSpots(ctx, L) {
  ctx.save();
  ctx.strokeStyle = COLORS.clothLine;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  const hs = toPx(L, HEAD_STRING, 0);
  const hs2 = toPx(L, HEAD_STRING, TABLE_WIDTH);
  ctx.beginPath();
  ctx.moveTo(hs.x, hs.y);
  ctx.lineTo(hs2.x, hs2.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const p = toPx(L, FOOT_SPOT.x, FOOT_SPOT.y);
  const r = Math.max(1.2, L.scale * 0.006);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.arc(p.x, p.y + r * 0.3, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#bfae8e";
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Sights: three along each long rail between the pockets, one along
 * each short rail — the diamonds a pool table is marked with. */
function drawSights(ctx, L, out, nose, wood) {
  const size = Math.max(2, wood * 0.2);
  const mid = wood * 0.5;
  const look = { seam: "rgba(24,12,4,0.55)", stops: ["#fffaf0", "#efe3cd", "#dcd3e2", "#c9bda6"], glint: "rgba(255,255,255,0.75)" };
  const put = (x, y) => paintSight(ctx, x, y, size, look);
  const longH = nose.w >= nose.h;
  const n = 8;
  for (let i = 1; i < n; i++) {
    if (i === n / 2) continue;
    const t = i / n;
    if (longH) {
      put(nose.x + t * nose.w, out.y + mid);
      put(nose.x + t * nose.w, out.y + out.h - mid);
    } else {
      put(out.x + mid, nose.y + t * nose.h);
      put(out.x + out.w - mid, nose.y + t * nose.h);
    }
  }
  for (const t of [0.25, 0.5, 0.75]) {
    if (longH) {
      put(out.x + mid, nose.y + t * nose.h);
      put(out.x + out.w - mid, nose.y + t * nose.h);
    } else {
      put(nose.x + t * nose.w, out.y + mid);
      put(nose.x + t * nose.w, out.y + out.h - mid);
    }
  }
}

/** A rounded-rectangle PATH (ctx.roundRect is too new to rely on). */
function roundRect(ctx, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/**
 * The balls. Shadows first, all of them, so a ball never casts onto its
 * neighbour; then the sprites. `sinking` is a list of {id, x, y, k}
 * (k = 0..1 progress) for balls animating into a pocket.
 */
export function drawBalls(ctx, L, balls, { sinking = [], dim = null } = {}) {
  const r = BALL_RADIUS * L.scale;
  const dpr = (ctx.getTransform ? ctx.getTransform().a : 0) || window.devicePixelRatio || 1;
  const px = Math.max(3, Math.round(r * dpr));
  const live = balls.filter((b) => !b.pocketed);

  ctx.save();
  for (const b of live) {
    const p = toPx(L, b.x, b.y);
    const cast = ctx.createRadialGradient(p.x + r * 0.3, p.y + r * 0.44, r * 0.25, p.x + r * 0.3, p.y + r * 0.44, r * 1.15);
    cast.addColorStop(0, "rgba(4,26,18,0.36)");
    cast.addColorStop(0.55, "rgba(4,26,18,0.15)");
    cast.addColorStop(1, "rgba(4,26,18,0)");
    ctx.fillStyle = cast;
    ctx.fillRect(p.x - r * 1.6, p.y - r * 1.6, r * 3.2, r * 3.2);
    const ao = ctx.createRadialGradient(p.x + r * 0.05, p.y + r * 0.12, 0, p.x + r * 0.05, p.y + r * 0.12, r * 0.88);
    ao.addColorStop(0, "rgba(2,18,12,0.55)");
    ao.addColorStop(0.62, "rgba(2,18,12,0.3)");
    ao.addColorStop(1, "rgba(2,18,12,0)");
    ctx.fillStyle = ao;
    ctx.fillRect(p.x - r * 1.2, p.y - r * 1.2, r * 2.4, r * 2.4);
  }
  ctx.restore();

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  for (const b of live) {
    const p = toPx(L, b.x, b.y);
    const sp = ballSprite(b.id, px, b.rot, L.rotated);
    const half = (r * sp.size) / (sp.R * 2);
    if (dim && dim(b)) ctx.globalAlpha = 0.55;
    ctx.drawImage(sp.canvas, p.x - half, p.y - half, half * 2, half * 2);
    ctx.globalAlpha = 1;
  }
  // Sinking: the ball shrinks into the pocket over a few frames. The
  // sinking record carries no orientation (main.js snapshots only the
  // position at the moment of capture), so `null` here means "whatever
  // this ball was last drawn as" rather than "upright" — a ball must not
  // snap its number straight up on the way into the pocket.
  for (const s of sinking) {
    const p = toPx(L, s.x, s.y);
    const sp = ballSprite(s.id, px, null, L.rotated);
    const k = 1 - s.k;
    const half = ((r * sp.size) / (sp.R * 2)) * (0.35 + 0.65 * k);
    ctx.globalAlpha = Math.max(0, k);
    ctx.drawImage(sp.canvas, p.x - half, p.y - half, half * 2, half * 2);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// --- the ball sprite -----------------------------------------------------
// Per-pixel shading (see four-ball's render.js for the full argument): the
// normal at (u, v) is (u, v, sqrt(1 - u^2 - v^2)) and every term below is
// one dot product off it, so the terminator, the rim and the highlight
// all agree.
//
// WHAT CHANGED WHEN THE BALLS STARTED ROLLING
//
// The markings used to be painted in SCREEN space: the stripe was the
// band |v| < 0.52 of the sprite and the number was canvas text at the
// middle of it. That is a decal on a disc, and it is why a ball crossing
// the cloth read as being SHOVED rather than rolling — the number faced
// the camera the whole way, which is something no ball has ever done.
//
// Now the markings live in the BALL'S OWN frame and the sprite asks the
// ball's orientation matrix where each screen pixel lands on that frame:
// the stripe is the band |local y| < 0.52, and the number sits in a disc
// around each local z pole (both poles — a real ball is numbered on both
// sides, and with only one the ball would go blank for half of every
// tumble). A pixel's local point is R-transpose times its screen normal,
// so the number foreshortens into an ellipse as it turns away and
// vanishes over the limb by itself, with no special case for either.
//
// AND WHY IT IS STILL AFFORDABLE ON A SEVEN-YEAR-OLD PHONE
//
// A rotating ball cannot be cached by `id@px` any more — every frame is a
// different picture. Re-running the shader for sixteen balls a frame was
// measured at roughly 11 ms on this container at phone resolution, which
// is most of a frame budget spent on lighting maths that had not changed.
//
// But the lighting DOESN'T change: every term in it (the lamp, the fill,
// the cloth bounce, the fresnel, both speculars) is a function of the
// SCREEN normal alone, and the screen normal at a given pixel of a given
// sprite size is fixed forever. Only which PAINT is under that pixel
// depends on the rotation. So the shader now runs once per sprite size
// into a bank of typed arrays, and once more per ball colour into a fully
// shaded LAYER; a frame is then a per-pixel choice between three finished
// layers — ball colour, white, and the number's ink — which is one 32-bit
// copy for most pixels. The lighting is bit-for-bit what it was; the
// per-frame work is the 3x3 transform and a branch.
//
// The three-layer trick works only because the shading is LINEAR in the
// albedo, which is also what lets the number's antialiased edge be a
// straight lerp between the white layer and the ink layer instead of a
// fourth pass.
const spriteCache = new Map();
/** The lamp, in screen space, pointing from the surface toward the light.
 * Up and to the left, and well off vertical — a light straight overhead
 * gives a sphere a bullseye instead of a face. */
const LAMP = norm3(-0.40, -0.52, 0.755);
/** The room: a dim fill from the opposite side, which stops the shadow
 * half from being a dead region and gives the second, smaller catchlight
 * every photograph of a billiard ball has.
 *
 * LOW AND WIDE, deliberately. The first version pointed it up at 0.72 in
 * z, and its highlight came out as a big soft smudge sitting in the
 * middle of the shadow side — a second lamp, not a reflection. A fill
 * light in a real room comes from the walls, so it grazes: dropping the z
 * to 0.48 pushes its catchlight out near the rim where a reflection of a
 * room belongs, and the exponent below makes it small. */
const FILL = norm3(0.72, 0.5, 0.48);
/** The cloth, straight up under the ball. Its bounce is the only GREEN in
 * a red ball, and leaving it out is what makes a ball look pasted onto a
 * photograph of a table rather than sitting on one. */
const BOUNCE = norm3(0.12, 0.34, 0.93);
const CLOTH_BOUNCE = [104, 196, 152];

function norm3(x, y, z) {
  const k = 1 / Math.hypot(x, y, z);
  return [x * k, y * k, z * k];
}
/** Halfway between a light and the eye, which is straight down (0,0,1).
 * Blinn's trick: the highlight is where the normal points at this. */
function halfway(l) {
  return norm3(l[0], l[1], l[2] + 1);
}
const LAMP_H = halfway(LAMP);
const FILL_H = halfway(FILL);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function ballColor(id) {
  const body = hexToRgb(colorOf(id));
  const dark = id === "8";
  const shadow = dark ? [40, 40, 44] : body.map((c) => Math.round(c * 0.58));
  const sheen = dark ? [200, 205, 215] : [255, 250, 240];
  return { body, shadow, sheen };
}
const WHITE = { body: [247, 244, 236], shadow: [156, 153, 145], sheen: [255, 255, 255] };
/** The printed number. Not flat black: the ink on a real ball is under
 * the same clear coat as everything else, so it takes the lamp's
 * highlight — which is exactly what stops the digit reading as a sticker
 * when it swings out toward the limb. */
const INK = { body: [26, 26, 28], shadow: [8, 8, 10], sheen: [205, 210, 220] };

/** The stripe: a band about the ball's own y axis. 0.52 is the sine of
 * the band's half-angle, i.e. the same number the old screen-space test
 * used, so a ball at rest is pixel-for-pixel what it was. */
const STRIPE_SIN = 0.52;
/** The number's disc has a projected radius of half the ball, so its rim
 * is where the local z component of the surface point falls to
 * sqrt(1 - 0.5^2). Testing lz rather than lx^2 + ly^2 is the same test
 * one multiply cheaper, and it covers both poles at once with an abs. */
const DISC_LZ = Math.sqrt(1 - 0.5 * 0.5);

function makeCanvas(w, h) {
  return typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });
}

// --- the rotation-independent half of the shader -------------------------

const bankCache = new Map();

/**
 * Everything about a sprite of this size that the ball's rotation cannot
 * change. Computed once and then shared by every ball on every frame.
 *
 * The pixel list is COMPACT — an index array of just the pixels inside
 * the silhouette — because a sprite is a circle in a square and about a
 * fifth of the square is corner that never gets drawn. Iterating the
 * compact list instead of testing alpha per pixel is a fifth off every
 * per-frame loop for free.
 *
 * `nu/nv/nn` is the normal RE-NORMALISED. The shading deliberately keeps
 * the raw (u, v, nz) — in the antialiased fringe just outside the
 * silhouette nz is clamped rather than solved, and changing that would
 * change the rim — but the texture lookup needs a genuine unit vector or
 * those fringe pixels would land off the sphere and pick the wrong paint.
 */
function shadeBank(R, size) {
  const key = `${R}x${size}`;
  const hit = bankCache.get(key);
  if (hit) return hit;

  const mid = size / 2;
  const idx = [];
  const A = [];
  const B = [];
  const T = [];
  const F = [];
  const AL = [];
  const NU = [];
  const NV = [];
  const NN = [];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5 - mid) / R;
      const v = (y + 0.5 - mid) / R;
      const d2 = u * u + v * v;
      if (d2 >= 1.16) continue;
      const d = Math.sqrt(d2);
      const alpha = 1 - smoothstep(1 - 1.1 / R, 1 + 0.4 / R, d);
      if (alpha <= 0) continue;
      const nz = Math.sqrt(Math.max(0.0025, 1 - Math.min(d2, 1)));

      const nl = u * LAMP[0] + v * LAMP[1] + nz * LAMP[2];
      const lam = clamp01((nl + 0.17) / 1.17) ** 1.5;
      const fill = clamp01(u * FILL[0] + v * FILL[1] + nz * FILL[2]) ** 2 * 0.22;
      const bnc = clamp01(u * BOUNCE[0] + v * BOUNCE[1] + nz * BOUNCE[2]) ** 2 * (1 - lam) * 0.5;
      const fres = (1 - nz) ** 2.0 * (0.3 + 0.7 * (1 - lam));
      const nh = clamp01(u * LAMP_H[0] + v * LAMP_H[1] + nz * LAMP_H[2]);
      const spec = nh ** 150 * 1.2 + nh ** 26 * 0.07;
      const nh2 = clamp01(u * FILL_H[0] + v * FILL_H[1] + nz * FILL_H[2]);
      const spec2 = nh2 ** 300 * 0.42;

      idx.push(y * size + x);
      A.push(clamp01(0.07 + lam * 0.98 + fill));
      B.push(bnc);
      T.push(1 - 0.18 * smoothstep(0.2, 1.0, d));
      F.push(fres * 0.26 + spec + spec2);
      AL.push(alpha * 255);
      const k = 1 / Math.sqrt(d2 + nz * nz);
      NU.push(u * k);
      NV.push(v * k);
      NN.push(nz * k);
    }
  }
  const bank = {
    n: idx.length,
    size,
    R,
    idx: Int32Array.from(idx),
    A: Float32Array.from(A),
    B: Float32Array.from(B),
    T: Float32Array.from(T),
    F: Float32Array.from(F),
    alpha: Uint8Array.from(AL),
    nu: Float32Array.from(NU),
    nv: Float32Array.from(NV),
    nn: Float32Array.from(NN),
    layers: new Map(),
    decals: new Map(),
  };
  bankCache.set(key, bank);
  if (bankCache.size > 4) bankCache.delete(bankCache.keys().next().value);
  return bank;
}

/**
 * One paint, shaded over the whole sprite, as finished RGBA. The bytes
 * and a 32-bit view of the same buffer, because most of a frame is
 * copying whole pixels and one word beats four bytes.
 */
function shadedLayer(bank, paint) {
  const { body, shadow, sheen } = paint;
  const bytes = new Uint8ClampedArray(bank.size * bank.size * 4);
  for (let k = 0; k < bank.n; k++) {
    const i = bank.idx[k] * 4;
    const a = bank.A[k];
    const b = bank.B[k];
    const t = bank.T[k];
    const f = bank.F[k];
    bytes[i] = (shadow[0] + (body[0] - shadow[0]) * a + CLOTH_BOUNCE[0] * b * 0.28) * t + sheen[0] * f;
    bytes[i + 1] = (shadow[1] + (body[1] - shadow[1]) * a + CLOTH_BOUNCE[1] * b * 0.34) * t + sheen[1] * f;
    bytes[i + 2] = (shadow[2] + (body[2] - shadow[2]) * a + CLOTH_BOUNCE[2] * b * 0.28) * t + sheen[2] * f;
    bytes[i + 3] = bank.alpha[k];
  }
  return { bytes, words: new Uint32Array(bytes.buffer) };
}

function layerFor(bank, name, paint) {
  let l = bank.layers.get(name);
  if (!l) {
    l = shadedLayer(bank, paint);
    bank.layers.set(name, l);
  }
  return l;
}

/**
 * The number, as a coverage map over the disc's own square.
 *
 * A texture rather than canvas text, because the glyph now has to be
 * sampled through the rotation: the disc is a spherical cap, and its
 * image on screen is not an affine squash of a circle that ctx.transform
 * could produce. Sampling coverage per pixel gets the foreshortening,
 * the rim and the disappearance over the limb from the same three lines
 * that get the stripe.
 *
 * Coverage only — no colour — because the ink is one flat paint and the
 * shading is applied afterwards out of the layers.
 */
function decalFor(bank, id) {
  let d = bank.decals.get(id);
  if (d) return d;
  // The disc spans half the ball, so its diameter on screen is about R
  // device pixels at most; a texture a little over that is past the point
  // where more resolution is visible, and it is only ever minified.
  const N = Math.max(24, Math.min(128, Math.round(bank.R * 1.25)));
  const c = makeCanvas(N, N);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.clearRect(0, 0, N, N);
  g.fillStyle = "#000";
  // Same proportions the old canvas text used: the font was R * 0.72 on a
  // disc of radius R * 0.5, so in disc-diameters it is 0.72 and 0.62.
  const fs = N * (id.length > 1 ? 0.62 : 0.72);
  g.font = `700 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(id, N / 2, N / 2 + fs * 0.06);
  const px = g.getImageData(0, 0, N, N).data;
  const cov = new Uint8Array(N * N);
  for (let i = 0; i < cov.length; i++) cov[i] = px[i * 4 + 3];
  d = { cov, N };
  bank.decals.set(id, d);
  return d;
}

// --- the per-frame composite ---------------------------------------------

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * The table frame the physics integrates in is x along the table, y
 * across it and z up out of the cloth; the screen frame is x right, y
 * DOWN and z out of the glass. On a landscape table those coincide, and
 * on a portrait one (layout.js stands the table up, long axis vertical)
 * screen x is table y and screen y is minus table x.
 *
 * What the shader wants is the orientation expressed in SCREEN axes,
 * which is S * rot * S-transpose — the ordinary change of basis. Doing it
 * this way rather than leaving the matrix in table axes is what keeps a
 * ball AT REST looking exactly as it did: identity in, identity out, so
 * the stripe is still level and the number still upright whichever way
 * the table is standing.
 *
 * Returned transposed, because every pixel wants local = M-transpose * n.
 */
function screenBasisTranspose(rot, rotated, out) {
  if (!rotated) {
    out[0] = rot[0]; out[1] = rot[3]; out[2] = rot[6];
    out[3] = rot[1]; out[4] = rot[4]; out[5] = rot[7];
    out[6] = rot[2]; out[7] = rot[5]; out[8] = rot[8];
    return out;
  }
  // S = [[0,1,0],[-1,0,0],[0,0,1]]. Writing out S*rot*S^T by hand costs
  // nothing at runtime and avoids two matrix products per ball per frame.
  const m0 = rot[4], m1 = -rot[3], m2 = rot[5];
  const m3 = -rot[1], m4 = rot[0], m5 = -rot[2];
  const m6 = rot[7], m7 = -rot[6], m8 = rot[8];
  out[0] = m0; out[1] = m3; out[2] = m6;
  out[3] = m1; out[4] = m4; out[5] = m7;
  out[6] = m2; out[7] = m5; out[8] = m8;
  return out;
}

function sameRot(a, b) {
  for (let i = 0; i < 9; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Render one ball to an offscreen canvas, shaded per pixel and painted
 * through its orientation. `px` is the radius in DEVICE pixels; the
 * sprite is built at SS times that and drawn back down, which is where
 * the smooth silhouette comes from.
 *
 * `rot` may be null, meaning "leave whatever is cached alone" — the
 * sinking animation has no orientation to offer and must not reset one.
 *
 * THE CACHE IS THE PERFORMANCE STORY. A ball whose matrix has not moved
 * since the last frame is not redrawn at all, and a matrix only moves
 * while the ball is turning; the aiming phase, which is most of the
 * wall-clock of a game of pool, costs nothing here at all.
 */
function ballSprite(id, px, rot, rotated = false, upright = false) {
  const SS = 2;
  const key = upright ? `${id}@${px}@u` : `${id}@${px}`;
  let e = spriteCache.get(key);

  if (!e) {
    const R = Math.max(3, Math.round(px * SS));
    const size = R * 2 + 2;
    const c = makeCanvas(size, size);
    const g = c.getContext("2d");
    const img = g.createImageData(size, size);
    e = {
      canvas: c,
      g,
      img,
      out: img.data,
      out32: new Uint32Array(img.data.buffer),
      size,
      R,
      bank: shadeBank(R, size),
      rot: null,
      rotated: null,
    };
    spriteCache.set(key, e);
    if (spriteCache.size > 40) {
      for (const k of [...spriteCache.keys()].slice(0, 16)) spriteCache.delete(k);
    }
  }

  const want = rot || e.rot || IDENTITY;
  if (e.rot && e.rotated === rotated && sameRot(e.rot, want)) return e;
  e.rot = want.slice();
  e.rotated = rotated;
  paintBall(e, id, want, rotated);
  return e;
}

const MT = new Float64Array(9);

function paintBall(e, id, rot, rotated) {
  const bank = e.bank;
  const out32 = e.out32;
  const out = e.out;
  const isCue = id === CUE_ID;
  const white = layerFor(bank, "white", WHITE);

  if (isCue) {
    // A cue ball carries no markings, so its picture is the same however
    // it is turning. One copy of the white layer and we are done — and
    // the cache above then never asks again.
    out32.set(white.words);
    e.g.putImageData(e.img, 0, 0);
    return;
  }

  const col = layerFor(bank, id, ballColor(id));
  const ink = layerFor(bank, "ink", INK);
  const decal = decalFor(bank, id);
  const striped = isStripe(id);
  const cov = decal.cov;
  const N = decal.N;

  const m = screenBasisTranspose(rot, rotated, MT);
  const m0 = m[0], m1 = m[1], m2 = m[2];
  const m3 = m[3], m4 = m[4], m5 = m[5];
  const m6 = m[6], m7 = m[7], m8 = m[8];

  const colW = col.words;
  const whiteW = white.words;
  const whiteB = white.bytes;
  const inkB = ink.bytes;
  const nu = bank.nu;
  const nv = bank.nv;
  const nn = bank.nn;
  const idx = bank.idx;

  for (let k = 0; k < bank.n; k++) {
    const i = idx[k];
    const u = nu[k];
    const v = nv[k];
    const w = nn[k];
    const lz = m6 * u + m7 * v + m8 * w;

    if (lz >= DISC_LZ || lz <= -DISC_LZ) {
      const lx = m0 * u + m1 * v + m2 * w;
      const ly = m3 * u + m4 * v + m5 * w;
      // The far pole's disc is printed the other way round, exactly as it
      // is on a real ball, so that BOTH numbers read forwards when they
      // come round to face you. Mirroring in x is what does that.
      const tx = lz >= 0 ? lx : -lx;
      let cx = ((tx + 0.5) * N) | 0;
      let cy = ((ly + 0.5) * N) | 0;
      if (cx < 0) cx = 0; else if (cx >= N) cx = N - 1;
      if (cy < 0) cy = 0; else if (cy >= N) cy = N - 1;
      const a = cov[cy * N + cx];
      if (a === 0) {
        out32[i] = whiteW[i];
      } else if (a === 255) {
        const o = i * 4;
        out[o] = inkB[o];
        out[o + 1] = inkB[o + 1];
        out[o + 2] = inkB[o + 2];
        out[o + 3] = inkB[o + 3];
      } else {
        // The glyph's antialiased edge. Because the shading is linear in
        // the albedo, mixing the two FINISHED layers is identical to
        // shading the mixed albedo, so the edge stays soft without a
        // fourth pass.
        const t = a / 255;
        const o = i * 4;
        const wr = whiteB[o], wg = whiteB[o + 1], wb = whiteB[o + 2];
        out[o] = wr + (inkB[o] - wr) * t;
        out[o + 1] = wg + (inkB[o + 1] - wg) * t;
        out[o + 2] = wb + (inkB[o + 2] - wb) * t;
        out[o + 3] = whiteB[o + 3];
      }
    } else if (striped) {
      const ly = m3 * u + m4 * v + m5 * w;
      out32[i] = ly > STRIPE_SIN || ly < -STRIPE_SIN ? whiteW[i] : colW[i];
    } else {
      out32[i] = colW[i];
    }
  }
  e.g.putImageData(e.img, 0, 0);
}

/** A ball drawn on its own, for the tray. Returns a data URL-free canvas
 * blit: the caller passes a 2D context and a centre.
 *
 * Upright on purpose, and on its own cache key so it can never fight with
 * the same ball turning on the cloth: the tray is a row of icons telling
 * you which balls are down, and an icon that has to be read at a glance
 * should not be showing you the back of the 9. */
export function drawBallAt(ctx, id, cx, cy, r) {
  const dpr = (ctx.getTransform ? ctx.getTransform().a : 0) || 1;
  const sp = ballSprite(id, Math.max(3, Math.round(r * dpr)), IDENTITY, false, true);
  const half = (r * sp.size) / (sp.R * 2);
  ctx.drawImage(sp.canvas, cx - half, cy - half, half * 2, half * 2);
}

/**
 * The aiming aid: the cue line, where it first meets something, and which
 * way that something will leave. A RAY CAST, not a run of the simulator:
 * a straight line to first contact plus the line of centres is what a
 * player can already see from the table; it removes the eyestrain, not
 * the skill.
 */
export function computeAim(world, cue, dirX, dirY) {
  const len = Math.hypot(dirX, dirY);
  if (len === 0) return null;
  const nx = dirX / len;
  const ny = dirY / len;
  const R = BALL_RADIUS;

  let bestT = Infinity;
  let target = null;
  for (const b of world.balls) {
    if (b === cue || b.pocketed) continue;
    const px = b.x - cue.x;
    const py = b.y - cue.y;
    const proj = px * nx + py * ny;
    if (proj <= 0) continue;
    const perp2 = px * px + py * py - proj * proj;
    const rr = (2 * R) * (2 * R);
    if (perp2 > rr) continue;
    const t = proj - Math.sqrt(rr - perp2);
    if (t > 0 && t < bestT) {
      bestT = t;
      target = b;
    }
  }
  let wallT = Infinity;
  if (nx > 0) wallT = Math.min(wallT, (world.length - R - cue.x) / nx);
  if (nx < 0) wallT = Math.min(wallT, (R - cue.x) / nx);
  if (ny > 0) wallT = Math.min(wallT, (world.width - R - cue.y) / ny);
  if (ny < 0) wallT = Math.min(wallT, (R - cue.y) / ny);

  if (target && bestT < wallT) {
    const gx = cue.x + nx * bestT;
    const gy = cue.y + ny * bestT;
    const ox = target.x - gx;
    const oy = target.y - gy;
    const ol = Math.hypot(ox, oy) || 1;
    return { hit: { x: gx, y: gy }, target, objDir: { x: ox / ol, y: oy / ol } };
  }
  return { hit: { x: cue.x + nx * Math.max(0, wallT), y: cue.y + ny * Math.max(0, wallT) }, target: null, objDir: null };
}

/** The guide: cue-ball line, ghost ball, and the object ball's line. */
export function drawAim(ctx, L, cue, aim, { legal = true } = {}) {
  if (!aim) return;
  const r = BALL_RADIUS * L.scale;
  const from = toPx(L, cue.x, cue.y);
  const to = toPx(L, aim.hit.x, aim.hit.y);

  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(3, r * 0.3);
  ctx.setLineDash([r * 0.5, r * 0.45]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);

  if (aim.target) {
    ctx.strokeStyle = legal ? "rgba(255,255,255,0.9)" : "rgba(255,120,110,0.95)";
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.beginPath();
    ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
    ctx.stroke();
    const d = dirToScreen(L, aim.objDir.x, aim.objDir.y);
    const tp = toPx(L, aim.target.x, aim.target.y);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(3, r * 0.3);
    ctx.beginPath();
    ctx.moveTo(tp.x, tp.y);
    ctx.lineTo(tp.x + d.x * r * 5, tp.y + d.y * r * 5);
    ctx.stroke();
    ctx.strokeStyle = legal ? "rgba(255,220,140,0.95)" : "rgba(255,120,110,0.95)";
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.beginPath();
    ctx.moveTo(tp.x, tp.y);
    ctx.lineTo(tp.x + d.x * r * 5, tp.y + d.y * r * 5);
    ctx.stroke();
  }
  ctx.restore();
}

/** The ghost cue ball while the player is choosing where to put it. */
export function drawGhost(ctx, L, x, y, ok) {
  const r = BALL_RADIUS * L.scale;
  const p = toPx(L, x, y);
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = ok ? "rgba(255,255,255,0.5)" : "rgba(255,120,110,0.45)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ok ? "#ffffff" : "#ff7a6e";
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.setLineDash([r * 0.4, r * 0.3]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 1.35, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** A gold ring around a ball (the Hint's target). */
export function drawRing(ctx, L, x, y, phase = 0) {
  const r = BALL_RADIUS * L.scale;
  const p = toPx(L, x, y);
  ctx.save();
  ctx.strokeStyle = "#f2b705";
  ctx.lineWidth = Math.max(2, r * 0.2);
  ctx.globalAlpha = 0.7 + 0.3 * Math.sin(phase);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 1.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** The kitchen, shaded, while the cue ball must go behind the line. */
export function drawKitchen(ctx, L) {
  const a = toPx(L, 0, 0);
  const b = toPx(L, HEAD_STRING, TABLE_WIDTH);
  ctx.save();
  // The status line calls this "the lighter area", so it has to actually
  // read as one at arm's length on a phone in daylight. 0.09 did not.
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * A tapered length of round stock, lit from one side.
 *
 * Everything on a cue is this shape, which is why it is a helper: the
 * gradient runs ACROSS the piece, not along it, and that is the whole
 * trick. A flat stroke is a stick drawn on paper; the same stroke with a
 * dark edge, a bright line a third of the way in, and a darker far edge
 * is a cylinder. Nothing else in this function matters as much.
 */
function cylinder(ctx, x1, y1, x2, y2, r1, r2, stops) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(x1 + nx * r1, y1 + ny * r1);
  ctx.lineTo(x2 + nx * r2, y2 + ny * r2);
  ctx.lineTo(x2 - nx * r2, y2 - ny * r2);
  ctx.lineTo(x1 - nx * r1, y1 - ny * r1);
  ctx.closePath();
  const m = Math.max(r1, r2);
  const g = ctx.createLinearGradient(x1 + nx * m, y1 + ny * m, x1 - nx * m, y1 - ny * m);
  for (const [t, c] of stops) g.addColorStop(t, c);
  ctx.fillStyle = g;
  ctx.fill();
}

/** The cue's materials, each an across-the-barrel gradient. */
export const CUE = {
  shaft: [[0, "#8a6a3e"], [0.16, "#e8cfa2"], [0.34, "#fbf0d8"], [0.62, "#dcc094"], [1, "#7d5e35"]],
  butt: [[0, "#1b0d07"], [0.18, "#5c2d18"], [0.34, "#8a4526"], [0.62, "#4a2413"], [1, "#160a05"]],
  wrap: [[0, "#12100e"], [0.2, "#3a352f"], [0.36, "#565049"], [0.62, "#2c2823"], [1, "#0e0c0a"]],
  collar: [[0, "#6b5320"], [0.3, "#d8b45c"], [0.5, "#f4e3ac"], [0.75, "#a8873c"], [1, "#4a3814"]],
  ferrule: [[0, "#b9ac96"], [0.3, "#f7f3e8"], [0.6, "#efe8d8"], [1, "#9a927f"]],
  tip: [[0, "#123a5c"], [0.35, "#2f6ea8"], [0.7, "#2a5f92"], [1, "#0d2942"]],
  grain: "#7a5a32",
};

export function drawCue(ctx, L, ball, dirX, dirY, power, side = 0) {
  const len = Math.hypot(dirX, dirY);
  if (len === 0) return;
  const r = BALL_RADIUS * L.scale;
  const d = dirToScreen(L, dirX / len, dirY / len);
  const bx = -d.x;
  const by = -d.y;
  const tx = -d.y;
  const ty = d.x;
  const across = (side / (0.5 * BALL_RADIUS)) * r * 0.5;

  // A real cue is 1.45m long against a table 1.5m long, which drawn in
  // full runs the whole cloth and reads as a plank across the picture.
  // 0.6m keeps the proportion believable while leaving the table visible
  // — the same compromise every billiards game makes.
  const cueLen = 0.6 * L.scale;
  // The draw-back distance tracks the PULL, not the power — the hand's
  // travel, not what it bought. This is the change that makes power
  // legible. Against the old power * 3.6, the whole 22-45% band that
  // every stage solution lives in moved the cue five pixels: the player
  // was choosing a speed with no feedback at all. Against the pull it
  // moves about thirty, because the pull is what their thumb is doing.
  const pull = pullForPower(power);
  // How far the cue is drawn back. It tracks the PULL, not the power —
  // the hand's travel, not what it bought — which is what makes power
  // legible at a glance. Just over 4 radii at full pull rather than four-ball's 12:
  // this table is 25 ball diameters long instead of 39, so twelve radii
  // put the tip off the canvas entirely whenever the cue ball was near a
  // rail, and at the break it always is.
  const gap = r * (1.15 + pull * 3.2);
  const p = toPx(L, ball.x, ball.y);
  const ox = p.x + bx * gap + tx * across;
  const oy = p.y + by * gap + ty * across;
  // Real proportions against the ball: 13mm tip, 30mm butt, 61.5mm ball.
  const rTip = r * 0.21;
  const rMid = r * 0.33;
  const rButt = r * 0.49;
  const at = (t) => [ox + bx * cueLen * t, oy + by * cueLen * t];
  const rad = (t) => rTip + (rButt - rTip) * Math.min(1, t / 0.92);

  ctx.save();
  // NOT clipped to the table.
  //
  // It used to be, clipped to the outside of the wooden frame, on the
  // theory that a stick running out over the page background looks
  // broken. What actually looks broken is a stick that stops in mid-air
  // along a straight edge, and that is what the clip produced every time
  // the cue ball sat near a rail — which is most of a billiards game. The
  // stroke room playMargin() reserves is real space around the table and
  // the cue is allowed to use it. The canvas edge is the only clip, the
  // controls are drawn after this and paint over anything that reaches
  // their strip, and a butt hanging off the bottom of the screen is
  // exactly what it looks like when you hold a cue.

  // Shadow, offset toward the cloth and blurred, so the cue floats above
  // the table the way the balls do rather than looking painted on. The
  // first version was a hard black copy at a third alpha and read as a
  // second, darker cue — a shadow with the same edge as its object is not
  // a shadow, it is a duplicate.
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.filter = `blur(${(r * 0.22).toFixed(1)}px)`;
  const s0 = at(0);
  const s1 = at(1);
  cylinder(
    ctx,
    s0[0] + r * 0.3,
    s0[1] + r * 0.46,
    s1[0] + r * 0.3,
    s1[1] + r * 0.46,
    rTip * 1.15,
    rButt * 1.15,
    [[0, "#000"], [1, "#000"]]
  );
  ctx.restore();

  // The pieces, tip first.
  const seg = (t0, t1, stops) => {
    const [x0, y0] = at(t0);
    const [x1, y1] = at(t1);
    cylinder(ctx, x0, y0, x1, y1, rad(t0), rad(t1), stops);
  };

  seg(0.05, 0.52, CUE.shaft);
  // shaft grain: a few fine lines along the maple, the one detail that
  // stops it being a cream tube
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = CUE.grain;
  ctx.lineWidth = 1;
  for (const k of [-0.45, -0.1, 0.25, 0.6]) {
    const [gx0, gy0] = at(0.07);
    const [gx1, gy1] = at(0.5);
    ctx.beginPath();
    ctx.moveTo(gx0 + tx * rad(0.07) * k, gy0 + ty * rad(0.07) * k);
    ctx.lineTo(gx1 + tx * rad(0.5) * k, gy1 + ty * rad(0.5) * k);
    ctx.stroke();
  }
  ctx.restore();

  seg(0.52, 0.56, CUE.collar); // the joint
  seg(0.56, 0.71, CUE.butt); // forearm
  seg(0.71, 0.73, CUE.collar); // the ring above the wrap
  seg(0.73, 0.88, CUE.wrap); // Irish linen
  // the wrap's cross-hatch
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = "#0a0908";
  ctx.lineWidth = 1;
  const turns = Math.max(6, Math.round(cueLen * 0.15 * 0.2));
  for (let i = 0; i <= turns; i++) {
    const t = 0.73 + (0.15 * i) / turns;
    const [wx, wy] = at(t);
    const rr = rad(t);
    ctx.beginPath();
    ctx.moveTo(wx + tx * rr, wy + ty * rr);
    ctx.lineTo(wx - tx * rr + bx * rr * 0.9, wy - ty * rr + by * rr * 0.9);
    ctx.stroke();
  }
  ctx.restore();
  seg(0.88, 0.9, CUE.collar);
  seg(0.9, 0.985, CUE.butt);
  seg(0.985, 1, [[0, "#0a0a0a"], [0.4, "#2a2a2a"], [1, "#050505"]]); // bumper

  // Ferrule and tip: the two centimetres the player is actually aiming.
  seg(0.012, 0.05, CUE.ferrule);
  seg(0, 0.012, CUE.tip);

  // One long specular down the lit side, which is what says "lacquer".
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = Math.max(1, r * 0.07);
  const [hx0, hy0] = at(0.06);
  const [hx1, hy1] = at(0.97);
  ctx.beginPath();
  ctx.moveTo(hx0 + tx * rad(0.06) * 0.42, hy0 + ty * rad(0.06) * 0.42);
  ctx.lineTo(hx1 + tx * rad(0.97) * 0.42, hy1 + ty * rad(0.97) * 0.42);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}
/**
 * The previewed path.
 *
 * Drawn in two halves, and the split is the honest part. The line is
 * solid up to the cue ball's first contact and dashed after it, because
 * the maths is exact on both sides but the two halves are not the same
 * kind of knowledge: before the contact the player could have worked it
 * out themselves, and after it they could not. The dashes say "this is
 * the part you are buying", not "this part is a guess".
 *
 * Deliberately cold and thin. It is an overlay on a table, not a thing on
 * the table — a fat glowing tube would compete with the balls, which are
 * the objects that actually have to be read.
 */
export function drawPreview(ctx, L, path) {
  if (!path || path.points.length < 2) return;
  const r = BALL_RADIUS * L.scale;
  const at = (i) => toPx(L, path.points[i].x, path.points[i].y);
  const trace = (from, to) => {
    ctx.beginPath();
    const p0 = at(from);
    ctx.moveTo(p0.x, p0.y);
    for (let i = from + 1; i <= to; i++) {
      const p = at(i);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  };

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // A dark under-stroke so the line survives on pale cloth as well as
  // in shadow. Cheaper and more reliable than a glow.
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(2.5, r * 0.42);
  trace(0, path.points.length - 1);

  const split = Math.max(1, Math.min(path.contactAt, path.points.length - 1));
  ctx.strokeStyle = "rgba(150,235,255,0.95)";
  ctx.lineWidth = Math.max(1.5, r * 0.22);
  ctx.setLineDash([]);
  trace(0, split);

  ctx.strokeStyle = "rgba(150,235,255,0.72)";
  ctx.setLineDash([r * 0.55, r * 0.5]);
  trace(split, path.points.length - 1);
  ctx.setLineDash([]);

  // Where it comes to rest, so the player can see the position they are
  // leaving themselves as well as the point they are trying to make.
  const end = at(path.points.length - 1);
  ctx.strokeStyle = "rgba(150,235,255,0.8)";
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath();
  ctx.arc(end.x, end.y, r * 0.95, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
