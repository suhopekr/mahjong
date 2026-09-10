// main.js
// The entry point: screens, the animation loop, pointer input, the AI's
// turn, and the campaign's progression. Everything genuinely game-shaped
// lives in game/*.js and is Node-tested; this file is the DOM glue, and
// per the series' established rule it is deliberately NOT a unit-test
// target — changes here are verified by actually playing in a browser
// (test/browser-check.mjs). Every bug of consequence in the previous two
// projects — a broken control, an asymmetric hit box, audio that never
// unlocked on iOS — was in this layer and was only ever found that way.

import { attachPointerHandlers } from "./core/input.js";
import {
  storageSynced,
  isSoundEnabled,
  toggleSound,
  getClearedStageIds,
  getHardClearedStageIds,
  isStageCleared,
  isStageUnlocked,
  recordStageCleared,
  getBestTurns,
  getStars,
  getTotalStars,
  isHardUnlocked,
  isHardCleared,
  isPvpAimGuideOn,
  setPvpAimGuide,
  getPracticeLevel,
  setPracticeLevel,
  AI_LEVELS,
  starsForShots,
  MAX_STARS,
  getContinuePoint,
  setLastStageId,
  incrementVersusGamesCompleted,
  getVersusStoneCount,
  setVersusStoneCount,
  getTheme,
  setTheme,
  themeUnlockContext,
  getSeenBriefings,
  markBriefingsSeen,
  getSeenTips,
  hasSeenTip,
  markTipSeen,
  getPreviewsHeld,
  setPreviewsHeld,
} from "./core/storage.js";
import {
  unlockAudio,
  playFlickSound,
  playImpactSound,
  playObstacleSound,
  playBumperSound,
  playPortalSound,
  playFallSound,
  playSinkSound,
  playWinSound,
  playLoseSound,
  playAchievementSound,
  playComboSound,
  playButtonSound,
} from "./core/audio.js";
import { notifyGameplayStart, notifyGameplayStop, notifyLoadingStart, notifyLoadingStop, onGameOver, requestRewardedHint, getAdSdkReadyState } from "./core/ads.js";
import { STAGES, VERSUS_STONE_COUNTS, versusLayout, getStage, stageTitleParts, nextStageId, FIRST_STAGE_ID, LAST_STAGE_ID } from "./game/stages.js";
import { createMatch, selectableStones, shoot, advance, countAlive, pickStartingPlayer } from "./game/arena.js";
import {
  boardLayout, stoneAtPoint, toBoard, dragToShot,
  MIN_DRAG, MIN_DRAG_TOUCH, MAX_DRAG, CANCEL_RELEASE,
} from "./game/layout.js";
import { simulateShotPath } from "./game/preview.js";
import { isChapterEnd, summariseChapter } from "./game/chapters.js";
import { TIPS, chapterTip, tipForLoss } from "./game/tips.js";
import { fitCanvasToDisplaySize, drawScene, DEFAULT_THEME } from "./game/render.js";
import { getThemeById, getUnlockedThemeIds, resolveActiveThemeId, THEMES } from "./game/themes.js";
import { chooseShot } from "./game/ai.js";
import {
  createSeries,
  openerFor,
  recordRound,
  recordDrawShot,
  seriesOutcome,
  ROUNDS_PER_MATCH,
} from "./game/series.js";
import { MAX_FLICK_SPEED, STONE_RADIUS } from "./game/physics.js";
import { briefingsForStage, aimLineBriefing } from "./game/briefings.js";
import { createBriefingDemo } from "./core/briefing-demo.js";

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
      window.gtag("event", name, { game_name: "stone_flick", ...params });
    }
  } catch {
    // Measurement failures are never allowed to reach the player.
  }
}

/**
 * Every link that leaves for another game on this site.
 *
 * There used to be exactly one — "More free games →" on the menu screen —
 * and it was wired by id. The top bar replaced it with a wordmark and a
 * panel of game cards (DESIGN.md "Site navigation"), so this is
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
        from: "stone_flick",
        to: a.dataset.crossgameTo,
        placement: a.dataset.placement || "unknown",
      });
    });
  }
}

// Opened here, at the top of module evaluation, and closed after the
// first screen is built. core/ads.js has always exported both halves and
// main.js only ever called the second, which is the kind of asymmetry a
// portal QA pass notices before we do: a loadingStop with no matching
// start is either ignored or logged as a warning, and in neither case
// does it say what it was meant to say. This game loads in milliseconds
// so the pair reads as ~0ms today; it becomes meaningful the moment
// anything genuinely async joins the boot.
notifyLoadingStart();

const $ = (id) => document.getElementById(id);

// Inline SVG icons rather than emoji. The previous game in this series
// made this exact swap and recorded why: an emoji is a font glyph, so it
// renders as a flat outline on one platform and a colored blob on
// another, it cannot take the UI's own color, and its metrics differ
// enough between platforms to knock a 42px button off center. These are
// stroked with `currentColor`, so they inherit whatever the button does.
const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  soundOn:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h3.5L12 19V5L7.5 9H4z" fill="currentColor" stroke="none"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7"/><path d="M18.7 5.6a8.5 8.5 0 0 1 0 12.8"/></svg>',
  // RESTART, and the shape matters more than it looks like it should.
  // The first version was the common "rotate" glyph: a three-quarter arc
  // with a corner bracket for a head. It was read as UNDO — reported
  // within a day — and that reading is fair, because an open hook with a
  // bracket tip is exactly how undo is drawn everywhere. The difference
  // between the two icons is not the arrow, it is whether the loop
  // CLOSES: undo is a hook that turns back, restart is a ring that comes
  // round. So this is 310 degrees of circle with a solid triangular head
  // that points along the direction of travel, and the gap is small
  // enough that the eye completes it.
  restart:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.6 7.2A7.4 7.4 0 1 1 12 4.6" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="M11.3 1.8l4.4 2.8-4.4 2.8z" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45 6.19 20.5 7.3 14.03 2.6 9.45l6.5-.95L12 2.6z"/></svg>',
  // BOARD THEME as a palette, not a paint tin or a swatch grid: the
  // thing being chosen is the surface the game is played on, and a
  // palette is the one glyph that means "pick an appearance" without
  // meaning "edit" as well.
  palette:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-.5-.2-.8-.5-1.1-.3-.4-.5-.7-.5-1.2 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.1-4-7.7-9-7.7z" stroke-linejoin="round"/><circle cx="7.5" cy="11.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/></svg>',
  gear:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3.6a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3.6a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
  soundOff:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h3.5L12 19V5L7.5 9H4z" fill="currentColor" stroke="none"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>',
  // The preview, drawn as what it draws: a curve that turns at a contact
  // and carries on dotted. Not an eye and not a lightbulb — both of those
  // say "hint" in the abstract, and the specific promise here is a PATH,
  // including the part where the path does not go where you pointed it.
  preview:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 18.5C6 12 9 8.5 13 8.5"/><path d="M13 8.5c3.4 0 4.8 3 7.5 4" stroke-dasharray="2.6 2.6"/><circle cx="13" cy="8.5" r="1.9" fill="currentColor" stroke="none"/></svg>',
  // The other games on the site, as four tiles: a grid is the one glyph
  // that means "a set of things to choose from" without also meaning
  // "settings" (a gear) or "more of this" (an ellipsis). It is the same
  // shape the panel it opens actually has.
  // Stroked, not filled: filled tiles came out heavier than the stroked
  // restart and sound glyphs beside it, and the odd one out in a row of
  // controls reads as the one that is switched ON.
  games:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="3.6" y="3.6" width="7" height="7" rx="1.8"/><rect x="13.4" y="3.6" width="7" height="7" rx="1.8"/><rect x="3.6" y="13.4" width="7" height="7" rx="1.8"/><rect x="13.4" y="13.4" width="7" height="7" rx="1.8"/></svg>',
};

const canvas = $("board");
const boardWrap = $("board-wrap");
const overlay = $("overlay");
const briefOverlay = $("brief-overlay");
const live = $("live");

let ctx = canvas.getContext("2d");
let layout = boardLayout(320, 320);

/** The live match, or null outside the game screen. */
let match = null;
let mode = "campaign";
/**
 * Whether the aim indicator extrapolates the shot's line across the board
 * (see drawAim's `guide`). On in the campaign, off in every mode where a
 * person is on the other side.
 *
 * A separate variable rather than `mode === "campaign"` at the call site,
 * because the modes that switch it off are not one mode: two-player is
 * here today, and solo practice and online matches are both defined by
 * having it off. Reading it from a single flag means each of those only
 * has to set it, not be special-cased in the renderer's call.
 */
let aimGuide = true;
/** Campaign only: the same layout with the aim guide removed, scored on
 * its own star track. Not a separate `mode` — it is the same campaign
 * match, and everything except the guide and which record it writes to
 * behaves identically. */
let hardMode = false;
/** Which difficulty the stage list is showing. UI state only — the match
 * takes its difficulty from the card that started it. */
let gridHard = false;
/** Practice is fixed at the count online will use. */
const PRACTICE_STONES = 5;

/**
 * What the current mode IS, rather than what it is called.
 *
 * The mode was being asked about by string in nine places, each deciding
 * a different thing — who may be flicked, who the AI plays for, whether
 * shots are counted, which result card to build. Adding a third mode
 * meant revisiting all nine and getting all nine right, which is the
 * shape of bug that put Restart back on normal difficulty: one caller of
 * a pair was already correct, so the pattern looked fine wherever you
 * happened to look.
 *
 * These name the CAPABILITY each site actually cares about. A fourth mode
 * (online) then has to answer three questions rather than be found in
 * nine conditionals.
 */
const vsComputer = () => mode === "campaign" || mode === "practice";
const isCampaign = () => mode === "campaign";
let stage = null;
/** Only the human's own shots, which is what "cleared in N turns" means
 * to a player — counting both sides' turns would make the number depend
 * on the AI and stop being a personal best. */
let playerShots = 0;
/** The two-player match in progress: two rounds and their results. See
 * game/series.js for why a match is not a single round. */
let series = null;
/** Shots each side has taken this round — the third tiebreak. */
let roundShots = [0, 0];
/** The draw-shot decider in progress, when a match came out level:
 * `{ order, taken }` — who shoots in which order, and each side's result
 * so far. Null whenever no decider is running. */
let decider = null;
/** Milliseconds the result card waits before covering the board. Only the
 * draw-shot reveal uses it; everything else shows its card at once. */
let resultHold = 0;

/** Set when a match ends in a win. The interstitial is deliberately NOT
 * shown the moment the result card appears — it fires when the player
 * leaves it. Two reasons, both learned from how this game actually
 * plays:
 *
 *   - An ad on top of "Stage clear" lands while the player is still
 *     reading their own result. On the way to the next stage they are
 *     already in a transition, which is the least intrusive break a
 *     stage game has.
 *   - A LOSS never arms it at all. Failing and retrying immediately is
 *     this game's core loop — a stage can be lost in twenty seconds —
 *     so counting losses would put an ad in front of a player every
 *     couple of failures, precisely when they are most frustrated. The
 *     previous game in this series counted every game-over because a
 *     loss there ended a match that had run for minutes; that
 *     assumption does not survive the move to short stages.
 */
let adPending = false;

/** Drag state for the slingshot. */
let dragging = null; // { stoneId, pointerBoard }

