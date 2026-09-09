// test/strings.test.js — every language present has exactly the English
// key set (passes trivially until the translator adds languages, then
// guards them), and every key is a string or a one-argument function.
import { test, assertEqual, assertTrue } from "./harness.js";
import { strings } from "../src/i18n/strings.js";
import { common } from "../../i18n/common.js";
import { LANG_CODES } from "../../i18n/i18n.js";

const enKeys = Object.keys(strings.en).sort();

test("English exists and every key is a string or a function", () => {
  assertTrue(enKeys.length > 40, "a real dictionary");
  for (const [k, v] of Object.entries(strings.en)) {
    assertTrue(typeof v === "string" || typeof v === "function", `${k} is text or a function`);
    if (typeof v === "function") assertTrue(v.length <= 1, `${k} takes one argument object`);
  }
});

test("every language present has exactly the English key set", () => {
  for (const lang of Object.keys(strings)) {
    assertTrue(LANG_CODES.includes(lang), `${lang} is a site language`);
    assertEqual(Object.keys(strings[lang]).sort(), enKeys, `keys of ${lang}`);
    for (const k of enKeys) assertEqual(typeof strings[lang][k], typeof strings.en[k], `${lang}.${k} has the English type`);
  }
});

test("game strings only override common ones on purpose", () => {
  const overlap = enKeys.filter((k) => k in common.en);
  assertEqual(overlap, ["playMahjong", "skipToBoard", "tryOther"].filter((k) => k in common.en).sort(), "deliberate overrides only");
});

test("no string smuggles a card or deal name in English: names are parameters", () => {
  for (const [k, v] of Object.entries(strings.en)) {
    if (typeof v !== "string") continue;
    assertTrue(!/\bof (spades|hearts|diamonds|clubs)\b/.test(v), `${k} names a card`);
  }
});
