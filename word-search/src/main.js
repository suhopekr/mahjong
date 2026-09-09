// word-search/src/main.js
// The page: renders game/wordsearch.js's puzzle as a grid of letters on a
// paper sheet, and turns drags, taps and buttons into calls on it.
//
// Nothing about the puzzle lives here — generate/findWord/hintFor are all
// the engine's. This file owns: measuring the board and sizing the cells,
// the drag and two-tap gestures, the capsules, saving, the settings
// sheet, the language picker, the win, and analytics. Every word the
// page says comes from i18n.t() or a data-i18n attribute.

import {
  generate, dailySeed, dateOfSeed, randomSeed, findWord, hintFor, isComplete, letterAt, endOf,
} from "./game/wordsearch.js";
import * as store from "./core/storage.js";
import * as audio from "./core/audio.js";
import * as ads from "./core/ads.js";
import { createI18n } from "/i18n/i18n.js";
import { common } from "/i18n/common.js";
import { strings } from "./i18n/strings.js";

const i18n = createI18n({ common, game: strings });
const t = (key, arg) => i18n.t(key, arg);

const $ = (id) => document.getElementById(id);
const main = $("word-search");
const board = $("ws-board");
const sheet = $("ws-sheet");
const grid = $("ws-grid");
const caps = $("ws-caps");
const wordsEl = $("ws-words");
const statusEl = $("ws-status");
const goalEl = $("ws-goal");
const titleEl = $("ws-title");
const badgeEl = $("ws-badge");
const dateEl = $("ws-date");
const hintBtn = $("ws-hint-btn");
const newBtn = $("ws-new-btn");
const todayBtn = $("ws-today-btn");
const settingsBtn = $("ws-settings-btn");
const settingsPanel = $("ws-settings-panel");
const settingsClose = $("ws-settings-close");
const langGrid = $("ws-lang-grid");
const winModal = $("ws-win-modal");
const winNote = $("ws-win-note");
const winAgain = $("ws-win-again");
const winToday = $("ws-win-today");
const winClose = $("ws-win-close");
const confirmModal = $("ws-confirm-modal");
const confirmYes = $("ws-confirm-yes");
const confirmNo = $("ws-confirm-no");
const toasts = $("ws-toasts");

const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DEBUG = /(^|[?&])debug=1(&|$)/.test(location.search);
const TONES = 8;

// ----------------------------------------------------------------------
// analytics — same shape as every other page: check gtag exists, never throw
// ----------------------------------------------------------------------
function trackEvent(name, params) {
  try {
    if (typeof window.gtag === "function") window.gtag("event", name, { game_name: "word_search", ...params });
  } catch { /* analytics must never affect the game */ }
}
for (const el of document.querySelectorAll("a[data-crossgame-to]")) {
  el.addEventListener("click", () => {
    trackEvent("cross_game_click", { from: "word_search", to: el.dataset.crossgameTo, placement: el.dataset.placement });
  });
}

// ----------------------------------------------------------------------
// state
// ----------------------------------------------------------------------
let settings = store.loadSettings();
let stats = store.loadStats();
let puzzle = null;
let found = [];          // [{ word, r1, c1, r2, c2 }] in the order found
let hints = 0;
let lastHint = null;     // the word the last hint pointed at
let busy = false;        // the win pause: no more input on the grid
let tapAnchor = null;    // two-tap: the first letter, { row, col }
let cursor = { row: 0, col: 0 };
let pending = null;      // what the confirm modal will do
let layout = null;
const cellEls = [];      // row-major, n*n
let liveCap = null;
let status = { key: "start", arg: null }; // the last status, re-spoken on a language change

audio.setSoundEnabled(settings.sound);

// ----------------------------------------------------------------------
// layout — everything derives from the board's width, and from the
// viewport height when that is the tighter of the two
// ----------------------------------------------------------------------
function heightOf(sel) { const el = document.querySelector(sel); return el ? el.offsetHeight : 0; }

