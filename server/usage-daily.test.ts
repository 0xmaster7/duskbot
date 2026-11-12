import { describe, expect, it } from "vitest";

import { clampDays, clampOffset, dailyUsage, dayKey } from "./usage-daily.ts";
import type { UsageRow } from "./usage-ledger.ts";

const NOW = Date.UTC(2026, 10, 12, 10);
const HOUR = 60 * 60_000;

function row(botId: string, at: number, costUsd: number | null, tokens = 100): UsageRow {
  return {
    at: new Date(at).toISOString(), botId, botName: botId, threadId: "t", instanceId: "i", driverKind: "claude", model: "m",
    input: tokens, output: 0, costUsd, trigger: { kind: "owner" },
  };
}

describe("dailyUsage", () => {
  it("gives one amount per day per bot, oldest first, ending today", () => {
    const report = dailyUsage([
      row("a", NOW - HOUR, 1), row("a", NOW - 2 * HOUR, 0.5), row("b", NOW - 24 * HOUR, 2), row("a", NOW - 10 * 24 * HOUR, 9),
    ], { now: NOW, days: 3, offsetMinutes: 0, botName: (id) => (id === "a" ? "Ada" : undefined) });
    expect(report.days).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(report.basis).toBe("usd");
    expect(report.series.map((one) => [one.key, one.name, one.values])).toEqual([["bot:b", "b", [0, 2, 0]], ["bot:a", "Ada", [0, 0, 1.5]]]);
    expect(report.totals).toEqual([0, 2, 1.5]);
    expect(report.total).toBe(3.5);
  });

  it("puts a turn on the viewer's own calendar day", () => {
    const late = Date.UTC(2026, 10, 11, 20);
    expect(dayKey(late, -330)).toBe("2026-11-12");
    const report = dailyUsage([row("a", late, 1)], { now: NOW, days: 2, offsetMinutes: -330 });
    expect(report.days).toEqual(["2026-11-11", "2026-11-12"]);
    expect(report.series[0]!.values).toEqual([0, 1]);
  });

  it("counts tokens while nothing in the range has a price", () => {
    const report = dailyUsage([row("a", NOW - HOUR, null, 300), row("b", NOW - HOUR, 0, 100)], { now: NOW, days: 1, offsetMinutes: 0 });
    expect(report.basis).toBe("tokens");
    expect(report.series.map((one) => one.total)).toEqual([300, 100]);
  });

  it("folds every bot past the busiest few into one other series", () => {
    const rows = ["a", "b", "c", "d"].map((id, index) => row(id, NOW - HOUR, 4 - index));
    const report = dailyUsage(rows, { now: NOW, days: 1, offsetMinutes: 0, top: 2 });
    expect(report.series.map((one) => [one.key, one.total, one.bots])).toEqual([["bot:a", 4, undefined], ["bot:b", 3, undefined], ["other", 3, 2]]);
    const one = dailyUsage(rows.slice(0, 3), { now: NOW, days: 1, offsetMinutes: 0, top: 2 });
    expect(one.series.map((entry) => entry.key)).toEqual(["bot:a", "bot:b", "bot:c"]);
  });

  it("is empty with no rows, and keeps days and zone offsets sane", () => {
    const report = dailyUsage([], { now: NOW, days: 7, offsetMinutes: 0 });
    expect(report.days).toHaveLength(7);
    expect(report.series).toEqual([]);
    expect(report.total).toBe(0);
    expect([clampDays("0"), clampDays("500"), clampDays("x"), clampDays("30")]).toEqual([14, 90, 14, 30]);
    expect([clampOffset("-330"), clampOffset("99999"), clampOffset(null)]).toEqual([-330, 0, 0]);
  });
});
