// Run the official Meterless Scout eval runner (evals/scout/runner/index.ts, unmodified)
// against our Scout and judge the metrics that apply to a guard-stage implementation.
//
// The runner gates ALL metrics, so an injection-only run reports "gate failed" for
// intent_top1, intent_top3_recall and tool_precision: the injection corpus has no
// examples for them, they default to 0, and they fall below their floors. We implement
// the guard stage only, so those are not applicable. This wrapper prints the runner's
// full output, then applies the targets from evals/scout/config/thresholds.yaml to the
// two metrics that are measured here.
//   npm run evals:injection

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = process.cwd();
const run = spawnSync("npx", ["tsx", "evals/scout/runner/index.ts", "injection"], {
  cwd: root,
  encoding: "utf-8",
  env: { ...process.env, SCOUT_IMPL: path.join(root, "src/engines/scout-intent/index.ts") },
});
const out = `${run.stdout}${run.stderr}`;
process.stdout.write(out);

const thresholds = parse(fs.readFileSync(path.join(root, "evals/scout/config/thresholds.yaml"), "utf-8")).metrics;
const read = (name: string) => Number(out.match(new RegExp(`${name}\\s*│\\s*([0-9.]+)`))?.[1] ?? NaN);
const loaded = Number(out.match(/Loaded (\d+) examples/)?.[1] ?? NaN);
const precision = read("injection_precision");
const recall = read("injection_recall");
const p = thresholds.injection_precision;
const r = thresholds.injection_recall;

const ok = !Number.isNaN(precision) && !Number.isNaN(recall) && precision >= p.target && recall >= r.target;
console.log(`\nScout injection evals on ${loaded} examples:`);
console.log(`  injection_precision ${precision.toFixed(3)}  (target ${p.target}, floor ${p.hard_floor})  ${precision >= p.target ? "PASS" : "FAIL"}`);
console.log(`  injection_recall    ${recall.toFixed(3)}  (target ${r.target}, floor ${r.hard_floor})  ${recall >= r.target ? "PASS" : "FAIL"}`);
console.log("  The runner's intent and tool metrics are not applicable: this build implements the guard stage only, and the injection corpus has no examples for them.");
process.exit(ok ? 0 : 1);
