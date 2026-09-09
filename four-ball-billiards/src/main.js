// main.js
// Wiring: canvas, input, the frame loop, and the stage flow. Every rule
// lives in game/rules.js, every equation in game/physics.js, every pixel
// in game/render.js; this file only decides WHEN each of them runs.

import * as P from "./game/physics.js";
import * as LAY from "./game/layout.js";
import * as R from "./game/render.js";
import { judgeFourBall, FOUL } from "./game/rules.js";
import { STAGES, OPENING, ballsFrom, starsFor, parFor } from "./game/stages.js";
import { attachPointerHandlers } from "./core/input.js";
import { simulateShotPath } from "./game/preview.js";
import {
  getPreviewsHeld,
  setPreviewsHeld,
  recordStageCleared,
  getStars,
  isStageCleared,
  isStageUnlocked,
  isLevelUnlocked,
  getContinuePoint,
  getTotalStars,
  setLastStage,
  DIFFICULTIES,
  hasSeenBriefing,
  markBriefingsSeen,
  getTheme,
  setTheme,
  themeUnlockContext,
  getMatchSetup,
  setMatchSetup,
  getPracticeRecord,
  recordPracticeTime,
  TARGET_SCORES,
  storageSynced,
} from "./core/storage.js";
import { THEMES, isThemeUnlocked } from "./game/themes.js";
import { LEVELS, chooseShot } from "./game/ai.js";
import * as SB from "./game/scoreboard.js";
import {
  isLocalDev,
  requestRewardedHint,
  notifyGameplayStart,
  notifyGameplayStop,
  onGameOver,
  reportProgress,
  setContext,
} from "./core/ads.js";
import {
  unlockAudio,
  playImpactSound,
  playCushionSound,
  playFlickSound,
  toggleSound,
  isSoundEnabled,
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
      window.gtag("event", name, { game_name: "four_ball_billiards", ...params });
    }
  } catch {
    // Measurement failures are never allowed to reach the player.
  }
}

// The one way back to the rest of the site, on the home screen only.
// Navigation is never delayed to wait on delivery — GA4 sends via
// sendBeacon, and making someone wait on measurement is the wrong trade.
document.getElementById("link-crossgame-home")?.addEventListener("click", () => {
  trackEvent("cross_game_click", { from: "four_ball_billiards", to: "site_home", placement: "home" });
});

const canvas = document.getElementById("table");
const ctx = canvas.getContext("2d");
const el = {
  stage: document.getElementById("stage-name"),
  hint: document.getElementById("hint"),
  shots: document.getElementById("shots"),
  banner: document.getElementById("banner"),
  retry: document.getElementById("retry"),
  toStages: document.getElementById("to-stages"),
  toHome: document.getElementById("to-home"),
  sound: document.getElementById("sound"),
  status: document.getElementById("status"),
  firstrun: document.getElementById("firstrun"),
  tip: document.getElementById("tip"),
  setup: document.getElementById("setup"),
  setupTitle: document.getElementById("setup-title"),
  setupBlurb: document.getElementById("setup-blurb"),
  setupTarget: document.getElementById("setup-target"),
  setupLevelField: document.getElementById("setup-level-field"),
  setupLevel: document.getElementById("setup-level"),
  setupRecord: document.getElementById("setup-record"),
  setupStart: document.getElementById("setup-start"),
  setupBack: document.getElementById("setup-back"),
  btnVersus: document.getElementById("btn-versus"),
  runover: document.getElementById("runover"),
  runoverHead: document.getElementById("runover-head"),
  runoverTime: document.getElementById("runover-time"),
  runoverDetail: document.getElementById("runover-detail"),
  runoverAgain: document.getElementById("runover-again"),
  runoverHome: document.getElementById("runover-home"),
  cleared: document.getElementById("cleared"),
  clearedStars: document.getElementById("cleared-stars"),
  clearedKind: document.getElementById("cleared-kind"),
  btnNext: document.getElementById("btn-next"),
  mapTabs: [...document.querySelectorAll("#map-tabs .mtab")],
  restartNow: document.getElementById("restart-now"),
  btnAgain: document.getElementById("btn-again"),
  menu: document.getElementById("menu"),
  menuOpen: document.getElementById("menu-open"),
  menuClose: document.getElementById("menu-close"),
  preview: document.getElementById("preview"),
  undo: document.getElementById("undo"),
  stuck: document.getElementById("stuck"),
  stuckWhy: document.getElementById("stuck-why"),
  btnWatch: document.getElementById("btn-watch"),
  btnNoThanks: document.getElementById("btn-nothanks"),
  app: document.getElementById("app"),
  home: document.getElementById("home"),
  btnPlay: document.getElementById("btn-play"),
  btnStages: document.getElementById("btn-stages"),
  btnFree: document.getElementById("btn-free"),
  homeStars: document.getElementById("home-stars"),
  homeSound: document.getElementById("home-sound"),
  stagemap: document.getElementById("stagemap"),
  stageGrid: document.getElementById("stage-grid"),
  mapStars: document.getElementById("map-stars"),
  mapBack: document.getElementById("map-back"),
  tables: document.getElementById("tables"),
  tablesBack: document.getElementById("tables-back"),
  tableGrid: document.getElementById("table-grid"),
  btnTables: document.getElementById("btn-tables"),
  mapDone: document.getElementById("map-done"),
};

// --- the shot preview ----------------------------------------------------
//
// EARNED FROM A REWARDED AD, SPENT ON A SHOT, and the two are separate
// controls on purpose. CrazyGames' advertisement requirements say a
// rewarded ad's REQUEST button "should not appear on an active gameplay
// screen", so:
//
//   - the REQUEST lives on the stuck card, which appears after a run of
//     misses on one stage and is not a gameplay screen;
//   - the SPEND lives in the top bar, because arming a preview is
//     something you do while deciding on a shot — and a button that
//     spends something you already own is not requesting an ad.
//
// It is PERSISTED (core/storage.js), which is not an afterthought: it was
// paid for with an ad, so it survives a restart and follows the player to
// whatever stage they play next. It was earned by the player, not by the
// stage they happened to get stuck on.
//
// ARMED, THEN SPENT ON THE SHOT — not on the look. While it is armed
// every angle the player tries draws its real path, and the charge only
// goes when they play a shot they meant. Being able to change your mind
// is most of the value: a preview you could point in exactly one
// direction would be worse than no preview.
let previewLeft = 0;
let previewArmed = false;
let previewCache = null;
// Both of these gates are asked for by name in the requirements: an
// out-of-lives style rewarded ad must not be offered "each time a user
// dies", and must not be offered too often. One miss is playing; three in
// a row on the same stage is stuck.
const OFFER_MIN_MISSES = 3;
const OFFER_COOLDOWN_MS = 120_000;
let missStreak = 0;
let missStreakStage = null;
let lastOfferAt = -Infinity;
// Consecutive requests that never became an ad. Two and the offer stops
// for the session, because there is nothing behind it — an ad blocker, no
// inventory, or Basic Launch, where CrazyGames' own monetization is off
// by definition and every request comes back unfilled. A game that keeps
// offering a reward it cannot hand over, during the exact window in which
// the portal is deciding whether to promote it, is showing its worst face
// to the people scoring it. "Skipped" is a decision and is not counted.
let offerMisses = 0;
const OFFER_MAX_MISSES = 2;
/** Blocks play while an ad is being requested or shown: "Ensure that a
 * user cannot progress the game while requesting or showing an ad." */
let adBusy = false;

/** Positions to go back to, newest last. Free play only: the campaign
 * already has "Restart this stage", and a stage is a fixed opening that
 * an undo would only ever rewind to.
 *
 * Practice is why this exists. A missed shot in free play leaves a table
 * you did not choose, and the shot you actually wanted to learn is gone
 * with it — so the position before every stroke is kept, along with the
 * score and the count it belonged to. Undoing a shot that took a point
 * away must give the point back, or the header starts telling a story
 * the table cannot support. */
const undoStack = [];
const UNDO_MAX = 40;

function paintUndoButton() {
  el.undo.hidden = state.mode !== "free" || undoStack.length === 0;
  // Campaign only. In the timed modes "restart" means throwing away a
  // run against the clock, which is a decision, not a loop step — it
  // stays behind the menu there. Hidden off the play screen for the
  // obvious reason: there is no stage to restart on the home screen.
  el.restartNow.hidden = state.screen !== "play" || state.mode !== "campaign";
}

function refreshPreviewButton() {
  previewLeft = getPreviewsHeld();
  // Free in both timed modes, and it stays on until it is switched off.
  // The preview is rationed in the campaign because seeing the route is
  // most of the puzzle there; practice and the AI game have no puzzle to
  // protect — they are the same table with a clock on it, and a player
  // working on a shot needs to see what the shot did.
  const free = timed();
  el.preview.hidden = !free && previewLeft === 0 && !previewArmed;
  el.preview.classList.toggle("ready", previewArmed);
  el.preview.textContent = previewArmed ? "Previewing" : "Preview";
  // The title row is one line and the badge is 90px of it. On a 390px
  // phone something has to give, and it is the try counter: the stage's
  // NAME is what the player is looking at, and the count is back the
  // moment the preview is spent. In free play the counter has already
  // moved down to the hint line to make room for these two buttons.
  //
  // ONLY ON A PHONE. This was unconditional, and a preview is earned
  // from an ad and then persists across stages and restarts — so on a
  // 1920px screen with 1400px of empty header, a player who banked a
  // preview lost "Try 3 · Par 2" indefinitely and had no idea why. The
  // concession is real but it is a concession to a 390px width, so it
  // is spent where that width exists.
  // In a timed run that slot is the CLOCK, and a clock that disappears
  // because a preview is banked is a run with no time on it.
  const narrow = typeof matchMedia === "function" && matchMedia("(max-width: 520px)").matches;
  if (el.shots) el.shots.hidden = !timed() && narrow && !el.preview.hidden;
}

function previewFor(shot) {
  if (!previewArmed) return null;
  // The simulation is a couple of thousand substeps and the pointer moves
  // every frame, so the result is cached against the shot that made it.
  // The key is rounded, because a path recomputed for a hundredth of a
  // degree is a path recomputed for nothing.
  const key = [
    state.stageIndex,
    state.shots,
    Math.round(state.aim.angle * 2000),
    Math.round(state.aim.power * 500),
    Math.round(state.tip.side * 1e4),
    Math.round(state.tip.vertical * 1e4),
  ].join(":");
  if (previewCache?.key === key) return previewCache.path;
  const path = simulateShotPath(state.world, "cue", {
    dirX: shot.dirX,
    dirY: shot.dirY,
    speed: shot.speed,
    side: state.tip.side,
    vertical: state.tip.vertical,
  });
  previewCache = { key, path };
  return path;
}

