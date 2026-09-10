# DESIGN-REVIEW.md — the cross-page pass before the nav ships

The top bar, the full-screen Games panel and the **Easy Classics** rebrand were
built across all 18 pages by three agents working in parallel. Everything was
functionally green (`npm --prefix tools test` → 0 failures) before this pass
started. This is the review that looks for what parallel work always leaves
behind: drift.

**Method.** `tools/qa/design_review.py` serves the site through
`tools/serve.mjs` (so `vercel.json`'s real CSP applies) and drives every one of
the eighteen pages at **375×667, 390×844, 820×1180 and 1280×800**, saving per
page:

```
tools/qa/out/review/<page>/01-load-<size>.png     the first screen as it loads
                          02-panel-<size>.png     the Games panel, at its top
                          03-panel-lang.png       the panel at the language grid (375×667)
                          04-arabic*.png          the page in Arabic (375×667)
```

164 screenshots. Every one was opened and looked at; the numbers next to each
(bar height, brand x/size/weight, control width and height, the mark's actual
fill colours, column count, thumb rendered size, Close box, overflow) are
printed by the same script so a picture and its measurement sit together.

The browser QA suites (`nav_qa.py`, `standalone_nav_qa.py`, `dab_qa.py`,
`fourball_fixes_qa.py`) and every game's own `test/run.js` were re-run after
each change.

---

## The five things worth calling drift

### 1. `/dots-and-boxes/` was a different brand (fixed)

The one page that did **not** load `/style.css`. Its forked nav block was a
faithful re-implementation in the board skins' own variables, and one day of
parallel work was enough to make it a second brand. Measured side by side with
the other seventeen pages:

| | the other 17 | `/dots-and-boxes/`, before |
|---|---|---|
| brand mark fill | `rgb(11,74,53)` deep green + cream | **`rgb(228,87,46)` amber** + white |
| bar background | `rgb(247,242,230)` cream (or `#131c20` on the 3 dark builds) | **`rgb(255,255,255)` white** |
| bar bottom rule | 1.5px `--felt-dark` | 1.5px `--muted`, ~3.2:1 — nearly invisible |
| brand ink | `--felt-dark` deep green | `--text` near-black |
| the two controls | ivory `.btn`, deep-green border/label | **beige 999px pills**, grey border |
| Games button width @375 | 92.0px | 82.7px |
| brand inset @820/1280 | 24px | 12px |
| panel card border | 2px deep green, 9.92:1 | 2px `--muted`, **3.24:1** |
| "Playing now" | `--felt-dark` on `#e4f2ea`, 8.89:1 | `--accent` orange on `--bg`, **3.22:1** |
| language ring | amber `--accent` | orange |

**Convergence decision: `/style.css` first, the game's own second — the same
order every other page uses, standalone builds included.** Full reasoning
below. The fork is deleted (330 lines out, ~90 in), and the bar, the panel and
all twelve cards on that page are now byte-identical in look to the other
seventeen. Every measured value matches: bar 56/64px, brand x 11.3/11.7/24/24,
Games 91.6/103px, Language 96.6/108.3px, mark `rgb(11,74,53)` + cream.

### 2. The panel's cards did not line up (fixed)

The grid stretches the `<li>`; the border is drawn by the `<a>` inside it. So
two cards in the same row had the same *row* height and different *card*
heights — measured 156.2px of row against a 129.2px card at 1280×800, i.e.
**27px of misalignment on the card a person is looking at**, and it landed
worst on the current game's card, which carries an extra "Playing now" line.
Visible as a broken masonry at 2-up and 3-up on all eighteen pages.

Fixed in the shared block: the card fills its row, and from 616px — the width
where `minmax(280px, 1fr)` actually produces a second column, DESIGN.md §3's
own number — the card's content is top-aligned so the **titles** line up across
a row too (they were up to 14px out). One column on the phone keeps the shipped
centred look, because nothing is stretched there. The same rule covers the
front page's More Free Games grid, which had the same defect.

### 3. `.game-title` was applied to pages with no board (fixed)

§5's whole argument for a small, quiet, centred h1 is *"the hierarchy is
board-first"*. On About / Contact / Privacy / Terms / `/guides/` there is no
board, and the result was:

```
Privacy Policy            17px, centred, --felt-dark   ← the page's own title
Last updated: …           18px
Game data stays on…       24px  (.content h2)
```

The page title was the smallest heading on the page and smaller than its body
text; at 1280 it was centred on the viewport while the text column sat 258px to
the left, so the two had no visual relationship at all. And the guides section
already contradicted itself: the index said "Guides" at 17px centred while the
guide inside it used `.article-title` at 26–34px left.

Fixed by splitting the rule in two and writing it down: **`.game-title` for a
page with a board, `.page-title` for a page whose content is the page.**
`.page-title` reuses `.article-title`'s ramp (`clamp(26px, 4vw, 34px)`),
`--ink` at 14.61:1, and `.content`'s own 820px cap and side padding, so it
lines up exactly with the first line of body copy. `tools/nav-check.mjs` was
taught the two-treatment rule.

### 4. Five in a Row's goal line repeated its h1 verbatim (fixed)

§5's hard rule: *the h1 must not repeat a word the goal line already carries.*

```
Five in a Row                                          h1, 17px
Get five in a row to win — across, down, or diagonally.   goal, 18px, "five in a row" BOLD
```

The whole title, word for word, set larger and bolder than the title itself
directly underneath it — so the top of the page stuttered, and the copy that
won the eye was the repetition. Now: *"Be the first to make an unbroken line of
**five stones** — across, down, or diagonally."* — the same rule, worded to
match the page's own FAQ rather than its title. English-only string (this page
has no i18n runtime of its own), one place, with the rule recorded in a comment
above it so it does not come back.

