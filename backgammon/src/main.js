// backgammon/src/main.js
// The page: renders game/backgammon.js's state as 24 points, a bar, two
// trays and 30 checkers on a wooden board, and turns taps, drags and
// buttons into calls on it. The computer's replies come from game/ai.js.
//
// Nothing about the rules lives here — legal moves, hits, bearing off and
// the win are all the engine's. This file owns: measuring the board and
// placing everything, the tap and drag gestures, the turn loop against the
// computer (with its pauses and animations), undo within a turn, saving,
// the settings sheet, the end of the game, languages and analytics.

import {
  HUMAN, COMPUTER, newGame, rollOpening, rollDice, applyMove, applyMoves, undoMove, endTurn,
  legalMoves, legalSequences, destinationsFrom, soleDestination, movableFroms, diceDisplay, countAt, ownerAt, pipCount, canBearOff,
  posOf, clonePos, summarizeMoves, sameMove,
} from "./game/backgammon.js";
import { chooseComputerMoves, bestHumanMoves } from "./game/ai.js";
import * as store from "./core/storage.js";
import * as audio from "./core/audio.js";
import { preloadInterstitial, showInterstitial, requestRewardedHint } from "./core/ads.js";
import { createI18n } from "/i18n/i18n.js";
import { common } from "/i18n/common.js";
import { strings } from "./i18n/strings.js";

const i18n = createI18n({ common, game: strings });
const t = (key, arg) => i18n.t(key, arg);

const $ = (id) => document.getElementById(id);
const main = $("backgammon");
const board = $("bg-board");
const frame = $("bg-frame");
const field = $("bg-field");
const dicePanel = $("bg-dice-panel");
const diceEl = $("bg-dice");
const diceCaption = $("bg-dice-caption");
const rollBtn = $("bg-roll-btn");
const statusEl = $("bg-status");
const plateSwatch = $("bg-plate-swatch");
const plateText = $("bg-plate-text");
const hintBtn = $("bg-hint-btn");
const passBtn = $("bg-pass-btn");
const undoBtn = $("bg-undo-btn");
const newBtn = $("bg-new-btn");
const settingsBtn = $("bg-settings-btn");
const settingsPanel = $("bg-settings-panel");
const settingsClose = $("bg-settings-close");
const resultModal = $("bg-result-modal");
const resultTitle = $("bg-result-title");
const resultNote = $("bg-result-note");
const resultAgain = $("bg-result-again");
const resultClose = $("bg-result-close");
const confirmModal = $("bg-confirm-modal");
const confirmYes = $("bg-confirm-yes");
const confirmNo = $("bg-confirm-no");
const toasts = $("bg-toasts");

const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

// Timing of the computer's turn: the dice show first, then one checker
// at a time. Long enough to follow, short enough not to feel like waiting.
const AI_THINK_MS = 650;
const AI_STEP_MS = 450;
const HANDOFF_MS = 1100;   // after the player's last die: a moment for Undo before the computer replies
const END_PAUSE_MS = 600;  // the final slide settles before the interstitial / modal

// ----------------------------------------------------------------------
// analytics — same shape as every other page: check gtag exists, never throw
// ----------------------------------------------------------------------
function trackEvent(name, params) {
  try {
    if (typeof window.gtag === "function") window.gtag("event", name, { game_name: "backgammon", ...params });
  } catch { /* analytics must never affect the game */ }
}
for (const el of document.querySelectorAll("a[data-crossgame-to]")) {
  el.addEventListener("click", () => {
    trackEvent("cross_game_click", { from: "backgammon", to: el.dataset.crossgameTo, placement: el.dataset.placement });
  });
}

// ----------------------------------------------------------------------
// state
// ----------------------------------------------------------------------
let settings = store.loadSettings();
let stats = store.loadStats();
let state = null;
let selected = null;      // "bar" or a point index the player has lifted
let hintMoves = null;     // the sequence Hint is showing
let busy = false;         // the computer is moving / the game is ending
let gameId = 0;           // bumped on every new game so stale timers give up
let handoffTimer = null;  // the pause between the player's last die and the computer's reply
let lastStatus = null;    // [key, arg] so the line can be re-spoken in a new language
let layout = null;
let lastAiTurn = null;    // { start, dice, moves } of the computer's last turn, for the QA script

audio.setSoundEnabled(settings.sound);
main.dataset.colours = settings.colours;

const NAME_KEY = { burgundy: "nameBurgundy", navy: "nameNavy", black: "nameBlack" };
const computerName = () => t(NAME_KEY[settings.colours]);
const pointName = (loc) => (loc === "bar" ? t("bar") : loc === "off" ? t("home") : String(loc + 1));

// ----------------------------------------------------------------------
// the board's elements — built once, positioned by measure(), moved by render()
// ----------------------------------------------------------------------
const pointEls = [];      // index → <button class="bg-point">
const numEls = [];        // index → <span class="bg-num">
const checkerEls = { h: [], c: [] };  // 15 each
const checkerAt = new Map();          // element → { loc, k }
let barEl, barZone = {}, trayEl = {}, trayCount = {}, labelEls = {}, checkerLayer, badgeLayer, countLayer;

function build() {
  field.innerHTML = "";
  barEl = document.createElement("div");
  barEl.className = "bg-bar";
  field.appendChild(barEl);
  for (const p of [HUMAN, COMPUTER]) {
    const z = document.createElement(p === HUMAN ? "button" : "div");
    if (p === HUMAN) z.type = "button";
    z.className = "bg-bar-zone";
    z.dataset.zone = p;
    if (p === COMPUTER) z.setAttribute("aria-hidden", "true");
    field.appendChild(z);
    barZone[p] = z;
    const tr = document.createElement(p === HUMAN ? "button" : "div");
    if (p === HUMAN) tr.type = "button";
    tr.className = "bg-tray";
    tr.dataset.tray = p;
    if (p === COMPUTER) tr.setAttribute("aria-hidden", "true");
    const cnt = document.createElement("span");
    cnt.className = "bg-tray-count";
    tr.appendChild(cnt);
    field.appendChild(tr);
    trayEl[p] = tr;
    trayCount[p] = cnt;
  }
  for (let i = 0; i < 24; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bg-point " + ((i % 2 === 0) ? "is-cream" : "is-green");
    b.dataset.point = i;
    b.innerHTML = '<span class="bg-point-shape"></span><svg class="bg-point-edge" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,0 100,0 50,100"/></svg>';
    field.appendChild(b);
    pointEls.push(b);
  }
  for (const key of ["homeH", "homeC", "bar"]) {
    const l = document.createElement("span");
    l.className = "bg-label";
    l.setAttribute("aria-hidden", "true");
    labelEls[key] = l;
  }
  frame.appendChild(labelEls.homeH);
  frame.appendChild(labelEls.homeC);
  field.appendChild(labelEls.bar);
  for (let i = 0; i < 24; i++) {
    const n = document.createElement("span");
    n.className = "bg-num";
    n.textContent = String(i + 1);
    n.setAttribute("aria-hidden", "true");
    numEls.push(n);
  }
  checkerLayer = document.createElement("div");
  checkerLayer.className = "bg-checkers";
  field.appendChild(checkerLayer);
  for (const p of [HUMAN, COMPUTER]) {
    for (let k = 0; k < 15; k++) {
      const c = document.createElement("div");
      c.className = "bg-checker " + (p === HUMAN ? "is-ivory" : "is-dark");
      c.dataset.owner = p;
      checkerLayer.appendChild(c);
      checkerEls[p].push(c);
    }
  }
  countLayer = document.createElement("div");
  countLayer.className = "bg-checkers";
  field.appendChild(countLayer);
  badgeLayer = document.createElement("div");
  badgeLayer.className = "bg-checkers";
  field.appendChild(badgeLayer);
}

