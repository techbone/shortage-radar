// "Buy instead" must be the same drug at the same concentration. FDA presentations
// write strength many ways ("20 mg/1 mL", "100 mg/10 mL (10 mg/mL)", "50 ug/1 mL",
// "1,000 Units/500 mL", ".5 mg/.5 mL"); we normalize to amount per mL and refuse to
// call anything a swap that differs in concentration, ingredients or preservative.

export type Strength = { perMl: number; total: number; unit: "mg" | "mEq" | "units" | "%"; volumeMl: number };

const UNIT: Record<string, { unit: Strength["unit"]; factor: number }> = {
  g: { unit: "mg", factor: 1000 }, mg: { unit: "mg", factor: 1 }, mcg: { unit: "mg", factor: 0.001 }, ug: { unit: "mg", factor: 0.001 }, µg: { unit: "mg", factor: 0.001 },
  meq: { unit: "mEq", factor: 1 }, units: { unit: "units", factor: 1 }, unit: { unit: "units", factor: 1 }, "%": { unit: "%", factor: 1 },
};

const num = (s: string) => Number(s.replace(/,/g, ""));

export function parseStrength(presentation: string): Strength | null {
  const m = presentation.match(/(\d[\d,]*\.?\d*|\.\d+)\s*(g|mg|mcg|ug|µg|mEq|Units?|%)\s*\/\s*(\d[\d,]*\.?\d*|\.\d+)?\s*(mL|L)\b/i);
  if (!m) return null;
  const u = UNIT[m[2].toLowerCase()];
  if (!u) return null;
  const amount = num(m[1]) * u.factor;
  const volumeMl = (m[3] ? num(m[3]) : 1) * (m[4].toLowerCase() === "l" ? 1000 : 1);
  if (!amount || !volumeMl) return null;
  return { perMl: amount / volumeMl, total: amount, unit: u.unit, volumeMl };
}

export const isCombination = (presentation: string): boolean =>
  presentation.includes(";") || /\b(and|with)\b/i.test(presentation.split(",")[0]);

export const isPreservativeFree = (presentation: string): boolean => /preservative[- ]free|\bpf\b/i.test(presentation);

export type Candidate = { ndc: string; company: string; availability: string; presentation: string };

export type Match = Candidate & {
  match: "same-product" | "same-concentration" | "review";
  reason: string;
  strength: Strength | null;
};

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.01;

/** Rank candidates for one of our products. Combinations are dropped; nothing with a different concentration is a swap. */
export function rankAlternates(ours: { presentation: string }, candidates: Candidate[]): Match[] {
  const mine = parseStrength(ours.presentation);
  const minePf = isPreservativeFree(ours.presentation);
  const out: Match[] = [];
  for (const c of candidates) {
    if (isCombination(c.presentation)) continue;
    const s = parseStrength(c.presentation);
    let match: Match["match"] = "review";
    let reason = "strength could not be read; check the label";
    if (mine && s && mine.unit === s.unit) {
      if (close(mine.perMl, s.perMl)) {
        match = close(mine.total, s.total) ? "same-product" : "same-concentration";
        reason = match === "same-product" ? "same concentration and container size" : `same concentration, ${s.volumeMl} mL container instead of ${mine.volumeMl} mL`;
      } else {
        reason = `different concentration (${fmt(s)} vs ours ${fmt(mine)})`;
      }
    }
    if (match !== "review" && minePf && !isPreservativeFree(c.presentation)) {
      match = "review";
      reason = "ours is preservative-free; this one is not";
    }
    out.push({ ...c, match, reason, strength: s });
  }
  const order = { "same-product": 0, "same-concentration": 1, review: 2 };
  return out.sort((a, b) => order[a.match] - order[b.match] || a.company.localeCompare(b.company) || a.ndc.localeCompare(b.ndc));
}

function fmt(s: Strength): string {
  const v = s.unit === "mg" && s.perMl < 1 ? `${+(s.perMl * 1000).toFixed(3)} mcg` : `${+s.perMl.toFixed(3)} ${s.unit}`;
  return `${v}/mL`;
}
