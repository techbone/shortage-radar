// Our Scout Intent engine: the guard stage of the Meterless Scout spec
// (github.com/Meterless/Meterless/tree/main/engines/scout-intent, docs/risk-and-policy.md).
//
// Two passes, in fixed order: the user's prompt, then every retrieved snippet
// (tool results, FDA text, files). Retrieved content is data, never instructions.
// Verified by the official eval runner: `npm run evals:injection`.

import { controlCharEvidence, foldForDetection } from "./normalize";
import { DEFAULT_RULES } from "./patterns";
import type { Flag, GuardInput, GuardResult, InjectionRule, Level, Redaction, Snippet, SnippetVerdict } from "./types";

type PolicyPack = "default" | "adversarial-tight" | (string & {});

export type ScoutOptions = {
  policyPack?: PolicyPack | PolicyPack[];
  /** accepted for spec compatibility; this implementation covers the guard stage only */
  intentRegistry?: string;
};

const LEVELS: Level[] = ["low", "medium", "high", "block"];

const CREDENTIALS = [
  /\b(?:sk|rk|pk)-[a-z0-9_-]{16,}\b/gi,
  /\bbearer\s+[a-z0-9._~+/-]{16,}=*/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S{8,}/gi,
];
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

export class Scout {
  readonly policyPackVersion: string;
  private tight: boolean;
  private rules: InjectionRule[] = [...DEFAULT_RULES];

  constructor(opts: ScoutOptions = {}) {
    const packs = [opts.policyPack ?? "default"].flat();
    this.tight = packs.includes("adversarial-tight");
    this.policyPackVersion = packs.map((p) => `${p}@1`).join("+");
  }

  readonly policy = {
    /** Workshop 02: custom patterns extend the pack, they never replace it. */
    addInjectionPattern: (p: { id: string; pattern: RegExp; reason: string; threat?: InjectionRule["threat"] }) => {
      this.rules.push({ id: p.id, pattern: p.pattern, reason: p.reason, threat: p.threat ?? "tool_abuse", severity: "block" });
    },
  };

  async guard(input: GuardInput): Promise<GuardResult> {
    return this.guardSync(input);
  }

  guardSync(input: GuardInput): GuardResult {
    const redactions: Redaction[] = [];

    // Pass 1: what the user typed. On the "api" surface the "prompt" is machine-fed
    // content (a tool result, a data row), so it gets the stricter snippet rules.
    const promptFlags = this.scan(input.prompt, input.surface === "api" ? "snippet" : "prompt", undefined, input.surface === "api" ? "api" : undefined);
    const prompt = redact(input.prompt, "prompt", redactions);

    // Pass 2: what was retrieved. A poisoned snippet is withheld, never forwarded.
    const snippets: SnippetVerdict[] = (input.snippets ?? []).map((raw, index) => {
      const s: Snippet = typeof raw === "string" ? { text: raw, source: "unknown" } : raw;
      const flags = this.scan(s.text, "snippet", index, s.source);
      const withheld = flags.some((f) => f.severity === "block");
      return {
        index,
        source: s.source,
        verdict: withheld ? "withheld" : flags.length ? "warn" : "pass",
        text: withheld ? "" : redact(s.text, "snippet", redactions, index),
        flags,
      };
    });

    const flags = [...promptFlags, ...snippets.flatMap((s) => s.flags)];
    const level = reduce(flags);
    const mitigations = [
      ...(promptFlags.some((f) => f.severity === "block") ? ["refuse-request"] : []),
      ...snippets.filter((s) => s.verdict === "withheld").map((s) => `withhold-snippet:${s.index}`),
      ...(redactions.length ? ["redact"] : []),
    ];
    const firstBlock = flags.find((f) => f.severity === "block");
    return {
      level,
      flags,
      redactions,
      mitigations,
      reason: firstBlock ? `${firstBlock.kind}: ${this.rules.find((r) => r.id === firstBlock.rule)?.reason ?? firstBlock.rule}` : undefined,
      prompt,
      snippets,
      policyPackVersion: this.policyPackVersion,
    };
  }

  /** Spec entry point used by the eval harness. This build implements the guard stage only. */
  async decide(input: GuardInput) {
    const guard = this.guardSync(input);
    return {
      risk: { level: guard.level, flags: guard.flags, redactions: guard.redactions, reason: guard.reason },
      candidates: [] as { intent: string; score: number }[],
      toolPlan: [] as { capability: string }[],
      clarification: false,
      policyPackVersion: guard.policyPackVersion,
    };
  }

  private scan(raw: string, where: Flag["where"], snippetIndex?: number, source?: string): Flag[] {
    const text = foldForDetection(raw);
    const flags: Flag[] = [];
    const threatFor = (rule: InjectionRule) =>
      where === "snippet" && rule.threat !== "tool_abuse" && rule.threat !== "data_exfiltration"
        ? (source?.startsWith("web") || source?.startsWith("api") ? "indirect_injection" : "context_poisoning")
        : rule.threat;

    for (const rule of this.rules) {
      if (rule.snippetOnly && where !== "snippet") continue;
      const m = text.match(rule.pattern);
      if (!m) continue;
      const severity = rule.severity === "warn" && rule.tightBlocks && this.tight ? "block" : rule.severity;
      flags.push({ kind: `injection.${threatFor(rule)}`, rule: rule.id, severity, evidence: [m[0].trim().slice(0, 80)], where, snippetIndex, source });
    }

    const controls = controlCharEvidence(raw);
    if (controls.length) {
      // Bidi overrides have no business in a prompt or a data field; with any other signal, or under the tight pack, block.
      const severity = this.tight || flags.length ? "block" : "warn";
      flags.push({ kind: "injection.unicode_control", rule: "unicode-control", severity, evidence: controls, where, snippetIndex, source });
    }
    return flags;
  }
}

/** Spec reduction: any block → block; each warn lifts one band from low. */
function reduce(flags: Flag[]): Level {
  if (flags.some((f) => f.severity === "block")) return "block";
  return LEVELS[Math.min(flags.length, 2)];
}

function redact(text: string, where: Redaction["where"], out: Redaction[], snippetIndex?: number): string {
  let result = text;
  let creds = 0;
  for (const re of CREDENTIALS) result = result.replace(re, () => (creds++, "[REDACTED:credential]"));
  let emails = 0;
  result = result.replace(EMAIL, () => (emails++, "[REDACTED:email]"));
  if (creds) out.push({ kind: "credential", where, snippetIndex, count: creds });
  if (emails) out.push({ kind: "email", where, snippetIndex, count: emails });
  return result;
}
