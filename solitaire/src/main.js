// solitaire/src/main.js
// The page: renders game/klondike.js's state as 52 card elements on a
// felt table, and turns taps, drags and buttons into calls on it.
//
// Nothing about the rules lives here — canMove/applyMove/autoMoveTarget/
// findHint are all the engine's. This file owns: measuring the table and
// placing cards, the tap and drag gestures, undo history, saving, the
// settings sheet, the win, languages, and analytics.
//
// Words: nothing the player reads is written here. Every phrase is a key
// into src/i18n/strings.js (this game) or /i18n/common.js (site-wide),
// looked up through i18n.t() in the language chosen in Settings; static
// markup carries data-i18n and is swapped by i18n.applyStatic().

import {
  newGame, applyMove, drawFromStock, canMove, cardsAt, autoMoveTarget, destinationsFor,
  findHint, describeHint, isWon, isStuck, canAutoComplete, autoCompleteStep,
  makeDeck, RANK_LABEL, RED,
} from "./game/klondike.js";
import * as store from "./core/storage.js";
import * as audio from "./core/audio.js";
import { createI18n } from "/i18n/i18n.js";
import { common } from "/i18n/common.js";
import { strings } from "./i18n/strings.js";

const i18n = createI18n({ common, game: strings });
i18n.applyStatic();

const $ = (id) => document.getElementById(id);
const table = $("sol-table");
const cardLayer = $("sol-cards");
const statusEl = $("sol-status");
const stockSlot = $("sol-slot-stock");
const hintBtn = $("sol-hint-btn");
const undoBtn = $("sol-undo-btn");
const newBtn = $("sol-new-btn");
const settingsBtn = $("sol-settings-btn");
const settingsPanel = $("sol-settings-panel");
const settingsClose = $("sol-settings-close");
const winModal = $("sol-win-modal");
const winNote = $("sol-win-note");
const winAgain = $("sol-win-again");
const winClose = $("sol-win-close");
const confirmModal = $("sol-confirm-modal");
const confirmYes = $("sol-confirm-yes");
const confirmNo = $("sol-confirm-no");
const toasts = $("sol-toasts");

const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ----------------------------------------------------------------------
// words — a card's spoken name, and a status message that can be said
// again in another language
// ----------------------------------------------------------------------
/** "7 of hearts" in the current language (strings.js cardName/rankN/suitX). */
function cardLabel(card) {
  return i18n.t("cardName", { rank: i18n.t("rank" + card.rank), suit: i18n.t("suit" + card.suit) });
}
/** Say a message key. `args.card` / `args.target` are card objects and
 *  become `name` / `target` names — the shape describeHint() returns. */
function say(key, args) {
  if (!args) return i18n.t(key);
  const a = { ...args };
  if (a.card) a.name = cardLabel(a.card);
  if (a.target) a.target = cardLabel(a.target);
  return i18n.t(key, a);
}
/**
 * The key for "what to do next", which is also where the game says the
 * position is dead.
 *
 * Every place that ends a turn asks this rather than naming "start" or
 * "chooseStart" itself, so "No moves left — try a new game." appears the
 * moment the hand goes dead — after a move, after a draw, after an undo —
 * instead of only when the player presses Hint. It is the shared site
 * key `noMoves` from /i18n/common.js, already written in all fourteen
 * languages, so this needed no translation round.
 *
 * A handful of messages deliberately beat it, because they answer
 * something the player just did and this does not: picking a card up,
 * "that can't go there", the deck being spent, and the win. The ones that
 * would otherwise sit ON a dead position — "the deck is used up",
 * "undone" — check isStuck() themselves at their call site.
 */
const idleKey = () => {
  if (state && !isWon(state) && isStuck(state)) return "noMoves";
  return settings.tap === "choose" ? "chooseStart" : "start";
};

// ----------------------------------------------------------------------
// analytics — same shape as every other page: check gtag exists, never throw
// ----------------------------------------------------------------------
function trackEvent(name, params) {
  try {
    if (typeof window.gtag === "function") window.gtag("event", name, { game_name: "solitaire", ...params });
  } catch { /* analytics must never affect the game */ }
}
for (const el of document.querySelectorAll("a[data-crossgame-to]")) {
  el.addEventListener("click", () => {
    trackEvent("cross_game_click", { from: "solitaire", to: el.dataset.crossgameTo, placement: el.dataset.placement });
  });
}

