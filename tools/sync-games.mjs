// tools/sync-games.mjs — writes everything that lists the site's games from
// games.json, so a new game is one registry entry and one run of this:
//
//   node tools/sync-games.mjs          rewrite the generated blocks
//   node tools/sync-games.mjs --check  exit 1 if anything is out of date
//
// Three kinds of block, each fenced by HTML/XML comments the script looks
// for and REPLACES — everything outside the fences is untouched:
//
//   <!-- games:footer -->  …  <!-- /games:footer -->   every page's footer,
//                                                     the Games column
//   <!-- games:cards -->   …  <!-- /games:cards -->    index.html, the
//                                                     More Free Games grid
//   <!-- games:sitemap --> …  <!-- /games:sitemap -->  sitemap.xml
//
// A page without a fence is left alone (the standalone game pages have no
// site footer — they carry a single "More free games" link instead).
//
// Cross-game links carry data-crossgame-to / data-placement instead of
// per-link ids, and game.js / five-in-a-row/src/main.js wire every
// a[data-crossgame-to] on the page — so nothing in JS lists games either.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(path.join(root, "games.json"), "utf8"));
const GAMES = registry.games;
const check = process.argv.includes("--check");

// --- what each page's blocks should contain ---------------------------------

/** URL path a page file is served at (Vercel: directory index, clean .html). */
function urlOf(file) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return "/" + rel.slice(0, -"index.html".length);
  return "/" + rel;
}

function footerBlock(pageUrl, indent) {
  return GAMES.map((g) => {
    const current = g.path === pageUrl;
    // track: false — a page of the same game (the daily board), not a
    // cross-game link, so no cross_game_click for it.
    const attrs = current
      ? ` aria-current="page"`
      : g.track === false ? "" : ` data-crossgame-to="${g.ga}" data-placement="footer"`;
    return `${indent}<a href="${g.path}"${attrs}>${g.name}</a>`;
  }).join("\n");
}

function cardsBlock(indent) {
  return GAMES.filter((g) => g.card).map((g) => {
    const c = g.card;
    return [
      `${indent}<li>`,
      `${indent}  <a class="game-card" href="${g.path}" data-crossgame-to="${g.ga}" data-placement="card_section">`,
      `${indent}    <img class="game-card-thumb" src="${c.thumb}" width="${c.size}" height="${c.size}"`,
      `${indent}         alt="${c.alt}" decoding="async" loading="lazy">`,
      `${indent}    <span class="game-card-body">`,
      `${indent}      <span class="game-card-title">${g.name}</span>`,
      `${indent}      <span class="game-card-desc">${c.desc}</span>`,
      `${indent}    </span>`,
      `${indent}  </a>`,
      `${indent}</li>`,
    ].join("\n");
  }).join("\n");
}

function sitemapBlock(indent) {
  return GAMES.filter((g) => g.sitemap).map((g) => [
    `${indent}<url>`,
    `${indent}  <loc>${registry.site}${g.path}</loc>`,
    `${indent}  <changefreq>${g.sitemap.changefreq}</changefreq>`,
    `${indent}  <priority>${g.sitemap.priority}</priority>`,
    `${indent}</url>`,
  ].join("\n")).join("\n");
}

// --- fence replacement ------------------------------------------------------

/** Replace the body of `<!-- games:NAME -->…<!-- /games:NAME -->`. The
 * fences keep their own lines; the body is regenerated at the indent of
 * the opening fence. Returns null when the file has no such fence. */
function replaceFence(text, name, makeBody) {
  const re = new RegExp(`^([ \\t]*)<!-- games:${name} -->\\n[\\s\\S]*?^[ \\t]*<!-- /games:${name} -->`, "m");
  const m = text.match(re);
  if (!m) return null;
  const indent = m[1];
  const body = makeBody(indent);
  return text.replace(re, `${indent}<!-- games:${name} -->\n${body}\n${indent}<!-- /games:${name} -->`);
}

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules" || name === "crazygames") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith(".html") || name === "sitemap.xml") yield p;
  }
}

// --- run --------------------------------------------------------------------

let touched = 0, stale = [];
for (const file of htmlFiles(root)) {
  const before = readFileSync(file, "utf8");
  let after = before;
  const pageUrl = urlOf(file);
  for (const [name, make] of [
    ["footer", (indent) => footerBlock(pageUrl, indent)],
    ["cards", cardsBlock],
    ["sitemap", sitemapBlock],
  ]) {
    const next = replaceFence(after, name, make);
    if (next !== null) after = next;
  }
  if (after === before) continue;
  const rel = path.relative(root, file);
  if (check) stale.push(rel);
  else { writeFileSync(file, after); touched++; console.log("updated", rel); }
}

if (check) {
  if (stale.length) {
    console.error("games.json and these files disagree — run `node tools/sync-games.mjs`:\n  " + stale.join("\n  "));
    process.exit(1);
  }
  console.log("games.json ↔ pages: in sync");
} else {
  console.log(touched ? `${touched} file(s) rewritten` : "nothing to change");
}