// ----------------------------------------------------------------------
// layout — everything derives from the board's measured width and height
// ----------------------------------------------------------------------
const POLY = {
  down: "0,0 100,0 50,100", up: "50,0 100,100 0,100", right: "0,0 100,50 0,100", left: "100,0 100,100 0,50",
};

function measure() {
  const W = board.clientWidth || 360;
  const vh = window.innerHeight || 800;
  const vertical = W < 600;
  const short = !vertical && vh < 600;
  const side = !vertical && (short || W >= 860);
  const boardTop = board.getBoundingClientRect().top + window.scrollY;
  const L = { W, vh, vertical, short, side };

  if (vertical) {
    const frameW = W < 480 ? 8 : 12;
    const trayH = 44, barH = W < 480 ? 68 : 76, gutter = 36;
    const availH = vh - boardTop - 16;
    const pitch = Math.max(40, Math.min(64, Math.floor((availH - barH - 2 * trayH - 2 * frameW) / 12)));
    const chk = Math.min(pitch, 44);
    const fieldW = W - 2 * frameW;
    const fieldH = 2 * trayH + 12 * pitch + barH;
    const pointLen = Math.floor((fieldW - gutter) / 2);
    Object.assign(L, { frameW, trayH, barH, gutter, pitch, chk, fieldW, fieldH, pointLen, die: 44, panelW: 0 });
    L.barY = trayH + 6 * pitch;
    L.rowY = (r) => (r < 6 ? trayH + r * pitch : trayH + 6 * pitch + barH + (r - 6) * pitch);
    // index → { col: "L"|"R", row: 0..11 }
    L.slot = (i) => (i <= 11 ? { col: "L", row: 11 - i } : { col: "R", row: i - 12 });
  } else {
    const frameW = short ? 10 : W < 700 ? 12 : 16;
    const panelW = side ? (short ? 76 : 124) : 0;
    const frameOuter = W - (side ? panelW + 12 : 0);
    const fieldW = frameOuter - 2 * frameW;
    let bar = 56, home = 48;
    let pitch = Math.floor((fieldW - 16 - bar - home) / 12);
    bar = Math.max(short ? 46 : 52, Math.min(72, pitch));
    home = Math.max(short ? 42 : 46, Math.min(64, Math.round(pitch * 0.9)));
    pitch = Math.floor((fieldW - 16 - bar - home) / 12);
    let padX = 8;
    if (pitch > 64) { pitch = 64; padX = Math.floor((fieldW - 12 * pitch - bar - home) / 2); }
    const mid = 16;
    const availH = vh - boardTop - 16 - (side ? 0 : 68);
    const capChk = Math.floor((availH - 2 * frameW - mid) / 9.2);
    let chk = Math.min(pitch - 4, 64, Math.max(40, capChk));
    chk = Math.max(32, chk);
    const pointLen = Math.round(chk * 4.6);
    const fieldH = 2 * pointLen + mid;
    Object.assign(L, { frameW, panelW, fieldW, fieldH, pitch, chk, bar, home, padX, mid, pointLen, die: W >= 600 ? 56 : 48 });
    // columns: left quadrant 0..5, bar, right quadrant 6..11, then the trays
    L.colX = (c) => padX + c * pitch + (c >= 6 ? bar : 0);
    L.barX = padX + 6 * pitch;
    L.trayX = fieldW - home;
    // index → { col 0..11, top: bool }: top row is 13..24 left→right, bottom row 12..1
    L.slot = (i) => (i >= 12 ? { col: i - 12, top: true } : { col: 11 - i, top: false });
  }
  layout = L;

  board.classList.toggle("is-vertical", vertical);
  board.classList.toggle("is-horizontal", !vertical);
  board.classList.toggle("is-side", side);
  board.classList.toggle("is-short", short);
  board.style.setProperty("--chk", L.chk + "px");
  board.style.setProperty("--pitch", L.pitch + "px");
  board.style.setProperty("--frame", L.frameW + "px");
  board.style.setProperty("--die", L.die + "px");
  board.style.setProperty("--panel", L.panelW + "px");
  field.style.width = L.fieldW + "px";
  field.style.height = L.fieldH + "px";

  // The dice panel lives on the bar in portrait, beside/under the frame otherwise.
  if (vertical) { if (dicePanel.parentNode !== barEl) barEl.appendChild(dicePanel); }
  else if (dicePanel.parentNode !== board) board.appendChild(dicePanel);

  const put = (el, x, y, w, h) => { el.style.left = x + "px"; el.style.top = y + "px"; el.style.width = w + "px"; el.style.height = h + "px"; };
  for (let i = 0; i < 24; i++) {
    const el = pointEls[i], r = pointRect(i);
    put(el, r.x, r.y, r.w, r.h);
    el.dataset.dir = r.dir;
    el.querySelector("polygon").setAttribute("points", POLY[r.dir]);
  }
  if (vertical) {
    put(barEl, 0, L.barY, L.fieldW, L.barH);
    const zoneW = Math.round(L.chk * 1.5);
    put(barZone.h, 8, L.barY + (L.barH - L.chk - 8) / 2, zoneW, L.chk + 8);
    put(barZone.c, 8 + zoneW + 6, L.barY + (L.barH - L.chk - 8) / 2, zoneW, L.chk + 8);
    const panelLeft = 8 + 2 * zoneW + 14;
    put(dicePanel, panelLeft, 0, L.fieldW - panelLeft - 8, L.barH);
    put(trayEl.c, 6, 4, L.fieldW - 12, L.trayH - 8);
    put(trayEl.h, 6, L.fieldH - L.trayH + 4, L.fieldW - 12, L.trayH - 8);
    for (const p of [HUMAN, COMPUTER]) { trayCount[p].style.right = "12px"; trayCount[p].style.top = Math.round((L.trayH - 8 - 15) / 2) + "px"; trayCount[p].style.left = ""; trayCount[p].style.bottom = ""; }
    labelEls.homeC.classList.remove("is-upright"); labelEls.homeH.classList.remove("is-upright"); labelEls.bar.classList.add("is-upright");
    // captions sit inside the trays' left ends (the frame is too thin in portrait)
    field.appendChild(labelEls.homeC); field.appendChild(labelEls.homeH);
    put(labelEls.homeC, 14, 4, 60, L.trayH - 8);
    put(labelEls.homeH, 14, L.fieldH - L.trayH + 4, 60, L.trayH - 8);
    put(labelEls.bar, 0, L.barY, 8, L.barH);
    labelEls.bar.style.display = "none";
    for (let i = 0; i < 24; i++) {
      const s = L.slot(i);
      // the left column's number on the left half of the gutter, the right's on the right
      put(numEls[i], L.pointLen + (s.col === "L" ? 0 : L.gutter / 2), L.rowY(s.row), L.gutter / 2, L.pitch);
      field.appendChild(numEls[i]);
    }
  } else {
    put(barEl, L.barX, 0, L.bar, L.fieldH);
    const zoneH = Math.round(L.chk * 2.2);
    put(barZone.c, L.barX + 2, Math.round(L.fieldH / 2) - zoneH - 4, L.bar - 4, zoneH);
    put(barZone.h, L.barX + 2, Math.round(L.fieldH / 2) + 4, L.bar - 4, zoneH);
    put(trayEl.c, L.trayX + 4, 4, L.home - 8, L.pointLen - 8);
    put(trayEl.h, L.trayX + 4, L.fieldH - L.pointLen + 4, L.home - 8, L.pointLen - 8);
    for (const p of [HUMAN, COMPUTER]) { trayCount[p].style.left = "0"; trayCount[p].style.right = "0"; trayCount[p].style.textAlign = "center"; }
    trayCount.c.style.top = ""; trayCount.c.style.bottom = "6px";
    trayCount.h.style.bottom = ""; trayCount.h.style.top = "6px";
    labelEls.homeC.classList.add("is-upright"); labelEls.homeH.classList.add("is-upright"); labelEls.bar.classList.add("is-upright");
    frame.appendChild(labelEls.homeC); frame.appendChild(labelEls.homeH);
    // "Home" on the right rim beside each tray, "Bar" on the felt between the zones
    put(labelEls.homeC, L.frameW + L.trayX + L.home, L.frameW, L.frameW, L.pointLen);
    put(labelEls.homeH, L.frameW + L.trayX + L.home, L.frameW + L.pointLen + L.mid, L.frameW, L.pointLen);
    labelEls.bar.style.display = L.short ? "none" : "";
    put(labelEls.bar, L.barX, Math.round(L.fieldH / 2) - 14, L.bar, 28);
    labelEls.bar.classList.remove("is-upright");
    labelEls.bar.style.fontSize = "12px";
    for (let i = 0; i < 24; i++) {
      const s = L.slot(i);
      const x = L.frameW + L.colX(s.col);
      put(numEls[i], x, s.top ? 0 : L.frameW + L.fieldH, L.pitch, L.frameW);
      frame.appendChild(numEls[i]);
    }
  }
  labelEls.homeH.textContent = t("homeLabel");
  labelEls.homeC.textContent = t("homeLabel");
  labelEls.bar.textContent = t("barLabel");
}

