// game/render.js
// All canvas drawing. Reads state, writes pixels, owns no game logic.
//
// Inherited from the site's Four Ball Billiards renderer: the cached
// table bitmap, the per-pixel shaded ball sprite, the cue, the preview
// line. New for pool: six pockets cut into the rails, numbered and
// striped balls, the head string and the ghost cue ball for ball in
// hand, and three cloth colours instead of five whole tables.

import { TABLE_LENGTH, TABLE_WIDTH, BALL_RADIUS } from "./physics.js";
import { toPx, dirToScreen, RAIL, pullForPower } from "./layout.js";
import { paintCloth, paintRail, paintSight } from "./surface.js";
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

  // --- the shadow the whole table casts ---------------------------------
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.filter = "blur(" + (railPx * 0.5).toFixed(1) + "px)";
  roundRect(ctx, out.x + railPx * 0.1, out.y + railPx * 0.3, out.w, out.h, railPx * 0.35);
  ctx.fill();
  ctx.restore();

  // --- four rails, mitred ------------------------------------------------
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

  // --- the cushion face --------------------------------------------------
  ctx.save();
  ctx.beginPath();
  ctx.rect(nose.x, nose.y, nose.w, nose.h);
  ctx.rect(bed.x + bed.w, bed.y, -bed.w, bed.h);
  ctx.fillStyle = COLORS.cushion;
  ctx.fill("evenodd");
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
  ctx.restore();

  // --- the bed -----------------------------------------------------------
  paintCloth(ctx, bed, { base: COLORS.cloth, lamp: COLORS.clothLamp, edge: COLORS.clothDark });
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(1, railPx * 0.05);
  ctx.strokeRect(bed.x, bed.y, bed.w, bed.h);
  ctx.restore();

  drawSpots(ctx, L);
  drawPockets(ctx, L, railPx);
  drawSights(ctx, L, out, nose, wood);

  // A brass fillet where the wood meets the cushion, and the lamp.
  ctx.save();
  ctx.strokeStyle = "rgba(201,164,92,0.75)";
  ctx.lineWidth = Math.max(1, wood * 0.07);
  ctx.strokeRect(nose.x, nose.y, nose.w, nose.h);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(bed.x, bed.y, bed.w, bed.h);
  ctx.clip();
  const cx = bed.x + bed.w / 2;
  const cy = bed.y + bed.h / 2;
  const rr = Math.max(bed.w, bed.h) * 0.62;
  const lg = ctx.createRadialGradient(cx, cy, rr * 0.12, cx, cy, rr);
  lg.addColorStop(0, "rgba(255,244,214,0.14)");
  lg.addColorStop(0.55, "rgba(255,240,205,0.04)");
  lg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = lg;
  ctx.fillRect(bed.x, bed.y, bed.w, bed.h);
  ctx.restore();
}

/**
 * The pockets: a hole cut through cushion and rail at each of the six,
 * drawn as a dark well with a leather-dark rim. Its drawn radius is a
 * little under the physics' capture circle so a ball hanging on the lip
 * is visibly still on the table.
 */
function drawPockets(ctx, L, railPx) {
  for (const p of pocketsPx(L)) {
    ctx.save();
    const r = p.r;
    // The rim: a ring of dark leather set into the wood.
    const rim = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 1.28);
    rim.addColorStop(0, "#0b0805");
    rim.addColorStop(0.72, "#1a120b");
    rim.addColorStop(0.86, "#3a2a1a");
    rim.addColorStop(1, "rgba(58,42,26,0)");
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.28, 0, Math.PI * 2);
    ctx.fill();
    // The well itself.
    const g = ctx.createRadialGradient(p.x - r * 0.2, p.y - r * 0.2, 0, p.x, p.y, r);
    g.addColorStop(0, "#050403");
    g.addColorStop(0.7, "#0a0806");
    g.addColorStop(1, "#171008");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = Math.max(1, railPx * 0.06);
    ctx.stroke();
    ctx.restore();
  }
}

