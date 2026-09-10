# Translating Easy Classics

Everything a visitor reads on this site translates into the 14 languages in
`/i18n/i18n.js`. This file is how. It is written for the person (or agent)
who is filling one language in, so it says where each kind of string lives,
what the keys mean, what must **not** be translated, and — at the bottom —
the exact list of files and keys, so several people can work at once
without touching the same file.

Run this whenever you want the list rather than reading it:

```
node tools/i18n-check.mjs --keys     every file, and the keys it needs
npm --prefix tools test              0 failures is the bar for a merge
```

---

## 1. The two mechanisms, and why there are two

**Short UI words** — buttons, labels, status lines, the footer's link names —
live in a dictionary **with English in it**, and the markup carries
`data-i18n`:

```html
<button class="btn" data-i18n="hint">Hint</button>
```

At runtime `i18n.applyStatic()` looks the key up (game dictionary → common →
English → the key) and writes the result. English is in both the dictionary
and the markup, and the tests **require the two to be identical** — if you
reword one, reword the other.

**Long-form copy** — the intro prose, How to Play, every FAQ question and
answer, the section headings, a page's `h1`, the game names and card
descriptions — works the other way round. The markup carries
`data-i18n-content`, and **English exists only in the HTML**:

```html
<section class="content" lang="en" dir="ltr"
         data-i18n-lang data-i18n-module="/solitaire/src/i18n/content.js">
  <h2 data-i18n-content="introH">Play Solitaire Free Online</h2>
  <p data-i18n-content="introP1">This is the classic Solitaire everyone knows …</p>
```

Why the difference: that article is roughly 7,700 words of SEO copy, and a
crawler never sets `localStorage`, so it always gets the default rendering —
the HTML. Copying those paragraphs into an `en` dictionary would be a second
copy of the text Google ranks, free to drift from it. So the English stays
where the crawler reads it, and a translation **replaces** it:

- **English** — nothing happens. No lookup, no fallback, nothing fetched.
- **any other language** — the runtime imports the page's content module
  (only then, only once) and replaces each block **whose key that language
  has**. A key you have not translated keeps its English. A module that
  404s, throws, or exports the wrong shape leaves the whole page in English.
- **switching back to English** — the runtime kept the authored HTML, so the
  original copy comes straight back, with no reload.

`data-i18n-lang` on the wrapper is what tells a screen reader and a browser
which language the block is really in. It says `lang="en" dir="ltr"` until
**every** key inside it is translated, and then flips to your language (and
to `dir="rtl"` for Arabic).

### In a page, end to end

1. `/nav.js` loads on every page. It registers `/i18n/games.js` plus
   whatever `data-i18n-module` the page declared, and does nothing more in
   English.
