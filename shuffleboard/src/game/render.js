// game/render.js
// Canvas drawing only. Reads world + layout, never mutates either.
//
// THE BOARD IS THE COVER. The series' single most expensive lesson
// (Daily Five, CTR 1.0%) is that a dark playfield disappears into the
// portal's dark grid; StoneFlick's bright wood measured 5.47:1 against
// it and passed. So the maple here is BRIGHT — the store cover will be
// this same renderer's output, and the first screen must be the picture
// the thumbnail promised. test/browser-check.mjs pins the board centre
// above 140/255 at runtime; every tone below was chosen under that pin.
//
// PREMIUM PASS (2026-09-02). The texture stack follows the series'
// frequency rule — coarse -> fine, the finest layer sells the material,
// every layer's contrast capped below the point where it competes with
// the weights:
//   maple:  stave tone blocks -> cathedral figure -> seams (3D: dark
//           joint + light lip) -> long grain -> fine grain -> wax dust
//           and silicone wax beads -> lamp sheen pools -> lacquer lip
//   walnut: four mitred rail boards (each grained along its OWN axis —
//           Four Ball's mitre lesson), crowned profile, inner bevel,
//           brass corner roses
//   gutter: a real recess — the board casts a shadow into it
//   pucks:  machined steel with turned grooves, inset cap with bevel
//           and specular, double contact shadow
// The whole table still paints ONCE into an offscreen canvas per size;
// per frame it is one drawImage plus the weights and UI.

import * as P from "./physics.js";
import { puckValue, isHanger } from "./rules.js";

export const COLORS = {
  page: "#171310",
  railHi: "#7a5336",
  railMid: "#5a3c25",
  railLo: "#3c2817",
  brass: "#b5964f",
  gutter: "#241a12",
  mapleLo: "#d8ae6b",
  mapleMid: "#e7c488",
  mapleHi: "#f2d89f",
  paint: "#4c3320",
};

export const PUCK_COLORS = [
  { cap: "#c53a2e", capHi: "#e2604f", capLo: "#8f241b", name: "red" }, // player
  { cap: "#2b5cb8", capHi: "#5581d6", capLo: "#1d3f85", name: "blue" }, // AI
];

// --- deterministic noise ---------------------------------------------------

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- table cache -----------------------------------------------------------

let cache = null; // { key, canvas }
let floorCache = null; // { key, canvas }

export function invalidateTable() {
  cache = null;
  floorCache = null;
}

/**
 * The room the table stands in. Landscape leaves ~40% of the canvas
 * empty around a 4.7:1 board; flat near-black there read as "unfinished"
 * (roadmap Phase B). Old tavern floorboards, a warm pool of lamplight
 * around the table, a vignette, and a soft shadow under the table make
 * the empty space read as a place — while staying well below the
 * table's brightness so the maple keeps owning the frame.
 */
