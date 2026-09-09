// core/storage.js
// Single-key, versioned persistence: sound preference, AI level and the
// recent match results that move it, and lifetime match stats.
//
// The ARCHITECTURE — one storage key holding one JSON blob, a versioned
// schema, a sanitize() that defends every field independently, and a
// three-tier backing store (CrazyGames SDK Data -> localStorage ->
// in-memory) — is inherited from the series (Dots and Boxes → Gomoku →
// StoneFlick → Four Ball). The schema is written from scratch, because
// the series' own audit note keeps being right: a storage module always
// LOOKS game-neutral and never is.
//
// Nothing here may throw. On any failure the game runs off the in-memory
// copy and the only thing lost is durability across a reload.

const STORAGE_KEY = "shuffleboard-save";
const SCHEMA_VERSION = 2;

// Duplicated from game/ai.js's LEVELS on purpose: this module owns its
// persisted shape and must not import game logic. test/storage.test.js
// asserts the two lists agree — that is the whole price of the split.
const AI_LEVELS = ["easy", "medium", "hard"];
const DEFAULT_AI_LEVEL = "easy";

/** How many recent match results are kept for promotion decisions. */
const RECENT_KEEP = 5;

// The campaign's own shape, duplicated from game/stages.js for the same
// reason as AI_LEVELS: storage owns its persisted shape and must not
// import game logic. test/storage.test.js asserts the numbers agree.
const MAX_STAGE_ID = 24;
const CHAPTER_IDS = [1, 2, 3];

// The one-line cards the game shows once each. Whitelisted structurally
// so a tampered save can only mark cards the game actually has.
const BRIEFING_IDS = ["first-shot", "first-drag", "first-score", "first-foul", "first-hanger", "first-knock"];

// --- SDK Data module bootstrap ------------------------------------------
async function initSdkData() {
  try {
    if (typeof window === "undefined" || !window.CrazyGames?.SDK?.data) return false;
    const sdk = window.CrazyGames.SDK;
    await sdk.init();
    return sdk.environment !== "disabled";
  } catch {
    return false;
  }
}

let sdkReadyPromise = initSdkData();
let sdkAvailable = false;

function sdkGetItem(key) {
  try {
    return window.CrazyGames.SDK.data.getItem(key);
  } catch {
    return null;
  }
}

function sdkSetItem(key, value) {
  try {
    window.CrazyGames.SDK.data.setItem(key, value);
  } catch {
    // Fire-and-forget: localStorage already has this same write.
  }
}

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota / private mode / storage disabled: in-memory copy carries on.
  }
}

// --- schema -------------------------------------------------------------

function defaultState() {
  return {
    version: SCHEMA_VERSION,
    sound: { enabled: true },
    ai: { level: DEFAULT_AI_LEVEL, recent: [] },
    stats: { matches: 0, wins: 0, bestMargin: 0, hangers: 0 },
    campaign: { stars: {}, current: 1, bosses: [] },
    previews: { held: 0 },
    briefings: { seen: [] },
  };
}

function isStageId(v) {
  return Number.isInteger(v) && v >= 1 && v <= MAX_STAGE_ID;
}

function sanitizeCampaign(entry) {
  const stars = {};
  if (entry?.stars && typeof entry.stars === "object") {
    for (const [key, value] of Object.entries(entry.stars)) {
      const id = Number(key);
      // 1..3 hard range: stars render as glyphs and a tampered 99 would
      // draw 99 of them.
      if (isStageId(id) && Number.isInteger(value) && value >= 1 && value <= 3) stars[id] = value;
    }
  }
  return {
    stars,
    current: isStageId(entry?.current) ? entry.current : 1,
    bosses: Array.isArray(entry?.bosses)
      ? CHAPTER_IDS.filter((c) => entry.bosses.includes(c))
      : [],
  };
}

function sanitize(parsed) {
  const recent = Array.isArray(parsed.ai?.recent)
    ? parsed.ai.recent.filter((r) => r === "W" || r === "L").slice(-RECENT_KEEP)
    : [];
  const stat = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const stats = {
    matches: stat(parsed.stats?.matches),
    wins: stat(parsed.stats?.wins),
    bestMargin: stat(parsed.stats?.bestMargin),
    hangers: stat(parsed.stats?.hangers),
  };
  // wins can never exceed matches; a save claiming otherwise is corrupt
  // and the safer reading is the smaller one.
  if (stats.wins > stats.matches) stats.wins = stats.matches;
  return {
    version: SCHEMA_VERSION,
    sound: { enabled: typeof parsed.sound?.enabled === "boolean" ? parsed.sound.enabled : true },
    ai: {
      level: AI_LEVELS.includes(parsed.ai?.level) ? parsed.ai.level : DEFAULT_AI_LEVEL,
      recent,
    },
    stats,
    campaign: sanitizeCampaign(parsed.campaign),
    // A shot preview the player is holding. PAID FOR with a rewarded ad,
    // so it must survive a reload like a cleared stage does. Capped at 1:
    // the offer only appears when none is held, so the cap is what makes
    // a hand-edited save stay honest.
    previews: {
      held: Number.isInteger(parsed.previews?.held) ? Math.max(0, Math.min(1, parsed.previews.held)) : 0,
    },
    briefings: {
      seen: Array.isArray(parsed.briefings?.seen)
        ? BRIEFING_IDS.filter((id) => parsed.briefings.seen.includes(id))
        : [],
    },
  };
}

