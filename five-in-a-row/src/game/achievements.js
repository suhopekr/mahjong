// game/achievements.js
// 11 achievements (milestone 7-2 declared 12; the QA pass dropped one —
// see "Hard Mode" below), declared as a plain data array and evaluated
// by iterating it — not a wall of if-statements. Each entry is just
// {id, title, description, requiresCreditableWin, check(context)};
// evaluateAchievements() below is the only place that loops over them.
// Adding a 12th achievement later means adding one array entry, not
// finding the right spot in a growing if/else chain.
//
// --- why 11, not 12 (QA pass) ------------------------------------------
//
// Milestone 7-2 shipped "Small Board" (beat Hard on 9x9) and "Big Board"
// (beat Hard on 15x15) on the assumption a board-size picker would land
// soon after. It never did — main.js's BOARD_SIZE is a hardcoded 15 and
// CLAUDE.md section 8 still lists the picker as a later milestone — so
// Small Board was a permanently un-earnable entry in a list the player
// can see, and Big Board was just "beat Hard" wearing a misleading name.
// Small Board is gone; Big Board became "Hard Mode" (id `hard-mode`),
// which says what it actually checks. main.js carries the one-time
// `big-board` -> `hard-mode` carry-over for players who'd already earned
// it, and counts only ids that still exist here so a stale stored id
// can't inflate the "N/11" counter — see its knownUnlockedAchievementIds().
//
// This module is pure: it only ever reads an AchievementContext object
// and returns which ids currently qualify. It never touches
// core/storage.js directly (doesn't know what's already unlocked, never
// calls unlockAchievement()) and never touches the DOM — main.js is
// responsible for building the context, persisting whichever ids come
// back as newly unlocked, and showing a toast. That split is what makes
// this file trivially Node-testable with plain fixtures (see
// test/achievements.test.js) despite depending on live game facts.
//
// --- the creditableWin gate (CLAUDE.md milestone 7-2's own warning) -----
//
// A real Dots and Boxes pitfall: several of these achievements only make
// sense as something the HUMAN accomplished (beat Hard, avoided ever
// being in danger, won cheaply) — if the AI is the one who actually won
// the game, crediting the human anyway is a real, easy-to-miss bug. Every
// achievement below that's fundamentally "I beat the AI at something" —
// which turns out to be all of them except Local Legend — declares
// `requiresCreditableWin: true`, and evaluateAchievements() checks that
// ONE condition (mode is vs-AI AND the human is the actual winner) in
// exactly one place before even calling that achievement's check().
// Individual check() functions never have to re-derive "did I actually
// win this" themselves, so there's nowhere left for that mistake to hide.
//
// (The user's own instructions named 4/5/6/7/12 specifically as needing
// this gate — the achievements whose check() logic is elaborate enough
// that the gate might get forgotten. 8/9/10 need it exactly as much,
// since "beat Hard" is just as miscreditable if the AI won instead; 1/2/3
// are gated too, mostly for defensive consistency, since D&B's own
// per-difficulty streak already only increments on a human win. Local
// Legend is the one genuine exception — it's explicitly about local
// 2-player completions, not a vs-AI result at all.)
//
// --- reusing evaluate()'s pattern recognition (Comeback / Untouchable) --
//
// evaluate() itself only ever returns a single scalar score, which can't
// answer "did the opponent ever have an open four" — but game/evaluate.js
// already exports countPatterns(board, player), the exact per-tier count
// breakdown evaluate() is built on top of (milestone 4-1). No new pattern-
// counting function was needed: main.js calls countPatterns() once after
// every move (for whoever just moved) and ORs the result into a running
// per-player "ever had an open four / open three" flag for the rest of
// the game — that's the "플레이 중 즉시 평가" half of this milestone. This
// file only ever sees the FINAL flags, already resolved, in the context
// object; it doesn't do any pattern recognition of its own.

/**
 * @typedef {Object} AchievementContext
 * @property {ReturnType<typeof import("./board.js").createGameState>} gameState - the just-concluded game's final state
 * @property {'ai'|'local'} mode
 * @property {0|1} [humanPlayer] - vs-AI mode only
 * @property {'easy'|'medium'|'hard'} [difficulty] - vs-AI mode only
 * @property {boolean} undoUsedThisGame - can't be reconstructed after the
 *   fact (undo destructively pops move history), so this MUST be tracked
 *   live during play, unlike everything else here
 * @property {boolean} hintUsedThisGame - same reasoning as
 *   undoUsedThisGame — tracked live, milestone 8-1's Hint feature; ANY
 *   hint (the free one or an ad-watched one) counts as "help used" for
 *   No Help Needed, not just paid ones (see that achievement's own
 *   check() below)
 * @property {[boolean, boolean]} everHadOpenFour - per board-index, did
 *   that player have an open four at any point this game (tracked live)
 * @property {[boolean, boolean]} everHadOpenThree - per board-index (tracked live)
 * @property {{current: number, best: number, isNewBest: boolean} | null} streakResult -
 *   vs-AI mode only: this game's core/storage.js recordStreakResult() output
 * @property {Record<number, boolean>} hardWinsByColor - AFTER this game's
 *   own recordHardWinByColor() call, if any
 * @property {number} localGamesCompleted - AFTER this game's own
 *   incrementLocalGamesCompleted() call, if any
 */

