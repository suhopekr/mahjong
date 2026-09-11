// eight-ball-pool/src/main.js
// The page: draws game/rules.js's table on a canvas, and turns drags,
// taps, the power bar and the buttons into shots.
//
// Nothing about the rules lives here — the rack, the fouls, whose turn it
// is, and what the computer plays are all the engine's (game/rack.js,
// game/rules.js, game/ai.js) and none of them touch the DOM. This file
// owns: measuring the table, the aim and placement gestures, the shot
// animation and its sounds, undo, saving, the settings sheet, the end of
// the game, languages, and analytics.
//
// Words: nothing the player reads is written here. Every phrase is a key
// into src/i18n/strings.js (this game) or /i18n/common.js (site-wide),
// looked up through i18n.t() in the language chosen in Settings; static
// markup carries data-i18n and is swapped by i18n.applyStatic().

import * as P from "./game/physics.js";
import { CUE, remaining, nearestPlacement, isValidPlacement } from "./game/rack.js";
import {
  newGame, applyShot, legalTargets, placeCue, toJSON, fromJSON,
} from "./game/rules.js";
import { chooseShot, chooseCuePlacement, pocketingCandidates, PACES } from "./game/ai.js";
import * as R from "./game/render.js";
import * as LO from "./game/layout.js";
import { simulateShotPath } from "./game/preview.js";
import { attachPointerHandlers } from "./core/input.js";
import * as store from "./core/storage.js";
import * as audio from "./core/audio.js";
import * as ads from "./core/ads.js";
import { createI18n } from "/i18n/i18n.js";
import { common } from "/i18n/common.js";
import { strings } from "./i18n/strings.js";

const i18n = createI18n({ common, game: strings });
i18n.applyStatic();

const $ = (id) => document.getElementById(id);
const mainEl = document.getElementById("eight-ball-pool");
const playEl = $("pool-play");
const tableColEl = $("pool-table-col");
const boardEl = $("pool-board");
const canvas = $("pool-canvas");
const ctx = canvas.getContext("2d");
const statusEl = $("pool-status");
const plate0 = $("pool-chip-0");
const plate1 = $("pool-chip-1");
const shotEl = $("pool-shot");
const powerInput = $("pool-power");
const powerWord = $("pool-power-word");
const shootBtn = $("pool-shoot");
const spinBox = $("pool-spin");
const controlsEl = document.querySelector(".pool-controls");
const hintBtn = $("pool-hint-btn");
const undoBtn = $("pool-undo-btn");
const newBtn = $("pool-new-btn");
const settingsBtn = $("pool-settings-btn");
const settingsPanel = $("pool-settings-panel");
const settingsClose = $("pool-settings-close");
const winModal = $("pool-win-modal");
const winTitle = $("pool-win-title");
const winNote = $("pool-win-note");
const winAgain = $("pool-win-again");
const winClose = $("pool-win-close");
const confirmModal = $("pool-confirm-modal");
const confirmYes = $("pool-confirm-yes");
const confirmNo = $("pool-confirm-no");
const toasts = $("pool-toasts");

const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const HUMAN = 0;
const AI = 1;

// ----------------------------------------------------------------------
// analytics — same shape as every other page: check gtag exists, never throw
// ----------------------------------------------------------------------
function trackEvent(name, params) {
  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, { game_name: "eight_ball_pool", ...params });
    }
  } catch { /* analytics must never affect the game */ }
}
for (const el of document.querySelectorAll("a[data-crossgame-to]")) {
  el.addEventListener("click", () => {
    trackEvent("cross_game_click", { from: "eight_ball_pool", to: el.dataset.crossgameTo, placement: el.dataset.placement });
  });
}

// ----------------------------------------------------------------------
// state
// ----------------------------------------------------------------------
let settings = store.getSettings();
let stats = store.loadStats();
let game = null;
/** Snapshots taken before each of the player's shots. Undo restores the
 *  last one, which takes back the player's shot AND the computer's reply
 *  in one press — the two are one exchange as far as the player is
 *  concerned, and undoing half of it would leave the table mid-turn. */
let undoStack = [];
/** "aim" | "place" | "shooting" | "waiting" | "over" */
let phase = "aim";
let layout = null;
let aim = { x: 1, y: 0 };
let pull = 0.5;
/** The player's own setting. The slider also shows how hard the COMPUTER
 *  is about to hit, which is worth seeing — but it must be handed back
 *  where the player left it when their turn comes round again. */
let myPull = 0.5;
let spinSide = 0;
let ghost = null;          // ball-in-hand candidate position
let hintPath = null;       // the preview line a Hint drew
let hintBall = null;       // and the ball it rings
let hintPulseUntil = 0;    // …which pulses for a few seconds, then rests
let sinking = [];          // pocket animations
let loopId = null;
let simSeconds = 0;
let eventsSeen = 0;
let lastStatus = null;

audio.setSoundEnabled(settings.sound);
R.applyCloth(settings.cloth);