function pointRect(i) {
  const L = layout, s = L.slot(i);
  if (L.vertical) {
    const y = L.rowY(s.row);
    return s.col === "L"
      ? { x: 0, y, w: L.pointLen, h: L.pitch, dir: "right" }
      : { x: L.fieldW - L.pointLen, y, w: L.pointLen, h: L.pitch, dir: "left" };
  }
  const x = L.colX(s.col);
  return s.top
    ? { x, y: 0, w: L.pitch, h: L.pointLen, dir: "down" }
    : { x, y: L.fieldH - L.pointLen, w: L.pitch, h: L.pointLen, dir: "up" };
}

/** Pixel position of checker k of n at a location; also the stack pitch. */
function checkerPos(loc, k, n, owner) {
  const L = layout, chk = L.chk;
  if (loc === "bar") {
    const z = barZone[owner];
    const zx = parseFloat(z.style.left), zy = parseFloat(z.style.top), zw = parseFloat(z.style.width), zh = parseFloat(z.style.height);
    const step = Math.round(chk * 0.28);
    if (L.vertical) return { x: zx + 4 + Math.min(k, 2) * step, y: zy + (zh - chk) / 2, sp: step };
    return { x: zx + (zw - chk) / 2, y: owner === HUMAN ? zy + 4 + Math.min(k, 3) * step : zy + zh - chk - 4 - Math.min(k, 3) * step, sp: step };
  }
  if (loc === "off") {
    const tr = trayEl[owner];
    const tx = parseFloat(tr.style.left), ty = parseFloat(tr.style.top), tw = parseFloat(tr.style.width), th = parseFloat(tr.style.height);
    if (L.vertical) {
      const slabW = 10, slabH = th - 12;
      return { x: tx + 78 + k * (slabW + 3), y: ty + 6, w: slabW, h: slabH };
    }
    const slabH = 9, slabW = tw - 10;
    return owner === HUMAN
      ? { x: tx + 5, y: ty + th - 26 - (k + 1) * (slabH + 2), w: slabW, h: slabH }
      : { x: tx + 5, y: ty + 26 + k * (slabH + 2), w: slabW, h: slabH };
  }
  const r = pointRect(loc);
  const len = L.vertical ? r.w : r.h;
  const room = len - chk - 4;
  const sp = n <= 5 ? Math.min(Math.round(chk * 0.86), Math.floor(room / Math.max(1, n - 1)))
    : Math.max(Math.round(chk * 0.35), Math.floor(room / (n - 1)));
  if (L.vertical) {
    const y = r.y + (r.h - chk) / 2;
    return r.dir === "right" ? { x: r.x + 2 + k * sp, y, sp } : { x: r.x + r.w - 2 - chk - k * sp, y, sp };
  }
  const x = r.x + (r.w - chk) / 2;
  return r.dir === "down" ? { x, y: r.y + 2 + k * sp, sp } : { x, y: r.y + r.h - 2 - chk - k * sp, sp };
}

// ----------------------------------------------------------------------
// render — assign the 30 checker elements to locations so that a move
// animates as one checker sliding, then place everything
// ----------------------------------------------------------------------
function locKey(loc, owner) { return `${owner}:${loc}`; }