function measure() {
  const W = board.clientWidth || 360;
  const vh = window.innerHeight || 800;
  const phone = W < 480;
  const short = W >= 600 && vh < 600;
  // The list stands beside the sheet on wide screens — except a portrait
  // tablet, which is wide enough but far taller than wide: there the
  // sheet takes the full width (bigger letters) and the chips wrap below.
  const beside = W >= 720 && vh <= W * 1.25;
  // On a height-capped screen (tablet sideways, laptop) ten stacked chips
  // are taller than the sheet; two columns keep the toolbar on screen.
  const listCols = beside && vh < 900 ? 2 : 1;
  const listW = !beside ? 0 : listCols === 2 ? 340 : W >= 860 ? 280 : 240;
  const gap = 24;
  const tablePad = phone ? 10 : 12;
  const sheetPad = phone ? 4 : 12;
  const sheetW = beside ? W - gap - listW : W;
  const inner = sheetW - 2 * tablePad - 2 * sheetPad;
  const n = puzzle ? puzzle.n : 8;
  let cell = Math.min(Math.floor(inner / n), 56);
  if (short) {
    // A phone held sideways: size from the height so the whole grid is on
    // one screen, but never below 30px a cell.
    cell = Math.min(cell, Math.max(30, Math.floor((vh - 120) / n)));
  } else if (W >= 600 && vh < 900) {
    // A tablet or a small laptop window: keep sheet + toolbar on one
    // screen when that can be done without going under 36px cells.
    const availH = vh - heightOf(".site-header") - heightOf(".ws-goal") - heightOf(".ws-status") - heightOf(".ws-head")
      - 56 - 48 - 2 * tablePad - 2 * sheetPad - 24;
    cell = Math.min(cell, Math.max(36, Math.floor(availH / n)));
  } else if (vh < 900) {
    // Design review: a phone held upright. The sheet was sized from the
    // width alone, so at 375x667 it ended 630px down the page and the word
    // list — the half of a word search you actually read — began below the
    // fold. Leave room for the first row of chips: a puzzle whose words
    // are all off screen does not look like a puzzle. The 36px floor
    // still protects the 24px letters, and DESIGN.md §2's own table wants
    // 41px cells at 375 anyway.
    const availH = vh - heightOf(".site-header") - heightOf(".ws-goal") - heightOf(".ws-status") - heightOf(".ws-head")
      - 16 /* board gap */ - 48 /* one chip row */ - 2 * tablePad - 2 * sheetPad - 36;
    cell = Math.min(cell, Math.max(36, Math.floor(availH / n)));
  }
  cell = Math.max(20, Math.min(cell, Math.floor(inner / n)));
  // 24px glyphs from a 40px cell, 40px at most; below 30px cells the
  // letter takes 80% of the cell so it still reads.
  const letter = Math.round(Math.min(40, Math.max(Math.min(24, cell * 0.8), cell * 0.6)));
  layout = { W, vh, phone, short, beside, listCols, listW, inner, n, cell, letter, tablePad, sheetPad };
  board.style.setProperty("--n", n);
  board.style.setProperty("--cell", cell + "px");
  board.style.setProperty("--letter", letter + "px");
  board.style.setProperty("--table-pad", tablePad + "px");
  board.style.setProperty("--sheet-pad", sheetPad + "px");
  board.style.setProperty("--list-w", listW + "px");
  board.style.setProperty("--list-cols", listCols);
  board.classList.toggle("is-beside", beside);
  board.classList.toggle("is-phone", phone);
  main.classList.toggle("is-phone", phone);
  updateSizeAvailability();
}
/** 12×12 needs ≥ 32px cells (24px letters); that is 420px of sheet. */
function largeFits() { return layout && layout.inner >= 420; }
/** A phone, either way up: Small by default (DESIGN §4.5). */
function narrowScreen() { return (window.innerWidth || 800) < 600 || (window.innerHeight || 800) < 600; }
/** The size the next puzzle gets: the chosen one, or Small on a phone
 *  and Medium elsewhere when nothing was chosen, never Large where it
 *  cannot fit. */
function resolveSize() {
  let size = settings.size || (narrowScreen() ? "small" : "medium");
  if (size === "large" && !largeFits()) size = "medium";
  return size;
}

// ----------------------------------------------------------------------
// render
// ----------------------------------------------------------------------
function buildGrid() {
  for (const el of cellEls) el.remove();
  cellEls.length = 0;
  const n = puzzle.n;
  const frag = document.createDocumentFragment();
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const el = document.createElement("div");
    el.className = "ws-cell";
    el.setAttribute("role", "gridcell");
    el.dataset.r = r;
    el.dataset.c = c;
    el.textContent = letterAt(puzzle, r, c);
    frag.appendChild(el);
    cellEls.push(el);
  }
  grid.appendChild(frag);
  cursor = { row: 0, col: 0 };
}
function cellEl(row, col) { return cellEls[row * puzzle.n + col]; }

