"""Browser QA for the two Four Ball Billiards fixes ported from upstream.

    python3 tools/qa/fourball_fixes_qa.py            checks + screenshots
    python3 tools/qa/fourball_fixes_qa.py --quick    checks only, no screenshots

Node's Playwright is not installed under tools/, so this is the Python one.
It serves the site through tools/serve.mjs, which applies vercel.json's real
headers — the Content-Security-Policy included, so a module that fails to
load fails here the way it would in production.

Two fixes, and neither of them shows up in a screenshot of a working game,
which is why they both needed a probe:

(1) THE FIRST TOUCH.  wakeUp() only ran from inside onDown's dial / arrows /
    stick / bar branches, so a press anywhere else fell out of the handler
    having done nothing at all: no cue movement, no banner, and the
    beginner's card still sitting there. Five of the eight gestures someone
    arrives with were in that "anywhere else" — and on a phone the status
    line that would have explained the controls is display:none, so there
    was nothing on screen to read either. This drives the four the fix is
    judged on (plus the flick, which is the fifth) at 390x844 with real
    pointer input, from a CLEARED save each time so the card is genuinely
    up, and asserts each one produces a state change a player could see.

    A gesture "did something" here means one of: the beginner's card went
    away, the cue turned, or the game said the one thing a new player is
    missing ("Pull the bar to shoot"). Anything less is the bug.

(2) THE TABLES SCREEN.  storage.themeUnlockContext() read a field that
    schema v3 moved into levels[], so opening the tables screen threw. A
    thrown exception inside a click handler leaves the screen half-painted
    and prints nothing a player will see, so this asserts on page errors
    with the screen actually open, at a save that has cleared stages (the
    getter returns 0 for everyone on a fresh save, which is exactly why the
    bug survived).

Screenshots land in tools/qa/out/fourball-fixes/ and are meant to be
looked at.
"""
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 8165
OUT = ROOT / "tools/qa/out/fourball-fixes"
GAME = "/four-ball-billiards/"

# The phone the fix is judged on. The status line that explains the
# controls is display:none at this width, so a gesture that does nothing
# visible here leaves the player nothing at all.
W, H, DSF = 390, 844, 2

HINT = "Pull the bar to shoot"

# GA and Vercel Insights are external and never reachable from here, the
# same exclusion tools/qa/nav_qa.py makes. Anything else on the console is
# the game's problem and is meant to fail this file.
EXTERNAL = re.compile(r"googletagmanager|google-analytics|_vercel/insights|favicon")

results = []


def ok(cond, what):
    results.append((bool(cond), what))
    print(("  ok   - " if cond else "  FAIL - ") + what)
    return bool(cond)


def new_page(browser, base, errors):
    ctx = browser.new_context(
        viewport={"width": W, "height": H},
        device_scale_factor=DSF,
        is_mobile=True,
        has_touch=True,
        base_url=base,
    )
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:300]))
    pg.on(
        "console",
        lambda m: errors.append("console: " + m.text[:300])
        if m.type == "error"
        and not EXTERNAL.search(m.text)
        and "Failed to load resource" not in m.text
        else None,
    )
    pg.on(
        "requestfailed",
        lambda r: errors.append("requestfailed: " + r.url[:200])
        if not EXTERNAL.search(r.url)
        else None,
    )
    return ctx, pg


def boot(browser, base, errors, save=None):
    """A page on the table, from a save chosen by the caller.

    The save is written before the game's modules run — core/storage.js
    reads localStorage once, at import time — so this navigates to the
    page, seeds it, and reloads.
    """
    ctx, pg = new_page(browser, base, errors)
    pg.goto(GAME, wait_until="load")
    pg.evaluate(
        """(save) => {
            localStorage.clear();
            if (save) localStorage.setItem("fourball-save", JSON.stringify(save));
        }""",
        save,
    )
    pg.goto(GAME, wait_until="load")
    pg.wait_for_function("() => window.__fourball && window.__fourball.state.layout")
    return ctx, pg


def enter_play(pg):
    pg.click("#btn-play")
    pg.wait_for_function("() => window.__fourball.state.screen === 'play'")
    # One frame, so the layout the gestures aim at is the one on screen.
    pg.wait_for_timeout(120)