function assignCheckers() {
  for (const owner of [HUMAN, COMPUTER]) {
    const want = new Map(); // loc → count
    for (let i = 0; i < 24; i++) { const n = countAt(state.points, i, owner); if (n) want.set(i, n); }
    if (state.bar[owner]) want.set("bar", state.bar[owner]);
    if (state.off[owner]) want.set("off", state.off[owner]);
    // keep checkers already at a location, freeing the topmost extras
    const byLoc = new Map();
    for (const el of checkerEls[owner]) {
      const a = checkerAt.get(el);
      if (!a) continue;
      if (!byLoc.has(a.loc)) byLoc.set(a.loc, []);
      byLoc.get(a.loc).push(el);
    }
    const free = [];
    const kept = new Map();
    for (const [loc, els] of byLoc) {
      els.sort((p, q) => checkerAt.get(p).k - checkerAt.get(q).k);
      const n = want.get(loc) || 0;
      kept.set(loc, els.slice(0, n));
      for (const el of els.slice(n)) free.push(el);
    }
    for (const el of checkerEls[owner]) if (!checkerAt.has(el)) free.push(el);
    for (const [loc, n] of want) {
      const list = kept.get(loc) || [];
      while (list.length < n) list.push(free.pop());
      list.forEach((el, k) => checkerAt.set(el, { loc, k, n }));
    }
  }
}

function placeCheckers(instant = false) {
  const L = layout;
  countLayer.innerHTML = "";
  for (const owner of [HUMAN, COMPUTER]) {
    const stacks = new Map();
    for (const el of checkerEls[owner]) {
      const a = checkerAt.get(el);
      if (!a) continue;
      const p = checkerPos(a.loc, a.k, a.n, owner);
      const off = a.loc === "off";
      el.classList.toggle("is-off", off);
      if (instant) el.classList.add("no-transition");
      el.style.width = off ? p.w + "px" : "";
      el.style.height = off ? p.h + "px" : "";
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      el.style.zIndex = 10 + a.k;
      const key = String(a.loc);
      const s = stacks.get(key) || { n: a.n, top: null, topK: -1, loc: a.loc };
      if (a.k > s.topK) { s.topK = a.k; s.top = el; }
      stacks.set(key, s);
    }
    // a count badge on the top checker of a compressed stack (6+) or a bar/tray stack
    for (const s of stacks.values()) {
      const needs = (typeof s.loc === "number" && s.n > 5) || (s.loc === "bar" && s.n > 1);
      if (!needs) continue;
      const p = checkerPos(s.loc, s.topK, s.n, owner);
      const b = document.createElement("span");
      b.className = "bg-count";
      b.textContent = String(s.n);
      b.style.left = Math.round(p.x + L.chk / 2 - 13) + "px";
      b.style.top = Math.round(p.y + L.chk / 2 - 13) + "px";
      countLayer.appendChild(b);
    }
  }
  if (instant) {
    void field.offsetWidth;
    for (const owner of [HUMAN, COMPUTER]) for (const el of checkerEls[owner]) el.classList.remove("no-transition");
  }
}

function topCheckerEl(loc, owner) {
  let best = null, bk = -1;
  for (const el of checkerEls[owner]) {
    const a = checkerAt.get(el);
    if (a && a.loc === loc && a.k > bk) { bk = a.k; best = el; }
  }
  return best;
}

function isHumanMoving() { return state && state.phase === "move" && state.turn === HUMAN && !busy; }

function render({ instant = false } = {}) {
  if (!layout) measure();
  assignCheckers();
  placeCheckers(instant);

  const froms = isHumanMoving() ? movableFroms(state) : [];
  const dests = selected !== null && isHumanMoving() ? destinationsFrom(state, selected) : [];
  for (let i = 0; i < 24; i++) {
    const el = pointEls[i];
    const owner = ownerAt(state.points, i);
    const n = owner ? countAt(state.points, i, owner) : 0;
    el.classList.toggle("is-movable", froms.includes(i));
    el.classList.toggle("is-target", dests.some((d) => d.to === i));
    el.classList.toggle("is-empty", n === 0);
    el.setAttribute("aria-label", n ? t("pointAria", { n: i + 1, count: n, colour: owner === HUMAN ? t("ivory") : computerName().toLowerCase() }) : t("pointEmptyAria", { n: i + 1 }));
    el.tabIndex = froms.includes(i) || dests.some((d) => d.to === i) ? 0 : -1;
  }
  barZone.h.classList.toggle("is-movable", froms.includes("bar"));
  barZone.h.setAttribute("aria-label", state.bar.h ? t("barAria", { count: state.bar.h }) : t("barEmptyAria"));
  barZone.h.tabIndex = froms.includes("bar") ? 0 : -1;
  const offTarget = dests.some((d) => d.to === "off");
  trayEl.h.classList.toggle("is-target", offTarget);
  trayEl.h.tabIndex = offTarget ? 0 : -1;
  trayEl.h.setAttribute("aria-label", t("trayAria", { count: state.off.h }));
  trayCount.h.textContent = state.off.h ? String(state.off.h) : "";
  trayCount.c.textContent = state.off.c ? String(state.off.c) : "";

  for (const owner of [HUMAN, COMPUTER]) for (const el of checkerEls[owner]) el.classList.remove("is-selected", "is-hint");
  if (selected !== null) { const el = topCheckerEl(selected, HUMAN); if (el) { el.classList.add("is-selected"); el.style.transform += " translateY(-6px) scale(1.06)"; } }
  renderBadges();
  renderDice();
  renderControls();
  renderPlate();
}

function renderBadges() {
  badgeLayer.innerHTML = "";
  if (!hintMoves || !hintMoves.length) return;
  const L = layout;
  hintMoves.forEach((m, i) => {
    const b = document.createElement("span");
    b.className = "bg-badge";
    b.textContent = String(i + 1);
    let x, y;
    if (m.to === "off") {
      const tr = trayEl.h;
      x = parseFloat(tr.style.left) + parseFloat(tr.style.width) / 2 - 14;
      y = parseFloat(tr.style.top) + parseFloat(tr.style.height) / 2 - 14;
    } else {
      const r = pointRect(m.to);
      // at the tip end of the triangle, clear of the stack
      if (L.vertical) { x = r.dir === "right" ? r.x + r.w - 34 : r.x + 6; y = r.y + r.h / 2 - 14; }
      else { x = r.x + r.w / 2 - 14; y = r.dir === "down" ? r.y + r.h - 36 : r.y + 8; }
    }
    b.style.left = Math.round(x) + "px";
    b.style.top = Math.round(y) + "px";
    badgeLayer.appendChild(b);
    if (i === 0) { const el = topCheckerEl(m.from, HUMAN); if (el) el.classList.add("is-hint"); }
  });
}

