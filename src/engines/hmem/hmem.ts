// Our H-MEM engine, implementing the Meterless H-MEM spec
// (github.com/Meterless/Meterless/tree/main/engines/hmem). Memory that survives
// between sessions: tiered records with source and confidence, hybrid ranked
// recall, an append-only trust ledger, preview-first sleep, approval-gated
// dreaming and conflict resolution that never deletes.
// Storage is grep-able JSONL under .state/hmem/<namespace>/ when a directory is set.
// Verified by the official conformance runner: `npm run conformance:hmem`.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { cosine, embed, extractEntities, inferDomain, jaccard, tokens } from "./text";
import type {
  AddInput, Conflict, DreamProposal, Feedback, Layer, LedgerAction, LedgerEntry, Memory,
  QueryResult, ScoredMemory, SleepPreview, SleepReport,
} from "./types";

const DAY = 24 * 60 * 60 * 1000;
const LAYER_WEIGHT: Record<Layer, number> = { long_term: 1, working: 0.8, short_term: 0.6 };
const OPPOSITES: [string, string][] = [["always", "never"], ["enable", "disable"], ["allow", "deny"], ["prefer", "avoid"], ["use", "do not use"], ["substitute", "do not substitute"], ["approved", "rejected"]];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e9) / 1e9;

export type HMEMOptions = { clock?: () => number; directory?: string; namespace?: string; actor?: string };

export class HMEM {
  private memories = new Map<string, Memory>();
  private entries: LedgerEntry[] = [];
  private proposals: DreamProposal[] = [];
  private openConflicts: Conflict[] = [];
  private backups = new Map<string, Memory[]>();
  private clock: () => number;
  private dir?: string;
  private actor: string;
  private seq = 0;

  constructor(opts: HMEMOptions = {}) {
    this.clock = opts.clock ?? (() => Date.now());
    this.actor = opts.actor ?? "hmem";
    if (opts.directory) {
      this.dir = path.join(opts.directory, opts.namespace ?? "default");
      fs.mkdirSync(this.dir, { recursive: true });
      for (const m of readJsonl<Memory>(path.join(this.dir, "memories.jsonl"))) this.memories.set(m.id, m);
      this.entries = readJsonl<LedgerEntry>(path.join(this.dir, "ledger.jsonl"));
      this.seq = this.entries.at(-1)?.seq ?? 0;
    }
  }

  // ------------------------------------------------------------------ write

  add(input: AddInput): Memory {
    if (!input.source?.trim()) throw new Error("H-MEM: every record needs a source. No source, no write.");
    if (!input.content?.trim()) throw new Error("H-MEM: empty content");
    const now = this.clock();
    const id = `mem_${createHash("sha256").update(`${input.content}|${input.source}|${now}|${this.memories.size}`).digest("hex").slice(0, 12)}`;
    const memory: Memory = {
      id,
      content: input.content,
      type: input.type ?? "general",
      layer: input.layer ?? "working",
      timestamp: now,
      lastAccessed: now,
      accessCount: 0,
      tags: input.tags ?? [],
      embedding: embed(input.content),
      confidence: clamp01(input.confidence ?? 0.7),
      source: input.source,
      provenance: { origin: input.provenance?.origin ?? (input.source === "dreaming" ? "dreaming" : "user"), learnedAt: now, label: input.provenance?.label ?? input.source, refs: input.provenance?.refs },
      domain: input.domain ?? inferDomain(input.content),
      namespace: input.namespace,
      entities: (input.entities ?? extractEntities(input.content)).slice(0, 10),
      relatedTo: [],
      supersedes: input.supersedes,
      derivedFrom: input.derivedFrom,
      data: input.data,
    };
    this.memories.set(id, memory);
    if (input.supersedes && this.memories.has(input.supersedes)) this.mutate(input.supersedes, "update", { supersededBy: id }, { reason: "superseded by newer record" });
    this.log(id, "create", undefined, snapshot(memory));
    this.persist();
    return memory;
  }