// ----------------------------------------------------------------------
// words
// ----------------------------------------------------------------------
function setStatus(key, args) {
  lastStatus = { key, args };
  statusEl.textContent = i18n.t(key, args);
}
function refreshStatus() { if (lastStatus) setStatus(lastStatus.key, lastStatus.args); }
function toast(text) {
  const el = document.createElement("div");
  el.className = "achievement-toast is-visible";
  el.textContent = text;
  toasts.appendChild(el);
  setTimeout(() => { el.classList.remove("is-visible"); setTimeout(() => el.remove(), 300); }, 2600);
}
/** "solids" / "stripes" in the current language. */
const groupWord = (g) => i18n.t(g === "solid" ? "solids" : "stripes");
const groupWordCap = (g) => i18n.t(g === "solid" ? "solidsCap" : "stripesCap");
const playerName = (p) => i18n.t(p === HUMAN ? "you" : "computer");
/** A ball's spoken name. The 8 is "8"; everything else is its number. */
const ballName = (id) => id;

// ----------------------------------------------------------------------
// layout — the table is as big as the screen can show
// ----------------------------------------------------------------------
function measure() {
  // THE WIDTH BUDGET.
  //
  // The page column no longer has a 760px cap (style.css says why), so the
  // width on offer is the whole play block — EXCEPT where the toolbar
  // stands beside the table instead of under it. style.css owns that
  // breakpoint and publishes it as --pool-side; reading the flag back is
  // how this function learns which layout is on screen without a second
  // copy of the media query that would quietly drift from the first.
  const side = getComputedStyle(mainEl).getPropertyValue("--pool-side").trim() === "1";
  const gapPx = parseFloat(getComputedStyle(playEl).columnGap) || 0;
  // Rounded UP, and a pixel more. The toolbar column is as wide as its
  // longest word, which is a fraction of a pixel in most languages, and
  // .pool-play wraps: underestimate that width by a third of a pixel and
  // German's "Einstellungen" tips the whole toolbar onto the line below
  // the table, where at 1024x768 it lands off the bottom of the screen.
  // offsetWidth rounds to the nearest integer and did exactly that.
  const asideW = side ? Math.ceil(controlsEl.getBoundingClientRect().width + gapPx) + 1 : 0;
  const W = Math.max(180, (playEl.clientWidth || 360) - asideW);
  const vh = window.innerHeight || 800;
  // A pool table is 2:1 and a phone is 1:2, so the table stands upright on
  // anything narrow and lies down on anything wide. 620 is between the
  // widest phone we ship to and the narrowest tablet.
  const vertical = W < 620;
  const shotH = shotEl.offsetHeight || 96;
  const bodyTop = document.body.getBoundingClientRect().top;
  const boardTop = boardEl.getBoundingClientRect().top - bodyTop;

  // What stands between the bottom of the cloth and the bottom of the
  // screen. The shot row always does. The toolbar does too on a screen
  // that is not a portrait phone, because "no scrolling" has to mean the
  // whole game: a player who must scroll the cloth away to reach New game
  // or Settings has been given a bigger table and a worse page. On a
  // portrait phone it deliberately does NOT count — there the table is
  // already taller than the fold (see `scrolled` below) and the toolbar
  // lives one flick under it, which is the trade that block describes.
  // Where the toolbar stands BESIDE the table it costs no height at all.
  const toolbarH = vertical || side
    ? 0
    : controlsEl.offsetHeight + (parseFloat(getComputedStyle(controlsEl).marginTop) || 0);

  // THE HEIGHT BUDGET.
  //
  // Three sizes are in play. `fits` is the table that needs no scrolling
  // at all — from the site header down to the last control on one screen
  // (the Take the shot button on a phone, the toolbar under or beside it
  // everywhere else; see toolbarH). `wants` is the table whose balls are
  // BALL_FLOOR_PX across, which is the size BRIEF.md sets for the smallest
  // phone we ship to.
  // `scrolled` is the table that fits once the player has flicked the
  // header and the goal line off the top: the status line pins itself to
  // the top of the window and the shot row to the bottom, so that view is
  // status + the WHOLE cloth + the controls, which is the view a player
  // aiming a shot actually wants.
  //
  // The table grows from `fits` toward `wants` and stops at `scrolled`.
  // On a 390x844 phone and everything larger `fits` already clears the
  // floor and nothing scrolls. On a 375x667 phone it does not — it lands
  // near 13px, a ball smaller than the number printed on it — so the
  // table takes the scrolled budget instead and the player gives up one
  // flick of the thumb for a ball they can see.
  const BALL_FLOOR_PX = 18;
  const statusH = statusEl.offsetHeight || 60;
  const fits = Math.max(180, vh - boardTop - shotH - toolbarH - 12);
  const scrolled = Math.max(180, vh - statusH - shotH - 12);
  const floorScale = BALL_FLOOR_PX / (2 * P.BALL_RADIUS);
  const wants = (vertical ? LO.BOX_ALONG : LO.BOX_ACROSS) * floorScale + 2 * LO.MARGIN_PX;
  const avail = Math.max(fits, Math.min(wants, scrolled));

  const size = LO.canvasSizeFor(W, avail, vertical);
  canvas.style.width = size.width + "px";
  canvas.style.height = size.height + "px";
  layout = LO.tableLayout(size.width, size.height, vertical);
  R.prepareCanvas(canvas, ctx);
  // Published so tools/qa/pool_qa.py can assert the ball never falls below
  // the size BRIEF.md sets for a 375px screen.
  window.__poolBallPx = 2 * layout.ballPx;
}

