// Lightweight, deterministic text features for retrieval: no model call.
// The embedding is a hashed bag of words and bigrams (256 dims, L2-normalized),
// enough to rank a pharmacy's few hundred memories; swap in a real embedder later.

import { createHash } from "node:crypto";

const STOP = new Set("a an and are as at be by do does for from has have how i in is it its of on or our that the this to was we what when where which who why will with you your".split(" "));
const DIMS = 256;

export function tokens(text: string): string[] {
  return text.toLowerCase().normalize("NFKC").replace(/[^a-z0-9\-\s]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
}

function bucket(feature: string): number {
  return createHash("md5").update(feature).digest().readUInt16BE(0) % DIMS;
}

export function embed(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  const t = tokens(text);
  t.forEach((tok, i) => {
    v[bucket(tok)] += 1;
    if (tok.length > 4) v[bucket(tok.slice(0, 5))] += 0.5; // cheap stemming: "deploys" ~ "deploy"
    if (i > 0) v[bucket(`${t[i - 1]}_${tok}`)] += 0.5;
  });
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export const cosine = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** NDCs and drug-ish words become entities; good enough to link decisions to products. */
export function extractEntities(text: string): { type: string; value: string }[] {
  const out = new Map<string, { type: string; value: string }>();
  for (const m of text.matchAll(/\b\d{4,5}-\d{3,4}-\d{1,2}\b/g)) out.set(`ndc:${m[0]}`, { type: "ndc", value: m[0] });
  return [...out.values()].slice(0, 10);
}

const DOMAINS: Record<string, string[]> = {
  pharmacy: ["ndc", "vial", "injection", "formulary", "shortage", "substitute", "supplier", "wholesaler", "order", "stock", "dose", "mg", "ml"],
  engineering: ["deploy", "api", "docker", "code", "build", "release", "server"],
};

export function inferDomain(text: string): string | undefined {
  const t = new Set(tokens(text));
  let best: [string, number] | undefined;
  for (const [d, words] of Object.entries(DOMAINS)) {
    const hits = words.filter((w) => t.has(w)).length;
    if (hits && (!best || hits > best[1])) best = [d, hits];
  }
  return best?.[0];
}
