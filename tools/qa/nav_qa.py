"""Browser QA for the site navigation — DESIGN.md "Site navigation" §9.

    python3 tools/qa/nav_qa.py            checks + screenshots
    python3 tools/qa/nav_qa.py --quick    checks only, no screenshots

Node's Playwright is not installed under tools/, so this is the Python one.
It serves the site through tools/serve.mjs, which applies vercel.json's real
headers — the Content-Security-Policy included, so a stray inline style or a
module that fails to load fails here the way it would in production.

Every one of the eight site-shell pages is driven at four sizes (iPhone SE,
iPhone 14, iPad Air portrait, laptop) and checked for:

  - no console errors, no page errors, no horizontal overflow
  - the bar is 56px under 768px and 64px above, every control hit-tests 48px+
    (52px+ above 768px) — measured from the client rect, not read off a
    computed style
  - the bar scrolls away under 768px and sticks at 768px and up
  - Games opens the panel, aria-expanded flips, focus lands on the sheet
  - eleven cards, in games.json order, the current one marked with
    aria-current AND the words "Playing now"
  - 1 column at 375, 2 at 820, 3 at 1280; Close still on screen after
    scrolling the whole list
  - Escape and Close both close it and put focus back on Games
  - exactly one game_start on load, and nav_open when the panel opens

and once per page, at 390x844:

  - a card really navigates
  - the language grid switches, says so in the new language, and the choice
    survives the reload
  - Arabic mirrors the bar and the panel while the board stays dir="ltr"

Screenshots land in tools/qa/out/nav/ and are meant to be looked at.
"""
import json, re, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 8162
OUT = ROOT / "tools/qa/out/nav"

REGISTRY = json.loads((ROOT / "games.json").read_text())
GAMES = REGISTRY["games"]
ORDER = [g["path"] for g in GAMES]

# The eight site-shell pages this pass owns. (about/contact/privacy/terms and
# the guides share the shell too and are covered by tools/nav-check.mjs; the
# three standalone builds are a separate pass.)
PAGES = [
    ("/", "mahjong", "#board-viewport"),
    ("/daily.html", "mahjong", "#board-viewport"),
    ("/solitaire/", "solitaire", "#sol-table"),
    ("/freecell/", "freecell", "#fc-table"),
    ("/word-search/", "word_search", "#ws-board"),
    ("/five-in-a-row/", "five_in_a_row", "#fir-board-wrap"),
    ("/backgammon/", "backgammon", "#bg-board"),
    ("/eight-ball-pool/", "eight_ball_pool", "#pool-board"),
]

VIEWPORTS = [
    ("375x667", 375, 667, 2),    # iPhone SE — the tightest real phone
    ("390x844", 390, 844, 2),    # iPhone 14
    ("820x1180", 820, 1180, 2),  # iPad Air, portrait — sticky starts here
    ("1280x800", 1280, 800, 1),  # laptop
]

EXTERNAL = re.compile(r"googletagmanager|google-analytics|_vercel/insights")

results = []


def ok(cond, what):
    results.append((bool(cond), what))
    if not cond:
        print("  FAIL - " + what)
    return bool(cond)


def slug(path):
    return "home" if path == "/" else path.strip("/").replace("/", "-").replace(".html", "")


def new_page(browser, w, h, dsf, base, errors):
    ctx = browser.new_context(viewport={"width": w, "height": h},
                             device_scale_factor=dsf,
                             is_mobile=w < 768, has_touch=w < 768,
                             base_url=base)
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text[:200])
          if m.type == "error" and not EXTERNAL.search(m.text)
          and "Failed to load resource" not in m.text else None)
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:200]))
    return ctx, pg


def dismiss_modals(pg):
    """Some pages open a modal on load (Mahjong's "Welcome back" when a game
    is saved). The panel deliberately refuses to open over one, so a run that
    revisits a page has to answer it first — same as a person would."""
    for _ in range(3):
        n = pg.evaluate("""() => { const m = [...document.querySelectorAll('.modal-overlay[data-open=\"true\"]')].pop();
            if (!m) return 0; const b = m.querySelector('.modal-actions .btn'); if (b) b.click();
            else m.dataset.open = 'false'; return 1; }""")
        if not n:
            return
        pg.wait_for_timeout(250)


def events(pg):
    return pg.evaluate("""() => (window.dataLayer || [])
        .filter(a => a[0] === 'event').map(a => ({name: a[1], ...(a[2] || {})}))""")


def rect(pg, sel):
    return pg.evaluate("""(s) => { const el = document.querySelector(s); if (!el) return null;
        const r = el.getBoundingClientRect(); return {w: r.width, h: r.height, x: r.x, y: r.y}; }""", sel)


