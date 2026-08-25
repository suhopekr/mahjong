// core/audio.js
// Procedural sound effects via the Web Audio API — no audio files. That's
// not a stylistic choice: shipping .mp3/.wav assets would blow straight
// through the "0 runtime dependencies" and "<100KB build" hard constraints
// (CLAUDE.md section 2). An AudioContext + a few OscillatorNode/GainNode
// pairs synthesize each short tone on demand instead, so there is no
// asset at all.
//
// The `tone()` primitive and the iOS Safari unlock dance below are
// exactly the game-agnostic parts CLAUDE.md's core-reuse audit (section
// 3) found reusable as-is when this file was copied over from Dots and
// Boxes — they only know how to play a tone and unlock an AudioContext,
// never anything about any specific game's rules.
//
// The named effects at the bottom are NOT reusable as-is, though — the
// same audit flagged `playDrawSound()`("드로잉" a line)/`playCaptureSound()`
// (capturing a box) as D&B's own vocabulary: Gomoku has no "drawing a
// line" action and no "capture" concept at all (that only exists in a
// Renju-adjacent capture variant, not the freestyle rules this project
// uses — CLAUDE.md's milestone 1 notes). This file's own effect set is
// now Gomoku's: a stone-placement tick, a win fanfare, a lose phrase, and
// a neutral "draw" (tied game) cue — win/lose are literally unchanged
// from D&B (a "you won"/"you lost" stinger is exactly as game-agnostic as
// the tone() engine itself), only the naming and the two D&B-specific
// ones actually changed.
//
// The on/off PREFERENCE itself is persisted by core/storage.js, not by
// this file directly — storage.js is the one place localStorage gets
// touched anywhere in the app (its own module comment explains why: one
// key, one JSON blob, versioned, migration-friendly).

import { isSoundEnabled as loadSoundEnabled, setSoundEnabled as persistSoundEnabled } from "./storage.js";

let ctx = null;

// (The "[audio]" console.log diagnostics that used to live here — added
// for an iPhone "no sound" report — were removed in the QA pass once
// the report was closed; nothing shipped should write to the console on
// every stone placed.)

function getContext() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null; // unsupported browser — sound is best-effort
    // Construction itself can throw (some browsers cap the number of
    // live contexts per page; a few privacy modes refuse outright) —
    // sound is best-effort, so a failure here means "no sound," never
    // "no stone placed."
    try {
      ctx = new AudioCtx();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") {
    // resume() returns a promise that REJECTS (rather than resolving to
    // a still-suspended state) on some engines when called outside a
    // user gesture — left un-caught it's an unhandledrejection in the
    // console for every pre-gesture call, with no behavioral upside.
    try {
      ctx.resume().catch(() => {});
    } catch {
      // same best-effort reasoning as the constructor above
    }
  }
  return ctx;
}

// iOS Safari specifically requires the unlock attempt itself — creating
// the AudioContext, or resuming it — to happen SYNCHRONOUSLY inside a
// real user-gesture event handler; a page having had *some* earlier
// gesture isn't enough (unlike Chromium, which is more lenient). A
// game's very first sound can legitimately happen outside any gesture at
// all — the concrete incident this defense was built for was Dots and
// Boxes' vs-AI mode: if the AI won the coin flip, its opening move was
// scored by a setTimeout() chain (main.js's AI-turn replay) that never
// ran inside a click/tap handler, so the player might not have touched
// the canvas even once yet. Gomoku has no AI as of this milestone, so
// this exact trigger doesn't exist YET — but a future AI milestone's own
// opening-move/reply sound will hit the identical scenario the moment it
// exists, which is why this stays in place now rather than being cut as
// "unused." Without it, that whole game would be silent on iOS, and —
// because the FIRST AudioContext ever created on the page is the one
// that stays stuck "suspended" — every sound afterward too.
//
// Several things past just calling resume() (found after a real "no
// sound on iPhone" report on Dots and Boxes — the original one-shot
// resume()-only version couldn't be reproduced locally, per that
// project's own CLAUDE.md, and evidently wasn't enough; a follow-up pass
// — still couldn't reproduce locally — added the silent-buffer trick and
// made the listener permanent, which STILL wasn't enough per the same
// reporter):
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
  return next;
}

