import { describe, expect, it } from "vitest";
import { compileServerToolSchema } from "./mcp-schema-validator.ts";

describe("compileServerToolSchema", () => {
  it("compiles a schema once and keys it by its whole text", () => {
    const schema = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };
    const first = compileServerToolSchema(schema);
    expect(compileServerToolSchema(JSON.parse(JSON.stringify(schema)))).toBe(first);
    const other = compileServerToolSchema({ ...schema, required: [] });
    expect(other).not.toBe(first);
    expect(first({})).toBe(false);
    expect(other({})).toBe(true);
  });

  it("still refuses a schema it cannot hold, every time", () => {
    const broken = { type: "object", properties: { id: { type: "string", pattern: "(" } } };
    expect(() => compileServerToolSchema(broken)).toThrow(/could not be validated/);
    expect(() => compileServerToolSchema(broken)).toThrow(/could not be validated/);
  });
});
