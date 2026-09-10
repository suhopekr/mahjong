// main.js — wiring: canvas, input, the frame loop, campaign and matches.
//
// THE FIRST SCREEN IS THE BOARD — and since the campaign pivot, the
// board is never empty twice: the player boots into their current
// stage, a situation with furniture on it and a one-line goal. The
// first playtest's verdict on plain matches ("one match, no wish for
// another — every frame the same, no reason to win") is the reason the
// campaign is the main mode and matches are the bosses at chapter ends.
//
// Rules of the room, inherited from the series:
// - Every rule arrives as a one-line card WHEN IT HAPPENS, never a manual.
// - The result card's primary button is the next thing to do, one tap.
// - Accent color on exactly one button per screen (test/copy.test.js).

import * as P from "./game/physics.js";
import * as R from "./game/rules.js";
import * as AI from "./game/ai.js";
import {
  STAGES,
  CHAPTERS,
  LAST_STAGE_ID,
  stageById,
  stagesInChapter,
  isChapterEnd,
  createStageWorld,
  judgeGoal,
  goalText,
  starsFor,
} from "./game/stages.js";
import { computeLayout } from "./game/layout.js";
import { draw, invalidateTable } from "./game/render.js";
import { attachPointerHandlers } from "./core/input.js";
import {
  storageSynced,
  getAiLevel,
  setAiLevel,
  getRecentResults,
  recordMatch,
  recordHanger,
  getStats,
  hasSeenBriefing,
  markBriefingSeen,
  getStageStars,
  recordStageClear,
  getCurrentStageId,
  setCurrentStageId,
  isBossBeaten,
  recordBossBeaten,
  getPreviewsHeld,
  setPreviewsHeld,
} from "./core/storage.js";
import { onGameOver, notifyGameplayStart, notifyGameplayStop, notifyLoadingStart, notifyLoadingStop, requestRewardedHint } from "./core/ads.js";
import { previewShot } from "./game/preview.js";
import {
  unlockAudio,
  isSoundEnabled,
  toggleSound,
  playImpactSound,
  playFlickSound,
  playFallSound,
  playWinSound,
  playLoseSound,
  playButtonSound,
  playComboSound,
  playAchievementSound,
} from "./core/audio.js";

// --- site analytics (easymahjongsolitaire.com) ---------------------------
//
// Same shape as the site's other games: check that gtag actually exists
// before calling, and swallow anything that throws. An ad blocker, a
// blocked tag script, or a consent tool can all leave window.gtag
// undefined — none of which may affect the game. game_name is added here
// so this game's game_start/game_win never merge with another page's.
function trackEvent(name, params) {
  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, { game_name: "shuffleboard", ...params });
    }
  } catch {
    // Measurement failures are never allowed to reach the player.
  }
}

/**
 * Every link that leaves for another game on this site.
 *
 * There used to be exactly one — "More free games →" at the bottom of the ⋯
 * menu — and it was wired by id. The top bar replaced it with a wordmark and
 * a panel of game cards (DESIGN.md "Site navigation"), so this is
 * game.js's wireCrossGameLinks() copied verbatim in shape: the LINK carries
 * where it goes (data-crossgame-to) and where it was pressed
 * (data-placement), which is what lets this function never list a game.
 * tools/sync-games.mjs writes those attributes from games.json.
 *
 * Navigation is never delayed to wait on delivery — GA4 sends via
 * sendBeacon, and making someone wait on measurement is the wrong trade.
 */
function wireCrossGameLinks() {
  for (const a of document.querySelectorAll("a[data-crossgame-to]")) {
    a.addEventListener("click", () => {
      trackEvent("cross_game_click", {
        from: "shuffleboard",
        to: a.dataset.crossgameTo,
        placement: a.dataset.placement || "unknown",
      });
    });
  }
}

// The bar personas. The ladder starts at the bottom on purpose: Daily
// Five gave every newcomer its hardest AI and they lost in seven moves.
const LEVEL_NAMES = { easy: "Rookie", medium: "Regular", hard: "Shark" };

const YOU = 0;
const THEM = 1;

// --- DOM -------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const canvas = $("board");
const ctx = canvas.getContext("2d");
const stage = $("stage");

// --- state -----------------------------------------------------------------

let layout = null;
let dpr = 1;
let world = P.createWorld();
/**
 * What is being played right now.
 * stage: { kind:"stage", stage, enemyIds, used }
 * match: { kind:"match", boss: chapterId|null } — boss matches are the
 *   campaign's chapter ends; boss:null is the free practice match.
 */