def run_viewport(browser, base, path, ga, board, label, w, h, dsf, shots):
    errors = []
    ctx, pg = new_page(browser, w, h, dsf, base, errors)
    tag = f"{slug(path)} [{label}]"
    print("\n" + tag)
    try:
        pg.goto(base + path, wait_until="networkidle", timeout=30000)
        pg.wait_for_timeout(500)

        # --- the page itself -------------------------------------------------
        ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
           f"{tag}: no horizontal overflow")
        starts = [e for e in events(pg) if e["name"] == "game_start"]
        ok(len(starts) == 1 and starts[0].get("game_name") == ga,
           f"{tag}: exactly one game_start (game_name={ga}) — got {starts}")

        # --- the bar ---------------------------------------------------------
        inner = rect(pg, ".site-nav-inner")
        want = 64 if w >= 768 else 56
        ok(inner and abs(inner["h"] - want) < 1.5, f"{tag}: the bar is {want}px (got {inner and round(inner['h'], 1)})")
        floor = 52 if w >= 768 else 48
        for sel in ["#nav-games", "#nav-lang"]:
            r = rect(pg, sel)
            ok(r and r["h"] >= floor - 0.5 and r["w"] >= 48,
               f"{tag}: {sel} hit-tests {floor}px+ (got {r and (round(r['w']), round(r['h']))})")
        brand = rect(pg, ".nav-brand")
        ok(brand and brand["h"] >= 44, f"{tag}: the wordmark is a 44px+ target")
        ok(pg.evaluate("!!document.querySelector('.nav-brand .b-easy') && !!document.querySelector('.nav-brand .b-classics')"),
           f"{tag}: the words never degrade")

        # sticky above 768, scrolls away below
        pg.evaluate("window.scrollTo(0, 400)")
        pg.wait_for_timeout(250)
        top = rect(pg, ".site-nav")["y"]
        if w >= 768:
            ok(top >= -1, f"{tag}: the bar sticks (top={round(top, 1)})")
        else:
            ok(top < -10 or pg.evaluate("window.scrollY") < 10,
               f"{tag}: the bar scrolls away (top={round(top, 1)})")
        pg.evaluate("window.scrollTo(0, 0)")
        pg.wait_for_timeout(200)

        if shots:
            pg.screenshot(path=str(OUT / f"{slug(path)}-{label}-top.png"))

        # --- opening the panel -----------------------------------------------
        pg.click("#nav-games")
        pg.wait_for_timeout(300)
        ok(pg.get_attribute("#nav-panel", "data-open") == "true", f"{tag}: Games opens the panel")
        ok(pg.get_attribute("#nav-games", "aria-expanded") == "true", f"{tag}: aria-expanded flips")
        ok(pg.evaluate("document.activeElement && document.activeElement.id") == "nav-panel-sheet",
           f"{tag}: focus lands on the sheet")
        ok(pg.evaluate("!!document.querySelector('.nav-panel-sheet[role=dialog][aria-modal=true]')"),
           f"{tag}: the sheet announces itself as a dialog")
        opened = [e for e in events(pg) if e["name"] == "nav_open"]
        ok(len(opened) == 1 and opened[0].get("placement") == "top_nav",
           f"{tag}: nav_open placement=top_nav — got {opened}")

        hrefs = pg.eval_on_selector_all(".nav-card-grid a.game-card", "els => els.map(e => e.getAttribute('href'))")
        ok(hrefs == ORDER, f"{tag}: all {len(ORDER)} cards in games.json order (got {len(hrefs)})")
        cur = pg.eval_on_selector_all(".nav-card-grid a[aria-current='page']", "els => els.map(e => e.getAttribute('href'))")
        ok(cur == [path], f"{tag}: the current game is marked — got {cur}")
        ok(pg.evaluate("""() => { const a = document.querySelector(".nav-card-grid a[aria-current='page']");
            return !!a && /\\S/.test(a.querySelector('.nav-now')?.textContent || ''); }"""),
           f"{tag}: and says it in words, not by tint alone")

        cols = pg.evaluate("""() => getComputedStyle(document.querySelector('.nav-card-grid'))
            .gridTemplateColumns.split(' ').length""")
        want_cols = 3 if w >= 1280 else 2 if w >= 616 else 1
        ok(cols == want_cols, f"{tag}: {want_cols} column(s) in the panel (got {cols})")

        # Close survives the whole list on a short screen.
        pg.evaluate("const b = document.getElementById('nav-panel-body'); b.scrollTop = b.scrollHeight;")
        pg.wait_for_timeout(250)
        close = rect(pg, "#nav-close")
        ok(close and close["y"] >= -1 and close["y"] + close["h"] <= h + 1 and close["h"] >= 48,
           f"{tag}: Close is still on screen at the bottom of the list — {close}")
        ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
           f"{tag}: the open panel does not overflow sideways")

        if shots:
            pg.evaluate("document.getElementById('nav-panel-body').scrollTop = 0")
            pg.wait_for_timeout(200)
            pg.screenshot(path=str(OUT / f"{slug(path)}-{label}-panel.png"))

        # --- Escape, then Close ----------------------------------------------
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(250)
        ok(pg.get_attribute("#nav-panel", "data-open") == "false", f"{tag}: Escape closes")
        ok(pg.evaluate("document.activeElement && document.activeElement.id") == "nav-games",
           f"{tag}: focus returns to Games after Escape")
        pg.click("#nav-games")
        pg.wait_for_timeout(250)
        pg.click("#nav-close")
        pg.wait_for_timeout(250)
        ok(pg.get_attribute("#nav-panel", "data-open") == "false", f"{tag}: Close closes")
        ok(pg.evaluate("document.activeElement && document.activeElement.id") == "nav-games",
           f"{tag}: focus returns to Games after Close")

        # --- the h1 that replaced the banner ---------------------------------
        h1 = pg.evaluate("""() => { const el = document.querySelector('main h1'); if (!el) return null;
            const cs = getComputedStyle(el); return {text: el.textContent.trim(), size: parseFloat(cs.fontSize),
                first: document.querySelectorAll('h1').length}; }""")
        ok(h1 and h1["first"] == 1, f"{tag}: exactly one h1")
        want_size = 22 if w >= 768 else 17
        ok(h1 and abs(h1["size"] - want_size) < 0.6, f"{tag}: the h1 is {want_size}px (got {h1 and h1['size']})")

        ok(not errors, f"{tag}: no console or page errors — {errors}")
    except Exception as e:  # noqa: BLE001
        ok(False, f"{tag}: drove without throwing — {type(e).__name__}: {e}")
    finally:
        ctx.close()


