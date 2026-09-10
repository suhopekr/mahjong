// test/page.test.js — the page around the game: the site's CSP rules,
// the FAQ matching its JSON-LD, the stylesheet staying in its lane, and
// every data-i18n key on the page having an English string.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, assertEqual, assertTrue } from "./harness.js";
import { COLOURS } from "../src/core/storage.js";
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

test("main.js never writes a style attribute into markup and has no English literals in status calls", () => {
  assertTrue(!/style="/.test(js), 'style="" inside an innerHTML string');
  assertTrue(!/setAttribute\(\s*["']style/.test(js), "setAttribute('style', …)");
  // every status goes through a key: setStatus("key" …), never a sentence
  for (const m of js.matchAll(/setStatus\(\s*"([^"]+)"/g)) assertTrue(!/\s/.test(m[1]), `status key, not a sentence: "${m[1]}"`);
  assertTrue(!/statusEl\.textContent\s*=\s*"[A-Z]/.test(js), "no literal sentence assigned to the status line");
});

test("head: canonical, description, og:image, shared GA init, the game's title", () => {
  assertTrue(body.includes('<link rel="canonical" href="https://easymahjongsolitaire.com/backgammon/">'));
  assertTrue(/<meta name="description" content="[^"]{40,}">/.test(body));
  assertTrue(body.includes('content="https://easymahjongsolitaire.com/backgammon/og-image.png"'));
  assertTrue(body.includes('src="/ga-init.js"'));
  assertTrue(body.includes("<title>Backgammon — Free Online Game vs Computer, Big Board, No Download | Easy Classics</title>"));
});

test("JSON-LD parses; the FAQ on the page matches the FAQPage block one for one", () => {
  const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const app = blocks.find((b) => b["@type"] === "WebApplication");
  assertEqual(app.url, "https://easymahjongsolitaire.com/backgammon/");
  const faq = blocks.find((b) => b["@type"] === "FAQPage");
  const questions = faq.mainEntity.map((q) => q.name);
  const onPage = [...body.matchAll(/<div class="faq-item">\s*<h3>([^<]+)<\/h3>/g)].map((m) => m[1].trim());
  assertEqual(onPage, questions, "same questions in the same order");
  const flat = body.replace(/\s+/g, " ");
  for (const q of faq.mainEntity) {
    const answer = q.acceptedAnswer.text.replace(/\s+/g, " ");
    assertTrue(flat.includes(answer), `answer on page is identical to the JSON-LD one: "${answer.slice(0, 40)}…"`);
  }
});

test("site shell: footer fence, cross-game links carry placement, one settings sheet, one result modal, ad slots after the controls", () => {
  assertTrue(html.includes("<!-- games:footer -->") && html.includes("<!-- /games:footer -->"));
  for (const m of body.matchAll(/<a [^>]*data-crossgame-to="[^"]+"[^>]*>/g)) {
    assertTrue(/data-placement="(footer|win_modal|top_nav|top_nav_brand)"/.test(m[0]), "placement on " + m[0]);
  }
  assertEqual((body.match(/class="settings-panel"/g) || []).length, 1);
  assertEqual((body.match(/id="bg-result-modal"/g) || []).length, 1);
  assertTrue(body.indexOf('role="toolbar"') < body.indexOf('class="ad-slot'), "ad slots come after the controls");
  assertTrue(body.indexOf('class="ad-slot') < body.indexOf('<section class="content">'), "…and before the content");
  assertTrue(body.includes('id="bg-board" dir="ltr"'), "the board is dir=ltr");
  assertTrue(body.includes('class="skip-link" id="bg-skip-link"') && css.includes('[dir="rtl"] #bg-skip-link'), "the skip link is parked on the right in rtl (else the page grows 10,000px wide)");
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
  assertTrue(/<main id="backgammon"[^>]*>\s*<h1 class="game-title">Backgammon<\/h1>/.test(body), "h1.game-title is the first thing in <main>");
  assertTrue(body.indexOf("<h1") < body.indexOf('class="bg-goal"'), "the h1 comes before the goal line");
  assertTrue(/<nav class="site-nav" id="site-nav"[^>]*data-nav-from="backgammon"/.test(body), "the bar names this page's game");
  assertTrue(/<div class="nav-panel" id="nav-panel" data-open="false">/.test(body), "the panel opens on data-open");
  // The count comes from games.json, not from a literal: the panel has to
  // hold EVERY registered game, and a new game must not need an edit here.
  const registered = JSON.parse(readFileSync(path.join(root, "../games.json"), "utf8")).games.length;
  assertEqual((body.match(/<a class="game-card"/g) || []).length, registered,
    `one panel card per game in games.json (${registered})`);
  assertTrue(/<a class="game-card" href="\/backgammon\/" aria-current="page">/.test(body), "this game's card is aria-current");
  assertTrue(body.includes('class="nav-now" data-i18n="playingNow"'), 'and says "Playing now" in words');
  assertTrue(/id="nav-lang-grid"/.test(body) &&
    body.indexOf('class="nav-card-grid"') < body.indexOf('id="nav-lang-section"'),
    "the language grid is in the panel, after the cards");
});

test("stylesheet: every selector is .bg-/#bg-/#backgammon scoped, no bare element selectors, board isolates", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  for (const sel of rules) {
    if (sel.startsWith("@") || /^\d+%|^from$|^to$/.test(sel)) continue;
    for (const part of sel.split(",")) {
      const p = part.trim();
      // A `[dir="rtl"]` prefix is allowed: the Arabic fixes must key off the page direction (as solitaire's do)
      assertTrue(/^(\[dir="rtl"\] )?(\.bg-|#bg-|#backgammon)/.test(p), `scoped selector: "${p}"`);
    }
  }
  assertTrue(/\.bg-board\s*{[^}]*isolation:\s*isolate/.test(css), "isolation: isolate on the board");
});

test("checker colourways: every colour in storage.js has a CSS block, a swatch and a name string", () => {
  for (const c of COLOURS) {
    assertTrue(css.includes(`#backgammon[data-colours="${c}"]`), `css for ${c}`);
    assertTrue(body.includes(`name="bg-colours" value="${c}"`), `swatch for ${c}`);
    assertTrue(typeof strings.en["name" + c[0].toUpperCase() + c.slice(1)] === "string", `name string for ${c}`);
  }
});

test("i18n: every data-i18n key on the page exists in strings.en or common.en; picker and language row present", () => {
  const keys = new Set([...body.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
  for (const m of body.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(";")) keys.add(pair.split(":")[1].trim());
  assertTrue(keys.size > 30, "the page is marked up for translation");
  for (const k of keys) assertTrue(k in strings.en || k in common.en, `string for "${k}"`);
  // every key main.js asks for exists too
  for (const m of js.matchAll(/\bt\(\s*"([^"]+)"/g)) assertTrue(m[1] in strings.en || m[1] in common.en, `main.js key "${m[1]}"`);
  for (const m of js.matchAll(/setStatus\(\s*"([^"]+)"/g)) assertTrue(m[1] in strings.en || m[1] in common.en, `status key "${m[1]}"`);
  assertTrue(body.includes('<legend class="settings-label" data-i18n="language">'), "Language legend");
  assertTrue(body.includes('class="lang-grid" id="bg-lang-grid"'), "language grid");
  assertTrue(css.includes("#bg-lang-grid"), "grid styled");
  const langRow = body.indexOf('data-i18n="language"'), paceRow = body.indexOf('data-i18n="paceLabel"');
  assertTrue(langRow > 0 && langRow < paceRow, "Language is the first settings row");
  assertTrue(/data-i18n="goal" data-i18n-html/.test(body), "goal line carries our own <strong>");
});