let session = null;
let match = R.createMatch(YOU);
let mode = "aim"; // aim | dragging | sliding | aiThink | aiAim | score | sweep | result
let aim = { y: P.BOARD_WIDTH / 2, angle: 0, power: 0, lastPower: null, owner: YOU, active: false };
let aiGhost = null;
let counted = [];
let foulFade = {};
let pressPt = null;
let firstGestureDone = false;
let playedAtAll = false;
let primaryAction = null; // what the result card's accent button does
let secondaryAction = null;
let tertiaryAction = null;
let effects = []; // knock-off pops: { x, y, owner, t (seconds) }
let scoreFx = null; // "+N" floater: { points, x, y, owner, t }
let sweepStart = null; // performance.now() when the sweep began
let scoreTween = null; // { el, from, to, t } header score counting up
let clockT = 0; // seconds since boot, for idle pulses
// Rewarded preview gating — Four Ball's four gates, kept whole: offered
// only after three straight failures on ONE stage, never while one is
// held, on a two-minute cooldown, and abandoned for the session after
// two unfilled requests in a row (during Basic Launch review every
// request comes back unfilled; keep advertising an ungrantable reward
// and the reviewer sees the game at its worst).
let stageFails = {}; // stage id -> consecutive failed attempts this session
let lastAdOfferAt = -Infinity;
let unfilledStreak = 0;
let adBusy = false;
let previewCache = null; // { key, result } for the aimed shot

// --- layout / canvas sizing ------------------------------------------------

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  dpr = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  layout = computeLayout(w, h);
  invalidateTable();
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);
resize();

/**
 * THE SITE BAR TAKES A REAL ROW, SO IT COMES OFF WHILE THE BOARD IS LIVE.
 *
 * DESIGN.md §6. Two reasons: the board's geometry is measured in JS from
 * #stage's live box, and a permanent band along the top edge of a surface
 * you drag a weight on is a mis-tap generator.
 *
 * The remeasure is the whole reason this is a function rather than one line
 * at each call site. body[data-nav] changes #app's height by 56px, and
 * resize() sizes the canvas AND computes the layout the hit test uses from
 * #stage's rect — a board measured before the row has gone (or come back)
 * keeps the old height, and then where the finger grabs and where the weight
 * is drawn disagree by that much. window's resize event does not fire for a
 * layout change inside the page, so nothing else would ever correct it. So:
 * toggle, then remeasure in the same turn, before the next frame paints.
 *
 * WHEN IT IS ON SCREEN, for a game whose first screen IS the board: the
 * front of this game is its cards, so the bar belongs to the home card, the
 * stage picker, and the arrival screen up to the player's first shot —
 * nowhere else. In particular NOT on the stage-clear card, which arrives
 * every couple of minutes; the board growing and shrinking around every
 * result would be worse than the bar being two taps away in ⋯.
 */
function setNavHidden(hidden) {
  if ((document.body.dataset.nav === "hidden") === hidden) return;
  if (hidden) document.body.dataset.nav = "hidden";
  else delete document.body.dataset.nav;
  resize();
}

// --- header ----------------------------------------------------------------

function pips(el, remaining, total) {
  el.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("i");
    if (i >= remaining) dot.className = "spent";
    el.appendChild(dot);
  }
}

function updateHeader() {
  if (session?.kind === "stage") {
    const st = session.stage;
    // The whole opponent side leaves during stages: a goal line needs
    // the width (on 390px it was wrapping into the menu button), and
    // there is no opponent shooting anyway.
    $("side-them").hidden = true;
    $("score-you").textContent = "";
    $("frame-no").textContent = `STAGE ${st.id} · ${goalText(st).toUpperCase()}`;
    pips($("pips-you"), st.budget - session.used, st.budget);
  } else {
    $("side-them").hidden = false;
    $("score-you").textContent = match.scores[YOU];
    $("score-them").textContent = match.scores[THEM];
    $("frame-no").textContent = `FRAME ${match.frame}`;
    $("them-name").textContent = session?.twoPlayer ? "Blue" : LEVEL_NAMES[matchLevelId()];
    document.querySelector(".side.you .name").textContent = session?.twoPlayer ? "Red" : "You";
    document.querySelector(".side.you").classList.toggle("turn", !match.over && match.shooter === YOU);
    document.querySelector(".side.them").classList.toggle("turn", !match.over && match.shooter === THEM);
    pips($("pips-you"), R.PUCKS_PER_SIDE - match.shot[YOU], R.PUCKS_PER_SIDE);
    pips($("pips-them"), R.PUCKS_PER_SIDE - match.shot[THEM], R.PUCKS_PER_SIDE);
  }
}

function matchLevelId() {
  if (session?.kind === "match" && session.boss !== null) {
    return CHAPTERS.find((c) => c.id === session.boss).boss;
  }
  return getAiLevel();
}

// --- one-line cards --------------------------------------------------------

let noteTimer = null;
function note(text, ms = 2800) {
  const el = $("note");
  el.textContent = text;
  el.hidden = false;
  el.style.opacity = "1";
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => {
      el.hidden = true;
    }, 260);
  }, ms);
}

/** A card that appears once ever, at the moment its rule first matters. */
function teach(id, text) {
  if (hasSeenBriefing(id)) return;
  markBriefingSeen(id);
  note(text, 3400);
}

// --- result card -----------------------------------------------------------

