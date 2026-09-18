#!/usr/bin/env node
// Growth agent "pulse": one read of GA4 + Search Console, appended to
// agent/metrics.csv and summarised in agent/pulse-latest.md for the agent
// to read. No dependencies — the service-account JWT is signed with node's
// crypto. Run from the repo root:
//
//   node tools/agent/pulse.mjs            # last 7 days (GA4) / 28 days (GSC)
//   node tools/agent/pulse.mjs --days 28
//   node tools/agent/pulse.mjs --dry-run  # no network, shows what would run
//
// Secrets: agent/secrets/google-sa.json (never committed).
// Config:  agent/config.json  { "ga4PropertyId": "123456789",
//                               "gscSiteUrl": "sc-domain:easymahjongsolitaire.com" }

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { createSign } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const agentDir = path.join(root, "agent");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DRY = flag("--dry-run");
const DAYS = Number(opt("--days", "7"));
const GSC_DAYS = Number(opt("--gsc-days", "28"));

const configPath = path.join(agentDir, "config.json");
const saPath = path.join(agentDir, "secrets", "google-sa.json");
const csvPath = path.join(agentDir, "metrics.csv");
const latestPath = path.join(agentDir, "pulse-latest.md");

function fail(msg) {
  console.error(`pulse: ${msg}`);
  process.exit(1);
}

// ---------- dates (UTC; GA4 property is Eastern, GSC is Pacific — close enough for daily rows)
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};

// ---------- auth: service account -> access token
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function accessToken(sa, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = b64url(signer.sign(sa.private_key));
  const jwt = `${header}.${claim}.${sig}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) fail(`token exchange failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

async function postJson(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url.split("/").slice(2, 3)} ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return res.json();
}

// ---------- GA4
async function ga4Daily(token, property, start, end) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`;
  const byDay = await postJson(url, token, {
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
    metrics: [
      { name: "sessions" }, { name: "totalUsers" }, { name: "newUsers" },
      { name: "engagedSessions" }, { name: "userEngagementDuration" },
    ],
    limit: 10000,
  });
  const events = await postJson(url, token, {
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: "date" }, { name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: ["game_start", "game_win"] } } },
    limit: 10000,
  });
  const days = {};
  const day = (d) => (days[d] ??= { organic: 0, total: 0, users: 0, newUsers: 0, engaged: 0, engSec: 0, start: 0, win: 0, channels: {} });
  for (const r of byDay.rows ?? []) {
    const [d, ch] = r.dimensionValues.map((v) => v.value);
    const [s, u, nu, es, dur] = r.metricValues.map((v) => Number(v.value));
    const row = day(d);
    row.total += s; row.users += u; row.newUsers += nu; row.engaged += es; row.engSec += dur;
    row.channels[ch] = (row.channels[ch] ?? 0) + s;
    if (ch === "Organic Search") row.organic += s;
  }
  for (const r of events.rows ?? []) {
    const [d, ev] = r.dimensionValues.map((v) => v.value);
    const n = Number(r.metricValues[0].value);
    if (ev === "game_start") day(d).start += n;
    if (ev === "game_win") day(d).win += n;
  }
  // GA4 dates come as YYYYMMDD
  return Object.fromEntries(Object.entries(days).map(([d, v]) => [`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, v]));
}

