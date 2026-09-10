"""The card thumbnail and the OG image for /dots-and-boxes/, from a real
screenshot of the deployed game.

    python3 tools/qa/dab_thumbs.py

Same recipe as tools/qa/make_thumbs.py — drive the real page under
tools/serve.mjs, screenshot the real board, and save:

  /dots-and-boxes-thumb.jpg   400x400, well under 100 KB (the games.json card)
  /dots-and-boxes/og-image.png  1200x630, felt + name + the same board

The board is played, not posed: a two-player 5x5 Quick Start game is
actually played until about half the boxes are claimed, so the picture
shows what the card promises — lines joined, boxes taken in both players'
colours, the last move still glowing. The portal build's own covers in
assets/covers/ were the reference for the framing (grid centred, both
colours visible, no UI chrome), but this comes off the site build so it
cannot go stale the way a copied cover would.
"""
import asyncio, os, subprocess, sys, time
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont

PORT = 8165
ROOT = "/home/claude/site"
FELT = (11, 74, 53)          # --felt-dark, the site's OG background
CREAM = (247, 242, 230)
BOXES_WANTED = 10            # of 25, and never one colour only — see play()
SEED = 7                     # Math.random is seeded, so this picture is reproducible
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


SEED_SCRIPT = """
  // Deterministic thumbnails: the Quick Start prefill and the coin flip
  // are the only randomness on this path, and both go through
  // Math.random. mulberry32, the same PRNG game/daily.js uses.
  (() => { let a = SEED >>> 0; Math.random = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }; })();
"""


async def play(pg, size, wanted):
    """Set up a two-player Quick Start game and play it until `wanted`
    boxes are claimed by BOTH players. Two players rather than vs AI: no
    thinking pause, no coin flip to wait through, and the picture is
    identical — and one player running the whole board (which happens:
    closing a box gives you another turn) would be a one-colour card."""
    await pg.click("#settings-btn")
    await pg.wait_for_timeout(300)
    await pg.click(f'#size-toggle .seg-btn[data-size="{size}"]')
    await pg.click('#quickstart-toggle .seg-btn[data-quickstart="on"]')
    await pg.click("#settings-close-btn")
    await pg.wait_for_timeout(300)
    await pg.click("#play-friend-btn")
    await pg.wait_for_timeout(800)
    pts = await pg.evaluate("""async (size) => {
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
    for x, y in pts:
        await pg.mouse.click(x, y)
        await pg.wait_for_timeout(70)
        a, b = int(await pg.inner_text("#score-0")), int(await pg.inner_text("#score-1"))
        if a + b >= wanted and min(a, b) >= 3:
            break
    await pg.wait_for_timeout(500)   # let the last draw/capture animation land
    return await pg.inner_text("#score-0"), await pg.inner_text("#score-1")


async def main():
    srv = subprocess.Popen(["node", f"{ROOT}/tools/serve.mjs", f"--port={PORT}"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    shot = "/tmp/dab-board.png"
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            ctx = await b.new_context(viewport={"width": 900, "height": 950}, device_scale_factor=2)
            pg = await ctx.new_page()
            await pg.add_init_script(SEED_SCRIPT.replace("SEED", str(SEED)))
            await pg.goto(f"http://127.0.0.1:{PORT}/dots-and-boxes/", wait_until="networkidle")
            await pg.wait_for_timeout(700)
            score = await play(pg, 5, BOXES_WANTED)
            print(f"  played to {score[0]}-{score[1]}")
            await (await pg.query_selector("#board")).screenshot(path=shot)
            await b.close()
    finally:
        srv.terminate()

    board = Image.open(shot).convert("RGB")
    # The grid is centred in the canvas, so a centred square keeps all of
    # it with its own margin — no arithmetic that can drift from the
    # game's layout.
    side = min(board.width, board.height)
    sq = board.crop(((board.width - side) // 2, (board.height - side) // 2,
                     (board.width - side) // 2 + side, (board.height - side) // 2 + side))
    # A little air around it, in the board's own paper colour (sampled, so
    # it follows the skin rather than hard-coding one) — the grid runs
    # almost to the edge of the canvas and the other cards on the site all
    # show their board with a margin around it.
    pad = round(side * 0.07)
    framed = Image.new("RGB", (side + pad * 2, side + pad * 2), board.getpixel((2, 2)))
    framed.paste(sq, (pad, pad))
    sq = framed

    thumb = f"{ROOT}/dots-and-boxes-thumb.jpg"
    sq.resize((400, 400), Image.LANCZOS).save(thumb, quality=84, optimize=True)
    print(f"  dots-and-boxes-thumb.jpg: {os.path.getsize(thumb) // 1024} KB (from {board.size})")

    # --- the OG image: the site's own layout (see solitaire/og-image.png):
    #     felt field, the game's name, one line of what it is, the domain,
    #     and the real board on the right.
    og = Image.new("RGB", (1200, 630), FELT)
    h = 566
    scaled = sq.resize((h, h), Image.LANCZOS)
    og.paste(scaled, (1200 - h - 24, (630 - h) // 2))
    d = ImageDraw.Draw(og)
    # 54px, not 60: at 60 the "s" of "Boxes" runs into the board.
    d.text((44, 200), "Dots and Boxes", font=ImageFont.truetype(FONT_BOLD, 54), fill=CREAM)
    d.text((46, 292), "Free · big targets · no timer", font=ImageFont.truetype(FONT, 29), fill=CREAM)
    d.text((46, 336), "easymahjongsolitaire.com", font=ImageFont.truetype(FONT, 29), fill=CREAM)
    out = f"{ROOT}/dots-and-boxes/og-image.png"
    og.save(out, optimize=True)
    print(f"  dots-and-boxes/og-image.png: {os.path.getsize(out) // 1024} KB")

asyncio.run(main())