function buildWords() {
  wordsEl.innerHTML = "";
  for (const p of puzzle.words) {
    const chip = document.createElement("span");
    chip.className = "ws-chip";
    chip.setAttribute("role", "listitem");
    chip.dataset.word = p.word;
    chip.textContent = p.word;
    wordsEl.appendChild(chip);
  }
}
function chipFor(word) { return wordsEl.querySelector(`.ws-chip[data-word="${word}"]`); }

function renderChips() {
  for (const chip of wordsEl.children) {
    const i = found.findIndex((f) => f.word === chip.dataset.word);
    chip.className = "ws-chip" + (i >= 0 ? ` is-found ws-tone-${(i % TONES) + 1}` : "");
    chip.setAttribute("aria-label", i >= 0 ? t("chipFound", { word: chip.dataset.word }) : chip.dataset.word);
  }
}

/** Geometry of a capsule from one cell centre to another, in grid px. */
function capsuleGeometry(r1, c1, r2, c2) {
  const { cell } = layout;
  const x1 = (c1 + 0.5) * cell, y1 = (r1 + 0.5) * cell;
  const x2 = (c2 + 0.5) * cell, y2 = (r2 + 0.5) * cell;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  return { x1, y1, dist, angle };
}
function placeCap(el, r1, c1, r2, c2) {
  const { cell } = layout;
  const g = capsuleGeometry(r1, c1, r2, c2);
  el.style.left = g.x1 + "px";
  el.style.top = (g.y1 - cell * 0.41) + "px";
  el.style.width = (g.dist + cell) + "px";
  el.style.transform = `rotate(${g.angle}deg) translateX(${-cell / 2}px)`;
}
function renderCaps() {
  for (const el of caps.querySelectorAll(".ws-cap:not(.is-live)")) el.remove();
  found.forEach((f, i) => {
    const el = document.createElement("div");
    el.className = `ws-cap ws-tone-${(i % TONES) + 1}`;
    placeCap(el, f.r1, f.c1, f.r2, f.c2);
    caps.appendChild(el);
  });
}
function formatDate(seed) {
  const d = dateOfSeed(seed);
  try { return d.toLocaleDateString(i18n.lang, { weekday: "long", day: "numeric", month: "long" }); }
  catch { return d.toDateString(); }
}
function formatNumber(n) {
  try { return n.toLocaleString(i18n.lang); } catch { return String(n); }
}
function renderHead() {
  titleEl.textContent = t(puzzle.theme);
  const today = puzzle.daily && puzzle.seed === dailySeed();
  badgeEl.textContent = today ? t("todayBadge") : puzzle.daily ? t("dailyBadge") : t("puzzleNo", { n: formatNumber(puzzle.seed) });
  dateEl.textContent = puzzle.daily ? formatDate(puzzle.seed) : "";
}
function renderCase() {
  sheet.classList.toggle("is-lower", settings.letters === "lower");
  wordsEl.classList.toggle("is-lower", settings.letters === "lower");
}
function renderGoal() {
  const dirs = puzzle ? puzzle.directions : settings.directions;
  goalEl.dataset.i18n = dirs === "all" ? "goalAll" : "goalEasy";
  goalEl.innerHTML = t(goalEl.dataset.i18n);
}
function render() {
  measure();
  renderHead();
  renderGoal();
  renderCase();
  renderChips();
  renderCaps();
  clearHighlights();
  hintBtn.disabled = busy;
  exposeDebug();
}
function clearHighlights() {
  for (const el of grid.querySelectorAll(".is-hint, .is-cursor, .is-anchor")) el.classList.remove("is-hint", "is-cursor", "is-anchor");
  for (const el of wordsEl.querySelectorAll(".is-hint")) el.classList.remove("is-hint");
  if (puzzle) cellEl(cursor.row, cursor.col).classList.add("is-cursor");
}
/** Everything the page draws itself, said again in the current language. */
function rerender() {
  if (!puzzle) return;
  renderHead();
  renderGoal();
  renderChips();
  updateSizeAvailability();
}

