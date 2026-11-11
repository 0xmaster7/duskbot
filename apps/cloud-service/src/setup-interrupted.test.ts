import { expect, it } from "vitest";
import type { StoredSubscription } from "../../dashboard/server/billing/store.ts";
import { INSTABOX_SETUP_STATUS } from "./home.ts";
import { DAY_MS } from "./retention.ts";
import { homeFixture, plan, SHA } from "./test-fixture.ts";

type Fixture = Awaited<ReturnType<typeof homeFixture>>;

function ordered(f: Fixture) {
  const c = f.service.order({ ...plan, accountId: "acct_1", name: "My Cloud", color: null, region: "eu" });
  const sub = { id: "sub_setup", accountId: "acct_1", cloudId: c.id, status: "active", currentPeriodEnd: f.now() + 30 * DAY_MS, updatedAt: f.now() } as unknown as StoredSubscription;
  f.subscriptions.push(sub);
  f.service.activate(c.id, sub.id, plan);
  return { c, sub };
}
const end = (f: Fixture, sub: StoredSubscription) => Object.assign(sub, { status: "ended", currentPeriodEnd: f.now() });
const renew = (f: Fixture, sub: StoredSubscription) => Object.assign(sub, { status: "active", currentPeriodEnd: f.now() + 30 * DAY_MS });
const creates = (f: Fixture) => f.api.requests.filter(r => r.method === "POST" && r.path === "/v1/machines").length;

it("a setup script that fails once gets a fresh machine, and the failed one is retired, not used", async () => {
  const f = await homeFixture();
  let failures = 0;
  f.api.onExec(({ machine, cmd }) => {
    if (cmd.includes("setsid nohup") && failures++ === 0) { machine.files.set(INSTABOX_SETUP_STATUS, Buffer.from("1\n")); return { exitCode: 0, stdout: "launched\n" }; }
    return null;
  });
  const { c } = ordered(f);
  await f.settle(c, x => x.status === "running", 30);
  expect(c).toMatchObject({ setupStep: null, error: null });
  expect(c.managed!.installed).toBe(SHA);
  expect(creates(f)).toBe(2);
  expect(c.managed!.retired).toHaveLength(1);
  expect(c.managed!.retired[0]!.serverId).not.toBe(c.serverId);
  expect(f.audit.entries(c.id).map(e => e.action)).toContain("setup_failed");
});

it("a setup that keeps failing stops after three machines and says so", async () => {
  const f = await homeFixture();
  f.api.onExec(({ machine, cmd }) => {
    if (cmd.includes("setsid nohup")) { machine.files.set(INSTABOX_SETUP_STATUS, Buffer.from("1\n")); return { exitCode: 0, stdout: "launched\n" }; }
    return null;
  });
  const { c } = ordered(f);
  await f.settle(c, x => x.status === "error", 40);
  expect(creates(f)).toBe(3);
  expect(c.managed!.retired).toHaveLength(2);
});

it("a plan cancelled mid-setup carries on with the setup once it is paid again, package and all", async () => {
  const f = await homeFixture();
  const { c, sub } = ordered(f);
  c.nextAttemptAt = 0; await f.service.reconcile();
  expect(c).toMatchObject({ status: "provisioning", setupStep: "storage" });
  end(f, sub);
  await f.settle(c, x => x.status === "stopped" && f.api.machines.get(x.serverId!)?.state === "suspended", 10);
  expect(c.setupStep).toBe("storage");
  renew(f, sub);
  await f.settle(c, x => x.status === "running", 20);
  expect(c.managed!.installed).toBe(SHA);
  expect(creates(f)).toBe(1);
  expect(f.audit.entries(c.id).map(e => e.action)).toContain("setup_resumed");
});

it("a plan cancelled before its machine was made gets a machine once it is paid again", async () => {
  const f = await homeFixture();
  const { c, sub } = ordered(f);
  end(f, sub);
  c.nextAttemptAt = 0; await f.service.reconcile();
  expect(c).toMatchObject({ status: "stopped", setupStep: "reserving", serverId: null });
  renew(f, sub);
  await f.settle(c, x => x.status === "running", 20);
  expect(creates(f)).toBe(1);
});

it("a home cut off mid-setup is never woken for a final backup and is deleted once retention ends", async () => {
  const f = await homeFixture();
  const { c, sub } = ordered(f);
  c.nextAttemptAt = 0; await f.service.reconcile();
  end(f, sub);
  for (let day = 0; day < 40 && c.status !== "destroyed"; day++) { f.advance(DAY_MS); c.nextAttemptAt = 0; await f.service.reconcile(); }
  const actions = f.audit.entries(c.id).map(e => e.action);
  expect(c.status).toBe("destroyed");
  expect(actions).not.toContain("wake");
  expect(actions).not.toContain("backup_refused");
  expect(f.api.deletes()).toHaveLength(1);
});

it("a home whose final backup cannot succeed is woken for it ever less often, not every ten minutes", async () => {
  const f = await homeFixture({ settings: { maxBackupBytes: 10 } });
  const { c, sub } = await f.paid();
  end(f, sub);
  for (let n = 0; n < 6 * 24 * 3; n++) { f.advance(10 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile(); }
  const wakes = f.audit.entries(c.id).filter(e => e.action === "wake" && e.reason === "final_backup").length;
  expect(wakes).toBeGreaterThan(1);
  expect(wakes).toBeLessThanOrEqual(10);
  expect(c.managed!.backupProblem).toBe("too_large");
});
