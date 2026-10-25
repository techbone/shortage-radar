// Register Shortage Radar's sources in Zetaris: runs zetaris/*.sql in order,
// one statement per call. Statements that already exist are reported and skipped,
// so the script is safe to re-run.
//   npm run zetaris:setup            (all files)
//   npm run zetaris:setup -- 01      (files whose name starts with 01)

import fs from "node:fs";
import path from "node:path";
import { runSql } from "../src/adapters/zetaris";

const dir = path.join(process.cwd(), "zetaris");
const only = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && (!only || f.startsWith(only))).sort();

/** Split on semicolons that end a statement, ignoring comments and quoted text. */
export function statements(sql: string): string[] {
  const clean = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of clean) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let failed = 0;
for (const file of files) {
  console.log(`[INFO] ${file}`);
  for (const stmt of statements(fs.readFileSync(path.join(dir, file), "utf-8"))) {
    const label = stmt.replace(/\s+/g, " ").slice(0, 80);
    try {
      const r = await runSql(stmt, { admin: true, timeoutMs: 180_000, retries: 0 });
      console.log(`  OK   ${label} (${r.ms} ms)`);
    } catch (err) {
      const msg = (err as Error).message;
      if (/already exist/i.test(msg)) {
        console.log(`  SKIP ${label} (already exists)`);
        continue;
      }
      failed++;
      console.log(`  FAIL ${label}\n       ${msg.slice(0, 300)}`);
    }
  }
}
process.exit(failed ? 1 : 0);
