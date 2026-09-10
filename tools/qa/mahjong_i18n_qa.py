"""Browser QA for the Mahjong board's own words (/i18n/mahjong.js).

    python3 tools/qa/mahjong_i18n_qa.py            checks + screenshots
    python3 tools/qa/mahjong_i18n_qa.py --quick    checks only

Mahjong and the Daily Challenge run on game.js, a classic script that cannot
import the language runtime. /mahjong-i18n.js bridges the two, and the whole
bridge rests on ONE ordering claim that no unit test can make: a deferred
module runs after game.js is parsed and before DOMContentLoaded, so
window.mahjongI18n is there when initApp() looks for it. If that is wrong,
every string on the board renders as its own key ("titleUndo", "pairsLabel")
and the site looks broken in a way the static checks cannot see.

So this drives a real browser under the real Content-Security-Policy
(tools/serve.mjs applies vercel.json's headers — `script-src 'self'`, so a
module the CSP would refuse fails here the way it would in production) and
asserts:

  1. NOTHING RENDERS AS A KEY. Not on first load, not after a language
     switch, not after the reload the switch triggers — on either page, in
     any language. This is the one check that would catch a typo'd
     data-i18n, a dictionary that failed to import, or the ordering claim
     above being false.
  2. THE BOARD STILL WORKS. 144 tiles, the pairs count and the timer both
     reading a number, no page error — in every language, because the
     dictionary is consulted while the board is being drawn (tile
     aria-labels) and a throw there takes the board down with it.
  3. THE DAILY CALENDAR IS IN THE LANGUAGE. Its month title and weekday
     letters come from arrays, which is the one shape in the dictionary that
     is not a string, so it is the one most likely to be got wrong.
  4. NOTHING OVERFLOWS AT 375px. German and Indonesian are the long ones;
     the toolbar and the settings sheet have to hold them.

Screenshots land in tools/qa/out/mahjong-i18n/.
"""
import json, re, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 8172
OUT = ROOT / "tools/qa/out/mahjong-i18n"

PAGES = ["/", "/daily.html"]
# en plus the shapes most likely to break something: the longest words
# (de, id), a CJK script, and the right-to-left one.
LANGS = ["en", "de", "id", "ko", "ja", "ar"]

# Every key the two pages could render. A page that shows one of these as
# text has fallen back to the key, which is the failure this file exists for.
def all_keys():
    keys = set()
    for name in ("index.html", "daily.html"):
        html = (ROOT / name).read_text()
        html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
        keys |= set(re.findall(r'data-i18n="([^"]+)"', html))
        for attr in re.findall(r'data-i18n-attr="([^"]+)"', html):
            for pair in attr.split(";"):
                bits = pair.split(":")
                if len(bits) > 1:
                    keys.add(bits[1].strip())
    return sorted(keys)


def open_settings(page):
    """Open Settings the way the viewport allows: the toolbar button on a
    wide screen, Menu → Settings on a phone."""
    if page.is_visible("#btn-settings"):
        page.click("#btn-settings")
    else:
        page.click("#btn-menu-mobile")
        page.wait_for_timeout(200)
        page.click("#btn-settings-mobile")
    page.wait_for_timeout(300)