const state = {
  stageIndex: 0,
  world: null,
  phase: "aim", // aim | rolling | result
  shots: 0,
  tip: { side: 0, vertical: 0 },
  /**
   * The shot as it currently stands: a direction and a power that persist
   * between gestures.
   *
   * Persisting is the change the whole control rests on. Aim and power
   * are set by two different controls at two different moments, so
   * neither one can be a thing the hand is HOLDING — the moment the
   * player lets go of the aim to reach for the power, the aim has to
   * still be there. It also means a slow control can exist at all: the
   * nudge turns this by a fifth of a degree, and no release can be that
   * fine.
   *
   * Power starts at nothing and goes back to nothing after every shot.
   * It survives the GESTURE — letting go of the aim does not lose it —
   * but not the stroke: the bar is the trigger now, so every shot is
   * played by taking hold of it and letting go, and a bar still holding
   * the last shot's reading is a cue drawn back for a stroke nobody is
   * making.
   */
  aim: { angle: 0, power: 0 },
  /** True once the aim or the power has been touched since the last shot.
   * A tap on the cloth plays the shot, so it has to be impossible for a
   * stray touch to play one: something deliberate has to have happened
   * first. */
  armed: false,
  /** Where this press landed, in screen px, and how far it has travelled
   * since. A press that never really moves is a TAP, whatever it landed
   * on, and a tap plays the shot. */
  pressAt: null,
  travelled: 0,
  /** True while a hand is on the cue, turning it. */
  dragging: false,
  /** The angle around the ball at which that hand was last seen, or null
   * before the first move of a gesture. The turn is the DIFFERENCE
   * between two of these — see steerAim(). */
  aimRef: null,
  /** True while a press on the power lane is setting the speed. */
  laneDrag: false,
  adjustingSpin: false,
  /** A TIMED RUN, which both of the free modes now are.
   *
   * Practice used to be endless and scored nothing but a counter, and an
   * endless mode has no reason to be played twice. A target and a clock
   * turn the same table into a record attempt: the position you leave
   * yourself still is the next problem, but now it costs you something.
   *
   * The clock starts on the FIRST SHOT rather than on entering, so
   * reading the card is free. It keeps running through an undo, which is
   * the whole price of an undo and the reason no other rule is needed
   * about them. */
  target: 10,
  runStart: 0,
  runMs: 0,
  aiPoints: 0,
  aiLevel: "medium",
  /** Points the opponent has made on its current visit to the table. */
  aiRun: 0,
  /** Whose shot it is in versus: "player" (white) or "ai" (yellow). */
  turn: "player",
  held: null, // "left" | "right" while a nudge button is down
  layout: null,
  banner: null,
  bannerUntil: 0,
  cleared: false,
  /**
   * True until the player's first touch.
   *
   * The first screen IS the table — no title, no menu, no start button.
   * Daily Five lost more than a third of its mobile visitors before they
   * ever played a shot, and the retro's read was that the first screen
   * was a page ABOUT the game rather than the game. So the balls are
   * already placed, the cue is already on the cloth, and the only thing
   * laid over it is the one sentence a player arriving from a grid full
   * of pocket games does not know.
   *
   * What this is NOT is an auto-start. Daily Five tried that and pulled
   * it: a game that begins with no input reads as a glitch, not a
   * service. The cue draws itself back and lets go on a loop, which shows
   * the control without performing it.
   */
  attract: true,
  /**
   * Which of the three screens is up: "home", "stages" or "play".
   *
   * The table renders under all three. That is the whole design of the
   * front end and it is a compromise with a measured number: Daily Five
   * gated its first screen behind a title card and lost 44% of visitors
   * (36.8% on mobile) before they played anything, so a gate is a real
   * cost — but "I opened it and I was already mid-puzzle with no idea
   * where I was" is a real cost too, and it is the one the player
   * reported. The settlement is that the gate exists and is not opaque:
   * the balls are on the cloth behind the wordmark, the attract stroke is
   * running, and the accent button is one tap from playing.
   */
  screen: "home",
  /**
   * "campaign" or "free".
   *
   * Free play is the same table with the judging turned off: no par, no
   * stars, no reset-on-miss, no stuck card. It exists because the first
   * thing a confused player wants is to hit a ball with no one keeping
   * score, and because spin and power are learned by messing about rather
   * than by being told. It costs one branch in settle() and one in
   * loadStage(), which is the cheapest mode this game will ever have.
   */
  mode: "campaign",
  /**
   * WHICH DIFFICULTY THE CAMPAIGN RUN IS AT: 0 normal, 1 hard, 2 extreme.
   *
   * It is also the point target minus one, and that is the whole of the
   * mode. Normal asks for one point from the position the stage deals.
   * Hard asks for a second from wherever the balls stopped, extreme for a
   * third — the same hundred layouts, asked the question four-ball is
   * actually about, which is not "can you make this shot" but "can you
   * keep going".
   */
  level: 0,
  /** Points scored so far in this campaign run, 0..level. */
  points: 0,
  /**
   * The placement a miss returns to.
   *
   * On normal this is always the stage's own deal — a stage exists to
   * make one shot unavoidable, and a stage that drifts into a random
   * layout after the first miss has stopped asking its question. On hard
   * and extreme it is re-taken after every point, because from then on
   * the position the player made IS the question, and sending them back
   * to the deal would delete the point they just scored.
   */
  leg: null,
  /** Points scored in free play. Never resets the balls: in real 4구 the
   * table you leave yourself IS the next problem, and a stage's reset
   * rule exists only because a stage is asking one fixed question. */
  freePoints: 0,
  /** How long the outcome has been fixed, in seconds. The result appears
   * SHOT_OVER_GRACE after it does — see the note above frame(). */
  decidedFor: 0,
  /** How far down world.events the sound layer has already listened. The
   * event log is append-only within a shot, so an index is all the
   * bookkeeping a "play the new ones" rule needs. */
  heard: 0,
};

/** Stage index (0-based, ours) <-> storage stage id (1-based, shared with
 * StoneFlick's save schema, which numbers slots from 1). One line, in one
 * place, so the two numbering systems never meet anywhere else. */
const storageId = (i) => i + 1;
/** Every star the campaign can award: three per stage per difficulty.
 * Not storage's own MAX_STARS, which is sized for a hundred stages
 * whether or not this build ships that many. */
const MAX_CAMPAIGN_STARS = STAGES.length * 3 * DIFFICULTIES;

/**
 * Show one of the three screens.
 *
 * The header goes with the game, not with the chrome: on home and on the
 * stage map it is hidden, because "1. First Point · Try 0 · Par 1" sitting
 * above a title card is the game answering a question nobody asked yet.
 * The attract stroke runs on both front screens for the same reason the
 * scrim is a gradient and not a wash — the table has to be visibly alive
 * behind the words.
 */
function showScreen(name) {
  state.screen = name;
  const playing = name === "play";
  // The portal wants to know when the player is actually playing rather
  // than reading a menu — it is how a session is measured, and the SDK
  // says to report "game start, resume, enter next level" and every
  // break. Every entry into and out of play goes through here, and both
  // calls are idempotent, so this one line is the whole contract for the
  // screens; the cards below add the breaks that happen while the play
  // screen is still up.
  if (playing) notifyGameplayStart();
  else notifyGameplayStop();
  el.home.hidden = name !== "home";
  el.stagemap.hidden = name !== "stages";
  el.tables.hidden = name !== "tables";
  el.setup.hidden = name !== "setup";
  el.app.classList.toggle("front", !playing);
  el.menu.hidden = true;
  if (playing) {
    // The demo stroke and the one-sentence card belong to the FIRST entry
    // into play and to no other. A player who has already been told that
    // the table has no pockets does not need to be told again on their
    // fourth stage, and a cue that draws itself back while they are
    // trying to aim is worse than useless.
    state.attract = !taught;
    el.firstrun.hidden = taught;
  } else {
    el.cleared.hidden = true;
    el.stuck.hidden = true;
    el.firstrun.hidden = true;
    el.runover.hidden = true;
    state.attract = true;
    state.phase = "aim";
  }
  // The header's own buttons follow the screen, not just the shot: undo
  // and restart have nothing to act on once the table is behind a menu.
  paintUndoButton();
  paintStatus();
}

function paintHome() {
  const resume = getContinuePoint();
  const next = Math.min(STAGES.length, resume.id);
  const fresh = !isStageCleared(1);
  // "Stage 6" on normal, "Hard 6" on hard: the number alone would be the
  // same word for two different things to go back to.
  el.btnPlay.textContent = fresh
    ? "Play"
    : `Continue \u00b7 ${resume.level === 0 ? "Stage" : LEVEL_NAMES[resume.level]} ${next}`;
  const stars = Math.min(getTotalStars(), MAX_CAMPAIGN_STARS);
  el.homeStars.textContent = stars > 0 ? `\u2605 ${stars} / ${MAX_CAMPAIGN_STARS}` : "";
  el.mapStars.textContent = `\u2605 ${stars} / ${MAX_CAMPAIGN_STARS}`;
}

/** Which difficulty the grid is showing. Not state.level: the map is a
 * place to look around, and looking at hard is not playing it. */
let mapLevel = 0;

/** Is any stage at all open at this difficulty? Hard needs one normal
 * clear, extreme one hard clear — before that the tab is a door to an
 * empty room, and it is disabled rather than hidden so a player can see
 * what the game still has. */
function levelReachable(level) {
  return level === 0 || STAGES.some((_, i) => isLevelUnlocked(storageId(i), level));
}

/** Open the grid, on a difficulty. Defaults to the one Continue would
 * resume, so leaving a hard stage lands back among the hard ones. */
function openStageMap(level = getContinuePoint().level) {
  mapLevel = levelReachable(level) ? level : 0;
  paintStageMap();
  showScreen("stages");
}

/**
 * Paint the stage grid.
 *
 * Rebuilt on every open rather than patched, because it is a hundred
 * tiles and the alternative is a second copy of the progress state that
 * can disagree with the save.
 */
function paintStageMap() {
  paintHome();
  if (!levelReachable(mapLevel)) mapLevel = 0;
  const resume = getContinuePoint();

  for (const tab of el.mapTabs) {
    const level = Number(tab.dataset.level);
    const open = levelReachable(level);
    tab.classList.toggle("on", level === mapLevel);
    tab.setAttribute("aria-selected", String(level === mapLevel));
    tab.disabled = !open;
    // A locked tab says what opens it rather than just refusing. "Hard"
    // with no explanation is a player wondering whether the game is
    // broken; one line is the difference between a wall and a goal.
    tab.title = open
      ? `${LEVEL_NAMES[level]}: ${level + 1} point${level ? "s" : ""} a stage`
      : `Clear a stage on ${LEVEL_NAMES[level - 1]} to open ${LEVEL_NAMES[level]}`;
  }

  // Only when there is genuinely nothing left AT THIS DIFFICULTY. A
  // player who has cleared a hundred stages has earned a sentence saying
  // so, and — the actual report that produced this — a screen with
  // nothing left to press on needs to name where to go instead.
  el.mapDone.hidden = STAGES.some((_, i) => !isStageCleared(storageId(i), mapLevel));
  el.mapDone.textContent =
    mapLevel < DIFFICULTIES - 1
      ? `Every stage cleared on ${LEVEL_NAMES[mapLevel]}. ${LEVEL_NAMES[mapLevel + 1]} plays the same layouts for ${mapLevel + 2} points.`
      : "Every stage cleared on Extreme. Practice is on the home screen.";

  // The header total follows the TAB, not the whole campaign. On this
  // screen the question is "how far am I on this difficulty", and
  // "24 / 900" answers a different one — the home screen's, where the
  // whole campaign is the subject.
  const levelStars = STAGES.reduce((n, _, i) => n + (getStars(storageId(i), mapLevel) || 0), 0);
  el.mapStars.textContent = `\u2605 ${levelStars} / ${STAGES.length * 3}`;

  el.stageGrid.textContent = "";
  STAGES.forEach((st, i) => {
    const id = storageId(i);
    const open = isLevelUnlocked(id, mapLevel);
    const done = isStageCleared(id, mapLevel);
    const stars = getStars(id, mapLevel) || 0;
    const tile = document.createElement("button");
    tile.className =
      "tile" + (done ? " done" : "") + (!open ? " locked" : "") +
      (open && !done && mapLevel === resume.level && id === resume.id ? " here" : "");
    tile.disabled = !open;

    const no = document.createElement("span");
    no.className = "no";
    no.textContent = String(i + 1);
    const sv = document.createElement("span");
    sv.className = "st" + (stars ? "" : " none");
    sv.textContent = open ? "\u2605".repeat(stars) + "\u2606".repeat(3 - stars) : "";
    // No name line: the tile already says the number, and "1 / Stage 1"
    // is the same word twice.
    if (open) tile.append(no, sv);
    else tile.append(no);
    if (open) tile.addEventListener("click", () => startCampaign(i, mapLevel));
    el.stageGrid.append(tile);
  });
}

