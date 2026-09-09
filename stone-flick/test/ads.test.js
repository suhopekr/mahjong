// test/ads.test.js — SITE BUILD.
//
// The portal build's suite pinned the CrazyGames SDK to the page. This
// site has no ad SDK, so this suite pins the opposite: the shim in
// src/core/ads.js keeps every name main.js imports, does nothing that
// could reach a player, and hands out the preview for free.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, assertEqual, assertTrue, readPage } from "./harness.js";
import * as ads from "../src/core/ads.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the shim exports every name main.js imports from core/ads.js", () => {
  const main = readFileSync(path.join(root, "src", "main.js"), "utf8");
  const m = main.match(/import\s*\{([^}]*)\}\s*from\s*"\.\/core\/ads\.js"/);
  assertTrue(!!m, "main.js still imports from ./core/ads.js");
  for (const name of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
    assertEqual(typeof ads[name], "function", `ads.js exports ${name}`);
  }
});

// Awaited up front: the harness's test() is synchronous.
const grantStarted = Date.now();
const grantOutcome = await ads.requestRewardedHint();
const grantMs = Date.now() - grantStarted;
test("the preview is free: requestRewardedHint grants without an SDK", () => {
  assertEqual(grantOutcome, "granted", "granted");
  assertTrue(grantMs < 2000, "and promptly");
});

test("the SDK hooks are inert and never throw", () => {
  for (const name of ["onGameOver", "notifyGameplayStart", "notifyGameplayStop", "notifyLoadingStart", "notifyLoadingStop", "reportProgress", "setContext"]) {
    assertEqual(ads[name](), undefined, `${name}() is a no-op`);
  }
  assertEqual(ads.getAdSdkReadyState(), true, "offers gated on an SDK still show — they are honoured for free");
});

test("nothing on the page or in the shim reaches for CrazyGames", () => {
  const html = readPage(root);
  assertTrue(!/sdk\.crazygames\.com/.test(html), "no SDK script tag");
  const shim = readFileSync(path.join(root, "src", "core", "ads.js"), "utf8");
  assertTrue(!/window\.CrazyGames/.test(shim), "the shim never touches window.CrazyGames");
});

test("no copy still promises an ad the site cannot show", () => {
  const html = readPage(root).replace(/<!--[\s\S]*?-->/g, "");
  const main = readFileSync(path.join(root, "src", "main.js"), "utf8").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
  assertTrue(!/watch (a|an) (short )?ad/i.test(html), "index.html");
  assertTrue(!/watch (a|an) (short )?ad/i.test(main), "src/main.js");
});