// ----------------------------------------------------------------------
// suit symbols — one SVG sprite, drawn once, so ♥♠♦♣ look the same on
// every device instead of whatever glyph the system font has
// ----------------------------------------------------------------------
const SUIT_PATHS = {
  H: '<path d="M50 90 C22 68 6 52 6 33 A21 21 0 0 1 50 24 A21 21 0 0 1 94 33 C94 52 78 68 50 90 Z"/>',
  D: '<path d="M50 4 Q68 34 92 50 Q68 66 50 96 Q32 66 8 50 Q32 34 50 4 Z"/>',
  S: '<path d="M50 6 C24 36 8 50 8 66 A19 19 0 0 0 45 74 C43 84 39 91 30 96 L70 96 C61 91 57 84 55 74 A19 19 0 0 0 92 66 C92 50 76 36 50 6 Z"/>',
  C: '<circle cx="50" cy="29" r="21"/><circle cx="27" cy="59" r="21"/><circle cx="73" cy="59" r="21"/><path d="M44 58 C46 78 40 90 30 96 L70 96 C60 90 54 78 56 58 Z"/>',
};
(function injectDefs() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "sol-defs");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = Object.entries(SUIT_PATHS)
    .map(([s, p]) => `<symbol id="sol-sym-${s}" viewBox="0 0 100 100">${p}</symbol>`)
    .join("");
  document.body.prepend(svg);
})();
function symbolSvg(suit) {
  return `<svg class="sol-sym" aria-hidden="true"><use href="#sol-sym-${suit}"/></svg>`;
}

// ----------------------------------------------------------------------
// state
// ----------------------------------------------------------------------
let settings = store.loadSettings();
let stats = store.loadStats();
let state = null;
let history = [];
let selected = null;      // choose-mode: the location picked up
let busy = false;         // auto-complete / win animation running
let cascade = null;       // rAF handle for the win animation
const cardEls = new Map(); // card id -> element
const cardLoc = new Map(); // card id -> { pile, index, card }
let layout = null;

audio.setSoundEnabled(settings.sound);
const main = $("solitaire");
main.dataset.back = settings.back;
// The swatches in Settings carry the same emblem as the real backs.
for (const sw of document.querySelectorAll(".sol-back-swatch .sol-card-back-emblem")) sw.innerHTML = symbolSvg("S");

// ----------------------------------------------------------------------
// card elements — built once, moved forever after
// ----------------------------------------------------------------------
function buildCards() {
  for (const c of makeDeck()) {
    const el = document.createElement("div");
    el.className = "sol-card is-face-down" + (RED[c.suit] ? " is-red" : "");
    el.dataset.id = c.id;
    const rank = RANK_LABEL[c.rank];
    const court = c.rank > 10;
    const centre = court
      ? `<span class="sol-card-court" aria-hidden="true">${rank}</span>`
      : `<span class="sol-card-pip" aria-hidden="true">${symbolSvg(c.suit)}</span>`;
    const index = `<span class="sol-card-rank${c.rank === 10 ? " is-ten" : ""}">${rank}</span>${symbolSvg(c.suit)}`;
    el.innerHTML =
      `<div class="sol-card-inner">` +
        `<div class="sol-card-face">` +
          `<span class="sol-card-index" aria-hidden="true">${index}</span>` +
          centre +
          `<span class="sol-card-index sol-card-index-bottom" aria-hidden="true">${index}</span>` +
        `</div>` +
        `<div class="sol-card-back"><span class="sol-card-back-emblem">${symbolSvg("S")}</span></div>` +
      `</div>`;
    cardLayer.appendChild(el);
    cardEls.set(c.id, el);
  }
  labelCards();
}
/** Every card's aria-label in the current language. */
function labelCards() {
  for (const c of makeDeck()) cardEls.get(c.id).setAttribute("aria-label", cardLabel(c));
}

