// Planner and Writer prompts, model-output parsing, and the Critic.
// The Critic is code, not a model: it checks every claim the Writer makes against
// the evidence the Investigator gathered. A recommended NDC must come from the
// same-concentration swap list; a citation must name a real evidence record;
// a day count must match the stock data.

import type { Match } from "../domain/alternates";
import type { ShortageState } from "../domain/fda-shortages";

export type Direction = "worse" | "better" | "new" | "cleared";

export type Evidence = { id: string; kind: "zetaris" | "world-model" | "hmem"; label: string; queryId?: string; record: Record<string, unknown> };

export type Item = {
  ndc: string;
  generic: string;
  presentation: string;
  category: string;
  critical: boolean;
  wholesaler: string;
  onHand: number;
  dailyUsage: number;
  daysOnHand: number;
  state: ShortageState;
  change?: { from: ShortageState | null; to: ShortageState; at: string; direction: Direction };
  history: { state: ShortageState; validFrom: string; validTo: string | null }[];
  handling: { status: "new" | "handled" | "changed-since-decision"; memoryId?: string; summary?: string };
  swaps: Match[];
  review: Match[];
  fdaNote?: string;
  evidence: Evidence[];
  priorityScore: number;
};

export type BriefItem = {
  ndc: string;
  priority: "act-today" | "this-week" | "watch" | "good-news";
  headline: string;
  why: string;
  action: string;
  buy_instead: string | null;
  citations: string[];
};

export type Brief = { headline: string; summary: string; items: BriefItem[] };

const SEVERITY: Record<ShortageState, number> = { unavailable: 5, limited: 4, listed: 3, "to-be-discontinued": 2, available: 1, resolved: 0, "off-list": 0 };

export function direction(from: ShortageState | null, to: ShortageState): Direction {
  if (from === null) return "new";
  if (to === "off-list" || to === "resolved") return "cleared";
  return SEVERITY[to] > SEVERITY[from] ? "worse" : "better";
}

/** Deterministic priority: what changed, how bad it is now, how long the stock lasts, how critical the drug is. */
export function priorityScore(i: Pick<Item, "state" | "change" | "daysOnHand" | "critical" | "handling">): number {
  const runway = i.daysOnHand <= 3 ? 30 : i.daysOnHand <= 7 ? 20 : i.daysOnHand <= 14 ? 8 : 0;
  const changed = i.change ? (i.change.direction === "worse" || i.change.direction === "new" ? 25 : 5) : 0;
  const handled = i.handling.status === "handled" ? -40 : i.handling.status === "changed-since-decision" ? 10 : 0;
  return SEVERITY[i.state] * 6 + runway + changed + (i.critical ? 10 : 0) + handled;
}

// ------------------------------------------------------------------ prompts

export const PLANNER_SYSTEM = `You are the Planner in Shortage Radar, an agent for a hospital pharmacy buyer.
You receive the buyer's request and a table of formulary items touched by the FDA drug shortage list.
The table is already in priority order (what changed, how bad, days of stock, how critical).
Keep that order unless the request asks for something narrower (a category, a drug, "only what got better").
Never drop an item that is unavailable or limited with 7 days or less, especially one with no listed alternate:
those are the ones the buyer must hear about. Skip items marked handled unless their status changed since the decision.
Never predict future shortages. Reply with JSON only:
{"focus": ["<ndc>", ...], "rationale": "<one or two sentences>"}`;

export const WRITER_SYSTEM = `You are the Writer in Shortage Radar. Write one item of a morning brief for a hospital pharmacy buyer.
Rules:
- Use only the evidence provided. "citations" lists evidence ids from the item's evidence list.
- "buy_instead" must be one NDC from swap_options, or null. Never invent or alter an NDC.
- State days on hand exactly as given. Never give a reason for the shortage unless fda_note states one.
- If fda_note gives a next delivery or estimated recovery, you may say "the manufacturer reports ..." with that date.
- Do not predict future shortages or say a drug "will" run out.
- Plain words a buyer uses. One short sentence per field.
- priority: act-today (unavailable or limited with 7 days or less), this-week, watch, good-news (got better or cleared).
Reply with JSON only:
{"ndc": "...", "priority": "...", "headline": "...", "why": "...", "action": "...", "buy_instead": "<ndc or null>", "citations": ["<evidence id>", ...]}`;

export const SUMMARY_SYSTEM = `You are the Writer in Shortage Radar. Given the items of a morning brief, write a two-sentence
summary for the buyer: what needs action today first, then anything that improved. Do not add facts. Do not predict shortages.
Reply with JSON only: {"summary": "..."}`;

