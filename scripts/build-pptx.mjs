// Build docs/deck/Shortage-Radar-deck.pptx from the rendered slide images (docs/deck/slides/s01.png ...),
// with speaker notes. Each slide is a full-bleed image, so it looks exactly like the PDF; the text is not
// editable in PowerPoint. The editable source is docs/deck/deck.html.
//   node scripts/build-deck.mjs && node scripts/build-pptx.mjs
import fs from "node:fs";
import path from "node:path";
import pptxgen from "pptxgenjs";

const dir = path.join(process.cwd(), "docs", "deck");
const NOTES = [
  "Shortage Radar, Track 02. One line: it does not guess what will run short, it tells a hospital pharmacy buyer what to do about what just did. Real FDA data, real NDCs, a fictional hospital. Built solo on Zetaris, the Meterless engines, Nightshift and Nemotron.",
  "The user is the buyer at a community hospital pharmacy. Today they check the FDA and ASHP pages, wholesaler emails and a spreadsheet. We measured the FDA list: 746 of 1,609 entries were updated in one week. Vizient put the labor at 8.6 million hours a year; ASHP counted a record 323 active shortages in Q1 2024. The real danger is buying the wrong substitute.",
  "One brief. It matches the hospital's stock to the FDA list in one SQL statement, explains every line with its evidence, and remembers what the buyer already decided. This is the real app on real FDA data.",
  "Six steps. Code gathers the facts through Zetaris, the World Model, H-MEM and the Scout guard. Nemotron plans and writes. A Critic written in plain code checks every claim, and sends a draft back up to twice before falling back to plain text. Everything is bounded: five minute budget, timeouts, and a labelled fallback to a recorded replay if a service is unreachable.",
  "Zetaris is the data layer, Nightshift is the only AI provider. The agent talks to Zetaris over REST and to Nemotron through Nightshift in OpenAI format. TypeScript, Next.js, Docker, 76 tests.",
  "Two sources, one statement: the hospital's Postgres as a JDBC data source joined with the FDA feed as a REST table. The JDBC syntax was found from the parser's error messages and is recorded in the build log. The adapter refuses anything that is not a single read-only statement.",
  "Three Meterless engines, each behind a feature you can click, each with a passing test from the official runner. World Model 8 of 8, H-MEM 13 of 13, Scout injection precision 1.000 and recall 0.980 on 2,316 cases. Be upfront: on six attacks written after our rules Scout caught none; we patched five, and Polish still gets through.",
  "Nemotron 3.5 Lightning through Nightshift plans and writes, and the model is named on every trace line. The finding: thinking is a design lever. Thinking on cost about 4 seconds and 389 tokens for a one-line answer; off, under a second and 23 tokens. The Planner keeps it on, it is the judgement call and takes 39 seconds of a 59 second run. The Writer turns it off.",
  "Every sentence has a receipt. The evidence drawer shows the records and the SQL. The Critic is code, not a model: it rejects an NDC that is not a same-concentration swap, a missing or invented citation, a wrong day count, an unsupported cause, or a prediction. In a live run it caught the Writer citing another drug's alternate.",
  "What was unique. Remove any sponsor and the flow stops. We tested our first idea, that recalls predict shortages, and the data said no, so the agent never forecasts. A swap means the same strength. And the checker is code that cannot be talked into agreeing.",
  "Limits, stated plainly: fictional hospital, pattern-based Scout covering the guard stage only, strengths read from presentation text with anything unclear sent to pharmacist review, a free endpoint with latency spikes. Next: wholesaler availability and prices as more Zetaris sources, a Nemotron safety model as Scout's second layer, ASHP notices, and a real-hospital pilot.",
  "Try it in two minutes with no keys: build the image, run it, press Run sweep. Sample mode replays a recorded live run. Repo, tests and evidence are all linked in the README.",
];
const files = fs.readdirSync(path.join(dir, "slides")).filter((f) => /^s\d+\.png$/.test(f)).sort();
if (files.length !== NOTES.length) throw new Error(`${files.length} slide images but ${NOTES.length} notes`);

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in, the same 16:9 as the 1920x1080 renders
pres.title = "Shortage Radar";
pres.author = "Musa Etudaye";
pres.subject = "Open Agent Hackathon 2026, Track 02";
files.forEach((f, i) => {
  const slide = pres.addSlide();
  slide.addImage({ path: path.join(dir, "slides", f), x: 0, y: 0, w: 10, h: 5.625, altText: `Slide ${i + 1}: ${NOTES[i].split(".")[0]}.` });
  slide.addNotes(NOTES[i]);
});
await pres.writeFile({ fileName: path.join(dir, "Shortage-Radar-deck.pptx") });
console.log(`wrote ${files.length} slides`);
