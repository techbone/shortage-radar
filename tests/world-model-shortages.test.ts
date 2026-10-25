import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { WorldModel } from "../src/engines/world-model";
import {
  ingestShortageSnapshot, listSnapshots, loadSnapshot, productId, shortageStateOf, stateHistory,
  type FdaShortageRecord, type FdaSnapshot,
} from "../src/domain/fda-shortages";

const real = loadSnapshot(listSnapshots()[0]);

/** A believable next-day feed: one NDC goes Limited → Unavailable, one drops off, one is new. */
function nextDay(base: FdaSnapshot) {
  const results = structuredClone(base.results);
  const worsened = results.find((r) => r.status === "Current" && r.availability === "Limited Availability" && results.filter((x) => x.package_ndc === r.package_ndc).length === 1)!;
  worsened.availability = "Unavailable";
  worsened.update_date = "10/23/2026";
  const removedIdx = results.findIndex((r) => r.status === "Current" && r.package_ndc !== worsened.package_ndc && results.filter((x) => x.package_ndc === r.package_ndc).length === 1);
  const [removed] = results.splice(removedIdx, 1);
  const added: FdaShortageRecord = { ...structuredClone(worsened), package_ndc: "99999-0001-01", availability: "Limited Availability", update_type: "New", initial_posting_date: "10/23/2026" };
  results.push(added);
  return { snap: { meta: { ...base.meta, last_updated: "2026-10-23" }, results }, worsened, removed, added };
}

describe("FDA shortage snapshots in the World Model", () => {
  let world: WorldModel;
  let baseline: Awaited<ReturnType<typeof ingestShortageSnapshot>>;

  beforeAll(async () => {
    world = new WorldModel({ namespace: "test" });
    baseline = await ingestShortageSnapshot(world, real);
  });

  it("loads the real 2026-10-22 snapshot as a baseline, one product per package NDC", () => {
    expect(baseline.baseline).toBe(true);
    expect(baseline.products).toBe(new Set(real.results.map((r) => r.package_ndc)).size);
    expect(world.entities("product")).toHaveLength(baseline.products);
  });

  it("re-ingesting the same snapshot appends nothing and reports no changes", async () => {
    const again = await ingestShortageSnapshot(world, real);
    expect(again.baseline).toBe(false);
    expect(again.eventsAppended).toBe(0);
    expect(again.changes).toEqual([]);
  });

  it("a next-day snapshot reports exactly what moved", async () => {
    const { snap, worsened, removed, added } = nextDay(real);
    const report = await ingestShortageSnapshot(world, snap);
    const summary = report.changes.map((c) => `${c.ndc} ${c.slot} ${c.from}→${c.to}`).sort();
    expect(summary).toEqual(
      [
        `${worsened.package_ndc} shortage-state limited→unavailable`,
        `${removed.package_ndc} shortage-state ${shortageStateOf(removed)}→off-list`,
        `${added.package_ndc} shortage-state null→limited`,
      ].sort(),
    );
  });

  it("keeps the status history and answers point-in-time questions", () => {
    const { worsened } = nextDay(real);
    const history = stateHistory(world, worsened.package_ndc);
    expect(history.map((h) => h.state)).toEqual(["limited", "unavailable"]);
    expect(history[0].validTo).toBe("2026-10-23T00:00:00.000Z");

    const graph = world.view("graph");
    const then = graph.neighborsOf(productId(worsened.package_ndc), { via: "shortage-state", at: "2026-10-22T12:00:00.000Z" });
    const now = graph.neighborsOf(productId(worsened.package_ndc), { via: "shortage-state" });
    expect(then.map((e) => e.id)).toEqual(["state:fda:limited"]);
    expect(now.map((e) => e.id)).toEqual(["state:fda:unavailable"]);
  });

  it("persists to disk and replays to the same state", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-"));
    const first = new WorldModel({ namespace: "persist", storage: "local", directory: dir });
    await ingestShortageSnapshot(first, real);
    const reloaded = new WorldModel({ namespace: "persist", storage: "local", directory: dir });
    expect(reloaded.stateShapeCanonical()).toBe(first.stateShapeCanonical());
    expect((await ingestShortageSnapshot(reloaded, real)).eventsAppended).toBe(0);
  });
});

describe("snapshot ordering", () => {
  it("replays a same-day revision after the original", () => {
    const names = listSnapshots().map((f) => f.split("/").pop());
    const orig = names.indexOf("fda-shortages-2026-10-23.json.gz");
    const rev = names.indexOf("fda-shortages-2026-10-23-1846z.json.gz");
    expect(orig).toBeGreaterThan(-1);
    expect(rev).toBeGreaterThan(orig);
  });
});
