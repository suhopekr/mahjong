// test/copy.test.js
// Everything the PLAYER reads is English.
//
// This is a product rule, not a style preference: the audience is an
// English-speaking web portal, and four-ball is close to unknown outside
// Korea and Japan, so the stage hints are the only rulebook most players
// will ever get. It is also the kind of rule that decays silently — one
// Korean banner added during a late fix ships and nobody notices until a
// player screenshots it — so it is pinned here rather than remembered.
//
// Comments and commit messages are deliberately NOT covered. The domain
// vocabulary is Korean (당점, 밀어치기, 사구) and the source is more
// honest for saying so.
import { test, assertTrue, readPage } from "./harness.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { STAGES } from "../src/game/stages.js";
import { SCORE_KIND } from "../src/game/rules.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

test("stage names are English", () => {
  for (const s of STAGES) {
    assertTrue(!HANGUL.test(s.name), `stage ${s.id} name is not English: ${s.name}`);
  }
});

test("a stage is a position, not a paragraph", () => {
  // Every stage used to carry a sentence naming the stroke it wanted,
  // shown above the table. It read as teaching and worked as a spoiler:
  // the only question a stage asks is which stroke this is, and the line
  // answered it on arrival. The card at first run teaches the one rule
  // that has to be taught; the rest is the game.
  for (const s of STAGES) {
    assertTrue(!("hint" in s), `stage ${s.id} still carries a sentence`);
  }
  const main = readFileSync(path.join(root, "src/main.js"), "utf8");
  assertTrue(!/stage\(\)\.hint/.test(main), "main.js still reads a hint off a stage");
});

test("score names are English", () => {
  for (const [k, v] of Object.entries(SCORE_KIND)) {
    assertTrue(!HANGUL.test(v), `SCORE_KIND.${k} is not English: ${v}`);
  }
});

test("nothing rendered by index.html is Korean", () => {
  const html = readPage(root);
  const body = html.slice(html.indexOf("<body"));
  const text = body.replace(/<[^>]*>/g, " ");
  assertTrue(!HANGUL.test(text), "index.html shows Korean text");
  assertTrue(/lang="en"/.test(html), "the document declares English");
});

test("no string literal in main.js is Korean", () => {
  // Crude on purpose: it scans quoted runs rather than parsing, which
  // over-reports (a quotation inside a comment would trip it) and never
  // under-reports. Over-reporting is the safe direction for a guard.
  const src = readFileSync(path.join(root, "src", "main.js"), "utf8");
  const literals = src.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) || [];
  const bad = literals.filter((l) => HANGUL.test(l));
  assertTrue(bad.length === 0, `Korean in a main.js string: ${bad.join(", ")}`);
});

// --- the first-screen rules, as structure ------------------------------

test("no screen carries more than one accent button", () => {
  // "One accent per screen" is a rule Daily Five had to learn twice: two
  // accents in the same place is not emphasis, it is "which one do I
  // press". Counted per overlay rather than per document — the cleared
  // card and the stuck card each get one, and they are never both up.
  const html = readPage(root);
  const body = html.slice(html.indexOf("<body"));
  const cards = body.split(/<div id="/).slice(1);
  for (const card of cards) {
    const id = card.slice(0, card.indexOf('"'));
    const upTo = card.indexOf('<div id="');
    const own = upTo === -1 ? card : card.slice(0, upTo);
    const accents = own.match(/class="[^"]*\bprimary\b/g) || [];
    assertTrue(accents.length <= 1, `#${id} has ${accents.length} accent buttons`);
  }
  assertTrue(
    (body.match(/class="[^"]*\bprimary\b/g) || []).length >= 1,
    "something should be the accent"
  );
});

