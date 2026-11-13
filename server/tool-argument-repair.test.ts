import { describe, expect, it } from "vitest";
import { compileToolSchema } from "./mcp-schema-validator.ts";
import { argumentOutline, repairToolArguments } from "./tool-argument-repair.ts";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    queries: { type: "array", items: { type: "string" }, minItems: 1 },
    limit: { type: "integer", minimum: 1 },
    ratio: { type: "number" },
    replies: { type: "boolean" },
    action: { type: "string", enum: ["search", "user_posts"] },
    bot_ids: { type: "array", items: { type: "string" } },
    filter: { type: "object", additionalProperties: false, properties: { from: { type: "string" }, max_age: { type: "integer" } } },
    note: { type: "string" },
  },
  required: ["queries"],
};
const valid = compileToolSchema(schema);
const repaired = (args: unknown) => repairToolArguments(schema, args);

describe("repairToolArguments", () => {
  it.each([
    [{ queries: '["a","b"]' }, { queries: ["a", "b"] }],
    [{ queries: "only one" }, { queries: ["only one"] }],
    [{ queries: ["a"], limit: "5" }, { queries: ["a"], limit: 5 }],
    [{ queries: ["a"], ratio: "0.5" }, { queries: ["a"], ratio: 0.5 }],
    [{ queries: ["a"], replies: "True" }, { queries: ["a"], replies: true }],
    [{ queries: ["a"], action: "Search" }, { queries: ["a"], action: "search" }],
    [{ queries: ["a"], botIds: ["b1"] }, { queries: ["a"], bot_ids: ["b1"] }],
    [{ queries: ["a"], note: null, limit: null }, { queries: ["a"] }],
    [{ queries: ["a"], filter: '{"from":"ada","maxAge":"3"}' }, { queries: ["a"], filter: { from: "ada", max_age: 3 } }],
    ['{"queries":["a"]}', { queries: ["a"] }],
    [{ query: "one search" }, { queries: ["one search"] }],
    [{ queries: ["a"], bot_id: "b1" }, { queries: ["a"], bot_ids: ["b1"] }],
  ])("repairs %j to %j, which then validates", (args, expected) => {
    const result = repaired(args)!;
    expect(result.args).toEqual(expected);
    expect(result.repairs.length).toBeGreaterThan(0);
    expect(valid(result.args)).toBe(true);
  });

  it("names each change in the field's own words", () => {
    expect(repaired({ queries: '["a"]', limit: "5", botIds: [] })!.repairs).toEqual([
      "queries: a JSON string read as a list",
      'limit: "5" read as a number',
      "botIds: read as bot_ids",
    ]);
  });

  it.each([
    [{ queries: ["a"], limit: "5.5" }, "a fraction is not a whole number"],
    [{ queries: ["a"], limit: "five" }, "words are not a number"],
    [{ queries: ["a"], replies: "yes" }, "only true and false are yes/no"],
    [{ queries: ["a"], action: "find" }, "no enum value matches"],
    [{ queries: ["a"], note: 42 }, "a number is not turned into text"],
    [{ queries: ["a"], other: 1 }, "an unknown field is not renamed into nothing"],
    [{}, "a missing required field is not invented"],
  ])("leaves %j for the schema to refuse: %s", (args: unknown, _why: string) => {
    expect(valid(repaired(args)!.args)).toBe(false);
  });

  it("keeps a JSON-looking string where the field takes text", () => {
    expect(repaired({ queries: ["a"], note: '["not","a","list"]' })!.args.note).toBe('["not","a","list"]');
  });

  it("does not rename onto a field the call already sets", () => {
    expect(repaired({ queries: ["a"], bot_ids: ["x"], botIds: ["y"] })!.args).toEqual({ queries: ["a"], bot_ids: ["x"], botIds: ["y"] });
  });

  it("returns nothing for arguments that are not an object", () => {
    expect(repaired("not json")).toBeUndefined();
    expect(repaired(["a"])).toBeUndefined();
  });
});

describe("argumentOutline", () => {
  it("lists required fields first, with types, lists and enum values", () => {
    expect(argumentOutline(schema)).toBe(
      'It takes { queries: list of strings, limit?: integer, ratio?: number, replies?: boolean, action?: one of "search" | "user_posts", bot_ids?: list of strings, filter?: object, note?: string } (? = optional).',
    );
  });

  it("leaves out the optional marker when every field is required", () => {
    expect(argumentOutline({ type: "object", properties: { queries: { type: "array", items: { type: "string" } } }, required: ["queries"] }))
      .toBe("It takes { queries: list of strings }.");
  });

  it("says when a tool takes nothing", () => {
    expect(argumentOutline({ type: "object", properties: {} })).toBe("It takes no arguments: send {}.");
  });
});
