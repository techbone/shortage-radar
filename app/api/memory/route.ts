// DELETE /api/memory: forget the buyer's saved decisions (the live H-MEM store), so a demo can start clean.

import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  fs.rmSync(path.join(process.cwd(), ".state", "hmem"), { recursive: true, force: true });
  return Response.json({ status: "ok" });
}