// ----------------------------------------------------------------------
// drawing
// ----------------------------------------------------------------------
function draw() {
  if (!layout || !game) return;
  R.prepareCanvas(canvas, ctx);
  R.drawTable(ctx, layout);
  const world = game.world;
  const cue = P.getBall(world, CUE);
  const myTurn = game.turn === HUMAN && !game.over;
  const legal = game.over ? [] : legalTargets(game);
  const dimOthers = myTurn && phase === "aim" && game.groups[HUMAN]
    ? (b) => b.id !== CUE && !legal.includes(b.id)
    : null;

  if (game.ballInHand && game.kitchen && (phase === "place" || phase === "aim")) {
    R.drawKitchen(ctx, layout);
  }
  R.drawBalls(ctx, layout, world.balls, { sinking, dim: dimOthers });

  if (phase === "place" && ghost) {
    R.drawGhost(ctx, layout, ghost.x, ghost.y, ghost.ok);
  }
  if (hintPath) R.drawPreview(ctx, layout, hintPath);
  if (hintBall) {
    const b = P.getBall(world, hintBall);
    // Pulses three times and then holds still (DESIGN.md 1.4). Holding
    // still also lets the animation loop stop: a ring that breathed for
    // as long as the player thought about the shot would keep a phone
    // rendering at 60fps for a minute at a time.
    if (b && !b.pocketed) {
      const live = performance.now() < hintPulseUntil;
      R.drawRing(ctx, layout, b.x, b.y, live ? performance.now() / 260 : Math.PI / 2);
    }
  }
  if ((phase === "aim" || phase === "waiting") && cue && !cue.pocketed && !game.over && !game.ballInHand) {
    if (settings.guide) {
      const a = R.computeAim(world, cue, aim.x, aim.y);
      const ok = !a || !a.target || legal.includes(a.target.id);
      R.drawAim(ctx, layout, cue, a, { legal: ok });
    }
    R.drawCue(ctx, layout, cue, aim.x, aim.y, LO.powerForPull(pull), spinSide * 0.35 * P.BALL_RADIUS);
  }
}

function requestDraw() {
  if (loopId !== null) return;
  loopId = requestAnimationFrame(() => { loopId = null; draw(); });
}

// ----------------------------------------------------------------------
// the plate: who is on what, and how many are left
// ----------------------------------------------------------------------
function fillPlate() {
  const els = [plate0, plate1];
  for (const p of [0, 1]) {
    const name = playerName(p);
    const g = game.groups[p];
    let text;
    if (!g) {
      text = i18n.t("chip", { name, group: i18n.t("anyBall") });
    } else {
      const left = remaining(game.world, g).length;
      text = left === 0
        ? i18n.t("chip", { name, group: i18n.t("onTheEight") })
        : i18n.t("chipLeft", { name, group: groupWordCap(g), n: left });
    }
    els[p].textContent = text;
    els[p].classList.toggle("is-turn", game.turn === p && !game.over);
    els[p].dataset.group = g || "open";
  }
}

// ----------------------------------------------------------------------
// the power bar
// ----------------------------------------------------------------------
function powerKey(v) { return v < 0.34 ? "powerSoft" : v < 0.7 ? "powerMedium" : "powerFirm"; }
function fillPower() {
  powerInput.value = String(Math.round(pull * 100));
  powerWord.textContent = i18n.t(powerKey(pull));
  powerInput.setAttribute("aria-valuetext", powerWord.textContent);
  shotEl.dataset.power = powerKey(pull).slice(5).toLowerCase();
}
powerInput.addEventListener("input", () => {
  pull = Number(powerInput.value) / 100;
  myPull = pull;
  fillPower();
  requestDraw();
});

// ----------------------------------------------------------------------
// aiming
// ----------------------------------------------------------------------
function aimAtTablePoint(tx, ty) {
  const cue = P.getBall(game.world, CUE);
  if (!cue) return;
  const dx = tx - cue.x;
  const dy = ty - cue.y;
  const d = Math.hypot(dx, dy);
  if (d * layout.scale < LO.AIM_PIVOT_MIN_PX) return;
  aim = { x: dx / d, y: dy / d };
  hintPath = null;
  hintBall = null;
}
/** Tap-to-aim: point the cue at this ball's easiest pocket. Tapping is
 *  the friendly gesture on a phone, and a mis-tap costs nothing — the
 *  worst case is an aim you drag away from. */
