"""Thumbnails for the two pages that never had one: the Mahjong front page
and the Daily Challenge.

    python3 tools/qa/make_thumbs.py

Rewritten by the cross-page design review. The first version shot the board
in a 1200x850 DESKTOP viewport and then letterboxed the wide result onto a
square of felt, which produced two card images with the same three faults:

  1. the board floated in the middle of the square with dead felt down both
     sides, so the subject only owned about half the card;
  2. a whole 144-tile board squeezed into 88 rendered pixels made the tiles
     unreadable — noise, not tiles;
  3. worst of all, /  and /daily.html render the SAME board, so the two cards
     were the same picture. Two adjacent cards a 65+ visitor cannot tell
     apart is not a thumbnail problem, it is a navigation problem.

What it does now:

  * shoots in a PORTRAIT viewport (620x900 at 3x), where the mahjong board
    lays out tall, and then COVER-crops to the square instead of letterboxing
    it. The tiles come out roughly twice the size and read as tiles at 88px.
  * gives Daily its own picture. Daily really is the same board, so the card
    is honest about that — the board is still the picture — and what is added
    is the thing that makes Daily Daily: this page's own month calendar with
    today ringed, as a small card in the corner. Cropped above the month name
    on purpose, so the asset does not go stale ("September 2026" baked into a
    permanent thumbnail dates the site every month).

Both land at 400x400 (games.json card.size) and well under 100 KB.
"""
import asyncio
import os
import subprocess
import sys
import time

from PIL import Image, ImageDraw
from playwright.async_api import async_playwright

PORT = 8161
ROOT = "/home/claude/site"
CREAM = (247, 242, 230)          # --paper, the panel/card ground
FELT_DARK = (11, 74, 53)         # --felt-dark, the site's edge colour
SIDE = 400
# How much of the card the calendar corner takes. 0.52 was chosen by looking:
# under ~0.45 it stops reading as a calendar at 88px, over ~0.6 it swallows
# the board and the card stops saying "mahjong".
CAL_FRAC = 0.52


def cover_square(im, side=SIDE):
    """Crop to a square from the centre, then resize — the board fills the
    card. (The old recipe did the opposite: it padded to a square, so the
    board shrank.)"""
    s = min(im.width, im.height)
    left = (im.width - s) // 2
    top = (im.height - s) // 2
    return im.crop((left, top, left + s, top + s)).resize((side, side), Image.LANCZOS)


def contain_square(im, side):
    """Fit the WHOLE picture on cream — used for the calendar, where cutting
    a column off would leave a grid that is not a week."""
    s = max(im.width, im.height)
    out = Image.new("RGB", (s, s), CREAM)
    out.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return out.resize((side, side), Image.LANCZOS)


async def dismiss(pg):
    for sel in ["#modal-win .btn", ".modal-overlay[data-open='true'] .btn"]:
        el = await pg.query_selector(sel)
        if el and await el.is_visible():
            await el.click()
            await pg.wait_for_timeout(600)


async def shoot(browser, path, selector, vw, vh):
    ctx = await browser.new_context(viewport={"width": vw, "height": vh}, device_scale_factor=3)
    pg = await ctx.new_page()
    await pg.goto(f"http://127.0.0.1:{PORT}{path}", wait_until="networkidle")
    await pg.wait_for_timeout(2500)
    await dismiss(pg)
    el = await pg.query_selector(selector)
    if el is None:
        raise SystemExit(f"{path}: no {selector}")
    tmp = f"/tmp/thumb-{abs(hash(path + selector))}.png"
    await el.screenshot(path=tmp)
    await ctx.close()
    return Image.open(tmp).convert("RGB")


def save(im, name):
    im.save(f"{ROOT}/{name}", quality=84, optimize=True)
    kb = os.path.getsize(f"{ROOT}/{name}") // 1024
    print(f"  {name}: {kb} KB")
    if kb > 100:
        print(f"    WARNING: over the 100 KB the site's other thumbs keep to")


async def main():
    srv = subprocess.Popen(["node", f"{ROOT}/tools/serve.mjs", f"--port={PORT}"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()

            # --- Mahjong: the board, tight ---------------------------------
            save(cover_square(await shoot(b, "/", "#board-viewport", 620, 900)),
                 "mahjong-thumb.jpg")

            # --- Daily: the same board, plus the calendar that names it ----
            board = cover_square(await shoot(b, "/daily.html", "#board-viewport", 620, 900))
            # #daily-calendar-grid, not .daily-calendar-section: the section
            # carries the "September 2026" heading, and a month name baked
            # into a permanent asset is wrong eleven months of the year.
            cal = await shoot(b, "/daily.html", "#daily-calendar-grid", 900, 1200)
            inner = int(SIDE * CAL_FRAC)
            pad = 10
            card = Image.new("RGB", (inner + 2 * pad, inner + 2 * pad), CREAM)
            ImageDraw.Draw(card).rectangle([0, 0, card.width - 1, card.height - 1],
                                           outline=FELT_DARK, width=8)
            card.paste(contain_square(cal, inner), (pad, pad))
            out = board.copy()
            out.paste(card, (SIDE - card.width - 10, SIDE - card.height - 10))
            save(out, "daily-thumb.jpg")

            await b.close()
    finally:
        srv.terminate()


asyncio.run(main())
