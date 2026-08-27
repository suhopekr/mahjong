// src/main.js
// Entry point for Five in a Row.
//
// This pass reworked the whole surface for one specific reader: someone
// over 65, playing on a phone, who has never played this game before and
// may have reduced eyesight and less precise touch control. Wherever two
// designs were defensible, the easier and larger one is the default and
// the harder one is opt-in. There is no "sensible default for experts,
// turn it down in settings" anywhere in here.
//
// The concrete consequences, all visible below:
//
//   - 9x9 is the board. 11 and 15 exist only inside Settings, and nothing
//     on the way into a game asks which you want — a question is friction
//     and this one has no good answer for a first-time player.
//   - Placing a stone takes two taps by default (see handleTap). A
//     mis-tap that instantly becomes a permanent move is the most
//     expensive mistake this game can produce.
//   - Every point where the other side would win outright next turn is
//     marked, in a distinct shape, and said in words (updateDangerCells).
//     Losing without understanding why is the single biggest reason this
//     audience stops playing.
//   - Undo is unlimited, hints are unlimited and instant, nothing is
//     locked, nothing is timed, and there is no score to protect.
//   - Nothing is framed as a contest — see the TEXT table's own note.
//   - Every control has a text label and is always on screen. Nothing
//     lives behind a hamburger.
//
// The board/AI/rule modules underneath are unchanged in structure; this
// file is where the audience decisions live.

import { createGameState, placeStone, undoMove } from "./game/board.js";
import { boardLayout, pointToIntersection } from "./game/layout.js";
import {
  drawBoard,
  drawGhostStone,
  drawHintMarker,
  drawForbiddenMarker,
  drawDangerMarker,
  fitCanvasToDisplaySize,
} from "./game/render.js";
import { attachPointerHandlers } from "./core/input.js";
import { createTurnManager, pickStartingPlayer } from "./core/turn.js";
import { chooseMove, generateCandidates } from "./game/ai.js";
import { countPatterns } from "./game/evaluate.js";
import { suggestHint, findAllOpponentWinPoints } from "./game/hint.js";
import { findForbiddenPointsForBlack, forbiddenReasonText } from "./game/renju.js";
import { ACHIEVEMENTS, evaluateAchievements } from "./game/achievements.js";
import { getThemeById, resolveActiveThemeId } from "./game/themes.js";
import {
  playStoneSound,
  playWinSound,
  playLoseSound,
  playDrawGameSound,
  isSoundEnabled,
  setSoundEnabled,
  unlockAudio,
} from "./core/audio.js";
import {
  BOARD_SIZES,
  recordStreakResult,
  getStreak,
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
  isConfirmPlacementEnabled,
  setConfirmPlacementEnabled,
  isDangerWarningEnabled,
  setDangerWarningEnabled,
  loadSavedGame,
  saveGame,
  clearSavedGame,
} from "./core/storage.js";

// --- copy -----------------------------------------------------------------
//
// Every player-visible string this file produces, gathered here so the
// tone is checkable in one place rather than hunted through handlers.
//
// Two rules, both deliberate:
//
//   1. No contest framing. The source project said "vs AI", "Hard
//      difficulty", "You win!", "You lost", "Rematch", "Opponent". A
//      first-time player told they are in a contest and then beaten six
//      times has been told six times that they are bad at this. So: the
//      other side is "the computer", named only when it must be; a game
//      is a "round"; and a loss is an invitation to play again, not a
//      verdict.
//   2. No jargon on the surface. gomoku, renju, overline, forbidden move,
//      open three, open four, freestyle, difficulty — none appear in the
//      UI. Where the underlying rule still needs naming (the Renju
//      restrictions), it is described by what it does to your moves.
const TEXT = {
  yourTurnBlack: "Your turn — you have the dark stones",
  yourTurnWhite: "Your turn — you have the light stones",
  computerThinking: "The computer is taking its turn…",
  playerTurn: (label) => `${label}'s turn`,
  dangerOne: "Careful — the marked spot would make five in a row next turn.",
  dangerMany: (n) => `Careful — ${n} marked spots would make five in a row next turn.`,
  wonTitle: "You got five in a row!",
  wonNote: "Nicely done. Another round is ready whenever you are.",
  lostTitle: "Try another round",
  lostNote: "The computer got five in a row that time. Another round is ready whenever you are.",
  drawTitle: "The board is full",
  drawNote: "Nobody got five in a row. Another round is ready whenever you are.",
  localWon: (label) => `${label} got five in a row!`,
  localWonNote: "Another round is ready whenever you are.",
  // The two states of the confirm-to-place flow, kept distinct on
  // purpose. "Waiting" is not silence: with the Place button visible but
  // disabled, a first-time player needs to be told what the button is
  // waiting FOR, or the disabled control reads as broken.
  chooseSpot: "Tap the board to choose a spot.",
  confirmPrompt: "Tap the same spot again, or press Place stone.",
  occupied: "There is already a stone there.",
  restored: "Picked up where you left off.",
};

