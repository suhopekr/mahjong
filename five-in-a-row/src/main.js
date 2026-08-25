// src/main.js
// Entry point for Five in a Row — a port of the "Daily Five" Gomoku
// project, stripped down to what this site actually ships.
//
// --- what this port dropped, and why -----------------------------------
//
// - The game-portal SDK, in full. No loading/gameplay lifecycle
//   notifications, no interstitials, no ad-gated features, and no
//   place in this file that ever awaits an external script. That removes
//   the single async dependency the original had outside its own AI.
// - The Daily Challenge. It was the original's primary entry point and
//   touched roughly a tenth of the file (a hero card, a countdown timer,
//   a status modal, a separate streak, a separate result panel row, and
//   its own game-start path). Practice vs AI and local 2-player are what
//   remain, and the setup screen is built around those two.
// - Every limit that existed to create ad inventory. Hints are unlimited
//   and instant; undo is unlimited in every mode, matching the rest of
//   this site's undo policy.
// - Theme unlock conditions (see game/themes.js's own header).
//
// --- what this port added ----------------------------------------------
//
// Board size is a real setting (9 / 11 / 15) rather than the original's
// hardcoded `const BOARD_SIZE = 15`. The logic layer needed no changes
// for this — game/board.js, game/layout.js and game/ai.js were already
// written against a size parameter — so the whole feature is this file
// reading a persisted value and passing it to createGameState().

import { createGameState, placeStone, undoMove } from "./game/board.js";
import { boardLayout, pointToIntersection } from "./game/layout.js";
import { drawBoard, drawGhostStone, drawHintMarker, drawForbiddenMarker, fitCanvasToDisplaySize } from "./game/render.js";
import { attachPointerHandlers } from "./core/input.js";
import { createTurnManager, pickStartingPlayer } from "./core/turn.js";
import { chooseMove, generateCandidates } from "./game/ai.js";
import { countPatterns } from "./game/evaluate.js";
import { suggestHint } from "./game/hint.js";
import { findForbiddenPointsForBlack, forbiddenReasonText } from "./game/renju.js";
import { ACHIEVEMENTS, evaluateAchievements } from "./game/achievements.js";
import { THEMES, getThemeById, resolveActiveThemeId } from "./game/themes.js";
import {
  playStoneSound,
  playWinSound,
  playLoseSound,
  playDrawGameSound,
  isSoundEnabled,
  toggleSound,
  unlockAudio,
} from "./core/audio.js";
import {
  BOARD_SIZES,
  recordStreakResult,
  getUnlockedAchievements,
  unlockAchievement,
  recordHardWin,
  getHardWinsByColor,
  recordHardWinByColor,
  getLocalGamesCompleted,
  incrementLocalGamesCompleted,
  getTheme,
  setTheme,
  isRenjuEnabled,
  setRenjuEnabled,
  getBoardSize,
  setBoardSize,
  getMode,
  setMode,
  getDifficulty,
  setDifficulty,
} from "./core/storage.js";

// --- icons ---------------------------------------------------------------
//
// Every icon this page uses, as inline SVG rather than emoji. Emoji
// render inconsistently across platforms (different glyph shapes, no real
// size control, can't inherit a surrounding text color). Every path here
// uses `stroke="currentColor"` (or `fill="currentColor"` for the solid
// ones) instead of a hardcoded color, so an icon always matches whatever
// CSS `color` its container has. A single object here — rather than
// literal markup duplicated in index.html — means every place an icon
// appears gets it from one source.
const ICONS = {
  trophy: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 5H4a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4"/><path d="M17 5h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4"/><path d="M12 14v3"/><path d="M8 21h8"/><path d="M10 21v-2a2 2 0 0 1 2-2 2 2 0 0 1 2 2v2"/></svg>`,
  palette: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3c1.9 0 3.5-1.6 3.5-3.5C21 6.4 17 2 12 2z"/><circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="11" cy="7" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8" r="1.1" fill="currentColor" stroke="none"/></svg>`,
  speakerOn: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="4,9 8,9 13,5 13,19 8,15 4,15" fill="currentColor" stroke="none"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>`,
  speakerMuted: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="4,9 8,9 13,5 13,19 8,15 4,15" fill="currentColor" stroke="none"/><line x1="16" y1="9" x2="21" y2="14"/><line x1="21" y1="9" x2="16" y2="14"/></svg>`,
  // Achievements still have a genuine locked state — that's the feature.
  // Themes no longer do (game/themes.js), so this icon appears in the
  // achievements list only.
  lock: `<svg class="icon icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
  gear: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
};

// How long the coin-flip result stays on screen before play begins —
// long enough to read, short enough not to feel like a loading screen.
const COIN_FLIP_DISPLAY_MS = 900;

// The AI's perceived "thinking" time is topped up to at least this much
// (never shortened) — measured per difficulty: easy ~3-5ms, medium
// ~45ms, hard ~350ms. Without a floor, easy/medium would appear to move
// instantly, reading as "didn't think" rather than "is weaker." 400ms
// sits just above Hard's own typical compute time, so Hard gets little
// to no extra padding while easy/medium get topped up to roughly the
// same felt delay.
const MIN_AI_THINK_MS = 400;

// Stone pop-in: a stone landing reads as an instant, slightly springy
// click, not a slow fade.
const STONE_ANIMATION_MS = 90;
// The win line sweeping into place is deliberately longer and more
// deliberate than a per-move stone pop; there's no per-move time budget
// pressure on it since it only ever happens once per game.
const WIN_LINE_ANIMATION_MS = 550;

// How long the result panel waits before appearing. It used to appear in
// the same frame the winning move landed — on top of the very line that
// was still sweeping into place, so the one moment worth watching was
// covered by a box announcing that it had happened. The delay is the
// sweep's own duration plus a short beat to let it land.
const GAME_OVER_REVEAL_MS = WIN_LINE_ANIMATION_MS + 250;

const canvas = document.getElementById("board");
const gameContent = document.getElementById("game-content");
const boardWrap = document.getElementById("board-wrap");
const mainContent = document.getElementById("main-content");
const turnLabel = document.getElementById("turn-label");
const hintBtn = document.getElementById("hint-btn");
const undoBtn = document.getElementById("undo-btn");
const newGameBtn = document.getElementById("new-game-btn");
const controls = document.getElementById("controls");
const setupPanel = document.getElementById("setup-panel");
const modeToggle = document.getElementById("mode-toggle");
const difficultyRow = document.getElementById("difficulty-row");
const difficultyToggle = document.getElementById("difficulty-toggle");
const boardSizeToggle = document.getElementById("board-size-toggle");
const startGameBtn = document.getElementById("start-game-btn");
const coinFlipBanner = document.getElementById("coin-flip-banner");
const coinFlipText = document.getElementById("coin-flip-text");
const gameOverBanner = document.getElementById("game-over-banner");
const gameOverText = document.getElementById("game-over-text");
const gameOverStreak = document.getElementById("game-over-streak");
const rematchBtn = document.getElementById("rematch-btn");
const gameOverNewGameBtn = document.getElementById("game-over-new-game-btn");
const soundToggleBtn = document.getElementById("sound-toggle-btn");
const achievementsBtn = document.getElementById("achievements-btn");
const achievementsOverlay = document.getElementById("achievements-overlay");
const achievementsCloseBtn = document.getElementById("achievements-close-btn");
const achievementsCountLabel = document.getElementById("achievements-count-label");
const achievementsList = document.getElementById("achievements-list");
const achievementToastContainer = document.getElementById("achievement-toast-container");
const themeBtn = document.getElementById("theme-btn");
const themeOverlay = document.getElementById("theme-overlay");
const themeCloseBtn = document.getElementById("theme-close-btn");
const themeList = document.getElementById("theme-list");
const renjuToggle = document.getElementById("renju-toggle");
const settingsBtn = document.getElementById("settings-btn");
const settingsBtnIcon = document.getElementById("settings-btn-icon");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const playSummary = document.getElementById("play-summary");
const playFriendBtn = document.getElementById("play-friend-btn");