function setStatus(key, arg = null) {
  status = { key, arg };
  statusEl.textContent = t(key, arg);
}
function refreshStatus() { statusEl.textContent = t(status.key, status.arg); }
function toast(text) {
  const el = document.createElement("div");
  el.className = "achievement-toast is-visible";
  el.textContent = text;
  toasts.appendChild(el);
  setTimeout(() => { el.classList.remove("is-visible"); setTimeout(() => el.remove(), 300); }, 2600);
}
function save() { if (puzzle && !isComplete(puzzle, foundWords())) store.saveGame(puzzle, found, hints); }
function foundWords() { return found.map((f) => f.word); }

/** ?debug=1 — the QA script reads where the words are so it can drive a
 *  puzzle to the end. Never set on a normal visit. */
function exposeDebug() {
  if (!DEBUG || !puzzle) return;
  window.__ws = {
    seed: puzzle.seed, n: puzzle.n, daily: puzzle.daily, theme: puzzle.theme, directions: puzzle.directions,
    placed: puzzle.words.map((w) => ({ word: w.word, row: w.row, col: w.col, dx: w.dx, dy: w.dy, end: endOf(w) })),
    found: foundWords(), cell: layout && layout.cell, hints,
  };
}

// ----------------------------------------------------------------------
// the live capsule (drag or two-tap)
// ----------------------------------------------------------------------
function showLive(r1, c1, r2, c2) {
  if (!liveCap) {
    liveCap = document.createElement("div");
    liveCap.className = "ws-cap is-live";
    caps.appendChild(liveCap);
  }
  liveCap.className = "ws-cap is-live";
  placeCap(liveCap, r1, c1, r2, c2);
}
function dropLive({ wrong = false } = {}) {
  if (!liveCap) return;
  const el = liveCap;
  liveCap = null;
  if (wrong) {
    el.classList.remove("is-live");
    el.classList.add("is-wrong");
    setTimeout(() => el.classList.add("is-gone"), reduceMotion ? 0 : 320);
    setTimeout(() => el.remove(), reduceMotion ? 10 : 620);
  } else {
    el.classList.add("is-gone");
    setTimeout(() => el.remove(), reduceMotion ? 10 : 300);
  }
}
/** The gold capsule becomes the pastel one: same element, new class, so
 *  CSS cross-fades the colour. */
function settleLive(tone) {
  if (!liveCap) return null;
  const el = liveCap;
  liveCap = null;
  void el.offsetWidth;
  el.className = `ws-cap ws-tone-${tone}`;
  return el;
}

// ----------------------------------------------------------------------
// hit-testing: nearest cell centre, by distance — never by element
// bounds, so a finger between two cells still lands
// ----------------------------------------------------------------------
function cellAtPoint(clientX, clientY) {
  const rect = grid.getBoundingClientRect();
  const { cell, n } = layout;
  const x = clientX - rect.left, y = clientY - rect.top;
  const col = Math.max(0, Math.min(n - 1, Math.floor(x / cell)));
  const row = Math.max(0, Math.min(n - 1, Math.floor(y / cell)));
  return { row, col, x, y };
}
const SNAP_DIRS = {
  easy: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  all: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]],
};
/** Where a drag from `anchor` to the point (x, y) ends: snapped to the
 *  nearest allowed direction and the nearest cell along it. */
function snapEnd(anchor, x, y) {
  const { cell, n } = layout;
  const ax = (anchor.col + 0.5) * cell, ay = (anchor.row + 0.5) * cell;
  const dx = x - ax, dy = y - ay;
  const dist = Math.hypot(dx, dy);
  if (dist < cell * 0.45) return { row: anchor.row, col: anchor.col };
  let best = null, bestDot = -Infinity;
  for (const [ddx, ddy] of SNAP_DIRS[puzzle.directions]) {
    const len = Math.hypot(ddx, ddy);
    const dot = (dx * ddx + dy * ddy) / len;
    if (dot > bestDot) { bestDot = dot; best = [ddx, ddy, len]; }
  }
  const [ddx, ddy, stepLen] = best;
  let steps = Math.round(Math.max(0, bestDot) / (cell * stepLen));
  const inside = (k) => anchor.col + ddx * k >= 0 && anchor.col + ddx * k < n && anchor.row + ddy * k >= 0 && anchor.row + ddy * k < n;
  while (steps > 0 && !inside(steps)) steps--;
  return { row: anchor.row + ddy * steps, col: anchor.col + ddx * steps };
}

