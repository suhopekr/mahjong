// test/page.test.js — the page around the game: the site's CSP rules,
// the FAQ matching its JSON-LD, the stylesheet staying in its lane, and
// every data-i18n key existing in the dictionaries.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, assertEqual, assertTrue } from "./harness.js";
import { strings } from "../src/i18n/strings.js";
import { common } from "../../i18n/common.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(root, "index.html"), "utf8");
const css = readFileSync(path.join(root, "style.css"), "utf8");
const js = readFileSync(path.join(root, "src/main.js"), "utf8");
const body = html.replace(/<!--[\s\S]*?-->/g, "");

test("no inline styles, style attributes or on* handlers (CSP style-src/script-src 'self')", () => {
  assertTrue(!/<style[\s>]/.test(body), "inline <style>");
  assertTrue(!/\sstyle="/.test(body), 'style="" attribute');
  assertTrue(!/\son[a-z]+="/i.test(body), "on*= handler");
  const inline = [...body.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)].filter((m) => !/ld\+json/.test(m[1]));
  assertEqual(inline.length, 0, "inline <script> other than JSON-LD");
});

test("main.js never writes a style attribute into markup and has no English literals for the status line", () => {
  assertTrue(!/style="/.test(js), 'style="" inside an innerHTML string');
  assertTrue(!/setAttribute\(\s*["']style/.test(js), "setAttribute('style', …)");
  assertTrue(!/setStatus\(\s*["'`][A-Z][a-z]+ /.test(js), "setStatus with an English sentence");
  assertTrue(!/textContent\s*=\s*["'`][A-Za-z]+ [a-z]/.test(js), "textContent set to an English sentence");
  assertTrue(js.includes('from "/i18n/i18n.js"') && js.includes('from "/i18n/common.js"'), "uses the shared i18n runtime");
});

test("head: canonical, description, og:image, shared GA init", () => {
  assertTrue(body.includes('<link rel="canonical" href="https://easymahjongsolitaire.com/freecell/">'));
  assertTrue(/<meta name="description" content="[^"]{40,}">/.test(body));
  assertTrue(body.includes('content="https://easymahjongsolitaire.com/freecell/og-image.png"'));
  assertTrue(body.includes('src="/ga-init.js"'));
  assertTrue(body.includes("<title>FreeCell — Free Online Solitaire, Big Cards, No Download | Easy Classics</title>"));
});

test("JSON-LD parses; the FAQ on the page matches the FAQPage block one for one", () => {
  const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const app = blocks.find((b) => b["@type"] === "WebApplication");
  assertEqual(app.url, "https://easymahjongsolitaire.com/freecell/");
  const faq = blocks.find((b) => b["@type"] === "FAQPage");
  const questions = faq.mainEntity.map((q) => q.name);
  const onPage = [...body.matchAll(/<div class="faq-item">\s*<h3>([^<]+)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)];
  assertEqual(onPage.map((m) => m[1].trim()), questions, "same questions in the same order");
  faq.mainEntity.forEach((q, i) => {
    const onPageAnswer = onPage[i][2].replace(/\s+/g, " ").trim();
    assertEqual(onPageAnswer, q.acceptedAnswer.text.replace(/\s+/g, " ").trim(), `answer ${i + 1} identical`);
  });
});

test("site shell: footer fence, cross-game links carry placement, one settings sheet, one win modal, board is LTR", () => {
  assertTrue(html.includes("<!-- games:footer -->") && html.includes("<!-- /games:footer -->"));
  for (const m of body.matchAll(/<a [^>]*data-crossgame-to="[^"]+"[^>]*>/g)) {
    assertTrue(/data-placement="(footer|win_modal|top_nav|top_nav_brand)"/.test(m[0]), "placement on " + m[0]);
  }
  assertEqual((body.match(/class="settings-panel"/g) || []).length, 1);
  assertEqual((body.match(/id="fc-win-modal"/g) || []).length, 1);
  assertTrue(/<div class="fc-table" id="fc-table" dir="ltr"/.test(body), "board dir=ltr");
  assertTrue(/<main id="freecell"/.test(body));
  assertTrue(/role="toolbar"/.test(body));
  const adIdx = body.indexOf('class="ad-slot');
  assertTrue(adIdx > body.indexOf('class="fc-controls"') && adIdx < body.indexOf('<section class="content">'), "ad slots between controls and content");
  assertTrue(body.includes('<div class="lang-grid" id="fc-lang-grid"></div>'), "language grid in settings");
  const settingsIdx = body.indexOf('id="fc-settings-panel"');
  assertTrue(body.indexOf('data-i18n="language"', settingsIdx) < body.indexOf('data-i18n="tapLegend"', settingsIdx), "Language is the first settings row");
});

// The green per-game banner (.site-header = h1 + .tagline + a cross-game
// link) is gone; DESIGN.md "Site navigation" replaced it with one bar on
// every page and a full-screen Games panel behind it. The bar's markup is
// generated (tools/sync-games.mjs, <!-- games:nav --> fences) so every
// game link works with JavaScript off; /nav.js only opens and closes it.
test("top bar: the nav fence, /nav.js, one h1.game-title first in <main>, no .site-header", () => {
  assertTrue(html.includes("<!-- games:nav -->") && html.includes("<!-- /games:nav -->"), "the nav fence");
  assertTrue(/<script type="module" src="\/nav\.js"><\/script>/.test(body), "loads /nav.js");
  assertTrue(!/class="site-header"/.test(body), "no .site-header left");
  assertTrue(!/class="tagline"/.test(body), "no .tagline left");
  assertEqual((body.match(/<h1[\s>]/g) || []).length, 1, "exactly one <h1>");
  assertTrue(/<main id="freecell"[^>]*>\s*<h1 class="game-title">FreeCell<\/h1>/.test(body), "h1.game-title is the first thing in <main>");
  assertTrue(body.indexOf("<h1") < body.indexOf('class="fc-goal"'), "the h1 comes before the goal line");
  assertTrue(/<nav class="site-nav" id="site-nav"[^>]*data-nav-from="freecell"/.test(body), "the bar names this page's game");
  assertTrue(/<div class="nav-panel" id="nav-panel" data-open="false">/.test(body), "the panel opens on data-open");
  // The count comes from games.json, not from a literal: the panel has to
  // hold EVERY registered game, and a new game must not need an edit here.
  const registered = JSON.parse(readFileSync(path.join(root, "../games.json"), "utf8")).games.length;
  assertEqual((body.match(/<a class="game-card"/g) || []).length, registered,
    `one panel card per game in games.json (${registered})`);
  assertTrue(/<a class="game-card" href="\/freecell\/" aria-current="page">/.test(body), "this game's card is aria-current");
  assertTrue(body.includes('class="nav-now" data-i18n="playingNow"'), 'and says "Playing now" in words');
  assertTrue(/id="nav-lang-grid"/.test(body) &&
    body.indexOf('class="nav-card-grid"') < body.indexOf('id="nav-lang-section"'),
    "the language grid is in the panel, after the cards");
});

test("stylesheet: every selector is .fc-/#fc-/#freecell scoped, no bare element selectors", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  for (const sel of rules) {
    if (sel.startsWith("@") || /^\d+%|^from$|^to$/.test(sel)) continue;
    for (const part of sel.split(",")) {
      const p = part.trim();
      assertTrue(/^(\.fc-|#fc-|#freecell)/.test(p), `scoped selector: "${p}"`);
    }
  }
  assertTrue(css.includes("isolation: isolate"), "board isolates its z-indexes");
});

test("card back themes: every theme in storage.js has a CSS block and a swatch", async () => {
  const { BACKS } = await import("../src/core/storage.js");
  for (const back of BACKS) {
    assertTrue(css.includes(`#freecell[data-back="${back}"]`), `css for ${back}`);
    assertTrue(body.includes(`name="fc-back" value="${back}"`), `swatch for ${back}`);
  }
});

test("every data-i18n key on the page exists in strings.en or common.en", () => {
  const keys = new Set();
  for (const m of body.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const m of body.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(";")) keys.add(pair.split(":")[1].trim());
  }
  assertTrue(keys.size >= 30, "the page is marked up (" + keys.size + " keys)");
  for (const k of keys) assertTrue(k in strings.en || k in common.en, `key "${k}" exists`);
  // and every key main.js asks for by literal name
  for (const m of js.matchAll(/\bt\(\s*"([A-Za-z0-9]+)"\s*[,)]/g)) assertTrue(m[1] in strings.en || m[1] in common.en, `main.js key "${m[1]}" exists`);
  for (const m of js.matchAll(/setStatus\(\s*"([A-Za-z0-9]+)"/g)) assertTrue(m[1] in strings.en || m[1] in common.en, `status key "${m[1]}" exists`);
  for (const k of ["hintNone", "hintHome", "hintCell", "hintEmpty", "hintOnto", "hintOntoRun", "hintEmptyRun", "wentToCell", "tooMany", "plateMove", "dealLabel"]) assertTrue(k in strings.en, k);
});

test("storage keys are freecell.v1.*", async () => {
  const src = readFileSync(path.join(root, "src/core/storage.js"), "utf8");
  assertTrue(src.includes('"freecell.v1"'));
  const store = await import("../src/core/storage.js");
  assertTrue(!store.isValidState({}), "rejects junk");
  const { newGame } = await import("../src/game/freecell.js");
  assertTrue(store.isValidState(newGame({ deal: 1 })), "accepts a real state");
});

test("the ads shim exposes the three hooks and main.js uses them", async () => {
  const ads = await import("../src/core/ads.js");
  assertEqual(typeof ads.preloadInterstitial, "function");
  assertEqual(await ads.showInterstitial("game_over"), undefined);
  assertEqual(await ads.requestRewardedHint(), "granted");
  assertTrue(js.includes('showInterstitial("game_over")') && js.includes("requestRewardedHint()"));
  assertTrue(js.includes('trackEvent("game_start"') && js.includes('trackEvent("game_win"') && js.includes('"cross_game_click"'));
});
