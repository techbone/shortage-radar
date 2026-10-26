// One sweep: Ingest → Diff → Match → Alternatives → Brief → Critique.
// Code gathers facts through Zetaris, the World Model, H-MEM and the Scout guard;
// Nemotron (through Nightshift) plans and writes; code critiques every claim.

import path from "node:path";
import { randomUUID } from "node:crypto";
import { chat, fixtureScope, loadSettings, MeterlessError } from "../adapters/meterless";
import { isSample, modeScope } from "../adapters/mode";
import { ZetarisError, type QueryResult } from "../adapters/zetaris";
import { HMEM } from "../engines/hmem";
import { WorldModel } from "../engines/world-model";
import { rankAlternates, type Candidate } from "../domain/alternates";
import { handlingFor, recordDecision, type DecisionInput } from "../domain/decisions";
import fs from "node:fs";
import os from "node:os";
import {
  ingestShortageSnapshot, listSnapshots, loadSnapshot, shortageStateOf, stateHistory,
  type FdaShortageRecord, type ShortageChange, type ShortageState,
} from "../domain/fda-shortages";
import {
  PLANNER_SYSTEM, SUMMARY_SYSTEM, WRITER_SYSTEM, critique, direction, fallbackItem, itemForWriter, parseJsonReply, priorityScore,
  type Brief, type BriefItem, type Evidence, type Item,
} from "./brief";
import { feedToSnapshot, queries, toExposure, type ExposureRow } from "./data";
import { buildMessages } from "./prompt";
import { Tracer } from "./trace";
import { guardContext, guardRows } from "./untrusted";

export type RunInput = {
  run_id?: string;
  input: { query?: string };
  /** buyer decisions to record in H-MEM before the sweep (what the UI's buttons send) */
  decisions?: DecisionInput[];
  options?: { sample_mode?: boolean; max_items?: number; quiet?: boolean; /** default true: replay a recorded run if live services are unreachable */ fallback?: boolean; /** sample mode: replay the exact model replies recorded for this example run (e.g. "example-1") */ replay_of?: string };
};

export type RunOutput = {
  run_id: string;
  status: "success" | "partial" | "error";
  output?: {
    summary: string;
    headline: string;
    fda_update: { date: string | null; changes: number; hit_your_shelf: number };
    recommendations: (BriefItem & { generic: string; fda_state: ShortageState; days_on_hand: number; on_hand_units: number; daily_usage_units: number; swaps: Item["swaps"]; review: Item["review"]; history: Item["history"]; handling: Item["handling"]; evidence: Evidence[]; written_by: string })[];
    quiet: { handled: { ndc: string; generic: string; summary?: string }[]; still_listed: number };
    artifacts: string[];
  };
  error?: { type: string; message: string; recoverable: boolean };
  /** set when a live run could not reach Zetaris or Nightshift and this result is a replay of a recorded run */
  fallback?: { from: "live"; to: "sample"; reason: string };
  agents: { name: string; role: string }[];
  models: string[];
  trace_id: string;
  log_file: string;
  execution_time_seconds: number;
};

const AGENTS = [
  { name: "Planner", role: "Nemotron: reads the request and what changed, picks the items to cover" },
  { name: "Investigator", role: "Code: Zetaris queries, World Model history, H-MEM decisions, alternates" },
  { name: "Guard", role: "Scout Intent: screens every third-party text before a model sees it" },
  { name: "Writer", role: "Nemotron: writes the brief with a citation for every claim" },
  { name: "Critic", role: "Code: rejects invented NDCs, bad citations, wrong day counts, predictions" },
];
const RUN_BUDGET_MS = 5 * 60_000;
const MAX_CRITIC_LOOPS = 2;