2. On a non-English language, `/i18n/i18n.js` `import()`s those modules
   (same origin, which the site's `script-src 'self'` allows), then swaps
   every `[data-i18n-content]` it has a value for.
3. The page renders English first and the translation lands a moment later.
   That order is deliberate: nothing ever flashes blank.

---

## 2. Where each kind of string lives

| What a visitor reads | File | Attribute | English in the file? |
| --- | --- | --- | --- |
| Buttons, settings, status lines, win/undo phrases, the footer's tagline and link names | `/i18n/common.js` | `data-i18n` | **yes** — it is the source, do not change it |
| A game's own phrases (hints, card names, its status line) | `<game>/src/i18n/strings.js` | `data-i18n` | **yes** — same |
| Mahjong's and the Daily Challenge's own phrases (the toolbar, the calendar, every modal, what the screen reader says) | `/i18n/mahjong.js` | `data-i18n` | **yes** — same |
| Game names + one-line card descriptions (footer link, Games-panel card, front-page card, a game page's `h1`) | `/i18n/games.js` | `data-i18n-content` | yes, but **generated** from `games.json` — never hand-edit `en` |
| The long-form article on a game page (intro, How to Play, FAQ) | `<game>/src/i18n/content.js` | `data-i18n-content` | **no** — it is in the HTML |
| The long-form text of `/`, `/daily.html`, `/about.html`, `/contact.html` | `/i18n/pages/<page>.js` | `data-i18n-content` | **no** — same |

Two shapes for the page modules, on purpose. A game page already owns a
`src/i18n/` directory (its `strings.js` lives there), so its article's
translations belong beside it: everything about `/solitaire/` is under
`/solitaire/`, its own test suite can check it, and deleting a game takes
its translations with it. The four root pages have no directory of their
own — inventing `/index/src/i18n/` for `index.html` would be absurd — so
they share `/i18n/pages/`, one file named after the page. The *mechanism* is
identical either way: the page names its module in the markup, and you never
have to guess which shape a page uses.

**One rule for which file a key is in:** a key starting `game.` is in
`/i18n/games.js`. Everything else is in the page's own module.

`/i18n/mahjong.js` is the one file that breaks the "a game's strings live
under the game's directory" pattern, and it has no choice: Mahjong and the
Daily Challenge *are* the root of the site (`/` and `/daily.html`), so there
is no `/mahjong/` to put it in. It is a `strings.js` in every other respect
— `data-i18n`, English is the source, one block per language.

### The shape of a content module

```js
export const content = {
  ko: {
    introH: "무료 온라인 솔리테어",
    introP1: "…",
    howToLi1: "<strong>줄:</strong> …",
  },
  ja: {
    // …the same keys again
  },
};
```

- **No `en` key. Ever.** The build fails if one appears.
- **All or nothing per language.** A language listed in a module must carry
  **every** key that page uses, or `npm --prefix tools test` fails. This is
  deliberate: a page with three Korean paragraphs and five English ones
  reads as broken, while a page in English reads as untranslated. If you
  cannot finish a page, leave your language out of that file entirely and
  come back to it.
- **Keep the English's inline markup.** If the English has
  `<strong>The columns:</strong>`, yours has a `<strong>` too. Values are
  inserted as HTML, and the tests check that your tag set matches the
  English's and that **every `href` is byte-identical** to the English one.
- **Nothing else may go in a value**: no `style=""` (the site's CSP forbids
  inline style), no `<script>`, no `on…=` handler, no `<iframe>`/`<form>`/
  `<input>`. Do not paste from a word processor or a web page — type or
  paste plain text and add the tags the English has by hand.

---

## 3. The key scheme

Same names on every page, so moving from Solitaire to FreeCell to the front
page is not a new scheme each time. The names describe the **role**, never
the words, so rewording the English does not orphan a translation.

| Key | The block it names |
| --- | --- |
| `h1` | the page's own `<h1>` — only on `/`, `/daily.html`, `/about.html`, `/contact.html` (a game page's `h1` is `game.<key>.name`) |
| `introH` | the first `<h2>` — "Play Solitaire Free Online" and its equivalents |
| `introP1`, `introP2`, `introP3` | the intro paragraphs, in order |
| `howToH` | the "How to Play …" `<h2>` |
| `howToP1` | the paragraph under it (the aim of the game) |
| `howToLi1` … `howToLi6` | the bullets under that, in order |
| `faqH` | the "Frequently Asked Questions" `<h2>` |
| `faqQ1` / `faqA1` … `faqQ10` / `faqA10` | each FAQ question and its answer, paired and in order |
| `ctaLink` | the link at the end of the article ("Play Free Mahjong Solitaire →" and its equivalents) — the **text only**; the `href` stays as it is |
| `moreGamesH` | "More Free Games", the front page's card-grid heading |
| `game.<key>.name` | a game's display name (`<key>` is its `key` in `games.json`) |
| `game.<key>.desc` | that game's one-line card description |

Numbering runs in document order and starts at 1. If the English gains a
paragraph in the middle, the numbers after it shift, and
`node tools/i18n-check.mjs --keys` is then the authority — not this table.

---

## 4. What must NOT be translated

- **`<title>`, every `<meta>` tag, and all JSON-LD.** These are read by
  search engines, not by players. They stay English on every page. The FAQ
  in the `FAQPage` JSON-LD must keep matching the page's **English** FAQ one
  for one; the tests check it.
- **`privacy.html` and `terms.html`** — wholly English, deliberately. A
  mistranslated privacy policy misstates what data the site collects, and
  mistranslated terms misstate what a visitor is agreeing to; those are not
  cosmetic bugs. Each file says so in a comment at the top. Do not add a
  `data-i18n` or `data-i18n-content` attribute to either, and do not create
  a content module for them. (Their bar, Games panel and footer *do*
  translate — that is the shared chrome, and it makes no claims.)
- **"Easy Classics"** — the brand. It is a proper name and stays in Latin
  script everywhere: in the footer it sits in the markup as
  `<strong>Easy Classics</strong>`, *outside* the `footerTagline` key, so it
  cannot be translated by accident.
- **The `en` block of `/i18n/games.js`** — generated from `games.json` by
  `tools/sync-games.mjs`. If a name or description is wrong, fix
  `games.json` and run `npm --prefix tools run sync`.
- **Any `href`, any `id`, any class name, any `data-` attribute.**
- **A game's rules terms where the language really uses the English** —
  "FreeCell" is FreeCell in most languages. Use the name your country
  actually uses for the game; do not invent one.

---

## 5. Tone

The audience is 65+, mostly women, often on a phone, often reading in a
second language or with reading glasses. Match `/i18n/common.js`, which is
fully translated and is the reference:

- **Plain, warm, unhurried.** Short sentences. One idea each.
- **Say what happens, not what the system does.** "Tap a card and it moves
  by itself", not "the auto-move heuristic selects a destination".
- **Never rush anyone.** No "quickly", no "hurry", no exclamation marks
  except at a win. There is no timer on this site and the copy must not
  imply one.
- **No jargon and no English loanwords where a plain word exists** in your
  language. If your language has an everyday word for "undo", use it.
- **Use the polite register** your language uses for an older stranger —
  Korean 해요체 as in `common.js`, Japanese です／ます, German *Sie*,
  French *vous*, Spanish *usted*.
- **Keep it about as long as the English.** These blocks sit in a fixed
  layout on a 375px phone; a paragraph that doubles in length will not look
  wrong, but a heading that doubles will wrap awkwardly.
- Numbers stay as digits (52 cards, 144 tiles). Card and tile names follow
  the game's own `strings.js` if it has them, so the article and the board
  agree.

---

## 6. The worklist — exact files and keys

Take a whole file at a time. No two files overlap, so any number of people
can work in parallel; the only file more than one person touches is
`/i18n/games.js` (one language block each) and `/i18n/common.js` (one
language block each). Counts are as of this writing —
`node tools/i18n-check.mjs --keys` prints the live list.

### Shared, every page

| File | Keys | Notes |
| --- | --- | --- |
| `/i18n/common.js` | 6 keys still English-only: `footerTagline`, `siteLinks`, `about`, `privacyPolicy`, `terms`, `contact` | Add each to all 13 non-English blocks, then **delete it from the `PENDING` array** at the bottom of the file. The tests require a key to leave `PENDING` once every language has it. The other 29 keys are already translated — leave them. |
| `/i18n/games.js` | 24: `game.<key>.name` and `game.<key>.desc` for `mahjong`, `daily`, `solitaire`, `freecell`, `word-search`, `five-in-a-row`, `dots-and-boxes`, `backgammon`, `four-ball-billiards`, `eight-ball-pool`, `stone-flick`, `shuffleboard` | Add a language block **after** `en`. Never edit `en`. All 24 or none. |
| `/i18n/mahjong.js` | 125, all of them | The two pages that run on `game.js`: the toolbar and the phone's action bar, Settings, the six badges, the backup code, the "add to home screen" hints, every modal, the Daily calendar, and the sentences a screen reader reads. Add a language block **after** `en`; never edit `en`. Three shapes of value live in here and each must keep its shape — see below. |

### One file per page

| File | Page | Keys |
| --- | --- | --- |
| `/i18n/pages/index.js` | `/` | 29 — `h1`, `introH`, `introP1`–`introP3`, `howToH`, `howToP1`, `howToLi1`–`howToLi5`, `faqH`, `faqQ1`/`faqA1` … `faqQ7`/`faqA7`, `ctaLink`, `moreGamesH` |
| `/i18n/pages/daily.js` | `/daily.html` | 5 — `h1`, `introH`, `introP1`, `introP2`, `ctaLink` |
| `/i18n/pages/about.js` | `/about.html` | 6 — `h1`, `introH`, `introP1`–`introP3`, `ctaLink` |
| `/i18n/pages/contact.js` | `/contact.html` | 3 — `h1`, `introP1`, `ctaLink` |
| `/solitaire/src/i18n/content.js` | `/solitaire/` | 28 — `introH`, `introP1`–`introP3`, `howToH`, `howToP1`, `howToLi1`–`howToLi5`, `faqH`, `faqQ1`/`faqA1` … `faqQ8`/`faqA8` |
| `/freecell/src/i18n/content.js` | `/freecell/` | 32 — the same shape, with `faqQ1`–`faqQ10` |
| `/word-search/src/i18n/content.js` | `/word-search/` | 30 — the same shape, with `faqQ1`–`faqQ9` |
| `/five-in-a-row/src/i18n/content.js` | `/five-in-a-row/` | 28 — the same shape, with `faqQ1`–`faqQ8` |
| `/backgammon/src/i18n/content.js` | `/backgammon/` | 29 — the same shape, `howToLi1`–`howToLi6`, `faqQ1`–`faqQ8` |
| `/eight-ball-pool/src/i18n/content.js` | `/eight-ball-pool/` | 29 — the same shape, `howToLi1`–`howToLi6`, `faqQ1`–`faqQ8` |

Not on the list, and not an oversight: `privacy.html`, `terms.html`,
`/guides/`, and the four standalone game builds (Dots and Boxes, Four Ball
Billiards, StoneFlick, Shuffleboard) have no long-form article on the site
yet — their names and card descriptions are in `/i18n/games.js` and that is
all they need.

### `/i18n/mahjong.js` — the three shapes of value

Almost every string on this site is a plain string. This one file has all
three shapes, and `node tools/i18n-check.mjs` fails if a translation changes
the shape of a value:

- **strings** — the usual thing.
- **functions** — `clearedIn: ({ time }) => \`You cleared the board in **${time}**.\``.
  Keep the arrow function and the parameter name; move `${time}` to wherever
  your language wants it. A translation that drops `${time}` loses the
  player's time, so the checker calls both versions and compares.
- **arrays** — `monthNames` is 12 month names starting January;
  `weekdayLetters` is 7 weekday initials **starting Sunday**. The calendar
  cells are one character wide, so use the shortest form the language has
  (`日 月 火 水 木 金 土`, `일 월 화 수 목 금 토`, `S M D M D F S`).
  `monthTitle` is what decides the heading's word order, so Korean reads
  `2026년 9월` from the same two pieces English reads `September 2026` from.

Two more rules that are specific to this file:

- The keyboard letter in a tooltip — `(U)`, `(H)`, `(N)`, `(Space or P)` —
  is the same key on every keyboard. Translate the words around it and leave
  the bracket alone.
- `**bold**` appears only in the `install*` strings, and it marks the name of
  a real menu item on the player's own phone. Translate those to **what that
  phone actually says in that language** (Korean iOS: `**공유**`,
  `**홈 화면에 추가**`) and keep the `**` markers — `game.js` turns them into
  `<strong>` nodes, never `innerHTML`.

---

## 7. Before you open a pull request

```
npm --prefix tools test        # must end "0 failures"
node tools/i18n-check.mjs      # the language checks on their own, verbosely
```

Working on one language of `/i18n/mahjong.js` and want the checks before you
merge it in? Put the block in a file of its own as
`export const dict = { … }` and run

```
node tools/check-trans.mjs <lang> <that file>
```

which is the same shape/argument/`**`/shortcut checking, aimed at one draft
and naming every problem at once instead of one per run.

What will stop you, and what it means:

| The failure | What to do |
| --- | --- |
| `ko is complete — … (missing: faqA7, faqQ8)` | finish those keys, or take `ko` out of that file |
| `ko has no key the page does not use (introP4)` | the English lost a paragraph; delete that key |
| `the module has no en` | remove the `en` block — the English is the markup |
| `ko.introP1 is not the English copied over` | you pasted the English; translate it or drop the key |
| `ko.howToLi1 keeps the English tags (strong), got none` | put the `<strong>` back |
| `ko.ctaLink keeps every href exactly as the English has it` | you changed a link; put it back |
| `common.en "about" is translated everywhere, or listed in PENDING` | you finished a key — delete it from `PENDING` |
| `its en block is games.json, key for key` | you edited `games.js`'s `en`; run `npm --prefix tools run sync` |

And once, in a browser, for the language you filled in:

```
node tools/serve.mjs --port=8167
python3 tools/qa/content_i18n_qa.py     # the mechanism itself, with a throwaway fixture
```

Then open the page you translated, pick your language in the Games panel,
and read it. The checks prove the keys line up; only a person can tell you
whether it sounds like someone talking to a person.
