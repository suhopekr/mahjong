// test/surface.test.js
// The readability contract, in numbers.
//
// The cloth is the brightest large object on the screen and four balls
// have to read against it at twelve pixels across. Texture may add
// SURFACE; it may not add CONTRAST that competes with a ball. That rule
// is easy to state and easy to break one commit at a time — every
// individual "just a little stronger" is defensible — so the caps are
// asserted here rather than trusted to the comments beside them.
//
// The painters need a canvas, which Node does not have, so what is tested
// is the amplitude table they draw from and the RNG they draw with. That
// is the part that decays; a gradient stop does not drift on its own.
import { test, assertTrue, assertEqual } from "./harness.js";
import { AMPLITUDE, MAX_LAYER_ALPHA, rng } from "../src/game/surface.js";

test("no texture layer may out-shout a ball", () => {
  for (const [name, a] of Object.entries(AMPLITUDE)) {
    assertTrue(a > 0, `${name} is switched off`);
    assertTrue(a <= MAX_LAYER_ALPHA, `${name} at ${a} is past the ${MAX_LAYER_ALPHA} cap`);
  }
});

test("the fine layers stay under the coarse ones", () => {
  // The stack only works ordered: mottling is meant to be the loudest
  // thing after the light, and the one-pixel fibre the quietest. A fleck
  // you can pick out individually is a speck of dirt, not a fibre.
  assertTrue(AMPLITUDE.fleck < AMPLITUDE.mottle, "fibre must sit under mottling");
  assertTrue(AMPLITUDE.weave < AMPLITUDE.nap, "the cross weave must sit under the nap");
  assertTrue(AMPLITUDE.iron < AMPLITUDE.nap, "the iron streaks are the faintest large layer");
});

test("the same table paints the same way every time", () => {
  // Not a style point: a screenshot test that photographs a different
  // surface each run cannot fail, which is worse than not having it.
  const a = Array.from({ length: 8 }, rng(1234));
  const b = Array.from({ length: 8 }, rng(1234));
  assertEqual(a, b, "same seed, same sequence");
  const c = Array.from({ length: 8 }, rng(1235));
  assertTrue(JSON.stringify(a) !== JSON.stringify(c), "different seeds must differ");
});

test("the generator is actually spread across its range", () => {
  const next = rng(99);
  let lo = 1;
  let hi = 0;
  let sum = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const v = next();
    assertTrue(v >= 0 && v < 1, `out of range: ${v}`);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    sum += v;
  }
  assertTrue(lo < 0.02 && hi > 0.98, `range ${lo.toFixed(3)}..${hi.toFixed(3)}`);
  assertTrue(Math.abs(sum / n - 0.5) < 0.02, `mean ${(sum / n).toFixed(3)}`);
});