test("stage navigation is not in the always-visible chrome", () => {
  // The header is the one thing competing with the table for a phone's
  // vertical pixels, which is the axis the layout is already tight on.
  // Stage select / Home / Sound are utilities, not the game, and they
  // stay behind the menu.
  //
  // RESTART MOVED OUT, and the reason is worth keeping: it was filed as
  // a utility when a stage was one shot, and hard and extreme made it a
  // loop step — a run of two or three points is restarted often enough
  // that two taps behind ⋯ is a tax on the mode. What has NOT changed is
  // the pixel argument, so the test is now that it costs no height: it
  // is on the same header row as ⋯, not a row of its own.
  const html = readPage(root);
  const menu = html.slice(html.indexOf('id="menu"'), html.indexOf('id="home"'));
  for (const id of ["retry", "to-stages", "to-home", "sound"]) {
    assertTrue(menu.includes(`id="${id}"`), `${id} should live in the menu`);
  }
  const header = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
  for (const id of ["retry", "to-stages", "to-home", "sound"]) {
    assertTrue(!header.includes(`id="${id}"`), `${id} is still in the header`);
  }
  assertTrue(header.includes('id="restart-now"'), "restart belongs in the campaign's loop");
  const style = html.slice(html.indexOf("<style"), html.indexOf("</style>"));
  const areas = /grid-template-areas:\s*([^;]+);/.exec(style)[1];
  const rows = areas.split("\n").filter((r) => r.includes('"'));
  const first = rows[0];
  assertTrue(/restart/.test(first) && /menu/.test(first),
    "restart must share the row that already holds the menu button");
  assertTrue(rows.filter((r) => /restart/.test(r)).length === 1,
    "restart must not add a header row");
});

test("the home screen puts exactly one accent on the button that plays", () => {
  // The front gate is the screen this project has the most evidence
  // about: Daily Five's title screen converted 44% (36.8% on mobile) and
  // the retro's read was too many equal-weight choices on a page ABOUT
  // the game. Stages and Practice are alternatives; Play is the road.
  const html = readPage(root);
  const home = html.slice(html.indexOf('id="home"'), html.indexOf('id="stagemap"'));
  const accents = [...home.matchAll(/class="primary"/g)];
  assertTrue(accents.length === 1, `home has ${accents.length} accent buttons, want 1`);
  const play = home.slice(home.indexOf('id="btn-play"'), home.indexOf('id="btn-play"') + 120);
  assertTrue(/primary/.test(play), "the accent must be on the button that plays");
});

test("the result card never routes back through a menu", () => {
  // The single most expensive thing Daily Five had to bolt on after
  // launch. A cleared stage's default action is the next stage; anything
  // that sends the player to a front screen is where the session ends.
  const html = readPage(root);
  const card = html.slice(html.indexOf('id="cleared"'), html.indexOf('id="stuck"'));
  const primary = card.slice(card.indexOf("btn-next"), card.indexOf("</button>", card.indexOf("btn-next")));
  assertTrue(/primary/.test(primary), "the accent belongs to btn-next");
  assertTrue(!/id="btn-home"|Home<|Main menu/i.test(card), "no route home on the result card");
});

test("no front screen mentions online, ranking or accounts", () => {
  // Retro 8-1: out of scope for v1, and an inert "SOON" tile is still a
  // promise the game cannot keep.
  const html = readPage(root);
  const front = html.slice(html.indexOf('id="home"'));
  assertTrue(
    !/\b(online|rank(ing)?|leaderboard|log ?in|sign ?in|account)\b/i.test(front),
    "a front screen promises something v1 does not have"
  );
});

