// game/render.js
// Canvas 2D rendering: the wooden board, its ruled grid, stage obstacles,
// the stones, and the slingshot aim indicator. Browser-only (Canvas2D,
// devicePixelRatio), so per the series' rule this file is verified in a
// real browser (test/browser-check.mjs) rather than by Node unit tests —
// only starPoints() below is pure enough to be worth testing directly.
//
// PORTED FROM GOMOKU, ON PURPOSE
// The wood gradient + grain background, the offscreen background cache,
// and the glossy 3-stop stone gradient with a clipped inner shadow are
// carried over from Daily Five's render.js essentially unchanged, because
// they are the output of several rounds of measurement there (interior-
// disc brightness sampled from real screenshots against the store cover,
// iterated rather than guessed) and re-deriving them would be pure loss.
// The specific reasons behind the odd-looking per-stone knobs are kept in
// the comments where they apply.
//
// WHAT IS NEW HERE
// - Stones are at continuous positions, not lattice points, so every
//   draw call takes board units and converts through game/layout.js.
// - Obstacles (peg / wall / hole) did not exist in Gomoku.
// - The aim indicator (pull-back band, direction ray, power) is the
//   entire interface of this game and gets the most attention below.
// - Stones are pre-rendered sprites now, not gradients drawn per frame:
//   the glossy model below is four gradients plus a specular, which is
//   too much to redraw a dozen times a frame. See `stoneSprite`.
// - A stone DOES cast a shadow on the board, clipped to the board rect.
//   The old note here said a drop shadow was impossible because a stone
//   may hang half off the board and the shadow would bleed into the
//   margin game/layout.js reserves for that overhang. Clipping is the
//   answer, and it is what the physical thing does anyway: the shadow
//   falls on the wood or it falls on nothing.

import { texture } from "./textures.js";
import { toPx, GRID_LINES, GRID_INSET, MAX_DRAG } from "./layout.js";
import { STONE_RADIUS } from "./physics.js";