// --- setup state ---------------------------------------------------------
//
// All four are persisted preferences now, initialized from storage at
// load and written back the moment they change — the original kept
// mode/difficulty as session-only in-memory values and persisted just
// renju/theme. Making all of them persistent is what lets a returning
// player land on the setup screen already configured the way they left
// it, which matters more here than it did in a daily-puzzle framing.
let mode = getMode(); // 'ai' | 'local'
let difficulty = getDifficulty(); // 'easy' | 'medium' | 'hard'
let renjuEnabled = isRenjuEnabled();
// Replaces the original's `const BOARD_SIZE = 15`. Read once here, then
// re-read at every startGame() — so changing the size in Settings
// applies to the next game started, never mid-game to a board already on
// screen.
let boardSize = getBoardSize();
// The colors object actually passed to drawBoard()/drawGhostStone() —
// recomputed by applyActiveTheme() at startup and whenever the selection
// changes. Starts as wood's own colors so there's a sane value before
// the very first applyActiveTheme() call.
let activeThemeColors = getThemeById("wood").colors;

// --- per-game state ------------------------------------------------------
let gamePhase = "setup"; // 'setup' | 'coinFlip' | 'playing' | 'gameOver'
let gameState = null;
let turnManager = null;
let humanPlayer = 0; // vs AI mode only — which board-index (0=black) the human plays
let aiPlayer = 1; // vs AI mode only
// Index 0/1 -> display label. Set by the coin flip each game, since
// board-index 0 always moves first (black always moves first — there's
// no "let white go first" variant). What the coin flip actually
// randomizes is WHICH participant is labeled index 0 this game.
let playerLabels = ["Black", "White"];
let aiThinking = false;
// Set once per game the FIRST time it reaches gameOver (see
// recordStreakOnce()) — guards against double-counting if the player
// undoes past a just-finished game and plays it to a second conclusion
// within the same session.
let streakRecordedThisGame = false;
let lastStreakResult = null; // {current, best, isNewBest} | null — vs-AI only, for the game-over banner
// Separate flag from streakRecordedThisGame above even though both fire
// at the same gameOver transition — they're independent concerns (one
// guards the streak counter, this one guards achievement unlocking) that
// only happen to be triggered together.
let achievementsRecordedThisGame = false;
// Live-tracked facts that can't be reconstructed from gameState after
// the fact (undo mutates history destructively) — see
// game/achievements.js's own doc comment on AchievementContext for why
// these have to be accumulated DURING play rather than derived at game
// end.
let undoUsedThisGame = false;
// Gates "No Help Needed" (game/achievements.js) — set true the moment
// any hint is shown, never un-set. The original had a SECOND flag next
// to this one (`hintUsedFreeThisGame`) implementing a one-free-hint-
// then-watch-an-ad budget; hints are unlimited here, so the budget flag
// is gone and this achievement gate is all that remains.
let hintUsedThisGame = false;
let hintCell = null; // {row, col, reason} | null — the suggested cell to highlight (+ its ladder reason, see game/hint.js), cleared on the next real move
// {row, col, reason}[] — recomputed by updateForbiddenCells() whenever
// it's about to be Black's own turn under Renju rules (and kept empty
// otherwise, including White's turns — White has no restrictions at
// all). Drives both the board markers (render()) and click-blocking
// (commitPreview()).
let forbiddenCells = [];
let everHadOpenFour = [false, false]; // per board-index — did that player ever have one this game
let everHadOpenThree = [false, false];
let previewCell = null;
let layout = null;
let ctx = null;

// --- deferred-callback guard --------------------------------------------
//
// Two things in this file fire LATER than the code that scheduled them:
// the coin-flip banner's COIN_FLIP_DISPLAY_MS timeout and the AI's two
// chained setTimeouts (maybeStartAiTurn() -> runAiTurn() -> the
// MIN_AI_THINK_MS top-up). Both used to assume the game they were
// scheduled for was still the current one. It isn't, necessarily: "New
// Game" during the 900ms coin flip, or during Hard's ~350ms "thinking…",
// calls goToSetup() which nulls gameState — and the still-pending
// callback then fires into a null board (TypeError on gameState.winner),
// or worse, into the NEXT game's fresh board ("ghost" stones from the
// previous game, "already occupied" throws).
//
// Two layers, deliberately both: the timer ids below are cleared the
// moment a game is abandoned/replaced (so the common case never fires at
// all), AND every deferred callback captures `gameId` when scheduled and
// bails if it no longer matches when it actually runs (the belt for the
// cases clearTimeout can't reach — a callback already dequeued can't be
// cleared). gameId is a plain monotonic counter, bumped on every
// startGame() AND goToSetup() — "which game (or no-game) is current" —
// never reused.
//
// (The original had a third such callback: an ad-request promise,
// which couldn't be cancelled at all and relied on this guard alone.
// Unlimited hints removed it.)
let gameId = 0;
let coinFlipTimerId = null;
let aiTurnTimerId = null;

/** Clears every pending game-scheduled timer. Idempotent. */
function cancelPendingGameTimers() {
  if (coinFlipTimerId !== null) {
    clearTimeout(coinFlipTimerId);
    coinFlipTimerId = null;
  }
  if (aiTurnTimerId !== null) {
    clearTimeout(aiTurnTimerId);
    aiTurnTimerId = null;
  }
  // The result panel's own reveal delay (GAME_OVER_REVEAL_MS): if the
  // player hits Rematch/New Game inside that window — entirely possible
  // from the controls row, which stays live — the pending reveal has to
  // die with the game it belonged to, or it would flash the previous
  // game's result over a board that has already been reset.
  if (gameOverRevealTimerId !== null) {
    clearTimeout(gameOverRevealTimerId);
    gameOverRevealTimerId = null;
  }
  gameOverRevealed = false;
}

/**
 * Marks "a different game (or the setup screen) is now current":
 * invalidates every outstanding deferred callback in one step. Called at
 * the top of every game start AND goToSetup(), before any new state is
 * written, so nothing scheduled against the old state can ever observe
 * the new one.
 */
function beginNewGameEpoch() {
  cancelPendingGameTimers();
  gameId += 1;
  return gameId;
}

// --- animation state -----------------------------------------------------
// Purely a rendering concern layered on top of the authoritative game
// state above — the animation loop never affects whose turn it is or
// what's legal, only how the next few frames look. `null` whenever
// nothing is mid-animation (the common case).
let stoneAnimation = null; // { row, col, startTime }
let winLineAnimation = null; // { startTime }
// Whether the result panel has been let through yet (see
// GAME_OVER_REVEAL_MS). Separate from `gamePhase` on purpose: the game
// IS over during the delay — input stays locked, the result is already
// recorded — the panel just isn't on screen yet, so nothing else has to
// care about this distinction.
let gameOverRevealed = false;
let gameOverRevealTimerId = null;
let animationFrameId = null;

function paddingFor(cssSize) {
  return cssSize < 400 ? 8 : 20;
}

/**
 * Which of the board's two possible header rows is showing — the live
 * turn label, or the result card that replaces it once a finished game's
 * result is revealed. Its own function, called from BOTH render() and
 * updateBoardMax(), because the board's available height depends on
 * which one is up: measuring before syncing would read the previous
 * state's row heights and size the canvas for a layout that no longer
 * exists (visibly, as a stretched canvas for one frame). Idempotent, so
 * the two callers can't fight over it.
 */
