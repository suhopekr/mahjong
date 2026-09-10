// test/page.test.js — the page around the game: the site's CSP rules,
// the FAQ matching its JSON-LD, the footer fence, the stylesheet staying
// in its lane, and every data-i18n key on the page having an English
// string.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, assertEqual, assertTrue } from "./harness.js";

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
  assertTrue(!/<link[^>]*rel="(stylesheet|preload)"[^>]*href="https?:/.test(body), "no external stylesheet or font");
});

test("main.js never writes a style attribute into markup", () => {
  assertTrue(!/style="/.test(js), 'style="" inside an innerHTML string');
  assertTrue(!/setAttribute\(\s*["']style/.test(js), "setAttribute('style', …)");
});

test("head: title, canonical, description, og:image, favicon, shared GA init", () => {
  assertTrue(body.includes("<title>Word Search — Free Online Puzzles, Big Letters, No Download | Easy Classics</title>"));
  assertTrue(body.includes('<link rel="canonical" href="https://easymahjongsolitaire.com/word-search/">'));
  assertTrue(/<meta name="description" content="[^"]{40,}">/.test(body));
  assertTrue(body.includes('content="https://easymahjongsolitaire.com/word-search/og-image.png"'));
  assertTrue(/<link rel="icon" href="data:image\/svg\+xml,/.test(body), "inline SVG favicon");
  assertTrue(body.includes('src="/ga-init.js"'));
  assertTrue(body.includes('src="/_vercel/insights/script.js"'));
});

test("JSON-LD parses; the FAQ on the page matches the FAQPage block one for one", () => {
  const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const app = blocks.find((b) => b["@type"] === "WebApplication");
  assertEqual(app.url, "https://easymahjongsolitaire.com/word-search/");
  const faq = blocks.find((b) => b["@type"] === "FAQPage");
  const questions = faq.mainEntity.map((q) => q.name);
  const onPage = [...body.matchAll(/<div class="faq-item">\s*<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
  assertEqual(onPage, questions, "same questions in the same order");
  const flat = body.replace(/\s+/g, " ");
  for (const q of faq.mainEntity) {
    const ans = q.acceptedAnswer.text.replace(/\s+/g, " ");
    assertTrue(flat.includes(ans), `answer on page identical to the JSON-LD one: "${ans.slice(0, 40)}…"`);
  }
});

test("site shell: goal, status, toolbar, ad slots after controls, footer fence, cross-game links, modals, toasts", () => {
  assertTrue(/<main id="word-search">/.test(body));
  assertTrue(/class="ws-goal"/.test(body) && /class="ws-status" id="ws-status" aria-live="polite"/.test(body));
  assertTrue(/<div class="ws-board" id="ws-board" dir="ltr">/.test(body), "board is dir=ltr");
  assertTrue(/role="toolbar"/.test(body));
  for (const id of ["ws-hint-btn", "ws-new-btn", "ws-today-btn", "ws-settings-btn"]) assertTrue(body.includes(`id="${id}"`), id);
  const iBoard = body.indexOf('id="ws-board"'), iControls = body.indexOf('role="toolbar"'), iAd = body.indexOf('class="ad-slot'), iContent = body.indexOf('<section class="content"');
  assertTrue(iBoard < iControls && iControls < iAd && iAd < iContent, "board → controls → ad slots → content");
  assertEqual((body.match(/class="ad-slot /g) || []).length, 2, "two ad slots");
  assertTrue(html.includes("<!-- games:footer -->") && html.includes("<!-- /games:footer -->"), "footer fence");
  for (const m of body.matchAll(/<a [^>]*data-crossgame-to="[^"]+"[^>]*>/g)) {
    assertTrue(/data-placement="(footer|win_modal|top_nav|top_nav_brand)"/.test(m[0]), "placement on " + m[0]);
  }
  assertTrue(/data-crossgame-to="mahjong" data-placement="win_modal"/.test(body), "win modal cross-game link");
  assertEqual((body.match(/class="settings-panel"/g) || []).length, 1);
  assertEqual((body.match(/id="ws-win-modal"/g) || []).length, 1);
  assertEqual((body.match(/id="ws-confirm-modal"/g) || []).length, 1);
  assertTrue(body.includes('id="ws-toasts"'));
  assertTrue(/<fieldset class="settings-row">\s*<legend class="settings-label" data-i18n="language">/.test(body), "language row is first in settings");
  assertTrue(body.indexOf('id="ws-lang-grid"') < body.indexOf('name="ws-size"'), "language row before size");
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
  assertTrue(/<main id="word-search">\s*<h1 class="game-title"[^>]*>Word Search<\/h1>/.test(body), "h1.game-title is the first thing in <main>");
  assertTrue(body.indexOf("<h1") < body.indexOf('class="ws-goal"'), "the h1 comes before the goal line");
  assertTrue(/<nav class="site-nav" id="site-nav"[^>]*data-nav-from="word_search"/.test(body), "the bar names this page's game");
  assertTrue(/<div class="nav-panel" id="nav-panel" data-open="false">/.test(body), "the panel opens on data-open");
  // The count comes from games.json, not from a literal: the panel has to
  // hold EVERY registered game, and a new game must not need an edit here.
  const registered = JSON.parse(readFileSync(path.join(root, "../games.json"), "utf8")).games.length;
  assertEqual((body.match(/<a class="game-card"/g) || []).length, registered,
    `one panel card per game in games.json (${registered})`);
  assertTrue(/<a class="game-card" href="\/word-search\/" aria-current="page">/.test(body), "this game's card is aria-current");
  assertTrue(body.includes('class="nav-now" data-i18n="playingNow"'), 'and says "Playing now" in words');
  assertTrue(/id="nav-lang-grid"/.test(body) &&
    body.indexOf('class="nav-card-grid"') < body.indexOf('id="nav-lang-section"'),
    "the language grid is in the panel, after the cards");
});

test("stylesheet: every selector is .ws-/#ws-/#word-search scoped, no bare element selectors, no site selector redefined", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  for (const sel of rules) {
    if (sel.startsWith("@") || /^\d+%|^from$|^to$/.test(sel)) continue;
    for (const part of sel.split(",")) {
      const p = part.trim();
      assertTrue(/^(\.ws-|#ws-|#word-search)/.test(p), `scoped selector: "${p}"`);
      assertTrue(!/^(\.btn|\.modal-|\.settings-|\.segmented|\.toggle-row|\.site-|\.achievement-toast|\.content|\.faq-item)/.test(p), "site selector " + p);
    }
  }
  assertTrue(css.includes("isolation: isolate"), "board panel isolates its z-indexes");
  assertTrue(css.includes("prefers-reduced-motion"), "reduced motion honoured");
  assertTrue(/#ws-settings-panel \.lang-grid/.test(css) && /#ws-settings-panel \.lang-btn/.test(css), "language grid styled");
});

test("i18n: every data-i18n / data-i18n-attr key on the page exists in strings.en or common.en", async () => {
  const { strings } = await import("../src/i18n/strings.js");
  const { common } = await import("../../i18n/common.js");
  const known = (k) => k in strings.en || k in common.en;
  const keys = [...body.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  assertTrue(keys.length >= 30, "the page is translated (" + keys.length + " keys)");
  for (const k of keys) assertTrue(known(k), "data-i18n key " + k);
  for (const m of body.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(";")) {
      const [attr, k] = pair.split(":").map((s) => s.trim());
      assertTrue(attr && known(k), "data-i18n-attr key " + k);
    }
  }
  // Keys main.js speaks: setStatus("key"), t("key") — and the goal/size-note keys it swaps in.
  const spoken = new Set([...js.matchAll(/\b(?:t|setStatus)\("([A-Za-z]+)"/g)].map((m) => m[1]));
  for (const k of ["goalEasy", "goalAll", "sizeNote", "sizeNoteNoLarge", "todayBadge", "dailyBadge", "puzzleNo", "winNote", "solvedCount", "chipFound"]) spoken.add(k);
  for (const k of spoken) assertTrue(known(k), "key spoken by main.js: " + k);
  // Every theme id is a key too.
  const { THEMES } = await import("../src/game/words.js");
  for (const th of THEMES) assertTrue(th.id in strings.en, "theme key " + th.id);
});

test("main.js has no English literals in the status line or toasts, imports the shared i18n runtime and re-renders on change", () => {
  assertTrue(js.includes('from "/i18n/i18n.js"') && js.includes('from "/i18n/common.js"'));
  assertTrue(js.includes("i18n.applyStatic()") && js.includes("i18n.renderPicker(") && js.includes("i18n.onChange("));
  assertTrue(!/setStatus\(\s*[`"'][^"'`]*\s[^"'`]*[`"']/.test(js), "setStatus() is given a key, never a sentence");
  assertTrue(!/toast\(\s*[`"']/.test(js), "toast() is given t(...)");
  assertTrue(!/statusEl\.textContent\s*=\s*[`"']/.test(js), "status never set from a literal");
});

test("analytics and ads: game_name word_search, game_start/game_win/cross_game_click, hints through requestRewardedHint, interstitial at game over", () => {
  assertTrue(js.includes('game_name: "word_search"'));
  assertEqual((js.match(/trackEvent\("game_start"/g) || []).length, 1, "game_start fires from one place");
  assertEqual((js.match(/trackEvent\("game_win"/g) || []).length, 1);
  assertTrue(js.includes('trackEvent("cross_game_click"'));
  assertTrue(js.includes("ads.requestRewardedHint()") && js.includes('ads.showInterstitial("game_over")'));
  const ads = readFileSync(path.join(root, "src/core/ads.js"), "utf8");
  for (const fn of ["preloadInterstitial", "showInterstitial", "requestRewardedHint"]) assertTrue(ads.includes(`export function ${fn}`), fn);
});

test("storage: keys under wordSearch.v1, only storage.js touches localStorage", () => {
  const storage = readFileSync(path.join(root, "src/core/storage.js"), "utf8");
  assertTrue(storage.includes('"wordSearch.v1"'));
  for (const f of ["src/main.js", "src/core/audio.js", "src/core/ads.js", "src/game/wordsearch.js", "src/game/words.js", "src/i18n/strings.js"]) {
    assertTrue(!readFileSync(path.join(root, f), "utf8").includes("localStorage"), f + " must not touch localStorage");
  }
});

// ---- long-form content (/i18n/TRANSLATING.md) --------------------------
//
// The .content article is the SEO copy, so its English stays in the markup
// and a translation REPLACES it — data-i18n-content, not data-i18n. The
// rules that apply to every page on the site are in tools/i18n-check.mjs
// (it also covers the pages that have no suite of their own); what is here
// is this page: every block a reader reads is keyed, the article declares
// the module those keys live in, and that module is complete for whatever
// languages it declares.
test("i18n: every block of the .content article is keyed, and nothing in it is left as unkeyed prose", () => {
  const at = body.indexOf('<section class="content"');
  const article = body.slice(at, body.indexOf("</section>", at));
  assertTrue(/data-i18n-module="\/word-search\/src\/i18n\/content\.js"/.test(article),
    "the article declares /word-search/src/i18n/content.js");
  assertTrue(/data-i18n-lang/.test(article), "…and data-i18n-lang, so its lang/dir follow the translation");
  assertTrue(/<section class="content" lang="en" dir="ltr"/.test(article),
    "…while shipping as lang=en dir=ltr, which is what a crawler gets");
  // Every heading, paragraph and list item a visitor reads.
  const unkeyed = [...article.matchAll(/<(h2|h3|p|li)((?:\s[^>]*)?)>/g)]
    .filter((m) => !/data-i18n-content="/.test(m[2]))
    .map((m) => m[0]);
  assertEqual(unkeyed, [], "unkeyed blocks in the article");
  // The h1 is chrome, and translates out of the shared /i18n/games.js so
  // the name matches the footer link and the Games panel card. The <title>,
  // the <meta> tags and the JSON-LD stay English deliberately.
  assertTrue(body.includes('<h1 class="game-title" data-i18n-content="game.word-search.name">Word Search</h1>'), "the h1 is keyed to the shared game name");
  assertTrue(!/<title>[^<]*data-i18n/.test(body) && !/<meta[^>]*data-i18n/.test(body),
    "the head is untouched by i18n");
  const keys = [...article.matchAll(/data-i18n-content="([^"]+)"/g)].map((m) => m[1]);
  assertEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], "a key is used once per page");
});

test("i18n: src/i18n/content.js holds no English, and every language in it is complete", async () => {
  const { content } = await import("../src/i18n/content.js");
  const { LANG_CODES } = await import("../../i18n/i18n.js");
  assertTrue(!("en" in content),
    "no `en` block — the English is the markup, and a copy of it here would drift from what ranks");
  const at = body.indexOf('<section class="content"');
  const article = body.slice(at, body.indexOf("</section>", at));
  const wanted = [...article.matchAll(/data-i18n-content="([^"]+)"/g)].map((m) => m[1]);
  assertTrue(wanted.length > 10, `the article is really keyed (${wanted.length} keys)`);
  for (const [code, dict] of Object.entries(content)) {
    assertTrue(LANG_CODES.includes(code), `"${code}" is one of the site's languages`);
    // All or nothing: a page half in Word Search's language and half in English
    // is worse than a page in English, so a partial language fails here
    // rather than shipping.
    assertEqual(wanted.filter((k) => !(k in dict)), [], `${code} is missing keys`);
    assertEqual(Object.keys(dict).filter((k) => !wanted.includes(k)), [], `${code} has keys the page does not use`);
  }
});
