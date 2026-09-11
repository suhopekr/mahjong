// game/surface.js
// The materials: cloth, hardwood, mother-of-pearl. Painters only — they
// take a 2D context and a rectangle and put a surface in it.
//
// WHY THIS FILE EXISTS, AND THE ONE IDEA IN IT
// StoneFlick hit this exact wall and wrote down the answer (its CLAUDE.md
// 6-10): a board that reads as "graphics" rather than as a material is
// not failing because it is too big, it is failing because it has ONE
// SPATIAL FREQUENCY. A two-stop gradient with a few strokes on it looks
// fine at 380px and looks like a vector illustration at 1100px, because
// the eye can take the whole thing in and there is nothing left to find.
//
// So every surface here is stacked coarse to fine, and the finest layer
// is doing real work:
//
//   1. base ramp .......... tone, and where the light is
//   2. broad mottling ..... the single biggest difference between a
//                           gradient and a surface
//   3. material signal .... the thing that names the material: the nap of
//                           worsted cloth, the fibre of flat-sawn wood
//   4. one-pixel detail ... fibre flecks, pores. Invisible alone, and the
//                           reason the other four stop looking printed
//   5. finish ............. gloss, bevel, and the fact that it has
//                           thickness
//
// ALL PROCEDURAL. Zero asset bytes, and the detail scales with the table
// instead of a 512px tile being stretched over a 2200px bed. Painted once
// into an offscreen canvas by render.js and blitted per frame, so the
// per-frame cost is one drawImage.
//
// THE READABILITY CONTRACT IS STILL THE HIGHER RULE. The cloth is the
// brightest large object on the screen and four balls have to read
// against it at 12 pixels across. Texture may add SURFACE; it may not add
// CONTRAST that competes with a ball. That is why every amplitude below
// is a named constant with a cap, and why test/surface.test.js measures
// the caps rather than trusting this paragraph.

/** Deterministic RNG. The same table must paint the same way every time,
 * or a screenshot test is photographing a different surface each run. */