function goHome() {
  paintHome();
  showScreen("home");
}

/**
 * The tables screen.
 *
 * Each card shows the RENDERER's own output at postcard size rather than
 * a colour swatch, because what a table theme is worth is entirely what
 * it looks like, and a chip would describe the reward instead of showing
 * it. The cost is real but bounded: five small paints, once, when the
 * screen opens — and applying a theme drops the table cache anyway, so
 * the previews and the game are never disagreeing about the same bitmap.
 */
function paintTables() {
  const ctx2 = themeUnlockContext();
  const current = getTheme();
  el.tableGrid.replaceChildren();
  for (const t of THEMES) {
    const open = isThemeUnlocked(t.id, ctx2);
    const card = document.createElement("button");
    card.className = "card" + (t.id === current ? " on" : "") + (open ? "" : " locked");
    card.disabled = !open;

    // Painted at full size into an offscreen canvas and then CROPPED to
    // the table's own frame. Drawing straight into a small card canvas
    // gets the game's layout instead — margins, and a reserved strip for
    // a spin dial the card does not have — so the table came out as a
    // stamp in the middle of a lot of nothing.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 640;
    const H = 400;
    const off = document.createElement("canvas");
    off.width = W * dpr;
    off.height = H * dpr;
    const og = off.getContext("2d");
    og.setTransform(dpr, 0, 0, dpr, 0, 0);
    R.applyTheme(t.id);
    const oL = LAY.tableLayout(W, H);
    R.drawTable(og, oL);
    const fr = LAY.tableFrame(oL);
    const pad = oL.railPx * 0.55;
    const sx = fr.left - pad;
    const sy = fr.top - pad;
    const sw = fr.right - fr.left + pad * 2;
    const sh = fr.bottom - fr.top + pad * 2;

    const cv = document.createElement("canvas");
    const w = 300;
    const h = Math.round((w * sh) / sw);
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.aspectRatio = `${sw.toFixed(2)} / ${sh.toFixed(2)}`;
    const g = cv.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(off, sx * dpr, sy * dpr, sw * dpr, sh * dpr, 0, 0, w * dpr, h * dpr);

    const row = document.createElement("div");
    row.className = "cn";
    const nm = document.createElement("b");
    nm.textContent = t.name;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = !open
      ? `Clear ${t.unlockAt} stages`
      : t.id === current
        ? "In use"
        : "Use";
    row.append(nm, tag);

    const p = document.createElement("p");
    p.textContent = t.blurb;
    card.append(cv, row, p);
    if (open) {
      card.addEventListener("click", () => {
        setTheme(t.id);
        R.applyTheme(t.id);
        paintTables();
      });
    }
    el.tableGrid.append(card);
  }
  // Whatever the previews left applied, the game's own table wins.
  R.applyTheme(current);
}


// --- timed runs -------------------------------------------------------

const timed = () => state.mode === "free" || state.mode === "versus";

/** mm:ss, and no smaller. Tenths on a clock that runs for four minutes
 *  are four digits of noise flickering under the player's eyes. */
function clock(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function runElapsed() {
  if (!state.runStart) return state.runMs;
  return state.runMs + (performance.now() - state.runStart);
}

/** Started by the first shot, not by opening the screen. */
function startClock() {
  if (!state.runStart) state.runStart = performance.now();
}

function stopClock() {
  if (!state.runStart) return;
  state.runMs += performance.now() - state.runStart;
  state.runStart = 0;
}

/** The clock is read off performance.now(), so it is always right; this
 *  only decides when the header is repainted. Without it the seconds sat
 *  frozen between shots — the run's own clock looked stopped while it
 *  was running. Repainting on the SECOND rather than the frame keeps it
 *  to one text write a second instead of sixty. */
let shownClock = "";
function tickClock() {
  if (!timed() || !state.runStart) return;
  const now = clock(runElapsed());
  if (now === shownClock) return;
  shownClock = now;
  el.shots.textContent = now;
}

let boards = null;

/** The bead rack, rebuilt whenever the target or the mode changes. Two
 *  rows in versus, one in practice — the second row is the opponent's and
 *  there is no opponent to give it to. */
function buildScoreboard() {
  el.hint.textContent = "";
  el.hint.innerHTML = "";
  boards = null;
  if (!timed()) return;
  const host = document.createElement("div");
  host.className = "scoreboard";
  el.hint.appendChild(host);
  boards = {
    player: SB.createRow(host, { target: state.target, label: "You" }),
    ai: state.mode === "versus" ? SB.createRow(host, { target: state.target, label: "Opponent", tone: "opponent" }) : null,
  };
  paintScoreboard();
}

function paintScoreboard() {
  if (!boards) return;
  // What is LEFT, not what has been made. The rack is set out at the
  // start and emptied by playing; a foul puts a bead back, so this can go
  // above the target, which is the player being further from the end than
  // when they started rather than an error.
  SB.setRemaining(boards.player, state.target - state.freePoints);
  if (boards.ai) SB.setRemaining(boards.ai, state.target - state.aiPoints);
  boards.player.row.classList.toggle("live", state.mode === "versus" && state.turn === "player");
  if (boards.ai) boards.ai.row.classList.toggle("live", state.turn === "ai");
}

// --- the setup card ---------------------------------------------------

let setupMode = "free";
let setupTarget = 10;
let setupLevel = "medium";

function segButton(text, on, onClick) {
  const b = document.createElement("button");
  b.textContent = text;
  if (on) b.className = "on";
  b.addEventListener("click", onClick);
  return b;
}

function paintSetup() {
  el.setupTarget.innerHTML = "";
  for (const t of TARGET_SCORES) {
    el.setupTarget.appendChild(
      segButton(String(t), t === setupTarget, () => {
        setupTarget = t;
        paintSetup();
      })
    );
  }
  el.setupLevel.innerHTML = "";
  for (const id of Object.keys(LEVELS)) {
    el.setupLevel.appendChild(
      segButton(LEVELS[id].label, id === setupLevel, () => {
        setupLevel = id;
        paintSetup();
      })
    );
  }
  el.setupLevelField.hidden = setupMode !== "versus";
  const record = setupMode === "free" ? getPracticeRecord(setupTarget) : null;
  el.setupRecord.textContent = record ? `Your best: ${clock(record)}` : "";
}

function openSetup(mode) {
  setupMode = mode;
  const saved = getMatchSetup();
  setupTarget = saved.target;
  setupLevel = saved.level;
  el.setupTitle.textContent = mode === "versus" ? "Play with AI" : "Practice run";
  el.setupBlurb.textContent =
    mode === "versus"
      ? "You play the white, the AI plays the yellow. A point keeps you at the table; a miss hands it over."
      : "The balls stay where you leave them. The clock starts on your first shot.";
  paintSetup();
  showScreen("setup");
}

// --- the opponent -----------------------------------------------------

/** Whose ball is being played right now. Everything that draws a cue or
 *  reads an aim goes through this rather than assuming the white. */
function shooter() {
  return state.mode === "versus" && state.turn === "ai"
    ? P.getBall(state.world, "yellow")
    : P.getBall(state.world, "cue");
}

const AI_SPEC = { cueId: "yellow", redIds: ["red1", "red2"], opponentId: "cue" };

/**
 * The opponent's turn: think, show the cue on the line it chose, play.
 *
 * The pause before the strike is not decoration. A shot that appears the
 * instant the table stops reads as the game moving the balls by itself;
 * a cue that settles on a line first reads as somebody taking a shot, and
 * it also shows the player WHAT was aimed at, which is most of what makes
 * an opponent feel like one.
 */
function aiTurn() {
  if (state.mode !== "versus" || state.turn !== "ai" || adBusy) return;
  state.phase = "thinking";
  paintStatus();
  // Two frames, so the status line is on screen before the search takes
  // the thread. The search is a few hundred simulations and blocks.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (state.phase !== "thinking") return;
      const shot = chooseShot(state.world, {
        ...AI_SPEC,
        level: LEVELS[state.aiLevel],
        run: state.aiRun,
      });
      // The bar shows what the opponent is ACTUALLY about to hit, worked
      // back from the speed it chose. It was a hard-coded 0.4 — which the
      // bar, now that it prints its own position rather than the power,
      // rendered as "69%" on every single shot the computer ever took. A
      // control frozen on one number reads as broken, and it was also a
      // lie: nothing about the shot was 69% of anything.
      const span = P.MAX_SHOT_SPEED - LAY.MIN_SHOT_SPEED;
      state.aim = {
        angle: shot.angle,
        power: Math.min(1, Math.max(0, (shot.speed - LAY.MIN_SHOT_SPEED) / span)),
      };
      state.armed = true;
      paintStatus();
      setTimeout(() => {
        if (state.phase !== "thinking") return;
        P.resetEvents(state.world);
        state.heard = 0;
        const ball = P.getBall(state.world, "yellow");
        P.strike(ball, Math.cos(shot.angle), Math.sin(shot.angle), shot.speed, 0, 0);
        playFlickSound(state.aim.power);
        state.phase = "rolling";
        state.shots++;
        paintStatus();
      }, 620);
    })
  );
}

function startCampaign(i, level = 0) {
  state.mode = "campaign";
  loadStage(i, level);
  // Here and not in loadStage(): boot preloads a stage behind the home
  // screen, and that is not a game the player started.
  trackEvent("game_start", { mode: "campaign", stage: storageId(state.stageIndex), level: state.level });
  showScreen("play");
}

/**
 * Practice: the opening position, a target, and a clock.
 *
 * The balls are never reset after a shot — the table you leave yourself
 * is the next problem, which is what 4구 actually is and the opposite of
 * a stage's job. What is new is that the run ENDS: reach the target and
 * the clock stops, which is the difference between a sandbox and a thing
 * worth playing twice.
 */
function startFree(target = 10) {
  state.mode = "free";
  state.target = target;
  beginRun();
  trackEvent("game_start", { mode: "free", target });
  el.stage.textContent = "Practice";
  setBanner(`First to ${target} \u2014 the clock starts on your shot.`, 2600);
  showScreen("play");
}

/**
 * Against the AI. The same table and the same rules as practice,
 * with the yellow ball answering back.
 *
 * Real four-ball: a point keeps you at the table, a miss hands it over,
 * and the first to the target wins. Both of those are one line each here
 * because the rules module already judges any shot from any ball's point
 * of view — the opponent is not a special case in the physics or the
 * scoring, only in who chooses the angle.
 */
function startVersus(target = 10, level = "medium") {
  state.mode = "versus";
  state.target = target;
  state.aiLevel = level;
  beginRun();
  trackEvent("game_start", { mode: "versus", target, level });
  el.stage.textContent = "Play with AI";
  setBanner(`First to ${target}. You are the white.`, 2400);
  showScreen("play");
}