def snapshot(pg):
    """Everything a player could notice about the aim, in one read."""
    return pg.evaluate(
        """() => {
            const s = window.__fourball.state;
            const banner = document.getElementById("banner");
            const card = document.getElementById("firstrun");
            return {
                attract: s.attract,
                dragging: Boolean(s.dragging),
                armed: Boolean(s.armed),
                angle: s.aim.angle,
                power: s.aim.power,
                banner: banner.textContent,
                bannerShown: banner.classList.contains("show"),
                cardUp: !card.hidden && !card.classList.contains("gone"),
            };
        }"""
    )


def points(pg):
    """Canvas-relative and page-absolute px for the places a finger lands.

    The cue ball's table coordinates go through the same transform
    game/layout.js uses; `cloth` is a spot on the felt chosen to be clear
    of the ball, the cue's grab capsule and the whole control strip, which
    is what makes it the press the old handler dropped.
    """
    return pg.evaluate(
        """() => {
            const F = window.__fourball;
            const s = F.state, L = s.layout;
            const r = document.getElementById("table").getBoundingClientRect();
            const toPx = (x, y) => L.rotated
                ? { x: L.originX + y * L.scale, y: L.originY + (2.84 - x) * L.scale }
                : { x: L.originX + x * L.scale, y: L.originY + y * L.scale };
            const cue = F.P.getBall(s.world, "cue");
            const ball = toPx(cue.x, cue.y);
            // Clear of the ball and above the control strip: the felt.
            const cloth = { x: r.width * 0.5, y: Math.min(ball.y, r.height * 0.5) * 0.45 };
            const abs = (p) => ({ x: r.x + p.x, y: r.y + p.y });
            return { rect: { x: r.x, y: r.y, w: r.width, h: r.height },
                     ball, cloth, ballAbs: abs(ball), clothAbs: abs(cloth) };
        }"""
    )


def changed(before, after):
    """Did the game answer? Any of the three things a player would see."""
    reasons = []
    if before["cardUp"] and not after["cardUp"]:
        reasons.append("the beginner's card went away")
    if abs(after["angle"] - before["angle"]) > 1e-6:
        reasons.append(f"the cue turned {abs(after['angle'] - before['angle']):.3f} rad")
    if after["bannerShown"] and after["banner"] and after["banner"] != before["banner"]:
        reasons.append(f'the game said "{after["banner"]}"')
    if not before["dragging"] and after["dragging"]:
        reasons.append("the shot was taken hold of")
    return reasons


# --- the gestures ---------------------------------------------------------
#
# Each returns the state DURING the press as well as after it: "tapping the
# cue ball" is a press and a release, and the thing it has to produce
# (taking hold of the shot) is true while the finger is down.


def tap(pg, pt, shot_name, screens):
    pg.mouse.move(pt["x"], pt["y"])
    pg.mouse.down()
    mid = snapshot(pg)
    if screens:
        pg.screenshot(path=str(OUT / f"{shot_name}.png"))
    pg.mouse.up()
    return mid, snapshot(pg)


def drag(pg, start, dx, dy, shot_name, screens):
    pg.mouse.move(start["x"], start["y"])
    pg.mouse.down()
    for i in range(1, 9):
        pg.mouse.move(start["x"] + dx * i / 8, start["y"] + dy * i / 8)
        pg.wait_for_timeout(16)
    mid = snapshot(pg)
    if screens:
        pg.screenshot(path=str(OUT / f"{shot_name}.png"))
    pg.mouse.up()
    return mid, snapshot(pg)