export function rng(seed) {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Amplitude caps, as fractions of full white/black.
 *
 * These are the readability contract in numbers. A ball on cloth is about
 * a 3:1 local contrast; anything in the surface that approaches that is
 * competing with the thing the player is trying to see. Nothing here goes
 * past 7% even at its densest, and the one-pixel layer is under 4% —
 * which sounds invisible and is exactly the point, because a fleck you
 * can pick out individually is a speck of dirt, not a fibre.
 */
export const AMPLITUDE = {
  mottle: 0.065,
  nap: 0.04,
  weave: 0.016,
  iron: 0.022,
  fleck: 0.045,
  grain: 0.07,
  pore: 0.06,
};

/** The largest alpha any single texture layer may use. Exported so the
 * test can assert it against the table above rather than re-listing it. */
export const MAX_LAYER_ALPHA = 0.07;

/**
 * A tile of fine noise, as a repeatable pattern.
 *
 * Generated at DEVICE scale and repeated rather than drawn per pixel over
 * the whole bed: the flecks are meant to be one device pixel, so they
 * must not grow when the table does, and a 96px tile costs 9k pixels
 * instead of two million.
 */
const tileCache = new Map();
export function fleckPattern(ctx, seed, alpha) {
  const key = `${seed}:${alpha}`;
  const hit = tileCache.get(key);
  if (hit) return ctx.createPattern(hit, "repeat");
  const size = 96;
  const c =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const r = rng(seed);
  for (let i = 0; i < size * size; i++) {
    // Sparse, not uniform: a surface is mostly itself with occasional
    // fibre. Uniform per-pixel noise reads as television snow.
    const v = r();
    let a = 0;
    let light = 0;
    if (v > 0.94) {
      a = ((v - 0.94) / 0.06) * alpha;
      light = 255;
    } else if (v < 0.06) {
      a = ((0.06 - v) / 0.06) * alpha;
      light = 0;
    }
    const o = i * 4;
    img.data[o] = light;
    img.data[o + 1] = light;
    img.data[o + 2] = light;
    img.data[o + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  tileCache.set(key, c);
  return ctx.createPattern(c, "repeat");
}

/**
 * Billiard cloth.
 *
 * Worsted wool, which is the cloth a carom table is covered with and is
 * different from the fuzzy napped stuff on a bar pool table: it is
 * combed, so it has a fine directional grain running the LENGTH of the
 * table and almost no pile. Three things carry it:
 *
 *   - the lamp. A table is lit from directly above its middle and the
 *     cloth falls off toward the cushions. This is the layer doing most
 *     of the work, and it is also why the balls look like they are ON
 *     something rather than in front of it.
 *   - the nap: fine lines along the long axis, with a much fainter cross
 *     weave. Both are needed. Only the nap reads as corduroy; only the
 *     weave reads as graph paper.
 *   - mottling, because cloth stretched over slate is never perfectly
 *     even, and this is the layer that separates "surface" from
 *     "gradient" more than any other.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,w:number,h:number}} r  the bed, in px
 * @param {{base:string, lamp:string, edge:string, nap:string}} colors
 */
export function paintCloth(ctx, r, colors) {
  const long = r.w >= r.h; // which way the nap runs
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();

  // 1. base ramp — the lamp over the middle of the table
  ctx.fillStyle = colors.edge;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const lamp = ctx.createRadialGradient(cx, cy, Math.min(r.w, r.h) * 0.06, cx, cy, Math.max(r.w, r.h) * 0.62);
  lamp.addColorStop(0, colors.lamp);
  lamp.addColorStop(0.55, colors.base);
  lamp.addColorStop(1, colors.edge);
  ctx.fillStyle = lamp;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // 2. broad mottling
  const rnd = rng(0x9e3779b9);
  const blobs = Math.round((r.w * r.h) / 26000) + 8;
  for (let i = 0; i < blobs; i++) {
    const bx = r.x + rnd() * r.w;
    const by = r.y + rnd() * r.h;
    const br = Math.min(r.w, r.h) * (0.06 + rnd() * 0.14);
    const up = rnd() > 0.5;
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    const a = AMPLITUDE.mottle * (0.35 + rnd() * 0.65);
    g.addColorStop(0, `rgba(${up ? "255,255,255" : "0,0,0"},${a.toFixed(4)})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(bx - br, by - br, br * 2, br * 2);
  }

  // 2b. iron streaks: very wide, very faint bands along the nap, left by
  //     the cloth being brushed and ironed one way. Almost invisible on
  //     its own, and it is what stops the fine layers below reading as a
  //     regular screen — a grid needs something at a different scale
  //     lying across it or the eye locks onto the grid.
  const streaks = 5 + Math.round(rnd() * 4);
  for (let i = 0; i < streaks; i++) {
    const t = rnd() * (long ? r.h : r.w);
    const width = (long ? r.h : r.w) * (0.05 + rnd() * 0.16);
    const g = long
      ? ctx.createLinearGradient(0, r.y + t - width, 0, r.y + t + width)
      : ctx.createLinearGradient(r.x + t - width, 0, r.x + t + width, 0);
    const a = AMPLITUDE.iron * (0.4 + rnd() * 0.6);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, `rgba(255,255,255,${a.toFixed(4)})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  // 3. the nap, and the weave across it.
  //
  // Both are needed and both have to be IRREGULAR. Evenly spaced nap
  // reads as corduroy; an evenly spaced cross weave reads as graph paper.
  // The first pass had both and looked like a fabric swatch: the spacing
  // is what gives it away, not the amplitude.
  const step = Math.max(2, Math.round(Math.min(r.w, r.h) / 190));
  ctx.lineWidth = 1;
  const napLen = long ? r.w : r.h;
  const across = long ? r.h : r.w;
  let t = 0;
  while (t < across) {
    t += step * (0.55 + rnd() * 1.1);
    const up = rnd() > 0.45;
    ctx.strokeStyle = `rgba(${up ? "255,255,255" : "0,0,0"},${(AMPLITUDE.nap * (0.15 + rnd() * 0.85)).toFixed(4)})`;
    ctx.beginPath();
    if (long) {
      ctx.moveTo(r.x, r.y + t);
      ctx.lineTo(r.x + napLen, r.y + t);
    } else {
      ctx.moveTo(r.x + t, r.y);
      ctx.lineTo(r.x + t, r.y + napLen);
    }
    ctx.stroke();
  }
  // The weave runs in broken segments rather than edge to edge, because a
  // thread that crosses the whole table is a ruled line.
  const weaveSpan = long ? r.w : r.h;
  let u = 0;
  while (u < weaveSpan) {
    u += step * (1.6 + rnd() * 2.2);
    const segs = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < segs; k++) {
      const from = rnd() * across;
      const to = Math.min(across, from + across * (0.12 + rnd() * 0.4));
      ctx.strokeStyle = `rgba(0,0,0,${(AMPLITUDE.weave * (0.3 + rnd() * 0.7)).toFixed(4)})`;
      ctx.beginPath();
      if (long) {
        ctx.moveTo(r.x + u, r.y + from);
        ctx.lineTo(r.x + u, r.y + to);
      } else {
        ctx.moveTo(r.x + from, r.y + u);
        ctx.lineTo(r.x + to, r.y + u);
      }
      ctx.stroke();
    }
  }

  // 4. one-pixel fibre
  ctx.fillStyle = fleckPattern(ctx, 0x51ed270b, AMPLITUDE.fleck);
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // 5. the cloth is pulled down where it meets the cushion, so it is
  //    darker in a narrow band all the way round. This is small and it is
  //    what makes the bed look recessed instead of pasted on.
  const inset = Math.min(r.w, r.h) * 0.045;
  const edges = [
    [r.x, r.y, r.w, inset, 0, 1],
    [r.x, r.y + r.h - inset, r.w, inset, 0, -1],
    [r.x, r.y, inset, r.h, 1, 0],
    [r.x + r.w - inset, r.y, inset, r.h, -1, 0],
  ];
  for (const [ex, ey, ew, eh, dx, dy] of edges) {
    const g = ctx.createLinearGradient(
      ex + (dx < 0 ? ew : 0),
      ey + (dy < 0 ? eh : 0),
      ex + (dx < 0 ? 0 : dx > 0 ? 0 : 0) + (dx > 0 ? 0 : dx < 0 ? 0 : 0),
      ey
    );
    // Simple axis-aligned ramp from the rail inward.
    const gg = ctx.createLinearGradient(
      dx !== 0 ? (dx > 0 ? ex : ex + ew) : ex,
      dy !== 0 ? (dy > 0 ? ey : ey + eh) : ey,
      dx !== 0 ? (dx > 0 ? ex + ew : ex) : ex,
      dy !== 0 ? (dy > 0 ? ey + eh : ey) : ey
    );
    gg.addColorStop(0, "rgba(0,0,0,0.26)");
    gg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gg;
    ctx.fillRect(ex, ey, ew, eh);
    void g;
  }
  ctx.restore();
}

/**
 * THE SHELF — the slate that shows inside a pocket mouth, between the two
 * cut-back cushion ends and the hole, and under the bite the pocket takes
 * out of the rail.
 *
 * It is the same cloth over the same slate as the bed, so it gets the
 * bed's own fibre; what makes it read as being INSIDE something is the
 * shadow render.js lays over it afterwards. The flat 26% black is not a
 * taste decision: paintCloth darkens the bed by exactly that much in the
 * narrow band where the cloth is pulled down at the cushion, so starting
 * the shelf at the same tone means the two meet at the nose line with no
 * step — and a step there is a straight line drawn across an open mouth,
 * which is the thing this whole pocket rework is about. For the same
 * reason the shadow is NOT applied here: it has to run on across the
 * seam onto the cloth, and only the caller knows where the cloth is.
 *
 * The caller has already clipped to the shelf; `box` only has to cover it.
 *
 * @param {{x:number,y:number,w:number,h:number}} box  any rect covering the clip
 */
export function paintShelf(ctx, box, colors) {
  ctx.save();
  ctx.fillStyle = colors.edge;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = "rgba(0,0,0,0.26)";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = fleckPattern(ctx, 0x51ed270b, AMPLITUDE.fleck);
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

/**
 * A rail: one straight piece of polished hardwood.
 *
 * Drawn per side rather than as one frame, because the grain in a real
 * rail runs along ITS OWN length — a frame painted with one grain
 * direction is a photograph of wood laid under a table, not four pieces
 * of wood around one. Getting that right is what makes the mitred corners
 * mean anything.
 *
 * @param {"h"|"v"} axis  which way this piece runs
 */
export function paintRail(ctx, r, axis, colors, flip = false) {
  const along = axis === "h" ? r.w : r.h;
  const across = axis === "h" ? r.h : r.w;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();

  // 1. base ramp ACROSS the piece: the lit face, rolling to shadow at the
  //    far edge. Lit from the top-left of the table, so which end is
  //    bright depends on the side.
  // `flip` because the table is lit from the top-left: the top and left
  // rails catch the light on their OUTER edge, the bottom and right ones
  // on their inner edge. Painting all four the same way is the thing that
  // makes a frame look like a printed border.
  const gx0 = axis === "h" ? r.x : flip ? r.x + r.w : r.x;
  const gy0 = axis === "h" ? (flip ? r.y + r.h : r.y) : r.y;
  const gx1 = axis === "h" ? r.x : flip ? r.x : r.x + r.w;
  const gy1 = axis === "h" ? (flip ? r.y : r.y + r.h) : r.y;
  const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
  g.addColorStop(0, colors.light);
  g.addColorStop(0.42, colors.base);
  g.addColorStop(1, colors.dark);
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // 2. broad mottling — the colour variation of any real board
  const rnd = rng(axis === "h" ? 0x2545f491 : 0x7f4a7c15);
  for (let i = 0; i < Math.round(along / 40) + 6; i++) {
    const bx = r.x + rnd() * r.w;
    const by = r.y + rnd() * r.h;
    const br = across * (0.5 + rnd() * 1.6);
    const gg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    gg.addColorStop(0, `rgba(${rnd() > 0.5 ? "255,240,215" : "40,20,8"},${(AMPLITUDE.mottle).toFixed(3)})`);
    gg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gg;
    ctx.fillRect(bx - br, by - br, br * 2, br * 2);
  }

  // 3. fibre along the length, with the odd stronger line — flat-sawn
  //    hardwood is mostly even fibre with a few darker rays through it
  // Density and STRENGTH both matter, and the first pass had neither: at
  // a fifth of the cap over a 25px rail the fibre was mathematically
  // present and visually absent, and the rails came out as flat brown
  // bands. Wood is mostly fibre; it should be the loudest thing in the
  // piece after the light.
  const lines = Math.max(10, Math.round(across / 1.5));
  for (let i = 0; i < lines; i++) {
    const t = (i / lines) * across + (rnd() - 0.5) * 2;
    const strong = rnd() > 0.84;
    const a = AMPLITUDE.grain * (strong ? 1 : 0.35 + rnd() * 0.45);
    ctx.strokeStyle = `rgba(${rnd() > 0.55 ? "255,235,200" : "38,18,6"},${a.toFixed(4)})`;
    ctx.lineWidth = strong ? 1.4 : 1;
    ctx.beginPath();
    // A slight wander: perfectly straight grain reads as pinstripe.
    const segs = 6;
    for (let s = 0; s <= segs; s++) {
      const p = s / segs;
      const wobble = (rnd() - 0.5) * across * 0.05;
      const x = axis === "h" ? r.x + p * r.w : r.x + t + wobble;
      const y = axis === "h" ? r.y + t + wobble : r.y + p * r.h;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 4. pores — the short dark dashes lying along the grain. StoneFlick
  //    found the same thing: this is the one detail that makes wood read
  //    as wood at 1:1 rather than as a brown gradient.
  ctx.strokeStyle = `rgba(26,11,3,${AMPLITUDE.pore})`;
  ctx.lineWidth = 1;
  const pores = Math.round((along * across) / 110);
  for (let i = 0; i < pores; i++) {
    const px = r.x + rnd() * r.w;
    const py = r.y + rnd() * r.h;
    const len = 2 + rnd() * 9;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(axis === "h" ? px + len : px, axis === "h" ? py : py + len);
    ctx.stroke();
  }

  // 5. finish: a satin band down the lit third, which is the varnish
  const sheen = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
  sheen.addColorStop(0, "rgba(255,244,222,0)");
  sheen.addColorStop(0.18, "rgba(255,244,222,0.13)");
  sheen.addColorStop(0.4, "rgba(255,244,222,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

/**
 * A sight — the diamond inlaid in the rail.
 *
 * Mother-of-pearl, which is worth the eight lines it costs because these
 * are the only small bright objects on the frame and the eye lands on
 * them. Flat cream lozenges read as printed dots; an inlay has a dark
 * seam where it was routed in, a shifting pale interior, and one specular
 * that moves with the light.
 */
/** Mother-of-pearl, and the default because four of the five tables are
 * wearing it. The third stop is the cool flash pearl always has. */
const SIGHT_DEFAULT = {
  seam: "rgba(24,12,4,0.55)",
  stops: ["#fffaf0", "#efe3cd", "#dcd3e2", "#c9bda6"],
  glint: "rgba(255,255,255,0.75)",
};

export function paintSight(ctx, x, y, size, look) {
  const s = look || SIGHT_DEFAULT;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  // the routed seam
  ctx.fillStyle = s.seam;
  ctx.fillRect(-size - 1, -size - 1, size * 2 + 2, size * 2 + 2);
  const g = ctx.createLinearGradient(-size, -size, size, size);
  g.addColorStop(0, s.stops[0]);
  g.addColorStop(0.42, s.stops[1]);
  g.addColorStop(0.62, s.stops[2]);
  g.addColorStop(1, s.stops[3]);
  ctx.fillStyle = g;
  ctx.fillRect(-size, -size, size * 2, size * 2);
  ctx.fillStyle = s.glint;
  ctx.fillRect(-size * 0.72, -size * 0.72, size * 0.6, size * 0.42);
  ctx.restore();
}
