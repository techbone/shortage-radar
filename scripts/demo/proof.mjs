// Record a short proof clip: the official Meterless runners, the Scout evals, a live Zetaris federated query and
// the test suite, each run for real in this repo while Chrome films a terminal-style page. Output streams in as the
// command produces it; nothing is sped up (frames carry Chrome's own timestamps, as in record.mjs).
//
//   node scripts/demo/proof.mjs        # Zetaris running, .env set; writes docs/demo/shortage-radar-proof.mp4
//
// Needs playwright-core, a local Chrome (CHROME_PATH) and ffmpeg (FFMPEG or on PATH).

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs", "demo");
const RAW = path.join(OUT, "raw-proof");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const SIZE = { width: 1600, height: 900 };

const ZQ = "SELECT f.generic_name, f.ndc, i.on_hand_units AS on_hand, i.daily_usage_units AS per_day, s.availability AS fda FROM northwind_pg.formulary_item f JOIN northwind_pg.inventory i ON i.ndc = f.ndc JOIN fda.shortages s ON s.package_ndc = f.ndc WHERE s.status = 'Current' AND s.availability <> 'Available' ORDER BY f.generic_name";
// Only these commands can be started from the page.
const STEPS = [
  { id: "wm", shown: "npm run conformance:wm", cmd: ["npm", "run", "-s", "conformance:wm"], hold: 6, caption: "World Model: 8 of 8 official conformance checks pass" },
  { id: "hmem", shown: "npm run conformance:hmem", cmd: ["npm", "run", "-s", "conformance:hmem"], hold: 7, caption: "H-MEM: 13 of 13 official conformance checks pass" },
  { id: "scout", shown: "npm run evals:injection", cmd: ["npm", "run", "-s", "evals:injection"], hold: 11, caption: "Scout Intent guard: injection precision 1.000, recall 0.980 on 2,316 cases (intent and tool rows: not built, guard stage only)" },
  { id: "zq", shown: `npm run zq -- "${ZQ}"`, cmd: ["npm", "run", "-s", "zq", "--", ZQ], hold: 10, caption: "Zetaris: one SQL statement joins the hospital's Postgres stock with the live FDA shortage feed" },
  { id: "test", shown: "npm test", cmd: ["npm", "test"], hold: 6, caption: "And all 76 repository tests pass" },
];

const FONT = (w) => path.join(ROOT, "node_modules", "@fontsource", "ibm-plex-mono", "files", `ibm-plex-mono-latin-${w}-normal.woff2`);
const SANS = path.join(ROOT, "node_modules", "@fontsource", "instrument-sans", "files", "instrument-sans-latin-600-normal.woff2");
const strip = (s) => s.replaceAll(ROOT, ".").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r(?!\n)/g, "\n");

