// The default injection pattern pack. Patterns run on folded text (lowercase,
// zero-width stripped, confusables mapped). Precision first: every block rule
// must stay silent on all real FDA free-text fields (tests/scout-intent.test.ts).

import type { InjectionRule } from "./types";

const VERB_OVERRIDE = "(?:ignore|disregard|forget|override|bypass|skip|abandon|drop)";
const TARGETS = "(?:instructions?|rules?|prompts?|directives?|guidelines?|polic(?:y|ies)|guardrails?|constraints?|system message|context)";
const SECRETS = "(?:system prompt|hidden prompt|initial prompt|your instructions|api[ _-]?keys?|credentials?|secrets?|passwords?|access tokens?|bearer tokens?|auth tokens?|env(?:ironment)? var(?:iable)?s?|\\.env\\b|private keys?)";

export const DEFAULT_RULES: InjectionRule[] = [
  // instruction_override
  { id: "override-targets", threat: "instruction_override", severity: "block", reason: "tells the model to drop its instructions",
    pattern: new RegExp(`\\b${VERB_OVERRIDE}\\b[^.\\n]{0,40}\\b${TARGETS}\\b`) },
  { id: "override-previous", threat: "instruction_override", severity: "block", reason: "tells the model to ignore what came before",
    pattern: /\b(?:ignore|disregard|forget)\s+(?:all\s+|everything\s+)?(?:the\s+)?(?:previous|prior|above|earlier|preceding)(?=\s*(?:[,.;:!]|$)|\s+(?:and|then|text|content|messages?|context|ones|lines)\b)/ },
  // "disregard previous communication" is real manufacturer phrasing: only bare "previous/above" or a model-facing noun counts.
  { id: "override-principal", threat: "instruction_override", severity: "block", reason: "tells the model to disregard its user or operator",
    pattern: /\b(?:ignore|disregard)\s+(?:the\s+|your\s+)?(?:user|operator|developer|pharmacist)\b/ },
  { id: "new-instructions", threat: "instruction_override", severity: "warn", tightBlocks: true, reason: "announces replacement instructions",
    pattern: /\b(?:new|updated|real|actual)\s+(?:instructions|rules|task|directive)s?\s*:/ },

  { id: "smuggle-via-transform", threat: "instruction_override", severity: "block", reason: "smuggles instructions through a translate or decode step",
    pattern: /\b(?:translate|decode|decrypt|unscramble|reverse)\b[^\n]{0,80}\b(?:and|then)\s+(?:then\s+)?(?:follow|execute|obey|do what it says|run|carry out|act on)\b/ },
  { id: "override-multilingual", threat: "instruction_override", severity: "block", reason: "instruction override in French, Spanish, Portuguese, German or Italian",
    pattern: /\b(?:ignorez|ignorer|ignore[sz]?|ignora|ignorar|ignoriere|ignorieren|vergiss)\b[^.\n]{0,40}\b(?:instructions|instrucciones|instruções|anweisungen|istruzioni|consignes|r[eè]gles|reglas|regeln)\b/ },
  { id: "exfil-multilingual", threat: "data_exfiltration", severity: "block", reason: "secret request in French, Spanish, Portuguese, German or Italian",
    pattern: /\b(?:r[ée]v[èe]le\w*|revela\w*|muestra\w*|zeige?\w*|mostra\w*|donne[sz]?)\b[^.\n]{0,30}\b(?:mot de passe|contraseñas?|senhas?|passw[oö]rter?|cl[ée]s? (?:d'?)?api|prompt (?:syst[eè]me|del sistema))\b/ },

  { id: "override-paraphrase", threat: "instruction_override", severity: "block", reason: "paraphrased instruction override",
    pattern: /\b(?:pay no attention to|set aside|put aside|stop following)\b[^.\n]{0,40}\b(?:told|guidance|instructions?|rules?|earlier|before|previous|prior)\b|\bfrom now on\b[^.\n]{0,30}\b(?:respond|reply|answer|output|say|you (?:will|must|are))\b|\binstead of (?:your|the) (?:\w+ )?(?:task|job|instructions?|assignment)\b/ },
  { id: "override-assignment", threat: "instruction_override", severity: "warn", tightBlocks: true, reason: "key=value override smuggled into content",
    pattern: /\b(?:override|force|set)\s*:\s*(?:status|availability|state|level|risk|verdict)\s*=/ },

  // role_confusion
  { id: "role-markup", threat: "role_confusion", severity: "block", reason: "chat-role markup inside content",
    pattern: /<\/?\s*(?:system|assistant|user|developer|tool|instructions?)\s*>|\[\/?inst\]|<<\/?sys>>|<\|im_(?:start|end)\|>|<\|(?:system|assistant|user)\|>/ },
  { id: "role-you-are-now", threat: "role_confusion", severity: "block", reason: "tries to give the model a new role",
    pattern: /\byou are now\b[^.\n]{0,40}\b(?:admin|administrator|root|unrestricted|unfiltered|jailbroken|developer|dan|superuser|system|database administrator|in (?:\w+ )?mode)\b|\byou are (?:an?\s+)?(?:unrestricted|unfiltered|jailbroken)\b/ },
  { id: "role-mode", threat: "role_confusion", severity: "block", reason: "asks for a privileged mode",
    pattern: /\b(?:developer|dev|god|jailbreak|unrestricted|maintenance|debug|sudo)\s+mode\b/ },
  { id: "role-pretend", threat: "role_confusion", severity: "block", reason: "asks the model to impersonate the system",
    pattern: /\b(?:pretend (?:to be|you are)|act as|roleplay as)\s+(?:the\s+|an?\s+)?(?:system|admin|administrator|developer|root|operator)\b/ },
  { id: "role-line-prefix", threat: "role_confusion", severity: "warn", tightBlocks: true, reason: "a line posing as a system message",
    pattern: /(?:^|\n)\s*(?:system|assistant)\s*(?:message|prompt|override)?\s*:\s*\S|(?:^|\n)\s*#{1,6}\s*system\b|\bsystem override\b/ },

  // data_exfiltration
  { id: "exfil-secrets", threat: "data_exfiltration", severity: "block", reason: "asks for secrets or the system prompt",
    pattern: new RegExp(`\\b(?:reveal|print|show|dump|leak|output|display|list|send|email|exfiltrate|share|return|repeat|tell me)\\b[^.\\n]{0,40}\\b${SECRETS}`) },
  { id: "exfil-to-address", threat: "data_exfiltration", severity: "block", reason: "asks to send data to an outside address",
    pattern: /\b(?:email|send|forward|post|upload|transmit|mail)\b[^\n]{0,80}\b(?:to|at)\s+[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { id: "exfil-bulk-records", threat: "data_exfiltration", severity: "block", reason: "asks to email records in bulk",
    pattern: /\b(?:email|send|forward)\s+(?:every|all|each)\s+\w+[^.\n]{0,40}\b(?:records?|data|pii|details|list)\b/ },

  // tool_abuse: anything outside the agent's read-only capability set
  { id: "tool-shell", threat: "tool_abuse", severity: "block", reason: "shell or code execution outside any capability",
    pattern: /\brm\s+-rf\b|\/etc\/(?:passwd|shadow)|\b(?:curl|wget)\s+https?:|\bbash\s+-c\b|\bpowershell\b|\b(?:exec|eval|os\.system|subprocess)\s*\(|\b(?:use|call|invoke|run|open)\s+(?:the\s+)?(?:shell|terminal|command line)\b/ },
  { id: "tool-sql-write", threat: "tool_abuse", severity: "block", reason: "SQL that writes or drops data; the agent is read-only",
    pattern: /\b(?:drop|truncate|alter)\s+(?:the\s+)?(?:\w+\s+){0,2}(?:table|database|schema)s?\b|\bdelete\s+from\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bgrant\s+(?:all|select|insert|update|delete)\b/ },
  { id: "tool-privilege", threat: "tool_abuse", severity: "block", reason: "asks for elevated access",
    pattern: /\bgrant\s+(?:me\s+|us\s+|the user\s+)?(?:admin|root|superuser|full access|access|privileges?)\b|\bescalate\s+(?:my\s+)?privileges?\b/ },
  { id: "tool-internal", threat: "tool_abuse", severity: "block", reason: "references an internal tool outside the capability set",
    pattern: /\binternal_[a-z_]+\b|\badmin[_ ]panel\b/ },

  // hidden directives in retrieved content
  { id: "hidden-comment", threat: "context_poisoning", severity: "block", reason: "instructions hidden in a markup comment",
    pattern: /<!--[\s\S]{0,400}?\b(?:system|assistant|ignore|instruction|email|send|you must|you are)\b[\s\S]{0,400}?-->/ },
  { id: "addressed-to-model", threat: "context_poisoning", severity: "warn", tightBlocks: true, snippetOnly: true, reason: "content that addresses the AI directly",
    pattern: /\b(?:note|message|instructions?|attention|important)\s*(?:to|for)?\s*(?:the\s+)?(?:ai|assistant|model|llm|agent|chatbot|language model)\b|\b(?:ai|assistant|model|agent),?\s+(?:you must|you should|please)\b|\bthe (?:ai|assistant|model|agent|llm)\s+(?:must|should|will now)\b|\b(?:if you are|as) an? (?:ai|language model|assistant|llm)\b/ },
  { id: "steer-recommendation", threat: "context_poisoning", severity: "warn", tightBlocks: true, snippetOnly: true, reason: "content that tries to steer what the agent recommends",
    pattern: /\b(?:always|only|must)\s+(?:recommend|suggest|choose|select)\b|\b(?:recommend|suggest)\s+(?:only|exclusively)\b|\bregardless of (?:the )?(?:data|availability|stock|price)\b|\btell the (?:user|pharmacist|buyer)\b/ },
  { id: "encoded-blob", threat: "indirect_injection", severity: "warn", tightBlocks: true, snippetOnly: true, reason: "long encoded blob in content",
    pattern: /[a-z0-9+/]{120,}={0,2}/ },
];
