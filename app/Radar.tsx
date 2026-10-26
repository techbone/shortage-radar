"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Loader2, Moon, Play, RotateCcw, Sun, X } from "lucide-react";
import type { RunOutput } from "../src/agent/run";
import type { DecisionAction, DecisionInput } from "../src/domain/decisions";
import { ENGINES, LIMITS } from "./evidence";

type Trace = {
  timestamp: string; agent_name: string; action: string; status: string;
  output_summary?: string; input_summary?: string; model?: string; ms?: number; sql?: string; query_id?: string; rows?: number; engine?: string; target_agent?: string;
};
type Rec = NonNullable<RunOutput["output"]>["recommendations"][number];
type Status = { live_available: boolean; zetaris: string; nightshift: string; sample_available: boolean };
type Tab = "brief" | "trace" | "engines";

// Sample mode replays the model replies recorded for the example that asked this same question.
const REPLAYS: Record<string, string> = {
  "Give me the morning brief: what changed on the FDA list that hits our shelf?": "example-1",
  "Anesthesia only. Which anesthesia drugs are short, and which have no same-strength alternate?": "example-2",
};

const QUERIES = [
  { label: "Morning brief", text: "Give me the morning brief: what changed on the FDA list that hits our shelf?" },
  { label: "Anesthesia only", text: "Anesthesia only. Which anesthesia drugs are short, and which have no same-strength alternate?" },
];

// ---------------------------------------------------------------- steps

const STEPS = [
  { id: "ingest", label: "Ingest", hint: "Zetaris reads the FDA feed. The World Model replays every saved snapshot." },
  { id: "diff", label: "Diff", hint: "What changed on the FDA list since the last update." },
  { id: "match", label: "Match", hint: "Stock and FDA list joined in one query. Scout screens the rows. H-MEM sets aside what you handled." },
  { id: "alternatives", label: "Alternatives", hint: "Nemotron picks what to cover. Zetaris finds same-strength swaps." },
  { id: "brief", label: "Brief", hint: "Nemotron writes one item at a time." },
  { id: "critique", label: "Critique", hint: "Code checks every claim against its evidence." },
] as const;
type StepId = (typeof STEPS)[number]["id"];

function stepOf(e: Trace, last: StepId | null): StepId | null {
  if (e.agent_name === "Orchestrator") return null;
  if (e.agent_name === "Guard") return last;
  const a = e.action;
  if (a === "zetaris:fda-feed" || a === "world-model:ingest") return "ingest";
  if (a === "world-model:diff") return "diff";
  if (a === "zetaris:exposure" || a === "match" || a.startsWith("hmem:")) return "match";
  if (e.agent_name === "Planner" || a === "zetaris:alternates" || a === "alternates") return "alternatives";
  if (e.agent_name === "Writer") return "brief";
  if (e.agent_name === "Critic") return "critique";
  return last;
}

function deriveSteps(events: Trace[], running: boolean, done: boolean) {
  const info = new Map<StepId, { events: Trace[]; first: number; last: number }>();
  let last: StepId | null = null;
  let current: StepId | null = null;
  for (const e of events) {
    const s = stepOf(e, last);
    if (!s) continue;
    last = s;
    current = s;
    const t = Date.parse(e.timestamp);
    const cur = info.get(s) ?? { events: [], first: t, last: t };
    cur.events.push(e);
    cur.last = t;
    info.set(s, cur);
  }
  return STEPS.map((s, i) => {
    const d = info.get(s.id);
    const later = STEPS.slice(i + 1).some((n) => info.has(n.id));
    const warn = !!d?.events.some((e) => e.status === "warning" || e.status === "error");
    let state: "pending" | "running" | "done" | "warn" = "pending";
    if (d) state = done || later || !running ? (warn ? "warn" : "done") : "running";
    if (s.id === "brief" && d && !done && running) state = "running";
    if (s.id === "critique" && d && !done && running) state = "running";
    let detail: string = s.hint;
    if (d) {
      if (s.id === "critique") {
        const checks = d.events.filter((e) => e.action === "critique");
        const sentBack = checks.filter((e) => e.status === "warning").length;
        detail = `${checks.length} items checked, ${sentBack} sent back for a fix${d.events.some((e) => e.action === "fallback") ? ", 1+ replaced with plain text" : ""}`;
      } else if (s.id === "brief") {
        const w = d.events.filter((e) => e.action === "write" && e.status === "success").length;
        detail = w ? `${w} items written by ${d.events.find((e) => e.model)?.model ?? "Nemotron"}` : (d.events.at(-1)?.input_summary ?? d.events.at(-1)?.output_summary ?? s.hint);
      } else {
        detail = (d.events.at(-1)?.output_summary ?? d.events.at(-1)?.input_summary ?? s.hint).slice(0, 140);
      }
    }
    return { ...s, state, detail, secs: d ? Math.max(0, Math.round((d.last - d.first) / 100) / 10) : null };
  });
}

