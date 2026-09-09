// freecell/src/main.js
// The page: renders game/freecell.js's state as 52 card elements on a
// felt table, and turns taps, drags and buttons into calls on it.
//
// Nothing about the rules lives here — canMove/applyMove/autoMoveTarget/
// findHint/safeAutoplayStep are all the engine's. This file owns:
// measuring the table and placing cards, the tap and drag gestures, undo
// history, saving, the settings sheet, the safe autoplay and the finish,
// the win, languages, and analytics. Every word on screen comes from
// i18n.t() — there is no English in this file.

import {
  newGame, applyMove, canMove, moveProblem, cardsAt, autoMoveTarget, maxMovable,
  findHint, describeHint, isWon, canAutoComplete, autoCompleteStep, safeAutoplayStep,
  makeDeck, formatDeal, isValidDealNumber, RANK_LABEL, RED, UNSOLVABLE,
} from "./game/freecell.js";
import * as store from "./core/storage.js";
import * as audio from "./core/audio.js";
import * as ads from "./core/ads.js";
import { createI18n } from "/i18n/i18n.js";
import { common } from "/i18n/common.js";
import { strings } from "./i18n/strings.js";

const i18n = createI18n({ common, game: strings });
const t = (key, arg) => i18n.t(key, arg);

const $ = (id) => document.getElementById(id);
const main = $("freecell");
const table = $("fc-table");
const cardLayer = $("fc-cards");
const statusEl = $("fc-status");
const plate = $("fc-plate");
const plateDeal = $("fc-plate-deal");
const plateMove = $("fc-plate-move");
const hintBtn = $("fc-hint-btn");
const undoBtn = $("fc-undo-btn");
const newBtn = $("fc-new-btn");
const settingsBtn = $("fc-settings-btn");
const settingsPanel = $("fc-settings-panel");
const settingsClose = $("fc-settings-close");
const winModal = $("fc-win-modal");
const winNote = $("fc-win-note");
const winAgain = $("fc-win-again");
const winChoose = $("fc-win-choose");
const confirmModal = $("fc-confirm-modal");
const confirmNote = $("fc-confirm-note");
const confirmYes = $("fc-confirm-yes");
const confirmNo = $("fc-confirm-no");
const dealCurrent = $("fc-deal-current");
const dealInput = $("fc-deal-input");
const dealGo = $("fc-deal-go");
const dealReplay = $("fc-deal-replay");
const dealNote = $("fc-deal-note");
const toasts = $("fc-toasts");

const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ----------------------------------------------------------------------
// words — card names and the deal label, composed from keys
// ----------------------------------------------------------------------
const SUIT_KEY = { S: "suitSpades", H: "suitHearts", D: "suitDiamonds", C: "suitClubs" };
function cardName(card) {
  return t("cardName", { rank: t("rank" + RANK_LABEL[card.rank]), suit: t(SUIT_KEY[card.suit]) });
}
function dealLabel(n) { return t("dealLabel", { deal: formatDeal(n) }); }
/** A hint descriptor from the engine, in words. */
function hintText(d) {
  if (d.key === "hintNone") return t("hintNone");
  const name = cardName(d.card);
  const n = t("cardsOnIt", { n: d.count - 1 });
  if (d.key === "hintHome") return t("hintHome", { name });
  if (d.key === "hintCell") return t("hintCell", { name });
  if (d.key === "hintEmpty") return d.count > 1 ? t("hintEmptyRun", { name, n }) : t("hintEmpty", { name });
  const dest = cardName(d.dest);
  return d.count > 1 ? t("hintOntoRun", { name, n, dest }) : t("hintOnto", { name, dest });
}

