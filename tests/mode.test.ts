import { describe, expect, it } from "vitest";
import { isSample, modeScope } from "../src/adapters/mode";

describe("sample mode is per request", () => {
  it("applies inside the scope and nowhere else", async () => {
    delete process.env.SAMPLE_MODE;
    expect(isSample()).toBe(false);
    const inside = await modeScope.run({ sample: true }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return isSample();
    });
    expect(inside).toBe(true);
    expect(isSample()).toBe(false);
  });

  it("concurrent requests do not see each other's mode", async () => {
    const run = (sample: boolean, ms: number) => modeScope.run({ sample }, async () => { await new Promise((r) => setTimeout(r, ms)); return isSample(); });
    expect(await Promise.all([run(true, 20), run(false, 5), run(true, 1)])).toEqual([true, false, true]);
  });
});
