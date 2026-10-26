// Record the demo video: a real run of the app in Chrome, in real time, with a visible cursor and
// burned-in captions. Nothing is sped up. Frames come straight from Chrome's screencast with their real
// timestamps (Playwright's own recorder re-times frames and drifts by several percent), so every beat
// time in docs/demo/beats.json is exact. Writes docs/demo/raw/frames/ + frames.txt and docs/demo/beats.json
// (each beat's start and end in video seconds, the narration to read, and what was actually observed
// on screen), which assemble.mjs uses to place a voiceover and to write the subtitle file.
//
//   npm run build && npm start                  # the app on :8000 with Zetaris and Nightshift running
//   node scripts/demo/record.mjs                # live run (falls back to Sample if live is unavailable)
//   node scripts/demo/record.mjs --sample       # replay a recorded run instead
//   node scripts/demo/record.mjs --no-captions  # clean footage, for a voiceover-only edit
//   node scripts/demo/record.mjs --beat-min why=40,trace=25   # make a beat at least that many seconds
//   node scripts/demo/record.mjs --timecode     # debug: burn the wall-clock seconds into the corner, to check sync
//
// Needs playwright-core and a local Chrome (CHROME_PATH to override).

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const args = new Set(argv);
const URL_ = process.env.APP_URL ?? "http://localhost:8000/";
const CAPTIONS = !args.has("--no-captions");
const WANT_SAMPLE = args.has("--sample");
const TIMECODE = args.has("--timecode");
const BEAT_MIN = Object.fromEntries((argv[argv.indexOf("--beat-min") + 1] ?? "").split(",").filter((x) => x.includes("=")).map((x) => x.split("=")).map(([k, v]) => [k, Number(v)]));
const OUT = path.join(process.cwd(), "docs", "demo");
const RAW = path.join(OUT, "raw");
const SIZE = { width: 1600, height: 900 };
const WPS = 2.4; // words per second of calm narration: sets the minimum length of each beat

fs.mkdirSync(RAW, { recursive: true });
fs.rmSync(RAW, { recursive: true, force: true });
fs.mkdirSync(path.join(RAW, "frames"), { recursive: true });

