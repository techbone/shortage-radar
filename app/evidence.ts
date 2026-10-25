// What the Engines tab shows. Every figure here must appear in the evidence file
// it points to; tests/evidence.test.ts fails if the two drift apart.

export type EngineEvidence = {
  engine: string;
  does: string;
  feature: string;
  result: string;
  detail: string;
  proof: string[];
  file: string;
  command: string;
  code: string;
};

export const ENGINES: EngineEvidence[] = [
  {
    engine: "World Model",
    does: "Replays every saved FDA snapshot and keeps each drug's status history, so the agent knows what changed and what a status was on any date.",
    feature: "“What changed since the last update”, status history in the evidence drawer",
    result: "8/8",
    detail: "official conformance checks",
    proof: ["8/8 checks passed", "PASS idem-001", "PASS bitemp-001"],
    file: "docs/evidence/world-model-conformance.md",
    command: "npm run conformance:wm",
    code: "src/engines/world-model",
  },
  {
    engine: "H-MEM",
    does: "Stores what the buyer decided, with source and confidence. A handled item stays out of tomorrow's brief unless the FDA status moves again.",
    feature: "Decision buttons, the “Handled” list, items that come back when status changes",
    result: "13/13",
    detail: "official conformance checks",
    proof: ["13/13 checks passed", "PASS la-001", "PASS cg-001"],
    file: "docs/evidence/hmem-conformance.md",
    command: "npm run conformance:hmem",
    code: "src/engines/hmem",
  },
  {
    engine: "Scout Intent",
    does: "Screens every third-party text (FDA notes, database rows) for prompt injection before a model sees it, and withholds only the poisoned field.",
    feature: "Guard step before every Nemotron call",
    result: "1.000 / 0.980",
    detail: "injection precision / recall on 2,316 cases (targets 0.95 / 0.90)",
    proof: ["2,316 examples", "injection_precision | **1.000**", "injection_recall | **0.980**", "**0 blocked**"],
    file: "docs/evidence/scout-injection-evals.md",
    command: "npm run evals:injection",
    code: "src/engines/scout-intent",
  },
];

export const LIMITS = [
  "The hospital is fictional: real NDCs, invented stock levels.",
  "Scout is pattern based. On 6 attacks written after its rules it caught 0; 5 were then patched, Polish still gets through.",
  "The agent reports exposure, runway and swaps. It does not predict shortages: recalls did not (0.7-0.9x baseline over 142 shortages).",
];
