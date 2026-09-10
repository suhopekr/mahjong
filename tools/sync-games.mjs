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
//   <!-- games:nav -->     …  <!-- /games:nav -->      the top bar and the
//                                                     Games panel (DESIGN.md
//                                                     "Site navigation")
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

/** The More Free Games grid. Every game has a card now (the panel in the
 *  top bar needs one for all eleven), so the page's OWN game is dropped
 *  here — "More free games" must not offer the page you are already on. */
function cardsBlock(pageUrl, indent) {
  return GAMES.filter((g) => g.card && g.path !== pageUrl).map((g) => {
    const c = g.card;
    return [
      `${indent}<li>`,
      `${indent}  <a class="game-card" href="${g.path}"${g.track === false ? "" : ` data-crossgame-to="${g.ga}" data-placement="card_section"`}>`,
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

/* --- the top bar and the Games panel ---------------------------------------
 * DESIGN.md "Site navigation". The whole thing is generated markup on
 * purpose: the eleven game links must work with JavaScript switched off, so
 * /nav.js only opens, closes, traps focus, runs the language grid and sends
 * the analytics. Nothing in JS lists games.
 *
 * `data-nav-from` is the GA `from` for this page's nav events — a game's own
 * `ga` value, or "site" on the pages that have no game runtime
 * (about/contact/privacy/terms/guides). /nav.js also reads it to decide
 * whether it has to wire the cards' cross_game_click itself: on a game page
 * game.js / <game>/src/main.js already wire every a[data-crossgame-to].
 * ------------------------------------------------------------------------ */

/** The 24px mark: a rounded square holding a cream circle (a tile/piece) and
 *  an offset cream rounded rect (a card). Inline SVG like every favicon here.
 *  The two colours come through custom properties so a dark bar (the three
 *  standalone builds, DESIGN.md §6) can restyle it without new markup. */
const NAV_MARK = [
  `<svg class="nav-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">`,
  `<rect width="24" height="24" rx="6" fill="var(--nav-mark-bg, #0b4a35)"/>`,
  `<circle cx="9" cy="9.5" r="4.2" fill="var(--nav-mark-ink, #f7f2e6)"/>`,
  `<rect x="11" y="11" width="9" height="10" rx="2.2" fill="var(--nav-mark-ink, #f7f2e6)"/>`,
  `</svg>`,
].join("");

function navBlock(pageUrl, indent) {
  const self = GAMES.find((g) => g.path === pageUrl);
  const from = self ? self.ga : "site";
  const i = (n) => indent + "  ".repeat(n);

  const cards = GAMES.map((g) => {
    const current = g.path === pageUrl;
    // Same rule as the footer: the page you are on is a self link, and a page
    // of the same game (the daily board) is not a cross-game click.
    const attrs = current
      ? ` aria-current="page"`
      : g.track === false || g.ga === from ? "" : ` data-crossgame-to="${g.ga}" data-placement="top_nav"`;
    const c = g.card;
    return [
      `${i(4)}<li>`,
      `${i(4)}  <a class="game-card" href="${g.path}"${attrs}>`,
      `${i(4)}    <img class="game-card-thumb" src="${c.thumb}" width="${c.size}" height="${c.size}"`,
      `${i(4)}         alt="${c.alt}" decoding="async" loading="lazy">`,
      `${i(4)}    <span class="game-card-body">`,
      `${i(4)}      <span class="game-card-title">${g.name}</span>`,
      `${i(4)}      <span class="game-card-desc">${c.desc}</span>`,
      current ? `${i(4)}      <span class="nav-now" data-i18n="playingNow">Playing now</span>` : null,
      `${i(4)}    </span>`,
      `${i(4)}  </a>`,
      `${i(4)}</li>`,
    ].filter(Boolean).join("\n");
  }).join("\n");

  // The wordmark is the heir to the standalone pages' "More free games →"
  // link, id and event included. On a Mahjong page it points at the page's
  // own game, so it carries no cross-game attributes there.
  const brandAttrs = from === "mahjong" ? "" : ` data-crossgame-to="mahjong" data-placement="top_nav_brand"`;

  return [
    `${i(0)}<nav class="site-nav" id="site-nav" aria-label="Site" data-nav-from="${from}">`,
    `${i(0)}  <div class="site-nav-inner">`,
    `${i(0)}    <a class="nav-brand" href="/" id="link-crossgame-home"${brandAttrs} dir="ltr">`,
    `${i(0)}      ${NAV_MARK}<span class="nav-words"><span class="b-easy">Easy</span> <span class="b-classics">Classics</span></span></a>`,
    `${i(0)}    <span class="nav-spacer" aria-hidden="true"></span>`,
    `${i(0)}    <button class="btn nav-btn" id="nav-games" type="button" aria-haspopup="dialog"`,
    `${i(0)}            aria-expanded="false" aria-controls="nav-panel" data-i18n="games">Games</button>`,
    `${i(0)}    <button class="btn nav-btn" id="nav-lang" type="button" aria-haspopup="dialog"`,
    `${i(0)}            aria-expanded="false" aria-controls="nav-panel">English</button>`,
    `${i(0)}  </div>`,
    `${i(0)}</nav>`,
    ``,
    `${i(0)}<div class="nav-panel" id="nav-panel" data-open="false">`,
    `${i(0)}  <div class="nav-panel-sheet" id="nav-panel-sheet" role="dialog" aria-modal="true"`,
    `${i(0)}       aria-labelledby="nav-panel-title" tabindex="-1">`,
    `${i(0)}    <div class="nav-panel-head">`,
    `${i(0)}      <h2 id="nav-panel-title" data-i18n="games">Games</h2>`,
    `${i(0)}      <button type="button" class="btn nav-panel-close" id="nav-close" data-i18n="close">Close</button>`,
    `${i(0)}    </div>`,
    `${i(0)}    <div class="nav-panel-body" id="nav-panel-body">`,
    `${i(0)}      <ul class="nav-card-grid">`,
    cards,
    `${i(0)}      </ul>`,
    `${i(0)}      <section class="nav-lang" id="nav-lang-section" aria-labelledby="nav-lang-title">`,
    `${i(0)}        <h3 id="nav-lang-title" data-i18n="language">Language</h3>`,
    `${i(0)}        <div class="lang-grid" id="nav-lang-grid"></div>`,
    `${i(0)}        <p class="nav-lang-note" id="nav-lang-note" aria-live="polite"></p>`,
    `${i(0)}      </section>`,
    `${i(0)}    </div>`,
    `${i(0)}  </div>`,
    `${i(0)}</div>`,
  ].join("\n");
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
    ["cards", (indent) => cardsBlock(pageUrl, indent)],
    ["nav", (indent) => navBlock(pageUrl, indent)],
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
