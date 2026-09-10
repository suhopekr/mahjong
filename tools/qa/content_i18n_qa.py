"""Browser QA for the long-form page translations (/i18n/TRANSLATING.md).

    python3 tools/qa/content_i18n_qa.py            checks + screenshots
    python3 tools/qa/content_i18n_qa.py --quick    checks only

The mechanism under test is data-i18n-content (/i18n/i18n.js): the English
long-form copy lives in the markup because it is the SEO text, and a
translation replaces it only when a non-English language is active, out of a
per-page module fetched with a dynamic import().

Three properties, and every one of them is a claim about a real browser
under the real Content-Security-Policy (tools/serve.mjs applies
vercel.json's headers, so `script-src 'self'` is in force and a dynamic
import that the CSP would refuse fails here the way it would in production):

  1. THE DEFAULT PAGE IS UNTOUCHED. With the content modules still empty —
     which is the state they ship in until the translators land — every
     page reads exactly the English in its markup, and an English visitor
     fetches NOTHING extra: no /i18n/games.js, no page module, not one
     request that was not there before. That is the whole justification for
     keeping English in the HTML, so it is the first thing checked.

  2. A TRANSLATION SWAPS, AND STICKS. A throwaway fixture translation is
     written into one module for one language, and the page has to show it
     after a language switch and still show it after a reload (the language
     lives in localStorage under site.v1.lang, and the reload is what the
     nav panel does). Switching back to English has to put the authored
     English back — the runtime keeps it, so this needs no reload either.
     The fixture is REMOVED again at the end, in a finally block: it is a
     test fixture and must never be committed.

  3. A BROKEN MODULE IS COSMETIC. A module that does not parse leaves the
     page in English, with the layout, the board and the controls intact.
     A translation that fails to load must never be worse than a missing
     translation — that is the promise, and this is where it is kept.

Screenshots land in tools/qa/out/content-i18n/ and are meant to be looked
at: the front page and one game page at 375x667 and 1280x800, before and
during a translation, so a swap that shifts the layout is visible rather
than merely un-asserted.
"""
import json, re, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 8167
OUT = ROOT / "tools/qa/out/content-i18n"

# Every page that declares a content module, discovered the same way the
# runtime discovers it: from the markup. Nothing here lists pages.
def declared_pages():
    found = []
    for f in sorted(ROOT.rglob("*.html")):
        rel = f.relative_to(ROOT).as_posix()
        if rel.startswith(("tools/", "crazygames/")):
            continue
        html = f.read_text(encoding="utf-8")
        m = re.search(r'data-i18n-module="([^"]+)"', html)
        if not m:
            continue
        url = "/" if rel == "index.html" else "/" + rel[: -len("index.html")] if rel.endswith("/index.html") else "/" + rel
        found.append((url, rel, m.group(1)))
    return found


PAGES = declared_pages()

# The page and language the fixture is written for. Solitaire because it has
# the fullest article (intro, How to Play with a list, eight FAQ pairs) and a
# game runtime of its own, so the fixture also proves the swap does not
# fight the game's own i18n instance.
FIXTURE_PAGE = "/solitaire/"
FIXTURE_MODULE = ROOT / "solitaire/src/i18n/content.js"
FIXTURE_LANG = "ko"

EXTERNAL = re.compile(r"googletagmanager|google-analytics|_vercel/insights")

results = []


def ok(cond, what):
    results.append((bool(cond), what))
    if not cond:
        print("  FAIL - " + what)
    return bool(cond)


def section(t):
    print("\n" + t)


def new_page(browser, w, h, base, errors, requests=None):
    ctx = browser.new_context(viewport={"width": w, "height": h},
                             device_scale_factor=2 if w < 768 else 1,
                             is_mobile=w < 768, has_touch=w < 768,
                             base_url=base)
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text[:200])
          if m.type == "error" and not EXTERNAL.search(m.text)
          and "Failed to load resource" not in m.text else None)
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:200]))
    if requests is not None:
        pg.on("request", lambda r: requests.append(r.url) if not EXTERNAL.search(r.url) else None)
    return ctx, pg


def keyed_text(pg):
    """Every data-i18n-content block on the page: key -> its visible text."""
    return pg.evaluate("""() => {
        const out = {};
        for (const el of document.querySelectorAll('[data-i18n-content]'))
            out[el.dataset.i18nContent] = el.textContent.replace(/\\s+/g, ' ').trim();
        return out; }""")


