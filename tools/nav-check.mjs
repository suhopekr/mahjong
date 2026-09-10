// tools/nav-check.mjs — the static half of "the top bar is really on every
// page". Run on its own, or as one section of tools/site-check.mjs:
//
//   node tools/nav-check.mjs
//
// The bar and the Games panel are generated markup (tools/sync-games.mjs,
// <!-- games:nav --> fences) plus one small module (/nav.js) plus one block
// of CSS. That means three ways to get it wrong that no unit suite would
// notice: a page nobody added the fence to, a page that loads the markup but
// not the module, and a page still carrying the old green .site-header — the
// last one silently doubles the site's chrome. Each is one line here.
//
// DESIGN.md "Site navigation" §9 is the checklist this covers statically;
// the rest of it (48px hit tests, sticky/scroll-away, focus, RTL) is
// tools/qa/nav_qa.py in a real browser.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(path.join(root, "games.json"), "utf8"));
const GAMES = registry.games;

// The pages that share the site shell but are not games. Everything else
// comes out of games.json.
const NON_GAME_PAGES = [
  "about.html", "contact.html", "privacy.html", "terms.html",
  "guides/index.html", "guides/how-to-play-mahjong-solitaire.html",
];

let pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; return true; }
  fail++; console.log("  FAIL - " + what); return false;
}
function section(t) { console.log("\n" + t); }

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules" || name === "crazygames" || name === "tools") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith(".html")) yield p;
  }
}
const rel = (f) => path.relative(root, f).split(path.sep).join("/");
const strip = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

const pageFile = (g) => (g.path.endsWith("/") ? g.path.slice(1) + "index.html" : g.path.slice(1));

/** Every page that must carry the bar: the site-shell games, plus the pages
 *  that share the shell. The standalone builds are converted by their own
 *  pass; they are checked here only once they have a fence. */
const shellGames = GAMES.filter((g) => g.check?.shell !== "standalone");
const expected = [
  ...shellGames.map(pageFile),
  ...NON_GAME_PAGES,
];

/** The full-viewport portal builds (DESIGN.md §6). They carry the same bar
 *  and the same panel, and none of the site shell around it: no <main>, no
 *  skip link, no .game-title h1 — their own home screen is the h1, and the
 *  screens behind it have their own. So the checks below that are about the
 *  SHELL are asked of shell pages only, and everything about the bar, the
 *  panel and the cards is asked of both. */
const STANDALONE = new Set(GAMES.filter((g) => g.check?.shell === "standalone").map(pageFile));

// --- the shared machinery ---------------------------------------------------