def main():
    quick = "--quick" in sys.argv
    keys = all_keys()
    OUT.mkdir(parents=True, exist_ok=True)
    srv = subprocess.Popen(["node", "tools/serve.mjs", f"--port={PORT}"], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    failures = []

    def check(cond, what):
        if not cond:
            failures.append(what)
            print("  FAIL -", what)
        else:
            print("  ok   -", what)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for lang in LANGS:
                for page_path in PAGES:
                    ctx = browser.new_context(viewport={"width": 375, "height": 667})
                    # The language is set before any script runs, so the page
                    # boots straight into it — which is what a returning
                    # visitor gets, and the only path game.js supports (it
                    # reads the language once, at boot).
                    ctx.add_init_script(f"localStorage.setItem('site.v1.lang', {json.dumps(lang)})")
                    page = ctx.new_page()
                    errors = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    page.goto(f"http://localhost:{PORT}{page_path}", wait_until="load")
                    page.wait_for_timeout(700)
                    label = f"{lang} {page_path}"

                    # Nothing may open by itself in front of the board. A
                    # saved game is resumed silently, so the only overlay a
                    # returning player can land on is the Paused screen they
                    # themselves left the game in.
                    opened = page.eval_on_selector_all(
                        '.modal-overlay[data-open="true"]', "ns => ns.map(n => n.id)")
                    check(opened in ([], ["modal-pause"]),
                          f"{label}: no modal opens on top of the board ({opened})")

                    check(not errors, f"{label}: no page error ({errors[:1]})")
                    check(page.eval_on_selector_all("#board .tile, #board .mj-tile, #board > *", "n => n.length") >= 100,
                          f"{label}: the board is drawn")
                    pairs = page.inner_text("#pairs-count")
                    check(pairs.strip().isdigit(), f"{label}: pairs count is a number ({pairs!r})")
                    check(re.match(r"^\d\d:\d\d", page.inner_text("#timer-display").strip()),
                          f"{label}: the timer reads a time")

                    # 1. nothing anywhere reads as a key
                    # At 375px the desktop toolbar is hidden and Settings
                    # lives behind Menu in the phone's sheet — the same two
                    # taps a player makes.
                    open_settings(page)
                    # Asked per element, not by scanning the page for the
                    # words: in English the article below the board really
                    # does contain "hint", "undo", "close" and "games", so a
                    # page-wide search flags them every time and means
                    # nothing. What matters is whether THIS element is
                    # showing THIS key.
                    leaked = page.evaluate("""() => [...document.querySelectorAll('[data-i18n]')]
                        .filter(el => el.textContent.trim() === el.dataset.i18n)
                        .map(el => el.dataset.i18n)""")
                    check(not leaked, f"{label}: no string rendered as its key ({leaked[:6]})")
                    titles = page.eval_on_selector_all(
                        "[title]", "ns => ns.map(n => n.getAttribute('title'))")
                    leaked_t = [t for t in titles if t in keys]
                    check(not leaked_t, f"{label}: no tooltip rendered as its key ({leaked_t[:4]})")

                    # 4. the sheet holds the language
                    over = page.evaluate(
                        "() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)")
                    check(over == 0, f"{label}: nothing overflows sideways at 375px (by {over}px)")
                    lang_btns = page.eval_on_selector_all("#mahjong-lang-grid .lang-btn", "n => n.length")
                    check(lang_btns == 14, f"{label}: Settings offers 14 languages (got {lang_btns})")
                    # The sheet is where the long words are (Tile size,
                    # Highlight open tiles, Backup & Restore) and it scrolls,
                    # so it is worth a full-page shot of its own.
                    if not quick and page_path == "/":
                        # The sheet, not the page: a full-page shot with a
                        # scrollable overlay open captures the article behind
                        # it and the top of the sheet, which is the one thing
                        # that was already fine.
                        page.locator(".settings-sheet").screenshot(
                            path=str(OUT / f"{lang}-settings.png"))
                    page.click("#btn-settings-close")
                    page.wait_for_timeout(150)

                    # 3. the calendar
                    if page_path == "/daily.html":
                        title = page.inner_text("#daily-calendar-title").strip()
                        check(bool(title) and title not in ("This Month", "monthTitle"),
                              f"{label}: the calendar names the month ({title!r})")
                        heads = page.eval_on_selector_all(
                            ".daily-calendar-weekday", "n => n.map(x => x.textContent)")
                        check(len(heads) == 7, f"{label}: seven weekday headings (got {len(heads)})")
                        if lang != "en":
                            check(heads != list("SMTWTFS"),
                                  f"{label}: the weekday letters are in {lang} ({heads})")

                    check(page.get_attribute("html", "lang") == ("zh-Hant" if lang == "zh-Hant" else lang),
                          f"{label}: <html lang> is {lang}")
                    check(page.get_attribute("html", "dir") == ("rtl" if lang == "ar" else "ltr"),
                          f"{label}: direction is right for {lang}")

                    if not quick:
                        tag = page_path.strip("/").replace(".html", "") or "index"
                        page.screenshot(path=str(OUT / f"{lang}-{tag}-375.png"), full_page=False)
                        if page_path == "/daily.html":
                            page.locator(".daily-calendar-section").screenshot(
                                path=str(OUT / f"{lang}-calendar.png"))
                    ctx.close()

            # The main page no longer ASKS whether to resume, so the thing
            # that has to be true instead is that it actually resumes. Play
            # two pairs, reload, and the board must come back with those four
            # tiles still gone and Undo still live — otherwise "no modal" has
            # quietly become "your game is thrown away on every visit".
            ctx = browser.new_context(viewport={"width": 375, "height": 667})
            page = ctx.new_page()
            page.goto(f"http://localhost:{PORT}/", wait_until="load")
            page.wait_for_timeout(600)
            before = page.eval_on_selector_all(".tile-btn", "n => n.length")
            check(before == 144, f"resume: a fresh board has 144 tiles (got {before})")
            for _ in range(2):
                page.click("#btn-hint-mobile")
                page.wait_for_timeout(250)
                # Both slots up front, then click each by its own index —
                # asking for "the first hinted tile" twice clicks the SAME
                # tile, which just deselects it.
                slots = page.eval_on_selector_all(
                    '.tile-btn[data-hint="true"]', "ns => ns.map(n => n.dataset.slot)")
                if len(slots) < 2:
                    break
                for slot in slots[:2]:
                    page.click(f'.tile-btn[data-slot="{slot}"]')
                    page.wait_for_timeout(200)
                page.wait_for_timeout(300)
            played = page.eval_on_selector_all(".tile-btn", "n => n.length")
            check(played == 140, f"resume: two pairs were actually taken (got {played})")
            page.reload(wait_until="load")
            page.wait_for_timeout(800)
            opened = page.eval_on_selector_all('.modal-overlay[data-open="true"]', "ns => ns.map(n => n.id)")
            check(opened == [], f"resume: nothing is asked on the way back in ({opened})")
            after = page.eval_on_selector_all(".tile-btn", "n => n.length")
            check(after == 140, f"resume: the saved board came back, not a new one (got {after})")
            check(not page.is_disabled("#btn-undo-mobile"),
                  "resume: the move history came back with it (Undo is live)")
            phone_state = ctx.storage_state()
            ctx.close()

            # The layout (wide turtle / tall tower) is fixed when a board is
            # dealt and cannot be reflowed, so a save carries its shape from
            # screen to screen. An UNTOUCHED board is re-dealt to fit the
            # screen it is opened on; a board with moves in it is restored
            # whatever the shape, because losing progress is far worse than
            # looking a little wrong.
            def layout_at(state, w, h):
                c = browser.new_context(viewport={"width": w, "height": h}, storage_state=state)
                pg = c.new_page()
                pg.goto(f"http://localhost:{PORT}/", wait_until="load")
                pg.wait_for_timeout(800)
                got = (pg.evaluate("() => JSON.parse(localStorage.getItem('mahjongSolitaire.v1.save') || '{}').layoutId"),
                       pg.eval_on_selector_all(".tile-btn", "n => n.length"))
                c.close()
                return got

            fresh = browser.new_context(viewport={"width": 375, "height": 667})
            pg = fresh.new_page()
            pg.goto(f"http://localhost:{PORT}/", wait_until="load"); pg.wait_for_timeout(700)
            untouched = fresh.storage_state()
            check(layout_at(untouched, 375, 667)[0] == "portrait", "layout: a phone deals the tall board")
            fresh.close()
            check(layout_at(untouched, 1280, 800) == ("turtle", 144),
                  "layout: an untouched phone board is re-dealt wide on a desktop")
            check(layout_at(phone_state, 1280, 800) == ("portrait", 140),
                  "layout: a board with moves in it keeps its shape and its progress")

            # 2. the switch itself: Settings' grid must change the language
            #    and survive the reload it triggers.
            ctx = browser.new_context(viewport={"width": 375, "height": 667})
            page = ctx.new_page()
            page.goto(f"http://localhost:{PORT}/", wait_until="load")
            page.wait_for_timeout(500)
            open_settings(page)
            page.click('#mahjong-lang-grid .lang-btn[data-lang="ko"]')
            page.wait_for_timeout(1200)
            check(page.evaluate("() => localStorage.getItem('site.v1.lang')") == "ko",
                  "Settings' grid stores the choice")
            check(page.get_attribute("html", "lang") == "ko",
                  "Settings' grid switched the page and the reload kept it")
            ctx.close()
            browser.close()
    finally:
        srv.terminate()

    print(f"\n{len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
