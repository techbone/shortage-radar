// Zetaris adapter: one Lightning SQL statement per call over the REST API.
//   POST {ZETARIS_REST_URL}/sql-editor/sqls/run  { queryId, sql, source, limit }
// Headers: Bearer API key, X-Org-ID, a fresh X-Request-ID per request.
//
// The agent is read-only: only SELECT / WITH / SHOW / DESCRIBE pass unless the
// caller is setup code that passes { admin: true }. This backs up the Scout
// guard's tool_abuse rules (defence in depth).
//
// SAMPLE_MODE=true replays recorded responses from data/fixtures/zetaris/,
// keyed by a hash of the SQL; ZETARIS_RECORD=true records live responses there.

import { createHash, randomUUID } from "node:crypto";
import { isSample } from "./mode";
import fs from "node:fs";
import path from "node:path";

export type QueryResult = {
  queryId: string;
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  ms: number;
  source: "zetaris" | "fixture";
  retries: number;
};

export class ZetarisError extends Error {
  constructor(message: string, public kind: "auth" | "bad-request" | "timeout" | "unreachable" | "rejected" | "sql" | "missing-fixture", public retries = 0) {
    super(message);
  }
}

const FIXTURE_DIR = path.join(process.cwd(), "data", "fixtures", "zetaris");
const TIMEOUT_MS = 60_000;
const READ_ONLY = /^\s*(?:select|with|show|describe|desc)\b/i;

export const sampleMode = isSample;

/** Lightning SQL is one statement per call; reject stacked statements outright. */
export function assertSingleStatement(sql: string): void {
  const body = sql.trim().replace(/;\s*$/, "");
  const withoutStrings = body.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, "''");
  if (withoutStrings.includes(";")) throw new ZetarisError("One statement per call: found more than one SQL statement", "rejected");
}

export function assertReadOnly(sql: string): void {
  if (!READ_ONLY.test(sql)) throw new ZetarisError("The agent may only run SELECT, WITH, SHOW or DESCRIBE", "rejected");
  if (/\b(?:insert|update|delete|merge|drop|truncate|alter|create|grant|cache|uncache|refresh)\b\s/i.test(sql.replace(/'(?:[^']|'')*'/g, "''")) && !/^\s*(?:show|describe|desc)\b/i.test(sql)) {
    throw new ZetarisError("Write or DDL keyword in a read-only query", "rejected");
  }
}

const fixtureKey = (sql: string) => createHash("sha256").update(sql.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 20);

/** Responses come back as rows of arrays or of objects depending on the endpoint; normalize to objects. */
export function toRecords(out: any): { columns: string[]; rows: Record<string, unknown>[] } {
  const data = Array.isArray(out) ? out : out?.data ?? out?.rows ?? out?.result?.data ?? [];
  const declared: string[] =
    out?.headers ??
    out?.columns?.map((c: any) => (typeof c === "string" ? c : c.name ?? c.columnName)) ??
    out?.schema?.map((c: any) => c.name) ??
    out?.metadata?.map((c: any) => c.name ?? c.columnName) ??
    [];
  if (!data.length) return { columns: declared, rows: [] };
  if (!Array.isArray(data[0])) return { columns: declared.length ? declared : Object.keys(data[0]), rows: data };
  const columns = declared.length ? declared : data[0].map((_: unknown, i: number) => `col_${i}`);
  return { columns, rows: data.map((r: unknown[]) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))) };
}

export async function runSql(sql: string, opts: { limit?: number; admin?: boolean; timeoutMs?: number; retries?: number } = {}): Promise<QueryResult> {
  assertSingleStatement(sql);
  if (!opts.admin) assertReadOnly(sql);
  const queryId = `zq_${randomUUID().slice(0, 8)}`;
  const key = fixtureKey(sql);

  if (sampleMode()) {
    const file = path.join(FIXTURE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) throw new ZetarisError(`SAMPLE_MODE: no recorded response for this query (${key})`, "missing-fixture");
    const saved = JSON.parse(fs.readFileSync(file, "utf-8"));
    return { queryId, sql, columns: saved.columns, rows: saved.rows, ms: 0, source: "fixture", retries: 0 };
  }

  const base = (process.env.ZETARIS_REST_URL ?? "http://localhost:8888/api/v1.0").replace(/\/+$/, "");
  const apiKey = process.env.ZETARIS_API_KEY;
  if (!apiKey) throw new ZetarisError("ZETARIS_API_KEY is not set (create one in the Zetaris UI, put it in .env)", "auth");

  const maxRetries = opts.retries ?? 2;
  let lastErr: ZetarisError | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/sql-editor/sqls/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Org-ID": process.env.ZETARIS_ORG_ID ?? "1",
          "X-Request-ID": randomUUID(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ queryId: randomUUID(), sql, source: "SqlEditor", limit: opts.limit ?? 1000 }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      });
      const text = await res.text();
      if (res.status === 401) throw new ZetarisError("Zetaris rejected the API key (401): create a new key and update .env", "auth", attempt);
      if (res.status === 400) throw new ZetarisError(`Zetaris 400: ${text.slice(0, 300)}`, "bad-request", attempt); // a SQL message, or a wrong X-Org-ID
      if (!res.ok) throw new ZetarisError(`Zetaris ${res.status}: ${text.slice(0, 400)}`, res.status >= 500 ? "unreachable" : "sql", attempt);
      const { columns, rows } = toRecords(text ? JSON.parse(text) : null);
      if (process.env.ZETARIS_RECORD === "true") {
        fs.mkdirSync(FIXTURE_DIR, { recursive: true });
        fs.writeFileSync(path.join(FIXTURE_DIR, `${key}.json`), JSON.stringify({ sql, columns, rows }, null, 1));
      }
      return { queryId, sql, columns, rows, ms: Date.now() - t0, source: "zetaris", retries: attempt };
    } catch (err) {
      const e = err instanceof ZetarisError ? err
        : (err as Error).name === "TimeoutError" ? new ZetarisError(`Zetaris did not answer within ${(opts.timeoutMs ?? TIMEOUT_MS) / 1000}s`, "timeout", attempt)
        : new ZetarisError(`Cannot reach Zetaris at ${base}: ${(err as Error).message}`, "unreachable", attempt);
      if (e.kind === "auth" || e.kind === "bad-request" || e.kind === "sql" || attempt === maxRetries) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr!;
}
