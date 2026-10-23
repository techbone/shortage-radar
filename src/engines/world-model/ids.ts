// Stable, content-derived ids (Meterless World Model, docs/stable-ids.md).
// Same input, same id, on every machine and every replay.

import { createHash } from "node:crypto";

export const sha256Hex = (input: string): string => createHash("sha256").update(input).digest("hex");

/** Deterministic JSON: sorted keys, undefined members dropped. Idempotency diffs depend on it. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * NFKD → strip combining marks and zero-width chars → lowercase → collapse whitespace.
 * Never abbreviates or stems: "Acme Corp" and "Acme Corporation" stay different.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[​-‍﻿]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const externalId = (type: string, system: string, id: string): string => `${type}:${system}:${id}`;

export const entityIdFromName = (type: string, name: string): string =>
  `ent_${sha256Hex(`${type}:${normalizeName(name)}`).slice(0, 16)}`;

export const relationshipId = (from: string, type: string, to: string, context = "", validFrom = ""): string =>
  `rel_${sha256Hex(`${from}|${type}|${to}|${context}|${validFrom}`).slice(0, 16)}`;