// ----------------------------------------------------------------------
// a selection is complete: is it a word?
// ----------------------------------------------------------------------
/** A drag that ran one cell past the last letter (or stopped one short of
 *  it) still means the word: the end is nudged along the line by one and
 *  the selection accepted if that spells a word. No word hides inside
 *  another, so this can never pick the wrong word. Two-tap is exact and
 *  gets no nudge. */
function forgiveDragEnd(a, b) {
  const dr = Math.sign(b.row - a.row), dc = Math.sign(b.col - a.col);
  if (!dr && !dc) return null;
  for (const k of [-1, 1]) {
    const end = { row: b.row + dr * k, col: b.col + dc * k };
    if (end.row < 0 || end.row >= puzzle.n || end.col < 0 || end.col >= puzzle.n) continue;
    if (end.row === a.row && end.col === a.col) continue;
    const r = findWord(puzzle, a.row, a.col, end.row, end.col);
    if (r && r.word) return { end, result: r };
  }
  return null;
}

function evaluate(a, b, { fromDrag = false } = {}) {
  let result = findWord(puzzle, a.row, a.col, b.row, b.col);
  if (!result) {
    dropLive();
    audio.playNope();
    setStatus("notStraight");
    return false;
  }
  if (!result.word && fromDrag) {
    const nudged = forgiveDragEnd(a, b);
    if (nudged) {
      b = nudged.end;
      result = nudged.result;
      showLive(a.row, a.col, b.row, b.col);
    }
  }
  if (!result.word) {
    dropLive({ wrong: true });
    audio.playNope();
    setStatus("notWord");
    return false;
  }
  if (found.some((f) => f.word === result.word)) {
    dropLive();
    setStatus("already", { word: result.word });
    return false;
  }
  const tone = (found.length % TONES) + 1;
  found.push({ word: result.word, r1: a.row, c1: a.col, r2: b.row, c2: b.col });
  const settled = settleLive(tone);
  if (!settled) renderCaps();
  renderChips();
  clearHighlights();
  audio.playFound();
  exposeDebug();
  const left = puzzle.words.length - found.length;
  if (left === 0) { onWin(); return true; }
  setStatus("found", { word: result.word, left });
  save();
  return true;
}

// ----------------------------------------------------------------------
// two-tap: tap the first letter, tap the last
// ----------------------------------------------------------------------
function tapCell(cell) {
  if (busy) return;
  setCursor(cell);
  if (!tapAnchor) {
    tapAnchor = cell;
    showLive(cell.row, cell.col, cell.row, cell.col);
    cellEl(cell.row, cell.col).classList.add("is-anchor");
    audio.playPick();
    setStatus("picked", { letter: letterAt(puzzle, cell.row, cell.col) });
    return;
  }
  if (tapAnchor.row === cell.row && tapAnchor.col === cell.col) {
    tapAnchor = null;
    dropLive();
    cellEl(cell.row, cell.col).classList.remove("is-anchor");
    setStatus("unpicked");
    return;
  }
  const a = tapAnchor;
  tapAnchor = null;
  cellEl(a.row, a.col).classList.remove("is-anchor");
  showLive(a.row, a.col, cell.row, cell.col);
  evaluate(a, cell);
}
function setCursor(cell) {
  if (puzzle) cellEl(cursor.row, cursor.col).classList.remove("is-cursor");
  cursor = { row: cell.row, col: cell.col };
  cellEl(cursor.row, cursor.col).classList.add("is-cursor");
}
function clearAnchor() {
  if (!tapAnchor) return;
  cellEl(tapAnchor.row, tapAnchor.col).classList.remove("is-anchor");
  tapAnchor = null;
  dropLive();
}

// ----------------------------------------------------------------------
// drag — pointer events on the grid, captured so a finger that wanders
// off the sheet still finishes its word
// ----------------------------------------------------------------------
let drag = null;
const DRAG_THRESHOLD = 6;

