// main.js
// Wires core (grid/turn/input/audio/ads) and game (rules/render/ai/
// chains/quickstart) modules together. Milestones 1-7: data model,
// canvas rendering, turn logic, pointer input, the AI opponent, grid
// size selection, and QUICK GAME pre-placement. Milestones 8-9: draw/
// capture animations, procedural sound + on/off toggle, turn-level
// undo. Milestone 10: CrazyGames SDK — interstitial on game over, a
// rewarded-ad-gated Hint button (core/ads.js does the actual SDK work;
// this file just calls onGameOver()/requestRewardedHint() and, for the
// hint itself, reads game/chains.js's existing analyze().safeMoves —
// no game-logic module was changed for any of this). Milestone 13-1:
// localStorage-backed sound/streak persistence (core/storage.js).
// Milestone 13-2: achievements (game/achievements.js defines what they
// are and when they fire; this file tracks the per-game facts they
// need -- deficits, hand-offs, hints used, boxes-per-turn -- and turns
// newly-satisfied ones into toasts). Milestone 13-3: Daily Challenge
// (game/daily.js generates the shared, date-seeded board and decides
// streak transitions; this file wires it into a third gameMode, 'daily',
// that reuses almost the entire vs-AI code path -- see hasAiOpponent()).
// Milestone 13-4: board skins (game/theme.js defines the 4 skins and
// their unlock conditions; this file applies the active one to both the
// canvas -- render()'s new `theme` option -- and the UI chrome -- CSS
// custom properties on <html> -- and reuses the achievement toast
// system verbatim for skin-unlock announcements).
//
// SITE BUILD (easymahjongsolitaire.com). Four things differ from the
// portal build, all of them in this file and all of them marked "SITE
// BUILD" below: core/ads.js is a shim (no SDK, the hint is free), the
// site's GA4 events (game_start / game_win / cross_game_click) are sent
// from the player's own entry points, the shared top bar is hidden while
// a board is live and the canvas is remeasured in the same frame, and
// the bar's Games panel gets an in-game entry point for while it is.

import { computeLayout } from "./core/grid.js";
import { createTurnManager, pickStartingPlayer } from "./core/turn.js";
import { attachPointerHandlers } from "./core/input.js";
import {
  isSoundEnabled,
  toggleSound,
  unlockAudio,
  playDrawSound,
  playCaptureSound,
  playWinSound,
  playLoseSound,
} from "./core/audio.js";
import {
  onGameOver,
  requestRewardedHint,
  notifyGameplayStart,
  notifyGameplayStop,
  getAdSdkReadyState,
} from "./core/ads.js";
import {
  recordStreakResult,
  getUnlockedAchievements,
  unlockAchievement,
  recordHardWin,
  getHardWinsBySize,
  getLocalGamesCompleted,
  incrementLocalGamesCompleted,
  getDailyState,
  recordDailyResult,
  getSkinsState,
  setSelectedSkin,
  unlockSkin,
  recordHardWinForSkins,
} from "./core/storage.js";
import { createGameState, applyMove, undoMove, isValidMove } from "./game/rules.js";
import { analyze } from "./game/chains.js";
import { render, findEdgeAt, edgeKey, boxKey } from "./game/render.js";
import { chooseTurnMoves } from "./game/ai.js";
import { generateQuickStart } from "./game/quickstart.js";
import {
  ACHIEVEMENTS,
  isDeliberateHandoff,
  createDeficitTracker,
  updateDeficitTracking,
  evaluateTurnEnd,
  evaluateGameOver,
} from "./game/achievements.js";
import {
  utcDateString,
  generateDailyBoard,
  dailyConfigForDate,
  nextDailyStreak,
  hasPlayedDailyToday,
  msUntilNextUtcMidnight,
  formatCountdown,
} from "./game/daily.js";
import { THEMES, getTheme, unlockDescription, evaluateNewlyUnlockedThemes } from "./game/theme.js";

const GRID_SIZES = [3, 5, 7];
const DEFAULT_GRID_SIZE = 5;
const AI_PLAYER = 1; // player 0 is always the human

// UX timing (CLAUDE.md section 7 / design notes):
//  - a short "thinking" pause before the AI's first move, so it doesn't
//    look reflexive (an instant move reads as *weaker*, not faster).
//  - a per-move pause while replaying its already-decided turn, so a
//    multi-box capture — and especially a double-cross's deliberate
//    hand-off — is watchable move by move instead of flashing onto the
//    board in a single frame.
const AI_THINK_DELAY_MS = 400;
const AI_STEP_DELAY_MS = 140;

// How long a single edge-draw / box-capture animation runs. Kept short
// on purpose: it's meant to be felt during normal play and not fought
// with during a fast AI replay (AI_STEP_DELAY_MS above) — a longer
// duration would make consecutive AI moves visibly "stack up" mid-anim.
const ANIM_DURATION_MS = 200;

// Every grid size here has an even number of dots per side, which
// structurally disadvantages whoever moves first under the long-chain
// rule (see CLAUDE.md section 3). A pie-rule-style compensation is too
// subtle to explain to a casual player, so instead: randomize who
// starts, and show it briefly so it reads as fair, not arbitrary. Kept
// well under a second — this is a beat, not something to wait through.
const COIN_FLIP_DISPLAY_MS = 800;

// Achievement toast timing (milestone 13-2): long enough to actually
// read ("X unlocked!" plus its icon), short enough not to feel like it's
// blocking anything — and it never does block anything, see the toast
// queue below, which runs entirely independently of gameGeneration/
// inputLocked/AI-turn timing on purpose.
const TOAST_DISPLAY_MS = 2600;
const TOAST_GAP_MS = 300;

// How often the Daily Challenge countdown/entry-button re-check the
// clock (milestone 13-3). A full second is plenty for a "HH:MM:SS"
// display and cheap enough to just always run rather than start/stop it
// around whichever overlay happens to be showing.
const DAILY_TICK_MS = 1000;

// --- hint / undo limits (milestone 16) ----------------------------------
//
// Both exist to fix a real problem, but different ones. Hint: during
// CrazyGames' Basic Launch review, ads are disabled portal-side
// (adsDisabledBasicLaunch — docs.crazygames.com/sdk/video-ads/), so a
// Hint button gated purely on a rewarded ad looks completely dead to a
// reviewer — one free hint per game means there's always something for
// a first-time player (or a QA reviewer) to see actually work, ad SDK
// entirely aside. Undo: unlimited undo lets a vs-AI loss simply be
// replayed away move by move until the AI slips up, which makes win
// streaks, achievements, and the Daily Challenge streak — all of which
// sit directly on top of "did the human actually win" — meaningless.
const FREE_HINTS_PER_GAME = 1;
// Applies to vs-AI AND Daily Challenge (hasAiOpponent()) — deliberately
// NOT just "ai": Daily's own streak is exactly as vulnerable to
// undo-until-you-win as the regular vs-AI streak is; if anything it's
// the more important one to protect, being the headline feature. Local
// 2-player is exempt (see canUndo()) — nobody's streak is at stake, and
// two people sharing a device can just agree to take a move back.
const UNDOS_PER_GAME_VS_AI = 3;

// --- SITE BUILD: analytics ------------------------------------------------
//
// The same shape as every other game on this site: /ga-init.js owns the
// gtag setup, every event carries this page's game_name so it never
// merges with another page's, and window.gtag is checked first — an ad
// blocker, a blocked tag script or a consent tool can all leave it
// undefined, and none of them may take the game down with them.
const GA_NAME = "dots_and_boxes";
function trackEvent(name, params) {
  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, { game_name: GA_NAME, ...params });
    }
  } catch {
    // analytics is never allowed to break a game
  }
}

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const hudEl = document.getElementById("hud");
const turnLabel = document.getElementById("turn-label");
const scoreEls = [document.getElementById("score-0"), document.getElementById("score-1")];
const playerCards = [document.getElementById("player-0"), document.getElementById("player-1")];
const playerLabels = [document.getElementById("player-0-label"), document.getElementById("player-1-label")];
const gameOverBanner = document.getElementById("game-over-banner");
const gameOverText = document.getElementById("game-over-text");
const gameOverScore = document.getElementById("game-over-score");
const gameOverStreak = document.getElementById("game-over-streak");
const rematchBtn = document.getElementById("rematch-btn"); // primary: same settings, one click
const gameOverNewGameBtn = document.getElementById("game-over-new-game-btn"); // secondary: back to setup
const coinFlipBanner = document.getElementById("coin-flip-banner");
const coinFlipText = document.getElementById("coin-flip-text");
const setupOverlay = document.getElementById("setup-overlay");
const startGameBtn = document.getElementById("start-game-btn");
const playFriendBtn = document.getElementById("play-friend-btn");
const modeButtons = [...document.querySelectorAll("#mode-toggle .seg-btn")];
const difficultyRow = document.getElementById("difficulty-row"); // wraps the label + seg-group; hidden together, not just the group
const difficultyButtons = [...document.querySelectorAll("#difficulty-toggle .seg-btn")];
const sizeButtons = [...document.querySelectorAll("#size-toggle .seg-btn")];
const quickstartButtons = [...document.querySelectorAll("#quickstart-toggle .seg-btn")];
const gameControls = document.getElementById("game-controls"); // Undo/Hint/New Game, playing phase only
const restartBtn = document.getElementById("restart-btn");
const undoBtn = document.getElementById("undo-btn");
const hintBtn = document.getElementById("hint-btn");
const soundToggleBtn = document.getElementById("sound-toggle-btn");
const settingsBtn = document.getElementById("settings-btn");
const gamesBtn = document.getElementById("games-btn"); // SITE BUILD: opens the site's Games panel from inside a live game
const settingsOverlay = document.getElementById("settings-overlay");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const achievementsBtn = document.getElementById("achievements-btn");
const achievementsCount = document.getElementById("achievements-count");
const achievementsOverlay = document.getElementById("achievements-overlay");
const achievementsHeaderCount = document.getElementById("achievements-header-count");
const achievementsList = document.getElementById("achievements-list");
const achievementsCloseBtn = document.getElementById("achievements-close-btn");
const toastContainer = document.getElementById("achievement-toast-container");
const dailyChallengeBtn = document.getElementById("daily-challenge-btn");
const dailyPreviewEl = document.getElementById("daily-preview");
const dailyStreakInfo = document.getElementById("daily-streak-info");
const dailyResultOverlay = document.getElementById("daily-result-overlay");
const dailyResultText = document.getElementById("daily-result-text");
const dailyResultScore = document.getElementById("daily-result-score");
const dailyResultStreak = document.getElementById("daily-result-streak");
const dailyCountdownEl = document.getElementById("daily-countdown");
const dailyResultCloseBtn = document.getElementById("daily-result-close-btn");
const skinOpenBtn = document.getElementById("skin-open-btn"); // row inside the settings modal
const skinCurrentSwatch = document.getElementById("skin-current-swatch");
const skinCurrentName = document.getElementById("skin-current-name");
const skinOverlay = document.getElementById("skin-overlay");
const skinList = document.getElementById("skin-list");
const skinCloseBtn = document.getElementById("skin-close-btn");
const confirmOverlay = document.getElementById("confirm-overlay");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");
const confirmOkBtn = document.getElementById("confirm-ok-btn");