/** Everything both timed modes reset. */
function beginRun() {
  state.freePoints = 0;
  state.aiPoints = 0;
  state.turn = "player";
  state.aiRun = 0;
  state.stageIndex = 0;
  state.shots = 0;
  state.cleared = false;
  state.runStart = 0;
  state.runMs = 0;
  state.world = P.createWorld({ balls: ballsFrom(OPENING) });
  state.phase = "aim";
  state.aim = { angle: 0, power: 0 };
  state.tip = { side: 0, vertical: 0 };
  resetShotState();
  undoStack.length = 0;
  previewArmed = false;
  previewCache = null;
  refreshPreviewButton();
  buildScoreboard();
  updateHud();
  el.runover.hidden = true;
}

/** The end of a run: the clock stops and the card says what it said. */
function endRun(playerWon) {
  stopClock();
  // A finished run is a game over: it stops the play clock the portal
  // keeps and is the one moment an interstitial is allowed. ads.js does
  // its own throttling — this only tells it the game ended.
  onGameOver();
  if (playerWon) trackEvent("game_win", { mode: state.mode, target: state.target });
  state.phase = "result";
  const ms = runElapsed();
  const record = state.mode === "free" && recordPracticeTime(state.target, ms);
  el.runoverHead.textContent =
    state.mode === "free"
      ? `Rack cleared`
      : playerWon
        ? "You win"
        : "The AI wins";
  el.runoverTime.textContent = clock(ms);
  el.runoverDetail.textContent =
    state.mode === "free"
      ? record
        ? `Best yet \u00b7 ${state.shots} shots`
        : `${state.shots} shots`
      : `${state.freePoints}\u2013${state.aiPoints} \u00b7 ${state.shots} shots`;
  el.runover.hidden = false;
  paintStatus();
}

function stage() {
  return STAGES[state.stageIndex];
}

/** How many points this run has to score. The level IS the mode. */
const need = () => state.level + 1;
/** A campaign run that can continue past a point: hard and extreme. */
const multiPoint = () => state.mode === "campaign" && state.level > 0;
/** Par at the difficulty being played, not the stage's own number. */
const levelPar = () => parFor(stage(), state.level);
/** Shown on tabs, buttons and result cards. Index is the level. */
const LEVEL_NAMES = ["Normal", "Hard", "Extreme"];

/** Is there a stage after this one, open at the difficulty being played? */
function nextStageIsOpen() {
  const next = state.stageIndex + 1;
  return next < STAGES.length && isLevelUnlocked(storageId(next), state.level);
}

/** Where the balls are right now, in the shape a placement has. What
 * makes "play on from here" something the miss rule can point at too. */
function snapshotBalls() {
  return state.world.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, color: b.color }));
}

/** Start the stage over from its own deal: a fresh run, no points. */
function dealStage() {
  state.leg = ballsFrom(stage().balls);
  state.points = 0;
}

/**
 * Put the cue and the tip back where a stage starts.
 *
 * The cue starts pointing where the stage's own solution points. It is
 * not a hint anyone can read as one — a stick lying on a table — but it
 * means the first thing a new player does, if they simply pull the bar
 * and let go, is a shot that goes somewhere sensible. Power is not
 * seeded with it: the bar is the trigger, so a power the player did not
 * set is a shot they did not ask for.
 *
 * The tip goes back to centre for the same reason it does between
 * stages — carrying a draw into a problem whose hint says "tip dead
 * centre" is the control lying about itself.
 *
 * AND THIS IS WHY RETRY CALLS IT. Replaying a stage used to reset the
 * balls and the try counter and nothing else, so the angle, the tip and
 * the power that had just cleared it were all still loaded: a player who
 * scraped a one-star clear could press Play it again and take the
 * identical shot for three stars without aiming. The stars are supposed
 * to measure the shot, and a retry that keeps the answer measures
 * nothing.
 */
function resetControls() {
  state.aim = {
    angle: state.mode === "campaign" ? (stage().solution.deg * Math.PI) / 180 : 0,
    power: 0,
  };
  state.tip = { side: 0, vertical: 0 };
  state.armed = false;
  previewCache = null;
}

/**
 * @param {number} i stage index, 0-based
 * @param {number} [level] 0 normal, 1 hard, 2 extreme. A level that is
 *   not open on this stage falls back to normal rather than refusing:
 *   every caller here computes the level from the save, and a locked one
 *   means the save moved under a screen that was already painted.
 */
function loadStage(i, level = 0) {
  state.mode = "campaign";
  state.stageIndex = ((i % STAGES.length) + STAGES.length) % STAGES.length;
  state.level = isLevelUnlocked(storageId(state.stageIndex), level) ? level : 0;
  setLastStage(storageId(state.stageIndex), state.level);
  dealStage();
  state.shots = 0;
  state.cleared = false;
  el.cleared.hidden = true;
  el.stuck.hidden = true;
  missStreak = 0;
  missStreakStage = stage().id;
  resetBalls();
  // The cue starts pointing where the stage's own solution points. It is
  // not a hint anyone can read as one — a stick lying on a table — but it
  // means the first thing a new player does, if they simply pull the bar
  // and let go, is a shot that goes somewhere sensible.
  // Power is not seeded with it. The bar is the trigger, so a power the
  // player did not set is a shot they did not ask for: they take hold of
  // the bar, and the reading starts where their thumb starts it.
  resetControls();
  // The name IS the number. Stages are generated and the campaign is
  // meant to keep growing, so a hundred invented names would be a hundred
  // things to get wrong in a language most of the audience reads better
  // than the author writes it.
  //
  // And no sentence under it. Every stage used to carry a line naming the
  // stroke it wanted — "Backspin is the only way the white comes home" —
  // which is the answer to the only question the stage asks. The
  // first-run card teaches the one rule that needs teaching; what to do
  // about a particular table is the game.
  el.stage.textContent = stage().name;
  el.hint.textContent = "";
  // So a player's feedback arrives with the stage they were on.
  setContext({ stage: storageId(state.stageIndex) });
  setBanner(null);
  updateHud();
}

/** Everything about the shot in progress, cleared. Split out of
 * resetBalls() because free play needs it without replacing the world —
 * there, the balls staying where they landed is the mode. */
function resetShotState() {
  state.phase = "aim";
  state.pressAt = null;
  state.travelled = 0;
  state.dragging = false;
  state.laneDrag = false;
  // The line stays where the player left it — a practice player playing
  // the same stroke twice should not have to aim it twice — and the
  // power goes home, because the bar is the trigger and the next stroke
  // starts by taking hold of it.
  state.aim.power = 0;
  state.armed = false;
  state.heard = 0;
  paintStatus();
}

/** Back to the start of the CURRENT LEG, which on normal is the stage's
 * own deal and on hard and extreme is wherever the last point left the
 * table. dealStage() is what goes back further than that. */
function resetBalls() {
  const placement = state.leg ?? ballsFrom(stage().balls);
  state.world = P.createWorld({ balls: placement.map((b) => ({ ...b })) });
  resetShotState();
}

function updateHud() {
  const free = timed();
  if (free) {
    // The title row carries the CLOCK now and the hint row carries the
    // beads. The numbers that used to be here said the same thing the
    // beads say, and said it worse: "7 points" is read, a rack with three
    // beads still to go is seen.
    el.shots.textContent = clock(runElapsed());
    paintScoreboard();
  } else {
    // On normal the count of tries and the par are the whole story. On
    // hard and extreme the player also has to know how much of the run is
    // already banked, and that number goes FIRST: it is the one that
    // changes what they do next.
    el.shots.textContent =
      state.level === 0
        ? `Try ${state.shots} \u00b7 Par ${levelPar()}`
        : `${state.points}/${need()} \u00b7 Try ${state.shots} \u00b7 Par ${levelPar()}`;
  }
  const header = el.status && el.status.parentElement;
  if (header) header.classList.toggle("free", free);
  paintUndoButton();
}

/** One line telling the player what the control wants next. A two-step
 * shot needs it: "drag and let go" is a complete gesture everywhere else
 * on the web, so a game that then waits for a second input has to say so
 * once, or it reads as having ignored the first one. */
/**
 * Is this the moment to offer the ad?
 *
 * Four gates, and each is a requirement rather than a preference: not
 * every failure (three in a row on one stage), not too often (a two
 * minute cooldown), not when the player already owns one, and not after
 * the offer has come back empty twice — at which point there is nothing
 * behind the button and continuing to show it is advertising a reward the
 * game cannot hand over.
 */
function shouldOffer() {
  return (
    state.mode === "campaign" &&
    !state.cleared &&
    previewLeft === 0 &&
    !previewArmed &&
    missStreak >= OFFER_MIN_MISSES &&
    offerMisses < OFFER_MAX_MISSES &&
    performance.now() - lastOfferAt > OFFER_COOLDOWN_MS
  );
}

function dismissStuck() {
  el.stuck.hidden = true;
  missStreak = 0;
  if (!state.cleared) resetBalls();
}

function paintStatus() {
  if (!el.status) return;
  const header = el.status.parentElement;
  el.status.textContent =
    state.phase === "thinking"
      ? "The AI is lining one up"
      : state.attract || state.phase !== "aim"
      ? ""
      : state.dragging
        ? "Turning the cue"
        : state.laneDrag
          ? state.travelled >= LAY.TAP_SLOP_PX
            ? "Let go to shoot"
            : "Tap to set \u00b7 pull to shoot"
          : state.aim.power < LAY.LANE_MIN_POWER
            ? "Tap the bar to set the power"
            : state.armed
              ? "Lined up \u00b7 pull the bar to shoot"
              : "Turn the cue to aim \u00b7 bar shoots";
  // Whether this screen HAS a status line, not whether it is saying
  // something right now: the text empties for the length of every shot,
  // and a row that comes and goes moves the table under the player.
  //
  // There used to be a second class here, `speaking`, which said whether
  // a hand was on a control — it decided which of the hint and the status
  // was in the one line a phone had room for. There is no hint any more,
  // so there is nothing to decide.
  if (header) header.classList.toggle("has-status", state.screen === "play");
}

/** The first touch that TAKES HOLD of something ends the demo.

 *
 * Not any touch. The card carries three numbered steps now, and a card
 * that vanishes when a finger lands anywhere on the screen is a card
 * that vanishes while it is being read. A press on the cue, the bar, the
 * dial or the arrows is a player who has started; a press on empty cloth
 * is a player who has not.
 *
 * Persisted, not a module-level flag: the flag died with the page, so a
 * player who closed the tab and came back for stage 8 was shown the
 * beginner's card — and a demo cue drawing itself back while they aim —
 * all over again. */
let taught = hasSeenBriefing("first-shot");
function wakeUp() {
  hideTip();
  if (!state.attract) return;
  state.attract = false;
  taught = true;
  markBriefingsSeen(["first-shot"]);
  el.firstrun.classList.add("gone");
  setTimeout(() => {
    el.firstrun.hidden = true;
  }, 300);
  paintStatus();
}

/**
 * A one-time coach note, anchored under the button it is about.
 *
 * Not a banner. The banner is for what just HAPPENED — "You hit the
 * yellow" — and it lives at the top of the table for a second and a half,
 * which is the wrong length and the wrong place for a sentence somebody
 * has to read and then act on. This sits by the control it describes,
 * stays long enough to be read twice, and goes away on the next touch
 * because by then the player is doing the thing it asked for.
 */
let tipTimer = null;
function showTip(text, ms = 7000) {
  clearTimeout(tipTimer);
  el.tip.textContent = text;
  el.tip.hidden = false;
  el.tip.classList.remove("gone");
  tipTimer = setTimeout(hideTip, ms);
}

function hideTip() {
  clearTimeout(tipTimer);
  tipTimer = null;
  if (el.tip.hidden) return;
  el.tip.classList.add("gone");
  setTimeout(() => {
    el.tip.hidden = true;
  }, 300);
}

