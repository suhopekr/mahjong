// game/render.js
// All canvas drawing. Reads state, writes pixels, owns no game logic.
//
// Inherited wholesale from the series (Gomoku -> StoneFlick -> here): the
// three-stop gloss that makes a sphere read as a sphere, drawing shadows
// before every ball rather than per ball so nothing casts onto a
// neighbour, and doing the whole frame in CSS pixels with one
// setTransform for devicePixelRatio at the top.
//
// What is new is that the table has to look like SLATE UNDER CLOTH rather
// than like a green rectangle. Three things carry that and none of them
// is the colour: the cloth is darker at the rails than in the middle
// (light falls off from the lamp over the table), the rails are lit from
// the top-left so the two facing the light are brighter, and the balls
// sit in a soft contact shadow rather than a hard drop shadow. Take any
// one away and it flattens into a board game.

import { TABLE_LENGTH, TABLE_WIDTH, BALL_RADIUS } from "./physics.js";
import {
  toPx,
  dirToScreen,
  RAIL,
  spinDialLayout,
  controlsLayout,
  pullForPower,
  laneToPx,
} from "./layout.js";
import { paintCloth, paintRail, paintSight } from "./surface.js";
import { DEFAULT_THEME, themeById } from "./themes.js";

export const COLORS = {
  // The cloth is the brightest large object on the screen and the balls
  // are read against it, so it is deliberately a little brighter and more
  // saturated than a photograph of a table would be. That also pays a
  // second debt: the cover has to survive being shrunk to a 120px tile
  // against the portal's dark UI, and Daily Five lost a whole point of
  // CTR to a cover whose average colour sat at 1.03:1 against that
  // background. A dark table would be beautiful and unclickable.
  cloth: "#2a7d5c",
  clothLamp: "#38976e",
  clothDark: "#175641",
  clothLine: "#3c9273",
  /** The cushion face — the same cloth, in shadow under the rail. */
  cushion: "#1c624a",
  rail: "#5a3620",
  railLight: "#8a5533",
  railDark: "#2e1a0e",
  diamond: "#f2e2c0",
  white: "#f7f4ec",
  yellow: "#f2c53d",
  red: "#cf2f2a",
  ink: "#e8eef0",
  dim: "rgba(232,238,240,0.55)",
};

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

/**
 * How the rail's width is split between wood and cushion.
 *
 * A billiard table is not a cloth rectangle inside a wooden one. Between
 * them is the cushion: rubber, covered in the same cloth, sloping down to
 * the nose that the ball actually hits. Drawing that strip is the single
 * change here that most makes the table read as a table rather than as a
 * board game — it gives the bed a wall instead of an edge, and it puts
 * the line the player aims at where it physically is.
 */
const WOOD_SHARE = 0.62;

/**
 * The table, painted once.
 *
 * Everything in here is static for a given canvas size, and it is now
 * expensive enough to be worth saying so: four grained rails, a napped
 * bed and twenty inlays is a few hundred canvas operations. Painting them
 * every frame at 60Hz would be absurd, so the whole table goes into an
 * offscreen canvas keyed by size and device ratio, and the frame loop
 * does one drawImage. Same pattern as StoneFlick's cached board, for the
 * same reason.
 */
let tableCache = null;

