// Our World Model engine, implementing the Meterless World Model spec
// (github.com/Meterless/Meterless/tree/main/engines/world-model).
// Event-sourced, file-backed, single writer. Verified by the official
// conformance runner: `npm run conformance:wm`.

import { canonicalJson, entityIdFromName, externalId, relationshipId, sha256Hex } from "./ids";
import { decide, nameSimilarity } from "./resolve";
import { EventStore, edgeSlot, resolveIn, type FoldedState } from "./store";
import type {
  AuditEntry, Entity, IngestObservation, IngestReport, MergeProposal, Provenance,
  Relationship, StoredProvenance, WorldModelOptions,
} from "./types";

type UpsertEntityInput = {
  type: string;
  externalKey?: { system: string; id: string };
  name?: string;
  attrs?: Record<string, unknown>;
  state?: Entity["state"];
  source: Provenance | undefined;
};

type RelateInput = {
  from: string;
  type: string;
  to: string;
  context?: string;
  attrs?: Record<string, unknown>;
  validFrom?: string;
  source: Provenance | undefined;
};

export class WorldModel {
  private store: EventStore;
  private opts: WorldModelOptions;
  private clock: () => Date;
  private lock: Promise<unknown> = Promise.resolve();
  private merges: MergeProposal[] = [];

  constructor(opts: WorldModelOptions) {
    if (!opts?.namespace) throw new Error("WorldModel: namespace is required");
    this.opts = opts;
    this.clock = opts.clock ?? (() => new Date());
    this.store = new EventStore(opts.namespace, opts.storage ?? "memory", opts.directory);
  }

  // ------------------------------------------------------------------ writes

  /** Single-writer queue: every write runs after the previous one and flushes once. */
  private write<T>(fn: () => T): Promise<T> {
    const next = this.lock.then(() => {
      try {
        return fn();
      } finally {
        this.store.flush();
      }
    });
    this.lock = next.catch(() => undefined);
    return next;
  }

  upsertEntity(input: UpsertEntityInput): Promise<Entity> {
    return this.write(() => this.upsertEntitySync(input));
  }

  relate(input: RelateInput): Promise<Relationship> {
    return this.write(() => this.relateSync(input));
  }

  /** Run several writes as one queued batch with one flush (used by domain ingest). */
  batch<T>(fn: (tx: { upsertEntity: (i: UpsertEntityInput) => Entity; relate: (i: RelateInput) => Relationship }) => T): Promise<T> {
    return this.write(() => fn({ upsertEntity: (i) => this.upsertEntitySync(i), relate: (i) => this.relateSync(i) }));
  }

  private upsertEntitySync(input: UpsertEntityInput): Entity {
    const source = requireProvenance(input.source);
    const name = input.name ?? (input.attrs?.name as string | undefined);
    let id = input.externalKey
      ? externalId(input.type, input.externalKey.system, input.externalKey.id)
      : entityIdFromName(input.type, mustName(name));

    if (!input.externalKey && name && !this.store.state.entities.has(id)) id = this.resolveName(id, input.type, name, source);

    const existing = this.store.state.entities.get(this.store.resolveAlias(id));
    if (existing && isUnchanged(existing, input, name)) return existing; // same facts again: no event

    const entity: Entity = {
      id: this.store.resolveAlias(id),
      type: input.type,
      name,
      aliases: name ? [name] : [],
      attrs: { ...(input.attrs ?? {}) },
      state: input.state ?? existing?.state ?? "active",
      source,
      createdAt: existing?.createdAt ?? source.at,
      updatedAt: source.at,
    };
    this.store.append({ kind: "upsertEntity", at: source.at, payload: entity });
    this.store.logAudit({ at: source.at, kind: "upsertEntity", actor: source.by ?? source.kind, summary: `${entity.id} (${input.type})`, runId: source.runId });
    return this.store.state.entities.get(entity.id)!;
  }

