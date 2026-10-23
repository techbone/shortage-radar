// Record shapes for our World Model engine (Meterless spec, AGENTS.md §2).
// State is a fold over an append-only event log; everything else is derived.

export type ISODate = string;

/** Every write carries provenance. No provenance, no write. */
export type Provenance = {
  kind: "manual" | "api" | "file" | "agent" | "pipeline" | "zetaris" | (string & {});
  by?: string;
  /** observation time; record timestamps derive from this, never from the wall clock */
  at: ISODate | Date;
  url?: string;
  runId?: string;
};

export type StoredProvenance = Omit<Provenance, "at"> & { at: ISODate };

export type Entity = {
  id: string;
  type: string;
  name?: string;
  aliases: string[];
  attrs: Record<string, unknown>;
  state: "emerging" | "active" | "archived";
  source: StoredProvenance;
  createdAt: ISODate;
  updatedAt: ISODate;
};

/** Bitemporal edge. A superseding edge closes the old one (sets validTo); nothing is deleted. */
export type Relationship = {
  id: string;
  from: string;
  type: string;
  to: string;
  context?: string;
  attrs?: Record<string, unknown>;
  validFrom: ISODate;
  validTo?: ISODate;
  supersededBy?: string;
  source: StoredProvenance;
  createdAt: ISODate;
};

export type Alias = { aliasId: string; primaryId: string; reason: string; at: ISODate };

export type ObservationRecord = { externalId: string; entityId: string; checksum: string; at: ISODate };

export type WorldEvent =
  | { seq: number; at: ISODate; kind: "upsertEntity"; payload: Entity }
  | { seq: number; at: ISODate; kind: "relate"; payload: Relationship }
  | { seq: number; at: ISODate; kind: "alias"; payload: Alias }
  | { seq: number; at: ISODate; kind: "observation"; payload: ObservationRecord };

export type AuditEntry = { seq: number; at: ISODate; kind: string; actor: string; summary: string; runId?: string };

export type MergeProposal = {
  id: string;
  leftId: string;
  rightId: string;
  similarity: number;
  status: "pending" | "approved" | "rejected";
  proposedAt: ISODate;
};

/** A raw observation for the generic ingest cycle (spec §4.3). */
export type IngestObservation = {
  externalId: string;
  type?: string;
  title: string;
  text?: string;
  at: ISODate;
  source: Provenance;
  entities?: { type: string; name: string }[];
};

export type IngestReport = {
  runId: string;
  processed: number;
  skippedUnchanged: number;
  eventsAppended: number;
  changed: boolean;
};

export type WorldModelOptions = {
  namespace: string;
  /** "memory" keeps state in-process; "local" appends to <directory>/<namespace>/events.jsonl */
  storage?: "memory" | "local";
  directory?: string;
  /** only for genuinely-now operator actions; record times come from provenance */
  clock?: () => Date;
  autoMergeAt?: number;
  reviewAt?: number;
};