/** Whichever named effect is about to play checks this instead of
 * isSoundEnabled() directly.
 *
 * The Gomoku original had a second condition here: an in-memory
 * `portalMuted` flag that the portal-integration module set from the
 * host portal's own mute setting, kept deliberately separate from the
 * player's persisted preference so an external override could never be
 * mistaken for the player's own choice. There is no portal integration
 * in this build, so nothing could ever set that flag — it and its setter
 * are gone rather than left as an export nothing calls. The indirection
 * stays, because every effect below already routes through it and a
 * future second condition (a page-level pause, say) would land here. */
function shouldPlaySound() {
  return isSoundEnabled();
}

// --- named effects (Gomoku's own vocabulary — see this file's header
// comment for why these replace Dots and Boxes' draw/capture pair) -----

// --- stone placement: a wood-goban "click," not a single tone() -------
//
// Second sound-design pass on this one effect (the first pass's own
// 190/420/950Hz triad is gone — see below). Everything else in this
// file's synthesized effects is one oscillator (or a short melodic
// sequence of single oscillators, win/lose/draw below) via the shared
// tone() helper, or the mallet family further down — this one effect
// needs more control than either offers (a pitch glide per partial, a
// noise burst, per-call randomization), so it's built directly on the
// raw Web Audio nodes instead. tone() itself is untouched — win/lose/
// draw still use the mallet family exactly as before this pass.
//
// The first pass's own diagnosis (real listening, not assumed): its
// 190/420/950Hz triad sits close enough to a harmonic series
// (~1x/2.2x/5x) that the ear locks onto it as a PITCHED electronic tone
// rather than a percussive hit — thin and "synthy" instead of "wood."
// This pass replaces that triad with 4 NON-integer-ratio partials (see
// the partial-generation block below for why those specific ratios), all
// summed into one shared lowpass ("부드러움" — rolls off the harsh top
// end) then one shared master gain, matching the mental model "a wooden
// stone struck onto a wooden board": a resonant, inharmonic BODY (the 4
// partials — what actually reads as "wood" instead of "synth") and a
// brief surface CLICK (filtered noise — the actual moment of contact,
// now mixed in 2ms BEFORE the body rather than layered after it — real
// contact noise precedes the resonant ring). Every oscillator/noise
// source still gets its own 2ms linear gain ramp-up before its decay
// starts — the first pass's own "클릭 노이즈 방지용 최소 램프," carried
// over unchanged since a hard onset on ANY oscillator/buffer source
// still produces the identical audible tick regardless of what
// frequencies are involved. A 12% send to the mallet family's own
// shared reverb bus (added this pass — see getReverbBus() further down,
// defined once and reused by every melodic effect in this file) gives
// the stone a faint sense of landing IN the same room the win/lose/
// achievement sounds live in, kept low (well under the mallet family's
// own 15-20%) since this is the one effect that fires dozens of times a
// game and doesn't want to smear into a wash.

// A single reusable white-noise buffer, generated once per AudioContext
// (module-level cache, same "expensive thing computed once, reused every
// call" shape as game/render.js's own background-gradient cache) rather
// than re-filling a fresh Float32Array on every single stone placement —
// this project's own board can see many dozens of placements per game,
// and the buffer's own contents don't need to differ per call (layer 3's
// own per-call variation already comes from its 0-4ms random start delay
// and the shared pitch/gain randomization below, not from the noise
// itself being different each time).
let noiseBufferCache = null;
function getNoiseBuffer(audioCtx) {
  if (noiseBufferCache && noiseBufferCache.ctx === audioCtx) return noiseBufferCache.buffer;
  const length = Math.ceil(audioCtx.sampleRate * 0.05); // well past the 20ms this is ever actually played for
  const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseBufferCache = { ctx: audioCtx, buffer };
  return buffer;
}

/**
 * One oscillator layer with a linear attack, an optional short downward
 * pitch glide into its own target frequency, and an exponential decay —
 * layers 1 and 2 both use this shape, only their own frequency/gain/
 * decay/glide/filter differ.
 * @returns {number} the time (AudioContext seconds) this layer's own
 *   envelope reaches silence — used to know how long the shared master
 *   chain needs to stay connected.
 */