// --- shot preview -------------------------------------------------------
//
// EARNED FROM A REWARDED AD, SPENT ON A SHOT. Two separate controls, and
// the separation is the whole design, because CrazyGames' advertisement
// requirements say a rewarded ad's REQUEST button "should not appear on
// an active gameplay screen":
//
//   - the REQUEST lives on the result card after a loss, which is not a
//     gameplay screen and is where a stuck player already is
//   - the SPEND lives in the game bar, because arming a preview is
//     something you do while deciding on a shot — and a button that
//     spends something you already own is not requesting an ad, so
//     nothing in those rules touches it
//
// It is not free and not per-game: one earned charge waits until it is
// used. PERSISTED, in core/storage.js, and that is not an afterthought —
// it was paid for with a rewarded ad, so it has to behave like something
// the player owns. It survives a Restart, it survives closing the tab,
// and it follows them to whatever stage they play next, because it was
// earned by the PLAYER and not by the stage they happened to lose on.
//
// ARMED, then SPENT ON THE SHOT — not spent on the look. While it is
// armed every angle the player drags shows its real path, and the charge
// goes when they let go of a shot they meant. Being able to change your
// mind is the whole value of it: a preview you could only point in one
// direction would be a worse hint than no hint. Pressing the button again
// disarms it, so an accidental press costs nothing.
//
// NOT IN HARD MODE. Hard mode is DEFINED by having no aim guide (see
// startStage), and a preview is a far stronger guide than the line it
// removes. Offering it there would make hard stars mean less than normal
// ones, which is the exact failure the setting that could put the guide
// back was refused to avoid.
/** Mirrors core/storage.js's count so the render path can read it every
 * frame without touching the save. storage is the source of truth; this
 * is only ever written through spendPreview()/grantPreview(). */
let previewLeft = 0;
let previewArmed = false;
let previewPending = false;
// Consecutive losses on the CURRENT stage, and when the offer was last
// put in front of the player. Both are gates the requirements ask for by
// name: an out-of-lives style rewarded ad must not be offered "each time
// a user dies", and "do not offer a rewarded ad too often — inform the
// user of this with a timer or hide the ad request button". A player who
// lost once is playing; two in a row on the same stage is stuck.
let lossStreak = 0;
let lossStreakStage = null;
let lastOfferAt = -Infinity;
const OFFER_MIN_LOSSES = 2;
const OFFER_COOLDOWN_MS = 120_000;
// Consecutive requests that never became an ad. Two of those and the
// offer stops for the session, because there is nothing behind it: an ad
// blocker, no inventory — or Basic Launch, where CrazyGames' own
// monetization is switched off by definition and EVERY request comes back
// unfilled. A game that keeps offering a reward it cannot hand over,
// during exactly the window in which the portal is deciding whether to
// promote it, is showing its worst face to the people scoring it.
//
// Counts "unfilled" only. A player who starts an ad and closes it has
// made a choice, and punishing that by taking the offer away would be
// reading a decision as a fault. Session-scoped, so a next visit — or a
// Full Launch — tries again from scratch.
let offerMisses = 0;
const OFFER_MAX_MISSES = 2;
// Blocks input, and the AI, while an ad is being requested or shown:
// "Ensure that a user cannot progress the game while requesting or
// showing an ad." The result card already covers the board, so this is
// belt and braces — and the thing that keeps it true if the offer moves.
let adBusy = false;
// The simulation is ~2000 substeps and the pointer moves every frame, so
// the result is cached against the shot that produced it. The key is
// rounded: a shot re-computed for a tenth of a degree is a shot
// re-computed for nothing.
let previewCache = null;
/** Stones removed recently, still shrinking out. */
let fading = [];
/** Seconds since the game screen opened — drives the selection pulse. */
let phase = 0;
let rafId = null;
let lastFrameTime = 0;
let aiTimer = null;

// --- screens -------------------------------------------------------------
const SCREENS = ["menu", "stages", "settings", "practice", "versus", "themes", "game"];
let screenStack = ["menu"];

/**
 * THE SITE BAR TAKES A REAL ROW, SO IT COMES OFF WHILE A MATCH IS UP.
 *
 * DESIGN.md §6. Two reasons: the board's geometry is measured in JS from the
 * live box, and a permanent band along the top edge of a surface you pull a
 * stone back on is a mis-tap generator.
 *
 * The remeasure is the whole reason this is a function rather than one line
 * at each call site. body[data-nav] changes #app's height by 56px, and
 * resizeBoard() sizes the canvas AND the hit test from #board-wrap's live
 * rect — a board measured before the row has gone keeps the old height, and
 * then where the finger grabs and where the stone is drawn disagree by that
 * much. The ResizeObserver on #board-wrap would eventually catch it, a frame
 * or two later; "eventually" is the bug. So: toggle, then remeasure in the
 * same turn, before anything can paint.
 *
 * Only when the bar goes away, because that is the only direction with a
 * board on screen to measure: on the menu screens #board-wrap is inside a
 * display:none section and its rect is 0x0.
 */
function setNavHidden(hidden) {
  if ((document.body.dataset.nav === "hidden") === hidden) return;
  if (hidden) document.body.dataset.nav = "hidden";
  else delete document.body.dataset.nav;
  if (hidden) resizeBoard();
}

function showScreen(name) {
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle("active", s === name);
  // After the sections have swapped, so the box resizeBoard() measures is
  // the one the player is about to see.
  setNavHidden(name === "game");
  if (name === "game") {
    startLoop();
    notifyGameplayStart();
  } else {
    stopLoop();
    notifyGameplayStop();
    // The toast belongs to a board. Leaving one takes it with you.
    hideTipToast();
  }
}

function goTo(name) {
  screenStack.push(name);
  showScreen(name);
}

function goBack() {
  if (screenStack.length > 1) screenStack.pop();
  showScreen(screenStack[screenStack.length - 1]);
}

// --- theme ---------------------------------------------------------------
function activeTheme() {
  const id = resolveActiveThemeId(getTheme(), themeUnlockContext());
  const theme = getThemeById(id).colors;
  // Every theme other than wood inherits wood's stone-rendering knobs
  // (gradientExtent / rimStart / shadowBoost / edgeColor) implicitly by
  // simply not defining them — game/render.js falls back per property.
  // Nothing to merge here; this indirection exists only so a future
  // theme can override the board without also restating stone physics-
  // of-light values it does not care about.
  return theme ?? DEFAULT_THEME;
}

/** #rrggbb -> #rrggbb, linear in sRGB bytes. Good enough for two tones
 * this close together; a perceptual space would move the midpoint by less
 * than a code value. */
