// core/audio.js
// Procedural sound effects via the Web Audio API — no audio files. That's
// not a stylistic choice: shipping .mp3/.wav assets would blow straight
// through the "0 runtime dependencies" and "<100KB build" hard constraints
// (CLAUDE.md section 2). An AudioContext + a few OscillatorNode/GainNode
// pairs synthesize each short tone on demand instead, so there is no
// asset at all.
//
// Game-agnostic and reusable as-is for the next game in the series
// (CLAUDE.md's stated reuse goal) — it only knows how to play tones and
// remember an on/off preference, never anything about Dots and Boxes.
// The specific effect names at the bottom (draw/capture/win/lose) are
// this game's vocabulary; a future game would add its own small set of
// named wrappers around the same `tone()` primitive.
//
// The on/off PREFERENCE itself is persisted by core/storage.js, not by
// this file directly — storage.js is the one place localStorage gets
// touched anywhere in the app (its own module comment explains why: one
// key, one JSON blob, versioned, migration-friendly). This file used to
// manage its own separate "dab-sound-enabled" key; storage.js migrates
// that legacy key forward automatically the first time it loads, so an
// existing player's preference survives the switch.

import { isSoundEnabled as loadSoundEnabled, setSoundEnabled as persistSoundEnabled } from "./storage.js";

let ctx = null;

// Temporary diagnostic instrumentation (real "no sound on iPhone" report,
// not reproducible locally — no iOS device available). Intended to be
// read via Safari's remote Web Inspector (Mac: Safari > Develop > [the
// iPhone] > this page) while reproducing on the actual device, since
// that's the only way to see what `ctx.state` really does there. Safe to
// remove once the report is confirmed resolved — every call site here is
// tagged "[audio]" specifically so it's easy to grep back out.
function logAudioState(label) {
  console.log(`[audio] ${label}: ${ctx ? ctx.state : "(no context yet)"}`);
}

function getContext() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null; // unsupported browser — sound is best-effort
    ctx = new AudioCtx();
    logAudioState("created");
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

// iOS Safari specifically requires the unlock attempt itself — creating
// the AudioContext, or resuming it — to happen SYNCHRONOUSLY inside a
// real user-gesture event handler; a page having had *some* earlier
// gesture isn't enough (unlike Chromium, which is more lenient). This
// game's very first sound can legitimately happen outside any gesture at
// all: in vs-AI mode, if the AI wins the coin flip, its opening move is
// scored by a setTimeout() chain (main.js's AI-turn replay) that never
// runs inside a click/tap handler — the player may not have touched the
// canvas even once yet. Without this, that whole game would be silent on
// iOS, and — because the FIRST AudioContext ever created on the page is
// the one that stays stuck "suspended" — every sound afterward too.
//
// Several things past just calling resume() (found after a real "no
// sound on iPhone" report — the original one-shot resume()-only version
// couldn't be reproduced locally, per CLAUDE.md, and evidently wasn't
// enough; a follow-up pass — still couldn't reproduce locally — added the
// silent-buffer trick and made the listener permanent, which STILL wasn't
// enough per the same reporter):
//
// 1. `ctx.resume()` alone isn't always sufficient on WebKit — the more
//    battle-tested trick (the same one Howler.js and other audio
//    libraries use) is to synchronously START a real, even silent,
//    buffer source node inside the gesture. Some iOS/WebKit versions
//    only truly unlock the hardware audio session once something has
//    actually *played*, not merely once `ctx.state` reads "running".
// 2. Listen at the `document` level (not just `window` — both should
//    receive a bubbled event identically, but `document` is what was
//    explicitly asked for while chasing this) for THREE gesture kinds,
//    not just `pointerdown`: also `touchstart` and `keydown`. iOS Safari
//    is documented as wanting the unlock attempt to be part of a
//    "trusted" input event's own call stack — covering all three is
//    strictly safer than assuming Pointer Events alone are always
//    enough to count, even though this game's own board input already
//    relies on them (core/input.js) without issue.
// 3. Early-exit if the context is already "running" — nothing to do, and
//    avoids constructing a throwaway buffer/source node on every single
//    tap for the entire rest of the session.
// 4. **Deliberately NOT detached after a successful unlock, even though
//    that's the more obviously-efficient option** — iOS re-suspends an
//    AudioContext fairly aggressively (backgrounding the tab: switching
//    apps, locking the screen, a phone call). Every sound after a
//    re-suspension (AI-turn replays, game-over stingers) fires from a
//    setTimeout(), never inside a fresh gesture, so a resume() attempted
//    there is silently ignored by WebKit — detaching here would
//    reintroduce exactly that bug the moment the context is re-suspended
//    later in the same session. The early-exit in (3) already makes
//    leaving these listeners attached forever effectively free.
function unlockAudioContext() {
  const c = getContext();
  if (!c) return;
  if (c.state === "running") return;
  try {
    const buffer = c.createBuffer(1, 1, 22050);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(c.destination);
    source.start(0);
  } catch {
    // best-effort — resume() above (inside getContext()) already ran either way
  }
  logAudioState("after unlock attempt");
}
if (typeof document !== "undefined") {
  for (const evt of ["pointerdown", "touchstart", "keydown"]) {
    document.addEventListener(evt, unlockAudioContext, { passive: true });
  }
}