// Headless Chrome reserves an 87 px strip at the top of its window, and Playwright pads a video whose page is that much
// shorter with gray. So: no viewport override, and a window 87 px taller than the 900 px page we want.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: [`--window-size=${SIZE.width},${SIZE.height + 87}`] });
const ctx = await browser.newContext({ viewport: null, colorScheme: "light" });
const page = await ctx.newPage();
await page.goto(URL_, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

// ---- on-screen furniture: cursor, click ripple, caption pill, end card
await page.evaluate((withCaptions) => {
  const css = document.createElement("style");
  css.textContent = `
    #demo-cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:99999;pointer-events:none;transform:translate(-100px,-100px)}
    #demo-ripple{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid #0f766e;z-index:99998;pointer-events:none;opacity:0}
    #demo-ripple.go{animation:rip .55s ease-out}
    @keyframes rip{from{opacity:.9;transform:scale(.4)}to{opacity:0;transform:scale(1.7)}}
    #demo-caption{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);max-width:1220px;padding:14px 26px;border-radius:12px;background:rgba(12,10,9,.9);color:#fafaf9;font:500 26px/1.35 Inter,system-ui,sans-serif;letter-spacing:-.005em;text-align:center;z-index:99997;pointer-events:none;opacity:0;transition:opacity .25s}
    #demo-caption.on{opacity:1}
    #demo-end,#demo-hook{position:fixed;inset:0;z-index:100000;background:#0c0a09;color:#f5f5f4;display:none;flex-direction:column;align-items:center;justify-content:center;gap:30px;font-family:Inter,system-ui,sans-serif;text-align:center;padding:0 140px;transition:opacity .7s}
    #demo-hook{display:flex}
    #demo-end h1{font:600 104px/1 "Instrument Sans",Inter,sans-serif;letter-spacing:-.03em;margin:0}
    #demo-end p,#demo-hook p{font-size:34px;line-height:1.4;margin:0;color:#e7e5e4;max-width:1150px;opacity:0;transition:opacity .8s}
    #demo-hook p.a{font:600 66px/1.12 "Instrument Sans",Inter,sans-serif;letter-spacing:-.025em;color:#f5f5f4;max-width:1250px}
    #demo-hook p.b{font:600 56px/1.15 "Instrument Sans",Inter,sans-serif;letter-spacing:-.02em;color:#2dd4bf}
    #demo-end p.big{font:600 52px/1.15 "Instrument Sans",Inter,sans-serif;letter-spacing:-.02em;color:#2dd4bf}
    #demo-end .u{font:500 28px "IBM Plex Mono",monospace;color:#a8a29e}
    #demo-end .show,#demo-hook .show{opacity:1}`;
  document.head.appendChild(css);
  const cur = document.createElement("div");
  cur.id = "demo-cursor";
  cur.innerHTML = `<svg viewBox="0 0 28 28" width="28" height="28"><path d="M4 2l17 10-7.5 1.8L9.6 21z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  const rip = document.createElement("div");
  rip.id = "demo-ripple";
  document.body.append(cur, rip);
  if (withCaptions) { const c = document.createElement("div"); c.id = "demo-caption"; document.body.appendChild(c); }
  const end = document.createElement("div");
  end.id = "demo-end";
  end.innerHTML = `<p class="t1" style="font-size:38px">It doesn’t guess what will run short.</p><p class="t2" style="font-size:38px">It tells you what to do about what just did.</p><h1 class="t3" style="opacity:0;transition:opacity .8s">Shortage Radar</h1><p class="big t4">Real data. Real queries. Real receipts.</p><p class="u t5" style="font-size:26px">github.com/techbone/shortage-radar</p><p class="t6" style="font-size:22px;color:#a8a29e">Zetaris · Meterless World Model, H-MEM, Scout Intent, Nightshift · NVIDIA Nemotron · built solo</p>`;
  document.body.appendChild(end);
  const hook = document.createElement("div");
  hook.id = "demo-hook";
  hook.innerHTML = `<p class="a">746 of the FDA’s 1,609 drug shortage entries were updated in a single week.</p><p class="b">Which ones are on your hospital’s shelf?</p>`;
  document.body.appendChild(hook);
  document.addEventListener("mousemove", (e) => { cur.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`; }, true);
  document.addEventListener("mousedown", (e) => { rip.style.left = e.clientX + "px"; rip.style.top = e.clientY + "px"; rip.classList.remove("go"); void rip.offsetWidth; rip.classList.add("go"); }, true);
}, CAPTIONS);
if (TIMECODE) await page.evaluate(() => { const d = document.createElement("div"); d.id = "tc"; d.style.cssText = "position:fixed;right:10px;bottom:10px;z-index:100001;background:#000;color:#0f0;font:20px monospace;padding:2px 8px"; document.body.appendChild(d); window.__t0 = Date.now(); setInterval(() => { d.textContent = ((Date.now() - window.__t0) / 1000).toFixed(1); }, 50); });

// ---- capture: every frame Chrome paints, with its own timestamp
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const file = `frames/${String(frames.length).padStart(6, "0")}.jpg`;
  fs.writeFileSync(path.join(RAW, file), Buffer.from(data, "base64"));
  frames.push({ t: metadata.timestamp, file });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
await page.waitForTimeout(400);

const t0 = Date.now();
const T0 = t0 / 1000; // video time zero, in the same epoch seconds as the frame timestamps
const now = () => Math.round((Date.now() - t0) / 100) / 10;
let mouse = { x: 800, y: 450 };
await page.mouse.move(mouse.x, mouse.y);