// ----------------------------------------------------------------------
// layout — everything derives from the table's width
// ----------------------------------------------------------------------
function measure() {
  const W = table.clientWidth || 360;
  const wide = W >= 600;
  const gap = wide ? 12 : Math.max(5, Math.round(W * 0.016));
  let pad = wide ? 14 : 8;
  let cardW = Math.floor((W - 2 * pad - 6 * gap) / 7);
  // A phone held sideways is wide but short: size the cards from the
  // height instead so the whole table still fits on one screen.
  const vh = window.innerHeight || 800;
  const short = wide && vh < 600;
  const cap = short ? Math.max(44, Math.floor((vh - 120) / 6.2)) : 88;
  let padX = pad;
  if (cardW > cap) { cardW = cap; padX = Math.floor((W - 7 * cardW - 6 * gap) / 2); }
  const cardH = Math.round(cardW * 1.42);
  const fanUp = Math.round(cardW * 0.48);
  const fanDown = Math.max(6, Math.round(cardH * 0.12));
  const rowGap = Math.round(cardH * 0.26);
  const colX = [];
  for (let i = 0; i < 7; i++) colX.push(padX + i * (cardW + gap));
  const y0 = pad;
  const y1 = pad + cardH + rowGap;
  // How tall a column may fan before its offsets squeeze. Tighter on a
  // desktop, where a 125px card would otherwise push the controls under
  // the fold of a 768px window.
  const budget = Math.round(cardH * (short ? 3.2 : wide ? 3.7 : 4.0));
  layout = { W, wide, gap, pad, cardW, cardH, fanUp, fanDown, colX, y0, y1, budget, wasteFan: Math.round(cardW * 0.42) };
  table.style.setProperty("--card-w", cardW + "px");
  table.style.setProperty("--card-h", cardH + "px");
  table.style.setProperty("--gap", gap + "px");
  table.style.setProperty("--pad", pad + "px");
  table.classList.toggle("is-wide", cardW >= 72);
  const slotPos = (el, x, y) => { el.style.left = x + "px"; el.style.top = y + "px"; };
  slotPos(stockSlot, colX[0], y0);
  slotPos($("sol-slot-waste"), colX[1], y0);
  for (let i = 0; i < 4; i++) slotPos($("sol-slot-foundation-" + i), colX[3 + i], y0);
  for (let i = 0; i < 7; i++) slotPos($("sol-slot-tableau-" + i), colX[i], y1);
}

/** Vertical offsets for a tableau column, squeezed to fit the budget. */
function columnOffsets(pile) {
  const { cardH, fanUp, fanDown, budget } = layout;
  const nDown = pile.filter((c) => !c.faceUp).length;
  const nUp = pile.length - nDown;
  let fu = fanUp, fd = fanDown;
  const need = () => cardH + nDown * fd + Math.max(0, nUp - 1) * fu;
  if (need() > budget && nUp > 1) fu = Math.max(Math.round(layout.cardW * 0.36), Math.floor((budget - cardH - nDown * fd) / (nUp - 1)));
  if (need() > budget && nDown > 0) fd = Math.max(4, Math.floor((budget - cardH - (nUp - 1) * fu) / nDown));
  const offsets = [];
  let y = 0;
  for (const c of pile) { offsets.push(y); y += c.faceUp ? fu : fd; }
  return { offsets, height: need() };
}

function positionOf(loc, k) {
  const { colX, y0, y1, wasteFan } = layout;
  if (loc.pile === "stock") return [colX[0], y0];
  if (loc.pile === "waste") {
    const n = state.waste.length;
    // Draw 3 fans the last three; everything under them sits flat.
    const visible = state.draw === 3 ? Math.min(3, n) : 1;
    const i = k - (n - visible);
    return [colX[1] + Math.max(0, i) * wasteFan, y0];
  }
  if (loc.pile === "foundation") return [colX[3 + loc.index], y0];
  return [colX[loc.index], y1 + (loc.offset || 0)];
}