def authored_text(rel):
    """The same thing read straight out of the file on disk, which is what a
    crawler gets. Content blocks do not nest, so the element's own closing
    tag is the next one of its kind."""
    html = re.sub(r"<!--[\s\S]*?-->", "", (ROOT / rel).read_text(encoding="utf-8"))
    out = {}
    for m in re.finditer(r'<([a-z0-9]+)((?:\s[^>]*)?)\sdata-i18n-content="([^"]+)"((?:\s[^>]*)?)>', html):
        tag, key = m.group(1), m.group(3)
        at = m.end()
        close = html.find(f"</{tag}>", at)
        inner = html[at:close] if close > -1 else ""
        out[key] = {"html": re.sub(r"\s+", " ", inner).strip(),
                    "text": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", inner)).replace("&amp;", "&").strip()}
    return out


# Keys under this prefix are the game names and card descriptions, and they
# live in the shared /i18n/games.js, not in the page's own module.
GAME_PREFIX = "game."


def own(keys):
    return {k: v for k, v in keys.items() if not k.startswith(GAME_PREFIX)}


def set_lang(pg, code):
    """What the nav panel does: store the choice, then reload from the top.
    The panel's own click path is tools/qa/nav_qa.py's business; this pass is
    about what the CONTENT does once the language has changed."""
    pg.evaluate("(c) => localStorage.setItem('site.v1.lang', c)", code)
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(500)


def shots(browser, base, url, name, lang, tag):
    """Two frames per size: the top of the page (the chrome and the board,
    where a shifted layout shows) and the article itself scrolled into view
    (where the words are). Both, in both languages, so the pair can be put
    side by side."""
    for w, h in [(375, 667), (1280, 800)]:
        ctx, pg = new_page(browser, w, h, base, [])
        pg.goto(base + url, wait_until="networkidle")
        if lang != "en":
            pg.evaluate("(c) => localStorage.setItem('site.v1.lang', c)", lang)
            pg.reload(wait_until="networkidle")
        pg.wait_for_timeout(700)
        pg.screenshot(path=str(OUT / f"{name}-{w}x{h}-{tag}-top.png"))
        pg.evaluate("""() => { const el = document.querySelector('.content');
            if (el) el.scrollIntoView({block: 'start'}); }""")
        pg.wait_for_timeout(400)
        pg.screenshot(path=str(OUT / f"{name}-{w}x{h}-{tag}-article.png"))
        ctx.close()


def main():
    quick = "--quick" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    srv = subprocess.Popen([ "node", str(ROOT / "tools/serve.mjs"), f"--port={PORT}"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{PORT}"
    original = FIXTURE_MODULE.read_text(encoding="utf-8")
    time.sleep(1.2)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            run(browser, base, quick, original)
            browser.close()
    finally:
        # The fixture is a fixture. Whatever happened above, the module goes
        # back exactly as it was.
        FIXTURE_MODULE.write_text(original, encoding="utf-8")
        srv.terminate()
        srv.wait(timeout=5)

    passed = sum(1 for okay, _ in results if okay)
    failed = len(results) - passed
    print(f"\n{passed} passed, {failed} failed")
    print(f"screenshots: {OUT}")
    print("fixture removed, /solitaire/src/i18n/content.js restored: " +
          str(FIXTURE_MODULE.read_text(encoding='utf-8') == original))
    sys.exit(1 if failed else 0)


def run(browser, base, quick, original):
    # ---------------------------------------------------------------------
    # 1. the default page: English, untouched, and nothing extra fetched
    # ---------------------------------------------------------------------
    section("English is the page as authored, and costs nothing")
    ok(len(PAGES) >= 10, f"found the pages that declare a content module ({len(PAGES)})")
    for url, rel, module in PAGES:
        errors, requests = [], []
        ctx, pg = new_page(browser, 1280, 800, base, errors, requests)
        pg.goto(base + url, wait_until="networkidle")
        pg.wait_for_timeout(400)

        on_page, on_disk = keyed_text(pg), authored_text(rel)
        # Every keyed block, word for word what the file says. This is the
        # property that lets the English stay in the markup at all.
        wrong = [k for k, v in on_disk.items() if on_page.get(k) != v["text"]]
        ok(not wrong, f"{url}: every keyed block still reads its authored English ({len(on_disk)} keys)"
                      + ("" if not wrong else "\n    differs: " + ", ".join(wrong[:6])))
        # Nothing extra on the wire: not the page's module, not the shared
        # one. This is the claim that pays for keeping English in the HTML.
        extra = [u for u in requests if u.endswith("/i18n/games.js") or u.endswith(module)]
        ok(not extra, f"{url}: an English visitor fetches no content module ({', '.join(extra) or 'none'})")
        # …and the wrapper still tells a crawler this is English.
        ok(pg.evaluate("""() => { const el = document.querySelector('[data-i18n-lang]');
            return el && el.getAttribute('lang') === 'en' && el.getAttribute('dir') === 'ltr'; }"""),
           f"{url}: the .content block is still lang=en dir=ltr")
        ok(not errors, f"{url}: no console or page errors" + ("" if not errors else "\n    " + "\n    ".join(errors)))
        ctx.close()

    # A non-English visitor with the modules still empty gets the same page —
    # the fallback path, which is the state the site is in until the
    # translators land, so it is not a hypothetical.
    section("a non-English visitor, with the modules still empty, also gets English")
    for url, rel, _module in PAGES[:4]:
        errors = []
        ctx, pg = new_page(browser, 1280, 800, base, errors)
        pg.goto(base + url, wait_until="networkidle")
        set_lang(pg, FIXTURE_LANG)
        on_page, on_disk = keyed_text(pg), authored_text(rel)
        wrong = [k for k, v in on_disk.items() if on_page.get(k) != v["text"]]
        ok(not wrong, f"{url} in {FIXTURE_LANG}: the article is still the authored English"
                      + ("" if not wrong else "\n    differs: " + ", ".join(wrong[:6])))
        ok(not errors, f"{url} in {FIXTURE_LANG}: no console or page errors"
                       + ("" if not errors else "\n    " + "\n    ".join(errors)))
        ctx.close()

    # ---------------------------------------------------------------------
    # screenshots: the English page, before any fixture exists
    # ---------------------------------------------------------------------
    if not quick:
        for url, name in [("/", "home"), (FIXTURE_PAGE, "solitaire")]:
            shots(browser, base, url, name, "en", "en")

    # ---------------------------------------------------------------------
    # 2. a real translation swaps, and survives a reload
    # ---------------------------------------------------------------------
    section("a fixture translation replaces the article, and a reload keeps it")
    rel = next(r for u, r, _ in PAGES if u == FIXTURE_PAGE)
    all_keys = authored_text(rel)
    on_disk = own(all_keys)          # the page's own module's keys
    shared = {k: v for k, v in all_keys.items() if k.startswith(GAME_PREFIX)}
    ok(len(shared) > 0, f"the page also carries shared game-name keys ({len(shared)}) — those stay English here")
    # One fixture value per key, unmistakable on sight, and carrying the same
    # inline markup the English has: keeping <strong> is part of a
    # translator's job, so the fixture does it too.
    fixture_html, fixture_text = {}, {}
    for k, v in on_disk.items():
        if "<strong>" in v["html"]:
            fixture_html[k] = f"<strong>[{FIXTURE_LANG}]</strong> 번역 {k}"
            fixture_text[k] = f"[{FIXTURE_LANG}] 번역 {k}"
        else:
            fixture_html[k] = fixture_text[k] = f"[{FIXTURE_LANG}] 번역 {k}"
    write_fixture(fixture_html)

    errors, requests = [], []
    ctx, pg = new_page(browser, 1280, 800, base, errors, requests)
    pg.goto(base + FIXTURE_PAGE, wait_until="networkidle")
    before = keyed_text(pg)
    ok(all(before.get(k) == v["text"] for k, v in on_disk.items()),
       "before the switch the page is English")
    set_lang(pg, FIXTURE_LANG)
    after = keyed_text(pg)
    swapped = [k for k in fixture_text if after.get(k) == fixture_text[k]]
    ok(len(swapped) == len(fixture_text),
       f"every keyed block swapped to the fixture ({len(swapped)} of {len(fixture_text)})")
    ok(pg.evaluate("""() => { const li = document.querySelector('.content li[data-i18n-content]');
        return li && li.querySelector('strong') !== null; }"""),
       "a list item's own <strong> survived the swap (the value is inserted as HTML)")
    ok(pg.evaluate(f"""() => {{ const el = document.querySelector('[data-i18n-lang]');
        return el && el.getAttribute('lang') === '{FIXTURE_LANG}'; }}"""),
       f"the .content wrapper now says lang={FIXTURE_LANG}")
    ok(any(FIXTURE_PAGE + "src/i18n/content.js" in u for u in requests),
       "…and the module was actually fetched this time")
    # The game names in the chrome come out of the shared module, which the
    # fixture does not touch — they must therefore still be English, which
    # is exactly the "leave the markup alone" behaviour, in the same page.
    ok(pg.evaluate("""() => { const el = document.querySelector('.footer-nav-links a[data-i18n-content]');
        return el && el.textContent.trim(); }""") == "Mahjong Solitaire",
       "an untranslated key (the footer game name) is left as authored English")
    ok(not errors, "no console or page errors during the swap"
                   + ("" if not errors else "\n    " + "\n    ".join(errors)))

    # A reload: the language is in localStorage, so the translation has to
    # come back on its own.
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(500)
    again = keyed_text(pg)
    ok(all(again.get(k) == v for k, v in fixture_text.items()), "a reload keeps the translation")
    ok(not errors, "no errors after the reload" + ("" if not errors else "\n    " + "\n    ".join(errors)))

    if not quick:
        shots(browser, base, FIXTURE_PAGE, "solitaire", FIXTURE_LANG, f"{FIXTURE_LANG}-fixture")

    # Back to English, with no reload at all: the runtime kept the authored
    # HTML, so the SEO copy comes straight back.
    pg.evaluate("() => localStorage.setItem('site.v1.lang', 'en')")
    pg.evaluate("""() => { const g = document.querySelector('#nav-lang-grid .lang-btn[data-lang=\"en\"]');
        if (g) g.click(); }""")
    pg.wait_for_timeout(400)
    back = keyed_text(pg)
    restored = [k for k, v in on_disk.items() if back.get(k) == v["text"]]
    ok(len(restored) == len(on_disk),
       f"switching back to English restores the authored copy without a reload ({len(restored)} of {len(on_disk)})")
    ctx.close()

    # ---------------------------------------------------------------------
    # 3. a broken module is cosmetic, and nothing more
    # ---------------------------------------------------------------------
    section("a module that does not parse leaves the page in English")
    FIXTURE_MODULE.write_text(
        "// deliberately broken fixture — tools/qa/content_i18n_qa.py\n"
        "export const content = { ko: { introH: 'unterminated\n", encoding="utf-8")
    errors = []
    ctx, pg = new_page(browser, 1280, 800, base, errors)
    pg.goto(base + FIXTURE_PAGE, wait_until="networkidle")
    set_lang(pg, FIXTURE_LANG)
    broken = keyed_text(pg)
    wrong = [k for k, v in on_disk.items() if broken.get(k) != v["text"]]
    ok(not wrong, "every block is the authored English" + ("" if not wrong else "\n    differs: " + ", ".join(wrong[:6])))
    ok(pg.evaluate("""() => { const el = document.querySelector('[data-i18n-lang]');
        return el && el.getAttribute('lang') === 'en'; }"""),
       "…and the wrapper honestly says lang=en")
    # No visible damage: the article, the board and the toolbar are all there
    # and laid out, and the page does not scroll sideways.
    shape = pg.evaluate("""() => {
        const box = (s) => { const el = document.querySelector(s); if (!el) return null;
            const r = el.getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height)}; };
        return { article: box('.content'), board: box('#sol-table'), bar: box('.site-nav'),
                 buttons: document.querySelectorAll('#solitaire .btn').length,
                 overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }""")
    ok(shape["article"] and shape["article"]["h"] > 400, f"the article is still laid out ({shape['article']})")
    ok(shape["board"] and shape["board"]["w"] > 200, f"the board is still there ({shape['board']})")
    ok(shape["bar"] and shape["bar"]["h"] >= 56, f"the bar is still there ({shape['bar']})")
    ok(shape["buttons"] >= 4, f"the toolbar still has its buttons ({shape['buttons']})")
    ok(shape["overflow"] <= 1, f"no horizontal overflow ({shape['overflow']}px)")
    # The only trace is the runtime's own warning. A page error, or a
    # console error from our own code, would mean the failure escaped.
    ours = [e for e in errors if "i18n" not in e.lower()]
    ok(not ours, "no page error and no console error of our own"
                 + ("" if not ours else "\n    " + "\n    ".join(ours)))
    ctx.close()

    # ---------------------------------------------------------------------
    # the fixture goes away, and the page is English again
    # ---------------------------------------------------------------------
    section("the fixture is removed")
    FIXTURE_MODULE.write_text(original, encoding="utf-8")
    ok(FIXTURE_MODULE.read_text(encoding="utf-8") == original,
       "solitaire/src/i18n/content.js is back to the committed version")
    ok(re.search(r"^\s{2}[\w\"'-]+:", FIXTURE_MODULE.read_text(encoding="utf-8"), re.M) is None,
       "…and it declares no language at all, as it ships")
    errors = []
    ctx, pg = new_page(browser, 1280, 800, base, errors)
    pg.goto(base + FIXTURE_PAGE, wait_until="networkidle")
    set_lang(pg, FIXTURE_LANG)
    final = keyed_text(pg)
    ok(all(final.get(k) == v["text"] for k, v in on_disk.items()), "the page is English again")
    ok(not errors, "no errors" + ("" if not errors else "\n    " + "\n    ".join(errors)))
    ctx.close()


def write_fixture(fixture):
    body = ",\n".join(f"    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in fixture.items())
    FIXTURE_MODULE.write_text(
        "// THROWAWAY FIXTURE written by tools/qa/content_i18n_qa.py.\n"
        "// If you are reading this in a commit, the QA run did not finish —\n"
        "// restore this file from git; the committed version declares no\n"
        "// language at all.\n"
        f"export const content = {{\n  ko: {{\n{body}\n  }},\n}};\n", encoding="utf-8")


if __name__ == "__main__":
    main()