  /** Name-keyed entities: near-duplicates of the same type auto-merge or queue for review. */
  private resolveName(id: string, type: string, name: string, source: StoredProvenance): string {
    for (const other of this.store.state.entities.values()) {
      if (other.type !== type || other.id === id || !other.name) continue;
      const similarity = nameSimilarity(name, other.name);
      const decision = decide(similarity, this.opts.autoMergeAt, this.opts.reviewAt);
      if (decision === "auto-merge") {
        this.store.append({ kind: "alias", at: source.at, payload: { aliasId: id, primaryId: other.id, reason: `similarity ${similarity.toFixed(3)}`, at: source.at } });
        this.store.logAudit({ at: source.at, kind: "auto-merge", actor: "resolver", summary: `${name} → ${other.name} (${similarity.toFixed(3)})` });
        return other.id;
      }
      if (decision === "review" && !this.merges.some((m) => m.leftId === id && m.rightId === other.id)) {
        this.merges.push({ id: `merge_${this.merges.length + 1}`, leftId: id, rightId: other.id, similarity, status: "pending", proposedAt: source.at });
        this.store.logAudit({ at: source.at, kind: "merge-proposed", actor: "resolver", summary: `${name} ~ ${other.name} (${similarity.toFixed(3)})` });
      }
    }
    return id;
  }

  private relateSync(input: RelateInput): Relationship {
    const source = requireProvenance(input.source);
    const from = this.store.resolveAlias(input.from);
    const to = this.store.resolveAlias(input.to);
    const openId = this.store.state.openEdges.get(edgeSlot(from, input.type, input.context));
    const open = openId ? this.store.state.relationships.get(openId) : undefined;
    if (open && open.to === to) return open; // unchanged: no event, empty diff

    const validFrom = input.validFrom ?? source.at;
    const id = relationshipId(from, input.type, to, input.context, validFrom);
    const existing = this.store.state.relationships.get(id);
    if (existing) return existing; // content-addressed no-op

    const rel: Relationship = { id, from, type: input.type, to, context: input.context, attrs: input.attrs, validFrom, source, createdAt: source.at };
    this.store.append({ kind: "relate", at: source.at, payload: rel });
    this.store.logAudit({ at: source.at, kind: "relate", actor: source.by ?? source.kind, summary: `${from} -[${input.type}]-> ${to}`, runId: source.runId });
    return this.store.state.relationships.get(id)!;
  }

  // ------------------------------------------------------------------ ingest

  /**
   * Generic observation ingest (spec §4.3). Idempotent: an observation whose
   * checksum is already stored is skipped, so re-running a batch is an empty diff.
   */
  ingest(observations: IngestObservation[]): Promise<IngestReport> {
    return this.write(() => {
      const runId = `run_${sha256Hex(canonicalJson(observations.map((o) => o.externalId))).slice(0, 12)}`;
      const before = this.stateShapeCanonical();
      const eventsBefore = this.store.events.length;
      let processed = 0;
      let skipped = 0;

      for (const obs of observations) {
        const checksum = sha256Hex(canonicalJson({ externalId: obs.externalId, title: obs.title, text: obs.text ?? "", at: obs.at, entities: obs.entities ?? [] }));
        if (this.store.state.observations.get(obs.externalId)?.checksum === checksum) {
          skipped++;
          continue;
        }
        const source: Provenance = { ...obs.source, at: obs.at, runId };
        const type = obs.type ?? "item";
        const item = this.upsertEntitySync({ type, externalKey: { system: "ingest", id: obs.externalId }, name: obs.title, attrs: { title: obs.title, text: obs.text }, source });
        for (const mention of obs.entities ?? []) {
          const mentioned = this.upsertEntitySync({ type: mention.type, name: mention.name, source });
          this.relateSync({ from: item.id, type: "mentions", to: mentioned.id, context: mentioned.id, source });
        }
        this.store.append({ kind: "observation", at: obs.at, payload: { externalId: obs.externalId, entityId: item.id, checksum, at: obs.at } });
        processed++;
      }

      this.store.logAudit({ at: observations[0]?.at ?? this.clock().toISOString(), kind: "ingest", actor: "pipeline", summary: `${runId}: ${processed} processed, ${skipped} skipped`, runId });
      return { runId, processed, skippedUnchanged: skipped, eventsAppended: this.store.events.length - eventsBefore, changed: before !== this.stateShapeCanonical() };
    });
  }

