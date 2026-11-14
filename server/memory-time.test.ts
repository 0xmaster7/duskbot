import { describe, expect, it } from "vitest";

import { factDates, queryTime } from "./memory-time.ts";

const TODAY = "2026-11-15";

describe("dates a fact names", () => {
  it("reads days, months, seasons and years", () => {
    expect(factDates("Flew to Kyoto on 2026-04-10")).toEqual({ start: "2026-04-10", end: "2026-04-10" });
    expect(factDates("Trip to Kyoto in April 2026 with Sam")).toEqual({ start: "2026-04-01", end: "2026-04-30" });
    expect(factDates("Moved on March 3, 2026")).toEqual({ start: "2026-03-03", end: "2026-03-03" });
    expect(factDates("Spent spring 2025 in Goa")).toEqual({ start: "2025-03-01", end: "2025-05-31" });
    expect(factDates("Joined Fernhill in 2024")).toEqual({ start: "2024-01-01", end: "2024-12-31" });
    expect(factDates("Prefers short replies")).toBeNull();
  });
});

describe("the time a question asks about", () => {
  it("resolves relative words against today", () => {
    expect(queryTime("where did I live last spring?", TODAY)).toEqual({ range: { start: "2026-03-01", end: "2026-05-31" }, past: true });
    expect(queryTime("what did we decide in March?", TODAY).range).toEqual({ start: "2026-03-01", end: "2026-03-31" });
    expect(queryTime("plans for December?", TODAY).range).toBeNull();
    expect(queryTime("what happened in December?", TODAY).range).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    expect(queryTime("how many trips this year", TODAY).range).toEqual({ start: "2026-01-01", end: TODAY });
    expect(queryTime("what did I do last year", TODAY).range).toEqual({ start: "2025-01-01", end: "2025-12-31" });
    expect(queryTime("what happened two weeks ago", TODAY).range).toEqual({ start: "2026-10-28", end: "2026-11-05" });
    expect(queryTime("last winter", "2026-01-20").range).toEqual({ start: "2024-12-01", end: "2025-02-28" });
    expect(queryTime("this winter", "2026-01-20").range).toEqual({ start: "2025-12-01", end: "2026-02-28" });
  });

  it("does not read the verb may as a month, and knows a question about the past", () => {
    expect(queryTime("may I ask where I live?", TODAY)).toEqual({ range: null, past: false });
    expect(queryTime("where did I used to work?", TODAY).past).toBe(true);
    expect(queryTime("where do I work?", TODAY).past).toBe(false);
  });
});