function playOscLayer(audioCtx, destination, { type, freq, glideFromRatio = null, glideMs = 0, peakGain, decay, startAt, attack = 0.002 }) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  if (glideFromRatio !== null) {
    osc.frequency.setValueAtTime(freq * glideFromRatio, startAt);
    osc.frequency.exponentialRampToValueAtTime(freq, startAt + glideMs);
  } else {
    osc.frequency.setValueAtTime(freq, startAt);
  }
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay);
  osc.connect(gain);
  gain.connect(destination);
  const endAt = startAt + attack + decay;
  osc.start(startAt);
  osc.stop(endAt + 0.01);
  // Explicit disconnect on top of stop() — stop()ping a node lets it be
  // garbage-collected once nothing references it, but this fires that
  // the moment playback ACTUALLY ends rather than leaving the graph
  // edges (osc->gain->destination) sitting around for the GC to notice
  // on its own schedule. Cheap, and exactly what a "confirm nothing
  // leaks after N rapid placements" check can actually observe.
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
  return endAt;
}

/**
 * A single stone landing on the board — this project's equivalent of
 * D&B's "draw a line" tick (same short/percussive/low-gain SHAPE — quiet,
 * frequent, per-move confirmation — even though the action it confirms
 * doesn't carry over). Fires on every placed stone, mouse or touch, so it
 * has to stay unobtrusive at 15x15's move count; the per-call
 * randomization below exists specifically so that unobtrusiveness
 * doesn't curdle into "the same tick, over and over" across a long game.
 * @param {boolean} [isAiMove] - a subtle, same-family difference (not a
 *   different sound) for the AI's own moves: main.js's commitMove()
 *   knows which player just moved and can pass this; existing call sites
 *   that don't pass anything get the human/default sound unchanged.
 */
