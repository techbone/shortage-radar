// GET /api/status: what this server can do right now. The UI picks Live or Sample from it.
// Never returns a secret, only whether one is set and whether the services answer.

import { checkStatus, loadSettings } from "../../../src/adapters/meterless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function zetarisUp(): Promise<boolean> {
  const key = process.env.ZETARIS_API_KEY;
  if (!key) return false;
  try {
    const base = (process.env.ZETARIS_REST_URL ?? "http://localhost:8888/api/v1.0").replace(/\/+$/, "");
    const res = await fetch(`${base}/datasource/datasources`, {
      headers: { Authorization: `Bearer ${key}`, "X-Org-ID": process.env.ZETARIS_ORG_ID ?? "1", "X-Request-ID": crypto.randomUUID() },
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const settings = loadSettings();
  const [zetaris, nightshift] = await Promise.all([zetarisUp(), settings.token ? checkStatus(settings, 2500) : Promise.resolve({ status: "unauthorized" as const, models: [] })]);
  return Response.json({
    live_available: zetaris && nightshift.status === "online",
    zetaris: zetaris ? "online" : process.env.ZETARIS_API_KEY ? "offline" : "not configured",
    nightshift: nightshift.status === "unauthorized" && !settings.token ? "not configured" : nightshift.status,
    routing_modes: nightshift.models,
    sample_available: true,
    hospital: "Northwind General (fictional)",
  });
}