// ---------------------------------------------------------------- small pieces

const stateLabel: Record<string, string> = { unavailable: "Unavailable", limited: "Limited", available: "Available", listed: "Listed", "to-be-discontinued": "Discontinuing", resolved: "Resolved", "off-list": "Off list" };
const chipClass = (s: string) => (s === "unavailable" ? "unavailable" : s === "limited" || s === "to-be-discontinued" ? "limited" : s === "available" || s === "resolved" ? "available" : "");
const day = (iso: string) => iso.slice(0, 10);
const num = (n: number) => String(Number(n.toFixed(1)));
const matchLabel = { "same-product": "Same product", "same-concentration": "Same concentration", review: "Pharmacist review" } as const;

function StateChip({ state }: { state: string }) {
  return <span className={`chip ${chipClass(state)}`}>{stateLabel[state] ?? state}</span>;
}

function prevState(r: Rec): string | null {
  return r.history.length >= 2 ? r.history[r.history.length - 2].state : null;
}

// ---------------------------------------------------------------- main

export function Radar() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"live" | "sample">("sample");
  const [tab, setTab] = useState<Tab>("brief");
  const [query, setQuery] = useState(QUERIES[0].text);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [events, setEvents] = useState<Trace[]>([]);
  const [result, setResult] = useState<RunOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<DecisionInput[]>([]);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("radar.decisions") ?? "[]");
      if (Array.isArray(saved)) setDecisions(saved);
      const t = localStorage.getItem("radar.theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
    fetch("/api/status").then((r) => r.json()).then((s: Status) => { setStatus(s); setMode(s.live_available ? "live" : "sample"); }).catch(() => setStatus({ live_available: false, zetaris: "offline", nightshift: "offline", sample_available: true }));
  }, []);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try { theme ? localStorage.setItem("radar.theme", theme) : localStorage.removeItem("radar.theme"); } catch {}
  }, [theme]);

  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [running]);

  const saveDecisions = (next: DecisionInput[]) => {
    setDecisions(next);
    try { localStorage.setItem("radar.decisions", JSON.stringify(next)); } catch {}
  };

  const run = useCallback(async () => {
    setRunning(true); setElapsed(0); setEvents([]); setResult(null); setError(null); setSelected(null); setTab("brief");
    try {
      const res = await fetch("/api/run?stream=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { query }, decisions, options: { sample_mode: mode === "sample", replay_of: mode === "sample" ? REPLAYS[query] : undefined } }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `The server answered ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.type === "trace") setEvents((prev) => [...prev, msg.event]);
          else if (msg.type === "result") {
            setResult(msg.result);
            if (msg.result.status === "error") setError(`${msg.result.error?.type}: ${msg.result.error?.message}`);
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }, [query, decisions, mode]);

  const out = result?.output;
  const decidedNdcs = new Set(decisions.map((d) => d.ndc));
  const recs = (out?.recommendations ?? []).filter((r) => !(decidedNdcs.has(r.ndc) && decisions.some((d) => d.ndc === r.ndc && d.stateAtDecision === r.fda_state)));
  const justHandled = (out?.recommendations ?? []).filter((r) => !recs.includes(r));
  const handled = [
    ...(out?.quiet.handled ?? []).map((h) => ({ ndc: h.ndc, generic: h.generic, summary: h.summary })),
    ...justHandled.map((r) => ({ ndc: r.ndc, generic: r.generic, summary: decisions.find((d) => d.ndc === r.ndc)?.note ?? "Decision saved. It stays out of the brief until the FDA status changes." })),
  ].filter((h, i, all) => all.findIndex((x) => x.ndc === h.ndc) === i);
  const selectedRec = recs.find((r) => r.ndc === selected) ?? null;
  const sqlById = useMemo(() => new Map(events.filter((e) => e.query_id && e.sql).map((e) => [e.query_id!, e.sql!])), [events]);
  const steps = deriveSteps(events, running, !!result);
  const nHidden = justHandled.length;
  const headline = nHidden ? (recs.length ? `${recs.filter((r) => r.priority === "act-today").length} to act on today` : "Nothing left to act on") : out?.headline ?? "";
  const summary = nHidden ? `You handled ${nHidden} ${nHidden === 1 ? "item" : "items"} since this run. Run again to refresh this summary.` : out?.summary ?? "";
  const customQuestion = mode === "sample" && !QUERIES.some((q) => q.text === query);

  const decide = (r: Rec, action: DecisionAction, note: string) => {
    const d: DecisionInput = { ndc: r.ndc, generic: r.generic, action, stateAtDecision: r.fda_state, alternateNdc: action === "bought-alternate" ? r.buy_instead ?? undefined : undefined, note: note.trim() || undefined, by: "buyer" };
    saveDecisions([...decisions.filter((x) => x.ndc !== r.ndc), d]);
    setSelected(null);
  };

  const forget = async () => {
    saveDecisions([]);
    if (mode === "live") await fetch("/api/memory", { method: "DELETE" }).catch(() => {});
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden /> Shortage Radar</div>
        <span className="where">Northwind General · fictional 220-bed hospital · 82 formulary lines</span>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Data source">
          <button aria-pressed={mode === "live"} disabled={!status?.live_available || running} onClick={() => setMode("live")} title={status?.live_available ? "Zetaris and Nightshift answer on this machine" : `Live needs Zetaris (${status?.zetaris ?? "…"}) and Nightshift (${status?.nightshift ?? "…"})`}>Live</button>
          <button aria-pressed={mode === "sample"} disabled={running} onClick={() => setMode("sample")} title="Replays a recorded live run. No Zetaris, Nightshift or network.">Sample</button>
        </div>
        <button className="btn icon" aria-label="Toggle theme" onClick={() => setTheme((t) => (t ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark" ? "light" : "dark")}>
          {theme === "dark" || (!theme && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? <Sun className="i" /> : <Moon className="i" />}
        </button>
      </header>

      <div className="layout">
        <aside className="rail" aria-label="Run progress">
          <h2>This run</h2>
          <ol className="steps">
            {steps.map((s) => (
              <li key={s.id} className={`step ${s.state}`}>
                <span className="mark">{s.state === "done" ? <Check className="i" /> : s.state === "running" ? <Loader2 className="i spin" /> : s.state === "warn" ? <AlertTriangle className="i" /> : null}</span>
                <div>
                  <div className="name"><span>{s.label}</span>{s.secs !== null && <span className="mono">{s.secs}s</span>}</div>
                  <div className="detail">{s.detail}</div>
                </div>
              </li>
            ))}
          </ol>
          {result && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{mode === "sample" ? "Replayed" : "Finished"} in <span className="mono">{result.execution_time_seconds}s</span>. Trace: <span className="mono">{result.log_file}</span></p>}
          {running && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Running for <span className="mono">{elapsed}s</span>{mode === "live" ? ". A live run takes about a minute or two: Nemotron reasons before it answers." : "."}</p>}
        </aside>

        <main className="main">
          <div className="topbar" style={{ position: "static", padding: 0, border: 0, background: "none", marginBottom: 16 }}>
            <input className="input" style={{ flex: 1, minWidth: 220 }} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Ask the agent" maxLength={500} disabled={running} onKeyDown={(e) => e.key === "Enter" && !running && run()} />
            {QUERIES.map((q) => <button key={q.label} className="btn" disabled={running} onClick={() => setQuery(q.text)}>{q.label}</button>)}
            <button className="btn primary" disabled={running} onClick={run}>{running ? <Loader2 className="i spin" /> : <Play className="i" />}{running ? "Running" : out ? "Run again" : "Run sweep"}</button>
          </div>
          {customQuestion && <p className="muted" style={{ fontSize: 12, margin: "-8px 0 16px" }}>Sample mode replays recorded answers. A new question reuses the recorded item write-ups with the default plan. Switch to Live to plan it with Nemotron.</p>}

          <div className="tabs" role="tablist">
            {(["brief", "trace", "engines"] as Tab[]).map((t) => <button key={t} role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === "brief" ? "Brief" : t === "trace" ? `Trace${events.length ? ` (${events.length})` : ""}` : "Engines"}</button>)}
          </div>

          {error && <div className="err" role="alert"><strong>The run did not finish.</strong> <span className="muted">{error}</span>{mode === "live" && <span> Try Sample mode, which needs no services.</span>}</div>}

          {tab === "brief" && (
            <>
              {!out && !running && !error && <Empty />}
              {!out && running && <LiveLog events={events} elapsed={elapsed} />}
              {out && (
                <>
                  <section className="hero">
                    <h1>{headline}</h1>
                    <p className={nHidden ? "muted" : undefined}>{summary}</p>
                    <div className="facts">
                      <span>FDA update <span className="mono">{out.fda_update.date ?? "none"}</span></span>
                      <span><span className="mono">{out.fda_update.changes}</span> NDCs changed status</span>
                      <span><span className="mono">{out.fda_update.hit_your_shelf}</span> on your shelf</span>
                      {result?.models.map((m) => <span key={m} className="chip accent mono">{m}</span>)}
                      {mode === "sample" && <span className="chip">Replay of a recorded live run</span>}
                      {result?.fallback && <span className="chip limited" title={result.fallback.reason}>Live services unreachable: showing a recorded run</span>}
                      {result?.status === "partial" && !result.fallback && <span className="chip limited">Some items use plain text</span>}
                    </div>
                  </section>

                  <div className="section-title"><h2>Needs action</h2><span className="muted">{recs.length} {recs.length === 1 ? "item" : "items"}</span></div>
                  {recs.length === 0 ? <p className="muted">Nothing left on your list. Everything the FDA touched is handled or doesn’t affect you.</p> : <BriefTable recs={recs} selected={selected} onSelect={setSelected} />}

                  {handled.length > 0 && (
                    <>
                      <div className="section-title"><h2>Handled</h2><span className="muted">Quiet until the FDA status changes</span></div>
                      <div className="cards">
                        {handled.map((h) => <div key={h.ndc} className="card"><div className="row-between"><strong style={{ textTransform: "capitalize" }}>{h.generic}</strong><span className="mono muted">{h.ndc}</span></div><p className="muted" style={{ fontSize: 13, marginTop: 4 }}>{h.summary}</p></div>)}
                      </div>
                    </>
                  )}
                  {decisions.length > 0 && <p style={{ marginTop: 24 }}><button className="btn" onClick={forget}><RotateCcw className="i" /> Forget my {decisions.length} {decisions.length === 1 ? "decision" : "decisions"}</button></p>}
                  <p className="muted" style={{ fontSize: 12, marginTop: 24 }}>{out.quiet.still_listed} more items on your formulary are still listed by the FDA without a new change. Decision support only: confirm with the label and your wholesaler before ordering.</p>
                </>
              )}
            </>
          )}

          {tab === "trace" && <TraceTab events={events} />}
          {tab === "engines" && <EnginesTab />}
        </main>
      </div>

      {selectedRec && <Drawer rec={selectedRec} sqlById={sqlById} onClose={() => setSelected(null)} onDecide={decide} />}
    </div>
  );
}

// ---------------------------------------------------------------- views

function LiveLog({ events, elapsed }: { events: Trace[]; elapsed: number }) {
  const t0 = events.length ? Date.parse(events[0].timestamp) : 0;
  const shown = events.filter((e) => !(e.agent_name === "Orchestrator" && e.action === "start")).slice(-12);
  return (
    <section className="live" aria-live="polite" aria-label="Live trace">
      <div className="live-head"><Loader2 className="i spin" /><span>Live trace</span><span className="muted mono">{events.length} events · {elapsed}s</span></div>
      {shown.length === 0 && <p className="muted" style={{ margin: 0 }}>Starting…</p>}
      <ul>
        {shown.map((e, i) => (
          <li key={e.timestamp + i} className={i === shown.length - 1 ? "latest" : undefined}>
            <span className="mono t">+{((Date.parse(e.timestamp) - t0) / 1000).toFixed(1)}s</span>
            <span className="who">{e.agent_name}</span>
            <span className="what">{e.output_summary ?? e.input_summary}</span>
            {e.model && <span className="chip mono">{e.model.replace("nvidia/", "")}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Empty() {
  return (
    <div className="empty">
      <h2>Morning brief</h2>
      <p>One run checks the FDA drug shortage list against Northwind General’s formulary and stock, then tells the buyer what needs action today and what to buy instead.</p>
      <ul>
        <li>Zetaris joins the hospital’s Postgres with the FDA feed in one query.</li>
        <li>Nemotron plans and writes. A code Critic rejects any claim its evidence doesn’t back.</li>
        <li>Every item opens to the queries, records and status history behind it.</li>
      </ul>
    </div>
  );
}

function BriefTable({ recs, selected, onSelect }: { recs: Rec[]; selected: string | null; onSelect: (ndc: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="t brief">
        <thead><tr><th>Drug</th><th>FDA status</th><th className="num">Days on hand</th><th>Buy instead</th><th className="hide-sm" /></tr></thead>
        <tbody>
          {recs.map((r) => {
            const swap = r.swaps.find((s) => s.ndc === r.buy_instead);
            const was = prevState(r);
            return (
              <tr key={r.ndc} className="row" data-ndc={r.ndc} data-swaps={r.swaps.length} data-review={r.review.length} tabIndex={0} aria-selected={selected === r.ndc} onClick={() => onSelect(r.ndc)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(r.ndc)}>
                <td><div className="drug" style={{ textTransform: "capitalize" }}>{r.generic}</div><div className="sub mono">{r.ndc}</div><div className="sub">{r.headline}</div></td>
                <td data-label="FDA status"><div><StateChip state={r.fda_state} />{was && was !== r.fda_state && <div className="sub">was {stateLabel[was]?.toLowerCase() ?? was}</div>}</div></td>
                <td className="num" data-label="Days on hand"><div><span className={`days ${r.days_on_hand <= 7 ? "low" : ""}`}>{num(r.days_on_hand)}</span><div className="sub mono">{r.on_hand_units} at {r.daily_usage_units}/day</div></div></td>
                <td data-label="Buy instead">{swap ? <div><div>{swap.company}</div><div className="sub mono">{swap.ndc} · {matchLabel[swap.match]}</div></div> : <span className="muted">{r.review.length ? `No same-strength swap. ${r.review.length} to review` : "No listed alternate"}</span>}</td>
                <td className="hide-sm"><ChevronRight className="i muted" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Drawer({ rec, sqlById, onClose, onDecide }: { rec: Rec; sqlById: Map<string, string>; onClose: () => void; onDecide: (r: Rec, a: DecisionAction, note: string) => void }) {
  const [note, setNote] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Why: ${rec.generic}`}>
        <header>
          <div style={{ flex: 1 }}>
            <h2 style={{ textTransform: "capitalize" }}>{rec.generic}</h2>
            <div className="mono muted" style={{ marginTop: 4 }}>{rec.ndc}</div>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}><StateChip state={rec.fda_state} /><span className="chip mono">{num(rec.days_on_hand)} days on hand</span><span className="chip">{rec.written_by === "nemotron" ? "Written by Nemotron, checked by the Critic" : "Plain text: the model draft failed the Critic"}</span></div>
          </div>
          <button ref={closeRef} className="btn icon" onClick={onClose} aria-label="Close"><X className="i" /></button>
        </header>
        <div className="body">
          <section><h3>Why</h3><p>{rec.why}</p><p className="muted" style={{ marginTop: 8 }}>{rec.action}</p></section>

          <section>
            <h3>Buy instead</h3>
            {rec.swaps.length === 0 && <p className="muted">No same-strength swap is listed as available.</p>}
            <div className="cards">
              {rec.swaps.map((s) => (
                <div key={s.ndc} className={`card ${s.ndc === rec.buy_instead ? "pick" : ""}`}>
                  <div className="row-between"><strong>{s.company}</strong><span className="chip good">{matchLabel[s.match]}</span></div>
                  <div className="mono muted" style={{ marginTop: 2 }}>{s.ndc}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{s.presentation}</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>{s.reason}</div>
                </div>
              ))}
            </div>
            {rec.review.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary>{rec.review.length} to review with a pharmacist (not a like-for-like swap)</summary>
                <div className="cards" style={{ marginTop: 8 }}>{rec.review.map((s) => <div key={s.ndc} className="card"><div className="row-between"><strong>{s.company}</strong><span className="chip limited">{matchLabel.review}</span></div><div className="mono muted">{s.ndc}</div><div style={{ fontSize: 12, marginTop: 4 }}>{s.reason}</div></div>)}</div>
              </details>
            )}
          </section>

          <section>
            <h3>Stock</h3>
            <dl className="kv"><dt>On hand</dt><dd className="mono">{rec.on_hand_units} units</dd><dt>Daily use</dt><dd className="mono">{rec.daily_usage_units} units</dd><dt>Days on hand</dt><dd className="mono">{num(rec.days_on_hand)}</dd></dl>
          </section>

          <section>
            <h3>FDA status history</h3>
            <ul className="timeline">{rec.history.map((h, i) => <li key={i}><StateChip state={h.state} /><span className="mono muted">{day(h.validFrom)}{h.validTo ? ` → ${day(h.validTo)}` : " → now"}</span></li>)}</ul>
          </section>

          <section>
            <h3>Evidence ({rec.evidence.length})</h3>
            <div className="evidence">
              {rec.evidence.map((e) => (
                <div key={e.id} className="ev">
                  <div>{e.label}</div>
                  <div className="mono">{e.kind === "zetaris" ? "Zetaris" : e.kind === "world-model" ? "World Model" : "H-MEM"} · {e.id}{e.queryId ? ` · query ${e.queryId}` : ""}</div>
                  {e.queryId && sqlById.get(e.queryId) && <details><summary>SQL</summary><pre className="sql">{sqlById.get(e.queryId)}</pre></details>}
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Cited in the brief: <span className="mono">{rec.citations.join(", ")}</span></p>
          </section>

          <section>
            <h3>Your decision</h3>
            <input className="input note" placeholder="Optional note, e.g. “2 weeks from Caplin via Cardinal”" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} aria-label="Decision note" />
            <div className="actions" style={{ marginTop: 8 }}>
              <button className="btn primary" disabled={!rec.buy_instead} title={rec.buy_instead ? "" : "No same-strength swap to record"} onClick={() => onDecide(rec, "bought-alternate", note)}>Bought the alternate</button>
              <button className="btn" onClick={() => onDecide(rec, "do-not-substitute", note)}>Do not substitute</button>
              <button className="btn" onClick={() => onDecide(rec, "monitor", note)}>Monitor</button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>H-MEM remembers this. The item stays out of the brief until the FDA changes its status.</p>
          </section>
        </div>
      </aside>
    </>
  );
}

function TraceTab({ events }: { events: Trace[] }) {
  if (!events.length) return <p className="muted">Run a sweep to see every agent step, Zetaris query and model call.</p>;
  const t0 = Date.parse(events[0].timestamp);
  return (
    <div className="table-wrap">
      <table className="t trace">
        <thead><tr><th>+s</th><th>Agent</th><th>Step</th><th>What happened</th><th>Model</th><th className="num">ms</th></tr></thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td className="mono">{((Date.parse(e.timestamp) - t0) / 1000).toFixed(1)}</td>
              <td><span className={`dot ${e.status === "error" ? "off" : e.status === "warning" ? "warn" : "on"}`} /> {e.agent_name}</td>
              <td className="mono">{e.action}</td>
              <td className="detail">{e.output_summary ?? e.input_summary}{e.query_id ? <span className="mono"> · {e.query_id}</span> : null}</td>
              <td className="mono muted">{e.model?.replace("nvidia/", "") ?? ""}</td>
              <td className="num mono">{e.ms ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EnginesTab() {
  return (
    <>
      <p style={{ maxWidth: "70ch", marginTop: 0 }}>Three Meterless engines do real work in this product. Each is our own implementation of the open specification, checked by the official test runner. The commands re-run the checks.</p>
      <div className="engines">
        {ENGINES.map((e) => (
          <div key={e.engine} className="engine">
            <h3>{e.engine}</h3>
            <div><div className="big">{e.result}</div><div className="muted" style={{ fontSize: 12 }}>{e.detail}</div></div>
            <p style={{ margin: 0 }}>{e.does}</p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Powers: {e.feature}</p>
            <div><code>{e.command}</code></div>
            <div className="mono muted">{e.code} · {e.file}</div>
          </div>
        ))}
      </div>
      <div className="section-title"><h2>What this does not do</h2></div>
      <ul className="limits">{LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
    </>
  );
}