function showResult({ title, stars = null, final = "", line = "", primary, onPrimary, secondary = null, onSecondary = null, tertiary = null, onTertiary = null }) {
  mode = "result";
  $("result-title").textContent = title;
  const starsEl = $("result-stars");
  if (stars === null) starsEl.hidden = true;
  else {
    starsEl.hidden = false;
    starsEl.textContent = "★★★".slice(0, stars) + "☆☆☆".slice(0, 3 - stars);
  }
  const finalEl = $("result-final");
  finalEl.hidden = final === "";
  finalEl.textContent = final;
  $("result-line").textContent = line;
  $("btn-primary").textContent = primary;
  primaryAction = onPrimary;
  const sec = $("btn-secondary");
  sec.hidden = secondary === null;
  sec.textContent = secondary ?? "";
  secondaryAction = onSecondary;
  const ter = $("btn-tertiary");
  ter.hidden = tertiary === null;
  ter.textContent = tertiary ?? "";
  tertiaryAction = onTertiary;
  $("result-card").hidden = false;
}

function hideResult() {
  $("result-card").hidden = true;
}

$("btn-primary").addEventListener("click", () => {
  playButtonSound();
  hideResult();
  if (primaryAction) primaryAction();
});
$("btn-secondary").addEventListener("click", () => {
  playButtonSound();
  hideResult();
  if (secondaryAction) secondaryAction();
});
$("btn-tertiary").addEventListener("click", () => {
  playButtonSound();
  hideResult();
  if (tertiaryAction) tertiaryAction();
});

// --- entering play ---------------------------------------------------------

function startStage(id, { quiet = false } = {}) {
  const st = stageById(id);
  if (!st) {
    startMatch(null);
    return;
  }
  if (!stageUnlocked(st)) {
    // A synced save or an old continue point can ask for a locked stage
    // (e.g. current advanced past a chapter whose boss is unbeaten).
    resumeCampaign();
    return;
  }
  const built = createStageWorld(st);
  world = built.world;
  session = { kind: "stage", stage: st, enemyIds: built.enemyIds, used: 0 };
  counted = [];
  foulFade = {};
  aim = { ...aim, y: P.BOARD_WIDTH / 2, angle: 0, power: 0, active: false };
  mode = "aim";
  $("frame-live").textContent = "";
  setCurrentStageId(st.id);
  if (!quiet) setNavHidden(true);
  if (!quiet) trackEvent("game_start", { mode: "stage", stage: st.id });
  updateHeader();
  if (!quiet) note(st.hint, 3200);
}

function startMatch(bossChapter, { twoPlayer = false, quiet = false } = {}) {
  $("frame-live").textContent = "";
  world = P.createWorld();
  match = R.createMatch(YOU);
  session = { kind: "match", boss: bossChapter, twoPlayer };
  if (!quiet) setNavHidden(true);
  if (!quiet) trackEvent("game_start", { mode: twoPlayer ? "two_player" : bossChapter !== null ? "boss" : "match", chapter: bossChapter ?? undefined });
  counted = [];
  foulFade = {};
  aim = { ...aim, y: P.BOARD_WIDTH / 2, angle: 0, power: 0, active: false };
  mode = "aim";
  updateHeader();
  if (bossChapter !== null) {
    note(`The ${LEVEL_NAMES[CHAPTERS.find((c) => c.id === bossChapter).boss]} racks up — first to ${R.TARGET_SCORE}.`, 2600);
  }
}

function bossIntro(chapter) {
  const persona = LEVEL_NAMES[CHAPTERS.find((c) => c.id === chapter).boss];
  showResult({
    title: `Chapter ${chapter} boss`,
    line: `Beat the ${persona} in a real match — first to ${R.TARGET_SCORE} takes the table.`,
    primary: `Play the ${persona}`,
    onPrimary: () => startMatch(chapter),
  });
}

// --- campaign map ----------------------------------------------------------

function chapterUnlocked(chapterId) {
  return chapterId === 1 || isBossBeaten(chapterId - 1);
}

function stageUnlocked(st) {
  if (!chapterUnlocked(st.chapter)) return false;
  const peers = stagesInChapter(st.chapter);
  const idx = peers.findIndex((p) => p.id === st.id);
  return idx === 0 || getStageStars(peers[idx - 1].id) > 0;
}

function bossUnlocked(chapterId) {
  return (
    chapterUnlocked(chapterId) &&
    stagesInChapter(chapterId).every((st) => getStageStars(st.id) > 0)
  );
}

/** What the campaign wants next, as a value — the home screen and the
 * boot path both read it. */
function resumeTarget() {
  for (const ch of CHAPTERS) {
    if (!chapterUnlocked(ch.id)) break;
    for (const st of stagesInChapter(ch.id)) {
      if (getStageStars(st.id) === 0) return { kind: "stage", id: st.id };
    }
    if (!isBossBeaten(ch.id)) return { kind: "boss", chapter: ch.id };
  }
  return { kind: "free" };
}

function resumeCampaign({ quiet = false } = {}) {
  const t = resumeTarget();
  if (t.kind === "stage") startStage(t.id, { quiet });
  else if (t.kind === "boss") bossIntro(t.chapter);
  else startMatch(null, { quiet });
}

