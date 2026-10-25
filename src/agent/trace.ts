// Run trace: one JSON object per line in logs/trace-<run_id>.jsonl (the hackathon
// guide's format, plus query ids, SQL and engine fields) and a readable stdout line.
// Secrets never reach either: values that look like keys or tokens are masked.

import fs from "node:fs";
import path from "node:path";

export type TraceEvent = {
  agent_name: string;
  action: string;
  input_summary?: string;
  output_summary?: string;
  target_agent?: string;
  model?: string;
  engine?: "zetaris" | "world-model" | "hmem" | "scout-intent" | "nightshift";
  query_id?: string;
  sql?: string;
  rows?: number;
  ms?: number;
  confidence?: number;
  retry_count?: number;
  status: "success" | "error" | "warning" | "skipped";
  details?: Record<string, unknown>;
};

const SECRETISH = [/nvapi-[\w-]+/g, /\b(?:sk|rk)-[\w-]{16,}/g, /\bBearer\s+[\w.~+/-]{16,}/gi, /\b[a-f0-9]{40,}\b/gi];

export function mask(text: string): string {
  return SECRETISH.reduce((t, re) => t.replace(re, "…redacted"), text);
}

export class Tracer {
  readonly file: string;
  readonly events: (TraceEvent & { timestamp: string; run_id: string })[] = [];

  constructor(readonly runId: string, private quiet = false) {
    const dir = path.join(process.cwd(), "logs");
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `trace-${runId}.jsonl`);
    fs.writeFileSync(this.file, "");
  }

  log(e: TraceEvent): void {
    const event = { timestamp: new Date().toISOString(), run_id: this.runId, ...e };
    const line = mask(JSON.stringify(event));
    this.events.push(JSON.parse(line));
    fs.appendFileSync(this.file, line + "\n");
    if (this.quiet) return;
    const level = e.status === "error" ? "ERROR" : e.status === "warning" ? "WARN" : "INFO";
    const bits = [e.output_summary ?? e.input_summary ?? "", e.model ? `(model: ${e.model})` : "", e.ms !== undefined ? `${e.ms} ms` : ""].filter(Boolean).join(" ");
    console.log(mask(`[${level}] run_id=${this.runId} ${e.agent_name} ${e.action}${e.target_agent ? ` → ${e.target_agent}` : ""}: ${bits}`));
  }
}
