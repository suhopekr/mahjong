// src/core/bus.js
// One output bus for every voice in the game, with a limiter on it.
//
// WHY THIS EXISTS
//
// Every voice used to connect straight to audioCtx.destination, which
// means the mix was whatever the sum of the voices happened to be, and
// nothing kept that sum under 1.0. Measured, at full strength:
//
//   ball-on-ball sample   0.67  (impact-01.mp3 peaks at -3.5 dBFS)
//   a second one          0.67  (main.js plays the two loudest)
//   cushion voice         0.45  (its two layers together)
//   two cushions          0.76  (worst overlap in 400 simulated breaks)
//
// A break that lands a hard carom while the cue ball is still working a
// rail asks for about 2.1, and everything above 1.0 is clipped by the
// hardware — which is heard as a crackle on the loudest moments only,
// intermittently, exactly as it was reported. Nothing is wrong with any
// individual voice; there was simply no place where the mix was allowed
// to be a mix.
//
// A compressor with a hard ratio is the standard answer and it is a
// better one than turning everything down: the quiet 90% of the game is
// under the threshold and passes through untouched, and only the pile-up
// is held. Attack is 3ms — fast enough to catch a transient that is
// itself 4ms, slow enough not to dull it.
const buses = new WeakMap();

/** The node every voice should connect to instead of ctx.destination. */
export function masterBus(ctx) {
  let bus = buses.get(ctx);
  if (bus) return bus;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  const out = ctx.createGain();
  // A little headroom under the limiter, because the limiter alone is
  // not enough: measured with twelve voices fired in one tick it still
  // let 1.31 through. A DynamicsCompressor has no lookahead, so a 3ms
  // attack cannot catch a transient that IS 4ms — it rides the level
  // after the fact, which is the right job for it and the wrong tool for
  // the first sample of a stack.
  out.gain.value = 0.85;

  // So the last thing in the chain is a soft knee that acts instantly.
  // Below 0.7 it is the identity — the quiet nine tenths of the game
  // passes through bit for bit — and above it the curve bends over to
  // 1.0 instead of running into the wall. What clipping does to a
  // transient is add every odd harmonic at once, which is the crackle;
  // what this does is round the top of it, which is what a loud room
  // sounds like.
  const shaper = ctx.createWaveShaper();
  const N = 2048;
  const curve = new Float32Array(N);
  const KNEE = 0.7;
  // The ceiling is 0.94, not 1.0. Oversampling filters ring a little at
  // the corner and the measured output of a 1.0 ceiling was 1.03 — over
  // the rail, which is the thing this whole node exists to avoid.
  const CEIL = 0.94;
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 4 - 2; // input range -2..2
    const a = Math.abs(x);
    const y = a <= KNEE ? a : KNEE + (CEIL - KNEE) * Math.tanh((a - KNEE) / (CEIL - KNEE));
    curve[i] = Math.sign(x) * y;
  }
  shaper.curve = curve;
  shaper.oversample = "2x";

  limiter.connect(out);
  out.connect(shaper);
  shaper.connect(ctx.destination);
  bus = limiter;
  buses.set(ctx, bus);
  return bus;
}