function floorCanvas(layout, width, height, dpr) {
  const key = `${Math.round(width * dpr)}x${Math.round(height * dpr)}`;
  if (floorCache && floorCache.key === key) return floorCache.canvas;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width * dpr));
  c.height = Math.max(1, Math.round(height * dpr));
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#161110";
  ctx.fillRect(0, 0, width, height);
  // Floorboards: rows across the screen, uneven joints, per-plank tone.
  const rng = makeRng(97);
  const rowH = Math.max(26, Math.min(44, height / 18));
  for (let y = 0, row = 0; y < height; y += rowH, row++) {
    // Each row is split into planks by staggered butt joints, and each
    // plank carries its own tone — old floors are never one colour.
    const joints = [0];
    let x = -rng() * 200;
    while (x < width) {
      x += 170 + rng() * 260;
      joints.push(Math.min(x, width));
    }
    joints.push(width);
    for (let j = 0; j < joints.length - 1; j++) {
      const px = joints[j];
      const pw = joints[j + 1] - px;
      if (pw <= 0) continue;
      const warm = rng();
      ctx.fillStyle = `rgba(${56 + warm * 26}, ${38 + warm * 15}, ${22 + warm * 10}, ${0.16 + rng() * 0.1})`;
      ctx.fillRect(px, y, pw, rowH);
    }
    // Row seam: dark joint with a faint worn lip below it.
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, y, width, 1);
    ctx.fillStyle = "rgba(214,170,120,0.05)";
    ctx.fillRect(0, y + 1, width, 1);
    for (let j = 1; j < joints.length - 1; j++) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(joints[j], y + 1, 1, rowH - 1);
    }
    // A few grain streaks per row.
    for (let g = 0; g < width / 220; g++) {
      const gx = rng() * width;
      const gy = y + 3 + rng() * (rowH - 6);
      ctx.strokeStyle = `rgba(0,0,0,${0.09 + rng() * 0.12})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.bezierCurveTo(gx + 30, gy + 1, gx + 60, gy - 1, gx + 80 + rng() * 60, gy);
      ctx.stroke();
    }
  }
  const t = layout.tableRect;
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  // The lamp over the table warms the boards around it before the
  // corners fall away — the floor's own frequency-rule "coarse" layer.
  const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(t.w, t.h) * 0.85);
  pool.addColorStop(0, "rgba(255,190,120,0.085)");
  pool.addColorStop(0.6, "rgba(255,180,110,0.035)");
  pool.addColorStop(1, "rgba(255,180,110,0)");
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, width, height);
  // Vignette: the light is over the table, not the corners.
  const rad = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
  const vig = ctx.createRadialGradient(cx, cy, rad * 0.35, cx, cy, rad);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.46)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, width, height);
  // Soft shadow under the table: widening translucent plates — no
  // ctx.filter, which older Safari does not give canvases.
  for (const [grow, a] of [[22, 0.08], [14, 0.11], [8, 0.15], [3, 0.2]]) {
    roundRect(ctx, t.x - grow, t.y - grow + 7, t.w + grow * 2, t.h + grow * 2, 18 + grow);
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fill();
  }
  floorCache = { key, canvas: c };
  return c;
}

/** Paint the whole table (rails, gutters, surface, painted lines) into an
 * offscreen canvas at device resolution, once per size/orientation. */
function tableCanvas(layout, dpr) {
  const key = `${layout.orient}:${Math.round(layout.tableRect.w * dpr)}x${Math.round(layout.tableRect.h * dpr)}`;
  if (cache && cache.key === key) return cache.canvas;
  const t = layout.tableRect;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(t.w * dpr));
  c.height = Math.max(1, Math.round(t.h * dpr));
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.translate(-t.x, -t.y);
  paintTable(ctx, layout);
  cache = { key, canvas: c };
  return c;
}

function paintTable(ctx, layout) {
  const t = layout.tableRect;
  const b = layout.boardRect;
  const long = layout.orient === "portrait" ? "v" : "h"; // board's long axis on screen
  const g = layout.railPx;
  const outerR = Math.min(14, g * 1.6);

  paintRails(ctx, layout, long, g, outerR);

  // Gutter: a recess between rail and surface.
  roundRect(ctx, t.x + g, t.y + g, t.w - g * 2, t.h - g * 2, 8);
  ctx.fillStyle = COLORS.gutter;
  ctx.fill();
  ctx.save();
  roundRect(ctx, t.x + g, t.y + g, t.w - g * 2, t.h - g * 2, 8);
  ctx.clip();
  // The recess floor is wood too: faint grain running the long way, a
  // wall shadow at the rail side, and lamp light grazing the middle —
  // at desktop widths a flat black band here read as a void.
  grain(ctx, { x: t.x + g, y: t.y + g, w: t.w - g * 2, h: t.h - g * 2 }, long, 53, 0.06, 0.8, "walnut");
  const gw = Math.max(6, (long === "v" ? b.x - (t.x + g) : b.y - (t.y + g)));
  // Four per-side bands: dark at the rail wall, a breath of warm lamp
  // light before the board's own cast shadow takes over.
  for (const side of ["top", "bottom", "left", "right"]) {
    let gradient;
    if (side === "top") gradient = ctx.createLinearGradient(0, t.y + g, 0, t.y + g + gw);
    else if (side === "bottom") gradient = ctx.createLinearGradient(0, t.y + t.h - g, 0, t.y + t.h - g - gw);
    else if (side === "left") gradient = ctx.createLinearGradient(t.x + g, 0, t.x + g + gw, 0);
    else gradient = ctx.createLinearGradient(t.x + t.w - g, 0, t.x + t.w - g - gw, 0);
    gradient.addColorStop(0, "rgba(0,0,0,0.5)");
    gradient.addColorStop(0.4, "rgba(0,0,0,0.12)");
    gradient.addColorStop(0.75, "rgba(214,170,110,0.05)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    if (side === "top") ctx.fillRect(t.x + g, t.y + g, t.w - g * 2, gw);
    else if (side === "bottom") ctx.fillRect(t.x + g, t.y + t.h - g - gw, t.w - g * 2, gw);
    else if (side === "left") ctx.fillRect(t.x + g, t.y + g, gw, t.h - g * 2);
    else ctx.fillRect(t.x + t.w - g - gw, t.y + g, gw, t.h - g * 2);
  }
  const dustRng = makeRng(53);
  for (let i = 0; i < (t.w + t.h) / 4; i++) {
    ctx.fillStyle = `rgba(200,168,124,${0.025 + dustRng() * 0.05})`;
    ctx.fillRect(t.x + g + dustRng() * (t.w - g * 2), t.y + g + dustRng() * (t.h - g * 2), 1, 1);
  }
  ctx.restore();

  paintSurface(ctx, layout, b, long);

  // The board stands proud of the gutter: it casts a shadow onto the
  // gutter floor and carries a bright lacquered lip on its own edge.
  ctx.save();
  roundRect(ctx, t.x + g, t.y + g, t.w - g * 2, t.h - g * 2, 8);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w, b.h);
  // Punch the board itself out of the clip so only the gutter takes paint.
  roundRect2(ctx, t.x + g - 40, t.y + g - 40, t.w - g * 2 + 80, t.h - g * 2 + 80);
  ctx.clip("evenodd");
  for (const [grow, a] of [[7, 0.12], [4, 0.16], [1.5, 0.28]]) {
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(b.x - grow, b.y - grow, b.w + grow * 2, b.h + grow * 2);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,246,225,0.32)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
}

/** Four mitred walnut boards, each grained along its own axis, with a
 * crowned profile, an inner bevel at the gutter lip, and brass roses
 * covering the corner bolts. */
function paintRails(ctx, layout, long, g, outerR) {
  const t = layout.tableRect;
  const ix = t.x + g;
  const iy = t.y + g;
  const iw = t.w - g * 2;
  const ih = t.h - g * 2;

  ctx.save();
  roundRect(ctx, t.x, t.y, t.w, t.h, outerR);
  ctx.clip();

  // The four rail boards. Sides listed with their own grain axis.
  const sides = [
    { name: "top", poly: [[t.x, t.y], [t.x + t.w, t.y], [ix + iw, iy], [ix, iy]], axis: "h", grad: [0, t.y, 0, iy], band: { x: t.x, y: t.y, w: t.w, h: g } },
    { name: "bottom", poly: [[t.x, t.y + t.h], [t.x + t.w, t.y + t.h], [ix + iw, iy + ih], [ix, iy + ih]], axis: "h", grad: [0, t.y + t.h, 0, iy + ih], band: { x: t.x, y: t.y + t.h - g, w: t.w, h: g } },
    { name: "left", poly: [[t.x, t.y], [t.x, t.y + t.h], [ix, iy + ih], [ix, iy]], axis: "v", grad: [t.x, 0, ix, 0], band: { x: t.x, y: t.y, w: g, h: t.h } },
    { name: "right", poly: [[t.x + t.w, t.y], [t.x + t.w, t.y + t.h], [ix + iw, iy + ih], [ix + iw, iy]], axis: "v", grad: [t.x + t.w, 0, ix + iw, 0], band: { x: t.x + t.w - g, y: t.y, w: g, h: t.h } },
  ];
  let seed = 41;
  for (const s of sides) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(s.poly[0][0], s.poly[0][1]);
    for (let i = 1; i < s.poly.length; i++) ctx.lineTo(s.poly[i][0], s.poly[i][1]);
    ctx.closePath();
    ctx.clip();
    // Crowned profile: dark at the outer edge, a rubbed highlight on the
    // crown, settling toward the inner lip.
    const grad = ctx.createLinearGradient(...s.grad);
    grad.addColorStop(0, COLORS.railLo);
    grad.addColorStop(0.42, COLORS.railHi);
    grad.addColorStop(0.75, COLORS.railMid);
    grad.addColorStop(1, "#4a3120");
    ctx.fillStyle = grad;
    ctx.fillRect(t.x, t.y, t.w, t.h);
    // Walnut figure: bolder dark streaks + a few pale sap lines, along
    // this board's own axis, then a soft lacquer sheen down the crown.
    // Grain gets the side's own BAND, not the whole table rect — spread
    // over the table, almost every streak fell outside the thin rail
    // and the walnut came out bald.
    grain(ctx, s.band, s.axis, seed, 0.26, 1.2, "walnut");
    grain(ctx, s.band, s.axis, seed + 7, 0.12, 0.6, "walnut");
    const crown = ctx.createLinearGradient(...s.grad);
    crown.addColorStop(0.3, "rgba(255,214,160,0)");
    crown.addColorStop(0.45, "rgba(255,214,160,0.09)");
    crown.addColorStop(0.6, "rgba(255,214,160,0)");
    ctx.fillStyle = crown;
    ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.restore();
    seed += 13;
  }

  // Mitre seams: the corner joints, a dark cut with a light lip.
  ctx.save();
  ctx.lineWidth = 1;
  for (const [ox, oy, cx2, cy2] of [
    [t.x, t.y, ix, iy],
    [t.x + t.w, t.y, ix + iw, iy],
    [t.x, t.y + t.h, ix, iy + ih],
    [t.x + t.w, t.y + t.h, ix + iw, iy + ih],
  ]) {
    ctx.strokeStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(cx2, cy2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,220,180,0.09)";
    ctx.beginPath();
    ctx.moveTo(ox + (cx2 > ox ? 1 : -1), oy);
    ctx.lineTo(cx2 + (cx2 > ox ? 1 : -1), cy2);
    ctx.stroke();
  }
  ctx.restore();

  // Outer edge: a dark rim and, one pixel in, the lacquer catching light.
  roundRect(ctx, t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1, outerR);
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  roundRect(ctx, t.x + 2, t.y + 2, t.w - 4, t.h - 4, Math.max(2, outerR - 2));
  ctx.strokeStyle = "rgba(255,224,180,0.1)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Inner bevel at the gutter lip: lit edge, then the drop.
  roundRect(ctx, ix - 1.5, iy - 1.5, iw + 3, ih + 3, 9);
  ctx.strokeStyle = "rgba(255,226,180,0.22)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Brass corner roses on the mitres — the jewellery that says
  // "furniture", sized off the rail and capped so phones keep them tidy.
  const rr = Math.max(3, Math.min(7, g * 0.24));
  for (const [cx2, cy2] of [
    [(t.x + ix) / 2, (t.y + iy) / 2],
    [(t.x + t.w + ix + iw) / 2, (t.y + iy) / 2],
    [(t.x + ix) / 2, (t.y + t.h + iy + ih) / 2],
    [(t.x + t.w + ix + iw) / 2, (t.y + t.h + iy + ih) / 2],
  ]) {
    // Seated in the wood: a small dark countersink first.
    ctx.beginPath();
    ctx.arc(cx2, cy2, rr * 1.25, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(20,10,4,0.45)";
    ctx.fill();
    const bg = ctx.createRadialGradient(cx2 - rr * 0.35, cy2 - rr * 0.4, rr * 0.15, cx2, cy2, rr);
    bg.addColorStop(0, "#d8bc7e");
    bg.addColorStop(0.55, COLORS.brass);
    bg.addColorStop(1, "#6b4d24");
    ctx.beginPath();
    ctx.arc(cx2, cy2, rr, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = "rgba(30,18,8,0.65)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Screw slot on the mitre's diagonal, and one dim glint.
    ctx.strokeStyle = "rgba(45,28,10,0.75)";
    ctx.lineWidth = Math.max(1, rr * 0.22);
    ctx.beginPath();
    ctx.moveTo(cx2 - rr * 0.55, cy2 - rr * 0.55);
    ctx.lineTo(cx2 + rr * 0.55, cy2 + rr * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx2 - rr * 0.32, cy2 - rr * 0.38, rr * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,248,225,0.55)";
    ctx.fill();
  }
  ctx.restore();
}

/** The bright maple playing surface, stave by stave. */
function paintSurface(ctx, layout, b, long) {
  // Base ramp: slightly brighter toward the scoring end — the eye is
  // pulled to where the game is decided, and that is where the lamp is.
  const surfGrad =
    long === "v"
      ? ctx.createLinearGradient(0, b.y, 0, b.y + b.h)
      : ctx.createLinearGradient(b.x + b.w, 0, b.x, 0);
  surfGrad.addColorStop(0, COLORS.mapleHi);
  surfGrad.addColorStop(0.55, COLORS.mapleMid);
  surfGrad.addColorStop(1, COLORS.mapleLo);
  ctx.fillStyle = surfGrad;
  ctx.fillRect(b.x, b.y, b.w, b.h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w, b.h);
  ctx.clip();

  // Staves: narrow maple boards running the LENGTH, uneven widths (a
  // perfectly regular seam grid reads as ruled paper — Four Ball's cloth
  // lesson). Each stave carries its own tone, and one in four carries a
  // cathedral figure.
  const stripRng = makeRng(7);
  const across = long === "v" ? b.w : b.h;
  const alongLen = long === "v" ? b.h : b.w;
  const stripW = layout.scale * 0.047;
  const edges = [0];
  for (let s = stripW * (0.6 + stripRng() * 0.5); s < across; s += stripW * (0.82 + stripRng() * 0.36)) edges.push(s);
  edges.push(across);
  for (let i = 0; i < edges.length - 1; i++) {
    const s0 = edges[i];
    const sw = edges[i + 1] - s0;
    if (sw <= 0) continue;
    // Per-stave tone: alternating warm and cool maple, low alpha.
    const warm = stripRng() < 0.5;
    const a = 0.05 + stripRng() * 0.055;
    ctx.fillStyle = warm ? `rgba(190,120,50,${a})` : `rgba(255,250,235,${a})`;
    if (long === "v") ctx.fillRect(b.x + s0, b.y, sw, b.h);
    else ctx.fillRect(b.x, b.y + s0, b.w, sw);
    // Cathedral figure: nested elongated arches inside the stave.
    if (stripRng() < 0.28 && sw > stripW * 0.5) {
      cathedral(ctx, b, long, s0, sw, alongLen, makeRng(211 + i * 17));
    }
    // Seam: dark joint plus a one-pixel lit lip — the seam becomes 3D.
    if (i > 0) {
      ctx.strokeStyle = "rgba(84,56,28,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (long === "v") {
        ctx.moveTo(b.x + s0, b.y);
        ctx.lineTo(b.x + s0, b.y + b.h);
      } else {
        ctx.moveTo(b.x, b.y + s0);
        ctx.lineTo(b.x + b.w, b.y + s0);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,250,235,0.1)";
      ctx.beginPath();
      if (long === "v") {
        ctx.moveTo(b.x + s0 + 1, b.y);
        ctx.lineTo(b.x + s0 + 1, b.y + b.h);
      } else {
        ctx.moveTo(b.x, b.y + s0 + 1);
        ctx.lineTo(b.x + b.w, b.y + s0 + 1);
      }
      ctx.stroke();
    }
  }

  // Grain, two frequencies: long low streaks, then fine short ones.
  grain(ctx, b, long, 13, 0.08, 1.5, "maple");
  grain(ctx, b, long, 31, 0.06, 0.65, "maple");

  // Wax: dust speckle everywhere, then the silicone wax beads a real
  // board is sprinkled with — tiny bright points that catch the lamp.
  const dustRng = makeRng(29);
  for (let i = 0; i < (b.w * b.h) / 700; i++) {
    const x = b.x + dustRng() * b.w;
    const y = b.y + dustRng() * b.h;
    ctx.fillStyle = dustRng() < 0.5 ? "rgba(255,250,235,0.05)" : "rgba(90,60,30,0.045)";
    ctx.fillRect(x, y, 1, 1);
  }
  const waxRng = makeRng(71);
  for (let i = 0; i < (b.w * b.h) / 2600; i++) {
    const x = b.x + waxRng() * b.w;
    const y = b.y + waxRng() * b.h;
    ctx.fillStyle = `rgba(255,252,240,${0.1 + waxRng() * 0.14})`;
    ctx.fillRect(x, y, 1, 1);
    if (waxRng() < 0.3) ctx.fillRect(x + 1, y, 1, 1);
  }

  // Painted lines and numerals.
  paintMarks(ctx, layout);

  // Lamp sheen: two soft pools where the lights hang over the board,
  // plus one broad diagonal wash. All additive and faint.
  for (const frac of [0.3, 0.72]) {
    const cx2 = long === "v" ? b.x + b.w / 2 : b.x + b.w * frac;
    const cy2 = long === "v" ? b.y + b.h * (1 - frac) : b.y + b.h / 2;
    const rad = Math.max(b.w, b.h) * 0.28;
    const lamp = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, rad);
    lamp.addColorStop(0, "rgba(255,252,240,0.07)");
    lamp.addColorStop(1, "rgba(255,252,240,0)");
    ctx.fillStyle = lamp;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  const sheen = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
  sheen.addColorStop(0, "rgba(255,255,255,0.06)");
  sheen.addColorStop(0.35, "rgba(255,255,255,0)");
  sheen.addColorStop(0.7, "rgba(255,255,255,0.045)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(b.x, b.y, b.w, b.h);

  // Edge shading where the surface meets the gutter drop.
  const edge = 5;
  ctx.fillStyle = "rgba(60,35,15,0.13)";
  ctx.fillRect(b.x, b.y, b.w, edge);
  ctx.fillRect(b.x, b.y + b.h - edge, b.w, edge);
  ctx.fillRect(b.x, b.y, edge, b.h);
  ctx.fillRect(b.x + b.w - edge, b.y, edge, b.h);
  ctx.restore();
}

/** Nested elongated arches — the heart of a flat-sawn maple board. */
function cathedral(ctx, b, long, s0, sw, alongLen, rng) {
  const n = 1 + Math.floor(rng() * 2);
  for (let k = 0; k < n; k++) {
    const centre = s0 + sw * (0.35 + rng() * 0.3);
    const at = rng() * alongLen; // arch apex along the length
    const dir = rng() < 0.5 ? 1 : -1;
    const rings = 5 + Math.floor(rng() * 3);
    for (let r = 1; r <= rings; r++) {
      const halfW = (sw * 0.46 * r) / rings;
      const len = (60 + rng() * 45) * r;
      ctx.strokeStyle = `rgba(160,105,45,${0.04 + rng() * 0.028})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      if (long === "v") {
        const x = b.x + centre;
        const y = b.y + at;
        ctx.moveTo(x - halfW, y + dir * len);
        ctx.quadraticCurveTo(x - halfW, y, x, y - dir * halfW * 1.6);
        ctx.quadraticCurveTo(x + halfW, y, x + halfW, y + dir * len);
      } else {
        const x = b.x + at;
        const y = b.y + centre;
        ctx.moveTo(x + dir * len, y - halfW);
        ctx.quadraticCurveTo(x, y - halfW, x - dir * halfW * 1.6, y);
        ctx.quadraticCurveTo(x, y + halfW, x + dir * len, y + halfW);
      }
      ctx.stroke();
    }
  }
}