// --- modal shell (milestone 14) -----------------------------------------
//
// Three overlays can stack (settings -> skin picker, settings ->
// achievements... though achievements is also independently reachable —
// see its own top-bar button) plus the new-game confirmation. Order here
// is innermost-first: Escape closes whichever of these is currently
// visible, checked in this order, so a nested picker closes before the
// settings modal it was opened from rather than both vanishing at once.
const modalOverlays = [confirmOverlay, skinOverlay, achievementsOverlay, settingsOverlay];

function isAnyModalOpen() {
  return modalOverlays.some((el) => !el.hidden);
}

function updateBodyScrollLock() {
  document.body.classList.toggle("modal-open", isAnyModalOpen());
}

function openModal(el) {
  el.hidden = false;
  updateBodyScrollLock();
}

function closeModal(el) {
  el.hidden = true;
  updateBodyScrollLock();
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  for (const el of modalOverlays) {
    if (!el.hidden) {
      closeModal(el);
      return;
    }
  }
});

// Inline SVG icon markup (milestone 14: no emoji, no icon font/library —
// CLAUDE.md's zero-runtime-dependency rule applies to icons too). Only
// the ones actually swapped or generated in a loop live here as JS
// strings (sound has two states; trophy is drawn once per achievement
// row plus once per toast). The gear and the close-X are static markup
// baked directly into index.html since they never change — no reason to
// route them through JS at all.
const ICONS = {
  soundOn:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3,9 8,9 13,4.5 13,19.5 8,15 3,15" fill="currentColor" stroke="none"/><path d="M16.2 8a5.2 5.2 0 0 1 0 8"/><path d="M18.6 5.3a9 9 0 0 1 0 13.4"/></svg>',
  soundOff:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3,9 8,9 13,4.5 13,19.5 8,15 3,15" fill="currentColor" stroke="none"/><line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/></svg>',
  trophy:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10v3a5 5 0 0 1-10 0V4z"/><path d="M7 5H4a3 3 0 0 0 3 5"/><path d="M17 5h3a3 3 0 0 1-3 5"/><line x1="12" y1="12" x2="12" y2="16"/><path d="M9 20h6"/><path d="M9.5 16.3h5l.7 3.7h-6.4z"/></svg>',
};

// Below this fraction of the board's total edges drawn, "New Game" during
// an active game proceeds with no confirmation — there's nothing
// meaningful to lose yet. At or above it, a confirm dialog gates the
// click (see requestNewGame()) so a stray tap can't erase real progress.
const NEW_GAME_CONFIRM_THRESHOLD = 0.15;

let gridSize = DEFAULT_GRID_SIZE; // 3 | 5 | 7 — applies the next time a game starts
let quickStart = true; // pre-fill the board instead of starting from empty
let gamePhase = "setup"; // 'setup' (configuring, no game yet) | 'playing'
let state = createGameState(gridSize, gridSize);
let turnManager = createTurnManager(2);
let layout = null;
let previewEdge = null; // edge the current pointer gesture is hovering/dragging over
let gameMode = "ai"; // 'local' | 'ai'
let aiDifficulty = "medium"; // 'easy' | 'medium' | 'hard'
let aiThinking = false; // true only during the pre-first-move "thinking" pause
let hintEdge = null; // {type, r, c} to highlight, or null — cleared on any move/reset
let lastStreakResult = null; // {current, best, isNewBest} from the vs-AI game that just ended, or null — cleared on any new/reset game

// state.edgesDrawn at the moment THIS game started (startGame()/
// startDailyChallenge()) — i.e. however many edges Quick Start (or the
// daily board generator, which is Quick Start under the hood) pre-filled
// before either player touched anything. requestNewGame()'s progress
// check subtracts this out: a prefilled edge cost the player nothing and
// a discarded prefilled board is instantly replaced by an equally-good
// random one, so it shouldn't count toward "how much would be lost."
let gameStartEdgesDrawn = 0;

// --- per-game tracking (milestones 13-2 and 16) -------------------------
//
// Everything below is THIS GAME's running context — reset in startGame(),
// startDailyChallenge(), AND enterSetup() (resetPerGameTracking(), all
// three call it). achievementsUnlocked itself is the one exception: it's
// loaded once from core/storage.js at startup and persists for the whole
// session (and across reloads, via storage.js), never reset per-game.
// Originally just achievement bookkeeping (hence the milestone-13-2
// name), now also the hint/undo per-game counters (milestone 16) — same
// "this game's running context, reset at the same three points" shape,
// so it stayed one function rather than growing a second near-identical one.
let achievementsUnlocked = new Set(getUnlockedAchievements());
let turnBoxCount = 0; // boxes captured so far in the turn currently being accumulated
let turnMover = null; // player index turnBoxCount belongs to; null between turns
let deficitTracker = createDeficitTracker();
let handoffTracker = [false, false]; // did player i deliberately hand off a capturable box at any point THIS game (Double Cross)
let hintsUsedThisGame = 0; // ANY hint granted this game, free or ad-based — evaluateGameOverAchievements()'s "No Help Needed" needs both counted
let freeHintsUsedThisGame = 0; // just the free allowance, for the "(N)" button label — see freeHintsRemaining()
let undosUsedThisGame = 0; // counts button PRESSES, not internal turnManager.undoTurn() calls (a vs-AI undo is 2 of the latter for 1 of these) — see undosRemaining()
let toastQueue = [];
let toastShowing = false;

function resetPerGameTracking() {
  turnBoxCount = 0;
  turnMover = null;
  deficitTracker = createDeficitTracker();
  handoffTracker = [false, false];
  hintsUsedThisGame = 0;
  freeHintsUsedThisGame = 0;
  undosUsedThisGame = 0;
}

// --- daily challenge state (milestone 13-3) -----------------------------
//
// gameMode can be 'daily' as well as 'local'/'ai' — see hasAiOpponent()
// below for which existing vs-AI code paths that does (and, just as
// importantly, does NOT) extend to.
let dailyResultVisible = false; // true while #daily-result-overlay is showing
let currentDailyDate = null; // the UTC date string the IN-PROGRESS daily game was generated for -- frozen at start, never re-read from the clock, so a game played across a UTC midnight still records under the day it was generated for
let preDailySettings = null; // {gameMode, gridSize, aiDifficulty} saved right before a daily run so returning to setup restores what the player had configured, rather than leaking the daily's forced size/difficulty into it

// --- board skins (milestone 13-4) ---------------------------------------
//
// Cached rather than re-derived from core/storage.js on every draw() call
// (which the RAF animation loop can call up to 60x/second) — updated
// only when the selection actually changes, via applyActiveTheme().
let activeTheme = getTheme(getSkinsState().selected);

// Guards input while something async owns the board — the AI is
// "thinking" or replaying its planned turn — so clicks can't queue up
// and fire all at once when control comes back.
//
// IMPORTANT: this is only ever set for the AI's turn. A human player
// completing a box and getting a consecutive turn never touches this
// flag — that's still their own turn continuing synchronously, and
// commitAt() just keeps accepting clicks for it exactly as before.
let inputLocked = false;

// Bumped by every startGame()/enterSetup(). A pending AI setTimeout
// captures the generation it was scheduled under; since the "New Game"
// button can abandon a game at any moment — including mid-AI-turn — a
// stale callback checks this and bails instead of mutating a game that
// isn't current anymore.
let gameGeneration = 0;

// In-flight edge-draw / box-capture animations, keyed by edgeKey()/
// boxKey() -> the performance.now() timestamp they started at. Driven
// by a requestAnimationFrame loop that only runs while either map is
// non-empty — draw() is otherwise called synchronously and cheaply, the
// same way it always was before animation existed.
let edgeAnimStarts = new Map();
let boxAnimStarts = new Map();
let animFrameHandle = null;

function buildInitialState() {
  return quickStart ? generateQuickStart(gridSize, gridSize) : createGameState(gridSize, gridSize);
}

// Gates every setup control — mode, difficulty, grid size, quick-start.
// The game is split into two phases specifically so this can be a
// simple, always-correct check: 'setup' has no game in progress to lose
// (the board shown is just a size preview, not live), so anything is
// safe to change; 'playing' means a real game exists — possibly with
// zero moves played so far, e.g. the coin flip landed on the AI and it
// hasn't moved yet — and none of these controls should be able to
// silently discard it. The only way out of 'playing' is the explicit
// "New Game" button.
function canChangeSetup() {
  return gamePhase === "setup";
}

// True for both 'ai' AND 'daily' — a daily game reuses almost the entire
// vs-AI code path (turn scheduling, hint gating, the "AI's turn"/"Your
// turn" label, the win/lose sound) since it IS a vs-AI game underneath,
// just with a fixed date-seeded board and no coin flip. Deliberately
// NOT used everywhere `gameMode === "ai"` appears, though: the vs-AI win
// STREAK (recordStreakForGameOver) and the AI-difficulty-progression
// achievements (First Win, No Help Needed, Grid Master, Hot Streak,
// Unstoppable — see evaluateGameOverAchievements()'s `humanWon`) stay
// gated on the literal `"ai"` string on purpose, because Daily Challenge
// has its OWN separate streak/result system (core/storage.js's `daily`
// block) and mixing the two would be confusing (e.g. a single Daily win
// silently incrementing your regular Hard-difficulty streak). The mode-
// agnostic achievements (Chain Reaction, Shutout, Comeback, ...) are NOT
// specially excluded from daily, though — those measure a genuine skill
// moment regardless of which mode produced it, and already work
// correctly for daily with no extra code (their gates check
// `winnerIndex === 0` / `mover === 0` directly, not the mode string).
function hasAiOpponent() {
  return gameMode === "ai" || gameMode === "daily";
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  // setTransform (not scale) so repeated resizes reset rather than compound.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout = computeLayout(state.rows, state.cols, cssWidth, cssHeight, 28);
  draw();
}