function aimAtBall(id) {
  const cue = P.getBall(game.world, CUE);
  const cands = pocketingCandidates(game.world, cue, [id]);
  if (cands.length) {
    aim = { x: Math.cos(cands[0].angle), y: Math.sin(cands[0].angle) };
  } else {
    const b = P.getBall(game.world, id);
    const d = Math.hypot(b.x - cue.x, b.y - cue.y) || 1;
    aim = { x: (b.x - cue.x) / d, y: (b.y - cue.y) / d };
  }
  hintPath = null;
  hintBall = null;
}
/** Which ball is under this point on the cloth, if any. */
function ballAt(tx, ty) {
  const grab = P.BALL_RADIUS * 1.9;
  let best = null;
  let bd = grab;
  for (const b of game.world.balls) {
    if (b.pocketed || b.id === CUE) continue;
    const d = Math.hypot(b.x - tx, b.y - ty);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

let press = null;
attachPointerHandlers(canvas, {
  onDown(pos) {
    if (!game || game.over) return;
    if (game.turn !== HUMAN) { setStatus("waitTurn"); return; }
    if (phase === "shooting") return;
    press = { x: pos.x, y: pos.y, moved: 0 };
    const t = LO.toTable(layout, pos.x, pos.y);
    if (game.ballInHand) { phase = "place"; updateGhost(t); }
    else { aimAtTablePoint(t.x, t.y); }
    requestDraw();
  },
  onMove(pos, meta) {
    if (!press || !meta.pressed || !game || game.over) return;
    press.moved = Math.max(press.moved, Math.hypot(pos.x - press.x, pos.y - press.y));
    const t = LO.toTable(layout, pos.x, pos.y);
    if (phase === "place") updateGhost(t);
    else aimAtTablePoint(t.x, t.y);
    requestDraw();
  },
  onUp(pos) {
    if (!press || !game || game.over) return;
    const tap = press.moved <= LO.TAP_SLOP_PX;
    press = null;
    const t = LO.toTable(layout, pos.x, pos.y);
    if (phase === "place") { commitPlacement(t); return; }
    if (tap) {
      const b = ballAt(t.x, t.y);
      if (b && legalTargets(game).includes(b.id)) aimAtBall(b.id);
      else aimAtTablePoint(t.x, t.y);
    }
    requestDraw();
  },
  onCancel() { press = null; },
});

canvas.addEventListener("keydown", (e) => {
  if (!game || game.over || game.turn !== HUMAN || phase === "shooting") return;
  const step = (e.shiftKey ? 3 : 1) * LO.NUDGE_DEGREES * Math.PI / 180;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const a = Math.atan2(aim.y, aim.x) + (e.key === "ArrowLeft" ? -step : step);
    aim = { x: Math.cos(a), y: Math.sin(a) };
    hintPath = null;
    requestDraw();
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    pull = Math.min(1, Math.max(0, pull + (e.key === "ArrowUp" ? 0.05 : -0.05)));
    fillPower();
    requestDraw();
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    takeShot();
  }
});

// ----------------------------------------------------------------------
// ball in hand
// ----------------------------------------------------------------------
function updateGhost(t) {
  const ok = isValidPlacement(game.world, t.x, t.y, { kitchen: game.kitchen });
  ghost = { x: t.x, y: t.y, ok };
}
function commitPlacement(t) {
  const spot = isValidPlacement(game.world, t.x, t.y, { kitchen: game.kitchen })
    ? { x: t.x, y: t.y }
    : nearestPlacement(game.world, t.x, t.y, { kitchen: game.kitchen });
  ghost = null;
  if (!spot || !placeCue(game, spot.x, spot.y)) {
    audio.playNope();
    setStatus(game.kitchen ? "notThereKitchen" : "notThere");
    phase = "aim";
    requestDraw();
    return;
  }
  game.ballInHand = false;
  phase = "aim";
  audio.playPlace();
  setStatus("placed");
  save();
  requestDraw();
}

// ----------------------------------------------------------------------
// taking a shot
// ----------------------------------------------------------------------
function speedForPull(v) {
  const p = LO.powerForPull(v);
  return LO.MIN_SHOT_SPEED + p * (P.MAX_SHOT_SPEED - LO.MIN_SHOT_SPEED);
}

function takeShot() {
  if (!game || game.over || phase === "shooting") return;
  if (game.turn !== HUMAN) { setStatus("waitTurn"); return; }
  if (game.ballInHand) { setStatus(game.kitchen ? "placeKitchen" : "placeAnywhere"); return; }
  if (pull < 0.04) { setStatus("powerFirst"); audio.playNope(); return; }
  undoStack.push(toJSON(game));
  if (undoStack.length > 60) undoStack.shift();
  fire(aim.x, aim.y, speedForPull(pull), spinSide * 0.35 * P.BALL_RADIUS);
}
shootBtn.addEventListener("click", takeShot);

function fire(dx, dy, speed, side) {
  const world = game.world;
  P.resetEvents(world);
  const cue = P.getBall(world, CUE);
  P.strike(cue, dx, dy, speed, side, 0);
  audio.playStroke(Math.min(1, speed / P.MAX_SHOT_SPEED));
  phase = "shooting";
  simSeconds = 0;
  eventsSeen = 0;
  hintPath = null;
  hintBall = null;
  ghost = null;
  setStatus("rolling");
  updateButtons();
  startLoop();
}

/** Real time drives the simulation, a little faster than life so a long
 *  roll does not become a wait. */
const SIM_SPEED = 1.35;
const SIM_CUTOFF = 14;

function startLoop() {
  if (loopId !== null) cancelAnimationFrame(loopId);
  let last = performance.now();
  const step = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (phase === "shooting") {
      P.stepWorld(game.world, dt * SIM_SPEED);
      simSeconds += dt * SIM_SPEED;
      voiceEvents();
      if (P.isAtRest(game.world) || simSeconds > SIM_CUTOFF) {
        if (!P.isAtRest(game.world)) { P.simulateToRest(game.world, 8); voiceEvents(); }
        finishShot();
      }
    }
    for (const s of sinking) s.k += dt * 4;
    sinking = sinking.filter((s) => s.k < 1);
    draw();
    if (phase === "shooting" || sinking.length || now < hintPulseUntil) loopId = requestAnimationFrame(step);
    else loopId = null;
  };
  loopId = requestAnimationFrame(step);
}

