// tools/test-all.mjs — everything, in one command:
//
//   npm --prefix tools test            unit suites + static site checks
//   npm --prefix tools run test:site   the browser run as well
//
// 1. each game's own suite (<game>/test/run.js, no dependencies)
// 2. tools/site-check.mjs --static (pass --browser to include Playwright)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const browser = process.argv.includes("--browser");
const registry = JSON.parse(readFileSync(path.join(root, "games.json"), "utf8"));

const results = [];
function run(label, args, cwd) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  results.push([label, r.status === 0]);
}

for (const g of registry.games) {
  const dir = path.join(root, g.path.replace(/^\//, "").replace(/\/$/, ""));
  const runner = path.join(dir, "test", "run.js");
  if (existsSync(runner)) run(`${g.name} unit suite`, ["test/run.js"], dir);
}
run("site check" + (browser ? "" : " (static)"), [path.join(here, "site-check.mjs"), ...(browser ? [] : ["--static"])], root);

console.log("\n=== summary ===");
for (const [label, okay] of results) console.log(`  ${okay ? "ok  " : "FAIL"} - ${label}`);
process.exit(results.every(([, okay]) => okay) ? 0 : 1);