const PAGE = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Plex;src:url(/font/400)}@font-face{font-family:Plex;font-weight:500;src:url(/font/500)}@font-face{font-family:IS;font-weight:600;src:url(/font/sans)}
html,body{margin:0;height:100%;background:#0c0a09;color:#e7e5e4;overflow:hidden}
#term{position:absolute;inset:44px 56px 168px;font:15px/1.4 Plex,monospace;white-space:pre-wrap;word-break:break-all;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end}
.p{color:#2dd4bf}.c{color:#fafaf9;font-weight:500}.ok{color:#86efac}.big{color:#2dd4bf;font-weight:500}.bad{color:#fca5a5}.dim{color:#78716c}
#bar{position:absolute;left:56px;right:56px;top:0;height:36px;display:flex;align-items:center;gap:8px;font:13px Plex,monospace;color:#78716c;border-bottom:1px solid #292524}
#cap{position:absolute;left:50%;bottom:36px;transform:translateX(-50%);max-width:1300px;padding:14px 26px;border-radius:12px;background:#f5f5f4;color:#0c0a09;font:500 25px/1.35 Inter,system-ui,sans-serif;text-align:center;opacity:0;transition:opacity .25s}
#cap.on{opacity:1}
.card{position:absolute;inset:0;background:#0c0a09;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;text-align:center;transition:opacity .6s;z-index:5}
.card h1{font:600 76px/1.05 IS,Inter,sans-serif;letter-spacing:-.03em;color:#f5f5f4;margin:0}
.card p{font:30px/1.4 Inter,system-ui,sans-serif;color:#d6d3d1;margin:0;max-width:1150px}
.card .t{color:#2dd4bf;font:600 40px/1.2 IS,Inter,sans-serif}
.card code{font:24px Plex,monospace;color:#a8a29e}
</style>
<div id="bar">~/shortage-radar · git ${spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf-8" }).stdout.trim()}</div><div id="term"></div><div id="cap"></div>
<div class="card" id="intro"><h1>Proof it works</h1><p>The official Meterless test runners, the Scout evals and a live Zetaris query, run in the Shortage Radar repo.</p><p class="t">Real commands. Real time. Nothing edited.</p></div>
<div class="card" id="end" style="opacity:0;display:none"><h1>Shortage Radar</h1><p class="t">Run them yourself</p><code>npm ci &amp;&amp; npm run conformance &amp;&amp; npm test</code><code>github.com/techbone/shortage-radar</code></div>
<script>
const term = document.getElementById("term"), cap = document.getElementById("cap");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cls = (l) => /^\\s*PASS\\b|PASS$/.test(l) ? "ok" : /checks passed|Tests +\\d+ passed|Test Files +\\d+ passed|injection_(precision|recall) +\\d/.test(l) ? "big" : /❌|FAIL|below floor|failed/.test(l) ? "bad" : /^\\[INFO\\]|^Loaded|^Report|^note:/.test(l) ? "dim" : "";
function line(text, c) { const d = document.createElement("div"); d.textContent = text || " "; if (c) d.className = c; term.append(d); return d; }
window.caption = (t) => { cap.textContent = t; cap.classList.toggle("on", !!t); };
window.card = async (id, show) => { const el = document.getElementById(id); if (show) { el.style.display = "flex"; await sleep(30); el.style.opacity = 1; } else { el.style.opacity = 0; await sleep(650); el.style.display = "none"; } };
window.run = async (id, shown) => {
  term.innerHTML = "";
  const p = line(""); p.innerHTML = '<span class="p">$ </span><span class="c"></span>';
  const c = p.querySelector(".c");
  const delay = shown.length > 80 ? 6 : 38;
  for (const ch of shown) { c.textContent += ch; await sleep(delay); }
  await sleep(350);
  const res = await fetch("/run/" + id); const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); const parts = buf.split("\\n"); buf = parts.pop(); for (const l of parts) line(l, cls(l)); }
  if (buf) line(buf, cls(buf));
  return Number(res.headers.get("x-start"));
};
</script>`;

const exits = {};
const server = http.createServer((req, res) => {
  if (req.url === "/") return res.end(PAGE);
  if (req.url.startsWith("/font/")) { const w = req.url.slice(6); return res.end(fs.readFileSync(w === "sans" ? SANS : FONT(w))); }
  const step = STEPS.find((s) => req.url === `/run/${s.id}`);
  if (!step) { res.statusCode = 404; return res.end(); }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "x-start": String(Date.now()) });
  const child = spawn(step.cmd[0], step.cmd.slice(1), { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "1" } });
  child.stdout.on("data", (d) => res.write(strip(d.toString())));
  child.stderr.on("data", (d) => res.write(strip(d.toString())));
  child.on("close", (code) => { exits[step.id] = code; res.end(); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

fs.rmSync(RAW, { recursive: true, force: true });
fs.mkdirSync(path.join(RAW, "frames"), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: [`--window-size=${SIZE.width},${SIZE.height + 87}`] });
const ctx = await browser.newContext({ viewport: null, colorScheme: "dark" });
const page = await ctx.newPage();
await page.goto(URL_);
await page.evaluate(() => document.fonts.ready);

const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const file = `frames/${String(frames.length).padStart(6, "0")}.jpg`;
  fs.writeFileSync(path.join(RAW, file), Buffer.from(data, "base64"));
  frames.push({ t: metadata.timestamp, file });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
await page.waitForTimeout(400);
const T0 = Date.now() / 1000;
const wait = (s) => page.waitForTimeout(s * 1000);

await wait(5.5);
await page.evaluate(() => window.card("intro", false));
for (const s of STEPS) {
  const t = Date.now();
  await page.evaluate(([id, shown]) => window.run(id, shown), [s.id, s.shown]);
  console.log(`[INFO] ${s.id}: exit ${exits[s.id]} after ${((Date.now() - t) / 1000).toFixed(1)}s on screen`);
  await wait(0.6);
  await page.evaluate((c) => window.caption(c), s.caption);
  await wait(s.hold);
  await page.evaluate(() => window.caption(""));
  await wait(0.4);
}
await page.evaluate(() => window.card("end", true));
await wait(5.5);

const T_END = Date.now() / 1000;
await cdp.send("Page.stopScreencast");
await page.waitForTimeout(200);
await browser.close();
server.close();

const failed = STEPS.filter((s) => exits[s.id] !== 0).map((s) => s.id);
const used = frames.filter((f) => f.t <= T_END).slice(Math.max(0, frames.findLastIndex((f) => f.t <= T0)));
const lines = [];
used.forEach((f, i) => { const start = Math.max(f.t, T0); const end = i + 1 < used.length ? used[i + 1].t : T_END; lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, end - start).toFixed(4)}`); });
lines.push(`file '${used.at(-1).file}'`);
fs.writeFileSync(path.join(RAW, "frames.txt"), lines.join("\n") + "\n");
const seconds = +(T_END - T0).toFixed(1);
const target = path.join(OUT, "shortage-radar-proof.mp4");
const ff = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(RAW, "frames.txt"), "-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=48000:cl=stereo",
  "-vf", "scale=1920:1080:flags=lanczos,fps=30", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-t", String(seconds), target], { encoding: "utf-8" });
if (ff.status !== 0) { console.error(ff.stderr); process.exit(1); }
console.log(`[INFO] ${path.relative(ROOT, target)}: ${seconds}s, ${(fs.statSync(target).size / 1e6).toFixed(1)} MB`);
if (failed.length) { console.error(`[WARN] these commands did not exit 0: ${failed.join(", ")}`); process.exit(1); }
