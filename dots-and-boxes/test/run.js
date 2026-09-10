// test/run.js
// Discovers and runs every *.test.js file in this directory, then
// prints a pass/fail summary. No dependencies, no browser:
//   node test/run.js   (or: npm test)
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { drain, summary } from "./harness.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

for (const file of files) {
  console.log(`\n${file}`);
  await import(path.join(testDir, file));
  // Importing a suite only DECLARES its tests; drain() is what runs them.
  // Awaited per file so each suite's output stays under its own heading
  // and two suites can never have their fixtures in play at once.
  await drain();
}

await summary();