export async function runSweep(req: RunInput, opts: { onTrace?: (e: unknown) => void } = {}): Promise<RunOutput> {
  const runId = req.run_id ?? `run-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`;
  const sample = req.options?.sample_mode ?? isSample();
  const tracer = new Tracer(runId, req.options?.quiet, opts.onTrace as never, sample);
  const t0 = Date.now();
  const models = new Set<string>();
  const base = { run_id: runId, agents: AGENTS, trace_id: `trace-${runId}${sample ? "-sample" : ""}`, log_file: path.relative(process.cwd(), tracer.file) };
  tracer.log({ agent_name: "Orchestrator", action: "start", input_summary: req.input.query || "morning sweep", status: "success", details: { sample_mode: sample } });

  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`run exceeded ${RUN_BUDGET_MS / 1000}s`)), RUN_BUDGET_MS);
  });
  try {
    const output = await Promise.race([modeScope.run({ sample }, () => fixtureScope.run(req.options?.replay_of ?? runId, () => sweep(req, tracer, models))), budget]);
    const status = output.recommendations.some((r) => r.written_by === "fallback") ? "partial" : "success";
    tracer.log({ agent_name: "Orchestrator", action: "complete", output_summary: `${output.recommendations.length} items in the brief, ${status}`, ms: Date.now() - t0, status: "success" });
    return { ...base, status, output, models: [...models], execution_time_seconds: secs(t0) };
  } catch (err) {
    const e = err as Error;
    const type = err instanceof ZetarisError ? `Zetaris:${err.kind}` : err instanceof MeterlessError ? `Nightshift:${err.status}` : /exceeded/.test(e.message) ? "Timeout" : "Error";
    tracer.log({ agent_name: "Orchestrator", action: "error", output_summary: e.message.slice(0, 300), status: "error" });
    // Zetaris or Nightshift unreachable on a live run: show a recorded run instead of nothing, and say so.
    const upstream = /^(Zetaris:(unreachable|timeout|auth)|Nightshift:(offline|unauthorized)|Timeout)$/.test(type);
    if (!sample && upstream && req.options?.fallback !== false) {
      tracer.log({ agent_name: "Orchestrator", action: "fallback", output_summary: `${type}: ${e.message.slice(0, 160)}. Replaying the recorded run instead.`, status: "warning" });
      const replay = await runSweep({ ...req, options: { ...req.options, sample_mode: true, fallback: false } }, opts);
      if (replay.status !== "error") {
        return { ...replay, status: "partial", fallback: { from: "live", to: "sample", reason: `${type}: ${e.message.slice(0, 200)}` } };
      }
    }
    return { ...base, status: "error", error: { type, message: e.message, recoverable: type !== "Error" }, models: [...models], execution_time_seconds: secs(t0) };
  } finally {
    clearTimeout(timer);
  }
}

