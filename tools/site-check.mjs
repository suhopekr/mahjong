// tools/site-check.mjs — the integration check for the whole site.
//
//   node tools/site-check.mjs            static checks + a real browser
//   node tools/site-check.mjs --static   static checks only (no Playwright)
//
// Every game's own unit suite (<game>/test/run.js) proves the game. This
// proves the SITE around the games — the part that breaks when a page is
// added by hand and one of eight footers is forgotten, or when a page that
// worked under python's server loses its stylesheet to the deployed CSP.
// The page list comes from games.json, so a new game is checked the moment
// it is registered.
//
// STATIC (reads files):
//   - games.json ↔ footers/cards/sitemap in sync (tools/sync-games.mjs --check)
//   - every registered page exists, has a canonical that matches its path,
//     a description, og:image that exists on disk, GA4 via /ga-init.js
//   - no inline <style>, no style="" attributes, no on*="" handlers, no
//     inline <script> except JSON-LD — the CSP in vercel.json admits none
//   - no script/stylesheet from a host the CSP does not allow
//   - JSON-LD parses; WebApplication.url matches the page
//   - a site-shell page has the footer fence; a standalone game page links
//     home from the top bar's wordmark (#link-crossgame-home, DESIGN.md §2)
//     and carries no "More free games" line any more
//   - card thumbnails exist and are small; every card path is a real page
//   - the top bar and the Games panel (tools/nav-check.mjs)
//   - the translations (tools/i18n-check.mjs): every block a visitor reads
//     is keyed, every content module is complete for the languages it
//     declares, no English is duplicated into a dictionary, and
//     privacy.html / terms.html translate nothing
//
// BROWSER (Playwright, Chromium, phone + desktop viewport, under the
// vercel.json headers so the CSP is real):
//   - the page loads with no console errors, no page errors, and no failed
//     same-origin request (GA / Vercel Insights are external and skipped)
//   - pressing the registered "play" control (or just loading, for games
//     that boot straight onto a board) produces exactly one game_start
//     carrying that page's game_name
//   - the cross-game links report cross_game_click with the right `to` and
//     `placement`, on site-shell pages and from the standalone builds'
//     wordmark alike
//   - the footer names every game, in games.json order
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startServer, root } from "./serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(readFileSync(path.join(root, "games.json"), "utf8"));
const GAMES = registry.games;
const staticOnly = process.argv.includes("--static");

let pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; return true; }
  fail++; console.log("  FAIL - " + what); return false;
}
function section(title) { console.log("\n" + title); }

// --- helpers --------------------------------------------------------------

function fileOf(urlPath) {
  return path.join(root, urlPath.endsWith("/") ? urlPath + "index.html" : urlPath);
}
function stripComments(html) { return html.replace(/<!--[\s\S]*?-->/g, ""); }
function cspSources(directive) {
  const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
  const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy").value;
  const part = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(directive + " "));
  return part ? part.split(/\s+/).slice(1) : [];
}
const scriptHosts = cspSources("script-src").filter((s) => s.startsWith("http")).map((s) => new URL(s).host);
const styleHosts = cspSources("style-src").filter((s) => s.startsWith("http")).map((s) => new URL(s).host);

// --- static -----------------------------------------------------------------

section("registry ↔ pages");
{
  const r = spawnSync(process.execPath, [path.join(here, "sync-games.mjs"), "--check"], { encoding: "utf8" });
  ok(r.status === 0, "games.json is in sync with footers/cards/sitemap\n    " + (r.stderr || r.stdout).trim().replace(/\n/g, "\n    "));
}

