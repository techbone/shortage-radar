// Run one Lightning SQL statement against Zetaris and print the rows (dev helper).
//   npm run zq -- "SELECT COUNT(*) FROM fda.shortages"
import { runSql } from "../src/adapters/zetaris";

const sql = process.argv.slice(2).join(" ");
try {
  const r = await runSql(sql, { admin: true, timeoutMs: 300_000, retries: 0 });
  console.log(`[INFO] ${r.ms} ms · ${r.rows.length} rows · ${r.columns.join(", ")}`);
  console.table(r.rows.slice(0, 25));
} catch (err) {
  console.log(`[ERROR] ${(err as Error).message.slice(0, 600)}`);
  process.exit(1);
}