function mixHex(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

/**
 * The table the board sits on.
 *
 * This is the whole of "a different background per stage", and it is
 * deliberately not a different background per stage. A hundred stages
 * would be a hundred images to load, and every one of them would be
 * competing with a 17px obstacle for the player's attention — the exact
 * thing game/render.js's readability contract is written to prevent. What
 * a player actually reads over a session is PROGRESS, so what changes is
 * a temperature: act 1 is a warm lamplit brown and act 10 is cold and
 * blue, with the eight acts between them walking the interval. Nothing is
 * loaded and nothing is drawn.
 *
 * @param {number|null} act 1..10, or null for the menu, which belongs to
 *   no act and takes a point near the warm end rather than an average of
 *   two colours nobody is looking at.
 */
function applySurround(act = null) {
  const theme = activeTheme();
  const warm = theme.surroundWarm ?? DEFAULT_THEME.surroundWarm;
  const cool = theme.surroundCool ?? DEFAULT_THEME.surroundCool;
  const t = act === null ? 0.2 : (Math.min(10, Math.max(1, act)) - 1) / 9;
  const root = document.documentElement.style;
  root.setProperty("--table", mixHex(warm, cool, t));
  root.setProperty("--table-edge", theme.surroundEdge ?? DEFAULT_THEME.surroundEdge);
}

// --- match lifecycle -----------------------------------------------------
function startStage(id, hard = false) {
  mode = "campaign";
  decider = null;
  stage = getStage(id);
  if (!stage) return;
  // Hard is refused on a stage never beaten normally. The grid will not
  // offer it, but Continue and the result card's "Next" both compute a
  // stage id and could otherwise walk into a locked one.
  hardMode = hard && isHardUnlocked(id);
  // NOT the settings toggle. Hard mode is DEFINED by having no guide, so
  // a setting that could put it back would make its stars meaningless.
  aimGuide = !hardMode;
  setLastStageId(id, hardMode);
  trackEvent("game_start", { mode: "campaign", stage: id, hard: hardMode });
  match = createMatch({ stage, startingPlayer: 0, mode: "campaign" });
  // The act, not the stage: the table's temperature is the progress
  // readout, and a colour that changed every single stage would read as
  // flicker rather than as travel.
  applySurround(stage.act);
  resetMatchUi(stageTitleParts(stage));
  maybeShowBriefings(stage);
}

/**
 * A single board against the computer, with no obstacles.
 *
 * It is deliberately the TWO-PLAYER layout with an AI on the far side
 * rather than a campaign stage without props: the point is to practise
 * the thing the campaign does not teach — reading a shot with no line
 * drawn for you, on an open board, against someone who shoots back. That
 * is what two-player and online are, and this is where you go to get good
 * at it without another person waiting on you.
 *
 * FIVE STONES, not the two-player setting. Online will be five, and a
 * practice board that is not the shape of the thing you are practising
 * for is practice for something else.
 *
 * Nothing here is scored. No stars, no par, no progress — the moment a
 * practice board keeps a record, players start optimising the record
 * instead of practising.
 */
function startPractice() {
  mode = "practice";
  hardMode = false;
  decider = null;
  aimGuide = isPvpAimGuideOn();
  // `difficulty` rides on the layout so scheduleAiIfNeeded() reads it the
  // same way it reads a campaign stage's, with no third branch.
  stage = { ...versusLayout(PRACTICE_STONES), name: "Practice", difficulty: getPracticeLevel() };
  match = createMatch({ stage, startingPlayer: pickStartingPlayer(2), mode: "practice" });
  trackEvent("game_start", { mode: "practice", level: stage.difficulty });
  resetMatchUi(stageTitleParts(stage));
  maybeShowAimBriefing();
}

function startVersus() {
  mode = "versus";
  hardMode = false;
  decider = null;
  // Two people, one device: with the line drawn for them the opening shot
  // is a certainty rather than a judgement, and this game's measured
  // first-mover advantage rises with how reliable that shot is. Off by
  // default, and the settings screen is the way back to it.
  aimGuide = isPvpAimGuideOn();
  // The coin flip only picks who opens ROUND ONE; the other player opens
  // round two, so nothing about the match hangs on it. That is the whole
  // reason a match is two rounds — game/series.js has the measurements.
  series = createSeries({ stoneCount: getVersusStoneCount(), opener: pickStartingPlayer(2) });
  trackEvent("game_start", { mode: "versus", stones: series.stoneCount });
  startVersusRound();
  maybeShowAimBriefing();
}

function startVersusRound() {
  // The opener also takes the near seat, so round two swaps BOTH: who
  // shoots first and who shoots from the comfortable side of the table.
  const opener = openerFor(series);
  stage = versusLayout(series.stoneCount, opener);
  match = createMatch({ stage, startingPlayer: opener, mode: "versus" });
  roundShots = [0, 0];
  resetMatchUi({ label: "Round", value: `${series.rounds.length + 1} / ${ROUNDS_PER_MATCH}` });
}

// --- obstacle briefings --------------------------------------------------
//
// The first time a stage puts an obstacle in front of the player that
// they have never met, the stage pauses on a card that shows the thing
// working — the real physics, the real renderer, on a loop — and says in
// one line what it does.
//
// WHY IT IS GATED ON A SEEN SET rather than on stage number: replaying a
// cleared stage must not re-explain anything, and the stage grid does not
// unlock strictly in sequence, so "stage 13 introduces the bumper" is not
// a safe assumption about what this particular player has actually
// watched. game/briefings.js does that reasoning; this function is only
// the presentation.
//
// It runs AFTER resetMatchUi(), so the board is already built and drawn
// behind the card. That is deliberate: the player sees the stage they are
// about to play, with the new obstacle sitting on it, at the same moment
// they are told what it is. Showing the card over an empty screen would
// separate the lesson from the thing it is about.

const briefDemo = createBriefingDemo($("brief-canvas"));
/** The briefings still to show for the stage being started, in order. */
let briefQueue = [];
let briefIndex = 0;

function maybeShowBriefings(forStage) {
  showBriefings(briefingsForStage(forStage, getSeenBriefings()));
}

/** The aim-line card, once, the first time a player opens a mode that can
 * hide the line. Not tied to a stage: it is about the MODE. */
// --- pro tips ------------------------------------------------------------
//
// game/tips.js decides WHICH tip; this decides WHERE. Two surfaces and no
// more, because a third would make the game chatty:
//
//   - the result card, which the player has already stopped to read,
//   - one toast for the single tip that is about the device rather than
//     about the board, and therefore cannot wait for a card.
//
// Everything here writes through markTipSeen(), so the supply drains and
// the game gets quieter as the player gets better. That is the whole
// design: seventeen tips, each shown once, and then never again.

/** The eyebrow + sentence both surfaces share. */
function tipMarkup(tip, eyebrow = "Pro tip") {
  const text = document.createElement("span");
  text.textContent = tip.text;
  const label = document.createElement("span");
  label.className = "tip-eyebrow";
  label.textContent = eyebrow;
  return [label, text];
}

/**
 * Put a tip on the result card, or leave the line off entirely.
 *
 * Marked seen on DISPLAY rather than on dismissal: the card has no
 * dismiss for this line, and a tip the player scrolled past is a tip they
 * were given. Being shown a second one next time is better than being
 * shown the same one twice.
 */
function showResultTip(tip) {
  const box = $("result-tip");
  box.hidden = !tip;
  if (!tip) return;
  box.replaceChildren(...tipMarkup(tip));
  markTipSeen(tip.id);
}

let tipToastTimer = null;

function hideTipToast() {
  const toast = $("tip-toast");
  window.clearTimeout(tipToastTimer);
  toast.classList.remove("show");
  // Long enough for the fade in the stylesheet, and harmless if the
  // player has already moved on — `hidden` on an invisible box is not a
  // visible change.
  tipToastTimer = window.setTimeout(() => { toast.hidden = true; }, 260);
}

/**
 * THE ONE TIP THAT CANNOT WAIT.
 *
 * A phone held upright gets a board capped by its own width (see
 * maxSideForPull) — perfectly playable, but smaller and tighter than the
 * same phone turned sideways. A player has no way to discover that,
 * because nothing on screen is wrong.
 *
 * Shown once, to a touch device in portrait, on the first board they
 * open. Not shown at all on a desktop, on a tablet wide enough not to
 * care, or to anyone already holding the phone sideways — a tip that
 * tells you to do what you are already doing is noise that costs trust in
 * every later tip.
 */
function maybeShowOrientationTip() {
  if (hasSeenTip(TIPS.landscape.id)) return;
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  if (window.innerHeight <= window.innerWidth) return;
  // A tablet has room for both the board and the pull. This is the same
  // threshold the two-column layout uses to decide it has width to spare.
  if (window.innerWidth >= 820) return;
  // Never over a briefing: that card is modal, and a toast under it would
  // be a message the player cannot read or dismiss. resetMatchUi() and
  // closeBriefing() both call this, so the second path picks it up.
  if ($("brief-overlay").classList.contains("show")) return;

  const toast = $("tip-toast");
  $("tip-toast-text").replaceChildren(...tipMarkup(TIPS.landscape, "Tip"));
  toast.hidden = false;
  // Next frame, so the transition has a start state to run from.
  requestAnimationFrame(() => toast.classList.add("show"));
  markTipSeen(TIPS.landscape.id);
  window.clearTimeout(tipToastTimer);
  tipToastTimer = window.setTimeout(hideTipToast, 9000);
}

$("btn-tip-dismiss").onclick = () => {
  playButtonSound();
  hideTipToast();
};

function maybeShowAimBriefing() {
  showBriefings(aimLineBriefing(getSeenBriefings()));
}

function showBriefings(queue) {
  briefQueue = queue;
  briefIndex = 0;
  if (briefQueue.length === 0) return;
  // Park the board's own loop for as long as the card is up. Two reasons,
  // and the second is not obvious:
  //
  //   - Nothing is moving behind the card, so every frame it draws is
  //     wasted work on the phone this game has to run on.
  //   - render.js caches the painted board surface (wood, grain, grid) in
  //     a SINGLE entry keyed by size. The demo canvas is a different size
  //     from the board, so leaving both loops running makes the two
  //     evict each other every frame and repaints both surfaces from
  //     scratch, sixty times a second — the most expensive thing in the
  //     renderer, running twice per frame, behind a modal nobody can see
  //     past. Stopping the board loop leaves the cache holding exactly
  //     one size again.
  //
  // Safe to stop here because resetMatchUi() has already drawn the board
  // once, so what sits behind the card is the stage the player is about
  // to play, in its starting position.
  stopLoop();
  briefOverlay.classList.add("show");
  renderBriefPage();
}

function renderBriefPage() {
  const brief = briefQueue[briefIndex];
  // Obstacle cards are about the stage in front of the player; the
  // aim-line card is about the MODE they just opened, and telling them it
  // is new on this stage would be a small lie on a card whose whole job
  // is to be believed.
  $("brief-eyebrow").textContent = brief.eyebrow ?? "New on this stage";
  $("brief-title").textContent = brief.title;
  $("brief-rule").textContent = brief.rule;
  // Dots only when there is more than one page. A single dot is not a
  // page indicator, it is a smudge.
  $("brief-dots").replaceChildren(
    ...(briefQueue.length > 1
      ? briefQueue.map((_, i) => {
          const dot = document.createElement("i");
          if (i === briefIndex) dot.className = "on";
          return dot;
        })
      : [])
  );
  const last = briefIndex === briefQueue.length - 1;
  $("btn-brief-next").textContent = last ? "Got it" : "Next";
  // Started only once the card is on screen: the canvas is sized from its
  // own box, and a `display: none` ancestor makes that box zero.
  briefDemo.show(brief, activeTheme());
  live.textContent = `${brief.title}. ${brief.rule}`;
}

function advanceBriefing() {
  playButtonSound();
  if (briefIndex < briefQueue.length - 1) {
    briefIndex += 1;
    renderBriefPage();
    return;
  }
  // Marked seen only here, at the end of the sequence. A player who quits
  // halfway gets the whole sequence again next time, which is the right
  // direction to fail in: the pages they did not reach are exactly the
  // ones they still need.
  markBriefingsSeen(briefQueue.map((b) => b.id));
  closeBriefing(true);
}

/**
 * @param {boolean} resume Restart the board's loop. True only on the path
 * that hands play back to the player; the other two callers
 * (resetMatchUi, quitToMenu) are mid-screen-change and showScreen()
 * decides the loop for them a moment later.
 */
function closeBriefing(resume = false) {
  briefOverlay.classList.remove("show");
  briefDemo.stop();
  briefQueue = [];
  briefIndex = 0;
  if (resume) startLoop();
  // The board has just become the player's. If the orientation tip was
  // held back because this card was up, this is when it gets its turn.
  if (resume) window.setTimeout(maybeShowOrientationTip, 500);
}

$("btn-brief-next").onclick = advanceBriefing;

function setMatchTitle(parts) {
  // Two fields rather than one string: the bar sets "STAGE" as a micro
  // label above the number, which is what lets a four-digit stage id have
  // the size it needs later without the word growing with it. The
  // two-player layout has no number and gets its name on one line —
  // `.wordy` swaps the type scale for that case.
  $("hud-stage-label").textContent = parts.label;
  $("hud-stage").textContent = parts.value;
  $("hud-title").classList.toggle("wordy", parts.label === "");
  // The two difficulties are the same board, so nothing else on screen
  // would say which one this is.
  $("hud-hard").hidden = !hardMode;
}

/**
 * Play the CURRENT match again, whatever it is.
 *
 * Exists because the game bar's Restart used to rebuild the match from
 * `stage.id` alone and dropped the difficulty on the floor: restarting a
 * hard stage put the player back on normal, with the aim line restored
 * and the HARD chip gone, and nothing said so. The result card's Retry
 * had the same shape and did remember, which is exactly how this kind of
 * bug survives — one of two callers is right.
 *
 * `startStage`'s `hard` argument defaults to false, so a caller that
 * forgets it silently means "normal". Rather than trusting every future
 * caller to remember, there is now one function that repeats what is
 * running and everything else calls it.
 */
function restartMatch() {
  if (mode === "versus") startVersus();
  else if (mode === "practice") startPractice();
  else startStage(stage.id, hardMode);
}

function resetMatchUi(parts) {
  playerShots = 0;
  dragging = null;
  fading = [];
  $("combo-banner").hidden = true;
  phase = 0;
  overlay.classList.remove("show");
  closeBriefing();
  setMatchTitle(parts);
  // The charge itself carries over — it was paid for. Only the ARMED
  // state resets, because it belongs to a shot that no longer exists.
  previewArmed = false;
  previewCache = null;
  refreshPreviewButton();
  updateHud();
  resizeBoard();
  if (screenStack[screenStack.length - 1] !== "game") goTo("game");
  else showScreen("game");
  announceTurn();
  scheduleAiIfNeeded();
  // Delayed, so it arrives after the board has drawn rather than with it
  // — a toast that is already there when the screen appears reads as part
  // of the furniture and gets ignored.
  window.setTimeout(maybeShowOrientationTip, 900);
}

/** Exactly one of the two result buttons carries the accent. Set rather
 * than authored in the markup, because which one it should be depends on
 * the result. */
function setPrimary(id) {
  for (const other of ["btn-again", "btn-next"]) {
    $(other).classList.toggle("primary", other === id);
  }
}

/**
 * A row of three stars, the earned ones filled. Always three, never just
 * the earned ones: "★★☆" says at a glance that one is missing and worth
 * going back for, while "★★" reads as a complete result.
 * @param {number} earned 0..3
 */
function starRow(earned) {
  const row = document.createElement("div");
  row.className = "stars";
  row.setAttribute("aria-hidden", "true");
  for (let i = 1; i <= 3; i++) {
    const span = document.createElement("span");
    span.className = i <= earned ? "earned" : "missed";
    span.innerHTML = ICONS.star;
    row.append(span);
  }
  return row;
}

function updateHud() {
  if (!match) return;
  // A draw shot has no stones to take, so a 1-0 score line would be
  // reporting on a game nobody is playing.
  $("gb-score").hidden = decider !== null;
  if (decider !== null) return;
  $("count-p0").querySelector("b").textContent = countAlive(match.world, 0);
  $("count-p1").querySelector("b").textContent = countAlive(match.world, 1);
  $("count-p0").classList.toggle("active", match.current === 0 && match.status === "playing");
  $("count-p1").classList.toggle("active", match.current === 1 && match.status === "playing");
  updateShotCounter();
}

/** Shots taken against the stage's par. Campaign only: practice and two
 * players are not scored, and a par shown where none applies is a target
 * the player cannot hit. */
function updateShotCounter() {
  const box = $("gb-progress");
  const scored = isCampaign() && stage && decider === null;
  box.classList.toggle("off", !scored);
  if (!scored) return;
  $("gb-shots").textContent = String(playerShots);
  $("gb-par").textContent = `/ par ${stage.par}`;
  // Past par the number turns, because at that point it has stopped being
  // information and started being the reason to press Restart.
  const over = playerShots > stage.par;
  box.classList.toggle("over", over);
  renderParTrack(stage.par, playerShots);
}

/** Par as a row of pips, one per shot the target allows, filled as they
 * are spent — so "two left before I lose a star" is read rather than
 * subtracted. Rebuilt only when the shape changes: this runs on every
 * HUD update and replacing a dozen nodes per frame for nothing is how a
 * cheap readout becomes an expensive one. */
function renderParTrack(par, used) {
  const track = $("gb-par-track");
  // A par above this is a stage with a lot of opponents on it, where a
  // row of fifteen 4px marks stops being countable and becomes a texture.
  const total = par > 12 ? 0 : Math.min(14, Math.max(par, used));
  const key = `${total}:${used}:${par}`;
  if (track.dataset.key === key) return;
  track.dataset.key = key;
  track.replaceChildren();
  for (let i = 1; i <= total; i++) {
    const pip = document.createElement("i");
    if (i <= used) pip.className = i > par ? "used over" : "used";
    track.append(pip);
  }
}

function announceTurn() {
  if (!match || match.status !== "playing") return;
  const banner = $("turn-banner");
  const yours = vsComputer()
    ? match.current === 0
      ? "Your turn"
      : "Opponent's turn"
    : match.current === 0
      ? "Black's turn"
      : "White's turn";
  banner.textContent = yours;
  banner.classList.add("show");
  live.textContent = yours;
  window.clearTimeout(announceTurn._t);
  announceTurn._t = window.setTimeout(() => banner.classList.remove("show"), 1100);
}

/** In campaign mode player 1 is the AI. In two-player mode nobody is. */
function isAiTurn() {
  return vsComputer() && match && match.status === "playing" && match.current === 1 && match.shooter === null;
}

function scheduleAiIfNeeded() {
  window.clearTimeout(aiTimer);
  // The opponent does not get to move while an ad is on screen either:
  // the requirement is that the GAME does not progress, not merely that
  // the player cannot touch it.
  if (adBusy || !isAiTurn()) return;
  // A deliberate pause before the AI moves. chooseShot() returns in tens
  // of milliseconds even on the largest stage, and an instant reply
  // reads as the game having skipped the opponent's turn entirely — the
  // delay is for legibility, not for computation.
  aiTimer = window.setTimeout(() => {
    if (!isAiTurn()) return;
    const plan = chooseShot(match.world, 1, stage.difficulty ?? "medium");
    if (!plan) return;
    if (shoot(match, plan.stoneId, plan.dirX, plan.dirY, plan.power)) {
      playFlickSound(plan.power);
    }
  }, 620);
}

// --- physics event -> sound / animation ----------------------------------
/**
 * A physics impact (a closing speed in board units per second) as a 0..1
 * loudness.
 *
 * Expressed as a fraction of MAX_FLICK_SPEED rather than as an absolute
 * speed, so it means the same thing whatever TIME_SCALE is set to: a
 * collision at about half of a full-strength flick is already as loud as
 * it gets, and everything above it is the same sound. The headroom is
 * deliberate — a direct max-power hit and a slightly harder one should
 * not be distinguishable, and a busy stage must not clip.
 */
const LOUDEST_IMPACT = MAX_FLICK_SPEED * 0.545;
const loudness = (impact) => impact / LOUDEST_IMPACT;

function handleEvents(events) {
  if (events.length === 0) return;
  // Collisions arrive in bursts (a pinball stage can produce a dozen in
  // one frame). Playing every one turns to mush and stacks gain, so only
  // the loudest of each family is voiced per frame — the ear cannot
  // separate them at that density anyway, and the loudest is the one it
  // would have picked out.
  let loudestStone = 0;
  let loudestObstacle = 0;
  let loudestBumper = 0;
  let teleported = false;
  for (const e of events) {
    if (e.type === "stoneHit") loudestStone = Math.max(loudestStone, e.impact);
    else if (e.type === "obstacleHit") loudestObstacle = Math.max(loudestObstacle, e.impact);
    else if (e.type === "bumperHit") loudestBumper = Math.max(loudestBumper, e.impact);
    else if (e.type === "teleported") teleported = true;
    else if (e.type === "fellOff" || e.type === "sank") {
      const stone = match.world.stones.find((s) => s.id === e.stone);
      if (stone) fading.push({ ...stone, progress: 0 });
      if (e.type === "sank") playSinkSound();
      else playFallSound();
    }
  }
  if (loudestStone > 0) playImpactSound(loudness(loudestStone));
  if (loudestObstacle > 0) playObstacleSound(loudness(loudestObstacle));
  if (loudestBumper > 0) playBumperSound(loudness(loudestBumper));
  if (teleported) playPortalSound();
}

// --- loop ----------------------------------------------------------------
function startLoop() {
  if (rafId !== null) return;
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(frame);
  // AND PUT BACK WHAT stopLoop() TOOK, which is the half that was
  // missing and cost a whole mode.
  //
  // stopLoop() cancels the opponent's pending move, correctly: a parked
  // board must not have a stone flying across it. But parking is always
  // temporary, and nothing was undoing it. So an opponent whose turn was
  // scheduled and then parked -- the computer opening a practice match
  // behind the aim-line card, which is a NEW PLAYER'S FIRST PRACTICE
  // MATCH -- never moved again. The card closed, the loop came back, the
  // board was alive and idle, and it stayed the computer's turn for as
  // long as the player was willing to look at it.
  //
  // Guarded by isAiTurn() rather than by a flag remembering whether a
  // move was pending: "is it the opponent's turn and has nothing been
  // flicked" is the same question scheduleAiIfNeeded() already answers,
  // and a remembered flag would be a second copy of it to keep in step.
  scheduleAiIfNeeded();
}

function stopLoop() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  window.clearTimeout(aiTimer);
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05); // a backgrounded tab hands back seconds
  lastFrameTime = now;
  phase += dt;
  if (!match) return;

  const wasResolving = match.shooter !== null;
  if (wasResolving) {
    handleEvents(advance(match, dt));
    if (match.shooter === null) onTurnResolved();
  }

  for (const f of fading) f.progress += dt / 0.45;
  fading = fading.filter((f) => f.progress < 1);

  draw();
}