// ----------------------------------------------------------------------
// render — place every card from the state; CSS animates the difference
// ----------------------------------------------------------------------
function place(el, x, y, z) {
  el.style.transform = `translate(${x}px, ${y}px)`;
  el.style.zIndex = z;
}
function render() {
  if (!layout) measure();
  cardLoc.clear();
  let maxCol = 0;
  const nStock = state.stock.length;
  state.stock.forEach((c, k) => {
    const el = cardEls.get(c.id);
    const [x, y] = positionOf({ pile: "stock" });
    // A deck looks like a deck: the cards under the top one peek out a
    // pixel each at the bottom-right.
    const peek = Math.min(nStock - 1 - k, 3);
    place(el, x + peek, y + peek, 10 + k);
    setFace(el, false);
    el.classList.add("is-stock");
    el.tabIndex = -1;
    cardLoc.set(c.id, { pile: "stock" });
  });
  state.waste.forEach((c, k) => {
    const el = cardEls.get(c.id);
    const [x, y] = positionOf({ pile: "waste" }, k);
    place(el, x, y, 100 + k);
    setFace(el, true);
    el.classList.remove("is-stock");
    const top = k === state.waste.length - 1;
    el.tabIndex = top ? 0 : -1;
    cardLoc.set(c.id, top ? { pile: "waste" } : { pile: "waste", buried: true });
  });
  state.foundations.forEach((pile, i) => pile.forEach((c, k) => {
    const el = cardEls.get(c.id);
    const [x, y] = positionOf({ pile: "foundation", index: i });
    place(el, x, y, 200 + k);
    setFace(el, true);
    el.classList.remove("is-stock");
    el.tabIndex = -1;
    cardLoc.set(c.id, { pile: "foundation", index: i, top: k === pile.length - 1 });
  }));
  state.tableau.forEach((pile, i) => {
    const { offsets, height } = columnOffsets(pile);
    maxCol = Math.max(maxCol, height);
    pile.forEach((c, k) => {
      const el = cardEls.get(c.id);
      const [x, y] = positionOf({ pile: "tableau", index: i, offset: offsets[k] });
      place(el, x, y, 300 + i * 30 + k);
      setFace(el, c.faceUp);
      el.classList.remove("is-stock");
      el.tabIndex = c.faceUp ? 0 : -1;
      cardLoc.set(c.id, { pile: "tableau", index: i, card: k, faceUp: c.faceUp });
    });
  });
  const height = layout.y1 + Math.max(layout.budget, maxCol) + layout.pad;
  table.style.height = height + "px";

  stockSlot.classList.toggle("is-empty", state.stock.length === 0 && state.waste.length > 0);
  stockSlot.classList.toggle("is-done", state.stock.length === 0 && state.waste.length === 0);
  labelStock();
  undoBtn.disabled = history.length === 0 || busy;
  hintBtn.disabled = busy;
  clearHighlights();
}
function setFace(el, up) {
  el.classList.toggle("is-face-down", !up);
}
function clearHighlights() {
  for (const el of table.querySelectorAll(".is-target, .is-hint, .is-selected")) {
    el.classList.remove("is-target", "is-hint", "is-selected");
  }
}

function labelStock() {
  if (!state) return;
  stockSlot.setAttribute("aria-label", i18n.t(state.stock.length ? "deckTurn" : state.waste.length ? "deckEmptyAgain" : "deckEmpty"));
}

// The last message is kept as { key, args } so a language change can say
// it again rather than leave the old language on screen.
let lastStatus = null;
function setStatus(key, args) {
  lastStatus = { key, args };
  statusEl.textContent = say(key, args);
}
function refreshStatus() { if (lastStatus) setStatus(lastStatus.key, lastStatus.args); }
function toast(text) {
  const el = document.createElement("div");
  el.className = "achievement-toast is-visible";
  el.textContent = text;
  toasts.appendChild(el);
  setTimeout(() => { el.classList.remove("is-visible"); setTimeout(() => el.remove(), 300); }, 2600);
}

// ----------------------------------------------------------------------
// committing a move
// ----------------------------------------------------------------------
function commit(next, { pushHistory = true } = {}) {
  if (pushHistory) {
    history.push(state);
    if (history.length > 500) history.shift();
  }
  state = next;
  selected = null;
  render();
  store.saveGame(state, history);
}

function afterMove(next, to) {
  if (to && to.pile === "foundation") audio.playFoundation(); else audio.playPlace();
  if (next.lastFlip) setTimeout(() => audio.playFlip(), 180);
  if (isWon(state)) return onWin();
  if (canAutoComplete(state)) return startAutoComplete();
}

function moveCards(from, to) {
  const next = applyMove(state, from, to);
  if (!next) return false;
  commit(next);
  afterMove(next, to);
  return true;
}

function draw() {
  if (busy) return;
  const next = drawFromStock(state);
  if (!next) { setStatus(isStuck(state) ? "noMoves" : "deckDone"); return; }
  commit(next);
  audio.playDraw();
  // "Turn the deck over again" is only worth saying if going round again
  // could do something; idleKey() says so when it cannot.
  if (state.stock.length === 0 && state.waste.length && !isStuck(state)) setStatus("deckAgain");
  else setStatus(idleKey());
}

function undo() {
  if (busy || !history.length) return;
  state = history.pop();
  selected = null;
  render();
  store.saveGame(state, history);
  audio.playUndo();
  // Undo is how a player gets OUT of a dead position, so this is where the
  // message has to clear. Undoing a draw does not change whether the hand
  // is dead (isStuck looks at the whole deck, not just the waste card), so
  // that case keeps saying it.
  setStatus(isStuck(state) ? "noMoves" : "undone");
}