function syncGameRowVisibility() {
  const resultOpen = gamePhase === "gameOver" && gameOverRevealed;
  turnLabel.hidden = gamePhase === "setup" || resultOpen;
  gameOverBanner.hidden = !resultOpen;
  // The board's own "a result is open" dimming, kept in lockstep with
  // the card rather than with `gamePhase`, so the board stays at full
  // strength through the win-line sweep and dims only as the card
  // arrives — one state change the player reads as one moment.
  boardWrap.classList.toggle("result-open", resultOpen);
}

// The board is sized from its own WIDTH (see the #board-wrap rule in
// style.css), so nothing stops it from growing taller than the space
// left under the turn label — on a wide, short viewport it would run off
// the bottom edge. This publishes the height that IS available as
// `--board-max`, which that CSS rule feeds into its own min(): measured
// from #main-content (the scroll container, whose height comes from the
// viewport and never from the board itself — so writing this back can't
// feed into another resize) minus the two siblings the board shares
// #game-content with, minus their gaps.
//
// Deliberately NOT observed on #board-wrap: the ResizeObserver below
// watches #main-content instead, because an observer on the element this
// function resizes is the textbook way to get "ResizeObserver loop
// completed with undelivered notifications" in the console.
const GAME_CONTENT_GAP = 10; // #game-content's own `gap`, in CSS px
function updateBoardMax() {
  syncGameRowVisibility();
  // Every sibling the board shares #game-content with, whichever of them
  // is currently showing. The result card is one of them, since it lives
  // above the board rather than on top of it — on a viewport with free
  // space to spare it costs the board nothing, and on a tight one the
  // board gives up the difference for as long as the result is open.
  // That's the right trade in that direction only because the game is
  // already over by then: a smaller board is still perfectly readable,
  // while a covered one isn't readable at all.
  const available =
    mainContent.clientHeight -
    (turnLabel.hidden ? 0 : turnLabel.offsetHeight + GAME_CONTENT_GAP) -
    (gameOverBanner.hidden ? 0 : gameOverBanner.offsetHeight + GAME_CONTENT_GAP) -
    (controls.hidden ? 0 : controls.offsetHeight + GAME_CONTENT_GAP);
  // A floor rather than a raw value: on a viewport too short for even a
  // small board, letting this go toward 0 would leave an unplayable
  // sliver, and the old scroll-to-reach behavior is the better failure
  // mode below some point. 200px is that point, picked from the board's
  // own geometry rather than taste — at 200px a 15x15 grid's cells are
  // ~13px, already under the ~15.4px measured as the smallest tested-
  // playable cell. (9x9 and 11x11 have proportionally larger cells at
  // the same pixel size, so this floor is set by the largest board and
  // is comfortably safe for the other two.)
  document.documentElement.style.setProperty("--board-max", `${Math.max(200, available)}px`);
}

function resize() {
  if (!gameState) return; // nothing to lay out during setup
  updateBoardMax();
  const cssSize = boardWrap.clientWidth;
  ctx = fitCanvasToDisplaySize(canvas, cssSize, cssSize);
  layout = boardLayout(gameState.size, cssSize, cssSize, paddingFor(cssSize));
  render();
}

function render() {
  updatePhaseVisibility();
  updateSoundToggleButton();
  if (gamePhase === "setup") {
    updateSetupUI();
    return;
  }
  if (!ctx || !layout || !gameState) return;

  const animatingCell = stoneAnimation
    ? { row: stoneAnimation.row, col: stoneAnimation.col, progress: animationProgress(stoneAnimation.startTime, STONE_ANIMATION_MS) }
    : null;
  const winLineProgress = winLineAnimation ? animationProgress(winLineAnimation.startTime, WIN_LINE_ANIMATION_MS) : 1;

  drawBoard(ctx, layout, gameState, { theme: activeThemeColors, animatingCell, winLineProgress });
  for (const cell of forbiddenCells) {
    drawForbiddenMarker(ctx, layout, cell.row, cell.col, activeThemeColors);
  }
  if (hintCell && gameState.winner === null) {
    drawHintMarker(ctx, layout, hintCell.row, hintCell.col, activeThemeColors);
  }
  if (previewCell && gameState.winner === null && !aiThinking) {
    drawGhostStone(ctx, layout, previewCell.row, previewCell.col, turnManager.current(), activeThemeColors);
  }
  updateTurnLabel();
  updateGameOverBanner();
  updateUndoButton();
  updateHintButton();
}

function animationProgress(startTime, durationMs) {
  return Math.min(1, (performance.now() - startTime) / durationMs);
}

function isAnimating() {
  return stoneAnimation !== null || winLineAnimation !== null;
}

/**
 * Runs render() on every frame until both animations (if any) finish,
 * then stops itself — there's no reason to keep painting 60 times a
 * second while the board is genuinely idle between moves.
 */
function ensureAnimationLoop() {
  if (animationFrameId !== null) return; // already running
  const step = () => {
    if (stoneAnimation && animationProgress(stoneAnimation.startTime, STONE_ANIMATION_MS) >= 1) {
      stoneAnimation = null;
    }
    if (winLineAnimation && animationProgress(winLineAnimation.startTime, WIN_LINE_ANIMATION_MS) >= 1) {
      winLineAnimation = null;
    }
    render();
    animationFrameId = isAnimating() ? requestAnimationFrame(step) : null;
  };
  animationFrameId = requestAnimationFrame(step);
}

function updatePhaseVisibility() {
  setupPanel.hidden = gamePhase !== "setup";
  // #game-content needs its OWN hidden toggle, separate from the 3
  // children's own — an empty-but-still-`display:flex` wrapper would
  // still count as a `flex: 1` sibling of #setup-panel inside
  // #main-content and steal half its centering space even while showing
  // nothing, which is why this isn't just "redundant with the three
  // lines below." Always the exact logical inverse of setupPanel's own
  // hidden state — the two are mutually exclusive by construction.
  gameContent.hidden = gamePhase === "setup";
  // #turn-label / #game-over-banner / the board's dimming all move
  // together — syncGameRowVisibility() owns that trio (the turn label is
  // hidden while a result is up: the card takes its row, and "Your turn"
  // under a finished game said the opposite of what just happened).
  syncGameRowVisibility();
  boardWrap.hidden = gamePhase === "setup";
  controls.hidden = gamePhase === "setup";
  coinFlipBanner.hidden = gamePhase !== "coinFlip";
}

function updateSetupUI() {
  for (const btn of modeToggle.querySelectorAll(".seg-btn")) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
  for (const btn of difficultyToggle.querySelectorAll(".seg-btn")) {
    btn.classList.toggle("active", btn.dataset.difficulty === difficulty);
  }
  difficultyRow.classList.toggle("hidden", mode !== "ai");
  for (const btn of boardSizeToggle.querySelectorAll(".seg-btn")) {
    btn.classList.toggle("active", Number(btn.dataset.boardSize) === boardSize);
  }
  for (const btn of renjuToggle.querySelectorAll(".seg-btn")) {
    btn.classList.toggle("active", btn.dataset.renju === (renjuEnabled ? "on" : "off"));
  }
  updatePlaySummary();
}

