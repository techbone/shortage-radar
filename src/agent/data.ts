// The three Zetaris queries behind a sweep. Each is one Lightning SQL statement;
// the federated ones join the hospital's Postgres (northwind_pg) with the openFDA
// REST source (fda.shortages) in a single call.

import { runSql, type QueryResult } from "../adapters/zetaris";
import type { FdaShortageRecord, FdaSnapshot } from "../domain/fda-shortages";

export const FEED_SQL = `SELECT package_ndc, generic_name, company_name, status, availability, presentation, dosage_form,
  update_date, update_type, initial_posting_date, related_info, discontinued_date, therapeutic_category, openfda_json
FROM fda.shortages`;

/** Every formulary line with its stock, and its FDA shortage entry when there is one. */
export const EXPOSURE_SQL = `SELECT f.ndc, f.generic_name, f.form, f.presentation AS our_presentation, f.labeler, f.category, f.critical,
  i.on_hand_units, i.daily_usage_units, i.reorder_point, i.wholesaler,
  s.status AS fda_status, s.availability AS fda_availability, s.update_date AS fda_update_date, s.related_info AS fda_related_info
FROM northwind_pg.formulary_item f
JOIN northwind_pg.inventory i ON i.ndc = f.ndc
LEFT JOIN fda.shortages s ON s.package_ndc = f.ndc AND s.status <> 'To Be Discontinued'`;

/** Other manufacturers' NDCs of the same drug and form that the FDA lists as available. */
export function alternatesSql(ndcs: string[]): string {
  const list = ndcs.map((n) => `'${n.replace(/[^0-9-]/g, "")}'`).join(", ");
  return `SELECT f.ndc AS for_ndc, a.package_ndc AS alt_ndc, a.company_name, a.availability, a.presentation, a.update_date
FROM northwind_pg.formulary_item f
JOIN fda.shortages a ON lower(a.generic_name) LIKE concat(lower(f.generic_name), '%')
  AND lower(a.dosage_form) LIKE concat(lower(f.form), '%')
  AND a.package_ndc <> f.ndc AND a.status = 'Current' AND lower(a.availability) LIKE 'available%'
WHERE f.ndc IN (${list})`;
}

const parseJson = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string" || !v) return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

/** Rows from fda.shortages → the snapshot shape the World Model ingests. */
export function feedToSnapshot(rows: Record<string, unknown>[], lastUpdated: string, queryId: string): FdaSnapshot {
  const results: FdaShortageRecord[] = rows.map((r) => ({
    package_ndc: String(r.package_ndc),
    generic_name: String(r.generic_name ?? ""),
    company_name: String(r.company_name ?? ""),
    status: String(r.status ?? ""),
    availability: (r.availability as string | null) ?? null,
    presentation: String(r.presentation ?? ""),
    dosage_form: (r.dosage_form as string | undefined) ?? undefined,
    therapeutic_category: parseJson<string[]>(r.therapeutic_category, []),
    initial_posting_date: String(r.initial_posting_date ?? ""),
    update_date: String(r.update_date ?? ""),
    update_type: (r.update_type as string | undefined) ?? undefined,
    discontinued_date: (r.discontinued_date as string | undefined) ?? undefined,
    related_info: (r.related_info as string | undefined) ?? undefined,
    openfda: parseJson<FdaShortageRecord["openfda"]>(r.openfda_json, {}),
  }));
  return { meta: { source: `zetaris:fda.shortages (${queryId})`, fetched_at: new Date().toISOString(), last_updated: lastUpdated, total: results.length }, results };
}

export type ExposureRow = {
  ndc: string; generic_name: string; form: string; our_presentation: string; labeler: string; category: string; critical: boolean;
  on_hand_units: number; daily_usage_units: number; reorder_point: number; wholesaler: string;
  fda_status: string | null; fda_availability: string | null; fda_update_date: string | null; fda_related_info: string | null;
};

export function toExposure(rows: Record<string, unknown>[]): ExposureRow[] {
  return rows.map((r) => ({
    ...(r as unknown as ExposureRow),
    critical: r.critical === true || r.critical === "true",
    on_hand_units: Number(r.on_hand_units),
    daily_usage_units: Number(r.daily_usage_units),
    reorder_point: Number(r.reorder_point),
  }));
}

export const queries = {
  feed: (): Promise<QueryResult> => runSql(FEED_SQL, { limit: 5000 }),
  exposure: (): Promise<QueryResult> => runSql(EXPOSURE_SQL, { limit: 5000 }),
  alternates: (ndcs: string[]): Promise<QueryResult> => runSql(alternatesSql(ndcs), { limit: 5000 }),
};