function setBanner(text, ms = 1600) {
  state.banner = text;
  state.bannerUntil = text ? performance.now() + ms : 0;
  el.banner.textContent = text || "";
  el.banner.classList.toggle("show", Boolean(text));
}

// --- input ------------------------------------------------------------

function cueBall() {
  return P.getBall(state.world, "cue");
}

/** The armed shot, in the shape physics.strike() wants. */
function currentShot() {
  const a = state.aim;
  return {
    dirX: Math.cos(a.angle),
    dirY: Math.sin(a.angle),
    power: a.power,
    speed: LAY.MIN_SHOT_SPEED + a.power * (P.MAX_SHOT_SPEED - LAY.MIN_SHOT_SPEED),
  };
}

/**
 * Turn the standing aim by a fifth of a degree, and hold it.
 *
 * The holding is the point. A drag fires on release, so there is no
 * moment inside it where a slower control could act; pressing an arrow
 * creates that moment deliberately — the aim is now lined up and waiting,
 * and a tap plays it. Opt-in precision: a player who never presses an
 * arrow never meets the two-step at all.
 */
function nudge(dir) {
  state.aim.angle += (dir * LAY.NUDGE_DEGREES * Math.PI) / 180;
  state.armed = true;
  paintStatus();
}

function startRepeat(which) {
  state.held = which;
  const step = which === "left" ? () => nudge(-1) : () => nudge(1);
  step();
  // A short delay before the repeat starts, so a single press is a single
  // step; without it a tap turns into three.
  state.repeatTimer = setTimeout(() => {
    state.repeatTimer = setInterval(step, 90);
  }, 320);
}

function stopRepeat() {
  clearTimeout(state.repeatTimer);
  clearInterval(state.repeatTimer);
  state.repeatTimer = null;
  state.held = null;
}

/**
 * Loudest impact the sound layer scales against, in m/s of CLOSING speed.
 *
 * StoneFlick needed the same constant and got it wrong first by picking a
 * number off the physics cap: scaling against the fastest thing possible
 * makes every ORDINARY shot quiet, and ordinary shots are all a player
 * ever hears. 4 m/s is a genuinely hard stroke (the cap is 6), so a
 * normal 2 m/s carom lands at half volume with headroom above it.
 */
const LOUDEST_IMPACT = 4;
/**
 * Below this closing speed, in m/s, a contact makes no sound at all.
 *
 * The gate lives in SPEED rather than in the strength number the voices
 * receive, because "was this a real collision" is a physics question and
 * "how loud" is an audio one. A ball creeping into a cushion at 5cm/s at
 * the end of a shot is not an event; a ball touching another at 30cm/s
 * very much is, and used to be inaudible.
 */
const QUIET_IMPACT = 0.12;
/** The quietest a contact that DOES get a sound is allowed to be. There
 * is no point spending a voice on something under the room noise. */
const MIN_AUDIBLE = 0.12;

/**
 * Closing speed -> how hard it sounds, 0..1.
 *
 * SQUARE ROOT, not linear, and this is the fix for a bug you can hear on
 * every stage in the campaign. Linear volume against speed sounds wrong
 * because hearing is not linear: doubling the amplitude is nothing like
 * doubling the loudness. Measured across the seven recorded solutions,
 * the FIRST contact came in around 1.5 m/s and the second — the one that
 * scores the point, the one the player is waiting for — around 0.5, so
 * the scoring hit was landing at a fifth of the volume of the setup hit
 * and one stage's ("Draw", 0.30 m/s) was below the audible threshold
 * entirely. The point of the shot was silent.
 *
 * Under the root the same pair reads 0.65 and 0.43: still softer, which
 * is true and should be audible, but unmistakably there.
 */
const loudness = (speed) => {
  if (speed <= QUIET_IMPACT) return 0;
  const t = Math.min(1, (speed - QUIET_IMPACT) / (LOUDEST_IMPACT - QUIET_IMPACT));
  return MIN_AUDIBLE + (1 - MIN_AUDIBLE) * Math.sqrt(t);
};

/**
 * Play whatever has happened since the last frame.
 *
 * One sound per KIND per frame, at the loudest event of that kind, rather
 * than one per event. A break can put three contacts inside a single
 * 16ms frame, and three impact voices stacked on the same millisecond do
 * not read as three hits — they read as one clipped bang. Taking the
 * loudest keeps the frame's dynamics and costs nothing.
 */
function playNewSounds() {
  const events = state.world.events;
  if (state.heard >= events.length) return;
  const balls = [];
  let rail = 0;
  for (let i = state.heard; i < events.length; i++) {
    const e = events[i];
    if (e.type === "ball") balls.push(e);
    else if (e.type === "cushion") rail = Math.max(rail, e.speed);
  }
  state.heard = events.length;

  // Ball on ball is StoneFlick's stone-on-stone sample, unchanged. A go
  // stone and a phenolic billiard ball make nearly the same noise: a short
  // hard transient with no tail. See assets/audio/README.md.
  //
  // TWO of them at most, not one and not all of them. One was the old
  // rule and it eats the second clack of a frozen carom, where the two
  // contacts are ten milliseconds apart and land in the same frame — and
  // that double clack IS the sound of hitting a frozen ball. All of them
  // is worse: a break can put several in a frame and they stack into one
  // clipped bang. So: the two loudest, the quieter one delayed by the
  // gap the simulation actually reported — which is the gap the player
  // hears, now that the clock is always real time.
  balls.sort((a, b) => b.speed - a.speed);
  if (balls.length > 0) playImpactSound(loudness(balls[0].speed));
  if (balls.length > 1) {
    const gap = Math.abs(balls[1].t - balls[0].t);
    playImpactSound(loudness(balls[1].speed), Math.min(0.09, Math.max(0.012, gap)));
  }

  // The cushion has its own voice now — rubber under cloth, synthesized
  // rather than borrowed. It used to reuse StoneFlick's "obstacle", which
  // is a go stone against a fixed wooden peg, and a peg clicks where a
  // cushion swallows. See core/audio.js playCushionSound().
  if (rail > 0) playCushionSound(loudness(rail));
}

/**
 * Turn the cue by however far the hand holding it has turned.
 *
 * Relative, one to one, around the ball. See layout.angleAround() for why
 * that and not an absolute line: the short version is that the hand is on
 * the STICK, and a stick that jumps when you touch it is not a stick.
 *
 * `aimRef` is the angle the hand was last seen at. It is set on the
 * first move rather than on the press, so the press itself is worth no
 * rotation at all, and it is cleared whenever the hand comes inside the
 * pivot — coming back out starts a fresh reference instead of applying
 * the nonsense angle measured while it was over the ball.
 */
function steerAim(px, py) {
  const cue = cueBall();
  const c = LAY.toPx(state.layout, cue.x, cue.y);
  if (Math.hypot(px - c.x, py - c.y) < LAY.AIM_PIVOT_MIN_PX) {
    state.aimRef = null;
    return;
  }
  // The reference for the FIRST turn is where the hand pressed, not
  // where it is when the slop is finally crossed. Seeding it at the
  // crossing instead threw those nine pixels away for good: on a phone
  // that is eight degrees at the middle of the stick, and the cue spent
  // the rest of the gesture that far behind the hand supposedly holding
  // it.
  if (state.aimRef === null && state.pressAt) {
    const q = LAY.toTable(state.layout, state.pressAt.x, state.pressAt.y);
    if (Math.hypot(state.pressAt.x - c.x, state.pressAt.y - c.y) >= LAY.AIM_PIVOT_MIN_PX) {
      state.aimRef = LAY.angleAround(cue.x, cue.y, q.x, q.y);
    }
  }
  const at = LAY.toTable(state.layout, px, py);
  const now = LAY.angleAround(cue.x, cue.y, at.x, at.y);
  if (state.aimRef !== null) state.aim.angle += LAY.wrapAngle(now - state.aimRef);
  state.aimRef = now;
}

/** The lane is the only thing that sets power, and it sets it outright:
 * where the finger is IS the speed, the way a fader is the volume. */
function setPowerFromLane(px, py) {
  const lane = LAY.controlsLayout(state.layout).lane;
  state.aim.power = LAY.powerForPull(LAY.laneToPower(lane, px, py));
}

attachPointerHandlers(canvas, {
  onDown(pos) {
    // Must happen synchronously inside a real gesture or the browser will
    // not let the audio context start — see core/audio.js.
    unlockAudio();
    if (adBusy || state.phase !== "aim") return;
    // Not while it is the opponent's table. Nothing here would corrupt
    // anything — the shot the player set up would simply be played with
    // the yellow ball — which is exactly why it has to be refused rather
    // than left to look like it worked.
    if (state.mode === "versus" && state.turn === "ai") return;
    const hit = LAY.controlAt(state.layout, pos.x, pos.y);
    if (hit === "dial") {
      wakeUp();
      state.adjustingSpin = true;
      const tip = LAY.dialToTip(LAY.spinDialLayout(state.layout), pos.x, pos.y, P.MAX_TIP_OFFSET);
      if (tip) state.tip = tip;
      return;
    }
    if (hit === "left" || hit === "right") {
      wakeUp();
      startRepeat(hit);
      return;
    }
    // THE CUE OUTRANKS THE BAR, and only the bar.
    //
    // The stick is long and it lies wherever the aim points, so it
    // crosses the other controls — and which one wins matters. The dial
    // and the arrows win, because they are small, precise, and a cue
    // lying across the dial would otherwise make the spin unusable for
    // the whole shot. The bar loses, because it is the biggest thing on
    // the strip: a stick 52px wide crossing a 355px fader leaves most of
    // the fader, while a fader that swallowed the stick would leave the
    // player no way to aim at all.
    if (LAY.withinCue(state.layout, cueBall(), state.aim.angle, state.aim.power, pos.x, pos.y)) {
      wakeUp();
      state.pressAt = { x: pos.x, y: pos.y };
      state.travelled = 0;
      state.aimRef = null;
      state.dragging = true;
      paintStatus();
      return;
    }
    if (hit === "lane") {
      wakeUp();
      state.laneDrag = true;
      state.pressAt = { x: pos.x, y: pos.y };
      state.travelled = 0;
      setPowerFromLane(pos.x, pos.y);
      // Taking hold of the bar loads the shot, so the cue draws back
      // under the thumb rather than waiting for a release that is also
      // the shot going off.
      state.armed = true;
      paintStatus();
      return;
    }
  },
  onMove(pos, meta) {
    if (state.phase !== "aim" || !meta.pressed) return;
    if (state.adjustingSpin) {
      const tip = LAY.dialToTip(LAY.spinDialLayout(state.layout), pos.x, pos.y, P.MAX_TIP_OFFSET);
      if (tip) state.tip = tip;
      return;
    }
    if (state.laneDrag) {
      if (state.pressAt) {
        // Along the lane only. Across it is the thumb rolling, and on a
        // 24px-wide bar that roll is most of a two-dimensional distance.
        const lane = LAY.controlsLayout(state.layout).lane;
        const along = lane.vertical
          ? Math.abs(pos.y - state.pressAt.y)
          : Math.abs(pos.x - state.pressAt.x);
        state.travelled = Math.max(state.travelled, along);
      }
      setPowerFromLane(pos.x, pos.y);
      paintStatus();
      return;
    }
    if (!state.dragging || !state.pressAt) return;
    state.travelled = Math.max(
      state.travelled,
      Math.hypot(pos.x - state.pressAt.x, pos.y - state.pressAt.y)
    );
    // Below the slop nothing turns. A hand resting on a stick is not
    // aiming, and two pixels of skin roll should not cost a degree on a
    // stage that forgives two and a half.
    if (state.travelled < LAY.TAP_SLOP_PX) return;
    steerAim(pos.x, pos.y);
    if (!state.armed) {
      state.armed = true;
      paintStatus();
    }
  },
  onUp(pos) {
    if (state.adjustingSpin) {
      state.adjustingSpin = false;
      return;
    }
    if (state.held) {
      stopRepeat();
      return;
    }
    if (state.laneDrag) {
      state.laneDrag = false;
      setPowerFromLane(pos.x, pos.y);
      const pulled = state.travelled >= LAY.LANE_PULL_PX;
      state.pressAt = null;
      state.travelled = 0;
      // A TAP ON THE BAR SETS THE POWER AND PLAYS NOTHING.
      //
      // The same tap-or-drag distinction the cue already uses, and it is
      // here for the preview. The preview draws the whole route, which
      // needs a direction AND a speed — and with the two on separate
      // controls, the only moment both were set was the moment the thumb
      // was about to let go of the bar and fire. You could see the route
      // you were about to play and never a route you were considering.
      //
      // A tap parks a speed. The cue can then be turned with the whole
      // route drawn and updating, as many times as it takes, and the
      // pull is spent once, at the end, on the line the player chose.
      if (!pulled) {
        state.armed = state.aim.power >= LAY.LANE_MIN_POWER;
        paintStatus();
        return;
      }
      // LETTING GO OF A PULL PLAYS THE SHOT.
      //
      // The bar is the trigger as well as the dial, which is one gesture
      // fewer than setting a power and then tapping the table — and it
      // is the one part of the old pull-back that was worth keeping. A
      // stroke has a moment where it goes, the hand knows what that
      // moment is, and a release is that moment. The difference from the
      // pull it replaced is that this release cannot disturb the aim:
      // the two controls are in different places and the line was set
      // before the thumb ever came here.
      //
      // Sliding back to nothing before letting go is the way out, and it
      // is what the cancel ring used to be: it costs nothing, needs no
      // aiming, and the bar itself shows you where it is.
      if (state.aim.power < LAY.LANE_MIN_POWER) {
        state.aim.power = 0;
        state.armed = false;
        paintStatus();
        return;
      }
      state.armed = true;
      fire(currentShot());
      return;
    }
    if (state.phase !== "aim" || !state.pressAt) return;
    const travelled = Math.max(
      state.travelled,
      Math.hypot(pos.x - state.pressAt.x, pos.y - state.pressAt.y)
    );
    state.dragging = false;
    state.pressAt = null;
    state.travelled = 0;
    state.aimRef = null;

    // Turning the cue is all this gesture did. Letting go of it cannot
    // play a shot: the trigger is the power bar, in one place, where it
    // cannot be pulled by a hand that was only lining something up.
    if (travelled >= LAY.TAP_SLOP_PX) state.armed = true;
    paintStatus();
  },
  onCancel() {
    state.dragging = false;
    state.aimRef = null;
    state.laneDrag = false;
    state.adjustingSpin = false;
    state.pressAt = null;
    state.travelled = 0;
    stopRepeat();
    paintStatus();
  },
});

