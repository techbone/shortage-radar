// FDA drug shortage snapshots → World Model.
//
// One product entity per package NDC, linked to its company and ingredients.
// Two bitemporal edge slots per product:
//   shortage-state   → unavailable | limited | available | listed | resolved | off-list
//   discontinuation  → to-be-discontinued | off-list
// Two slots because the feed lists some NDCs twice (e.g. "Current" and "To Be Discontinued").
// Re-ingesting a snapshot appends nothing; a later snapshot appends only what moved.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { normalizeName, type Provenance, type WorldModel } from "../engines/world-model";

export type FdaShortageRecord = {
  package_ndc: string;
  generic_name: string;
  company_name: string;
  status: "Current" | "To Be Discontinued" | "Resolved" | (string & {});
  availability?: string | null;
  presentation: string;
  dosage_form?: string;
  therapeutic_category?: string[];
  initial_posting_date: string;
  update_date: string;
  update_type?: string;
  discontinued_date?: string;
  related_info?: string;
  openfda?: { rxcui?: string[]; substance_name?: string[]; route?: string[]; product_ndc?: string[]; brand_name?: string[] };
};

export type FdaSnapshot = {
  meta: { source: string; fetched_at: string; last_updated: string; total: number; license?: string };
  results: FdaShortageRecord[];
};

export type ShortageState = "unavailable" | "limited" | "available" | "listed" | "resolved" | "to-be-discontinued" | "off-list";
export type EdgeSlot = "shortage-state" | "discontinuation";

export type ShortageChange = {
  ndc: string;
  productId: string;
  slot: EdgeSlot;
  from: ShortageState | null;
  to: ShortageState;
  at: string;
  generic: string;
  company: string;
  presentation: string;
  rxcui: string[];
};

export type SnapshotIngestReport = {
  snapshot: string;
  baseline: boolean;
  products: number;
  eventsAppended: number;
  changes: ShortageChange[];
};

export const SNAPSHOT_DIR = path.join(process.cwd(), "data", "snapshots");

export function listSnapshots(dir = SNAPSHOT_DIR): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^fda-shortages-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

export function loadSnapshot(file: string): FdaSnapshot {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf-8")) as FdaSnapshot;
}

export const productId = (ndc: string): string => `product:ndc:${ndc}`;
const stateId = (state: ShortageState): string => `state:fda:${state}`;

export function shortageStateOf(r: FdaShortageRecord): ShortageState {
  if (r.status === "Resolved") return "resolved";
  const a = (r.availability ?? "").toLowerCase();
  if (a.startsWith("unav") || a.startsWith("unv")) return "unavailable"; // the feed also spells it "Unvailable"
  if (a.startsWith("limited")) return "limited";
  if (a.startsWith("available")) return "available";
  return "listed";
}