function draw() {
  render(ctx, layout, state, {
    previewEdge,
    previewPlayer: turnManager.current(),
    edgeProgress: progressMap(edgeAnimStarts),
    boxProgress: progressMap(boxAnimStarts),
    hintEdge,
    theme: activeTheme.board,
  });
}

function progressMap(startsMap) {
  if (startsMap.size === 0) return null;
  const now = performance.now();
  const out = new Map();
  for (const [key, startedAt] of startsMap) {
    out.set(key, Math.min(1, (now - startedAt) / ANIM_DURATION_MS));
  }
  return out;
}

// --- draw / capture animations ---------------------------------------
//
// Purely a rendering flourish (CLAUDE.md section 7's "the only hand-feel
// this game has") — nothing here affects game state. Starting an
// animation just records a timestamp and (re)starts the RAF loop that
// keeps calling draw() until every in-flight animation has crossed its
// duration, at which point the loop stops itself.

function startEdgeAnimation(type, r, c) {
  edgeAnimStarts.set(edgeKey(type, r, c), performance.now());
  ensureAnimLoop();
}

function startBoxAnimation(r, c) {
  boxAnimStarts.set(boxKey(r, c), performance.now());
  ensureAnimLoop();
}

// Undoing removes edges/boxes outright rather than animating them away,
// so any animation still tracking them would just be dead weight kept
// alive until it timed out on its own — dropped immediately instead.
function resetAnimations() {
  edgeAnimStarts.clear();
  boxAnimStarts.clear();
  if (animFrameHandle !== null) {
    cancelAnimationFrame(animFrameHandle);
    animFrameHandle = null;
  }
}

function ensureAnimLoop() {
  if (animFrameHandle !== null) return;
  animFrameHandle = requestAnimationFrame(animTick);
}

function animTick() {
  const now = performance.now();
  pruneFinished(edgeAnimStarts, now);
  pruneFinished(boxAnimStarts, now);
  draw();
  if (edgeAnimStarts.size > 0 || boxAnimStarts.size > 0) {
    animFrameHandle = requestAnimationFrame(animTick);
  } else {
    animFrameHandle = null;
  }
}

function pruneFinished(startsMap, now) {
  for (const [key, startedAt] of startsMap) {
    if (now - startedAt >= ANIM_DURATION_MS) startsMap.delete(key);
  }
}

function updateHud() {
  // First screen shows no score yet; the empty board preview gets the
  // vertical space instead (milestone 14).
  hudEl.hidden = gamePhase !== "playing";

  scoreEls[0].textContent = state.scores[0];
  scoreEls[1].textContent = state.scores[1];

  playerLabels[0].textContent = "Player 1";
  playerLabels[1].textContent = hasAiOpponent() ? `AI · ${capitalize(aiDifficulty)}` : "Player 2";

  playerCards.forEach((el, i) => {
    el.classList.toggle("active", !state.gameOver && turnManager.current() === i);
  });

  turnLabel.textContent = turnLabelText();

  // Daily Challenge never shows the normal game-over banner (Rematch
  // doesn't make sense — you can't replay today's board) — it gets its
  // own #daily-result-overlay instead, shown via showDailyResult().
  gameOverBanner.hidden = !state.gameOver || gameMode === "daily" || dailyResultVisible;
  if (state.gameOver && gameMode !== "daily") {
    gameOverText.textContent = gameOverMessage();
    gameOverScore.textContent = `Final score: ${state.scores[0]} – ${state.scores[1]}`;
    const streakText = streakMessage();
    gameOverStreak.textContent = streakText;
    gameOverStreak.hidden = !streakText;
    gameOverStreak.classList.toggle("new-best", !!lastStreakResult?.isNewBest);
  }
  dailyResultOverlay.hidden = !dailyResultVisible;
  updateDailyButton();

  // All four setup controls (mode, difficulty, size, quick-start) share
  // one rule: locked as soon as any move has actually been played, back
  // open once the game's over or a fresh New Game starts. They now live
  // inside the settings modal, which is itself unreachable during play
  // (settingsBtn.disabled below) — this per-button disabling is kept as
  // defense in depth rather than the primary guard.
  const setupLocked = !canChangeSetup();

  modeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === gameMode);
    btn.disabled = setupLocked;
  });
  difficultyRow.classList.toggle("hidden", gameMode !== "ai");
  difficultyButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.difficulty === aiDifficulty);
    btn.disabled = setupLocked;
  });

  sizeButtons.forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.size) === gridSize);
    btn.disabled = setupLocked;
  });
  // Daily Challenge always pre-fills the board (game/daily.js calls
  // generateQuickStart() unconditionally, ignoring the `quickStart`
  // variable entirely) regardless of whatever the player last had this
  // toggle set to — display that reality while a daily game is active,
  // rather than showing a stale "Classic" that doesn't match the actual
  // board on screen.
  const effectiveQuickStart = gameMode === "daily" ? true : quickStart;
  quickstartButtons.forEach((btn) => {
    btn.classList.toggle("active", (btn.dataset.quickstart === "on") === effectiveQuickStart);
    btn.disabled = setupLocked;
  });

  // The big "Play" CTA lives over the board (impossible to miss) during
  // setup; #game-controls (Undo/Hint/New Game) takes over once a game
  // exists — one container hidden/shown together rather than each button
  // toggling its own `hidden`.
  setupOverlay.hidden = gamePhase !== "setup" || dailyResultVisible;
  gameControls.hidden = gamePhase !== "playing";
  undoBtn.disabled = !canUndo();
  hintBtn.disabled = !canHint();
  // Undo's count is meaningful even at 0 (it's WHY the button is
  // disabled) so it always shows for a limited mode; local 2-player has
  // no limit at all, so no count reads as more honest than "(∞)". Hint's
  // count only shows while free ones remain — once it hits 0 the button
  // isn't actually out of options (an ad attempt is still possible), so
  // "(0)" would read as more final than it is.
  undoBtn.textContent = hasAiOpponent() ? `Undo (${undosRemaining()})` : "Undo";
  hintBtn.textContent = freeHintsRemaining() > 0 ? `Hint (${freeHintsRemaining()})` : "Hint";

  // Settings (and everything nested behind it — mode/difficulty/size/
  // quick-start/skin) is only reachable from setup. Achievements is
  // deliberately NOT gated this way — see its top-bar button's comment
  // in index.html.
  settingsBtn.disabled = gamePhase === "playing";

  // SITE BUILD: last, deliberately — syncNav() remeasures the canvas when
  // it changes anything, and it must read the DOM this function has just
  // finished settling (the same reason enterSetup()/startGame() call
  // updateHud() before resizeCanvas(); see their comments and CLAUDE.md's
  // design note about the offset hit-testing bug that ordering caused).
  syncNav();
}

function turnLabelText() {
  if (state.gameOver) return "Game over";
  if (aiThinking) return "AI is thinking…";
  if (hasAiOpponent()) {
    return turnManager.current() === AI_PLAYER ? "AI's turn" : "Your turn";
  }
  return `Player ${turnManager.current() + 1}'s turn`;
}

function gameOverMessage() {
  if (state.winner === "draw") return "It's a draw!";
  if (gameMode === "ai") {
    return state.winner === AI_PLAYER ? "AI wins!" : "You win!";
  }
  return `Player ${state.winner + 1} wins!`;
}

