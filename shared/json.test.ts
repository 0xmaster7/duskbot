import { describe, expect, it } from "vitest";
import { isRecord } from "./json.ts";

describe("isRecord", () => {
  it.each([null, undefined, false, true, 0, 1, "", "value", [], [1], () => ({}), Symbol("key"), 1n])("rejects non-record values: %s", (value) => {
    expect(isRecord(value)).toBe(false);
  });

  it.each([{}, { key: 1 }, Object.create(null), new Date(0), new Map(), new (class RecordValue {})()])("accepts non-array objects: %s", (value) => {
    expect(isRecord(value)).toBe(true);
  });
});