function difficultyLabel(d) {
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/**
 * The one-line "what will Play actually do" caption under the Play
 * button — so hiding Mode/Difficulty/Board/Renju behind the settings
 * gear doesn't turn Play into a black box. Reads the same state Play
 * itself uses, so it can never drift out of sync with what a tap on Play
 * actually starts.
 */
function updatePlaySummary() {
  const parts = mode === "ai" ? ["vs AI", difficultyLabel(difficulty)] : ["2 Player"];
  parts.push(`${boardSize}×${boardSize}`);
  if (renjuEnabled) parts.push("Renju On");
  playSummary.textContent = parts.join(" · ");
}

// "You" is grammatically second-person ("Your turn," "You win!") while
// every other label ("Computer," "Player 1") is third-person ("Computer's
// turn," "Player 1 wins!") — the generic `${label}'s turn`/`${label}
// wins!` templates below are wrong for exactly that one label, so it
// gets its own two irregular forms instead of a general-purpose grammar
// engine for a vocabulary of four fixed strings.
function possessiveTurnText(label) {
  return label === "You" ? "Your turn" : `${label}'s turn`;
}

function winsText(label) {
  return label === "You" ? "You win!" : `${label} wins!`;
}

/**
 * The coin-flip announcement — same "You" irregular-verb exception as
 * the two functions above (`You play`, not `You plays`), but also fixing
 * a second, more substantive problem the grammar bug shared a root cause
 * with: an earlier template (`${label} is Black`) used "Black" as a bare
 * predicate, reading as a claim about the PERSON ("You is/are Black")
 * rather than about which stones they're playing. Every caller passes a
 * COLOR ("Black"/"White"), not a player label, as `colorWord` — this
 * function only ever says "plays/play `${colorWord}` stones."
 */
function playsStonesText(label, colorWord) {
  return label === "You" ? `You play ${colorWord} stones` : `${label} plays ${colorWord} stones`;
}

// One line per game/hint.js's own ladder reason, hardcoded (no i18n
// layer exists anywhere in this English-only app). Shown in place of the
// normal turn text, in the SAME #turn-label element the turn indicator
// already occupies — not a new element, so it disappears for free the
// instant hintCell is cleared, exactly like the marker itself (both are
// driven by the same hintCell lifecycle: nulled on every real move,
// undo, new game).
const HINT_REASON_TEXT = {
  win: "Winning move — five in a row!",
  "block-win": "Block this or lose next turn",
  "open-four": "Open four — this wins next turn",
  "block-three": "Stop their open three",
  develop: "Solid move to build from",
};

function updateTurnLabel() {
  if (gameState.winner !== null) {
    turnLabel.textContent = "";
    turnLabel.classList.remove("hint-active");
    return;
  }
  if (hintCell) {
    turnLabel.textContent = HINT_REASON_TEXT[hintCell.reason] ?? "";
    turnLabel.classList.add("hint-active");
    return;
  }
  turnLabel.classList.remove("hint-active");
  const current = turnManager.current();
  const label = playerLabels[current];
  turnLabel.textContent = aiThinking ? `${label} is thinking…` : possessiveTurnText(label);
}

/**
 * Holds the result panel back until the win line has finished sweeping
 * (GAME_OVER_REVEAL_MS), then renders it. Guarded by `gameId` like every
 * other deferred callback here: a game abandoned inside the delay window
 * must not have its result flash over whatever replaced it — and
 * cancelPendingGameTimers() clears this timer anyway, so the guard is
 * belt-and-braces against a path that forgets to.
 *
 * A draw waits too, even though there's no line to watch: the last stone
 * still has its own pop-in animation, and a panel that beats the final
 * stone onto the board looks like it decided before the move landed.
 */
function scheduleGameOverReveal() {
  // Reset first: undoing past a finished game and then finishing it
  // AGAIN reaches here inside the same gameId, and a stale `true` from
  // the first ending would skip the delay the second time around.
  gameOverRevealed = false;
  const thisGameId = gameId;
  gameOverRevealTimerId = setTimeout(() => {
    gameOverRevealTimerId = null;
    if (gameId !== thisGameId || gamePhase !== "gameOver") return;
    gameOverRevealed = true;
    // resize(), not render(): the card takes real layout space above the
    // board, so the board's own max height changes the moment it appears
    // and the canvas has to be refitted to match — render() alone would
    // leave the canvas at its old size, stretched by CSS. (resize()
    // syncs the rows first and renders at the end, so this one call
    // covers the whole transition.)
    resize();
  }, GAME_OVER_REVEAL_MS);
}

function updateGameOverBanner() {
  // `gameOverRevealed` (not just the phase) — the panel is held back for
  // GAME_OVER_REVEAL_MS after the game ends so the win line can finish
  // sweeping in the clear; see that constant's own comment.
  syncGameRowVisibility();
  if (gameState.winner === null) return;
  gameOverText.textContent = gameState.winner === "draw" ? "Draw!" : winsText(playerLabels[gameState.winner]);
  updateGameOverStreak();
}

/**
 * vs-AI only (local mode has no per-difficulty streak). A win keeps the
 * emphasis on the streak that's still alive; a loss or draw already
 * zeroed `current` (see recordStreakOnce()), so there's nothing live
 * left to show — instead it leaves the standing PERSONAL BEST as a
 * target for next time, which is more motivating than reporting "0."
 */
function updateGameOverStreak() {
  if (mode !== "ai" || !lastStreakResult) {
    gameOverStreak.hidden = true;
    return;
  }
  gameOverStreak.hidden = false;
  const { current, best, isNewBest } = lastStreakResult;
  const won = gameState.winner === humanPlayer;
  gameOverStreak.textContent = won ? `Win streak: ${current}` : `Best: ${best}`;
  gameOverStreak.classList.toggle("new-best", won && isNewBest);
  if (won && isNewBest) gameOverStreak.textContent += " — New Best!";
}

/**
 * Undo is unlimited in every mode, matching the rest of this site. The
 * original capped it at 3 per game in vs-AI mode (local was already
 * unlimited) and rendered the remaining count into this button's own
 * label as "Undo (2)"; with no budget left to report, the label is a
 * plain "Undo" and the button's only state is enabled/disabled.
 */
function updateUndoButton() {
  undoBtn.disabled = !canUndo();
}

/**
 * Disabled whenever it's not actually the human's turn to act — the same
 * isHumanInputAllowed() gate the board's own input uses, and now the
 * only condition. The original had a second one: once the single free
 * hint was spent, the button went dead whenever the ad SDK was
 * confirmed unavailable. Hints are unlimited and instant here, so the
 * button is live exactly whenever a move is.
 */
function updateHintButton() {
  hintBtn.disabled = !isHumanInputAllowed();
}

function updateSoundToggleButton() {
  const enabled = isSoundEnabled();
  soundToggleBtn.innerHTML = enabled ? ICONS.speakerOn : ICONS.speakerMuted;
  soundToggleBtn.setAttribute("aria-label", enabled ? "Mute sound" : "Unmute sound");
}

// --- sound ---------------------------------------------------------------

soundToggleBtn.addEventListener("click", () => {
  // core/audio.js's own doc comment on unlockAudio() promises exactly
  // this belt-and-suspenders call. The document-level pointerdown/
  // touchstart/keydown listener in audio.js already fires before this
  // click handler on a real tap (pointerdown precedes click), but a
  // mouse click synthesized without a preceding pointerdown, or any
  // future input path that isn't already covered, would fall through
  // that gap. Tapping the toggle is an unambiguous gesture in its own
  // right; there's no reason to depend solely on whichever gesture fired
  // first.
  unlockAudio();
  toggleSound(); // persists via core/storage.js
  updateSoundToggleButton();
});

// --- modal manager (accessibility) ---------------------------------------
//
// The three modals (achievements / theme / settings) used to be opened
// by flipping `overlay.hidden` and nothing else: focus stayed on the
// button behind the dimmed backdrop, Tab walked straight into the page
// underneath, Escape did nothing, and a screen reader had no idea a
// dialog had appeared. One small manager fixes all three at once instead
// of each open*/close* pair growing its own copy:
//
// - open: remember the opener (document.activeElement), show, move focus
//   to the panel's close button (always present, always first in the
//   header — the predictable landing spot a keyboard user expects), and
//   mark #top-bar/#main-content `inert` so the page behind is neither
//   tabbable nor clickable nor read out.
// - close: hide, drop inert (only when the LAST modal closes — the stack
//   makes that assumption unnecessary rather than load-bearing), restore
//   focus to the opener.
// - Escape (document keydown): closes the TOPMOST open modal only.
//
// `inert` is applied to the two page roots rather than `aria-hidden` + a
// focus trap because it does both jobs natively (focus AND pointer AND
// accessibility tree). The modals themselves are siblings of those two
// roots, so marking the roots never touches the open panel.
//
// (The original also called the portal's gameplayStop()/gameplayStart()
// here, since a modal opening mid-game is a break in play the portal
// needed told about. Nothing external is listening now, so opening a
// modal is purely a DOM concern.)
const inertWhileModalOpen = [document.getElementById("top-bar"), document.getElementById("main-content")];
/** @type {{overlay: HTMLElement, opener: Element | null}[]} — bottom to top */
const openModalStack = [];

function openModal(overlay) {
  if (!overlay.hidden) return; // already open — don't re-capture the opener (it'd be the close button by now)
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  openModalStack.push({ overlay, opener });
  for (const el of inertWhileModalOpen) el.inert = true;
  overlay.hidden = false;
  const focusTarget = overlay.querySelector(".modal-close-btn") ?? overlay.querySelector(".modal-panel");
  focusTarget?.focus();
}

function closeModal(overlay) {
  if (overlay.hidden) return;
  const index = openModalStack.findIndex((entry) => entry.overlay === overlay);
  const [entry] = index >= 0 ? openModalStack.splice(index, 1) : [null];
  overlay.hidden = true;
  if (openModalStack.length === 0) {
    for (const el of inertWhileModalOpen) el.inert = false;
  }
  // Restore focus only if the opener is still something that can take it
  // — it may have been removed/hidden meanwhile, in which case focus is
  // simply left where the browser puts it rather than thrown at a dead
  // node.
  if (entry?.opener?.isConnected && !entry.opener.hidden) entry.opener.focus();
}

document.addEventListener("keydown", (evt) => {
  if (evt.key !== "Escape" || openModalStack.length === 0) return;
  evt.preventDefault();
  closeModal(openModalStack[openModalStack.length - 1].overlay);
});

// --- achievements UI ------------------------------------------------------
//
// The button/counter is always visible (same reasoning as sound-toggle —
// checking progress isn't a mid-game action), but the LIST is only built
// lazily when opened rather than kept in sync continuously; nothing about
// the list itself changes except right when a game just concluded, and
// evaluateAndUnlockAchievements() already refreshes the counter then.

/**
 * core/storage.js's unlocked list, filtered to ids that still exist in
 * game/achievements.js. storage.js deliberately knows nothing about
 * which ids are real (its own header note), so a profile carrying an id
 * this build no longer ships would otherwise be counted and show
 * "12/11". Every count in this file goes through here so they can't
 * disagree.
 */
function knownUnlockedAchievementIds() {
  const known = new Set(ACHIEVEMENTS.map((a) => a.id));
  return getUnlockedAchievements().filter((id) => known.has(id));
}

function updateAchievementsButton() {
  const count = knownUnlockedAchievementIds().length;
  achievementsBtn.innerHTML = `${ICONS.trophy}<span class="btn-count">${count}/${ACHIEVEMENTS.length}</span>`;
}

function openAchievements() {
  renderAchievementsList();
  openModal(achievementsOverlay);
}

function closeAchievements() {
  closeModal(achievementsOverlay);
}

/**
 * Locked entries still render their full title/description — only the
 * icon dims and the title mutes (via the .locked class in CSS), never a
 * "???" placeholder. ACHIEVEMENTS is iterated directly in its declared
 * order rather than sorted by unlock state.
 */
function renderAchievementsList() {
  const unlocked = new Set(knownUnlockedAchievementIds());
  achievementsCountLabel.textContent = `${unlocked.size}/${ACHIEVEMENTS.length}`;
  achievementsList.innerHTML = "";
  for (const achievement of ACHIEVEMENTS) {
    const isUnlocked = unlocked.has(achievement.id);
    const row = document.createElement("li");
    row.className = `achievement-row ${isUnlocked ? "unlocked" : "locked"}`;
    row.innerHTML = `
      <span class="achievement-row-icon">${isUnlocked ? ICONS.trophy : ICONS.lock}</span>
      <div>
        <div class="achievement-row-title">${achievement.title}</div>
        <div class="achievement-row-description">${achievement.description}</div>
      </div>
    `;
    achievementsList.appendChild(row);
  }
}

/** How long a toast stays up before removing itself — long enough to read
 * a short title, short enough that several in a row (a single win can
 * unlock more than one) don't pile up indefinitely. */
const ACHIEVEMENT_TOAST_MS = 2600;

function showAchievementToasts(ids) {
  for (const id of ids) {
    const achievement = ACHIEVEMENTS.find((a) => a.id === id);
    if (!achievement) continue; // defensive — evaluateAchievements() only ever returns real ids
    const toast = document.createElement("div");
    toast.className = "achievement-toast";
    toast.innerHTML = `${ICONS.trophy}<span>${achievement.title}</span>`;
    achievementToastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), ACHIEVEMENT_TOAST_MS);
  }
}

