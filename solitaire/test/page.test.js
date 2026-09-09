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
    assertTrue(/data-placement="(footer|win_modal)"/.test(m[0]), "placement on " + m[0]);
  }
  assertEqual((body.match(/class="settings-panel"/g) || []).length, 1);
  assertEqual((body.match(/id="sol-win-modal"/g) || []).length, 1);
});

test("stylesheet: every selector is .sol-/#sol-/#solitaire scoped, no bare element selectors", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  for (const sel of rules) {
    if (sel.startsWith("@") || /^\d+%|^from$|^to$/.test(sel)) continue;
    for (const part of sel.split(",")) {
      const p = part.trim();
      assertTrue(/^(\.sol-|#sol-|#solitaire)/.test(p), `scoped selector: "${p}"`);
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