// Hint text in plain words. The source used the engine's own vocabulary
// ("Open four — this wins next turn", "Stop their open three"); these say
// the same thing without naming a shape.
const HINT_TEXT = {
  win: "This spot gets you five in a row.",
  "block-win": "Play here, or the other side gets five next turn.",
  "open-four": "A strong spot — it sets up five in a row.",
  "block-three": "Play here to break up the line building against you.",
  develop: "A solid spot to build from.",
};

// How long the "who has which stones" note stays up before play begins.
const OPENING_NOTE_MS = 1100;

// The computer's visible thinking pause. Raised from the source's 400ms:
// at 400 the label is gone before this audience has finished reading it,
// so the computer's move looks like it simply appeared. 600ms registers
// as "it is taking its turn" without feeling like waiting.
const MIN_AI_THINK_MS = 600;

const STONE_ANIMATION_MS = 90;
const WIN_LINE_ANIMATION_MS = 550;
const RESULT_REVEAL_MS = WIN_LINE_ANIMATION_MS + 250;
const TOAST_MS = 3200;

// The board never exceeds this CSS width. Without a cap it grows to fill a
// desktop viewport, which makes the eye travel further than it needs to
// and pushes the controls below the fold.
const BOARD_MAX_PX = 560;

// Honoured by skipping animations outright rather than shortening them.
// Read once: the OS setting is effectively static for a session.
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Whether this device does touch at all. Used only to decide which
// instruction the status line gives — the confirm-to-place flow itself is
// gated per-event on pointerType (see handleTap), which is the accurate
// signal; this is the coarse "what should the idle prompt say" question,
// which has to be answered before any pointer event has happened.
const isTouchDevice = window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;

// --- DOM ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const canvas = $("fir-board");
const boardWrap = $("fir-board-wrap");
const statusEl = $("fir-status");
const coinFlip = $("fir-coinflip");
const coinFlipText = $("fir-coinflip-text");
const confirmBar = $("fir-confirm");
const placeBtn = $("fir-place-btn");
const cancelBtn = $("fir-cancel-btn");
const hintBtn = $("fir-hint-btn");
const undoBtn = $("fir-undo-btn");
const newBtn = $("fir-new-btn");
const settingsBtn = $("fir-settings-btn");
const settingsPanel = $("fir-settings-panel");
const settingsClose = $("fir-settings-close");
const sizeGroup = $("fir-size-group");
const themeGroup = $("fir-theme-group");
const modeGroup = $("fir-mode-group");
const paceGroup = $("fir-pace-group");
const paceRow = $("fir-pace-row");
const toggleDanger = $("fir-toggle-danger");
const toggleConfirm = $("fir-toggle-confirm");
const toggleSoundEl = $("fir-toggle-sound");
const toggleRenju = $("fir-toggle-renju");
const statWins = $("fir-stat-wins");
const statBest = $("fir-stat-best");
const statBadges = $("fir-stat-badges");
const badgeList = $("fir-badges");
const resultModal = $("fir-result-modal");
const resultTitle = $("fir-result-title");
const resultNote = $("fir-result-note");
const resultAgain = $("fir-result-again");
const resultClose = $("fir-result-close");
const toasts = $("fir-toasts");

// --- persisted settings ---------------------------------------------------
let mode = getMode();
let difficulty = getDifficulty();
let renjuEnabled = isRenjuEnabled();
let boardSize = getBoardSize();
let confirmPlacement = isConfirmPlacementEnabled();
let dangerWarning = isDangerWarningEnabled();
let activeThemeColors = getThemeById(resolveActiveThemeId(getTheme())).colors;

// --- per-game state -------------------------------------------------------
let gamePhase = "opening"; // 'opening' | 'playing' | 'gameOver'
let gameState = null;
let turnManager = null;
let humanPlayer = 0;
let aiPlayer = 1;
let playerLabels = ["Player 1", "Player 2"];
let aiThinking = false;
let streakRecordedThisGame = false;
let lastStreakResult = null;
let achievementsRecordedThisGame = false;
let undoUsedThisGame = false;
let hintUsedThisGame = false;
let hintCell = null;
let forbiddenCells = [];
// Points where the side that is NOT about to move could complete five in
// a row immediately — see updateDangerCells().
let dangerCells = [];
let everHadOpenFour = [false, false];
let everHadOpenThree = [false, false];
// Two-step placement staging slot. A pending cell is drawn as a ghost and
// is NOT on the board; it becomes a real move only via commitPending().
let pendingCell = null;
let previewCell = null; // mouse hover only
let layout = null;
let ctx = null;

let gameId = 0;
let openingTimerId = null;
let aiTurnTimerId = null;
let resultTimerId = null;
let stoneAnimation = null;
let winLineAnimation = null;
let animationFrameId = null;

function cancelPendingGameTimers() {
  for (const id of [openingTimerId, aiTurnTimerId, resultTimerId]) if (id !== null) clearTimeout(id);
  openingTimerId = aiTurnTimerId = resultTimerId = null;
}

