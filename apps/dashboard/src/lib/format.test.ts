import { describe, expect, it } from "vitest";
import { usd } from "./format";

describe("usd", () => {
  it("never shows a negative zero", () => {
    expect(usd(-0)).toBe("$0.00");
    expect(usd(-0.001)).toBe("$0.00");
  });
  it("puts the sign before the dollar", () => expect(usd(-5)).toBe("-$5.00"));
  it("keeps tiny amounts honest", () => expect(usd(0.004)).toBe("<$0.01"));
});