// --- color math ---------------------------------------------------------
function hexToRgb(hex) {
  const value = parseInt(hex.replace("#", ""), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgbToHex(r, g, b) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;
}

const RIM_FALLBACK_DARKEN = 0.35;
function darkenHex(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = 1 - amount;
  return rgbToHex(r * f, g * f, b * f);
}

/** Blend a colour toward white (amount > 0) or black (amount < 0). The
 * prop painters need this because every metal collar is the SAME turned
 * ramp built out of one theme colour — hardcoding eight hex stops per
 * prop is what made the first pass copper on a neon board. */
function shadeHex(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  if (amount >= 0) {
    return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
  }
  const f = 1 + amount;
  return rgbToHex(r * f, g * f, b * f);
}

/** A hex colour at a given alpha. Portals need this because their whole
 * body is drawn in the link's own hue at varying transparency — the one
 * place here that a colour has to survive being made translucent rather
 * than being blended toward black. */
function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Wood, and the shape every theme conforms to. Kept as a parameter rather
 * than hardcoded into the draw calls so game/themes.js can swap it
 * wholesale. boardGradientTop/Bottom, boardEdgeColor and grainColor are
 * OPTIONAL — paintBackground() falls back to a flat `boardColor` fill for
 * any theme that omits them, which is what Slate/Paper/Neon do.
 */
export const DEFAULT_THEME = {
  boardColor: "#dcb35c",
  // The material this board is made of, and the tones the painter for it
  // ramps between. See "board surfaces" above: `surface` names the
  // painter, and each theme gets a DIFFERENT one because each theme
  // already claims a different material.
  surface: "hardwood",
  // Pulled back toward the honey the board has always been. The study
  // tile was a shade paler and the satin band lifted its top corner
  // further still, which came out as pale ash rather than kaya — a
  // different board, when the point of the pass was the same board with
  // real material on it.
  surfaceTop: "#e3b571",
  surfaceMid: "#d3a25e",
  surfaceBottom: "#bb8845",
  /** The short dark flecks lying along the grain. The single detail that
   * makes wood read as wood at 1:1. */
  poreColor: "#5d3f18",
  /** The cathedral figure — the flat-sawn face of a log. */
  figureColor: "#7a5522",
  // The table the board sits on — see main.js's applySurround(). Two
  // values rather than one because the campaign's ten acts ramp between
  // them (act 1 warm, act 10 cool), which is the only "per-stage
  // background" this game gets: a temperature, not an image. Both are
  // picked to sit BELOW the board's own darkest surface tone, because
  // every shading decision in this file assumes the board is the
  // brightest object on the screen; a surround that competes with it
  // flattens every prop drawn on it. test/theme-surround.test.js measures
  // that and fails if a theme ever breaks it.
  surroundWarm: "#2e2116",
  surroundCool: "#17222b",
  surroundEdge: "#0b0908",
  boardGradientTop: "#e0b26a",
  boardGradientBottom: "#c69650",
  boardEdgeColor: "#a67a3c",
  grainColor: "#7a5a2e",
  lineColor: "#3a2b1a",
  starColor: "#3a2b1a",
  stones: {
    // Retuned for the glossy model above. The inherited numbers came from
    // Daily Five, where a stone was a flat token dropped on a lattice and
    // the whole job was "white must not read as gray marble" — so white's
    // darkening band was squeezed into the outer 22% (`rimStart` 0.78) and
    // its inner shadow damped almost out (`shadowBoost` 0.08). Both did
    // exactly what they were for, and both leave a disc rather than a
    // dome.
    //
    // Here a stone is a physical object that gets flicked, and the ask is
    // that it look like polished shell and slate. So white's falloff
    // starts at 0.62 and lands on a warmer, deeper rim, and its inner
    // shadow is allowed back at a fifth strength. The middle stays bright:
    // the original worry was right, and a white stone that goes gray in
    // the centre fails the one job it has on wood.
    //
    // `gradientExtent` 1.08 still reaches past the visible edge so the
    // silhouette never lands fully on the dark stop — that part was right
    // and is kept.
    0: { fill: "#242424", highlight: "#c4c4c4", rim: "#0b0b0b", gradientExtent: 1.1, shadowBoost: 0.34 },
    1: {
      fill: "#f6f5f1",
      highlight: "#ffffff",
      rim: "#c9c5bb",
      rimStart: 0.62,
      edgeColor: "#a9a49a",
      edgeAlpha: 0.55,
      gradientExtent: 1.08,
      shadowBoost: 0.2,
    },
  },
  aimColor: "#d2362d",
  obstacleColor: "#8a5f2c",
  obstacleEdge: "#5c3d18",
  holeColor: "#3a2b1a",
  // Brass. The only metal on the board — see drawBumper.
  bumperColor: "#d9a441",
  bumperEdge: "#6b4712",
  // One per portal `link`, cycled. Pairs are told apart by COLOR rather
  // than by a number drawn on them: a player has to spot both ends of a
  // pair in peripheral vision while aiming, and matching two hues is
  // instant where reading two labels is not.
  //
  // Which PAIR a portal belongs to, for a board carrying more than one.
  // Demoted from load-bearing to convenience once the aperture started
  // showing the destination — a player identifies a pair by what they can
  // see through it, so this only has to separate two pairs at a glance.
  // Far apart in hue and in value; the amber that used to be in this list
  // was dropped because it read as the brass bumper.
  // Portal blue, and after it Portal orange. Both ends of one PAIR share
  // a colour here, because the pair is what a player has to match; the
  // list is indexed by `link`, so a board carrying two pairs gets blue
  // and orange the way the game everyone already knows does it. No stage
  // has a second pair yet, so today every portal is blue.
  portalColors: ["#2f9bff", "#ff8a1e", "#3fae72"],
  // The floor of the aperture, seen only where the through-view falls off
  // the far side of the board. Warm-black rather than pure black so it
  // sits on wood without looking like a punched-out hole in the canvas.
  portalLacquer: "#171019",
  // The rim's fire. Deliberately HOTTER and lighter than the bumper's
  // brass (#d9a441): brass is a reserved colour on this board, and the
  // two are kept apart by value and by behaviour — the bumper is a solid
  // lit dome that never moves, the rim is emissive, broken and turning.
  // Additive light piles up toward white, so these start further DOWN the
  // hue ramp than the fire is meant to look: a near-white core came out
  // as a pale yellow lamp rather than as embers. The mid tone is the one
  // that has to survive, because it is what the eye reads as "orange".
  emberCore: "#ffd489",
  emberMid: "#ff8c1a",
  emberOut: "#bf3208",
  sandColor: "#7a5c2c",
  iceColor: "#a9cfdd",
};

/**
 * Resizes the backing store to devicePixelRatio so lines and stones stay
 * crisp on high-DPI screens. Safe to call on every resize —
 * setTransform() replaces the previous scale rather than compounding it.
 */
export function fitCanvasToDisplaySize(canvas, cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * Conventional star points (화점) for an n-line goban, in GRID
 * coordinates (0..n-1). Purely decorative here — the grid is not a
 * coordinate system in this game — but a goban without them does not
 * read as a goban. Pure function, Node-tested.
 * @returns {[number,number][]}
 */
export function starPoints(lines = GRID_LINES) {
  const margin = lines >= 13 ? 3 : 2;
  const near = margin;
  const far = lines - 1 - margin;
  if (far <= near) return [];
  const points = [
    [near, near],
    [near, far],
    [far, near],
    [far, far],
  ];
  if (lines % 2 === 1) {
    const c = (lines - 1) / 2;
    points.push([c, c], [near, c], [far, c], [c, near], [c, far]);
  }
  return points;
}

/** Ease-out cubic: fast start, gentle settle. Used by the first-run drag
 * hint's pull-back, so the ghost hand accelerates away from the stone and
 * eases into the held position the way a real hand does — a linear pull
 * reads as a machine demonstrating, not a person. */
function easeOutCubic(t) {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

// --- background (cached offscreen) --------------------------------------
// The animation loop redraws everything on every rAF tick while stones
// are moving, so the gradient + grain must not be recomputed per frame.
// Painted once into an offscreen canvas keyed on (size, dpr, theme); each
// later frame is a single drawImage.
let backgroundCache = { canvas: null, theme: null, size: 0, dpr: 0 };

// --- board surfaces -----------------------------------------------------
//
// THE SIZE THAT MADE IT LOOK CHEAPER
//
// The board used to be a two-stop vertical gradient with seven sine-wave
// strokes over it. On the ~380px board a phone gets, that reads as wood.
// The two-column layout then gave the board 570px in the portal frame and
// 1040px at 1920x1080, and at that size the same surface reads as a flat
// vector shape with some lines drawn on it: the change meant to make the
// game feel bigger is what made it look cheaper.
//
// What is actually missing at 1:1 is HIGH-FREQUENCY DETAIL. A real
// material has structure down to the pixel; a gradient has structure at
// one scale only, and the eye reads "drawing" the moment it can see the
// whole of it. So every surface below is built the same way, coarse to
// fine, and the fine end is the part that does the work:
//
//   1. a base ramp                — the tone
//   2. broad soft mottling        — a slab is never one even ramp, and
//                                   this is the single biggest difference
//                                   between "a gradient" and "a surface"
//   3. the material's own signal  — grain, speckle, laid lines, tooth
//   4. the 1px detail             — pores, flecks, grit
//   5. sheen and bevel            — a finish, and the fact of thickness
//
// All procedural. No image assets, nothing to download, and the detail
// scales with the board instead of being resampled — a 2048px board on a
// desktop gets real texture rather than a stretched 512px tile. Painted
// once into the offscreen cache in getCachedBoard() below (0.1-3.3ms at
// 1040px, once per board size per theme), so none of it is per-frame.
//
// EACH THEME GETS ITS OWN MATERIAL, because each theme already claims
// one: slate is stone, paper is paper, neon is a lit panel. Recolouring a
// single wood texture four times would have made three of them read as
// stained wood, which is the opposite of what a theme is for. The
// material a theme paints is named in game/themes.js's `surface`.
//
// The readability contract further down still governs all of this: the
// board is the brightest object on the screen and every prop is shaded
// against it, so a surface may add texture but may not add CONTRAST that
// competes with a 17px prop. That is why nothing here goes above a few
// per cent alpha, and why test/theme-surround.test.js measures each
// theme's own tones rather than trusting a global number.

/** Deterministic PRNG. The surface is painted into a cache and repainted
 * on every resize, so it has to come out identical each time — a board
 * whose grain reshuffles when the window changes size is a board the
 * player notices. */
function surfaceRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function baseRamp(ctx, size, top, bottom, mid) {
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, top);
  if (mid) g.addColorStop(0.55, mid);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

/** Broad, soft, low-frequency lightness variation. Step 2 above. */
function surfaceMottle(ctx, size, seed, amount, count, light = "255,246,230", dark = "60,36,12") {
  const rand = surfaceRandom(seed);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const r = size * (0.18 + rand() * 0.45);
    const g = ctx.createRadialGradient(rand() * size, rand() * size, 0, rand() * size, rand() * size, r);
    g.addColorStop(0, `rgba(${rand() < 0.5 ? light : dark},${amount})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();
}

/** Per-pixel grit, tiled from one small canvas — a pattern fill rather
 * than a million putImageData writes. Built lazily: this module is
 * imported by Node tests through game/themes.js and must not touch the
 * DOM at load time. */
let noiseTile = null;
function surfaceNoise(ctx, size, alpha) {
  if (!noiseTile) {
    const n = 128;
    noiseTile = document.createElement("canvas");
    noiseTile.width = n;
    noiseTile.height = n;
    const nc = noiseTile.getContext("2d");
    const img = nc.createImageData(n, n);
    const rand = surfaceRandom(1337);
    for (let i = 0; i < n * n; i++) {
      // Three samples averaged: roughly gaussian, so the grit has a
      // distribution instead of being uniform static.
      const d = Math.round(((rand() + rand() + rand()) / 3 - 0.5) * 46);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 128 + d;
      img.data[i * 4 + 3] = 255;
    }
    nc.putImageData(img, 0, 0);
  }
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ctx.createPattern(noiseTile, "repeat");
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

/** A satin finish: one broad band of light across the slab, from the same
 * upper-left source every prop on this board is lit by. Wide and weak —
 * a tight highlight would read as glass, and would also be the second
 * specular on a board where the stones own that channel. */
function surfaceSheen(ctx, size, alpha) {
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, `rgba(255,247,231,${alpha})`);
  g.addColorStop(0.42, `rgba(255,247,231,${alpha * 0.35})`);
  g.addColorStop(1, "rgba(0,0,0,0.05)");
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

/** The slab has thickness. A lit inner edge top-left and a shaded one
 * bottom-right is the cheapest thing that says so, and it costs two
 * strokes. */
function surfaceBevel(ctx, size, strength = 1) {
  const w = Math.max(size * 0.008, 3);
  ctx.save();
  ctx.lineWidth = w;
  ctx.globalAlpha = 0.30 * strength;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(0, size - w / 2); ctx.lineTo(0, w / 2); ctx.lineTo(size, w / 2);
  ctx.stroke();
  ctx.globalAlpha = 0.34 * strength;
  ctx.strokeStyle = "#000000";
  ctx.beginPath();
  ctx.moveTo(size, w / 2); ctx.lineTo(size - w / 2, size); ctx.lineTo(0, size);
  ctx.stroke();
  ctx.restore();
}

/**
 * HARDWOOD — the goban. A real board's grain is a hundred and eighty
 * fibres, not seven, and what makes wood read as wood at 1:1 is the
 * PORES: the short dark flecks lying along the grain. One faint cathedral
 * figure on each half, because a perfectly even grain is veneer — faint
 * being the operative word, since the first pass had them tight enough to
 * read as two stains, which is worse than no figure at all.
 */
function paintHardwood(ctx, size, theme) {
  baseRamp(ctx, size, theme.surfaceTop, theme.surfaceBottom, theme.surfaceMid);
  surfaceMottle(ctx, size, 11, 0.04, 22);

  const rand = surfaceRandom(7);
  const fibres = Math.round(size / 3.2);
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i < fibres; i++) {
    const y = (size / fibres) * i + rand() * 2.2;
    const dark = rand() < 0.18;
    ctx.globalAlpha = dark ? 0.10 + rand() * 0.09 : 0.025 + rand() * 0.045;
    ctx.strokeStyle = dark ? theme.poreColor : theme.grainColor;
    const wave = 2 + rand() * 5;
    const wl = size * (0.6 + rand());
    const phase = rand() * 6.28;
    ctx.beginPath();
    for (let s = 0; s <= 24; s++) {
      const x = (size / 24) * s;
      const yy = y + Math.sin((x / wl) * Math.PI * 2 + phase) * wave;
      if (s === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  for (let f = 0; f < 2; f++) {
    const cx = size * (0.18 + f * 0.58);
    const cy = size * (0.15 + rand() * 0.7);
    for (let k = 0; k < 9; k++) {
      ctx.globalAlpha = 0.016 + rand() * 0.014;
      ctx.strokeStyle = theme.figureColor;
      ctx.lineWidth = 1 + rand();
      ctx.beginPath();
      ctx.ellipse(cx, cy, size * (0.05 + k * 0.03), size * (0.22 + k * 0.09), Math.PI / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  for (let i = 0; i < size * 1.6; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.11;
    ctx.strokeStyle = theme.poreColor;
    ctx.lineWidth = 0.8 + rand() * 0.9;
    const x = rand() * size;
    const y = rand() * size;
    const len = 2 + rand() * 9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rand() - 0.5) * 1.4);
    ctx.stroke();
  }
  ctx.restore();

  surfaceSheen(ctx, size, 0.045);
}

/**
 * HONED STONE — slate's own material, finally. Fine speckle and a few
 * long veins, no grain direction, and no sheen: honed stone is matte by
 * definition, and a polished one would put a second highlight on a board
 * whose props are already the lit things.
 */
function paintStone(ctx, size, theme) {
  baseRamp(ctx, size, theme.surfaceTop, theme.surfaceBottom, theme.surfaceMid);
  surfaceMottle(ctx, size, 5, 0.045, 24, "236,246,252", "18,26,32");
  const rand = surfaceRandom(99);
  ctx.save();
  for (let i = 0; i < size * 2.4; i++) {
    const light = rand() < 0.45;
    ctx.globalAlpha = 0.05 + rand() * 0.13;
    ctx.fillStyle = light ? theme.speckleLight : theme.speckleDark;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, 0.5 + rand() * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = "round";
  // Faint. A vein you can follow across the board reads as a scratch,
  // and a scratch is damage rather than material.
  for (let v = 0; v < 4; v++) {
    ctx.globalAlpha = 0.028 + rand() * 0.032;
    ctx.strokeStyle = rand() < 0.5 ? theme.speckleLight : theme.speckleDark;
    ctx.lineWidth = 0.9 + rand() * 1.8;
    let x = rand() * size;
    let y = -10;
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (y < size + 10) {
      x += (rand() - 0.5) * size * 0.16;
      y += size * 0.09;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  surfaceNoise(ctx, size, 0.4);
}

/**
 * LAID PAPER — the theme is a printed board, so its surface is a sheet:
 * fine horizontal laid lines from the mould's wires, the widely spaced
 * vertical chain lines that hold them, and loose fibre in the pulp. It is
 * the one surface here with a visible repeating structure, which is
 * exactly right for paper and would be wrong for anything else.
 */
function paintPaper(ctx, size, theme) {
  baseRamp(ctx, size, theme.surfaceTop, theme.surfaceBottom, theme.surfaceMid);
  surfaceMottle(ctx, size, 31, 0.03, 18, "255,253,246", "120,102,72");
  const rand = surfaceRandom(53);
  ctx.save();
  const laid = Math.max(3, size / 190);
  for (let y = 0; y < size; y += laid) {
    ctx.globalAlpha = 0.022 + rand() * 0.016;
    ctx.strokeStyle = theme.grainColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(size, y + 0.5);
    ctx.stroke();
  }
  const chain = size / 9;
  for (let x = chain * 0.5; x < size; x += chain) {
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = theme.grainColor;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, size);
    ctx.stroke();
  }
  // Fibre in the pulp: short pale threads, the thing that separates
  // handmade paper from a beige rectangle.
  for (let i = 0; i < size * 0.7; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.09;
    ctx.strokeStyle = rand() < 0.6 ? "#fffdf6" : theme.poreColor;
    ctx.lineWidth = 0.7 + rand() * 0.7;
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI;
    const len = 3 + rand() * 8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
  surfaceNoise(ctx, size, 0.3);
}

/**
 * MATTE PANEL — neon's board, and the default for any theme that names
 * no surface. No grain direction at all: an even tooth over broad
 * mottling, the way a matte-painted or resin panel looks. Neon's board is
 * near-black and is read by its glowing rules rather than by its
 * brightness, so this stays the quietest surface of the four by a wide
 * margin — grit on a near-black field is the one place texture turns into
 * noise fastest.
 */
function paintMatte(ctx, size, theme) {
  baseRamp(ctx, size, theme.surfaceTop, theme.surfaceBottom, theme.surfaceMid);
  surfaceMottle(ctx, size, 23, 0.03, 26, "180,220,240", "0,0,0");
  surfaceNoise(ctx, size, 0.3);
  const g = ctx.createRadialGradient(size * 0.3, size * 0.24, 0, size * 0.3, size * 0.24, size * 1.15);
  g.addColorStop(0, "rgba(210,240,255,0.045)");
  g.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

const SURFACES = {
  hardwood: paintHardwood,
  stone: paintStone,
  paper: paintPaper,
  matte: paintMatte,
};

function paintBoardSurface(ctx, size, theme) {
  // A theme with no `surface` and no tones is still legal — it gets a
  // flat fill of its board colour, which is what every theme did before
  // any of this existed.
  const paint = SURFACES[theme.surface];
  if (paint && theme.surfaceTop && theme.surfaceBottom) {
    paint(ctx, size, theme);
  } else {
    ctx.fillStyle = theme.boardColor;
    ctx.fillRect(0, 0, size, size);
  }
  // The slab's front face, then its edges. Drawn after the material so
  // the bevel lights the real surface rather than the base ramp.
  if (theme.boardEdgeColor) {
    const edge = Math.max(size * 0.012, 4);
    ctx.fillStyle = theme.boardEdgeColor;
    ctx.fillRect(0, size - edge, size, edge);
  }
  if (paint) surfaceBevel(ctx, size, theme.bevelStrength ?? 1);

  // Ruled grid + star points, painted into the same cached surface: they
  // never move relative to the board, so there is no reason to redraw
  // them per frame either.
  const inset = GRID_INSET * size;
  const span = size - inset * 2;
  const step = span / (GRID_LINES - 1);
  ctx.save();
  ctx.strokeStyle = theme.lineColor;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 1;
  for (let i = 0; i < GRID_LINES; i++) {
    const at = inset + step * i + 0.5;
    ctx.beginPath();
    ctx.moveTo(inset, at);
    ctx.lineTo(size - inset, at);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(at, inset);
    ctx.lineTo(at, size - inset);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = theme.starColor;
  const dot = Math.max(step * 0.16, 2);
  for (const [gx, gy] of starPoints(GRID_LINES)) {
    ctx.beginPath();
    ctx.arc(inset + step * gx, inset + step * gy, dot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function getCachedBoard(layout, theme) {
  const dpr = window.devicePixelRatio || 1;
  const px = Math.max(1, Math.round(layout.size * dpr));
  if (backgroundCache.canvas && backgroundCache.theme === theme && backgroundCache.size === px && backgroundCache.dpr === dpr) {
    return backgroundCache.canvas;
  }
  const offscreen = document.createElement("canvas");
  offscreen.width = px;
  offscreen.height = px;
  const offCtx = offscreen.getContext("2d");
  offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintBoardSurface(offCtx, layout.size, theme);
  backgroundCache = { canvas: offscreen, theme, size: px, dpr };
  return offscreen;
}

/** The board on its own, with nothing on it. Exported for test/props.mjs,
 * which has to judge every obstacle against the surface it actually sits
 * on — a prop sheet on a white background flatters everything equally and
 * tells you nothing. */
export function drawBoardOnly(ctx, layout, theme = DEFAULT_THEME) {
  drawBoardSurface(ctx, layout, theme);
}

function drawBoardSurface(ctx, layout, theme) {
  const cached = getCachedBoard(layout, theme);
  // A soft shadow under the board itself, so the wood reads as a slab
  // sitting on the page rather than a flat rectangle. Drawn OUTSIDE the
  // board square, in the margin game/layout.js reserves — that margin
  // exists for stone overhang and is otherwise empty.
  ctx.save();
  // Deepened and thrown further once the page behind the board stopped
  // being flat black (index.html's table). Against black a shadow is
  // invisible by definition; against a lit surface it is the thing that
  // makes the board a slab lying ON something rather than a rectangle cut
  // out of it, and at 0.28/2% it was too faint to do that job.
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = Math.max(layout.size * 0.045, 12);
  ctx.shadowOffsetY = Math.max(layout.size * 0.018, 5);
  ctx.fillStyle = theme.boardColor;
  ctx.fillRect(layout.originX, layout.originY, layout.size, layout.size);
  ctx.restore();
  ctx.drawImage(cached, layout.originX, layout.originY, layout.size, layout.size);
}

// --- obstacles ----------------------------------------------------------
/**
 * THE READABILITY CONTRACT
 *
 * A prop sheet (`npm run props`) put all eight obstacles side by side for
 * the first time and the verdict was blunt: SEVEN OF EIGHT HAD THE SAME
 * SILHOUETTE — a circle, differing only in size. Squinted down to
 * thumbnail size, peg, bumper and one of the portal tints collapsed into
 * a single "small brownish dot". They were being told apart by hue, which
 * is the weakest signal a player reads and the last one that survives
 * motion, small screens or a colour-blind viewer.
 *
 * So each prop is now separated on four axes, in this order of strength:
 *
 *   0. EMISSION — the strongest separator, and only one prop gets it.
 *      Everything on this board is LIT: a light from the upper left, a
 *      gradient, a shadow. The portal's rim is the single thing that
 *      gives off light of its own, and it turns while everything else
 *      holds still. Nothing can acquire that by accident, and it survives
 *      greyscale, motion and a 17px prop, which is why the portal was
 *      able to give up the octagon it used to need (see drawPortal).
 *      It is spent HERE and nowhere else: a second glowing prop would
 *      cost this one everything it buys.
 *
 *   1. SILHOUETTE — assigned by behaviour class, not by object:
 *        solid convex form   things that BLOCK      peg, wall
 *        plain disc, no trim things that REMOVE     hole
 *        ringed disc         things that TRANSPORT  portal
 *        irregular blob      terrain                zones
 *      A wobble is not decoration; at 20px it is the only cue left.
 *
 *   2. VALUE — assigned by consequence. The hole takes your stone, so it
 *      is the darkest thing on the board and it is EVEN: dark all the way
 *      across, nothing to look at. The portal moves the stone on, so it
 *      is the highest-CONTRAST thing instead — a bright rim around a
 *      recessed view, dark and light in the same prop. That pairing is
 *      what keeps the two apart at a glance even though both are round
 *      and both are set into the board. Furniture (peg, wall) sits within
 *      a hair of the board's own value, and terrain is tighter still — a
 *      zone that competes with an object for contrast is lying about how
 *      much it matters.
 *
 *   3. HUE — reserved, and used last. Brass belongs to the bumper alone
 *      because it alone gives energy back; the portal's fire is kept
 *      hotter and lighter so the two never trade places. The hole has no
 *      hue at all. A portal PAIR is identified by what you can SEE
 *      through it rather than by its colour, which is what finally took
 *      the last colour-blindness risk off this board — the pair tint that
 *      remains is a convenience, not a channel anything depends on.
 *
 *   4. SIZE — ordered by weight: peg < bumper < portal < hole < zone.
 *
 * MATERIAL IS THE RULE.
 *
 * The first version of these drew each new obstacle as a flat, saturated
 * UI shape — a red disc, a purple ring, a tinted blob — and they looked
 * like stickers on the board rather than things in the game. The board's
 * own visual language was already settled by the stones: warm materials,
 * one light source from the upper left, real gradients, everything either
 * resting ON the wood with a shadow or cut INTO it with a bevel. Anything
 * that ignores that reads as a different game pasted on top.
 *
 * So every obstacle is now a plausible object made of a plausible
 * material, and the material carries the rule:
 *
 *   peg     bamboo dowel     wood on wood — part of the board, blocks you
 *   wall    wooden bar       same material, longer; same rule
 *   bumper  brass post       the only METAL: hard, sprung, gives back more
 *   hole    cut through      an opening; the stone is gone
 *   portal  shell inlay      set flush INTO the board, sends you elsewhere
 *   zone    raw / lacquered  a change of SURFACE, not an object at all
 *
 * A player does not have to be told any of that. Metal looks springy,
 * inlay looks deliberate, and a patch with no edge is obviously something
 * you slide over. That is the whole point of choosing materials rather
 * than colours: the colour has to be learned, the material does not.
 */
function drawObstacles(ctx, layout, scene, theme, phase = 0) {
  const obstacles = scene.obstacles;
  ctx.save();
  // Surface treatments first (zones), then things set into the board
  // (portals, holes), then things standing on it (pegs, bumpers, walls).
  // The order is the information: what a stone slides over, what swallows
  // it, and what stops it, in that visual stack.
  const order = { zone: 0, portal: 1, hole: 2 };
  const sorted = [...obstacles].sort((a, b) => (order[a.type] ?? 3) - (order[b.type] ?? 3));
  for (const o of sorted) drawObstacle(ctx, layout, o, theme, phase, scene);
  ctx.restore();
}

/**
 * One obstacle. Exported so test/props.mjs can lay every type out side by
 * side at a matched size — the sheet an artist makes to check that a set
 * reads as one set, which is not a thing you can judge while they are
 * scattered across four different stages.
 */
export function drawObstacle(ctx, layout, o, theme = DEFAULT_THEME, phase = 0, scene = null) {
  if (o.type === "hole") drawHole(ctx, layout, o, theme);
  else if (o.type === "zone") drawZone(ctx, layout, o, theme);
  else if (o.type === "portal") drawPortal(ctx, layout, o, theme, phase, scene);
  else if (o.type === "bumper") drawBumper(ctx, layout, o, theme);
  else if (o.type === "peg") drawPeg(ctx, layout, o, theme);
  else if (o.type === "wall") drawWall(ctx, layout, o, theme);
}


/**
 * A bamboo dowel driven into the board: the same family of material as
 * the board itself, domed, with a lighter cut top and a ring of grain.
 * It should look like part of the furniture — a peg is the boring
 * obstacle, and looking boring next to the brass bumper is exactly its
 * job.
 */

// --- props ---------------------------------------------------------------
//
// THE OBSTACLES ARE DRAWN BY THE STONES' OWN PAINTER, and that is the
// whole design.
//
// Three passes before this one tried to make the props LOOK expensive:
// engraved collars, coil springs, brass ferrules, crazed clay, and
// finally a real offline renderer that lit them properly. Every one of
// them failed the same way, and it took all three to see it. A stone in
// this game is a sphere with one material, one highlight and no ornament
// whatsoever -- and next to that, ANY decorated object looks like it
// wandered in from a different game. The mismatch was never quality; it
// was complexity. More rendering effort made it worse, because a better
// render of an over-designed object is a better-looking wrong object.
//
// So a prop here is a dome or a dish, drawn with exactly the five moves
// that make a stone read as a stone:
//
//   1. a body gradient whose bright end is OFF CENTRE, up and left
//   2. an occlusion under the far rim, where the form turns away
//   3. a warm bounce off the board into the near rim
//   4. a specular: a tight core inside a soft halo
//   5. a thin occlusion inside the whole rim, so it sits ON the board
//
// What separates one prop from another is then only MATERIAL and VALUE --
// a peg is the board's own colour, a bumper is bright and glows, a hole
// is the same form lit backwards. That is a weaker-looking toolkit than
// engraving, and it is the correct one: the player already learned to
// read this exact vocabulary on the first stone they flicked.

const TAU = Math.PI * 2;

/** Deterministic per-prop noise: the same obstacle every frame, on every
 * machine. */
function propRandom(seed) {
  let a = (seed | 0) >>> 0;
  return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * The five moves, on whatever path is currently set, in one of three
 * modes. The modes are not knobs on one shader -- they are three
 * different objects, and trying to reach them by turning knobs on the
 * dome is what produced a pit that looked like a dark ball and a mud
 * patch that domed up like a boulder.
 *
 *   "dome"  something standing ON the board. Lit upper-left, occluded
 *           lower-right, one specular. This is the stone, exactly.
 *   "dish"  an opening IN the board. NOT a dome with its light moved --
 *           a pit has no specular at all, because there is no surface
 *           facing you to put one on. What it has is the near lip's
 *           shadow thrown down the inside, and a crescent of light on the
 *           far inner wall. That inversion is what makes a shape read as
 *           "down" pre-attentively, with no collar drawn around it.
 *   "plate" a patch of ground. No shadow, no specular, no rim occlusion,
 *           barely any gradient -- everything that would make it stand up
 *           is removed on purpose. A plate that reads as an object is
 *           telling the player to avoid a thing they are supposed to
 *           shoot across.
 */
function shadeForm(c, cx, cy, r, colors, mode = "dome") {
  const { r: fr, g: fg, b: fb } = hexToRgb(colors.fill);
  const lum = (0.2126 * fr + 0.7152 * fg + 0.0722 * fb) / 255;
  const box = () => c.fillRect(cx - r * 1.2, cy - r * 1.2, r * 2.4, r * 2.4);

  if (mode === "plate") {
    // Nearly uniform. Any real falloff across the middle is a dome, and a
    // dome is exactly the wrong thing to say about a patch of ground --
    // the previous version used the same centre-out ramp as the stone and
    // the mud read as a boulder the size of six stones.
    const body = c.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    body.addColorStop(0, colors.fill);
    body.addColorStop(0.86, colors.fill);
    body.addColorStop(1, colors.rim);
    c.fillStyle = body;
    c.fill();
    c.save();
    c.clip();
    // one broad sheen, well off centre and very soft: enough to say the
    // surface is not the board, not enough to say it is an object
    const sx = cx - r * 0.34;
    const sy = cy - r * 0.40;
    const sheen = c.createRadialGradient(sx, sy, 0, sx, sy, r * 0.95);
    sheen.addColorStop(0, `rgba(255,255,255,${(0.20 - lum * 0.12).toFixed(3)})`);
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = sheen;
    box();
    c.restore();
    return;
  }

  if (mode === "dish") {
    // 1. the inside, darkest under the near lip
    const body = c.createRadialGradient(cx - r * 0.24, cy - r * 0.30, r * 0.04, cx, cy, r * 1.04);
    body.addColorStop(0, colors.rim);
    body.addColorStop(0.55, colors.fill);
    body.addColorStop(1, colors.highlight);
    c.fillStyle = body;
    c.fill();
    c.save();
    c.clip();
    // 2. the near lip's shadow, thrown down the inside
    const lip = c.createLinearGradient(cx - r * 0.5, cy - r, cx + r * 0.4, cy + r * 0.5);
    lip.addColorStop(0, "rgba(0,0,0,0.85)");
    lip.addColorStop(0.75, "rgba(0,0,0,0)");
    c.fillStyle = lip;
    box();
    // 3. the far inner wall, which is the surface actually facing the
    // light. A crescent hugging the lower-right rim -- never a blob in
    // the middle, which is a highlight and would turn the hole straight
    // back into a ball. It is made by putting the gradient's ORIGIN off
    // the far side of the disc rather than by clipping one circle with
    // another: an offset clip gives a crescent with a hard edge on its
    // inside, which reads as an eclipse.
    const ox = cx - r * 0.62;
    const oy = cy - r * 0.72;
    const crescent = c.createRadialGradient(ox, oy, r * 0.9, ox, oy, r * 2.3);
    crescent.addColorStop(0, "rgba(255,238,210,0)");
    crescent.addColorStop(0.72, "rgba(255,238,210,0.06)");
    crescent.addColorStop(1, "rgba(255,238,210,0.42)");
    c.globalCompositeOperation = "lighter";
    c.fillStyle = crescent;
    box();
    c.restore();
    return;
  }

  // dome
  const bx = cx - r * 0.30;
  const by = cy - r * 0.38;
  const body = c.createRadialGradient(bx, by, r * 0.05, cx, cy, r * 1.02);
  body.addColorStop(0, colors.highlight);
  body.addColorStop(0.52, colors.fill);
  body.addColorStop(1, colors.rim);
  c.fillStyle = body;
  c.fill();

  c.save();
  c.clip();
  const shadow = c.createRadialGradient(cx, cy + r * 0.35, r * 0.15, cx, cy + r * 0.35, r * 1.05);
  shadow.addColorStop(0, "rgba(0,0,0,0.30)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = shadow;
  box();

  c.globalCompositeOperation = "lighter";
  const bp = 0.20 * (1 - lum * 0.85);
  const bounce = c.createRadialGradient(
    cx + r * 0.34, cy + r * 0.60, r * 0.05, cx + r * 0.34, cy + r * 0.60, r * 0.95);
  bounce.addColorStop(0, `rgba(255,226,178,${bp.toFixed(3)})`);
  bounce.addColorStop(0.55, `rgba(255,214,160,${(bp * 0.35).toFixed(3)})`);
  bounce.addColorStop(1, "rgba(255,200,140,0)");
  c.fillStyle = bounce;
  box();

  const sx = cx - r * 0.32;
  const sy = cy - r * 0.38;
  const halo = 0.30 - lum * 0.18;
  const h = c.createRadialGradient(sx, sy, 0, sx, sy, r * 0.66);
  h.addColorStop(0, `rgba(255,255,255,${halo.toFixed(3)})`);
  h.addColorStop(0.45, `rgba(255,255,255,${(halo * 0.3).toFixed(3)})`);
  h.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = h;
  box();
  c.globalCompositeOperation = "source-over";

  const coreR = r * (0.26 - lum * 0.08);
  const peak = 0.80 - lum * 0.40;
  const core = c.createRadialGradient(sx, sy, 0, sx, sy, coreR);
  core.addColorStop(0, `rgba(255,255,255,${peak.toFixed(3)})`);
  core.addColorStop(0.42, `rgba(255,255,255,${(peak * 0.48).toFixed(3)})`);
  core.addColorStop(1, "rgba(255,255,255,0)");
  c.save();
  c.translate(sx, sy);
  c.rotate(-0.5);
  c.scale(1, 0.62);
  c.translate(-sx, -sy);
  c.fillStyle = core;
  c.beginPath();
  c.arc(sx, sy, coreR, 0, TAU);
  c.fill();
  c.restore();

  const ao = c.createRadialGradient(cx, cy, r * 0.66, cx, cy, r);
  ao.addColorStop(0, "rgba(60,40,20,0)");
  ao.addColorStop(1, `rgba(60,40,20,${(0.10 + lum * 0.16).toFixed(3)})`);
  c.fillStyle = ao;
  box();
  c.restore();
}

/** The dark a prop leaves on the board it stands on. */
function propShadow(ctx, x, y, r, alpha = 0.34) {
  const g = ctx.createRadialGradient(x, y + r * 0.16, r * 0.62, x, y + r * 0.16, r * 1.24);
  g.addColorStop(0, `rgba(22,12,4,${alpha})`);
  g.addColorStop(0.6, `rgba(22,12,4,${alpha * 0.42})`);
  g.addColorStop(1, "rgba(22,12,4,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.16, r * 1.24, 0, TAU);
  ctx.fill();
}

/**
 * The soft light an ACTIVE prop throws on the board around it.
 *
 * Only two props get one, and the rule behind that is worth stating: a
 * glow means the object DOES something when you touch it. A bumper gives
 * back more than it took and a portal sends you elsewhere; a peg, a wall
 * and a hole only ever take. So the glow is not decoration, it is the
 * board's one piece of behavioural vocabulary, and spending it on
 * anything passive would spend it entirely.
 */
function propGlow(ctx, x, y, r, color, strength) {
  // TWO passes, and the reason is that additive light cannot tint.
  // "lighter" only ever adds, so a blue glow on a warm board pushes the
  // wood toward white and the halo comes out looking warm -- which is
  // exactly what happened the first time the portals turned blue. So the
  // wide falloff is composited normally, where it can actually pull the
  // board toward the light's own colour, and only the tight inner ring
  // is added on top, where a real light does blow out to white.
  ctx.save();
  const wide = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * 2.1);
  wide.addColorStop(0, hexToRgba(color, 0.55 * strength));
  wide.addColorStop(0.4, hexToRgba(color, 0.24 * strength));
  wide.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = wide;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.1, 0, TAU);
  ctx.fill();

  ctx.globalCompositeOperation = "lighter";
  const hot = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.45);
  hot.addColorStop(0, hexToRgba(color, 0.45 * strength));
  hot.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = hot;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.45, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Fill, mid and rim for a prop, mixed from one theme colour so every
 * board gets props made of its own material. */
function formColors(base, { lighten = 0.34, darken = -0.42 } = {}) {
  return { highlight: shadeHex(base, lighten), fill: base, rim: shadeHex(base, darken) };
}

/**
 * A peg: a post driven through the board, seen end-on -- so what you are
 * looking at is END GRAIN, and end grain is annual rings.
 *
 * The rings are texture, not ornament. This camera looks straight down at
 * a cut cylinder, and a cut cylinder without rings is a coloured disc; a
 * player reads "wood, cut across" from the rings before they read
 * anything else. The SHAPE is fixed across every theme -- same bark edge,
 * same ring count, same off-centre pith -- and only the colours are mixed
 * from the theme, because a peg has to be the same object on every board.
 *
 * Baked into a sprite because none of it changes between frames, and a
 * board can hold five of these.
 */
const pegSprites = new Map();
const PEG_SPRITE_LIMIT = 16;

function pegSprite(base, radiusPx, dpr, seed) {
  const r = Math.round(radiusPx * dpr);
  if (r < 3) return null;
  const key = `${base}|${seed}|${r}`;
  const hit = pegSprites.get(key);
  if (hit) return hit;

  const pad = Math.ceil(r * 0.10) + 2;
  const size = (r + pad) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const rand = propRandom(seed);

  const bark = shadeHex(base, -0.46);
  const cambium = shadeHex(base, -0.12);
  const early = shadeHex(base, 0.52);   // the pale wood a ring grows in spring
  const late = shadeHex(base, 0.06);    // the dark line it lays down in autumn

  // 1. bark: a rough edge, because bark is the one part of a log that is
  // never a circle
  const barkEdge = () => {
    c.beginPath();
    const n = 30;
    const rr2 = propRandom(seed ^ 0x5bd1);
    for (let i = 0; i < n; i++) {
      const a = (TAU * i) / n;
      const rr = r * (0.955 + rr2() * 0.09);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
  };
  barkEdge();
  c.fillStyle = bark;
  c.fill();

  // 2. the cambium, a clean band just inside the bark
  c.beginPath();
  c.arc(cx, cy, r * 0.885, 0, TAU);
  c.fillStyle = cambium;
  c.fill();

  // 3. the heartwood, and the rings in it
  const face = r * 0.82;
  c.save();
  c.beginPath();
  c.arc(cx, cy, face, 0, TAU);
  c.clip();
  c.fillStyle = early;
  c.fillRect(0, 0, size, size);

  // the pith is never in the middle, and the rings are never circles:
  // each one is the last one plus a little growth, unevenly
  const px0 = cx + (rand() - 0.5) * face * 0.34;
  const py0 = cy + (rand() - 0.5) * face * 0.34;
  const rings = 13 + Math.floor(rand() * 5);
  const wob = [];
  const lobes = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < 5; i++) wob.push(rand() * TAU);
  c.lineJoin = "round";
  for (let k = 1; k <= rings; k++) {
    const t = k / rings;
    // growth slows outward, which is what puts the rings closer together
    // at the edge and is most of what makes a slice look real
    const rr = face * 1.16 * Math.pow(t, 0.78);
    c.beginPath();
    const steps = 46;
    for (let i = 0; i <= steps; i++) {
      const a = (TAU * i) / steps;
      const w =
        1 +
        0.085 * Math.sin(a * lobes + wob[0] + k * 0.16) +
        0.042 * Math.sin(a * (lobes + 3) + wob[1] - k * 0.1) +
        0.020 * Math.sin(a * (lobes + 7) + wob[2] + k * 0.23);
      const ax = px0 + Math.cos(a) * rr * w;
      const ay = py0 + Math.sin(a) * rr * w * 0.97;
      if (i === 0) c.moveTo(ax, ay);
      else c.lineTo(ax, ay);
    }
    c.closePath();
    c.strokeStyle = hexToRgba(late, 0.55 + 0.40 * (k % 2));
    c.lineWidth = Math.max(0.7, r * (0.030 + 0.016 * (k % 2)));
    c.stroke();
  }
  // a couple of radial checks, the splits a drying log opens along its rays
  for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
    const a = rand() * TAU;
    c.beginPath();
    c.moveTo(px0, py0);
    c.lineTo(px0 + Math.cos(a) * face * 1.2, py0 + Math.sin(a) * face * 1.2);
    c.strokeStyle = hexToRgba(shadeHex(base, -0.3), 0.34);
    c.lineWidth = Math.max(0.8, r * 0.022);
    c.stroke();
  }
  c.restore();

  // 4. it is still an object standing on the board: the same soft
  // upper-left light and rim occlusion every other prop gets, laid over
  // the grain rather than replacing it
  c.save();
  c.beginPath();
  c.arc(cx, cy, r, 0, TAU);
  c.clip();
  const sx = cx - r * 0.34;
  const sy = cy - r * 0.40;
  const lit = c.createRadialGradient(sx, sy, 0, sx, sy, r * 1.25);
  lit.addColorStop(0, "rgba(255,255,255,0.22)");
  lit.addColorStop(0.55, "rgba(255,255,255,0.03)");
  lit.addColorStop(1, "rgba(0,0,0,0.18)");
  c.fillStyle = lit;
  c.fillRect(0, 0, size, size);
  const ao = c.createRadialGradient(cx, cy, r * 0.72, cx, cy, r);
  ao.addColorStop(0, "rgba(40,24,10,0)");
  ao.addColorStop(1, "rgba(40,24,10,0.35)");
  c.fillStyle = ao;
  c.fillRect(0, 0, size, size);
  c.restore();

  if (pegSprites.size >= PEG_SPRITE_LIMIT) {
    pegSprites.delete(pegSprites.keys().next().value);
  }
  pegSprites.set(key, canvas);
  return canvas;
}

function drawPeg(ctx, layout, o, theme) {
  const { x, y } = toPx(layout, o.x, o.y);
  const r = o.radius * layout.scale;
  const base = theme.obstacleColor ?? DEFAULT_THEME.obstacleColor;
  ctx.save();
  propShadow(ctx, x, y, r);
  const dpr = (typeof devicePixelRatio === "number" ? devicePixelRatio : 1) || 1;
  const seed = ((Math.round(o.x * 9973) ^ Math.round(o.y * 7919)) | 1) + 5;
  const sprite = pegSprite(base, r, dpr, seed);
  if (sprite) {
    const half = (sprite.width / 2) / dpr;
    ctx.drawImage(sprite, x - half, y - half, half * 2, half * 2);
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    shadeForm(ctx, x, y, r, formColors(base));
  }
  ctx.restore();
}

/**
 * A wall: a milled beam lying on the board. The same material as the peg,
 * the same rule, longer -- but seen along its LENGTH rather than end-on,
 * so what shows is long grain instead of rings.
 *
 * Modern, which here means specific things and not a style label: one
 * piece rather than courses, square-milled with an eased edge rather than
 * rustic, a satin sheen rather than a varnish gloss, and figure that runs
 * the length of the piece instead of a repeating pattern. Anything laid
 * in courses -- brick, stone, plank -- reads as masonry, and masonry on a
 * board this clean looks like clip art.
 */
const wallSprites = new Map();
const WALL_SPRITE_LIMIT = 12;

function wallSprite(base, wPx, hPx, dpr, seed) {
  const w = Math.round(wPx * dpr);
  const h = Math.round(hPx * dpr);
  if (w < 4 || h < 3) return null;
  const key = `${base}|${seed}|${w}x${h}`;
  const hit = wallSprites.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");
  const col = formColors(base);
  const rand = propRandom(seed);
  const rr = Math.min(h * 0.34, w * 0.09);

  // An eased corner, not a capsule. A full half-height round makes the
  // ends of the beam hemispherical, which reads as a dowel or a pill; a
  // milled piece has its arrises broken, not turned. This is the phone-
  // corner amount -- clearly softened, still obviously a rectangle.
  const capsule = () => {
    c.beginPath();
    c.moveTo(rr, 0);
    c.lineTo(w - rr, 0);
    c.quadraticCurveTo(w, 0, w, rr);
    c.lineTo(w, h - rr);
    c.quadraticCurveTo(w, h, w - rr, h);
    c.lineTo(rr, h);
    c.quadraticCurveTo(0, h, 0, h - rr);
    c.lineTo(0, rr);
    c.quadraticCurveTo(0, 0, rr, 0);
    c.closePath();
  };

  // the beam's own round: lit along the top edge, shaded along the bottom
  const body = c.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, col.rim);
  body.addColorStop(0.16, col.highlight);
  body.addColorStop(0.50, col.fill);
  body.addColorStop(1, col.rim);
  capsule();
  c.fillStyle = body;
  c.fill();

  c.save();
  capsule();
  c.clip();

  // LONG GRAIN. Lines that run the whole length, never quite straight and
  // never evenly spaced -- the two things that separate sawn timber from
  // a hatch pattern.
  const dark = shadeHex(base, -0.34);
  const pale = shadeHex(base, 0.30);
  const lines = 9 + Math.floor(rand() * 6);
  for (let i = 0; i < lines; i++) {
    const y0 = (i + 0.35 + rand() * 0.3) * (h / lines);
    const amp = h * (0.02 + rand() * 0.05);
    const freq = 0.6 + rand() * 1.5;
    const phase = rand() * TAU;
    c.beginPath();
    for (let x = 0; x <= w; x += Math.max(2, w / 80)) {
      const yy = y0 + Math.sin((x / w) * TAU * freq + phase) * amp;
      if (x === 0) c.moveTo(x, yy);
      else c.lineTo(x, yy);
    }
    c.strokeStyle = hexToRgba(rand() > 0.72 ? pale : dark, 0.16 + rand() * 0.30);
    c.lineWidth = Math.max(0.7, h * (0.026 + rand() * 0.060));
    c.stroke();
  }

  // one or two cathedral figures: the long V the grain makes where the
  // saw crossed a growth ring, and the thing that says "a plank" rather
  // than "a striped bar"
  const figures = 1 + Math.floor(rand() * 2);
  for (let f = 0; f < figures; f++) {
    const fx = w * (0.18 + rand() * 0.64);
    const fw = w * (0.10 + rand() * 0.14);
    for (let k = 0; k < 4; k++) {
      const spread = fw * (0.35 + k * 0.3);
      c.beginPath();
      c.moveTo(fx - spread, h);
      c.quadraticCurveTo(fx, -h * (0.25 + k * 0.16), fx + spread, h);
      c.strokeStyle = hexToRgba(dark, 0.22 - k * 0.035);
      c.lineWidth = Math.max(0.7, h * 0.045);
      c.stroke();
    }
  }

  // Open pore: the fine speckle a hardwood keeps even after milling. It
  // is the difference between "wood" and "a brown cylinder", and it costs
  // one pass of short dashes.
  for (let i = 0; i < Math.round(w * h * 0.0016); i++) {
    const px = rand() * w;
    const py = rand() * h;
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px + h * (0.06 + rand() * 0.14), py + (rand() - 0.5) * h * 0.04);
    c.strokeStyle = hexToRgba(dark, 0.10 + rand() * 0.16);
    c.lineWidth = Math.max(0.5, h * 0.018);
    c.stroke();
  }

  // SATIN, not gloss. A hard white band along the top made the beam look
  // like moulded plastic; oiled timber returns a wide, dim sheen and lets
  // the grain stay visible through it.
  const spec = c.createLinearGradient(0, 0, 0, h * 0.52);
  spec.addColorStop(0, "rgba(255,248,236,0.17)");
  spec.addColorStop(1, "rgba(255,248,236,0)");
  c.fillStyle = spec;
  c.fillRect(0, 0, w, h);
  const bounce = c.createLinearGradient(0, h * 0.74, 0, h);
  bounce.addColorStop(0, "rgba(255,214,160,0)");
  bounce.addColorStop(1, "rgba(255,214,160,0.16)");
  c.fillStyle = bounce;
  c.fillRect(0, 0, w, h);

  // the milled ends read as end grain: a short cross-hatch, darker
  for (const ex of [0, w]) {
    const dir = ex === 0 ? 1 : -1;
    const g = c.createLinearGradient(ex, 0, ex + dir * h * 0.7, 0);
    g.addColorStop(0, hexToRgba(dark, 0.5));
    g.addColorStop(1, hexToRgba(dark, 0));
    c.fillStyle = g;
    c.fillRect(Math.min(ex, ex + dir * h * 0.7), 0, h * 0.7, h);
  }
  c.restore();

  if (wallSprites.size >= WALL_SPRITE_LIMIT) {
    wallSprites.delete(wallSprites.keys().next().value);
  }
  wallSprites.set(key, canvas);
  return canvas;
}

function drawWall(ctx, layout, o, theme) {
  const a = toPx(layout, o.x, o.y);
  const w = o.w * layout.scale;
  const h = o.h * layout.scale;
  const cy = a.y + h / 2;
  const base = theme.obstacleColor ?? DEFAULT_THEME.obstacleColor;
  ctx.save();

  const sh = ctx.createLinearGradient(0, cy, 0, a.y + h * 1.6);
  sh.addColorStop(0, "rgba(24,12,4,0.38)");
  sh.addColorStop(1, "rgba(24,12,4,0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(a.x + w / 2, cy + h * 0.42, w / 2, h * 0.5, 0, 0, TAU);
  ctx.fill();

  const dpr = (typeof devicePixelRatio === "number" ? devicePixelRatio : 1) || 1;
  const seed = ((Math.round(o.x * 9973) ^ Math.round(o.y * 7919)) | 1) + 41;
  const sprite = wallSprite(base, w, h, dpr, seed);
  if (sprite) {
    ctx.drawImage(sprite, a.x, a.y, w, h);
    ctx.restore();
    return;
  }

  const col = formColors(base);
  const rr = Math.min(h * 0.34, w * 0.09);
  ctx.beginPath();
  ctx.moveTo(a.x + rr, a.y);
  ctx.lineTo(a.x + w - rr, a.y);
  ctx.quadraticCurveTo(a.x + w, a.y, a.x + w, a.y + rr);
  ctx.lineTo(a.x + w, a.y + h - rr);
  ctx.quadraticCurveTo(a.x + w, a.y + h, a.x + w - rr, a.y + h);
  ctx.lineTo(a.x + rr, a.y + h);
  ctx.quadraticCurveTo(a.x, a.y + h, a.x, a.y + h - rr);
  ctx.lineTo(a.x, a.y + rr);
  ctx.quadraticCurveTo(a.x, a.y, a.x + rr, a.y);
  ctx.closePath();
  const body = ctx.createLinearGradient(0, a.y, 0, a.y + h);
  body.addColorStop(0, col.rim);
  body.addColorStop(0.18, col.highlight);
  body.addColorStop(0.52, col.fill);
  body.addColorStop(1, col.rim);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.restore();
}

/**
 * A bumper: a drum skin.
 *
 * Four candidates were drawn on the real board and this one was chosen.
 * The brief it had to satisfy came out of what was wrong with the version
 * before it: that one glowed, and the portal already glows -- two
 * emissive objects meaning two different things is worse than neither
 * being emissive -- and nothing about it said the prop stands UP.
 *
 * What this says instead of height is TENSION. A dark collar with a taut
 * membrane stretched inside it, and one very tight specular on the skin,
 * which is exactly how a pinball bumper reads and why nobody has to be
 * told what one does. The collar's inner face is shaded all the way
 * round rather than on one side, so the prop keeps the square-on
 * viewpoint the rest of the board is drawn from.
 */
function drawBumper(ctx, layout, o, theme) {
  const { x, y } = toPx(layout, o.x, o.y);
  const r = o.radius * layout.scale;
  const base = theme.bumperColor ?? DEFAULT_THEME.bumperColor;
  ctx.save();
  propShadow(ctx, x, y, r, 0.34);

  const collar = ctx.createRadialGradient(x - r * 0.2, y - r * 0.24, r * 0.2, x, y, r);
  collar.addColorStop(0, shadeHex(base, -0.42));
  collar.addColorStop(0.7, shadeHex(base, -0.56));
  collar.addColorStop(1, shadeHex(base, -0.74));
  ctx.fillStyle = collar;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();

  // the collar's inside face, in shadow the whole way round
  const inner = ctx.createRadialGradient(x, y, r * 0.58, x, y, r * 0.80);
  inner.addColorStop(0, "rgba(0,0,0,0.55)");
  inner.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.82, 0, TAU);
  ctx.fill();

  const skin = ctx.createRadialGradient(x - r * 0.2, y - r * 0.24, r * 0.02, x, y, r * 0.68);
  skin.addColorStop(0, shadeHex(base, 0.55));
  skin.addColorStop(0.55, base);
  skin.addColorStop(1, shadeHex(base, -0.22));
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.66, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = hexToRgba(shadeHex(base, 0.7), 0.55);
  ctx.lineWidth = Math.max(0.8, r * 0.035);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.66, 0, TAU);
  ctx.stroke();

  // the tight specular: a drum skin is taut, and taut is a SMALL
  // highlight. A wide one would make it slack.
  const sx = x - r * 0.24;
  const sy = y - r * 0.28;
  const spec = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.24);
  spec.addColorStop(0, "rgba(255,255,255,0.85)");
  spec.addColorStop(0.4, "rgba(255,255,255,0.28)");
  spec.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.arc(sx, sy, r * 0.24, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * A hole, seen from DIRECTLY ABOVE.
 *
 * The version before this borrowed the stone's raking light: the near lip
 * threw a shadow across one side and a crescent lit the far wall. That is
 * how a pit looks from an angle, and it was the one object on this board
 * claiming a viewpoint the others do not have -- everything else is
 * square-on, so a hole with a shadow pushed to one side read as a
 * mistake rather than as depth.
 *
 * Straight down, a shaft has no light side. What you see is the walls all
 * the way round, foreshortened into a ring that gets darker with every
 * metre, and black in the middle where the bottom is too far to reach.
 * So the depth is a purely CONCENTRIC ramp -- no direction anywhere in it
 * -- with two things laid over it that a flat gradient cannot say on its
 * own:
 *
 * with faint radial streaks on the wall converging toward the centre.
 * Parallel lines converging is the oldest depth cue there is, and it is
 * what stops the ramp reading as an airbrushed dot.
 *
 * NO CRACKS. A version of this drew a fracture network running out into
 * the board from the rim -- a couple of dominant splits over a scatter of
 * hairlines -- on the reasoning that a hole in a board is evidence
 * something broke through. It read as hair. At the size a pit is actually
 * played, every line thin enough to be a hairline is one pixel wide and
 * lands as noise around a shape whose whole strength is that it is a
 * clean dark circle, and the dominant splits could not carry the idea on
 * their own. The opening does not need explaining; it needs an edge.
 */
const holeSprites = new Map();
const HOLE_SPRITE_LIMIT = 12;

function holeSprite(base, radiusPx, dpr, seed) {
  const r = Math.round(radiusPx * dpr);
  if (r < 3) return null;
  const key = `${base}|${seed}|${r}`;
  const hit = holeSprites.get(key);
  if (hit) return hit;

  const pad = 2;
  const size = (r + pad) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const rand = propRandom(seed);

  // 1. the broken lip: a narrow ring of exposed material just outside the
  // mouth, all the way round because nothing here has a light side
  const lip = c.createRadialGradient(cx, cy, r * 0.93, cx, cy, r * 1.12);
  lip.addColorStop(0, "rgba(0,0,0,0.34)");
  lip.addColorStop(0.35, "rgba(0,0,0,0.14)");
  lip.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = lip;
  c.beginPath();
  c.arc(cx, cy, r * 1.12, 0, TAU);
  c.fill();

  // 2. the shaft
  c.save();
  c.beginPath();
  c.arc(cx, cy, r, 0, TAU);
  c.clip();

  const wall = c.createRadialGradient(cx, cy, r * 0.18, cx, cy, r);
  wall.addColorStop(0, "#000000");
  wall.addColorStop(0.42, "#05060a");
  // The top of the wall is mixed toward WHITE, not toward the hole's own
  // colour. Every theme sets holeColor near-black, which on a near-black
  // board (neon) left the mouth with no edge at all -- the pit vanished
  // into the wood it was cut in. Lifting the last two stops gives the rim
  // a value of its own on every board, and reads correctly besides: the
  // top of a shaft is the part daylight still reaches.
  wall.addColorStop(0.78, shadeHex(base, 0.10));
  wall.addColorStop(0.93, shadeHex(base, 0.34));
  wall.addColorStop(1, shadeHex(base, 0.52));
  c.fillStyle = wall;
  c.fillRect(0, 0, size, size);

  // the wall's own texture: streaks running down it, converging
  const streaks = 26 + Math.floor(rand() * 14);
  for (let i = 0; i < streaks; i++) {
    const a = (TAU * i) / streaks + (rand() - 0.5) * 0.14;
    const inner = r * (0.30 + rand() * 0.30);
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * r * 1.01, cy + Math.sin(a) * r * 1.01);
    c.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    const g = c.createLinearGradient(
      cx + Math.cos(a) * r, cy + Math.sin(a) * r,
      cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    const pale = rand() > 0.55;
    g.addColorStop(0, pale ? "rgba(255,238,208,0.10)" : "rgba(0,0,0,0.30)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.strokeStyle = g;
    c.lineWidth = Math.max(0.7, r * (0.012 + rand() * 0.022));
    c.stroke();
  }

  // and a last uniform darkening at the very rim, the wall turning under
  const under = c.createRadialGradient(cx, cy, r * 0.86, cx, cy, r);
  under.addColorStop(0, "rgba(0,0,0,0)");
  under.addColorStop(0.7, "rgba(0,0,0,0.35)");
  under.addColorStop(1, "rgba(0,0,0,0.05)");
  c.fillStyle = under;
  c.fillRect(0, 0, size, size);
  c.restore();

  if (holeSprites.size >= HOLE_SPRITE_LIMIT) {
    holeSprites.delete(holeSprites.keys().next().value);
  }
  holeSprites.set(key, canvas);
  return canvas;
}

function drawHole(ctx, layout, o, theme) {
  const { x, y } = toPx(layout, o.x, o.y);
  const r = o.radius * layout.scale;
  const base = theme.holeColor ?? DEFAULT_THEME.holeColor;
  const dpr = (typeof devicePixelRatio === "number" ? devicePixelRatio : 1) || 1;
  const seed = ((Math.round(o.x * 9973) ^ Math.round(o.y * 7919)) | 1) + 73;
  const sprite = holeSprite(base, r, dpr, seed);
  ctx.save();
  if (sprite) {
    const half = (sprite.width / 2) / dpr;
    ctx.drawImage(sprite, x - half, y - half, half * 2, half * 2);
  } else {
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, "#000000");
    g.addColorStop(1, shadeHex(base, -0.2));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A portal: a dark aperture with a glowing ring, in its pair's colour.
 *
 * The pair is told apart by hue, and hue is enough here because the ring
 * is the only EMISSIVE thing on the board besides the bumper -- and the
 * bumper is one fixed colour per theme, while portals are never that
 * colour. A player picks the matching pair out of peripheral vision
 * without reading anything.
 */
function drawPortal(ctx, layout, o, theme, phase) {
  const palette = theme.portalColors ?? DEFAULT_THEME.portalColors;
  // Pairs are authored as link 1, 2, 3..., so the FIRST pair on a board
  // has to land on the first colour. Indexing by the raw link number put
  // every portal in the game on the second entry, which is why they all
  // came out orange the first time this palette changed.
  const pair = Math.max(0, (o.link ?? 1) - 1);
  const tint = palette[pair % palette.length];
  const { x, y } = toPx(layout, o.x, o.y);
  const r = o.radius * layout.scale;
  const pulse = 0.86 + 0.14 * Math.sin(phase * 1.7);
  ctx.save();
  propGlow(ctx, x, y, r, tint, 0.9 * pulse);

  // ONE edge, not two. The dish shading used for a hole puts a dark band
  // just inside the rim -- correct for a pit, where that band is the near
  // lip's own shadow, and wrong here, where it landed immediately inside
  // the bright ring and read as a second outline drawn around the first.
  // A portal is not a hole in the board, it is a way through, so its
  // inside is a single unbroken ramp: the ring's light at the edge,
  // falling to black at the centre, with nothing in between.
  const mouth = ctx.createRadialGradient(x, y, 0, x, y, r);
  mouth.addColorStop(0, shadeHex(tint, -0.88));
  mouth.addColorStop(0.45, shadeHex(tint, -0.78));
  mouth.addColorStop(0.86, shadeHex(tint, -0.52));
  mouth.addColorStop(1, shadeHex(tint, -0.12));
  ctx.fillStyle = mouth;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();

  // the ring: one stroke, brightest where the light hits, and it TURNS,
  // which is the only motion on a board of still objects
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineWidth = Math.max(1.2, r * 0.10);
  const spin = phase * 0.9;
  const ring = ctx.createLinearGradient(
    x + Math.cos(spin) * r, y + Math.sin(spin) * r,
    x - Math.cos(spin) * r, y - Math.sin(spin) * r);
  ring.addColorStop(0, hexToRgba(shadeHex(tint, 0.6), 0.95 * pulse));
  ring.addColorStop(0.5, hexToRgba(tint, 0.55 * pulse));
  ring.addColorStop(1, hexToRgba(shadeHex(tint, 0.35), 0.85 * pulse));
  ctx.strokeStyle = ring;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.95, 0, TAU);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/**
 * Ice and clay: patches of GROUND, not objects.
 *
 * Everything that makes a prop stand up -- the drop shadow, the strong
 * body gradient, the rim occlusion -- is absent on purpose. What is left
 * is a texture, because ground is nothing but texture, and because a zone
 * has no silhouette to read: a player has to learn "this is slippery" or
 * "this is draggy" from the surface alone.
 *
 * BAKED PER PATCH. The patch is composited into an offscreen canvas and
 * blitted, rather than drawn straight onto the board, and that is not an
 * optimisation. Ice is TRANSLUCENT -- the board's own grid has to show
 * through it -- and the only way to get a translucent sheet whose texture
 * varies and whose edge fades out is to build it against transparency and
 * mask it, which cannot be done on a canvas that already has a board on
 * it. The cache is keyed by everything that changes the picture, so a
 * resize or a theme change makes new entries and the old ones fall out.
 */
/**
 * The outline of a zone: a fractured floe, never an ellipse.
 *
 * The version before this was nine control points joined by quadratic
 * curves, which is a recipe for a smooth blob no matter what the numbers
 * are -- the curve fitting sands off exactly the detail that makes a
 * shape look found rather than drawn. Real drift ice is bounded by
 * STRAIGHT segments meeting at hard angles, at uneven spacing, because
 * that boundary is where the sheet broke.
 *
 * So: many vertices, straight between them, and three independent sources
 * of variation -- how many vertices there are, a slow lobing that decides
 * the patch's overall silhouette, and a fast jitter on each vertex. All
 * three are drawn from the patch's OWN seed, which is mixed from its
 * board position and its kind, so no two patches on a board can come out
 * alike: not two clay patches, not two ice patches, and not a clay patch
 * and an ice one.
 *
 * The radius stays within about a tenth of the true one in both
 * directions. That is a hard constraint rather than a taste call: the
 * physics tests `hypot(stone - zone) < radius`, a circle, so a drawn edge
 * that wandered far from it would put the slippery ground somewhere the
 * player cannot see it -- or show it somewhere it is not.
 */
function zoneOutline(c, cx, cy, r, rand) {
  // FEW vertices, moved a LOT. The first attempt used twenty vertices
  // nudged a few percent each and produced a regular polygon with a
  // slight tremor -- the number of corners is what the eye counts, and
  // twenty corners at even spacing is a circle no matter how they wobble.
  // Seven to twelve, at uneven angles and very different radii, gives
  // long straight chords meeting at hard corners, which is what a broken
  // sheet actually looks like from above.
  const n = 7 + Math.floor(rand() * 6);
  const lobes = 2 + Math.floor(rand() * 2);
  const lobePhase = rand() * TAU;
  const lobeAmp = 0.05 + rand() * 0.07;
  const jitter = 0.05 + rand() * 0.05;
  const spin = rand() * TAU;
  // A floe is rarely round: squeeze along one axis and stretch across it,
  // so two patches differ in SILHOUETTE and not only in their corners.
  const squash = 0.06 + rand() * 0.05;
  const axis = rand() * Math.PI;
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);

  c.beginPath();
  for (let i = 0; i < n; i++) {
    const a = spin + (TAU * i) / n + (rand() - 0.5) * (TAU / n) * 0.75;
    const lobe = Math.sin(a * lobes + lobePhase) * lobeAmp;
    // one corner in four is a real spike or a real bite, which is where
    // the long chords come from
    const spike = rand() < 0.28 ? (rand() < 0.5 ? 0.09 : -0.10) : 0;
    // Biased a little OUTSIDE the true radius. The physics tests a
    // circle, so where the drawing and the rule disagree it should be by
    // showing slightly more slippery ground than there is, never less.
    const rr = r * (1.02 + lobe + spike + (rand() - 0.5) * 2 * jitter);
    const ux = Math.cos(a) * rr;
    const uy = Math.sin(a) * rr;
    // stretch along `axis`, squeeze across it
    const along = ux * ca + uy * sa;
    const across = -ux * sa + uy * ca;
    const px = cx + (along * (1 + squash)) * ca - (across * (1 - squash)) * sa;
    const py = cy + (along * (1 + squash)) * sa + (across * (1 - squash)) * ca;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
}

const zoneSprites = new Map();
const ZONE_SPRITE_LIMIT = 12;

function zoneSprite(clay, radiusPx, base, seed, dpr) {
  const tex = texture(clay ? "mud" : "ice");
  if (!tex) return null;
  const r = Math.round(radiusPx * dpr);
  if (r < 2) return null;
  const key = `${clay ? "m" : "i"}|${base}|${seed}|${r}`;
  const hit = zoneSprites.get(key);
  if (hit) return hit;

  // Padded, because the floe outline reaches past the true radius and
  // then takes a stroke on top of that. Without the pad the sprite's own
  // canvas edge crops the corners off every patch, which is a straight
  // line across a shape whose whole job is not to have any.
  const pad = Math.ceil(r * 0.24) + 2;
  const size = (r + pad) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  // One stream, drawn from the patch's own seed and consumed in a fixed
  // order: the outline first, then the tile's placement. The edge stroke
  // below restarts the same stream so it retraces exactly the same
  // outline.
  const rand = propRandom(seed);
  zoneOutline(c, cx, cy, r, rand);
  c.save();
  c.clip();

  c.fillStyle = base;
  c.fillRect(0, 0, size, size);

  // The tile is drawn oversize, offset AND ROTATED by the patch's own
  // seed. Two clay patches sit side by side on stage 15, and the same
  // tile drawn twice at the same angle reads instantly as one texture
  // stamped twice, which is the tell that gives a cheap game away.
  c.save();
  c.translate(cx, cy);
  c.rotate(rand() * TAU);
  c.translate(-cx, -cy);
  const scale = 1.5;
  const ox = cx - size * scale * (0.35 + rand() * 0.3);
  const oy = cy - size * scale * (0.35 + rand() * 0.3);
  c.globalCompositeOperation = clay ? "multiply" : "overlay";
  c.globalAlpha = clay ? 1 : 0.95;
  c.drawImage(tex, ox, oy, size * scale, size * scale);
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
  c.restore();

  if (clay) {
    // clay is wet, and wet is a sheen off the light side, not a paler brown
    const sx = cx - r * 0.34;
    const sy = cy - r * 0.40;
    const sheen = c.createRadialGradient(sx, sy, 0, sx, sy, r * 1.1);
    sheen.addColorStop(0, "rgba(255,244,220,0.16)");
    sheen.addColorStop(1, "rgba(255,244,220,0)");
    c.fillStyle = sheen;
    c.fillRect(0, 0, size, size);
  }
  c.restore();

  // The edge itself. Ice breaks with a bright lip, because a fracture
  // face is fresh and catches the sky; wet clay ends in a dark line where
  // the water pools against the boundary. It is one stroke either way,
  // and it is what keeps the patch from looking like a texture-filled
  // hole punched in the board.
  c.save();
  zoneOutline(c, cx, cy, r, propRandom(seed));
  c.lineJoin = "round";
  c.lineWidth = Math.max(1, r * 0.045);
  c.strokeStyle = clay ? "rgba(24,14,6,0.42)" : "rgba(255,255,255,0.7)";
  c.stroke();
  c.restore();

  // the patch's own alpha: mostly flat, falling off at the rim so the
  // ground changes gradually rather than ending at a line
  c.globalCompositeOperation = "destination-in";
  const mask = c.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 1.08);
  const core = clay ? 0.96 : 0.62;
  mask.addColorStop(0, `rgba(0,0,0,${core})`);
  mask.addColorStop(0.86, `rgba(0,0,0,${(core * 0.94).toFixed(2)})`);
  mask.addColorStop(1, `rgba(0,0,0,${(core * 0.55).toFixed(2)})`);
  c.fillStyle = mask;
  c.fillRect(0, 0, size, size);

  if (zoneSprites.size >= ZONE_SPRITE_LIMIT) {
    zoneSprites.delete(zoneSprites.keys().next().value);
  }
  zoneSprites.set(key, canvas);
  return canvas;
}

function drawZone(ctx, layout, o, theme) {
  const { x, y } = toPx(layout, o.x, o.y);
  const r = o.radius * layout.scale;
  const clay = o.friction >= 1;
  const base = clay
    ? (theme.sandColor ?? DEFAULT_THEME.sandColor)
    : (theme.iceColor ?? DEFAULT_THEME.iceColor);
  const seed = ((Math.round(o.x * 9973) ^ Math.round(o.y * 7919)) | 1) + (clay ? 17 : 0);

  const dpr = (typeof devicePixelRatio === "number" ? devicePixelRatio : 1) || 1;
  const sprite = zoneSprite(clay, r, base, seed, dpr);
  if (sprite) {
    const half = (sprite.width / 2) / dpr;
    ctx.drawImage(sprite, x - half, y - half, half * 2, half * 2);
    return;
  }

  // fallback, before the tile has loaded: the flat tinted patch
  ctx.save();
  ctx.globalAlpha = clay ? 0.9 : 0.5;
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// --- stones -------------------------------------------------------------
/**
 * Glossy 3D stone: a 3-stop radial gradient (bright offset highlight ->
 * mid-tone base -> darker rim) plus a soft shadow CLIPPED INSIDE the
 * stone's own circle rather than a real Canvas2D drop shadow. The clip is
 * not a stylistic preference — a true drop shadow extends past the shape
 * casting it, and this game deliberately lets a stone hang over the
 * board's edge into a margin sized for exactly one stone radius.
 */
// --- stones --------------------------------------------------------------
//
// A go stone is glass or shell, polished, sitting on wood under one soft
// light. Four things make that read, and the first pass here had only the
// first two:
//
//   1. A body gradient whose bright end is OFF CENTRE, up and to the left,
//      so the surface is curved rather than a flat disc.
//   2. An occlusion under the far rim, where the dome turns away.
//   3. A SPECULAR: the small hard reflection of the light itself. This is
//      the single thing that says "polished" — a matte stone and a glossy
//      one differ almost entirely in whether they have one.
//   4. A BOUNCE along the near-bottom rim: light off the board, back up
//      into the stone. On the black stone this is what stops it reading as
//      a hole cut in the board, and it is warm because the board is.
//
// PRE-RENDERED. All of that is a lot of gradients for something drawn up
// to a dozen times a frame, so each stone is baked once into an offscreen
// canvas at device resolution and blitted after that. The cache is keyed
// by colour and by radius in whole device pixels, so a resize or a theme
// change simply produces new entries and the old ones fall out.
const stoneSprites = new Map();
const STONE_SPRITE_LIMIT = 48;

/** The sprite is padded so the specular's soft halo has room to fall off
 * without being clipped by the canvas edge. */
const SPRITE_PAD = 0.06;

function stoneSprite(colors, radiusPx, dpr) {
  const { r: fr0, g: fg0, b: fb0 } = hexToRgb(colors.fill);
  const brightness = (0.2126 * fr0 + 0.7152 * fg0 + 0.0722 * fb0) / 255;
  // A pale stone needs a DEEPER and EARLIER falloff than a dark one to
  // read as a dome: white on white has no range to work with, so the
  // shading has to come from the rim inward. A theme that states its own
  // rim is left alone — this only fills in the default.
  const rim = colors.rim ?? darkenHex(colors.fill, RIM_FALLBACK_DARKEN + brightness * 0.14);
  const rimStart = colors.rimStart ?? 0.55 - brightness * 0.20;
  const gradientExtent = colors.gradientExtent ?? 1;
  const shadowAlpha = 0.32 * (colors.shadowBoost ?? 1);
  const r = Math.round(radiusPx * dpr);
  const key = `${colors.fill}|${colors.highlight}|${rim}|${rimStart}|${gradientExtent}|${colors.edgeColor ?? ""}|${r}`;
  const hit = stoneSprites.get(key);
  if (hit) return hit;

  // How bright the stone's own colour is, 0..1. Everything specular is
  // scaled by it: a white core at full strength on a white shell stone is
  // not a highlight, it is an eraser — it removes the only shading the
  // stone had. The black stone wants the opposite.
  const lum = brightness;

  const pad = Math.ceil(r * SPRITE_PAD) + 1;
  const size = (r + pad) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;

  const circle = () => {
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
  };

  // 1. body
  const body = c.createRadialGradient(cx - r * 0.28, cy - r * 0.36, r * 0.05, cx, cy, r * gradientExtent);
  body.addColorStop(0, colors.highlight);
  body.addColorStop(rimStart, colors.fill);
  body.addColorStop(1, rim);
  c.fillStyle = body;
  circle();
  c.fill();

  c.save();
  circle();
  c.clip();

  // 2. the far rim turns away from the light
  const shadow = c.createRadialGradient(cx, cy + r * 0.35, r * 0.15, cx, cy + r * 0.35, r * 1.05);
  shadow.addColorStop(0, `rgba(0, 0, 0, ${shadowAlpha})`);
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  c.fillStyle = shadow;
  c.fillRect(cx - r, cy - r, r * 2, r * 2);

  // 4. bounce off the board, up into the near rim. Warm, dim, and wide —
  // it is a whole board's worth of light arriving from everywhere at once,
  // so it has no shape of its own.
  // Scaled by how DARK the stone is: added light is what saves a black
  // stone from reading as a hole in the board, and what flattens a white
  // one into a paper dot.
  const bouncePeak = 0.22 * (1 - lum * 0.85);
  const bounce = c.createRadialGradient(cx + r * 0.34, cy + r * 0.62, r * 0.05, cx + r * 0.34, cy + r * 0.62, r * 0.95);
  bounce.addColorStop(0, `rgba(255, 226, 178, ${bouncePeak.toFixed(3)})`);
  bounce.addColorStop(0.55, `rgba(255, 214, 160, ${(bouncePeak * 0.35).toFixed(3)})`);
  bounce.addColorStop(1, "rgba(255, 200, 140, 0)");
  c.globalCompositeOperation = "lighter";
  c.fillStyle = bounce;
  c.fillRect(cx - r, cy - r, r * 2, r * 2);

  // 3. the light itself. A tight core inside a soft halo: one alone reads
  // as either a sticker (core only) or a smudge (halo only).
  const specX = cx - r * 0.34;
  const specY = cy - r * 0.40;
  const haloPeak = (0.32 - lum * 0.20).toFixed(3);
  const halo = c.createRadialGradient(specX, specY, 0, specX, specY, r * 0.62);
  halo.addColorStop(0, `rgba(255, 255, 255, ${haloPeak})`);
  halo.addColorStop(0.45, `rgba(255, 255, 255, ${(haloPeak * 0.3).toFixed(3)})`);
  halo.addColorStop(1, "rgba(255, 255, 255, 0)");
  c.fillStyle = halo;
  c.fillRect(cx - r, cy - r, r * 2, r * 2);
  c.globalCompositeOperation = "source-over";

  const coreR = r * (0.30 - lum * 0.09);
  const corePeak = 0.94 - lum * 0.42;
  const core = c.createRadialGradient(specX, specY, 0, specX, specY, coreR);
  core.addColorStop(0, `rgba(255, 255, 255, ${corePeak.toFixed(3)})`);
  core.addColorStop(0.42, `rgba(255, 255, 255, ${(corePeak * 0.48).toFixed(3)})`);
  core.addColorStop(1, "rgba(255, 255, 255, 0)");
  c.save();
  c.translate(specX, specY);
  c.rotate(-0.5);
  c.scale(1, 0.62);
  c.translate(-specX, -specY);
  c.fillStyle = core;
  c.beginPath();
  c.arc(specX, specY, coreR, 0, Math.PI * 2);
  c.fill();
  c.restore();

  // A thin occlusion inside the whole rim. Without it a pale stone has no
  // edge of its own and floats; with it, the disc ends where the stone
  // ends. Stronger on the pale stone, which needs it most.
  const edgeAo = c.createRadialGradient(cx, cy, r * 0.66, cx, cy, r);
  edgeAo.addColorStop(0, "rgba(60, 40, 20, 0)");
  edgeAo.addColorStop(1, `rgba(60, 40, 20, ${(0.10 + lum * 0.16).toFixed(3)})`);
  c.fillStyle = edgeAo;
  c.fillRect(cx - r, cy - r, r * 2, r * 2);
  c.restore();

  // The hairline that keeps a white stone off white wood. Unchanged, and
  // still guarded: a stone animating out passes through a radius small
  // enough for arc() to throw.
  if (colors.edgeColor && r > 0.5) {
    c.strokeStyle = colors.edgeColor;
    c.globalAlpha = colors.edgeAlpha;
    c.lineWidth = Math.max(1, dpr);
    c.beginPath();
    c.arc(cx, cy, r - Math.max(0.5, dpr * 0.5), 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
  }

  if (stoneSprites.size >= STONE_SPRITE_LIMIT) stoneSprites.clear();
  const sprite = { canvas, r, pad };
  stoneSprites.set(key, sprite);
  return sprite;
}

/**
 * The stone's own shadow on the board.
 *
 * The file header used to say a real drop shadow was impossible here,
 * because a stone may hang half off the board and the shadow would bleed
 * into the margin game/layout.js reserves for that overhang. It is
 * possible; it just has to be CLIPPED TO THE BOARD, which is also what
 * the physical thing does — a shadow falls on the wood or it falls on
 * nothing. Small and tight, because the stone touches the board.
 *
 * Baked like the stone itself: this runs once per stone per frame, and a
 * radial gradient built twelve times a frame for a blur that never
 * changes is the kind of cost that only shows up on a phone.
 */
const shadowSprites = new Map();

function shadowSprite(radiusPx, dpr) {
  const r = Math.round(radiusPx * dpr);
  const hit = shadowSprites.get(r);
  if (hit) return hit;
  const reach = Math.ceil(r * 1.3);
  const size = reach * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  const g = c.createRadialGradient(reach, reach, r * 0.55, reach, reach, r * 1.22);
  g.addColorStop(0, "rgba(24, 14, 4, 0.40)");
  g.addColorStop(0.6, "rgba(24, 14, 4, 0.17)");
  g.addColorStop(1, "rgba(24, 14, 4, 0)");
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  if (shadowSprites.size >= STONE_SPRITE_LIMIT) shadowSprites.clear();
  const sprite = { canvas, reach };
  shadowSprites.set(r, sprite);
  return sprite;
}

function drawStoneShadow(ctx, layout, x, y, radius, alpha, dpr) {
  const sprite = shadowSprite(radius, dpr);
  const reach = sprite.reach / dpr;
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.originX, layout.originY, layout.size, layout.size);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite.canvas, x + radius * 0.10 - reach, y + radius * 0.16 - reach, reach * 2, reach * 2);
  ctx.restore();
}

/** Exported for the same reason drawBoardOnly and drawObstacle are: study
 * tools (test/props.mjs, tools/texture-study.mjs) have to judge a surface
 * with the things that actually sit on it, and a board sheet with no
 * stones on it flatters every surface equally. */
export function drawStone(ctx, layout, stone, theme, alphaOverride = 1, radiusScale = 1) {
  const { x, y } = toPx(layout, stone.x, stone.y);
  const radius = stone.radius * layout.scale * radiusScale;
  if (radius <= 0) return;
  const dpr = ctx.getTransform?.().a || 1;
  const colors = theme.stones[stone.player];

  if (alphaOverride > 0.05) drawStoneShadow(ctx, layout, x, y, radius, alphaOverride, dpr);

  const sprite = stoneSprite(colors, radius, dpr);
  const half = (sprite.r + sprite.pad) / dpr;
  ctx.save();
  ctx.globalAlpha = alphaOverride;
  ctx.drawImage(sprite.canvas, x - half, y - half, half * 2, half * 2);
  ctx.restore();
}

/** A pulsing ring marking which of your stones can be flicked. Drawn
 * UNDER the stones so it never obscures the stone's own gradient. */
function drawSelectionRings(ctx, layout, stones, theme, phase) {
  if (stones.length === 0) return;
  const pulse = 0.5 + 0.5 * Math.sin(phase * 3.2);
  ctx.save();
  ctx.strokeStyle = theme.aimColor;
  ctx.lineWidth = 2;
  for (const s of stones) {
    const { x, y } = toPx(layout, s.x, s.y);
    const r = s.radius * layout.scale * (1.25 + pulse * 0.12);
    ctx.globalAlpha = 0.25 + pulse * 0.3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// --- aim indicator ------------------------------------------------------
/**
 * The slingshot. Three separate cues, because one is not enough on a
 * phone where a thumb covers the stone it is aiming:
 *   1. a taut band from the stone back to the pointer (where you pulled),
 *   2. a dashed ray forward from the stone (where it will go), its length
 *      proportional to power so distance is readable without a number,
 *   3. an arc gauge around the stone that fills as power approaches 1,
 *      so max power has a definite feel rather than being a guess.
 * @param {{x:number,y:number,radius:number}} stone
 * When the pointer is dragged back to within a hair of the stone the
 * release will do nothing (game/layout.js's MIN_DRAG), which is the
 * game's only way to call off a shot you have changed your mind about.
 * That escape hatch existed from the start and was completely invisible,
 * so `cancelling` draws it: the band goes grey, the forward ray and the
 * power gauge disappear entirely, and a cross sits over the stone. This
 * is the answer to "should there be an undo" — most of the shots a player
 * wants back are ones they knew were wrong before they let go.
 * @param {{dirX:number,dirY:number,power:number}} shot
 * @param {{x:number,y:number}} pointerBoard
 * @param {boolean} [cancelling]
 */
/**
 * The aim indicator, in one of two modes.
 *
 * `guide` is what separates the campaign from every player-versus-player
 * screen in this game. With it, the shot's line is EXTRAPOLATED for you:
 * a dashed ray thrown out ahead of the stone with an arrowhead on it,
 * lying across the board where the stone is about to travel. Without it
 * you get the pull-back band and nothing else.
 *
 * WHAT THAT ACTUALLY TAKES AWAY, precisely, because it is less than it
 * looks: direction is not hidden. The band you are dragging IS the shot
 * vector, negated — anyone can see which way the stone will go. What
 * goes is the EXTENSION of that line across the board. Judging where a
 * short reversed segment lands forty centimetres away is a different and
 * much harder task than reading a line somebody drew for you, and it is
 * the skill every serious pool and golf game removes its aim line to
 * make room for.
 *
 * The power arc stays in both modes. Power is not a thing you should
 * have to guess at from a drag length — it is already shown physically
 * by how far you have pulled, and removing the readout on top of that
 * makes the control feel unreliable rather than demanding.
 *
 * @param {boolean} [guide=true] draw the forward ray and arrowhead
 */
export function drawAim(ctx, layout, stone, shot, pointerBoard, theme, cancelling = false, guide = true) {
  if (cancelling) {
    drawCancelledAim(ctx, layout, stone, pointerBoard);
    return;
  }
  const from = toPx(layout, stone.x, stone.y);
  const back = toPx(layout, pointerBoard.x, pointerBoard.y);
  const len = Math.hypot(shot.dirX, shot.dirY) || 1;
  const ux = shot.dirX / len;
  const uy = shot.dirY / len;
  // The ray shows POWER, so its length is its own constant rather than a
  // multiple of MAX_DRAG — that coupling meant retuning the drag distance
  // for reachability silently shortened the aim indicator too, which is
  // the one part of the interface that has nothing to do with how far the
  // pointer had to travel.
  const rayLength = (0.08 + shot.power * 0.52) * layout.scale;

  ctx.save();
  // 1. pull-back band
  ctx.strokeStyle = theme.aimColor;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(back.x, back.y);
  ctx.stroke();

  // 2. forward ray — campaign only; see `guide` above.
  if (guide) {
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(from.x + ux * stone.radius * layout.scale, from.y + uy * stone.radius * layout.scale);
    ctx.lineTo(from.x + ux * rayLength, from.y + uy * rayLength);
    ctx.stroke();
    ctx.setLineDash([]);

    // arrowhead, so direction reads even at very low power
    const tipX = from.x + ux * rayLength;
    const tipY = from.y + uy * rayLength;
    const head = Math.max(layout.size * 0.018, 7);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * head - uy * head * 0.55, tipY - uy * head + ux * head * 0.55);
    ctx.lineTo(tipX - ux * head + uy * head * 0.55, tipY - uy * head - ux * head * 0.55);
    ctx.closePath();
    ctx.fillStyle = theme.aimColor;
    ctx.fill();
  }

  // 3. power arc — both modes.
  const gaugeR = stone.radius * layout.scale * 1.85;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 4;
  ctx.strokeStyle = theme.aimColor;
  ctx.beginPath();
  ctx.arc(from.x, from.y, gaugeR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(from.x, from.y, gaugeR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * shot.power);
  ctx.stroke();
  ctx.restore();
}

function drawCancelledAim(ctx, layout, stone, pointerBoard) {
  const from = toPx(layout, stone.x, stone.y);
  const back = toPx(layout, pointerBoard.x, pointerBoard.y);
  const radius = stone.radius * layout.scale;
  ctx.save();
  ctx.strokeStyle = "#9a9a9a";
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(back.x, back.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // A cross ON the stone, not beside it — the message is "this stone is
  // not going anywhere", and anywhere else it reads as a marker for the
  // spot rather than for the shot.
  const arm = radius * 0.72;
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = 0.92;
  ctx.lineWidth = Math.max(radius * 0.16, 2);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x - arm, from.y - arm);
  ctx.lineTo(from.x + arm, from.y + arm);
  ctx.moveTo(from.x + arm, from.y - arm);
  ctx.lineTo(from.x - arm, from.y + arm);
  ctx.stroke();
  ctx.restore();
}

/**
 * The first-run demonstration: a ghost fingertip that pulls back from the
 * stone and lets go, on a loop, with a dashed track behind it. Shown only
 * on the campaign's first stage to a player who has never taken a shot.
 *
 * A slingshot is not self-evident — a first-time player's instinct on a
 * board game is to tap where they want the stone to GO, which here does
 * nothing at all, and "nothing happens when I touch it" is how a portal
 * player leaves in the first ten seconds. Showing the gesture costs
 * nothing and needs no words.
 */
function drawDragHint(ctx, layout, stone, theme, phase) {
  const period = 2.6;
  const t = (phase % period) / period;
  // Pull back over the first 60% of the loop, snap forward over the next
  // 12%, then hold empty — the pause is what makes the loop read as a
  // repeated demonstration rather than a jittering animation.
  const pull = t < 0.6 ? easeOutCubic(t / 0.6) : t < 0.72 ? 1 - (t - 0.6) / 0.12 : 0;
  if (pull <= 0.001) return;

  const from = toPx(layout, stone.x, stone.y);
  const reach = MAX_DRAG * 0.8 * layout.scale;
  const tipX = from.x;
  const tipY = from.y + reach * pull; // straight back, i.e. the stone would fly up the board
  const radius = stone.radius * layout.scale;

  ctx.save();
  ctx.globalAlpha = 0.5 * Math.min(1, pull * 3);
  ctx.strokeStyle = theme.aimColor;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.setLineDash([]);

  // The fingertip: a filled disc with a ring, sized like a real contact
  // patch rather than a cursor, since the gesture being taught is a touch
  // gesture.
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(tipX, tipY, radius * 0.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = theme.aimColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(tipX, tipY, radius * 1.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * One full frame.
 * @param {object} options
 * @param {typeof DEFAULT_THEME} [options.theme]
 * @param {{stone:object, shot:object, pointerBoard:object}|null} [options.aim]
 * @param {{id:number,x:number,y:number,player:0|1,radius:number,progress:number}[]} [options.fading]
 *   stones removed this turn, still shrinking out — drawn after the live
 *   ones so a stone leaving does not pop.
 * @param {number} [options.phase] - seconds since start, for the pulse
 * @param {{id:number}[]} [options.selectable]
 */
/**
 * The target for a draw shot: rings around the middle of the board.
 *
 * Drawn ON the wood rather than as an object sitting on it — the whole
 * readability contract (see the header) says a thing with a silhouette is
 * a thing a stone can hit, and this one is not. So: hairlines in the
 * board's own grid ink, one ring per stone width, exactly the marks a
 * player would scratch on a real board to argue about who was closer.
 */
function drawTarget(ctx, layout, theme) {
  const centre = toPx(layout, 0.5, 0.5);
  const step = STONE_RADIUS * 2 * layout.scale;
  ctx.save();
  ctx.strokeStyle = theme.lineColor ?? DEFAULT_THEME.lineColor;
  for (const [ring, alpha] of [[1, 0.55], [2, 0.4], [3, 0.28]]) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = ring === 1 ? 1.6 : 1;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, step * ring, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, Math.max(2.5, layout.scale * 0.006), 0, Math.PI * 2);
  ctx.fillStyle = theme.lineColor ?? DEFAULT_THEME.lineColor;
  ctx.fill();
  ctx.restore();
}

/**
 * @param {number} [options.stoneAlpha] - fade the live stones out without
 *   removing them. Used by the draw shot: the shooter must SEE the stone
 *   leave (a shot with no flight reads as a bug) but nobody may see where
 *   it stops, so the stone dissolves in mid-travel.
 */

/**
 * The measurement, drawn on the board rather than only printed on a card.
 *
 * Two stones a few centimetres apart in board units is a number nobody
 * can picture; a line from each stone to the centre, labelled, is the
 * same fact in a form the eye settles in one look. This is the moment the
 * decider is FOR — both shots revealed together — so it gets held on
 * screen before any card covers it.
 *
 * @param {{x:number, y:number, player:0|1, label:string, winner:boolean}[]} marks
 */
function drawMeasures(ctx, layout, marks, theme) {
  const centre = toPx(layout, 0.5, 0.5);
  const size = Math.max(12, layout.scale * 0.032);
  ctx.save();
  ctx.lineCap = "round";
  for (const m of marks) {
    const p = toPx(layout, m.x, m.y);
    ctx.save();
    ctx.globalAlpha = m.winner ? 1 : 0.55;
    ctx.strokeStyle = theme.aimColor ?? DEFAULT_THEME.aimColor;
    ctx.lineWidth = m.winner ? 2.4 : 1.5;
    ctx.setLineDash(m.winner ? [] : [7, 6]);
    ctx.beginPath();
    ctx.moveTo(centre.x, centre.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // The label sits beyond the stone, on the far side from the centre,
    // so it never lands on top of the thing being measured.
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    const len = Math.hypot(dx, dy) || 1;
    const lx = p.x + (dx / len) * size * 1.7;
    const ly = p.y + (dy / len) * size * 1.7;
    ctx.font = `${m.winner ? 700 : 500} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // A thin outline plus a shadow, not a thick one: a heavy stroke turns
    // two digits into a blob at the size this is read from.
    ctx.lineWidth = size * 0.18;
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = size * 0.35;
    ctx.strokeText(m.label, lx, ly);
    ctx.shadowBlur = 0;
    ctx.fillStyle = m.winner ? (theme.aimColor ?? DEFAULT_THEME.aimColor) : "rgba(255,255,255,0.82)";
    ctx.fillText(m.label, lx, ly);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The simulated path of the shot being aimed, from game/preview.js.
 *
 * Drawn UNDER the stones and over the board, because it is a plan rather
 * than an object: it must never sit on top of the stone it is about to
 * hit, or the player reads the line as passing through a stone it will
 * actually bounce off.
 *
 * Two weights, split at the first contact. Solid is "this is what
 * happens"; dotted is "this is what happens if that contact goes the way
 * the physics says", which is true and is still the half a player should
 * plan around less. The end of the line is marked by what ended it — a
 * ring where the stone comes to rest, nothing at all where it left the
 * board or went down a pit, because the line simply stopping at the rim
 * IS that information and a marker there would soften it.
 */
function drawPreviewPath(ctx, layout, preview, theme) {
  const pts = preview.points;
  if (!pts || pts.length < 2) return;
  const px = pts.map((p) => toPx(layout, p.x, p.y));
  const split = Math.max(1, Math.min(preview.contactAt, px.length - 1));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // A dark under-stroke first: the path crosses wood, ice, mud and the
  // mouth of a pit, and a single light line disappears over the pale
  // ones. Same trick the aim ray does not need because it only ever
  // crosses a couple of centimetres of board.
  for (const pass of [
    { color: "rgba(0,0,0,0.5)", width: 7 },
    { color: theme.aimColor, width: 3.2 },
  ]) {
    ctx.strokeStyle = pass.color;
    ctx.lineWidth = pass.width;
    ctx.globalAlpha = pass.color === theme.aimColor ? 0.92 : 0.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(px[0].x, px[0].y);
    for (let i = 1; i <= split; i++) ctx.lineTo(px[i].x, px[i].y);
    ctx.stroke();

    if (split < px.length - 1) {
      ctx.globalAlpha = (pass.color === theme.aimColor ? 0.92 : 0.5) * 0.62;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.moveTo(px[split].x, px[split].y);
      for (let i = split + 1; i < px.length; i++) ctx.lineTo(px[i].x, px[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // The contact itself, marked where it happens — the one place on the
  // line the player is actually deciding about.
  if (preview.contactAt > 0 && preview.contactAt < px.length - 1) {
    const c = px[split];
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = theme.aimColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(layout.size * 0.011, 4), 0, Math.PI * 2);
    ctx.stroke();
  }

  if (preview.ending === "rest" || preview.ending === "timeout") {
    const e = px[px.length - 1];
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = theme.aimColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, STONE_RADIUS * layout.scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawScene(ctx, layout, match, { theme = DEFAULT_THEME, aim = null, fading = [], phase = 0, selectable = [], hintStone = null, target = false, stoneAlpha = 1, measures = null, preview = null } = {}) {
  ctx.clearRect(0, 0, layout.width, layout.height);
  drawBoardSurface(ctx, layout, theme);
  if (target) drawTarget(ctx, layout, theme);
  drawObstacles(ctx, layout, match.world, theme, phase);
  if (preview) drawPreviewPath(ctx, layout, preview, theme);
  if (!aim) drawSelectionRings(ctx, layout, selectable, theme, phase);
  for (const s of match.world.stones) {
    if (s.alive) drawStone(ctx, layout, s, theme, stoneAlpha);
  }
  for (const f of fading) {
    const t = Math.max(0, 1 - f.progress);
    drawStone(ctx, layout, f, theme, t, 0.4 + t * 0.6);
  }
  if (measures) drawMeasures(ctx, layout, measures, theme);
  if (aim) {
    drawStone(ctx, layout, aim.stone, theme, stoneAlpha); // redraw on top of the band
    drawAim(ctx, layout, aim.stone, aim.shot, aim.pointerBoard, theme, aim.cancelling, aim.guide !== false);
  } else if (hintStone) {
    drawDragHint(ctx, layout, hintStone, theme, phase);
  }
}
