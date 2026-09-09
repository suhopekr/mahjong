// test/strings.test.js — every language present has exactly the English
// key set, and functions stay functions. Passes trivially while only
// English exists; guards the translator's work once it lands.
import { test, assertEqual, assertTrue } from "./harness.js";
import { strings } from "../src/i18n/strings.js";
import { LANG_CODES } from "../../i18n/i18n.js";

const enKeys = Object.keys(strings.en).sort();

test("English exists and is non-trivial", () => {
  assertTrue(enKeys.length > 80, `${enKeys.length} keys`);
  for (const k of enKeys) {
    const v = strings.en[k];
    assertTrue(typeof v === "string" ? v.trim().length > 0 : typeof v === "function", `"${k}" is text or a function`);
  }
});

test("every language present has exactly the English key set, same value types", () => {
  for (const lang of Object.keys(strings)) {
    assertTrue(LANG_CODES.includes(lang), `"${lang}" is a site language`);
    assertEqual(Object.keys(strings[lang]).sort(), enKeys, `${lang} keys`);
    for (const k of enKeys) assertEqual(typeof strings[lang][k], typeof strings.en[k], `${lang}.${k} type`);
  }
});

test("function strings render with their arguments and never say 'undefined'", () => {
  const sample = { n: 3, h: 5, c: 2, a: 6, b: 1, name: "Burgundy", dice: "6 · 1", die: 4, from: 8, text: "moved 13→7", list: "13→7", used: "6", toPlay: "1", you: 120, them: 130, count: 2, colour: "ivory", face: 5 };
  for (const lang of Object.keys(strings)) for (const k of enKeys) {
    const v = strings[lang][k];
    if (typeof v !== "function") continue;
    const out = v(sample);
    assertTrue(typeof out === "string" && !/undefined/.test(out), `${lang}.${k} → "${out}"`);
  }
});
