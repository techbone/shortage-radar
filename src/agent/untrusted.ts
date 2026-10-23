// Every piece of untrusted text (Zetaris rows from public APIs, FDA free text,
// hospital rows, recalled memories, the buyer's own question) passes through
// Scout's guard before it can reach a model. The prompt builder only accepts a
// GuardedContext, and only this module can create one.

import { Scout, type Flag, type Redaction } from "../engines/scout-intent";

declare const guarded: unique symbol;

export type UntrustedText = { text: string; source: string };

export type Withheld = { source: string; rule: string; kind: string; evidence: string };

export type GuardedContext = {
  readonly [guarded]: true;
  readonly blocks: readonly { source: string; text: string; warned: boolean }[];
  readonly withheld: readonly Withheld[];
  readonly redactions: readonly Redaction[];
  readonly flags: readonly Flag[];
};

/** Snippets come from outside our control, so the tight pack applies: warn-level rules block. */
export const scout = new Scout({ policyPack: ["default", "adversarial-tight"] });

export function guardContext(items: UntrustedText[], engine: Scout = scout): GuardedContext {
  const result = engine.guardSync({ prompt: "", surface: "api", snippets: items });
  const withheld: Withheld[] = [];
  const blocks = result.snippets.flatMap((s) => {
    if (s.verdict !== "withheld") return [{ source: s.source, text: s.text, warned: s.verdict === "warn" }];
    const f = s.flags.find((x) => x.severity === "block")!;
    withheld.push({ source: s.source, rule: f.rule, kind: f.kind, evidence: f.evidence[0] ?? "" });
    return [];
  });
  return { blocks, withheld, redactions: result.redactions, flags: result.flags } as unknown as GuardedContext;
}

export type Row = Record<string, unknown>;
export const WITHHELD = "[withheld: suspected prompt injection]";

/**
 * Guard every text field of query rows. Numbers, booleans and nulls pass through;
 * a poisoned text field is replaced, the rest of the row survives. Withholding the
 * field (not the run) keeps one poisoned record from blanking the whole brief.
 */
export function guardRows(rows: Row[], opts: { table: string; key: string }, engine: Scout = scout): { rows: Row[]; context: GuardedContext } {
  const items: UntrustedText[] = [];
  const at: { row: number; col: string }[] = [];
  rows.forEach((row, i) => {
    for (const [col, value] of Object.entries(row)) {
      if (typeof value !== "string" || !value.trim()) continue;
      items.push({ text: value, source: `zetaris:${opts.table}.${col}:${String(row[opts.key] ?? i)}` });
      at.push({ row: i, col });
    }
  });
  const context = guardContext(items, engine);
  const bySource = new Map(context.blocks.map((b) => [b.source, b.text]));
  const out = rows.map((r) => ({ ...r }));
  items.forEach((item, idx) => {
    const { row, col } = at[idx];
    out[row][col] = bySource.get(item.source) ?? WITHHELD;
  });
  return { rows: out, context };
}