function renderDice() {
  let faces = [];
  if (state.phase === "opening" && state.opening) faces = [{ face: state.opening.h, used: false }, { face: state.opening.c, used: false }];
  else if (state.dice.length) faces = diceDisplay(state);
  // before a roll two blank dice hold the place, so the bar never has a hole
  if (!faces.length) faces = [{ face: 0, used: false, blank: true }, { face: 0, used: false, blank: true }];
  diceEl.classList.toggle("is-double", faces.length === 4);
  const existing = diceEl.children.length === faces.length && [...diceEl.children].every((d, i) => d.dataset.face === String(faces[i].face));
  if (!existing) {
    diceEl.innerHTML = "";
    for (const f of faces) {
      const d = document.createElement("div");
      d.className = "bg-die";
      d.dataset.face = String(f.face);
      d.innerHTML = '<span class="bg-pip"></span>'.repeat(9);
      diceEl.appendChild(d);
    }
  }
  [...diceEl.children].forEach((d, i) => {
    d.classList.toggle("is-used", faces[i].used);
    d.classList.toggle("is-blank", !!faces[i].blank);
    if (faces[i].blank) { d.setAttribute("aria-hidden", "true"); d.removeAttribute("aria-label"); }
    else { d.removeAttribute("aria-hidden"); d.setAttribute("aria-label", t(faces[i].used ? "dieUsedAria" : "dieAria", { face: faces[i].face })); }
  });
  if (state.phase === "move" && state.dice.length) {
    const used = faces.filter((f) => f.used).map((f) => f.face), left = faces.filter((f) => !f.used).map((f) => f.face);
    diceCaption.textContent = used.length ? t("usedToPlay", { used: used.join(" · "), toPlay: left.length ? left.join(" · ") : t("none") }) : t("toPlay", { toPlay: left.join(" · ") });
  } else diceCaption.textContent = "";
  diceCaption.classList.toggle("is-hidden", layout.vertical && layout.W < 480);
}

function renderControls() {
  const human = state.turn === HUMAN;
  const canRoll = !busy && ((state.phase === "opening") || (state.phase === "roll" && human));
  const stuck = isHumanMoving() && legalMoves(state).length === 0;
  const only = isHumanMoving() && !stuck && legalMoves(state).length === 1;
  rollBtn.disabled = !canRoll && !stuck;
  rollBtn.textContent = stuck ? t("passTurn") : t("rollDice");
  passBtn.hidden = !(stuck || only);
  passBtn.textContent = stuck ? t("pass") : t("playMyMove");
  hintBtn.hidden = stuck || only;
  hintBtn.disabled = !isHumanMoving();
  undoBtn.disabled = !(state.phase === "move" && human && !busy && state.turnMoves.length > 0);
}

function renderPlate() {
  const name = computerName();
  let text, swatch = "none";
  if (state.phase === "over") text = t("plateOver");
  else if (state.phase === "opening") text = t("plateOpening");
  else if (state.turn === HUMAN) {
    swatch = "ivory";
    if (state.phase === "roll") text = t("plateYourRoll");
    else { const left = state.remaining; text = left.length === 1 ? t("plateYourMove", { die: left[0] }) : t("plateYourMoves", { n: left.length, dice: left.join(" · ") }); }
  } else {
    swatch = "dark";
    text = state.phase === "move" ? t("plateRolled", { name, a: state.dice[0], b: state.dice[1] }) : t("plateThinking", { name });
  }
  if (settings.pips) text += " · " + t("platePips", { you: pipCount(posOf(state), HUMAN), them: pipCount(posOf(state), COMPUTER), name });
  plateText.textContent = text;
  plateSwatch.className = "bg-plate-swatch" + (swatch === "dark" ? " is-dark" : swatch === "none" ? " is-none" : "");
}

function setStatus(key, arg) {
  lastStatus = [key, arg];
  statusEl.textContent = t(key, arg);
}
function toast(text) {
  const el = document.createElement("div");
  el.className = "achievement-toast is-visible";
  el.textContent = text;
  toasts.appendChild(el);
  setTimeout(() => { el.classList.remove("is-visible"); setTimeout(() => el.remove(), 300); }, 2600);
}
function save() { if (state.phase !== "over") store.saveGame(state); else store.clearGame(); }

// ----------------------------------------------------------------------
// words for a turn
// ----------------------------------------------------------------------
function listOf(items) {
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " " + t("and") + " " + items[items.length - 1];
}
function narrate(summary, player) {
  if (summary.empty) return t("narNothing");
  const arrow = (xs) => xs.map(pointName).join("→");
  const phrases = [];
  if (summary.entered.length) phrases.push(t("narEntered", { list: listOf(summary.entered.map(arrow)) }));
  if (summary.moved.length) phrases.push(t("narMoved", { list: listOf(summary.moved.map(arrow)) }));
  if (summary.off.length) phrases.push(t("narOff", { list: listOf(summary.off.map(pointName)) }));
  let text = listOf(phrases);
  const notes = [];
  if (summary.hits) {
    if (player === COMPUTER) notes.push(t(summary.hits > 1 ? "narHitYouMany" : "narHitYou"));
    else notes.push(t(summary.hits > 1 ? "narHitMany" : "narHitOne", { name: computerName().toLowerCase() }));
  }
  if (summary.made === 1) notes.push(t("narMadePoint"));
  if (summary.made > 1) notes.push(t("narMadePoints", { n: summary.made }));
  if (notes.length) text += ", " + notes.join(" " + t("and") + " ");
  return text;
}

// ----------------------------------------------------------------------
// the player's turn
// ----------------------------------------------------------------------
function statusForTurn() {
  const moves = legalMoves(state);
  const left = state.remaining;
  if (!moves.length) {
    if (state.turnMoves.length) setStatus("dieStuck", { die: left.join(" " + t("and") + " ") });
    else setStatus("noMoves", { dice: state.dice.join(" " + t("and") + " ") });
    return;
  }
  if (moves.length === 1) { setStatus("onlyMove"); return; }
  if (state.turnMoves.length === 0) {
    if (state.dice[0] === state.dice[1]) setStatus("rolledDouble", { a: state.dice[0] });
    else setStatus("rolled", { a: state.dice[0], b: state.dice[1] });
  } else if (left.length === 1) setStatus("oneMoveLeft", { die: left[0] });
  else setStatus("movesLeft", { n: left.length, dice: left.join(" · ") });
}

/** When exactly one move is possible, lift that checker so the glow shows where. */
function liftIfOnly() {
  const moves = legalMoves(state);
  if (moves.length === 1) selected = moves[0].from;
}

function onRoll() {
  if (busy) return;
  if (state.phase === "move" && state.turn === HUMAN && legalMoves(state).length === 0) return pass();
  if (state.phase === "opening") {
    state = rollOpening(state);
    audio.playRoll();
    if (state.phase === "opening") { setStatus("openingTie", { n: state.opening.h }); render(); animateDice(); save(); return; }
    if (state.turn === HUMAN) {
      liftIfOnly();
      render(); animateDice(); save();
      setStatus("openingYou", { h: state.opening.h, c: state.opening.c });
      if (legalMoves(state).length === 1) setStatus("onlyMove");
      if (legalMoves(state).length === 0) statusForTurn();
      return;
    }
    render(); animateDice(); save();
    setStatus("openingComputer", { h: state.opening.h, c: state.opening.c, name: computerName() });
    runComputerTurn({ alreadyRolled: true });
    return;
  }
  if (state.phase !== "roll" || state.turn !== HUMAN) return;
  state = rollDice(state);
  audio.playRoll();
  hintMoves = null;
  liftIfOnly();
  render();
  animateDice();
  save();
  statusForTurn();
}