  feedback(id: string, kind: Feedback): Memory {
    const m = this.mustGet(id);
    const prev = { confidence: m.confidence, accessCount: m.accessCount, tags: [...m.tags] };
    if (kind === "helpful") {
      m.accessCount += 1;
      m.confidence = round(clamp01(m.confidence + 0.05));
    } else if (kind === "not_helpful") {
      m.confidence = round(clamp01(m.confidence - 0.03));
    } else {
      m.confidence = round(clamp01(m.confidence - 0.2));
      if (!m.tags.includes("review")) m.tags.push("review");
    }
    this.log(id, "feedback", prev, { confidence: m.confidence, accessCount: m.accessCount, tags: [...m.tags] }, { kind });
    this.persist();
    return m;
  }

  // ------------------------------------------------------------------ recall

  /** Canonical hybrid score; score = clamp01(raw) × confidence. Threshold 0.35, top 5 by default. */
  query(q: string, opts: { threshold?: number; topN?: number; tags?: string[]; entities?: string[]; logReads?: boolean } = {}): QueryResult {
    const now = this.clock();
    const qEmb = embed(q);
    const qTokens = tokens(q).slice(0, 8);
    const qDomain = inferDomain(q);
    const qEntities = new Set([...(opts.entities ?? []), ...extractEntities(q).map((e) => e.value)].map((v) => v.toLowerCase()));
    const qTags = new Set([...(opts.tags ?? []), ...qTokens]);

    const scored: ScoredMemory[] = [...this.memories.values()].map((m) => {
      const ents = m.entities.map((e) => e.value.toLowerCase());
      const parts = {
        semantic: Math.max(0, cosine(qEmb, m.embedding)),
        keyword: jaccard(qTokens, tokens(m.content)),
        tag: m.tags.length ? m.tags.filter((t) => qTags.has(t.toLowerCase())).length / m.tags.length : 0,
        domain: qDomain && m.domain === qDomain ? 1 : 0,
        entity: qEntities.size && ents.length ? ents.filter((e) => qEntities.has(e)).length / Math.min(qEntities.size, ents.length) : 0,
        layer: LAYER_WEIGHT[m.layer],
        recency: Math.exp(-(now - m.lastAccessed) / (14 * DAY)),
        superseded: m.supersededBy ? 1 : 0,
      };
      const raw = 0.35 * parts.semantic + 0.2 * parts.keyword + 0.1 * parts.tag + 0.1 * parts.domain + 0.15 * parts.entity + 0.05 * parts.layer + 0.05 * parts.recency - 0.2 * parts.superseded;
      return { memory: m, score: clamp01(raw) * m.confidence, parts };
    });

    const kept = scored.filter((s) => s.score >= (opts.threshold ?? 0.35)).sort((a, b) => b.score - a.score).slice(0, opts.topN ?? 5);
    if (opts.logReads) {
      for (const s of kept) {
        s.memory.lastAccessed = now;
        this.log(s.memory.id, "read", undefined, undefined, { query: q, score: round(s.score) });
      }
      this.persist();
    }
    return { memories: kept, context: reinject(kept), retrievalReason: kept.length ? `${kept.length} memories above threshold for "${q}"` : "no memory above threshold", strategy: kept.length > 2 ? "comprehensive" : "minimal" };
  }

  // ------------------------------------------------------------------ services

  readonly store = {
    get: (id: string) => this.memories.get(id),
    all: () => [...this.memories.values()],
    byTag: (tag: string) => [...this.memories.values()].filter((m) => m.tags.includes(tag)),
  };

  readonly ledger = {
    history: (id: string) => this.entries.filter((e) => e.memoryId === id),
    all: () => [...this.entries],
  };