const COMBO_WORDS = { 2: "Double!", 3: "Triple!", 4: "Four at once!" };

/** Announce a multi-stone shot. Two is worth calling out — it is the
 * shot the whole game is built around and, until now, landing one looked
 * exactly like landing an ordinary one. */
function showCombo(count) {
  const banner = $("combo-banner");
  banner.textContent = COMBO_WORDS[count] ?? `${count} at once!`;
  banner.hidden = false;
  banner.classList.remove("pop");
  void banner.offsetWidth; // restart the animation even on a back-to-back combo
  banner.classList.add("pop");
  live.textContent = banner.textContent;
  playComboSound(count);
  window.clearTimeout(showCombo._t);
  showCombo._t = window.setTimeout(() => {
    banner.hidden = true;
  }, 1200);
}

function onTurnResolved() {
  // game/arena.js counts this while the shooter is still known — see its
  // own `turnKills` comment for why it cannot be counted from here.
  if (match.turnKills >= 2) showCombo(match.turnKills);
  updateHud();
  if (match.status !== "playing") {
    finishMatch();
    return;
  }
  announceTurn();
  scheduleAiIfNeeded();
}

/**
 * Whether to demonstrate the slingshot this frame. Only on the campaign's
 * first stage, only for a player who has never cleared anything, and only
 * until they take their first shot — after that they have understood it
 * and a looping animation is just noise. Deliberately NOT stored as a
 * "seen the tutorial" flag: `has cleared nothing AND has not shot yet` is
 * derived from state that already exists and cannot drift out of sync
 * with it.
 */
function shouldShowDragHint() {
  return (
    isCampaign() &&
    stage?.id === FIRST_STAGE_ID &&
    getClearedStageIds().length === 0 &&
    playerShots === 0 &&
    match?.status === "playing" &&
    match.current === 0 &&
    match.shooter === null &&
    !dragging
  );
}

/** How far the pull must be before a release counts as a shot. A finger
 * hides the first ~15px of its own gesture, so the touch threshold is
 * wider — see game/layout.js's MIN_DRAG_TOUCH for the ratio and what it
 * costs. Read from the gesture in progress, so a device with both a
 * mouse and a touchscreen gets the right one per gesture rather than a
 * guess made at load. */
function dragMinimum() {
  return dragging && dragging.touch ? MIN_DRAG_TOUCH : MIN_DRAG;
}

/**
 * THE CANCEL LATCH.
 *
 * Coming home to the stone arms it; pulling well back out again releases
 * it. Between those two thresholds the state is HELD, which is the whole
 * point — see game/layout.js's CANCEL_RELEASE for the measurements, but
 * the short version is that a thumb's centroid moves two to three
 * millimetres just in being lifted off the glass, and the entire power
 * dial on a phone is eight. A single radius cannot separate "changed my
 * mind" from "let go", at any size. Two can.
 *
 * Called from onMove rather than computed in draw(), because it is state
 * and not a rendering: the frame that draws the cancel and the release
 * that acts on it have to agree, and a predicate re-evaluated at release
 * time from a position two pixels further on would not.
 */
function updateCancelLatch() {
  const stone = match && match.world.stones.find((s) => s.id === dragging.stoneId);
  if (!stone) return;
  const len = Math.hypot(
    dragging.pointerBoard.x - stone.x,
    dragging.pointerBoard.y - stone.y
  );
  if (len >= dragMinimum()) dragging.pulled = true;
  if (len > MAX_DRAG * CANCEL_RELEASE) dragging.cancelArmed = false;
  else if (dragging.pulled && len < dragMinimum()) dragging.cancelArmed = true;
}

/** Whether letting go right now would call the shot off. The latch, plus
 * the plain "you never pulled at all" case — a tap on a stone has to stay
 * a tap, and it has not armed anything. */
function isCancelling(shot) {
  return dragging.cancelArmed || shot.dragLength < dragMinimum();
}

function draw() {
  if (!match) return;
  const selectable = !vsComputer() || match.current === 0 ? selectableStones(match) : [];
  let aim = null;
  if (dragging) {
    const stone = match.world.stones.find((s) => s.id === dragging.stoneId);
    if (stone) {
      const shot = dragToShot(stone.x, stone.y, dragging.pointerBoard.x, dragging.pointerBoard.y, dragMinimum());
      // Below MIN_DRAG the release will do nothing. Telling the player
      // that WHILE they are still holding is the whole point — it turns
      // an invisible escape hatch into a usable "no, not that one," which
      // is what most of the shots a player would want back actually need.
      aim = {
        stone,
        shot,
        pointerBoard: dragging.pointerBoard,
        cancelling: isCancelling(shot),
        // The decider never draws the forward line, setting or no
        // setting: it exists to break a tie on skill, and a line that
        // tells you where the stone lands is the skill removed.
        //
        // Nor does it draw while a preview is up, and that one is not a
        // rule about difficulty: the forward ray points where you AIMED
        // and the preview shows where the stone GOES, so on any shot with
        // a bounce in it the two disagree — in the same colour, from the
        // same stone. The preview is the truer of the two, so it is the
        // one that stays.
        guide: aimGuide && decider === null && !previewArmed,
      };
    }
  }
  const preview = aim && !aim.cancelling ? previewFor(aim) : null;
  const hint = shouldShowDragHint();
  const hintStone = hint ? selectable[0] ?? null : null;
  $("hint-banner").hidden = !hintStone;
  drawScene(ctx, layout, match, {
    theme: activeTheme(),
    aim,
    fading,
    phase,
    selectable,
    hintStone,
    target: decider !== null,
    stoneAlpha: drawShotVeil(),
    measures: decider?.measures ?? null,
    preview,
  });
}

/**
 * The path for the shot currently being aimed, or null if the player has
 * not bought one. Cached, because draw() runs every frame and the
 * simulation behind this is the same work the AI does to score a single
 * candidate move.
 */
function previewFor(aim) {
  if (!previewArmed) return null;
  const { stone, shot } = aim;
  const key = [
    stone.id,
    Math.round(Math.atan2(shot.dirY, shot.dirX) * 400),
    Math.round(shot.power * 200),
    match.world.stones.filter((st) => st.alive).length,
  ].join(":");
  if (previewCache?.key === key) return previewCache.result;
  const result = simulateShotPath(match.world, stone.id, shot.dirX, shot.dirY, shot.power);
  previewCache = { key, result };
  return result;
}

/**
 * CAMPAIGN ONLY, and stated as an allowlist rather than as a list of
 * exclusions — a future mode (online is already a tile on the menu) must
 * have to opt IN to a paid hint rather than inherit it by not being
 * mentioned here.
 *
 * Two players share one device and one bar, so a charge earned by one
 * person has no honest owner; the draw shot is a tiebreak on skill and a
 * drawn path is the skill removed; hard mode is DEFINED by having no aim
 * guide, and a preview is a stronger guide than the line it takes away.
 * Practice is excluded for a different reason: nothing there is scored,
 * so a charge spent in it is a charge the player wasted — and it is the
 * one place they might arm it by accident.
 */
function previewAllowed() {
  return mode === "campaign" && decider === null && !hardMode;
}