for (const g of GAMES) {
  section(`${g.name}  ${g.path}`);
  const file = fileOf(g.path);
  if (!ok(existsSync(file), `page exists: ${path.relative(root, file)}`)) continue;
  const raw = readFileSync(file, "utf8");
  const html = stripComments(raw);
  const url = registry.site + g.path;

  // head
  ok(html.includes(`<link rel="canonical" href="${url}">`), `canonical is ${url}`);
  ok(/<meta name="description" content="[^"]{40,}">/.test(html), "meta description (40+ chars)");
  const og = html.match(/<meta property="og:image" content="([^"]+)">/);
  ok(og && og[1].startsWith(registry.site + "/") && existsSync(path.join(root, og[1].slice(registry.site.length))),
    `og:image is an absolute site URL to a file that exists (${og ? og[1] : "missing"})`);
  ok(html.includes('src="/ga-init.js"') && html.includes("googletagmanager.com/gtag/js?id="), "GA4 via the shared /ga-init.js");

  // CSP hygiene
  ok(!/<style[\s>]/.test(html), "no inline <style>");
  ok(!/\sstyle="/.test(html), 'no style="" attributes');
  ok(!/\son[a-z]+="/i.test(html), 'no on*="" handlers');
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)].filter((m) => !/type="application\/ld\+json"/.test(m[1]));
  ok(inlineScripts.length === 0, "no inline <script> other than JSON-LD");
  for (const m of html.matchAll(/<script[^>]*\ssrc="(https?:\/\/[^"]+)"/g)) {
    ok(scriptHosts.includes(new URL(m[1]).host), `external script host allowed by CSP: ${m[1]}`);
  }
  for (const m of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="(https?:\/\/[^"]+)"/g)) {
    ok(styleHosts.includes(new URL(m[1]).host), `external stylesheet host allowed by CSP: ${m[1]}`);
  }
  for (const m of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) {
    if (m[1].startsWith("http")) continue;
    const css = m[1].startsWith("/") ? path.join(root, m[1]) : path.join(path.dirname(file), m[1]);
    ok(existsSync(css), `stylesheet exists: ${m[1]}`);
  }

  // JSON-LD
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  // A game's landing page carries JSON-LD; a secondary page of the same game
  // (the daily board, track: false) need not, but whatever it does carry must
  // parse.
  if (g.track !== false) ok(lds.length >= 1, "has JSON-LD");
  for (const m of lds) {
    let data = null;
    try { data = JSON.parse(m[1]); } catch (e) { ok(false, "JSON-LD parses: " + e.message); continue; }
    if (data["@type"] === "WebApplication") ok(data.url === url, `WebApplication.url is ${url}`);
  }

  // shell
  if (g.check?.shell === "standalone") {
    // The one way home used to be a "More free games →" link on the game's
    // own home screen. The top bar's wordmark is its heir — same id, same
    // href, same event, better placement (DESIGN.md §2) — so this still
    // checks that a standalone page links home, at the address it now
    // lives at, and that the old line is really gone rather than doubled.
    ok(/<a class="nav-brand" href="\/" id="link-crossgame-home"/.test(html),
      'standalone page links home from the bar: <a class="nav-brand" href="/" id="link-crossgame-home">');
    ok(!/More free games/.test(html), 'no "More free games" line left over');
    ok(/<script type="module" src="\/nav\.js"><\/script>/.test(html), "loads /nav.js as a module");
    ok(!/<!-- games:footer -->/.test(raw), "standalone page has no site footer fence (it has no site footer)");
    ok(!/sdk\.crazygames\.com/.test(html), "no CrazyGames SDK");
  } else {
    ok(/<!-- games:footer -->/.test(raw), "site-shell page has the footer fence");
    const footer = raw.slice(raw.indexOf("<!-- games:footer -->"), raw.indexOf("<!-- /games:footer -->"));
    for (const other of GAMES) ok(footer.includes(`href="${other.path}"`), `footer links ${other.name}`);
  }

  // card
  if (g.card) {
    const thumb = path.join(root, g.card.thumb);
    ok(existsSync(thumb), `card thumb exists: ${g.card.thumb}`);
    if (existsSync(thumb)) ok(statSync(thumb).size < 150 * 1024, `card thumb under 150 KB (${Math.round(statSync(thumb).size / 1024)} KB)`);
    // Every game has a card now (the Games panel needs eleven), but the
    // front page's own card is not on the front page.
    if (g.path !== "/") {
      const index = stripComments(readFileSync(path.join(root, "index.html"), "utf8"));
      ok(index.includes(`<a class="game-card" href="${g.path}"`), "front page has its card");
    }
  }

  // sitemap
  if (g.sitemap) {
    const sm = readFileSync(path.join(root, "sitemap.xml"), "utf8");
    ok(sm.includes(`<loc>${url}</loc>`), "listed in sitemap.xml");
  }
}

section("navigation (tools/nav-check.mjs)");
{
  const r = spawnSync(process.execPath, [path.join(here, "nav-check.mjs")], { encoding: "utf8" });
  if (!ok(r.status === 0, "the top bar and the Games panel are in place on every page")) {
    console.log("    " + (r.stdout + r.stderr).trim().replace(/\n/g, "\n    "));
  }
}

section("languages (tools/i18n-check.mjs)");
{
  const r = spawnSync(process.execPath, [path.join(here, "i18n-check.mjs")], { encoding: "utf8" });
  if (!ok(r.status === 0, "every page's long-form text is keyed, and every content module is complete")) {
    console.log("    " + (r.stdout + r.stderr).trim().replace(/\n/g, "\n    "));
  }
}

