// Re-fetch the openFDA feed into Zetaris's cached REST tables, then check Zetaris holds every entry.
// The feed is registered as two 1,000-row pages (zetaris/01_fda_shortages.sql); this fails loudly if openFDA
// ever lists more than the pages cover, rather than letting rows go missing.
//   npm run zetaris:refresh

import { runSql } from "../src/adapters/zetaris";

const admin = { admin: true, timeoutMs: 300_000, retries: 0 } as const;
for (const page of ["shortages_p0", "shortages_p1"]) {
  await runSql(`UNCACHE TABLE fda_rest.${page}`, admin);
  const r = await runSql(`CACHE TABLE fda_rest.${page}`, admin);
  console.log(`[INFO] fda_rest.${page} re-cached (${r.ms} ms)`);
}

const meta = (await (await fetch("https://api.fda.gov/drug/shortages.json?limit=1", { signal: AbortSignal.timeout(30_000) })).json()) as { meta: { last_updated: string; results: { total: number } } };
const inZetaris = Number((await runSql("SELECT COUNT(*) AS n FROM fda.shortages", admin)).rows[0].n);
const total = meta.meta.results.total;
console.log(`[INFO] openFDA last_updated ${meta.meta.last_updated}: ${total} entries; Zetaris fda.shortages: ${inZetaris} rows`);
if (inZetaris !== total) {
  console.error(`[ERROR] Zetaris has ${inZetaris} of ${total} entries. If openFDA now lists more than 2,000, add a third page to zetaris/01_fda_shortages.sql.`);
  process.exit(1);
}
