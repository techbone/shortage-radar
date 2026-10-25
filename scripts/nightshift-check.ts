// Live check against your running Nightshift (the Power prompt's done-criteria):
//   1. a wrong token shows unauthorized (not offline)
//   2. auto detect finds the runtime
//   3. a plain text request on meterless/auto returns a string, and which model answered
//   npm run nightshift:check

import { autoDetect, chat, checkStatus, loadSettings, maskToken } from "../src/adapters/meterless";

const s = loadSettings();
console.log(`[INFO] base URL ${s.baseUrl} · token ${maskToken(s.token)} · model ${s.model}`);

const wrong = await checkStatus({ baseUrl: s.baseUrl, token: "definitely-wrong-token" });
console.log(`[CHECK 1] wrong token → ${wrong.status} ${wrong.status === "unauthorized" ? "PASS" : "FAIL (expected unauthorized)"}`);

const found = await autoDetect(s.token);
console.log(`[CHECK 2] auto detect → ${found ? `${found.baseUrl} (${found.status})` : "nothing found"} ${found ? "PASS" : "FAIL"}`);
if (found?.models.length) console.log(`          routing modes: ${found.models.join(", ")}`);

if (!s.token) {
  console.log("[CHECK 3] skipped: set METERLESS_RUNTIME_TOKEN in .env (Nightshift → Console)");
  process.exit(1);
}
const r = await chat({ messages: [{ role: "user", content: "Reply with one short sentence: what is a drug shortage?" }], model: "meterless/auto", maxTokens: 1024 }); // reasoning models think first: ~500 tokens for a one-line answer
console.log(`[CHECK 3] meterless/auto → ${typeof r.content === "string" && r.content ? "PASS" : "FAIL"} (${r.latencyMs} ms, model: ${r.model})`);
console.log(`          "${r.content.slice(0, 160)}"`);
if (!/nemotron/i.test(r.model)) console.log("[WARN] the answering model is not Nemotron; pin a Nemotron lane in Nightshift for the NVIDIA award");
