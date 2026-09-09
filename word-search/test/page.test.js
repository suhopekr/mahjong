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
  assertTrue(body.includes("<title>Word Search — Free Online Puzzles, Big Letters, No Download</title>"));
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
  const onPage = [...body.matchAll(/<div class="faq-item">\s*<h3>([^<]+)<\/h3>/g)].map((m) => m[1].trim());
  assertEqual(onPage, questions, "same questions in the same order");
  const flat = body.replace(/\s+/g, " ");
  for (const q of faq.mainEntity) {
    const ans = q.acceptedAnswer.text.replace(/\s+/g, " ");
    assertTrue(flat.includes(ans), `answer on page identical to the JSON-LD one: "${ans.slice(0, 40)}…"`);
  }
});

test("site shell: header, goal, status, toolbar, ad slots after controls, footer fence, cross-game links, modals, toasts", () => {
  assertTrue(/<main id="word-search">/.test(body));
  assertTrue(/<header class="site-header">\s*<h1>Word Search<\/h1>/.test(body));
  assertTrue(/class="ws-goal"/.test(body) && /class="ws-status" id="ws-status" aria-live="polite"/.test(body));
  assertTrue(/<div class="ws-board" id="ws-board" dir="ltr">/.test(body), "board is dir=ltr");
  assertTrue(/role="toolbar"/.test(body));
  for (const id of ["ws-hint-btn", "ws-new-btn", "ws-today-btn", "ws-settings-btn"]) assertTrue(body.includes(`id="${id}"`), id);
  const iBoard = body.indexOf('id="ws-board"'), iControls = body.indexOf('role="toolbar"'), iAd = body.indexOf('class="ad-slot'), iContent = body.indexOf('<section class="content">');
  assertTrue(iBoard < iControls && iControls < iAd && iAd < iContent, "board → controls → ad slots → content");
  assertEqual((body.match(/class="ad-slot /g) || []).length, 2, "two ad slots");
  assertTrue(html.includes("<!-- games:footer -->") && html.includes("<!-- /games:footer -->"), "footer fence");
  for (const m of body.matchAll(/<a [^>]*data-crossgame-to="[^"]+"[^>]*>/g)) {
    assertTrue(/data-placement="(footer|win_modal)"/.test(m[0]), "placement on " + m[0]);
  }
  assertTrue(/data-crossgame-to="mahjong" data-placement="win_modal"/.test(body), "win modal cross-game link");
  assertEqual((body.match(/class="settings-panel"/g) || []).length, 1);
  assertEqual((body.match(/id="ws-win-modal"/g) || []).length, 1);
  assertEqual((body.match(/id="ws-confirm-modal"/g) || []).length, 1);
  assertTrue(body.includes('id="ws-toasts"'));
  assertTrue(/<fieldset class="settings-row">\s*<legend class="settings-label" data-i18n="language">/.test(body), "language row is first in settings");
  assertTrue(body.indexOf('id="ws-lang-grid"') < body.indexOf('name="ws-size"'), "language row before size");
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