// lastStreakResult is null for local 2-player games (streaks don't apply
// there) — an empty string means "don't show the streak line at all",
// which updateHud() uses to hide gameOverStreak entirely rather than
// showing an empty or misleading line.
function streakMessage() {
  if (!lastStreakResult) return "";
  const { current, best, isNewBest } = lastStreakResult;
  if (current > 0) {
    // A win is the only way current ends up > 0 here — recordStreakResult()
    // resets it to 0 on both a loss and a draw.
    return isNewBest ? `New best streak: ${current}!` : `${current} in a row`;
  }
  // Streak just broke (or this vs-AI difficulty has never had one) —
  // leave a target instead of just silence, unless there's genuinely
  // nothing to aim for yet.
  return best > 0 ? `Best streak: ${best}` : "";
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- achievement tracking hooks (milestone 13-2) -----------------------
//
// beforeApplyMoveAchievements()/afterApplyMoveAchievements() bracket
// every single applyMove() call, in both commitAt() (human) and
// playAiMoveStep() (AI) — the "before" half needs the state as it stood
// right before this specific edge was drawn (isDeliberateHandoff() reads
// capturableBoxes, which stops existing the instant the edge is drawn),
// and the "after" half needs the result applyMove() just returned.

/**
 * @param {{type:'h'|'v', r:number, c:number}} edge - about to be drawn
 * @returns {number} the player who's about to move (pass straight through to afterApplyMoveAchievements)
 */
function beforeApplyMoveAchievements(edge) {
  const mover = turnManager.current();
  if (isDeliberateHandoff(state, edge)) handoffTracker[mover] = true;
  return mover;
}

function afterApplyMoveAchievements(mover, result) {
  if (turnMover !== mover) {
    // First move of a fresh turn (or right after performUndo() reset
    // these) — start this turn's box count from zero.
    turnBoxCount = 0;
    turnMover = mover;
  }
  turnBoxCount += result.completedBoxes.length;
  updateDeficitTracking(deficitTracker, state.scores);

  // A turn "ends" either normally (no extra turn granted) or because the
  // game itself just ended on a move that WOULD have granted one — either
  // way there's no more of this turn left to accumulate.
  if (!result.extraTurn || result.gameOver) {
    const creditable = gameMode === "local" || mover === 0; // vs AI: only the human's own turns count
    grantAchievements(evaluateTurnEnd({ boxesThisTurn: turnBoxCount, creditable }, achievementsUnlocked));
    turnBoxCount = 0;
    turnMover = null;
  }
}

// Records this game's outcome into the two cumulative, persisted facts
// (Hard win per grid size, local games completed) BEFORE building the
// context achievements are checked against — so grid_master/
// local_legend see THIS game's own contribution, not just prior ones.
// Only called once, from playMoveSound()'s result.gameOver branch (same
// "fires exactly once" guarantee as onGameOver()/recordStreakForGameOver()
// next to it).
function evaluateGameOverAchievements() {
  const winnerIndex = state.winner === "draw" ? null : state.winner;
  const humanWon = gameMode === "ai" && winnerIndex === 0; // player 0 is always the human
  const creditableWin = winnerIndex !== null && (gameMode === "local" || winnerIndex === 0);

  let allHardSizesWon = false;
  if (humanWon && aiDifficulty === "hard") {
    const record = recordHardWin(gridSize);
    allHardSizesWon = GRID_SIZES.every((size) => record[size]);
  }

  let localGamesCompletedTotal = getLocalGamesCompleted();
  if (gameMode === "local") {
    localGamesCompletedTotal = incrementLocalGamesCompleted();
  }

  const ctx = {
    mode: gameMode,
    gridSize,
    difficulty: aiDifficulty,
    humanWon,
    creditableWin,
    winnerScore: winnerIndex === null ? null : state.scores[winnerIndex],
    opponentScore: winnerIndex === null ? null : state.scores[winnerIndex === 0 ? 1 : 0],
    maxDeficitForWinner:
      winnerIndex === null ? 0 : winnerIndex === 0 ? deficitTracker.maxDeficit0 : deficitTracker.maxDeficit1,
    handoffByWinner: winnerIndex === null ? false : handoffTracker[winnerIndex],
    hintsUsed: hintsUsedThisGame,
    // lastStreakResult is set just before this function is called (see
    // playMoveSound()) — current is 0 for a loss/draw or a local game,
    // exactly what hot_streak/unstoppable need.
    currentStreak: lastStreakResult ? lastStreakResult.current : 0,
    allHardSizesWon,
    localGamesCompletedTotal,
  };

  return evaluateGameOver(ctx, achievementsUnlocked);
}

// Persists + records newly-unlocked achievements and queues their
// toasts. Safe to call with an empty array (the common case — most
// turns/games unlock nothing).
function grantAchievements(defs) {
  if (defs.length === 0) return;
  for (const def of defs) {
    unlockAchievement(def.id); // persist (idempotent, but these are always genuinely new here)
    achievementsUnlocked.add(def.id);
  }
  updateAchievementsBadge();
  queueAchievementToasts(defs);
}

function updateAchievementsBadge() {
  const text = `${achievementsUnlocked.size}/${ACHIEVEMENTS.length}`;
  achievementsCount.textContent = text;
  achievementsHeaderCount.textContent = text;
}

// Toasts are deliberately NOT gated by gameGeneration/inputLocked/
// anything else game-state-related — an achievement unlock is permanent
// and worth showing even if the player immediately hits New Game right
// after earning it. They render into a viewport-fixed container (see
// index.html) positioned well clear of the board/HUD/game-over banner,
// so there's nothing to coordinate z-index-wise: it's always on top,
// and simply never overlaps anything else because of where it sits.
//
// Generic queue of {text, icon?} items — started out achievement-only
// (hence the CSS class names below still reading ".achievement-toast"),
// generalized in milestone 16 for the Hint button's "no hint available"
// feedback, which needs the exact same fire-and-forget stacking behavior
// but no trophy icon and no "unlocked!" suffix.
function queueToasts(items) {
  toastQueue.push(...items);
  if (!toastShowing) showNextToast();
}

function queueAchievementToasts(defs) {
  queueToasts(defs.map((def) => ({ text: `${def.title} unlocked!`, icon: ICONS.trophy })));
}

/** A single plain-text toast, no icon — e.g. "No hint available right now". */
function queueInfoToast(text) {
  queueToasts([{ text }]);
}

function showNextToast() {
  const item = toastQueue.shift();
  if (!item) {
    toastShowing = false;
    return;
  }
  toastShowing = true;
  const el = document.createElement("div");
  el.className = "achievement-toast";
  if (item.icon) {
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.innerHTML = item.icon;
    el.append(icon);
  }
  const label = document.createElement("span");
  label.textContent = item.text;
  el.append(label);
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.remove();
    setTimeout(showNextToast, TOAST_GAP_MS);
  }, TOAST_DISPLAY_MS);
}

// Achievement list screen: every achievement is always listed, locked
// ones included, with its real title/description showing — CLAUDE.md's
// milestone note is explicit that a hidden reward isn't motivating.
// Re-rendered fresh each time the panel opens (12 rows, cheap) rather
// than kept in sync incrementally.
function renderAchievementsPanel() {
  achievementsList.innerHTML = "";
  for (const def of ACHIEVEMENTS) {
    const isUnlocked = achievementsUnlocked.has(def.id);
    const li = document.createElement("li");
    li.className = `achievement-row ${isUnlocked ? "unlocked" : "locked"}`;

    // Same trophy icon either way — "locked" is communicated by the
    // dimmed opacity (.achievement-row.locked .achievement-icon in CSS),
    // not a separate padlock glyph (milestone 14: only 4 icons total).
    const icon = document.createElement("span");
    icon.className = "achievement-icon";
    icon.innerHTML = ICONS.trophy;

    const text = document.createElement("span");
    text.className = "achievement-text";
    const title = document.createElement("span");
    title.className = "achievement-title";
    title.textContent = def.title;
    const desc = document.createElement("span");
    desc.className = "achievement-desc";
    desc.textContent = def.description;
    text.append(title, desc);

    li.append(icon, text);
    achievementsList.appendChild(li);
  }
}

// --- board skins (milestone 13-4) ---------------------------------------
//
// No currency, no purchases (CLAUDE.md rules both out) — every skin
// unlocks purely from an in-game accomplishment. Unlock status itself is
// always freshly RE-DERIVED from current facts (achievement count, a
// Hard win, best daily streak) rather than tracked as a one-time event —
// see game/theme.js's module comment for why that's safe here. The
// persisted `unlocked` list in core/storage.js exists only so a skin's
// toast fires exactly once, the same "don't re-announce" role
// achievementsUnlocked plays for achievements.

function buildSkinFacts() {
  return {
    unlockedAchievementCount: achievementsUnlocked.size,
    hasHardWin: getSkinsState().hasHardWin,
    bestDailyStreak: getDailyState().bestStreak,
  };
}

// Called once at startup (catches anything an existing player already
// qualified for before skins existed) and once after every game-over
// (see playMoveSound()) — cheap and idempotent either way, so there's no
// harm calling it more often than strictly necessary rather than trying
// to thread a "did a relevant fact actually change" check through three
// different call sites.
function checkForNewlySkins() {
  const skins = getSkinsState();
  const newly = evaluateNewlyUnlockedThemes(buildSkinFacts(), skins.unlocked);
  if (newly.length === 0) return;
  for (const theme of newly) unlockSkin(theme.id);
  // Reuses the same generic toast queue achievements use (CLAUDE.md's
  // milestone note: "업적 토스트와 같은 시스템 재사용").
  queueToasts(newly.map((t) => ({ text: `${t.name} skin unlocked!`, icon: ICONS.trophy })));
  if (!skinOverlay.hidden) renderSkinPanel(); // live-refresh if the picker happens to be open right now
}

// Applies the currently-selected skin to both the canvas (activeTheme,
// read by draw()) and the UI chrome (CSS custom properties on <html> —
// the same variables :root already defines, just overridden with an
// inline style, which wins on specificity). Called at startup and
// immediately after a selection change; never anywhere else, so there's
// exactly one place "what does the page look like right now" gets
// decided from persisted state.
function applyActiveTheme() {
  activeTheme = getTheme(getSkinsState().selected);
  for (const [cssVar, value] of Object.entries(activeTheme.cssVars)) {
    document.documentElement.style.setProperty(cssVar, value);
  }
  playerCards.forEach((el, i) => {
    el.style.setProperty("--player-color", activeTheme.board.playerColors[i]);
  });
  skinCurrentName.textContent = activeTheme.name;
  skinCurrentSwatch.style.background = activeTheme.board.background;
  if (layout) draw(); // guarded: layout isn't set yet the very first time this runs at module load
}

// Skin picker: every skin is always listed, locked ones included, with
// their real unlock requirement showing — same "a hidden reward isn't
// motivating" reasoning as the achievements panel. A small two-dot
// swatch (background + both player colors) previews each skin without
// needing to actually switch to it first.
function renderSkinPanel() {
  const skins = getSkinsState();
  skinList.innerHTML = "";
  for (const theme of THEMES) {
    const unlocked = skins.unlocked.includes(theme.id);
    const isSelected = skins.selected === theme.id;
    const li = document.createElement("li");
    li.className = `skin-row ${unlocked ? "unlocked" : "locked"}${isSelected ? " selected" : ""}`;

    const swatch = document.createElement("span");
    swatch.className = "skin-swatch";
    swatch.style.background = theme.board.background;
    for (const playerColor of theme.board.playerColors) {
      const dot = document.createElement("span");
      dot.className = "skin-swatch-dot";
      dot.style.background = playerColor;
      swatch.appendChild(dot);
    }

    const text = document.createElement("span");
    text.className = "skin-text";
    const title = document.createElement("span");
    title.className = "skin-title";
    title.textContent = theme.name;
    const desc = document.createElement("span");
    desc.className = "skin-desc";
    desc.textContent = unlocked ? (isSelected ? "Selected" : "Tap to select") : unlockDescription(theme);
    text.append(title, desc);

    li.append(swatch, text);
    if (unlocked && !isSelected) {
      li.addEventListener("click", () => {
        if (setSelectedSkin(theme.id)) {
          applyActiveTheme();
          renderSkinPanel();
        }
      });
    }
    skinList.appendChild(li);
  }
}

