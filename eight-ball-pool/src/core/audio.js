// core/audio.js
// Procedural sound via the Web Audio API — no audio files, no build step.
// The tone() engine and the iOS unlock dance are solitaire/src/core/
// audio.js's (which in turn took them from five-in-a-row); only the named
// effects at the bottom are this game's.
//
// A pool table's vocabulary is PHYSICS rather than button presses, so the
// three effects that fire during a shot take the impact's strength (0..1)
// and map it to gain, pitch and length together. A grazing kiss and a
// full-blooded smash playing the identical sample is the fastest way to
// make a physics game feel fake.

let ctx = null;
let enabled = true;

export function setSoundEnabled(on) { enabled = !!on; }
export function isSoundEnabled() { return enabled; }

function getContext() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try { ctx = new AudioCtx(); } catch { return null; }
  }
  if (ctx.state === "suspended") {
    try { ctx.resume().catch(() => {}); } catch { /* best-effort */ }
  }
  return ctx;
}

function unlockAudioContext() {
  const c = getContext();
  if (!c || c.state === "running") return;
  try {
    const buffer = c.createBuffer(1, 1, 22050);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(c.destination);
    source.start(0);
  } catch { /* best-effort */ }
}
if (typeof document !== "undefined") {
  for (const evt of ["pointerdown", "touchstart", "keydown"]) {
    document.addEventListener(evt, unlockAudioContext, { passive: true });
  }
}

function tone({ freq, duration = 0.08, type = "sine", gain = 0.12, delay = 0, slideTo = null }) {
  if (!enabled) return;
  const c = getContext();
  if (!c) return;
  try {
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  } catch { /* best-effort */ }
}

/** A burst of filtered noise — the body of every impact on a pool table.
 * Two phenolic balls meeting is a click with almost no pitch to it; a
 * cushion is the same click with the top taken off. */
function noise({ duration = 0.05, gain = 0.1, cutoff = 3000, q = 1, delay = 0, type = "bandpass" }) {
  if (!enabled) return;
  const c = getContext();
  if (!c) return;
  try {
    const t0 = c.currentTime + delay;
    const frames = Math.max(1, Math.floor(c.sampleRate * duration));
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(cutoff, t0);
    filt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filt).connect(g).connect(c.destination);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  } catch { /* best-effort */ }
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Cue tip on the cue ball: a soft leathery knock that hardens with power. */
export function playStroke(power = 0.5) {
  const s = clamp01(power);
  noise({ duration: 0.05 + 0.02 * s, gain: 0.05 + 0.09 * s, cutoff: 700 + 900 * s, q: 0.8 });
  tone({ freq: 150 + 60 * s, duration: 0.07, type: "sine", gain: 0.04 + 0.05 * s, slideTo: 90 });
}

/** Ball on ball. `strength` is 0..1 from the collision's own closing speed. */
export function playClick(strength = 0.5) {
  const s = clamp01(strength);
  noise({ duration: 0.028 + 0.02 * s, gain: 0.05 + 0.16 * s, cutoff: 2600 + 3200 * s, q: 1.1 });
  tone({ freq: 1500 + 900 * s, duration: 0.035, type: "sine", gain: 0.03 + 0.06 * s, slideTo: 900 });
}

/** Ball on cushion: the same knock with the top rolled off. */
export function playCushion(strength = 0.5) {
  const s = clamp01(strength);
  noise({ duration: 0.05 + 0.03 * s, gain: 0.04 + 0.1 * s, cutoff: 500 + 700 * s, q: 0.7, type: "lowpass" });
  tone({ freq: 210 + 90 * s, duration: 0.06, type: "sine", gain: 0.03 + 0.04 * s, slideTo: 130 });
}

/** A ball dropping into a pocket: the drop, then the rattle in the net. */
export function playPocket() {
  tone({ freq: 320, duration: 0.1, type: "sine", gain: 0.09, slideTo: 140 });
  noise({ duration: 0.16, gain: 0.07, cutoff: 900, q: 0.6, delay: 0.06, type: "lowpass" });
}

/** A tap that could not do anything. */
export function playNope() { tone({ freq: 180, duration: 0.12, type: "square", gain: 0.05, slideTo: 140 }); }
/** The cue ball set down for ball in hand. */
export function playPlace() { tone({ freq: 520, duration: 0.06, type: "triangle", gain: 0.08 }); }
/** Undo. */
export function playUndo() { tone({ freq: 500, duration: 0.07, type: "sine", gain: 0.07, slideTo: 380 }); }
/** The game is won. */
export function playWin() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => tone({ freq: f, duration: 0.22, type: "triangle", gain: 0.11, delay: i * 0.13 }));
  tone({ freq: 1319, duration: 0.5, type: "sine", gain: 0.08, delay: 0.55 });
}
/** The game is lost — warm, not a buzzer. */
export function playLose() {
  const notes = [523, 440, 349];
  notes.forEach((f, i) => tone({ freq: f, duration: 0.26, type: "triangle", gain: 0.09, delay: i * 0.16 }));
}