/**
 * Play one short synthesized tone.
 * @param {number} freq - Hz
 * @param {number} duration - seconds
 * @param {{type?: OscillatorType, gain?: number, delay?: number}} [opts]
 */
function tone(freq, duration, { type = "sine", gain = 0.2, delay = 0 } = {}) {
  const audioCtx = getContext();
  if (!audioCtx) return;
  logAudioState("about to play a tone");

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  const startAt = audioCtx.currentTime + delay;
  // Exponential decay reads as a natural "pluck" rather than an abrupt
  // cutoff; exponentialRamp can't target exactly 0, hence 0.001.
  gainNode.gain.setValueAtTime(gain, startAt);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);
}

/**
 * Exported so main.js's sound-toggle click handler can call this
 * explicitly too — belt-and-suspenders alongside the document-level
 * gesture listener above. Tapping the toggle is an unambiguous user
 * gesture in its own right; there's no reason to rely solely on
 * whichever gesture happened to fire first on the page.
 */
export function unlockAudio() {
  unlockAudioContext();
}

// --- on/off preference ---------------------------------------------
//
// Thin pass-through to storage.js — kept as this file's own public API
// (rather than having main.js import these straight from storage.js)
// because "is sound on" is really a question about the audio system,
// and every call site elsewhere in the app already asks it here.

export function isSoundEnabled() {
  return loadSoundEnabled();
}

export function setSoundEnabled(value) {
  persistSoundEnabled(value);
}

export function toggleSound() {
  const next = !loadSoundEnabled();
  persistSoundEnabled(next);
  logAudioState("after sound toggle");
  return next;
}

// --- named effects (CLAUDE.md section 5: 4 short tones) -------------

export function playDrawSound() {
  if (!isSoundEnabled()) return;
  tone(420, 0.08, { type: "triangle", gain: 0.12 });
}

export function playCaptureSound() {
  if (!isSoundEnabled()) return;
  tone(660, 0.12, { type: "square", gain: 0.15 });
}

export function playWinSound() {
  if (!isSoundEnabled()) return;
  // A short rising major arpeggio (C5-E5-G5-C6).
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
    tone(freq, 0.18, { type: "triangle", gain: 0.15, delay: i * 0.09 })
  );
}

export function playLoseSound() {
  if (!isSoundEnabled()) return;
  // A short falling minor phrase (G4-E4-C4).
  [392, 329.63, 261.63].forEach((freq, i) =>
    tone(freq, 0.22, { type: "sawtooth", gain: 0.12, delay: i * 0.11 })
  );
}