/** Turn the physics log into sound. At most one impact voiced per frame —
 *  a break makes a dozen inside 100ms and playing them all is mush. */
function voiceEvents() {
  const evs = game.world.events;
  let loudest = null;
  let pocketed = false;
  for (; eventsSeen < evs.length; eventsSeen++) {
    const e = evs[eventsSeen];
    if (e.type === "ball" || e.type === "cushion") {
      const s = Math.min(1, (e.speed || 0) / 3);
      if (!loudest || s > loudest.s) loudest = { type: e.type, s };
    } else if (e.type === "pocket") {
      pocketed = true;
      const b = P.getBall(game.world, e.ball);
      if (b) sinking.push({ id: b.id, x: b.x, y: b.y, k: 0 });
    }
  }
  if (loudest) {
    if (loudest.type === "ball") audio.playClick(loudest.s);
    else audio.playCushion(loudest.s);
  }
  if (pocketed) audio.playPocket();
}

// ----------------------------------------------------------------------
// what the shot did
// ----------------------------------------------------------------------
function finishShot() {
  phase = "waiting";
  const shooter = game.turn;
  const outcome = applyShot(game, game.world.events, { strict: game.strict });
  fillPlate();
  save();
  announce(shooter, outcome);
  updateButtons();
  if (outcome.over) { endGame(outcome); return; }
  if (game.turn === AI) { setTimeout(aiTurn, reduceMotion ? 300 : 900); phase = "waiting"; }
  else { phase = "aim"; pull = myPull; fillPower(); }
  requestDraw();
}

/** One sentence for what just happened, then what to do next. */
function announce(shooter, o) {
  const mine = shooter === HUMAN;
  if (o.over) return;
  if (o.spotEight) { setStatus("eightSpotted"); return; }
  if (o.foul) {
    if (o.cueScratch) setStatus(mine ? "foulScratchYou" : "foulScratchThem");
    else if (o.foul === "wrongBall") setStatus(mine ? "foulWrongYou" : "foulWrongThem");
    else if (o.foul === "noContact") setStatus(mine ? "foulMissYou" : "foulMissThem");
    else setStatus(mine ? "foulRailYou" : "foulRailThem");
    return;
  }
  if (o.assigned) {
    setStatus(mine ? "youGroup" : "theyGroup", { group: groupWord(o.assigned) });
    return;
  }
  if (o.ownMade.length > 1) {
    setStatus(mine ? "youPottedMany" : "theyPotted", mine ? { n: o.ownMade.length } : { name: ballName(o.ownMade[0]) });
    return;
  }
  if (o.ownMade.length === 1) {
    setStatus(mine ? "youPotted" : "theyPotted", { name: ballName(o.ownMade[0]) });
    return;
  }
  if (o.oppMade.length) { setStatus(mine ? "pottedTheirs" : "theyPottedYours"); return; }
  setStatus(mine ? "youMissed" : "theyMissed");
}

/** What to say while it is the player's turn and nothing has just
 *  happened — the prompt they read before every shot. */
function promptForTurn() {
  if (game.over) return;
  if (game.turn !== HUMAN) { setStatus("theirTurn"); return; }
  if (game.ballInHand) { setStatus(game.kitchen ? "placeKitchen" : "placeAnywhere"); return; }
  if (!game.breakDone) { setStatus("breakNow"); return; }
  const g = game.groups[HUMAN];
  if (!g) { setStatus("aimOpen"); return; }
  if (remaining(game.world, g).length === 0) { setStatus("aimEight"); return; }
  setStatus("aimGroup", { group: groupWord(g) });
}

// ----------------------------------------------------------------------
// the computer's turn
// ----------------------------------------------------------------------
function aiTurn() {
  if (!game || game.over || game.turn !== AI) return;
  setStatus("theirTurn");
  if (game.ballInHand) {
    const spot = chooseCuePlacement(game);
    placeCue(game, spot.x, spot.y);
    game.ballInHand = false;
    audio.playPlace();
    requestDraw();
  }
  const pace = PACES[settings.pace] || PACES.standard;
  const shot = chooseShot(game, { pace });
  aim = { x: Math.cos(shot.angle), y: Math.sin(shot.angle) };
  pull = LO.pullForPower(Math.min(1, Math.max(0, (shot.speed - LO.MIN_SHOT_SPEED) / (P.MAX_SHOT_SPEED - LO.MIN_SHOT_SPEED))));
  fillPower();
  phase = "waiting";
  requestDraw();
  // A beat with the cue drawn back, so the player sees what it is playing
  // rather than a table that suddenly explodes.
  setTimeout(() => {
    if (!game || game.over || game.turn !== AI) return;
    fire(shot.angle ? Math.cos(shot.angle) : 1, Math.sin(shot.angle), shot.speed, 0);
  }, reduceMotion ? 150 : 650);
}