test("the first screen says the one thing a pool player does not know", () => {
  // Seventeen games in the portal's pool tag and every one of them has
  // pockets. A player arriving from that grid has to be told before they
  // are surprised, or the surprise happens on the conversion metric.
  const html = readPage(root);
  const card = html.slice(html.indexOf('id="firstrun"'), html.indexOf('id="cleared"'));
  assertTrue(/no pockets/i.test(card), "the first-run card must say there are no pockets");
  // And how to play a shot, which is three controls in a fixed order and
  // has to name all three. A card that says "drag back and release"
  // describes a control this game no longer has, and a player who reads
  // it will pull at the cloth and wonder why nothing goes.
  //
  // The ORDER is pinned too, not just the words. Tapping the bar before
  // there is a line to shoot along is harmless; pulling it is not, and a
  // card that put the pull before the aim would be teaching the one
  // sequence that fires a shot nobody chose.
  const steps = [...card.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
  assertTrue(steps.length === 3, "the card must lay the control out as three steps");
  assertTrue(/cue/i.test(steps[0]) && /aim/i.test(steps[0]), "step one is aiming the cue");
  assertTrue(/bar/i.test(steps[1]) && /power|speed/i.test(steps[1]), "step two is the power bar");
  assertTrue(
    /bar/i.test(steps[2]) && /(let go|release)/i.test(steps[2]),
    "step three is the pull that plays it"
  );
});


test("every overlay card is actually positioned over the board", () => {
  // A card that is only given `hidden` styling and never `position:
  // absolute` still exists, still says hidden:false, and still renders —
  // in the document flow, below a canvas that fills its container, where
  // nobody will ever see it. The stuck card shipped that way for exactly
  // one screenshot, and the only reason it was caught is that the picture
  // did not match what the state said.
  const html = readPage(root);
  const body = html.slice(html.indexOf("<body"));
  const style = html.slice(html.indexOf("<style"), html.indexOf("</style>"));
  // Only the cards that are DIRECT children of #board. Something hidden
  // inside one of them (a "you finished everything" line inside the stage
  // map, say) inherits its parent's positioning and is not the bug this
  // is looking for — the bug is a card that thinks it is an overlay and
  // is really a paragraph in the document flow, underneath a canvas.
  const board = body.slice(body.indexOf('<div id="board"'));
  const ids = [];
  let depth = 0;
  for (const m of board.matchAll(/<div\b([^>]*)>|<\/div>/g)) {
    if (m[0] === "</div>") {
      if (--depth === 0) break;
      continue;
    }
    depth++;
    if (depth !== 2) continue;
    const id = /id="([a-z-]+)"/.exec(m[1]);
    if (id && /\bhidden\b/.test(m[1])) ids.push(id[1]);
  }
  assertTrue(ids.length > 0, "expected some overlay cards");
  for (const id of ids) {
    // It must appear in a rule that also sets absolute positioning.
    const positioned = style
      .split("}")
      .some((rule) => rule.includes(`#${id}`) && /position:\s*absolute/.test(rule));
    assertTrue(positioned, `#${id} is never positioned over the board`);
  }
});

// --- the header does not move while the balls do -------------------------

test("the status row keeps its height while it is empty", () => {
  // A shot empties the status line for its whole duration. When the row
  // could collapse, the header lost ~16px the moment the balls started
  // rolling and got it back when they stopped, so the table grew and
  // shrank around every stroke. Measured on a 390px phone: the board's
  // top moved 108.1 -> 92.2 -> 108.1 px.
  //
  // Two things hold it still and both are easy to delete by accident, so
  // both are pinned: the row reserves its height, at the SAME multiple
  // its line-height uses (a different multiple leaves a one-pixel creep),
  // and the phone stylesheet must not zero that reservation out again.
  const html = readPage(root);
  // Not the FIRST "#status {" — that one is the grid-area one-liner.
  // The rule we care about is whichever block reserves the height.
  const blocks = [...html.matchAll(/#status \{[^}]*\}/g)].map((m) => m[0]);
  const rule = blocks.find((b) => b.includes("min-height")) || "";
  const lh = /line-height:\s*([\d.]+)/.exec(rule);
  const mh = /min-height:\s*([\d.]+)em/.exec(rule);
  assertTrue(lh !== null, "#status must set an explicit line-height");
  assertTrue(mh !== null, "#status must reserve its row with a min-height in em");
  assertTrue(lh[1] === mh[1], `line-height ${lh && lh[1]} != min-height ${mh && mh[1]}em`);
  assertTrue(!/#status\s*\{\s*min-height:\s*0/.test(html), "something zeroes the reservation again");
});

test("no status line is long enough to wrap", () => {
  // The row is one line high and reserves exactly one line, so a sentence
  // that wraps does not get a taller row — it gets a SECOND line that
  // pushes the board down, which is the same 15px shift the reservation
  // above exists to prevent. It reappeared the moment the control changed
  // and the idle line had to name two controls instead of one.
  //
  // 36 characters is the ceiling, measured in the browser at 360px, the
  // narrowest screen we ship to: 38 M's still fit on one line and a
  // 39-character sentence of ordinary words does not. Ordinary words, not
  // the worst case, because that is what these are.
  const main = readFileSync(path.join(root, "src/main.js"), "utf8");
  // Bounded by the statement, not by the comment that used to follow it.
  // The submission build strips comments, and a test that slices source on
  // a comment reads the whole rest of the file once it is gone — which is
  // how this one started failing on the build while passing on the source.
  const from = main.indexOf("el.status.textContent =");
  const fn = main.slice(from, main.indexOf(";", main.indexOf('"', from)) + 1);
  const lines = [...fn.matchAll(/"([^"]*)"/g)].map((m) =>
    m[1].replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  );
  assertTrue(lines.length >= 4, "the status line should have something to say");
  for (const line of lines) {
    assertTrue(line.length <= 36, `"${line}" is ${line.length} characters and will wrap`);
  }
});

test("the status row is claimed by the screen, not by the sentence", () => {
  // has-status has to mean "this screen has a status line", not "the
  // line is saying something this instant" — otherwise the hint swaps
  // back in for the two seconds a shot takes and moves the table.
  const main = readFileSync(path.join(root, "src/main.js"), "utf8");
  assertTrue(
    /classList\.toggle\("has-status",\s*state\.screen === "play"\)/.test(main),
    "has-status must be toggled off the screen"
  );
});

test("the timed modes put beads in the row the sentence used to have", () => {
  // The row is one line high and the score used to be written into it as
  // text — which rewrapped between shots as the counts changed width, and
  // a row that rewraps moves the table under the player's thumb. It is a
  // bead rack now: fixed elements, fixed width, and nothing to reflow.
  //
  // The check is that nothing has quietly gone back to writing a sentence
  // there while a run is on.
  const main = readFileSync(path.join(root, "src/main.js"), "utf8");
  const hud = main.slice(main.indexOf("function updateHud()"), main.indexOf("function paintStatus()"));
  assertTrue(/paintScoreboard\(\)/.test(hud), "the timed modes must paint the bead rack");
  assertTrue(
    !/el\.hint\.textContent = `/.test(hud),
    "the hint row is the scoreboard's now; a template written into it will reflow"
  );
  // And the rack is built from elements, so its width cannot depend on
  // the number in it.
  const sb = readFileSync(path.join(root, "src/game/scoreboard.js"), "utf8");
  assertTrue(/createElement\("i"\)/.test(sb), "beads must be elements");
});

// --- controls a thumb can actually hit -----------------------------------

test("nothing sets display on a hideable element without guarding hidden", () => {
  // `#undo { display: inline-flex }` OUTRANKS `[hidden] { display: none }`
  // — an id beats an attribute — so the button ignored its own hidden
  // attribute and appeared in the campaign, where it does not belong. It
  // squeezed the stage name down to "S." and nothing threw.
  //
  // The fix is either :not([hidden]) on the selector or an explicit
  // #id[hidden] rule. This checks that one of the two is present for
  // every id that is ever hidden in the markup.
  const html = readPage(root);
  const body = html.slice(html.indexOf("<body"));
  // Comments out first: one of them names #undo and the word display,
  // and a comment is not a rule.
  const style = html
    .slice(html.indexOf("<style"), html.indexOf("</style>"))
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const hideable = new Set();
  for (const m of body.matchAll(/<[a-z]+\b([^>]*)>/g)) {
    const attrs = m[1];
    if (!/\shidden(\s|>|$|=)/.test(attrs + ">")) continue;
    const id = /id="([a-z-]+)"/.exec(attrs);
    if (id) hideable.add(id[1]);
  }
  assertTrue(hideable.size > 0, "expected some hideable ids");

  const rules = style.split("}").map((r) => r + "}");
  for (const id of hideable) {
    const guarded = rules.some(
      (r) => new RegExp(`#${id}\\[hidden\\]`).test(r) && /display:\s*none/.test(r)
    );
    for (const rule of rules) {
      const sel = rule.slice(0, rule.indexOf("{"));
      if (!new RegExp(`#${id}(?![\\w-])`).test(sel)) continue;
      if (!/display:\s*[^;}]/.test(rule)) continue;
      const selfGuarded = new RegExp(`#${id}:not\\(\\[hidden\\]\\)`).test(sel) ||
        new RegExp(`#${id}\\[hidden\\]`).test(sel);
      assertTrue(
        selfGuarded || guarded,
        `#${id} sets display and can be hidden: ${sel.trim()}`
      );
    }
  }
});

test("every header control is big enough to hit", () => {
  // 26x22 is what the menu button was, against the 44px a thumb is
  // measured with. Height is pinned here because it is the axis the
  // header can afford to give; the extra reach comes from #menu-open's
  // ::after, which grows the target without growing the row.
  const html = readPage(root);
  const style = html
    .slice(html.indexOf("<style"), html.indexOf("</style>"))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = style.split("}");
  const minHeightOf = (sel) => {
    for (const r of rules) {
      if (!r.includes(sel)) continue;
      const m = /min-height:\s*(\d+)px/.exec(r);
      if (m) return Number(m[1]);
    }
    return 0;
  };
  assertTrue(minHeightOf("header button") >= 38, "header buttons need a real target");
  assertTrue(minHeightOf("button.back") >= 40, "the way out needs the biggest target of all");
  // #menu-open has more than one rule — one places it in the grid — so
  // look for the one that actually sizes it.
  const sized = rules
    .filter((r) => /#menu-open\s*\{/.test(r))
    .map((r) => /width:\s*(\d+)px/.exec(r))
    .find(Boolean);
  assertTrue(sized && Number(sized[1]) >= 44, `the menu button is ${sized && sized[1]}px wide`);
  assertTrue(
    style.includes("#menu-open::after"),
    "the menu button should extend its target past its box"
  );
});

test("the front headers centre their title on the screen", () => {
  // Symmetric side columns, or "centred" means "centred in what is left
  // over beside a button", which is off by half that button. And the
  // areas reset is load-bearing: the in-game `header` rule names six
  // areas, named areas EXTEND the explicit grid, and without it these
  // two screens inherited three extra columns and the middle one stopped
  // being the middle. Measured: the title sat 18px left of centre.
  const html = readPage(root);
  const style = html
    .slice(html.indexOf("<style"), html.indexOf("</style>"))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = style.split("}").find((r) => r.includes("#stagemap header")) || "";
  assertTrue(/grid-template-areas:\s*none/.test(rule), "the inherited areas must be reset");
  const cols = /grid-template-columns:\s*([^;]+);/.exec(rule);
  assertTrue(cols !== null, "the header needs explicit columns");
  const tracks = cols[1].trim().split(/\s+(?![^(]*\))/);
  assertTrue(tracks.length === 3, `want three tracks, got ${tracks.length}`);
  assertTrue(tracks[0] === tracks[2], `side tracks differ: ${tracks[0]} vs ${tracks[2]}`);
});

test("the way out is the first thing in the header", () => {
  // Position is most of what makes a button a button. When it sat last,
  // after the title and the star count and at the same weight as the text
  // beside it, it read as a third piece of metadata.
  const html = readPage(root);
  for (const [screen, id] of [["stagemap", "map-back"], ["tables", "tables-back"]]) {
    const start = html.indexOf(`id="${screen}"`);
    const head = html.slice(html.indexOf("<header>", start), html.indexOf("</header>", start));
    assertTrue(head.indexOf(`id="${id}"`) < head.indexOf("<h2>"), `${id} should precede the title`);
    assertTrue(/class="back"/.test(head), `${id} should carry the back treatment`);
  }
});