export function playStoneSound(isAiMove = false) {
  if (!shouldPlaySound()) return;
  const audioCtx = getContext();
  if (!audioCtx) return;

  const startAt = audioCtx.currentTime;

  // "반복 회피 랜덤화" — widened this pass from 0.96~1.04 to 0.94~1.06
  // (the spec's own explicit ask). Still ONE shared pitch factor and ONE
  // shared gain factor per placement, not an independent draw per
  // partial — the 4 body partials + the noise layer are meant to read as
  // ONE struck object, and randomizing them independently risks several
  // unrelated small sounds that merely overlap rather than one coherent
  // "click" whose overall pitch/loudness just happens to vary call to
  // call (unchanged reasoning from the first pass). The noise layer
  // additionally gets its own small random extra delay on top of its
  // fixed -2ms head start (below) — it's the shortest layer, so a
  // perfectly fixed offset there would be the most noticeable repeat.
  const pitchFactor = 0.94 + Math.random() * 0.12;
  const gainFactor = 0.85 + Math.random() * 0.15;
  const noiseJitter = Math.random() * 0.003;

  // AI vs player (CLAUDE.md's own "선택이지만 권장," implemented and left
  // wired to a parameter rather than hardcoded true/false) — a subtly
  // lower/quieter voice in the SAME family, layered on top of (not
  // instead of) the per-call randomization above. Unchanged from the
  // first pass.
  const roleFreqScale = isAiMove ? 0.94 : 1;
  const roleGainScale = isAiMove ? 0.9 : 1;
  const freqScale = pitchFactor * roleFreqScale;
  const gainScale = gainFactor * roleGainScale;

  // Master chain: every source (4 body partials + the noise layer) feeds
  // this ONE lowpass — opened up this pass from 4500Hz to 5200Hz (the
  // spec's own "명쾌함 확보"; once the body itself is inharmonic, below,
  // the same amount of top end reads as clarity rather than harshness) —
  // then this ONE master gain, then a 12% send to the mallet family's
  // own shared reverb bus (getReverbBus(), defined further down this
  // file and reused as-is — no second reverb built). The send taps the
  // chain AFTER the master gain, matching makeMallet()'s own choice to
  // tap its wet send post-gain rather than pre-gain (see that function's
  // own header comment) — the wet signal is meant to be a quiet echo of
  // the ACTUAL output level, not of the unscaled raw partial sum.
  //
  // 0.1548 is this pass's own real gain-matching computation, NOT the
  // first pass's 0.17 used as-is. The 4 partials' own raw peaks
  // (0.5+0.28+0.16+0.08=1.02) plus the noise layer's own worst-case
  // overlap with them — the noise layer's OWN peak (0.18) happens
  // earlier and has already started decaying by the time the partials
  // reach THEIR shared peak 2ms in, but it's still contributing about
  // 0.078 at that instant — sum to a real simulated worst case of
  // 1.0983, not 1.02 alone (verified by simulating the actual
  // linear-attack + exponential-decay envelope math node-for-node, the
  // same technique used for the win-sound decay-time simulation).
  // 1.0983 × 0.1548 = 0.1700 — exactly playStoneSound()'s own established
  // peak ceiling at the loudest possible roll (gainFactor=1.0, a human
  // move); an AI move's own roleGainScale (0.9) keeps it further under
  // that, at ~0.153.
  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 5200;
  const master = audioCtx.createGain();
  master.gain.value = 0.1548 * gainScale;
  lowpass.connect(master);
  master.connect(audioCtx.destination);
  const wetSend = audioCtx.createGain();
  wetSend.gain.value = 0.12;
  master.connect(wetSend);
  wetSend.connect(getReverbBus(audioCtx));

  // The 4 body partials — NON-integer-multiple ratios of a 240Hz
  // fundamental (×2.83/×4.17/×6.44, not the first pass's ~×2.2/×5 near-
  // harmonic triad) — the actual fix for this pass's own diagnosis (see
  // this function's own header comment): these specific ratios come from
  // a real struck circular plate/membrane's own modal frequencies, which
  // is exactly why they DON'T line up on a harmonic series — no
  // combination of them suggests a single fundamental pitch to the ear,
  // which is what makes this read as a percussive HIT rather than a
  // pitched electronic tone. The other half of "struck, not rung": each
  // higher partial decays faster than the last (90/55/35/20ms) — a
  // sustained tone's partials decay together, a mallet strike's higher
  // partials die first. Reuses playOscLayer() (defined above, already
  // supports the pitch-glide-then-decay shape every partial here needs)
  // rather than a second near-duplicate helper — every partial glides
  // down from 1.35x its own target frequency over the first 22ms (the
  // spec's own "타격감": a hair sharp, snapping down into place, reads as
  // a mallet head actually striking and settling rather than a pure tone
  // starting cold — the first pass's own 1.06x/30ms glide was judged too
  // subtle to register as an actual strike).
  // The partials themselves are scheduled 2ms AFTER `startAt` (not the
  // noise burst 2ms BEFORE it, below) — mathematically the identical
  // relative timing, but this direction never asks Web Audio to schedule
  // anything earlier than `audioCtx.currentTime` itself. A negative-
  // relative-to-now start time isn't invalid (browsers clamp it to
  // "now," they don't throw — only a genuinely negative absolute time
  // does), but relying on that clamp would make the intended 2ms lead
  // shrink to ~0 in practice (there's essentially no real time between
  // reading `startAt` and this call), silently defeating the point of
  // scheduling it early at all. Delaying the partials instead achieves
  // the exact same "contact noise arrives first" relationship for real.
  const partialStartAt = startAt + 0.002;
  const f0 = 240 * freqScale;
  const p1End = playOscLayer(audioCtx, lowpass, { type: "sine", freq: f0 * 1.0, glideFromRatio: 1.35, glideMs: 0.022, peakGain: 0.5, decay: 0.09, startAt: partialStartAt });
  const p2End = playOscLayer(audioCtx, lowpass, { type: "sine", freq: f0 * 2.83, glideFromRatio: 1.35, glideMs: 0.022, peakGain: 0.28, decay: 0.055, startAt: partialStartAt });
  const p3End = playOscLayer(audioCtx, lowpass, { type: "sine", freq: f0 * 4.17, glideFromRatio: 1.35, glideMs: 0.022, peakGain: 0.16, decay: 0.035, startAt: partialStartAt });
  const p4End = playOscLayer(audioCtx, lowpass, { type: "sine", freq: f0 * 6.44, glideFromRatio: 1.35, glideMs: 0.022, peakGain: 0.08, decay: 0.02, startAt: partialStartAt });

  // Surface contact noise — widened and dropped this pass from
  // 2800Hz/Q1.2 (this pass's own diagnosis: that band is where a
  // "손톱 튕기는" fingernail-flick quality was coming from, the other
  // main source of the old hardness) to 1400Hz/Q0.8 — lower center,
  // wider bandwidth, reads as a duller/rounder contact instead of a
  // sharp flick. Anchored at the nominal `startAt` (2ms before the body
  // partials' own `partialStartAt` above — real contact noise precedes
  // the resonant ring, this pass's own explicit ask), plus the small
  // extra jitter computed above.
  let clickEnd = startAt;
  {
    const noiseStart = startAt + noiseJitter;
    const source = audioCtx.createBufferSource();
    source.buffer = getNoiseBuffer(audioCtx);
    const bandpass = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 1400 * freqScale;
    bandpass.Q.value = 0.8;
    const attack = 0.002;
    const decay = 0.018;
    gain.gain.setValueAtTime(0.0001, noiseStart);
    gain.gain.linearRampToValueAtTime(0.18, noiseStart + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, noiseStart + attack + decay);
    source.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(lowpass);
    clickEnd = noiseStart + attack + decay;
    source.start(noiseStart);
    source.stop(clickEnd + 0.01);
    source.onended = () => {
      source.disconnect();
      bandpass.disconnect();
      gain.disconnect();
    };
  }

  // The shared lowpass/master/wetSend chain outlives every individual
  // source's own onended (5 independent sources feed it, and
  // disconnecting after the FIRST one to finish would silence the ones
  // still playing) — plain setTimeout()'d to whichever source actually
  // finishes last, which is always partial 1's own 240Hz fundamental
  // (90ms decay, the longest of the five) in practice, but computed from
  // the real numbers above rather than hardcoded so this can't quietly
  // drift out of sync if any of those durations ever change. Total note
  // length from the moment this function is actually called (the 2ms
  // partial delay + 2ms attack + 90ms decay) is 94ms, comfortably under
  // the spec's own 140ms budget.
  const lastEnd = Math.max(p1End, p2End, p3End, p4End, clickEnd);
  const cleanupDelayMs = Math.max(0, (lastEnd - audioCtx.currentTime) * 1000) + 20;
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      lowpass.disconnect();
      master.disconnect();
      wetSend.disconnect();
    }, cleanupDelayMs);
  }
}