// Fires right after an applyMove() call, using the {completedBoxes,
// gameOver} it returned — never from updateHud(), which runs many times
// per move and would replay the tone on every one of them.
function playMoveSound(result) {
  if (result.completedBoxes.length > 0) {
    playCaptureSound();
  } else {
    playDrawSound();
  }
  if (result.gameOver) {
    // A short beat after the capture/draw tone so the two don't clip
    // into each other.
    setTimeout(playGameOverSound, 150);
    // Ad hook (CLAUDE.md section 8): a no-op today (core/ads.js), the
    // interstitial trigger point once the portal SDK is wired in.
    // Fires exactly once — result.gameOver is only ever true on the
    // single move that ends the game.
    onGameOver();
    // Milestone 13-1: per-difficulty AI win streak. Same "fires exactly
    // once" guarantee as onGameOver() above — this is the one place a
    // vs-AI game is known to have just ended, as opposed to updateHud(),
    // which runs many times over while state.gameOver stays true.
    lastStreakResult = recordStreakForGameOver();
    // Milestone 13-2: game-over achievements. Must run AFTER
    // lastStreakResult is set above — evaluateGameOverAchievements()
    // reads it for hot_streak/unstoppable.
    grantAchievements(evaluateGameOverAchievements());
    // Milestone 13-3: Daily Challenge result + streak. Deliberately
    // separate from recordStreakForGameOver() above (gameMode !== "ai"
    // for a daily game, so that one is already a no-op here) — Daily
    // Challenge has its own storage.js block and its own streak entirely.
    if (gameMode === "daily") recordDailyChallengeResult();
    // Milestone 13-4: Neon's unlock fact — a Hard win in ANY mode with an
    // AI opponent (vs AI or Daily), deliberately broader than
    // achievements.js's vs-AI-only hardWinsBySize (see storage.js's
    // recordHardWinForSkins() doc comment for why that's intentional).
    if (hasAiOpponent() && aiDifficulty === "hard" && state.winner === 0) {
      recordHardWinForSkins();
    }
    // Re-derive skin unlocks from whatever just changed above (achievement
    // count, the Hard-win fact, or the daily streak) and toast anything new.
    checkForNewlySkins();
    // SITE BUILD: game_win, in the same "fires exactly once" spot as
    // onGameOver() above. A draw is not a win, and neither is the AI
    // taking the board; a finished local 2-player game IS one — somebody
    // at that device won it, and there is no "you" to lose.
    const humanWon = hasAiOpponent() ? state.winner === 0 : state.winner !== "draw";
    if (humanWon) {
      trackEvent("game_win", {
        mode: gameMode,
        difficulty: hasAiOpponent() ? aiDifficulty : undefined,
        size: gridSize,
        score: state.scores[0],
        opponent_score: state.scores[1],
      });
    }
  }
}

// Records this game's outcome against aiDifficulty's streak — but only
// for a vs-AI game that actually finished. Local 2-player never touches
// streaks (there's no "AI difficulty" for it to belong to), and leaving
// mid-game via New Game never reaches here at all (state.gameOver never
// becomes true), so an abandoned game correctly counts as nothing.
function recordStreakForGameOver() {
  if (gameMode !== "ai") return null;
  const humanWon = state.winner === 0; // player 0 is always the human (see AI_PLAYER above); false covers both an AI win AND a draw, which both break the streak the same way
  return recordStreakResult(aiDifficulty, humanWon);
}

function playGameOverSound() {
  if (state.winner === "draw") {
    playWinSound(); // a draw is still a clean finish, not a loss
    return;
  }
  if (hasAiOpponent()) {
    (state.winner === AI_PLAYER ? playLoseSound : playWinSound)();
  } else {
    // Local 2-player: there's no single "you" to lose, so the game-over
    // sting is always the celebratory one.
    playWinSound();
  }
}

function setPreview(edge) {
  previewEdge = edge;
  draw();
}

function updatePreview(pos, pointerType) {
  if (gamePhase !== "playing" || state.gameOver || inputLocked || isAnyModalOpen() || !layout) {
    setPreview(null);
    return;
  }
  setPreview(findEdgeAt(layout, state, pos.x, pos.y, pointerType));
}

function commitAt(pos, pointerType) {
  // isAnyModalOpen() is defensive here — settingsBtn is disabled whenever
  // gamePhase === "playing" (the only phase this function does anything
  // in), so a modal shouldn't actually be reachable at the same time as
  // a live board. Cheap enough to check anyway (CLAUDE.md's "모달 열림
  // 중에는 게임 입력이 잠겨야 한다" requirement, taken literally).
  if (gamePhase !== "playing" || state.gameOver || inputLocked || isAnyModalOpen() || !layout) return;
  const edge = findEdgeAt(layout, state, pos.x, pos.y, pointerType);
  if (!edge || !isValidMove(state, edge.type, edge.r, edge.c)) {
    setPreview(null);
    return;
  }
  const mover = beforeApplyMoveAchievements(edge);
  const result = applyMove(state, turnManager, edge.type, edge.r, edge.c);
  afterApplyMoveAchievements(mover, result);
  startEdgeAnimation(edge.type, edge.r, edge.c);
  for (const box of result.completedBoxes) startBoxAnimation(box.r, box.c);
  playMoveSound(result);
  previewEdge = null;
  hintEdge = null; // the board moved on; whatever was suggested no longer applies
  draw();
  updateHud();
  scheduleAiTurnIfNeeded();
}

// --- AI turn ---------------------------------------------------------
//
// chooseTurnMoves() plans the AI's ENTIRE turn in one call — every edge
// it will draw, in order — precisely because deciding a double-cross
// requires knowing a chain's true length before any of it is eaten (see
// game/ai.js's module comment). The loop below only ever REPLAYS that
// already-decided array at a human-watchable pace; it never calls the
// AI again mid-turn.

function isAiTurn() {
  return gamePhase === "playing" && hasAiOpponent() && !state.gameOver && turnManager.current() === AI_PLAYER;
}

function scheduleAiTurnIfNeeded() {
  if (!isAiTurn()) return;
  inputLocked = true;
  aiThinking = true;
  updateHud();
  const myGeneration = gameGeneration;
  setTimeout(() => runAiTurn(myGeneration), AI_THINK_DELAY_MS);
}

function runAiTurn(myGeneration) {
  if (myGeneration !== gameGeneration) return; // the board was reset while we were "thinking"
  const moves = chooseTurnMoves(state, AI_PLAYER, aiDifficulty);
  aiThinking = false;
  if (moves.length === 0) {
    // Shouldn't happen — chooseTurnMoves() always returns at least one
    // move — but fail safe rather than leave input locked forever.
    inputLocked = false;
    updateHud();
    return;
  }
  playAiMoveStep(moves, 0, myGeneration);
}

function playAiMoveStep(moves, index, myGeneration) {
  if (myGeneration !== gameGeneration) return; // stale — a newer game has since started
  const move = moves[index];
  const mover = beforeApplyMoveAchievements(move);
  const result = applyMove(state, turnManager, move.type, move.r, move.c);
  afterApplyMoveAchievements(mover, result);
  startEdgeAnimation(move.type, move.r, move.c);
  for (const box of result.completedBoxes) startBoxAnimation(box.r, box.c);
  playMoveSound(result);
  hintEdge = null; // defensive: hint is never offered on the AI's turn, but the board did move
  draw();

  // Unlock BEFORE the update that announces "your turn" — not after —
  // so the label and the actual ability to click always change in the
  // same paint. Doing this the other way around leaves a real gap
  // where the UI claims it's your turn but clicks still get swallowed
  // until the next scheduled step fires.
  const isLastMove = index === moves.length - 1;
  if (isLastMove || state.gameOver) {
    inputLocked = false;
  }
  updateHud();

  if (!isLastMove && !state.gameOver) {
    setTimeout(() => playAiMoveStep(moves, index + 1, myGeneration), AI_STEP_DELAY_MS);
  }
}

// --- undo --------------------------------------------------------------
//
// Undo works in whole TURNS, not single edges (core/turn.js's
// undoTurn() — see its doc comment for why). Only ever offered when it's
// safe to click: a real game is in progress, nothing async currently
// owns the board, the game hasn't already ended, AND (milestone 16)
// there's still an allowance left for this mode — see undosRemaining().
//
// In AI mode, the visible "Undo" always hands control straight back to
// the human: it's only enabled when it's the human's turn (i.e. the AI
// just finished responding), and pressing it undoes BOTH the AI's reply
// AND the human move that provoked it — CLAUDE.md's "내 수 + AI 응수 둘
// 다 되감기" requirement. One turn's worth of undo would otherwise just
// hand the move straight back to the AI to redo identically. This was
// gated on the literal `gameMode === "ai"` string before milestone 16 —
// changed to hasAiOpponent() while touching this function anyway,
// fixing what turned out to be a real pre-existing bug: Daily Challenge
// (gameMode === "daily") never got the second undoTurn(), so pressing
// Undo there only rewound the AI's reply and left turnManager pointed
// AT the AI with the human's own flawed move still on the board —
// scheduleAiTurnIfNeeded() at the bottom of this function would then
// just make the AI immediately respond again (usually identically,
// since chooseTurnMoves() is deterministic for an unchanged board),
// which reads as "Undo did nothing." Found by tracing core/turn.js's
// undoTurn() semantics directly while implementing the limit below, not
// something that was reported — confirmed via Playwright afterward
// (see the milestone note in CLAUDE.md for the exact repro).
//
// Below FREE_HINTS_PER_GAME/UNDOS_PER_GAME_VS_AI's own comments for why
// Daily shares the vs-AI limit rather than being unlimited or separate.

function undosRemaining() {
  return hasAiOpponent() ? Math.max(0, UNDOS_PER_GAME_VS_AI - undosUsedThisGame) : Infinity;
}

function canUndo() {
  return (
    gamePhase === "playing" &&
    !inputLocked &&
    !state.gameOver &&
    turnManager.getHistory().length > 0 &&
    undosRemaining() > 0
  );
}

function revertEntry(entry) {
  undoMove(state, entry.move, entry.player);
}