/**
 * Marks "a different game is now current", invalidating every deferred
 * callback in one step. Each of the three timers above also re-checks
 * `gameId` when it fires, for the case where a callback was already
 * dequeued and can no longer be cleared.
 */
function beginNewGameEpoch() {
  cancelPendingGameTimers();
  gameId += 1;
  return gameId;
}

// Reuses the site's own .achievement-toast component rather than defining
// a second toast style; only the container is this game's.
function toast(text) {
  const el = document.createElement("div");
  el.className = "achievement-toast is-visible";
  el.textContent = text;
  toasts.appendChild(el);
  setTimeout(() => el.remove(), TOAST_MS);
}

// --- analytics ------------------------------------------------------------
//
// Same shape as the Mahjong page's own trackEvent (game.js): check that
// gtag actually exists before calling, and swallow anything that throws.
// An ad blocker, a privacy extension, or a failed googletagmanager load
// all leave window.gtag undefined — none of which may affect the game.
//
// `game_name` is stamped here rather than at each call site, exactly as
// the Mahjong side does it. Without it, GA merges both games'
// game_start/game_win into one number and neither game's completion rate
// means anything.
function trackEvent(name, params) {
  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, { game_name: "five_in_a_row", ...params });
    }
  } catch {
    // Measurement failures are never allowed to reach the player.
  }
}

/** The settings that describe a round, shared by game_start and game_win
 * so the two are directly comparable in a report. */
function roundParams() {
  return {
    board_size: boardSize,
    // The internal difficulty ids, not the UI wording — "easy" stays
    // stable in reports even if the visible label changes again.
    pace: difficulty,
    mode: mode,
  };
}

// --- layout / rendering ---------------------------------------------------

function resize() {
  if (!gameState) return;
  // Width only. The board is square and driven by its wrapper's width,
  // which CSS has already constrained by the page gutter and
  // BOARD_MAX_PX. Letting height participate made the board jump size
  // whenever the status line wrapped to a second line.
  const cssSize = Math.max(220, Math.min(BOARD_MAX_PX, boardWrap.clientWidth));
  ctx = fitCanvasToDisplaySize(canvas, cssSize, cssSize);
  // Padding requested as 0 so boardLayout() applies its own proportional
  // floor (stone radius + half a grid line). Passing a fixed pixel
  // padding, as the source did, is what clipped edge stones at small
  // sizes.
  layout = boardLayout(gameState.size, cssSize, cssSize, 0);
  render();
}

function render() {
  if (!ctx || !layout || !gameState) return;

  const animatingCell =
    stoneAnimation && !reduceMotion
      ? {
          row: stoneAnimation.row,
          col: stoneAnimation.col,
          progress: progressOf(stoneAnimation.startTime, STONE_ANIMATION_MS),
        }
      : null;
  const winLineProgress =
    winLineAnimation && !reduceMotion ? progressOf(winLineAnimation.startTime, WIN_LINE_ANIMATION_MS) : 1;

  drawBoard(ctx, layout, gameState, { theme: activeThemeColors, animatingCell, winLineProgress });

  for (const cell of forbiddenCells) drawForbiddenMarker(ctx, layout, cell.row, cell.col, activeThemeColors);
  for (const cell of dangerCells) drawDangerMarker(ctx, layout, cell.row, cell.col, activeThemeColors);
  if (hintCell && gameState.winner === null) drawHintMarker(ctx, layout, hintCell.row, hintCell.col, activeThemeColors);

  // A staged stone takes precedence over the mouse hover preview — they
  // are never both meaningful at once.
  const ghost = pendingCell ?? (isHumanInputAllowed() && !aiThinking ? previewCell : null);
  if (ghost && gameState.winner === null) {
    drawGhostStone(ctx, layout, ghost.row, ghost.col, turnManager.current(), activeThemeColors);
  }

  updateStatus();
  updateControls();
}

function progressOf(startTime, durationMs) {
  return Math.min(1, (performance.now() - startTime) / durationMs);
}

function isAnimating() {
  return stoneAnimation !== null || winLineAnimation !== null;
}

function ensureAnimationLoop() {
  if (reduceMotion) {
    stoneAnimation = null;
    winLineAnimation = null;
    render();
    return;
  }
  if (animationFrameId !== null) return;
  const step = () => {
    if (stoneAnimation && progressOf(stoneAnimation.startTime, STONE_ANIMATION_MS) >= 1) stoneAnimation = null;
    if (winLineAnimation && progressOf(winLineAnimation.startTime, WIN_LINE_ANIMATION_MS) >= 1) winLineAnimation = null;
    render();
    animationFrameId = isAnimating() ? requestAnimationFrame(step) : null;
  };
  animationFrameId = requestAnimationFrame(step);
}

// --- status line ----------------------------------------------------------

/**
 * Writes the status line, and ONLY when the text actually changed.
 *
 * The guard is load-bearing, not an optimisation. #fir-status is
 * aria-live="polite", and render() runs on every animation frame — so
 * assigning textContent unconditionally re-announced the same sentence to
 * a screen reader on every frame of every stone animation, and again on
 * every tap that produced the same state. polite queues rather than
 * interrupts, so that backlog would be read out long after the moment
 * passed. Comparing first means an announcement happens exactly when the
 * state genuinely changes.
 */