// ----------------------------------------------------------------------
// tap
// ----------------------------------------------------------------------
function shake(el) {
  el.classList.remove("is-shake");
  void el.offsetWidth;
  el.classList.add("is-shake");
  setTimeout(() => el.classList.remove("is-shake"), 400);
}

function locOfCard(id) {
  const l = cardLoc.get(id);
  if (!l) return null;
  if (l.pile === "tableau") return l.faceUp ? { pile: "tableau", index: l.index, card: l.card } : null;
  if (l.pile === "waste") return l.buried ? null : { pile: "waste" };
  if (l.pile === "foundation") return l.top ? { pile: "foundation", index: l.index } : null;
  return { pile: "stock" };
}

function tapCard(el) {
  if (busy) return;
  const id = el.dataset.id;
  const raw = cardLoc.get(id);
  if (!raw) return;
  if (raw.pile === "stock") return draw();
  const loc = locOfCard(id);
  if (!loc) {
    // A buried waste card or a face-down tableau card: nothing to do, and
    // in choose mode a tap on a covered card means "put it here" if the
    // column's top card takes it.
    if (selected && raw.pile === "tableau") return tryPlaceSelected({ pile: "tableau", index: raw.index });
    return;
  }
  if (loc.pile === "foundation") {
    if (selected) return tryPlaceSelected({ pile: "foundation", index: loc.index });
    setStatus("foundationBack");
    return;
  }
  if (settings.tap === "choose") return tapChoose(loc, el);

  const to = autoMoveTarget(state, loc);
  if (!to) {
    shake(el);
    audio.playNope();
    setStatus("nowhere", { card: cardsAt(state, loc)[0] });
    return;
  }
  moveCards(loc, to);
  if (!isWon(state) && !busy) setStatus(idleKey());
}

function tapChoose(loc, el) {
  if (selected) {
    const same = selected.pile === loc.pile && selected.index === loc.index && selected.card === loc.card;
    if (same) { selected = null; clearHighlights(); setStatus(idleKey()); return; }
    if (tryPlaceSelected({ pile: loc.pile, index: loc.index })) return;
  }
  selectRun(loc);
}
function selectRun(loc) {
  selected = loc;
  clearHighlights();
  for (const c of cardsAt(state, loc)) cardEls.get(c.id).classList.add("is-selected");
  for (const d of destinationsFor(state, loc)) highlightPile(d);
  setStatus("pickedUp", { card: cardsAt(state, loc)[0] });
}
function highlightPile(d) {
  const pile = d.pile === "foundation" ? state.foundations[d.index] : state.tableau[d.index];
  if (pile.length) cardEls.get(pile[pile.length - 1].id).classList.add("is-target");
  else $(`sol-slot-${d.pile}-${d.index}`).classList.add("is-target");
}
function tryPlaceSelected(to) {
  if (!selected) return false;
  const from = selected;
  if (canMove(state, from, to)) {
    moveCards(from, to);
    if (!isWon(state) && !busy) setStatus(idleKey());
    return true;
  }
  sayCannotGo(from, to);
  return false;
}

/** "The 7 of hearts can't go on that pile / column." */
function sayCannotGo(from, to) {
  setStatus(to.pile === "foundation" ? "cannotGoPile" : "cannotGoColumn", { card: cardsAt(state, from)[0] });
  audio.playNope();
}

function tapSlot(slot) {
  if (busy) return;
  if (slot === stockSlot) return draw();
  if (!selected) return;
  if (slot.dataset.tableau !== undefined) tryPlaceSelected({ pile: "tableau", index: Number(slot.dataset.tableau) });
  if (slot.dataset.foundation !== undefined) tryPlaceSelected({ pile: "foundation", index: Number(slot.dataset.foundation) });
}

// ----------------------------------------------------------------------
// drag — pointer events, delegated from the table
// ----------------------------------------------------------------------
let drag = null;
const DRAG_THRESHOLD = 8;