async function sweep(req: RunInput, tracer: Tracer, models: Set<string>): Promise<NonNullable<RunOutput["output"]>> {
  const q = (label: string, r: QueryResult) =>
    tracer.log({ agent_name: "Investigator", action: `zetaris:${label}`, engine: "zetaris", query_id: r.queryId, sql: r.sql.replace(/\s+/g, " "), rows: r.rows.length, ms: r.ms, output_summary: `${r.rows.length} rows (${r.source})`, status: "success" });

  // ---- Ingest: rebuild the World Model from saved FDA snapshots, then today's feed via Zetaris.
  const world = new WorldModel({ namespace: "sweep" });
  const reports: Awaited<ReturnType<typeof ingestShortageSnapshot>>[] = [];
  for (const file of snapshotsForRun()) reports.push(await ingestShortageSnapshot(world, loadSnapshot(file)));
  const feed = await queries.feed();
  q("fda-feed", feed);
  const today = isSample() ? reports.at(-1)!.snapshot : new Date().toISOString().slice(0, 10);
  reports.push(await ingestShortageSnapshot(world, feedToSnapshot(feed.rows, today, feed.queryId)));
  tracer.log({ agent_name: "Investigator", action: "world-model:ingest", engine: "world-model", output_summary: `${reports.length} feeds replayed, ${world.eventCount()} events; today's Zetaris feed added ${reports.at(-1)!.changes.length} changes`, status: "success" });

  // ---- Diff: the latest FDA update that changed anything (same-day revisions merged).
  const changeDate = [...reports].reverse().find((r) => r.changes.length && !r.baseline)?.snapshot ?? null;
  const latest = new Map<string, ShortageChange & { firstFrom: ShortageState | null }>();
  for (const r of reports) {
    if (r.baseline || r.snapshot !== changeDate) continue;
    for (const c of r.changes) {
      if (c.slot !== "shortage-state") continue;
      const prev = latest.get(c.ndc);
      latest.set(c.ndc, { ...c, firstFrom: prev ? prev.firstFrom : c.from });
    }
  }
  tracer.log({ agent_name: "Investigator", action: "world-model:diff", engine: "world-model", output_summary: `FDA update ${changeDate ?? "none"}: ${latest.size} NDCs changed status`, status: "success" });

  // ---- Match: the hospital's formulary and stock against the FDA list, one federated query.
  const exposureQ = await queries.exposure();
  q("exposure", exposureQ);
  const guardedExposure = guardRows(exposureQ.rows, { table: "exposure", key: "ndc" });
  logGuard(tracer, guardedExposure.context.withheld.length, exposureQ.rows.length);
  const exposure = toExposure(guardedExposure.rows);

  // Live runs remember across sessions; sample mode uses a throwaway store so every judge sees the same result.
  const hmemDir = isSample() ? fs.mkdtempSync(path.join(os.tmpdir(), "radar-hmem-")) : path.join(process.cwd(), ".state", "hmem");
  const hmem = new HMEM({ directory: hmemDir, namespace: "northwind", actor: "investigator", clock: isSample() ? () => Date.parse("2026-10-25T08:00:00Z") : undefined });
  for (const d of req.decisions ?? []) {
    if (hmem.store.byTag("decision").some((x) => !x.supersededBy && (x.data as DecisionInput | undefined)?.ndc === d.ndc && (x.data as DecisionInput).action === d.action && (x.data as DecisionInput).stateAtDecision === d.stateAtDecision)) continue; // the UI resends its decisions on every run
    const m = recordDecision(hmem, d);
    tracer.log({ agent_name: "Investigator", action: "hmem:remember", engine: "hmem", output_summary: `buyer decision stored as ${m.id}: ${m.content}`, status: "success" });
  }
  const candidates: Item[] = [];
  const handled: { ndc: string; generic: string; summary?: string }[] = [];
  let stillListed = 0;
  for (const row of exposure) {
    const wmState = currentState(world, row.ndc);
    const change = latest.get(row.ndc);
    if (!change && (!wmState || wmState === "off-list" || wmState === "available" || wmState === "resolved")) continue;
    const state = wmState ?? "off-list";
    const handling = handlingFor(hmem, row.ndc, state);
    const days = row.daily_usage_units > 0 ? Math.round((row.on_hand_units / row.daily_usage_units) * 10) / 10 : 999;
    const item: Item = {
      ndc: row.ndc, generic: row.generic_name, presentation: row.our_presentation, category: row.category, critical: row.critical,
      wholesaler: row.wholesaler, onHand: row.on_hand_units, dailyUsage: row.daily_usage_units, daysOnHand: days, state,
      change: change ? { from: change.firstFrom, to: change.to, at: change.at, direction: direction(change.firstFrom, change.to) } : undefined,
      history: stateHistory(world, row.ndc).map(({ state: s, validFrom, validTo }) => ({ state: s, validFrom, validTo })),
      handling: handling.status === "new" ? { status: "new" } : { status: handling.status, memoryId: handling.decision.id, summary: handling.decision.content },
      swaps: [], review: [], fdaNote: row.fda_related_info ?? undefined, evidence: [], priorityScore: 0,
    };
    item.priorityScore = priorityScore(item);
    if (handling.status === "handled") {
      handled.push({ ndc: row.ndc, generic: row.generic_name, summary: handling.decision.content });
      tracer.log({ agent_name: "Investigator", action: "hmem:handled", engine: "hmem", output_summary: `${row.generic_name} ${row.ndc} already handled (memory ${handling.decision.id}); kept out of the brief`, status: "success" });
      continue;
    }
    if (!change) stillListed++;
    candidates.push(item);
  }
  candidates.sort((a, b) => b.priorityScore - a.priorityScore);
  tracer.log({ agent_name: "Investigator", action: "match", output_summary: `${exposure.length} formulary lines checked; ${candidates.length} need attention (${latest.size ? [...latest.keys()].filter((n) => candidates.some((c) => c.ndc === n)).length : 0} changed in the latest update), ${handled.length} handled`, status: "success" });

  // ---- Plan: Nemotron picks the focus, honouring the buyer's request.
  const maxItems = req.options?.max_items ?? 6;
  const focus = await plan(req.input.query ?? "", candidates, maxItems, tracer, models);
  const items = focus.map((ndc) => candidates.find((c) => c.ndc === ndc)!);

  // ---- Alternatives: same drug, same concentration, from manufacturers the FDA lists as available.
  if (items.length) {
    // Asked for every formulary NDC, not just the chosen items: a fixed query that does not change with the plan or with what the buyer has handled, so sample mode can replay it.
    const altQ = await queries.alternates(exposure.map((e) => e.ndc).sort());
    q("alternates", altQ);
    const guardedAlt = guardRows(altQ.rows, { table: "alternates", key: "alt_ndc" });
    logGuard(tracer, guardedAlt.context.withheld.length, altQ.rows.length);
    for (const item of items) {
      const cands: Candidate[] = guardedAlt.rows.filter((r) => r.for_ndc === item.ndc).map((r) => ({ ndc: String(r.alt_ndc), company: String(r.company_name), availability: String(r.availability), presentation: String(r.presentation) }));
      const ranked = rankAlternates({ presentation: item.presentation }, cands);
      item.swaps = ranked.filter((m) => m.match !== "review").slice(0, 3);
      item.review = ranked.filter((m) => m.match === "review").slice(0, 2);
      item.evidence = buildEvidence(item, exposureQ.queryId, altQ.queryId);
    }
    tracer.log({ agent_name: "Investigator", action: "alternates", output_summary: items.map((i) => `${i.generic}: ${i.swaps.length} swaps, ${i.review.length} to review`).join("; "), status: "success" });
  }

  // ---- Brief + Critique.
  const { brief, writtenBy } = await write(items, tracer, models);
  const byNdc = new Map(items.map((i) => [i.ndc, i]));
  const recommendations = brief.items.map((b) => {
    const i = byNdc.get(b.ndc)!;
    return { ...b, generic: i.generic, fda_state: i.state, days_on_hand: i.daysOnHand, on_hand_units: i.onHand, daily_usage_units: i.dailyUsage, swaps: i.swaps, review: i.review, history: i.history, handling: i.handling, evidence: i.evidence, written_by: writtenBy.get(b.ndc) ?? "fallback" };
  });
  const hit = [...latest.keys()].filter((n) => exposure.some((e) => e.ndc === n)).length;
  return {
    headline: brief.headline,
    summary: brief.summary,
    fda_update: { date: changeDate, changes: latest.size, hit_your_shelf: hit },
    recommendations,
    quiet: { handled, still_listed: stillListed },
    artifacts: [path.relative(process.cwd(), tracer.file)],
  };
}

