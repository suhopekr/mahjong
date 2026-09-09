// test/harness.js
// Zero-dependency test harness for exercising game logic without a
// browser (no Playwright, no DOM — just the modules under test). Not
// shipped in the game build, dev-only tooling; consistent with the
// project's zero-runtime-dependency rule since it's not a runtime dep.
//
// Usage:
//   import { test, assertEqual, assertThrows } from "./harness.js";
//   test("description", () => { assertEqual(1 + 1, 2, "adds"); });
// Run all suites: node test/run.js  (or npm test)

let passCount = 0;
let failCount = 0;

/**
 * Tests run one at a time, in the order they were declared, and an ASYNC
 * one is awaited before the next begins.
 *
 * It did not used to be, and that was not a style question. `test()` used
 * to call fn() and count a pass the moment it RETURNED, so an async test
 * was counted as passing while it was still running: its assertions
 * landed later as unhandled rejections that killed the process after the
 * summary had already printed "0 failed", and — worse — several of them
 * overlapped, swapping the module singletons and globals they each set up
 * out from under one another. Six async tests in test/storage.test.js
 * were being reported on without ever being waited for.
 *
 * A promise chain rather than a queue drained at the end, so the console
 * output stays in declaration order; test/run.js awaits drain() between
 * files to keep each suite's block together.
 */
let chain = Promise.resolve();

export function test(name, fn) {
  chain = chain.then(async () => {
    try {
      await fn();
      passCount++;
      console.log(`  ok - ${name}`);
    } catch (err) {
      failCount++;
      console.log(`  FAIL - ${name}`);
      console.log(`    ${err.message}`);
    }
  });
}

/** Everything declared so far, finished. */
export function drain() {
  return chain;
}

export function assertEqual(actual, expected, msg = "") {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${msg ? msg + ": " : ""}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

export function assertTrue(cond, msg = "expected truthy value") {
  if (!cond) throw new Error(msg);
}

/**
 * Assert fn() throws. `matcher` (RegExp or substring) is checked against
 * the thrown error's message when given.
 */
export function assertThrows(fn, matcher, msg = "expected function to throw") {
  let threw = false;
  let error = null;
  try {
    fn();
  } catch (err) {
    threw = true;
    error = err;
  }
  if (!threw) throw new Error(msg);
  if (matcher) {
    const text = error.message || String(error);
    const matches = matcher instanceof RegExp ? matcher.test(text) : text.includes(matcher);
    if (!matches) {
      throw new Error(`error message "${text}" did not match ${matcher}`);
    }
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

export async function summary() {
  await chain;
  console.log(`\n${passCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exitCode = 1;
}

// --- site build ------------------------------------------------------------
//
// On the portal this game's CSS was an inline <style> in index.html, and
// several suites read the page and slice that block out. On the site the
// CSS lives in ./style.css (the site's Content-Security-Policy refuses
// inline styles), so this puts it back where those suites expect it: the
// page exactly as a browser sees it, with the stylesheet inlined at the
// <link> that loads it. Every test that used to read index.html reads
// this instead, and none of their assertions had to change.
import { readFileSync as _readFileSync } from "node:fs";
import _path from "node:path";
export function readPage(root) {
  const html = _readFileSync(_path.join(root, "index.html"), "utf8");
  const css = _readFileSync(_path.join(root, "style.css"), "utf8");
  const link = /([ \t]*)<link rel="stylesheet" href="\.\/style\.css" \/>\n/;
  const m = html.match(link);
  if (!m) throw new Error("index.html no longer links ./style.css");
  // Re-indented two deeper than the <link>, which is exactly where the
  // inline block's rules used to sit — a few suites slice by indented text.
  const indent = m[1] + "  ";
  const body = css.split("\n").map((l) => (l ? indent + l : l)).join("\n");
  return html.replace(link, `${m[1]}<style>\n${body}${m[1]}</style>\n`);
}
