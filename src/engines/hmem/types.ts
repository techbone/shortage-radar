// Memory record shapes for our H-MEM engine (Meterless spec, AGENTS.md §2).

export type MemoryType = "personal" | "factual" | "preference" | "general";
export type Layer = "short_term" | "working" | "long_term";
export type Origin = "user" | "agent" | "dreaming" | "import" | "system";

export type Memory = {
  id: string;
  content: string;
  type: MemoryType;
  layer: Layer;
  timestamp: number;
  lastAccessed: number;
  accessCount: number;
  tags: string[];
  embedding: number[];
  confidence: number;
  /** mandatory: a record with no source is rejected */
  source: string;
  provenance: { origin: Origin; learnedAt: number; label: string; refs?: string[] };
  domain?: string;
  namespace?: string;
  entities: { type: string; value: string }[];
  relatedTo: string[];
  supersedes?: string;
  supersededBy?: string;
  derivedFrom?: string[];
  /** free-form structured payload (e.g. a buyer decision); never used for ranking */
  data?: Record<string, unknown>;
};

export type AddInput = {
  content: string;
  source: string;
  type?: MemoryType;
  layer?: Layer;
  confidence?: number;
  tags?: string[];
  entities?: { type: string; value: string }[];
  derivedFrom?: string[];
  supersedes?: string;
  domain?: string;
  namespace?: string;
  provenance?: Partial<Memory["provenance"]>;
  data?: Record<string, unknown>;
};

export type ScoredMemory = {
  memory: Memory;
  score: number;
  parts: { semantic: number; keyword: number; tag: number; domain: number; entity: number; layer: number; recency: number; superseded: number };
};

export type QueryResult = {
  memories: ScoredMemory[];
  /** the reinjection block for a prompt (domain-grouped, layer-marked) */
  context: string;
  retrievalReason: string;
  strategy: "minimal" | "comprehensive";
};

export type LedgerAction =
  | "create" | "read" | "update" | "delete" | "feedback" | "promote" | "demote" | "merge"
  | "conflict_detected" | "conflict_resolved" | "sleep_consolidate" | "sleep_archive" | "sleep_synthesize"
  | "dream_proposed" | "dream_approved" | "dream_rejected" | "restore";

export type LedgerEntry = {
  seq: number;
  memoryId: string;
  action: LedgerAction;
  actor: string;
  timestamp: number;
  previousState?: Partial<Memory>;
  newState?: Partial<Memory>;
  details?: Record<string, unknown>;
};

export type Feedback = "helpful" | "not_helpful" | "wrong";

export type SleepPreview = { toConsolidate: string[]; toArchive: string[]; toSynthesize: string[][]; at: number };
export type SleepReport = { backupId: string; consolidated: number; archived: number; synthesized: number; actions: string[] };

export type DreamProposal = { id: string; kind: "synthesize"; content: string; type: MemoryType; sourceIds: string[]; status: "pending" | "approved" | "rejected" };

export type Conflict = { id: string; a: string; b: string; reason: string; confidence: number; status: "open" | "resolved" | "queued" };
