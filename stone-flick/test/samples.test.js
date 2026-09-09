// test/samples.test.js
// The audio sample layer's one Node-testable surface: the filename ->
// role rule. Everything else in core/samples.js needs fetch() and an
// AudioContext and is verified in a browser.
//
// This exists because the rule is written TWICE on purpose — once in
// src/core/samples.js (runtime) and once in tools/build-audio-manifest.mjs
// (build script, which must not import browser code). That duplication is
// the right call, and this is the test that keeps it honest. A silent
// disagreement is the bad case: the file gets listed, fetched and decoded
// and is then dropped because the runtime does not recognize its role,
// with nothing in the console to say so.
import { test, assertEqual, assertTrue } from "./harness.js";
import { readFileSync } from "node:fs";
import { ROLES, roleOf } from "../src/core/samples.js";

test("a bare role name is that role", () => {
  assertEqual(roleOf("sink.mp3"), "sink");
  assertEqual(roleOf("win.ogg"), "win");
});

test("a numbered variant is still its role", () => {
  assertEqual(roleOf("impact-01.mp3"), "impact");
  assertEqual(roleOf("impact-2.wav"), "impact");
  assertEqual(roleOf("obstacle-heavy.m4a"), "obstacle");
});

test("case does not matter", () => {
  assertEqual(roleOf("Impact-01.MP3"), "impact");
});

test("an unrecognized name is rejected rather than guessed at", () => {
  // Guessing would be worse than refusing: a file called "stone.mp3"
  // silently becoming an `impact` is exactly the kind of helpfulness that
  // makes a wrong filename impossible to debug.
  assertEqual(roleOf("stone.mp3"), null);
  assertEqual(roleOf("readme.txt"), null);
  assertEqual(roleOf("-.mp3"), null);
});

test("the build script parses filenames the same way the runtime does", () => {
  const script = readFileSync(new URL("../tools/build-audio-manifest.mjs", import.meta.url), "utf8");
  const listed = script.match(/const ROLES = \[([^\]]+)\]/);
  assertTrue(listed !== null, "the build script still declares a ROLES list");
  const scriptRoles = listed[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
  assertEqual(scriptRoles, ROLES, "tools/build-audio-manifest.mjs and core/samples.js disagree about the role list");
});