const caption = async (text) => { if (CAPTIONS) await page.evaluate((t) => { const c = document.getElementById("demo-caption"); if (!c) return; if (t) { c.textContent = t; c.classList.add("on"); } else c.classList.remove("on"); }, text); };
const moveTo = async (locator, { dx = 0, dy = 0, steps = 28 } = {}) => {
  const b = await locator.boundingBox();
  if (!b) return;
  const x = b.x + b.width / 2 + dx, y = b.y + b.height / 2 + dy;
  await page.mouse.move(x, y, { steps });
  mouse = { x, y };
};
const click = async (locator, opts) => { await moveTo(locator, opts); await page.waitForTimeout(250); await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up(); };
const pause = (s) => page.waitForTimeout(s * 1000);
// A caption is one short sentence: cut at the first full stop, or at a word boundary with an ellipsis.
const tidy = (t) => { const first = t.split(/\.\s/)[0]; if (first.length <= 112) return first; return first.slice(0, 112).replace(/\s+\S*$/, "") + "…"; };
const drawerScroll = (top) => page.locator(".drawer .body").evaluate((el, y) => el.scrollBy({ top: y, behavior: "smooth" }), top);

const status = await (await fetch(new URL("/api/status", URL_))).json();
const useLive = !WANT_SAMPLE && status.live_available;
console.log(`[INFO] recording in ${useLive ? "LIVE" : "SAMPLE"} mode${CAPTIONS ? "" : ", no captions"}`);

const beats = [];
const warnings = [];
let observed = {};
async function beat(id, narration, captionText, action) {
  const start = now();
  await caption(captionText);
  const minDur = Math.max(Math.ceil(narration.split(/\s+/).length / WPS), BEAT_MIN[id] ?? 0);
  const done = action ? action() : Promise.resolve();
  await Promise.all([done, pause(minDur)]);
  beats.push({ id, start, end: now(), narration, caption: captionText });
  console.log(`[INFO] beat ${id}: ${start}s to ${now()}s`);
}

// 0. The hook: a cold open before the app appears.
await beat("hook",
  "Seven hundred and forty six drug shortage entries on the FDA list were updated in a single week. Which of them are on your hospital's shelf?",
  "",
  async () => {
    await pause(0.7);
    await page.evaluate(() => document.querySelector("#demo-hook .a").classList.add("show"));
    await pause(4);
    await page.evaluate(() => document.querySelector("#demo-hook .b").classList.add("show"));
    await pause(4.2);
    await page.evaluate(() => { document.getElementById("demo-hook").style.opacity = "0"; });
    await pause(0.8);
    await page.evaluate(() => { document.getElementById("demo-hook").style.display = "none"; });
  });

// 1. The run starts, in real time, while the problem is explained.
let runDone;
await beat("problem",
  "That is the daily job of a hospital pharmacy buyer. This is Shortage Radar, running right now, in real time, against the real FDA data.",
  useLive ? "A real run, live: no speed-up, no mock data" : "A replay of a recorded live run",
  async () => {
    if (useLive) await click(page.getByRole("button", { name: "Live" })); else await click(page.getByRole("button", { name: "Sample" }));
    await pause(0.4);
    await click(page.getByRole("button", { name: /Run sweep/ }));
    runDone = page.waitForSelector("table.t", { timeout: 280_000 });
  });

// 2. The fast steps are already done by now (about 3 s); the screen shows them ticked.
await beat("steps",
  "Before any model is involved, it has already read the FDA feed through Zetaris, replayed every saved snapshot in the World Model so it knows what changed, joined the hospital's stock with the FDA list in one query, and screened every third party field with the Scout guard.",
  "Already done, no model involved: Zetaris query, World Model diff, stock join, Scout guard",
  async () => { await moveTo(page.locator(".rail"), { dx: 20, dy: -60 }); });