/**
 * The home gate, Four Ball's screen-flow rules applied: one screen, one
 * primary whose words change but whose position never does; the board
 * stays visible behind it. Shown to RETURNING players only — a first
 * visit boots straight onto stage 1, because the gate is one tap of
 * conversion a brand-new player should not pay.
 */
function showHome() {
  const t = resumeTarget();
  // Put the board of the next thing behind the card, quietly.
  if (t.kind === "stage") startStage(t.id, { quiet: true });
  else if (session === null) startMatch(null, { quiet: true });
  const totalStars = STAGES.reduce((a, s) => a + getStageStars(s.id), 0);
  const ch = t.kind === "stage" ? stageById(t.id).chapter : t.kind === "boss" ? t.chapter : CHAPTERS.length;
  const chName = CHAPTERS.find((c) => c.id === ch).name;
  const primary =
    t.kind === "stage"
      ? totalStars === 0 && t.id === 1
        ? "Play"
        : `Continue — Stage ${t.id}`
      : t.kind === "boss"
        ? `Boss: the ${LEVEL_NAMES[CHAPTERS.find((c) => c.id === t.chapter).boss]}`
        : "Free play";
  showResult({
    title: "Tavern Shuffleboard",
    line: totalStars === 0 ? "The bar game of sliding weights." : `★ ${totalStars}/${LAST_STAGE_ID * 3} · Chapter ${ch} — ${chName}`,
    primary,
    onPrimary: () => {
      if (t.kind === "stage") {
        // The board behind the card was started quietly, so there is no
        // startStage() here to take the bar's row away — this branch has to
        // do it itself, and setNavHidden() remeasures in the same turn.
        setNavHidden(true);
        mode = "aim";
        note(stageById(t.id).hint, 3200);
      } else if (t.kind === "boss") startMatch(t.chapter);
      else startMatch(null);
    },
    secondary: "Stages",
    onSecondary: () => openStagePicker(),
    tertiary: "Practice match",
    onTertiary: () => startMatch(null),
  });
  mode = "result";
  // The home card IS this game's home screen — last, because the quiet
  // startStage above has just hidden the bar for the board behind it.
  setNavHidden(false);
}

function openStagePicker() {
  const list = $("stages-list");
  list.innerHTML = "";
  for (const ch of CHAPTERS) {
    const h = document.createElement("h3");
    h.textContent = `Chapter ${ch.id} — ${ch.name}`;
    list.appendChild(h);
    const row = document.createElement("div");
    row.className = "chip-row";
    for (const st of stagesInChapter(ch.id)) {
      const chip = document.createElement("button");
      const stars = getStageStars(st.id);
      const open = stageUnlocked(st);
      chip.className = "chip" + (open ? "" : " locked");
      chip.innerHTML = `<span>${st.id}</span><span class="st">${stars > 0 ? "★★★".slice(0, stars) : open ? "·" : ""}</span>`;
      if (open) {
        chip.addEventListener("click", () => {
          playButtonSound();
          $("stages-card").hidden = true;
          hideResult();
          startStage(st.id);
        });
      }
      row.appendChild(chip);
    }
    const boss = document.createElement("button");
    const beaten = isBossBeaten(ch.id);
    const openBoss = bossUnlocked(ch.id);
    boss.className = "chip boss" + (beaten ? " beaten" : "") + (openBoss || beaten ? "" : " locked");
    const persona = LEVEL_NAMES[ch.boss];
    boss.innerHTML = `<span>${persona}</span><span class="st">${beaten ? "beaten" : openBoss ? "boss match" : ""}</span>`;
    if (openBoss || beaten) {
      boss.addEventListener("click", () => {
        playButtonSound();
        $("stages-card").hidden = true;
        hideResult();
        startMatch(ch.id);
      });
    }
    row.appendChild(boss);
    list.appendChild(row);
  }
  $("stages-card").hidden = false;
  setNavHidden(false);
}

// The picker closes like the menu: any tap on the board dismisses it.
function closePicker() {
  $("stages-card").hidden = true;
  // Dismissing the picker without choosing puts the board back in front,
  // unless the home card is what is under it.
  setNavHidden($("result-card").hidden);
}

// --- aim input -------------------------------------------------------------

/** Drag length (metres of screen travel) for full power. */
const MAX_DRAG_M = 0.9;