/** The compact, model-facing view of an item: no prompt-irrelevant fields, evidence ids inline. */
export function itemForWriter(i: Item) {
  return {
    ndc: i.ndc,
    drug: i.generic,
    product: i.presentation,
    category: i.category,
    critical: i.critical,
    fda_state_now: i.state,
    change: i.change ? { from: i.change.from ?? "not listed", to: i.change.to, fda_date: i.change.at.slice(0, 10) } : null,
    days_on_hand: i.daysOnHand,
    on_hand_units: i.onHand,
    daily_usage_units: i.dailyUsage,
    buyer_decision: i.handling.status === "new" ? null : { status: i.handling.status, summary: i.handling.summary },
    swap_options: i.swaps.slice(0, 3).map((s) => ({ ndc: s.ndc, company: s.company, why_it_matches: s.reason })),
    needs_pharmacist_review: i.review.slice(0, 2).map((s) => ({ ndc: s.ndc, company: s.company, reason: s.reason })),
    fda_note: i.fdaNote ?? null,
    evidence: i.evidence.map((e) => ({ id: e.id, what: e.label })),
  };
}

// ------------------------------------------------------------------ parsing

/** Pull the JSON object out of a model reply (fences, stray prose, think tags). */
export function parseJsonReply<T>(text: string): T {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model reply");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

// ------------------------------------------------------------------ critic

export type Violation = { ndc: string; rule: string; detail: string };

const CAUSE = /\b(?:manufactur\w*|production|delay\w*|demand|recall\w*|raw material|quality|discontinu\w*|backorder\w*|supply chain|regulatory)\b/i;
const PREDICTION = /\b(?:will (?:run out|go short|become (?:unavailable|scarce))|predict(?:s|ed|ion)?|forecast(?:s|ed)?|is expected to (?:run out|go short))\b/i;

export function critique(brief: Brief, items: Item[]): Violation[] {
  const byNdc = new Map(items.map((i) => [i.ndc, i]));
  const out: Violation[] = [];
  const seen = new Set<string>();
  for (const b of brief.items ?? []) {
    const item = byNdc.get(b.ndc);
    if (!item) {
      out.push({ ndc: b.ndc, rule: "unknown-item", detail: "this NDC is not one of the items to cover" });
      continue;
    }
    seen.add(b.ndc);
    const ids = new Set(item.evidence.map((e) => e.id));
    if (!b.citations?.length) out.push({ ndc: b.ndc, rule: "no-citation", detail: "every item needs at least one evidence id" });
    for (const c of b.citations ?? []) if (!ids.has(c)) out.push({ ndc: b.ndc, rule: "bad-citation", detail: `"${c}" is not in this item's evidence list` });
    if (b.buy_instead && item.swaps.some((s) => s.ndc === b.buy_instead) && !b.citations?.includes(`alt:${b.buy_instead}`)) {
      out.push({ ndc: b.ndc, rule: "uncited-swap", detail: `buy_instead ${b.buy_instead} must cite alt:${b.buy_instead}` });
    }
    if (b.buy_instead && !item.swaps.some((s) => s.ndc === b.buy_instead)) {
      out.push({ ndc: b.ndc, rule: "unsafe-swap", detail: `buy_instead ${b.buy_instead} is not a same-concentration swap option (allowed: ${item.swaps.map((s) => s.ndc).join(", ") || "none"})` });
    }
    const text = `${b.headline} ${b.why} ${b.action}`;
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*days?\b/gi)) {
      const n = Number(m[1]);
      if (Math.abs(n - item.daysOnHand) > 0.5 && !/reorder|within|next|every|per|past|last|ago/i.test(text.slice(Math.max(0, m.index! - 25), m.index!))) {
        out.push({ ndc: b.ndc, rule: "wrong-days", detail: `says ${m[0]} but days on hand is ${item.daysOnHand}` });
      }
    }
    if (PREDICTION.test(text)) out.push({ ndc: b.ndc, rule: "prediction", detail: "do not predict shortages; report the current state" });
    const cause = text.match(CAUSE)?.[0];
    if (cause && !CAUSE.test(item.fdaNote ?? "")) out.push({ ndc: b.ndc, rule: "unsupported-cause", detail: `gives a cause ("${cause}") that the FDA note does not state` });
  }
  for (const i of items) if (!seen.has(i.ndc)) out.push({ ndc: i.ndc, rule: "missing-item", detail: "this item must be covered" });
  return out;
}

/** Plain, deterministic text for an item the Writer could not get right. */
export function fallbackItem(i: Item): BriefItem {
  const swap = i.swaps[0];
  const changed = i.change ? `FDA moved it from ${i.change.from ?? "not listed"} to ${i.change.to}. ` : "";
  const priority: BriefItem["priority"] =
    i.change && (i.change.direction === "better" || i.change.direction === "cleared") ? "good-news"
    : (i.state === "unavailable" || i.state === "limited") && i.daysOnHand <= 7 ? "act-today"
    : i.state === "unavailable" || i.state === "limited" ? "this-week" : "watch";
  return {
    ndc: i.ndc,
    priority,
    headline: `${cap(i.generic)}: ${i.state}, ${i.daysOnHand} days on hand`,
    why: `${changed}${i.onHand} units on hand at ${i.dailyUsage} a day.`,
    action: swap ? `Buy instead: ${swap.company} NDC ${swap.ndc} (${swap.reason}).` : i.review.length ? "No same-concentration swap listed; pharmacist to review other strengths." : "No listed alternate; check with the wholesaler.",
    buy_instead: swap?.ndc ?? null,
    citations: [...i.evidence.slice(0, 3).map((e) => e.id), ...(swap ? [`alt:${swap.ndc}`] : [])],
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
