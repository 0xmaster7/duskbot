// the egress guard: levels per plan, one alert each, the limit inside the machine, the pause, and the 1st
import { afterEach, expect, it, vi } from "vitest";
import { BILLING_CONFIG } from "../../dashboard/server/billing/plans.ts";
import { createEgressGuard, EGRESS_LIFT_COMMAND, EGRESS_READ_MS, egressLevel, egressLimitCommand, egressLimits, egressMbit, egressTampered, GB } from "./egress.ts";
import { homeFixture } from "./test-fixture.ts";
import type { StoredCloud } from "../../dashboard/server/clouds/types.ts";

afterEach(() => { vi.restoreAllMocks(); });

it("reads each plan's levels from the billing config, the bigger plans about twice the room", () => {
  expect(egressLimits("shared_s")).toEqual(BILLING_CONFIG.egressGb.shared_s);
  expect(egressLimits("shared_s").pause).toBe(100);
  expect(egressLimits("shared_m").pause).toBe(200);
  expect(egressLimits("dedicated").pause).toBe(2 * egressLimits("shared_m").pause);
  expect(egressLimits("unknown")).toEqual(egressLimits("shared_s"));
  for (const kind of ["shared_s", "shared_m", "dedicated"]) {
    const { alert, steps, pause } = egressLimits(kind);
    // gentle: full speed to the first step, rising GB and falling speed, never more than halved at once, the pause last
    expect(alert).toBeLessThan(steps[0]!.gb);
    expect(steps[0]!.mbit).toBeGreaterThanOrEqual(100);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.gb).toBeGreaterThan(steps[i - 1]!.gb);
      expect(steps[i]!.mbit).toBeGreaterThanOrEqual(steps[i - 1]!.mbit / 2);
      expect(steps[i]!.mbit).toBeLessThan(steps[i - 1]!.mbit);
    }
    expect(steps.at(-1)!.gb).toBeLessThan(pause);
  }
  const limits = egressLimits("shared_s");
  expect([0, 29.9, 30, 39.9, 40, 99.9, 100, 900].map(gb => egressLevel(gb * GB, limits))).toEqual(["ok", "ok", "alert", "alert", "slow", "slow", "pause", "pause"]);
  expect([0, 39.9, 40, 54.9, 55, 70, 89.9, 90, 99.9].map(gb => egressMbit(gb * GB, limits))).toEqual([null, null, 200, 200, 100, 50, 50, 25, 25]);
});

it("builds the nftables limit for any rate, the burst growing with it", () => {
  const at5 = egressLimitCommand(5), at200 = egressLimitCommand(200);
  // 5 Mbit/s is the rate checked on a real InstaBox machine (625000 bytes a second, 256 KB burst)
  expect(at5).toContain("limit cap { rate over 625000 bytes/second burst 262144 bytes; }");
  expect(at200).toContain("limit cap { rate over 25000000 bytes/second burst 2500000 bytes; }");
  expect(egressLimitCommand(25)).toContain("rate over 3125000 bytes/second burst 312500 bytes;");
  // the same shape whatever the rate: one table, output and forward, then the check
  expect(at200.replace(/rate over \d+ bytes\/second burst \d+ bytes/, "")).toBe(at5.replace(/rate over \d+ bytes\/second burst \d+ bytes/, ""));
  for (const bad of [0, -1, Number.NaN, Infinity, 20_000]) expect(() => egressLimitCommand(bad)).toThrow();
});