achievementsBtn.addEventListener("click", openAchievements);
achievementsCloseBtn.addEventListener("click", closeAchievements);
achievementsOverlay.addEventListener("click", (evt) => {
  if (evt.target === achievementsOverlay) closeAchievements(); // click on the dimmed backdrop, not the panel
});

// --- board theme UI -------------------------------------------------------
//
// Every theme is available from the start (game/themes.js dropped its
// unlock concept entirely — see that file's header for why). What used
// to live here and no longer does: themeUnlockContext(), which assembled
// achievement counts / Hard-win history / daily streak into an
// UnlockContext; checkForNewThemeUnlocks(), which diffed the unlocked set
// before and after each game to toast a newly earned theme; and the
// locked-row rendering path with its padlock icon and "how to unlock"
// text. Picking a theme is now just picking a theme.

/**
 * Recomputes and applies the theme to actually render with:
 * core/storage.js's getTheme() (whatever the player last selected) run
 * through resolveActiveThemeId() (game/themes.js), which falls back to
 * Wood for an id this build doesn't ship — the case that matters is a
 * save written when Neon still existed. Called once at startup and again
 * after a new selection.
 */
function applyActiveTheme() {
  const resolvedId = resolveActiveThemeId(getTheme());
  activeThemeColors = getThemeById(resolvedId).colors;
  render();
}

function openThemeModal() {
  renderThemeList();
  openModal(themeOverlay);
}

function closeThemeModal() {
  closeModal(themeOverlay);
}

/**
 * Builds a small pure-CSS color swatch for `theme` — no image assets — a
 * board-colored square with two stone-colored dots, all set inline from
 * game/themes.js's own color data so this function is the ONLY place a
 * theme's actual hex values get read into the DOM.
 *
 * (These are CSSOM property assignments, not `style="..."` attributes in
 * markup, so they are not subject to the site's `style-src 'self'` CSP —
 * CSP does not police the CSSOM.)
 */
function buildThemeSwatch(theme) {
  const swatch = document.createElement("div");
  swatch.className = "theme-swatch";
  swatch.style.background = theme.colors.boardColor;
  for (const player of [0, 1]) {
    const dot = document.createElement("span");
    dot.className = "theme-swatch-dot";
    dot.style.background = theme.colors.stones[player].fill;
    swatch.appendChild(dot);
  }
  return swatch;
}

