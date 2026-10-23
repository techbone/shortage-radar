// Merge banding for name-keyed entities (spec: entity resolution).
//   similarity >= 0.85 → auto-merge (0.85 exactly merges)
//   0.82 <= s < 0.85   → operator review (0.82 exactly queues)
//   s < 0.82           → new entity
//
// Drug entities never go through this path: they are keyed by NDC / normalized
// substance, because look-alike drug names are a known source of medication errors.

import { normalizeName } from "./ids";

export type ResolutionDecision = "auto-merge" | "review" | "new";

export function decide(similarity: number, autoMergeAt = 0.85, reviewAt = 0.82): ResolutionDecision {
  if (similarity >= autoMergeAt) return "auto-merge";
  if (similarity >= reviewAt) return "review";
  return "new";
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function nameSimilarity(rawA: string, rawB: string): number {
  const a = normalizeName(rawA);
  const b = normalizeName(rawB);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}
