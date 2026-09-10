"""Browser QA for /dots-and-boxes/ — the ported standalone build.

    python3 tools/qa/dab_qa.py            # all four viewports
    python3 tools/qa/dab_qa.py 375x667    # just one

Runs against tools/serve.mjs, so vercel.json's real Content-Security-Policy
is in force: an inline style or a stray SDK tag fails here the way it fails
in production, not silently.

What it grades, per viewport (DESIGN.md §9's checklist, the parts that need
a real browser, plus this game's own port risks):

  * no console error, no page error, no failed same-origin request
  * no horizontal overflow, on the setup screen, during play, and with the
    Games panel open
  * the top bar is there before a game starts, every control in it hit-tests
    48px (44px on a short landscape screen), and it is GONE during play
  * the canvas is really remeasured when the bar hides: its box has to
    change, not just the attribute
  * exactly one game_start, at the player's own entry (Play), never at boot
  * the Games panel opens from the game's own top row while the bar is
    hidden, reports placement=game_menu, and Escape gives focus back
  * the panel lists every game in games.json order, marks this one
    aria-current + "Playing now", and its Close stays on screen
  * a real finished game: every edge clicked on a 3x3 board until someone
    wins, and exactly one game_win
  * what persists persists: the sound setting and the achievement count
    survive a reload

Screenshots land in tools/qa/out/dab-*.png — they are the point as much as
the assertions are; look at every one.
"""
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

PORT = 8164
ROOT = "/home/claude/site"
OUT = f"{ROOT}/tools/qa/out"
PATH = "/dots-and-boxes/"
GA = "dots_and_boxes"
EXTERNAL = ("googletagmanager", "google-analytics", "_vercel/insights")

VIEWPORTS = [
    ("375x667", {"width": 375, "height": 667}, True),
    ("390x844", {"width": 390, "height": 844}, True),
    ("844x390", {"width": 844, "height": 390}, True),
    ("1280x800", {"width": 1280, "height": 800}, False),
]

GAMES = [g["path"] for g in json.load(open(f"{ROOT}/games.json"))["games"]]

passed = failed = 0
def ok(cond, what):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"    FAIL - {what}")
    return cond


async def events(pg, name=None):
    evs = await pg.evaluate("() => (window.dataLayer || []).filter(a => a[0] === 'event')"
                            ".map(a => Object.assign({name: a[1]}, a[2] || {}))")
    return [e for e in evs if name is None or e["name"] == name]


async def overflow(pg):
    return await pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")


async def box(pg, sel):
    el = await pg.query_selector(sel)
    return await el.bounding_box() if el else None


async def edge_points(pg, size):
    """Every edge's midpoint on the live board, in page coordinates —
    computed from the game's OWN layout module, so this cannot drift from
    what the game thinks the geometry is."""
    return await pg.evaluate("""async (size) => {
      const { computeLayout } = await import('/dots-and-boxes/src/core/grid.js');
      const c = document.getElementById('board');
      const r = c.getBoundingClientRect();
      const L = computeLayout(size, size, c.clientWidth, c.clientHeight, 28);
      const pts = [];
      for (let row = 0; row <= size; row++)
        for (let col = 0; col < size; col++)
          pts.push([r.left + L.originX + (col + 0.5) * L.cellSize, r.top + L.originY + row * L.cellSize]);
      for (let row = 0; row < size; row++)
        for (let col = 0; col <= size; col++)
          pts.push([r.left + L.originX + col * L.cellSize, r.top + L.originY + (row + 0.5) * L.cellSize]);
      return pts;
    }""", size)