### 5. The two new thumbnails were the same picture (fixed)

`mahjong-thumb.jpg` and `daily-thumb.jpg` were made from wide desktop
screenshots letterboxed onto a square of felt. Three faults, all visible at the
88px they actually render at:

- the board floated in the middle with dead felt down both sides, so the
  subject owned about half the card;
- 144 tiles squeezed into 88px is noise, not tiles;
- `/` and `/daily.html` render the **same board**, so the two adjacent cards
  were indistinguishable. Two cards a 65+ visitor cannot tell apart is a
  navigation problem, not a picture problem.

`tools/qa/make_thumbs.py` rewritten: shoots portrait (620×900 at 3×) and
**cover**-crops, so the tiles come out about twice the size and read as tiles.
Daily keeps the board — it really is the same board, and the card should be
honest about that — and gains the thing that makes it Daily: this page's own
month calendar with today ringed, as a corner card. Cropped **above** the month
name on purpose, so a permanent asset does not carry "September 2026".
24 KB and 23 KB. `games.json`'s `alt` for Daily now describes the picture.

---

## The convergence decision on `dots-and-boxes/style.css`

**Load `/style.css` first, delete the fork.** The forking agent's argument was
good and I am overruling it on the evidence:

*Their case.* A standalone build is a full-viewport layout and the site shell
would fight it; and restating the bar in `--bg / --panel / --text / --muted /
--accent` makes it follow all four board skins with no per-skin CSS.

*Why the other way wins.*

1. **DESIGN.md §6a already decided this exact question**, after doing three of
   them: *"Copying loses the one-implementation property the whole bar rests
   on, so: `/style.css` first, the game's own second… The fight is settled by
   cascade ORDER."* Fifteen pages plus three converted standalone builds were
   on one side of that line and one page on the other.
2. **The fork's own drift is the proof.** Nobody was careless: the amber mark,
   the grey rules, the beige pills and the two sub-4.5:1 colours are simply
   what a second implementation of the same thing becomes. A third day would
   have widened it further.
3. **The fight does not actually happen.** I diffed the computed style of all
   240 elements on the page with and without `/style.css` in the head. Exactly
   five things leaked, and each is neutralised by name at the end of the game's
   own stylesheet with the measurement that found it: body's 64px phone
   action-bar padding, the 18px/1.5 page font (this build sized everything at
   the browser default), body's `min-height`/`overflow` box, `.settings-row`'s
   18px margins (144px of dead space in a modal that already scrolls), and —
   the one that would actually have shipped broken — `.achievement-toast`,
   where the site's fixed, `opacity: 0`, `.is-visible`-revealed pill would have
   made this game's unlock toast **invisible for good**. Everything else this
   file declares already wins on order.