function renderThemeList() {
  const selectedId = resolveActiveThemeId(getTheme());
  themeList.innerHTML = "";
  for (const theme of THEMES) {
    const isSelected = theme.id === selectedId;
    const row = document.createElement("li");
    row.className = `theme-row ${isSelected ? "selected" : ""}`;
    row.dataset.themeId = theme.id; // selectTheme() uses this to re-focus the row after a rebuild
    row.appendChild(buildThemeSwatch(theme));
    const text = document.createElement("div");
    text.innerHTML = `
      <div class="theme-row-name">${theme.name}${isSelected ? " ✓" : ""}</div>
      <div class="theme-row-description">${theme.description}</div>
    `;
    row.appendChild(text);
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute("aria-pressed", String(isSelected));
    row.addEventListener("click", () => selectTheme(theme.id));
    row.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault(); // Space would otherwise scroll the list
      selectTheme(theme.id);
    });
    themeList.appendChild(row);
  }
}

function selectTheme(id) {
  setTheme(id); // core/storage.js's own setTheme() ignores anything not in its THEME_IDS whitelist, belt-and-suspenders
  applyActiveTheme();
  renderThemeList(); // refresh the selected-checkmark/border without closing the modal
  // renderThemeList() rebuilds every row from scratch, which silently
  // drops keyboard focus to <body> — put it back on the row that was
  // just activated so Tab/Shift+Tab continue from where the user was.
  themeList.querySelector(`[data-theme-id="${id}"]`)?.focus();
}

themeBtn.addEventListener("click", openThemeModal);
themeCloseBtn.addEventListener("click", closeThemeModal);
themeOverlay.addEventListener("click", (evt) => {
  if (evt.target === themeOverlay) closeThemeModal();
});

/**
 * Win/lose is meaningful only relative to the human in vs-AI mode; local
 * 2-player has no "you" to lose against a computer, so any win there is
 * just a win worth celebrating regardless of which of the two people it
 * was — playWinSound() covers that case too rather than needing a third,
 * "nobody in particular" variant.
 */
function playGameOverSound() {
  if (gameState.winner === "draw") {
    playDrawGameSound();
  } else if (mode === "ai") {
    if (gameState.winner === humanPlayer) playWinSound();
    else playLoseSound();
  } else {
    playWinSound();
  }
}

/**
 * Records this game's outcome against `difficulty`'s win streak — vs-AI
 * only (local mode never touches streaks at all). A loss or a draw both
 * reset `current` to 0 the same way — core/storage.js's
 * recordStreakResult() already treats "not a win" as one case, so
 * there's no separate draw branch to get wrong here.
 *
 * Deliberately counts a game that used Undo. Undo exists here
 * specifically so a loss to a stronger difficulty doesn't feel final and
 * punishing; disqualifying a streak because it used that same aid would
 * fight the feature's own purpose. (The original made this call when
 * undo was capped at 3 per game. It's now unlimited, which does make the
 * streak a softer number — but "unlimited undo everywhere" is this
 * site's policy, and gating the streak on it would just re-introduce the
 * limit through the back door.)
 *
 * Guarded by `streakRecordedThisGame` so this only ever fires once per
 * game SESSION — undoing back past a just-finished game and playing it
 * to a second conclusion does not record a second result; the first real
 * conclusion is what counts. Abandoning mid-game via "New Game" never
 * reaches this function at all (it's only ever called from the gameOver
 * transition), so there's no separate check needed for that.
 */
function recordStreakOnce() {
  if (mode !== "ai" || streakRecordedThisGame) return;
  streakRecordedThisGame = true;
  const won = gameState.winner === humanPlayer;
  lastStreakResult = recordStreakResult(difficulty, won);
}

/**
 * Evaluates and persists this game's achievements — guarded by
 * `achievementsRecordedThisGame` for exactly the reason
 * `streakRecordedThisGame` exists above: undoing back past a
 * just-finished game and reaching a SECOND conclusion in the same
 * session must not re-run this (which would, for instance, re-record a
 * Hard win on a color that already had one, or worse, let a losing
 * second conclusion's context overwrite `lastStreakResult`-derived facts
 * from the real one). Must run AFTER recordStreakOnce() — Hot Streak /
 * Unstoppable read `lastStreakResult`, which that call just set.
 */
function evaluateAndUnlockAchievements() {
  if (achievementsRecordedThisGame) return;
  achievementsRecordedThisGame = true;

  const creditableHardWin = mode === "ai" && gameState.winner === humanPlayer && difficulty === "hard";
  if (creditableHardWin) {
    // Statistics only — nothing gates on either of these any more (see
    // core/storage.js's own note on hardWinsBySize). recordHardWin()
    // warns to the console if it's ever handed a size not in
    // BOARD_SIZES, precisely because an unrecorded win would otherwise
    // be completely invisible.
    recordHardWin(gameState.size);
    recordHardWinByColor(humanPlayer);
  }
  if (mode === "local" && gameState.winner !== null) {
    incrementLocalGamesCompleted();
  }

  const context = {
    gameState,
    mode,
    humanPlayer,
    difficulty,
    undoUsedThisGame,
    hintUsedThisGame,
    everHadOpenFour,
    everHadOpenThree,
    streakResult: lastStreakResult,
    hardWinsByColor: getHardWinsByColor(),
    localGamesCompleted: getLocalGamesCompleted(),
  };

  const qualifying = evaluateAchievements(context);
  const newlyUnlocked = qualifying.filter((id) => unlockAchievement(id));
  updateAchievementsButton();
  if (newlyUnlocked.length > 0) showAchievementToasts(newlyUnlocked);
}

// --- setup screen ---------------------------------------------------------
//
// Every toggle below writes its value straight through to storage as
// well as to the module-level variable, so the setup screen is where the
// player left it on their next visit.

modeToggle.addEventListener("click", (evt) => {
  const btn = evt.target.closest(".seg-btn");
  if (!btn) return;
  mode = btn.dataset.mode;
  setMode(mode);
  updateSetupUI();
});

difficultyToggle.addEventListener("click", (evt) => {
  const btn = evt.target.closest(".seg-btn");
  if (!btn) return;
  difficulty = btn.dataset.difficulty;
  setDifficulty(difficulty);
  updateSetupUI();
});

// 9 / 11 / 15. Applies to the NEXT game started, never to a board
// already on screen — startGame() re-reads `boardSize` at the moment it
// builds the state, and nothing resizes a live game underneath the
// player.
boardSizeToggle.addEventListener("click", (evt) => {
  const btn = evt.target.closest(".seg-btn");
  if (!btn) return;
  boardSize = Number(btn.dataset.boardSize);
  setBoardSize(boardSize);
  updateSetupUI();
});

renjuToggle.addEventListener("click", (evt) => {
  const btn = evt.target.closest(".seg-btn");
  if (!btn) return;
  renjuEnabled = btn.dataset.renju === "on";
  setRenjuEnabled(renjuEnabled); // a global preference, not a per-game-only choice
  updateSetupUI();
});

startGameBtn.addEventListener("click", startGame);

function openSettingsModal() {
  updateSetupUI(); // paints the toggles' current .active state the instant the modal opens, not just after the next click inside it
  openModal(settingsOverlay);
}

function closeSettingsModal() {
  closeModal(settingsOverlay);
}

settingsBtn.addEventListener("click", openSettingsModal);
settingsCloseBtn.addEventListener("click", closeSettingsModal);
settingsOverlay.addEventListener("click", (evt) => {
  if (evt.target === settingsOverlay) closeSettingsModal(); // click on the dimmed backdrop, not the panel
});

// "Play with a friend" — 2-player is this game's differentiator, so it
// keeps a direct one-tap path that skips the settings modal entirely,
// alongside (not instead of) selecting "2 Player" from inside Settings.
playFriendBtn.addEventListener("click", () => {
  mode = "local";
  setMode(mode);
  updateSetupUI();
  startGame();
});

// --- game start / coin flip ----------------------------------------------