function performUndo() {
  if (!canUndo()) return;
  // One button press = one undo, regardless of how many internal
  // turnManager.undoTurn() calls it takes below (vs-AI/Daily is always
  // 2: the AI's reply, then the human's own move) — the limit is about
  // how many times the PLAYER can reach for this button, not an
  // internal implementation detail of what one press rewinds.
  undosUsedThisGame++;

  turnManager.undoTurn(revertEntry);
  if (hasAiOpponent() && turnManager.getHistory().length > 0) {
    turnManager.undoTurn(revertEntry);
  }

  // The turn(s) just undone never happened as far as the achievement
  // tracker is concerned — without this, a same-player continuation
  // right after undo would keep accumulating turnBoxCount from a turn
  // that's no longer real. (deficitTracker/handoffTracker are
  // deliberately left as-is: they're "did this ever happen this game
  // session" trackers, and reverting them accurately would mean
  // replaying the whole game from scratch — the minor over-counting
  // this can cause, e.g. Comeback crediting a deficit the player then
  // undid their way out of, is an accepted simplification.)
  turnBoxCount = 0;
  turnMover = null;

  const remaining = turnManager.peekLast();
  state.lastMove = remaining
    ? { type: remaining.move.type, r: remaining.move.r, c: remaining.move.c, player: remaining.player }
    : null;

  resetAnimations();
  previewEdge = null;
  hintEdge = null; // the board just changed underneath it
  draw();
  updateHud();

  // Normally a no-op (undoing both halves of an AI round-trip always
  // hands the turn back to the human). The one case it isn't: the AI won
  // the coin flip and its opening move is the ONLY entry in history —
  // there's no preceding human turn for the second undoTurn() to reach,
  // so this can leave turnManager.current() pointed at the AI with
  // nothing scheduled to make it move. Re-checking here (exactly what
  // every other AI-turn entry point does) resumes it instead of
  // stranding the board in a state where the next human click would get
  // silently recorded as the AI's move.
  scheduleAiTurnIfNeeded();
}

// --- hint (free allowance, then a rewarded ad) --------------------------
//
// Always user-initiated (the button below), never shown mid-turn or
// unprompted — CrazyGames' placement rules for rewarded ads. The reward
// itself is a highlighted safe move read straight off game/chains.js's
// existing analyze().safeMoves; this file never re-derives "what's
// safe," only asks chains.js and highlights whichever one comes back.
//
// Milestone 16: FREE_HINTS_PER_GAME free hints before ever touching the
// ad path. During CrazyGames' Basic Launch review specifically, ads are
// portal-side disabled (adsDisabledBasicLaunch), so an ad-only Hint
// button is permanently, silently dead on first submission — exactly
// the kind of "nothing happens" state QA sees and casual players
// bounce off of. One guaranteed-free hint means the button always does
// SOMETHING at least once, ad SDK entirely aside.

function freeHintsRemaining() {
  return Math.max(0, FREE_HINTS_PER_GAME - freeHintsUsedThisGame);
}

function canHint() {
  if (gamePhase !== "playing" || inputLocked || state.gameOver) return false;
  if (hasAiOpponent() && turnManager.current() === AI_PLAYER) return false;
  if (analyze(state).safeMoves.length === 0) return false;
  if (freeHintsRemaining() > 0) return true;
  // Once free hints are used up, only a CONFIRMED-unavailable ad SDK
  // (getAdSdkReadyState() === false) disables the button outright —
  // `null` (still resolving) or `true` (SDK present) both leave it
  // clickable, since neither one means a specific ad request is
  // guaranteed to succeed or fail; that's only knowable by trying (see
  // getAdSdkReadyState()'s own doc comment in core/ads.js).
  return getAdSdkReadyState() !== false;
}

// Shared by both the free and ad-granted paths below — picks and
// highlights one of the board's current safe moves. Re-reads analyze()
// rather than trusting a value cached from canHint()'s check: for the ad
// path specifically, input was locked for the whole ad duration so the
// board couldn't have changed, but re-deriving here costs nothing and
// means this never has to reason about whether a cached value is stale.
function grantHint() {
  const { safeMoves } = analyze(state);
  if (safeMoves.length > 0) {
    hintEdge = safeMoves[Math.floor(Math.random() * safeMoves.length)];
  }
}

async function performHint() {
  if (!canHint()) return;

  if (freeHintsRemaining() > 0) {
    // No ad, no async wait — this is instant, so unlike the ad path
    // below there's nothing to lock input for.
    freeHintsUsedThisGame++;
    hintsUsedThisGame++; // No Help Needed tracks ALL hints, free or paid — see evaluateGameOverAchievements()
    grantHint();
    draw();
    updateHud();
    return;
  }

  const myGeneration = gameGeneration;
  // Locked the same way an AI turn locks input: requestRewardedHint()
  // hands off to the portal's ad player, which owns the screen for as
  // long as it's showing — no board interaction should be possible
  // (or even meaningful) until it resolves.
  inputLocked = true;
  updateHud();

  const granted = await requestRewardedHint();

  if (myGeneration !== gameGeneration) return; // New Game / rematch happened mid-ad
  inputLocked = false;
  if (granted) {
    hintsUsedThisGame++;
    grantHint();
  } else {
    // SITE BUILD: unreachable in practice — this site's core/ads.js
    // shim always grants, because the preview is simply free here (no
    // ad to fail). Kept, with the ad wording gone, as the honest answer
    // if the shim is ever swapped back for a real one: a silent failure
    // is indistinguishable from a broken button from the player's side.
    queueInfoToast("No hint available right now");
  }
  draw();
  updateHud();
}

// --- daily challenge (milestone 13-3) -----------------------------------
//
// Reuses almost the entire vs-AI game loop (commitAt/playAiMoveStep/
// applyMove/chooseTurnMoves, undo, hint — all completely untouched by
// this section) via gameMode = "daily" + hasAiOpponent() above. What's
// genuinely different: the board comes from game/daily.js's date-seeded
// generator instead of buildInitialState(), there's no coin flip (the
// human always moves first — see startDailyChallenge()'s comment), and
// finishing routes to a dedicated result overlay instead of the normal
// game-over banner (Rematch doesn't make sense for a board everyone in
// the world is sharing today).

// current/best are both 0 and nothing has ever been played -> nothing
// worth printing (mirrors streakMessage()'s same "don't show an empty
// target" judgment call for the regular vs-AI streak).
function dailyStreakText(daily) {
  if (daily.currentStreak > 0) return `${daily.currentStreak} day streak${daily.bestStreak > daily.currentStreak ? ` · Best: ${daily.bestStreak}` : ""}`;
  return daily.bestStreak > 0 ? `Best streak: ${daily.bestStreak} days` : "";
}

// Drives the setup-overlay entry point's text/styling AND the result
// overlay's streak line — called from updateHud() (so it's always fresh
// whenever anything else changes) and from the once-a-second daily
// ticker (so it also self-corrects if the page is left open across a
// UTC midnight without any interaction at all).
function updateDailyButton() {
  const daily = getDailyState();
  const playedToday = hasPlayedDailyToday(daily, utcDateString());
  if (playedToday) {
    dailyChallengeBtn.textContent = daily.lastResult?.won ? "Today: Won" : "Today: Played";
  } else {
    dailyChallengeBtn.textContent = "Daily Challenge";
  }
  // "daily-ready" is the eye-catching styling CLAUDE.md's daily
  // requirements ask for when today hasn't been played yet; already-
  // played today gets the same quiet .small-btn-ish treatment as
  // everything else in the setup overlay.
  dailyChallengeBtn.classList.toggle("daily-ready", !playedToday);
  // Shown regardless of played/not-played, and regardless of the fixed
  // weekly pattern being a spoiler — CLAUDE.md's own reasoning for this:
  // a player who learns "Friday is always 7x7 Hard" has a concrete
  // reason to come back on a Friday specifically, which is worth more
  // than the mild surprise of not knowing in advance.
  const todayConfig = dailyConfigForDate(new Date());
  dailyPreviewEl.textContent = `Today: ${todayConfig.gridSize}×${todayConfig.gridSize} · ${capitalize(todayConfig.difficulty)}`;
  dailyStreakInfo.textContent = dailyStreakText(daily);
}

// Shown both right after finishing today's daily game AND when the
// entry button is clicked on a day already played (re-opening the same
// result) — one function, one code path, for both cases.
function showDailyResult(daily) {
  const result = daily.lastResult;
  if (!result) return; // defensive — shouldn't be reachable without one
  dailyResultVisible = true;
  dailyResultText.textContent = result.won ? "You beat today's challenge!" : "Better luck tomorrow!";
  dailyResultScore.textContent = `Final score: ${result.playerScore} – ${result.aiScore}`;
  dailyResultStreak.textContent = dailyStreakText(daily);
  updateDailyCountdownDisplays();
  updateHud();
}

function hideDailyResult() {
  dailyResultVisible = false;
}

// Only ever called once, from playMoveSound()'s result.gameOver branch,
// and only for gameMode === "daily" — same "fires exactly once" spot
// every other game-over hook (onGameOver/recordStreakForGameOver/
// evaluateGameOverAchievements) already uses.
function recordDailyChallengeResult() {
  const won = state.winner === 0; // human is always player 0 in daily (no coin flip — see startDailyChallenge())
  const priorDaily = getDailyState();
  const newStreak = nextDailyStreak({
    currentStreak: priorDaily.currentStreak,
    lastPlayedDate: priorDaily.lastPlayedDate,
    todayDateString: currentDailyDate,
    won,
  });
  const updated = recordDailyResult({
    dateString: currentDailyDate,
    won,
    playerScore: state.scores[0],
    aiScore: state.scores[1],
    newStreak,
  });
  showDailyResult(updated);
}

// Ticks the "next challenge in HH:MM:SS" countdown once a second and
// piggybacks the daily button's own refresh onto the same interval —
// see updateDailyButton()'s comment for why that matters even when
// nothing else is happening on the page.
function updateDailyCountdownDisplays() {
  const text = `Next challenge in ${formatCountdown(msUntilNextUtcMidnight())}`;
  if (dailyResultVisible) dailyCountdownEl.textContent = text;
  updateDailyButton();
}