  readonly sleep = {
    /** Pure: computes what would change, touches nothing. */
    preview: (): SleepPreview => {
      const now = this.clock();
      const all = [...this.memories.values()];
      const currentIds = new Set(all.map((m) => m.supersedes).filter(Boolean) as string[]);
      const hubs = new Set(all.flatMap((m) => m.relatedTo).filter((id, _, arr) => arr.filter((x) => x === id).length >= 3));
      const protectedIds = new Set(all.filter((m) => m.derivedFrom?.length || m.supersedes || currentIds.has(m.id) || hubs.has(m.id) || m.layer === "long_term").map((m) => m.id));
      const age = (m: Memory) => (now - m.lastAccessed) / DAY;
      return {
        toConsolidate: all.filter((m) => m.layer === "short_term" && m.accessCount >= 3).map((m) => m.id),
        toArchive: all.filter((m) => !protectedIds.has(m.id) && age(m) > 30 && m.accessCount < 2).map((m) => m.id),
        toSynthesize: [],
        at: now,
      };
    },
    execute: (preview: SleepPreview): SleepReport => {
      const backupId = `bak_${preview.at}_${this.backups.size + 1}`;
      this.backups.set(backupId, structuredClone([...this.memories.values()]));
      const actions: string[] = [];
      for (const id of preview.toConsolidate) {
        if (!this.memories.has(id)) continue;
        this.mutate(id, "sleep_consolidate", { layer: "long_term" });
        actions.push(`consolidate ${id}`);
      }
      for (const id of preview.toArchive) {
        const m = this.memories.get(id);
        if (!m) continue;
        this.memories.delete(id);
        this.log(id, "sleep_archive", snapshot(m), undefined, { backupId });
        actions.push(`archive ${id}`);
      }
      this.persist();
      return { backupId, consolidated: preview.toConsolidate.length, archived: preview.toArchive.length, synthesized: 0, actions };
    },
    restore: (backupId: string): boolean => {
      const saved = this.backups.get(backupId);
      if (!saved) return false;
      this.memories = new Map(saved.map((m) => [m.id, structuredClone(m)]));
      this.log("*", "restore", undefined, undefined, { backupId });
      this.persist();
      return true;
    },
  };

  readonly dreaming = {
    /** Propose syntheses of related memories of the same type. Nothing is written until approved. */
    dream: (): DreamProposal[] => {
      const groups = new Map<string, Memory[]>();
      for (const m of this.memories.values()) {
        if (m.supersededBy || m.derivedFrom?.length) continue;
        const key = m.type === "preference" ? "preference" : m.entities[0] ? `${m.type}:${m.entities[0].value}` : "";
        if (key) groups.set(key, [...(groups.get(key) ?? []), m]);
      }
      const fresh: DreamProposal[] = [];
      for (const members of groups.values()) {
        if (members.length < 2) continue;
        const sourceIds = members.map((m) => m.id).sort();
        if (this.proposals.some((p) => p.status === "pending" && p.sourceIds.join() === sourceIds.join())) continue;
        const proposal: DreamProposal = { id: `dream_${this.proposals.length + 1}`, kind: "synthesize", type: members[0].type, sourceIds, status: "pending", content: `Standing pattern: ${members.map((m) => m.content.replace(/\.$/, "")).join("; ")}.` };
        this.proposals.push(proposal);
        this.log(proposal.id, "dream_proposed", undefined, undefined, { sourceIds });
        fresh.push(proposal);
      }
      return fresh;
    },
    approve: (proposalId: string): Memory | undefined => {
      const p = this.proposals.find((x) => x.id === proposalId && x.status === "pending");
      if (!p) return undefined;
      p.status = "approved";
      const created = this.add({ content: p.content, type: p.type, layer: "long_term", source: "dreaming", derivedFrom: p.sourceIds, confidence: 0.7, provenance: { origin: "dreaming", label: "approved dream synthesis" } });
      this.log(created.id, "dream_approved", undefined, undefined, { proposalId });
      this.persist();
      return created;
    },
    reject: (proposalId: string): void => {
      const p = this.proposals.find((x) => x.id === proposalId && x.status === "pending");
      if (!p) return;
      p.status = "rejected";
      this.log(p.id, "dream_rejected");
    },
    pending: () => this.proposals.filter((p) => p.status === "pending"),
  };

