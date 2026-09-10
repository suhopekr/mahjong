// tools/i18n-check.mjs — the static half of "everything a visitor reads
// translates, and nothing that must not be translated is". Run on its own,
// or as one section of tools/site-check.mjs:
//
//   node tools/i18n-check.mjs           check
//   node tools/i18n-check.mjs --keys    print each page's module and keys,
//                                       in order — the translator's worklist
//
// WHY THIS IS A SITE CHECK AND NOT ONLY A TEST IN EACH GAME.
//
// Four of the ten translated pages have no test suite of their own at all
// (index.html and daily.html are driven by /game.js, /about.html and
// /contact.html by nothing but /nav.js), and /five-in-a-row/ has no test
// directory either. A rule that lived in <game>/test/page.test.js would
// therefore be enforced on five pages and unenforced on five, which for a
// mechanism whose whole point is that a translator can work through pages
// mechanically is the worst of both. So the rules that apply to EVERY page
// live here, once; a game's own page.test.js keeps the checks that are
// about that page's shape.
//
// The mechanism it guards (/i18n/i18n.js, /i18n/TRANSLATING.md):
//
//   - short UI words → data-i18n, English in /i18n/common.js AND in the
//     markup, and the two must agree (each game's page.test.js).
//   - long-form copy → data-i18n-content, English ONLY in the markup,
//     translations in a per-page module fetched only for a non-English
//     language. So: no `en` in a content module, ever, and no English
//     paragraph copied into one.
//   - game names and card descriptions → data-i18n-content too, but out of
//     /i18n/games.js, whose `en` block is GENERATED from games.json by
//     tools/sync-games.mjs. That file is the one content module with an
//     `en`, because there the English is not markup — it is the registry —
//     and being generated it cannot drift. Checked here against games.json.
//   - privacy.html and terms.html translate nothing of their own.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(path.join(root, "games.json"), "utf8"));
const GAMES = registry.games;
const keysOnly = process.argv.includes("--keys");

/** The pages that must stay wholly English, and why (the comment at the top
 *  of each says the same thing to whoever opens the file). */
const ENGLISH_ONLY = ["privacy.html", "terms.html"];

/** /i18n/games.js owns every key under this prefix, on every page; a page's
 *  own module owns everything else. One rule, so a translator never has to
 *  ask which file a key is in. */
const GAME_PREFIX = "game.";

let pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; return true; }
  fail++; console.log("  FAIL - " + what); return false;
}
function section(t) { if (!keysOnly) console.log("\n" + t); }

const rel = (f) => path.relative(root, f).split(path.sep).join("/");
const strip = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const squash = (s) => s.replace(/\s+/g, " ").trim();

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules" || name === "crazygames" || name === "tools") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith(".html")) yield p;
  }
}

/** Every data-i18n-content on a page, in document order, with the English
 *  the markup ships with. Content blocks never nest, so the element's own
 *  closing tag is the next one of its kind. */
function contentKeys(html) {
  const out = [];
  const re = /<([a-z0-9]+)((?:\s[^>]*)?)\sdata-i18n-content="([^"]+)"((?:\s[^>]*)?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const [full, tag, , key] = m;
    const at = m.index + full.length;
    const close = html.indexOf(`</${tag}>`, at);
    out.push({ key, tag, english: close < 0 ? "" : html.slice(at, close) });
  }
  return out;
}

/** The absolute-path content module a page declared, if any. */
function declaredModule(html) {
  const m = html.match(/data-i18n-module="([^"]+)"/);
  return m ? m[1] : null;
}