// --- full-effects-set redesign (mallet family) ------------------------
//
// Every named effect below EXCEPT playStoneSound() (which has its own
// separate, dedicated design further up this file — most recently
// revised in a later pass, see that function's own header comment) is
// rebuilt on ONE shared instrument voice — makeMallet() — plus a
// separate short noise-tick voice for buttons/undo. The old tone()-based
// win/lose/draw
// (triangle/sawtooth/sine single oscillators, carried over unchanged
// from Dots and Boxes per this file's own header) are replaced outright;
// tone() itself stays exactly as-is, still used by nothing now but kept
// since removing a working, documented, game-agnostic primitive isn't
// this pass's job.
//
// --- tonal palette: A major pentatonic, fixed --------------------------
// Every melodic note in this file draws from exactly these 8 pitches —
// no accidentals, no chromatic passing tones — so every effect,
// regardless of which one plays or in what order, is harmonically
// consistent with every other one (the same reasoning a real instrument
// family/palette serves: it's what makes a set of sounds read as "one
// game's voice" rather than several unrelated stingers).
const A3 = 220;
const B3 = 246.9;
const CS4 = 277.2;
const E4 = 329.6;
const FS4 = 370;
const A4 = 440;
const CS5 = 554.4;
const E5 = 659.3;

// --- shared reverb send (space) -----------------------------------------
//
// A short synthesized room, not a real IR recording (no audio ASSET —
// CLAUDE.md section 2's own "0 runtime dependencies / no shipped audio
// files" constraint applies exactly as much to a reverb impulse as to
// any other sound here). White noise shaped by an exponential decay
// envelope is the standard "algorithmic reverb" technique for exactly
// this reason: a ConvolverNode doesn't care whether its buffer came from
// a real room or was synthesized, only that it LOOKS like a decaying
// reflection pattern. 2 independently-seeded channels (not the same
// noise duplicated to both) is what actually gives the result stereo
// WIDTH — a mono IR panned to both channels doesn't decorrelate at all.
function createReverbImpulse(audioCtx) {
  const duration = 0.25;
  const length = Math.ceil(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(2, length, audioCtx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // exp(-6t): decays to e^-6 (~0.25%) of its starting amplitude by
      // the end of the buffer — audibly "gone" well before the hard cut.
      const decay = Math.exp(-6 * t);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  return buffer;
}

// Module-level cache, same "expensive thing built once, reused every
// call" shape as playStoneSound()'s own noiseBufferCache below — a
// ConvolverNode's buffer assignment does real up-front work (the SDK/
// browser effectively pre-computes the convolution kernel), so building
// this fresh per mallet note would be real, measurable, entirely
// avoidable overhead across a single win/lose/draw sequence's several
// notes, let alone a whole session's worth of achievement/hint sounds.
let reverbBusCache = null;
function getReverbBus(audioCtx) {
  if (reverbBusCache && reverbBusCache.ctx === audioCtx) return reverbBusCache.convolver;
  const convolver = audioCtx.createConvolver();
  convolver.buffer = createReverbImpulse(audioCtx);
  convolver.connect(audioCtx.destination);
  reverbBusCache = { ctx: audioCtx, convolver };
  return convolver;
}

// Fraction of a mallet note's own (dry) signal sent to the shared reverb
// bus — the spec's own "15~20%" range, its midpoint (a send-level ratio,
// not a second gain applied on top of the note's already-final peak —
// see makeMallet()'s own comment on why the note's OWN gain math doesn't
// need to account for this separately).
const MALLET_WET_RATIO = 0.175;

// A mallet note's 3 partials sum to this multiple of the fundamental's
// own gain at their shared attack peak (1 fundamental + 0.25 harmonic +
// 0.3 detune) — makeMallet() divides its own `peakGain` argument by this
// up front specifically so that argument means what every OTHER gain
// number in this file already means: the sound's actual, already-
// gain-matched, final output peak (exactly playStoneSound()'s own
// "0.17 is a real computation, not a raw per-layer value" precedent —
// see that function's own header comment).
const MALLET_PARTIAL_SUM = 1 + 0.25 + 0.3;

/**
 * The shared instrument voice behind every melodic effect in this file
 * (win/lose/draw/achievement/hint) — a sine fundamental, a sine
 * harmonic at 4x the fundamental (quiet, fast-decaying — the classic
 * "marimba" fingerprint: a bright, short overtone riding a longer, pure
 * fundamental), and a triangle detuned 0.3% sharp (a chorus-like
 * thickness, not a tuning error — 3 nearly-but-not-quite-unison voices
 * read as one richer note rather than three separate ones). A short
 * (3ms) linear attack on every partial prevents the audible "tick" a
 * hard onset on any oscillator produces (playStoneSound()'s own layers
 * use the identical technique). Feeds a shared per-note lowpass (5000Hz
 * by default — playLoseSound()'s own darker voice overrides this, see
 * that function) which splits into a dry path straight to `destination`
 * and a wet send through the shared reverb bus.
 * @param {AudioContext} audioCtx
 * @param {AudioNode} destination
 * @param {number} freq - fundamental frequency, Hz
 * @param {number} startTime - AudioContext seconds
 * @param {number} peakGain - the NOTE's own final output peak (already
 *   accounts for the 3 partials summing on top of each other — see
 *   MALLET_PARTIAL_SUM's own comment)
 * @param {number} decaySec - the fundamental/detune partials' own decay
 *   time; the harmonic partial always decays at 0.4x this (the spec's
 *   own ratio)
 * @param {{lowpassFreq?: number, wetRatio?: number}} [options]
 * @returns {number} the AudioContext time this note's own envelope
 *   reaches silence — callers use this to size their own cleanup delay,
 *   exactly like playOscLayer()'s own return value below.
 */
function makeMallet(audioCtx, destination, freq, startTime, peakGain, decaySec, { lowpassFreq = 5000, wetRatio = MALLET_WET_RATIO } = {}) {
  const attack = 0.003;
  const fundamentalPeak = peakGain / MALLET_PARTIAL_SUM;

  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = lowpassFreq;
  lowpass.connect(destination);
  const wetSend = audioCtx.createGain();
  wetSend.gain.value = wetRatio;
  lowpass.connect(wetSend);
  wetSend.connect(getReverbBus(audioCtx));

  function addPartial(type, partialFreq, gainMul, partialDecay) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = partialFreq;
    const peak = fundamentalPeak * gainMul;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + partialDecay);
    osc.connect(gain);
    gain.connect(lowpass);
    const endAt = startTime + attack + partialDecay;
    osc.start(startTime);
    osc.stop(endAt + 0.01);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    return endAt;
  }

  const fundamentalEnd = addPartial("sine", freq, 1, decaySec);
  const harmonicEnd = addPartial("sine", freq * 4.0, 0.25, decaySec * 0.4);
  const detuneEnd = addPartial("triangle", freq * 1.003, 0.3, decaySec);

  const lastEnd = Math.max(fundamentalEnd, harmonicEnd, detuneEnd);
  const cleanupMs = Math.max(0, (lastEnd - audioCtx.currentTime) * 1000) + 20;
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      lowpass.disconnect();
      wetSend.disconnect();
    }, cleanupMs);
  }
  return lastEnd;
}