const MANIFEST = path.join(process.cwd(), "data", "fixtures", "manifest.json");

/** Sample mode replays exactly the snapshots that existed when its fixtures were recorded. */
function snapshotsForRun(): string[] {
  const all = listSnapshots();
  if (process.env.ZETARIS_RECORD === "true" || process.env.METERLESS_RECORD === "true") {
    fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
    fs.writeFileSync(MANIFEST, JSON.stringify({ snapshots: all.map((f) => path.basename(f)), recorded_at: new Date().toISOString() }, null, 2) + "\n");
  }
  if (!isSample() || !fs.existsSync(MANIFEST)) return all;
  const pinned = new Set<string>((JSON.parse(fs.readFileSync(MANIFEST, "utf-8")) as { snapshots: string[] }).snapshots);
  return all.filter((f) => pinned.has(path.basename(f)));
}

function currentState(world: WorldModel, ndc: string): ShortageState | null {
  const open = world.openEdge(`product:ndc:${ndc}`, "shortage-state");
  return open ? (open.to.split(":").pop() as ShortageState) : null;
}

function buildEvidence(i: Item, exposureQid: string, altQid: string): Evidence[] {
  const ev: Evidence[] = [
    { id: `stock:${i.ndc}`, kind: "zetaris", queryId: exposureQid, label: `Northwind stock: ${i.onHand} units, ${i.dailyUsage}/day (northwind_pg.inventory)`, record: { ndc: i.ndc, on_hand_units: i.onHand, daily_usage_units: i.dailyUsage, days_on_hand: i.daysOnHand } },
    { id: `fda:${i.ndc}`, kind: "zetaris", queryId: exposureQid, label: `FDA shortage list: ${i.state} (fda.shortages)`, record: { ndc: i.ndc, state: i.state } },
    { id: `history:${i.ndc}`, kind: "world-model", label: `Status history: ${i.history.map((h) => `${h.state} from ${h.validFrom.slice(0, 10)}`).join(" → ")}`, record: { history: i.history } },
  ];
  for (const s of [...i.swaps, ...i.review]) ev.push({ id: `alt:${s.ndc}`, kind: "zetaris", queryId: altQid, label: `${s.company} NDC ${s.ndc}: ${s.availability} (${s.reason})`, record: { ndc: s.ndc, company: s.company, presentation: s.presentation, match: s.match } });
  if (i.handling.memoryId) ev.push({ id: `memory:${i.handling.memoryId}`, kind: "hmem", label: `Buyer decision: ${i.handling.summary}`, record: { memoryId: i.handling.memoryId } });
  return ev;
}