table.addEventListener("pointerdown", (e) => {
  if (busy || e.button > 0) return;
  const cardEl = e.target.closest(".sol-card");
  const slot = e.target.closest(".sol-slot");
  if (!cardEl && !slot) return;
  const loc = cardEl ? locOfCard(cardEl.dataset.id) : null;
  const liftable = loc && loc.pile !== "stock";
  drag = {
    el: cardEl, slot, loc, liftable,
    x0: e.clientX, y0: e.clientY, moved: false, pointerId: e.pointerId,
    run: liftable ? cardsAt(state, loc).map((c) => cardEls.get(c.id)) : [],
    starts: [],
  };
  if (liftable) {
    drag.starts = drag.run.map((el) => {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
      return m ? [Number(m[1]), Number(m[2])] : [0, 0];
    });
    try { cardEl.setPointerCapture(e.pointerId); } catch { /* not all browsers */ }
  }
  if (cardEl) e.preventDefault();
});

table.addEventListener("pointermove", (e) => {
  if (!drag || !drag.liftable) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    clearHighlights();
    selected = null;
    drag.run.forEach((el) => el.classList.add("is-dragging"));
  }
  drag.run.forEach((el, i) => {
    el.style.transform = `translate(${drag.starts[i][0] + dx}px, ${drag.starts[i][1] + dy}px)`;
  });
  updateDropTarget();
});

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.el) { try { d.el.releasePointerCapture(d.pointerId); } catch { /* ignore */ } }
  if (!d.moved) {
    if (d.el) tapCard(d.el);
    else if (d.slot) tapSlot(d.slot);
    return;
  }
  d.run.forEach((el) => el.classList.remove("is-dragging"));
  const to = dropTargetFor(d);
  clearHighlights();
  if (to && canMove(state, d.loc, to)) {
    moveCards(d.loc, to);
    if (!isWon(state) && !busy) setStatus(idleKey());
  } else {
    render(); // snap back
    if (to) sayCannotGo(d.loc, to);
  }
}
table.addEventListener("pointerup", endDrag);
table.addEventListener("pointercancel", endDrag);

/** The pile under the dragged card: greatest overlap with its head card. */
function dropTargetFor(d) {
  const head = d.run[0].getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  let best = null, bestArea = 0;
  const consider = (to, rect) => {
    const w = Math.min(head.right, rect.right) - Math.max(head.left, rect.left);
    const h = Math.min(head.bottom, rect.bottom) - Math.max(head.top, rect.top);
    if (w <= 0 || h <= 0) return;
    const area = w * h;
    if (area > bestArea) { bestArea = area; best = to; }
  };
  for (let i = 0; i < 4; i++) {
    if (d.loc.pile === "foundation" && d.loc.index === i) continue;
    const [x, y] = positionOf({ pile: "foundation", index: i });
    consider({ pile: "foundation", index: i }, { left: tableRect.left + x, top: tableRect.top + y, right: tableRect.left + x + layout.cardW, bottom: tableRect.top + y + layout.cardH });
  }
  for (let i = 0; i < 7; i++) {
    if (d.loc.pile === "tableau" && d.loc.index === i) continue;
    const { height } = columnOffsets(state.tableau[i]);
    const [x, y] = positionOf({ pile: "tableau", index: i });
    consider({ pile: "tableau", index: i }, { left: tableRect.left + x, top: tableRect.top + y, right: tableRect.left + x + layout.cardW, bottom: tableRect.top + y + Math.max(height, layout.cardH) });
  }
  return bestArea > layout.cardW * layout.cardH * 0.2 ? best : null;
}
function updateDropTarget() {
  for (const el of table.querySelectorAll(".is-target")) el.classList.remove("is-target");
  const to = dropTargetFor(drag);
  if (to && canMove(state, drag.loc, to)) highlightPile(to);
}

// keyboard: Enter/Space on a card or the deck does what a tap does
table.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const cardEl = e.target.closest(".sol-card");
  if (cardEl) { e.preventDefault(); tapCard(cardEl); }
  else if (e.target === stockSlot) { e.preventDefault(); draw(); }
});

// ----------------------------------------------------------------------
// hint
// ----------------------------------------------------------------------
hintBtn.addEventListener("click", () => {
  if (busy) return;
  const h = findHint(state);
  clearHighlights();
  selected = null;
  const d = describeHint(state, h);
  setStatus(d.key, d.args);
  if (!h) return;
  if (h.draw) { stockSlot.classList.add("is-target"); if (state.stock.length) cardEls.get(state.stock[state.stock.length - 1].id).classList.add("is-hint"); return; }
  for (const c of cardsAt(state, h.from)) cardEls.get(c.id).classList.add("is-hint");
  highlightPile(h.to);
});

undoBtn.addEventListener("click", undo);