/** The button says which of three states it is in, and that is the whole
 * of its interface: ready, armed, or spent for this game. */
function refreshPreviewButton() {
  const btn = $("btn-preview");
  // Present only while there is something to spend. A permanently
  // disabled control during play would be a control hinting at a purchase
  // on a gameplay screen, which is the thing being avoided.
  btn.hidden = !previewAllowed() || (previewLeft === 0 && !previewArmed);
  if (btn.hidden) return;
  btn.classList.toggle("ready", previewArmed);
  btn.querySelector(".btn-lbl").textContent = previewArmed ? "Aiming" : "Preview";
  btn.setAttribute("aria-label", previewArmed
    ? "Cancel the shot preview"
    : "Use your shot preview");
}

/**
 * The rewarded-ad offer, on the result card and nowhere else.
 *
 * Every condition here is a line from CrazyGames' advertisement
 * requirements rather than a taste call:
 *   - the request button is not on a gameplay screen
 *   - it is not offered "each time a user dies" — two consecutive losses
 *     on the same stage, which is the difference between a player who is
 *     playing and one who is stuck
 *   - "do not offer a rewarded ad too often" — a two-minute floor between
 *     offers, so a bad run is not a series of pitches
 *   - hidden when it cannot be honoured (no SDK: local dev, an ad
 *     blocker, a non-portal build) rather than shown and failing, and
 *     hidden for the rest of the session after two requests that never
 *     became an ad — see offerMisses
 *   - hidden when a charge is already held, because a second one would be
 *     selling something the player cannot use
 */
function refreshPreviewOffer() {
  const box = $("preview-offer");
  const offer = previewAllowed()
    && isCampaign()
    && previewLeft === 0
    && offerMisses < OFFER_MAX_MISSES
    && lossStreak >= OFFER_MIN_LOSSES
    && performance.now() - lastOfferAt >= OFFER_COOLDOWN_MS
    && getAdSdkReadyState() !== false;
  box.hidden = !offer;
  if (offer) lastOfferAt = performance.now();
  box.classList.toggle("busy", previewPending);
  $("btn-buy-preview").disabled = previewPending;
  $("btn-buy-preview").querySelector(".ad-text").textContent = previewPending
    ? "One moment…"
    : "Free preview · see the shot's path";
}

async function buyPreview() {
  if (previewPending || previewLeft > 0) return;
  previewPending = true;
  adBusy = true;
  refreshPreviewOffer();
  const outcome = await requestRewardedHint();
  previewPending = false;
  adBusy = false;
  scheduleAiIfNeeded();
  if (outcome === "granted") {
    previewLeft = 1;
    setPreviewsHeld(previewLeft);
    offerMisses = 0;
  } else if (outcome === "unfilled") {
    offerMisses += 1;
  }
  // Nothing is said when an ad does not fill. The offer simply goes away
  // for this card: the portal's ad inventory is not the player's problem,
  // and "try again" here would be chaining, which the same requirements
  // forbid.
  $("preview-offer").hidden = true;
  refreshPreviewButton();
}

/** Arm, or put it back. Pressing it twice costs nothing — the charge is
 * spent by the SHOT, not by the button. */
function togglePreview() {
  if (!previewAllowed()) return;
  if (previewArmed) previewArmed = false;
  else if (previewLeft > 0) previewArmed = true;
  else return;
  previewCache = null;
  refreshPreviewButton();
  draw();
}

// --- input ---------------------------------------------------------------
attachPointerHandlers(canvas, {
  onDown(pos, meta) {
    unlockAudio(); // must happen synchronously inside a real gesture — see core/audio.js
    // "Ensure that a user cannot progress the game while requesting or
    // showing an ad" — CrazyGames' advertisement requirements.
    if (adBusy) return;
    if (!match || match.status !== "playing" || match.shooter !== null) return;
    if (vsComputer() && match.current !== 0) return;
    const stone = stoneAtPoint(layout, selectableStones(match), pos.x, pos.y);
    if (!stone) return;
    // The pointer TYPE is recorded at the start of the gesture and not
    // re-read: which threshold applies has to be the same on the frame
    // that draws "this will cancel" and on the release that acts on it.
    dragging = {
      stoneId: stone.id,
      pointerBoard: toBoard(layout, pos.x, pos.y),
      touch: meta.pointerType === "touch",
      // The gesture starts ON the stone, which is inside the cancel zone
      // — so the latch cannot start closed, or the first pull out would
      // be reading a cancel the player never asked for. It arms only
      // after a real pull has happened and then come home.
      pulled: false,
      cancelArmed: false,
    };
  },
  onMove(pos, meta) {
    if (!dragging || !meta.pressed) return;
    dragging.pointerBoard = toBoard(layout, pos.x, pos.y);
    updateCancelLatch();
  },
  onUp(pos) {
    if (!dragging || !match) return;
    const stone = match.world.stones.find((s) => s.id === dragging.stoneId);
    const pointerBoard = toBoard(layout, pos.x, pos.y);
    const min = dragMinimum();
    // The release position is part of the gesture: on a touchscreen the
    // reported point moves as the finger comes off, so the latch is given
    // the last word rather than the last pixel.
    dragging.pointerBoard = pointerBoard;
    updateCancelLatch();
    const cancelled = !stone || dragging.cancelArmed;
    dragging = null;
    if (!stone) return;
    const shotPlan = dragToShot(stone.x, stone.y, pointerBoard.x, pointerBoard.y, min);
    // Below MIN_DRAG this was a tap, not a shot. Silently doing nothing
    // is right: a player who taps a stone to see what it does should not
    // lose their turn to a dribble.
    if (cancelled || shotPlan.dragLength < min) return;
    if (shoot(match, stone.id, shotPlan.dirX, shotPlan.dirY, shotPlan.power)) {
      // Spent on the shot, not on the look. See the preview block above.
      if (previewArmed) {
        previewArmed = false;
        previewLeft -= 1;
        setPreviewsHeld(previewLeft);
        previewCache = null;
        refreshPreviewButton();
      }
      // Only the human's own shots count toward a stage record.
      if (isCampaign() && match.shooter === 0) playerShots += 1;
      if (mode === "versus" && decider === null && match.shooter !== null) roundShots[match.shooter] += 1;
      playFlickSound(shotPlan.power);
      // A draw shot flies like any other shot — and then dissolves in
      // mid-travel, so the shooter sees the strike they made and nobody
      // sees where it stopped. See VEIL below.
      if (decider !== null) decider.shotAt = phase;
    }
  },
  onCancel() {
    dragging = null;
  },
});


// --- two-player match card -----------------------------------------------
//
// A match is two rounds and a ladder of tiebreaks (game/series.js), which
// means the winner is sometimes decided by something that happened in the
// OTHER round. So the card does not just announce a winner: it prints the
// ladder, both players' numbers on every rung it had to read, and marks
// the one that settled it. A tiebreak nobody can see is indistinguishable
// from a coin flip, and this format exists precisely to have no coin flip
// in it.

const SIDE_NAME = ["Black", "White"];

const RUNG_LABEL = {
  rounds: "Rounds won",
  stones: "Stones kept",
  shots: "Shots used",
  // Named by its unit rather than by the event: "Draw shot 0.7" says
  // nothing, "stones from the centre 0.7" is a picture of the board.
  draw: "Stones from centre",
};

/** A distance in board units means nothing to a player. Stone widths do:
 * "one and a bit stones out" is a thing you can see on the board. */
function stoneWidths(distance) {
  if (!Number.isFinite(distance)) return "off the board";
  return `${(distance / (STONE_RADIUS * 2)).toFixed(1)}`;
}

const RUNG_WHY = {
  rounds: (name) => `${name} won both rounds.`,
  stones: (name) => `One round each — ${name} finished with more stones on the board.`,
  shots: (name) => `One round each, same stones left — ${name} needed fewer shots.`,
  draw: (name) => `Level on everything, so one blind flick each at the centre — ${name} landed closer.`,
  level: () => "Same rounds, same stones, same shots. One shot each at the centre decides it.",
};

function scoreRow(label, values, { decisive = false, lowerWins = false, format = String } = {}) {
  const row = document.createElement("tr");
  if (decisive) row.className = "decisive";
  const head = document.createElement("th");
  head.textContent = label;
  row.append(head);
  const winning = values[0] === values[1] ? -1 : lowerWins ? (values[0] < values[1] ? 0 : 1) : values[0] > values[1] ? 0 : 1;
  for (const side of [0, 1]) {
    const cell = document.createElement("td");
    cell.textContent = format(values[side]);
    if (decisive && side === winning) cell.className = "lead";
    row.append(cell);
  }
  return row;
}

/** Every score table carries the two names above the columns. A pair of
 * bare numbers is not an explanation — the first thing a reader has to
 * know is whose number is whose. */
function scoreTable() {
  const table = document.createElement("table");
  table.className = "ladder";
  const head = document.createElement("tr");
  head.append(document.createElement("th"));
  for (const side of [0, 1]) {
    const cell = document.createElement("th");
    cell.className = "side";
    const pip = document.createElement("i");
    pip.className = `pip p${side}`;
    cell.append(pip, document.createTextNode(SIDE_NAME[side]));
    head.append(cell);
  }
  table.append(head);
  return table;
}

function ladderTable(out) {
  const table = scoreTable();
  // Rungs BELOW the decisive one never got read, so printing them would
  // invite the player to check numbers that did not count. Everything up
  // to and including the one that decided it, and all three when the
  // match came out level.
  for (const rung of out.ladder) {
    table.append(
      scoreRow(RUNG_LABEL[rung.key], rung.values, {
        ...rung,
        format: rung.key === "draw" ? stoneWidths : String,
      })
    );
    if (rung.decisive) break;
  }
  const why = document.createElement("p");
  why.className = "result-why";
  why.textContent = RUNG_WHY[out.reason ?? "level"](out.winner === null ? "" : SIDE_NAME[out.winner]);
  const box = document.createElement("div");
  box.append(table, why);
  return box;
}

function roundSummary(round, nextOpener) {
  const box = document.createElement("div");
  const table = scoreTable();
  table.append(scoreRow("Stones left", round.alive), scoreRow("Shots used", round.shots));
  const note = document.createElement("p");
  note.className = "result-why";
  // Said out loud because it is the whole point of the format, and a
  // player who does not notice the swap will read the match as unfair.
  note.textContent = `${SIDE_NAME[nextOpener]} opens round ${ROUNDS_PER_MATCH} — each side opens once.`;
  box.append(table, note);
  return box;
}

function finishVersusRound(title, body) {
  const winner = /** @type {0|1} */ (match.status === "won" ? 0 : 1);
  recordRound(series, {
    winner,
    alive: [countAlive(match.world, 0), countAlive(match.world, 1)],
    shots: [roundShots[0], roundShots[1]],
  });
  const out = seriesOutcome(series);
  $("result-stars").replaceChildren();
  const played = series.rounds.length;

  if (!out.complete) {
    title.textContent = `${SIDE_NAME[winner]} takes round ${played}`;
    body.replaceChildren(roundSummary(series.rounds[played - 1], openerFor(series)));
    $("btn-next").textContent = `Round ${played + 1}`;
    $("btn-next").onclick = () => {
      playButtonSound();
      releaseResult();
      startVersusRound();
    };
  } else {
    if (out.needsDraw) {
      title.textContent = "Dead level";
      body.replaceChildren(ladderTable(out));
      $("btn-next").textContent = "Draw shot";
      $("btn-next").onclick = () => {
        playButtonSound();
        startDecider();
      };
    } else {
      // One match, not two games: the ad policy and the "games completed"
      // counter both mean a finished contest.
      incrementVersusGamesCompleted();
      title.textContent = `${SIDE_NAME[out.winner]} wins the match`;
      body.replaceChildren(ladderTable(out));
      $("btn-next").textContent = "Rematch";
      $("btn-next").onclick = () => {
        playButtonSound();
        releaseResult();
        startVersus();
      };
    }
  }
  $("btn-again").textContent = "Menu";
  $("btn-again").onclick = () => {
    playButtonSound();
    releaseResult();
    quitToMenu();
  };
}


