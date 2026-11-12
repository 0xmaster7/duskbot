// the egress guard: levels per plan, one alert each, the limit inside the machine, the pause, and the 1st
import { afterEach, expect, it, vi } from "vitest";
import { BILLING_CONFIG } from "../../dashboard/server/billing/plans.ts";
import { createEgressGuard, EGRESS_LIFT_COMMAND, EGRESS_LIMIT_COMMAND, EGRESS_READ_MS, egressLevel, egressLimits, egressTampered, GB } from "./egress.ts";
import { homeFixture } from "./test-fixture.ts";
import type { StoredCloud } from "../../dashboard/server/clouds/types.ts";

afterEach(() => { vi.restoreAllMocks(); });

it("reads each plan's levels from the billing config, the bigger plans about twice the room", () => {
  expect(egressLimits("shared_s")).toEqual({ alert: 25, slow: 50, pause: 100 });
  expect(egressLimits("shared_m")).toEqual({ alert: 50, slow: 100, pause: 200 });
  expect(egressLimits("dedicated")).toEqual(BILLING_CONFIG.egressGb.dedicated);
  expect(egressLimits("dedicated").pause).toBe(2 * egressLimits("shared_m").pause);
  expect(egressLimits("unknown")).toEqual(egressLimits("shared_s"));
  const limits = egressLimits("shared_s");
  expect([0, 24.9, 25, 49.9, 50, 99.9, 100, 900].map(gb => egressLevel(gb * GB, limits))).toEqual(["ok", "ok", "alert", "alert", "slow", "slow", "pause", "pause"]);
});

it("alerts once, slows the machine inside, pauses it and keeps it asleep, and lifts everything on the 1st", async () => {
  const f = await homeFixture();
  const { c } = await f.paid();
  const serverId = c.serverId!;
  const tc: string[] = [];
  f.api.onExec(({ cmd }) => {
    if (cmd === EGRESS_LIMIT_COMMAND) { tc.push("limit"); return { exitCode: 0, stdout: "limited eth0\n" }; }
    if (cmd === EGRESS_LIFT_COMMAND) { tc.push("lift"); return { exitCode: 0, stdout: "lifted\n" }; }
    return null;
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const alerts = () => warn.mock.calls.map(call => String(call[0])).filter(line => line.startsWith("managed: ALERT") && line.includes("to the internet"));
  const pass = async (n = 1) => { for (let i = 0; i < n; i++) { f.advance(EGRESS_READ_MS + 1_000); c.nextAttemptAt = 0; await f.service.reconcile(); } };
  const view = () => f.service.view(c).egress;

  // normal use: a read every 15 minutes, nothing else
  f.api.egress(serverId, 3 * GB);
  await pass(4);
  expect(view()).toMatchObject({ bytes: 3 * GB, state: "ok", until: null });
  expect(alerts()).toEqual([]);

  // past the alert: the operator hears once, whatever the next reads say
  f.api.egress(serverId, 30 * GB);
  await pass(3);
  expect(alerts()).toHaveLength(1);
  expect(alerts()[0]).toContain(`cloud ${c.id} sent 30 GB`);
  expect(view()!.state).toBe("ok");
  expect(tc).toEqual([]);

  // past slow: the limit goes in on the machine, is put back at each read, and the owner sees until when
  f.api.egress(serverId, 60 * GB);
  await pass();
  expect(tc).toEqual(["limit"]);
  const until = Date.UTC(2026, 11, 1);
  expect(view()).toEqual({ bytes: 60 * GB, state: "slowed", until });
  expect(c.status).toBe("running");
  await pass(2);
  expect(tc).toEqual(["limit", "limit", "limit"]);
  expect(f.audit.entries(c.id).filter(e => e.action === "egress_limit_applied")).toHaveLength(1);
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

it("pauses at once a limited machine whose meter shows more than the limit lets through (the owner took the limit off)", async () => {
  // 5 Mbit/s is 2.25 GB an hour: an hour of slack for the meter's hourly buckets, and half again the rate
  expect(egressTampered(4.4 * GB, 3_600_000)).toBe(false);
  expect(egressTampered(6 * GB, 3_600_000)).toBe(true);
  for (const tampered of [false, true]) {
    const at = { t: Date.UTC(2026, 10, 9) };
    const c = { id: "c1", kind: "shared_s", serverId: "m_1", powerSince: at.t, managed: {} } as unknown as StoredCloud;
    let bytes = 55 * GB;
    const alerts: string[] = [];
    const guard = createEgressGuard({ provider: { run: async () => ({ ok: true, exitCode: 0, stdout: "limited eth0\n" }), usage: async () => ({ from: 0, to: 0, runningSeconds: 0, vcpuSeconds: 0, memGiBSeconds: 0, diskGiBSeconds: 0, egressBytes: bytes }) },
      now: () => at.t, save: () => {}, log: () => {}, alert: (_c, text) => alerts.push(text) });
    await guard.step(c, true);
    expect(guard.view(c)!.state).toBe("slowed");
    // the hour the limit went in may still show unlimited upload: not held against it
    bytes += 20 * GB;
    for (let i = 0; i < 4; i++) { at.t += EGRESS_READ_MS; await guard.step(c, true); }
    expect(guard.view(c)!.state).toBe("slowed");
    // then two hours: at the limit (2.25 GB an hour), or at the host's 50 Mbit/s (22.5 GB an hour)
    for (let i = 0; i < 8; i++) { at.t += EGRESS_READ_MS; bytes += (tampered ? 22.5 : 2.25) / 4 * GB; await guard.step(c, true); }
    expect(guard.view(c)!.state).toBe(tampered ? "paused" : "slowed");
    expect(guard.paused(c)).toBe(tampered);
    // paused for the removed limit, not for reaching the pause level
    expect(alerts.filter(text => text.includes("the limit was removed"))).toHaveLength(tampered ? 1 : 0);
    expect(alerts.filter(text => text.includes("this month; it is paused"))).toHaveLength(0);
  }
});