// Bypasses the normal setup flow entirely — today's grid size and
// difficulty are fixed by the date (game/daily.js's dailyConfigForDate()),
// not chosen by the player, so there's nothing to configure. The
// player's own setup selections are saved and restored (see
// preDailySettings' declaration) so playing a daily doesn't silently
// overwrite what they'd picked for their next regular game.
function startDailyChallenge() {
  gameGeneration++; // invalidates any AI turn/coin-flip reveal still in flight from a prior game
  gamePhase = "playing";
  notifyGameplayStart();

  preDailySettings = { gameMode, gridSize, aiDifficulty };
  const board = generateDailyBoard();
  gameMode = "daily";
  gridSize = board.gridSize;
  aiDifficulty = board.difficulty;
  currentDailyDate = board.dateString;

  state = board.state;
  gameStartEdgesDrawn = state.edgesDrawn; // the daily board is Quick Start under the hood — see the variable's own comment
  // SITE BUILD: the other player-initiated start. Reported with the
  // date-fixed size/difficulty the board actually came out at, not with
  // whatever the player had configured for a regular game.
  trackEvent("game_start", {
    mode: "daily",
    difficulty: aiDifficulty,
    size: gridSize,
    quick_start: true,
  });
  // The human always moves first in the daily challenge — deliberately
  // NOT a coin flip. The whole point of the feature is that everyone
  // gets the identical board; leaving who-goes-first to Math.random()
  // would reintroduce exactly the kind of per-player unfairness the
  // shared board is supposed to eliminate (this game's own first-move
  // (dis)advantage is real — see CLAUDE.md section 3's parity note —
  // so it can't be waved off as inconsequential here).
  turnManager = createTurnManager(2, 0);
  previewEdge = null;
  hintEdge = null;
  lastStreakResult = null;
  resetPerGameTracking();
  aiThinking = false;
  inputLocked = false; // no coin-flip reveal to wait through
  resetAnimations();
  hideDailyResult();
  updateHud();
  resizeCanvas();
}

// --- setup / controls --------------------------------------------------

// Back to a configurable, no-game-yet state: mode/difficulty/size/quick
// start are all open to change, and the board shown is just a size
// preview (never interactive — see gamePhase's check in
// updatePreview()/commitAt()). This is what the "New Game" button does
// once a game is underway, and what the page lands on before the first
// game too — settings get picked, THEN the player explicitly starts,
// rather than a game (and possibly the AI's opening move) committing
// itself before they've had a chance to look at the options.
function enterSetup() {
  gameGeneration++; // invalidates any AI turn or coin-flip reveal still in flight
  notifyGameplayStop(); // "entering a menu" (CrazyGames SDK) — idempotent no-op if a game was never active
  // Restore whatever mode/size/difficulty the player had configured
  // before a daily run overwrote them (a no-op the rest of the time —
  // preDailySettings is only ever non-null right after startDailyChallenge()).
  if (preDailySettings) {
    ({ gameMode, gridSize, aiDifficulty } = preDailySettings);
    preDailySettings = null;
  }
  gamePhase = "setup";
  state = createGameState(gridSize, gridSize);
  turnManager = createTurnManager(2);
  previewEdge = null;
  hintEdge = null;
  lastStreakResult = null;
  resetPerGameTracking();
  inputLocked = false;
  aiThinking = false;
  hideCoinFlip();
  hideDailyResult();
  resetAnimations();
  // updateHud() BEFORE resizeCanvas(), not after: updateHud() is what
  // actually flips undo/hint/restart's `hidden` attribute, which can
  // change how many rows the settings bar wraps to and therefore how
  // tall #board-wrap (flex: 1) actually is. Reading canvas.clientHeight
  // (inside resizeCanvas()) before that DOM change has been applied
  // would compute `layout` against the WRONG, about-to-be-stale canvas
  // size — see the design-decision note in CLAUDE.md for the exact bug
  // this caused (horizontal-edge hit-testing silently offset on the Y
  // axis only, since only the row of buttons' height changes, never
  // their row's width).
  updateHud();
  resizeCanvas(); // recomputes layout from the now-settled canvas size, then draws
}

// Commits to the settings currently selected and actually begins a
// game: coin flip, reveal, then play (including the AI's own opening
// move if it won the flip).
function startGame() {
  gameGeneration++;
  const myGeneration = gameGeneration;
  gamePhase = "playing";
  notifyGameplayStart(); // CrazyGames SDK: "game start" — fires the moment play actually begins, not gated behind the coin-flip reveal
  // SITE BUILD: the player's OWN entry into a game — Play, Rematch, or
  // "Play with a friend". Never at boot: the page lands on enterSetup()
  // with a dead board preview behind the Play button, so nothing here
  // counts a game the player did not ask for.
  trackEvent("game_start", {
    mode: gameMode,
    difficulty: gameMode === "ai" ? aiDifficulty : undefined,
    size: gridSize,
    quick_start: quickStart,
  });

  state = buildInitialState();
  gameStartEdgesDrawn = state.edgesDrawn; // 0 for Classic, ~35% for Quick Start (see the variable's own comment)
  const startingPlayer = pickStartingPlayer(2);
  turnManager = createTurnManager(2, startingPlayer);
  previewEdge = null;
  hintEdge = null;
  lastStreakResult = null;
  resetPerGameTracking();
  aiThinking = false;
  inputLocked = true; // locked through the coin-flip reveal, same as an AI turn
  resetAnimations();
  // See enterSetup()'s matching comment: updateHud() (which reveals
  // undo/hint/restart and can change the settings bar's wrapped height)
  // must run BEFORE resizeCanvas() reads canvas.clientHeight, or layout
  // gets computed against the canvas's pre-reveal size.
  updateHud();
  resizeCanvas();
  showCoinFlip(startingPlayer);

  setTimeout(() => {
    if (myGeneration !== gameGeneration) return; // superseded by a newer game/setup
    hideCoinFlip();
    inputLocked = false;
    updateHud();
    scheduleAiTurnIfNeeded();
  }, COIN_FLIP_DISPLAY_MS);
}

function showCoinFlip(startingPlayer) {
  coinFlipText.textContent = coinFlipMessage(startingPlayer);
  coinFlipBanner.hidden = false;
}

function hideCoinFlip() {
  coinFlipBanner.hidden = true;
}

function coinFlipMessage(startingPlayer) {
  if (gameMode === "ai") {
    return startingPlayer === AI_PLAYER ? "AI goes first" : "You go first";
  }
  return `Player ${startingPlayer + 1} goes first`;
}

function setMode(mode) {
  if (mode === gameMode || !canChangeSetup()) return;
  gameMode = mode;
  enterSetup(); // stay in setup, just refresh the HUD/preview for the new mode
}

function setDifficulty(difficulty) {
  if (difficulty === aiDifficulty || !canChangeSetup()) return;
  aiDifficulty = difficulty;
  enterSetup();
}

function setGridSize(size) {
  if (size === gridSize || !canChangeSetup()) return;
  gridSize = size;
  enterSetup(); // rebuilds the preview board at the new size
}

function setQuickStart(enabled) {
  if (enabled === quickStart || !canChangeSetup()) return;
  quickStart = enabled;
  enterSetup();
}

// One Pointer Events path for mouse, touch, and pen:
//  - mouse: onMove fires continuously (real hover) -> live ghost preview.
//           onDown/onUp is a click; onUp commits at the release point.
//  - touch: no hover. onDown starts the preview where the finger lands,
//           onMove while pressed drags it along, onUp commits on release.
//           This is what lets a finger overshoot the line and still work.
attachPointerHandlers(canvas, {
  onMove(pos, meta) {
    updatePreview(pos, meta.pointerType);
  },
  onDown(pos, meta) {
    updatePreview(pos, meta.pointerType);
  },
  onUp(pos, meta) {
    commitAt(pos, meta.pointerType);
  },
  onCancel() {
    setPreview(null);
  },
});

// Game-over banner: one-click instant rematch with the current settings
// (CLAUDE.md's "즉시 재대결" requirement) — skips setup entirely. This is
// the exact same startGame() the big setup-phase CTA below calls, so a
// rematch gets its own coin flip, its own flip-reveal banner, and —
// if the AI wins that flip — an automatically-starting AI turn, all for
// free. New Game next to it is the alternative: back to setup instead
// of an instant restart.
rematchBtn.addEventListener("click", startGame);
gameOverNewGameBtn.addEventListener("click", enterSetup);

// The big overlay CTA, only visible during setup.
startGameBtn.addEventListener("click", startGame);

// "Play with a friend" (milestone 14): skips the settings modal entirely
// and starts a 2-player local game immediately with whatever size/quick-
// start is currently configured — only `gameMode` is forced. Mirrors
// setMode()'s own canChangeSetup() guard defensively, though this link
// is only ever visible during setup anyway.
function playWithFriend() {
  if (!canChangeSetup()) return;
  gameMode = "local";
  startGame();
}
playFriendBtn.addEventListener("click", playWithFriend);

// --- New Game confirmation (milestone 14) -------------------------------
//
// The in-game "New Game" pill discards the current game outright. The
// point of confirming is protecting what the PLAYER invested — and a
// Quick Start prefill isn't that: it cost nobody a click, and discarding
// it instantly regenerates an equally-good random one next time Play is
// pressed. So the progress ratio is measured only over edges drawn AFTER
// the game started (state.edgesDrawn - gameStartEdgesDrawn) against only
// the edges that were actually still blank to draw (state.totalEdges -
// gameStartEdgesDrawn) — NOT the raw edgesDrawn/totalEdges fraction, which
// would count Quick Start's ~35% prefill as if the player had drawn it.
// Below NEW_GAME_CONFIRM_THRESHOLD of THAT ratio there's nothing real to
// lose, so it proceeds immediately (matches Rematch/game-over's New Game,
// which also never confirm — the game's already over there). At or above
// it, a confirm modal gates it so a stray tap can't erase real progress.
function requestNewGame() {
  if (gamePhase !== "playing") {
    enterSetup();
    return;
  }
  const playableEdges = state.totalEdges - gameStartEdgesDrawn;
  const drawnSinceStart = state.edgesDrawn - gameStartEdgesDrawn;
  const progress = playableEdges > 0 ? drawnSinceStart / playableEdges : 0;
  if (progress < NEW_GAME_CONFIRM_THRESHOLD) {
    enterSetup();
    return;
  }
  openModal(confirmOverlay);
}
restartBtn.addEventListener("click", requestNewGame);
confirmCancelBtn.addEventListener("click", () => closeModal(confirmOverlay));
confirmOkBtn.addEventListener("click", () => {
  closeModal(confirmOverlay);
  enterSetup();
});
confirmOverlay.addEventListener("click", (e) => {
  if (e.target === confirmOverlay) closeModal(confirmOverlay); // click on the backdrop cancels
});