section("shared machinery");
ok(existsSync(path.join(root, "nav.js")), "/nav.js exists");
{
  const nav = readFileSync(path.join(root, "nav.js"), "utf8");
  // The CSP forbids a style attribute arriving through innerHTML; setting
  // el.style.x from JS is fine, so only the string form is a problem here.
  ok(!/style="/.test(nav), '/nav.js writes no style="" into markup');
  ok(!/setAttribute\(\s*["']style/.test(nav), "/nav.js never setAttribute('style', …)");
  // It must not be the thing that lists the games — the cards come from the
  // fence so they work with JavaScript off.
  for (const g of GAMES) {
    ok(!nav.includes(`"${g.path}"`) && !nav.includes(`'${g.path}'`) || g.path === "/",
      `/nav.js does not hard-code ${g.name}'s path`);
  }
  ok(nav.includes('from "/i18n/i18n.js"') && nav.includes('from "/i18n/common.js"'),
    "/nav.js uses the shared i18n runtime");
  for (const ev of ["nav_open", "language_change"]) ok(nav.includes(`"${ev}"`), `/nav.js sends ${ev}`);
}
{
  const css = readFileSync(path.join(root, "style.css"), "utf8");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/\.site-header/.test(rules), "style.css has no .site-header rules left");
  for (const sel of [".site-nav", ".site-nav-inner", ".nav-brand", ".nav-btn", ".nav-panel",
    ".nav-panel-head", ".nav-panel-body", ".nav-card-grid", ".nav-now", ".nav-lang", ".game-title"]) {
    ok(rules.includes(sel), `style.css defines ${sel}`);
  }
  ok(/--nav-h:\s*56px/.test(rules) && /--nav-h:\s*64px/.test(rules), "--nav-h is 56px, 64px at 768px+");
  // Logical properties only in the bar, so Arabic mirrors for free.
  const bar = rules.slice(rules.indexOf(".site-nav {"), rules.indexOf(".game-title {"));
  ok(!/\b(margin|padding)-(left|right)\s*:/.test(bar), "the bar uses logical properties, never left/right");
}
{
  const common = readFileSync(path.join(root, "i18n/common.js"), "utf8");
  for (const key of ["games", "close", "language", "playingNow", "languageReload"]) {
    ok(common.includes(key + ":"), `/i18n/common.js has the bar's "${key}"`);
  }
}

// --- every page -------------------------------------------------------------

const seen = new Set();
for (const file of htmlFiles(root)) {
  const raw = readFileSync(file, "utf8");
  const html = strip(raw);
  const name = rel(file);
  const hasFence = raw.includes("<!-- games:nav -->") && raw.includes("<!-- /games:nav -->");
  const mustHave = expected.includes(name);
  if (!hasFence && !mustHave) continue;   // a standalone page, not converted yet
  seen.add(name);
  section(name);

  if (!ok(hasFence, "has the <!-- games:nav --> fence")) continue;

  // The old chrome is gone. Both of these on one page means two site headers.
  ok(!/class="site-header"/.test(html), "no .site-header left");
  ok(!/class="tagline"/.test(html), "no .tagline left");

  ok(/<script type="module" src="\/nav\.js"><\/script>/.test(html), "loads /nav.js as a module");

  if (!STANDALONE.has(name)) {
    // Exactly one h1, and it is the first heading in the reading order.
    const h1s = [...html.matchAll(/<h1[\s>]/g)];
    ok(h1s.length === 1, `exactly one <h1> (found ${h1s.length})`);
    // First heading in the reading order, ignoring the panel's own h2/h3 —
    // the panel is display:none until it is opened, so it is not in the
    // heading outline anyone reads, and its markup has to sit with the bar in
    // the fence.
    const outsideFence = html.slice(0, html.indexOf("<nav class=\"site-nav\"")) +
      html.slice(html.indexOf("</div>", html.indexOf('id="nav-lang-section"')));
    const headings = [...outsideFence.matchAll(/<h([1-6])[\s>]/g)];
    ok(headings.length > 0 && headings[0][1] === "1", "the h1 is the first heading in the page's own content");
    const h1 = html.match(/<h1 class="([^"]+)"/);
    // Two treatments, one rule (DESIGN.md §5 + the design review): a page
    // with a board gets .game-title (small and quiet, because the board is
    // the hierarchy); a page whose content IS the page — About, Contact,
    // Privacy, Terms, the guides index and a guide itself — gets the
    // page-title ramp, because there the h1 is the page's real title.
    ok(h1 && /\b(game-title|page-title|article-title)\b/.test(h1[1]),
      `the h1 is .game-title on a game page, .page-title / .article-title on a content page — got ${h1 ? h1[1] : "no class"}`);
    const mainAt = html.indexOf("<main");
    ok(mainAt > -1 && html.indexOf("<h1") > mainAt, "the h1 is inside <main>");
    // …and first in it (the guide article opens with its breadcrumb).
    const afterMain = html.slice(html.indexOf(">", mainAt) + 1).trim();
    ok(afterMain.startsWith("<h1") || afterMain.startsWith("<article"),
      "the h1 (or, on a guide, the article that opens with it) is first in <main>");

    // The skip link still comes first, above the bar, and still targets the board.
    ok(html.indexOf('class="skip-link') < html.indexOf('class="site-nav'), "the skip link is above the bar");
  } else {
    // A standalone build: the bar is the first thing in the body, the game
    // owns everything under it, and the row it takes has to be given back
    // during play — which is a src/main.js job (body[data-nav="hidden"]) and
    // is measured in tools/qa/standalone_nav_qa.py. What can be checked from
    // here is that the two halves of it exist and that the game's own
    // stylesheet carries the dark override rather than restyling the shared
    // one (DESIGN.md §6).
    ok(html.indexOf('class="site-nav"') < html.indexOf('id="app"'),
      "the bar is above the game, first in the body");
    ok(!/More free games/.test(html), 'no "More free games →" line left on the home screen');
    // The bar's own rules can come from /style.css or be restated locally —
    // that is each build's own call. What is NOT optional is that the game's
    // stylesheet owns the two things only it can know: how the row is given
    // back during play, and what the bar looks like on a dark page.
    const own = readFileSync(path.join(root, path.dirname(name), "style.css"), "utf8");
    ok(html.includes('href="/style.css"') || /\.site-nav\s*\{/.test(own),
      "the bar's rules are reachable from this page");
    ok(/body\[data-nav="hidden"\]\s*\.site-nav\s*\{\s*display:\s*none/.test(own),
      "its stylesheet takes the bar's row away during play");
    // The --nav-* palette is a CHOICE, not a requirement. Three of the four
    // standalone builds are permanently dark, so their bar overrides all
    // three values; /dots-and-boxes/ deliberately overrides none of them —
    // its bar is the site's cream chrome on all four board skins, the same
    // bar the other fifteen pages have (design review). What is not a
    // choice is overriding the set PARTLY: a cream background under a
    // near-white ink, or a dark field with the site's deep-green hairline,
    // is the drift this check exists to catch.
    const navVars = ["--nav-bg", "--nav-ink", "--nav-border"].filter((v) => own.includes(v + ":"));
    ok(navVars.length === 0 || navVars.length === 3,
      `its bar palette is all-or-nothing — got ${navVars.length ? navVars.join(" ") : "the site's own (no override)"}`);
    // Whichever way it went, the MARK is never re-tinted: a deep-green tile
    // with two cream shapes is the badge on every page, and one brand that
    // looks like three is what the review found and undid here.
    ok(!/--nav-mark-(bg|ink):/.test(own),
      "it does not re-tint the brand mark (DESIGN.md §6a)");
    ok(/#app\s*\{[^}]*flex:\s*1 1 auto/.test(own), "#app is the flex row that gets what is left");
    const game = GAMES.find((g) => pageFile(g) === name);
    // The toggle itself, in the game's own runtime. Whether it is written as
    // dataset.nav or as a setAttribute is the build's business.
    ok(/dataset\.nav|data-nav/.test(readFileSync(path.join(root, path.dirname(name), "src/main.js"), "utf8")),
      `${game.name}'s main.js sets body[data-nav]`);
  }

  // The bar itself.
  const fence = raw.slice(raw.indexOf("<!-- games:nav -->"), raw.indexOf("<!-- /games:nav -->"));
  ok(/<nav class="site-nav" id="site-nav"[^>]*data-nav-from="[a-z_]+"/.test(fence), "the bar declares data-nav-from");
  ok(fence.includes('id="link-crossgame-home"') && fence.includes('class="nav-brand" href="/"'),
    'the wordmark is <a class="nav-brand" href="/" id="link-crossgame-home">');
  ok(fence.includes('<span class="b-easy">Easy</span>') && fence.includes('<span class="b-classics">Classics</span>'),
    "the wordmark is text, never an image");
  ok(/id="nav-games"[^>]*aria-haspopup="dialog"/.test(fence.replace(/\n\s+/g, " ")) &&
    /id="nav-games"[^>]*aria-expanded="false"/.test(fence.replace(/\n\s+/g, " ")),
    "Games is a button with aria-haspopup/aria-expanded");
  ok(fence.includes('data-i18n="games"') && fence.includes('data-i18n="close"') &&
    fence.includes('data-i18n="language"'), "the bar's own strings are translated");

  // The panel.
  ok(/<div class="nav-panel" id="nav-panel" data-open="false">/.test(fence), "the panel opens on data-open");
  ok(/role="dialog" aria-modal="true"/.test(fence) && fence.includes('aria-labelledby="nav-panel-title"'),
    "the sheet is a labelled modal dialog");
  ok(fence.includes('tabindex="-1"'), "the sheet can take focus");
  ok(fence.includes('id="nav-lang-grid"'), "the language grid is in the panel");
  ok(fence.indexOf('class="nav-card-grid"') < fence.indexOf('id="nav-lang-section"'),
    "the language grid comes after the game cards");

  // Eleven cards, in games.json order, each one able to reserve its space.
  const cards = [...fence.matchAll(/<a class="game-card" href="([^"]+)"/g)].map((m) => m[1]);
  ok(cards.join("|") === GAMES.map((g) => g.path).join("|"),
    `all ${GAMES.length} cards in games.json order (got ${cards.length})`);
  const thumbs = [...fence.matchAll(/<img class="game-card-thumb"[^>]*>/g)];
  ok(thumbs.length === GAMES.length && thumbs.every((m) => /width="\d+"/.test(m[0]) && /height="\d+"/.test(m[0])),
    "every thumb carries width and height (CLS 0 on open)");

  // The current game: aria-current AND the words, never the tint alone.
  const game = GAMES.find((g) => g.path === "/" + name.replace(/index\.html$/, ""));
  const currents = [...fence.matchAll(/aria-current="page"/g)];
  if (game) {
    ok(currents.length === 1, `the current game's card is marked once (got ${currents.length})`);
    ok(fence.includes('class="nav-now" data-i18n="playingNow"'), 'and says "Playing now"');
  } else {
    ok(currents.length === 0, "no card is marked current on a page that is not a game");
  }

  // Panel cards are plain cross-game links with the new placement.
  for (const m of fence.matchAll(/<a class="game-card"[^>]*>/g)) {
    if (/aria-current/.test(m[0])) continue;
    if (!/data-crossgame-to/.test(m[0])) continue;   // same game (the daily board)
    ok(/data-placement="top_nav"/.test(m[0]), "panel card placement is top_nav: " + m[0].slice(0, 60));
  }

  // The brand title carries the site name, the <title> the keywords.
  ok(/<title>[^<]*Easy Classics<\/title>/.test(html), "the <title> ends with the brand");
}

section("coverage");
for (const name of expected) ok(seen.has(name), `${name} carries the bar`);
{
  const pending = GAMES.filter((g) => g.check?.shell === "standalone")
    .filter((g) => !seen.has(g.path.slice(1) + "index.html"));
  if (pending.length) {
    console.log("  note - standalone builds not converted yet (their own pass): " +
      pending.map((g) => g.name).join(", "));
  }
}
{
  // The front page is the page that ranks; its h1 is not the brand.
  const index = strip(readFileSync(path.join(root, "index.html"), "utf8"));
  ok(index.includes('<h1 class="game-title">Free Mahjong Solitaire</h1>'),
    'the front page h1 is still "Free Mahjong Solitaire"');
  ok(/"@type":\s*"WebSite"/.test(index) && /"name":\s*"Easy Classics"/.test(index) && /alternateName/.test(index),
    "the front page carries WebSite JSON-LD naming the brand");
  for (const f of expected.filter((n) => n !== "index.html")) {
    ok(!/"@type":\s*"WebSite"/.test(readFileSync(path.join(root, f), "utf8")),
      `${f} does not repeat the WebSite block`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
