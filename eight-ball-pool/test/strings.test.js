// test/strings.test.js — the language tables: every language present has
// exactly the English key set, the same value types, and the same
// placeholders. Trivially true while only English exists; when the
// translator adds the other thirteen this is what catches a dropped key or
// a `${name}` that went missing in translation.
import { test, assertEqual, assertTrue } from "./harness.js";
import { strings } from "../src/i18n/strings.js";
import { common, PENDING } from "../../i18n/common.js";
import { LANG_CODES } from "../../i18n/i18n.js";

const ARG_NAMES = ["name", "group", "n", "count", "shots"];
/** Which of the known argument names a phrase function actually uses. */
function argsUsed(fn) {
  const src = fn.toString();
  return ARG_NAMES.filter((a) => new RegExp(`\\b${a}\\b`).test(src));
}

// PENDING (see /i18n/common.js) is the list of shared keys that exist in
// English and nowhere else yet — the footer strings landed with the
// content-translation work and the 13 languages come after. They are
// exempt from "every language has every English key" and from nothing
// else; tools/i18n-check.mjs is what stops the list becoming permanent.
for (const [label, table, pending] of [["strings.js", strings, []], ["common.js", common, PENDING]]) {
  test(`${label}: has English, and every language code is one the runtime knows`, () => {
    assertTrue(table.en && Object.keys(table.en).length > 0, "en present");
    for (const code of Object.keys(table)) assertTrue(LANG_CODES.includes(code), `known language "${code}"`);
  });

  test(`${label}: every language has exactly the English keys, same types, same placeholders, no blanks`, () => {
    const enKeys = Object.keys(table.en);
    for (const [code, dict] of Object.entries(table)) {
      if (code === "en") continue;
      const keys = Object.keys(dict);
      // A pending key is required of a language only once that language has
      // it: absent is the expected state until a translator gets to it, and
      // present means it is theirs to keep correct like any other.
      const required = enKeys.filter((k) => !pending.includes(k) || k in dict);
      assertEqual(required.filter((k) => !keys.includes(k)), [], `${code}: missing keys`);
      assertEqual(keys.filter((k) => !enKeys.includes(k)), [], `${code}: unknown keys`);
      for (const k of required) {
        const en = table.en[k];
        const v = dict[k];
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

test("strings.js does not shadow common.js: the lookup order would hide the shared phrase", () => {
  // Lookup is game → common, so a key in both silently overrides the
  // site-wide wording. This game overrides nothing; add a key here with a
  // reason if that ever has to change.
  const shadowed = Object.keys(strings.en).filter((k) => k in common.en);
  assertEqual(shadowed, [], "keys in both tables");
});

test("strings.js: the pieces the status line assembles all exist", () => {
  for (const k of ["solids", "stripes", "solidsCap", "stripesCap", "you", "computer", "anyBall", "onTheEight"]) {
    assertTrue(typeof strings.en[k] === "string", k);
  }
  assertEqual(strings.en.chip({ name: "You", group: "Solids" }), "You: Solids");
  assertEqual(strings.en.chipLeft({ name: "You", group: "Solids", n: 3 }), "You: Solids, 3 left");
  assertEqual(strings.en.aimGroup({ group: "solids" }), "You're on the solids. Hit one of them first.");
});

test("strings.js: the power bar says a word, never a bare number", () => {
  for (const k of ["powerSoft", "powerMedium", "powerFirm"]) {
    const v = strings.en[k];
    assertTrue(typeof v === "string" && !/\d/.test(v), `${k} is a word`);
  }
});

test("strings.js: every status line is short enough for the two reserved lines", () => {
  const long = [];
  for (const [k, v] of Object.entries(strings.en)) {
    if (typeof v !== "string") continue;
    // Settings notes and the long rules explanation are paragraphs, not
    // status lines; everything else is read at a glance.
    if (/Note$|Legend$|^goal$|^tagline$/.test(k)) continue;
    if (v.length > 78) long.push(`${k} (${v.length})`);
  }
  assertEqual(long, [], "status phrases over 78 characters");
});
