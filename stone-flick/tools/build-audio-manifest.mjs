// tools/build-audio-manifest.mjs
// Rewrites assets/audio/manifest.json from whatever is actually in
// assets/audio/. Run it after dropping sound files in:
//     npm run audio:manifest
//
// The manifest exists so the game never has to probe for files it might
// not have (see src/core/samples.js's own comment on why a wall of 404s
// in the console is worse than an extra build step). This script is what
// keeps that from being a file anyone has to hand-edit.
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO_DIR = path.join(ROOT, "assets", "audio");
const ROLES = ["impact", "obstacle", "bumper", "portal", "flick", "fall", "sink", "win", "lose", "button"];
const PLAYABLE = new Set([".mp3", ".ogg", ".m4a", ".wav"]);

const files = readdirSync(AUDIO_DIR)
  .filter((name) => PLAYABLE.has(path.extname(name).toLowerCase()))
  .sort();

const accepted = [];
const rejected = [];
for (const name of files) {
  const role = path.basename(name, path.extname(name)).split("-")[0].toLowerCase();
  if (ROLES.includes(role)) accepted.push(name);
  else rejected.push(name);
}

writeFileSync(path.join(AUDIO_DIR, "manifest.json"), `${JSON.stringify({ files: accepted }, null, 2)}\n`);

const byRole = {};
for (const name of accepted) {
  const role = path.basename(name, path.extname(name)).split("-")[0].toLowerCase();
  byRole[role] = (byRole[role] ?? 0) + 1;
}
console.log(`manifest.json: ${accepted.length} file(s)`);
for (const role of ROLES) {
  const count = byRole[role] ?? 0;
  console.log(`  ${count > 0 ? "ok  " : "--  "}${role.padEnd(9)} ${count} variant(s)${count === 0 ? "  (synthesized)" : ""}`);
}
if (rejected.length > 0) {
  console.log(`\nIgnored — filename must start with a role name (${ROLES.join(", ")}):`);
  for (const name of rejected) console.log(`  ${name}`);
}