attachPointerHandlers(canvas, {
  onDown(pos) {
    if (!firstGestureDone) {
      firstGestureDone = true;
      unlockAudio();
      $("first-card").hidden = true;
      markBriefingSeen("first-shot");
    }
    closeMenu();
    closePicker();
    const human = session?.twoPlayer ? true : currentShooter() === YOU;
    if (mode !== "aim" || !human) return;
    pressPt = pos;
    const b = layout.toBoard(pos.x, pos.y);
    aim.y = P.clamp(b.y, P.MIN_START_Y, P.MAX_START_Y);
    aim.angle = 0;
    aim.power = 0;
    aim.active = true;
    mode = "dragging";
  },
  onMove(pos) {
    if (mode !== "dragging" || !pressPt) return;
    const d = layout.forward(pos.x - pressPt.x, pos.y - pressPt.y);
    let along = d.along;
    let across = d.across;
    // Hands arrive trained by pool games: a backward drag is the same
    // shot through the slingshot mirror — no dead gesture.
    if (along < 0) {
      along = -along;
      across = -across;
    }
    if (along <= 0.005) {
      aim.power = 0;
      return;
    }
    aim.angle = P.clamp(Math.atan2(across, along), -P.MAX_AIM_ANGLE, P.MAX_AIM_ANGLE);
    aim.power = P.clamp(Math.hypot(along, across) / MAX_DRAG_M, 0, 1);
  },
  onUp() {
    if (mode !== "dragging") return;
    pressPt = null;
    aim.active = false;
    if (aim.power < 0.05) {
      mode = "aim";
      aim.power = 0;
      return;
    }
    fire(session?.twoPlayer ? currentShooter() : YOU, aim.y, aim.angle, aim.power);
    aim.lastPower = aim.power;
    markBriefingSeen("first-drag");
  },
  onCancel() {
    if (mode === "dragging") {
      mode = "aim";
      aim.active = false;
      aim.power = 0;
      pressPt = null;
    }
  },
});

function currentShooter() {
  return session?.kind === "match" ? match.shooter : YOU;
}

// --- shooting and the turn loop -------------------------------------------

function fire(owner, y, angle, power) {
  if (!playedAtAll) {
    playedAtAll = true;
    notifyGameplayStart();
  }
  // A shot is the board going live, whatever card the player arrived on.
  setNavHidden(true);
  $("frame-live").textContent = "";
  if (owner === YOU && !session?.twoPlayer && getPreviewsHeld() > 0 && aim.preview) {
    setPreviewsHeld(0); // spent on the shot it informed
  }
  aim.preview = null;
  previewCache = null;
  P.shoot(world, owner, y, angle, power);
  if (session?.kind === "stage" && owner === YOU) {
    session.used++;
    updateHeader();
  }
  playFlickSound(power);
  mode = "sliding";
}

function aiTurn() {
  mode = "aiThink";
  setTimeout(() => {
    const level = AI.LEVELS[matchLevelId()];
    const { shot } = AI.chooseShot(world, THEM, level, Math.random);
    aiGhost = { ...shot, owner: THEM, active: true, lastPower: null };
    mode = "aiAim";
    setTimeout(() => {
      aiGhost = null;
      fire(THEM, shot.y, shot.angle, shot.power);
    }, 620);
  }, 420);
}

function afterRest() {
  const fouls = P.removeFouls(world);
  if (fouls.length > 0) {
    for (const p of fouls) foulFade[p.id] = 1;
    if (fouls.some((p) => p.owner === YOU)) {
      teach("first-foul", "Short of the line — a weight must clear it to stay on.");
    }
  }
  if (session?.kind === "stage") afterStageShot();
  else afterMatchShot();
}

// --- stage flow ------------------------------------------------------------

function afterStageShot() {
  const { stage: st, enemyIds, used } = session;
  if (judgeGoal(st, world, enemyIds)) {
    stageCleared();
    return;
  }
  if (used >= st.budget) {
    stageFailed();
    return;
  }
  mode = "aim";
  aim.power = 0;
}

function stageCleared() {
  mode = "score";
  const st = session.stage;
  stageFails[st.id] = 0;
  const stars = starsFor(session.used, st.par);
  recordStageClear(st.id, stars);
  trackEvent("game_win", { mode: "stage", stage: st.id, stars, shots: session.used });
  if (st.goal.type === "hanger") recordHanger();
  playComboSound(1 + stars);
  if (stars === 3) playAchievementSound();
  // Let the final board sit for a beat before the card covers it.
  setTimeout(() => {
    const chapterDone = isChapterEnd(st);
    const next = stageById(st.id + 1);
    showResult({
      title: st.name,
      stars,
      line: stars === 3 ? "Clean." : `Par is ${st.par} — worth another go.`,
      primary: chapterDone ? "The boss is waiting" : "Next stage",
      onPrimary: chapterDone ? () => bossIntro(st.chapter) : () => startStage(next ? next.id : st.id),
      secondary: "Replay",
      onSecondary: () => startStage(st.id),
    });
    onGameOver(); // ads count CLEARS, never failed attempts
  }, 900);
}

function stageFailed() {
  mode = "score";
  const st = session.stage;
  stageFails[st.id] = (stageFails[st.id] ?? 0) + 1;
  const offerAd =
    stageFails[st.id] >= 3 &&
    getPreviewsHeld() === 0 &&
    unfilledStreak < 2 &&
    performance.now() - lastAdOfferAt > 120 * 1000;
  setTimeout(() => {
    showResult({
      title: "Not this time",
      line: goalText(st) + ".",
      primary: "Try again",
      onPrimary: () => startStage(st.id),
      secondary: offerAd ? "Free preview · see where your shot stops" : null,
      onSecondary: offerAd ? () => claimPreview(st.id) : null,
    });
  }, 700);
}