section("game unit suites are present");
for (const g of GAMES.filter((x) => x.check?.shell === "standalone")) {
  ok(existsSync(path.join(fileOf(g.path), "..", "test", "run.js")), `${g.name}: test/run.js`);
}

// --- the harness itself -----------------------------------------------------
//
// WHY THIS IS A SITE CHECK AND NOT A TEST IN ONE GAME.
//
// test/harness.js is copied between games, not shared, so a guard living
// inside one game's suite proves nothing about the other eight. It was
// copied while it was wrong: `test()` called fn() and counted a pass the
// moment it RETURNED, which for an `async () =>` test is the moment it
// STARTS. Eleven tests across four games (solitaire, freecell,
// word-search and eight-ball-pool page.test.js) were printing ok without
// their assertions ever being awaited, and the totals those suites
// reported counted them.
//
// A harness cannot check itself with its own counters, so this drives
// each game's copy directly: four tests, two of which throw, one of each
// pair async, and the run has to come back saying two ok and two FAIL.
// The async failure is the whole point — under the old harness it was an
// ok line plus an unhandled rejection nobody read.
section("every game's test harness awaits an async test");
// Every game that HAS a harness, not just the standalone ones: the four
// suites this bug was actually hiding tests in are all site-shell games,
// so the filter the section above uses would have missed every one of
// them.
for (const g of GAMES) {
  const harness = path.join(fileOf(g.path), "..", "test", "harness.js");
  if (!existsSync(harness)) continue;
  // A fresh module instance per game, so its pass/fail counters are its
  // own and nothing here touches the counters a real run would use.
  const h = await import(`${pathToFileURL(harness).href}?site-check=${encodeURIComponent(g.name)}`);
  ok(typeof h.drain === "function", `${g.name}: harness exports drain() for run.js to await`);
  const lines = [];
  const escaped = [];
  const realLog = console.log;
  // A harness that does not await gets its rejection back as an
  // unhandled one, which would take this process down mid-section. Held
  // here so it is reported as the failure it is instead.
  const onEscape = (err) => escaped.push(err);
  process.on("unhandledRejection", onEscape);
  console.log = (...a) => lines.push(a.join(" "));
  try {
    h.test("sync pass", () => {});
    h.test("sync fail", () => { throw new Error("sync boom"); });
    h.test("async pass", async () => { await Promise.resolve(); });
    h.test("async fail", async () => { await Promise.resolve(); throw new Error("async boom"); });
    if (typeof h.drain === "function") await h.drain();
    // Two turns of the microtask queue: long enough for an un-awaited
    // test's rejection to have escaped, so the assertions below see it.
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.log = realLog;
    process.off("unhandledRejection", onEscape);
  }
  const said = (needle) => lines.some((l) => l.includes(needle));
  ok(said("ok - sync pass") && said("ok - async pass"), `${g.name}: a passing test still passes`);
  ok(said("FAIL - sync fail") && said("sync boom"), `${g.name}: a sync failure is reported with its message`);
  ok(
    said("FAIL - async fail") && said("async boom"),
    `${g.name}: an async failure is counted as a failure, not printed as ok`
  );
  ok(!said("ok - async fail"), `${g.name}: an async failure is never also reported ok`);
  ok(escaped.length === 0, `${g.name}: an async failure never escapes as an unhandled rejection`);
}

// --- browser ----------------------------------------------------------------

