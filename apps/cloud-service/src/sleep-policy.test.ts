import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_IDLE_MS, breakEvenMs, HOUR, HOURLY_CENTS, MINUTE, nextStartCents, predictReturn, sleepDecision, startCostCents, type SleepInput } from "./sleep-policy.ts";
import { createStartLedger, StartCapError } from "./starts.ts";

const now = Date.UTC(2026, 10, 10, 12);
const input = (patch: Partial<SleepInput> = {}): SleepInput => ({ now, awakeSince: now - HOUR, lastActivityAt: now - 20 * MINUTE, busy: [], focusSince: null, nextDueAt: null,
  startsToday: 20, includedStarts: 200, predictedReturnMs: null, hourlyCents: HOURLY_CENTS.small, ...patch });
const decide = (patch: Partial<SleepInput> = {}) => sleepDecision(input(patch));

describe("start prices", () => {
  it("follows the provider's tiers and fails past 6x", () => {
    expect([200, 201, 300, 301, 400, 401, 1200, 1201].map(n => startCostCents(n, 200))).toEqual([0, 3, 3, 5, 5, 7, 7, Number.POSITIVE_INFINITY]);
  });
  it("values an included start low, and like a paid one once the pool is past 70%", () => {
    expect(nextStartCents(20, 200)).toBe(1.5);
    expect(nextStartCents(140, 200)).toBe(3);
    expect(nextStartCents(399, 200)).toBe(5);
    // a small machine: one $0.03 start is 1 h 40 min of compute, a $0.07 one almost 4 h
    expect(breakEvenMs(3, HOURLY_CENTS.small) / MINUTE).toBeCloseTo(100, 0);
    expect(breakEvenMs(7, HOURLY_CENTS.small) / HOUR).toBeCloseTo(3.89, 1);
    expect(breakEvenMs(1.5, HOURLY_CENTS.small) / MINUTE).toBeCloseTo(50, 0);
  });
});

describe("the sleep decision", () => {
  it("stops an idle home after the base 15 minutes when starts are cheap and nothing is coming", () => {
    expect(decide()).toMatchObject({ action: "stop", reason: "idle" });
    expect(decide({ lastActivityAt: now - 10 * MINUTE })).toMatchObject({ action: "stay", reason: "recent_use", recheckAt: now + 5 * MINUTE });
    expect(decide({ lastActivityAt: now - BASE_IDLE_MS })).toMatchObject({ action: "stop" });
    // the home's own idle word wins over the activity time it reported
    expect(decide({ lastActivityAt: now - 5 * MINUTE, homeIdle: true })).toMatchObject({ action: "stop" });
  });

  it("never stops a busy home, one that just woke, or one with a run due within 10 minutes", () => {
    expect(decide({ busy: ["turn"] })).toMatchObject({ action: "stay", reason: "busy:turn" });
    expect(decide({ awakeSince: now - MINUTE, lastActivityAt: null })).toMatchObject({ action: "stay", reason: "just_woke" });
    expect(decide({ nextDueAt: now + 9 * MINUTE })).toMatchObject({ action: "stay", reason: "routine_due" });
  });

  it("lets a focused app keep the home up for 30 minutes at most", () => {
    expect(decide({ busy: ["focus"], focusSince: now - 20 * MINUTE })).toMatchObject({ action: "stay", reason: "focused" });
    expect(decide({ busy: ["focus"], focusSince: now - 31 * MINUTE })).toMatchObject({ action: "stop" });
  });

  it("keeps an hourly routine's box up between runs only when that is cheaper than the start", () => {
    // pool quiet: an included start is worth 50 min of small compute, so a run 45 min out is cheaper awake, 60 min out is not
    expect(decide({ nextDueAt: now + 45 * MINUTE })).toMatchObject({ action: "stay", reason: "routine_cheaper_awake" });
    expect(decide({ nextDueAt: now + 60 * MINUTE })).toMatchObject({ action: "stop" });
    // pool past 70%: a start is worth 1 h 40 min, so the hourly routine keeps it up
    expect(decide({ nextDueAt: now + 60 * MINUTE, startsToday: 150 })).toMatchObject({ action: "stay", reason: "routine_cheaper_awake" });
    // on a bigger machine compute costs more, so the same run is not worth staying for
    expect(decide({ nextDueAt: now + 45 * MINUTE, hourlyCents: HOURLY_CENTS.large })).toMatchObject({ action: "stop" });
  });

  it("stays up when the owner is predicted back inside the break-even time", () => {
    expect(decide({ predictedReturnMs: 30 * MINUTE })).toMatchObject({ action: "stay", reason: "owner_back_soon" });
    expect(decide({ predictedReturnMs: 3 * HOUR })).toMatchObject({ action: "stop" });
    expect(decide({ predictedReturnMs: 90 * MINUTE, startsToday: 150 })).toMatchObject({ action: "stay", reason: "owner_back_soon" });
  });

  it("idles longer as the shared pool fills, then stops past the break-even", () => {
    expect(decide({ startsToday: 150, lastActivityAt: now - 60 * MINUTE })).toMatchObject({ action: "stay", reason: "pool_pressure" });
    expect(decide({ startsToday: 150, awakeSince: now - 8 * HOUR, lastActivityAt: now - 101 * MINUTE })).toMatchObject({ action: "stop", reason: "idle_past_break_even" });
    // extra starts at $0.05: almost 3 h
    expect(decide({ startsToday: 350, awakeSince: now - 8 * HOUR, lastActivityAt: now - 150 * MINUTE })).toMatchObject({ action: "stay", reason: "pool_pressure" });
  });

  it("never risks the hard cap, and otherwise never idles past 6 hours", () => {
    expect(decide({ startsToday: 1150, awakeSince: now - 8 * HOUR, lastActivityAt: now - 7 * HOUR })).toMatchObject({ action: "stay", reason: "near_hard_cap", recheckAt: now + HOUR });
    expect(decide({ startsToday: 350, awakeSince: now - 8 * HOUR, lastActivityAt: now - 7 * HOUR, predictedReturnMs: MINUTE })).toMatchObject({ action: "stop", reason: "max_idle" });
  });
});

