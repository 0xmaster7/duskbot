import { CLOUD_HOME } from "../../../electron/legacy-names.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { StoredSubscription } from "../../dashboard/server/billing/store.ts";
import { homeBackupKey } from "./backups.ts";
import { INSTABOX_BOOT_FILE, INSTABOX_PACKAGE_FILE, INSTABOX_SETUP_FILE } from "./home.ts";
import { pooledCostProfile } from "./power/pooled-profile.ts";
import { DAY_MS, entitlementOf } from "./retention.ts";
import { createSealer } from "../../dashboard/server/clouds/seal.ts";
import { BACKUP_SECRET, homeFixture, plan, SHA } from "./test-fixture.ts";

const execs = (f: Awaited<ReturnType<typeof homeFixture>>) => f.api.requests.filter(r => r.path.endsWith("/exec")).map(r => (r.body as { cmd: string }).cmd);

it("provisions a paid cloud: a labelled machine, secrets only in its boot file, package installed, home started", async () => {
  const f = await homeFixture();
  const { c } = await f.paid();
  expect(c).toMatchObject({ backend: "managed", status: "running", setupStep: null });
  expect(c.origin).toMatch(/^https:\/\/8080-[a-z0-9]+\.instabox\.tech$/);
  const create = f.api.requests.find(r => r.method === "POST" && r.path === "/v1/machines")!.body as Record<string, any>;
  const secret = createSealer(Buffer.alloc(32, 7)).unseal(c.bootstrapSecret);
  expect(JSON.stringify(create)).not.toContain(secret);
  expect(create.metadata).toMatchObject({ "omb.cloud": c.id, "omb.scope": "0123456789abcdef" });
  const machine = f.api.machines.get(c.serverId!)!;
  expect(machine.files.get(INSTABOX_SETUP_FILE)!.toString()).not.toContain(secret);
  expect(machine.files.get(INSTABOX_BOOT_FILE)!.toString()).toContain(secret);
  const commands = execs(f).filter(cmd => cmd.includes("omb-home"));
  expect(commands[0]).toContain(`omb-home install ${INSTABOX_PACKAGE_FILE} ${SHA}`);
  expect(commands[1]).toBe(`sudo -n ${CLOUD_HOME.root}/bin/omb-home start '${c.origin}' '${c.origin}'`);
  expect(JSON.stringify(f.audit.entries(c.id))).not.toContain(secret);
  expect(f.service.view(c)).toMatchObject({ provider: "managed", status: "running" });
});

it("calls a new home ready only once its bot computers can start, and never waits more than 15 minutes for their image", async () => {
  for (const finished of [true, false]) {
    const f = await homeFixture();
    let building = true;
    f.api.onExec(({ cmd }) => cmd.includes("omb-home desktop-status") ? { exitCode: 0, stdout: building ? "building\n" : "ready\n" } : null);
    const c = f.service.order({ ...plan, accountId: "acct_1", name: "My Cloud", color: null, region: "eu" });
    f.subscriptions.push({ id: "sub_img", accountId: "acct_1", cloudId: c.id, status: "active", currentPeriodEnd: f.now() + 30 * DAY_MS, updatedAt: f.now() } as unknown as StoredSubscription);
    f.service.activate(c.id, "sub_img", plan);
    for (let n = 0; n < 20; n++) { c.nextAttemptAt = 0; await f.service.reconcile(); }
    expect(c).toMatchObject({ status: "provisioning", setupStep: "checking", attempts: 0, error: null });
    if (finished) building = false; else f.advance(16 * 60_000);
    await f.settle(c, x => x.status === "running");
    expect(c.error).toBeNull();
  }
});

