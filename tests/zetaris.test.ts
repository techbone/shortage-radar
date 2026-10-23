import { describe, expect, it } from "vitest";
import { assertReadOnly, assertSingleStatement, toRecords } from "../src/adapters/zetaris";

describe("Zetaris adapter guards", () => {
  it.each(["SELECT 1", "with x as (select 1) select * from x", "SHOW TABLES", "DESCRIBE fda.shortages_table"])("allows read-only %s", (sql) => {
    expect(() => assertReadOnly(sql)).not.toThrow();
  });

  it.each(["DROP TABLE hospital.inventory", "select 1; drop table x", "DELETE FROM formulary_item", "CREATE LIGHTNING DATABASE X", "select * from t where 1=1 union select 1 from (drop table x)"])(
    "rejects %s for the agent",
    (sql) => {
      expect(() => {
        assertSingleStatement(sql);
        assertReadOnly(sql);
      }).toThrow();
    },
  );

  it("does not mistake a semicolon inside a string for a second statement", () => {
    expect(() => assertSingleStatement("SELECT * FROM t WHERE note = 'a; b'")).not.toThrow();
  });

  it("normalizes array rows and object rows", () => {
    expect(toRecords({ data: [[1, "a"]], columns: ["id", "name"] })).toEqual({ columns: ["id", "name"], rows: [{ id: 1, name: "a" }] });
    expect(toRecords({ data: [{ id: 1 }] })).toEqual({ columns: ["id"], rows: [{ id: 1 }] });
    expect(toRecords({ data: [] })).toEqual({ columns: [], rows: [] });
  });
});
