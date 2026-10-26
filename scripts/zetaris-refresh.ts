// Re-fetch the openFDA feed into Zetaris's cached REST tables, then check Zetaris holds every entry.
// The feed is registered as two 1,000-row pages (zetaris/01_fda_shortages.sql); this fails loudly if openFDA
// ever lists more than the pages cover, rather than letting rows go missing.
//   npm run zetaris:refresh

import { runSql } from "../src/adapters/zetaris";

const admin = { admin: true, timeoutMs: 300_000, retries: 0 } as const;
// An uncached page makes every query call openFDA live, so keep retrying the re-cache rather than leave it dropped.
for (const page of ["shortages_p0", "shortages_p1"]) {
  await runSql(`UNCACHE TABLE fda_rest.${page}`, admin);
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await runSql(`CACHE TABLE fda_rest.${page}`, admin);
      console.log(`[INFO] fda_rest.${page} re-cached (${r.ms} ms)`);
      break;
    } catch (err) {
      if (attempt === 5) throw err;
      console.warn(`[WARN] re-caching fda_rest.${page} failed (${(err as Error).message.slice(0, 80)}), retry ${attempt}/4 in 60 s`);
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
}

const meta = (await (await fetch("https://api.fda.gov/drug/shortages.json?limit=1", { signal: AbortSignal.timeout(30_000) })).json()) as { meta: { last_updated: string; results: { total: number } } };
const inZetaris = Number((await runSql("SELECT COUNT(*) AS n FROM fda.shortages", admin)).rows[0].n);
const total = meta.meta.results.total;
console.log(`[INFO] openFDA last_updated ${meta.meta.last_updated}: ${total} entries; Zetaris fda.shortages: ${inZetaris} rows`);
if (inZetaris !== total) {
  console.error(`[ERROR] Zetaris has ${inZetaris} of ${total} entries. If openFDA now lists more than 2,000, add a third page to zetaris/01_fda_shortages.sql.`);
  process.exit(1);
}
