// Shapes for our Scout Intent guard stage (Meterless spec: docs/risk-and-policy.md).

export type ThreatClass =
  | "instruction_override"
  | "role_confusion"
  | "data_exfiltration"
  | "tool_abuse"
  | "context_poisoning"
  | "indirect_injection"
  | "unicode_control";

export type Level = "low" | "medium" | "high" | "block";

export type Flag = {
  /** e.g. "injection.instruction_override" */
  kind: string;
  rule: string;
  severity: "block" | "warn";
  evidence: string[];
  where: "prompt" | "snippet";
  snippetIndex?: number;
  source?: string;
};

export type Redaction = { kind: "credential" | "email"; where: "prompt" | "snippet"; snippetIndex?: number; count: number };

export type Snippet = { text: string; source: string };

export type GuardInput = {
  prompt: string;
  user?: { id?: string; role?: string };
  surface?: string;
  /** retrieved / tool / file content; checked in the second pass */
  snippets?: (string | Snippet)[];
};

export type SnippetVerdict = {
  index: number;
  source: string;
  verdict: "pass" | "warn" | "withheld";
  /** redacted text, safe to place in a prompt; empty when withheld */
  text: string;
  flags: Flag[];
};

export type GuardResult = {
  level: Level;
  flags: Flag[];
  redactions: Redaction[];
  mitigations: string[];
  reason?: string;
  /** the prompt with credentials redacted */
  prompt: string;
  snippets: SnippetVerdict[];
  policyPackVersion: string;
};

export type InjectionRule = {
  id: string;
  threat: ThreatClass;
  pattern: RegExp;
  severity: "block" | "warn";
  /** warn rules that block under the adversarial-tight pack */
  tightBlocks?: boolean;
  /** only checked on snippets (retrieved content), not on the user's own prompt */
  snippetOnly?: boolean;
  reason: string;
};