/** Rock the dice that were just rolled — call after render() has drawn them. */
function animateDice() {
  if (reduceMotion) return;
  for (const d of diceEl.children) { if (d.classList.contains("is-blank")) continue; d.classList.remove("is-rolling"); void d.offsetWidth; d.classList.add("is-rolling"); }
  setTimeout(() => { for (const d of diceEl.children) d.classList.remove("is-rolling"); }, 400);
}

function pass() {
  if (!isHumanMoving() || legalMoves(state).length) return;
  selected = null; hintMoves = null;
  handOver();
}

/** The player has finished (or passed): give the computer the roll. */
function handOver() {
  cancelHandoff();
  state = endTurn(state);
  render();
  save();
  runComputerTurn();
}
function cancelHandoff() { if (handoffTimer) { clearTimeout(handoffTimer); handoffTimer = null; } }

/** Apply the player's chain of moves for a lifted checker to `to`. */
function playChain(moves) {
  state = applyMoves(state, moves);
  selected = null;
  hintMoves = null;
  if (moves.some((m) => m.to === "off")) audio.playOff(); else audio.playPlace();
  if (moves.some((m) => m.hit)) setTimeout(() => audio.playHit(), 120);
  render();
  save();
  if (state.phase === "over") return endGame();
  const summary = summarizeMoves(state.turnMoves, state.turnStart, posOf(state), HUMAN);
  if (legalMoves(state).length === 0) {
    if (state.remaining.length === 0) {
      // the whole roll is played: a beat for Undo, then the computer replies
      setStatus("youMoved", { text: narrate(summary, HUMAN) });
      statusEl.textContent += " " + t("thinkingAfterYou", { name: computerName() });
      handoffTimer = setTimeout(() => { handoffTimer = null; handOver(); }, reduceMotion ? 200 : HANDOFF_MS);
    } else statusForTurn(); // a die is stuck: Pass
    return;
  }
  if (moves.some((m) => m.hit)) { setStatus("youHit", { name: computerName().toLowerCase() }); liftIfOnly(); render(); return; }
  liftIfOnly();
  render();
  statusForTurn();
}

// ----------------------------------------------------------------------
// tap
// ----------------------------------------------------------------------
function regionOf(el) {
  const p = el.closest(".bg-point");
  if (p) return { type: "point", idx: Number(p.dataset.point) };
  const z = el.closest(".bg-bar-zone");
  if (z && z.dataset.zone === HUMAN) return { type: "bar" };
  const tr = el.closest(".bg-tray");
  if (tr && tr.dataset.tray === HUMAN) return { type: "off" };
  return null;
}
function regionLoc(r) { return r.type === "point" ? r.idx : r.type; }

function shakeTop(loc, owner) {
  const el = topCheckerEl(loc, owner);
  if (!el) return;
  el.classList.remove("is-shake"); void el.offsetWidth; el.classList.add("is-shake");
  setTimeout(() => el.classList.remove("is-shake"), 400);
}

function tapRegion(r) {
  if (!r || busy) return;
  if (state.phase === "over") return;
  if (!isHumanMoving()) {
    if (state.phase === "roll" && state.turn === HUMAN) setStatus("yourRoll");
    else if (state.phase === "opening") setStatus("openingStart");
    return;
  }
  const loc = regionLoc(r);
  if (selected !== null) {
    const d = destinationsFrom(state, selected).find((x) => String(x.to) === String(loc));
    if (d) return playChain(d.moves);
    if (loc === selected) {
      // a second tap on a checker with exactly one place to go plays it (DESIGN §5.4)
      const sole = soleDestination(state, selected);
      if (sole) return playChain(sole);
      selected = null; render(); setStatus("putDown"); return;
    }
    if (loc !== "off" && movableFroms(state).includes(loc)) return lift(loc);
    audio.playNope();
    setStatus("notThere");
    return;
  }
  if (loc === "off") { setStatus("putDown"); return; }
  if (movableFroms(state).includes(loc)) return lift(loc);
  const owner = loc === "bar" ? (state.bar.h ? HUMAN : null) : ownerAt(state.points, loc);
  if (owner === COMPUTER) { audio.playNope(); setStatus("notYours"); return; }
  if (owner === HUMAN) {
    audio.playNope();
    shakeTop(loc, HUMAN);
    if (state.bar.h > 0 && loc !== "bar") setStatus("mustEnterFirst");
    else setStatus("cantMoveThat");
  }
}
function lift(loc) {
  selected = loc;
  hintMoves = null;
  render();
  const sole = soleDestination(state, loc);
  if (loc === "bar") setStatus(sole ? "pickedUpBarOne" : "pickedUpBar");
  else setStatus(sole ? "pickedUpOne" : "pickedUp", { from: loc + 1 });
  if (legalMoves(state).length === 1) setStatus("onlyMove");
}

// ----------------------------------------------------------------------
// drag — pointer events, delegated from the field
// ----------------------------------------------------------------------
let drag = null;
const DRAG_THRESHOLD = 8;

field.addEventListener("pointerdown", (e) => {
  if (e.button > 0) return;
  const r = regionOf(e.target);
  if (!r) return;
  const loc = regionLoc(r);
  const liftable = isHumanMoving() && loc !== "off" && movableFroms(state).includes(loc);
  const el = liftable ? topCheckerEl(loc, HUMAN) : null;
  drag = { r, loc, el, x0: e.clientX, y0: e.clientY, moved: false, pointerId: e.pointerId, start: null };
  if (el) {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
    drag.start = m ? [Number(m[1]), Number(m[2])] : [0, 0];
    try { e.target.setPointerCapture(e.pointerId); } catch { /* not all browsers */ }
  }
});
field.addEventListener("pointermove", (e) => {
  if (!drag || !drag.el) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    if (selected !== drag.loc) { selected = drag.loc; hintMoves = null; render(); }
    drag.el.classList.add("is-dragging");
  }
  drag.el.style.transform = `translate(${drag.start[0] + dx}px, ${drag.start[1] + dy}px) scale(1.06)`;
});
function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  try { e.target.releasePointerCapture(d.pointerId); } catch { /* ignore */ }
  if (!d.moved) { tapRegion(d.r); return; }
  d.el.classList.remove("is-dragging");
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const r = under ? regionOf(under) : null;
  const loc = r ? regionLoc(r) : null;
  const dest = loc !== null && isHumanMoving() ? destinationsFrom(state, d.loc).find((x) => String(x.to) === String(loc)) : null;
  if (dest) { playChain(dest.moves); return; }
  render(); // snap back, still lifted
  if (r && loc !== d.loc) { audio.playNope(); setStatus("notThere"); }
}
field.addEventListener("pointerup", endDrag);
field.addEventListener("pointercancel", (e) => { if (drag && drag.moved) { drag.el.classList.remove("is-dragging"); render(); } drag = null; void e; });