// --- the draw shot -------------------------------------------------------
//
// A match level on rounds, stones AND shots is settled the way curling
// settles the hammer: one flick each at the middle of an empty board,
// closest wins. It is the only tiebreak left that is still a thing the
// player DID.
//
// SEALED, not merely blind. Each shot is taken on its own board holding
// only that player's stone, resolved without being animated, and the
// stone is removed before the next frame — so the second shooter has
// nothing to aim against, and neither player sees anything until both
// shots are in. On one shared device that is the only version that is
// actually fair: watching the first shot land is exactly the advantage
// this decider exists to avoid handing out.

/** Both draw shots are taken from the SAME spot on the near row. The seat
 * is worth something (see versusLayout), and a decider that hands one
 * player the near row and the other the far one is not a decider, it is a
 * coin flip with extra steps. */
const DRAW_HOME = 0.86;

function deciderStage(side) {
  const stone = [{ x: 0.5, y: DRAW_HOME }];
  return {
    id: "draw",
    name: "Draw shot",
    stones: { 0: side === 0 ? stone : [], 1: side === 1 ? stone : [] },
    obstacles: [],
  };
}

function startDecider() {
  // Order does not matter — both shots are sealed — so it is the round-1
  // opener, purely so the sequence is stated somewhere rather than random.
  decider = { order: [series.opener, /** @type {0|1} */ (1 - series.opener)], taken: [] };
  startDeciderShot();
}

function startDeciderShot() {
  const side = decider.order[decider.taken.length];
  stage = deciderStage(side);
  match = createMatch({ stage, startingPlayer: side, mode: "versus" });
  resetMatchUi({ label: "", value: `${SIDE_NAME[side]}'s draw shot` });
}

/**
 * THE VEIL. How a draw shot can be watched and still be secret.
 *
 * The first version resolved the shot the instant it was released, with
 * no flight at all, and it read as a bug — you flick, and a card appears.
 * But letting it play to a stop hands the second shooter the exact number
 * to beat, which is the advantage this whole decider exists to withhold.
 *
 * So the stone fades out while it is still travelling: solid for the
 * first third of a second — long enough to see the direction and how hard
 * it was hit — then gone well before it comes to rest. You get the shot;
 * nobody gets the answer.
 */
const VEIL_SOLID = 0.42;
const VEIL_GONE = 0.80;

/** How long both stones sit on the board, measured and labelled, before
 * the card covers them. The reveal IS the decider — a card that arrives
 * on top of it turns the moment the whole tiebreak exists for into a
 * number nobody watched. */
const REVEAL_HOLD_MS = 2200;

function drawShotVeil() {
  if (decider === null || decider.shotAt === undefined) return 1;
  // A duffed shot can stop inside the solid window; the moment it is at
  // rest it is an answer, and answers are what the veil is for.
  if (match && match.shooter === null) return 0;
  const t = phase - decider.shotAt;
  if (t <= VEIL_SOLID) return 1;
  if (t >= VEIL_GONE) return 0;
  return 1 - (t - VEIL_SOLID) / (VEIL_GONE - VEIL_SOLID);
}

/** Read the shot off the board once it has come to rest, then clear it —
 * the card sits over the board, and a stone left under it is the leak. */
function sealDrawShot() {
  const stone = match.world.stones[0];
  const side = decider.order[decider.taken.length];
  decider.taken.push({
    side,
    distance: stone.alive ? Math.hypot(stone.x - 0.5, stone.y - 0.5) : Infinity,
    x: stone.x,
    y: stone.y,
    alive: stone.alive,
  });
  match.world.stones = [];
  decider.shotAt = undefined;
}

function revealDrawShots(winner) {
  // Both stones on one board, with the distance drawn as a line to the
  // centre and written beside each stone.
  const at = (side) => decider.taken.find((t) => t.side === side);
  const onBoard = (side) => (at(side).alive ? [{ x: at(side).x, y: at(side).y }] : []);
  stage = { id: "draw", name: "Draw shot", stones: { 0: onBoard(0), 1: onBoard(1) }, obstacles: [] };
  match = createMatch({ stage, startingPlayer: 0, mode: "versus" });
  // Nothing on this board is playable: it exists to be looked at, and the
  // card has not covered it yet, so a stray drag could otherwise fire one
  // of the two stones being measured.
  match.status = "draw";
  decider.measures = [0, 1]
    .filter((side) => at(side).alive)
    .map((side) => ({
      x: at(side).x,
      y: at(side).y,
      player: side,
      label: stoneWidths(at(side).distance),
      winner: side === winner,
    }));
  setMatchTitle({ label: "", value: "Draw shot" });
  resizeBoard();
}

function finishDrawShot(title, body) {
  sealDrawShot();
  if (decider.taken.length < 2) {
    const next = decider.order[1];
    title.textContent = "Sealed";
    const note = document.createElement("p");
    note.className = "result-why";
    note.textContent = `Nobody sees that shot — not even you — until both are in. ${SIDE_NAME[next]} shoots next.`;
    body.replaceChildren(note);
    $("btn-next").textContent = `${SIDE_NAME[next]}'s shot`;
    $("btn-next").onclick = () => {
      playButtonSound();
      startDeciderShot();
    };
    return;
  }

  const distance = (side) => decider.taken.find((t) => t.side === side).distance;
  recordDrawShot(series, [distance(0), distance(1)]);
  const out = seriesOutcome(series);
  revealDrawShots(out.winner);
  // Hold the board before the card: this is the one moment in the whole
  // match where both players want to look at the board rather than read.
  resultHold = REVEAL_HOLD_MS;

  if (out.needsDraw) {
    // Nothing separates them, so it goes again — and again — rather than
    // being awarded to whoever missed by less.
    const bothOff = !Number.isFinite(distance(0)) && !Number.isFinite(distance(1));
    title.textContent = bothOff ? "Both off the board" : "Still level";
    const note = document.createElement("p");
    note.className = "result-why";
    note.textContent = bothOff
      ? "Neither stone stayed on. Shoot again."
      : "Both stones the same distance out. Shoot again.";
    body.replaceChildren(note);
    $("btn-next").textContent = "Draw again";
    $("btn-next").onclick = () => {
      playButtonSound();
      series.draw = null;
      startDecider();
    };
    return;
  }

  incrementVersusGamesCompleted();
  title.textContent = `${SIDE_NAME[out.winner]} wins the match`;
  body.replaceChildren(ladderTable(out));
  $("btn-next").textContent = "Rematch";
  $("btn-next").onclick = () => {
    playButtonSound();
    releaseResult();
    startVersus();
  };
}

// --- results -------------------------------------------------------------
function finishMatch() {
  const won = match.status === "won";
  if (won && mode === "campaign" && decider === null) {
    trackEvent("game_win", { mode: "campaign", stage: stage?.id, hard: hardMode });
  } else if (won && mode === "practice") {
    trackEvent("game_win", { mode: "practice" });
  }
  const title = $("result-title");
  const body = $("result-body");
  const unlockNote = $("result-unlock");
  unlockNote.hidden = true;
  // Off by default on every card. The campaign branch below is the only
  // one that turns it on: practice, two-player and the decider are not
  // places to be taught, they are places to be playing.
  $("result-tip").hidden = true;
  // The default for every card; the campaign's flips it on a loss.
  setPrimary("btn-next");

  if (decider !== null) {
    finishDrawShot(title, body);
  } else if (mode === "versus") {
    finishVersusRound(title, body);
  } else if (!isCampaign()) {
    // Practice only: two-player has its own card above, and the campaign
    // its own branch below.
    title.textContent = won ? "You win" : "The computer wins";
    $("result-stars").replaceChildren(); // stars are a campaign idea only
    body.textContent = "";
    $("btn-next").textContent = "Rematch";
    $("btn-next").onclick = () => {
      playButtonSound();
      releaseResult();
      restartMatch();
    };
    $("btn-again").textContent = "Menu";
    $("btn-again").onclick = () => {
      playButtonSound();
      releaseResult();
      quitToMenu();
    };
  } else {
    const before = getUnlockedThemeIds(themeUnlockContext());
    const previousBest = getBestTurns(stage.id, hardMode);
    const previousStars = getStars(stage.id, hardMode);
    // The SAME par in both difficulties, and that is not laziness. Par
    // comes from test/balance.mjs's strongest player model, which never
    // sees the aim indicator — it computes its shots. So par has always
    // been a no-guide number; hard mode is the difficulty it was actually
    // measured at, and normal was the generous one.
    const stars = starsForShots(playerShots, stage.par);
    if (won) recordStageCleared(stage.id, playerShots, stars, hardMode);
    const after = getUnlockedThemeIds(themeUnlockContext());
    const newTheme = after.find((id) => !before.includes(id));

    // Consecutive losses on THIS stage. Reset by a win and by moving to a
    // different stage, so the streak means "stuck here" rather than "has
    // lost a lot lately".
    if (lossStreakStage !== stage.id) {
      lossStreakStage = stage.id;
      lossStreak = 0;
    }
    lossStreak = won ? 0 : lossStreak + 1;

    // THE CHAPTER BOUNDARY, WHICH USED TO PASS IN SILENCE.
    //
    // Chapters were built for the stage GRID — a hundred cards in one
    // scroll has no landmark, so ten headings give one. In play they said
    // nothing, and measuring the campaign showed why: every element is
    // introduced by stage 19, so chapters 3 to 10 share one vocabulary
    // and differ only in par (3.1 rising to 5.3) and opponent count. There
    // was no content change at the boundary, so there was nothing to
    // announce.
    //
    // What there IS at a boundary is ten stages of the player's own
    // record, which is worth reading back to them — and now the two
    // progress-based theme unlocks land there too (game/themes.js), so a
    // boundary is also where the game hands something over.
    const chapterEnd = won && isChapterEnd(stage.id);
    const chapter = chapterEnd ? summariseChapter(stage.act, hardMode) : null;
    title.textContent = chapterEnd
      ? (nextStageId(stage.id) === null ? "Campaign complete" : `Chapter ${stage.act} complete`)
      : won ? (hardMode ? "Hard clear" : "Stage clear") : "Wiped out";
    const chapterNote = $("result-chapter");
    chapterNote.hidden = !chapter;
    if (chapter) {
      // No "Chapter N ·" prefix: the title two lines up already says it,
      // and a card that repeats itself reads as a template rather than as
      // a result.
      chapterNote.innerHTML =
        `<b>${chapter.stars}</b> of ${chapter.maxStars} stars` +
        ` · <b>${chapter.shots}</b> shots against par ${chapter.par}`;
    }
    const starsBox = $("result-stars");
    starsBox.replaceChildren();
    if (won) starsBox.append(...starRow(stars).childNodes);
    body.textContent = won
      ? `${playerShots} shot${playerShots === 1 ? "" : "s"} · par ${stage.par}` +
        (stars < 3 ? ` · clear in ${stage.par} for 3 stars` : "") +
        (previousStars > stars ? " · your best still stands" : "")
      : "Every stone gone. Try a softer angle.";
    if (newTheme) {
      unlockNote.hidden = false;
      unlockNote.textContent = `New board theme unlocked: ${getThemeById(newTheme).name}`;
    }

    // THE TIP LINE. Two cards carry one, and only two.
    //
    //   - a chapter card, because it is a pause the player earned and
    //     the only moment in the campaign that is already ceremonial;
    //   - a loss, because it is the only moment they are actually asking
    //     why, and game/tips.js can answer from the board they just lost.
    //
    // A plain stage clear gets nothing. It is the most common card in the
    // game and the player is already reaching for Next; a lesson there
    // would be read as the game talking over its own applause.
    const seenTips = getSeenTips();
    if (chapterEnd) {
      showResultTip(chapterTip(stage.act, seenTips));
    } else if (!won) {
      showResultTip(
        tipForLoss(
          {
            stage,
            // Both sides gone on one shot. game/arena.js scores that
            // against the shooter, which is exactly the tip to give.
            mutual: countAlive(match.world, 0) === 0 && countAlive(match.world, 1) === 0,
            ownGoals: match.ownGoals,
            opponentsLeft: countAlive(match.world, 1),
            lossStreak,
            shotsOverPar: playerShots - stage.par,
          },
          seenTips
        )
      );
    }

    const next = nextStageId(stage.id);
    // WHICH BUTTON IS THE LOUD ONE FOLLOWS WHAT THE PLAYER CAME TO DO.
    // Menu was the filled slab on both cards, so on a loss the gold
    // button — the one the eye goes to and the thumb follows — was the
    // one that leaves the game. Nobody who has just lost wants the menu;
    // they want another go. So on a loss Retry takes the accent and Menu
    // goes plain, and on a win it stays as it was, because then the thing
    // you came for really is the next stage.
    if (!won) setPrimary("btn-again");
    $("btn-again").textContent = "Retry";
    $("btn-again").onclick = () => {
      playButtonSound();
      releaseResult();
      restartMatch();
    };
    // "Next" keeps the difficulty, but only where it exists: the stage
    // after this one is not open on hard until it has been beaten
    // normally, so a player running the hard track is handed the normal
    // version of a stage they have not seen rather than a locked one.
    const nextHard = hardMode && next !== null && isHardUnlocked(next);
    // On a chapter card the button names where it goes, because that is
    // the one moment the player is being told they have moved somewhere.
    $("btn-next").textContent = won
      ? (next ? (chapterEnd ? `Chapter ${stage.act + 1}` : "Next stage") : "Menu")
      : "Menu";
    $("btn-next").onclick = () => {
      playButtonSound();
      releaseResult();
      if (won && next) startStage(next, nextHard);
      else quitToMenu();
    };
  }
  // Every card asks; refreshPreviewOffer() is the single place that knows
  // when the answer is yes, and only the campaign's loss card ever gets
  // one.
  refreshPreviewOffer();

  if (mode === "versus") {
    // Two people at one device: there is no "you" to have lost, and the
    // defeat sting belongs to losing against the computer.
    playWinSound(false);
  } else if (won) {
    if (isCampaign() && stage.id === LAST_STAGE_ID) playWinSound(true);
    else if (isCampaign()) playAchievementSound();
    else playWinSound(false);
  } else {
    playLoseSound();
  }
  live.textContent = title.textContent;
  if (resultHold > 0) {
    const wait = resultHold;
    resultHold = 0;
    setTimeout(() => {
      // The match can be abandoned during the hold; showing a card over a
      // board nobody is on any more would be a ghost.
      if (match) overlay.classList.add("show");
    }, wait);
  } else {
    overlay.classList.add("show");
  }
  // Active play is over either way; the ad itself waits for the player to
  // leave this card, and only if they won (see `adPending`).
  notifyGameplayStop();
  adPending = won;
}

