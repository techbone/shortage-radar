// Buyer decisions as H-MEM memories. A decision quiets an item until the FDA
// status moves again: handled items stay out of tomorrow's brief, and an item
// whose status changed after the decision comes back with the reason.

import type { HMEM, Memory } from "../engines/hmem";
import type { ShortageState } from "./fda-shortages";

export type DecisionAction = "bought-alternate" | "do-not-substitute" | "allocated" | "monitor";

export type DecisionInput = {
  ndc: string;
  generic: string;
  action: DecisionAction;
  /** FDA state of the product when the buyer decided */
  stateAtDecision: ShortageState;
  alternateNdc?: string;
  note?: string;
  by: string;
};

const PHRASE: Record<DecisionAction, string> = {
  "bought-alternate": "bought an alternate",
  "do-not-substitute": "decided not to substitute",
  allocated: "set up an allocation",
  monitor: "chose to monitor",
};

export function recordDecision(hmem: HMEM, d: DecisionInput): Memory {
  const alt = d.alternateNdc ? ` (NDC ${d.alternateNdc})` : "";
  const content = `For ${d.generic} NDC ${d.ndc}, the buyer ${PHRASE[d.action]}${alt} while it was ${d.stateAtDecision}.${d.note ? ` Note: ${d.note}` : ""}`;
  return hmem.add({
    content,
    source: `buyer:${d.by}`,
    type: "factual",
    layer: "long_term",
    confidence: 0.9,
    tags: ["decision", d.action, d.generic.toLowerCase()],
    entities: [{ type: "ndc", value: d.ndc }, { type: "ingredient", value: d.generic.toLowerCase() }, ...(d.alternateNdc ? [{ type: "ndc", value: d.alternateNdc }] : [])],
    domain: "pharmacy",
    provenance: { origin: "user", label: `decision by ${d.by}` },
    data: { ...d },
  });
}

export type Handling =
  | { status: "new" }
  | { status: "handled"; decision: Memory }
  | { status: "changed-since-decision"; decision: Memory; was: ShortageState; now: ShortageState };

/** Latest live decision for this NDC, compared with the product's current state. */
export function handlingFor(hmem: HMEM, ndc: string, currentState: ShortageState): Handling {
  const decisions = hmem.store
    .byTag("decision")
    .filter((m) => !m.supersededBy && m.entities.some((e) => e.type === "ndc" && e.value === ndc) && (m.data as DecisionInput | undefined)?.ndc === ndc)
    .sort((a, b) => b.timestamp - a.timestamp);
  const latest = decisions[0];
  if (!latest) return { status: "new" };
  const was = (latest.data as DecisionInput).stateAtDecision;
  return was === currentState ? { status: "handled", decision: latest } : { status: "changed-since-decision", decision: latest, was, now: currentState };
}