// ----------------------------------------------------------------------
// the end
// ----------------------------------------------------------------------
async function endGame(o) {
  phase = "over";
  game.over = true;
  const won = o.winner === HUMAN;
  stats = store.recordResult(won);
  store.clearSave();
  undoBtn.disabled = true;
  hintBtn.disabled = true;
  shootBtn.disabled = true;
  if (won) {
    setStatus(o.reason === "eightMade" ? "wonEight" : o.reason === "eightScratch" ? "wonTheirScratch" : "wonTheirEarly");
    audio.playWin();
  } else {
    setStatus(o.reason === "eightMade" ? "lostEight" : o.reason === "eightScratch" ? "lostScratch" : "lostEarly");
    audio.playLose();
  }
  trackEvent("game_win", { result: won ? "player" : "computer", shots: game.shots });
  fillPlate();
  requestDraw();
  // The board already shows the finished table and the status line already
  // celebrates, so the ad lands on a screen that makes sense to come back
  // to (DESIGN.md 6).
  await new Promise((r) => setTimeout(r, reduceMotion ? 200 : 900));
  await ads.showInterstitial("game_over");
  fillWinNote();
  winModal.dataset.open = "true";
  winAgain.focus();
}

function fillWinNote() {
  if (!game || !game.over) return;
  const won = game.winner === HUMAN;
  winTitle.textContent = i18n.t(won ? "youWon" : "youLost");
  winNote.textContent = won ? i18n.t("winNote", { n: game.shots }) : i18n.t("loseNote");
}
winAgain.addEventListener("click", () => { winModal.dataset.open = "false"; rack(); });
winClose.addEventListener("click", () => { winModal.dataset.open = "false"; newBtn.focus(); });

// ----------------------------------------------------------------------
// a new rack
// ----------------------------------------------------------------------
function gameInProgress() { return game && game.shots > 0 && !game.over; }

newBtn.addEventListener("click", () => {
  if (gameInProgress()) { confirmModal.dataset.open = "true"; confirmYes.focus(); return; }
  rack();
});
// Abandoning a live game is the other natural pause (DESIGN.md 6): the
// decision is already made and the table is about to be swept, so an
// interstitial here interrupts nothing.
confirmYes.addEventListener("click", async () => {
  confirmModal.dataset.open = "false";
  await ads.showInterstitial("game_over");
  rack();
});
confirmNo.addEventListener("click", () => { confirmModal.dataset.open = "false"; newBtn.focus(); });

function rack({ seed } = {}) {
  ads.preloadInterstitial();
  game = newGame({
    seed: seed || (Date.now() % 100000) + 1,
    players: ["human", "ai"],
    strict: settings.rules === "standard",
    fullHand: settings.rules === "standard",
  });
  undoStack = [];
  sinking = [];
  hintPath = null;
  hintBall = null;
  ghost = null;
  phase = "aim";
  pull = 0.86;                     // a break wants a firm hit
  myPull = pull;
  aimAtRack();
  fillPower();
  fillPlate();
  save();
  trackEvent("game_start", { pace: settings.pace, rules: settings.rules });
  shootBtn.disabled = false;
  updateButtons();
  promptForTurn();
  measure();
  requestDraw();
}

/** Point the cue at the front of the triangle, so the opening shot is one
 *  press for anyone who does not want to aim it themselves. */
function aimAtRack() {
  const cue = P.getBall(game.world, CUE);
  let apex = null;
  for (const b of game.world.balls) {
    if (b.id === CUE || b.pocketed) continue;
    if (!apex || b.x < apex.x) apex = b;
  }
  if (!apex) return;
  const d = Math.hypot(apex.x - cue.x, apex.y - cue.y) || 1;
  aim = { x: (apex.x - cue.x) / d, y: (apex.y - cue.y) / d };
}

// ----------------------------------------------------------------------
// undo and hint
// ----------------------------------------------------------------------
function undo() {
  if (phase === "shooting" || !undoStack.length) { setStatus("nothingToUndo"); return; }
  const snap = undoStack.pop();
  const restored = fromJSON(snap);
  if (!restored) { setStatus("nothingToUndo"); return; }
  game = restored;
  sinking = [];
  hintPath = null;
  hintBall = null;
  ghost = null;
  phase = "aim";
  shootBtn.disabled = false;
  winModal.dataset.open = "false";
  audio.playUndo();
  fillPlate();
  save();
  setStatus("shotUndone");
  updateButtons();
  requestDraw();
}
undoBtn.addEventListener("click", undo);