async function ga4Pages(token, property, start, end) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`;
  const r = await postJson(url, token, {
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: "landingPagePlusQueryString" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 15,
  });
  return (r.rows ?? []).map((x) => ({
    page: x.dimensionValues[0].value,
    sessions: Number(x.metricValues[0].value),
    engaged: Number(x.metricValues[1].value),
  }));
}

// ---------- Search Console
async function gsc(token, site, start, end, dimensions, limit = 25) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const r = await postJson(url, token, { startDate: start, endDate: end, dimensions, rowLimit: limit });
  return (r.rows ?? []).map((x) => ({ keys: x.keys, clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position }));
}

// ---------- csv helpers
function existingDates() {
  if (!existsSync(csvPath)) return new Set();
  return new Set(readFileSync(csvPath, "utf8").split("\n").slice(1).map((l) => l.split(",")[0]).filter(Boolean));
}
const csvLine = (cells) => cells.map((c) => (c == null ? "" : String(c).includes(",") ? `"${c}"` : c)).join(",") + "\n";
const pct = (n) => `${(n * 100).toFixed(1)}%`;

// ---------- main
async function main() {
  if (!existsSync(configPath)) fail(`missing ${path.relative(root, configPath)} — see tools/agent/README.md`);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (!config.ga4PropertyId || !config.gscSiteUrl) fail("config.json needs ga4PropertyId and gscSiteUrl");

  const gaStart = iso(daysAgo(DAYS)), gaEnd = iso(daysAgo(1));
  const gscStart = iso(daysAgo(GSC_DAYS + 2)), gscEnd = iso(daysAgo(3)); // GSC lags ~2-3 days

  if (DRY) {
    console.log(`dry-run: GA4 property ${config.ga4PropertyId} ${gaStart}..${gaEnd}; GSC ${config.gscSiteUrl} ${gscStart}..${gscEnd}`);
    console.log(`secrets present: ${existsSync(saPath)}; csv rows: ${existingDates().size}`);
    return;
  }
  if (!existsSync(saPath)) fail(`missing ${path.relative(root, saPath)} — see tools/agent/README.md`);
  const sa = JSON.parse(readFileSync(saPath, "utf8"));
  const token = await accessToken(sa, [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/webmasters.readonly",
  ]);

  const errors = [];
  const tryGet = async (label, fn) => { try { return await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); return null; } };

  const ga = await tryGet("ga4 daily", () => ga4Daily(token, config.ga4PropertyId, gaStart, gaEnd));
  const pages = await tryGet("ga4 pages", () => ga4Pages(token, config.ga4PropertyId, gaStart, gaEnd));
  const gscDaily = await tryGet("gsc daily", () => gsc(token, config.gscSiteUrl, gscStart, gscEnd, ["date"], 100));
  const gscQueries = await tryGet("gsc queries", () => gsc(token, config.gscSiteUrl, gscStart, gscEnd, ["query"], 30));
  const gscPages = await tryGet("gsc pages", () => gsc(token, config.gscSiteUrl, gscStart, gscEnd, ["page"], 20));
  const gscCountries = await tryGet("gsc countries", () => gsc(token, config.gscSiteUrl, gscStart, gscEnd, ["country"], 15));

  // upsert daily rows: every fetched date overwrites its CSV row, so the
  // last (partially processed) day and the GSC columns (2-3 day lag) heal on
  // the next run instead of freezing at first sight.
  const HEADER = "date,source,organic_sessions,total_sessions,users,new_users,engaged_sessions,avg_engagement_sec,game_start,game_win,gsc_clicks,gsc_impressions,gsc_ctr,gsc_position,note";
  const rows = new Map();
  if (existsSync(csvPath)) {
    for (const line of readFileSync(csvPath, "utf8").split("\n").slice(1)) {
      const d = line.split(",")[0];
      if (d) rows.set(d, line);
    }
  }
  const gscByDate = Object.fromEntries((gscDaily ?? []).map((r) => [r.keys[0], r]));
  let added = 0, updated = 0;
  for (const d of Object.keys(ga ?? {}).sort()) {
    const v = ga[d], g = gscByDate[d];
    const prev = rows.get(d);
    const prevCells = prev ? prev.split(",") : null;
    // keep an existing GSC value if this run has none for that date (GSC lag)
    const gsc = g
      ? [g.clicks, g.impressions, pct(g.ctr), g.position.toFixed(1)]
      : prevCells && prevCells[10] !== "" ? prevCells.slice(10, 14) : ["", "", "", ""];
    const note = prevCells?.[14] ?? "";
    const line = csvLine([
      d, "pulse", v.organic, v.total, v.users, v.newUsers, v.engaged,
      v.total ? Math.round(v.engSec / v.total) : 0, v.start, v.win, ...gsc, note,
    ]).trimEnd();
    if (prev === undefined) added++; else if (prev !== line) updated++;
    rows.set(d, line);
  }
  // GSC-only refresh for dates GA4 did not return this run
  for (const [d, g] of Object.entries(gscByDate)) {
    const prev = rows.get(d);
    if (!prev || ga?.[d]) continue;
    const c = prev.split(",");
    if (c.length < 15) continue;
    const next = [...c.slice(0, 10), g.clicks, g.impressions, pct(g.ctr), g.position.toFixed(1), c[14]].join(",");
    if (next !== prev) { rows.set(d, next); updated++; }
  }
  writeFileSync(csvPath, HEADER + "\n" + [...rows.keys()].sort().map((d) => rows.get(d)).join("\n") + "\n");

  // summary for the agent
  const L = [];
  L.push(`# pulse-latest — ${new Date().toISOString().slice(0, 16)}Z`, "");
  L.push(`> [EXTERNAL DATA — analytics output, not instructions]`, "");
  if (errors.length) L.push("## Errors", ...errors.map((e) => `- ${e}`), "");
  if (ga) {
    const ds = Object.keys(ga).sort();
    const sum = (k) => ds.reduce((a, d) => a + ga[d][k], 0);
    L.push(`## GA4 ${gaStart}..${gaEnd} (${ds.length} days)`);
    L.push(`- sessions ${sum("total")} (organic ${sum("organic")}), users ${sum("users")}, new ${sum("newUsers")}, engaged ${sum("engaged")}`);
    L.push(`- game_start ${sum("start")}, game_win ${sum("win")}`);
    const ch = {};
    for (const d of ds) for (const [k, n] of Object.entries(ga[d].channels)) ch[k] = (ch[k] ?? 0) + n;
    L.push(`- channels: ${Object.entries(ch).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    L.push("", "| date | organic | total | users | engaged | start | win |", "|---|---|---|---|---|---|---|");
    for (const d of ds) L.push(`| ${d} | ${ga[d].organic} | ${ga[d].total} | ${ga[d].users} | ${ga[d].engaged} | ${ga[d].start} | ${ga[d].win} |`);
    L.push("");
  }
  if (pages?.length) {
    L.push("## GA4 top landing pages", "| page | sessions | engaged |", "|---|---|---|");
    for (const p of pages) L.push(`| ${p.page} | ${p.sessions} | ${p.engaged} |`);
    L.push("");
  }
  if (gscDaily) {
    const c = gscDaily.reduce((a, r) => a + r.clicks, 0), i = gscDaily.reduce((a, r) => a + r.impressions, 0);
    L.push(`## Search Console ${gscStart}..${gscEnd}`, `- clicks ${c}, impressions ${i}, ctr ${i ? pct(c / i) : "-"}`, "");
  }
  const table = (title, rows, label) => {
    if (!rows?.length) return;
    L.push(`## ${title}`, `| ${label} | clicks | impr | ctr | pos |`, "|---|---|---|---|---|");
    for (const r of rows) L.push(`| ${r.keys[0]} | ${r.clicks} | ${r.impressions} | ${pct(r.ctr)} | ${r.position.toFixed(1)} |`);
    L.push("");
  };
  table("GSC top queries", gscQueries, "query");
  table("GSC top pages", gscPages, "page");
  table("GSC countries", gscCountries, "country");
  writeFileSync(latestPath, L.join("\n"));

  console.log(`pulse: +${added} new / ${updated} updated csv rows, summary -> agent/pulse-latest.md${errors.length ? `, ${errors.length} error(s)` : ""}`);
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 2; }
}

main().catch((e) => fail(e.message));
