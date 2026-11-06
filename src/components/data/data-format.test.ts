import { describe, expect, it } from "vitest";
import { cellNumber, isNumericType, rowObjects } from "./data-format";

describe("data helpers", () => {
  it("knows DuckDB's number types", () => {
    for (const type of ["BIGINT", "INTEGER", "UBIGINT", "HUGEINT", "DECIMAL(18,3)", "DOUBLE", "FLOAT", "REAL", "SMALLINT", "TINYINT"]) expect(isNumericType(type), type).toBe(true);
    for (const type of ["VARCHAR", "BOOLEAN", "DATE", "TIMESTAMP", "INTERVAL", "BLOB", "INTEGER[]"]) expect(isNumericType(type), type).toBe(type === "INTEGER[]");
  });

  it("turns cells into numbers", () => {
    expect(cellNumber("12345678901234567890")).toBe(12345678901234567000);
    expect(cellNumber("1.50")).toBe(1.5);
    expect(cellNumber("")).toBeNull();
    expect(cellNumber("abc")).toBeNull();
  });

  it("binds rows as objects, with numeric columns as numbers", () => {
    const rows = rowObjects([{ name: "n", type: "BIGINT" }, { name: "s", type: "VARCHAR" }], [["42", "a"], [null, null]]);
    expect(rows).toEqual([{ n: 42, s: "a" }, { n: null, s: null }]);
  });
});