async def run(b, label, viewport, mobile):
    print(f"\n{label}")
    ctx = await b.new_context(viewport=viewport, is_mobile=mobile, has_touch=mobile,
                             device_scale_factor=2 if mobile else 1)
    pg = await ctx.new_page()
    errors, failures = [], []
    pg.on("console", lambda m: m.type == "error" and not any(x in m.text for x in EXTERNAL)
          and "Failed to load resource" not in m.text and errors.append(m.text[:200]))
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:200]))
    pg.on("requestfailed", lambda r: (not any(x in r.url for x in EXTERNAL))
          and failures.append(r.url + " " + (r.failure or "")))
    pg.on("response", lambda r: r.status >= 400 and not any(x in r.url for x in EXTERNAL)
          and failures.append(f"{r.status} {r.url}"))

    base = f"http://127.0.0.1:{PORT}"
    await pg.goto(base + PATH, wait_until="networkidle")
    await pg.wait_for_timeout(700)

    # --- the setup screen ------------------------------------------------
    ok(await overflow(pg) <= 0, f"no horizontal overflow on setup ({await overflow(pg)}px)")
    ok(len(await events(pg, "game_start")) == 0, "no game_start at boot — the page lands on setup")
    short = viewport["height"] <= 500
    floor = 44 if short else (52 if viewport["width"] >= 768 else 48)
    nav = await box(pg, ".site-nav")
    ok(nav is not None and nav["height"] >= floor, f"the bar is on the setup screen ({nav and round(nav['height'])}px)")
    for sel in ["#nav-games", "#nav-lang"]:
        bb = await box(pg, sel)
        ok(bb is not None and bb["height"] >= floor - 0.5, f"{sel} hit-tests {floor}px+ (got {bb and round(bb['height'],1)})")
    # The wordmark is a link, not a control the spec grows at 768px
    # (DESIGN.md §2 keeps it at 48px everywhere, 44 on a short screen).
    brand_floor = 44 if short else 48
    bb = await box(pg, ".nav-brand")
    ok(bb is not None and bb["height"] >= brand_floor - 0.5,
       f".nav-brand hit-tests {brand_floor}px+ (got {bb and round(bb['height'],1)})")
    ok(await pg.is_hidden("#games-btn"), "the in-game Games button is hidden during setup — the bar is right there")
    await pg.screenshot(path=f"{OUT}/dab-{label}-1-setup.png")

    # The settings modal is where mode / difficulty / board size / skin
    # live, and it is the densest screen in the game — the one most
    # likely to clip or drop under 48px after a type change.
    await pg.click("#settings-btn")
    await pg.wait_for_timeout(400)
    for sel in ["#mode-toggle .seg-btn", "#size-toggle .seg-btn", "#skin-open-btn", "#settings-close-btn"]:
        for el in await pg.query_selector_all(sel):
            bb = await el.bounding_box()
            ok(bb["height"] >= 47.5, f"{sel} is 48px tall ({round(bb['height'],1)})")
    ok(await pg.evaluate("() => { const b = document.getElementById('settings-body');"
                         " return b.scrollWidth <= b.clientWidth + 1; }"),
       "nothing in the settings modal is cut off sideways")
    await pg.screenshot(path=f"{OUT}/dab-{label}-1b-settings.png")
    await pg.click("#settings-close-btn")
    await pg.wait_for_timeout(300)

    # The bar's own Games button (this one is /nav.js's, not ours) and the
    # links it carries. The wordmark is the heir to the old "More free
    # games →" line: same id, same href, and DESIGN.md §8's event.
    await pg.click("#nav-games")
    await pg.wait_for_timeout(400)
    ok(await pg.get_attribute("#nav-panel", "data-open") == "true", "the bar's Games button opens the panel")
    bar_opens = [e for e in await events(pg, "nav_open") if e.get("placement") == "top_nav"]
    ok(len(bar_opens) == 1 and bar_opens[0].get("from") == GA, f"nav_open placement=top_nav ({bar_opens})")
    card = await pg.evaluate("""() => {
      const a = document.querySelector('.nav-card-grid a[data-crossgame-to]');
      a.addEventListener('click', (e) => e.preventDefault(), { once: true });
      a.click();
      const ev = (window.dataLayer || []).filter((x) => x[0] === 'event' && x[1] === 'cross_game_click').pop();
      return { want: a.dataset.crossgameTo, got: ev ? ev[2] : null };
    }""")
    ok(card["got"] and card["got"]["to"] == card["want"] and card["got"]["placement"] == "top_nav"
       and card["got"]["from"] == GA, f"a panel card reports cross_game_click top_nav ({card})")
    await pg.click("#nav-close")
    await pg.wait_for_timeout(300)
    ok(await pg.get_attribute("#nav-panel", "data-open") == "false", "Close closes it")
    ok(await pg.evaluate("() => document.activeElement.id") == "nav-games", "and focus returns to the Games button")
    brand = await pg.evaluate("""() => {
      const a = document.getElementById('link-crossgame-home');
      if (!a) return 'missing';
      a.addEventListener('click', (e) => e.preventDefault(), { once: true });
      a.click();
      const ev = (window.dataLayer || []).filter((x) => x[0] === 'event' && x[1] === 'cross_game_click').pop();
      return { href: a.getAttribute('href'), got: ev ? ev[2] : null };
    }""")
    ok(brand != "missing" and brand["href"] == "/", "the wordmark is #link-crossgame-home and goes home")
    ok(brand["got"] and brand["got"]["from"] == GA and brand["got"]["to"] == "mahjong"
       and brand["got"]["placement"] == "top_nav_brand",
       f"the wordmark reports cross_game_click top_nav_brand ({brand['got']})")

    # --- the player's own entry ------------------------------------------
    before = await box(pg, "#board")
    await pg.click("#start-game-btn")
    await pg.wait_for_timeout(1200)
    starts = await events(pg, "game_start")
    ok(len(starts) == 1 and starts[0].get("game_name") == GA,
       f"exactly one game_start, game_name={GA} ({starts})")
    ok(await pg.get_attribute("body", "data-nav") == "hidden", "the bar hides during play")
    ok(await pg.is_hidden(".site-nav"), "…and is really off the page, not just transparent")
    after = await box(pg, "#board")
    # The bar frees 56px and the HUD + the Undo/Hint/New Game row take
    # rather more than that back, so the board does not necessarily grow —
    # what matters is that its box really moved and that the game measured
    # the board AFTER it did. The backing buffer is the proof of the
    # second: it is set from clientWidth/clientHeight in resizeCanvas(),
    # so if the remeasure had not followed the toggle it would still be
    # sized for the page that had a bar on it.
    ok(abs(after["height"] - before["height"]) > 1,
       f"the canvas box really changed when the bar hid ({round(before['height'])} -> {round(after['height'])})")
    ok(await pg.evaluate("() => { const c = document.getElementById('board'), d = window.devicePixelRatio || 1;"
                         " return Math.abs(c.width / d - c.clientWidth) < 2 && Math.abs(c.height / d - c.clientHeight) < 2; }"),
       "…and the backing buffer matches the board's new CSS size (the remeasure ran after the toggle)")
    ok(await overflow(pg) <= 0, "no horizontal overflow during play")
    ok(await pg.is_visible("#games-btn"), "the in-game Games button takes over while the bar is hidden")
    await pg.screenshot(path=f"{OUT}/dab-{label}-2-playing.png")

    # --- the Games panel, from inside the game ---------------------------
    await pg.click("#games-btn")
    await pg.wait_for_timeout(400)
    ok(await pg.get_attribute("#nav-panel", "data-open") == "true", "the panel opens from the game's own row")
    opens = [e for e in await events(pg, "nav_open") if e.get("placement") == "game_menu"]
    ok(len(opens) == 1 and opens[0].get("from") == GA,
       f"nav_open reports placement=game_menu from={GA} ({opens})")
    ok(await pg.evaluate("() => document.activeElement.id") == "nav-panel-sheet",
       "focus lands on the sheet, so it announces as a dialog")
    cards = await pg.eval_on_selector_all(".nav-card-grid a[href]", "els => els.map(e => e.getAttribute('href'))")
    ok(cards == GAMES, f"every game, in games.json order ({len(cards)} cards)")
    ok(await pg.get_attribute(f'.nav-card-grid a[href="{PATH}"]', "aria-current") == "page",
       "this game's card is aria-current")
    ok(await pg.is_visible(f'.nav-card-grid a[href="{PATH}"] .nav-now'), 'and says "Playing now" in words')
    ok(await pg.is_visible("#nav-close"), "Close is on screen")
    ok(await overflow(pg) <= 0, "no horizontal overflow with the panel open")
    await pg.screenshot(path=f"{OUT}/dab-{label}-3-panel.png")
    # scroll the whole list: Close must survive it (there is no backdrop to tap under 1040px)
    await pg.eval_on_selector("#nav-panel-body", "el => el.scrollTop = el.scrollHeight")
    await pg.wait_for_timeout(300)
    ok(await pg.is_visible("#nav-close"), "Close is still on screen at the bottom of the list")
    ok(await pg.is_visible("#nav-lang-grid .lang-btn"), "the language grid is after the cards")
    await pg.screenshot(path=f"{OUT}/dab-{label}-4-panel-bottom.png")
    await pg.keyboard.press("Escape")
    await pg.wait_for_timeout(300)
    ok(await pg.get_attribute("#nav-panel", "data-open") == "false", "Escape closes it")
    ok(await pg.evaluate("() => document.activeElement.id") == "games-btn",
       "and focus comes back to the button that opened it")

    # --- back to setup: the bar returns and the board is remeasured again -
    playing = await box(pg, "#board")
    await pg.click("#restart-btn")
    await pg.wait_for_timeout(600)
    if await pg.is_visible("#confirm-ok-btn"):
        await pg.click("#confirm-ok-btn")
        await pg.wait_for_timeout(500)
    ok(await pg.get_attribute("body", "data-nav") == "shown", "New Game brings the bar back")
    ok(abs((await box(pg, "#board"))["height"] - playing["height"]) > 1, "and the canvas box changes back")
    ok(await pg.evaluate("() => { const c = document.getElementById('board'), d = window.devicePixelRatio || 1;"
                         " return Math.abs(c.height / d - c.clientHeight) < 2; }"),
       "…measured again with the bar back on the page")
    ok(await pg.is_hidden("#games-btn"), "the in-game Games button steps aside again")

    # --- a real finished game --------------------------------------------
    # 3x3, Classic, two players on one device: 24 edges, no AI to wait for,
    # and 9 boxes cannot end in a draw — so somebody wins.
    await pg.click("#settings-btn")
    await pg.wait_for_timeout(300)
    await pg.click('#size-toggle .seg-btn[data-size="3"]')
    await pg.click('#quickstart-toggle .seg-btn[data-quickstart="off"]')
    await pg.click("#settings-close-btn")
    await pg.wait_for_timeout(300)
    await pg.click("#play-friend-btn")
    await pg.wait_for_timeout(700)
    # Three passes over the same 24 midpoints. A tap on an edge that is
    # already drawn is a no-op, so repeating is free — and it is needed:
    # a tap that lands during another edge's 200ms draw animation is
    # occasionally swallowed, which used to leave the last box unclosed.
    for _ in range(3):
        if await pg.is_visible("#game-over-banner"):
            break
        for x, y in await edge_points(pg, 3):
            # A touch context gets a real tap: the game's hit test widens
            # its snap threshold for pointerType "touch"
            # (game/render.js findEdgeAt), so a synthetic mouse click on a
            # phone viewport is not the event a phone actually sends.
            if mobile:
                await pg.touchscreen.tap(x, y)
            else:
                await pg.mouse.click(x, y)
            await pg.wait_for_timeout(90)
            if await pg.is_visible("#game-over-banner"):
                break
    await pg.wait_for_timeout(700)
    ok(await pg.is_visible("#game-over-banner"), "the board finished and the game-over banner is up")
    wins = await events(pg, "game_win")
    ok(len(wins) == 1 and wins[0].get("game_name") == GA, f"exactly one game_win ({wins})")
    ok(await overflow(pg) <= 0, "no horizontal overflow on the game-over screen")
    await pg.screenshot(path=f"{OUT}/dab-{label}-5-gameover.png")

    # --- save / restore ---------------------------------------------------
    saved = await pg.evaluate("() => localStorage.getItem('dab-save')")
    ok(saved and json.loads(saved), "the game wrote its save (dab-save)")
    badge = await pg.inner_text("#achievements-count")
    await pg.click("#sound-toggle-btn")
    await pg.wait_for_timeout(200)
    muted = await pg.get_attribute("#sound-toggle-btn", "aria-label")
    await pg.reload(wait_until="networkidle")
    await pg.wait_for_timeout(800)
    ok(await pg.get_attribute("#sound-toggle-btn", "aria-label") == muted,
       f"the sound setting survived the reload ({muted})")
    ok(await pg.inner_text("#achievements-count") == badge,
       f"the achievement count survived the reload ({badge})")
    ok(await pg.get_attribute("body", "data-nav") == "shown", "a reload comes back on the setup screen, bar and all")
    await pg.screenshot(path=f"{OUT}/dab-{label}-6-restored.png")

    ok(not errors, "no console or page errors" + ("\n      " + "\n      ".join(errors) if errors else ""))
    ok(not failures, "no failed same-origin requests" + ("\n      " + "\n      ".join(failures) if failures else ""))
    await ctx.close()


