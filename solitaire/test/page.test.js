// test/page.test.js — the page around the game: the site's CSP rules,
// the FAQ matching its JSON-LD, the stylesheet staying in its lane.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, assertEqual, assertTrue } from "./harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(root, "index.html"), "utf8");
const css = readFileSync(path.join(root, "style.css"), "utf8");
const body = html.replace(/<!--[\s\S]*?-->/g, "");

test("no inline styles, style attributes or on* handlers (CSP style-src/script-src 'self')", () => {
  assertTrue(!/<style[\s>]/.test(body), "inline <style>");
  assertTrue(!/\sstyle="/.test(body), 'style="" attribute');
  assertTrue(!/\son[a-z]+="/i.test(body), "on*= handler");
  const inline = [...body.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)].filter((m) => !/ld\+json/.test(m[1]));
  assertEqual(inline.length, 0, "inline <script> other than JSON-LD");
});

test("main.js never writes a style attribute into markup", () => {
  const js = readFileSync(path.join(root, "src/main.js"), "utf8");
  assertTrue(!/style="/.test(js), 'style="" inside an innerHTML string');
  assertTrue(!/setAttribute\(\s*["']style/.test(js), "setAttribute('style', …)");
});

test("head: canonical, description, og:image, shared GA init", () => {
  assertTrue(body.includes('<link rel="canonical" href="https://easymahjongsolitaire.com/solitaire/">'));
  assertTrue(/<meta name="description" content="[^"]{40,}">/.test(body));
  assertTrue(body.includes('content="https://easymahjongsolitaire.com/solitaire/og-image.png"'));
  assertTrue(body.includes('src="/ga-init.js"'));
});

test("JSON-LD parses; the FAQ on the page matches the FAQPage block one for one", () => {
  const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const app = blocks.find((b) => b["@type"] === "WebApplication");
  assertEqual(app.url, "https://easymahjongsolitaire.com/solitaire/");
  const faq = blocks.find((b) => b["@type"] === "FAQPage");
  const questions = faq.mainEntity.map((q) => q.name);
  const onPage = [...body.matchAll(/<div class="faq-item">\s*<h3>([^<]+)<\/h3>/g)].map((m) => m[1].trim());
  assertEqual(onPage, questions, "same questions in the same order");
  for (const q of faq.mainEntity) {
    const words = q.acceptedAnswer.text.split(/\s+/).slice(0, 5).join(" ");
    assertTrue(body.replace(/\s+/g, " ").includes(words), `answer on page starts like the JSON-LD one: "${words}"`);
  }
});

test("site shell: footer fence, cross-game links carry placement, one settings sheet, one win modal", () => {
  assertTrue(html.includes("<!-- games:footer -->"));
  for (const m of body.matchAll(/<a [^>]*data-crossgame-to="[^"]+"[^>]*>/g)) {
    assertTrue(/data-placement="(footer|win_modal|top_nav|top_nav_brand)"/.test(m[0]), "placement on " + m[0]);
  }
  assertEqual((body.match(/class="settings-panel"/g) || []).length, 1);
  assertEqual((body.match(/id="sol-win-modal"/g) || []).length, 1);
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
  assertTrue(/<main id="solitaire"[^>]*>\s*<h1 class="game-title">Solitaire<\/h1>/.test(body), "h1.game-title is the first thing in <main>");
  assertTrue(body.indexOf("<h1") < body.indexOf('class="sol-goal"'), "the h1 comes before the goal line");
  assertTrue(/<nav class="site-nav" id="site-nav"[^>]*data-nav-from="solitaire"/.test(body), "the bar names this page's game");
  assertTrue(/<div class="nav-panel" id="nav-panel" data-open="false">/.test(body), "the panel opens on data-open");
  // The count comes from games.json, not from a literal: the panel has to
  // hold EVERY registered game, and a new game must not need an edit here.
  const registered = JSON.parse(readFileSync(path.join(root, "../games.json"), "utf8")).games.length;
  assertEqual((body.match(/<a class="game-card"/g) || []).length, registered,
    `one panel card per game in games.json (${registered})`);
  assertTrue(/<a class="game-card" href="\/solitaire\/" aria-current="page">/.test(body), "this game's card is aria-current");
  assertTrue(body.includes('class="nav-now" data-i18n="playingNow"'), 'and says "Playing now" in words');
  assertTrue(/id="nav-lang-grid"/.test(body) &&
    body.indexOf('class="nav-card-grid"') < body.indexOf('id="nav-lang-section"'),
    "the language grid is in the panel, after the cards");
});

test("stylesheet: every selector is .sol-/#sol-/#solitaire scoped, no bare element selectors", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  for (const sel of rules) {
    if (sel.startsWith("@") || /^\d+%|^from$|^to$/.test(sel)) continue;
    for (const part of sel.split(",")) {
      const p = part.trim();
      // A `[dir="rtl"]` prefix is allowed: the Arabic fixes must key off
      // <html dir>, and what follows is still a #sol-/.sol- selector.
      assertTrue(/^(\[dir="rtl"\] )?(\.sol-|#sol-|#solitaire)/.test(p), `scoped selector: "${p}"`);
    }
  }
});

test("card back themes: every theme in storage.js has a CSS block and a swatch", async () => {
  const { BACKS } = await import("../src/core/storage.js");
  for (const back of BACKS) {
    assertTrue(css.includes(`#solitaire[data-back="${back}"]`), `css for ${back}`);
    assertTrue(body.includes(`name="sol-back" value="${back}"`), `swatch for ${back}`);
  }
});

// ---- languages (BRIEF.md "Languages") ---------------------------------

test("i18n: every data-i18n / data-i18n-attr key on the page exists in strings.en or common.en", async () => {
  const { strings } = await import("../src/i18n/strings.js");
  const { common } = await import("../../i18n/common.js");
  const known = (k) => k in strings.en || k in common.en;
  const keys = [...body.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  assertTrue(keys.length >= 40, `enough data-i18n on the page (${keys.length})`);
  for (const k of keys) assertTrue(known(k), `data-i18n key "${k}" is defined`);
  for (const m of body.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(";")) {
      const [attr, k] = pair.split(":").map((s) => s.trim());
      assertTrue(attr && k && known(k), `data-i18n-attr "${pair}" names a defined key`);
    }
  }
  // data-i18n-html only where our string carries markup — and vice versa.
  for (const m of body.matchAll(/<[^>]*data-i18n="([^"]+)"[^>]*>/g)) {
    const isHtml = /data-i18n-html/.test(m[0]);
    const v = strings.en[m[1]] ?? common.en[m[1]];
    assertEqual(isHtml, typeof v === "string" && /<[a-z]/.test(v), `data-i18n-html on "${m[1]}" matches the string`);
  }
});

test("i18n: the page's static English matches strings.en (what a search engine reads is what English players see)", async () => {
  const { strings } = await import("../src/i18n/strings.js");
  const { common } = await import("../../i18n/common.js");
  for (const m of body.matchAll(/<([a-z0-9]+)[^>]*data-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const [, , key, inner] = m;
    if (/<[a-z]/.test(inner) && !/data-i18n-html/.test(m[0])) continue; // nested elements — not this one's text
    const v = strings.en[key] ?? common.en[key];
    if (typeof v !== "string") continue;
    assertEqual(inner.replace(/\s+/g, " ").trim(), v.replace(/\s+/g, " ").trim(), `text under data-i18n="${key}"`);
  }
});

test("i18n: the shell wires the runtime — imports, applyStatic at boot, picker, onChange, no English TEXT table", () => {
  const js = readFileSync(path.join(root, "src/main.js"), "utf8");
  assertTrue(js.includes('from "/i18n/i18n.js"'), "imports createI18n from /i18n/i18n.js");
  assertTrue(js.includes('from "/i18n/common.js"'), "imports common");
  assertTrue(js.includes('from "./i18n/strings.js"'), "imports strings");
  assertTrue(/createI18n\(\{\s*common,\s*game:\s*strings\s*\}\)/.test(js), "createI18n({ common, game: strings })");
  assertTrue(js.includes("i18n.applyStatic()"), "applyStatic at boot");
  assertTrue(js.includes('i18n.renderPicker($("sol-lang-grid"))'), "renderPicker into #sol-lang-grid");
  assertTrue(js.includes("i18n.onChange("), "onChange re-render");
  assertTrue(!/const TEXT\s*=/.test(js), "no TEXT table");
  // No English sentence literals left: a quoted string with two or more
  // words and sentence punctuation is a phrase that belongs in strings.js.
  const code = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const phrases = [...code.matchAll(/["'`]([A-Z][a-z]+ [a-z][^"'`]*[.!?])["'`]/g)].map((m) => m[1]);
  assertEqual(phrases, [], "English sentences in main.js");
  assertTrue(body.includes('id="sol-table" dir="ltr"'), "the board is dir=ltr");
  assertTrue(body.includes('<section class="content" lang="en" dir="ltr">'), "the SEO text stays English and ltr");
  assertTrue(/<fieldset class="settings-row">\s*<legend class="settings-label" data-i18n="language">/.test(body.replace(/<!--[\s\S]*?-->/g, "")), "Language row present");
  const sheet = body.slice(body.indexOf('id="sol-settings-title"'));
  assertTrue(sheet.indexOf('id="sol-lang-grid"') < sheet.indexOf('id="sol-draw-group"'), "Language is the first settings row");
  assertTrue(css.includes("#solitaire .lang-grid") && css.includes('#solitaire .lang-btn[aria-pressed="true"]'), "lang-grid styled and scoped");
});