4. **`--nav-*` is a choice, not a requirement.** The skin-following bar was the
   fork's real prize, and it is the one thing I did not keep. The bar is site
   chrome (§1: *"one calm cream field with the bar reading as chrome is the
   point"*), and on this page it is only ever on screen on the setup screen,
   because it hides during play. So it is the site's cream bar on all four
   skins. A cream band above a Chalkboard board is the same picture
   `/backgammon/` and `/eight-ball-pool/` already are: site chrome above a dark
   green table. The three permanently-dark builds keep their `--nav-*`
   override, because their whole viewport is dark all the time.
5. **The mark is never re-tinted.** §6a says so in as many words, and it is why
   the mark is exposed as two variables rather than hard-coded. The brand mark
   now reads identically on all eighteen pages.

*What stayed local, and had to:* the flex row and the capped `--notch`, the
hide-during-play rule, and **the stacking order** — `/style.css` puts the panel
at `z-index: 160`, which is above anything a site-shell page stacks but *below*
this build's own overlays (settings 850, achievements/skins 900). At 160 the
Games panel would have opened **behind them**. It is pinned at 950: above the
game's chrome, below the achievement toast container at 1000. This build's own
`page.test.js` caught it, which is the test earning its keep.

`tools/nav-check.mjs` now enforces the shape rather than assuming a dark page:
a standalone build's `--nav-*` override must be **all three values or none**
(a cream field under near-white ink is the drift the old check meant to catch),
and `--nav-mark-*` is forbidden outright.

---

## Per-page grades

Nav checklist (DESIGN.md §9) items that are visible per page: **1** bar
present · **2** 56/64px, controls ≥48/52px · **3** scrolls away <768, sticks
≥768 · **5** one h1, first in `<main>`, not repeating the goal line · **6**
panel opens, focus, Escape/Close · **7** 12 cards in order, thumbs sized ·
**8** `aria-current` + the words · **9** 1/2/3 columns, Close always reachable ·
**10** language grid after the cards · **12** Arabic mirrors, boards stay LTR.
55+ checklist: 48px targets · ≥17px glanceable text · words on buttons ·
never colour alone · contrast.

| # | Page | Checked | Changed, and why | Left, and why |
|---|---|---|---|---|
| 1 | `/` (Mahjong) | all 4 sizes, panel, lang, cards | card stretch + top-align; `.nav-now` 16px; **new tighter thumb** | h1 is "Free Mahjong Solitaire", not the brand — DESIGN.md keeps the ranking heading out of the bar's business. No goal line under the h1 (the toolbar follows); front page, so §5's stutter rule cannot fire |
| 2 | `/daily.html` | all 4, panel, lang | as above; **new thumb with the calendar corner**, `alt` rewritten | h1 "Daily Mahjong Challenge" ≠ card title "Daily Challenge"; both are right in their own place |
| 3 | `/solitaire/` | all 4, panel, lang, **Arabic panel** | shared fixes only | — |
| 4 | `/freecell/` | all 4, panel, lang | shared fixes only | — |
| 5 | `/word-search/` | all 4, panel, lang | shared fixes only | h1 "Word Search" / goal "Find every **word** …" share the noun. Not a §5 breach: the rule is about restating the *name*, and you cannot state this game's rule without the word "word". Not a stutter on screen |
| 6 | `/five-in-a-row/` | all 4, panel, lang | **goal line rewritten** (§4 above) | — |
| 7 | `/dots-and-boxes/` | all 4, panel, lang, Arabic, Arabic panel, full computed-style diff, `dab_qa.py` | **converged onto `/style.css`**; fork deleted; mark, bar, controls, panel, cards, language ring all now the site's; panel z-index pinned at 950; five leaks neutralised by name | `.game-title` keeps `color: var(--text)` instead of the site's `--felt-dark`: the h1 sits on the *page*, which is skinned, and deep green disappears on Chalkboard/Neon/Blueprint. The only page with no goal line under its h1 — adding one costs board height on a full-viewport build and needs its own hide-during-play rule; too invasive for a review, and §5's stutter rule cannot fire without it. Its own three icon-only round buttons (trophy/gear/sound) predate the bar and are the game's chrome, not the nav's |
| 8 | `/backgammon/` | all 4, panel, lang | shared fixes only | — |
| 9 | `/four-ball-billiards/` | all 4, panel, lang, `standalone_nav_qa.py`, `fourball_fixes_qa.py` | shared fixes only | Dark `--nav-*` override kept — permanently dark page. The mark's deep-green tile is 1.68:1 on `#131c20`; see "could not fix" |
| 10 | `/eight-ball-pool/` | all 4, panel, lang | shared fixes only | **At 375/390 the bar is off screen on arrival** — `revealTable()` scrolls the page at boot to get the table up, taking the bar, the h1 and the goal line with it. Known and accepted in §1. Flick up and it is there; sticky and visible from 768px. Undoing it would put the table below the fold on the page most likely to be an ad landing |
| 11 | `/stone-flick/` | all 4, panel, lang, `standalone_nav_qa.py` | shared fixes only | Dark override kept. Its own icon-only row predates the bar |
| 12 | `/shuffleboard/` | all 4, panel, lang, `standalone_nav_qa.py` | shared fixes only | Dark override kept. Its stage strip is ~15px letterspaced uppercase — under the 17px glance floor, but it is the game's own chrome and rewording/resizing it is a game pass, not a nav pass |
| 13 | `/about.html` | all 4, panel, lang | **`.page-title`**: was 17px centred above a 26px h2 | h1 still says "About Free Mahjong Solitaire". The rebrand deliberately kept the domain and the page titles; changing the About heading is the owner's SEO call, not a design fix |
| 14 | `/contact.html` | all 4, panel, lang | **`.page-title`** | — |
| 15 | `/privacy.html` | all 4, panel, lang | **`.page-title`** | — |
| 16 | `/terms.html` | all 4, panel, lang | **`.page-title`** | — |
| 17 | `/guides/` | all 4, panel, lang | **`.page-title`** — it was a 17px whisper above a 20px blue link | — |
| 18 | `/guides/how-to-play-mahjong-solitaire.html` | all 4, panel, lang | `.article-title` keeps its size ramp, now declared once alongside `.page-title` | Its h1 is not literally `<main>`'s first child — a `← All guides` breadcrumb precedes it. Normal article structure, and `nav-check.mjs` allows it by name |

Nav checklist result: **1, 2, 3, 5, 6, 7, 8, 9, 10 and 12 pass on all
eighteen**, with the two exceptions named above (`/eight-ball-pool/` at scroll
0 under 768px; the mark's width rule below). Items 4, 11, 13, 14 and 15 are
asserted by the QA suites rather than by eye and are green.

55+ checklist: every nav control hit-tests 48px under 768px and 52px above
(measured from client rects, not computed styles); the language buttons are
56px; every label is a word, never an icon; the current game and the current
language are each marked three ways (`aria-current`/`aria-pressed`, a tint, and
words); nav contrast runs 8.89–15.76:1 throughout.

---

## Still open

**The brand mark is not on the phone.** `/style.css` drops it under 400px, not
§2's 360px, and the fork had copied the same 400px, so this is uniform rather
than drift — but it means the badge exists on the iPad and the laptop and not
on most of the traffic. I re-measured the bar at 375px with the mark forced on
in all fourteen languages:

| fits at 375px | over budget |
|---|---|
| en (**by 1px**), fr, it, de, ru, tr, id, ko, ja, ar | es (+4px), pt (+13px) |

One pixel of slack for English is not shippable for a wordmark that clips
rather than wraps, so I left the rule alone rather than trade a missing mark
for "Easy Classic". Buying it back means shortening the bar's **language**
control on the phone — the two words are what fill the bar, and the language
label is a setting chosen once — which reverses §4's argument, so it is the
owner's call, not a review's. The words never degrade either way, which is the
part §2 says matters.

**The mark's tile is 1.68:1 against the three dark bars** (`#0b4a35` on
`#131c20`). Under the 3:1 non-text floor; the two cream shapes inside it carry
9.19:1 and the wordmark beside it carries the name, so nothing is lost, but the
badge reads as two floating shapes rather than a tile there. The available fix
is a hairline on the tile scoped to the dark bars — which is a mark that looks
different on three pages, i.e. exactly the drift this pass removed. Deliberately
not applied; flagged for the owner.

**The card descriptions are 16px**, under the 17px glance floor, as §3
specifies. The title above them is 20px and does the scanning; the description
is read on the one card you are considering. Raising it reflows all twelve
cards and lengthens the panel. Left as specified.

**`/eight-ball-pool/` has no bar on arrival below 768px** — see the table.

**A game in English under a bar in Korean** on the four standalone builds. The
bar, the panel and the fourteen-language grid are fully translated there
(`/nav.js` brings the i18n runtime with it); the games' own words are not.
Pre-existing, recorded in §6a, unchanged by this pass.

**`nav_qa.py` has one flaky assertion.** `five-in-a-row [820x1180]: exactly one
game_start` failed once in four full runs and passed in the other three and in
every `--quick` run — a race between `networkidle` and the page's own
`game_start`, not a regression. Worth a `wait_for_function` on the event rather
than a fixed 500ms, in whoever owns that file next.

---

## Test results after the changes

```
npm --prefix tools test                     395 passed, 0 failed   (incl. site check)
node tools/nav-check.mjs                    704 passed, 0 failed
solitaire/test/run.js                        40 passed, 0 failed
freecell/test/run.js                         38 passed, 0 failed
word-search/test/run.js                      40 passed, 0 failed
dots-and-boxes/test/run.js                  241 passed, 0 failed
backgammon/test/run.js                       54 passed, 0 failed
four-ball-billiards/test/run.js             466 passed, 0 failed
eight-ball-pool/test/run.js                  68 passed, 0 failed
stone-flick/test/run.js                     206 passed, 0 failed
shuffleboard/test/run.js                     63 passed, 0 failed
tools/qa/nav_qa.py                          991 passed, 0 failed
tools/qa/standalone_nav_qa.py               567 passed, 0 failed
tools/qa/dab_qa.py                          224 passed, 0 failed
tools/qa/fourball_fixes_qa.py                22 passed, 0 failed
tools/qa/design_review.py                   164 screenshots, 0 notes
```

## Files touched

| File | Change |
|---|---|
| `style.css` | panel/front-page card stretch + top-align from 616px; `.page-title`; `.article-title` size ramp declared once; `.nav-now` 14→16px; `[dir="rtl"] .game-card-body` LTR |
| `dots-and-boxes/index.html` | loads `/style.css` before `./style.css`, with the reasoning in the head comment |
| `dots-and-boxes/style.css` | forked nav block (330 lines) replaced by a §6-shaped override block: flex row, capped notch, hide-during-play, panel `z-index: 950`, the panel's `--ink`/`--accent`, and five named leak neutralisations |
| `five-in-a-row/index.html` | goal line rewritten so it no longer repeats the h1 |
| `about/contact/privacy/terms/guides` `index.html` | `h1.game-title` → `h1.page-title` |
| `games.json` | Daily's card `alt` describes the new picture |
| `mahjong-thumb.jpg`, `daily-thumb.jpg` | re-shot |
| `tools/qa/make_thumbs.py` | rewritten (portrait, cover-crop, Daily's calendar corner) |
| `tools/qa/design_review.py` | new — the 18-page × 4-size screenshot pass this review ran on |
| `tools/nav-check.mjs` | the two h1 treatments; `--nav-*` all-or-none; `--nav-mark-*` forbidden |
| `DESIGN.md` | new §10 recording where the spec above it now differs from the code, and why |

Generated markup (footers, cards, sitemap, the nav fences) was re-synced with
`npm --prefix tools run sync` after the `games.json` edit.
