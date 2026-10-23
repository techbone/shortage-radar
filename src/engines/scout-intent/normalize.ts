// Text normalization for detection only. Attackers split trigger words with
// zero-width characters, flip them with bidi overrides, or swap Latin letters
// for Cyrillic/Greek look-alikes; detection runs on the folded form.

const BIDI = /[‪-‮⁦-⁩]/g;
const ZERO_WIDTH = /[​-‍⁠﻿­]/g;
/** literal escape text such as "‮" written into a prompt */
const ESCAPED_CONTROL = /\\u(202[a-e]|206[6-9]|200[b-d]|2060|feff)/gi;

const CONFUSABLES: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", һ: "h", ԁ: "d", ɡ: "g",
  А: "a", В: "b", Е: "e", К: "k", М: "m", Н: "h", О: "o", Р: "p", С: "c", Т: "t", Х: "x",
  α: "a", ε: "e", ι: "i", ο: "o", ρ: "p", υ: "u", ν: "v", κ: "k",
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");

export function controlCharEvidence(raw: string): string[] {
  const found = new Set<string>();
  for (const m of raw.matchAll(BIDI)) found.add(`U+${m[0].codePointAt(0)!.toString(16).toUpperCase()}`);
  for (const m of raw.matchAll(ESCAPED_CONTROL)) found.add(m[0]);
  return [...found];
}

export function foldForDetection(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(ESCAPED_CONTROL, " ")
    .replace(BIDI, " ")
    .replace(ZERO_WIDTH, "")
    .toLowerCase() // before the confusable map, so capital look-alikes (І, О) fold too
    .replace(CONFUSABLE_RE, (c) => CONFUSABLES[c] ?? c)
    .replace(/[ \t]+/g, " ");
}