grid.addEventListener("pointerdown", (e) => {
  if (busy || !puzzle || e.button > 0) return;
  const cell = cellAtPoint(e.clientX, e.clientY);
  drag = { anchor: cell, end: cell, x0: e.clientX, y0: e.clientY, moved: false, pointerId: e.pointerId };
  try { grid.setPointerCapture(e.pointerId); } catch { /* not all browsers */ }
  e.preventDefault();
});
grid.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_THRESHOLD) return;
    drag.moved = true;
    // A drag replaces any half-made two-tap selection.
    clearAnchor();
    setCursor(drag.anchor);
  }
  const p = cellAtPoint(e.clientX, e.clientY);
  const end = snapEnd(drag.anchor, p.x, p.y);
  if (end.row !== drag.end.row || end.col !== drag.end.col || !liveCap) {
    drag.end = end;
    showLive(drag.anchor.row, drag.anchor.col, end.row, end.col);
  }
});
function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  try { grid.releasePointerCapture(d.pointerId); } catch { /* ignore */ }
  if (e.type === "pointercancel") { if (d.moved) dropLive(); return; }
  if (!d.moved) { tapCell(d.anchor); return; }
  const single = d.end.row === d.anchor.row && d.end.col === d.anchor.col;
  if (single) {
    // A wiggle on one letter is a tap on it.
    dropLive();
    tapCell(d.anchor);
    return;
  }
  evaluate(d.anchor, d.end, { fromDrag: true });
}
grid.addEventListener("pointerup", endDrag);
grid.addEventListener("pointercancel", endDrag);
// Should pointer capture be refused (older WebKit), a finger lifted off
// the sheet still ends the drag instead of leaving a gold capsule behind.
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

// keyboard: arrows move, Enter/Space taps
grid.addEventListener("keydown", (e) => {
  if (!puzzle || busy) return;
  const n = puzzle.n;
  const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
  if (moves[e.key]) {
    e.preventDefault();
    const [dr, dc] = moves[e.key];
    setCursor({ row: Math.max(0, Math.min(n - 1, cursor.row + dr)), col: Math.max(0, Math.min(n - 1, cursor.col + dc)) });
    return;
  }
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tapCell({ ...cursor }); }
});

// ----------------------------------------------------------------------
// hint — through the ads shim, so a rewarded ad can gate it one day
// ----------------------------------------------------------------------
hintBtn.addEventListener("click", () => {
  if (busy || !puzzle) return;
  const h = hintFor(puzzle, foundWords(), lastHint);
  if (!h) { setStatus("noHint"); return; }
  ads.requestRewardedHint().then((answer) => {
    if (answer !== "granted" || busy || !puzzle) return;
    hints += 1;
    lastHint = h.word;
    for (const el of grid.querySelectorAll(".is-hint")) el.classList.remove("is-hint");
    for (const el of wordsEl.querySelectorAll(".is-hint")) el.classList.remove("is-hint");
    const cell = cellEl(h.row, h.col);
    void cell.offsetWidth;
    cell.classList.add("is-hint");
    const chip = chipFor(h.word);
    if (chip) { void chip.offsetWidth; chip.classList.add("is-hint"); }
    audio.playHint();
    setStatus("hintShown", { word: h.word, letter: h.letter });
    save();
    exposeDebug();
  });
});

// ----------------------------------------------------------------------
// new puzzle / today's puzzle
// ----------------------------------------------------------------------
function inProgress() { return puzzle && found.length > 0 && !isComplete(puzzle, foundWords()); }

function askOrDo(action) {
  if (inProgress()) { pending = action; confirmModal.dataset.open = "true"; confirmYes.focus(); return; }
  action();
}
newBtn.addEventListener("click", () => askOrDo(startRandom));
todayBtn.addEventListener("click", () => {
  const today = dailySeed();
  if (puzzle && puzzle.daily && puzzle.seed === today) {
    setStatus(isComplete(puzzle, foundWords()) ? "todayDone" : "todayLive");
    return;
  }
  askOrDo(startToday);
});
confirmYes.addEventListener("click", () => {
  confirmModal.dataset.open = "false";
  const action = pending;
  pending = null;
  ads.showInterstitial("new_game").then(() => { if (action) action(); });
});
confirmNo.addEventListener("click", () => { confirmModal.dataset.open = "false"; newBtn.focus({ preventScroll: true }); });

