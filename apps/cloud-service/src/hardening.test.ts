import { describe, expect, it } from "vitest";
import { homeControlScript, homeSetupScript } from "./home.ts";
import { DEFAULT_MANAGED_SETTINGS } from "./lifecycle.ts";
import { homeFixture } from "./test-fixture.ts";

const MINUTE = 60_000;

describe("provider limits and conflicts", () => {
  it("a start refused for the pool waits for its nextStartAt: no start before it for any home, no failure, and no stop that would need one", async () => {
    const f = await homeFixture();
    const { c } = await f.paid();
    await f.asleep(c);
    // a second home, up long enough that only the pool can keep it from sleeping
    const other = (await f.paid("acct_2")).c;
    other.powerSince = f.now() - 30 * MINUTE;
    const resumes = () => f.api.requests.filter(r => r.method === "POST" && r.path.endsWith("/resume")).length;
    const notBefore = f.now() + 4 * MINUTE;
    f.api.limitStartsUntil(notBefore);
    await f.service.power(c.accountId, c.id, "on");
    expect(resumes()).toBe(1);
    f.power.idle = true; f.power.busy = [];
    // however often the service retries, nothing reaches the provider before its time, and nothing counts as a failure
    for (let n = 0; n < 6; n++) {
      f.advance(30_000);
      for (const x of [c, other]) { x.nextAttemptAt = 0; x.managed!.lastPowerAt = 0; }
      await f.service.reconcile();
      expect(resumes()).toBe(1);
      expect(c.attempts).toBe(0);
      // the pool waits for everyone: another home is not stopped while the next start may be refused
      expect(other.status).toBe("running");
    }
    expect(other.managed!.stayReason).toBe("provider_not_before");
    f.advance(notBefore - f.now() + 1_000);
    await f.settle(c, c => c.status === "running");
    expect(resumes()).toBe(2);
  });

  it("a 429 never fails a cloud: it backs off 30 s doubling to 5 minutes, honours Retry-After, and is logged once", async () => {
    const f = await homeFixture();
    const { c } = await f.paid();
    expect(c.status).toBe("running");
    f.power.idle = true; f.power.busy = [];
    f.advance(5 * MINUTE);
    f.api.limitNext(3);
    c.nextAttemptAt = 0; await f.service.reconcile();
    expect(c.status).toBe("running");
    expect(c.error).toBeNull();
    expect(c.attempts).toBe(0);
    // Retry-After: 40 s beats the first 30 s step
    expect(c.nextAttemptAt - f.now()).toBe(40_000);
    for (let n = 0; n < 2; n++) { c.nextAttemptAt = 0; await f.service.reconcile(); }
    expect(c.nextAttemptAt - f.now()).toBe(120_000);
    expect(f.audit.entries(c.id).filter(e => e.action === "provider_limit")).toHaveLength(1);
    await f.settle(c, c => c.status === "sleeping", 60, 5 * 60_000);
    expect(c.managed!.limitStreak).toBe(0);
  });

  it("a 409 on a power change is in progress, not a failure", async () => {
    const f = await homeFixture();
    const { c } = await f.paid();
    await f.provider.power(c.serverId!, "off");
    // another operation runs on the machine: the provider answers 409 operation_conflict
    f.api.busyNext(1);
    await expect(f.provider.power(c.serverId!, "on")).resolves.toBeUndefined();
    await f.provider.power(c.serverId!, "on");
    expect(f.api.machines.get(c.serverId!)!.state).toBe("running");
  });
});

describe("waking for a routine", () => {
  it("starts a sleeping home within the lead and its own spread before its next run, never later", async () => {
    const f = await homeFixture();
    const { c } = await f.paid();
    f.power.idle = true; f.power.busy = []; const due = f.now() + 3 * 3_600_000; f.power.nextDueAt = due;
    f.advance(5 * MINUTE);
    await f.settle(c, c => c.status === "sleeping", 60, 5 * 60_000);
    expect(c.managed!.nextDueAt).toBe(due);
    // the default lead is 2 minutes and the spread a few more: no wake 9 minutes out, a wake by the lead
    f.advance(due - 9 * MINUTE - f.now());
    c.nextAttemptAt = 0; await f.service.reconcile();
    expect(f.audit.entries(c.id).some(e => e.action === "wake" && e.reason === "routine_due")).toBe(false);
    for (let at = due - 8 * MINUTE; at <= due - DEFAULT_MANAGED_SETTINGS.wakeLeadMs && !f.audit.entries(c.id).some(e => e.action === "wake"); at += 30_000) {
      f.advance(at - f.now()); c.nextAttemptAt = 0; await f.service.reconcile();
    }
    const wake = f.audit.entries(c.id).find(e => e.action === "wake" && e.reason === "routine_due");
    expect(wake).toBeDefined();
    expect(due - wake!.at).toBeGreaterThanOrEqual(DEFAULT_MANAGED_SETTINGS.wakeLeadMs);
  });
});

describe("the machine's own guards", () => {
  const setup = homeSetupScript(), control = homeControlScript();
  it("caps memory: the home under 90%, bot computers under their slice, compressed swap, and the home killed last", () => {
    for (const line of ["MemoryMax=90%", "OOMScoreAdjust=-500", "OOMPolicy=continue", "MemoryMax=75%", "omb-zram", "cgroup-parent"]) expect(setup).toContain(line);
  });

  it("never restarts a home a resume kept running: the start command checks it answers with the same names first", () => {
    const start = control.slice(control.indexOf("  start)"), control.indexOf("  stop)"));
    expect(start.indexOf("systemctl is-active --quiet omb-home.service")).toBeLessThan(start.indexOf("systemctl restart omb-home.service"));
    expect(start).toContain("http://127.0.0.1:8799/api/health");
    expect(setup).not.toContain("pre-stop");
  });
});