async function plan(query: string, candidates: Item[], maxItems: number, tracer: Tracer, models: Set<string>): Promise<string[]> {
  const fallback = candidates.slice(0, maxItems).map((c) => c.ndc);
  if (!candidates.length) return [];
  const table = candidates.slice(0, 25).map((c) => ({
    ndc: c.ndc, drug: c.generic, category: c.category, critical: c.critical, fda_state: c.state,
    change: c.change ? `${c.change.from ?? "not listed"} → ${c.change.to}` : "no change", days_on_hand: c.daysOnHand,
    decision: c.handling.status === "changed-since-decision" ? "status changed since buyer decided" : null,
  }));
  const context = guardContext([{ text: query || "Give me the morning brief.", source: "buyer:request" }, { text: JSON.stringify(table), source: "investigator:candidates" }]);
  if (context.withheld.some((w) => w.source === "buyer:request")) {
    tracer.log({ agent_name: "Guard", action: "scout:block-request", engine: "scout-intent", output_summary: "buyer request withheld by the injection guard; planning on defaults", status: "warning" });
  }
  const messages = buildMessages({ system: PLANNER_SYSTEM, task: `Choose at most ${maxItems} items.`, context });
  tracer.log({ agent_name: "Planner", action: "plan:start", target_agent: "Nemotron", input_summary: `Nemotron is choosing what to cover from ${candidates.length} candidates (thinking on, can take a while)`, status: "success" });
  try {
    // Reasoning on: choosing what matters is the judgement call. Retry with thinking off if it comes back empty.
    const r = await chat({ messages, maxTokens: 8192, timeoutMs: 120_000 }).catch((err) => {
      if (err instanceof MeterlessError && /empty_response/.test(err.message)) {
        tracer.log({ agent_name: "Planner", action: "plan", output_summary: "reasoning ran out of room (empty_response); retrying with thinking off", status: "warning" });
        return chat({ messages, reasoning: false, maxTokens: 800, timeoutMs: 60_000 });
      }
      throw err;
    });
    models.add(r.model);
    const reply = parseJsonReply<{ focus: string[]; rationale: string }>(r.content);
    const valid = (reply.focus ?? []).filter((n) => candidates.some((c) => c.ndc === n));
    const focus = [...new Set(valid)].slice(0, maxItems);
    tracer.log({ agent_name: "Planner", action: "plan", target_agent: "Investigator", model: r.model, ms: r.latencyMs, input_summary: query || "morning brief", output_summary: `${focus.length} items: ${focus.map((n) => candidates.find((c) => c.ndc === n)!.generic).join(", ")}. ${reply.rationale ?? ""}`, status: focus.length ? "success" : "warning", details: { dropped: (reply.focus ?? []).length - focus.length } });
    return focus.length ? focus : fallback;
  } catch (err) {
    tracer.log({ agent_name: "Planner", action: "plan", output_summary: sampleMiss(err) ? `${SAMPLE_NOTE}, so the items are covered in priority order.` : `planner failed (${(err as Error).message.slice(0, 120)}); using priority order`, status: "warning" });
    if (err instanceof MeterlessError && err.status === "unauthorized") throw err;
    return fallback;
  }
}