function startRandom() {
  newPuzzle({ seed: randomSeed() });
  setStatus("newReady");
}
function startToday() {
  const seed = dailySeed();
  if (stats.dailySolved.includes(seed)) {
    // Already solved today: show it solved, no new game. The puzzle that
    // was on the sheet has been put away (the confirm said so), so its
    // save goes too — otherwise a reload would bring it back.
    loadPuzzle(generate({ seed, size: resolveSize(), directions: settings.directions }), null, 0, { solved: true });
    store.clearGame();
    setStatus("todayDone");
    return;
  }
  newPuzzle({ seed });
  setStatus("start");
}

/** A fresh puzzle on the table — the one moment game_start fires. */
function newPuzzle({ seed }) {
  const size = resolveSize();
  const wantedLarge = (settings.size === "large") && size !== "large";
  const p = generate({ seed, size, directions: settings.directions });
  loadPuzzle(p, [], 0);
  const today = dailySeed();
  stats.played += 1;
  if (stats.lastDay !== today) { stats.lastDay = today; stats.daysPlayed += 1; }
  store.saveStats(stats);
  store.saveGame(puzzle, found, hints);
  trackEvent("game_start", { size: p.size, directions: p.directions, daily: p.daily, theme: p.themeName });
  audio.playNew();
  if (wantedLarge) toast(t("largeNeedsRoom"));
  ads.preloadInterstitial();
}

/** Put a puzzle on the sheet: fresh, restored, or (solved) to look at. */
function loadPuzzle(p, foundList, hintCount, { solved = false } = {}) {
  puzzle = p;
  found = foundList ? foundList.slice() : [];
  if (solved) found = p.words.map((w) => { const e = endOf(w); return { word: w.word, r1: w.row, c1: w.col, r2: e.row, c2: e.col }; });
  hints = hintCount;
  lastHint = null;
  tapAnchor = null;
  drag = null;
  busy = false;
  if (liveCap) { liveCap.remove(); liveCap = null; }
  winModal.dataset.open = "false";
  buildGrid();
  buildWords();
  render();
  hintBtn.disabled = solved;
}

// ----------------------------------------------------------------------
// the win: the sheet already shows every word; a pause; then the modal
// ----------------------------------------------------------------------
function onWin() {
  busy = true;
  stats.solved += 1;
  if (puzzle.daily && !stats.dailySolved.includes(puzzle.seed)) stats.dailySolved.push(puzzle.seed);
  store.saveStats(stats);
  store.clearGame();
  trackEvent("game_win", { size: puzzle.size, directions: puzzle.directions, daily: puzzle.daily, theme: puzzle.themeName, hints });
  audio.playWin();
  setStatus("won");
  hintBtn.disabled = true;
  renderWinNote();
  const todayDone = stats.dailySolved.includes(dailySeed());
  winToday.hidden = todayDone;
  const wait = reduceMotion ? 200 : 600;
  setTimeout(() => {
    ads.showInterstitial("game_over").then(() => {
      if (!busy) return; // a new puzzle was started meanwhile
      winModal.dataset.open = "true";
      winAgain.focus();
    });
  }, wait);
}
function renderWinNote() {
  if (!puzzle) return;
  winNote.textContent = t("winNote", { n: puzzle.words.length, theme: t(puzzle.theme) })
    + (stats.solved > 1 ? " " + t("solvedCount", { n: stats.solved }) : "");
}
winAgain.addEventListener("click", () => { winModal.dataset.open = "false"; startRandom(); });
winToday.addEventListener("click", () => { winModal.dataset.open = "false"; startToday(); });
winClose.addEventListener("click", () => { winModal.dataset.open = "false"; newBtn.focus({ preventScroll: true }); });

// ----------------------------------------------------------------------
// settings
// ----------------------------------------------------------------------
const sizeRadios = document.querySelectorAll('input[name="ws-size"]');
const dirsRadios = document.querySelectorAll('input[name="ws-dirs"]');
const caseRadios = document.querySelectorAll('input[name="ws-case"]');
const soundToggle = $("ws-toggle-sound");
const largeLabel = $("ws-size-large-label");
const sizeNote = $("ws-size-note");

