// tools/serve.mjs — the site, locally, WITH vercel.json's headers.
//
//   node tools/serve.mjs            http://localhost:8080
//   node tools/serve.mjs --port=0   any free port (printed)
//
// `python3 -m http.server` serves the files but not the headers, and the
// header that matters is the Content-Security-Policy: an inline <style>
// or a stray style="" attribute that looks fine under python's server is
// silently dropped on the deployed site. This server applies every header
// vercel.json declares, so what breaks here is what breaks in production.
// Also imported by site-check.mjs, which starts it on a free port.
import http from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".xml": "application/xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg", ".txt": "text/plain", ".webmanifest": "application/manifest+json",
};

export function startServer(port = 8080) {
  const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
  const headers = (vercel.headers || []).flatMap((h) => h.headers);
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
    catch { res.writeHead(400); res.end(); return; }
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" }); res.end("404 " + p); return;
    }
    for (const h of headers) res.setHeader(h.key, h.value);
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

if (process.argv[1] && process.argv[1].endsWith("serve.mjs")) {
  const arg = process.argv.find((a) => a.startsWith("--port="));
  const { port } = await startServer(arg ? Number(arg.split("=")[1]) : 8080);
  console.log(`serving ${root}\n  http://localhost:${port}/  (vercel.json headers applied)`);
}