def run_once(browser, base, path, ga, board, shots):
    """The things worth doing once per page, on the phone that matters."""
    errors = []
    ctx, pg = new_page(browser, 390, 844, 2, base, errors)
    tag = f"{slug(path)} [once]"
    print("\n" + tag)
    try:
        # --- a card really navigates -----------------------------------------
        pg.goto(base + path, wait_until="networkidle", timeout=30000)
        pg.wait_for_timeout(400)
        dismiss_modals(pg)
        pg.click("#nav-games")
        pg.wait_for_timeout(250)
        target = pg.eval_on_selector_all(
            ".nav-card-grid a.game-card:not([aria-current])", "els => els[0].getAttribute('href')")
        pg.click(f".nav-card-grid a.game-card[href='{target}']")
        pg.wait_for_load_state("networkidle", timeout=30000)
        ok(pg.url.endswith(target), f"{tag}: a card navigates to {target} (got {pg.url})")

        # --- the language grid ------------------------------------------------
        pg.goto(base + path, wait_until="networkidle", timeout=30000)
        pg.wait_for_timeout(400)
        dismiss_modals(pg)
        pg.click("#nav-lang")
        pg.wait_for_timeout(400)
        ok(pg.get_attribute("#nav-panel", "data-open") == "true", f"{tag}: Language opens the panel")
        # Either the grid is at the top of the panel, or the panel is already
        # scrolled as far as it goes — the grid is the last thing in it, so on
        # a tall screen "as far as it goes" is the best that exists.
        jump = pg.evaluate("""() => { const s = document.getElementById('nav-lang-section');
            const b = document.getElementById('nav-panel-body');
            return {offset: s.getBoundingClientRect().top - b.getBoundingClientRect().top,
                    atEnd: b.scrollTop >= b.scrollHeight - b.clientHeight - 2,
                    visible: s.getBoundingClientRect().top < b.getBoundingClientRect().bottom}; }""")
        ok(jump["visible"] and (-4 <= jump["offset"] <= 24 or jump["atEnd"]),
           f"{tag}: Language jumps to the grid ({jump})")
        ok(pg.eval_on_selector_all("#nav-lang-grid .lang-btn", "e => e.length") == 14,
           f"{tag}: 14 languages")
        ok(pg.evaluate("""() => document.querySelector("#nav-lang-grid .lang-btn[aria-pressed='true']")?.dataset.lang""") == "en",
           f"{tag}: the current language is aria-pressed")
        heights = pg.eval_on_selector_all("#nav-lang-grid .lang-btn",
                                          "els => els.map(e => e.getBoundingClientRect().height)")
        ok(min(heights) >= 55.5, f"{tag}: every language button is 56px (min {min(heights)})")

        pg.click("#nav-lang-grid .lang-btn[data-lang='ko']")
        pg.wait_for_timeout(120)
        ok(pg.evaluate("""() => document.querySelector("#nav-lang-grid .lang-btn[data-lang='ko']").getAttribute('aria-pressed')""") == "true",
           f"{tag}: the tap is acknowledged before anything moves")
        note = pg.text_content("#nav-lang-note") or ""
        ok("한국어" in note, f"{tag}: it says what is happening, in the new language — {note!r}")
        if shots and path == "/solitaire/":
            pg.screenshot(path=str(OUT / "solitaire-375x667-switching.png"))
        pg.wait_for_load_state("networkidle", timeout=30000)
        pg.wait_for_timeout(600)
        ok(pg.evaluate("localStorage.getItem('site.v1.lang')") == "ko", f"{tag}: the choice is saved")
        ok((pg.text_content("#nav-lang") or "").strip() == "한국어", f"{tag}: the bar shows the new language after the reload")
        ok((pg.text_content("#nav-games") or "").strip() == "게임", f"{tag}: the bar itself is translated")
        # /eight-ball-pool/ scrolls its own header off screen at boot
        # (revealTable), so "at the top" is not what it wants to be.
        if ga != "eight_ball_pool":
            ok(pg.evaluate("window.scrollY") < 5, f"{tag}: it comes back at the top")

        # --- Arabic ------------------------------------------------------------
        pg.evaluate("localStorage.setItem('site.v1.lang', 'ar')")
        pg.goto(base + path, wait_until="networkidle", timeout=30000)
        pg.wait_for_timeout(500)
        dismiss_modals(pg)
        ok(pg.evaluate("document.documentElement.dir") == "rtl", f"{tag}: Arabic turns the page right-to-left")
        ok((pg.text_content("#nav-games") or "").strip() == "ألعاب", f"{tag}: the bar is in Arabic")
        geo = pg.evaluate("""() => { const b = document.querySelector('.nav-brand').getBoundingClientRect();
            const g = document.getElementById('nav-games').getBoundingClientRect();
            return {brand: b.x, games: g.x, brandDir: document.querySelector('.nav-brand').getAttribute('dir')}; }""")
        ok(geo["brand"] > geo["games"], f"{tag}: the bar mirrors — wordmark on the right ({geo})")
        ok(geo["brandDir"] == "ltr", f"{tag}: the wordmark itself stays left-to-right")
        bdir = pg.evaluate("(s) => { const el = document.querySelector(s); return el && getComputedStyle(el).direction; }", board)
        ok(bdir == "ltr", f"{tag}: the board stays dir=ltr ({board} -> {bdir})")
        # In rtl the space to the LEFT is the scrollable one, so anything
        # parked off the left edge grows the page. It used to be the skip link.
        ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
           f"{tag}: Arabic does not make the page scroll sideways "
           f"({pg.evaluate('document.documentElement.scrollWidth')}px wide)")
        pg.click("#nav-games")
        pg.wait_for_timeout(300)
        close_x = rect(pg, "#nav-close")["x"]
        head_x = rect(pg, ".nav-panel-head h2")["x"]
        ok(close_x < head_x, f"{tag}: Close is on the left of the panel head in Arabic")
        if shots and path in ("/", "/solitaire/"):
            pg.screenshot(path=str(OUT / f"{slug(path)}-arabic-panel.png"))
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(250)
            pg.screenshot(path=str(OUT / f"{slug(path)}-arabic-top.png"))
        ok(not errors, f"{tag}: no console or page errors — {errors}")
    except Exception as e:  # noqa: BLE001
        ok(False, f"{tag}: drove without throwing — {type(e).__name__}: {e}")
    finally:
        ctx.close()


def main():
    quick = "--quick" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    srv = subprocess.Popen(["node", str(ROOT / "tools/serve.mjs"), f"--port={PORT}"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    base = f"http://127.0.0.1:{PORT}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for path, ga, board in PAGES:
                for label, w, h, dsf in VIEWPORTS:
                    # Screenshots: the phone everywhere, the laptop and the iPad
                    # on the three pages that stand for the rest.
                    shots = (not quick) and (
                        label == "375x667" or (label in ("1280x800", "820x1180")
                                               and path in ("/", "/solitaire/", "/word-search/")))
                    run_viewport(browser, base, path, ga, board, label, w, h, dsf, shots)
                run_once(browser, base, path, ga, board, not quick)
            browser.close()
    finally:
        srv.terminate()

    bad = [w for good, w in results if not good]
    print(f"\n{len(results) - len(bad)} passed, {len(bad)} failed")
    if not quick:
        print(f"screenshots in {OUT}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