it("alerts once, slows the machine inside, pauses it and keeps it asleep, and lifts everything on the 1st", async () => {
  const f = await homeFixture();
  const { c } = await f.paid();
  const serverId = c.serverId!;
  const tc: string[] = [];
  const rates = new Map([200, 100, 50, 25].map(mbit => [egressLimitCommand(mbit), mbit]));
  f.api.onExec(({ cmd }) => {
    if (rates.has(cmd)) { tc.push(`limit ${rates.get(cmd)}`); return { exitCode: 0, stdout: "limited eth0\n" }; }
    if (cmd === EGRESS_LIFT_COMMAND) { tc.push("lift"); return { exitCode: 0, stdout: "lifted\n" }; }
    return null;
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const alerts = () => warn.mock.calls.map(call => String(call[0])).filter(line => line.startsWith("managed: ALERT") && line.includes("to the internet"));
  const pass = async (n = 1) => { for (let i = 0; i < n; i++) { f.advance(EGRESS_READ_MS + 1_000); c.nextAttemptAt = 0; await f.service.reconcile(); } };
  const view = () => f.service.view(c).egress;

  // normal use: a read every 5 minutes, nothing else
  f.api.egress(serverId, 3 * GB);
  await pass(4);
  expect(view()).toMatchObject({ bytes: 3 * GB, state: "ok", until: null });
  expect(alerts()).toEqual([]);

  // past the alert: the operator hears once, whatever the next reads say, and the speed is untouched
  f.api.egress(serverId, 32 * GB);
  await pass(3);
  expect(alerts()).toHaveLength(1);
  expect(alerts()[0]).toContain(`cloud ${c.id} sent 32 GB`);
  expect(view()!.state).toBe("ok");
  expect(tc).toEqual([]);

  // the first step: a gentle limit goes in on the machine, is put back at each read, and the owner sees until when
  f.api.egress(serverId, 45 * GB);
  await pass();
  expect(tc).toEqual(["limit 200"]);
  const until = Date.UTC(2026, 11, 1);
  expect(view()).toEqual({ bytes: 45 * GB, state: "slowed", until });
  expect(c.status).toBe("running");
  await pass(2);
  expect(tc).toEqual(["limit 200", "limit 200", "limit 200"]);
  expect(f.audit.entries(c.id).filter(e => e.action === "egress_limit_applied")).toHaveLength(1);

  // each later step a little slower, still running, no new alert to the operator
  for (const [gb, mbit] of [[60, 100], [75, 50], [95, 25]] as const) {
    f.api.egress(serverId, gb * GB);
    await pass();
    expect(tc.at(-1)).toBe(`limit ${mbit}`);
    expect(view()).toEqual({ bytes: gb * GB, state: "slowed", until });
    expect(c.status).toBe("running");
  }
  expect(f.audit.entries(c.id).filter(e => e.action === "egress_limit_applied").map(e => e.detail?.mbit)).toEqual([200, 100, 50, 25]);
  expect(f.audit.entries(c.id).filter(e => e.action === "egress_slowed")).toHaveLength(1);
  expect(alerts()).toHaveLength(1);

  // past pause: alerted once, the machine pauses, and no wake of any kind brings it back this month
  f.api.egress(serverId, 110 * GB);
  await pass(2);
  expect(alerts()).toHaveLength(2);
  expect(alerts()[1]).toContain("paused until 2026-12-01");
  expect(c.status).toBe("sleeping");
  expect(f.api.machines.get(serverId)!.state).toBe("suspended");
  expect(view()).toEqual({ bytes: 110 * GB, state: "paused", until });
  expect(f.service.view(c).waking).toBe(false);
  await f.service.power(c.accountId, c.id, "on");
  await pass(4);
  expect(f.api.machines.get(serverId)!.state).toBe("suspended");
  expect(c.managed!.stayReason).toBe("egress_paused");
  expect(alerts()).toHaveLength(2);

  // the 1st: wakes work again, the limit left on the paused machine comes off, the meter starts over
  f.advance(until - f.now() + 60_000);
  f.api.egress(serverId, 0);
  await f.service.power(c.accountId, c.id, "on");
  await f.settle(c, x => x.status === "running", 20, 1_000);
  await pass();
  expect(tc.at(-1)).toBe("lift");
  expect(view()).toMatchObject({ bytes: 0, state: "ok", until: null });
  expect(f.audit.entries(c.id).map(e => e.action)).toEqual(expect.arrayContaining(["egress_alert", "egress_slowed", "egress_paused", "egress_lifted", "egress_limit_removed"]));
});

it("puts the limit back after a cold boot, and tells the operator once when it cannot be put in", async () => {
  const at = { t: Date.UTC(2026, 10, 9) };
  const c = { id: "c1", kind: "shared_s", serverId: "m_1", powerSince: at.t, managed: {} } as unknown as StoredCloud;
  const run = vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "limited eth0\n" }));
  const usage = vi.fn(async () => ({ from: 0, to: 0, runningSeconds: 0, vcpuSeconds: 0, memGiBSeconds: 0, diskGiBSeconds: 0, egressBytes: 60 * GB }));
  const alerts: string[] = [];
  const guard = createEgressGuard({ provider: { run, usage }, now: () => at.t, save: () => {}, log: () => {}, alert: (_c, text) => alerts.push(text) });
  await guard.step(c, true);
  expect(run).toHaveBeenCalledTimes(1);
  // a wake from a cold boot (the limit is gone with it): put back at once, before the next read
  at.t += 60_000; c.powerSince = at.t;
  await guard.step(c, true);
  expect(run).toHaveBeenCalledTimes(2);
  at.t += 60_000;
  await guard.step(c, true);
  expect(run).toHaveBeenCalledTimes(2);
  // the machine refuses it (no tc, say): tried again every 5 minutes, one alert at the third failure, never more
  run.mockResolvedValue({ ok: false, exitCode: 3, stdout: "no route\n" });
  for (let i = 0; i < 12; i++) { at.t += 5 * 60_000 + 1; c.powerSince = at.t - 1; await guard.step(c, true); }
  expect(alerts.filter(text => text.includes("could not be limited"))).toHaveLength(1);
  // a sleeping home is not read
  usage.mockClear();
  at.t += EGRESS_READ_MS * 2;
  await guard.step(c, false);
  expect(usage).not.toHaveBeenCalled();
});