// 3. The slow step, explained, and the engines explained while the run is still thinking.
// Captions follow the real step names from the page whenever nothing else is being narrated.
const startFollower = () => {
  let on = true;
  const loop = (async () => {
    while (on) {
      const cur = await page.locator(".step.running").first().innerText({ timeout: 300 }).catch(() => ""); // short timeout: between steps nothing is running
      if (cur) { const [name, ...rest] = cur.split("\n").filter(Boolean); await caption(tidy(`${name}: ${rest.filter((x) => !/^\d+(\.\d)?s$/.test(x)).join(" ")}`)); }
      await pause(1);
    }
  })();
  return async () => { on = false; await loop; };
};
let stopFollower = startFollower();
await beat("thinking",
  "Now Nemotron, through Nightshift, is choosing what to cover. This is the slow step, because it is the one place the model is allowed to think: choosing what matters is the judgement call. After that it writes one item at a time with thinking off, and a checker written in plain code verifies every claim, so a slow model cannot talk its way past it.",
  "", async () => {});
await stopFollower();

await beat("engines",
  "While that finishes, here is what is under the hood. Three Meterless engines do real work, and each passes its official test: World Model, eight of eight. H-MEM, thirteen of thirteen. Scout Intent, injection precision one point zero, recall point nine eight. The limits are on the page too: the hospital is fictional, Scout is pattern based, and the agent never predicts a shortage, because when we tested whether recalls predict them, the data said no.",
  "Three Meterless engines, each passing the official tests, and the limits stated plainly",
  async () => {
    await click(page.getByRole("tab", { name: "Engines" }));
    await pause(2.5);
    await moveTo(page.locator(".engine").nth(0), { dy: -40 });
    await pause(2);
    await moveTo(page.locator(".engine").nth(1), { dy: -40 });
    await pause(2);
    await moveTo(page.locator(".engine").nth(2), { dy: -40 });
    await pause(2);
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "smooth" }));
    await pause(4);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await click(page.getByRole("tab", { name: "Brief" }));
  });

// 3b. Whatever is left of the real wait. Silent footage with live captions; nothing is cut or sped up.
stopFollower = startFollower();
const waitStart = now();
await runDone;
await stopFollower();
observed.waitAfterEnginesSeconds = Math.round((now() - waitStart) * 10) / 10;
await pause(0.6);

// 4. The result. What the narration says is checked against what is on screen.
const facts = (await page.locator(".facts").innerText({ timeout: 3000 }).catch(() => "")).replace(/\s+/g, " ");
const headline = await page.locator(".hero h1").innerText({ timeout: 3000 }).catch(() => "");
const rows = await page.locator("tr.row").evaluateAll((trs) => trs.map((tr) => ({ drug: tr.querySelector(".drug")?.textContent?.trim(), state: tr.querySelector(".chip")?.textContent?.trim(), days: tr.querySelector(".days")?.textContent?.trim(), buy: tr.querySelectorAll("td")[3]?.textContent?.trim(), swaps: Number(tr.dataset.swaps), review: Number(tr.dataset.review) })));
const changes = facts.match(/(\d+) NDCs changed status/)?.[1];
const shelf = facts.match(/(\d+) on your shelf/)?.[1];
observed = { ...observed, headline, items: rows.length, first: rows[0], changes, shelf, rows };
if (rows.length !== 6) warnings.push(`narration says "six items" but the screen shows ${rows.length}`);
if (rows[0]?.drug?.toLowerCase() !== "etomidate" || rows[0]?.state !== "Unavailable" || rows[0]?.days !== "6") warnings.push(`narration says Etomidate, unavailable, six days on hand; the screen shows ${JSON.stringify(rows[0])}`);
// The review beat shows an item that has same-strength swaps AND other strengths held back for review.
const reviewRow = rows.find((r) => r.swaps > 0 && r.review > 0) ?? rows.find((r) => r.review > 0);
if (!reviewRow) warnings.push("no item in this brief has strengths held back for review; the review beat is skipped");
const cap1 = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);
observed.reviewDrug = reviewRow?.drug;
for (const w of warnings) console.warn(`[WARN] ${w}`);
await beat("result",
  "Six items need action today. Etomidate went from available to unavailable, with six days of stock left, and it names exactly what to buy instead: the same strength, from another manufacturer.",
  `${headline}  ·  ${changes} FDA status changes, ${shelf} on this hospital's shelf`,
  async () => { await moveTo(page.locator("tr.row", { hasText: "Etomidate" }), { dx: 120 }); await pause(1.5); await moveTo(page.locator("tr.row", { hasText: "Etomidate" }).locator("td").nth(3), { steps: 40 }); });