/**
 * Coin flip: which participant (human/computer in vs-AI mode, Player 1/
 * Player 2 in local mode) is assigned board-index 0 — the player who
 * always moves first, i.e. Black. Reuses core/turn.js's own
 * pickStartingPlayer(2, rng) as a plain 2-way coin flip; board-index 0
 * ALWAYS moves first regardless of its result (that's a rule of the
 * game, not a fairness knob) — what pickStartingPlayer's return value
 * actually decides here is who gets labeled index 0 this game, not which
 * index moves first.
 */
function startGame() {
  const thisGameId = beginNewGameEpoch(); // invalidates anything the PREVIOUS game still had pending — see gameId's own comment
  const firstParticipantIsBlack = pickStartingPlayer(2, Math.random) === 0;
  if (mode === "ai") {
    humanPlayer = firstParticipantIsBlack ? 0 : 1;
    aiPlayer = 1 - humanPlayer;
    playerLabels = firstParticipantIsBlack ? ["You", "Computer"] : ["Computer", "You"];
  } else {
    playerLabels = firstParticipantIsBlack ? ["Player 1", "Player 2"] : ["Player 2", "Player 1"];
  }

  // Re-read rather than trusting the module variable: this is the one
  // point where a size change in Settings takes effect, and reading it
  // here means the board on screen always matches what storage says.
  boardSize = getBoardSize();
  gameState = createGameState(boardSize);
  turnManager = createTurnManager(2, 0); // board-index 0 always starts
  previewCell = null;
  aiThinking = false;
  streakRecordedThisGame = false;
  lastStreakResult = null;
  achievementsRecordedThisGame = false;
  undoUsedThisGame = false;
  hintUsedThisGame = false;
  hintCell = null;
  everHadOpenFour = [false, false];
  everHadOpenThree = [false, false];
  stoneAnimation = null;
  winLineAnimation = null;
  gamePhase = "coinFlip";
  // vs-AI: framed around "You" specifically (the human cares about their
  // OWN color, not a third-person report of who's Black) — local: no
  // single "you" exists, so this announces whoever board-index 0 turned
  // out to be, playerLabels[0], who always plays Black.
  coinFlipText.textContent =
    mode === "ai" ? playsStonesText("You", humanPlayer === 0 ? "Black" : "White") : playsStonesText(playerLabels[0], "Black");
  render();
  resize(); // gameState just became non-null — lay out the canvas now

  coinFlipTimerId = setTimeout(() => {
    coinFlipTimerId = null;
    if (thisGameId !== gameId) return; // this game was abandoned/replaced mid-flip — see gameId's own comment
    gamePhase = "playing";
    updateForbiddenCells();
    render();
    maybeStartAiTurn();
  }, COIN_FLIP_DISPLAY_MS);
}

// --- moves: shared commit path for both human clicks and AI moves --------

function commitMove(row, col, player) {
  placeStone(gameState, row, col, player);
  turnManager.recordMove({ row, col }, false); // this game never grants an extra turn
  playStoneSound(mode === "ai" && player === aiPlayer);
  stoneAnimation = { row, col, startTime: performance.now() };
  hintCell = null; // any move played (by anyone) makes a standing suggestion stale
  trackLivePatterns(player);

  if (gameState.winner !== null) {
    gamePhase = "gameOver";
    if (gameState.winLine) winLineAnimation = { startTime: performance.now() };
    scheduleGameOverReveal();
    playGameOverSound();
    recordStreakOnce();
    evaluateAndUnlockAchievements();
  }

  updateForbiddenCells();
  render();
  ensureAnimationLoop();
  maybeStartAiTurn();
}

/**
 * Updates `everHadOpenFour`/`everHadOpenThree` for whichever player just
 * moved — placing a stone can only ever grow ITS OWN player's pattern
 * counts, never the opponent's (a move can block/reduce the opponent's
 * open patterns, never create one for them), so checking only the mover
 * each turn is sufficient to catch every open-three/open-four either
 * player ever has across the whole game.
 */
function trackLivePatterns(player) {
  const counts = countPatterns(gameState.board, player);
  if (counts.openFour > 0) everHadOpenFour[player] = true;
  if (counts.openThree > 0) everHadOpenThree[player] = true;
}

/**
 * Recomputes `forbiddenCells` from the CURRENT board state — never a
 * one-time computation, since which points are forbidden changes with
 * every stone placed. Only ever non-empty when it's genuinely about to
 * be Black's own turn under Renju rules; every other situation (White's
 * turn, Renju off, game over, no game at all) clears it, so
 * render()/commitPreview() never need their own extra "is this even
 * relevant right now" checks beyond "is the array non-empty."
 *
 * Scoped to generateCandidates() (game/ai.js) rather than every empty
 * cell on the board — same reasoning as findForbiddenPointsForBlack()'s
 * own doc comment: a forbidden pattern always needs nearby stones to
 * form at all.
 */
function updateForbiddenCells() {
  if (!renjuEnabled || !gameState || gameState.winner !== null || turnManager.current() !== 0) {
    forbiddenCells = [];
    return;
  }
  forbiddenCells = findForbiddenPointsForBlack(gameState.board, generateCandidates(gameState.board));
}

/**
 * If it's the AI's turn, kicks off its move: locks input and paints the
 * "thinking" state SYNCHRONOUSLY first, then defers the actual (possibly
 * ~350ms-blocking, see game/ai.js) search to a LATER tick — giving the
 * browser an actual paint opportunity before the heavy synchronous call,
 * instead of freezing mid-frame with no visual indication anything is
 * happening. A true non-blocking search (e.g. a Web Worker) would remove
 * the freeze itself; deferring only removes the "silently frozen with no
 * feedback" part of it.
 *
 * The delay is STONE_ANIMATION_MS rather than 0 for a measured reason.
 * This call fires right after the PLAYER's own move started its 90ms
 * pop-in (commitMove()'s stoneAnimation, still running via
 * ensureAnimationLoop()'s requestAnimationFrame loop at this exact
 * point). With a bare `setTimeout(runAiTurn, 0)`, that timeout's
 * callback becomes ready to run BEFORE the animation loop's next frame
 * gets a chance to paint — and since JS is single-threaded, once
 * runAiTurn()'s synchronous search starts, NOTHING can paint until it
 * returns. The measured result was the player's own stone frozen at ~5%
 * scale for the ENTIRE search, then snapping to 100% the instant the
 * next frame finally ran. Delaying the AI's blocking work by exactly the
 * animation's own duration is what keeps that window free. Game logic
 * and ordering are untouched by this — only WHEN the search's
 * synchronous call starts.
 */
function maybeStartAiTurn() {
  if (mode !== "ai") return;
  if (gameState.winner !== null) return;
  if (turnManager.current() !== aiPlayer) return;

  aiThinking = true;
  render();
  const thisGameId = gameId; // captured NOW — see gameId's own comment for why every deferred step re-checks it
  aiTurnTimerId = setTimeout(() => {
    aiTurnTimerId = null;
    if (thisGameId !== gameId) return; // game abandoned/replaced before the search even started
    runAiTurn(thisGameId);
  }, STONE_ANIMATION_MS);
}

/**
 * @param {number} thisGameId - the gameId this turn was scheduled under;
 *   the MIN_AI_THINK_MS top-up timeout below re-checks it, since "New
 *   Game" during the padding window is exactly the window a synchronous
 *   search can't be interrupted in but a deferred commit still can.
 */