function fillStats() {
  $("ws-stat-solved").textContent = stats.solved;
  $("ws-stat-days").textContent = stats.daysPlayed;
  $("ws-stat-daily").textContent = stats.dailySolved.length;
}
function fillSettings() {
  const size = settings.size || (narrowScreen() ? "small" : "medium");
  sizeRadios.forEach((r) => { r.checked = r.value === size; });
  dirsRadios.forEach((r) => { r.checked = r.value === settings.directions; });
  caseRadios.forEach((r) => { r.checked = r.value === settings.letters; });
  soundToggle.checked = settings.sound;
  updateSizeAvailability();
}
function updateSizeAvailability() {
  const fits = largeFits();
  const large = [...sizeRadios].find((r) => r.value === "large");
  if (!large) return;
  large.disabled = !fits;
  largeLabel.classList.toggle("is-unavailable", !fits);
  sizeNote.dataset.i18n = fits ? "sizeNote" : "sizeNoteNoLarge";
  sizeNote.textContent = t(sizeNote.dataset.i18n);
}
function openSettings() {
  fillStats();
  fillSettings();
  settingsPanel.dataset.open = "true";
  settingsClose.focus({ preventScroll: true });
}
function closeSettings() {
  settingsPanel.dataset.open = "false";
  // preventScroll: on a phone the toolbar is below the sheet, and focusing
  // it would scroll the letters off the top of the screen.
  settingsBtn.focus({ preventScroll: true });
}
settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsPanel.addEventListener("click", (e) => { if (e.target === settingsPanel) closeSettings(); });

/** Nothing found yet: remake the same puzzle number under the new rule,
 *  so the change is visible at once instead of "on your next puzzle". */
function remakeIfUntouched() {
  if (!puzzle || found.length > 0 || hints > 0 || busy) return;
  const p = generate({ seed: puzzle.seed, size: resolveSize(), directions: settings.directions });
  loadPuzzle(p, [], 0);
  store.saveGame(puzzle, found, hints);
  setStatus("start");
}
sizeRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings.size = r.value;
  store.saveSettings(settings);
  remakeIfUntouched();
}));
dirsRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings.directions = r.value;
  store.saveSettings(settings);
  remakeIfUntouched();
  renderGoal();
}));
caseRadios.forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  settings.letters = r.value;
  store.saveSettings(settings);
  renderCase();
}));
soundToggle.addEventListener("change", () => {
  settings.sound = soundToggle.checked;
  audio.setSoundEnabled(settings.sound);
  store.saveSettings(settings);
  if (settings.sound) audio.playPick();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (winModal.dataset.open === "true") { winModal.dataset.open = "false"; return; }
  if (confirmModal.dataset.open === "true") { confirmModal.dataset.open = "false"; pending = null; return; }
  if (settingsPanel.dataset.open === "true") closeSettings();
  else if (tapAnchor) { clearAnchor(); setStatus("unpicked"); }
});

// ----------------------------------------------------------------------
// language
// ----------------------------------------------------------------------
i18n.applyStatic();
i18n.renderPicker(langGrid);
i18n.onChange(() => {
  rerender();
  renderWinNote();
  refreshStatus();
  // Label widths change with the language: the sheet may have moved.
  requestAnimationFrame(relayout);
});

// ----------------------------------------------------------------------
// boot
// ----------------------------------------------------------------------
measure();
let lastW = board.clientWidth, lastH = window.innerHeight;
function relayout() {
  measure();
  if (puzzle) {
    renderCaps();
    if (liveCap && tapAnchor) placeCap(liveCap, tapAnchor.row, tapAnchor.col, tapAnchor.row, tapAnchor.col);
    exposeDebug();
  }
}
new ResizeObserver(() => {
  const w = board.clientWidth, h = window.innerHeight;
  if (w === lastW && h === lastH) return;
  lastW = w; lastH = h;
  relayout();
}).observe(board);
window.addEventListener("orientationchange", () => setTimeout(relayout, 60));
window.addEventListener("resize", () => { if (window.innerHeight !== lastH) { lastH = window.innerHeight; relayout(); } });
// After fonts settle the measured width can shift by a pixel or two.
requestAnimationFrame(() => requestAnimationFrame(relayout));

const saved = store.loadGame();
if (saved && !isComplete(saved.puzzle, saved.found.map((f) => f.word))) {
  loadPuzzle(saved.puzzle, saved.found, saved.hints);
  setStatus("start");
  toast(t("restored"));
} else if (stats.dailySolved.includes(dailySeed())) {
  startRandom();
} else {
  newPuzzle({ seed: dailySeed() });
  setStatus("start");
}
