// Meterless Runtime provider (Runtime 1.4, provider contract v4).
// OpenAI-compatible: POST /v1/chat/completions, GET /v1/models. Our primary and
// only AI provider; Nightshift routes each request to a lane (Nemotron for us).
// Settings come from env, falling back to .state/settings.json; the token is never logged.

import fs from "node:fs";
import path from "node:path";

export const PROVIDER = { id: "meterless", name: "Meterless Runtime" } as const;
export const APP_ID = "shortage-radar";
export const DEFAULT_BASE_URL = "http://127.0.0.1:8088/v1";
export const DEFAULT_MODEL = "meterless/auto";
const TIMEOUT_MS = 180_000; // a model load can take minutes
const PROBE_TIMEOUT_MS = 2_500;
const DISPOSITIONS = ["auto", "fast", "deep", "cheap", "local", "fusion"];

export type Status = "online" | "unauthorized" | "offline";
export type Settings = { baseUrl: string; token?: string; model: string };

/** Accept host, host:port, with or without scheme, /v1, /v1/chat/completions, /v1/models or /healthz → <origin>/v1. */
export function normalizeBaseUrl(input: string): string {
  let s = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  const url = new URL(s);
  let p = url.pathname.replace(/\/+$/, "");
  p = p.replace(/\/(?:chat\/completions|models|healthz)$/, "").replace(/\/healthz$/, "");
  p = p.replace(/(?:\/v1)+$/, "");
  return `${url.origin}${p}/v1`;
}

/** http://<host>:<port>/connect#k=<key>[&m=<model>][&n=<app>] → base URL + key (+ model). */
export function parseConnectLink(link: string): { baseUrl: string; token: string; model?: string } | null {
  try {
    const url = new URL(link.trim());
    if (!url.pathname.replace(/\/+$/, "").endsWith("/connect")) return null;
    const params = new URLSearchParams(url.hash.replace(/^#/, ""));
    const token = params.get("k");
    if (!token) return null;
    return { baseUrl: `${url.origin}/v1`, token, model: params.get("m") ?? undefined };
  } catch {
    return null;
  }
}

export function isMeterlessModel(id: string): boolean {
  return id.startsWith("meterless/");
}

/** Describe a routing mode id: meterless/<disposition>, meterless/<class>, meterless/<class>.<disposition>. Unknown meterless/* ids are kept. */
export function describeModel(id: string): { class?: string; disposition?: string } {
  const rest = id.replace(/^meterless\//, "");
  const [a, b] = rest.split(".");
  if (b) return { class: a, disposition: b };
  return DISPOSITIONS.includes(a) ? { disposition: a } : { class: a };
}

const SETTINGS_FILE = () => path.join(process.cwd(), ".state", "settings.json");

export function loadSettings(): Settings {
  let saved: Record<string, string> = {};
  try {
    saved = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf-8"));
  } catch {}
  const stateDirToken = () => {
    const dir = process.env.METERLESS_STATE_DIR;
    if (!dir) return undefined;
    try {
      return fs.readFileSync(path.join(dir, "proxy-token"), "utf-8").trim() || undefined;
    } catch {
      return undefined;
    }
  };
  return {
    baseUrl: normalizeBaseUrl(process.env.METERLESS_BASE_URL || saved.meterless_base_url || DEFAULT_BASE_URL),
    token: process.env.METERLESS_RUNTIME_TOKEN || saved.meterless_runtime_token || stateDirToken(),
    model: process.env.METERLESS_MODEL || saved.meterless_model || DEFAULT_MODEL,
  };
}

export function saveSettings(patch: Partial<Settings>): void {
  const file = SETTINGS_FILE();
  let saved: Record<string, string> = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {}
  if (patch.baseUrl) saved.meterless_base_url = normalizeBaseUrl(patch.baseUrl);
  if (patch.token) saved.meterless_runtime_token = patch.token;
  if (patch.model) saved.meterless_model = patch.model;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
}

export function maskToken(token?: string): string {
  return token ? `${token.slice(0, 3)}…redacted` : "(none)";
}

function headers(token: string | undefined, chat: boolean): Record<string, string> {
  if (!token || token === "rt-local") throw new MeterlessError("unauthorized", "Runtime token missing or the rt-local placeholder; paste the key from Nightshift's Console");
  return {
    Authorization: `Bearer ${token}`,
    "meterless-app": APP_ID,
    ...(chat ? { "meterless-scope": "user", "Content-Type": "application/json" } : {}),
  };
}

export class MeterlessError extends Error {
  constructor(public status: Status | "error", message: string, public httpStatus?: number) {
    super(message);
  }
}

/** GET /v1/models decides status: 401/403 unauthorized, 200 with meterless ids online, anything else offline. */
export async function checkStatus(settings: Pick<Settings, "baseUrl" | "token">, timeoutMs = PROBE_TIMEOUT_MS): Promise<{ status: Status; models: string[] }> {
  try {
    const token = settings.token && settings.token !== "rt-local" ? settings.token : "";
    const res = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${token}`, "meterless-app": APP_ID },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) return { status: "unauthorized", models: [] };
    if (!res.ok) return { status: "offline", models: [] };
    const body = (await res.json()) as { data?: { id: string }[] };
    const models = (body.data ?? []).map((m) => m.id).filter(isMeterlessModel);
    return { status: models.length ? "online" : "offline", models };
  } catch {
    return { status: "offline", models: [] };
  }
}

/** Try the known ports on loopback; return the first online or unauthorized runtime. */
export async function autoDetect(token?: string, ports = [8088, 8090, 8787, 11434], hosts = ["127.0.0.1", "localhost", "[::1]"]) {
  for (const port of ports) {
    for (const host of hosts) {
      const baseUrl = `http://${host}:${port}/v1`;
      const { status, models } = await checkStatus({ baseUrl, token });
      if (status !== "offline") return { baseUrl, status, models };
    }
  }
  return null;
}

export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: unknown[] };
export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type ChatResult = {
  content: string;
  /** the model the runtime reports it actually used (for the trace and the NVIDIA evidence) */
  model: string;
  requestedModel: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  latencyMs: number;
};

export async function chat(
  input: { messages: ChatMessage[]; model?: string; tools?: ToolSpec[]; temperature?: number; maxTokens?: number; timeoutMs?: number },
  settings: Settings = loadSettings(),
): Promise<ChatResult> {
  const model = input.model ?? settings.model;
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(settings.token, true),
      body: JSON.stringify({ model, messages: input.messages, tools: input.tools, temperature: input.temperature ?? 0.2, max_tokens: input.maxTokens }),
      signal: AbortSignal.timeout(input.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (err) {
    throw new MeterlessError("offline", `Meterless Runtime unreachable at ${settings.baseUrl}: ${(err as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) throw new MeterlessError("unauthorized", "Runtime token rejected", res.status);
  if (!res.ok) throw new MeterlessError("error", `Meterless Runtime ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  const body = (await res.json()) as any;
  const msg = body.choices?.[0]?.message ?? {};
  return {
    content: typeof msg.content === "string" ? msg.content : "",
    model: body.model ?? model,
    requestedModel: model,
    toolCalls: (msg.tool_calls ?? []).map((c: any) => ({ id: c.id, name: c.function?.name, arguments: c.function?.arguments ?? "{}" })),
    usage: body.usage,
    latencyMs: Date.now() - t0,
  };
}