hintBtn.addEventListener("click", async () => {
  if (!game || game.over || game.turn !== HUMAN || phase === "shooting") return;
  hintBtn.disabled = true;
  await ads.requestRewardedHint();
  hintBtn.disabled = false;
  if (!game || game.over || game.turn !== HUMAN) return;

  // With the cue ball in hand, WHERE to put it is half of the advice, so
  // the hint sets it down on the spot the computer would choose rather
  // than telling the player to do that part themselves first.
  let placedForYou = false;
  if (game.ballInHand) {
    const spot = chooseCuePlacement(game);
    if (placeCue(game, spot.x, spot.y)) {
      game.ballInHand = false;
      phase = "aim";
      placedForYou = true;
      audio.playPlace();
      save();
    }
  }

  let key;
  let shot;
  if (!game.breakDone) {
    aimAtRack();
    pull = 0.86;
    shot = { angle: Math.atan2(aim.y, aim.x), speed: speedForPull(pull), target: null };
    key = "hintBreak";
  } else {
    shot = chooseShot(game, { pace: PACES.challenging, best: true });
    aim = { x: Math.cos(shot.angle), y: Math.sin(shot.angle) };
    pull = LO.pullForPower(Math.min(1, Math.max(0, (shot.speed - LO.MIN_SHOT_SPEED) / (P.MAX_SHOT_SPEED - LO.MIN_SHOT_SPEED))));
    key = shot.intent === "make" ? "hintShown" : "hintNone";
  }
  if (placedForYou) key = "hintPlaced";
  myPull = pull;
  fillPower();
  hintBall = shot.target || null;
  hintPulseUntil = performance.now() + 3400;
  hintPath = simulateShotPath(game.world, CUE, { dirX: aim.x, dirY: aim.y, speed: shot.speed, side: 0, vertical: 0 });
  setStatus(key);
  updateButtons();
  startLoop();
});

function updateButtons() {
  undoBtn.disabled = undoStack.length === 0 || phase === "shooting" || (game && game.over);
  hintBtn.disabled = phase === "shooting" || (game && (game.over || game.turn !== HUMAN));
  shootBtn.disabled = phase === "shooting" || (game && (game.over || game.turn !== HUMAN));
}

// ----------------------------------------------------------------------
// saving
// ----------------------------------------------------------------------
function save() {
  if (!game || game.over) return;
  store.saveGame({ game: toJSON(game), undo: undoStack.slice(-20) });
}

// ----------------------------------------------------------------------
// settings
// ----------------------------------------------------------------------
function fillStats() {
  $("pool-stat-wins").textContent = stats.won;
  $("pool-stat-played").textContent = stats.played;
  $("pool-stat-best").textContent = stats.best;
}
function openSettings() {
  stats = store.loadStats();
  fillStats();
  i18n.renderPicker($("pool-lang-grid"));
  settingsPanel.dataset.open = "true";
  settingsClose.focus({ preventScroll: true });
}
function closeSettings() {
  settingsPanel.dataset.open = "false";
  settingsBtn.focus();
}
settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsPanel.addEventListener("click", (e) => { if (e.target === settingsPanel) closeSettings(); });

const paceRadios = document.querySelectorAll('input[name="pool-pace"]');
const rulesRadios = document.querySelectorAll('input[name="pool-rules"]');
const clothRadios = document.querySelectorAll('input[name="pool-cloth"]');
const spinRadios = document.querySelectorAll('input[name="pool-spin"]');
const guideToggle = $("pool-toggle-guide");
const spinToggle = $("pool-toggle-spin");
const soundToggle = $("pool-toggle-sound");

paceRadios.forEach((r) => { r.checked = r.value === settings.pace; });
rulesRadios.forEach((r) => { r.checked = r.value === settings.rules; });
clothRadios.forEach((r) => { r.checked = r.value === settings.cloth; });
guideToggle.checked = settings.guide;
spinToggle.checked = settings.spin;
soundToggle.checked = settings.sound;

paceRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings = store.setSetting("pace", r.value);
}));
rulesRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings = store.setSetting("rules", r.value);
  if (game) {
    game.strict = settings.rules === "standard";
    game.fullHand = settings.rules === "standard";
    save();
  }
}));
clothRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings = store.setSetting("cloth", r.value);
  R.applyCloth(settings.cloth);
  requestDraw();
}));
guideToggle.addEventListener("change", () => {
  settings = store.setSetting("guide", guideToggle.checked);
  requestDraw();
});
spinToggle.addEventListener("change", () => {
  settings = store.setSetting("spin", spinToggle.checked);
  applySpinVisibility();
  measure();
  requestDraw();
});
soundToggle.addEventListener("change", () => {
  settings = store.setSetting("sound", soundToggle.checked);
  audio.setSoundEnabled(settings.sound);
  if (settings.sound) audio.playPlace();
  toast(i18n.t(settings.sound ? "soundOn" : "soundOff"));
});
spinRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  spinSide = Number(r.value);
  requestDraw();
}));

function applySpinVisibility() {
  spinBox.hidden = !settings.spin;
  if (!settings.spin) {
    spinSide = 0;
    for (const r of spinRadios) r.checked = r.value === "0";
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (winModal.dataset.open === "true") { winModal.dataset.open = "false"; return; }
  if (confirmModal.dataset.open === "true") { confirmModal.dataset.open = "false"; return; }
  if (settingsPanel.dataset.open === "true") closeSettings();
});

// A new language: applyStatic() has already swapped every data-i18n text;
// this re-says everything the page wrote itself.
i18n.onChange(() => {
  fillPlate();
  fillPower();
  refreshStatus();
  fillStats();
  fillWinNote();
  requestDraw();
});