/** Called by every button that leaves the result card. core/ads.js owns
 * the frequency policy — how many games and how many seconds between
 * interstitials, plus a first-session grace period — so this only ever
 * reports that a game finished, at the moment the player is moving on. */
function releaseResult() {
  if (!adPending) return;
  adPending = false;
  onGameOver();
}

function quitToMenu() {
  decider = null;
  resultHold = 0;
  overlay.classList.remove("show");
  closeBriefing();
  match = null;
  screenStack = ["menu"];
  centreTableLight();
  applySurround(null);
  showScreen("menu");
  renderMenu();
}

// --- menu / stage list / themes ------------------------------------------
function renderMenu() {
  const cleared = getClearedStageIds().length;
  const hardCleared = getHardClearedStageIds().length;
  // The star total has always counted both difficulties (96 = 16 x 3 x 2),
  // so a stage count that only knew about normal was measuring a different
  // campaign than the number beside it: "16 / 16 stages · 56 / 96 stars"
  // says finished and half-finished in one breath. Once hard exists for
  // this player the line names both tracks; before that there is only one
  // track to name.
  const stages =
    hardCleared > 0 || cleared === STAGES.length
      ? `${cleared} / ${STAGES.length} normal · ${hardCleared} / ${STAGES.length} hard`
      : `${cleared} / ${STAGES.length} stages`;
  const resume = getContinuePoint();

  // THE HERO CARD. What used to be a plain button plus a grey footnote
  // under the whole menu is one thing now, because they were always one
  // thing: where the player left off, and how far along that is. The
  // footnote was the smallest text on the screen while being, with a
  // campaign this long, the single number a returning player came back
  // for.
  //
  // The label still says exactly where the button goes, difficulty
  // included: a player who has finished the normal campaign is sent on to
  // the next HARD stage, and being dropped into a no-aim-line board
  // without being told would read as a bug rather than as progress.
  const label =
    cleared === 0
      ? "Play"
      : `Continue · Stage ${resume.id}${resume.hard ? ' <span class="btn-chip">Hard</span>' : ""}`;
  const stars = getTotalStars();
  const done = cleared + hardCleared;
  const total = STAGES.length * 2;
  $("btn-continue").innerHTML =
    `<span class="hero-label">${label}</span>` +
    (cleared === 0
      ? ""
      : `<span class="hero-bar"><i></i></span>` +
        `<span class="hero-stats"><span>${stages}</span><span>${stars} / ${MAX_STARS} ★</span></span>`);
  // Site build: the bar's width is set through the CSSOM rather than as a
  // style attribute in the markup — the site's Content-Security-Policy
  // (style-src 'self') refuses inline style attributes, and a refused one
  // would leave the progress bar permanently empty.
  const heroFill = $("btn-continue").querySelector(".hero-bar i");
  if (heroFill) heroFill.style.width = `${Math.round((done / total) * 100)}%`;

  // The Stages tile carries the campaign's size, so the menu says how
  // much game there is without a player having to open anything.
  $("mode-stages-sub").textContent =
    cleared === 0 ? `${STAGES.length} stages` : `${cleared} / ${STAGES.length} cleared`;

  refreshSoundButtons();
}

function renderStageGrid() {
  const grid = $("stage-grid");
  grid.replaceChildren();
  for (const button of $("stage-difficulty").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String((button.dataset.hard === "1") === gridHard));
  }
  $("difficulty-note").textContent = gridHard
    ? "Same stages, no aim line. Opens once you have cleared a stage."
    : "";

  // CHAPTERS. A hundred cards in one run is a scroll, not a menu -- a
  // player looking for stage 63 has no landmark to aim at. Ten chapters
  // of ten give one, and the heading carries the chapter's own progress,
  // so the screen answers "where am I" as well as "where can I go".
  let chapter = null;
  let head = null;
  for (const s of STAGES) {
    if (s.act !== chapter) {
      chapter = s.act;
      const inChapter = STAGES.filter((x) => x.act === chapter);
      const done = inChapter.filter((x) => (gridHard ? isHardCleared(x.id) : isStageCleared(x.id))).length;
      head = document.createElement("h2");
      head.className = "chapter";
      head.innerHTML =
        `<span>Chapter ${chapter}</span>` +
        `<span class="chapter-count">${done} / ${inChapter.length}</span>`;
      grid.append(head);
    }
    // On hard, a stage opens by having been BEATEN normally rather than
    // by the previous stage having been beaten — the two tracks unlock on
    // different rules, and hard's is the stricter one.
    const unlocked = gridHard ? isHardUnlocked(s.id) : isStageUnlocked(s.id);
    const cleared = gridHard ? isHardCleared(s.id) : isStageCleared(s.id);
    const card = document.createElement("button");
    card.className = `stage-card${cleared ? " cleared" : ""}${unlocked ? "" : " locked"}`;
    card.disabled = !unlocked;
    const best = getBestTurns(s.id, gridHard);
    card.innerHTML = "";
    // With the names gone the number IS the card, so it gets the size the
    // name used to have and the word "Stage" shrinks to a label. This is
    // also the shape that survives the campaign getting long: "4426" fits
    // where "Quicksand" did, and a four-digit number is still the thing
    // the eye lands on.
    const no = document.createElement("span");
    no.className = "no";
    no.textContent = "Stage";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = unlocked ? String(s.id) : "Locked";
    card.append(no, nm);
    if (unlocked && cleared) {
      card.append(starRow(getStars(s.id, gridHard)));
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = best ? `${best} / par ${s.par}` : "";
      card.append(meta);
    }
    card.onclick = () => {
      playButtonSound();
      startStage(s.id, gridHard);
    };
    grid.append(card);
  }
}

/** How each stone count actually plays, so the choice means something
 * before the first match rather than after it. */
const STONE_COUNT_NOTES = {
  3: "A quick duel. One bad shot decides it.",
  5: "The classic setup. Room to manoeuvre.",
  7: "A crowded board — stones get in each other's way.",
  9: "As many as fit while every stone is still easy to grab.",
};

function renderVersusSetup() {
  const group = $("stone-count");
  const selected = getVersusStoneCount();
  group.replaceChildren();
  for (const count of VERSUS_STONE_COUNTS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(count);
    button.setAttribute("aria-pressed", String(count === selected));
    button.onclick = () => {
      playButtonSound();
      setVersusStoneCount(count);
      renderVersusSetup();
    };
    group.append(button);
  }
  $("stone-note").textContent = STONE_COUNT_NOTES[selected] ?? "";
}

/** How each AI level actually plays, so the choice means something
 * before the first match rather than after it. */
const AI_LEVEL_NOTES = {
  easy: "Aims loosely and misreads the board. A place to learn the drag.",
  medium: "Plans a few shots ahead and mostly executes them.",
  hard: "Searches hard and rarely wastes a turn. What you are training for.",
};

function renderPracticeSetup() {
  const group = $("practice-level");
  const selected = getPracticeLevel();
  group.replaceChildren();
  for (const level of AI_LEVELS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = level[0].toUpperCase() + level.slice(1);
    button.setAttribute("aria-pressed", String(level === selected));
    button.onclick = () => {
      playButtonSound();
      setPracticeLevel(level);
      renderPracticeSetup();
    };
    group.append(button);
  }
  $("practice-note").textContent = AI_LEVEL_NOTES[selected] ?? "";
}

function renderSettings() {
  $("toggle-aim-guide").setAttribute("aria-checked", String(isPvpAimGuideOn()));
}

function renderThemes() {
  const list = $("theme-list");
  const context = themeUnlockContext();
  const unlocked = getUnlockedThemeIds(context);
  const selected = resolveActiveThemeId(getTheme(), context);
  list.replaceChildren();
  for (const theme of THEMES) {
    const isUnlocked = unlocked.includes(theme.id);
    const row = document.createElement("button");
    row.className = `theme-row${theme.id === selected ? " selected" : ""}`;
    row.disabled = !isUnlocked;
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = theme.colors.boardGradientTop
      ? `linear-gradient(${theme.colors.boardGradientTop}, ${theme.colors.boardGradientBottom})`
      : theme.colors.boardColor;
    const text = document.createElement("span");
    const nm = document.createElement("div");
    nm.className = "nm";
    nm.textContent = theme.name;
    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = isUnlocked ? (theme.id === selected ? "Selected" : "Tap to use") : theme.description;
    text.append(nm, desc);
    row.append(swatch, text);
    row.onclick = () => {
      playButtonSound();
      setTheme(theme.id);
      // Each theme brings its own table, measured against its own board.
      applySurround(stage && isCampaign() ? stage.act : null);
      renderThemes();
    };
    list.append(row);
  }
}

function refreshSoundButtons() {
  const icon = isSoundEnabled() ? ICONS.soundOn : ICONS.soundOff;
  $("sound-toggle").innerHTML = icon;
  $("btn-themes").innerHTML = ICONS.palette;
  $("btn-settings").innerHTML = ICONS.gear;
  // The in-game one carries a word in the sidebar layout, so its icon is
  // REPLACED rather than the whole button being rewritten — innerHTML
  // here would delete the label the moment the player muted.
  const gameIcon = $("sound-toggle-game").querySelector("svg");
  if (gameIcon) gameIcon.replaceWith(svgNode(icon));
  else $("sound-toggle-game").insertAdjacentHTML("afterbegin", icon);
}