async function loadModule(urlPath) {
  const file = path.join(root, urlPath.replace(/^\//, ""));
  if (!existsSync(file)) return { error: "no such file: " + urlPath };
  try {
    const mod = await import(pathToFileURL(file).href);
    const content = mod.content ?? mod.default;
    if (!content || typeof content !== "object") return { error: urlPath + " exports no `content` object" };
    return { content };
  } catch (e) {
    return { error: `${urlPath} does not import: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// the pages that translate, and the module each one uses
// ---------------------------------------------------------------------------

const PAGES = [];
for (const file of htmlFiles(root)) {
  const html = strip(readFileSync(file, "utf8"));
  const keys = contentKeys(html).filter((k) => !k.key.startsWith(GAME_PREFIX));
  const mod = declaredModule(html);
  if (!keys.length && !mod) continue;
  PAGES.push({ name: rel(file), file, html, keys, module: mod });
}

if (keysOnly) {
  const games = await loadModule("/i18n/games.js");
  console.log("# the translator's worklist — generated by `node tools/i18n-check.mjs --keys`\n");
  console.log("/i18n/common.js   (short UI words; English is in the table, fill the other 13)");
  const { PENDING } = await import(pathToFileURL(path.join(root, "i18n/common.js")).href);
  for (const k of PENDING) console.log("    " + k + "   (awaiting every language)");
  console.log("\n/i18n/games.js    (game names + card descriptions; `en` is generated, do not edit it)");
  for (const k of Object.keys(games.content?.en || {})) console.log("    " + k);
  for (const p of PAGES) {
    console.log(`\n${p.module}\n    for ${p.name === "index.html" ? "/" : "/" + p.name.replace(/index\.html$/, "")}`);
    for (const k of p.keys) console.log("    " + k.key);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// the shared machinery
// ---------------------------------------------------------------------------

section("shared machinery");
{
  const rt = readFileSync(path.join(root, "i18n/i18n.js"), "utf8");
  ok(rt.includes("[data-i18n-content]"), "/i18n/i18n.js handles data-i18n-content");
  ok(/import\(url\)/.test(rt), "…by dynamic import() of the declared module");
  ok(/lang === "en"/.test(rt) && /return null/.test(rt),
    "…and never looks a content key up in English (English is the markup)");
  ok(rt.includes("authoredHtml"),
    "…keeping the authored English so switching back to English restores it");
  // innerHTML is unavoidable here (whole paragraphs with our own <strong>),
  // so the reason has to be written down where someone would otherwise have
  // to guess whether it is safe.
  const at = rt.indexOf("el.innerHTML = next");
  const nearby = rt.slice(Math.max(0, at - 1200), at);
  ok(at > -1 && /trust|injection|repository/i.test(nearby),
    "the innerHTML in applyContent carries a comment about why it is trusted");
  ok(rt.includes("useContent"), "createI18n exposes useContent()");
}
{
  const nav = readFileSync(path.join(root, "nav.js"), "utf8");
  ok(nav.includes('i18n.useContent("/i18n/games.js"'), "/nav.js registers /i18n/games.js");
  ok(nav.includes("[data-i18n-module]"), "/nav.js registers whatever the page declared");
  // Nothing in JS lists pages, the same rule the games have.
  ok(!/\/i18n\/pages\//.test(nav), "/nav.js does not hard-code a page's module path");
}
{
  // /i18n/games.js: one registry, so its `en` is games.json, generated.
  const games = await loadModule("/i18n/games.js");
  if (ok(!games.error, "/i18n/games.js imports: " + (games.error || "ok"))) {
    const en = games.content.en || {};
    const expected = {};
    for (const g of GAMES) {
      expected[`${GAME_PREFIX}${g.key}.name`] = g.name;
      expected[`${GAME_PREFIX}${g.key}.desc`] = g.card.desc;
    }
    ok(JSON.stringify(en) === JSON.stringify(expected),
      "its `en` block is games.json, key for key — run `npm --prefix tools run sync`");
    for (const [code, dict] of Object.entries(games.content)) {
      if (code === "en") continue;
      const missing = Object.keys(expected).filter((k) => !(k in dict));
      ok(missing.length === 0, `games.js ${code} has every game (missing: ${missing.join(", ")})`);
      const extra = Object.keys(dict).filter((k) => !(k in expected));
      ok(extra.length === 0, `games.js ${code} names no game the registry does not (${extra.join(", ")})`);
    }
  }
}
{
  // PENDING is a to-do list, not a loophole: a key may sit on it only while
  // some language is still missing it.
  const { common, PENDING } = await import(pathToFileURL(path.join(root, "i18n/common.js")).href);
  const others = Object.keys(common).filter((c) => c !== "en");
  ok(Array.isArray(PENDING), "/i18n/common.js exports PENDING");
  for (const k of PENDING) {
    ok(k in common.en, `PENDING key "${k}" exists in common.en`);
    ok(others.some((c) => !(k in common[c])),
      `PENDING key "${k}" is still missing somewhere — take it off the list once every language has it`);
  }
  for (const k of Object.keys(common.en)) {
    if (PENDING.includes(k)) continue;
    const gaps = others.filter((c) => !(k in common[c]));
    ok(gaps.length === 0, `common.en "${k}" is translated everywhere, or listed in PENDING (missing: ${gaps.join(", ")})`);
  }
}

// ---------------------------------------------------------------------------
// every translated page
// ---------------------------------------------------------------------------

/** Tag names used in a value, as a set — a translator must keep our own
 *  <strong>/<em>/<a>, and must not invent new ones. */
const tagsIn = (s) => [...new Set([...String(s).matchAll(/<([a-z][a-z0-9]*)/g)].map((m) => m[1]))].sort();
const hrefsIn = (s) => [...String(s).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

for (const page of PAGES) {
  section(page.name);
  if (!ok(page.module, "declares its content module on the block it belongs to")) continue;
  ok(page.keys.length > 0, `has keyed content (${page.keys.length} keys)`);

  // The wrapper whose lang/dir follow the translation.
  ok(/data-i18n-lang/.test(page.html), "the .content block carries data-i18n-lang");
  ok(/<section class="content"[^>]*lang="en"[^>]*dir="ltr"/.test(page.html),
    "…and ships as lang=en dir=ltr, which is what a crawler gets");

  // Keys are unique per page: two blocks sharing a key means a translator
  // cannot give them different words.
  const dupes = page.keys.map((k) => k.key).filter((k, i, a) => a.indexOf(k) !== i);
  ok(dupes.length === 0, "no key is used twice on the page (" + dupes.join(", ") + ")");

  // No key is empty in the markup — the English IS the source.
  for (const k of page.keys) ok(squash(k.english).length > 0, `${k.key} has English in the markup`);

  const mod = await loadModule(page.module);
  if (!ok(!mod.error, "its module imports: " + (mod.error || "ok"))) continue;

  ok(!("en" in mod.content),
    "the module has no `en` — English lives in the markup and must not be copied here");
  for (const code of Object.keys(mod.content)) {
    const { LANG_CODES } = await import(pathToFileURL(path.join(root, "i18n/i18n.js")).href);
    ok(LANG_CODES.includes(code), `"${code}" is one of the site's languages`);
  }

  const wanted = page.keys.map((k) => k.key);
  const englishOf = new Map(page.keys.map((k) => [k.key, squash(k.english)]));
  for (const [code, dict] of Object.entries(mod.content)) {
    const have = Object.keys(dict);
    // ALL OR NOTHING. Half a page in Korean and half in English is the
    // failure mode this exists to stop; the fix is to finish the language
    // or to remove it, never to ship the mixture.
    const missing = wanted.filter((k) => !have.includes(k));
    ok(missing.length === 0,
      `${code} is complete — a language here must carry every key the page uses (missing: ${missing.join(", ")})`);
    const extra = have.filter((k) => !wanted.includes(k));
    ok(extra.length === 0, `${code} has no key the page does not use (${extra.join(", ")})`);

    for (const [k, v] of Object.entries(dict)) {
      if (!wanted.includes(k)) continue;
      ok(typeof v === "string" && v.trim().length > 0, `${code}.${k} is non-empty text`);
      if (typeof v !== "string") continue;
      // The English is the markup. A value equal to it is a copy that will
      // drift the first time the English is edited.
      ok(squash(v) !== englishOf.get(k),
        `${code}.${k} is not the English copied over — leave the key out and the markup shows through`);
      // These values go through innerHTML, and the site's CSP admits no
      // inline style and no inline script. A translator pasting from a
      // word processor is exactly how one arrives.
      ok(!/\sstyle="/.test(v), `${code}.${k} carries no style="" (CSP style-src 'self')`);
      ok(!/<script|<\/script|\son[a-z]+\s*=/i.test(v), `${code}.${k} carries no script or on* handler`);
      ok(!/<(iframe|object|embed|link|meta|form|input)\b/i.test(v), `${code}.${k} carries no embedded or interactive markup`);
      // Same tags as the English, same link targets.
      const en = englishOf.get(k) || "";
      ok(tagsIn(v).join(",") === tagsIn(en).join(","),
        `${code}.${k} keeps the English tags (${tagsIn(en).join(",") || "none"}), got ${tagsIn(v).join(",") || "none"}`);
      ok(hrefsIn(v).join("|") === hrefsIn(en).join("|"),
        `${code}.${k} keeps every href exactly as the English has it`);
    }
  }
}

// ---------------------------------------------------------------------------
// the pages that must not translate
// ---------------------------------------------------------------------------

section("English-only pages");
for (const name of ENGLISH_ONLY) {
  const raw = readFileSync(path.join(root, name), "utf8");
  const html = strip(raw);
  // Only the page's OWN text: the bar, the Games panel and the footer around
  // it are the same generated chrome as everywhere else and do translate.
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  ok(main.length > 100, `${name}: found its <main>`);
  ok(!/data-i18n/.test(main), `${name}: no translation attribute anywhere in its own text`);
  ok(!/data-i18n-module/.test(html), `${name}: declares no content module`);
  ok(!existsSync(path.join(root, "i18n/pages", name.replace(".html", ".js"))),
    `${name}: has no content module file either`);
  // And the reason, at the top of the file, so the next person does not
  // "finish the job".
  ok(/THIS PAGE STAYS IN ENGLISH/.test(raw.slice(0, 1200)),
    `${name}: says at the top of the file that this is deliberate, and why`);
}

// ---------------------------------------------------------------------------
// the FAQ and its JSON-LD still line up
// ---------------------------------------------------------------------------
//
// Each game's page.test.js already asserts this, and keying the FAQ moved
// every <h3> and <p> it reads. Asserting it here as well covers index.html
// and /five-in-a-row/, which have a FAQPage block and no suite of their own,
// and makes "the structured data still matches the visible English" a
// property of the site rather than of five games.

section("FAQ ↔ FAQPage JSON-LD");
for (const file of htmlFiles(root)) {
  const html = strip(readFileSync(file, "utf8"));
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  const faqRaw = blocks.map((m) => m[1]).find((t) => /"FAQPage"/.test(t));
  if (!faqRaw) continue;
  const name = rel(file);
  let faq;
  try { faq = JSON.parse(faqRaw); } catch (e) { ok(false, `${name}: FAQPage JSON-LD parses (${e.message})`); continue; }
  const questions = faq.mainEntity.map((q) => q.name);
  const onPage = [...html.matchAll(/<div class="faq-item">\s*<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => squash(m[1]));
  ok(JSON.stringify(onPage) === JSON.stringify(questions),
    `${name}: the FAQ questions on the page are the JSON-LD's, in order\n    page: ${JSON.stringify(onPage)}\n    ld:   ${JSON.stringify(questions)}`);
  const flat = squash(html);
  for (const q of faq.mainEntity) {
    const words = q.acceptedAnswer.text.split(/\s+/).slice(0, 6).join(" ");
    ok(flat.includes(words), `${name}: the answer to "${q.name}" is on the page in English`);
  }
  // The structured data is English on purpose — it is what search engines
  // read — so it must never carry a translation attribute of its own.
  ok(!/data-i18n/.test(faqRaw), `${name}: the JSON-LD itself is untouched by i18n`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
