// test/render.test.js
// Does the render module call anything it does not have?
//
// THE BUG THIS EXISTS FOR HAS HAPPENED TWICE. Both times a block edit to
// render.js removed a small local helper (roundRect) that a distant part
// of the file still called, and both times the symptom was the same and
// was nowhere near the change: the first frame threw, the throw escaped
// requestAnimationFrame, the loop stopped, and the game was a black
// rectangle. Nothing in a headless suite noticed, because every test here
// runs the physics and the rules and none of them draw.
//
// This is a cheap static stand-in for the browser check that would catch
// it properly. It reads the source, collects every bare `name(` call —
// bare meaning not `something.name(`, so it skips every canvas method —
// and asserts each one is declared in the file, imported into it, or on
// the short list of things a browser always has.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, assertTrue } from "./harness.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Things the language or the browser provides. */
const AMBIENT = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "function",
  "Math", "Number", "String", "Object", "Array", "Set", "Map", "JSON", "Boolean",
  "requestAnimationFrame", "setTimeout", "clearTimeout", "setInterval",
  "clearInterval", "parseFloat", "parseInt", "isNaN", "OffscreenCanvas",
  "Image", "ImageData", "Promise", "Error", "console", "document", "window",
]);

/** Comments and string literals out, so a CSS colour like "rgba(0,0,0,1)"
 * inside a string is not read as a call to a function named rgba. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

function declaredIn(src) {
  const names = new Set();
  // Anywhere, not just at the start of a line: `return function next()`
  // is a named function expression and it counts.
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g))
    names.add(m[1]);
  // Locals: arrow functions and consts declared anywhere, including inside
  // a function body.
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  // Imports, named and namespaced.
  for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from/g))
    for (const part of m[1].split(",")) names.add(part.trim().split(/\s+as\s+/).pop().trim());
  for (const m of src.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // Destructuring, both shapes: const { next } = rng(), const [a, b] = ...
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=/g))
    for (const part of m[1].split(","))
      names.add(part.trim().split(/[:=\s]/)[0].replace(/^\.\.\./, "").trim());
  for (const m of src.matchAll(/(?:const|let|var)\s*\[([^\]]+)\]\s*=/g))
    for (const part of m[1].split(",")) names.add(part.trim().replace(/^\.\.\./, ""));
  // Parameters, taken loosely: anything inside the first parens of a
  // function declaration or an arrow.
  for (const m of src.matchAll(/(?:function\s*[A-Za-z_$\w]*\s*|\()([^)(]*)\)\s*(?:=>|\{)/g))
    for (const part of m[1].split(","))
      names.add(part.trim().split(/[=:\s]/)[0].replace(/^\.\.\./, "").trim());
  return names;
}

for (const file of ["src/game/render.js", "src/game/layout.js", "src/game/surface.js"]) {
  test(`${file} calls nothing it does not have`, () => {
    const src = code(readFileSync(path.join(root, file), "utf8"));
    const have = declaredIn(src);
    const missing = new Set();
    // A bare call: an identifier followed by "(" and NOT preceded by a dot
    // or a word character.
    for (const m of src.matchAll(/(^|[^.\w$])([a-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (AMBIENT.has(name) || have.has(name)) continue;
      missing.add(name);
    }
    assertTrue(
      missing.size === 0,
      `calls with no definition in scope: ${[...missing].join(", ")}`
    );
  });
}