async function write(items: Item[], tracer: Tracer, models: Set<string>): Promise<{ brief: Brief; writtenBy: Map<string, string> }> {
  const writtenBy = new Map<string, string>();
  if (!items.length) return { brief: { headline: "Nothing on your shelf needs action from the latest FDA update.", summary: "No formulary items are newly short or running low.", items: [] }, writtenBy };

  // One small call per item (Nemotron thinking off: the Critic checks every claim), two at a time to stay inside the free endpoint's limits.
  const finalItems: BriefItem[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      const { item, by } = await writeItem(items[idx], tracer, models);
      finalItems[idx] = item;
      writtenBy.set(items[idx].ndc, by);
    }
  };
  await Promise.all([worker(), worker()]);

  const fallbacks = [...writtenBy.values()].filter((v) => v === "fallback").length;
  if (fallbacks) tracer.log({ agent_name: "Critic", action: "fallback", output_summary: `${fallbacks} item(s) still failed after ${MAX_CRITIC_LOOPS} refinements; replaced with plain deterministic text`, status: "warning" });

  // The headline is counted, not written. The summary is written from the approved items only, so it cannot add facts.
  const today = finalItems.filter((b) => b.priority === "act-today").length;
  const better = finalItems.filter((b) => b.priority === "good-news").length;
  const headline = [`${today} to act on today`, better ? `${better} improved` : "", `${items.length - today - better} to watch`].filter((x) => x && !x.startsWith("0 to watch")).join(" · ");
  let summary = finalItems.map((b) => b.headline).join("; ");
  try {
    const context = guardContext([{ text: JSON.stringify(finalItems.map((b) => ({ priority: b.priority, headline: b.headline, action: b.action }))), source: "brief:items" }]);
    const r = await chat({ messages: buildMessages({ system: SUMMARY_SYSTEM, task: "Write the brief summary.", context }), reasoning: false, maxTokens: 400, timeoutMs: 60_000 });
    models.add(r.model);
    const reply = parseJsonReply<{ summary: string }>(r.content);
    const bad = /\b(?:will (?:run out|go short)|predict|forecast)\b/i.test(reply.summary ?? "");
    if (!bad && reply.summary) summary = reply.summary;
    tracer.log({ agent_name: "Writer", action: "summarize", model: r.model, ms: r.latencyMs, output_summary: bad ? "summary used prediction language; kept the plain one" : reply.summary, status: bad ? "warning" : "success" });
  } catch (err) {
    tracer.log({ agent_name: "Writer", action: "summarize", output_summary: sampleMiss(err) ? `${SAMPLE_NOTE}; plain summary used.` : `kept plain summary (${(err as Error).message.slice(0, 100)})`, status: "warning" });
  }
  return { brief: { headline, summary, items: finalItems }, writtenBy };
}

