"""Browser QA for the top bar on the three standalone builds — DESIGN.md §6.

    python3 tools/qa/standalone_nav_qa.py            checks + screenshots
    python3 tools/qa/standalone_nav_qa.py --quick    checks only, no screenshots

Node's Playwright is not installed under tools/, so this is the Python one.
It serves the site through tools/serve.mjs, which applies vercel.json's real
headers — the Content-Security-Policy included, so a stray inline style or a
module that fails to load fails here the way it would in production.

tools/qa/nav_qa.py covers the eight site-shell pages. This one covers what
those pages cannot show, because it only exists on the full-viewport portal
builds (Four Ball Billiards, StoneFlick, Shuffleboard):

  - there is no scroll here, so the bar cannot scroll away: it takes a real
    ROW and the game gets exactly what is left. So the checks are geometric —
    #app starts where the bar ends, to the pixel, and nothing runs off the
    bottom or the side at any of the four sizes.
  - the bar comes off during play, and the canvas is MEASURED IN JS. That is
    the one bug this file exists to catch: a canvas measured while the row is
    mid-toggle keeps the old height, and then the finger and the drawing
    disagree by 56px. So entering play is asserted twice over. Once for the
    TIMING: the canvas is read in the same JavaScript task as the click that
    toggles the bar, so a remeasure deferred to the next frame shows up as a
    bitmap that does not fit its box. And once for the SIZE: with the play
    screen still up, the bar is put back underneath the game and the two
    states are compared, so "#app gained the bar's whole row" is a
    measurement rather than a claim.
  - the bar is dark here, and the cream Games panel is opened over a dark
    page, which is a palette the shell pages never exercise.
  - the panel is reachable mid-game from the game's own menu, since the bar
    itself is gone by then.

Four sizes: the tightest real phone, the common phone, that phone turned
sideways (where the site drops the bar to 48px with 44px controls — the one
place it goes under 48, and only because the alternative is no board), and a
laptop.

Screenshots land in tools/qa/out/standalone/ and are meant to be looked at.
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 8163
OUT = ROOT / "tools/qa/out/standalone"

REGISTRY = json.loads((ROOT / "games.json").read_text())
GAMES = REGISTRY["games"]
ORDER = [g["path"] for g in GAMES]

EXTERNAL = re.compile(r"googletagmanager|google-analytics|_vercel/insights")

VIEWPORTS = [
    ("375x667", 375, 667, 2),   # iPhone SE — the tightest real phone
    ("390x844", 390, 844, 2),   # iPhone 14
    ("844x390", 844, 390, 2),   # the same phone sideways — the 48px bar
    ("1280x800", 1280, 800, 1),  # laptop
]

# Per game: where its canvas is, how a player enters a play screen, how they
# come back, and where the panel is reachable from mid-game.
#
# `enter` / `leave` / `menu_games` are lists of steps run in order. A step is
# either a CSS selector to click, or ("js", "<expression>") to drive the
# game's own test handle where there is no button a player could press
# (Shuffleboard has no home SCREEN — its home is a card, and only its own
# runtime can put it up).
PAGES = [
    {
        "path": "/four-ball-billiards/",
        "ga": "four_ball_billiards",
        "canvas": "#table",
        # Its canvas fills the row it is given, so it gains the bar's whole
        # height when the bar goes.
        "canvas_fills": True,
        "front_canvas": True,
        # The home screen is up at boot; Play starts the campaign stage.
        "enter": ["#btn-play"],
        "leave": ["#menu-open", "#to-home"],
        "menu_games": ["#menu-open", "#to-games"],
        "menu_close": ["#menu-close"],
    },
    {
        "path": "/stone-flick/",
        "ga": "stone_flick",
        "canvas": "#board",
        # StoneFlick's board is a SQUARE whose side is min(box width, box
        # height, what the pull-back still has room for) — so on a phone the
        # narrow axis binds and the row the bar gives back does not make the
        # square bigger. It still has to be RE-MEASURED (the bitmap must
        # track the box); it just does not have to grow.
        "canvas_fills": False,
        # And it lives inside the game screen, which is display:none on the
        # menu — there is no canvas to measure until a match is up.
        "front_canvas": False,
        "enter": ["#btn-continue"],
        "leave": ["#screen-game [data-back]"],
        # No ⋯ overlay in this build; the game bar's tool group is the
        # equivalent and is the only chrome that survives a match.
        "menu_games": ["#btn-games"],
        "menu_close": [],
    },
    {
        "path": "/shuffleboard/",
        "ga": "shuffleboard",
        "canvas": "#board",
        "canvas_fills": True,
        "front_canvas": True,
        # This game boots onto the board with its first-run card up. Its home
        # is a card, so the run puts that card up the way the ⋯ menu does and
        # then presses the button on it.
        "enter": [("js", "window.__sb.showHome()"), "#btn-primary"],
        "leave": ["#menu-btn", "#btn-home"],
        "menu_games": ["#menu-btn", "#btn-games"],
        "menu_close": ["#menu-btn"],
    },
]

results = []


def ok(cond, what):
    results.append((bool(cond), what))
    if not cond:
        print("  FAIL - " + what)
    return bool(cond)


def slug(path):
    return path.strip("/").replace("/", "-")


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


def rect(pg, sel):
    return pg.evaluate("""(s) => { const el = document.querySelector(s); if (!el) return null;
        const r = el.getBoundingClientRect();
        return {w: r.width, h: r.height, x: r.x, y: r.y, bottom: r.bottom, right: r.right}; }""", sel)


def canvas_state(pg, sel):
    """The canvas as both a box and a bitmap.

    The bitmap is the half that matters: a canvas whose CSS box grew but whose
    backing store did not was never re-measured, and everything drawn in it is
    then stretched — the aim the finger sets and the line on screen disagree.
    `ratio` is device pixels per CSS pixel on each axis; the game sets it from
    devicePixelRatio, so the two axes agreeing is the fingerprint of a real
    remeasure."""
    return pg.evaluate("""(s) => { const c = document.querySelector(s); if (!c) return null;
        const r = c.getBoundingClientRect();
        return {css: {w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100,
                      y: Math.round(r.y * 100) / 100, bottom: Math.round(r.bottom * 100) / 100},
                bitmap: {w: c.width, h: c.height},
                ratio: {x: c.clientWidth ? c.width / c.clientWidth : 0,
                        y: c.clientHeight ? c.height / c.clientHeight : 0}}; }""", sel)


def click_and_measure(pg, sel, canvas_sel):
    """Click, then read the canvas in the SAME JavaScript task.

    The click handler is synchronous: it flips body[data-nav] and calls the
    game's own remeasure. getBoundingClientRect() on the next line forces
    layout, so the box returned is the new one and the bitmap is whatever the
    game had set by the time the handler returned. If a game deferred its
    remeasure by even one frame, this is where the two disagree."""
    return pg.evaluate("""([sel, cs]) => {
        const c = document.querySelector(cs);
        document.querySelector(sel).click();
        const r = c.getBoundingClientRect();
        return {css: {w: r.width, h: r.height}, bitmap: {w: c.width, h: c.height},
                ratio: {x: c.clientWidth ? c.width / c.clientWidth : 0,
                        y: c.clientHeight ? c.height / c.clientHeight : 0},
                navHidden: document.body.dataset.nav === 'hidden'};
    }""", [sel, canvas_sel])


def step(pg, s):
    if isinstance(s, tuple):
        pg.evaluate(s[1])
    else:
        pg.click(s, timeout=5000)
    pg.wait_for_timeout(250)


def events(pg):
    return pg.evaluate("""() => (window.dataLayer || [])
        .filter(a => a[0] === 'event').map(a => ({name: a[1], ...(a[2] || {})}))""")


def nav_shown(pg):
    return pg.evaluate("""() => { const n = document.getElementById('site-nav');
        return !!n && getComputedStyle(n).display !== 'none'; }""")


# --------------------------------------------------------------------------


def run_viewport(browser, base, game, label, w, h, dsf, shots):
    errors = []
    ctx, pg = new_page(browser, w, h, dsf, base, errors)
    tag = f"{slug(game['path'])} [{label}]"
    short_landscape = h <= 500 and w > h
    print("\n" + tag)
    try:
        pg.goto(base + game["path"], wait_until="networkidle", timeout=30000)
        pg.wait_for_timeout(600)

        # --- the page itself -------------------------------------------------
        ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
           f"{tag}: no horizontal overflow "
           f"({pg.evaluate('document.documentElement.scrollWidth')} > {w})")
        ok(pg.evaluate("document.documentElement.scrollHeight <= window.innerHeight + 1"),
           f"{tag}: nothing runs off the bottom either — there is no scroll on this page "
           f"({pg.evaluate('document.documentElement.scrollHeight')} > {h})")

        # --- the bar is on the first screen ---------------------------------
        ok(nav_shown(pg), f"{tag}: the bar is on the game's first screen")
        inner = rect(pg, ".site-nav-inner")
        want = 48 if short_landscape else (64 if w >= 768 else 56)
        ok(inner and abs(inner["h"] - want) < 1.5,
           f"{tag}: the bar is {want}px (got {inner and round(inner['h'], 1)})")
        floor = 44 if short_landscape else (52 if w >= 768 else 48)
        for sel in ["#nav-games", "#nav-lang"]:
            r = rect(pg, sel)
            ok(r and r["h"] >= floor - 0.5 and r["w"] >= 48,
               f"{tag}: {sel} hit-tests {floor}px tall and 48px wide "
               f"(got {r and (round(r['w'], 1), round(r['h'], 1))})")
        brand = rect(pg, ".nav-brand")
        ok(brand and brand["h"] >= 44, f"{tag}: the wordmark is a 44px+ target")
        ok(pg.evaluate("!!document.querySelector('.nav-brand .b-easy')"
                       " && !!document.querySelector('.nav-brand .b-classics')"),
           f"{tag}: the words never degrade")
        # The dark override: the bar must not arrive as the site's cream band
        # on a black page.
        bg = pg.evaluate("() => getComputedStyle(document.getElementById('site-nav')).backgroundColor")
        ok(bg not in ("rgb(247, 242, 230)", "rgba(0, 0, 0, 0)"),
           f"{tag}: the bar carries the dark --nav-* override (background {bg})")

        # --- the game gets exactly what is left ------------------------------
        nav = rect(pg, ".site-nav")
        app = rect(pg, "#app")
        ok(app and abs(app["y"] - nav["bottom"]) < 1.5,
           f"{tag}: the game starts where the bar ends — no gap, no overlap "
           f"(bar bottom {round(nav['bottom'], 1)}, #app top {app and round(app['y'], 1)})")
        ok(app and app["bottom"] <= h + 1,
           f"{tag}: and ends at the bottom of the window, not past it "
           f"(#app bottom {app and round(app['bottom'], 1)} > {h})")
        if game["front_canvas"]:
            cv = canvas_state(pg, game["canvas"])
            ok(cv and cv["css"]["w"] > 0 and cv["css"]["h"] > 0, f"{tag}: the canvas has a size")
            ok(cv and cv["css"]["y"] >= nav["bottom"] - 1 and cv["css"]["bottom"] <= h + 1,
               f"{tag}: the canvas is wholly under the bar and inside the window "
               f"({cv and (cv['css']['y'], cv['css']['bottom'])} vs "
               f"{round(nav['bottom'], 1)}..{h})")
            ok(cv and abs(cv["ratio"]["x"] - cv["ratio"]["y"]) < 0.05 and cv["ratio"]["x"] > 0.9,
               f"{tag}: the canvas bitmap matches its box on both axes "
               f"({cv and (round(cv['ratio']['x'], 3), round(cv['ratio']['y'], 3))})")

        # NOTHING THE BAR PUSHED DOWN IS OUT OF REACH. The bar takes a real
        # row out of a page that cannot scroll, so a control that was already
        # near the bottom edge can end up under it with no way to get at it —
        # Four Ball's landscape home screen lost its whole footer row (star
        # total, Tables, Sound) that way, and it was already 14px over before
        # the bar existed. A control below the fold is fine as long as
        # something between it and the body scrolls.
        unreachable = pg.evaluate("""() => {
            const out = [];
            for (const el of document.querySelectorAll('#app button, #app a')) {
                if (el.disabled) continue;
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) continue;
                if (r.bottom <= window.innerHeight + 1 && r.top >= -1) continue;
                let p = el.parentElement, scrollable = false;
                while (p && p !== document.body) {
                    const cs = getComputedStyle(p);
                    if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) { scrollable = true; break; }
                    p = p.parentElement;
                }
                if (!scrollable) out.push((el.id || el.className || el.tagName) + ' @' + Math.round(r.top) + '..' + Math.round(r.bottom));
            }
            return out; }""")
        ok(not unreachable,
           f"{tag}: no control on the game's first screen is stranded below the fold — {unreachable}")

        if shots:
            pg.screenshot(path=str(OUT / f"{slug(game['path'])}-{label}-top.png"))

        # --- the panel -------------------------------------------------------
        pg.click("#nav-games")
        pg.wait_for_timeout(350)
        ok(pg.get_attribute("#nav-panel", "data-open") == "true", f"{tag}: Games opens the panel")
        ok(pg.get_attribute("#nav-games", "aria-expanded") == "true", f"{tag}: aria-expanded flips")
        ok(pg.evaluate("document.activeElement && document.activeElement.id") == "nav-panel-sheet",
           f"{tag}: focus lands on the sheet")
        opened = [e for e in events(pg) if e["name"] == "nav_open"]
        ok(len(opened) == 1 and opened[0].get("from") == game["ga"],
           f"{tag}: nav_open names this game — got {opened}")

        hrefs = pg.eval_on_selector_all(".nav-card-grid a.game-card",
                                        "els => els.map(e => e.getAttribute('href'))")
        ok(hrefs == ORDER, f"{tag}: all {len(ORDER)} cards, in games.json order (got {len(hrefs)})")
        cur = pg.eval_on_selector_all(".nav-card-grid a[aria-current='page']",
                                      "els => els.map(e => e.getAttribute('href'))")
        ok(cur == [game["path"]], f"{tag}: this game's card is the one marked — got {cur}")
        ok(pg.evaluate("""() => { const a = document.querySelector(".nav-card-grid a[aria-current='page']");
            return !!a && /\\S/.test(a.querySelector('.nav-now')?.textContent || ''); }"""),
           f"{tag}: and says so in words, not by tint alone")
        # The panel is the site's cream sheet on a dark page — the one palette
        # collision these three builds have (they redefine --ink).
        inkish = pg.evaluate("""() => { const t = document.querySelector('.game-card-title');
            return t && getComputedStyle(t).color; }""")
        ok(inkish == "rgb(15, 36, 25)",
           f"{tag}: the panel keeps the site's ink on its cream sheet (got {inkish})")
        ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
           f"{tag}: the open panel does not overflow sideways")

        # Close survives the whole list on a short screen.
        pg.evaluate("const b = document.getElementById('nav-panel-body'); b.scrollTop = b.scrollHeight;")
        pg.wait_for_timeout(250)
        close = rect(pg, "#nav-close")
        ok(close and close["y"] >= -1 and close["bottom"] <= h + 1 and close["h"] >= 48,
           f"{tag}: Close is still on screen at the bottom of the list — {close}")
        ok(close and close["x"] >= 0 and close["right"] <= w + 1,
           f"{tag}: and inside the sheet sideways ({close and (round(close['x'], 1), round(close['right'], 1))} in 0..{w})")
        if shots:
            pg.evaluate("document.getElementById('nav-panel-body').scrollTop = 0")
            pg.wait_for_timeout(200)
            pg.screenshot(path=str(OUT / f"{slug(game['path'])}-{label}-panel.png"))

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

        # --- into play: the row goes, and the canvas comes with it ------------
        #
        # Two separate claims, because they fail separately.
        #
        # 1. THE SAME FRAME. The last step into play is a click, so its
        #    handler runs synchronously: it toggles body[data-nav] and calls
        #    the game's own remeasure. click_and_measure() reads the canvas on
        #    the next line of the SAME JavaScript task, which forces layout —
        #    so the box it reports is the new one, and the bitmap is whatever
        #    the game had set by then. A game that deferred its remeasure to a
        #    requestAnimationFrame or left it to a ResizeObserver reports a
        #    stale bitmap here, which is exactly the bug this step exists for.
        # 2. THE ROW REALLY WENT TO THE GAME. Measured on the play screen
        #    against itself: put the bar back with the game none the wiser,
        #    let the game's ordinary resize path settle, and compare. #app has
        #    to gain the bar's whole height; whether the CANVAS does depends
        #    on the game (see canvas_fills).
        for s in game["enter"][:-1]:
            step(pg, s)
        sync = click_and_measure(pg, game["enter"][-1], game["canvas"])
        ok(sync["navHidden"], f"{tag}: entering a play screen takes the bar's row away, synchronously")
        ok(abs(sync["ratio"]["x"] - sync["ratio"]["y"]) < 0.05 and sync["ratio"]["x"] > 0.9,
           f"{tag}: THE CANVAS RE-MEASURED IN THE SAME TASK AS THE TOGGLE — read "
           f"immediately after the click, its {sync['bitmap']['w']}x{sync['bitmap']['h']} "
           f"bitmap already fits its {round(sync['css']['w'], 1)}x{round(sync['css']['h'], 1)} "
           f"box (ratio {round(sync['ratio']['x'], 3)}/{round(sync['ratio']['y'], 3)})")
        pg.wait_for_timeout(350)
        ok(not nav_shown(pg), f"{tag}: the bar is gone")
        after = canvas_state(pg, game["canvas"])
        app_play = rect(pg, "#app")

        # Put the bar back underneath the game and let its own resize path run.
        pg.evaluate("delete document.body.dataset.nav; window.dispatchEvent(new Event('resize'));")
        pg.wait_for_timeout(350)
        withbar = canvas_state(pg, game["canvas"])
        app_withbar = rect(pg, "#app")
        d_app = app_play["h"] - app_withbar["h"]
        d_canvas = after["css"]["h"] - withbar["css"]["h"]
        ok(abs(d_app - nav["h"]) < 1.5,
           f"{tag}: the game gets the bar's whole row — #app is {round(d_app, 1)}px taller "
           f"without it, and the bar is {round(nav['h'], 1)}px")
        if game["canvas_fills"]:
            ok(abs(d_canvas - nav["h"]) < 1.5,
               f"{tag}: and so does the canvas — {round(withbar['css']['h'], 1)}px with the bar, "
               f"{round(after['css']['h'], 1)}px without (+{round(d_canvas, 1)}px)")
        else:
            ok(d_canvas >= -0.5,
               f"{tag}: and the square board never shrinks for it "
               f"({round(withbar['css']['h'], 1)} -> {round(after['css']['h'], 1)})")
        ok(abs(withbar["ratio"]["x"] - withbar["ratio"]["y"]) < 0.05,
           f"{tag}: the canvas re-measures in that direction too "
           f"(ratio {round(withbar['ratio']['x'], 3)}/{round(withbar['ratio']['y'], 3)})")
        pg.evaluate("document.body.dataset.nav = 'hidden'; window.dispatchEvent(new Event('resize'));")
        pg.wait_for_timeout(300)

        ok(after["css"]["bottom"] <= h + 1 and after["css"]["y"] >= -1,
           f"{tag}: the full-height canvas is not clipped "
           f"({after['css']['y']}..{after['css']['bottom']} in {h})")
        # Sideways only. StoneFlick's own two-column landscape layout has a
        # pre-existing 17px vertical overrun of its board row (the pull-back
        # gutter), clipped by html,body{overflow:hidden} and unrelated to the
        # bar — it is the same with #app back on height:100%. What the bar
        # must not do is make the page scroll sideways or clip the canvas,
        # and both of those are checked.
        ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
           f"{tag}: the play screen does not overflow sideways")
        if shots:
            pg.screenshot(path=str(OUT / f"{slug(game['path'])}-{label}-play.png"))

        # --- the panel is still reachable from the game's own menu -----------
        for i, s in enumerate(game["menu_games"]):
            step(pg, s)
            # The menu itself is worth a look: the Games item has to read as
            # the one thing in it that leaves the game.
            if shots and i == 0 and len(game["menu_games"]) > 1:
                pg.screenshot(path=str(OUT / f"{slug(game['path'])}-{label}-menu.png"))
        pg.wait_for_timeout(300)
        ok(pg.get_attribute("#nav-panel", "data-open") == "true",
           f"{tag}: the game menu's Games item opens the same panel")
        ok(len([e for e in events(pg) if e["name"] == "nav_open"]) >= 2,
           f"{tag}: and reports nav_open for it")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)
        ok(pg.get_attribute("#nav-panel", "data-open") == "false",
           f"{tag}: Escape closes it from there too")
        # /nav.js hands focus back to #nav-games, which is display:none here —
        # the game puts it back on the item that was pressed.
        focused = pg.evaluate("document.activeElement && document.activeElement.id")
        ok(focused not in (None, "", "nav-games"),
           f"{tag}: focus does not fall into the void when the bar is hidden (got {focused!r})")
        for s in game["menu_close"]:
            step(pg, s)

        # --- back out: the row comes back ------------------------------------
        for s in game["leave"]:
            step(pg, s)
        pg.wait_for_timeout(400)
        ok(nav_shown(pg), f"{tag}: leaving the play screen brings the bar back")
        back = canvas_state(pg, game["canvas"])
        nav2 = rect(pg, ".site-nav")
        app2 = rect(pg, "#app")
        ok(app2 and abs(app2["y"] - nav2["bottom"]) < 1.5,
           f"{tag}: and the game starts under it again "
           f"({app2 and round(app2['y'], 1)} vs {round(nav2['bottom'], 1)})")
        ok(back["css"]["h"] <= after["css"]["h"] + 1,
           f"{tag}: the canvas gave the row back "
           f"({after['css']['h']} -> {back['css']['h']})")
        ok(abs(back["ratio"]["x"] - back["ratio"]["y"]) < 0.05,
           f"{tag}: and re-measured on the way back too "
           f"(ratio {round(back['ratio']['x'], 3)}/{round(back['ratio']['y'], 3)})")

        ok(not errors, f"{tag}: no console or page errors — {errors}")
    except Exception as e:  # noqa: BLE001
        ok(False, f"{tag}: drove without throwing — {type(e).__name__}: {e}")
        try:
            pg.screenshot(path=str(OUT / f"{slug(game['path'])}-{label}-CRASH.png"))
        except Exception:  # noqa: BLE001
            pass
    finally:
        ctx.close()


def run_once(browser, base, game, shots):
    """Once per game, on the phone that matters: the wordmark's event, and a
    card that really navigates."""
    errors = []
    ctx, pg = new_page(browser, 390, 844, 2, base, errors)
    tag = f"{slug(game['path'])} [once]"
    print("\n" + tag)
    try:
        pg.goto(base + game["path"], wait_until="networkidle", timeout=30000)
        pg.wait_for_timeout(500)
        # The wordmark is the heir to "More free games →": same id, same href,
        # and the event it used to send.
        brand = pg.evaluate("""() => { const a = document.getElementById('link-crossgame-home');
            return a && {href: a.getAttribute('href'), to: a.dataset.crossgameTo,
                         placement: a.dataset.placement, cls: a.className}; }""")
        ok(brand and brand["href"] == "/" and brand["to"] == "mahjong"
           and brand["placement"] == "top_nav_brand" and "nav-brand" in brand["cls"],
           f"{tag}: the wordmark is #link-crossgame-home -> / ({brand})")
        report = pg.evaluate("""() => { const el = document.getElementById('link-crossgame-home');
            el.addEventListener('click', (e) => e.preventDefault(), {once: true});
            el.click();
            const ev = (window.dataLayer || []).filter(a => a[0] === 'event' && a[1] === 'cross_game_click').pop();
            return ev ? ev[2] : null; }""")
        ok(report and report.get("from") == game["ga"] and report.get("to") == "mahjong"
           and report.get("placement") == "top_nav_brand",
           f"{tag}: and it reports cross_game_click — got {report}")
        ok(not pg.evaluate("!!document.body.textContent.match(/More free games/)"),
           f"{tag}: no 'More free games' line left anywhere")

        # A card really navigates.
        pg.click("#nav-games")
        pg.wait_for_timeout(300)
        target = pg.eval_on_selector_all(
            ".nav-card-grid a.game-card:not([aria-current])", "els => els[0].getAttribute('href')")
        pg.click(f".nav-card-grid a.game-card[href='{target}']")
        pg.wait_for_load_state("networkidle", timeout=30000)
        ok(pg.url.endswith(target), f"{tag}: a card navigates to {target} (got {pg.url})")
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
            for game in PAGES:
                for label, w, h, dsf in VIEWPORTS:
                    run_viewport(browser, base, game, label, w, h, dsf, not quick)
                run_once(browser, base, game, not quick)
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