function setStatus(text, kind = "") {
  if (statusEl.textContent !== text) statusEl.textContent = text;
  statusEl.classList.toggle("fir-status-danger", kind === "danger");
  statusEl.classList.toggle("fir-status-hint", kind === "hint");
}

function updateStatus() {
  if (!gameState) return;
  if (gameState.winner !== null) {
    if (gameState.winner === "draw") return setStatus(TEXT.drawTitle);
    if (mode === "ai") return setStatus(gameState.winner === humanPlayer ? TEXT.wonTitle : TEXT.lostTitle);
    return setStatus(TEXT.localWon(playerLabels[gameState.winner]));
  }
  if (aiThinking) return setStatus(TEXT.computerThinking);
  // A staged stone outranks everything below: it is the only state with a
  // pending action the player has to complete, and the Place button is
  // sitting right there waiting for it.
  if (pendingCell) return setStatus(TEXT.confirmPrompt);
  if (hintCell) return setStatus(HINT_TEXT[hintCell.reason] ?? "", "hint");
  // The danger warning is stated in words as well as drawn, so it never
  // depends on noticing a mark on the board.
  if (dangerCells.length > 0) {
    return setStatus(dangerCells.length > 1 ? TEXT.dangerMany(dangerCells.length) : TEXT.dangerOne, "danger");
  }
  const current = turnManager.current();
  const yourMove = mode !== "ai" || current === humanPlayer;
  // With the Place button on screen and disabled, say what it is waiting
  // for. Only on touch, and only while confirm-to-place is actually
  // armed — a mouse user places in one click and never sees that button
  // do anything, so telling them to "choose a spot" first would describe
  // a step that does not exist for them.
  if (yourMove && confirmPlacement && isTouchDevice) return setStatus(TEXT.chooseSpot);
  if (mode === "ai") {
    return setStatus(current === humanPlayer ? (humanPlayer === 0 ? TEXT.yourTurnBlack : TEXT.yourTurnWhite) : TEXT.computerThinking);
  }
  setStatus(TEXT.playerTurn(playerLabels[current]));
}

function updateControls() {
  hintBtn.disabled = !isHumanInputAllowed();
  undoBtn.disabled = !canUndo();
  // The confirm row itself is never hidden — see index.html's own note on
  // why. Only the buttons' states change, and neither change alters the
  // row's height, so nothing below it ever moves.
  placeBtn.disabled = pendingCell === null;
  cancelBtn.hidden = pendingCell === null;
}

// --- danger warning -------------------------------------------------------

/**
 * Recomputes `dangerCells`: every empty point where the side about to
 * move NEXT would complete five in a row immediately.
 *
 * Reuses game/hint.js's findAllOpponentWinPoints() rather than adding a
 * second copy of "can this player win right here". That function already
 * does the legality filtering the Renju restrictions need, and hint.js's
 * own block-a-win rung is built on it, so the warning and the hint can
 * never disagree about what counts as a threat.
 *
 * Skipped when it is the computer's turn in computer mode — there is no
 * one to warn. In two-player mode both sides are people and both get the
 * warning on their own turn.
 */
function updateDangerCells() {
  dangerCells = [];
  if (!dangerWarning) return;
  if (!gameState || gameState.winner !== null) return;
  if (!turnManager || gamePhase !== "playing") return;
  const current = turnManager.current();
  if (mode === "ai" && current !== humanPlayer) return;
  const threatener = 1 - current;
  const points = findAllOpponentWinPoints(gameState.board, threatener, generateCandidates(gameState.board), renjuEnabled);
  dangerCells = points.map(([row, col]) => ({ row, col }));
}

function updateForbiddenCells() {
  if (!renjuEnabled || !gameState || gameState.winner !== null || turnManager.current() !== 0) {
    forbiddenCells = [];
    return;
  }
  forbiddenCells = findForbiddenPointsForBlack(gameState.board, generateCandidates(gameState.board));
}

/** Everything that has to be recomputed after the board changes. */
function refreshBoardDerivedState() {
  updateForbiddenCells();
  updateDangerCells();
}

// --- game start -----------------------------------------------------------