async function claimPreview(stageId) {
  if (adBusy) return;
  adBusy = true;
  lastAdOfferAt = performance.now();
  const outcome = await requestRewardedHint();
  adBusy = false;
  if (outcome === "granted") {
    unfilledStreak = 0;
    setPreviewsHeld(1);
    note("Preview armed — while you aim, it shows where the shot stops.", 3600);
  } else if (outcome === "unfilled") {
    unfilledStreak++;
    note("No ad available right now.", 2400);
  }
  // "skipped" is a decision, not a failure: no counter moves.
  startStage(stageId);
}

// --- match flow ------------------------------------------------------------

/** "If the frame ended now": the line that gives every mid-frame shot a
 * visible stake. Daily diagnosis ①: the scoring was opaque until the
 * frame-end toast, so shots felt consequence-free. */
function updateLiveScore() {
  const el = $("frame-live");
  if (session?.kind !== "match" || !P.isAtRest(world)) {
    el.textContent = "";
    return;
  }
  const r = R.scoreFrame(world);
  if (r.winner === null || r.points === 0) {
    el.textContent = P.livePucks(world).length ? "board is even" : "";
    return;
  }
  const names = session?.twoPlayer
    ? ["Red would take", "Blue would take"]
    : ["you'd take", `${LEVEL_NAMES[matchLevelId()]} would take`];
  el.textContent = `${names[r.winner]} +${r.points}`;
  el.style.color = r.winner === YOU ? "var(--accent)" : "var(--blue-dim, #8fb3f0)";
}

function afterMatchShot() {
  const next = R.recordShot(match);
  updateHeader();
  updateLiveScore();
  if (R.frameComplete(match)) {
    scoreSequence();
  } else if (session.twoPlayer || next === YOU) {
    mode = "aim";
    aim.power = 0;
    aim.owner = session.twoPlayer ? match.shooter : YOU;
  } else {
    aiTurn();
  }
}

function scoreSequence() {
  mode = "score";
  const result = R.scoreFrame(world);
  counted = result.counted;
  const hangers = P.livePucks(world).filter((p) => R.isHanger(p) && result.counted.includes(p.id));
  if (hangers.some((p) => p.owner === YOU)) {
    recordHanger();
    teach("first-hanger", "A hanger — over the edge but still on. That one is worth 4.");
  }
  if (result.winner !== null && result.points > 0) {
    // The "+N" rises from the weights that earned it, and the header
    // score counts up to meet it — the frame's verdict as an event, not
    // a toast.
    if (session.twoPlayer) {
      note(`${result.winner === YOU ? "Red" : "Blue"} scores +${result.points}`, 1800);
    }
    const scorers = P.livePucks(world).filter((p) => result.counted.includes(p.id));
    const cx = scorers.reduce((a, p) => a + p.x, 0) / Math.max(1, scorers.length);
    const cy = scorers.reduce((a, p) => a + p.y, 0) / Math.max(1, scorers.length);
    scoreFx = { points: result.points, x: cx, y: cy, owner: result.winner, t: 0 };
    const el = $(result.winner === YOU ? "score-you" : "score-them");
    scoreTween = { el, from: match.scores[result.winner], to: match.scores[result.winner] + result.points, t: 0 };
    if (result.winner === YOU) playComboSound(Math.min(4, result.points));
    teach("first-score", "Only the side with the farthest weight scores each frame.");
  } else {
    note("No score — nothing past the other side.", 1900);
  }
  setTimeout(() => {
    counted = [];
    R.endFrame(match, result);
    updateHeader();
    if (match.over) {
      matchOver();
    } else {
      sweep();
    }
  }, 1500);
}

function sweep() {
  mode = "sweep";
  sweepStart = performance.now();
  setTimeout(() => {
    sweepStart = null;
    world = P.createWorld();
    foulFade = {};
    updateHeader();
    updateLiveScore();
    if (session.twoPlayer || match.shooter === YOU) {
      mode = "aim";
      aim.power = 0;
      aim.owner = session.twoPlayer ? match.shooter : YOU;
    } else {
      aiTurn();
    }
  }, 460);
}