it("counts every machine of the home this month: a new machine does not reset the meter", async () => {
  const at = { t: Date.UTC(2026, 10, 9) };
  const c = { id: "c1", kind: "shared_s", serverId: "m_1", powerSince: at.t, managed: {} } as unknown as StoredCloud;
  let bytes = 40 * GB;
  const guard = createEgressGuard({ provider: { run: async () => ({ ok: true, exitCode: 0, stdout: "limited eth0\n" }), usage: async () => ({ from: 0, to: 0, runningSeconds: 0, vcpuSeconds: 0, memGiBSeconds: 0, diskGiBSeconds: 0, egressBytes: bytes }) },
    now: () => at.t, save: () => {}, log: () => {}, alert: () => {} });
  await guard.step(c, true);
  c.serverId = "m_2"; bytes = 15 * GB; at.t += EGRESS_READ_MS;
  await guard.step(c, true);
  expect(guard.view(c)).toMatchObject({ bytes: 55 * GB, state: "slowed" });
  // the next month starts at zero
  at.t = Date.UTC(2026, 11, 1, 0, 1); bytes = 1 * GB;
  await guard.step(c, true);
  expect(guard.view(c)).toMatchObject({ bytes: 1 * GB, state: "ok" });
});

it("pauses at once a limited machine whose meter shows more than its step lets through (the owner took the limit off)", async () => {
  // 5 Mbit/s is 2.25 GB an hour, 100 Mbit/s 45: half again the rate plus two minutes of slack
  expect(egressTampered(3.3 * GB, 3_600_000, 5)).toBe(false);
  expect(egressTampered(3.6 * GB, 3_600_000, 5)).toBe(true);
  expect(egressTampered(68 * GB, 3_600_000, 100)).toBe(false);
  expect(egressTampered(70 * GB, 3_600_000, 100)).toBe(true);
  const limits = { alert: 10, steps: [{ gb: 50, mbit: 100 }], pause: 2_000 };
  for (const tampered of [false, true]) {
    const at = { t: Date.UTC(2026, 10, 9) };
    const c = { id: "c1", kind: "shared_s", serverId: "m_1", powerSince: at.t, managed: {} } as unknown as StoredCloud;
    let bytes = 55 * GB;
    const alerts: string[] = [];
    const guard = createEgressGuard({ provider: { run: async () => ({ ok: true, exitCode: 0, stdout: "limited eth0\n" }), usage: async () => ({ from: 0, to: 0, runningSeconds: 0, vcpuSeconds: 0, memGiBSeconds: 0, diskGiBSeconds: 0, egressBytes: bytes }) },
      now: () => at.t, save: () => {}, log: () => {}, alert: (_c, text) => alerts.push(text), limits: () => limits });
    await guard.step(c, true);
    expect(guard.view(c)!.state).toBe("slowed");
    // the hour the limit went in may still show unlimited upload: not held against it
    bytes += 200 * GB;
    for (let i = 0; i < 12; i++) { at.t += EGRESS_READ_MS; await guard.step(c, true); }
    expect(guard.view(c)!.state).toBe("slowed");
    // then two hours: at the limit (45 GB an hour), or at 400 Mbit/s (180 GB an hour)
    for (let i = 0; i < 24; i++) { at.t += EGRESS_READ_MS; bytes += (tampered ? 180 : 45) * EGRESS_READ_MS / 3_600_000 * GB; await guard.step(c, true); }
    expect(guard.view(c)!.state).toBe(tampered ? "paused" : "slowed");
    expect(guard.paused(c)).toBe(tampered);
    // paused for the removed limit, not for reaching the pause level
    expect(alerts.filter(text => text.includes("while limited to 100 Mbit/s (the limit was removed)"))).toHaveLength(tampered ? 1 : 0);
    expect(alerts.filter(text => text.includes("this month; it is paused"))).toHaveLength(0);
  }
});