// 5. Why: the evidence drawer.
await beat("why",
  "Every line has a receipt. The drawer shows the swap options, and below that the evidence behind each sentence: the stock, the FDA status history from the World Model, and the Zetaris query with its SQL, one click away.",
  "Every line has a receipt: the stock, the status history, and the SQL behind it",
  async () => {
    await click(page.locator("tr.row", { hasText: "Etomidate" }));
    await page.waitForSelector(".drawer");
    await pause(2.5);
    await drawerScroll(520);
    await pause(2);
    await drawerScroll(700);
    await pause(1.5);
    await click(page.locator(".drawer details summary", { hasText: "SQL" }).first());
    await pause(3);
    await drawerScroll(500);
    await pause(4);
    await page.keyboard.press("Escape");
  });

// 6. Safety: a different strength is never offered as a swap.
if (reviewRow) await beat("review",
  `A swap has to be the same strength. A different concentration is a medication error, so on ${cap1(reviewRow.drug)} the other products are not offered as swaps. They go to a pharmacist for review, each with its reason.`,
  "Same strength only: everything else goes to pharmacist review, with the reason",
  async () => {
    await click(page.locator(`tr.row[data-ndc]`).filter({ has: page.locator(".drug", { hasText: new RegExp(`^${reviewRow.drug}$`, "i") }) }));
    await page.waitForSelector(".drawer");
    await pause(2);
    const review = page.locator(".drawer details summary", { hasText: "to review" }).first();
    await review.scrollIntoViewIfNeeded();
    await pause(0.8);
    await click(review);
    await pause(2.5);
    observed.reviewReasons = await page.locator(".drawer details .card").evaluateAll((cs) => cs.map((c) => c.textContent?.replace(/\s+/g, " ").trim()));
    await drawerScroll(220);
    await pause(3);
    await page.keyboard.press("Escape");
  });

// 7. H-MEM: the decision.
if (!rows.find((r) => r.drug?.toLowerCase() === "etomidate")) { warnings.push("the decision beat records Etomidate, which is not in the brief"); }
await beat("decision",
  "When the buyer decides, H-MEM remembers. I record that I bought the alternate, and Etomidate moves to Handled. It stays out of tomorrow's brief until the FDA status changes again.",
  "H-MEM remembers the decision: handled items stay out of the brief until the FDA status moves",
  async () => {
    await click(page.locator("tr.row", { hasText: "Etomidate" }));
    await page.waitForSelector(".drawer");
    await pause(0.8);
    await page.locator(".drawer .body").evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
    await pause(1.2);
    await click(page.getByPlaceholder(/Optional note/));
    await page.keyboard.type("2 weeks from Caplin via Cardinal", { delay: 55 });
    await pause(0.6);
    await click(page.getByRole("button", { name: "Bought the alternate" }));
    await pause(1.5);
    await moveTo(page.getByText("Quiet until the FDA status changes"), { dx: -200, dy: 60 });
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
  });

// 8. The trace.
await beat("trace",
  "Everything is logged. Each line names the agent, the Zetaris query, and the model that answered: Nemotron three point five Lightning, through Nightshift. The planner thinks, the writer doesn't, and the critic is code.",
  "Every call is logged, with the model named: nvidia/nemotron-3.5-lightning-30b-a3b",
  async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await click(page.getByRole("tab", { name: /Trace/ }));
    await pause(2);
    await page.evaluate(() => window.scrollBy({ top: 360, behavior: "smooth" }));
    await pause(2);
    await page.evaluate(() => window.scrollBy({ top: 420, behavior: "smooth" }));
    await pause(1.5);
  });

