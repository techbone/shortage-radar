// Headless entry point: run one sweep and print the JSON result.
//   npx tsx run.ts input_examples/example_1.json
//   npx tsx run.ts '{"input":{"query":"anesthesia only"}}'
//   SAMPLE_MODE=true npx tsx run.ts input_examples/example_1.json   (no Zetaris, Nightshift or network)

import fs from "node:fs";
import { runSweep, type RunInput } from "./src/agent/run";

const arg = process.argv[2] ?? "{}";
const req: RunInput = JSON.parse(fs.existsSync(arg) ? fs.readFileSync(arg, "utf-8") : arg);
req.input ??= {};
const result = await runSweep(req);
const out = process.argv[3];
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
process.stdout.write(`\n${JSON.stringify(result, null, 2)}\n`);
process.exit(result.status === "error" ? 1 : 0);