function startGame() {
  const thisGameId = beginNewGameEpoch();
  const firstIsBlack = pickStartingPlayer(2, Math.random) === 0;
  if (mode === "ai") {
    humanPlayer = firstIsBlack ? 0 : 1;
    aiPlayer = 1 - humanPlayer;
  } else {
    playerLabels = firstIsBlack ? ["Player 1", "Player 2"] : ["Player 2", "Player 1"];
  }

  boardSize = getBoardSize();
  gameState = createGameState(boardSize);
  turnManager = createTurnManager(2, 0);
  resetPerGameFlags();
  gamePhase = "opening";

  coinFlipText.textContent =
    mode === "ai"
      ? humanPlayer === 0
        ? "You have the dark stones, and you go first."
        : "You have the light stones. The computer goes first."
      : `${playerLabels[0]} has the dark stones and goes first.`;
  coinFlip.hidden = false;
  closeResultModal();
  resize();

  openingTimerId = setTimeout(
    () => {
      openingTimerId = null;
      if (thisGameId !== gameId) return;
      coinFlip.hidden = true;
      gamePhase = "playing";
      refreshBoardDerivedState();
      render();
      persistGame();
      // Fired when play actually begins, not when startGame() is called —
      // a round abandoned during the opening note was never really started.
      // A restored game does not fire this either (restoreGame() has its
      // own path), so game_start counts rounds begun, not page loads.
      trackEvent("game_start", roundParams());
      maybeStartAiTurn();
    },
    reduceMotion ? 0 : OPENING_NOTE_MS,
  );
}

function resetPerGameFlags() {
  pendingCell = null;
  previewCell = null;
  aiThinking = false;
  streakRecordedThisGame = false;
  lastStreakResult = null;
  achievementsRecordedThisGame = false;
  undoUsedThisGame = false;
  hintUsedThisGame = false;
  hintCell = null;
  forbiddenCells = [];
  dangerCells = [];
  everHadOpenFour = [false, false];
  everHadOpenThree = [false, false];
  stoneAnimation = null;
  winLineAnimation = null;
}

// --- save / restore -------------------------------------------------------
//
// The rest of this site keeps an in-progress game across a reload, and so
// does this one now. It matters more here: this audience is the most
// likely to close a tab by accident, and losing a board they had been
// thinking about is a real loss.
//
// Written after every committed move, every hint and every undo; cleared
// when a round ends or a new one starts, so a finished game never returns.

function persistGame() {
  if (!gameState || gamePhase !== "playing") return;
  saveGame({
    size: gameState.size,
    board: gameState.board,
    moves: gameState.moves,
    mode,
    difficulty,
    humanPlayer,
    turn: turnManager.current(),
    undoUsed: undoUsedThisGame,
    hintUsed: hintUsedThisGame,
  });
}

/**
 * Rebuilds a game from a stored snapshot; false if there was nothing
 * usable, in which case the caller starts fresh.
 *
 * The board is adopted wholesale rather than replayed move by move.
 * Replaying would re-run win detection (and could end the restored game
 * on its own last move) and would re-fire the sounds and animations of a
 * game the player already watched.
 */
function restoreGame() {
  const saved = loadSavedGame();
  if (!saved) return false;
  // A board size this build no longer offers would still render, but the
  // settings UI could not represent it — treat it as unusable rather than
  // restoring into a state the player cannot see or change.
  if (!BOARD_SIZES.includes(saved.size)) return false;

  beginNewGameEpoch();
  mode = saved.mode;
  difficulty = saved.difficulty;
  humanPlayer = saved.humanPlayer;
  aiPlayer = 1 - humanPlayer;
  boardSize = saved.size;
  playerLabels = ["Player 1", "Player 2"];

  gameState = { size: saved.size, board: saved.board, moves: saved.moves, winner: null, winLine: null };
  turnManager = createTurnManager(2, 0);
  // The manager always starts at index 0; advance it to the stored turn
  // without touching the board. recordMove() is its only way forward and
  // it does not inspect the move object on this path.
  if (saved.turn !== 0) turnManager.recordMove({ row: -1, col: -1 }, false);

  resetPerGameFlags();
  undoUsedThisGame = saved.undoUsed;
  hintUsedThisGame = saved.hintUsed;
  // The "ever had" pattern flags are about what happened DURING the game
  // and cannot be recovered from a board. Seeding them from the current
  // position is the honest approximation: it can only under-credit
  // "Untouchable" (which asks that the other side never had an open
  // three), never over-credit it, because anything visible now did
  // definitely happen.
  for (const p of [0, 1]) {
    const counts = countPatterns(gameState.board, p);
    if (counts.openFour > 0) everHadOpenFour[p] = true;
    if (counts.openThree > 0) everHadOpenThree[p] = true;
  }

  gamePhase = "playing";
  coinFlip.hidden = true;
  refreshBoardDerivedState();
  resize();
  maybeStartAiTurn();
  return true;
}

// --- moves ----------------------------------------------------------------

function commitMove(row, col, player) {
  placeStone(gameState, row, col, player);
  turnManager.recordMove({ row, col }, false);
  playStoneSound(mode === "ai" && player === aiPlayer);
  if (!reduceMotion) stoneAnimation = { row, col, startTime: performance.now() };
  hintCell = null;
  pendingCell = null;
  previewCell = null;
  trackLivePatterns(player);

  if (gameState.winner !== null) {
    gamePhase = "gameOver";
    if (gameState.winLine && !reduceMotion) winLineAnimation = { startTime: performance.now() };
    clearSavedGame(); // a finished round must not come back on reload
    scheduleResultReveal();
    playGameOverSound();
    recordStreakOnce();
    evaluateAndUnlockAchievements();
    // Only a win by the person playing — a loss or a draw is not a
    // game_win, and in two-player mode there is no "you" to credit, so
    // that mode reports the outcome without claiming a winner.
    if (mode === "ai" && gameState.winner === humanPlayer) {
      trackEvent("game_win", {
        ...roundParams(),
        moves: gameState.moves.length,
        undo_used: undoUsedThisGame,
        hint_used: hintUsedThisGame,
      });
    }
  } else {
    persistGame();
  }

  refreshBoardDerivedState();
  render();
  ensureAnimationLoop();
  maybeStartAiTurn();
}