describe("the owner's predicted return", () => {
  it("is the median next wake after this time of day over 14 days, or nothing without 3 days of history", () => {
    const at = (daysAgo: number, minutesAfter: number) => now - daysAgo * 24 * HOUR + minutesAfter * MINUTE;
    expect(predictReturn([at(1, 20), at(2, 40)], now)).toBeNull();
    expect(predictReturn([at(1, 20), at(2, 40), at(3, 30), at(4, 25 * 60)], now)).toBe(30 * MINUTE);
  });
});

describe("the start ledger", () => {
  it("counts the day's starts, alerts once per threshold, keeps intent wakes, and refuses past 6x", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-starts-")), alerts: string[] = [];
    let t = now;
    try {
      const ledger = createStartLedger({ dataDir: dir, included: 10, now: () => t, alert: text => alerts.push(text) });
      for (let n = 0; n < 7; n++) ledger.record("c1", "wake");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain("7 today, 70% of the 10 included");
      for (let n = 0; n < 8; n++) ledger.record("c1", "refresh");
      expect(alerts.map(a => a.split(",")[0])).toEqual(["provider starts: 7 today", "provider starts: 10 today", "provider starts: 15 today"]);
      expect(ledger.days()[0]).toMatchObject({ starts: 15, byKind: { wake: 7, refresh: 8 }, extraCents: 15 });
      expect(ledger.wakes("c1")).toHaveLength(7);
      for (let n = 15; n < 60; n++) ledger.record("c2", "create");
      expect(() => ledger.admit()).toThrow(StartCapError);
      t += 24 * HOUR;
      expect(ledger.count()).toBe(0);
      expect(() => ledger.admit()).not.toThrow();
      ledger.close();
      expect(createStartLedger({ dataDir: dir, included: 10, now: () => t }).days()).toHaveLength(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("the reconciler with the policy", () => {
  it("keeps an idle home up for a routine due before a start pays for itself, and counts every start by kind", async () => {
    const { boatFixture } = await import("./test-fixture.ts");
    const { readFileSync } = await import("node:fs");
    const f = await boatFixture();
    const { c } = await f.paid();
    f.advance(3 * MINUTE); f.power.idle = true; f.power.busy = []; f.power.nextDueAt = f.now() + 30 * MINUTE;
    for (let n = 0; n < 4; n++) { c.nextAttemptAt = 0; await f.service.reconcile(); }
    expect(c.status).toBe("running");
    expect(c.managed!.stayReason).toBe("routine_cheaper_awake");
    // the home is read once a minute: the next read finds nothing due
    f.power.nextDueAt = null; f.advance(2 * MINUTE);
    await f.settle(c, c => c.status === "sleeping");
    await f.service.power(c.accountId, c.id, "on");
    await f.settle(c, c => c.status === "running");
    const days = JSON.parse(readFileSync(join(f.dataDir, "provider-starts.json"), "utf8")).days;
    expect(days.at(-1)).toMatchObject({ starts: 2, byKind: { create: 1, wake: 1 } });
  });
});
