// tools/check-trans.mjs — validate one language's draft of /i18n/mahjong.js
// before it is merged in.  Usage:
//
//     node tools/check-trans.mjs <lang-code> <path/to/draft.js>
//
// The draft must be an ES module with `export const dict = { … }` holding
// exactly the keys of mahjong.en, with the same KIND of value for each
// (string / function / array) and, for functions, still using every ${…}
// the English one uses.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mahjong } from "../i18n/mahjong.js";

const [code, file] = process.argv.slice(2);
if (!code || !file) { console.error("usage: node tools/check-trans.mjs <lang> <file>"); process.exit(2); }

const { dict } = await import(pathToFileURL(path.resolve(file)).href);
const en = mahjong.en;
const problems = [];

for (const k of Object.keys(en)) if (!(k in dict)) problems.push(`missing key: ${k}`);
for (const k of Object.keys(dict)) if (!(k in en)) problems.push(`key not in English: ${k}`);

const ARG = { name: "NAME", time: "01:23", month: "MONTH", day: 4, year: 2026, n: 7, tile: "TILE" };
for (const k of Object.keys(en)) {
  if (!(k in dict)) continue;
  const a = en[k], b = dict[k];
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) { problems.push(`${k}: must be an array of ${a.length}`); continue; }
    if (b.length !== a.length) problems.push(`${k}: has ${b.length} entries, needs ${a.length}`);
    if (b.some((x) => typeof x !== "string" || !x.trim())) problems.push(`${k}: every entry must be a non-empty string`);
    continue;
  }
  if (typeof a !== typeof b) { problems.push(`${k}: is ${typeof b}, English is ${typeof a}`); continue; }
  if (typeof a === "function") {
    let out;
    try { out = String(b(ARG)); } catch (e) { problems.push(`${k}: throws when called (${e.message})`); continue; }
    for (const v of new Set([...String(a).matchAll(/\$\{\s*(\w+)\s*\}/g)].map((m) => m[1]))) {
      if (!out.includes(String(ARG[v]))) problems.push(`${k}: dropped \${${v}} — produced "${out}"`);
    }
    continue;
  }
  if (typeof a === "string") {
    if (!b.trim()) problems.push(`${k}: is empty`);
    if (a.includes("**") && (b.split("**").length - 1) % 2 !== 0) problems.push(`${k}: unmatched ** pair`);
    if (a.includes("**") && !b.includes("**")) problems.push(`${k}: lost its **bold** menu names`);
    // The keyboard letter in a tooltip is the same key in every language.
    const shortcut = a.match(/\(([A-Za-z]|Space or P)\)$/);
    if (shortcut && !b.includes(shortcut[1])) problems.push(`${k}: lost the keyboard shortcut "${shortcut[1]}"`);
  }
}

if (problems.length) {
  console.log(`${code}: ${problems.length} problem(s)`);
  for (const p of problems) console.log("  - " + p);
  process.exit(1);
}
console.log(`${code}: ok — ${Object.keys(dict).length} keys`);