def first_touch(browser, base, screens):
    """The eight gestures, five of which used to produce nothing."""
    print("\nfirst touch on the table (390x844, real pointer input)")

    # A press on the cue ball. Its own branch answered this only when the
    # press landed inside the STICK's grab capsule — the ball itself is
    # not the stick, and at rest the stick lies off to one side of it.
    cases = [
        ("tapping the cue ball", "tap", "ball", None, None),
        ("flicking the cue ball at the reds", "drag", "ball", 0, -90),
        ("pulling back from the cue ball", "drag", "ball", 0, 90),
        ("tapping the cloth", "tap", "cloth", None, None),
        ("dragging the cloth", "drag", "cloth", 70, 40),
    ]
    for label, kind, where, dx, dy in cases:
        errors = []
        ctx, pg = boot(browser, base, errors)
        enter_play(pg)
        before = snapshot(pg)
        ok(before["cardUp"] and before["attract"], f"{label}: the beginner's card is up to start with")
        pt = points(pg)[where + "Abs"]
        name = label.replace(" ", "-")
        if kind == "tap":
            mid, after = tap(pg, pt, name, screens)
        else:
            mid, after = drag(pg, pt, dx, dy, name, screens)
        # DURING the press and after it, both: taking hold of the shot is
        # a state that only exists while the finger is down.
        reasons = changed(before, mid) + changed(before, after)
        ok(reasons, f"{label}: the game answers — {'; '.join(dict.fromkeys(reasons)) or 'NOTHING HAPPENED'}")
        ok(not errors, f"{label}: no page errors ({errors[:1]})")
        ctx.close()

    # The hint is capped and it is only for someone who has never fired.
    errors = []
    ctx, pg = boot(browser, base, errors)
    enter_play(pg)
    pt = points(pg)
    seen = []
    for _ in range(4):
        tap(pg, pt["clothAbs"], "hint-cap", False)
        seen.append(snapshot(pg)["banner"])
        pg.evaluate("() => { document.getElementById('banner').textContent = ''; }")
    ok(seen[:2] == [HINT, HINT], f'the first two presses say "{HINT}" (got {seen[:2]})')
    ok(seen[2:] == ["", ""], f"and it stops after two, so it never becomes wallpaper (got {seen[2:]})")
    ok(not errors, f"the hint: no page errors ({errors[:1]})")
    ctx.close()


# --- the tables screen ---------------------------------------------------


def tables_screen(browser, base, screens):
    """themeUnlockContext() on a save that has something in it."""
    print("\nthe tables screen opens on a v3 save")
    # A v3 save with stage 1 cleared at all three difficulties. The old
    # code read campaign.cleared, which v3 does not have; a save with an
    # EMPTY campaign would have thrown just the same, but this one also
    # proves the answer — one stage, not three.
    save = {
        "version": 3,
        "campaign": {
            "levels": [
                {"cleared": [1, 2], "stars": {"1": 3, "2": 2}, "bestTurns": {"1": 1}},
                {"cleared": [1], "stars": {"1": 2}, "bestTurns": {}},
                {"cleared": [1], "stars": {"1": 1}, "bestTurns": {}},
            ],
            "lastStageId": 2,
            "lastLevel": 0,
        },
        "theme": {"selected": "classic"},
    }
    errors = []
    ctx, pg = boot(browser, base, errors, save)
    ctx_before = pg.evaluate("() => window.__fourball.state.screen")
    ok(ctx_before == "home", f"boots onto the home screen (got {ctx_before})")
    # The button a player presses, not the function behind it.
    pg.click("#btn-tables")
    # A throw inside the click handler leaves state.screen wherever it was,
    # so this is given a short leash and then reported rather than raising
    # — the failure IS that the screen never came up.
    try:
        pg.wait_for_function("() => window.__fourball.state.screen === 'tables'", timeout=4000)
    except Exception:
        pass
    pg.wait_for_timeout(200)
    if screens:
        pg.screenshot(path=str(OUT / "tables-screen.png"))
    ok(not errors, f"the tables screen opens with no uncaught exception ({errors[:2]})")
    # Half-painted is the shape the throw left behind: the screen is up
    # and the cards on it are empty.
    cards = pg.evaluate(
        """() => document.querySelectorAll("#table-grid .card").length"""
    )
    ok(cards > 0, f"and it has its table cards on it ({cards})")
    unlocked = pg.evaluate(
        """() => { const s = window.__fourball; return s.state.screen; }"""
    )
    ok(unlocked == "tables", "and stays on the tables screen")
    ctx.close()


def main():
    quick = "--quick" in sys.argv
    screens = not quick
    OUT.mkdir(parents=True, exist_ok=True)
    srv = subprocess.Popen(
        ["node", str(ROOT / "tools/serve.mjs"), f"--port={PORT}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(1.2)
    base = f"http://127.0.0.1:{PORT}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            first_touch(browser, base, screens)
            tables_screen(browser, base, screens)
            browser.close()
    finally:
        srv.terminate()

    bad = [w for good, w in results if not good]
    print(f"\n{len(results) - len(bad)} passed, {len(bad)} failed")
    if screens:
        print(f"screenshots in {OUT}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