// keyboard: Enter/Space on a point, the bar or the tray does what a tap does
field.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const r = regionOf(e.target);
  if (!r) return;
  e.preventDefault();
  tapRegion(r);
});

// ----------------------------------------------------------------------
// the computer's turn — dice first, then one checker at a time
// ----------------------------------------------------------------------
function runComputerTurn({ alreadyRolled = false } = {}) {
  if (state.phase === "over" || state.turn !== COMPUTER) return;
  busy = true;
  selected = null; hintMoves = null;
  const id = gameId;
  const name = computerName();
  const wait = (ms) => new Promise((res) => setTimeout(res, reduceMotion ? Math.min(ms, 120) : ms));
  (async () => {
    render();
    if (!alreadyRolled && state.phase === "roll") {
      setStatus("computerThinking", { name });
      await wait(AI_THINK_MS);
      if (id !== gameId) return;
      state = rollDice(state);
      audio.playRoll();
      render(); animateDice(); save();
      setStatus("computerRolled", { name, a: state.dice[0], b: state.dice[1] });
      await wait(AI_THINK_MS);
    } else if (alreadyRolled) {
      await wait(AI_THINK_MS + 300);
    }
    if (id !== gameId) return;
    if (state.phase !== "move") { busy = false; render(); return; }
    const { moves, rng } = chooseComputerMoves(state);
    state = { ...state, rng };
    const before = clonePos(state.turnStart);
    lastAiTurn = { start: clonePos(state.turnStart), dice: state.dice.slice(), moves: [...state.turnMoves, ...moves] };
    for (const m of moves) {
      if (id !== gameId) return;
      state = applyMove(state, m);
      if (m.to === "off") audio.playOff(); else audio.playPlaceSoft();
      if (m.hit) setTimeout(() => audio.playHit(), 120);
      render(); save();
      if (state.phase === "over") break;
      await wait(AI_STEP_MS);
    }
    if (id !== gameId) return;
    if (state.phase === "over") { busy = false; return endGame(); }
    const summary = summarizeMoves(state.turnMoves, before, posOf(state), COMPUTER);
    state = endTurn(state);
    busy = false;
    render(); save();
    if (summary.empty) setStatus("computerNoMove", { name });
    else setStatus("computerMoved", { name, text: narrate(summary, COMPUTER) });
  })();
}

// ----------------------------------------------------------------------
// hint, undo, pass
// ----------------------------------------------------------------------
hintBtn.addEventListener("click", () => {
  if (busy) return;
  if (!isHumanMoving()) { setStatus("hintNotNow"); return; }
  requestRewardedHint().then((answer) => {
    if (answer !== "granted" || !isHumanMoving()) return;
    const best = bestHumanMoves(state);
    if (!best.length) { setStatus("hintNone"); return; }
    hintMoves = best;
    selected = null;
    render();
    // the position after the hint, through the rules, for "making a point"
    const after = applyMoves(state, best);
    setStatus("hintText", { text: narrate(summarizeMoves(best, posOf(state), posOf(after), HUMAN), HUMAN) });
  });
});

passBtn.addEventListener("click", () => {
  if (!isHumanMoving()) return;
  const moves = legalMoves(state);
  if (moves.length === 0) return pass();
  if (moves.length === 1) { selected = moves[0].from; const d = destinationsFrom(state, selected).find((x) => String(x.to) === String(moves[0].to)); if (d) playChain(d.moves); }
});

undoBtn.addEventListener("click", () => {
  if (busy || state.phase !== "move" || state.turn !== HUMAN) return;
  if (!state.turnMoves.length) { setStatus("nothingToUndo"); return; }
  cancelHandoff();
  state = undoMove(state);
  selected = null; hintMoves = null;
  audio.playUndo();
  render(); save();
  setStatus("undoneStatus");
});

// ----------------------------------------------------------------------
// new game
// ----------------------------------------------------------------------
function gameInProgress() { return state && state.phase !== "over" && (state.moveCount > 0 || state.turnCount > 0); }

newBtn.addEventListener("click", () => {
  if (busy && state.phase !== "over") return;
  if (gameInProgress()) { confirmModal.dataset.open = "true"; confirmYes.focus(); return; }
  deal();
});
confirmYes.addEventListener("click", async () => {
  confirmModal.dataset.open = "false";
  stats.streak = 0;
  await showInterstitial("new_game");
  deal();
});
confirmNo.addEventListener("click", () => { confirmModal.dataset.open = "false"; newBtn.focus(); });

function deal({ seed } = {}) {
  gameId += 1;
  cancelHandoff();
  stats.played += 1;
  store.saveStats(stats);
  state = newGame({ seed, difficulty: settings.pace, first: settings.first });
  selected = null; hintMoves = null; busy = false;
  resultModal.dataset.open = "false";
  save();
  trackEvent("game_start", { pace: settings.pace, first: settings.first });
  render();
  if (state.phase === "opening") setStatus("newGameStarted");
  else if (state.turn === HUMAN) setStatus("youStart");
  else { setStatus("computerStarts", { name: computerName() }); runComputerTurn(); }
  preloadInterstitial();
}

// ----------------------------------------------------------------------
// the end
// ----------------------------------------------------------------------
function endGame() {
  busy = true;
  cancelHandoff();
  const won = state.winner === HUMAN;
  const big = state.result !== "single";
  const name = computerName();
  const id = gameId;
  if (won) {
    stats.won += 1; stats.streak += 1; stats.best = Math.max(stats.best, stats.streak);
    if (big) stats.big += 1;
    trackEvent("game_win", { pace: settings.pace, first: settings.first, result: state.result, moves: state.moveCount });
    audio.playWin();
    setStatus(big ? "youDidItBig" : "youDidIt");
  } else {
    stats.streak = 0;
    audio.playLose();
    setStatus("computerWonStatus");
  }
  store.saveStats(stats);
  store.clearGame();
  render();
  setTimeout(async () => {
    if (id !== gameId) return;
    await showInterstitial("game_over");
    if (id !== gameId) return;
    if (won) {
      resultTitle.textContent = t("winTitle");
      resultNote.textContent = (big ? t("winNoteBig") : t("winNote", { n: state.moveCount })) + (stats.streak > 1 ? " " + t("winsInARow", { n: stats.streak }) : "");
    } else {
      resultTitle.textContent = t("lostTitle");
      resultNote.textContent = t("lostNote", { name });
    }
    resultModal.dataset.open = "true";
    resultAgain.focus();
  }, reduceMotion ? 100 : END_PAUSE_MS);
}
resultAgain.addEventListener("click", () => { resultModal.dataset.open = "false"; deal(); });
resultClose.addEventListener("click", () => { resultModal.dataset.open = "false"; newBtn.focus(); });