  readonly conflicts = {
    /** Opposing phrase pairs on otherwise similar content. A supersedes relation suppresses the conflict. */
    scan: (): Conflict[] => {
      const all = [...this.memories.values()].filter((m) => !m.supersededBy);
      const found: Conflict[] = [];
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const [a, b] = [all[i], all[j]];
          if (a.supersedes === b.id || b.supersedes === a.id) continue;
          const pair = opposingPair(a.content, b.content);
          if (!pair) continue;
          const strip = (s: string) => tokens(s.replace(new RegExp(`\\b(${pair.join("|")})\\b`, "gi"), " "));
          const similarity = jaccard(strip(a.content), strip(b.content));
          if (similarity < 0.6) continue;
          const sharedEntity = a.entities.some((e) => b.entities.some((f) => f.value === e.value));
          const confidence = clamp01(0.5 + 0.4 * similarity + (sharedEntity ? 0.1 : 0) + (a.domain && a.domain === b.domain ? 0.05 : 0));
          const conflict: Conflict = { id: `conf_${a.id}_${b.id}`, a: a.id, b: b.id, reason: `opposing "${pair[0]}"/"${pair[1]}" on similar content (${similarity.toFixed(2)})`, confidence, status: "open" };
          if (!this.openConflicts.some((c) => c.id === conflict.id)) {
            this.openConflicts.push(conflict);
            this.log(a.id, "conflict_detected", undefined, undefined, { with: b.id, reason: conflict.reason });
          }
          found.push(conflict);
        }
      }
      return found;
    },
    /** Auto-resolve only at decision confidence >= 0.70; the loser is superseded, never deleted. */
    autoResolve: (conflict: Conflict): "resolved" | "queued" => {
      const a = this.mustGet(conflict.a);
      const b = this.mustGet(conflict.b);
      const trust = (m: Memory) => m.confidence + (m.source === "user_correction" ? 0.3 : 0) + Math.min(m.accessCount, 10) * 0.01 + (m.timestamp / 1e15);
      const [winner, loser] = trust(a) >= trust(b) ? [a, b] : [b, a];
      const decision = clamp01(0.5 + Math.abs(a.confidence - b.confidence) * 0.6 + (winner.source === "user_correction" ? 0.2 : 0));
      if (decision < 0.7) {
        conflict.status = "queued";
        return "queued";
      }
      this.mutate(loser.id, "conflict_resolved", { supersededBy: winner.id }, { winner: winner.id, decision: round(decision), reason: conflict.reason });
      conflict.status = "resolved";
      this.persist();
      return "resolved";
    },
    queue: () => this.openConflicts.filter((c) => c.status !== "resolved"),
  };

  // ------------------------------------------------------------------ internals

  private mustGet(id: string): Memory {
    const m = this.memories.get(id);
    if (!m) throw new Error(`H-MEM: no memory ${id}`);
    return m;
  }

  private mutate(id: string, action: LedgerAction, patch: Partial<Memory>, details?: Record<string, unknown>): void {
    const m = this.mustGet(id);
    const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, (m as Record<string, unknown>)[k]]));
    Object.assign(m, patch);
    this.log(id, action, prev, patch, details);
  }

  private log(memoryId: string, action: LedgerAction, previousState?: Partial<Memory>, newState?: Partial<Memory>, details?: Record<string, unknown>): void {
    const entry: LedgerEntry = { seq: ++this.seq, memoryId, action, actor: this.actor, timestamp: this.clock(), previousState, newState, details };
    this.entries.push(entry);
    if (this.dir) fs.appendFileSync(path.join(this.dir, "ledger.jsonl"), JSON.stringify(entry) + "\n");
  }

  private persist(): void {
    if (!this.dir) return;
    const lines = [...this.memories.values()].map((m) => JSON.stringify({ ...m, embedding: undefined }));
    fs.writeFileSync(path.join(this.dir, "memories.jsonl"), lines.join("\n") + (lines.length ? "\n" : ""));
  }
}

function snapshot(m: Memory): Partial<Memory> {
  const { embedding: _e, ...rest } = m;
  return structuredClone(rest);
}

function opposingPair(a: string, b: string): [string, string] | undefined {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  const has = (s: string, w: string) => new RegExp(`\\b${w}\\b`).test(s);
  for (const [x, y] of OPPOSITES) {
    if ((has(la, x) && has(lb, y) && !has(la, y)) || (has(la, y) && has(lb, x) && !has(lb, y))) return [x, y];
  }
  return undefined;
}

/** Domain-grouped reinjection block, one line per memory with its layer marker and source. */
function reinject(kept: ScoredMemory[]): string {
  if (!kept.length) return "";
  const byDomain = new Map<string, ScoredMemory[]>();
  for (const s of kept) byDomain.set(s.memory.domain ?? "general", [...(byDomain.get(s.memory.domain ?? "general") ?? []), s]);
  return [...byDomain.entries()]
    .map(([domain, items]) => `## ${domain}\n${items.map((s) => `- [${s.memory.layer}] ${s.memory.content} (memory ${s.memory.id}, source ${s.memory.source}, confidence ${s.memory.confidence.toFixed(2)})`).join("\n")}`)
    .join("\n");
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean).map((l) => {
    const row = JSON.parse(l);
    if ("content" in row && !row.embedding) row.embedding = embed(row.content);
    return row as T;
  });
}