export function drawTable(ctx, L) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const key = `${Math.round(L.width)}x${Math.round(L.height)}@${dpr}:${Math.round(L.scale)}`;
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
  const bed = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
  const railPx = RAIL * L.scale;
  const wood = railPx * WOOD_SHARE;
  const cush = railPx - wood;
  const nose = { x: bed.x - cush, y: bed.y - cush, w: bed.w + cush * 2, h: bed.h + cush * 2 };
  const out = { x: nose.x - wood, y: nose.y - wood, w: nose.w + wood * 2, h: nose.h + wood * 2 };

  // --- the shadow the whole table casts, so it sits on the page --------
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.filter = "blur(" + (railPx * 0.5).toFixed(1) + "px)";
  roundRect(ctx, out.x + railPx * 0.1, out.y + railPx * 0.3, out.w, out.h, railPx * 0.35);
  ctx.fill();
  ctx.restore();

  // --- four rails, mitred -----------------------------------------------
  // Each piece is a trapezoid from the outer edge to the cushion, which is
  // what puts a 45 degree seam in every corner. And each is painted with
  // its grain running along ITS OWN length: a frame with one grain
  // direction is a photograph of a plank with a hole in it.
  // Each piece is painted in ITS OWN box, not the frame's. Passing the
  // whole frame was the first version's bug and it is invisible in code:
  // the across-gradient then ran over 600px and was flat inside a 25px
  // strip, and the grain — spaced by the box's width — put eleven lines
  // in a rail that needed sixty. The rails came out as plain brown bands.
  const pieces = [
    {
      box: { x: out.x, y: out.y, w: out.w, h: wood },
      pts: [[out.x, out.y], [out.x + out.w, out.y], [nose.x + nose.w, nose.y], [nose.x, nose.y]],
      axis: "h",
      flip: false,
    },
    {
      box: { x: out.x, y: nose.y + nose.h, w: out.w, h: wood },
      pts: [[out.x, out.y + out.h], [out.x + out.w, out.y + out.h], [nose.x + nose.w, nose.y + nose.h], [nose.x, nose.y + nose.h]],
      axis: "h",
      flip: true,
    },
    {
      box: { x: out.x, y: out.y, w: wood, h: out.h },
      pts: [[out.x, out.y], [out.x, out.y + out.h], [nose.x, nose.y + nose.h], [nose.x, nose.y]],
      axis: "v",
      flip: false,
    },
    {
      box: { x: nose.x + nose.w, y: out.y, w: wood, h: out.h },
      pts: [[out.x + out.w, out.y], [out.x + out.w, out.y + out.h], [nose.x + nose.w, nose.y + nose.h], [nose.x + nose.w, nose.y]],
      axis: "v",
      flip: true,
    },
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

  // the mitre seams, as hairlines
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
  // outer edge: a lit top arris and a dark underside, so the frame has
  // thickness rather than being a painted border
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

  // --- rails that are not wood -------------------------------------------
  // Painted OVER the wood rather than instead of it, which is not a
  // shortcut: the wood pass is what establishes the mitred trapezoids and
  // the outer arris, and every theme wants those. Only the fill changes.
  if (THEME.rails !== "wood") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(out.x, out.y, out.w, out.h);
    ctx.rect(nose.x + nose.w, nose.y, -nose.w, nose.h); // reverse winding = hole
    const gr = ctx.createLinearGradient(out.x, out.y, out.x, out.y + out.h);
    if (THEME.rails === "steel") {
      gr.addColorStop(0, COLORS.railLight);
      gr.addColorStop(0.45, COLORS.rail);
      gr.addColorStop(1, COLORS.railDark);
    } else {
      // "bezel": no material at all, just a dark frame around the bed.
      gr.addColorStop(0, COLORS.railLight);
      gr.addColorStop(0.6, COLORS.rail);
      gr.addColorStop(1, COLORS.railDark);
    }
    ctx.fillStyle = gr;
    ctx.fill("evenodd");
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(out.x, out.y + out.h);
    ctx.lineTo(out.x, out.y);
    ctx.lineTo(out.x + out.w, out.y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.moveTo(out.x + out.w, out.y);
    ctx.lineTo(out.x + out.w, out.y + out.h);
    ctx.lineTo(out.x, out.y + out.h);
    ctx.stroke();
    ctx.restore();
  }

  // --- the cushion face --------------------------------------------------
  ctx.save();
  ctx.beginPath();
  ctx.rect(nose.x, nose.y, nose.w, nose.h);
  ctx.rect(bed.x + bed.w, bed.y, -bed.w, bed.h); // reverse winding = hole
  ctx.fillStyle = COLORS.cushion;
  ctx.fill("evenodd");
  // The cloth over the cushion catches light along the top of the slope
  // and goes dark at the nose. Four ramps, one per side.
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
  paintCloth(ctx, bed, {
    base: COLORS.cloth,
    lamp: COLORS.clothLamp,
    edge: COLORS.clothDark,
  });

  // the nose itself: the line the player aims at, so it is drawn and not
  // left as the edge of a fill
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(1, railPx * 0.05);
  ctx.strokeRect(bed.x, bed.y, bed.w, bed.h);
  ctx.restore();

  drawSpots(ctx, L);
  drawSights(ctx, L, out, nose, wood);

  // --- the theme's own finishing passes ----------------------------------
  // All of them are static, which is why they live in here: paintTable's
  // output is cached once per size, so a lamp pool costs nothing per
  // frame no matter how expensive the gradient is.

  // A fillet is the thin metal line where the wood meets the cushion.
  if (THEME.fillet) {
    ctx.save();
    ctx.strokeStyle = THEME.fillet;
    ctx.lineWidth = Math.max(1, wood * 0.07);
    ctx.strokeRect(nose.x, nose.y, nose.w, nose.h);
    ctx.restore();
  }
  // An inlay runs round the OUTER face of the rail, inset from its edge.
  if (THEME.inlay) {
    ctx.save();
    ctx.strokeStyle = THEME.inlay;
    ctx.lineWidth = Math.max(1.2, wood * 0.055);
    ctx.shadowColor = THEME.inlay;
    ctx.shadowBlur = wood * 0.25;
    const inset = wood * 0.34;
    ctx.strokeRect(out.x + inset, out.y + inset, out.w - inset * 2, out.h - inset * 2);
    ctx.restore();
  }
  // The lamp. Clipped to the bed, because a shade hanging over a table
  // lights the cloth and not the woodwork.
  if (THEME.lamp) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(bed.x, bed.y, bed.w, bed.h);
    ctx.clip();
    const cx = bed.x + bed.w / 2;
    const cy = bed.y + bed.h / 2;
    const rr = Math.max(bed.w, bed.h) * 0.62;
    const lg = ctx.createRadialGradient(cx, cy, rr * 0.12, cx, cy, rr);
    lg.addColorStop(0, `rgba(255,244,214,${THEME.lamp})`);
    lg.addColorStop(0.55, `rgba(255,240,205,${THEME.lamp * 0.28})`);
    lg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(bed.x, bed.y, bed.w, bed.h);
    // Past a certain brightness the pool needs a matching fall-off or it
    // reads as a bright patch rather than as a light in a dark room.
    if (THEME.lamp >= 0.3) {
      const dk = ctx.createRadialGradient(cx, cy, rr * 0.35, cx, cy, rr * 1.15);
      dk.addColorStop(0, "rgba(0,0,0,0)");
      dk.addColorStop(1, `rgba(0,0,0,${THEME.lamp * 0.85})`);
      ctx.fillStyle = dk;
      ctx.fillRect(bed.x, bed.y, bed.w, bed.h);
    }
    ctx.restore();
  }
  if (THEME.warm) {
    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = THEME.warm;
    ctx.fillRect(out.x, out.y, out.w, out.h);
    ctx.restore();
  }
  if (THEME.vignette) {
    ctx.save();
    const w = L.width;
    const h = L.height;
    const vg = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.25,
      w / 2, h / 2, Math.max(w, h) * 0.75
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, `rgba(0,0,0,${THEME.vignette})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

/** Sights. Seven along each long rail and three along each short one is
 * the real thing, and it is not decoration: every cushion system a player
 * knows is counted off these. */
function drawSights(ctx, L, out, nose, wood) {
  const size = Math.max(2, wood * 0.2);
  const mid = wood * 0.5;
  const put = (x, y) => paintSight(ctx, x, y, size, THEME.sight);
  for (let i = 1; i <= 7; i++) {
    const t = i / 8;
    const x = nose.x + t * nose.w;
    put(x, out.y + mid);
    put(x, out.y + out.h - mid);
  }
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const y = nose.y + t * nose.h;
    put(out.x + mid, y);
    put(out.x + out.w - mid, y);
  }
}

/** The three spots on the long axis plus the head string — where the
 * balls are placed for an opening shot, so they have to be visible. */
function drawSpots(ctx, L) {
  ctx.save();
  ctx.strokeStyle = COLORS.clothLine;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  const hs = toPx(L, TABLE_LENGTH / 4, 0);
  const hs2 = toPx(L, TABLE_LENGTH / 4, TABLE_WIDTH);
  ctx.beginPath();
  ctx.moveTo(hs.x, hs.y);
  ctx.lineTo(hs2.x, hs2.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  for (const t of [0.25, 0.5, 0.75]) {
    const p = toPx(L, TABLE_LENGTH * t, TABLE_WIDTH / 2);
    const r = Math.max(1.2, L.scale * 0.0055);
    // A spot is a paper disc glued to the cloth, not a drawn dot: it has
    // an edge and it catches the lamp.
    // Dimmed and small: a bright cream disc on green is read as a BALL
    // in peripheral vision, which is the one thing a spot must never be.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.arc(p.x, p.y + r * 0.3, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#bfae8e";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/**
 * A rounded-rectangle PATH.
 *
 * Not ctx.roundRect(): that is new enough that some of the browsers this
 * game has to survive do not have it, and a missing method here throws
 * inside the frame loop, which stops requestAnimationFrame, which black-
 * screens the whole game. This has cost this project a debugging session
 * once already.
 */
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

export function drawBalls(ctx, L, balls) {
  const r = BALL_RADIUS * L.scale;
  // The device-pixel radius, because that is what the sprite is built at.
  // Rounded so a table that is 312.4 pixels per metre one frame and 312.6
  // the next does not rebuild three sprites for nothing.
  // getTransform() is not in every Safari this game will meet, and an
  // exception here kills the frame loop and black-screens the game —
  // which is exactly how roundRect() took the whole board out once.
  const dpr = (ctx.getTransform ? ctx.getTransform().a : 0) || window.devicePixelRatio || 1;
  const px = Math.max(3, Math.round(r * dpr));

  // Shadows first, ALL of them, so a ball never casts onto its neighbour.
  // Two per ball and they are doing different jobs. The wide one is the
  // lamp's shadow, thrown away from the light and soft because the shade
  // over a billiard table is large. The tight one is ambient occlusion at
  // the contact point — the cloth right under the ball can see almost
  // nothing of the room — and it is the one that GLUES the ball down.
  // With only the soft shadow a ball hovers a centimetre off the table.
  ctx.save();
  for (const b of balls) {
    const p = toPx(L, b.x, b.y);
    const cast = ctx.createRadialGradient(
      p.x + r * 0.3,
      p.y + r * 0.44,
      r * 0.25,
      p.x + r * 0.3,
      p.y + r * 0.44,
      r * 1.15
    );
    cast.addColorStop(0, "rgba(4,26,18,0.36)");
    cast.addColorStop(0.55, "rgba(4,26,18,0.15)");
    cast.addColorStop(1, "rgba(4,26,18,0)");
    ctx.fillStyle = cast;
    ctx.fillRect(p.x - r * 1.6, p.y - r * 1.6, r * 3.2, r * 3.2);

    const ao = ctx.createRadialGradient(
      p.x + r * 0.05,
      p.y + r * 0.12,
      0,
      p.x + r * 0.05,
      p.y + r * 0.12,
      r * 0.88
    );
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
  for (const b of balls) {
    const p = toPx(L, b.x, b.y);
    const sp = ballSprite(b.color, px);
    // The sprite is square and one sprite-pixel wider than the ball on
    // each side, for the antialiased edge to live in.
    const half = (r * sp.size) / (sp.R * 2);
    ctx.drawImage(sp.canvas, p.x - half, p.y - half, half * 2, half * 2);
  }
  ctx.restore();
}

function ballColor(name) {
  if (name === "red")
    return { body: [207, 47, 42], shadow: [127, 28, 27], sheen: [255, 236, 232] };
  if (name === "yellow")
    return { body: [242, 197, 61], shadow: [152, 116, 32], sheen: [255, 250, 232] };
  return { body: [247, 244, 236], shadow: [156, 153, 145], sheen: [255, 255, 255] };
}

// --- the ball sprite -----------------------------------------------------
//
// WHY A PER-PIXEL SPRITE AND NOT SIX GRADIENTS
//
// The old ball was a radial gradient, a bounce gradient, an arc for the
// rim and two ellipses for the highlight, and the report on it was exact:
// "it looks nice until you look, and then it is just a line at the
// bottom". That is what stacking 2D primitives on a circle gets you.
// Every one of those pieces is a guess at what a shading term LOOKS like,
// and the guesses do not agree with each other — the rim was an arc over
// part of the edge, so the ball was round on one side and flat on the
// other; the terminator was a gradient centred on the ball rather than on
// the light, so the dark side sat in a ring instead of a crescent.
//
// The terms are cheap to just COMPUTE. For a sphere seen from directly
// above, the surface normal at a point (u,v) from the centre is
// (u, v, sqrt(1 - u^2 - v^2)) with u,v in radii — no projection, no
// matrices — and from that every term below is one dot product. What it
// buys is that they agree: the terminator, the rim and the highlight are
// all reading the same normal, so the ball is round everywhere at once.
//
// It is affordable because a ball sprite depends only on its colour and
// its radius. Three colours, one radius per layout: three sprites, built
// once and blitted every frame after. That is FEWER draw calls per frame
// than the gradients it replaces, not more.
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

/**
 * Render one ball to an offscreen canvas, shaded per pixel.
 *
 * `px` is the radius in DEVICE pixels; the sprite is built at SS times
 * that and drawn back down, which is where the smooth silhouette comes
 * from. A ball is 10 CSS pixels across on a phone, so its edge is the
 * single most visible thing about it and cannot be left to the
 * rasteriser.
 */
function ballSprite(colour, px) {
  const SS = 2;
  const key = `${colour}@${px}`;
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
  const { body, shadow, sheen } = ballColor(colour);
  const mid = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5 - mid) / R;
      const v = (y + 0.5 - mid) / R;
      const d2 = u * u + v * v;
      const i = (y * size + x) * 4;
      if (d2 >= 1.16) continue;
      const d = Math.sqrt(d2);
      // One pixel of coverage at the silhouette, in sprite pixels.
      const alpha = 1 - smoothstep(1 - 1.1 / R, 1 + 0.4 / R, d);
      if (alpha <= 0) continue;
      // The normal. Clamped just inside 1 so the very rim still has a
      // z to work with instead of collapsing to a flat disc edge.
      const nz = Math.sqrt(Math.max(0.0025, 1 - Math.min(d2, 1)));

      // Diffuse from the lamp, wrapped. A hard N.L terminator is right
      // for a matte ball on a black table; a real one sits under a big
      // soft shade, so the falloff is widened and lifted rather than
      // cut at zero.
      const nl = u * LAMP[0] + v * LAMP[1] + nz * LAMP[2];
      const lam = clamp01((nl + 0.17) / 1.17) ** 1.5;
      // Fill and cloth bounce, both weak, both from below.
      const fill = clamp01(u * FILL[0] + v * FILL[1] + nz * FILL[2]) ** 2 * 0.22;
      const bnc = clamp01(u * BOUNCE[0] + v * BOUNCE[1] + nz * BOUNCE[2]) ** 2 * (1 - lam) * 0.5;

      const shade = clamp01(0.07 + lam * 0.98 + fill);
      let rr = shadow[0] + (body[0] - shadow[0]) * shade;
      let gg = shadow[1] + (body[1] - shadow[1]) * shade;
      let bb = shadow[2] + (body[2] - shadow[2]) * shade;
      rr += CLOTH_BOUNCE[0] * bnc * 0.28;
      gg += CLOTH_BOUNCE[1] * bnc * 0.34;
      bb += CLOTH_BOUNCE[2] * bnc * 0.28;

      // The turn away toward the silhouette. It starts at a fifth of the
      // radius and is worth only 18%, and that is the whole point: at
      // 0.58-0.97 and 40% it was a dark BAND about two pixels wide on a
      // phone, and a band that narrow reads as an inked outline rather
      // than a surface curving away. Spread across four fifths of the
      // ball it is a gradient, which is what it is on a real one. The
      // shadow colours were lifted toward their bodies for the same
      // reason: the darkest tone on the ball should still be the ball's
      // own colour.
      const turn = 1 - 0.18 * smoothstep(0.2, 1.0, d);
      rr *= turn;
      gg *= turn;
      bb *= turn;

      // Fresnel. Every glancing surface reflects, so this is a ring all
      // the way round — but weighted toward the SHADOW side, because that
      // is where there is dark body colour for it to show against.
      //
      // The exponent is 2, not the 4-5 the physics would suggest, and the
      // reason is the pixel budget: at 4.5 the band that reads lives
      // inside the last 2% of the radius, which is HALF A PIXEL on a
      // phone. A rim nobody can see is a rim that is not there. Two
      // spreads it from about 80% of the radius outward, which is a real
      // pixel at every size this game draws.
      const fres = (1 - nz) ** 2.0 * (0.3 + 0.7 * (1 - lam));
      rr += sheen[0] * fres * 0.26;
      gg += sheen[1] * fres * 0.26;
      bb += sheen[2] * fres * 0.26;

      // Specular. Two lights, two highlights, and the second one is not
      // decoration: a single catchlight reads as a sticker, and the pair
      // is what says the ball is polished and in a room.
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
  spriteCache.set(key, { canvas: c, size, R });
  // Three colours times one radius. If a resize leaves stale entries
  // behind, drop the lot rather than growing without bound.
  if (spriteCache.size > 12) {
    for (const k of [...spriteCache.keys()].slice(0, 6)) spriteCache.delete(k);
  }
  return spriteCache.get(key);
}

/**
 * The aiming aid: the cue line, where it first meets something, and which
 * way that something will leave.
 *
 * Deliberately a RAY CAST and not a run of the simulator. A full
 * simulation would draw the true path including spin, and drawing the
 * true path is the same as playing the shot for the player — there is
 * nothing left to judge. A straight line to first contact plus the line
 * of centres is what a player can already see for themselves from the
 * table; it removes the eyestrain, not the skill. (It also, not
 * incidentally, costs nothing per frame.)
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
    if (b === cue) continue;
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

  // Cushions, so the line always ends somewhere real.
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
  return { hit: { x: cue.x + nx * wallT, y: cue.y + ny * wallT }, target: null, objDir: null };
}

/**
 * The guide: where the cue ball goes, where it makes contact, and where
 * the object ball leaves from. Always drawn at full strength — the line
 * is never in an in-between state now that setting it is a control of its
 * own, so there is nothing for a faint version to mean.
 */
export function drawAim(ctx, L, cue, aim) {
  if (!aim) return;
  const r = BALL_RADIUS * L.scale;
  const from = toPx(L, cue.x, cue.y);
  const to = toPx(L, aim.hit.x, aim.hit.y);

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.setLineDash([r * 0.5, r * 0.45]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);

  if (aim.target) {
    // Ghost ball: where the cue ball would be at the moment of contact.
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
    ctx.stroke();

    // The object ball leaves along the line of centres.
    const d = dirToScreen(L, aim.objDir.x, aim.objDir.y);
    const tp = toPx(L, aim.target.x, aim.target.y);
    ctx.strokeStyle = "rgba(255,220,140,0.8)";
    ctx.beginPath();
    ctx.moveTo(tp.x, tp.y);
    ctx.lineTo(tp.x + d.x * r * 4.5, tp.y + d.y * r * 4.5);
    ctx.stroke();
  }
  ctx.restore();

  // NO POWER READING HERE. There was a collar drawn round the ball and a
  // percentage beside it, both for the same reason: the pull was made on
  // the cloth, so the reading belonged on the cloth. The pull is a fader
  // now, and both of them followed it there — see drawPowerLane(). What
  // is left on the table is the line, the ghost ball and the object
  // ball's departure, which is the shot and nothing about the control.
}

/**
 * The cue.
 *
 * Worth drawing for a reason beyond decoration. This game's control is a
 * pull-back drag inherited from StoneFlick, where it meant a finger
 * flicking a stone — and a stick lying behind the ball is what tells a
 * new player that the SAME gesture now means a stroke, before any text
 * does. It also puts the aim line's origin somewhere physical: without
 * it, a dashed line simply emanates from a ball for no visible reason.
 *
 * Three things it shows at once:
 *   - direction, by lying along the shot line;
 *   - power, by how far back it is drawn (this is the pull the player is
 *     performing, mirrored);
 *   - side spin, by shifting ACROSS the line by the tip offset, so the
 *     tip really is pointing at the contact point the dial selected.
 *
 * Follow and draw are deliberately NOT shown here. From directly above, a
 * cue raised or lowered on the vertical face of the ball looks exactly
 * like one that is not — there is no honest way to draw it in this
 * projection, and faking it with a shifted cue would contradict the dial.
 */
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

/** The cue's materials, each an across-the-barrel gradient: the lit side,
 * the body, and the shaded side. Grouped into one exported object so a
 * table theme can bring its own cue - a blackened butt belongs with steel
 * rails and a rosewood one with mahogany, and the alternative is four
 * module constants nothing outside this file can reach. */
export const CUE = {
  shaft: [
    [0, "#8a6a3e"],
    [0.16, "#e8cfa2"],
    [0.34, "#fbf0d8"],
    [0.62, "#dcc094"],
    [1, "#7d5e35"],
  ],
  butt: [
    [0, "#1b0d07"],
    [0.18, "#5c2d18"],
    [0.34, "#8a4526"],
    [0.62, "#4a2413"],
    [1, "#160a05"],
  ],
  wrap: [
    [0, "#12100e"],
    [0.2, "#3a352f"],
    [0.36, "#565049"],
    [0.62, "#2c2823"],
    [1, "#0e0c0a"],
  ],
  collar: [
    [0, "#6b5320"],
    [0.3, "#d8b45c"],
    [0.5, "#f4e3ac"],
    [0.75, "#a8873c"],
    [1, "#4a3814"],
  ],
  ferrule: [
    [0, "#b9ac96"],
    [0.3, "#f7f3e8"],
    [0.6, "#efe8d8"],
    [1, "#9a927f"],
  ],
  tip: [
    [0, "#123a5c"],
    [0.35, "#2f6ea8"],
    [0.7, "#2a5f92"],
    [1, "#0d2942"],
  ],
  /** The fine lines along the shaft. Transparent for a cue with no grain. */
  grain: "#7a5a32",
};

/** The structural half of a theme — everything that is not a colour COLORS
 * or CUE already holds. Set by applyTheme() and read by paintTable(). */
let THEME = themeById(DEFAULT_THEME);

/**
 * Repaint the world in another theme.
 *
 * COLORS and CUE are mutated in place rather than replaced because every
 * other module in the game holds a reference to them; swapping the object
 * would leave half the renderer painting the old table. Both caches go
 * with it — the table is a cached bitmap and the balls are cached sprites
 * keyed by colour and radius, and neither key mentions the theme.
 */
export function applyTheme(id) {
  const t = themeById(id);
  THEME = t;
  Object.assign(COLORS, t.colors);
  Object.assign(CUE, t.cue);
  tableCache = null;
  spriteCache.clear();
  return t;
}

/**
 * The cue.
 *
 * Worth drawing for a reason beyond decoration. This game's control is a
 * pull-back drag inherited from StoneFlick, where it meant a finger
 * flicking a stone — and a stick lying behind the ball is what tells a
 * new player that the SAME gesture now means a stroke, before any text
 * does. It also puts the aim line's origin somewhere physical.
 *
 * Three things it shows at once:
 *   - direction, by lying along the shot line;
 *   - power, by how far back it is drawn;
 *   - side spin, by shifting ACROSS the line by the tip offset, so the
 *     tip really is pointing at the contact point the dial selected.
 *
 * Follow and draw are deliberately NOT shown. From directly above, a cue
 * raised or lowered on the vertical face of the ball looks exactly like
 * one that is not — there is no honest way to draw it in this projection,
 * and faking it with a shifted cue would contradict the dial.
 *
 * The build of the cue is the real thing because the proportions are what
 * the eye knows: a 13mm tip and a 30mm butt against a 61.5mm ball, an
 * ivory ferrule, a joint a little past halfway, a linen wrap where the
 * hand goes. Get those wrong and it reads as a pointer, not a cue.
 */
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

  // A real cue is 1.45m against a 1.42m table width, which drawn in full
  // reaches most of the way across the cloth and reads as a plank. 0.95m
  // keeps the proportion believable while leaving the table visible —
  // the same compromise every billiards game makes.
  const cueLen = 0.95 * L.scale;
  // The draw-back distance tracks the PULL, not the power — the hand's
  // travel, not what it bought. This is the change that makes power
  // legible. Against the old power * 3.6, the whole 22-45% band that
  // every stage solution lives in moved the cue five pixels: the player
  // was choosing a speed with no feedback at all. Against the pull it
  // moves about thirty, because the pull is what their thumb is doing.
  const pull = pullForPower(power);
  const gap = r * (1.15 + pull * 12);
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

/**
 * The two things that are not the table: the aim nudge, and the power
 * lane.
 *
 * The lane is the larger of the two on purpose. It is a control every
 * shot passes through, so it is drawn like one — a track with a fill and
 * a handle, the shape every volume slider on every device has already
 * taught this player to read. The nudges beside it stay quiet: they are
 * for the shot that needs a fifth of a degree, and a control that shouts
 * at everyone for the benefit of the few who need it is a control that
 * has made the game look complicated.
 *
 * Both are drawn on the canvas rather than as DOM elements because they
 * sit in a strip whose position is computed from the table's layout, and
 * keeping that arithmetic in one place beats synchronising an absolutely
 * positioned overlay with it on every resize.
 */
export function drawControls(ctx, L, { held, power = 0, live = false }) {
  const c = controlsLayout(L);
  const unit = c.left.w;

  const arrow = (b, dir, pressed) => {
    ctx.save();
    ctx.fillStyle = pressed ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)";
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, b.cx - b.w / 2, b.cy - b.h / 2, b.w, b.h, Math.min(b.w, b.h) * 0.28);
    ctx.fill();
    ctx.stroke();
    // dir is which way the aim turns, so the apex points that way.
    ctx.fillStyle = "rgba(232,238,240,0.85)";
    const s = unit * 0.26;
    ctx.beginPath();
    ctx.moveTo(b.cx - dir * s * 0.7, b.cy - s);
    ctx.lineTo(b.cx - dir * s * 0.7, b.cy + s);
    ctx.lineTo(b.cx + dir * s * 0.75, b.cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  arrow(c.left, -1, held === "left");
  arrow(c.right, 1, held === "right");
  drawPowerLane(ctx, c.lane, power, live);
}

/**
 * The power lane: a milled channel with a brass slug in it.
 *
 * Six treatments were drawn and compared side by side — the generic
 * amber slider it replaces, this, an ivory scale with no fill, the cue's
 * own butt as the handle, a segmented heat bar, and stitched leather.
 * This one won on two counts. It is made of the materials the table is
 * already made of, so it reads as part of the room rather than as a
 * widget laid over it; and of the six it is the one that most obviously
 * wants to be GRABBED, which is the whole job: a player who does not
 * work out that this thing is pulled never plays a shot at all.
 *
 * THE COLOUR IS THREE MATERIALS IN THEIR RIGHT ROLES, and the first
 * version had two of them wrong. It filled the channel with brass, and
 * brass was already spoken for twice over — the primary button and the
 * yellow ball are both in that hue — so the bar arrived as a third claim
 * on the same colour and lost to both. It also put the largest warm area
 * on the screen directly under a green cloth, where the two fought for
 * the eye across a hue gap wide enough to buzz.
 *
 * So: the channel is walnut, like the rails, and dark enough to sit
 * back. The fill is IVORY, the material of the balls and the sights —
 * neutral, so it cannot fight the cloth, and light, so it does the
 * legibility work with value instead of hue. And the collar keeps the
 * brass, which is now the only brass in the strip and therefore reads as
 * exactly one thing: the part you take hold of.
 *
 * The one liberty is a warm gradient ALONG the fill, transparent at the
 * soft end and amber at the hard one. It gives the top of the range a
 * temperature without a threshold, an alarm colour, or a second hue.
 *
 * Everything here is in service of that second point.
 *
 * The corners are only a third of the thickness, not a full pill. A pill
 * is a pipe, and a pipe is a thing that HOLDS something; a slot with
 * squarer ends is a track, and a track is a thing something SLIDES in.
 *
 * The collar is knurled, wider than the channel, and it overhangs. Every
 * one of those says "this part is separate from that part", which is
 * what a grip is.
 *
 * And the empty travel carries chevrons pointing the way the collar has
 * to go, brightest just ahead of it and fading out. They breathe while
 * the bar is at zero and nothing has been touched, then go still — an
 * invitation that stops asking once it has been accepted.
 *
 * The fill is positioned by pullForPower(), not by the power itself. The
 * lane's travel is a PULL and the power curve is deliberately not linear
 * in it, so laying the fill out by power would put the collar somewhere
 * the finger is not.
 */
function drawPowerLane(ctx, lane, power, live) {
  const thick = lane.vertical ? lane.w : lane.h;
  const t = pullForPower(Math.min(1, Math.max(0, power)));
  const h = laneToPx(lane, t);
  const radius = thick * 0.33;
  // Along the lane, pointing at more power.
  const ax = lane.vertical ? 0 : 1;
  const ay = lane.vertical ? -1 : 0;

  // The label's geometry is worked out here, before anything is drawn,
  // because the chevrons have to know where it is. At zero the label sits
  // over the empty channel — exactly where the first chevron wants to be
  // — and the two drawn on top of each other read as neither.
  // THE NUMBER IS THE BAR'S POSITION, NOT THE SPEED.
  //
  // It used to print the power, and the power is deliberately not linear in
  // the travel — the working range of speeds gets nearly three quarters of
  // the lane so it can be aimed at. So a bar that was visibly 85% full read
  // "60%", and the gap widens toward the top: at the far end the last few
  // pixels of travel carry a whole quarter of the range. A gauge whose
  // number disagrees with its own fill is read as broken, and it is right
  // to read it that way — one of the two is lying.
  //
  // Printing the position fixes it in the only direction that keeps
  // anything: the curve is what makes the control usable and must stay,
  // and the number's job is to make a stroke repeatable, which a position
  // does exactly as well as a speed. Now the fill, the handle, the marks
  // and the number all say the same thing.
  const label = `${Math.round(t * 100)}%`;
  const face = (px) => `700 ${px.toFixed(1)}px ui-sans-serif, system-ui, sans-serif`;
  let fs = Math.max(10, thick * 0.5);
  ctx.font = face(fs);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // A vertical lane is only as wide as it is thick and the label runs
  // ACROSS it. Measured against "100%" rather than the current reading,
  // so the type does not resize itself as the thumb moves.
  if (lane.vertical) {
    const widest = ctx.measureText("100%").width;
    const across = lane.w * 0.8;
    if (widest > across) {
      fs *= across / widest;
      ctx.font = face(fs);
    }
  }
  const gw = thick * 1.02;
  const gl = thick * 0.62;
  const labelHalf = (lane.vertical ? fs * 0.75 : ctx.measureText(label).width / 2) + fs * 0.4;
  const labelAt = Math.max(gl, gw) / 2 + labelHalf + fs * 0.2;
  // Behind the collar, over the fill, whenever there is fill to sit on.
  const behind = (lane.vertical ? lane.y + lane.h - h.y : h.x - lane.x) > labelAt + thick / 2;

  ctx.save();

  // The channel: a recess, which means a dark face with a lit lower lip
  // and a shadowed upper one. Milled out of the same dark walnut the
  // rails are.
  roundRect(ctx, lane.x, lane.y, lane.w, lane.h, radius);
  const bore = lane.vertical
    ? ctx.createLinearGradient(lane.x, 0, lane.x + lane.w, 0)
    : ctx.createLinearGradient(0, lane.y, 0, lane.y + lane.h);
  bore.addColorStop(0, "#080604");
  bore.addColorStop(0.55, "#1d1811");
  bore.addColorStop(1, "#0d0a07");
  ctx.fillStyle = bore;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // A hairline of walnut light on the outside, so the channel reads as
  // cut INTO something rather than laid on top of it.
  roundRect(ctx, lane.x - 1, lane.y - 1, lane.w + 2, lane.h + 2, radius + 1);
  ctx.strokeStyle = "rgba(150,120,84,0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();
  roundRect(ctx, lane.x, lane.y, lane.w, lane.h, radius);

  ctx.save();
  ctx.clip();

  // Ivory, lit across the barrel rather than along it: dark edge, bright
  // line a third of the way in, darker far edge. That across-the-piece
  // gradient is the only thing that makes a flat fill read as a round
  // bar, and it is the same trick the cue and the balls are drawn with.
  const bar = lane.vertical
    ? ctx.createLinearGradient(lane.x, 0, lane.x + lane.w, 0)
    : ctx.createLinearGradient(0, lane.y, 0, lane.y + lane.h);
  bar.addColorStop(0, "#5b5347");
  bar.addColorStop(0.3, "#c8bfa9");
  bar.addColorStop(0.5, "#efe8d6");
  bar.addColorStop(0.74, "#b4ab95");
  bar.addColorStop(1, "#4e483e");
  const fillFrom = laneToPx(lane, 0);
  const fillTo = laneToPx(lane, 1);
  const fill = (style) => {
    ctx.fillStyle = style;
    if (lane.vertical) ctx.fillRect(lane.x, h.y, lane.w, lane.y + lane.h - h.y);
    else ctx.fillRect(lane.x, lane.y, h.x - lane.x, lane.h);
  };
  fill(bar);
  // And the temperature, along the length: nothing at the soft end,
  // amber at the hard one. Drawn over the whole fill rather than past a
  // threshold, so there is no line where the bar changes its mind.
  const heat = ctx.createLinearGradient(fillFrom.x, fillFrom.y, fillTo.x, fillTo.y);
  heat.addColorStop(0, "rgba(214,150,60,0)");
  heat.addColorStop(0.55, "rgba(214,150,60,0.1)");
  heat.addColorStop(0.85, "rgba(206,116,52,0.4)");
  heat.addColorStop(1, "rgba(196,84,48,0.62)");
  fill(heat);

  // Chevrons in the empty travel: the one part of this control that is
  // there to be read rather than used.
  const end = laneToPx(lane, 1);
  const runway = Math.hypot(end.x - h.x, end.y - h.y);
  const step = thick * 0.58;
  const wing = thick * 0.2;
  const idle = power < 0.001;
  // A slow breath while nothing is set. performance.now() rather than a
  // stored phase, so it does not matter which frame this is called on.
  const pulse = idle ? 0.55 + 0.45 * Math.sin(performance.now() / 620) : 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.5, thick * 0.09);
  const nx = -ay;
  const ny = ax;
  const clear = behind ? 0 : labelAt + labelHalf;
  const first = Math.max(1, Math.ceil(clear / step));
  for (let k = first; k * step < runway - thick * 0.35; k++) {
    const cx = h.x + ax * step * k;
    const cy = h.y + ay * step * k;
    // Fading from the FIRST one drawn, not from the collar. Counting
    // from the collar meant that at zero — where the label pushes the
    // chevrons three places along — every one of them came out at zero
    // alpha, and the one moment the invitation matters most was the one
    // moment it was invisible.
    const fade = Math.max(0, 1 - (k - first) * 0.34);
    ctx.strokeStyle = `rgba(232,226,208,${(0.42 * fade * pulse).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(cx - ax * wing * 0.5 + nx * wing, cy - ay * wing * 0.5 + ny * wing);
    ctx.lineTo(cx + ax * wing * 0.5, cy + ay * wing * 0.5);
    ctx.lineTo(cx - ax * wing * 0.5 - nx * wing, cy - ay * wing * 0.5 - ny * wing);
    ctx.stroke();
  }
  ctx.restore();

  // The collar. Wider than the channel and overhanging it, because the
  // overhang is what says "separate part, made to be held".
  const bx = lane.vertical ? h.x - gw / 2 : h.x - gl / 2;
  const by = lane.vertical ? h.y - gl / 2 : h.y - gw / 2;
  const bw = lane.vertical ? gw : gl;
  const bh = lane.vertical ? gl : gw;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = thick * 0.28;
  ctx.shadowOffsetY = thick * 0.06;
  roundRect(ctx, bx, by, bw, bh, Math.min(bw, bh) * 0.3);
  const collar = lane.vertical
    ? ctx.createLinearGradient(bx, 0, bx + bw, 0)
    : ctx.createLinearGradient(0, by, 0, by + bh);
  collar.addColorStop(0, "#5c4419");
  collar.addColorStop(0.26, live ? "#fbe6b4" : "#e8cf98");
  collar.addColorStop(0.52, "#bd9750");
  collar.addColorStop(0.8, "#7d5c22");
  collar.addColorStop(1, "#3d2b10");
  ctx.fillStyle = collar;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  roundRect(ctx, bx, by, bw, bh, Math.min(bw, bh) * 0.3);
  ctx.stroke();

  // Knurling: five grooves across the grip. The one detail that turns a
  // brass block into something a hand is meant to close on.
  ctx.strokeStyle = "rgba(60,42,16,0.5)";
  ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    if (lane.vertical) {
      const y = h.y + i * gl * 0.17;
      ctx.moveTo(bx + bw * 0.14, y);
      ctx.lineTo(bx + bw * 0.86, y);
    } else {
      const x = h.x + i * gl * 0.17;
      ctx.moveTo(x, by + bh * 0.14);
      ctx.lineTo(x, by + bh * 0.86);
    }
    ctx.stroke();
  }

  // The number, inside the track.
  //
  // It used to sit on the cloth beside the cue ball, because that was
  // where the pull was made. The pull is here now and the reading came
  // with it. INSIDE the track rather than beside the collar: beside it,
  // the label rides into whatever the lane happens to be next to — on a
  // phone that is the spin dial, and at 37% the tag landed underneath
  // it. Inside, it cannot collide with anything the layout will ever put
  // there.
  //
  // It sits BEHIND the collar, over the fill, so it never covers the
  // empty travel the thumb is heading into — and it is dark there,
  // because dark on ivory is what an engraved number looks like.
  const lx = lane.vertical ? h.x : h.x - (behind ? labelAt : -labelAt);
  const ly = lane.vertical ? h.y + (behind ? labelAt : -labelAt) : h.y;
  if (behind) {
    // Engraved into the ivory: a light lower edge and a dark face.
    ctx.fillStyle = "rgba(255,252,244,0.4)";
    ctx.fillText(label, lx, ly + fs * 0.1);
    ctx.fillStyle = "rgba(44,38,28,0.88)";
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillText(label, lx, ly + fs * 0.12);
    ctx.fillStyle = "rgba(224,216,196,0.85)";
  }
  ctx.fillText(label, lx, ly + fs * 0.04);
  ctx.restore();
}

