import { describe, expect, it } from "vitest";
import { isCombination, parseStrength, rankAlternates } from "../src/domain/alternates";

describe("strength parsing from real FDA presentations", () => {
  it.each([
    ["Lidocaine Hydrochloride, Injection, 20 mg/1 mL (NDC 76329-3390-1)", 20, 20],
    ["Lidocaine Hydrochloride, Injection, 200 mg/20 mL (NDC 83634-651-20)", 10, 200],
    ["Rocuronium Bromide, Injection, 100 mg/10 mL (10 mg/mL)", 10, 100],
    ["Sufentanil Citrate, Injection, 50 ug/1 mL (NDC 0409-3382-21)", 0.05, 0.05],
    ["Heparin Sodium, Injection, 1,000 Units/500 mL (2 Units/mL)", 2, 1000],
    ["Hydromorphone Hydrochloride, Injection, 0.5 mg/0.5 mL", 1, 0.5],
    ["Hydromorphone Hydrochloride, Injection, .5 mg/.5 mL", 1, 0.5],
    ["Sodium Bicarbonate, Injection, 50 mEq/50 mL (8.4%, 1 mEq/mL)", 1, 50],
    ["Lidocaine Hydrochloride, Injection, 20 mg/mL (NDC 55150-164-02)", 20, 20],
  ])("%s", (p, perMl, total) => {
    const s = parseStrength(p)!;
    expect(s.perMl).toBeCloseTo(perMl, 6);
    expect(s.total).toBeCloseTo(total, 6);
  });

  it("flags combinations", () => {
    expect(isCombination("Lidocaine Hydrochloride And Dextrose, Injection, 5 g/100 mL; .4 g/100 mL")).toBe(true);
    expect(isCombination("Xylocaine, Injection, .005 mg/1 mL; 15 mg/1 mL")).toBe(true);
    expect(isCombination("Lidocaine Hydrochloride, Injection, 20 mg/1 mL")).toBe(false);
  });
});

describe("ranking alternates", () => {
  const ours = { presentation: "Lidocaine Hydrochloride, Injection, 100 mg/5 mL (20 mg/mL) (NDC 0409-1323-05)" };
  const c = (ndc: string, presentation: string, company = "Acme") => ({ ndc, company, availability: "Available", presentation });

  it("never offers a different concentration or a premix as a swap", () => {
    const ranked = rankAlternates(ours, [
      c("1", "Lidocaine Hydrochloride, Injection, 10 mg/1 mL"),
      c("2", "Lidocaine Hydrochloride And Dextrose, Injection, 5 g/100 mL; .4 g/100 mL"),
      c("3", "Lidocaine Hydrochloride, Injection, 100 mg/5 mL"),
      c("4", "Lidocaine Hydrochloride, Injection, 20 mg/1 mL"),
    ]);
    expect(ranked.map((r) => [r.ndc, r.match])).toEqual([["3", "same-product"], ["4", "same-concentration"], ["1", "review"]]);
  });

  it("keeps preservative-free products from being swapped for preserved ones", () => {
    const pf = { presentation: "Lidocaine Hydrochloride Preservative Free, Injection, 20 mg/1 mL" };
    const ranked = rankAlternates(pf, [c("5", "Lidocaine Hydrochloride, Injection, 20 mg/1 mL"), c("6", "Lidocaine Hydrochloride Preservative Free, Injection, 20 mg/1 mL")]);
    expect(ranked.find((r) => r.ndc === "5")).toMatchObject({ match: "review", reason: "ours is preservative-free; this one is not" });
    expect(ranked.find((r) => r.ndc === "6")?.match).toBe("same-product");
  });
});