// ----------------------------------------------------------------------
// analytics — same shape as every other page: check gtag exists, never throw
// ----------------------------------------------------------------------
function trackEvent(name, params) {
  try {
    if (typeof window.gtag === "function") window.gtag("event", name, { game_name: "freecell", ...params });
  } catch { /* analytics must never affect the game */ }
}
for (const el of document.querySelectorAll("a[data-crossgame-to]")) {
  el.addEventListener("click", () => {
    trackEvent("cross_game_click", { from: "freecell", to: el.dataset.crossgameTo, placement: el.dataset.placement });
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
  svg.setAttribute("class", "fc-defs");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = Object.entries(SUIT_PATHS)
    .map(([s, p]) => `<symbol id="fc-sym-${s}" viewBox="0 0 100 100">${p}</symbol>`)
    .join("");
  document.body.prepend(svg);
})();
function symbolSvg(suit) {
  return `<svg class="fc-sym" aria-hidden="true"><use href="#fc-sym-${suit}"/></svg>`;
}

// ----------------------------------------------------------------------
// state
// ----------------------------------------------------------------------
let settings = store.loadSettings();
let stats = store.loadStats();
let state = null;
let history = [];
let selected = null;      // choose-mode: the location picked up
let busy = false;         // autoplay / finish / win animation running
let cascade = null;       // rAF handle for the win animation
let pendingDeal = null;   // deal number waiting behind the confirm modal
let lastStatus = null;    // [key, args] of the status line, re-spoken on language change
const cardEls = new Map(); // card id -> element
const cardLoc = new Map(); // card id -> location + whether it can be lifted
let layout = null;

audio.setSoundEnabled(settings.sound);
main.dataset.back = settings.back;
// The swatches in Settings carry the same emblem as the real backs.
for (const sw of document.querySelectorAll(".fc-back-swatch .fc-card-back-emblem")) sw.innerHTML = symbolSvg("S");
ads.preloadInterstitial();
i18n.applyStatic();
i18n.renderPicker($("fc-lang-grid"));

// ----------------------------------------------------------------------
// card elements — built once, moved forever after
// ----------------------------------------------------------------------
function buildCards() {
  for (const c of makeDeck()) {
    const el = document.createElement("div");
    el.className = "fc-card is-face-down" + (RED[c.suit] ? " is-red" : "");
    el.dataset.id = c.id;
    const rank = RANK_LABEL[c.rank];
    const court = c.rank > 10;
    const centre = court
      ? `<span class="fc-card-court" aria-hidden="true">${rank}</span>`
      : `<span class="fc-card-pip" aria-hidden="true">${symbolSvg(c.suit)}</span>`;
    const index = `<span class="fc-card-rank${c.rank === 10 ? " is-ten" : ""}">${rank}</span>${symbolSvg(c.suit)}`;
    el.innerHTML =
      `<div class="fc-card-inner">` +
        `<div class="fc-card-face">` +
          `<span class="fc-card-index" aria-hidden="true">${index}</span>` +
          centre +
          `<span class="fc-card-index fc-card-index-bottom" aria-hidden="true">${index}</span>` +
        `</div>` +
        `<div class="fc-card-back"><span class="fc-card-back-emblem">${symbolSvg("S")}</span></div>` +
      `</div>`;
    cardLayer.appendChild(el);
    cardEls.set(c.id, el);
  }
  labelCards();
}
function labelCards() {
  for (const c of makeDeck()) cardEls.get(c.id).setAttribute("aria-label", cardName(c));
}

// ----------------------------------------------------------------------
// layout — everything derives from the table's width (and, on a short
// screen, its height)
// ----------------------------------------------------------------------
function measure() {
  main.classList.toggle("is-narrow", window.innerWidth < 480);
  // Measure the room the table has (its parent's inner width), not the
  // table itself: on a short screen the table is narrowed to hug the
  // height-capped cards, and measuring itself would feed back on itself.
  const cs = getComputedStyle(main);
  const room = Math.max(200, main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  const wide = room >= 600;
  const vh = window.innerHeight || 800;
  const short = wide && vh < 600;
  const gap = wide ? 12 : room < 480 ? 3 : Math.max(4, Math.round(room * 0.014));
  const pad = wide ? 14 : 4;
  let cardW = Math.floor((room - 2 * pad - 7 * gap) / 8);
  // A phone held sideways is wide but short: size the cards from the
  // height so the whole table still fits on one screen. A tablet or
  // laptop under 900px tall is capped so that the table AND the toolbar
  // fit under the measured header, goal and status (DESIGN §2: availH =
  // vh − everything above the table − 56 toolbar − 32 gaps) — Undo must
  // never sit below the fold on a laptop. The table is 2·pad + card row +
  // caption gap + a 3.2-card column budget + plate + 4, i.e. about
  // 66 + 6.45·cardW; never below 64px so a squat window still gets big
  // cards (and scrolls).
  const plateH = Math.max(34, plate.offsetHeight || 34);
  let cap = 88;
  if (short) cap = Math.max(44, Math.floor((vh - 120) / 6.4));
  else if (wide && vh < 900) {
    const tableTop = table.getBoundingClientRect().top + window.scrollY;
    const availH = vh - tableTop - 56 - 32;
    const fixed = 2 * pad + plateH + 4;
    cap = Math.min(88, Math.max(64, Math.floor((availH - fixed) / (1.42 * (1 + 0.34 + 3.2)))));
  }
  let W = room;
  if (cardW > cap) {
    cardW = cap;
    // Whenever the height, not the width, set the card size, the felt
    // panel hugs the eight columns instead of leaving a field of felt
    // either side (a 64px deck on a 744px panel would float in green).
    W = 8 * cardW + 7 * gap + 2 * pad;
  }
  const padX = Math.floor((W - 8 * cardW - 7 * gap) / 2);
  table.style.width = W === room ? "" : W + "px";
  const cardH = Math.round(cardW * 1.42);
  const fan = Math.round(cardW * 0.48);
  // Never squeeze a column so far that the index strip is covered.
  const minFan = Math.max(12, Math.round(cardW * 0.44));
  const rowGap = Math.round(cardH * 0.34);
  const colX = [];
  for (let i = 0; i < 8; i++) colX.push(padX + i * (cardW + gap));
  const y0 = pad;
  const y1 = pad + cardH + rowGap;
  // How tall a column may fan before its offsets squeeze (the table grows
  // past this when a column really needs it).
  const budget = Math.round(cardH * (short ? 2.9 : wide ? 3.2 : 3.6));
  layout = { W, room, vh, wide, short, gap, pad, padX, cardW, cardH, fan, minFan, colX, y0, y1, rowGap, budget, plateH };
  table.style.setProperty("--card-w", cardW + "px");
  table.style.setProperty("--card-h", cardH + "px");
  table.style.setProperty("--gap", gap + "px");
  table.style.setProperty("--pad", pad + "px");
  table.classList.toggle("is-wide", cardW >= 72);
  table.classList.toggle("is-narrow", cardW < 48);
  table.classList.toggle("no-captions", cardW < 44 && short);
  plate.classList.toggle("is-stacked", W < 420);
  const slotPos = (el, x, y) => { el.style.left = x + "px"; el.style.top = y + "px"; };
  for (let i = 0; i < 4; i++) slotPos($("fc-slot-cell-" + i), colX[i], y0);
  for (let i = 0; i < 4; i++) slotPos($("fc-slot-foundation-" + i), colX[4 + i], y0);
  for (let i = 0; i < 8; i++) slotPos($("fc-slot-cascade-" + i), colX[i], y1);
  const capY = y0 + cardH + Math.max(0, Math.round((rowGap - 15) / 2));
  const capW = colX[3] + cardW - colX[0];
  const caption = (el, x) => { el.style.left = x + "px"; el.style.top = capY + "px"; el.style.width = capW + "px"; };
  caption($("fc-caption-cells"), colX[0]);
  caption($("fc-caption-home"), colX[4]);
}

/** Vertical offsets for a cascade, squeezed to fit the budget. */
function columnOffsets(pile) {
  const { cardH, fan, minFan, budget } = layout;
  const n = pile.length;
  let f = fan;
  if (n > 1 && cardH + (n - 1) * f > budget) f = Math.max(minFan, Math.floor((budget - cardH) / (n - 1)));
  const offsets = [];
  for (let k = 0; k < n; k++) offsets.push(k * f);
  return { offsets, height: n ? cardH + (n - 1) * f : cardH };
}

function positionOf(loc) {
  const { colX, y0, y1 } = layout;
  if (loc.pile === "cell") return [colX[loc.index], y0];
  if (loc.pile === "foundation") return [colX[4 + loc.index], y0];
  if (loc.pile === "deck") return [Math.round((layout.W - layout.cardW) / 2), y0];
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
  state.cells.forEach((c, i) => {
    const slot = $("fc-slot-cell-" + i);
    slot.setAttribute("aria-label", c ? t("cellHolds", { n: i + 1, name: cardName(c) }) : t("cellEmpty", { n: i + 1 }));
    if (!c) return;
    const el = cardEls.get(c.id);
    const [x, y] = positionOf({ pile: "cell", index: i });
    place(el, x, y, 100 + i);
    setFace(el, true);
    el.tabIndex = 0;
    cardLoc.set(c.id, { pile: "cell", index: i, liftable: true });
  });
  state.foundations.forEach((pile, i) => {
    const slot = $("fc-slot-foundation-" + i);
    slot.setAttribute("aria-label", pile.length ? t("homeHolds", { n: i + 1, name: cardName(pile[pile.length - 1]) }) : t("homeEmpty", { n: i + 1 }));
    pile.forEach((c, k) => {
      const el = cardEls.get(c.id);
      const [x, y] = positionOf({ pile: "foundation", index: i });
      place(el, x, y, 200 + k);
      setFace(el, true);
      el.tabIndex = -1;
      cardLoc.set(c.id, { pile: "foundation", index: i, liftable: false });
    });
  });
  state.cascades.forEach((pile, i) => {
    const { offsets, height } = columnOffsets(pile);
    maxCol = Math.max(maxCol, height);
    $("fc-slot-cascade-" + i).setAttribute("aria-label", pile.length ? t("columnLabel", { n: i + 1 }) : t("columnEmpty", { n: i + 1 }));
    pile.forEach((c, k) => {
      const el = cardEls.get(c.id);
      const [x, y] = positionOf({ pile: "cascade", index: i, offset: offsets[k] });
      place(el, x, y, 300 + i * 30 + k);
      setFace(el, true);
      el.tabIndex = 0;
      cardLoc.set(c.id, { pile: "cascade", index: i, card: k, liftable: true });
    });
  });
  plateDeal.textContent = dealLabel(state.deal);
  // Never promise more cards than are left on the table (an empty table
  // would otherwise boast "1280 cards at once").
  const left = 52 - state.foundations.reduce((n, p) => n + p.length, 0);
  plateMove.textContent = left ? t("plateMove", { n: Math.min(maxMovable(state), left) }) : "";
  // The plate is measured after its words are set: in German or Russian
  // it wraps to two lines on a phone, and the table must grow with it so
  // the plate never covers the bottom of a long column.
  layout.plateH = Math.max(34, plate.offsetHeight || 34);
  const height = layout.y1 + Math.max(layout.budget, maxCol) + layout.pad + layout.plateH + 4;
  table.style.height = height + "px";

  dealCurrent.textContent = dealLabel(state.deal);
  undoBtn.disabled = history.length === 0 || busy;
  hintBtn.disabled = busy;
  clearHighlights();
  // A card picked up in "Let me choose" keeps its gold ring through a
  // resize, a rotation or a language change.
  if (selected && cardsAt(state, selected).length) {
    for (const c of cardsAt(state, selected)) cardEls.get(c.id).classList.add("is-selected");
    highlightTargets(selected);
  } else {
    selected = null;
  }
}
function setFace(el, up) {
  el.classList.toggle("is-face-down", !up);
}
function clearHighlights() {
  for (const el of table.querySelectorAll(".is-target, .is-hint, .is-selected, .is-empty")) {
    el.classList.remove("is-target", "is-hint", "is-selected", "is-empty");
  }
}

/** The status line. `key` is an i18n key (or a thunk returning text for
 *  the few composed sentences); it is remembered so a language change
 *  re-speaks the same message. */
function setStatus(key, args) {
  lastStatus = [key, args];
  statusEl.textContent = typeof key === "function" ? key() : t(key, args);
}
function refreshStatus() { if (lastStatus) setStatus(lastStatus[0], lastStatus[1]); }
function toast(text) {
  const el = document.createElement("div");
  el.className = "achievement-toast is-visible";
  el.textContent = text;
  toasts.appendChild(el);
  setTimeout(() => { el.classList.remove("is-visible"); setTimeout(() => el.remove(), 300); }, 2600);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function startKey() { return settings.tap === "choose" ? "chooseStart" : "start"; }

// Everything drawn by this file is redrawn in the new language.
i18n.onChange(() => {
  labelCards();
  i18n.renderPicker($("fc-lang-grid"));
  if (state) render();
  if (pendingDeal !== null) confirmNote.textContent = t("putAwayDeal", { deal: formatDeal(pendingDeal) });
  if (winModal.dataset.open === "true") fillWinNote();
  refreshStatus();
});

// ----------------------------------------------------------------------
// committing a move
// ----------------------------------------------------------------------
function commit(next) {
  history.push(state);
  if (history.length > 500) history.shift();
  state = next;
  selected = null;
  render();
  store.saveGame(state, history);
}

/** Apply a legal move, play its sound, then let safe cards go Home. */
function moveCards(from, to) {
  const next = applyMove(state, from, to);
  if (!next) return false;
  commit(next);
  if (to.pile === "foundation") audio.playFoundation();
  else if (to.pile === "cell") audio.playCell();
  else audio.playPlace();
  if (isWon(state)) onWin();
  else if (canAutoComplete(state)) startAutoFinish();
  else startSafeAutoplay();
  return true;
}

function undo() {
  if (busy || !history.length) return;
  state = history.pop();
  selected = null;
  render();
  store.saveGame(state, history);
  audio.playUndo();
  setStatus("undone");
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

/** The location a card element stands for, or null when it cannot be lifted. */
function locOfCard(id) {
  const l = cardLoc.get(id);
  if (!l || !l.liftable) return null;
  if (l.pile === "cascade") return { pile: "cascade", index: l.index, card: l.card };
  return { pile: "cell", index: l.index };
}

/** Why the run at `loc` cannot be lifted at all, as [key, args] — or null. */
function liftProblem(loc) {
  if (loc.pile !== "cascade") return null;
  const cards = cardsAt(state, loc);
  const pile = state.cascades[loc.index];
  if (!cards.length) return ["covered", { name: cardName(pile[loc.card]) }];
  const allowed = maxMovable(state);
  if (cards.length > allowed) return ["tooMany", { n: cards.length, allowed }];
  return null;
}

/** What the status says after a tap sent the cards at `from` to `to`. */
function wentText(cards, to, destTop) {
  const name = cardName(cards[0]);
  if (to.pile === "foundation") return ["wentHome", { name }];
  if (to.pile === "cell") return ["wentToCell", { name }];
  if (!destTop) return ["wentToEmpty", { name }];
  return ["wentOnto", { name, dest: cardName(destTop) }];
}

function tapCard(el) {
  if (busy) return;
  const id = el.dataset.id;
  const raw = cardLoc.get(id);
  if (!raw) return;
  if (raw.pile === "foundation") {
    if (selected) return tryPlaceSelected({ pile: "foundation", index: raw.index });
    setStatus("homeStay");
    return;
  }
  const loc = locOfCard(id);
  if (settings.tap === "choose") return tapChoose(loc, raw, el);

  const problem = liftProblem(loc);
  if (problem) { shake(el); audio.playNope(); setStatus(...problem); return; }
  const to = autoMoveTarget(state, loc);
  const cards = cardsAt(state, loc);
  if (!to) {
    shake(el);
    audio.playNope();
    // A run that only an empty column would take, but is too long for it.
    const p = state.cascades.map((_, i) => moveProblem(state, loc, { pile: "cascade", index: i })).find((x) => x && x.reason === "tooMany");
    if (p) setStatus("tooManyEmpty", { n: p.count, allowed: p.allowed });
    else setStatus("nowhere", { name: cardName(cards[0]) });
    return;
  }
  const destPile = to.pile === "cascade" ? state.cascades[to.index] : null;
  const went = wentText(cards, to, destPile && destPile.length ? destPile[destPile.length - 1] : null);
  moveCards(loc, to);
  if (!busy) setStatus(...went);
}

function tapChoose(loc, raw, el) {
  if (selected) {
    const same = selected.pile === loc.pile && selected.index === loc.index && selected.card === loc.card;
    if (same) { selected = null; clearHighlights(); setStatus("putDown"); return; }
    if (tryPlaceSelected({ pile: raw.pile, index: raw.index })) return;
  }
  const problem = liftProblem(loc);
  if (problem) { selected = null; clearHighlights(); shake(el); audio.playNope(); setStatus(...problem); return; }
  selectRun(loc);
}
function selectRun(loc) {
  selected = loc;
  clearHighlights();
  const cards = cardsAt(state, loc);
  for (const c of cards) cardEls.get(c.id).classList.add("is-selected");
  highlightTargets(loc);
  audio.playPick();
  const name = cardName(cards[0]);
  if (cards.length > 1) setStatus("pickedUpRun", { name, n: cards.length - 1 });
  else setStatus("pickedUp", { name });
}
/** Every place the cards at `loc` may go, lit up. */
function highlightTargets(loc) {
  for (let i = 0; i < 4; i++) {
    if (canMove(state, loc, { pile: "foundation", index: i })) highlightPile({ pile: "foundation", index: i });
    if (canMove(state, loc, { pile: "cell", index: i })) highlightPile({ pile: "cell", index: i });
  }
  for (let i = 0; i < 8; i++) if (canMove(state, loc, { pile: "cascade", index: i })) highlightPile({ pile: "cascade", index: i });
}
function highlightPile(d) {
  const top = d.pile === "cell" ? state.cells[d.index] : (d.pile === "foundation" ? state.foundations[d.index] : state.cascades[d.index]).slice(-1)[0];
  if (top) cardEls.get(top.id).classList.add("is-target");
  else $(`fc-slot-${d.pile}-${d.index}`).classList.add("is-target", "is-empty");
}
function problemStatus(p, to) {
  if (p.reason === "tooMany") return state.cascades[to.index].length ? ["tooMany", { n: p.count, allowed: p.allowed }] : ["tooManyEmpty", { n: p.count, allowed: p.allowed }];
  if (p.reason === "cellFull") return ["cellFull"];
  if (p.reason === "single") return ["onlyOne"];
  if (p.reason === "foundation") return ["cannotFoundation"];
  return ["cannotCascade"];
}
function tryPlaceSelected(to) {
  if (!selected) return false;
  const from = selected;
  const p = moveProblem(state, from, to);
  if (!p) {
    const cards = cardsAt(state, from);
    const destPile = to.pile === "cascade" ? state.cascades[to.index] : null;
    const went = wentText(cards, to, destPile && destPile.length ? destPile[destPile.length - 1] : null);
    moveCards(from, to);
    if (!busy) setStatus(...went);
    return true;
  }
  if (p.reason === "same") return false;
  setStatus(...problemStatus(p, to));
  audio.playNope();
  return false;
}

function tapSlot(slot) {
  if (busy || !selected) return;
  if (slot.dataset.cascade !== undefined) tryPlaceSelected({ pile: "cascade", index: Number(slot.dataset.cascade) });
  else if (slot.dataset.cell !== undefined) tryPlaceSelected({ pile: "cell", index: Number(slot.dataset.cell) });
  else if (slot.dataset.foundation !== undefined) tryPlaceSelected({ pile: "foundation", index: Number(slot.dataset.foundation) });
}

// ----------------------------------------------------------------------
// drag — pointer events, delegated from the table
// ----------------------------------------------------------------------
let drag = null;
const DRAG_THRESHOLD = 8;

table.addEventListener("pointerdown", (e) => {
  if (cascade) { stopCascade(); render(); }   // any tap skips the flourish
  if (busy || e.button > 0) return;
  const cardEl = e.target.closest(".fc-card");
  const slot = e.target.closest(".fc-slot");
  if (!cardEl && !slot) return;
  const loc = cardEl ? locOfCard(cardEl.dataset.id) : null;
  const liftable = !!(loc && cardsAt(state, loc).length);
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

function endDrag() {
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
  const p = to ? moveProblem(state, d.loc, to) : { reason: "none" };
  if (to && !p) {
    const cards = cardsAt(state, d.loc);
    const destPile = to.pile === "cascade" ? state.cascades[to.index] : null;
    const went = wentText(cards, to, destPile && destPile.length ? destPile[destPile.length - 1] : null);
    moveCards(d.loc, to);
    if (!busy) setStatus(...went);
  } else {
    render(); // snap back
    if (to && p.reason !== "same") { setStatus(...problemStatus(p, to)); audio.playNope(); }
  }
}
table.addEventListener("pointerup", endDrag);
table.addEventListener("pointercancel", endDrag);

/** The pile under the dragged card: greatest overlap with its head card. */
function dropTargetFor(d) {
  const head = d.run[0].getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  let best = null, bestArea = 0;
  const consider = (to, x, y, h) => {
    const rect = { left: tableRect.left + x, top: tableRect.top + y, right: tableRect.left + x + layout.cardW, bottom: tableRect.top + y + h };
    const w = Math.min(head.right, rect.right) - Math.max(head.left, rect.left);
    const hh = Math.min(head.bottom, rect.bottom) - Math.max(head.top, rect.top);
    if (w <= 0 || hh <= 0) return;
    const area = w * hh;
    if (area > bestArea) { bestArea = area; best = to; }
  };
  for (let i = 0; i < 4; i++) {
    if (!(d.loc.pile === "cell" && d.loc.index === i)) { const [x, y] = positionOf({ pile: "cell", index: i }); consider({ pile: "cell", index: i }, x, y, layout.cardH); }
    const [fx, fy] = positionOf({ pile: "foundation", index: i });
    consider({ pile: "foundation", index: i }, fx, fy, layout.cardH);
  }
  for (let i = 0; i < 8; i++) {
    if (d.loc.pile === "cascade" && d.loc.index === i) continue;
    const { height } = columnOffsets(state.cascades[i]);
    const [x, y] = positionOf({ pile: "cascade", index: i });
    consider({ pile: "cascade", index: i }, x, y, Math.max(height, layout.cardH));
  }
  return bestArea > layout.cardW * layout.cardH * 0.2 ? best : null;
}
function updateDropTarget() {
  for (const el of table.querySelectorAll(".is-target, .is-empty")) el.classList.remove("is-target", "is-empty");
  const to = dropTargetFor(drag);
  if (to && canMove(state, drag.loc, to)) highlightPile(to);
}

// keyboard: Enter/Space on a card or a slot does what a tap does
table.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const cardEl = e.target.closest(".fc-card");
  const slot = e.target.closest(".fc-slot");
  if (cardEl) { e.preventDefault(); tapCard(cardEl); }
  else if (slot) { e.preventDefault(); tapSlot(slot); }
});

// ----------------------------------------------------------------------
// hint — routed through the (future) rewarded-ad hook
// ----------------------------------------------------------------------
hintBtn.addEventListener("click", async () => {
  if (busy) return;
  const answer = await ads.requestRewardedHint();
  if (answer !== "granted" || busy) return;
  const h = findHint(state);
  clearHighlights();
  selected = null;
  const d = describeHint(state, h);
  setStatus(() => hintText(d));
  if (!h) return;
  for (const c of cardsAt(state, h.from)) cardEls.get(c.id).classList.add("is-hint");
  highlightPile(h.to);
  const slot = $(`fc-slot-${h.to.pile}-${h.to.index}`);
  if (slot.classList.contains("is-target")) slot.classList.add("is-hint");
});

undoBtn.addEventListener("click", undo);

// ----------------------------------------------------------------------
// new game
// ----------------------------------------------------------------------
/** Only the player's own moves count: cards that went Home by themselves
 *  after the deal are not a game worth asking about. */
function gameInProgress() { return state && history.length > 0 && !isWon(state); }

function askThenDeal(dealNumber) {
  pendingDeal = dealNumber === undefined ? null : dealNumber;
  if (gameInProgress()) {
    confirmNote.textContent = pendingDeal !== null ? t("putAwayDeal", { deal: formatDeal(pendingDeal) }) : t("putAway");
    confirmModal.dataset.open = "true";
    confirmYes.focus();
    return;
  }
  deal(pendingDeal === null ? {} : { deal: pendingDeal });
}
newBtn.addEventListener("click", () => {
  if (busy && !isWon(state)) return;
  askThenDeal();
});
confirmYes.addEventListener("click", async () => {
  confirmModal.dataset.open = "false";
  const n = pendingDeal;
  await ads.showInterstitial("new_game");
  deal(n === null ? { abandoned: true } : { abandoned: true, deal: n });
});
confirmNo.addEventListener("click", () => { confirmModal.dataset.open = "false"; pendingDeal = null; newBtn.focus(); });

function deal({ abandoned = false, deal: dealNumber } = {}) {
  stopCascade();
  if (abandoned) stats.streak = 0;
  stats.played += 1;
  store.saveStats(stats);
  state = newGame({ deal: dealNumber });
  history = [];
  selected = null;
  pendingDeal = null;
  busy = false;
  winModal.dataset.open = "false";
  store.saveGame(state, history);
  trackEvent("game_start", { deal: state.deal });
  animateDeal();
  setStatus(UNSOLVABLE.has(state.deal) ? "newDealHard" : "newDeal", { deal: formatDeal(state.deal) });
  // A fresh deal can already have safe cards to send Home.
  if (!reduceMotion) setTimeout(() => { if (state.moves === 0 && !busy) startSafeAutoplay(); }, 52 * 22 + 500);
  else startSafeAutoplay();
}

/** Every card starts face down on a deck in the middle and flies to its
 *  place, one after another, turning over as it lands. */
function animateDeal() {
  if (!layout) measure();
  if (reduceMotion) { render(); return; }
  const [sx, sy] = positionOf({ pile: "deck" });
  for (const el of cardEls.values()) {
    el.classList.add("no-transition");
    el.style.transitionDelay = "0ms";
    el.firstElementChild.style.transitionDelay = "0ms";
    place(el, sx, sy, 5);
    setFace(el, false);
  }
  void table.offsetWidth; // flush so the jump above is not animated
  let n = 0;
  for (let k = 0; k < 7; k++) {
    for (const pile of state.cascades) {
      if (!pile[k]) continue;
      const el = cardEls.get(pile[k].id);
      el.style.transitionDelay = `${n * 22}ms`;
      el.firstElementChild.style.transitionDelay = `${n * 22 + 120}ms`;
      n++;
    }
  }
  for (const el of cardEls.values()) el.classList.remove("no-transition");
  render();
  setTimeout(() => { for (const el of cardEls.values()) { el.style.transitionDelay = ""; el.firstElementChild.style.transitionDelay = ""; } }, n * 22 + 500);
}

// ----------------------------------------------------------------------
// safe autoplay, the finish, and the win
// ----------------------------------------------------------------------
/** Runs `stepFn` one card at a time, ~120 ms apart, then `done(count, firstCard)`. */
function runSteps(stepFn, done, firstDelay = 120) {
  let n = 0, first = null;
  const tick = () => {
    const step = stepFn(state);
    if (!step) { done(n, first); return; }
    const card = cardsAt(state, step.from)[0];
    if (!first) first = card;
    state = applyMove(state, step.from, step.to);
    n++;
    render();
    audio.playFoundation();
    setTimeout(tick, reduceMotion ? 0 : 120);
  };
  setTimeout(tick, reduceMotion ? 0 : firstDelay);
}

function startSafeAutoplay() {
  if (!safeAutoplayStep(state)) return;
  busy = true;
  render();
  runSteps(safeAutoplayStep, (n, first) => {
    busy = false;
    render();
    store.saveGame(state, history);
    if (isWon(state)) return onWin();
    if (n === 1) setStatus("autoHomeOne", { name: cardName(first) }); else setStatus("autoHomeMany", { n });
    if (canAutoComplete(state)) startAutoFinish();
  });
}

function startAutoFinish() {
  busy = true;
  render();
  setStatus("finishing");
  runSteps(autoCompleteStep, () => {
    busy = false;
    render();
    store.saveGame(state, history);
    if (isWon(state)) onWin();
  }, 350);
}

function fillWinNote() {
  winNote.textContent = t("wonNote", { deal: formatDeal(state.deal), moves: state.moves }) + (stats.streak > 1 ? " " + t("winsInARow", { n: stats.streak }) : "");
}

async function onWin() {
  busy = true;
  stats.won += 1;
  stats.streak += 1;
  stats.best = Math.max(stats.best, stats.streak);
  store.saveStats(stats);
  store.clearGame();
  trackEvent("game_win", { deal: state.deal, moves: state.moves });
  audio.playWin();
  setStatus("youDidIt");
  undoBtn.disabled = true;
  hintBtn.disabled = true;
  fillWinNote();
  if (!reduceMotion) startCascade();
  // The table already celebrates; an interstitial here sits in a natural
  // pause, and the modal waits for it.
  await wait(reduceMotion ? 200 : 600);
  await ads.showInterstitial("game_over");
  await wait(reduceMotion ? 0 : 600);
  winModal.dataset.open = "true";
  winAgain.focus();
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
winChoose.addEventListener("click", () => { winModal.dataset.open = "false"; openSettings(); dealInput.focus({ preventScroll: false }); });

// ----------------------------------------------------------------------
// settings
// ----------------------------------------------------------------------
function fillStats() {
  $("fc-stat-wins").textContent = stats.won;
  $("fc-stat-played").textContent = stats.played;
  $("fc-stat-best").textContent = stats.best;
}
function openSettings() {
  fillStats();
  dealNote.textContent = t("dealNote");
  dealInput.classList.remove("is-invalid");
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

function dealFromInput() {
  const n = Number(dealInput.value);
  if (!isValidDealNumber(n)) { dealNote.textContent = t("dealInvalid"); dealInput.classList.add("is-invalid"); dealInput.focus(); return; }
  if (busy && !isWon(state)) return;
  dealInput.value = "";
  dealInput.classList.remove("is-invalid");
  settingsPanel.dataset.open = "false";
  askThenDeal(n);
}
dealGo.addEventListener("click", dealFromInput);
dealInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); dealFromInput(); } });
dealReplay.addEventListener("click", () => {
  if (busy && !isWon(state)) return;
  settingsPanel.dataset.open = "false";
  askThenDeal(state.deal);
});

const tapRadios = document.querySelectorAll('input[name="fc-tap"]');
const soundToggle = $("fc-toggle-sound");
const backRadios = document.querySelectorAll('input[name="fc-back"]');
backRadios.forEach((r) => { r.checked = r.value === settings.back; });
backRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings.back = r.value;
  main.dataset.back = settings.back;
  store.saveSettings(settings);
  audio.playPlace();
}));
tapRadios.forEach((r) => { r.checked = r.value === settings.tap; });
soundToggle.checked = settings.sound;

tapRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings.tap = r.value;
  store.saveSettings(settings);
  selected = null;
  clearHighlights();
  setStatus(startKey());
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
  if (confirmModal.dataset.open === "true") { confirmModal.dataset.open = "false"; pendingDeal = null; return; }
  if (settingsPanel.dataset.open === "true") closeSettings();
  else if (selected) { selected = null; clearHighlights(); setStatus("putDown"); }
});

// ----------------------------------------------------------------------
// boot
// ----------------------------------------------------------------------
buildCards();
measure();
function relayout() {
  measure();
  if (state) {
    for (const el of cardEls.values()) el.classList.add("no-transition");
    render();
    void table.offsetWidth;
    for (const el of cardEls.values()) el.classList.remove("no-transition");
  }
}
new ResizeObserver(() => {
  if (layout && main.clientWidth === layout.mainW && window.innerHeight === layout.vh) return;
  relayout();
  layout.mainW = main.clientWidth;
}).observe(main);
window.addEventListener("orientationchange", () => setTimeout(relayout, 60));
window.addEventListener("resize", () => { if (layout && (window.innerHeight !== layout.vh || main.clientWidth !== layout.mainW)) { relayout(); layout.mainW = main.clientWidth; } });
requestAnimationFrame(() => requestAnimationFrame(relayout));

const saved = store.loadGame();
if (saved && !isWon(saved.state)) {
  state = saved.state;
  history = saved.history;
  for (const el of cardEls.values()) el.classList.add("no-transition");
  render();
  void table.offsetWidth;
  for (const el of cardEls.values()) el.classList.remove("no-transition");
  setStatus(startKey());
  toast(t("restored"));
  // A save written just before autoplay ran (the tab closed mid-flight)
  // still has safe cards waiting: send them Home now, as a move would.
  if (canAutoComplete(state)) startAutoFinish();
  else startSafeAutoplay();
} else {
  deal();
}
