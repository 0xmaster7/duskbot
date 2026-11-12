import { describe, expect, it } from "vitest";
import { DAY, HOUR, visitsOf } from "./web.ts";
import type { StoredEvent } from "./sink.ts";
import { aligned, newVsReturning, peakHours } from "./insights.ts";

const T = Date.parse("2026-11-01T00:00:00Z");
const view = (visitor: string, session: string, at: number, channel = "direct"): StoredEvent =>
  ({ id: `${session}:${at}`, name: "site_view", at, accountId: null, props: { path: "/" }, ctx: { visitor, session, page: "/", source: channel, channel: channel as never } }) as StoredEvent;

describe("insights", () => {
  it("splits each bucket's visitors into first visits and people who came back, counting history before the window", () => {
    const visits = visitsOf([view("old", "s0", T - 3 * DAY), view("old", "s1", T + HOUR), view("a", "s2", T + HOUR), view("a", "s3", T + DAY + HOUR), view("b", "s4", T + DAY + 2 * HOUR, "social")]);
    expect(newVsReturning(visits, T, T + 3 * DAY)).toEqual({ new: [1, 1, 0], returning: [1, 1, 0] });
    expect(newVsReturning(visits, T, T + 3 * DAY, { channel: "social" })).toEqual({ new: [0, 1, 0], returning: [0, 0, 0] });
  });

  it("counts visits by weekday and hour in the reader's zone", () => {
    const visits = visitsOf([view("a", "s1", T + 9 * HOUR), view("b", "s2", T + 9 * HOUR + 60_000)]);
    expect(peakHours(visits, T, T + DAY, 0)[0]![9]).toBe(2);
    expect(peakHours(visits, T, T + DAY, -330)[0]![14]).toBe(2);
  });

  it("lays the previous window on the current buckets", () => {
    expect(aligned([1, 2], 3)).toEqual([1, 2, 0]);
    expect(aligned([1, 2, 3], 2)).toEqual([1, 2]);
  });
});