function runAiTurn(thisGameId) {
  const start = performance.now();
  const move = chooseMove(gameState.board, aiPlayer, difficulty, Math.random, renjuEnabled);
  const elapsed = performance.now() - start;
  const remainingDelay = Math.max(0, MIN_AI_THINK_MS - elapsed);

  aiTurnTimerId = setTimeout(() => {
    aiTurnTimerId = null;
    if (thisGameId !== gameId) return; // the board this move was computed for no longer exists — never commit it elsewhere
    aiThinking = false;
    // Board-full is already resolved by placeStone()/checkWin() before
    // this ever runs (the game ends the exact move it fills) — the only
    // OTHER way chooseMove() can return null is the Renju edge case
    // (Renju on, aiPlayer is Black, genuinely zero legal moves
    // anywhere), astronomically rare and deliberately left unhandled
    // beyond "do nothing" rather than building a dedicated
    // no-legal-moves end state for it.
    if (!move) return;
    commitMove(move[0], move[1], aiPlayer);
  }, remainingDelay);
}

// --- human input ----------------------------------------------------------

function isHumanInputAllowed() {
  if (gamePhase !== "playing") return false;
  if (aiThinking) return false;
  if (gameState.winner !== null) return false;
  if (mode === "ai" && turnManager.current() !== humanPlayer) return false;
  return true;
}

function updatePreviewFromPointer(pos) {
  if (!isHumanInputAllowed()) return setPreview(null);
  const hit = pointToIntersection(layout, pos.x, pos.y);
  if (!hit || gameState.board[hit.row][hit.col] !== null) return setPreview(null);
  setPreview(hit);
}

function setPreview(cell) {
  const changed =
    (cell === null) !== (previewCell === null) ||
    (cell && previewCell && (cell.row !== previewCell.row || cell.col !== previewCell.col));
  previewCell = cell;
  if (changed) render();
}

function commitPreview() {
  if (!previewCell || !isHumanInputAllowed()) return;
  const { row, col } = previewCell;

  // Blocked at commit time, not at hover/preview time (the ghost stone
  // still shows normally while hovering — the X marker already drawn
  // there is what communicates "but you can't place this"). A click
  // attempt on a forbidden point never places a stone; it just explains
  // why, once, via the same toast mechanism achievements use.
  const forbidden = forbiddenCells.find((cell) => cell.row === row && cell.col === col);
  if (forbidden) {
    showTransientMessage(forbiddenReasonText(forbidden.reason));
    setPreview(null);
    return;
  }

  const player = turnManager.current();
  previewCell = null;
  commitMove(row, col, player);
}

// --- hint -----------------------------------------------------------------
//
// Unlimited and instant, in every mode. The original gave one free hint
// per game and put every subsequent one behind a video ad — an
// `async` click handler that awaited an external script, disabled the
// button while the ad played, re-checked the game id on the way back
// (the ad could outlive the game), and showed a deliberately neutral
// "No hint this time." toast for its failure modes. All
// of that is gone: handleHintClick() is synchronous and its only guard
// is "is it your turn."

/** Reuses the achievement toast container and CSS class — one generic
 * notification surface. Used for the case a silent failure would be
 * actively bad UX: a click on a Renju-forbidden point shouldn't just do
 * nothing with no explanation. */
function showTransientMessage(text) {
  const toast = document.createElement("div");
  toast.className = "achievement-toast";
  toast.textContent = text;
  achievementToastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), ACHIEVEMENT_TOAST_MS);
}

function showHint() {
  const player = turnManager.current();
  const suggested = suggestHint(gameState.board, player, renjuEnabled);
  if (!suggested) return; // board is full — isHumanInputAllowed() already prevents reaching here in practice
  hintCell = suggested; // {row, col, reason} — see game/hint.js's own ladder
  // Gates "No Help Needed" (game/achievements.js). Unlimited hints don't
  // change what this flag means: any hint at all is still help, and that
  // achievement still asks for a Hard win without it.
  hintUsedThisGame = true;
  render();
}

function handleHintClick() {
  if (!isHumanInputAllowed()) return;
  showHint();
}

hintBtn.addEventListener("click", handleHintClick);

// --- undo -----------------------------------------------------------------

function undoOneMove() {
  turnManager.undoTurn(() => undoMove(gameState));
}

/**
 * Unlimited in every mode. The original capped vs-AI undo at 3 per game
 * (`MAX_UNDOS_VS_AI`, tracked in an `undosRemaining` counter and shown
 * in the button label); this site's policy is unlimited undo across
 * every game it hosts, so the cap, the counter and the label are all
 * gone. What remains is unchanged:
 *
 * vs-AI mode: undoing takes back BOTH the AI's reply and the human's own
 * move before it — a single move-level undo would just hand the human
 * right back to the AI's own last decision point, not theirs. This is a
 * GAME-LEVEL decision, not a turn.js one: core/turn.js's own undoTurn()
 * still does exactly one thing (rewind whichever single player's move is
 * on top of the stack). Calling undoOneMove() twice here is main.js
 * explicitly choosing, at the GAME layer, that one human-facing "Undo"
 * click == one full round in vs-AI mode.
 *
 * Local 2-player mode takes back exactly the one last move — both
 * players are human, so there's no "their own move" to reach back
 * through automatically.
 */
function performUndo() {
  if (!canUndo()) return;

  undoUsedThisGame = true; // gates "No Help Needed" — never un-set once true this game
  undoOneMove();
  if (mode === "ai" && gameState.moves.length > 0 && turnManager.current() === aiPlayer) {
    undoOneMove();
  }
  previewCell = null;
  hintCell = null; // the board just changed under it — a standing suggestion is stale
  stoneAnimation = null;
  winLineAnimation = null;
  gamePhase = "playing"; // undo from a just-finished game returns to play
  updateForbiddenCells();
  render();
  maybeStartAiTurn();
}

function canUndo() {
  if (gamePhase !== "playing" && gamePhase !== "gameOver") return false;
  if (aiThinking || isAnimating()) return false;
  if (!gameState || gameState.moves.length === 0) return false;
  return true;
}

// --- new game / rematch ---------------------------------------------------

function goToSetup() {
  // BEFORE nulling gameState: any coin-flip/AI timer still pending for
  // the game being abandoned is cleared here — see gameId's own comment.
  beginNewGameEpoch();
  gamePhase = "setup";
  gameState = null;
  turnManager = null;
  previewCell = null;
  hintCell = null;
  forbiddenCells = [];
  aiThinking = false;
  stoneAnimation = null;
  winLineAnimation = null;
  render();
}

function rematch() {
  startGame(); // same mode/difficulty/size, fresh coin flip
}

undoBtn.addEventListener("click", performUndo);
newGameBtn.addEventListener("click", goToSetup);
gameOverNewGameBtn.addEventListener("click", goToSetup);
rematchBtn.addEventListener("click", rematch);

attachPointerHandlers(canvas, {
  onMove: updatePreviewFromPointer,
  onDown: updatePreviewFromPointer,
  onUp: commitPreview,
  onCancel: () => setPreview(null),
});

// #main-content, not #board-wrap — see updateBoardMax()'s own comment on
// why observing the element this callback resizes would loop. Every case
// the old observer covered still fires: #main-content's own width/height
// changes on any viewport resize or rotation, which is what actually
// moves the board.
new ResizeObserver(resize).observe(mainContent);

// Static icons that never change again after this — no update function
// owns these, so they're set once, here, rather than re-injected on
// every render() for no reason (contrast with the achievements/sound
// icons above, which really do change and get set inside their own
// update*() functions instead).
themeBtn.innerHTML = ICONS.palette;
settingsBtnIcon.innerHTML = ICONS.gear;

// Board-size options are generated from core/storage.js's own
// BOARD_SIZES rather than hardcoded in index.html, so the list can't
// drift from the one the persistence layer will actually accept.
for (const size of BOARD_SIZES) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "seg-btn";
  btn.dataset.boardSize = String(size);
  btn.textContent = `${size}×${size}`;
  boardSizeToggle.appendChild(btn);
}

updateAchievementsButton();
applyActiveTheme(); // also renders — see this function's own doc comment
render();
