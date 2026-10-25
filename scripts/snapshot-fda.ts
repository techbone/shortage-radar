// Fetch today's FDA drug shortage feed into data/snapshots/ (gzipped JSON).
// Skips when a snapshot for the feed's last_updated date already exists.
//   npm run snapshot

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { SNAPSHOT_DIR, listSnapshots, loadSnapshot, type FdaShortageRecord } from "../src/domain/fda-shortages";

const BASE = "https://api.fda.gov/drug/shortages.json";
const PAGE = 1000;

async function getPage(skip: number, attempt = 1): Promise<{ meta: any; results: FdaShortageRecord[] }> {
  const key = process.env.OPENFDA_API_KEY ? `&api_key=${process.env.OPENFDA_API_KEY}` : "";
  try {
    const res = await fetch(`${BASE}?limit=${PAGE}&skip=${skip}${key}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`openFDA ${res.status}`);
    return (await res.json()) as { meta: any; results: FdaShortageRecord[] };
  } catch (err) {
    if (attempt >= 3) throw err;
    console.log(`[WARN] page skip=${skip} failed (${(err as Error).message}), retry ${attempt}/2`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return getPage(skip, attempt + 1);
  }
}

const first = await getPage(0);
const total: number = first.meta.results.total;
const lastUpdated: string = first.meta.last_updated;
let file = path.join(SNAPSHOT_DIR, `fda-shortages-${lastUpdated}.json.gz`);

const results = [...first.results];
for (let skip = PAGE; skip < total; skip += PAGE) results.push(...(await getPage(skip)).results);
if (results.length !== total) throw new Error(`expected ${total} records, got ${results.length}`);

// openFDA revises records in place without bumping last_updated, so compare content, not the date.
const digest = (rs: FdaShortageRecord[]) => createHash("sha256").update(JSON.stringify([...rs].sort((a, b) => (a.package_ndc + a.status).localeCompare(b.package_ndc + b.status)))).digest("hex");
const sameDay = listSnapshots().filter((f) => path.basename(f).startsWith(`fda-shortages-${lastUpdated}`));
const newest = sameDay.at(-1);
if (newest && digest(loadSnapshot(newest).results) === digest(results)) {
  console.log(`[INFO] feed unchanged since ${path.relative(process.cwd(), newest)}`);
  process.exit(0);
}
if (newest) {
  const hhmm = new Date().toISOString().slice(11, 16).replace(":", "");
  file = path.join(SNAPSHOT_DIR, `fda-shortages-${lastUpdated}-${hhmm}z.json.gz`);
  console.log(`[INFO] same last_updated (${lastUpdated}) but the content changed: saving a same-day revision`);
}

const meta = { source: BASE, fetched_at: new Date().toISOString(), last_updated: lastUpdated, total, license: first.meta.license };
fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ meta, results })));
console.log(`[INFO] saved ${total} records for ${lastUpdated} → ${path.relative(process.cwd(), file)}`);