undoBtn.addEventListener("click", performUndo);
hintBtn.addEventListener("click", performHint);
window.addEventListener("resize", resizeCanvas);

// --- SITE BUILD: the site's top bar and its Games panel ------------------
//
// DESIGN.md §6. The bar's markup is generated into index.html by
// tools/sync-games.mjs and its behaviour — open, close, Escape, the focus
// trap, the language grid — belongs to the shared /nav.js. Three things
// are this game's own responsibility and live here:
//
//   1. the bar HIDES while a board is live, and the canvas is remeasured
//      in the same frame every time that flips (syncNav);
//   2. while it is hidden the panel is still reachable, from #games-btn in
//      the game's own top row (openGamesPanel);
//   3. the cross-game links the bar and the panel carry report themselves
//      (wireCrossGameLinks — copied from the site's game.js, which the
//      site-shell pages use for exactly this).

const siteNavPanel = document.getElementById("nav-panel");
const siteNavGamesBtn = document.getElementById("nav-games");
const siteNavLangBtn = document.getElementById("nav-lang");
const siteNavSheet = document.getElementById("nav-panel-sheet");
const siteNavBody = document.getElementById("nav-panel-body");

/** The bar takes a real row of a page that cannot scroll, so during play
 *  it is both a mis-tap hazard over a board you tap on and 56px the board
 *  could have had. Hidden by a body attribute (CSS does the rest) and, if
 *  and only if that actually changed, the canvas is remeasured right here
 *  — the canvas is sized from its own clientWidth/clientHeight, so a
 *  hidden bar it has not been told about is a board drawn at the wrong
 *  size with every edge's hitbox offset to match.
 *
 *  Returns nothing on purpose: no caller has to remember to remeasure.
 *  Called from the end of updateHud(), which every phase change runs. */
function syncNav() {
  const want = gamePhase === "playing" ? "hidden" : "shown";
  if (gamesBtn) gamesBtn.hidden = gamePhase !== "playing";
  if (document.body.dataset.nav === want) return;
  document.body.dataset.nav = want;
  if (layout) resizeCanvas(); // guarded: not yet set on the very first pass at boot
}

/** Opens the shared panel from inside the game.
 *
 *  /nav.js is shared by every page on the site and a game does not edit
 *  it, so this reproduces its open steps rather than reaching into it —
 *  deliberately just the open half. Everything after that is still
 *  /nav.js's: Close, Escape, the backdrop at 1040px+, the focus trap and
 *  the language grid all key off the same data-open attribute and work
 *  whoever set it. The one thing /nav.js cannot do for us is give focus
 *  back to a button it has never heard of, so a short-lived observer does
 *  that when the panel closes.
 *
 *  nav_open's placement is "game_menu", not "top_nav" — the whole point
 *  of DESIGN.md §8's two placements is being able to tell an open from
 *  the bar apart from an open from inside a game, which is why this does
 *  not simply click the bar's own button. */
function openGamesPanel() {
  if (!siteNavPanel || siteNavPanel.dataset.open === "true") return;
  // The game's own modals close first: the panel covers them anyway
  // (style.css puts it above both), and leaving one open underneath
  // would strand body.modal-open's scroll lock behind it.
  for (const overlay of [confirmOverlay, skinOverlay, achievementsOverlay, settingsOverlay]) {
    if (overlay && !overlay.hidden) closeModal(overlay);
  }
  siteNavPanel.dataset.open = "true";
  document.body.classList.add("nav-open");
  if (siteNavGamesBtn) siteNavGamesBtn.setAttribute("aria-expanded", "true");
  if (siteNavLangBtn) siteNavLangBtn.setAttribute("aria-expanded", "true");
  if (siteNavBody) siteNavBody.scrollTop = 0; // the same list from the same place every time
  if (siteNavSheet) siteNavSheet.focus({ preventScroll: true });
  trackEvent("nav_open", { from: GA_NAME, placement: "game_menu" });

  const observer = new MutationObserver(() => {
    if (siteNavPanel.dataset.open === "true") return;
    observer.disconnect();
    // Only take focus back if /nav.js's own close has not already put it
    // somewhere deliberate inside the page.
    if (gamesBtn && !gamesBtn.hidden) gamesBtn.focus();
  });
  observer.observe(siteNavPanel, { attributes: true, attributeFilter: ["data-open"] });
}

if (gamesBtn) gamesBtn.addEventListener("click", openGamesPanel);

// The bar's own Games button is /nav.js's, and it opens the panel without
// telling us. That is fine except for one thing: this game's modals would
// stay open underneath it. Watching the attribute covers both openers.
if (siteNavPanel) {
  new MutationObserver(() => {
    if (siteNavPanel.dataset.open !== "true") return;
    for (const overlay of [confirmOverlay, skinOverlay, achievementsOverlay, settingsOverlay]) {
      if (overlay && !overlay.hidden) closeModal(overlay);
    }
  }).observe(siteNavPanel, { attributes: true, attributeFilter: ["data-open"] });
}

/** Every cross-game link on the page reports itself. Copied from the
 *  site's game.js: the link carries where it goes (data-crossgame-to) and
 *  where it sits (data-placement), so this code does not list games and
 *  does not change when one is added. On this page the links are the
 *  bar's wordmark (placement "top_nav_brand", and the heir to the old
 *  "More free games →" line, id and all) and the panel's ten other cards
 *  (placement "top_nav"). /nav.js deliberately leaves them to us: it only
 *  wires them on the pages that have no game runtime of their own. */
function wireCrossGameLinks() {
  for (const el of document.querySelectorAll("a[data-crossgame-to]")) {
    el.addEventListener("click", () => {
      trackEvent("cross_game_click", {
        from: GA_NAME,
        to: el.getAttribute("data-crossgame-to"),
        placement: el.getAttribute("data-placement") || "unknown",
      });
    });
  }
}
wireCrossGameLinks();

// Sound toggle is independent of gamePhase/canChangeSetup — muting isn't
// a game setting that could discard a game in progress, so it's always
// clickable.
function updateSoundButton() {
  const on = isSoundEnabled();
  soundToggleBtn.innerHTML = on ? ICONS.soundOn : ICONS.soundOff;
  soundToggleBtn.classList.toggle("active", on);
  soundToggleBtn.setAttribute("aria-label", on ? "Mute sound" : "Unmute sound");
}
soundToggleBtn.addEventListener("click", () => {
  // Belt-and-suspenders alongside core/audio.js's own document-level
  // gesture listener — this click is unambiguously a real user gesture,
  // so there's no reason not to also use it as an unlock opportunity
  // (see unlockAudio()'s doc comment).
  unlockAudio();
  toggleSound();
  updateSoundButton();
});
updateSoundButton();

// Achievements panel: always reachable regardless of gamePhase — a
// read-only progress view, unlike settings, can't affect a game in
// progress, and it's exactly what a player wants mid-game right after an
// achievement toast fires (milestone 14 decision — see its top-bar
// button's comment in index.html).
achievementsBtn.addEventListener("click", () => {
  renderAchievementsPanel();
  openModal(achievementsOverlay);
});
achievementsCloseBtn.addEventListener("click", () => closeModal(achievementsOverlay));
achievementsOverlay.addEventListener("click", (e) => {
  if (e.target === achievementsOverlay) closeModal(achievementsOverlay); // click on the backdrop closes
});
updateAchievementsBadge();

// Daily Challenge entry point: starts today's game if it hasn't been
// played yet, or re-opens today's already-recorded result if it has.
dailyChallengeBtn.addEventListener("click", () => {
  const daily = getDailyState();
  if (hasPlayedDailyToday(daily, utcDateString())) {
    showDailyResult(daily);
  } else {
    startDailyChallenge();
  }
});
// Always routes back through enterSetup() — a single exit path whether
// this is closing a just-finished game's result or one reopened later
// (the latter has no in-progress game state to clean up, but enterSetup()
// resetting it anyway is harmless).
dailyResultCloseBtn.addEventListener("click", enterSetup);
// Ticks the "next challenge" countdown and self-corrects the entry
// button's played/not-played state across a UTC midnight rollover, even
// if the page has otherwise sat idle — see updateDailyCountdownDisplays().
setInterval(updateDailyCountdownDisplays, DAILY_TICK_MS);

// Settings modal (milestone 14): the single entry point for mode/
// difficulty/size/quick-start/skin. Disabled (not just gated on click)
// during play — see updateHud()'s settingsBtn.disabled — so this handler
// never actually needs to check gamePhase itself.
settingsBtn.addEventListener("click", () => openModal(settingsOverlay));
settingsCloseBtn.addEventListener("click", () => closeModal(settingsOverlay));
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeModal(settingsOverlay); // click on the backdrop closes
});

// Skin picker: opened from the settings modal's "Board Skin" row, which
// is itself only reachable from setup — see settingsBtn above.
skinOpenBtn.addEventListener("click", () => {
  renderSkinPanel();
  openModal(skinOverlay);
});
skinCloseBtn.addEventListener("click", () => closeModal(skinOverlay));
skinOverlay.addEventListener("click", (e) => {
  if (e.target === skinOverlay) closeModal(skinOverlay); // click on the backdrop closes
});

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});
difficultyButtons.forEach((btn) => {
  btn.addEventListener("click", () => setDifficulty(btn.dataset.difficulty));
});
sizeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setGridSize(Number(btn.dataset.size)));
});
quickstartButtons.forEach((btn) => {
  btn.addEventListener("click", () => setQuickStart(btn.dataset.quickstart === "on"));
});

// One-time backfill for players upgrading from before skins existed: if
// they already have a Hard win recorded (milestone 13-2's per-size
// hardWinsBySize, vs-AI only) from before this milestone shipped, credit
// it toward Neon immediately rather than requiring them to win Hard
// again just to trip the new fact.
if (!getSkinsState().hasHardWin && Object.values(getHardWinsBySize()).some(Boolean)) {
  recordHardWinForSkins();
}
resizeCanvas(); // sets `layout` — must run before applyActiveTheme()'s draw() call below
applyActiveTheme();
checkForNewlySkins(); // retroactively unlock + toast anything an existing player already qualifies for
enterSetup();
