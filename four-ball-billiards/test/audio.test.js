// test/audio.test.js
// The output bus, checked without a browser.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, assertTrue } from "./harness.js";
import { masterBus } from "../src/core/bus.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Just enough of a Web Audio context for masterBus() to build its chain. */
function fakeCtx() {
  const param = () => ({ value: 0 });
  const node = (extra = {}) => ({ connect() {}, ...extra });
  return {
    destination: node(),
    createDynamicsCompressor: () =>
      node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createGain: () => node({ gain: param() }),
    createWaveShaper: () => node({ curve: null, oversample: "none" }),
  };
}

test("every voice goes through the bus, not the speaker", () => {
  // The bug this prevents is not a wrong sound, it is a sound that is
  // right on its own: each voice was connected straight to the
  // destination, so nothing anywhere kept their SUM under full scale.
  // Measured before the bus: two impact samples at 0.67 plus two cushion
  // voices at 0.45 asks for about 2.1, and everything over 1.0 comes out
  // as a crackle on the loudest moments only — which is why it was
  // intermittent and hard to pin.
  for (const f of ["audio.js", "samples.js"]) {
    const src = readFileSync(path.join(root, "src", "core", f), "utf8");
    const direct = src.match(/connect\(\s*\w*[Cc]tx\.destination\s*\)/g) || [];
    assertTrue(direct.length === 0, `${f} connects a voice straight to the speaker: ${direct.join(", ")}`);
  }
});

test("the bus cannot put a sample past full scale", () => {
  const ctx = fakeCtx();
  let shaper = null;
  const made = ctx.createWaveShaper;
  ctx.createWaveShaper = () => (shaper = made());
  masterBus(ctx);
  assertTrue(shaper && shaper.curve, "the bus has no soft-clip stage");
  const c = shaper.curve;
  let maxOut = 0;
  let monotonic = true;
  for (let i = 1; i < c.length; i++) {
    maxOut = Math.max(maxOut, Math.abs(c[i]));
    if (c[i] < c[i - 1] - 1e-9) monotonic = false;
  }
  assertTrue(maxOut <= 0.95, `the curve reaches ${maxOut.toFixed(3)} — that is the rail again`);
  assertTrue(monotonic, "the curve folds back on itself, which is distortion of the bad kind");
  // And it has to be the identity where the game normally sits, or every
  // quiet sound gets quietly re-mixed.
  const at = (x) => c[Math.round(((x + 2) / 4) * (c.length - 1))];
  for (const x of [0.05, 0.2, 0.4, 0.6]) {
    assertTrue(Math.abs(at(x) - x) < 0.005, `${x} is not passed through untouched`);
  }
});
