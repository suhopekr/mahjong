// test/strings.test.js — the language tables: every language present has
// exactly the English key set, the same value types, and the same
// placeholders. Trivially true while only English exists; when the
// translator adds the other 13 this is what catches a dropped key or a
// `${name}` that went missing in translation.
import { test, assertEqual, assertTrue } from "./harness.js";
import { strings } from "../src/i18n/strings.js";
import { common } from "../../i18n/common.js";
import { LANG_CODES } from "../../i18n/i18n.js";

const ARG_NAMES = ["name", "target", "moves", "n", "rank", "suit"];
/** Which of the known argument names a phrase function actually uses. */
function argsUsed(fn) {
  const src = fn.toString();
  return ARG_NAMES.filter((a) => new RegExp(`\\b${a}\\b`).test(src));
}

for (const [label, table] of [["strings.js", strings], ["common.js", common]]) {
  test(`${label}: has English, and every language code is one the runtime knows`, () => {
    assertTrue(table.en && Object.keys(table.en).length > 0, "en present");
    for (const code of Object.keys(table)) assertTrue(LANG_CODES.includes(code), `known language "${code}"`);
  });

  test(`${label}: every language has exactly the English keys, same types, same placeholders, no blanks`, () => {
    const enKeys = Object.keys(table.en);
    for (const [code, dict] of Object.entries(table)) {
      if (code === "en") continue;
      const keys = Object.keys(dict);
      const missing = enKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !enKeys.includes(k));
      assertEqual(missing, [], `${code}: missing keys`);
      assertEqual(extra, [], `${code}: unknown keys`);
      for (const k of enKeys) {
        const en = table.en[k], v = dict[k];
        assertEqual(typeof v, typeof en, `${code}.${k} type`);
        if (typeof en === "function") {
          assertEqual(argsUsed(v).sort(), argsUsed(en).sort(), `${code}.${k} uses the same placeholders`);
        } else {
          assertTrue(v.trim().length > 0, `${code}.${k} is not blank`);
          assertEqual(/<[a-z]/.test(v), /<[a-z]/.test(en), `${code}.${k} carries markup iff English does`);
        }
      }
    }
  });
}

test("strings.js: card names are complete — rank1..rank13, the four suits, cardName()", () => {
  for (let r = 1; r <= 13; r++) assertTrue(typeof strings.en["rank" + r] === "string", "rank" + r);
  for (const s of ["S", "H", "D", "C"]) assertTrue(typeof strings.en["suit" + s] === "string", "suit" + s);
  assertEqual(strings.en.cardName({ rank: strings.en.rank11, suit: strings.en.suitH }), "J of hearts");
});

test("strings.js and common.js do not disagree: a game key that shadows a common key is deliberate", () => {
  // The lookup order is game → common, so a duplicate silently overrides.
  // Solitaire overrides nothing today; add a key here if that changes.
  const shadowed = Object.keys(strings.en).filter((k) => k in common.en);
  assertEqual(shadowed, [], "keys in both tables");
});