function trackLivePatterns(player) {
  const counts = countPatterns(gameState.board, player);
  if (counts.openFour > 0) everHadOpenFour[player] = true;
  if (counts.openThree > 0) everHadOpenThree[player] = true;
}

function maybeStartAiTurn() {
  if (mode !== "ai" || !gameState) return;
  if (gameState.winner !== null) return;
  if (turnManager.current() !== aiPlayer) return;

  aiThinking = true;
  pendingCell = null; // nothing may stay staged across the computer's turn
  render();
  const thisGameId = gameId;
  // Deferred by exactly the stone animation's own duration so the
  // player's stone finishes its pop-in before the computer's synchronous
  // search blocks the main thread. A bare setTimeout(…, 0) let the search
  // start first and froze the stone mid-animation.
  aiTurnTimerId = setTimeout(() => {
    aiTurnTimerId = null;
    if (thisGameId !== gameId) return;
    runAiTurn(thisGameId);
  }, STONE_ANIMATION_MS);
}

function runAiTurn(thisGameId) {
  const start = performance.now();
  const move = chooseMove(gameState.board, aiPlayer, difficulty, Math.random, renjuEnabled);
  const elapsed = performance.now() - start;
  aiTurnTimerId = setTimeout(
    () => {
      aiTurnTimerId = null;
      if (thisGameId !== gameId) return;
      aiThinking = false;
      if (!move) return;
      commitMove(move[0], move[1], aiPlayer);
    },
    Math.max(0, MIN_AI_THINK_MS - elapsed),
  );
}

// --- input ----------------------------------------------------------------

function isHumanInputAllowed() {
  if (gamePhase !== "playing") return false;
  if (aiThinking) return false;
  if (!gameState || gameState.winner !== null) return false;
  if (mode === "ai" && turnManager.current() !== humanPlayer) return false;
  return true;
}

/**
 * Why a tap at (row, col) cannot become a stone, or null if it can.
 * Returning a reason rather than a boolean is what lets the caller SAY
 * so: a tap that silently does nothing is indistinguishable from a tap
 * the game failed to notice, which is exactly the ambiguity this audience
 * cannot resolve on their own.
 */
function rejectionFor(row, col) {
  if (gameState.board[row][col] !== null) return TEXT.occupied;
  const forbidden = forbiddenCells.find((c) => c.row === row && c.col === col);
  if (forbidden) return forbiddenReasonText(forbidden.reason);
  return null;
}

/**
 * The two-step placement state machine, driven from the pointer layer's
 * onUp — core/input.js gives one Pointer Events path covering mouse,
 * touch and pen, so this needs no per-device branching beyond the
 * pointerType check below.
 *
 *   nothing staged + tap X  ->  stage X
 *   X staged       + tap X  ->  commit X
 *   X staged       + tap Y  ->  move the staging to Y
 *
 * Confirmation applies to touch and pen only. A mouse already shows a
 * hover preview of exactly where the stone will land before the click,
 * and a click is precise — a second click there would be friction with
 * nothing bought for it. Touch has no hover, which is the whole reason
 * the staged stone exists.
 */
function handleTap(pos, meta) {
  unlockAudio();
  if (!isHumanInputAllowed() || !layout) return;
  const hit = pointToIntersection(layout, pos.x, pos.y);
  if (!hit) return;

  const reason = rejectionFor(hit.row, hit.col);
  if (reason) {
    toast(reason);
    pendingCell = null;
    render();
    return;
  }

  const wantsConfirm = confirmPlacement && (meta?.pointerType === "touch" || meta?.pointerType === "pen");
  if (!wantsConfirm) return commitMove(hit.row, hit.col, turnManager.current());
  if (pendingCell && pendingCell.row === hit.row && pendingCell.col === hit.col) return commitPending();
  pendingCell = hit;
  render();
}

function commitPending() {
  if (!pendingCell || !isHumanInputAllowed()) return;
  const { row, col } = pendingCell;
  const reason = rejectionFor(row, col);
  if (reason) {
    toast(reason);
    pendingCell = null;
    render();
    return;
  }
  commitMove(row, col, turnManager.current());
}