// ----------------------------------------------------------------------
// new game
// ----------------------------------------------------------------------
function gameInProgress() { return state && state.moves > 0 && !isWon(state); }

newBtn.addEventListener("click", () => {
  if (busy && !isWon(state)) return;
  if (gameInProgress()) { confirmModal.dataset.open = "true"; confirmYes.focus(); return; }
  deal();
});
confirmYes.addEventListener("click", () => { confirmModal.dataset.open = "false"; deal({ abandoned: true }); });
confirmNo.addEventListener("click", () => { confirmModal.dataset.open = "false"; newBtn.focus(); });

function deal({ abandoned = false, seed } = {}) {
  stopCascade();
  if (abandoned) { stats.streak = 0; }
  stats.played += 1;
  store.saveStats(stats);
  state = newGame({ draw: settings.draw, seed });
  history = [];
  selected = null;
  busy = false;
  winModal.dataset.open = "false";
  store.saveGame(state, history);
  trackEvent("game_start", { draw: state.draw });
  animateDeal();
  setStatus(idleKey());
}

/** Every card starts on the deck and flies to its place, one after another. */
function animateDeal() {
  if (!layout) measure();
  if (reduceMotion) { render(); return; }
  const [sx, sy] = positionOf({ pile: "stock" });
  for (const el of cardEls.values()) {
    el.classList.add("no-transition");
    el.style.transitionDelay = "0ms";
    place(el, sx, sy, 5);
    setFace(el, false);
  }
  void table.offsetWidth; // flush so the jump above is not animated
  let n = 0;
  for (const pile of state.tableau) for (const c of pile) cardEls.get(c.id).style.transitionDelay = `${n++ * 28}ms`;
  for (const el of cardEls.values()) el.classList.remove("no-transition");
  render();
  setTimeout(() => { for (const el of cardEls.values()) el.style.transitionDelay = ""; }, n * 28 + 400);
}

// ----------------------------------------------------------------------
// auto-complete and the win
// ----------------------------------------------------------------------
function startAutoComplete() {
  busy = true;
  render();
  setStatus("finishing");
  const tick = () => {
    const step = autoCompleteStep(state);
    if (!step) { busy = false; render(); if (isWon(state)) onWin(); return; }
    state = applyMove(state, step.from, step.to);
    render();
    audio.playFoundation();
    setTimeout(tick, reduceMotion ? 0 : 130);
  };
  setTimeout(tick, 350);
}

function onWin() {
  busy = true;
  stats.won += 1;
  stats.streak += 1;
  stats.best = Math.max(stats.best, stats.streak);
  store.saveStats(stats);
  store.clearGame();
  trackEvent("game_win", { draw: state.draw, moves: state.moves });
  audio.playWin();
  setStatus("won", { moves: state.moves });
  undoBtn.disabled = true;
  hintBtn.disabled = true;
  fillWinNote();
  if (!reduceMotion) startCascade();
  setTimeout(() => { winModal.dataset.open = "true"; winAgain.focus(); }, reduceMotion ? 200 : 1400);
}

/** "All four piles are complete in 88 moves. That's 3 wins in a row." —
 *  written from the state so a language change can write it again. */
function fillWinNote() {
  if (!state || !isWon(state)) return;
  winNote.textContent = i18n.t("won", { moves: state.moves }) + (stats.streak > 1 ? " " + i18n.t("winsInARow", { n: stats.streak }) : "");
}

/** The classic bouncing cascade: each card leaps off its pile and bounces
 *  along the bottom of the table until it leaves the side. */
function startCascade() {
  const bodies = [];
  const floor = table.clientHeight - layout.cardH;
  const order = [];
  for (let k = 12; k >= 0; k--) for (let i = 0; i < 4; i++) order.push(state.foundations[i][k]);
  order.forEach((c, n) => {
    const el = cardEls.get(c.id);
    const [x, y] = positionOf({ pile: "foundation", index: 3 - (n % 4) });
    bodies.push({ el, x, y, vx: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 3), vy: -(2 + Math.random() * 4), start: n * 90, z: 2000 + n });
  });
  table.classList.add("is-cascading");
  let t0 = null;
  const step = (ts) => {
    if (t0 === null) t0 = ts;
    const elapsed = ts - t0;
    let live = false;
    for (const b of bodies) {
      if (elapsed < b.start || b.done) { if (!b.done) live = true; continue; }
      if (!b.started) { b.started = true; b.el.classList.add("no-transition"); b.el.style.zIndex = b.z; }
      b.vy += 0.45;
      b.x += b.vx;
      b.y += b.vy;
      if (b.y > floor) { b.y = floor; b.vy = -b.vy * 0.72; }
      b.el.style.transform = `translate(${b.x}px, ${b.y}px)`;
      if (b.x < -layout.cardW - 10 || b.x > layout.W + 10) b.done = true; else live = true;
    }
    if (live) cascade = requestAnimationFrame(step); else cascade = null;
  };
  cascade = requestAnimationFrame(step);
}
function stopCascade() {
  if (cascade) cancelAnimationFrame(cascade);
  cascade = null;
  table.classList.remove("is-cascading");
  for (const el of cardEls.values()) el.classList.remove("no-transition");
}

