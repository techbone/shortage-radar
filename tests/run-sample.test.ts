// The whole agent, end to end, replaying the recorded live runs. No Zetaris, no Nightshift, no network.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { runSweep, type RunInput } from "../src/agent/run";

const example = (n: number): RunInput => JSON.parse(fs.readFileSync(`input_examples/example_${n}.json`, "utf-8"));
const sample = (req: RunInput, id: string): RunInput => ({ ...req, run_id: id, options: { ...req.options, sample_mode: true, quiet: true } });

describe("sample mode replays a recorded live run", () => {
  it("example 1: six items, Nemotron named, every claim checked, structured result", async () => {
    const r = await runSweep({ ...sample(example(1), "example-1") });
    expect(r.status).toBe("success");
    expect(r.models).toEqual(["nvidia/nemotron-3.5-lightning-30b-a3b"]);
    expect(r.output!.recommendations.map((x) => x.generic)).toEqual(["etomidate", "morphine", "dexmedetomidine", "lidocaine", "sufentanil", "atropine"]);
    expect(r.output!.recommendations.every((x) => x.written_by === "nemotron")).toBe(true);
    expect(r.output!.fda_update).toMatchObject({ date: "2026-10-23", changes: 13, hit_your_shelf: 8 });
    expect(r.agents.map((a) => a.name)).toEqual(["Planner", "Investigator", "Guard", "Writer", "Critic"]);
    expect(r.log_file).toBe("logs/trace-example-1-sample.jsonl");
    expect(r.execution_time_seconds).toBeLessThan(10);
  });

  it("every recommended NDC is a same-concentration swap and cites its own record", async () => {
    const r = await runSweep(sample(example(1), "example-1"));
    for (const rec of r.output!.recommendations) {
      if (!rec.buy_instead) continue;
      expect(rec.swaps.map((s) => s.ndc)).toContain(rec.buy_instead);
      expect(rec.citations).toContain(`alt:${rec.buy_instead}`);
      expect(rec.swaps.find((s) => s.ndc === rec.buy_instead)!.match).not.toBe("review");
    }
  });

  it("example 3: decisions sent with the request keep two items out of the brief (H-MEM)", async () => {
    const r = await runSweep(sample(example(3), "example-3"));
    expect(r.status).toBe("success");
    expect(r.output!.quiet.handled.map((h) => h.generic).sort()).toEqual(["etomidate", "morphine"]);
    expect(r.output!.recommendations.map((x) => x.generic)).not.toContain("etomidate");
    expect(r.output!.recommendations.map((x) => x.generic)).not.toContain("morphine");
  });

  it("a decision on an item the recordings never saw still produces a brief", async () => {
    const req = sample({ run_id: "t", input: { query: "A question nobody recorded." }, decisions: [{ ndc: "0409-1630-10", generic: "atropine", action: "monitor", stateAtDecision: "limited", by: "buyer" }] }, "test-novel");
    const r = await runSweep(req);
    expect(r.status === "success" || r.status === "partial").toBe(true);
    expect(r.output!.recommendations.map((x) => x.generic)).not.toContain("atropine");
    expect(r.output!.recommendations.length).toBeGreaterThan(0);
  });

  it("two requests with different modes do not leak into each other", async () => {
    const before = process.env.SAMPLE_MODE;
    await runSweep(sample(example(1), "test-leak"));
    expect(process.env.SAMPLE_MODE).toBe(before);
  });
});

describe("a live run that cannot reach its services", () => {
  const live = (id: string, fallback?: boolean): RunInput => ({ run_id: id, input: { query: example(1).input.query }, options: { quiet: true, fallback } });

  it("falls back to the recorded run and says so", async () => {
    const saved = { ...process.env };
    delete process.env.SAMPLE_MODE;
    process.env.ZETARIS_API_KEY = "";
    process.env.ZETARIS_REST_URL = "http://127.0.0.1:9/api/v1.0";
    try {
      const r = await runSweep(live("test-fallback"));
      expect(r.status).toBe("partial");
      expect(r.fallback).toMatchObject({ from: "live", to: "sample" });
      expect(r.fallback!.reason).toMatch(/Zetaris/);
      expect(r.output!.recommendations.length).toBeGreaterThan(0);
    } finally {
      process.env = saved;
    }
  });

  it("returns a structured, recoverable error when fallback is off", async () => {
    const saved = { ...process.env };
    delete process.env.SAMPLE_MODE;
    process.env.ZETARIS_API_KEY = "";
    try {
      const r = await runSweep(live("test-nofallback", false));
      expect(r.status).toBe("error");
      expect(r.error).toMatchObject({ type: "Zetaris:auth", recoverable: true });
      expect(r.trace_id).toBe("trace-test-nofallback");
    } finally {
      process.env = saved;
    }
  });
});
