import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HMEM } from "../src/engines/hmem";
import { handlingFor, recordDecision } from "../src/domain/decisions";

describe("buyer decisions in H-MEM", () => {
  it("quiets a handled item, and brings it back when the FDA status moves", () => {
    const hmem = new HMEM();
    expect(handlingFor(hmem, "0409-6695-01", "unavailable").status).toBe("new");

    recordDecision(hmem, { ndc: "0409-6695-01", generic: "etomidate", action: "bought-alternate", alternateNdc: "55150-0221-10", stateAtDecision: "unavailable", by: "buyer-1" });
    expect(handlingFor(hmem, "0409-6695-01", "unavailable").status).toBe("handled");

    const later = handlingFor(hmem, "0409-6695-01", "limited");
    expect(later).toMatchObject({ status: "changed-since-decision", was: "unavailable", now: "limited" });
  });

  it("remembers across sessions (a new process reads the same files)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hmem-"));
    const first = new HMEM({ directory: dir, namespace: "northwind" });
    recordDecision(first, { ndc: "0409-3815-12", generic: "morphine", action: "do-not-substitute", stateAtDecision: "limited", note: "P&T committee: keep 1 mg/mL concentration only", by: "buyer-1" });

    const second = new HMEM({ directory: dir, namespace: "northwind" });
    expect(handlingFor(second, "0409-3815-12", "limited").status).toBe("handled");
    const recall = second.query("morphine substitution decision", { entities: ["0409-3815-12"], threshold: 0.2 });
    expect(recall.memories[0].memory.content).toContain("decided not to substitute");
    expect(recall.context).toContain("[long_term]");
    expect(second.ledger.all().map((e) => e.action)).toContain("create");
  });

  it("a newer contradicting decision supersedes the old one instead of deleting it", () => {
    const hmem = new HMEM();
    const a = recordDecision(hmem, { ndc: "0409-1323-05", generic: "lidocaine", action: "do-not-substitute", stateAtDecision: "limited", by: "buyer-1" });
    const b = hmem.add({ content: a.content.replace("decided not to substitute", "bought an alternate"), source: "user_correction", supersedes: a.id, tags: ["decision"], type: "factual", layer: "long_term" });
    expect(hmem.store.get(a.id)?.supersededBy).toBe(b.id);
    expect(hmem.store.get(a.id)).toBeDefined();
  });
});
