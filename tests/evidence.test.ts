import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINES } from "../app/evidence";

describe("the Engines tab only claims what the evidence files show", () => {
  for (const e of ENGINES) {
    it(`${e.engine}: ${e.result}`, () => {
      const doc = fs.readFileSync(path.join(process.cwd(), e.file), "utf-8");
      for (const needle of e.proof) expect(doc, `${e.file} should contain "${needle}"`).toContain(needle);
      expect(fs.existsSync(path.join(process.cwd(), e.code))).toBe(true);
    });
  }
});
