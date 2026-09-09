// test/strings.test.js — the game's dictionary: English is complete and
// well-formed, and every other language present carries exactly the
// English key set (trivially true until the translator adds languages,
// then a guard against a missed or misspelled key).
import { test, assertEqual, assertTrue } from "./harness.js";
import { strings } from "../src/i18n/strings.js";
import { common } from "../../i18n/common.js";
import { LANG_CODES } from "../../i18n/i18n.js";

const en = strings.en;

test("English exists, every value is a non-empty string or a function", () => {
  assertTrue(en && typeof en === "object");
  for (const [k, v] of Object.entries(en)) {
    assertTrue(/^[a-zA-Z][A-Za-z0-9]*$/.test(k), "key name " + k);
    assertTrue((typeof v === "string" && v.trim().length > 0) || typeof v === "function", "value of " + k);
  }
});

test("function strings render with their arguments", () => {
  assertEqual(en.found({ word: "ROSE", left: 1 }), "You found ROSE! One word to go.");
  assertEqual(en.found({ word: "ROSE", left: 3 }), "You found ROSE! 3 words to go.");
  assertEqual(en.picked({ letter: "R" }), "You picked R. Now tap the last letter of the word.");
  assertEqual(en.hintShown({ word: "TULIP", letter: "T" }), "TULIP starts at the glowing T.");
  assertEqual(en.winNote({ n: 6, theme: "Garden" }), "All 6 words in the Garden puzzle.");
  assertEqual(en.puzzleNo({ n: "4,217" }), "Puzzle 4,217");
});

test("only our own <strong> markup, and only in the goal strings", () => {
  for (const [k, v] of Object.entries(en)) {
    if (typeof v !== "string") continue;
    if (/[<>]/.test(v)) assertTrue(/^goal/.test(k) && /^[^<>]*<strong>[^<>]*<\/strong>[^<>]*$/.test(v), "markup in " + k);
  }
});

test("status phrases stay short enough for two lines on a phone (~70 characters)", () => {
  const samples = {
    start: en.start, restored: en.restored, notStraight: en.notStraight, notWord: en.notWord, noHint: en.noHint,
    won: en.won, todayLive: en.todayLive, todayDone: en.todayDone, newReady: en.newReady, unpicked: en.unpicked,
    picked: en.picked({ letter: "W" }), found: en.found({ word: "LIGHTHOUSE", left: 9 }), already: en.already({ word: "LIGHTHOUSE" }),
    hintShown: en.hintShown({ word: "LIGHTHOUSE", letter: "L" }),
  };
  for (const [k, v] of Object.entries(samples)) assertTrue(v.length <= 72, `${k} is ${v.length} chars: ${v}`);
});

test("every language present has exactly the English key set, in the game and the shared dictionary", () => {
  const enKeys = Object.keys(en).sort();
  for (const lang of Object.keys(strings)) {
    assertTrue(LANG_CODES.includes(lang), "known language code " + lang);
    assertEqual(Object.keys(strings[lang]).sort(), enKeys, "keys for " + lang);
    for (const k of enKeys) assertEqual(typeof strings[lang][k], typeof en[k], `${lang}.${k} same kind as English`);
  }
  const commonKeys = Object.keys(common.en).sort();
  for (const lang of Object.keys(common)) {
    assertTrue(LANG_CODES.includes(lang), "known language code " + lang);
    assertEqual(Object.keys(common[lang]).sort(), commonKeys, "common keys for " + lang);
  }
});

test("the game does not shadow a shared key with a different meaning by accident", () => {
  // Keys the game deliberately re-uses from common stay in common; the ones
  // it overrides are listed here on purpose.
  const overridden = Object.keys(en).filter((k) => k in common.en);
  assertEqual(overridden.sort(), ["restored", "skipToBoard"], "deliberate overrides only");
});