function matchOver() {
  mode = "score";
  notifyGameplayStop();
  const won = match.winner === YOU;
  const margin = Math.abs(match.scores[YOU] - match.scores[THEM]);
  const persona = LEVEL_NAMES[matchLevelId()];
  const final = `${match.scores[YOU]} – ${match.scores[THEM]}`;

  if (session.twoPlayer) {
    // Pass-and-play: no ladder, no stats — the couch keeps its own score.
    playWinSound();
    showResult({
      title: match.winner === YOU ? "Red takes the board" : "Blue takes the board",
      final,
      primary: "Rematch",
      onPrimary: () => startMatch(null, { twoPlayer: true }),
      secondary: "Home",
      onSecondary: () => showHome(),
    });
    onGameOver();
    return;
  }

  recordMatch(won ? "W" : "L", margin);
  if (won) trackEvent("game_win", { mode: session.boss !== null ? "boss" : "match", chapter: session.boss ?? undefined, margin });
  if (won) playWinSound();
  else playLoseSound();

  if (session.boss !== null) {
    const ch = session.boss;
    if (won) {
      recordBossBeaten(ch);
      const nextChapter = CHAPTERS.find((c) => c.id === ch + 1);
      const nextStage = STAGES.find((s) => s.chapter === ch + 1);
      showResult({
        title: `The ${persona} steps aside`,
        final,
        line: nextChapter ? `Chapter ${ch} cleared.` : "Campaign complete — the table is yours.",
        primary: nextChapter && nextStage ? `Chapter ${ch + 1}: ${nextChapter.name}` : "Free play",
        onPrimary: nextChapter && nextStage ? () => startStage(nextStage.id) : () => startMatch(null),
      });
      onGameOver();
    } else {
      showResult({
        title: `The ${persona} holds the table`,
        final,
        line: "Bosses reset nothing — run it back.",
        primary: "Rematch",
        onPrimary: () => startMatch(ch),
        secondary: "Back to stages",
        onSecondary: () => openStagePicker(),
      });
    }
    return;
  }

  // Practice match: the adaptive ladder applies here and only here.
  const levelBefore = getAiLevel();
  const promoted = AI.nextLevel(levelBefore, getRecentResults());
  if (promoted !== levelBefore) setAiLevel(promoted);
  const stats = getStats();
  showResult({
    title: won ? "You win the board" : `The ${persona} takes it`,
    final,
    line: `${stats.wins}/${stats.matches} won`,
    primary: "Rematch",
    onPrimary: () => startMatch(null),
    secondary: "Back to stages",
    onSecondary: () => openStagePicker(),
  });
  if (won) onGameOver();
}

// --- menu ------------------------------------------------------------------

function closeMenu() {
  $("menu").hidden = true;
}

$("menu-btn").addEventListener("click", () => {
  playButtonSound();
  const menu = $("menu");
  menu.hidden = !menu.hidden;
  $("btn-sound").textContent = `Sound: ${isSoundEnabled() ? "On" : "Off"}`;
  const cleared = STAGES.filter((s) => getStageStars(s.id) > 0).length;
  $("menu-who").textContent = `Campaign: ${cleared}/${LAST_STAGE_ID} stages`;
});

$("btn-home").addEventListener("click", () => {
  playButtonSound();
  closeMenu();
  hideResult();
  showHome();
});

$("btn-sound").addEventListener("click", () => {
  const on = toggleSound();
  $("btn-sound").textContent = `Sound: ${on ? "On" : "Off"}`;
  if (on) playButtonSound();
});

$("btn-stage").addEventListener("click", () => {
  playButtonSound();
  closeMenu();
  openStagePicker();
});

$("btn-practice").addEventListener("click", () => {
  playButtonSound();
  closeMenu();
  hideResult();
  startMatch(null);
});

$("btn-two").addEventListener("click", () => {
  playButtonSound();
  closeMenu();
  hideResult();
  startMatch(null, { twoPlayer: true });
  note("Pass and play — Red shoots first, hand it over between turns.", 3400);
});

/**
 * Games — the same panel the bar's own Games button opens. This is the last
 * item in ⋯ and the heir to the "More free games →" line that used to sit
 * there: the same destination, the whole list instead of one link.
 *
 * /nav.js owns opening, closing, the focus trap and the analytics, and its
 * public surface is the bar's own button — so this presses it rather than
 * re-implementing any of that. That button is display:none while the board
 * is live, which click() does not care about but focus does: /nav.js hands
 * focus back to #nav-games on close and a hidden element cannot take it. So
 * the one thing left to do here is catch the close and put focus back on the
 * menu item the player actually pressed.
 */
$("btn-games").addEventListener("click", () => {
  playButtonSound();
  const panel = document.getElementById("nav-panel");
  const games = document.getElementById("nav-games");
  if (!panel || !games) return;
  const back = new MutationObserver(() => {
    if (panel.dataset.open === "true") return;
    back.disconnect();
    if (!$("menu").hidden) $("btn-games").focus();
  });
  back.observe(panel, { attributes: true, attributeFilter: ["data-open"] });
  games.click();
});

// --- frame loop ------------------------------------------------------------

let lastT = performance.now();

// The gesture demo: loops until the player's first shot ever, then never
// again. A phantom drag only — nothing auto-fires.
let inviteT = 0;

function invitePhase(dt) {
  inviteT += dt;
  const cycle = 2.1;
  const t = inviteT % cycle;
  const pull = Math.min(1, t / 1.4);
  return (pull < 1 ? 0.5 - 0.5 * Math.cos(pull * Math.PI) : 0) * 0.72;
}

