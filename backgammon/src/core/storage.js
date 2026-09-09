// core/storage.js
// localStorage persistence for Backgammon — the only file that touches it.
//
// One key per concern, namespaced and versioned like the rest of the site
// (solitaire.v1.*, fiveInARow.v1.*): a corrupt save can never cost the
// player their settings or their win count.
//
//   backgammon.v1.save      the game on the board (whose turn, the dice
//                           still to play, the moves made this turn)
//   backgammon.v1.settings  pace / who starts / colours / pips / sound
//   backgammon.v1.stats     games played, won, won by a lot, streaks

import { isValidState, DIFFICULTIES, FIRST } from "../game/backgammon.js";

const KEY_PREFIX = "backgammon.v1";
const KEYS = {
  save: `${KEY_PREFIX}.save`,
  settings: `${KEY_PREFIX}.settings`,
  stats: `${KEY_PREFIX}.stats`,
};

export const COLOURS = ["burgundy", "navy", "black"];
export const DEFAULT_SETTINGS = Object.freeze({ pace: "relaxed", first: "random", colours: "burgundy", pips: false, sound: true });
export const DEFAULT_STATS = Object.freeze({ played: 0, won: 0, big: 0, streak: 0, best: 0 });

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private mode / quota — the game plays on without saving
  }
}

export function loadSettings() {
  const s = read(KEYS.settings) || {};
  return {
    pace: DIFFICULTIES.includes(s.pace) ? s.pace : DEFAULT_SETTINGS.pace,
    first: FIRST.includes(s.first) ? s.first : DEFAULT_SETTINGS.first,
    colours: COLOURS.includes(s.colours) ? s.colours : DEFAULT_SETTINGS.colours,
    pips: s.pips === true,
    sound: s.sound !== false,
  };
}
export function saveSettings(settings) { return write(KEYS.settings, settings); }

export function loadStats() {
  const s = read(KEYS.stats) || {};
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return { played: n(s.played), won: n(s.won), big: n(s.big), streak: n(s.streak), best: n(s.best) };
}
export function saveStats(stats) { return write(KEYS.stats, stats); }

/** The game in progress, or null when there is none or it does not add up. */
export function loadGame() {
  const g = read(KEYS.save);
  if (!g || !isValidState(g.state)) return null;
  return { state: g.state };
}
export function saveGame(state) {
  return write(KEYS.save, { state });
}
export function clearGame() { return write(KEYS.save, null); }