it("waits out a slow setup script without counting it as a failure", async () => {
  const f = await homeFixture({ setupPolls: 30 });
  const c = f.service.order({ ...plan, accountId: "acct_1", name: "My Cloud", color: null, region: "eu" });
  f.subscriptions.push({ id: "sub_slow", accountId: "acct_1", cloudId: c.id, status: "active", currentPeriodEnd: f.now() + 30 * DAY_MS, updatedAt: f.now() } as unknown as StoredSubscription);
  f.service.activate(c.id, "sub_slow", plan);
  for (let n = 0; n < 40 && c.status === "provisioning"; n++) { c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(c).toMatchObject({ status: "running", attempts: 0, error: null });
});

it("sleeps an idle home after the handshake, wakes it for its owner, and wakes it before a routine", async () => {
  const f = await homeFixture();
  const { c } = await f.paid();
  f.advance(5 * 60_000); f.power.idle = true; f.power.busy = [];
  await f.settle(c, c => c.status === "sleeping", 60, 5 * 60_000);
  // the handshake asks the home to agree to the idle time the policy saw, never less than the rails' minimum
  const asked = f.home.sleep.mock.calls.at(-1)! as unknown as [string, string, number];
  expect(asked[0]).toBe(c.origin);
  expect(asked[2]).toBeGreaterThanOrEqual(3);
  expect(f.api.machines.get(c.serverId!)!.state).toBe("suspended");
  await f.service.power(c.accountId, c.id, "on");
  await f.settle(c, c => c.status === "running");
  expect(f.api.machines.get(c.serverId!)!.processesPreserved).toBe(true);
  expect(f.audit.entries(c.id).map(e => e.action)).toEqual(expect.arrayContaining(["sleep", "wake", "awake"]));
  // a routine three hours out, far past a start's break-even: asleep now, awake within the lead and this home's spread before it
  f.advance(5 * 60_000); const due = f.now() + 3 * 60 * 60_000; f.power.nextDueAt = due;
  await f.settle(c, c => c.status === "sleeping", 60, 5 * 60_000);
  f.advance(due - 10 * 60_000 - f.now()); c.nextAttemptAt = 0; await f.service.reconcile();
  expect(c.status).toBe("sleeping");
  f.advance(9 * 60_000); await f.settle(c, c => c.status === "running");
  expect(f.audit.entries(c.id).filter(e => e.action === "wake").at(-1)!.reason).toBe("routine_due");
});

it("backs up an idle home's volume from the running machine before it sleeps, encrypted off the provider, and keeps the newest generations", async () => {
  const f = await homeFixture();
  const { c } = await f.paid();
  for (let day = 0; day < 4; day++) {
    f.advance(DAY_MS); f.power.idle = true; f.power.busy = [];
    await f.settle(c, c => c.status === "sleeping", 60, 5 * 60_000);
    expect(f.audit.entries(c.id).filter(e => e.action === "backup").at(-1)!.reason).toBe("before_sleep");
    await f.service.power(c.accountId, c.id, "on"); await f.settle(c, c => c.status === "running");
  }
  expect(c.managed!.backups).toHaveLength(3);
  expect(c.managed!.backups.every(g => g.verifiedAt !== null)).toBe(true);
  // the backup came from the live snapshot, which is removed from the machine once read
  expect(execs(f).filter(cmd => cmd.includes("omb-home snapshot-done")).length).toBeGreaterThanOrEqual(4);
  const files = readdirSync(join(f.dataDir, "managed-backups", c.id));
  expect(files).toHaveLength(3);
  for (const file of files) expect(readFileSync(join(f.dataDir, "managed-backups", c.id, file)).includes("Test bot")).toBe(false);
});

it("recovers a lost machine from its newest backup into a fresh one and tells the owner", async () => {
  const f = await homeFixture();
  const { c } = await f.paid();
  f.advance(DAY_MS); f.power.idle = true; f.power.busy = [];
  await f.settle(c, c => c.status === "sleeping", 60, 5 * 60_000);
  expect(c.managed!.backups).toHaveLength(1);
  const lost = c.serverId!;
  f.api.lose(lost);
  // one 404 is not a lost machine: only repeated ones over half an hour, and gone from the account's list
  c.nextAttemptAt = 0; await f.service.reconcile();
  expect(c.serverId).toBe(lost);
  for (let n = 0; n < 40 && !(c.status === "running" && c.serverId !== lost); n++) { f.advance(11 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(c.status === "running" && c.serverId !== lost).toBe(true);
  expect(c.managed!.attempt).toBe(1);
  const fresh = f.api.machines.get(c.serverId!)!;
  expect(JSON.parse(fresh.volume.get("data/.omb-cloud-home.json")!.toString())).toMatchObject({ machine: c.id });
  expect(fresh.volume.get(`data/${CLOUD_HOME.dataName}/bots.json`)!.toString()).toContain("Test bot");
  expect(f.notices.map(n => n.kind)).toContain("recovered");
  expect(f.api.deletes()).toHaveLength(0);
});

it("keeps an ended plan's home asleep for 45 days with notices, then deletes it only after the final backup it took before sleeping", async () => {
  const f = await homeFixture();
  const { c, sub } = await f.paid();
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(c, c => c.status === "stopped");
  // the final copy was read from the running home right before it slept for its plan, and the verdict accepts it
  const final = c.managed!.backups.at(-1)!;
  expect(final.verifiedAt).not.toBeNull();
  expect(final.snapshotAt).toBeGreaterThanOrEqual(c.managed!.lastStopAt!);
  expect(f.audit.entries(c.id).filter(e => e.action === "backup").map(e => e.reason)).toEqual(["plan_ended"]);
  expect(f.api.machines.get(c.serverId!)!.state).toBe("suspended");
  expect(f.notices.map(n => n.kind)).toEqual(["ended"]);
  for (const day of [15, 38, 44, 44.9]) { f.advance((day - (f.now() - sub.currentPeriodEnd!) / DAY_MS) * DAY_MS); c.nextAttemptAt = 0; await f.service.reconcile(); await f.service.reconcile(); }
  expect(f.notices.map(n => n.kind)).toEqual(["ended", "left_30", "left_7", "left_1"]);
  expect(f.api.deletes()).toHaveLength(0);
  expect(c.status).toBe("stopped");
  // no wake was needed for it: the home stayed asleep the whole retention period
  expect(f.audit.entries(c.id).filter(e => e.action === "wake")).toHaveLength(0);
  f.advance(0.2 * DAY_MS);
  await f.settle(c, c => c.status === "destroyed");
  expect(f.api.deletes()).toHaveLength(1);
  expect(f.alerts).toEqual(expect.arrayContaining(["delete_requested:retention_over", "deleted:retention_over"]));
  expect(f.notices.at(-1)!.kind).toBe("deleted");
  expect(f.workspaces.remove).toHaveBeenCalledWith("workspace-1");
  // the backups outlive the machine for the tail, then go
  expect(f.backups.list(c.id).length).toBeGreaterThan(0);
  f.advance(31 * DAY_MS); await f.service.reconcile();
  expect(f.backups.list(c.id)).toEqual([]);
});

it("an ended plan's home that paused itself with no final backup is woken once to take it, then deleted after retention", async () => {
  const f = await homeFixture();
  const { c, sub } = await f.paid();
  // our lease lapsed: the provider paused the machine on its own, with data newer than any backup
  f.advance(60_000); f.api.autoPause(c.serverId!);
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(c, c => c.status === "stopped" && (c.managed!.backups.at(-1)?.verifiedAt ?? null) !== null, 20, 60_000);
  for (let n = 0; n < 10; n++) { f.advance(30 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile(); }
  const wakes = f.audit.entries(c.id).filter(e => e.action === "wake");
  expect(wakes.map(e => e.reason)).toEqual(["final_backup"]);
  expect(f.api.machines.get(c.serverId!)!.state).toBe("suspended");
  expect(c.managed!.backups.at(-1)!.snapshotAt).toBeGreaterThanOrEqual(c.managed!.lastStopAt!);
  f.advance(46 * DAY_MS);
  await f.settle(c, c => c.status === "destroyed");
  expect(f.api.deletes()).toHaveLength(1);
});

it("renewing before the end of retention brings the home back without losing anything", async () => {
  const f = await homeFixture();
  const { c, sub } = await f.paid();
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(c, c => c.status === "stopped");
  f.advance(20 * DAY_MS);
  sub.status = "active"; sub.currentPeriodEnd = f.now() + 30 * DAY_MS;
  await f.settle(c, c => c.status === "running");
  expect(f.notices.map(n => n.kind)).toContain("resumed");
  expect(f.api.deletes()).toHaveLength(0);
});

it("a provider outage while running never marks the cloud failed", async () => {
  const f = await homeFixture();
  const { c } = await f.paid();
  for (let n = 0; n < 12; n++) { f.api.failNext(1); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(c.status).toBe("running");
  expect(c.error).toBeNull();
});

it("pauses machines no live cloud runs on and never deletes one that may hold someone's data", async () => {
  const f = await homeFixture();
  const { c } = await f.paid();
  const stray = await f.provider.create({ cloudId: `c${"e".repeat(24)}`, spec: plan.spec, region: "eu", userData: "", ttlSeconds: 3600 });
  f.advance(1000);
  const duplicate = await f.provider.create({ cloudId: c.id, spec: plan.spec, region: "eu", userData: "", ttlSeconds: 3600, attempt: 9 });
  f.advance(31 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile();
  expect(f.api.machines.get(stray.id)!.state).toBe("suspended");
  expect(f.api.machines.get(duplicate.id)!.state).toBe("suspended");
  // newer than the cloud's own machine: kept for an operator, never retired
  expect(c.managed!.retired.map(r => r.serverId)).not.toContain(duplicate.id);
  expect(f.audit.entries(c.id).map(e => e.action)).toContain("orphan_kept");
  for (let day = 0; day < 50; day++) { f.advance(DAY_MS); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(f.api.deletes()).toHaveLength(0);
  expect(f.audit.entries().map(e => e.action)).toContain("orphan_unclaimed");
  expect(f.api.machines.has(stray.id) && f.api.machines.has(duplicate.id) && f.api.machines.has(c.serverId!)).toBe(true);
});

it("a plan that drops the desktop ends its entitlement at the drop, and a renewal cancels a pending owner delete", async () => {
  const sub = { id: "sub_x", cloudId: null, status: "active", currentPeriodEnd: 50 * DAY_MS, updatedAt: 0, lastEventAt: 5 * DAY_MS } as unknown as StoredSubscription;
  expect(entitlementOf([sub], { id: "c1", subscriptionId: "sub_x", endsAt: 20 * DAY_MS }, 10 * DAY_MS)).toMatchObject({ active: true, until: null });
  expect(entitlementOf([sub], { id: "c1", subscriptionId: "sub_x", endsAt: 20 * DAY_MS }, 21 * DAY_MS)).toMatchObject({ active: false, until: 20 * DAY_MS });
  expect(entitlementOf([sub], { id: "c1", subscriptionId: "sub_x", ended: true, endedAt: 15 * DAY_MS }, 21 * DAY_MS)).toMatchObject({ active: false, until: 15 * DAY_MS });
  // later events never move the date: a renewal of the same subscription after the cloud ended changes nothing
  expect(entitlementOf([{ ...sub, lastEventAt: 30 * DAY_MS, currentPeriodEnd: 80 * DAY_MS } as StoredSubscription], { id: "c1", subscriptionId: "sub_x", ended: true, endedAt: 15 * DAY_MS }, 31 * DAY_MS)).toMatchObject({ until: 15 * DAY_MS });
  // a subscription that will not renew counts only to its period end, whatever its status
  expect(entitlementOf([{ ...sub, cloudId: "c1", cancelAtPeriodEnd: true, currentPeriodEnd: 20 * DAY_MS } as StoredSubscription], { id: "c1", subscriptionId: "sub_x" }, 21 * DAY_MS)).toMatchObject({ active: false, until: 20 * DAY_MS });
  const f = await homeFixture();
  const { c, sub: paid } = await f.paid();
  paid.status = "ended"; paid.currentPeriodEnd = f.now(); paid.lastEventAt = f.now();
  await f.settle(c, c => c.status === "stopped");
  f.service.managed!.requestDelete(c, token => `https://dash.example.test/#${token}`);
  const token = f.notices.findLast(n => n.kind === "delete_requested")!.link!.split("#")[1]!;
  f.service.managed!.confirmDelete(c, token);
  paid.status = "active"; paid.currentPeriodEnd = f.now() + 30 * DAY_MS;
  await f.settle(c, c => c.status === "running");
  expect(c.managed!.deleteRequest!.cancelledAt).not.toBeNull();
  paid.status = "ended"; paid.currentPeriodEnd = f.now(); paid.lastEventAt = f.now();
  f.advance(8 * DAY_MS); await f.settle(c, c => c.status === "stopped");
  for (let n = 0; n < 4; n++) { c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(f.api.deletes()).toHaveLength(0);
});

it("a delete whose answer was lost is never mistaken for a lost machine, and cannot be cancelled mid-way", async () => {
  const f = await homeFixture();
  const { c, sub } = await f.paid();
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(c, c => c.status === "stopped");
  expect(c.managed!.backups.at(-1)?.verifiedAt ?? null).not.toBeNull();
  f.service.managed!.requestDelete(c, token => `https://dash.example.test/#${token}`);
  f.service.managed!.confirmDelete(c, f.notices.findLast(n => n.kind === "delete_requested")!.link!.split("#")[1]!);
  f.advance(8 * DAY_MS);
  const real = f.provider.requestDelete;
  f.provider.requestDelete = async id => { await real(id); throw new Error("answer lost"); };
  c.nextAttemptAt = 0; await f.service.reconcile();
  expect(c.status).toBe("destroying");
  expect(c.managed!.deleteRequest!.cancelledAt).toBeNull();
  expect(() => f.service.managed!.cancelDelete(c)).toThrow("unavailable");
  f.provider.requestDelete = real;
  await f.settle(c, c => c.status === "destroyed");
  expect(c.managed!.attempt).toBe(0);
  expect(f.notices.map(n => n.kind)).not.toContain("recovered");
});

it("a plan upgrade resizes the machine in place: its disk kept, booted on the new size, started", async () => {
  const f = await homeFixture();
  const { c } = await f.paid();
  const machine = f.api.machines.get(c.serverId!)!;
  machine.volume.set(`data/${CLOUD_HOME.dataName}/kept.json`, Buffer.from("kept"));
  expect([machine.vcpus, machine.memMiB]).toEqual([2, 4096]);
  f.service.changePlan(c.id, { kind: "shared_m", placement: "pool", spec: { vcpu: 4, ramGb: 8, diskGb: 80 }, botComputers: 5 });
  // waits for the owner's "restart now" (or the next idle sleep); here the owner asks
  f.advance(5 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile();
  expect(machine.vcpus).toBe(2);
  f.service.managed!.resizeNow(c);
  for (let n = 0; n < 20 && !(c.status === "running" && !f.service.managed!.resizing(c)); n++) { c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(c).toMatchObject({ status: "running", spec: { vcpu: 4, ramGb: 8, diskGb: 80 } });
  expect(c.serverId).toBe(machine.id);
  expect([machine.vcpus, machine.memMiB]).toEqual([4, 8192]);
  expect(machine.volume.get(`data/${CLOUD_HOME.dataName}/kept.json`)!.toString()).toBe("kept");
  expect(f.audit.entries(c.id).map(e => e.action)).toContain("resize");
  expect(f.service.managed!.resizing(c)).toBe(false);
});

it("a replaced machine that answers again is paused and kept, never deleted", async () => {
  const f = await homeFixture();
  const { c } = await f.paid();
  f.advance(DAY_MS); f.power.idle = true; f.power.busy = [];
  await f.settle(c, c => c.status === "sleeping", 60, 5 * 60_000);
  await f.service.power(c.accountId, c.id, "on"); await f.settle(c, c => c.status === "running");
  const original = c.serverId!;
  // the provider stops answering for this one machine long enough, and leaves it off the list: it is taken for lost
  const machine = f.provider.machine, listed = f.provider.listed;
  f.provider.machine = async id => id === original ? null : machine(id);
  f.provider.listed = async id => id === original ? false : listed(id);
  for (let n = 0; n < 40 && !(c.status === "running" && c.serverId !== original); n++) { f.advance(11 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(c.serverId).not.toBe(original);
  expect(c.managed!.retired.map(r => r.serverId)).toContain(original);
  // it answers again, still running: paused and charged to the home; nothing deleted
  f.provider.machine = machine; f.provider.listed = listed;
  for (let n = 0; n < 6; n++) { f.advance(11 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(f.api.machines.get(original)!.state).toBe("suspended");
  expect(f.audit.entries(c.id).map(e => e.action)).toContain("retired_stopped");
  for (let day = 0; day < 20; day++) { f.advance(DAY_MS); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(f.api.deletes()).toHaveLength(0);
  expect(f.api.machines.has(original)).toBe(true);
  // a backup still opens with this service's key only
  expect(f.backups.read(c.id, homeBackupKey(BACKUP_SECRET, c.id), c.managed!.backups.at(-1)!.file).includes("Test bot")).toBe(true);
});

it("charges every start to the home's monthly book, and keeps a home up once the provider caused the reserve's worth of starts", async () => {
  const f = await homeFixture({ costProfile: pooledCostProfile() });
  const { c } = await f.paid();
  const lines = () => readFileSync(join(f.dataDir, "spend", "2026-11.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l) as { c: string; e: string; cents?: number; kind?: string });
  // the create: charged at the worst price before the provider was asked, settled to the included price the pool proves
  expect(lines().filter(l => l.c === c.id).map(l => `${l.e}${l.cents === undefined ? "" : `:${l.cents}`}`).slice(0, 3)).toEqual(["open", "start:7", "settle:7"]);
  // the provider stops the machine five times behind our back: each restart is a start nobody chose
  for (let n = 0; n < 5; n++) {
    f.api.machines.get(c.serverId!)!.state = "stopped";
    f.api.machines.get(c.serverId!)!.ready = false;
    await f.settle(c, c => c.status === "running" && f.api.machines.get(c.serverId!)!.state === "running", 20, 30_000);
  }
  expect(lines().filter(l => l.c === c.id && l.e === "start").length).toBe(6);
  f.advance(5 * 60_000); f.power.idle = true; f.power.busy = [];
  for (let n = 0; n < 20; n++) { c.nextAttemptAt = 0; await f.service.reconcile(); f.advance(5 * 60_000); }
  expect(c.status).toBe("running");
  expect(c.managed!.stayReason).toBe("cost_reserve_used");
  expect(f.audit.entries(c.id).filter(e => e.action === "cost_ceiling_alert").map(e => e.reason)).toEqual(["reserve"]);
});