/** "08/03/2026" → "2026-08-03T00:00:00.000Z" */
export function fdaDate(mdy: string | undefined): string | undefined {
  const m = mdy?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}T00:00:00.000Z` : undefined;
}

export async function ingestShortageSnapshot(world: WorldModel, snap: FdaSnapshot): Promise<SnapshotIngestReport> {
  const snapshotAt = `${snap.meta.last_updated}T00:00:00.000Z`;
  const source: Provenance = { kind: "api", by: "fda-shortage-sync", url: snap.meta.source, at: snapshotAt, runId: `fda@${snap.meta.last_updated}` };
  const baseline = world.entities("product").length === 0;
  const eventsBefore = world.eventCount();

  const byNdc = new Map<string, { shortage?: FdaShortageRecord; discontinuation?: FdaShortageRecord }>();
  for (const r of snap.results) {
    const slot = byNdc.get(r.package_ndc) ?? {};
    if (r.status === "To Be Discontinued") slot.discontinuation = latest(slot.discontinuation, r);
    else slot.shortage = latest(slot.shortage, r);
    byNdc.set(r.package_ndc, slot);
  }

  const changes = await world.batch((tx) => {
    const out: ShortageChange[] = [];
    for (const s of ["unavailable", "limited", "available", "listed", "resolved", "to-be-discontinued", "off-list"] as ShortageState[]) {
      tx.upsertEntity({ type: "state", externalKey: { system: "fda", id: s }, name: s, source });
    }

    const move = (pid: string, slot: EdgeSlot, to: ShortageState, validFrom: string, r: Pick<ShortageChange, "ndc" | "generic" | "company" | "presentation" | "rxcui">) => {
      const open = world.openEdge(pid, slot);
      const from = open ? (open.to.split(":").pop() as ShortageState) : null;
      if (from === to) return;
      if (from === null && to === "off-list") return;
      // FDA's own update date when it is newer than what we hold; otherwise the snapshot date.
      const at = !open || validFrom > open.validFrom ? validFrom : snapshotAt;
      tx.relate({ from: pid, type: slot, to: stateId(to), validFrom: at, source });
      out.push({ ...r, productId: pid, slot, from, to, at });
    };

    for (const [ndc, { shortage, discontinuation }] of byNdc) {
      const r = (shortage ?? discontinuation)!;
      const pid = productId(ndc);
      const rxcui = [...new Set([...(shortage?.openfda?.rxcui ?? []), ...(discontinuation?.openfda?.rxcui ?? [])])].sort();
      const substances = r.openfda?.substance_name?.length ? r.openfda.substance_name : [r.generic_name.split(/[,;]/)[0]];

      tx.upsertEntity({
        type: "product",
        externalKey: { system: "ndc", id: ndc },
        name: r.presentation,
        attrs: {
          ndc,
          productNdc: r.openfda?.product_ndc?.[0] ?? ndc.split("-").slice(0, 2).join("-"),
          generic: r.generic_name,
          company: r.company_name,
          presentation: r.presentation,
          dosageForm: r.dosage_form ?? null,
          route: r.openfda?.route ?? [],
          categories: r.therapeutic_category ?? [],
          rxcui,
          substances: substances.map(normalizeName).sort(),
          relatedInfo: shortage?.related_info ?? discontinuation?.related_info ?? null,
          fdaUpdated: r.update_date,
          discontinuedDate: discontinuation?.discontinued_date ?? null,
        },
        source,
      });

      const company = tx.upsertEntity({ type: "company", externalKey: { system: "fda", id: normalizeName(r.company_name) }, name: r.company_name, source });
      tx.relate({ from: pid, type: "made-by", to: company.id, source, validFrom: snapshotAt });
      for (const name of substances) {
        const ing = tx.upsertEntity({ type: "ingredient", externalKey: { system: "substance", id: normalizeName(name) }, name: normalizeName(name), source });
        tx.relate({ from: pid, type: "contains", to: ing.id, context: ing.id, source, validFrom: snapshotAt });
      }

      const info = { ndc, generic: r.generic_name, company: r.company_name, presentation: r.presentation, rxcui };
      if (shortage) move(pid, "shortage-state", shortageStateOf(shortage), fdaDate(shortage.update_date) ?? snapshotAt, info);
      else move(pid, "shortage-state", "off-list", snapshotAt, info);
      if (discontinuation) move(pid, "discontinuation", "to-be-discontinued", fdaDate(discontinuation.update_date) ?? snapshotAt, info);
      else move(pid, "discontinuation", "off-list", snapshotAt, info);
    }

    // Products we hold that the feed no longer lists came off the list.
    for (const p of world.entities("product")) {
      const ndc = String(p.attrs.ndc);
      if (byNdc.has(ndc)) continue;
      const info = { ndc, generic: String(p.attrs.generic), company: String(p.attrs.company), presentation: String(p.attrs.presentation), rxcui: (p.attrs.rxcui as string[]) ?? [] };
      move(p.id, "shortage-state", "off-list", snapshotAt, info);
      move(p.id, "discontinuation", "off-list", snapshotAt, info);
    }
    return out;
  });

  return { snapshot: snap.meta.last_updated, baseline, products: byNdc.size, eventsAppended: world.eventCount() - eventsBefore, changes };
}

/** The product's shortage-state history, oldest first: [{ state, from, to }] */
export function stateHistory(world: WorldModel, ndc: string, slot: EdgeSlot = "shortage-state") {
  return world.history(productId(ndc), slot).map((e) => ({ state: e.to.split(":").pop() as ShortageState, validFrom: e.validFrom, validTo: e.validTo ?? null, source: e.source.runId }));
}

function latest(a: FdaShortageRecord | undefined, b: FdaShortageRecord): FdaShortageRecord {
  if (!a) return b;
  return (fdaDate(b.update_date) ?? "") > (fdaDate(a.update_date) ?? "") ? b : a;
}