/** Low-contrast streaks along a rect's given axis ("v"|"h").
 * kind picks the palette: maple (warm brown + pale) or walnut (near-black
 * chocolate + pale sap). */
function grain(ctx, rect, axis, seed, alpha, weight, kind = "maple") {
  const rng = makeRng(seed);
  const n = Math.round((axis === "v" ? rect.w : rect.h) / 3);
  const dark = kind === "walnut" ? "26,14,6" : "96,64,32";
  const pale = kind === "walnut" ? "205,160,110" : "255,244,220";
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  for (let i = 0; i < n; i++) {
    const a = alpha * (0.35 + rng() * 0.65);
    ctx.strokeStyle = rng() < 0.75 ? `rgba(${dark},${a})` : `rgba(${pale},${a * 0.8})`;
    ctx.lineWidth = weight * (0.5 + rng());
    ctx.beginPath();
    if (axis === "v") {
      const x = rect.x + rng() * rect.w;
      const y0 = rect.y + rng() * rect.h;
      const len = (0.2 + rng() * 0.6) * rect.h;
      const wob = (rng() - 0.5) * 3;
      ctx.moveTo(x, y0);
      ctx.bezierCurveTo(x + wob, y0 + len * 0.33, x - wob, y0 + len * 0.66, x + wob * 0.5, y0 + len);
    } else {
      const y = rect.y + rng() * rect.h;
      const x0 = rect.x + rng() * rect.w;
      const len = (0.2 + rng() * 0.6) * rect.w;
      const wob = (rng() - 0.5) * 3;
      ctx.moveTo(x0, y);
      ctx.bezierCurveTo(x0 + len * 0.33, y + wob, x0 + len * 0.66, y - wob, x0 + len, y + wob * 0.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function paintMarks(ctx, layout) {
  const L = P.BOARD_LENGTH;
  // A zone line is paint on wood: a soft pressed shadow under it, the
  // line itself, then seeded nicks of surface tone breaking it — worn by
  // ten thousand slides, not printed this morning.
  const lineAt = (x, width, alpha, seed) => {
    const a = layout.toScreen(x, 0);
    const b2 = layout.toScreen(x, P.BOARD_WIDTH);
    ctx.strokeStyle = `rgba(255,246,225,${alpha * 0.3})`;
    ctx.lineWidth = width + 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.stroke();
    ctx.strokeStyle = `rgba(66,42,20,${alpha})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.stroke();
    const rng = makeRng(seed);
    const len = Math.hypot(b2.x - a.x, b2.y - a.y);
    const ux = (b2.x - a.x) / len;
    const uy = (b2.y - a.y) / len;
    for (let i = 0; i < len / 14; i++) {
      const d = rng() * len;
      ctx.fillStyle = `rgba(231,196,136,${0.25 + rng() * 0.3})`;
      ctx.fillRect(a.x + ux * d - 1, a.y + uy * d - 1, 1 + rng() * 2, 1 + rng() * 1.5);
    }
  };
  lineAt(L - P.ZONE_3_DEPTH, 2, 0.52, 101);
  lineAt(L - P.ZONE_2_DEPTH, 2, 0.52, 103);
  lineAt(P.FOUL_X, 2, 0.4, 107);

  // Zone numerals, stencilled the way a real board paints them: a light
  // lip below-right (paint pressed into lacquered wood), then the paint.
  // Drawn upright on screen whatever the orientation — they are labels,
  // and a sideways 2 is a puzzle.
  const numeral = (x, text, size) => {
    const p = layout.toScreen(x, P.BOARD_WIDTH / 2);
    ctx.font = `600 ${size}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,248,228,0.35)";
    ctx.fillText(text, p.x + 1, p.y + 1.2);
    ctx.fillStyle = "rgba(66,42,20,0.55)";
    ctx.fillText(text, p.x, p.y);
  };
  const s = Math.max(11, layout.scale * 0.075);
  numeral(L - P.ZONE_3_DEPTH / 2, "3", s);
  numeral(L - (P.ZONE_2_DEPTH + P.ZONE_3_DEPTH) / 2, "2", s);
  numeral(L - P.ZONE_2_DEPTH - (P.FOUL_DEPTH - P.ZONE_2_DEPTH) / 2, "1", s * 0.92);
}

// --- per-frame drawing -----------------------------------------------------

export function draw(ctx, layout, view) {
  const dpr = view.dpr || 1;
  ctx.save();
  ctx.clearRect(0, 0, view.width, view.height);
  const floor = floorCanvas(layout, view.width, view.height, dpr);
  ctx.drawImage(floor, 0, 0, view.width, view.height);
  const table = tableCanvas(layout, dpr);
  ctx.drawImage(table, layout.tableRect.x, layout.tableRect.y, layout.tableRect.w, layout.tableRect.h);

  // Fallen weights lie in the gutter where they went over — the record of
  // every knock-off stays visible for the rest of the frame.
  for (const p of view.world.pucks) {
    if (p.off) drawGutterPuck(ctx, layout, p);
  }
  // Live weights. During the sweep they slide back toward the shooter
  // and fade — the barman's arm collecting the frame.
  const sweep = view.sweep ?? null;
  for (const p of view.world.pucks) {
    if (p.off) continue;
    if (p.foul && view.foulFade?.[p.id] === undefined) continue;
    const fade = p.foul ? view.foulFade[p.id] : 1;
    const shown = sweep === null ? p : { ...p, x: Math.max(0.05, p.x - sweep * sweep * 0.9) };
    const alpha = sweep === null ? fade : fade * (1 - sweep);
    drawPuck(ctx, layout, shown, { alpha, counted: view.counted?.includes(p.id) });
    // A resting hanger glows: it is the board's rarest, richest state,
    // and before this pulse most players never noticed they had one.
    if (sweep === null && view.restful && isHanger(p) && !p.foul) {
      const s2 = layout.toScreen(p.x, p.y);
      const pulse = 0.28 + 0.18 * Math.sin((view.time ?? 0) * 4.5);
      ctx.beginPath();
      ctx.arc(s2.x, s2.y, layout.puckPx * 1.45, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 214, 110, ${pulse})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  if (view.effects) drawPops(ctx, layout, view.effects);
  if (view.scoreFx) drawScoreFx(ctx, layout, view.scoreFx);
  if (view.aim) drawAim(ctx, layout, view.aim);
  if (view.invite) drawInvite(ctx, layout, view.invite);
  ctx.restore();
}

/** A machined steel weight: turned grooves in the body, an inset
 * lacquered cap with its own bevel, one hot specular point. */
function drawPuck(ctx, layout, p, { alpha = 1, counted = false, ghost = false } = {}) {
  const r = layout.puckPx;
  const s = layout.toScreen(p.x, p.y);
  ctx.save();
  ctx.globalAlpha = alpha * (ghost ? 0.45 : 1);
  // Contact shadow: a broad soft pool and a tight dark core.
  ctx.beginPath();
  ctx.ellipse(s.x + r * 0.16, s.y + r * 0.24, r * 1.14, r * 1.0, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(40,22,8,0.16)";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(s.x + r * 0.08, s.y + r * 0.12, r * 1.0, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(35,18,6,0.22)";
  ctx.fill();
  // Steel body.
  const body = ctx.createRadialGradient(s.x - r * 0.42, s.y - r * 0.48, r * 0.15, s.x, s.y, r * 1.05);
  body.addColorStop(0, "#fafaf8");
  body.addColorStop(0.35, "#d5d8db");
  body.addColorStop(0.65, "#a9adb3");
  body.addColorStop(0.88, "#787d85");
  body.addColorStop(1, "#5c6169");
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(25,26,30,0.6)";
  ctx.stroke();
  // Turned grooves: two rings cut on the lathe, each a dark cut with a
  // lit lip — what makes steel read as machined instead of moulded.
  for (const gr of [0.87, 0.76]) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * gr, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(40,44,52,0.28)";
    ctx.lineWidth = Math.max(0.8, r * 0.045);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * gr - Math.max(0.8, r * 0.05), Math.PI * 0.9, Math.PI * 1.6);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  // Cap recess: the dark ring the cap sits into.
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 0.66, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(20,20,24,0.4)";
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.stroke();
  // Cap.
  const col = PUCK_COLORS[p.owner];
  const cap = ctx.createRadialGradient(s.x - r * 0.26, s.y - r * 0.32, r * 0.06, s.x, s.y, r * 0.68);
  cap.addColorStop(0, col.capHi);
  cap.addColorStop(0.7, col.cap);
  cap.addColorStop(1, col.capLo);
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = cap;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // Cap bevel: the lacquer edge catching light on the lamp side.
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 0.56, Math.PI * 0.85, Math.PI * 1.75);
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = Math.max(0.8, r * 0.05);
  ctx.stroke();
  // Gloss crescent + one hot specular point.
  ctx.beginPath();
  ctx.ellipse(s.x - r * 0.2, s.y - r * 0.26, r * 0.3, r * 0.2, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s.x - r * 0.3, s.y - r * 0.36, Math.max(0.8, r * 0.09), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fill();
  // Rim light, lower right — what keeps a disc from reading as a flat dot.
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 0.93, Math.PI * 0.12, Math.PI * 0.62);
  ctx.strokeStyle = "rgba(255,252,240,0.32)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  if (counted) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,232,150,0.95)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

function drawGutterPuck(ctx, layout, p) {
  // Clamp the exit point to the gutter band nearest to where it left.
  const r = layout.puckPx * 0.92;
  const half = P.PUCK_RADIUS; // in metres, for clamping along the board
  const x = P.clamp(p.x, half, P.BOARD_LENGTH); // "end" exits sit at the end gutter
  let s;
  const off = layout.gutterPx * 0.55;
  if (p.y < 0) s = shift(layout, layout.toScreen(x, 0), -off);
  else if (p.y > P.BOARD_WIDTH) s = shift(layout, layout.toScreen(x, P.BOARD_WIDTH), off);
  else {
    const e = layout.toScreen(P.BOARD_LENGTH, P.clamp(p.y, half, P.BOARD_WIDTH - half));
    s = layout.orient === "portrait" ? { x: e.x, y: e.y - off } : { x: e.x + off, y: e.y };
  }
  ctx.save();
  // A weight down in the recess: dimmer, cooler, a faint top edge still
  // caught by the lamp so the record of the knock-off stays legible.
  const col = PUCK_COLORS[p.owner];
  ctx.globalAlpha = 0.9;
  const body = ctx.createRadialGradient(s.x - r * 0.3, s.y - r * 0.35, r * 0.1, s.x, s.y, r);
  body.addColorStop(0, "#7d8288");
  body.addColorStop(0.7, "#4e5257");
  body.addColorStop(1, "#33363b");
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = col.capLo;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 0.95, Math.PI * 1.05, Math.PI * 1.7);
  ctx.strokeStyle = "rgba(255,240,210,0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Move a screen point "outward" across the board's short axis. */
function shift(layout, s, d) {
  return layout.orient === "portrait" ? { x: s.x + d, y: s.y } : { x: s.x, y: s.y + d };
}

// --- moments ---------------------------------------------------------------

/** Expanding rings where a weight went over — the knock-off made visible.
 * @param effects [{ x, y, t01, owner }] */
function drawPops(ctx, layout, effects) {
  for (const fx of effects) {
    const s = layout.toScreen(
      P.clamp(fx.x, 0, P.BOARD_LENGTH),
      P.clamp(fx.y, -P.PUCK_RADIUS, P.BOARD_WIDTH + P.PUCK_RADIUS)
    );
    const t = fx.t01;
    const r = layout.puckPx * (1 + t * 2.4);
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.strokeStyle = PUCK_COLORS[fx.owner]?.capHi ?? "#fff";
    ctx.lineWidth = 3 * (1 - t) + 0.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** "+N" rising off the counted weights while the header score ticks up.
 * @param fx { points, x, y, t01, owner } */
function drawScoreFx(ctx, layout, fx) {
  const s = layout.toScreen(fx.x, fx.y);
  const t = fx.t01;
  const rise = 14 + t * 26;
  const alpha = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `800 ${Math.max(19, layout.puckPx * 1.5)}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(23,19,16,0.6)";
  ctx.fillStyle = fx.owner === 0 ? "#ffb45e" : "#8fb3f0";
  const label = `+${fx.points}`;
  ctx.strokeText(label, s.x, s.y - rise);
  ctx.fillText(label, s.x, s.y - rise);
  ctx.restore();
}

// --- aim UI ---------------------------------------------------------------

/**
 * @param aim { y, angle, power, lastPower, active }
 *
 * POWER LIVES WHERE THE EYES ARE. The first hands-on test's very first
 * finding: a meter drawn on the rail below the table was CLIPPED OFF
 * SCREEN in portrait (the table fills the stage), so power had no
 * visible feedback at all — the same "state says visible, screen says
 * nothing" family as Four Ball's stuck-card bug. Everything now draws at
 * the weight itself: an arc gauge around it with a % readout, a tick at
 * the previous shot's power (the gauge memory that makes power a skill),
 * and an aim ray whose LENGTH grows with power. The ray is deliberately
 * short and uncalibrated — it says "harder", never "you will stop here";
 * the true stopping point stays earnable (kickoff doc, section 5).
 */
function drawAim(ctx, layout, aim) {
  const ghost = { id: -1, owner: aim.owner ?? 0, x: P.START_X, y: aim.y, off: false, foul: false };
  drawPuck(ctx, layout, ghost, { ghost: !aim.active, alpha: aim.active ? 1 : 0.8 });
  const s = layout.toScreen(P.START_X, aim.y);
  if (aim.active || aim.power > 0) drawAimRay(ctx, layout, s, aim);
  drawPowerArc(ctx, layout, s, aim);
  if (aim.preview) drawPreview(ctx, layout, aim.preview);
}

/** The bought stop-point: the shot weight's true path (dashed) and where
 * it comes to rest — or the edge it leaves by. Exact, not estimated. */
function drawPreview(ctx, layout, pv) {
  ctx.save();
  ctx.setLineDash([3, 6]);
  ctx.strokeStyle = "rgba(255,244,214,0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < pv.path.length; i++) {
    const q = layout.toScreen(pv.path[i].x, pv.path[i].y);
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  const e = layout.toScreen(
    P.clamp(pv.x, 0, P.BOARD_LENGTH),
    P.clamp(pv.y, -P.PUCK_RADIUS, P.BOARD_WIDTH + P.PUCK_RADIUS)
  );
  if (pv.off) {
    // It leaves the board: a cross at the exit, not a resting ring.
    const k = layout.puckPx * 0.7;
    ctx.strokeStyle = "rgba(226,96,79,0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(e.x - k, e.y - k);
    ctx.lineTo(e.x + k, e.y + k);
    ctx.moveTo(e.x + k, e.y - k);
    ctx.lineTo(e.x - k, e.y + k);
    ctx.stroke();
  } else {
    ctx.strokeStyle = pv.foul ? "rgba(226,96,79,0.9)" : "rgba(255,244,214,0.95)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(e.x, e.y, layout.puckPx, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAimRay(ctx, layout, s, aim) {
  // Length says power. 0.2 m at a feather, 0.85 m at full — well short of
  // any real stopping distance, so it cannot be read as a landing marker.
  const rayLen = 0.2 + aim.power * 0.65;
  const ex = P.START_X + Math.cos(aim.angle) * rayLen;
  const ey = aim.y + Math.sin(aim.angle) * rayLen;
  const e = layout.toScreen(ex, ey);
  const hot = aim.power > 0.94;
  const col = hot ? "rgba(197,58,46,0.8)" : "rgba(50,32,14,0.6)";
  ctx.save();
  ctx.setLineDash([6, 7]);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2 + aim.power * 1.6;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(e.x, e.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const ang = Math.atan2(e.y - s.y, e.x - s.x);
  const ah = 8 + aim.power * 4;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x - Math.cos(ang - 0.42) * ah, e.y - Math.sin(ang - 0.42) * ah);
  ctx.lineTo(e.x - Math.cos(ang + 0.42) * ah, e.y - Math.sin(ang + 0.42) * ah);
  ctx.fill();
  ctx.restore();
}

/** 270° gauge around the weight. Gap faces the shooter (screen-down in
 * portrait is the shooter's side; the gap is just "not on the line of
 * play" in landscape too, which is close enough to stay screen-fixed). */
function drawPowerArc(ctx, layout, s, aim) {
  const r = layout.puckPx * 1.7 + 5;
  const a0 = Math.PI * 0.75;
  const span = Math.PI * 1.5;
  ctx.save();
  ctx.lineCap = "round";
  // Track — always visible while aiming, so the gauge exists before the
  // first drag rather than appearing mid-gesture.
  ctx.strokeStyle = "rgba(40,24,10,0.22)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, a0, a0 + span);
  ctx.stroke();
  // Fill.
  const frac = P.clamp(aim.power, 0, 1);
  if (frac > 0.002) {
    ctx.strokeStyle = frac > 0.94 ? "rgba(197,58,46,0.95)" : "rgba(224,163,60,0.95)";
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, a0, a0 + span * frac);
    ctx.stroke();
  }
  // The previous shot's power: the tick that turns the gauge into memory.
  if (aim.lastPower != null) {
    const a = a0 + span * P.clamp(aim.lastPower, 0, 1);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x + Math.cos(a) * (r - 5), s.y + Math.sin(a) * (r - 5));
    ctx.lineTo(s.x + Math.cos(a) * (r + 5), s.y + Math.sin(a) * (r + 5));
    ctx.stroke();
  }
  // Percent readout, behind the weight (away from the line of play).
  if (aim.active && frac > 0.002) {
    const t = layout.toScreen(P.START_X - 0.1, aim.y);
    ctx.font = `700 ${Math.max(13, layout.puckPx * 0.95)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(240,233,221,0.85)";
    ctx.fillStyle = frac > 0.94 ? "#a32619" : "#4c3320";
    const label = `${Math.round(frac * 100)}%`;
    ctx.strokeText(label, t.x, t.y);
    ctx.fillText(label, t.x, t.y);
  }
  ctx.restore();
}

/**
 * The gesture demo: a phantom finger dragging the weight's line out and
 * letting go, looping until the player's first shot ever. It SHOWS the
 * push gesture instead of explaining it — and it never fires anything
 * (the series learned that auto-started play reads as a glitch).
 * @param invite { power, y, showText }
 */
function drawInvite(ctx, layout, invite) {
  const s = layout.toScreen(P.START_X, invite.y);
  // The phantom fingertip, travelling the drag path ahead of the weight.
  const d = 0.12 + invite.power * 0.5;
  const f = layout.toScreen(P.START_X + d, invite.y);
  ctx.save();
  ctx.beginPath();
  ctx.arc(f.x, f.y, 11, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.stroke();
  // Tether from weight to fingertip.
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(f.x, f.y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (invite.showText) {
    const t = layout.toScreen(P.START_X + 0.78, invite.y);
    ctx.font = `600 13px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(23,19,16,0.55)";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    const label = "Drag, then let go";
    ctx.strokeText(label, t.x, t.y);
    ctx.fillText(label, t.x, t.y);
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Append a plain rect to the CURRENT path (for evenodd punch-outs) —
 * roundRect() begins a new path, which would discard the first shape. */
function roundRect2(ctx, x, y, w, h) {
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

export { drawPuck, isHanger, puckValue };