// 9. Sample mode: anyone can run it with no keys.
await beat("sample",
  "And anyone can run it with no keys at all. Sample mode replays a recorded live run, labelled as a replay, so a judge sees exactly what the live system produced.",
  "No keys needed: Sample mode replays a recorded live run, labelled as a replay",
  async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await click(page.getByRole("tab", { name: "Brief" }));
    await pause(0.8);
    const forget = page.getByRole("button", { name: /Forget my/ });
    await forget.scrollIntoViewIfNeeded(); // it sits below the fold: a click outside the window does nothing
    await pause(0.6);
    await click(forget);
    await pause(0.8);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await pause(0.8);
    await click(page.getByRole("button", { name: "Sample" }));
    await pause(0.5);
    await click(page.getByRole("button", { name: /Run again/ }));
    await page.getByText("Replay of a recorded live run").waitFor({ timeout: 30_000 }); // only exists once the replay has finished
    await pause(1);
    const replayRows = await page.locator("tr.row").count();
    const replayWarn = await page.locator(".step.warn").count();
    observed.replay = { rows: replayRows, stepsWithWarnings: replayWarn };
    if (replayRows !== 6 || replayWarn > 0) warnings.push(`the sample replay should show the six recorded items with no warnings; it shows ${replayRows} items and ${replayWarn} warning steps`);
    await moveTo(page.getByText("Replay of a recorded live run"), { steps: 35 });
    await pause(2);
  });

// 10. Close.
await beat("close",
  "Real data, real queries, real receipts. Shortage Radar doesn't guess what will run short. It tells you what to do about what just did.",
  "",
  async () => {
    await caption("");
    await page.evaluate(() => { const e = document.getElementById("demo-end"); e.style.opacity = "0"; e.style.display = "flex"; void e.offsetWidth; e.style.opacity = "1"; });
    await pause(0.8);
    for (const [cls, wait] of [["t1", 1.6], ["t2", 2.2], ["t3", 1.4], ["t4", 1.8], ["t5", 0.8], ["t6", 0.5]]) {
      await page.evaluate((c) => { const el = document.querySelector(`#demo-end .${c}`); el.classList.add("show"); if (el.style.opacity === "0") el.style.opacity = "1"; }, cls);
      await pause(wait);
    }
  });
await pause(3);

const total = now();
const T_END = Date.now() / 1000;
await cdp.send("Page.stopScreencast");
await page.waitForTimeout(200);
await ctx.close();

// Concat list for ffmpeg: each frame is shown from its own timestamp until the next one (video time zero = T0).
const inWindow = frames.filter((f) => f.t <= T_END);
const first = Math.max(0, inWindow.findLastIndex((f) => f.t <= T0));
const used = inWindow.slice(first);
const lines = [];
used.forEach((f, i) => {
  const start = Math.max(f.t, T0);
  const end = i + 1 < used.length ? used[i + 1].t : T_END;
  lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, end - start).toFixed(4)}`);
});
lines.push(`file '${used.at(-1).file}'`);
fs.writeFileSync(path.join(RAW, "frames.txt"), lines.join("\n") + "\n");
const video_seconds = Math.round((T_END - T0) * 10) / 10;
console.log(`[INFO] ${used.length} frames over ${video_seconds}s`);
if (total > 235) warnings.push(`the video is about ${total}s; the limit is 240s`);
fs.writeFileSync(path.join(OUT, "beats.json"), JSON.stringify({ mode: useLive ? "live" : "sample", captions: CAPTIONS, frames_list: "raw/frames.txt", duration_seconds: video_seconds, warnings, observed, beats }, null, 2) + "\n");
await browser.close();
console.log(`[INFO] ${video_seconds}s of footage → docs/demo/raw/; timing in docs/demo/beats.json${warnings.length ? `\n[WARN] ${warnings.length} thing(s) to fix before using this footage` : "\n[INFO] narration matches the screen"}`);
