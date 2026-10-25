// POST /api/run (also POST /run): one sweep, JSON in and JSON out.
// Add ?stream=1 (or Accept: application/x-ndjson) to get trace events as they happen,
// followed by the final result, one JSON object per line.

import { runSweep, type RunInput } from "../../../src/agent/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bad = (message: string) =>
  Response.json({ status: "error", error: { type: "BadRequest", message, recoverable: true } }, { status: 400 });

export async function POST(req: Request) {
  let body: RunInput;
  try {
    body = (await req.json()) as RunInput;
  } catch {
    return bad("Body must be JSON, e.g. {\"input\": {\"query\": \"Give me the morning brief\"}}");
  }
  if (!body || typeof body !== "object") return bad("Body must be a JSON object");
  body.input ??= {};
  if (typeof body.input.query !== "undefined" && typeof body.input.query !== "string") return bad("input.query must be a string");
  if (body.input.query && body.input.query.length > 2000) return bad("input.query is limited to 2000 characters");
  if (body.decisions && (!Array.isArray(body.decisions) || body.decisions.length > 50)) return bad("decisions must be an array of at most 50");

  const wantsStream = new URL(req.url).searchParams.get("stream") === "1" || (req.headers.get("accept") ?? "").includes("x-ndjson");
  if (!wantsStream) {
    const result = await runSweep(body, { onTrace: undefined });
    return Response.json(result, { status: result.status === "error" ? 502 : 200 });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const result = await runSweep(body, { onTrace: (event) => send({ type: "trace", event }) });
        send({ type: "result", result });
      } catch (err) {
        send({ type: "result", result: { status: "error", error: { type: "Error", message: (err as Error).message, recoverable: false } } });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