/**
 * A short noise-burst UI tick — buttons, undo. Deliberately NOT a
 * mallet() call: this project's own spec draws a hard line between "an
 * instrument note" (melodic, reverberant, mallet family) and "a plain
 * confirmation click" (percussive, dry, noise-based) — playStoneSound()'s
 * own layer 3 already established the same noise+bandpass shape for
 * exactly this kind of short surface-contact sound, reused here rather
 * than invented a second way to make a click. No reverb send ("잔향
 * 없음") — a UI tick is meant to feel immediate/dry, the opposite of the
 * mallet family's own sense of space. `centerFreq`'s own small per-call
 * randomization (the spec's own ×0.95~1.05) exists for the identical
 * reason playStoneSound()'s own randomization does: a sound this short
 * and this frequent (every click) reads as a broken loop if it's ever
 * bit-for-bit identical twice in a row.
 * @param {number} centerFreq
 * @param {number} gain
 */
function playUiTick(centerFreq, gain) {
  if (!shouldPlaySound()) return;
  const audioCtx = getContext();
  if (!audioCtx) return;

  const startAt = audioCtx.currentTime;
  const freqScale = 0.95 + Math.random() * 0.1;
  const attack = 0.001;
  const duration = 0.008;

  const source = audioCtx.createBufferSource();
  source.buffer = getNoiseBuffer(audioCtx); // shared with playStoneSound()'s own layer 3 — see that cache's own comment
  const bandpass = audioCtx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = centerFreq * freqScale;
  bandpass.Q.value = 1.5;
  const gainNode = audioCtx.createGain();
  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.linearRampToValueAtTime(gain, startAt + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  source.connect(bandpass);
  bandpass.connect(gainNode);
  gainNode.connect(audioCtx.destination); // dry — no reverb send, see this function's own header
  source.start(startAt);
  source.stop(startAt + duration + 0.01);
  source.onended = () => {
    source.disconnect();
    bandpass.disconnect();
    gainNode.disconnect();
  };
}

/**
 * @param {boolean} [isDaily] - the Daily Challenge's own longer flourish
 *   (an extra note past the base 3-note arpeggio) — main.js's own
 *   caller's game-mode flag isn't threaded through to this call (this
 *   pass is scoped to core/audio.js only), so every EXISTING call site
 *   gets the base sound unchanged until a future pass wires it up, the
 *   same disclosed-but-unwired shape playStoneSound()'s own isAiMove
 *   parameter had before its own follow-up pass connected it.
 */
export function playWinSound(isDaily = false) {
  if (!shouldPlaySound()) return;
  const audioCtx = getContext();
  if (!audioCtx) return;

  const startAt = audioCtx.currentTime;
  const destination = audioCtx.destination;
  // "조용한 성취" (a quiet achievement, not a fanfare): a rising 3-note
  // arpeggio through the pentatonic palette. The first two notes' own
  // 0.15s decay (not spec-given directly — chosen and verified by
  // simulating the summed envelope, see this pass's own CLAUDE.md
  // section) keeps their tails from stacking on top of the 3rd note's
  // own attack; the 3rd note is the ONE place in this whole redesign
  // allowed to reach playStoneSound()'s own peak (0.17) — CLAUDE.md's
  // own "게인 스테이징" rule.
  makeMallet(audioCtx, destination, A3, startAt, 0.14, 0.15);
  makeMallet(audioCtx, destination, E4, startAt + 0.14, 0.15, 0.15);
  makeMallet(audioCtx, destination, A4, startAt + 0.3, 0.17, 0.9);
  if (isDaily) {
    makeMallet(audioCtx, destination, CS5, startAt + 0.46, 0.1, 1.1);
  }
}

export function playLoseSound() {
  if (!shouldPlaySound()) return;
  const audioCtx = getContext();
  if (!audioCtx) return;

  const startAt = audioCtx.currentTime;
  const destination = audioCtx.destination;
  // A short falling 2-note phrase — darker than every other mallet
  // sound in this file (3200Hz lowpass override vs. the 5000Hz default,
  // the spec's own explicit ask), never a "trombone" stinger.
  const options = { lowpassFreq: 3200 };
  makeMallet(audioCtx, destination, E4, startAt, 0.12, 0.5, options);
  makeMallet(audioCtx, destination, CS4, startAt + 0.18, 0.11, 0.5, options);
}

/**
 * The board filled up with no winner (game/board.js's `winner === "draw"`).
 * Deliberately flat where playWinSound() rises and playLoseSound() falls
 * — the SAME note twice — so it reads immediately as "ended, but neither
 * up nor down" even to a player who's never heard the other two.
 */
export function playDrawGameSound() {
  if (!shouldPlaySound()) return;
  const audioCtx = getContext();
  if (!audioCtx) return;

  const startAt = audioCtx.currentTime;
  const destination = audioCtx.destination;
  makeMallet(audioCtx, destination, E4, startAt, 0.12, 0.35);
  makeMallet(audioCtx, destination, E4, startAt + 0.16, 0.12, 0.35);
}

/** A new achievement unlocked (game/achievements.js's own evaluation,
 * main.js's own toast). Not yet wired to that toast's own call site —
 * this pass is scoped to core/audio.js only (same disclosed-but-unwired
 * shape as playWinSound()'s own isDaily parameter above). */
export function playAchievementSound() {
  if (!shouldPlaySound()) return;
  const audioCtx = getContext();
  if (!audioCtx) return;

  const startAt = audioCtx.currentTime;
  const destination = audioCtx.destination;
  makeMallet(audioCtx, destination, A4, startAt, 0.09, 0.4);
  makeMallet(audioCtx, destination, E5, startAt + 0.11, 0.11, 0.7);
}

/** A hint marker being shown (game/hint.js's own suggestion, main.js's
 * own showHint()). Not yet wired — same disclosed-but-unwired shape as
 * the rest of this pass's new exports. Quieter reverb send (10%, vs. the
 * mallet family's own 15-20% default) — a hint is a small nudge, not
 * something that should feel like it's happening in the same "room" as
 * a win/lose/achievement moment. */
export function playHintSound() {
  if (!shouldPlaySound()) return;
  const audioCtx = getContext();
  if (!audioCtx) return;

  makeMallet(audioCtx, audioCtx.destination, CS5, audioCtx.currentTime, 0.08, 0.3, { wetRatio: 0.1 });
}

/** A generic UI button press. Not yet wired to any specific button's
 * click handler — same disclosed-but-unwired shape as this pass's other
 * new exports. */
export function playButtonSound() {
  playUiTick(3200, 0.05);
}

/** Undo. Same tick family as playButtonSound(), a lower center frequency
 * (2200Hz, the spec's own explicit ask) its only difference — not yet
 * wired to the Undo button's own click handler. */
export function playUndoSound() {
  playUiTick(2200, 0.05);
}