function countStonesBy(gameState, player) {
  return gameState.moves.filter((move) => move.player === player).length;
}

/**
 * A win line is always a straight run of >= 5 colinear points (see
 * game/board.js's checkWin) — just comparing the first two points'
 * row/col deltas is enough to classify the whole line.
 */
function winLineDirection(winLine) {
  const [r0, c0] = winLine[0];
  const [r1, c1] = winLine[1];
  if (r0 === r1) return "horizontal";
  if (c0 === c1) return "vertical";
  return "diagonal";
}

export const ACHIEVEMENTS = [
  {
    id: "first-win",
    title: "First Win",
    description: "Win a game against the AI, any difficulty.",
    requiresCreditableWin: true,
    check: () => true,
  },
  {
    id: "hot-streak",
    title: "Hot Streak",
    description: "Reach a 5-game win streak against the AI.",
    requiresCreditableWin: true,
    check: (ctx) => !!ctx.streakResult && ctx.streakResult.current >= 5,
  },
  {
    id: "unstoppable",
    title: "Unstoppable",
    description: "Reach a 10-game win streak against the AI.",
    requiresCreditableWin: true,
    check: (ctx) => !!ctx.streakResult && ctx.streakResult.current >= 10,
  },
  {
    id: "sharpshooter",
    title: "Sharpshooter",
    description: "Win using 20 of your own stones or fewer.",
    requiresCreditableWin: true,
    check: (ctx) => countStonesBy(ctx.gameState, ctx.humanPlayer) <= 20,
  },
  {
    id: "comeback",
    title: "Comeback",
    description: "Win a game after the AI once had an open four.",
    requiresCreditableWin: true,
    check: (ctx) => ctx.everHadOpenFour[1 - ctx.humanPlayer],
  },
  {
    id: "untouchable",
    title: "Untouchable",
    description: "Win without ever letting the AI form an open three.",
    requiresCreditableWin: true,
    check: (ctx) => !ctx.everHadOpenThree[1 - ctx.humanPlayer],
  },
  {
    id: "no-help-needed",
    title: "No Help Needed",
    description: "Beat Hard difficulty without using Undo or a Hint.",
    requiresCreditableWin: true,
    // Milestone 8-1 extended this gate to hints — the achievement's own
    // NAME was always broader than "no undo specifically," and a hint is
    // just as much external help as an undo is. The free first hint
    // counts too (hintUsedThisGame doesn't distinguish free from
    // ad-watched — see AchievementContext's own doc comment on it).
    check: (ctx) => ctx.difficulty === "hard" && !ctx.undoUsedThisGame && !ctx.hintUsedThisGame,
  },
  {
    id: "both-sides",
    title: "Both Sides",
    description: "Beat Hard difficulty playing as both Black and White (across any games).",
    requiresCreditableWin: true,
    check: (ctx) => ctx.difficulty === "hard" && ctx.hardWinsByColor[0] && ctx.hardWinsByColor[1],
  },
  {
    id: "hard-mode",
    title: "Hard Mode",
    description: "Beat Hard difficulty.",
    requiresCreditableWin: true,
    // No board-size condition — see the file header for why the old
    // Small/Big Board pair collapsed into this one.
    check: (ctx) => ctx.difficulty === "hard",
  },
  {
    id: "local-legend",
    title: "Local Legend",
    description: "Complete 10 local 2-player games.",
    requiresCreditableWin: false, // not a vs-AI result at all — see file header
    check: (ctx) => ctx.mode === "local" && ctx.localGamesCompleted >= 10,
  },
  {
    id: "diagonal-master",
    title: "Diagonal Master",
    description: "Win with a diagonal line of five.",
    requiresCreditableWin: true,
    check: (ctx) => ctx.gameState.winLine !== null && winLineDirection(ctx.gameState.winLine) === "diagonal",
  },
];

/**
 * Every achievement id whose condition is satisfied by `context` — NOT
 * filtered by what's already unlocked (that's core/storage.js's
 * unlockAchievement()'s own idempotency, applied by the caller). A "First
 * Win"-style achievement that's already unlocked will keep showing up
 * here on every future qualifying win; main.js only reports the ones
 * unlockAchievement() says are genuinely NEW.
 * @param {AchievementContext} context
 * @returns {string[]}
 */
export function evaluateAchievements(context) {
  const creditableWin = context.mode === "ai" && context.gameState.winner === context.humanPlayer;
  const qualifying = [];
  for (const achievement of ACHIEVEMENTS) {
    if (achievement.requiresCreditableWin && !creditableWin) continue;
    if (achievement.check(context)) qualifying.push(achievement.id);
  }
  return qualifying;
}