function updateHoverPreview(pos, meta) {
  // Mouse only: touch has no hover, and letting a touch drag paint a
  // preview would compete with the staged stone.
  if (meta && meta.pointerType !== "mouse") return;
  if (!isHumanInputAllowed() || !layout) return setPreview(null);
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

attachPointerHandlers(canvas, {
  onMove: updateHoverPreview,
  onUp: handleTap,
  onCancel: () => setPreview(null),
});

placeBtn.addEventListener("click", () => {
  unlockAudio();
  commitPending();
});
cancelBtn.addEventListener("click", () => {
  pendingCell = null;
  render();
});

// --- hint -----------------------------------------------------------------
// Unlimited and instant. The source gave one free hint per round and put
// every one after that behind a video ad.

hintBtn.addEventListener("click", () => {
  unlockAudio();
  if (!isHumanInputAllowed()) return;
  const suggested = suggestHint(gameState.board, turnManager.current(), renjuEnabled);
  if (!suggested) return;
  hintCell = suggested;
  hintUsedThisGame = true;
  persistGame();
  render();
});

// --- undo -----------------------------------------------------------------
// Unlimited, in every mode, matching the rest of this site.

function canUndo() {
  if (gamePhase !== "playing" && gamePhase !== "gameOver") return false;
  if (aiThinking || isAnimating()) return false;
  if (!gameState || gameState.moves.length === 0) return false;
  return true;
}

undoBtn.addEventListener("click", () => {
  if (!canUndo()) return;
  undoUsedThisGame = true;
  turnManager.undoTurn(() => undoMove(gameState));
  // In computer mode one press takes back a whole round — the computer's
  // reply and the move that prompted it. Taking back only the computer's
  // reply would hand the player straight back to the same decision.
  if (mode === "ai" && gameState.moves.length > 0 && turnManager.current() === aiPlayer) {
    turnManager.undoTurn(() => undoMove(gameState));
  }
  pendingCell = null;
  previewCell = null;
  hintCell = null;
  stoneAnimation = null;
  winLineAnimation = null;
  gamePhase = "playing";
  closeResultModal();
  refreshBoardDerivedState();
  render();
  persistGame();
  maybeStartAiTurn();
});

// --- end of round ---------------------------------------------------------

function playGameOverSound() {
  if (gameState.winner === "draw") playDrawGameSound();
  else if (mode === "ai") (gameState.winner === humanPlayer ? playWinSound : playLoseSound)();
  else playWinSound();
}

// Held back until the win line has finished sweeping, so the one moment
// worth watching is not covered by a box announcing that it happened.
function scheduleResultReveal() {
  const thisGameId = gameId;
  resultTimerId = setTimeout(
    () => {
      resultTimerId = null;
      if (gameId !== thisGameId || gamePhase !== "gameOver") return;
      openResultModal();
    },
    reduceMotion ? 0 : RESULT_REVEAL_MS,
  );
}

function openResultModal() {
  const w = gameState.winner;
  if (w === "draw") {
    resultTitle.textContent = TEXT.drawTitle;
    resultNote.textContent = TEXT.drawNote;
  } else if (mode === "ai") {
    const won = w === humanPlayer;
    resultTitle.textContent = won ? TEXT.wonTitle : TEXT.lostTitle;
    resultNote.textContent = won ? TEXT.wonNote : TEXT.lostNote;
  } else {
    resultTitle.textContent = TEXT.localWon(playerLabels[w]);
    resultNote.textContent = TEXT.localWonNote;
  }
  resultModal.dataset.open = "true";
  resultAgain.focus();
}

function closeResultModal() {
  resultModal.dataset.open = "false";
}

resultAgain.addEventListener("click", () => {
  closeResultModal();
  clearSavedGame();
  startGame();
});
resultClose.addEventListener("click", closeResultModal);

function recordStreakOnce() {
  if (mode !== "ai" || streakRecordedThisGame) return;
  streakRecordedThisGame = true;
  lastStreakResult = recordStreakResult(difficulty, gameState.winner === humanPlayer);
  refreshStats();
}

function evaluateAndUnlockAchievements() {
  if (achievementsRecordedThisGame) return;
  achievementsRecordedThisGame = true;
  if (mode === "ai" && gameState.winner === humanPlayer && difficulty === "hard") {
    recordHardWin(gameState.size);
    recordHardWinByColor(humanPlayer);
  }
  if (mode === "local" && gameState.winner !== null) incrementLocalGamesCompleted();

  const qualifying = evaluateAchievements({
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
  });
  const newly = qualifying.filter((id) => unlockAchievement(id));
  refreshStats();
  for (const id of newly) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a) toast(`Badge earned — ${a.title}`);
  }
}

// --- new game -------------------------------------------------------------

newBtn.addEventListener("click", () => {
  unlockAudio();
  clearSavedGame();
  startGame();
});

// --- settings -------------------------------------------------------------

function knownUnlockedAchievementIds() {
  const known = new Set(ACHIEVEMENTS.map((a) => a.id));
  return getUnlockedAchievements().filter((id) => known.has(id));
}

