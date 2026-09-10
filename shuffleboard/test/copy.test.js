// test/copy.test.js
// Structural rules for everything the player reads. Each of these is a
// lesson the series paid for once already:
// - exactly one accent button per screen (Daily Five retro)
// - no Korean visible to the player (the audience is the English portal;
//   Four Ball pinned the same rule)
// - no promise of online/ranking/login anywhere (out of v1's scope; a
//   mention is a promise the build cannot keep)
// - every hidden overlay must also be positioned, or it "shows" below
//   the canvas where nobody looks (Four Ball's stuck-card bug)
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, assertTrue, assertEqual, readPage } from "./harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readPage(root);

/**
 * The page minus the site's top bar and Games panel.
 *
 * Everything between the <!-- games:nav --> fences is written by
 * tools/sync-games.mjs from games.json: it is the site's own chrome, and it
 * describes the OTHER ten games — including a "white cue ball" and a "cue
 * ball ready" in two card alt texts. The rules below are about the words
 * THIS game chose, so they are asked of the page without it.
 */
function ownWords(page) {
  const a = page.indexOf("<!-- games:nav -->");
  const b = page.indexOf("<!-- /games:nav -->");
  if (a === -1 || b === -1) return page;
  return page.slice(0, a) + page.slice(b);
}
const own = ownWords(html);

function sourceFiles() {
  const out = [];
  for (const dir of ["src", "src/core", "src/game"]) {
    for (const f of readdirSync(path.join(root, dir))) {
      if (f.endsWith(".js")) out.push(path.join(root, dir, f));
    }
  }
  return out;
}

/** Strip // and /* comments so a Korean or "carom" inside one is fine. */
function stripComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

test("exactly one accent button per screen", () => {
  const primaries = [...html.matchAll(/class="primary"/g)];
  assertEqual(primaries.length, 1, "one .primary in the whole shell (screens never overlap)");
});

test("no Korean reaches the player", () => {
  assertTrue(!/[가-힯]/.test(html), "index.html is all English");
  for (const f of sourceFiles()) {
    const code = stripComments(readFileSync(f, "utf8"));
    assertTrue(!/[가-힯]/.test(code), `${path.basename(f)} has Korean outside comments`);
  }
});

test("nothing promises online, ranking or accounts", () => {
  const words = /\b(online|ranking|leaderboard|login|sign.?in|account)\b/i;
  // Site build: <head> carries the site's search copy ("play … free
  // online"), which is about where the game runs, not a promise of online
  // play. The game's own words are everything from <body> on.
  assertTrue(!words.test(own.slice(own.indexOf("<body>"))), "index.html");
  for (const f of sourceFiles()) {
    const code = stripComments(readFileSync(f, "utf8"));
    // Strings only would be nicer; identifiers don't render, but keeping
    // the words out of the code entirely is cheaper than being clever.
    assertTrue(!words.test(code), `${path.basename(f)}`);
  }
});

test("the deck game is not promised either", () => {
  // This is TABLE shuffleboard. "cue" and "deck" are the vocabulary of
  // the cruise-ship floor game; a player who reads them will expect the
  // wrong sport — the same expectation-miss as pool players finding a
  // table with no pockets.
  const visible = own.replace(/<!--[\s\S]*?-->/g, "");
  assertTrue(!/\b(deck|cue)\b/i.test(visible), "index.html speaks table shuffleboard");
});

test("every hidden overlay is also positioned", () => {
  // Four Ball's stuck-card bug: a div can be hidden=false yet render
  // below the canvas in document flow, "visible" in state and invisible
  // in fact. Everything that toggles `hidden` here must carry the .card
  // class (absolutely positioned) or be #menu (positioned in css).
  const hiddenIds = [...html.matchAll(/id="([^"]+)"[^>]*\bhidden\b/g)].map((m) => m[1]);
  assertTrue(hiddenIds.length >= 3, "the overlays exist");
  // Children of the result card toggle hidden too (stars for stages, the
  // score line for matches, the optional second button); they inherit
  // their position from the card, so the rule does not apply to them —
  // but they must actually BE inside it for that exemption to hold.
  const inResultCard = ["result-stars", "result-final", "btn-secondary", "btn-tertiary"];
  const cardBlock = /<div class="card" id="result-card"[\s\S]*?<\/button>\s*<\/div>/.exec(html)[0];
  for (const id of inResultCard) {
    assertTrue(cardBlock.includes(`id="${id}"`), `#${id} must live inside #result-card`);
  }
  for (const id of hiddenIds) {
    if (inResultCard.includes(id)) continue;
    const tag = new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`).exec(html)[0];
    const positioned = /class="[^"]*card[^"]*"/.test(tag) || id === "menu";
    assertTrue(positioned, `#${id} is hidden-able but not positioned`);
  }
});

test("the first-shot card says what winning is and what the edge does", () => {
  const card = /<div class="card" id="first-card"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/.exec(html)[1];
  assertTrue(/closest to the far edge/i.test(card), "the goal in one clause");
  assertTrue(/off the edge/i.test(card), "the risk in one clause");
  // No "first to 15" here any more: the first thing a new player meets
  // is a campaign stage, and its goal bar does the specific talking.
});

test("the SDK save key is this game's own", () => {
  const storage = readFileSync(path.join(root, "src/core/storage.js"), "utf8");
  assertTrue(/shuffleboard-save/.test(storage), "not inherited from a previous game");
});