  // ------------------------------------------------------------------ reads

  view(name: "graph"): GraphView;
  view(name: "snapshot"): SnapshotView;
  view(name: string): GraphView | SnapshotView {
    if (name === "graph") return new GraphView(this.store.state);
    if (name === "snapshot") return new SnapshotView(this.store);
    throw new Error(`World Model: unknown view "${name}"`);
  }

  entity(id: string): Entity | undefined {
    return this.store.state.entities.get(this.store.resolveAlias(id));
  }

  entities(type?: string): Entity[] {
    return [...this.store.state.entities.values()].filter((e) => !type || e.type === type);
  }

  /** The currently open edge in a slot, if any. */
  openEdge(from: string, type: string, context?: string): Relationship | undefined {
    const id = this.store.state.openEdges.get(edgeSlot(this.store.resolveAlias(from), type, context));
    return id ? this.store.state.relationships.get(id) : undefined;
  }

  /** Every edge ever written for (from, type), oldest first: the status history. */
  history(from: string, type: string): Relationship[] {
    const id = this.store.resolveAlias(from);
    return [...this.store.state.relationships.values()]
      .filter((r) => r.from === id && r.type === type)
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.createdAt.localeCompare(b.createdAt));
  }

  mergeQueue(): readonly MergeProposal[] {
    return this.merges;
  }

  audit(): readonly AuditEntry[] {
    return this.store.audit;
  }

  eventCount(): number {
    return this.store.events.length;
  }

  stateShapeCanonical(): string {
    const s = this.store.state;
    const sorted = <T extends { id?: string; externalId?: string }>(m: Map<string, T>) =>
      [...m.values()].sort((a, b) => (a.id ?? a.externalId ?? "").localeCompare(b.id ?? b.externalId ?? ""));
    return canonicalJson({ entities: sorted(s.entities), relationships: sorted(s.relationships), observations: sorted(s.observations) });
  }
}

class GraphView {
  constructor(private state: FoldedState) {}

  /** Neighbours over edges open now, or valid at `at` (validFrom <= at < validTo). */
  neighborsOf(id: string, opts?: { via?: string; at?: string }): Entity[] {
    const rid = resolveIn(this.state, id);
    const out = new Map<string, Entity>();
    for (const rel of this.state.relationships.values()) {
      if (opts?.via && rel.type !== opts.via) continue;
      if (opts?.at ? !validAt(rel, opts.at) : rel.validTo) continue;
      const other = rel.from === rid ? rel.to : rel.to === rid ? rel.from : undefined;
      const entity = other ? this.state.entities.get(other) : undefined;
      if (entity) out.set(entity.id, entity);
    }
    return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

class SnapshotView {
  constructor(private store: EventStore) {}

  /** An entity as it was at `at`, replayed from the log. */
  entityAt(id: string, at: string): Entity | undefined {
    const state = this.store.foldUntil(at.length === 10 ? `${at}T23:59:59.999Z` : at);
    return state.entities.get(resolveIn(state, id));
  }
}

function isUnchanged(existing: Entity, input: UpsertEntityInput, name: string | undefined): boolean {
  const merged = { ...existing.attrs, ...(input.attrs ?? {}) };
  return (
    existing.type === input.type &&
    (name === undefined || name === existing.name) &&
    (input.state === undefined || input.state === existing.state) &&
    canonicalJson(merged) === canonicalJson(existing.attrs)
  );
}

const validAt = (rel: Relationship, at: string): boolean => rel.validFrom <= at && (!rel.validTo || at < rel.validTo);

function requireProvenance(source: Provenance | undefined): StoredProvenance {
  if (!source?.kind || source.at === undefined) throw new Error("World Model: every write carries provenance (kind + at). No provenance, no write.");
  return { ...source, at: source.at instanceof Date ? source.at.toISOString() : source.at };
}

function mustName(name: string | undefined): string {
  if (!name) throw new Error("World Model: name-keyed entities need a name (or an externalKey)");
  return name;
}