/** An SVG string as a node, so it can replace an existing one in place. */
function svgNode(markup) {
  const box = document.createElement("div");
  box.innerHTML = markup;
  return box.firstElementChild;
}

// --- layout / resize ------------------------------------------------------
/**
 * THE BOARD MAY NOT BE BIGGER THAN THE ROOM AROUND IT CAN PAY FOR.
 *
 * The pull-back for a shot goes the opposite way from the shot; the
 * pointer is captured so it may leave the canvas, but it cannot leave the
 * window. A stone resting against a wall therefore has only the margin
 * beyond the board to be pulled into. That margin was a few pixels, so a
 * wall stone on a 390px phone could reach 41% power and no more, with
 * nothing on screen to say why — the player just finds that some stones
 * will not fire hard and cannot tell that the screen edge is the reason.
 *
 * The vertical case has been half-handled since the beginning:
 * .board-wrap's 1:2 spacers and its pull-back gutter were sized for a
 * stone on the HOME ROW, which is where the pull actually happens most of
 * the time. A stone knocked flat against the bottom wall sits lower than
 * that and was still short — 59% on a 1920x1080 portal embed. So the same
 * rule now governs both axes, applied to whichever is tighter.
 *
 * THE ARITHMETIC, for one axis. Writing S for the wood's side and `side`
 * for the canvas (which reserves a stone radius outside the wood on each
 * edge, so side = S * (1 + 2r)), the free space between the wood's edge
 * and the window's edge is
 *
 *     free = outer + (box - side)/2 + (side - S)/2
 *          = outer + box/2 - S/2
 *
 * and a stone against the wall sits r*S inside the wood, so the pull has
 *
 *     free + r*S  >=  MAX_DRAG * S
 *
 * Solving for S and multiplying back up by (1 + 2r) gives the cap below.
 * On the vertical axis the box is not split evenly — the spacers put two
 * thirds of the slack below — so the cap is conservative there rather
 * than exact, which is the safe direction to be wrong in.
 *
 * The cost is a smaller board, and it is worth naming: 12% on a phone,
 * 10% on a desktop. What it buys is a drag range that is THE SAME
 * EVERYWHERE ON THE BOARD, which is also what makes the cancel threshold
 * in dragMinimum() tunable at all — before this, how much of the range a
 * player actually had depended on where the stone happened to be sitting.
 */
/** The strip at the very edge of the window that a pull cannot actually
 * use. A finger cannot land on the last pixel of a screen, and on iOS the
 * outermost few pixels belong to the system's own edge gestures — a pull
 * that only reaches full power by touching x = 389.9 has not reached it.
 * Small, but it is the difference between the cap being exactly tight and
 * being true. */
const EDGE_RESERVE = 6;

function maxSideForPull(box, outer) {
  const r = STONE_RADIUS;
  const usable = Math.max(0, outer - EDGE_RESERVE);
  const maxWood = (usable + box / 2) / (0.5 + MAX_DRAG - r);
  return maxWood * (1 + 2 * r);
}

function resizeBoard() {
  const rect = boardWrap.getBoundingClientRect();
  // How much window there is beyond the box: beside it on the tighter
  // side, and below it (the pull that needs the most room is the one for
  // an upward shot, and it goes down).
  const outer = Math.max(0, Math.min(rect.left, window.innerWidth - rect.right));
  const below = Math.max(0, window.innerHeight - rect.bottom);
  const side = Math.max(
    160,
    Math.min(
      rect.width, rect.height,
      maxSideForPull(rect.width, outer),
      maxSideForPull(rect.height, below)
    )
  );
  ctx = fitCanvasToDisplaySize(canvas, side, side);
  layout = boardLayout(side, side);
  aimTableLight(rect, side);
  alignSidebarToBoard(rect, side);
  draw();
}

/**
 * Line the sidebar up with the WOOD, not with the canvas.
 *
 * game/layout.js deliberately reserves a full stone radius outside the
 * board square on every side, because a stone teetering half off the edge
 * is legal and is the most dramatic moment in the game — so the canvas is
 * about 6% taller than the board painted inside it. Aligning the column
 * to the canvas therefore put its first and last rows a visible ~18px
 * above and below the wood, which reads as the panel not quite fitting
 * the thing it belongs to.
 *
 * Measured from the layout rather than derived from STONE_RADIUS in CSS,
 * so it stays correct if the reserve ever changes.
 */
function alignSidebarToBoard(rect, side) {
  const root = document.documentElement.style;
  // The canvas is not always flush with the top of its wrapper — on a
  // tall box .board-wrap's 1:2 spacers sit it a third of the way down —
  // so its offset is measured rather than assumed to be zero.
  const canvasTop = canvas.getBoundingClientRect().top - rect.top;
  const woodTop = canvasTop + (side - layout.size) / 2;
  root.setProperty("--wood-top", `${Math.max(0, woodTop).toFixed(1)}px`);
  root.setProperty("--wood-bottom", `${Math.max(0, rect.height - woodTop - layout.size).toFixed(1)}px`);
}

/**
 * Point the table's pool of light at the BOARD rather than at the middle
 * of the page. In the two-column layout the board sits left of centre by
 * half the sidebar, and a highlight centred on the page put the brightest
 * part of the table in the empty gap beside the board — which is exactly
 * backwards: the lift exists to seat the board, so it has to be under it.
 * Measured rather than computed from the sidebar's width, because the
 * sidebar is a `minmax()` and its real width is only known here.
 */
function aimTableLight(rect, side) {
  const root = document.documentElement.style;
  root.setProperty("--table-x", `${Math.round(rect.left + rect.width / 2)}px`);
  root.setProperty("--table-y", `${Math.round(rect.top + side / 2)}px`);
  // Wide enough that the board sits inside the flat part of the pool and
  // the falloff happens out in the empty space, not across the wood.
  root.setProperty("--table-r", `${Math.round(side * 1.55)}px`);
}

/** The menu has no board to sit under, so the pool goes back to the
 * middle of the page and grows to the size of the screen. */
function centreTableLight() {
  const root = document.documentElement.style;
  root.removeProperty("--table-x");
  root.removeProperty("--table-y");
  root.removeProperty("--table-r");
}

// A ResizeObserver rather than a window resize listener: the board's own
// box changes for reasons the window does not (the HUD wrapping to two
// lines on a narrow phone, the browser's URL bar collapsing on scroll),
// and those are exactly the cases where a stale layout puts the hit test
// and the drawing out of register.
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => {
    if (screenStack[screenStack.length - 1] === "game") resizeBoard();
  }).observe(boardWrap);
} else {
  window.addEventListener("resize", () => {
    if (screenStack[screenStack.length - 1] === "game") resizeBoard();
  });
}

// The briefing card's canvas is sized from its own box too, and that box
// moves when the phone is rotated. It is not inside boardWrap, so the
// observer above never sees it; a plain resize listener is enough because
// the card is only ever on screen while the game is paused.
window.addEventListener("resize", () => {
  if (briefQueue.length > 0) briefDemo.resize();
});

// --- wiring ---------------------------------------------------------------
for (const button of document.querySelectorAll("[data-back]")) {
  // Prepended, not assigned: the game screen's back button also carries a
  // word ("Main Menu") in the sidebar layout, and innerHTML would delete
  // it. The other screens' back buttons have no label to lose.
  button.insertAdjacentHTML("afterbegin", ICONS.back);
  button.addEventListener("click", () => {
    playButtonSound();
    // On the game screen this is now the ONLY way out of a match — the
    // separate "Menu" slab under the board is gone, because back already
    // meant exactly this and two controls for one action is one too many.
    // It has to release a pending interstitial rather than merely pop a
    // screen, which is why the game screen is a special case here.
    if (screenStack[screenStack.length - 1] === "game") {
      releaseResult();
      quitToMenu();
    } else goBack();
  });
}

$("btn-continue").onclick = () => {
  playButtonSound();
  const { id, hard } = getContinuePoint();
  startStage(id, hard);
};
for (const button of $("stage-difficulty").querySelectorAll("button")) {
  button.onclick = () => {
    playButtonSound();
    gridHard = button.dataset.hard === "1";
    renderStageGrid();
  };
}

$("btn-practice").onclick = () => {
  playButtonSound();
  renderPracticeSetup();
  goTo("practice");
};

$("btn-practice-start").onclick = () => {
  playButtonSound();
  startPractice();
};

$("btn-settings").onclick = () => {
  playButtonSound();
  renderSettings();
  goTo("settings");
};

$("toggle-aim-guide").onclick = () => {
  playButtonSound();
  setPvpAimGuide(!isPvpAimGuideOn());
  renderSettings();
};

$("btn-stages").onclick = () => {
  playButtonSound();
  renderStageGrid();
  goTo("stages");
};
$("btn-versus").onclick = () => {
  playButtonSound();
  renderVersusSetup();
  goTo("versus");
};
$("btn-versus-start").onclick = () => {
  playButtonSound();
  startVersus();
};
$("btn-themes").onclick = () => {
  playButtonSound();
  renderThemes();
  goTo("themes");
};
$("btn-retry").onclick = () => {
  playButtonSound();
  restartMatch();
};
// Prepended rather than assigned: the button also holds a text label,
// which innerHTML would delete.
$("btn-retry").insertAdjacentHTML("afterbegin", ICONS.restart);

$("btn-preview").onclick = () => {
  playButtonSound();
  togglePreview();
};
$("btn-preview").insertAdjacentHTML("afterbegin", ICONS.preview);

/**
 * Games, from the game bar — the same panel the site bar opens.
 *
 * This game has no ⋯ overlay to hang it in (DESIGN.md §6 assumes one); its
 * tool group is the equivalent, and it is the only chrome that survives a
 * match. /nav.js owns opening, closing, the focus trap and the analytics,
 * and its public surface is the bar's own button — so this presses it rather
 * than re-implementing any of that. That button is display:none while a
 * match is up, which click() does not care about but focus does: /nav.js
 * hands focus back to #nav-games on close and a hidden element cannot take
 * it. So the one thing left to do here is catch the close and put focus back
 * on the button the player actually pressed.
 */
$("btn-games").insertAdjacentHTML("afterbegin", ICONS.games);
$("btn-games").onclick = () => {
  playButtonSound();
  const panel = $("nav-panel");
  const games = $("nav-games");
  if (!panel || !games) return;
  const back = new MutationObserver(() => {
    if (panel.dataset.open === "true") return;
    back.disconnect();
    $("btn-games").focus();
  });
  back.observe(panel, { attributes: true, attributeFilter: ["data-open"] });
  games.click();
};

$("btn-buy-preview").onclick = () => {
  playButtonSound();
  buyPreview();
};

for (const id of ["sound-toggle", "sound-toggle-game"]) {
  $(id).onclick = () => {
    unlockAudio();
    toggleSound();
    refreshSoundButtons();
    playButtonSound();
  };
}

previewLeft = getPreviewsHeld();
applySurround(null);
renderMenu();
// The bar's markup is written into the page by tools/sync-games.mjs, so its
// links are in the document from the first byte.
wireCrossGameLinks();
notifyLoadingStop();

// The portal's Data module can hold newer progress than this device's
// localStorage (or localStorage can be partitioned away entirely inside
// the portal's iframe), and it only becomes readable after the SDK
// resolves. Re-render every progress-derived surface then — building the
// first screen from pre-reconciliation data was a real shipped bug in
// the previous project, and it only ever reproduced on the live portal.
storageSynced.then(() => {
  // NOT reloadFromStorage() — core/storage.js has already reconciled and
  // may be holding the SDK's newer copy in memory; re-reading
  // localStorage here would throw that away. All this callback owes the
  // player is a re-render.
  // The portal's Data module can hold a preview this device's
  // localStorage does not know about — earned on the player's phone,
  // spent on their laptop. Re-read it for the same reason every other
  // progress-derived surface is re-rendered here.
  previewLeft = getPreviewsHeld();
  refreshPreviewButton();
  renderMenu();
  if (screenStack[screenStack.length - 1] === "stages") renderStageGrid();
  if (screenStack[screenStack.length - 1] === "themes") renderThemes();
});
