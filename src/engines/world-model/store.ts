// Event-sourced canonical store. The log is append-only JSONL on disk
// (one line per event), replayed on load; state is the fold of the log.
// Writes are buffered and flushed once per public operation, so ingesting a
// 1,600-record snapshot is one file append, not 10,000 rewrites.

import fs from "node:fs";
import path from "node:path";
import type { Alias, AuditEntry, Entity, ObservationRecord, Relationship, WorldEvent } from "./types";

export type FoldedState = {
  entities: Map<string, Entity>;
  relationships: Map<string, Relationship>;
  aliases: Map<string, string>;
  observations: Map<string, ObservationRecord>;
  /** `${from}|${type}|${context}` → id of the open edge (validTo unset) */
  openEdges: Map<string, string>;
};

const emptyState = (): FoldedState => ({
  entities: new Map(),
  relationships: new Map(),
  aliases: new Map(),
  observations: new Map(),
  openEdges: new Map(),
});

export const edgeSlot = (from: string, type: string, context?: string): string => `${from}|${type}|${context ?? ""}`;

type NewEvent = WorldEvent extends infer E ? (E extends WorldEvent ? Omit<E, "seq"> : never) : never;

export class EventStore {
  events: WorldEvent[] = [];
  audit: AuditEntry[] = [];
  state: FoldedState = emptyState();
  private pendingEvents: WorldEvent[] = [];
  private pendingAudit: AuditEntry[] = [];
  private dir?: string;

  constructor(namespace: string, storage: "memory" | "local", directory?: string) {
    if (storage !== "local") return;
    this.dir = path.join(directory ?? path.join(process.cwd(), ".state", "world"), namespace);
    fs.mkdirSync(this.dir, { recursive: true });
    for (const e of readJsonl<WorldEvent>(path.join(this.dir, "events.jsonl"))) {
      this.events.push(e);
      fold(this.state, e);
    }
    this.audit = readJsonl<AuditEntry>(path.join(this.dir, "audit.jsonl"));
  }

  append(event: NewEvent): WorldEvent {
    const full = { ...event, seq: this.events.length + 1 } as WorldEvent;
    this.events.push(full);
    this.pendingEvents.push(full);
    fold(this.state, full);
    return full;
  }

  logAudit(entry: Omit<AuditEntry, "seq">): void {
    const full = { ...entry, seq: this.audit.length + 1 };
    this.audit.push(full);
    this.pendingAudit.push(full);
  }

  flush(): void {
    if (this.dir) {
      appendJsonl(path.join(this.dir, "events.jsonl"), this.pendingEvents);
      appendJsonl(path.join(this.dir, "audit.jsonl"), this.pendingAudit);
    }
    this.pendingEvents = [];
    this.pendingAudit = [];
  }

  resolveAlias(id: string): string {
    return resolveIn(this.state, id);
  }

  /** Replay the log up to and including `at`: the world as it was then. */
  foldUntil(at: string): FoldedState {
    const scratch = emptyState();
    for (const e of this.events) if (e.at <= at) fold(scratch, e);
    return scratch;
  }
}

export function resolveIn(state: FoldedState, id: string): string {
  let cur = id;
  const seen = new Set<string>();
  while (state.aliases.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = state.aliases.get(cur)!;
  }
  return cur;
}

function fold(state: FoldedState, event: WorldEvent): void {
  switch (event.kind) {
    case "upsertEntity": {
      const e = event.payload;
      const existing = state.entities.get(e.id);
      if (!existing) {
        state.entities.set(e.id, structuredClone(e));
        break;
      }
      existing.attrs = { ...existing.attrs, ...e.attrs };
      existing.updatedAt = e.updatedAt;
      existing.source = e.source;
      existing.state = e.state;
      if (e.name) {
        existing.name = e.name;
        if (!existing.aliases.includes(e.name)) existing.aliases.push(e.name);
      }
      break;
    }
    case "relate": {
      const r = event.payload;
      if (state.relationships.has(r.id)) break;
      // A new edge in the same slot with a different target closes the open one.
      const slot = edgeSlot(r.from, r.type, r.context);
      const openId = state.openEdges.get(slot);
      const open = openId ? state.relationships.get(openId) : undefined;
      if (open && open.to !== r.to) {
        open.validTo = r.validFrom;
        open.supersededBy = r.id;
      }
      state.relationships.set(r.id, structuredClone(r));
      if (!r.validTo && (!open || open.to !== r.to)) state.openEdges.set(slot, r.id);
      break;
    }
    case "alias": {
      const a: Alias = event.payload;
      state.aliases.set(a.aliasId, a.primaryId);
      break;
    }
    case "observation":
      state.observations.set(event.payload.externalId, structuredClone(event.payload));
      break;
  }
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function appendJsonl(file: string, rows: unknown[]): void {
  if (rows.length) fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
}
