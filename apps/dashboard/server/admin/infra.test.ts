import { describe, expect, it } from "vitest";
import type { StoredCloud } from "../clouds/types.ts";
import { costOf, createInfraCollector, marginReport, memoryInfraStore, type InfraDay, type MachineUsage } from "./infra.ts";

const HOUR = 3600;
const cloud = (id: string, accountId: string, patch: Partial<StoredCloud> = {}) => ({ id, accountId, backend: "managed", serverId: `m-${id}`, status: "running", ...patch }) as StoredCloud;
const usage = (running: number, vcpu = 2, mem = 4, disk = 20): MachineUsage => ({ runningSeconds: running, vcpuSeconds: running * vcpu, memGiBSeconds: running * mem, diskGiBSeconds: disk * running, egressBytes: 0 });
const day = (d: string, cloudId: string, accountId: string, running: number, extra: Partial<InfraDay> = {}): InfraDay => ({
  day: d, cloudId, accountId, serverId: `m-${cloudId}`, ...usage(running), ...costOf(usage(running)), collectedAt: 0, ...extra });

describe("infra cost", () => {
  it("prices compute at instabox's rates and disk at $0.08 a gib-month", () => {
    // an hour of 2 vcpu / 4 gib: 2 x 0.4 + 4 x 0.225 = 1.7 cents
    expect(costOf({ vcpuSeconds: 2 * HOUR, memGiBSeconds: 4 * HOUR, diskGiBSeconds: 0 })).toEqual({ computeCents: 1.7, diskCents: 0, costCents: 1.7 });
    // 20 gib for a 730 hour month: 20 x 8 cents
    expect(costOf({ vcpuSeconds: 0, memGiBSeconds: 0, diskGiBSeconds: 20 * 730 * HOUR }).diskCents).toBe(160);
  });

  it("writes yesterday and today once per cloud, however often it runs, and skips clouds without a managed machine", async () => {
    const now = Date.parse("2026-11-13T05:00:00Z"), today = Date.parse("2026-11-13T00:00:00Z"), yesterday = today - 24 * HOUR * 1000;
    const store = memoryInfraStore();
    const calls: Array<[string, number]> = [];
    const collector = createInfraCollector({ store, now: () => now,
      clouds: () => [cloud("c1", "a1"), cloud("c2", "a2", { serverId: null }), cloud("c3", "a3", { backend: undefined }), cloud("c4", "a4", { status: "destroyed" })],
      usage: async (c, from) => { calls.push([c.id, from]); return from === yesterday ? usage(10 * HOUR) : from === today ? usage(3 * HOUR) : null; } });
    expect(await collector.run()).toBe(2);
    expect(await collector.run()).toBe(2);
    expect(store.rows.size).toBe(2);
    expect(new Set(calls.map(([id]) => id))).toEqual(new Set(["c1"]));
    const rows = await store.range("2026-11-12", "2026-11-13");
    expect(rows.map(row => [row.day, row.runningSeconds])).toEqual([["2026-11-12", 7 * HOUR], ["2026-11-13", 3 * HOUR]]);
    expect(rows[0]).toMatchObject({ cloudId: "c1", accountId: "a1", serverId: "m-c1", vcpuSeconds: 14 * HOUR, memGiBSeconds: 28 * HOUR, computeCents: 11.9 });
  });

  it("keeps a stored day when the machine can no longer be read", async () => {
    const store = memoryInfraStore();
    await store.put([day("2026-11-12", "c1", "a1", HOUR)]);
    const collector = createInfraCollector({ store, now: () => Date.parse("2026-11-13T05:00:00Z"), clouds: () => [cloud("c1", "a1")], usage: async () => null });
    expect(await collector.run()).toBe(0);
    expect((await store.range("2026-11-12", "2026-11-12"))[0]!.runningSeconds).toBe(HOUR);
  });
});

