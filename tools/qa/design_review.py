"""Cross-page DESIGN REVIEW screenshots — the eyes pass, not the assertions pass.

    python3 tools/qa/design_review.py                 all 18 pages
    python3 tools/qa/design_review.py solitaire home  just those folders

`nav_qa.py` / `standalone_nav_qa.py` / `dab_qa.py` assert. This one exists to
be LOOKED AT: it drives every one of the eighteen pages that now carry the top
bar — the twelve games plus about / contact / privacy / terms / guides index /
the mahjong guide — at the four sizes the site is graded at, and saves, per
page, one folder of:

    01-load-<size>.png    the first screen exactly as it loads
    02-panel-<size>.png   the Games panel open, scrolled to the top
    03-panel-lang.png     the panel scrolled to the language grid (375x667)
    04-arabic.png         the page in Arabic (375x667), one page only

Four sizes: 375x667 (the tightest real phone), 390x844 (the common phone),
820x1180 (iPad Air portrait — where the bar starts sticking) and 1280x800.
device_scale_factor is 1 on purpose: these are read by eye at 1x, and a
retina shot of 163 screens is a folder nobody opens.

It serves through tools/serve.mjs so vercel.json's real CSP applies, and it
prints any console error it sees per page — a design pass that silently ran
against a broken stylesheet is worse than no pass.
"""
import json
import subprocess
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 8166
OUT = ROOT / "tools/qa/out/review"

REGISTRY = json.loads((ROOT / "games.json").read_text())
GAMES = REGISTRY["games"]

# (url, folder, shell) — shell "site" pages have a <main>; "standalone" pages
# are full-viewport portal builds whose bar sits in a real flex row.
PAGES = [
    ("/", "01-mahjong", "site"),
    ("/daily.html", "02-daily", "site"),
    ("/solitaire/", "03-solitaire", "site"),
    ("/freecell/", "04-freecell", "site"),
    ("/word-search/", "05-word-search", "site"),
    ("/five-in-a-row/", "06-five-in-a-row", "site"),
    ("/dots-and-boxes/", "07-dots-and-boxes", "standalone"),
    ("/backgammon/", "08-backgammon", "site"),
    ("/four-ball-billiards/", "09-four-ball-billiards", "standalone"),
    ("/eight-ball-pool/", "10-eight-ball-pool", "site"),
    ("/stone-flick/", "11-stone-flick", "standalone"),
    ("/shuffleboard/", "12-shuffleboard", "standalone"),
    ("/about.html", "13-about", "site"),
    ("/contact.html", "14-contact", "site"),
    ("/privacy.html", "15-privacy", "site"),
    ("/terms.html", "16-terms", "site"),
    ("/guides/", "17-guides", "site"),
    ("/guides/how-to-play-mahjong-solitaire.html", "18-guide-mahjong", "site"),
]

VIEWPORTS = [
    ("375x667", 375, 667),
    ("390x844", 390, 844),
    ("820x1180", 820, 1180),
    ("1280x800", 1280, 800),
]

# The one page shot in Arabic — a standalone build, because that is the case
# where /nav.js turns the document rtl on a page with no i18n of its own.
ARABIC_PAGE = "/dots-and-boxes/"

EXTERNAL = re.compile(r"googletagmanager|google-analytics|_vercel/insights")

notes = []


def dismiss_modals(pg):
    for _ in range(3):
        n = pg.evaluate(
            """() => { const m = [...document.querySelectorAll('.modal-overlay[data-open="true"]')].pop();
            if (!m) return 0; const b = m.querySelector('.modal-actions .btn'); if (b) b.click();
            else m.dataset.open = 'false'; return 1; }"""
        )
        if not n:
            return
        pg.wait_for_timeout(250)


def measure(pg):
    """The numbers worth having next to the picture."""
    return pg.evaluate(
        """() => {
        const r = (s) => { const el = document.querySelector(s); if (!el) return null;
            const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
            return {x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
                    size: cs.fontSize, weight: cs.fontWeight, color: cs.color}; };
        const mark = document.querySelector('.nav-mark');
        const markFill = mark ? [...mark.querySelectorAll('*')].map(n => getComputedStyle(n).fill) : null;
        return {
          navInner: r('.site-nav-inner'), brand: r('.nav-brand'), mark: r('.nav-mark'),
          games: r('#nav-games'), lang: r('#nav-lang'), h1: r('main h1'),
          markFill, navBg: getComputedStyle(document.querySelector('.site-nav') || document.body).backgroundColor,
          h1Text: document.querySelector('main h1')?.textContent.trim() || null,
          goal: document.querySelector('main h1')?.nextElementSibling?.textContent.trim().slice(0, 90) || null,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        }; }"""
    )


def shoot(pg, folder, name):
    folder.mkdir(parents=True, exist_ok=True)
    pg.screenshot(path=str(folder / name))