async function writeItem(item: Item, tracer: Tracer, models: Set<string>): Promise<{ item: BriefItem; by: "nemotron" | "fallback" }> {
  const context = guardContext([{ text: JSON.stringify(itemForWriter(item)), source: `item:${item.ndc}` }]);
  if (context.withheld.length) logGuard(tracer, context.withheld.length, 1);
  const baseTask = `Write the brief item for NDC ${item.ndc}.`;
  tracer.log({ agent_name: "Writer", action: "write:start", input_summary: `Writing ${item.generic} (${item.ndc}) from ${item.evidence.length} evidence records`, status: "success" });
  let messages = buildMessages({ system: WRITER_SYSTEM, task: baseTask, context });
  for (let attempt = 0; attempt <= MAX_CRITIC_LOOPS; attempt++) {
    let r;
    try {
      // The free NVIDIA endpoint has latency spikes (20-40 s seen, some past 60 s): retry a timeout once with the guide's 90 s ceiling.
      r = await chat({ messages, reasoning: false, maxTokens: 700, timeoutMs: 60_000 }).catch((err) => {
        if (err instanceof MeterlessError && err.status === "offline" && /timeout|aborted/i.test(err.message)) {
          tracer.log({ agent_name: "Writer", action: "write", retry_count: attempt, output_summary: `${item.generic}: model call timed out after 60 s; retrying once with 90 s`, status: "warning" });
          return chat({ messages, reasoning: false, maxTokens: 700, timeoutMs: 90_000 });
        }
        throw err;
      });
    } catch (err) {
      tracer.log({ agent_name: "Writer", action: "write", retry_count: attempt, output_summary: sampleMiss(err) ? `${item.generic}: ${SAMPLE_NOTE}; plain text used.` : `${item.generic}: writer failed (${(err as Error).message.slice(0, 120)})`, status: sampleMiss(err) ? "warning" : "error" });
      if (err instanceof MeterlessError && err.status === "unauthorized") throw err;
      break;
    }
    models.add(r.model);
    let draft: BriefItem;
    try {
      draft = { ...parseJsonReply<BriefItem>(r.content), ndc: item.ndc };
    } catch {
      tracer.log({ agent_name: "Writer", action: "write", model: r.model, ms: r.latencyMs, retry_count: attempt, output_summary: `${item.generic}: reply was not valid JSON`, status: "warning" });
      messages = buildMessages({ system: WRITER_SYSTEM, task: `${baseTask} Reply with the JSON object only, no other text.`, context });
      continue;
    }
    const violations = critique({ headline: "", summary: "", items: [draft] }, [item]);
    tracer.log({ agent_name: "Writer", action: "write", target_agent: "Critic", model: r.model, ms: r.latencyMs, retry_count: attempt, output_summary: `${item.generic}: "${draft.headline}"`, status: "success", details: { usage: r.usage } });
    tracer.log({ agent_name: "Critic", action: "critique", target_agent: violations.length ? "Writer" : undefined, retry_count: attempt, output_summary: violations.length ? `${item.generic}: ${violations.map((v) => `${v.rule} (${v.detail})`).join("; ")}` : `${item.generic}: every claim checks out`, status: violations.length ? "warning" : "success", details: { violations } });
    if (!violations.length) return { item: draft, by: "nemotron" };
    // A fresh single-turn prompt: multi-turn refinements with thinking off come back empty from the endpoint.
    const notes = violations.map((v) => `- ${v.rule}: ${v.detail}`).join("\n");
    messages = buildMessages({ system: WRITER_SYSTEM, task: `${baseTask}\nYour previous draft was rejected by the Critic:\n${notes}\nPrevious draft: ${JSON.stringify(draft)}\nReply with the corrected JSON only.`, context });
  }
  return { item: fallbackItem(item), by: "fallback" };
}

function logGuard(tracer: Tracer, withheld: number, total: number) {
  tracer.log({ agent_name: "Guard", action: "scout:screen", engine: "scout-intent", output_summary: withheld ? `${withheld} field(s) withheld as suspected prompt injection (of ${total} rows)` : `${total} rows screened, nothing withheld`, status: withheld ? "warning" : "success" });
}

/** In sample mode a variation nobody recorded has no model reply to replay. That is expected, not a fault. */
const sampleMiss = (err: unknown): boolean => isSample() && /no recorded model response/.test((err as Error).message ?? "");
const SAMPLE_NOTE = "Sample mode has no recorded Nemotron reply for this variation";

const secs = (t0: number) => Math.round((Date.now() - t0) / 100) / 10;

export const _internal = { currentState, shortageStateOf, loadSettings };
export type { FdaShortageRecord };
