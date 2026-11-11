import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DAILY_LINES, dailyLine, investedLine, investedNoteDue, markInvestedNote, streakLine } from "./fun";

const morning = new Date(2026, 10, 12, 8).getTime(), night = new Date(2026, 10, 12, 23, 30).getTime();
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

it("greets with one line all day and a different one tomorrow, every line lowercase and without em dashes", () => {
  expect(dailyLine(morning)).toBe(dailyLine(night));
  expect(dailyLine(morning + 86_400_000)).not.toBe(dailyLine(morning));
  for (const line of DAILY_LINES) { expect(line).toBe(line.toLowerCase()); expect(line).not.toContain("—"); }
});

it("says a streak only from two days, warmer as it grows", () => {
  expect(streakLine(0)).toBeNull();
  expect(streakLine(1)).toBeNull();
  expect(streakLine(3)).toBe("3 day streak");
  expect(streakLine(12)).toBe("12 days straight. nice.");
  expect(streakLine(40)).toBe("40 days straight. legendary.");
});

it("shows the invested note once per account, only past a threshold and only without a cloud", () => {
  const invested = { bots: 3, messages: 0, routines: 0 }, trying = { bots: 2, messages: 49, routines: 2 };
  expect(investedNoteDue("acct_a", trying, false)).toBe(false);
  expect(investedNoteDue("acct_a", invested, true)).toBe(false);
  expect(investedNoteDue(null, invested, false)).toBe(false);
  expect(investedNoteDue("acct_a", invested, false)).toBe(true);
  markInvestedNote("acct_a");
  expect(investedNoteDue("acct_a", invested, false)).toBe(false);
  expect(investedNoteDue("acct_b", { bots: 0, messages: 50, routines: 0 }, false)).toBe(true);
  expect(investedLine({ bots: 0, messages: 1200, routines: 0 })).toBe("1,200 messages in. your bots nap when your mac does.");
});