if (!staticOnly) {
  let chromium;
  try {
    const require = createRequire(import.meta.url);
    const mod = await import(require.resolve("playwright"));
    chromium = mod.chromium || mod.default?.chromium;
    if (!chromium) throw new Error("playwright resolved but exports no chromium");
  } catch (e) {
    console.log(`\nPlaywright is not usable under tools/ (${e.message}) — run \`npm --prefix tools install\`, or pass --static.`);
    fail++;
  }
  if (chromium) {
    const { server, port } = await startServer(0);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();
    const EXTERNAL = /googletagmanager|google-analytics|_vercel\/insights/;
    const viewports = [
      { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      { name: "desktop", viewport: { width: 1280, height: 800 } },
    ];
    for (const g of GAMES) {
      for (const vp of viewports) {
        section(`${g.name}  ${g.path}  [${vp.name}]`);
        const ctx = await browser.newContext(vp);
        const page = await ctx.newPage();
        const errors = [], failed = [];
        page.on("console", (m) => { if (m.type() === "error" && !EXTERNAL.test(m.text()) && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
        page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
        page.on("requestfailed", (r) => { if (!EXTERNAL.test(r.url())) failed.push(`${r.url()} ${r.failure()?.errorText}`); });
        page.on("response", (r) => { if (r.status() >= 400 && !EXTERNAL.test(r.url())) failed.push(`${r.status()} ${r.url()}`); });
        try {
          await page.goto(base + g.path, { waitUntil: "networkidle", timeout: 30000 });
          await page.waitForTimeout(600);
          if (g.check?.play) {
            await page.click(g.check.play, { timeout: 5000 });
            await page.waitForTimeout(1200);
          }
          const events = await page.evaluate(() =>
            (window.dataLayer || []).filter((a) => a[0] === "event").map((a) => ({ name: a[1], ...(a[2] || {}) })));
          const starts = events.filter((e) => e.name === "game_start");
          ok(starts.length === 1 && starts[0].game_name === g.ga,
            `exactly one game_start with game_name=${g.ga} (got ${JSON.stringify(starts)})`);

          if (g.check?.shell === "standalone") {
            // The wordmark, heir to the old home link: present, reports the
            // right direction and placement, then really navigates. Clicked
            // through the element rather than the mouse because by this point
            // the "play" control has been pressed and the bar has given its
            // row back to the table — which is the behaviour under test in
            // tools/qa/standalone_nav_qa.py, not a reason to skip this.
            const report = await page.evaluate(() => {
              const el = document.getElementById("link-crossgame-home");
              if (!el) return "missing";
              el.addEventListener("click", (e) => e.preventDefault(), { once: true });
              el.click();
              const ev = (window.dataLayer || []).filter((a) => a[0] === "event" && a[1] === "cross_game_click").pop();
              return ev ? JSON.stringify(ev[2]) : "no event";
            });
            ok(report.includes(`"from":"${g.ga}"`) && report.includes('"to":"mahjong"') &&
               report.includes('"placement":"top_nav_brand"'),
              `the wordmark reports from=${g.ga} to=mahjong placement=top_nav_brand (${report})`);
            // The panel's cards are the rest of the site from here, and they
            // are wired by the game's own copy of wireCrossGameLinks().
            const card = await page.evaluate(() => {
              const el = document.querySelector('.nav-card-grid a[data-crossgame-to]');
              if (!el) return "no panel card";
              el.addEventListener("click", (e) => e.preventDefault(), { once: true });
              el.click();
              const ev = (window.dataLayer || []).filter((a) => a[0] === "event" && a[1] === "cross_game_click").pop();
              return ev ? { to: ev[2].to, placement: ev[2].placement, expected: el.dataset.crossgameTo } : "no event";
            });
            ok(typeof card === "object" && card.to === card.expected && card.placement === "top_nav",
              `a panel card reports to=${card.expected} placement=top_nav (${JSON.stringify(card)})`);
          } else {
            const links = await page.evaluate(() => [...document.querySelectorAll("a[data-crossgame-to]")].map((el) => ({
              to: el.dataset.crossgameTo, placement: el.dataset.placement, href: el.getAttribute("href") })));
            ok(links.length >= GAMES.length - 2, `has cross-game links (${links.length})`);
            const footer = await page.evaluate(() => [...document.querySelectorAll(".footer-nav-links a")].map((a) => a.textContent.trim()));
            for (const other of GAMES) ok(footer.includes(other.name), `footer shows ${other.name}`);
            ok(footer.filter((n) => GAMES.some((x) => x.name === n)).join("|") === GAMES.map((x) => x.name).join("|"), "footer lists games in games.json order");
            // Click one footer link with navigation held back; the report must name it.
            const tracked = await page.evaluate(() => {
              const el = document.querySelector('.footer-nav-links a[data-crossgame-to]');
              if (!el) return "no tracked footer link";
              el.addEventListener("click", (e) => e.preventDefault(), { once: true });
              el.click();
              const ev = (window.dataLayer || []).filter((a) => a[0] === "event" && a[1] === "cross_game_click").pop();
              return ev ? { to: ev[2].to, placement: ev[2].placement, expected: el.dataset.crossgameTo } : "no event";
            });
            ok(typeof tracked === "object" && tracked.to === tracked.expected && tracked.placement === "footer",
              `footer link click reports to=${tracked.expected} placement=footer (${JSON.stringify(tracked)})`);
          }
        } catch (e) {
          ok(false, "page drove without error: " + e.message.split("\n")[0]);
        }
        ok(errors.length === 0, "no console/page errors" + (errors.length ? "\n    " + errors.join("\n    ") : ""));
        ok(failed.length === 0, "no failed same-origin requests" + (failed.length ? "\n    " + failed.join("\n    ") : ""));
        await ctx.close();
      }
    }
    await browser.close();
    server.close();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