def run(browser, base, url, folder_name, shell, want):
    if want and folder_name not in want and url not in want:
        return
    folder = OUT / folder_name
    print("\n=== " + folder_name + "  " + url)
    for label, w, h in VIEWPORTS:
        errors = []
        ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1,
                                  is_mobile=w < 768, has_touch=w < 768, base_url=base)
        pg = ctx.new_page()
        pg.on("console", lambda m: errors.append(m.text[:160])
              if m.type == "error" and not EXTERNAL.search(m.text)
              and "Failed to load resource" not in m.text else None)
        pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:160]))
        try:
            pg.goto(base + url, wait_until="networkidle", timeout=40000)
            pg.wait_for_timeout(700)
            shoot(pg, folder, f"01-load-{label}.png")
            m = measure(pg)
            print(f"  [{label}] bar={m['navInner'] and m['navInner']['h']} "
                  f"brand=({m['brand'] and m['brand']['x']},{m['brand'] and m['brand']['size']},"
                  f"{m['brand'] and m['brand']['weight']}) "
                  f"games={m['games'] and (m['games']['w'], m['games']['h'], m['games']['size'])} "
                  f"lang={m['lang'] and (m['lang']['w'], m['lang']['h'], m['lang']['size'])} "
                  f"mark={m['markFill']} navbg={m['navBg']} overflow={m['overflow']}")
            if m["h1"]:
                print(f"           h1={m['h1Text']!r} {m['h1']['size']}/{m['h1']['weight']} "
                      f"next={m['goal']!r}")
            if m["overflow"] > 1:
                notes.append(f"{folder_name} [{label}]: horizontal overflow {m['overflow']}px")

            dismiss_modals(pg)
            pg.click("#nav-games")
            pg.wait_for_timeout(500)
            pg.evaluate("document.getElementById('nav-panel-body').scrollTop = 0")
            pg.wait_for_timeout(200)
            shoot(pg, folder, f"02-panel-{label}.png")
            grid = pg.evaluate(
                """() => { const g = document.querySelector('.nav-card-grid');
                const cards = [...g.querySelectorAll('a.game-card')];
                const thumb = cards.map(c => { const i = c.querySelector('img');
                    const b = i.getBoundingClientRect();
                    return {src: (i.getAttribute('src')||'').split('/').pop(),
                            w: Math.round(b.width), h: Math.round(b.height),
                            nat: i.naturalWidth + 'x' + i.naturalHeight, ok: i.complete && i.naturalWidth > 0}; });
                return {cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
                        n: cards.length, broken: thumb.filter(t => !t.ok),
                        sizes: [...new Set(thumb.map(t => t.w + 'x' + t.h))],
                        close: (() => { const b = document.getElementById('nav-close').getBoundingClientRect();
                            return {w: Math.round(b.width), h: Math.round(b.height), y: Math.round(b.y)}; })(),
                        now: document.querySelector('.nav-now')?.textContent.trim() || null}; }"""
            )
            print(f"           panel cols={grid['cols']} cards={grid['n']} thumb={grid['sizes']} "
                  f"close={grid['close']} now={grid['now']!r} broken={grid['broken']}")
            if grid["broken"]:
                notes.append(f"{folder_name} [{label}]: thumbnails failed to load {grid['broken']}")
            if grid["n"] != len(GAMES):
                notes.append(f"{folder_name} [{label}]: {grid['n']} cards, expected {len(GAMES)}")

            if label == "375x667":
                pg.evaluate(
                    """() => { const s = document.getElementById('nav-lang-section');
                    const b = document.getElementById('nav-panel-body');
                    b.scrollTop += s.getBoundingClientRect().top - b.getBoundingClientRect().top; }"""
                )
                pg.wait_for_timeout(250)
                shoot(pg, folder, "03-panel-lang.png")
        except Exception as e:  # noqa: BLE001
            notes.append(f"{folder_name} [{label}]: threw {type(e).__name__}: {e}")
            print(f"  [{label}] THREW {type(e).__name__}: {e}")
        finally:
            if errors:
                notes.append(f"{folder_name} [{label}]: console {errors}")
                print(f"  [{label}] CONSOLE {errors}")
            ctx.close()

    if url == ARABIC_PAGE:
        ctx = browser.new_context(viewport={"width": 375, "height": 667}, device_scale_factor=1,
                                  is_mobile=True, has_touch=True, base_url=base)
        pg = ctx.new_page()
        pg.goto(base + url, wait_until="networkidle", timeout=40000)
        pg.evaluate("localStorage.setItem('site.v1.lang', 'ar')")
        pg.goto(base + url, wait_until="networkidle", timeout=40000)
        pg.wait_for_timeout(800)
        shoot(pg, folder, "04-arabic.png")
        dismiss_modals(pg)
        pg.click("#nav-games")
        pg.wait_for_timeout(500)
        shoot(pg, folder, "04-arabic-panel.png")
        ctx.close()


def main():
    want = set(a for a in sys.argv[1:] if not a.startswith("-"))
    OUT.mkdir(parents=True, exist_ok=True)
    srv = subprocess.Popen(["node", "tools/serve.mjs", f"--port={PORT}"], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    base = f"http://localhost:{PORT}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for url, folder, shell in PAGES:
                run(browser, base, url, folder, shell, want)
            browser.close()
    finally:
        srv.terminate()
    print("\n---- things worth a second look ----")
    for n in notes:
        print("  * " + n)
    print(f"\n{len(notes)} note(s).  Screenshots: {OUT}")


if __name__ == "__main__":
    main()
