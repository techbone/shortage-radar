import { describe, expect, it } from "vitest";
import { critique, fallbackItem, parseJsonReply, type Item } from "../src/agent/brief";

const item: Item = {
  ndc: "0409-6695-01", generic: "etomidate", presentation: "Amidate, Injection, 2 mg/1 mL", category: "Anesthesia", critical: true,
  wholesaler: "Cardinal Health", onHand: 192, dailyUsage: 32, daysOnHand: 6, state: "unavailable",
  change: { from: "available", to: "unavailable", at: "2026-10-21T00:00:00.000Z", direction: "worse" },
  history: [], handling: { status: "new" },
  swaps: [{ ndc: "55150-221-10", company: "Eugia US LLC", availability: "Available", presentation: "Etomidate, Injection, 2 mg/1 mL", match: "same-concentration", reason: "same concentration", strength: null }],
  review: [], evidence: [{ id: "exp:0409-6695-01", kind: "zetaris", label: "stock", record: {} }, { id: "wm:0409-6695-01", kind: "world-model", label: "history", record: {} }, { id: "alt:55150-221-10", kind: "zetaris", label: "alternate", record: {} }],
  priorityScore: 90,
};
const good = { ndc: item.ndc, priority: "act-today" as const, headline: "Etomidate unavailable, 6 days on hand", why: "FDA moved it from available to unavailable.", action: "Buy the Eugia NDC.", buy_instead: "55150-221-10", citations: ["exp:0409-6695-01", "wm:0409-6695-01", "alt:55150-221-10"] };

describe("the Critic", () => {
  it("accepts a brief that matches the evidence", () => {
    expect(critique({ headline: "x", summary: "y", items: [good] }, [item])).toEqual([]);
  });

  it("rejects an invented NDC, a fake citation, wrong day counts and predictions", () => {
    const bad = { ...good, buy_instead: "12345-678-90", citations: ["exp:0409-6695-01", "made-up"], headline: "Etomidate: 9 days on hand", why: "Supply will run out nationally." };
    const rules = critique({ headline: "x", summary: "y", items: [bad] }, [item]).map((v) => v.rule).sort();
    expect(rules).toEqual(["bad-citation", "prediction", "unsafe-swap", "wrong-days"]);
  });

  it("flags items the Writer skipped or made up", () => {
    const rules = critique({ headline: "x", summary: "y", items: [{ ...good, ndc: "0000-0000-00" }] }, [item]).map((v) => v.rule).sort();
    expect(rules).toEqual(["missing-item", "unknown-item"]);
  });

  it("the deterministic fallback passes its own Critic", () => {
    expect(critique({ headline: "x", summary: "y", items: [fallbackItem(item)] }, [item])).toEqual([]);
  });

  it("parses JSON wrapped in fences, prose or think tags", () => {
    expect(parseJsonReply<{ a: number }>("<think>hmm</think>Sure!\n```json\n{\"a\": 1}\n```")).toEqual({ a: 1 });
  });
});

describe("the Critic on recommendations", () => {
  it("requires a recommended NDC to cite its own alternate record", () => {
    const uncited = { ...good, citations: ["exp:0409-6695-01"] };
    expect(critique({ headline: "x", summary: "y", items: [uncited] }, [item]).map((v) => v.rule)).toEqual(["uncited-swap"]);
  });
});
