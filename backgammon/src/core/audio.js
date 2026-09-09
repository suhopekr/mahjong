// core/audio.js
// Procedural sounds via the Web Audio API — no audio files. The tone()
// engine and the iOS unlock dance are solitaire's (see five-in-a-row/src/
// core/audio.js for why every part of the unlock exists); only the named
// effects at the bottom are this game's.

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
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  } catch { /* best-effort */ }
}

/** A checker set down on a point: a short wooden tap. */
export function playPlace() { tone({ freq: 480, duration: 0.06, type: "triangle", gain: 0.09 }); }
/** The computer's checker landing: the same tap, a touch lower. */
export function playPlaceSoft() { tone({ freq: 380, duration: 0.06, type: "triangle", gain: 0.07 }); }
/** Dice rattling in the cup and landing. */
export function playRoll() {
  tone({ freq: 260, duration: 0.05, type: "square", gain: 0.04, slideTo: 180 });
  tone({ freq: 320, duration: 0.05, type: "square", gain: 0.04, delay: 0.06, slideTo: 200 });
  tone({ freq: 540, duration: 0.07, type: "triangle", gain: 0.08, delay: 0.14 });
}
/** A checker sent to the bar. */
export function playHit() { tone({ freq: 620, duration: 0.09, type: "sine", gain: 0.09, slideTo: 300 }); }
/** A checker borne off: a brighter tap, a fifth higher. */
export function playOff() {
  tone({ freq: 660, duration: 0.07, type: "triangle", gain: 0.1 });
  tone({ freq: 990, duration: 0.09, type: "sine", gain: 0.06, delay: 0.05 });
}
/** A tap that could not move anything. */
export function playNope() { tone({ freq: 180, duration: 0.12, type: "square", gain: 0.05, slideTo: 140 }); }
/** Undo. */
export function playUndo() { tone({ freq: 500, duration: 0.07, type: "sine", gain: 0.07, slideTo: 380 }); }
/** The game is won. */
export function playWin() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => tone({ freq: f, duration: 0.22, type: "triangle", gain: 0.11, delay: i * 0.13 }));
  tone({ freq: 1319, duration: 0.5, type: "sine", gain: 0.08, delay: 0.55 });
}
/** The game is lost: two soft falling notes, no sting. */
export function playLose() {
  tone({ freq: 440, duration: 0.2, type: "triangle", gain: 0.07 });
  tone({ freq: 330, duration: 0.3, type: "triangle", gain: 0.06, delay: 0.2 });
}