async def run_rtl(b):
    """Arabic, once, at 375x667 (DESIGN.md §9 item 12). The bar and the
    panel must mirror; the game itself must NOT — it has no i18n runtime,
    so its UI is English whatever the site language is, and mirrored
    English is just broken. index.html pins dir="ltr" on the game's own
    roots for exactly this."""
    print("\nArabic (375x667)")
    ctx = await b.new_context(viewport={"width": 375, "height": 667}, is_mobile=True,
                              has_touch=True, device_scale_factor=2)
    pg = await ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    await pg.add_init_script("try { localStorage.setItem('site.v1.lang', 'ar'); } catch (e) {}")
    await pg.goto(f"http://127.0.0.1:{PORT}{PATH}", wait_until="networkidle")
    await pg.wait_for_timeout(900)
    ok(await pg.get_attribute("html", "dir") == "rtl", "the runtime put the document in RTL")
    ok(await pg.get_attribute("#app", "dir") == "ltr", "the game itself stays LTR")
    brand, games = await box(pg, ".nav-brand"), await box(pg, "#nav-games")
    ok(brand["x"] > games["x"], "the bar is mirrored: the wordmark is on the right")
    ok(await overflow(pg) <= 0, f"no horizontal overflow ({await overflow(pg)}px)")
    await pg.screenshot(path=f"{OUT}/dab-rtl-1-setup.png")
    await pg.click("#nav-games")
    await pg.wait_for_timeout(500)
    close, title = await box(pg, "#nav-close"), await box(pg, "#nav-panel-title")
    ok(close["x"] < title["x"], "the panel head is mirrored: Close is on the left")
    ok(await overflow(pg) <= 0, "no horizontal overflow with the panel open")
    await pg.screenshot(path=f"{OUT}/dab-rtl-2-panel.png")
    await pg.click("#nav-close")
    await pg.wait_for_timeout(300)
    await pg.click("#start-game-btn")
    await pg.wait_for_timeout(1200)
    ok(await overflow(pg) <= 0, "no horizontal overflow during play")
    ok(not errors, "no page errors" + ("\n      " + "\n      ".join(errors) if errors else ""))
    await pg.screenshot(path=f"{OUT}/dab-rtl-3-playing.png")
    await ctx.close()


async def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(["node", f"{ROOT}/tools/serve.mjs", f"--port={PORT}"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for label, vp, mobile in VIEWPORTS:
                if only and label != only:
                    continue
                await run(b, label, vp, mobile)
            if not only or only == "ar":
                await run_rtl(b)
            await b.close()
    finally:
        srv.terminate()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)

asyncio.run(main())