// ----------------------------------------------------------------------
// a test hook
// ----------------------------------------------------------------------
// tools/qa/pool_qa.py drives a whole rack in a real browser, and doing
// that through the canvas alone would be a script that aims by guessing
// pixels — it would fail for reasons that have nothing to do with the
// game. This exposes only what a test needs to ASK (whose turn, is it
// over, what does the table look like) and two shortcuts that call the
// same engine functions the buttons do. It reads state and presses the
// game's own levers; there is nothing here that can make the game behave
// differently from the way a player's hands make it behave.
window.__pool = {
  phase: () => phase,
  turn: () => (game ? game.turn : -1),
  over: () => Boolean(!game || game.over),
  ballInHand: () => Boolean(game && game.ballInHand),
  hasHint: () => Boolean(hintPath),
  shots: () => (game ? game.shots : 0),
  /** A cheap signature of the table, for save/restore and undo checks. */
  fingerprint: () => (game
    ? game.world.balls.map((b) => `${b.id}:${b.pocketed ? "x" : Math.round(b.x * 1000) + "," + Math.round(b.y * 1000)}`).join("|") + `#${game.turn}/${game.shots}`
    : ""),
  autoPlace: () => {
    if (!game || !game.ballInHand) return false;
    const spot = chooseCuePlacement(game);
    const ok = placeCue(game, spot.x, spot.y);
    if (ok) { game.ballInHand = false; phase = "aim"; save(); requestDraw(); }
    return ok;
  },
  autoAim: () => {
    if (!game || game.over || game.turn !== HUMAN) return false;
    if (!game.breakDone) { aimAtRack(); pull = 0.86; }
    else {
      const shot = chooseShot(game, { pace: PACES.challenging, best: true });
      aim = { x: Math.cos(shot.angle), y: Math.sin(shot.angle) };
      pull = LO.pullForPower(Math.min(1, Math.max(0, (shot.speed - LO.MIN_SHOT_SPEED) / (P.MAX_SHOT_SPEED - LO.MIN_SHOT_SPEED))));
    }
    fillPower();
    requestDraw();
    return true;
  },
};

// ----------------------------------------------------------------------
// boot
// ----------------------------------------------------------------------
applySpinVisibility();
measure();

let lastW = 0;
let lastH = 0;
/** The cheap guard against a ResizeObserver storm. It keys on the toolbar's
 *  width as well as the window's, because in the side-by-side layout the
 *  toolbar column is what the table's width is measured against, and that
 *  column is as wide as its longest word — "Einstellungen" and Indonesian's
 *  "Pengaturan" make it wider than English does. */
const remeasure = () => {
  const w = playEl.clientWidth * 10000 + controlsEl.offsetWidth;
  const h = window.innerHeight;
  if (w === lastW && h === lastH) return;
  lastW = w;
  lastH = h;
  measure();
  requestDraw();
};
new ResizeObserver(remeasure).observe(playEl);
new ResizeObserver(remeasure).observe(controlsEl);
window.addEventListener("orientationchange", () => setTimeout(remeasure, 120));
window.addEventListener("resize", remeasure);
requestAnimationFrame(() => requestAnimationFrame(() => { remeasure(); revealTable(); }));

/** Bring the whole table on screen, once, at boot.
 *
 * On a short phone the table is deliberately taller than the space above
 * the fold (see measure()), so at scroll 0 the player would be looking at
 * the top two thirds of the cloth with the white ball off the bottom —
 * which is the one thing a player about to aim must be able to see. One
 * scroll fixes it: the status line pins to the top, the shot row to the
 * bottom, and everything between them is table. Done once and never
 * again, so it can never fight a player who has scrolled somewhere on
 * purpose. */
let revealed = false;
function revealTable() {
  if (revealed || !layout) return;
  revealed = true;
  const need = boardEl.getBoundingClientRect().bottom + shotEl.offsetHeight - window.innerHeight;
  if (need <= 8) return;
  // Design review: scrolling by exactly `need` left the page resting in the
  // middle of the plate, so the first thing at the top of the screen was
  // the bottom two pixels of a chip. Land on the status line instead — it
  // is the element that pins to top:0, so this puts the sentence that says
  // what to do flush against the top of the window with nothing half-cut
  // above it, which is also where it stays for the rest of the game. (It
  // used to say .pool-play, which began with the status line; the chips
  // now live inside that block too, so the sticky element is named here
  // rather than inferred from the block that happens to start with it.)
  const stickyTop = statusEl.getBoundingClientRect().top + window.scrollY;
  const top = Math.max(stickyTop, window.scrollY + need);
  window.scrollTo({ top: Math.round(top), behavior: reduceMotion ? "auto" : "smooth" });
}

const saved = store.loadSave();
const restored = saved ? fromJSON(saved.game) : null;
if (restored && !restored.over) {
  game = restored;
  undoStack = Array.isArray(saved.undo) ? saved.undo : [];
  phase = "aim";
  pull = game.breakDone ? 0.5 : 0.86;
  myPull = pull;
  aimAtRack();
  fillPower();
  fillPlate();
  updateButtons();
  promptForTurn();
  measure();
  requestDraw();
  toast(i18n.t("restored"));
  if (game.turn === AI) setTimeout(aiTurn, 700);
} else {
  store.clearSave();
  rack();
}