winAgain.addEventListener("click", () => { winModal.dataset.open = "false"; deal(); });
winClose.addEventListener("click", () => { winModal.dataset.open = "false"; newBtn.focus(); });

// ----------------------------------------------------------------------
// settings
// ----------------------------------------------------------------------
function fillStats() {
  $("sol-stat-wins").textContent = stats.won;
  $("sol-stat-played").textContent = stats.played;
  $("sol-stat-best").textContent = stats.best;
}
function openSettings() {
  fillStats();
  i18n.renderPicker($("sol-lang-grid"));
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

const drawRadios = document.querySelectorAll('input[name="sol-draw"]');
const tapRadios = document.querySelectorAll('input[name="sol-tap"]');
const soundToggle = $("sol-toggle-sound");
const backRadios = document.querySelectorAll('input[name="sol-back"]');
backRadios.forEach((r) => { r.checked = r.value === settings.back; });
backRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings.back = r.value;
  main.dataset.back = settings.back;
  store.saveSettings(settings);
  audio.playPlace();
}));
drawRadios.forEach((r) => { r.checked = Number(r.value) === settings.draw; });
tapRadios.forEach((r) => { r.checked = r.value === settings.tap; });
soundToggle.checked = settings.sound;

drawRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings.draw = Number(r.value);
  store.saveSettings(settings);
  // Nothing played yet: re-deal from the same seed under the new rule, so
  // the change is visible at once instead of "on your next game". That
  // brings the same cards back whenever they can still be won by the new
  // rule, and the next hand that can when they cannot — Draw 3 is a much
  // harder game than Draw 1, and handing the player a board that is lost
  // before the first tap would undo the point of dealing only winnable
  // games (see newGame in game/klondike.js).
  if (state && state.moves === 0 && !busy) {
    stats.played -= 1; // the re-deal is the same game, not a new one
    deal({ seed: state.seed });
  }
}));
tapRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings.tap = r.value;
  store.saveSettings(settings);
  selected = null;
  clearHighlights();
  setStatus(idleKey());
}));
soundToggle.addEventListener("change", () => {
  settings.sound = soundToggle.checked;
  audio.setSoundEnabled(settings.sound);
  store.saveSettings(settings);
  if (settings.sound) audio.playPlace();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (winModal.dataset.open === "true") { winModal.dataset.open = "false"; return; }
  if (confirmModal.dataset.open === "true") { confirmModal.dataset.open = "false"; return; }
  if (settingsPanel.dataset.open === "true") closeSettings();
  else if (selected) { selected = null; clearHighlights(); setStatus(idleKey()); }
});

// A new language: applyStatic() has already swapped the data-i18n text;
// this re-says everything the page wrote itself.
i18n.onChange(() => {
  labelCards();
  labelStock();
  refreshStatus();
  fillStats();
  fillWinNote();
});

// ----------------------------------------------------------------------
// boot
// ----------------------------------------------------------------------
buildCards();
measure();
new ResizeObserver(() => {
  const w = table.clientWidth;
  if (layout && w === layout.W) return;
  measure();
  if (state) {
    for (const el of cardEls.values()) el.classList.add("no-transition");
    render();
    void table.offsetWidth;
    for (const el of cardEls.values()) el.classList.remove("no-transition");
  }
}).observe(table);

const saved = store.loadGame();
if (saved && !isWon(saved.state)) {
  state = saved.state;
  history = saved.history;
  for (const el of cardEls.values()) el.classList.add("no-transition");
  render();
  void table.offsetWidth;
  for (const el of cardEls.values()) el.classList.remove("no-transition");
  setStatus(idleKey());
  toast(i18n.t("restored"));
  if (canAutoComplete(state)) startAutoComplete();
} else {
  deal();
}