/** The 당점 dial: a cue ball seen face-on with the tip's contact point on
 * it. Its crosshair is the only place the game explains follow/draw/side
 * without words. */
export function drawSpinDial(ctx, L, tip, maxOffset) {
  const d = spinDialLayout(L);
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.arc(d.cx, d.cy, d.r * 1.16, 0, Math.PI * 2);
  ctx.fill();

  const g = ctx.createRadialGradient(
    d.cx - d.r * 0.35,
    d.cy - d.r * 0.4,
    d.r * 0.08,
    d.cx,
    d.cy,
    d.r * 1.05
  );
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.5, COLORS.white);
  g.addColorStop(1, "#a8a396");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(d.cx, d.cy, d.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(d.cx - d.r * 0.8, d.cy);
  ctx.lineTo(d.cx + d.r * 0.8, d.cy);
  ctx.moveTo(d.cx, d.cy - d.r * 0.8);
  ctx.lineTo(d.cx, d.cy + d.r * 0.8);
  ctx.stroke();

  const px = d.cx + (tip.side / maxOffset) * d.r;
  const py = d.cy - (tip.vertical / maxOffset) * d.r;
  ctx.fillStyle = "#1c6fd0";
  ctx.beginPath();
  ctx.arc(px, py, d.r * 0.19, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}