/**
 * One press of the power keys, as a fraction of full power.
 *
 * Keyboard-only, and deliberately not a pair of on-screen buttons. The
 * lane is a fader and a fader is the right control for a mouse or a
 * thumb: you can see the whole range and put the pointer straight on the
 * part of it you want. A keyboard cannot do that, so it gets the thing a
 * keyboard is good at instead — a repeatable step, small enough that
 * holding the key walks the range in about a second.
 */
const KEY_POWER_STEP = 0.02;

// Desktop gets both controls on the keyboard: left/right walk the line by
// a fifth of a degree, up/down walk the power, and space plays the shot.
// Every one of them is finer than the hand that would otherwise do it.
window.addEventListener("keydown", (e) => {
  if (adBusy || state.phase !== "aim") return;
  if (state.mode === "versus" && state.turn === "ai") return;
  wakeUp();
  const step = e.shiftKey ? 5 : 1;
  const power = (dir) => {
    state.aim.power = Math.max(0, Math.min(1, state.aim.power + dir * step * KEY_POWER_STEP));
    state.armed = state.aim.power >= LAY.LANE_MIN_POWER;
    paintStatus();
  };
  if (e.key === "ArrowLeft") for (let i = 0; i < step; i++) nudge(-1);
  else if (e.key === "ArrowRight") for (let i = 0; i < step; i++) nudge(1);
  else if (e.key === "ArrowUp") power(1);
  else if (e.key === "ArrowDown") power(-1);
  else if (e.key === " " || e.key === "Enter") {
    if (state.armed && state.aim.power >= LAY.LANE_MIN_POWER) fire(currentShot());
  } else return;
  e.preventDefault();
});

function fire(shot) {
  // The one place that guards this, rather than each of the three call
  // sites. Every path in was already checking, but a shot fired while the
  // table is still rolling — or while an ad is up, which the requirements
  // ask us to prevent — is the kind of thing that only shows up as a
  // scrambled sequence much later.
  if (state.phase !== "aim" || adBusy) return;
  P.resetEvents(state.world);
  state.heard = 0;
  state.armed = false;
  state.decidedFor = 0;
  if (timed()) {
    // The table as it stands, before the stroke. Balls are at rest here
    // by definition, so the clone is a clean position and not a moment
    // mid-roll.
    undoStack.push({
      world: P.cloneWorld(state.world),
      points: state.freePoints,
      shots: state.shots,
    });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    paintUndoButton();
  } else if (previewArmed) {
    // Spent on the shot, not on the look. Free play does not pay: the
    // preview there is a switch, not a consumable.
    previewArmed = false;
    previewCache = null;
    setPreviewsHeld(Math.max(0, previewLeft - 1));
    refreshPreviewButton();
  }
  if (timed()) startClock();
  P.strike(cueBall(), shot.dirX, shot.dirY, shot.speed, state.tip.side, state.tip.vertical);
  playFlickSound(shot.power);
  state.phase = "rolling";
  state.shots++;
  updateHud();
  paintStatus();
}

// --- the frame loop ---------------------------------------------------

/**
 * WHEN A SHOT IS OVER — and why there is no fast-forward any more.
 *
 * Measured across the twenty-one stages: the outcome of a shot is fixed
 * after 0.79 SECONDS on average, and the balls then keep rolling for
 * another 4.80. Ninety per cent of what the player watches is the reds
 * rattling around after the point is already made.
 *
 * Two versions tried to compress that 4.8s by speeding up the clock, and
 * both were reported as bugs, because both are the same bug. On-screen
 * speed is v * p, so on-screen acceleration is the real one times p
 * SQUARED: a flat 3x brakes every ball nine times too hard, which reads
 * as "they stop suddenly". Making the multiplier fall as the table
 * settles fixed that and produced the other half — while p RAMPS UP, a
 * ball that is already slow gets faster on screen, which reads as "the
 * red speeds up just before it stops". Measured: 4 of 21 stages had a
 * ball visibly speed up in its last second under the old 3x, and 10 of
 * 21 under the settling version.
 *
 * Every policy that removed the artifact removed the fast-forward with
 * it. That is not a tuning failure, it is the arithmetic: compressing
 * time IS a change of speed, and there is no schedule of p that
 * compresses four seconds into one without a ball somewhere moving
 * differently than the cloth says it does.
 *
 * SO THE CLOCK IS REAL, ALWAYS, and the 4.8 seconds is not compressed —
 * it is simply not waited for. The shot ends a beat after its outcome is
 * fixed; the table keeps rolling honestly behind the result, at 1x, for
 * as long as it takes. Nothing is skipped and nothing is sped up. The
 * player sees their point land and moves on, and the balls that no
 * longer matter finish moving like billiard balls.
 *
 * Net: about 1.5s from the stroke to the result, against 2.6s of
 * fast-forward before it. Shorter AND honest, which is the giveaway that
 * the fast-forward was solving the wrong problem.
 */
/** Seconds between the outcome being fixed and the result appearing.
 * Long enough to watch the second red actually go, short enough that
 * nobody is waiting. */
const SHOT_OVER_GRACE = 0.7;

let lastTime = performance.now();

function frame(now) {
  const real = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (state.phase === "rolling") {
    P.stepWorld(state.world, real);
    playNewSounds();
    // A table whose leftovers MATTER is judged at rest; one whose
    // leftovers are scenery can be judged as soon as the outcome is
    // fixed, which is 0.7s of waiting the player never has to do.
    //
    // Free play was the original exception, and for a reason: there the
    // resting positions ARE the next problem, so the player has to see
    // them and must not be able to shoot into a moving table. Hard and
    // extreme joined it the moment a run could continue — the position
    // this shot leaves is the one the next point is played from, and the
    // one a miss returns to, so reading it while the balls are still
    // rolling would bank a table that never existed.
    if (timed() || multiPoint()) {
      if (P.isAtRest(state.world)) settle();
    } else {
      state.decidedFor = shotDecided() ? state.decidedFor + real : 0;
      if (state.decidedFor >= SHOT_OVER_GRACE || P.isAtRest(state.world)) settle();
    }
  } else if (!P.isAtRest(state.world)) {
    // The table finishes rolling under the result card, at real speed.
    P.stepWorld(state.world, real);
    playNewSounds();
  }

  if (state.banner && now > state.bannerUntil) setBanner(null);
  tickClock();

  draw();
  requestAnimationFrame(frame);
}

/**
 * How far a ball could still travel, in metres — an upper bound.
 *
 * Every joule it has, divided by the gentlest force the table can apply.
 * KE = 1/2 m v^2 + 1/5 m R^2 w^2 for a sphere, and rolling resistance
 * mu_roll * m * g is the smallest deceleration in the model — sliding is
 * twenty times stronger, and a cushion only ever takes energy away. The
 * mass cancels, so it never appears.
 *
 * Deliberately loose. A rolling ball actually covers KE / (1.4 mu m g),
 * and spin about the vertical axis never becomes travel at all, so this
 * over-estimates — which is the only safe direction for something the
 * game uses to decide a shot is over.
 */
function reachOf(b) {
  // A ball that is already ROLLING is not a bound at all, it is an
  // equality: its spin is locked to its speed, so it travels exactly
  // v^2 / (2 mu g) and not a millimetre more. Most of a shot is spent
  // rolling, and using the loose form there costs a third of a second of
  // waiting per shot for nothing. Verified over 3,276 shots: the tighter
  // reading never once called a shot early.
  if (P.isRolling(b)) {
    return (b.vx * b.vx + b.vy * b.vy) / (2 * P.MU_ROLL * P.GRAVITY);
  }
  const v2 = b.vx * b.vx + b.vy * b.vy;
  const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
  return (0.5 * v2 + 0.2 * P.BALL_RADIUS * P.BALL_RADIUS * w2) / (P.MU_ROLL * P.GRAVITY);
}

/** The whole table's remaining reach. Summed rather than taken per ball
 * because energy MOVES between balls — a red can carry it into the cue
 * ball — and a bound that ignored that would be wrong exactly in the
 * cases that matter. */
function tableReach() {
  let sum = 0;
  for (const b of state.world.balls) sum += reachOf(b);
  return sum;
}

