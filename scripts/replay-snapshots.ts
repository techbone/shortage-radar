// Replay every saved FDA snapshot, in date order, into a fresh World Model and
// print what changed between consecutive days.
//   npm run replay

import path from "node:path";
import { WorldModel } from "../src/engines/world-model";
import { ingestShortageSnapshot, listSnapshots, loadSnapshot } from "../src/domain/fda-shortages";

const world = new WorldModel({ namespace: "replay" });

for (const file of listSnapshots()) {
  const t0 = performance.now();
  const report = await ingestShortageSnapshot(world, loadSnapshot(file));
  const ms = Math.round(performance.now() - t0);
  const label = report.baseline ? "baseline" : `${report.changes.length} changes`;
  console.log(`[INFO] ${path.basename(file)}: ${report.products} products, ${report.eventsAppended} events, ${label} (${ms} ms)`);
  if (report.baseline) continue;
  for (const c of report.changes.slice(0, 25)) {
    console.log(`       ${c.ndc.padEnd(14)} ${c.slot.padEnd(16)} ${String(c.from).padEnd(12)} → ${c.to.padEnd(12)} ${c.generic.slice(0, 50)}`);
  }
  if (report.changes.length > 25) console.log(`       … ${report.changes.length - 25} more`);
}
console.log(`[INFO] world: ${world.eventCount()} events, ${world.audit().length} audit entries`);