function frame(now) {
  const dt = Math.min(1 / 30, (now - lastT) / 1000);
  lastT = now;

  clockT += dt;
  // A held preview follows the live aim. Recomputed only when the aim
  // actually changes (a full shot sim per pointer event would chug on
  // phones), and never in pass-and-play, where it would be a house edge.
  if (mode === "dragging" && aim.power >= 0.05 && getPreviewsHeld() > 0 && !session?.twoPlayer) {
    const key = `${aim.y.toFixed(4)}|${aim.angle.toFixed(4)}|${aim.power.toFixed(3)}`;
    if (!previewCache || previewCache.key !== key) {
      previewCache = { key, result: previewShot(world, YOU, aim.y, aim.angle, aim.power) };
    }
    aim.preview = previewCache.result;
  } else if (aim.preview && mode !== "dragging") {
    aim.preview = null;
  }
  if (mode === "sliding") {
    P.stepWorld(world, dt);
    drainEvents();
    if (P.isAtRest(world)) afterRest();
  }
  for (const id of Object.keys(foulFade)) {
    foulFade[id] -= dt * 2.5;
    if (foulFade[id] <= 0) delete foulFade[id];
  }
  for (const fx of effects) fx.t += dt;
  effects = effects.filter((fx) => fx.t < 0.45);
  if (scoreFx) {
    scoreFx.t += dt;
    if (scoreFx.t > 1.3) scoreFx = null;
  }
  if (scoreTween) {
    scoreTween.t += dt / 0.8;
    const k = Math.min(1, scoreTween.t);
    scoreTween.el.textContent = Math.round(scoreTween.from + (scoreTween.to - scoreTween.from) * k);
    if (k >= 1) scoreTween = null;
  }

  const myTurn = mode === "aim" && currentShooter() === YOU;
  ctx.save();
  ctx.scale(dpr, dpr);
  draw(ctx, layout, {
    width: canvas.width / dpr,
    height: canvas.height / dpr,
    dpr,
    world,
    counted,
    foulFade,
    aim: myTurn || mode === "dragging" ? aim : mode === "aiAim" ? aiGhost : null,
    invite: myTurn && !hasSeenBriefing("first-drag") ? { power: invitePhase(dt), y: aim.y, showText: true } : null,
    time: clockT,
    restful: mode === "aim" || mode === "dragging" || mode === "score" || mode === "result",
    effects: effects.map((fx) => ({ ...fx, t01: Math.min(1, fx.t / 0.45) })),
    scoreFx: scoreFx ? { ...scoreFx, t01: Math.min(1, scoreFx.t / 1.3) } : null,
    sweep: mode === "sweep" && sweepStart !== null ? Math.min(1, (performance.now() - sweepStart) / 460) : null,
  });
  ctx.restore();
  requestAnimationFrame(frame);
}

function drainEvents() {
  for (const e of world.events) {
    if (e.type === "hit") playImpactSound(Math.min(1, e.speed / 1.6));
    else if (e.type === "off") {
      playFallSound();
      const p = world.pucks.find((q) => q.id === e.id);
      if (p) effects.push({ x: p.x, y: p.y, owner: p.owner, t: 0 });
    }
  }
  world.events.length = 0;
}

// --- boot ------------------------------------------------------------------

notifyLoadingStart();
if (hasSeenBriefing("first-shot")) showHome();
else {
  resumeCampaign();
  $("first-card").hidden = false;
}
// Whichever of those two arrival screens it is, the bar is on it: a page
// reached from an ad has to show what site it belongs to, and neither of
// them is a shot in progress. fire() takes it away again.
setNavHidden(false);
wireCrossGameLinks();
storageSynced.then(() => {
  // Inside the portal iframe the save may only exist on the SDK side.
  if (hasSeenBriefing("first-shot")) $("first-card").hidden = true;
  // Re-boot off the synced truth, but never yank a board the player has
  // already started shooting on.
  if (!playedAtAll && (session?.kind !== "stage" || session.used === 0) && mode !== "sliding") {
    hideResult();
    // Quiet: the boot above already counted this same game_start, and
    // this is the same boot rerun off the synced save, not a second game.
    if (hasSeenBriefing("first-shot")) showHome();
    else resumeCampaign({ quiet: true });
  }
  updateHeader();
});
notifyLoadingStop();
requestAnimationFrame(frame);

// --- test handle -----------------------------------------------------------
// test/browser-check.mjs drives the game through this. Not a cheat
// surface worth defending: single player, nothing competitive.
window.__sb = {
  P,
  R,
  fire,
  startStage,
  startMatch,
  openStagePicker,
  showHome,
  get world() { return world; },
  get mode() { return mode; },
  get match() { return match; },
  get session() { return session; },
  get layout() { return layout; },
  poseAim(o) {
    aim = { ...aim, ...o, active: true };
    mode = "dragging";
  },
  /** Show an exact board (store-asset shots): pucks straight from a
   * headless simulation, drawn at rest with no aim UI. */
  poseWorld(pucks) {
    world = { pucks: pucks.map((p) => ({ ...p })), nextId: 999, events: [] };
    session = null;
    mode = "score";
  },
};