/**
 * True once nothing that can still happen would change the verdict.
 *
 * THE OLD VERSION OF THIS WAS WRONG, twice, and both errors were the same
 * mistake: assuming a partial result is a final one.
 *
 * It returned true as soon as the shot SCORED. But scoring both reds does
 * not end anything — the cue ball is still rolling, and touching the
 * yellow afterwards turns the point into a foul. It also returned true as
 * soon as the cue ball came to rest, on the reasoning that every rule is
 * about what the cue ball touched; that one is now true, but only because
 * rules.js was made to say so explicitly (a red rolling into a stopped
 * cue ball used to count). Measured across 252 shots, two changed verdict
 * after this said they could not.
 *
 * The sound version asks the question directly: is there any ball left
 * whose next contact could change the answer, and can the cue ball still
 * get to it? The open set is the reds not yet touched, plus the yellow
 * while a foul on it is still possible. If every one of them is further
 * away than the table's whole remaining energy could carry anything, the
 * shot is over — whatever it looks like on screen.
 *
 * Verified over 3,276 shots (every stage, every 7 degrees, three speeds):
 * zero disagreements with the verdict read at full rest, and it arrives
 * 1.6 seconds earlier on average.
 */
function shotDecided() {
  const cue = cueBall();
  const u = P.contactVelocity(cue);
  if (
    Math.hypot(cue.vx, cue.vy) < P.STOP_SPEED &&
    Math.hypot(u.x, u.y) < P.STOP_SPEED
  ) {
    return true;
  }
  const v = judgeFourBall(state.world.events, {
    cueId: "cue",
    redIds: ["red1", "red2"],
    opponentId: "yellow",
  });
  const open = ["red1", "red2"].filter((id) => !v.contacted.includes(id));
  if (v.foul !== FOUL.OPPONENT) open.push("yellow");
  const reach = tableReach();
  return open.every((id) => {
    const o = P.getBall(state.world, id);
    return Math.hypot(o.x - cue.x, o.y - cue.y) - 2 * P.BALL_RADIUS > reach;
  });
}

function settle() {
  paintStatus();
  const ai = state.mode === "versus" && state.turn === "ai";
  const verdict = judgeFourBall(state.world.events, {
    cueId: ai ? "yellow" : "cue",
    redIds: ["red1", "red2"],
    opponentId: ai ? "cue" : "yellow",
    // Free play is the only mode that scores a foul. The campaign judges
    // a stage pass or fail and has nothing to deduct from; free play is a
    // running total, which is where touching the opponent's ball costs
    // something the way it does at a real table.
    penalizeFoul: timed(),
  });

  // Free play settles and stops. No stars, no reset, no stuck card — the
  // balls stay exactly where they stopped and the next shot is whatever
  // that leaves you, which is the mode. The only feedback is the name of
  // what you just did, because "Two cushions" is worth knowing and is the
  // one thing about 4구 a newcomer cannot see for themselves.
  if (timed()) {
    const mine = state.turn === "player" || state.mode === "free";
    if (verdict.points > 0) {
      if (mine) state.freePoints += verdict.points;
      else {
        state.aiPoints += verdict.points;
        // How many the opponent has made without leaving the table. Its
        // next shot is chosen against this, so a break gets harder as it
        // gets longer instead of running to the finish.
        state.aiRun++;
      }
      setBanner(verdict.kind + " \u00b7 point", 1400);
    } else if (verdict.points < 0) {
      // A foul pushes a bead back onto the rod — but only as far as the
      // rack you started with. Unbounded, a bad run makes the game longer
      // than it began, and a target that recedes while you play is not a
      // target. So the floor is zero points made, and a foul at a full
      // rack costs the turn and nothing else, which the banner says.
      const who = mine ? "freePoints" : "aiPoints";
      const before = state[who];
      state[who] = Math.max(0, before + verdict.points);
      const moved = state[who] !== before;
      const what = verdict.foul === FOUL.NO_CONTACT ? "Hit nothing" : "Yellow ball";
      setBanner(moved ? `${what} \u00b7 one back` : what, 1400);
    }
    // Back to centre ball. In the campaign the same position comes round
    // again and again and a remembered tip is a setting; here the table
    // never repeats, so a tip left over from the last shot is a surprise
    // waiting on the next one.
    state.tip = { side: 0, vertical: 0 };
    updateHud();

    if (state.freePoints >= state.target) return endRun(true);
    if (state.mode === "versus" && state.aiPoints >= state.target) return endRun(false);

    if (state.mode === "versus" && !verdict.scored) {
      // A miss hands the table over. This is the only rule in the mode
      // that is not already in rules.js, and it is the one that makes the
      // opponent's leave matter: what they left you is what you have to
      // play, for as long as you keep making it.
      state.turn = state.turn === "player" ? "ai" : "player";
      state.aiRun = 0;
      paintScoreboard();
      setBanner(state.turn === "ai" ? "Opponent's table" : "Your table", 1200);
    }
    state.phase = "aim";
    resetShotState();
    if (state.mode === "versus" && state.turn === "ai") aiTurn();
    return;
  }

  if (verdict.scored) {
    missStreak = 0;
    state.points++;
    // A RUN THAT STILL OWES POINTS PLAYS ON FROM HERE.
    //
    // This is the whole of hard and extreme, and it is the question four
    // ball actually asks: not "can you make this shot" but "can you keep
    // going". The stopped position becomes the leg, so a miss from now on
    // returns to the table the player made rather than to the deal — a
    // reset to the deal would quietly delete the point they just scored.
    //
    // tools/chain-check.mjs is what makes this safe to ship: every one of
    // the hundred layouts is proved to have a scoring line left after the
    // first point, and after the second.
    if (state.points < need()) {
      state.leg = snapshotBalls();
      state.phase = "aim";
      resetShotState();
      updateHud();
      setBanner(`${state.points} of ${need()} \u2014 play on from here`, 1900);
      return;
    }
    state.cleared = true;
    state.phase = "result";
    const stars = starsFor(stage(), state.shots, state.level);
    // Persisted here and nowhere else. recordStageCleared() keeps only
    // what beats the existing record, so replaying a stage badly can
    // never cost a player a star they already earned.
    recordStageCleared(storageId(state.stageIndex), state.shots, stars, state.level);
    trackEvent("game_win", { mode: "campaign", stage: storageId(state.stageIndex), level: state.level, shots: state.shots, stars });
    // How far through the campaign this player is. It is the only
    // progress number the portal will ever show us, and it is what says
    // whether a hundred stages is enough.
    const done = STAGES.filter((_, i) => isStageCleared(storageId(i))).length;
    reportProgress((done / STAGES.length) * 100);
    // A card, not a banner that fades. The most valuable thing on this
    // screen is one tap to the next stage: playtime is made of "a reason
    // to start the next one", and a result that dissolves back to the
    // same table leaves the player nowhere to go. Daily Five had to bolt
    // this on eight days after launch; it is cheaper to be born with it.
    el.clearedStars.textContent = "\u2605".repeat(stars) + "\u2606".repeat(3 - stars);
    el.clearedKind.textContent =
      (state.level === 0 ? "" : LEVEL_NAMES[state.level] + " \u00b7 ") +
      verdict.kind + " \u00b7 " + state.shots + (state.shots === 1 ? " try" : " tries");
    // The primary stays "next stage" everywhere it can be, because a
    // result screen that routes back through a menu is where a session
    // ends — the one Daily Five finding this project has never had to
    // relearn. On the last stage there IS no next, and the grid of what
    // you have done is the only honest thing to offer.
    // And "next" means the next stage AT THIS DIFFICULTY. On hard, the
    // stage after this one is only open if it has been beaten normally,
    // so a player running ahead on hard is sent to the grid rather than
    // into a stage that would silently drop them back to normal.
    el.btnNext.textContent = nextStageIsOpen() ? "Next stage" : "Stage select";
    el.cleared.hidden = false;
    // A cleared stage is a completed game as far as the portal is
    // concerned: the player is on a card, not at the table.
    onGameOver();
    setBanner(null);
    return;
  }

  // A missed problem resets to its own placement rather than playing on
  // from where the balls stopped. This is NOT how a 4구 match works, and
  // it is on purpose: a stage exists to make one shot unavoidable, and a
  // stage that drifts into a random layout after the first miss has
  // stopped asking its question. Match play, where the wreckage is the
  // point, is the online mode's job.
  state.phase = "result";
  const why =
    verdict.foul === FOUL.OPPONENT
      ? "You hit the yellow"
      : verdict.foul === FOUL.NO_CONTACT
        ? "You hit nothing"
        : verdict.contacted.length === 1
          ? "Only one red"
          : "Missed";

  if (missStreakStage !== stage().id) {
    missStreakStage = stage().id;
    missStreak = 0;
  }
  missStreak++;

  if (shouldOffer()) {
    lastOfferAt = performance.now();
    el.stuckWhy.textContent = why;
    el.stuck.hidden = false;
    return;
  }

  setBanner(why, 1500);
  setTimeout(() => {
    if (!state.cleared) resetBalls();
  }, 900);
}

/** Last written, so the DOM is only touched when the number changes.
 * This runs every frame. */
let chromeLeft = -1;
let chromeRight = -1;

/**
 * Line the header up with the table.
 *
 * The table's own edges are known only after the layout is computed, and
 * they move with the window, so the two numbers go out to CSS as custom
 * properties rather than being guessed at in the stylesheet.
 */
function alignChrome(L) {
  const f = LAY.tableFrame(L);
  const left = Math.max(6, Math.round(f.left));
  const right = Math.max(6, Math.round(L.width - f.right));
  if (left === chromeLeft && right === chromeRight) return;
  chromeLeft = left;
  chromeRight = right;
  el.app.style.setProperty("--table-left", `${left}px`);
  el.app.style.setProperty("--table-right", `${right}px`);
}

function draw() {
  const size = R.prepareCanvas(canvas, ctx);
  state.layout = LAY.tableLayout(size.width, size.height);
  alignChrome(state.layout);
  ctx.clearRect(0, 0, size.width, size.height);

  R.drawTable(ctx, state.layout);

  // Held back until after the balls. A cue stick passing behind a ball it
  // is nowhere near is the one thing on this table that cannot happen in
  // a room: the stick is above the cloth and the balls are on it.
  let cueArgs = null;
  // What the BAR shows, which is not always what the shot holds: during
  // the attract demo the bar is driven by the demo. That is the whole
  // teaching device. A cue drawing itself back while the bar it is
  // supposedly attached to sits still says the two are unrelated —
  // which is the one thing a new player must not conclude, because the
  // bar is the trigger. Pulled together, in a loop, on the front screen,
  // it needs no words at all.
  let barPower = state.aim.power;

  if (state.phase === "aim" || state.phase === "thinking") {
    const shot = currentShot();
    if (state.attract) {
      // The demo stroke: draw back, hold, let go, wait. Deliberately the
      // CONTROL and not the game — no ball moves, because a ball moving
      // on its own is the glitch Daily Five had to withdraw.
      const cycle = (performance.now() % 2600) / 2600;
      const pull =
        cycle < 0.45
          ? cycle / 0.45
          : cycle < 0.6
            ? 1
            : cycle < 0.68
              ? 1 - (cycle - 0.6) / 0.08
              : 0;
      shot.power = pull * 0.45;
      barPower = shot.power;
    }
    // On the front screens the table is scenery: the cue keeps stroking,
    // because a still table behind a title is a screenshot and a moving
    // one is a game, but every piece of HUD comes off. A ghost ball, a
    // dashed aim line and a "45%" tag sitting under a wordmark are three
    // answers to questions the player has not asked, and the spin dial
    // and nudge arrows read as controls that do nothing — which, on this
    // screen, they are.
    const onstage = state.screen === "play";
    // The cue is drawn back whenever there is a shot standing, not only
    // while a hand is on the control. That IS the feedback now: the two
    // controls set a shot and then let go of it, so the only thing
    // telling the player what they have set up is the stick.
    const live = state.armed || state.dragging || state.attract;
    // Whoever is at the table. In versus that is the yellow for half
    // the game, and a cue drawn on the white while the yellow is being
    // played is the game lying about whose shot it is.
    const at = shooter();
    const aim = R.computeAim(state.world, at, shot.dirX, shot.dirY);
    const path = live && !state.attract ? previewFor(shot) : null;
    // The preview replaces the aim guide rather than joining it. They
    // disagree by construction — the guide draws a straight line to first
    // contact, the preview draws where the ball actually goes — and two
    // lines from one ball saying different things is worse than either.
    if (!onstage) {
      // nothing: on the front screens the table is scenery
    } else if (live && !path) {
      R.drawAim(ctx, state.layout, at, aim);
    } else if (live) R.drawPreview(ctx, state.layout, path);
    // The cue is on the table even before anyone touches it, drawn back
    // only once a shot is loaded. A control nobody has discovered yet
    // still has to be visible — the stick is how a player learns that the
    // drag is a stroke.
    cueArgs = [
      at,
      shot.dirX,
      shot.dirY,
      live ? shot.power : 0,
      state.tip.side,
    ];
  }

  R.drawBalls(ctx, state.layout, state.world.balls);
  if (cueArgs) R.drawCue(ctx, state.layout, ...cueArgs);
  if (state.screen === "play") {
    R.drawControls(ctx, state.layout, {
      held: state.held,
      power: barPower,
      live: state.laneDrag || state.attract,
    });
    R.drawSpinDial(ctx, state.layout, state.tip, P.MAX_TIP_OFFSET);
  }
}