/** Pocket centres and drawn radii in canvas px. */
export function pocketsPx(L, world) {
  const R = BALL_RADIUS * L.scale;
  const list = world ? world.pockets : null;
  const out = [];
  const geom = list || [
    { id: "tl", x: -0.9 * BALL_RADIUS, y: -0.9 * BALL_RADIUS, corner: true },
    { id: "tm", x: TABLE_LENGTH / 2, y: -0.8 * BALL_RADIUS, corner: false },
    { id: "tr", x: TABLE_LENGTH + 0.9 * BALL_RADIUS, y: -0.9 * BALL_RADIUS, corner: true },
    { id: "bl", x: -0.9 * BALL_RADIUS, y: TABLE_WIDTH + 0.9 * BALL_RADIUS, corner: true },
    { id: "bm", x: TABLE_LENGTH / 2, y: TABLE_WIDTH + 0.8 * BALL_RADIUS, corner: false },
    { id: "br", x: TABLE_LENGTH + 0.9 * BALL_RADIUS, y: TABLE_WIDTH + 0.9 * BALL_RADIUS, corner: true },
  ];
  for (const p of geom) {
    const q = toPx(L, p.x, p.y);
    out.push({ id: p.id, x: q.x, y: q.y, r: p.corner ? R * 2.1 : R * 1.75, corner: p.corner });
  }
  return out;
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
    const sp = ballSprite(b.id, px);
    const half = (r * sp.size) / (sp.R * 2);
    if (dim && dim(b)) ctx.globalAlpha = 0.55;
    ctx.drawImage(sp.canvas, p.x - half, p.y - half, half * 2, half * 2);
    ctx.globalAlpha = 1;
  }
  // Sinking: the ball shrinks into the pocket over a few frames.
  for (const s of sinking) {
    const p = toPx(L, s.x, s.y);
    const sp = ballSprite(s.id, px);
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
// all agree. A stripe is a band of colour across the equator of a white
// ball; every numbered ball then gets its white disc and number drawn on
// top with ordinary canvas text.
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

/**
 * Render one ball to an offscreen canvas, shaded per pixel. `px` is the
 * radius in DEVICE pixels; the sprite is built at SS times that and drawn
 * back down, which is where the smooth silhouette comes from.
 */
function ballSprite(id, px) {
  const SS = 2;
  const key = `${id}@${px}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  const R = Math.max(3, Math.round(px * SS));
  const size = R * 2 + 2;
  const c =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const data = img.data;
  const isCue = id === CUE_ID;
  const stripe = isStripe(id);
  const col = isCue ? WHITE : ballColor(id);
  const mid = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5 - mid) / R;
      const v = (y + 0.5 - mid) / R;
      const d2 = u * u + v * v;
      const i = (y * size + x) * 4;
      if (d2 >= 1.16) continue;
      const d = Math.sqrt(d2);
      const alpha = 1 - smoothstep(1 - 1.1 / R, 1 + 0.4 / R, d);
      if (alpha <= 0) continue;
      const nz = Math.sqrt(Math.max(0.0025, 1 - Math.min(d2, 1)));
      // A stripe: white outside a band across the middle. The band's
      // edge is where the sphere's height drops through 0.5, which is
      // how a real stripe seen from above curves at its ends.
      const paint = stripe && Math.abs(v) > 0.52 ? WHITE : col;
      const { body, shadow, sheen } = paint;

      const nl = u * LAMP[0] + v * LAMP[1] + nz * LAMP[2];
      const lam = clamp01((nl + 0.17) / 1.17) ** 1.5;
      const fill = clamp01(u * FILL[0] + v * FILL[1] + nz * FILL[2]) ** 2 * 0.22;
      const bnc = clamp01(u * BOUNCE[0] + v * BOUNCE[1] + nz * BOUNCE[2]) ** 2 * (1 - lam) * 0.5;

      const shade = clamp01(0.07 + lam * 0.98 + fill);
      let rr = shadow[0] + (body[0] - shadow[0]) * shade;
      let gg = shadow[1] + (body[1] - shadow[1]) * shade;
      let bb = shadow[2] + (body[2] - shadow[2]) * shade;
      rr += CLOTH_BOUNCE[0] * bnc * 0.28;
      gg += CLOTH_BOUNCE[1] * bnc * 0.34;
      bb += CLOTH_BOUNCE[2] * bnc * 0.28;

      const turn = 1 - 0.18 * smoothstep(0.2, 1.0, d);
      rr *= turn;
      gg *= turn;
      bb *= turn;

      const fres = (1 - nz) ** 2.0 * (0.3 + 0.7 * (1 - lam));
      rr += sheen[0] * fres * 0.26;
      gg += sheen[1] * fres * 0.26;
      bb += sheen[2] * fres * 0.26;

      const nh = clamp01(u * LAMP_H[0] + v * LAMP_H[1] + nz * LAMP_H[2]);
      const spec = nh ** 150 * 1.2 + nh ** 26 * 0.07;
      const nh2 = clamp01(u * FILL_H[0] + v * FILL_H[1] + nz * FILL_H[2]);
      const spec2 = nh2 ** 300 * 0.42;
      const s = spec + spec2;
      rr += sheen[0] * s;
      gg += sheen[1] * s;
      bb += sheen[2] * s;

      data[i] = rr > 255 ? 255 : rr;
      data[i + 1] = gg > 255 ? 255 : gg;
      data[i + 2] = bb > 255 ? 255 : bb;
      data[i + 3] = alpha * 255;
    }
  }
  g.putImageData(img, 0, 0);

  // The number on its white disc. Big, because it is read at 18 px.
  if (!isCue) {
    const discR = R * 0.5;
    g.save();
    g.translate(mid, mid);
    const dg = g.createRadialGradient(-discR * 0.3, -discR * 0.35, discR * 0.1, 0, 0, discR);
    dg.addColorStop(0, "#ffffff");
    dg.addColorStop(1, "#dcd6c8");
    g.fillStyle = dg;
    g.beginPath();
    g.arc(0, 0, discR, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#151515";
    const fs = R * (id.length > 1 ? 0.62 : 0.72);
    g.font = `700 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(id, 0, fs * 0.06);
    // The sphere's own shading over the disc, so the number sits ON the
    // ball rather than floating in front of it.
    const sh = g.createRadialGradient(-R * 0.4, -R * 0.5, R * 0.1, 0, 0, R);
    sh.addColorStop(0, "rgba(0,0,0,0)");
    sh.addColorStop(0.7, "rgba(0,0,0,0.05)");
    sh.addColorStop(1, "rgba(0,0,0,0.35)");
    g.fillStyle = sh;
    g.beginPath();
    g.arc(0, 0, discR, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  spriteCache.set(key, { canvas: c, size, R });
  if (spriteCache.size > 40) {
    for (const k of [...spriteCache.keys()].slice(0, 16)) spriteCache.delete(k);
  }
  return spriteCache.get(key);
}

/** A ball drawn on its own, for the tray. Returns a data URL-free canvas
 * blit: the caller passes a 2D context and a centre. */
export function drawBallAt(ctx, id, cx, cy, r) {
  const dpr = (ctx.getTransform ? ctx.getTransform().a : 0) || 1;
  const sp = ballSprite(id, Math.max(3, Math.round(r * dpr)));
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