function migrate(parsed) {
  let current = parsed;
  if (current.version === undefined) current = { ...current, version: 1 };
  // v1 -> v2: the campaign was added. No field moved; sanitize() gives
  // an absent campaign its defaults, so the step is the version stamp.
  if (current.version === 1) current = { ...current, version: 2 };
  return current.version === SCHEMA_VERSION ? current : null;
}

function parseAndNormalize(raw) {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (parsed.version === SCHEMA_VERSION) return sanitize(parsed);
    const migrated = migrate(parsed);
    return migrated ? sanitize(migrated) : null;
  } catch {
    return null;
  }
}

function load() {
  const normalized = parseAndNormalize(safeGetItem(STORAGE_KEY));
  if (normalized) return normalized;
  const fresh = defaultState();
  safeSetItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

let state = load();

/** Resolves once SDK detection and the one-time reconciliation are done —
 * `state` is final for the session. The first screen re-renders on this:
 * inside the portal's cross-origin iframe, localStorage can legitimately
 * be empty or partitioned away. Never rejects. */
export const storageSynced = sdkReadyPromise.then((ready) => {
  sdkAvailable = ready;
  if (ready) reconcileWithSdk();
});

function reconcileWithSdk() {
  const fromSdk = parseAndNormalize(sdkGetItem(STORAGE_KEY));
  if (fromSdk) {
    state = fromSdk;
    safeSetItem(STORAGE_KEY, JSON.stringify(state));
    return;
  }
  sdkSetItem(STORAGE_KEY, JSON.stringify(state));
}

function save() {
  const json = JSON.stringify(state);
  safeSetItem(STORAGE_KEY, json);
  if (sdkAvailable) sdkSetItem(STORAGE_KEY, json);
}

export function reloadFromStorage() {
  state = load();
}

/** Test-only; see the identical hook in the previous games. */
export async function reinitSdkForTesting() {
  sdkReadyPromise = initSdkData();
  sdkAvailable = await sdkReadyPromise;
  if (sdkAvailable) reconcileWithSdk();
  return sdkAvailable;
}

// --- sound ---------------------------------------------------------------

export function isSoundEnabled() {
  return state.sound.enabled;
}

export function setSoundEnabled(value) {
  state.sound.enabled = value === true;
  save();
}

export function toggleSound() {
  setSoundEnabled(!state.sound.enabled);
  return state.sound.enabled;
}

// --- AI level -------------------------------------------------------------

export function getAiLevel() {
  return state.ai.level;
}

/** main.js computes the next level with game/ai.js's own rule and stores
 * it here; storage never decides. */
export function setAiLevel(level) {
  if (AI_LEVELS.includes(level)) {
    state.ai.level = level;
    save();
  }
}

export function getRecentResults() {
  return [...state.ai.recent];
}

// --- match stats ----------------------------------------------------------

/** Record a finished match. @param {"W"|"L"} result */
export function recordMatch(result, margin = 0) {
  if (result !== "W" && result !== "L") return;
  state.ai.recent = [...state.ai.recent, result].slice(-RECENT_KEEP);
  state.stats.matches++;
  if (result === "W") {
    state.stats.wins++;
    if (Number.isInteger(margin) && margin > state.stats.bestMargin) state.stats.bestMargin = margin;
  }
  save();
}

export function recordHanger() {
  state.stats.hangers++;
  save();
}

export function getStats() {
  return { ...state.stats };
}

// --- campaign --------------------------------------------------------------

export function getStageStars(id) {
  return state.campaign.stars[id] ?? 0;
}

/** Best-ever stars only — replaying for fewer never regresses. Clearing
 * the current stage advances the continue point. */
export function recordStageClear(id, stars) {
  if (!isStageId(id) || !Number.isInteger(stars) || stars < 1 || stars > 3) return;
  if (stars > getStageStars(id)) state.campaign.stars[id] = stars;
  if (id === state.campaign.current) {
    state.campaign.current = Math.min(MAX_STAGE_ID, id + 1);
  }
  save();
}

export function getCurrentStageId() {
  return state.campaign.current;
}

export function setCurrentStageId(id) {
  if (isStageId(id)) {
    state.campaign.current = id;
    save();
  }
}

export function isBossBeaten(chapter) {
  return state.campaign.bosses.includes(chapter);
}

export function recordBossBeaten(chapter) {
  if (CHAPTER_IDS.includes(chapter) && !state.campaign.bosses.includes(chapter)) {
    state.campaign.bosses = CHAPTER_IDS.filter(
      (c) => state.campaign.bosses.includes(c) || c === chapter
    );
    save();
  }
}

// --- shot previews ---------------------------------------------------------

export function getPreviewsHeld() {
  return state.previews.held;
}

export function setPreviewsHeld(n) {
  state.previews.held = Math.max(0, Math.min(1, Number.isInteger(n) ? n : 0));
  save();
}

// --- one-time cards -------------------------------------------------------

export function hasSeenBriefing(id) {
  return state.briefings.seen.includes(id);
}

export function markBriefingSeen(id) {
  if (!BRIEFING_IDS.includes(id) || state.briefings.seen.includes(id)) return;
  state.briefings.seen = BRIEFING_IDS.filter(
    (known) => state.briefings.seen.includes(known) || known === id
  );
  save();
}

export { AI_LEVELS, BRIEFING_IDS, RECENT_KEEP, MAX_STAGE_ID, CHAPTER_IDS };
