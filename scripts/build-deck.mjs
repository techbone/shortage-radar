// Render docs/deck/deck.html: one PNG per slide, layout checks, and the PDF.
//   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/build-deck.mjs [outDir]
// Needs playwright-core (devDependency), a local Chrome, and `npm ci` (the deck uses the bundled fonts).

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = process.cwd();
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, "docs", "deck", "slides"));
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`file://${ROOT}/docs/deck/deck.html`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

fs.mkdirSync(OUT, { recursive: true });
const slides = await page.locator(".slide").all();
const problems = [];
for (let i = 0; i < slides.length; i++) {
  await slides[i].screenshot({ path: path.join(OUT, `s${String(i + 1).padStart(2, "0")}.png`) });
  // Anything that leaves the slide, clips its own content, or runs into the footer.
  const found = await slides[i].evaluate((el) => {
    const s = el.getBoundingClientRect();
    const out = [];
    el.querySelectorAll("*").forEach((n) => {
      const b = n.getBoundingClientRect();
      if (!b.width || !b.height) return;
      if (b.right > s.right + 1 || b.bottom > s.bottom + 1 || b.left < s.left - 1) out.push(`${n.tagName}.${n.className} leaves the slide`);
      if ((n.scrollHeight > n.clientHeight + 2 || n.scrollWidth > n.clientWidth + 2) && getComputedStyle(n).overflow !== "visible") out.push(`${n.tagName}.${n.className} clips its content`);
    });
    const foot = el.querySelector(".foot")?.getBoundingClientRect();
    if (foot) el.querySelectorAll(".body, .grid2, .grid3, .flow, .card, .code, .shot").forEach((n) => { if (n.getBoundingClientRect().bottom > foot.top - 4) out.push(`${n.tagName}.${n.className} runs into the footer`); });
    return out;
  });
  if (found.length) problems.push({ slide: i + 1, problems: [...new Set(found)].slice(0, 6) });
}
console.log(problems.length ? JSON.stringify(problems, null, 1) : `${slides.length} slides, no layout problems detected`);
await page.pdf({ path: path.join(ROOT, "docs", "deck", "Shortage-Radar-deck.pdf"), width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true });
await browser.close();