it("measures the tamper rule against the step in place: a slower step starts its watch over", async () => {
  const limits = { alert: 10, steps: [{ gb: 50, mbit: 200 }, { gb: 300, mbit: 25 }], pause: 2_000 };
  const at = { t: Date.UTC(2026, 10, 9) };
  const c = { id: "c1", kind: "shared_s", serverId: "m_1", powerSince: at.t, managed: {} } as unknown as StoredCloud;
  let bytes = 55 * GB;
  const run = vi.fn(async (_id: string, _cmd: string) => ({ ok: true, exitCode: 0, stdout: "limited eth0\n" }));
  const guard = createEgressGuard({ provider: { run, usage: async () => ({ from: 0, to: 0, runningSeconds: 0, vcpuSeconds: 0, memGiBSeconds: 0, diskGiBSeconds: 0, egressBytes: bytes }) },
    now: () => at.t, save: () => {}, log: () => {}, alert: () => {}, limits: () => limits });
  // three hours at the first step's full 200 Mbit/s (90 GB an hour), past 300 GB into the 25 Mbit/s step
  for (let i = 0; i < 36; i++) { at.t += EGRESS_READ_MS; bytes += 90 * EGRESS_READ_MS / 3_600_000 * GB; await guard.step(c, true); }
  expect(run.mock.calls.at(-1)![1]).toBe(egressLimitCommand(25));
  expect(guard.view(c)!.state).toBe("slowed");
  // then the slower step holds: 11.25 GB an hour is not tampering, though the watch began at 200 Mbit/s
  for (let i = 0; i < 30; i++) { at.t += EGRESS_READ_MS; bytes += 11.25 * EGRESS_READ_MS / 3_600_000 * GB; await guard.step(c, true); }
  expect(guard.view(c)!.state).toBe("slowed");
});