describe("margin report", () => {
  // the 11th day of a 30 day month: a third of it has passed
  const now = Date.parse("2026-11-11T00:00:00Z");
  const customers = [
    { accountId: "a1", email: "one@example.test", plan: "plus", interval: "month" as const, status: "active", mrr: 2000 },
    { accountId: "a2", email: "two@example.test", plan: "pro", interval: "month" as const, status: "active", mrr: 5000 },
    { accountId: "a3", email: "three@example.test", plan: "team", interval: "year" as const, status: "active", mrr: 11900 },
    { accountId: "a5", email: null, plan: "plus", interval: "month" as const, status: "churned", mrr: 0 },
  ];
  // a1: 10 days x 2 h, a2: 10 days x 20 h, a4 (no plan): 1 day x 6 h, a3: no cloud measured
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => day(`2026-11-${String(i + 1).padStart(2, "0")}`, "c1", "a1", 2 * HOUR)),
    ...Array.from({ length: 10 }, (_, i) => day(`2026-11-${String(i + 1).padStart(2, "0")}`, "c2", "a2", 20 * HOUR)),
    day("2026-11-05", "c4", "a4", 6 * HOUR),
    day("2026-10-31", "c1", "a1", 24 * HOUR),
  ];
  const report = marginReport({ now, customers, rows });
  const cost = (hours: number, days: number) => days * costOf(usage(hours * HOUR)).costCents;

  it("sums month-to-date cost per customer and scales it to the month for the margin", () => {
    const a1 = report.customers.find(row => row.accountId === "a1")!;
    expect(a1.costCents).toBe(Math.round(cost(2, 10)));
    expect(a1.projectedCents).toBe(Math.round(cost(2, 10) * 3));
    expect(a1.feeCents).toBe(Math.round(2000 * 0.06 + 40));
    expect(a1.marginCents).toBe(2000 - a1.feeCents - a1.projectedCents);
    expect(a1.margin).toBeCloseTo(a1.marginCents / 2000, 3);
    expect(a1.awakeHours).toBe(20);
    const a3 = report.customers.find(row => row.accountId === "a3")!;
    expect(a3).toMatchObject({ costCents: 0, feeCents: Math.round(11900 * 0.06 + 40 / 12) });
    expect(report.customers.find(row => row.accountId === "a4")).toMatchObject({ mrr: 0, margin: null, plan: "none" });
    expect(report.customers.some(row => row.accountId === "a5")).toBe(false);
  });

  it("totals mrr, fees and infra into a gross margin, and counts unbilled cost apart", () => {
    const t = report.totals;
    expect(t.mrr).toBe(18900);
    expect(t.costCents).toBe(report.customers.reduce((sum, row) => sum + row.costCents, 0));
    expect(t.marginCents).toBe(18900 - t.feeCents - t.projectedCents);
    expect(t.margin).toBeCloseTo(t.marginCents / 18900, 3);
    expect(t.unbilledCents).toBe(Math.round(cost(6, 1)));
    expect(t.clouds).toBe(3);
    expect(report).toMatchObject({ month: "2026-11", days: 10 });
  });

  it("lists the worst margins first, only for paying customers", () => {
    expect(report.worst.map(row => row.accountId)).toEqual(["a2", "a1", "a3"]);
    expect(marginReport({ now, customers, rows, worst: 1 }).worst).toHaveLength(1);
  });

  it("buckets clouds by their average awake hours a day this month", () => {
    expect(report.awake).toEqual([{ label: "0-1h", clouds: 0 }, { label: "1-4h", clouds: 1 }, { label: "4-8h", clouds: 1 }, { label: "8-12h", clouds: 0 }, { label: "12-24h", clouds: 1 }]);
    const edges = marginReport({ now, customers: [], rows: [day("2026-11-01", "x1", "b", 0), day("2026-11-01", "x2", "b", HOUR), day("2026-11-01", "x3", "b", 8 * HOUR), day("2026-11-01", "x4", "b", 24 * HOUR)] });
    expect(edges.awake.map(bucket => bucket.clouds)).toEqual([1, 1, 0, 1, 1]);
  });
});