// --- chrome -----------------------------------------------------------

function paintSoundButton() {
  const on = isSoundEnabled();
  el.sound.textContent = on ? "Sound on" : "Sound off";
  el.sound.setAttribute("aria-pressed", String(on));
  el.homeSound.textContent = on ? "Sound on" : "Sound off";
  el.homeSound.setAttribute("aria-pressed", String(on));
}
el.sound.addEventListener("click", () => {
  unlockAudio();
  toggleSound();
  paintSoundButton();
refreshPreviewButton();
});
paintSoundButton();
refreshPreviewButton();

function closeMenu() {
  el.menu.hidden = true;
}
el.menuOpen.addEventListener("click", () => {
  el.retry.textContent = timed() ? "Start again" : "Restart this stage";
  el.toStages.hidden = timed();
  el.menu.hidden = !el.menu.hidden;
  // Opening the menu is a break; closing it is a resume.
  if (el.menu.hidden) notifyGameplayStart();
  else notifyGameplayStop();
});
el.menuClose.addEventListener("click", () => {
  closeMenu();
  if (state.screen === "play") notifyGameplayStart();
});
el.btnNext.addEventListener("click", () => {
  if (!nextStageIsOpen()) {
    openStageMap(state.level);
    return;
  }
  startCampaign(state.stageIndex + 1, state.level);
});
el.btnVersus.addEventListener("click", () => openSetup("versus"));
el.setupBack.addEventListener("click", () => showScreen("home"));
el.setupStart.addEventListener("click", () => {
  setMatchSetup({ target: setupTarget, level: setupLevel });
  if (setupMode === "versus") startVersus(setupTarget, setupLevel);
  else startFree(setupTarget);
});
el.runoverAgain.addEventListener("click", () => {
  if (state.mode === "versus") startVersus(state.target, state.aiLevel);
  else startFree(state.target);
});
el.runoverHome.addEventListener("click", () => goHome());

el.preview.addEventListener("click", () => {
  // Both timed modes, not just practice. The button was drawn in versus
  // and then refused every press, because this line asked for "free"
  // while the code that draws it asks for timed() — a control that is
  // visible and inert is worse than one that is not there.
  if (!timed() && previewLeft === 0 && !previewArmed) return;
  // Pressing a HUD button is a player who has started, so the demo card
  // goes — and it has to go BEFORE the tip appears, or the two are on
  // screen together saying different things.
  wakeUp();
  previewArmed = !previewArmed;
  previewCache = null;
  refreshPreviewButton();
  // The one thing about the preview that nobody works out on their own.
  // The route needs a speed as well as a line, and the only way to have
  // a speed standing BEFORE the shot goes is to tap the bar rather than
  // pull it — so the moment the preview is switched on is the moment
  // that is worth one sentence.
  if (previewArmed && !hasSeenBriefing("preview-power")) {
    showTip("Tap the bar to set a speed, then turn the cue — the route follows your aim. Pull the bar when it looks right.");
    markBriefingsSeen(["preview-power"]);
  } else if (!previewArmed) {
    hideTip();
  }
});

el.undo.addEventListener("click", () => {
  // Also while the balls are still rolling. Practice is a loop of "that
  // was wrong, again" and the answer is already known long before the
  // white stops; making the player watch the rest of a shot they have
  // already given up on is the slowest part of the loop.
  if (state.mode !== "free" || adBusy) return;
  if (state.phase !== "aim" && state.phase !== "rolling") return;
  wakeUp();
  const snap = undoStack.pop();
  if (!snap) return;
  state.world = snap.world;
  P.resetEvents(state.world);
  state.freePoints = snap.points;
  state.shots = snap.shots;
  state.tip = { side: 0, vertical: 0 };
  state.decidedFor = 0;
  state.heard = 0;
  previewCache = null;
  setBanner("Back one shot", 1100);
  updateHud();
  // resetShotState() puts the phase back to "aim", which is also what
  // stops the frame loop stepping a shot that has just been undone.
  resetShotState();
});

el.btnNoThanks.addEventListener("click", dismissStuck);
el.btnWatch.addEventListener("click", async () => {
  if (adBusy) return;
  adBusy = true;
  el.btnWatch.disabled = true;
  el.btnWatch.textContent = "Loading\u2026";
  const outcome = await requestRewardedHint();
  adBusy = false;
  el.btnWatch.disabled = false;
  el.btnWatch.textContent = "Get a free preview";
  if (outcome === "granted") {
    offerMisses = 0;
    setPreviewsHeld(1);
    previewArmed = true;
    refreshPreviewButton();
    setBanner("Preview ready \u2014 aim and it draws the path", 2600);
  } else if (outcome === "unfilled") {
    // Nothing was there to watch. Say so plainly rather than pretending
    // the player declined something.
    offerMisses++;
    setBanner("No ad available right now", 1800);
  }
  dismissStuck();
});

el.btnAgain.addEventListener("click", () => {
  state.shots = 0;
  state.cleared = false;
  el.cleared.hidden = true;
  dealStage();
  resetBalls();
  resetControls();
  updateHud();
});

el.toStages.addEventListener("click", () => {
  closeMenu();
  openStageMap();
});
el.toHome.addEventListener("click", () => {
  closeMenu();
  goHome();
});
/**
 * Start this stage again from its own deal.
 *
 * Two buttons call it: the header one, which is in the campaign's loop
 * because a two or three point run is restarted often, and the menu one,
 * which is the only way in for the timed modes.
 */
function restartStage() {
  closeMenu();
  state.shots = 0;
  state.cleared = false;
  el.cleared.hidden = true;
  if (state.mode === "free") {
    state.freePoints = 0;
    state.world = P.createWorld({ balls: ballsFrom(OPENING) });
    resetShotState();
  } else {
    // The whole run, not the leg: retry means the stage as it was dealt,
    // with the points given back. Anything else would let a player bank
    // the hard half of a run and retry only the part they missed.
    dealStage();
    resetBalls();
  }
  resetControls();
  updateHud();
  setBanner(null);
}

el.retry.addEventListener("click", restartStage);
el.restartNow.addEventListener("click", restartStage);

el.btnPlay.addEventListener("click", () => {
  unlockAudio();
  const resume = getContinuePoint();
  startCampaign(Math.min(STAGES.length, resume.id) - 1, resume.level);
});
for (const tab of el.mapTabs) {
  tab.addEventListener("click", () => {
    mapLevel = Number(tab.dataset.level);
    paintStageMap();
  });
}
el.btnStages.addEventListener("click", () => {
  unlockAudio();
  openStageMap();
});
el.btnFree.addEventListener("click", () => {
  unlockAudio();
  openSetup("free");
});
el.mapBack.addEventListener("click", goHome);
el.btnTables.addEventListener("click", () => {
  unlockAudio();
  paintTables();
  showScreen("tables");
});
el.tablesBack.addEventListener("click", goHome);
el.homeSound.addEventListener("click", () => {
  unlockAudio();
  toggleSound();
  paintSoundButton();
});
window.addEventListener("blur", stopRepeat);

// Boot on the home screen, with the stage the player would resume
// already laid out on the table behind it. The wordmark is over a real
// position from the real campaign, which is the whole reason the gate is
// allowed to be a gate.
// The saved table, before anything is drawn. applyTheme() drops the table
// bitmap and every ball sprite, so doing it after the first frame would
// paint one frame of the default table and then throw it away.
R.applyTheme(getTheme());
const boot = getContinuePoint();
loadStage(Math.min(STAGES.length, boot.id) - 1, boot.level);
goHome();
requestAnimationFrame(frame);

/**
 * THE SAVE ARRIVES A MOMENT AFTER THE SCREEN DOES.
 *
 * storage.js has to answer synchronously at import time — every line
 * above this one reads from it — but the CrazyGames SDK's copy of the
 * save cannot be read until SDK.init() resolves. So the first screen is
 * built from localStorage, and inside a portal iframe localStorage is
 * routinely empty or partitioned away: a returning player was shown a
 * brand-new game, no stages cleared, no tables, no records. The save was
 * never lost — it landed a second later and nothing repainted, so the
 * screen went on lying until a reload. It is the one failure that can
 * only happen on the portal, which is why nothing here catches it.
 *
 * storage.js has exported this promise for exactly this since it was
 * written. Nothing was listening.
 *
 * Repainting is limited to the front screens: if the player has already
 * started a stage by the time this lands, their table is theirs, and
 * pulling it out from under them would be a worse bug than the one being
 * fixed. The theme, the sound button and the preview count are safe
 * anywhere.
 */
storageSynced.then(() => {
  R.applyTheme(getTheme());
  paintSoundButton();
  refreshPreviewButton();
  if (state.screen === "home" || state.screen === "stages" || state.screen === "tables") {
    const point = getContinuePoint();
    loadStage(Math.min(STAGES.length, point.id) - 1, point.level);
    paintHome();
    paintStageMap();
    paintTables();
    showScreen(state.screen);
  }
});

// Exposed for the screenshot and QA tools, which need to place balls and
// fire a known shot without a pointer.
//
// LOCAL ONLY. "Harmless in the shipped build" is what this comment used
// to say, and it is not: the object hands anyone with a console the
// power to set their own score, skip a stage and fire a shot out of
// turn in the AI game. It costs the tools nothing to be gated — they
// drive the game over localhost — and it costs a player nothing to lose
// a handle they were never meant to have.
if (isLocalDev()) window.__fourball = {
  state,
  P,
  loadStage,
  fire,
  goHome,
  startCampaign,
  startFree,
  startVersus,
  updateHud,
  showScreen,
  paintStageMap,
  /** Read-only view of the ad-offer gates, for the screenshot suite. The
   * offer has four conditions and a bug in any of them is invisible from
   * the outside — the card simply never appears. */
  offer: () => ({ missStreak, missStreakStage, previewLeft, previewArmed, offerMisses, adBusy }),
};