function refreshStats() {
  const s = getStreak(difficulty);
  statWins.textContent = String(s.current);
  statBest.textContent = String(s.best);
  const unlocked = new Set(knownUnlockedAchievementIds());
  statBadges.textContent = `${unlocked.size} of ${ACHIEVEMENTS.length}`;
  badgeList.innerHTML = "";
  for (const a of ACHIEVEMENTS) {
    const earned = unlocked.has(a.id);
    const li = document.createElement("li");
    li.className = earned ? "fir-badge fir-badge-earned" : "fir-badge";
    // Earned vs not is carried by a WORD, not only by colour or opacity.
    const state = document.createElement("span");
    state.className = "fir-badge-state";
    state.textContent = earned ? "Earned" : "Not yet";
    const title = document.createElement("span");
    title.className = "fir-badge-title";
    title.textContent = a.title;
    const desc = document.createElement("span");
    desc.className = "fir-badge-desc";
    desc.textContent = a.description;
    li.append(state, title, desc);
    badgeList.appendChild(li);
  }
}

function syncSettingsUI() {
  for (const input of sizeGroup.querySelectorAll("input")) input.checked = Number(input.value) === boardSize;
  for (const input of themeGroup.querySelectorAll("input")) input.checked = input.value === resolveActiveThemeId(getTheme());
  for (const input of modeGroup.querySelectorAll("input")) input.checked = input.value === mode;
  for (const input of paceGroup.querySelectorAll("input")) input.checked = input.value === difficulty;
  paceRow.hidden = mode !== "ai";
  toggleDanger.checked = dangerWarning;
  toggleConfirm.checked = confirmPlacement;
  toggleSoundEl.checked = isSoundEnabled();
  toggleRenju.checked = renjuEnabled;
  refreshStats();
}

function openSettings() {
  syncSettingsUI();
  settingsPanel.dataset.open = "true";
  // Scroll to the top BEFORE moving focus, and move focus without
  // scrolling. A plain settingsClose.focus() scrolls its target into
  // view, and Close is the last element in a long sheet — so opening
  // Settings jumped straight to the bottom of the badge list and the
  // first row (Board size) was never seen. Focus still lands somewhere
  // inside the dialog so the keyboard path is unchanged.
  const sheet = settingsPanel.querySelector(".settings-sheet");
  if (sheet) sheet.scrollTop = 0;
  settingsPanel.scrollTop = 0;
  settingsClose.focus({ preventScroll: true });
}

function closeSettings() {
  settingsPanel.dataset.open = "false";
  settingsBtn.focus();
}

settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsPanel.addEventListener("click", (evt) => {
  if (evt.target === settingsPanel) closeSettings();
});

document.addEventListener("keydown", (evt) => {
  if (evt.key !== "Escape") return;
  if (resultModal.dataset.open === "true") return closeResultModal();
  if (settingsPanel.dataset.open === "true") closeSettings();
});

// Board size is the one setting that must not disturb a game in progress,
// so it applies to the next round. Everything else takes effect at once,
// because seeing the change is how you know it is the one you wanted.
sizeGroup.addEventListener("change", (evt) => {
  boardSize = Number(evt.target.value);
  setBoardSize(boardSize);
});

themeGroup.addEventListener("change", (evt) => {
  setTheme(evt.target.value);
  activeThemeColors = getThemeById(resolveActiveThemeId(getTheme())).colors;
  render();
});

modeGroup.addEventListener("change", (evt) => {
  mode = evt.target.value;
  setMode(mode);
  paceRow.hidden = mode !== "ai";
  clearSavedGame();
  startGame();
});

paceGroup.addEventListener("change", (evt) => {
  difficulty = evt.target.value;
  setDifficulty(difficulty);
  refreshStats();
});

toggleDanger.addEventListener("change", () => {
  dangerWarning = toggleDanger.checked;
  setDangerWarningEnabled(dangerWarning);
  refreshBoardDerivedState();
  render();
});

toggleConfirm.addEventListener("change", () => {
  confirmPlacement = toggleConfirm.checked;
  setConfirmPlacementEnabled(confirmPlacement);
  if (!confirmPlacement) pendingCell = null;
  render();
});

toggleSoundEl.addEventListener("change", () => {
  unlockAudio();
  setSoundEnabled(toggleSoundEl.checked);
});

toggleRenju.addEventListener("change", () => {
  renjuEnabled = toggleRenju.checked;
  setRenjuEnabled(renjuEnabled);
  refreshBoardDerivedState();
  render();
});

// --- cross-game links -----------------------------------------------------
//
// Mirrors the Mahjong page's own wiring. Reported with from/to reversed so
// the two directions are distinguishable in one report, and with the same
// `placement` vocabulary. game_name is added by trackEvent itself.
//
// Navigation is never delayed to wait on delivery — GA4 sends via
// sendBeacon, and making someone wait on measurement is the wrong trade.
for (const [id, placement] of [
  ["fir-link-crossgame-win", "win_modal"],
  ["fir-link-crossgame-footer", "footer"],
]) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("click", () => {
      trackEvent("cross_game_click", { from: "five_in_a_row", to: "mahjong", placement });
    });
  }
}

// --- boot -----------------------------------------------------------------

new ResizeObserver(resize).observe(boardWrap);

syncSettingsUI();
if (restoreGame()) toast(TEXT.restored);
else startGame();