// ----------------------------------------------------------------------
// settings
// ----------------------------------------------------------------------
function fillStats() {
  $("bg-stat-wins").textContent = stats.won;
  $("bg-stat-big").textContent = stats.big;
  $("bg-stat-played").textContent = stats.played;
  $("bg-stat-best").textContent = stats.best;
}
function openSettings() {
  fillStats();
  settingsPanel.dataset.open = "true";
  const sheet = settingsPanel.querySelector(".settings-sheet");
  if (sheet) sheet.scrollTop = 0;
  settingsClose.focus({ preventScroll: true });
}
function closeSettings() {
  settingsPanel.dataset.open = "false";
  settingsBtn.focus();
}
settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsPanel.addEventListener("click", (e) => { if (e.target === settingsPanel) closeSettings(); });

const paceRadios = document.querySelectorAll('input[name="bg-pace"]');
const firstRadios = document.querySelectorAll('input[name="bg-first"]');
const colourRadios = document.querySelectorAll('input[name="bg-colours"]');
const pipsToggle = $("bg-toggle-pips");
const soundToggle = $("bg-toggle-sound");
paceRadios.forEach((r) => { r.checked = r.value === settings.pace; });
firstRadios.forEach((r) => { r.checked = r.value === settings.first; });
colourRadios.forEach((r) => { r.checked = r.value === settings.colours; });
pipsToggle.checked = settings.pips;
soundToggle.checked = settings.sound;

paceRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings.pace = r.value;
  store.saveSettings(settings);
  if (state) { state = { ...state, difficulty: settings.pace }; save(); }
}));
firstRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings.first = r.value;
  store.saveSettings(settings);
}));
colourRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings.colours = r.value;
  main.dataset.colours = settings.colours;
  store.saveSettings(settings);
  audio.playPlace();
  if (state) { render(); refreshStatus(); }
}));
pipsToggle.addEventListener("change", () => {
  settings.pips = pipsToggle.checked;
  store.saveSettings(settings);
  if (state) renderPlate();
});
soundToggle.addEventListener("change", () => {
  settings.sound = soundToggle.checked;
  audio.setSoundEnabled(settings.sound);
  store.saveSettings(settings);
  if (settings.sound) audio.playPlace();
  toast(t(settings.sound ? "soundOn" : "soundOff"));
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (resultModal.dataset.open === "true") { resultModal.dataset.open = "false"; return; }
  if (confirmModal.dataset.open === "true") { confirmModal.dataset.open = "false"; return; }
  if (settingsPanel.dataset.open === "true") closeSettings();
  else if (selected !== null && isHumanMoving()) { selected = null; render(); setStatus("putDown"); }
});

// ----------------------------------------------------------------------
// languages
// ----------------------------------------------------------------------
function refreshStatus() { if (lastStatus) setStatus(lastStatus[0], lastStatus[1]); }
i18n.applyStatic();
i18n.renderPicker($("bg-lang-grid"));
i18n.onChange(() => {
  if (layout) measure();
  if (state) { render(); refreshStatus(); }
});

// ----------------------------------------------------------------------
// boot
// ----------------------------------------------------------------------
rollBtn.addEventListener("click", onRoll);
build();
measure();
let lastSize = [board.clientWidth, window.innerHeight];
function relayout() {
  const w = board.clientWidth, h = window.innerHeight;
  if (layout && w === lastSize[0] && h === lastSize[1]) return;
  lastSize = [w, h];
  measure();
  if (state) render({ instant: true });
}
new ResizeObserver(relayout).observe(board);
window.addEventListener("resize", relayout);
window.addEventListener("orientationchange", () => setTimeout(relayout, 60));
requestAnimationFrame(() => requestAnimationFrame(relayout));

function restoreStatus() {
  if (state.phase === "opening") setStatus(state.opening ? "openingTie" : "openingStart", state.opening ? { n: state.opening.h } : undefined);
  else if (state.turn === HUMAN) { if (state.phase === "roll") setStatus("yourRoll"); else { liftIfOnly(); statusForTurn(); } }
}

const saved = store.loadGame();
if (saved && saved.state.phase !== "over") {
  state = saved.state;
  state = { ...state, difficulty: settings.pace };
  render({ instant: true });
  restoreStatus();
  toast(t("restored"));
  if (state.turn === COMPUTER) runComputerTurn({ alreadyRolled: state.phase === "move" });
} else {
  deal();
}

// ----------------------------------------------------------------------
// debug hook for the QA script — only with ?debug=1
// ----------------------------------------------------------------------
if (DEBUG) {
  window.__bg = {
    state: () => state,
    layout: () => layout,
    busy: () => busy,
    legal: () => legalMoves(state),
    movable: () => movableFroms(state),
    dests: (from) => destinationsFrom(state, from),
    selected: () => selected,
    canBearOff: () => canBearOff(posOf(state), HUMAN),
    lastAiTurn: () => lastAiTurn,
    /** The computer's last turn was one of the engine's complete legal sequences (never an illegal or a short play). */
    aiTurnLegal: () => {
      if (!lastAiTurn) return true;
      const seqs = legalSequences(lastAiTurn.start, COMPUTER, lastAiTurn.dice);
      return seqs.some((q) => q.length === lastAiTurn.moves.length && q.every((m, i) => sameMove(m, lastAiTurn.moves[i])));
    },
    roll: (forced) => {
      if (busy) return false;
      if (state.phase === "opening") { onRoll(); return true; }
      if (state.phase !== "roll" || state.turn !== HUMAN) return false;
      if (forced) { state = rollDice(state, forced); audio.playRoll(); hintMoves = null; liftIfOnly(); render(); animateDice(); save(); statusForTurn(); return true; }
      onRoll(); return true;
    },
    move: (from, to) => {
      if (!isHumanMoving()) return false;
      const d = destinationsFrom(state, from).find((x) => String(x.to) === String(to));
      if (!d) return false;
      playChain(d.moves); return true;
    },
    tap: (loc) => tapRegion(loc === "bar" ? { type: "bar" } : loc === "off" ? { type: "off" } : { type: "point", idx: loc }),
    pass, undo: () => undoBtn.click(), hint: () => hintBtn.click(), newGame: () => deal(),
    load: (s) => { gameId += 1; cancelHandoff(); state = s; selected = null; hintMoves = null; busy = false; render({ instant: true }); restoreStatus(); save(); if (state.turn === COMPUTER) runComputerTurn({ alreadyRolled: state.phase === "move" }); },
  };
}
