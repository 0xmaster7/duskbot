import { createCipheriv, randomBytes } from "node:crypto";
import { chmodSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { StoredSubscription } from "../../dashboard/server/billing/store.ts";
import { boatBackupKey } from "./backups.ts";
import { backupKey } from "./home.ts";
import { DAY_MS, entitlementOf } from "./retention.ts";
import { createSealer } from "../../dashboard/server/clouds/seal.ts";
import { BACKUP_SECRET, boatFixture, plan, SHA } from "./test-fixture.ts";

it("provisions a paid cloud on Boat: labelled sandbox, secrets only in its boot file, package installed, home started", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  expect(c).toMatchObject({ backend: "managed", status: "running", setupStep: null });
  expect(c.origin).toMatch(/^https:\/\/.+\.on\.boat\.dev$/);
  const create = f.api.requests.find(r => r.method === "POST" && r.path === "/sandboxes")!.body as Record<string, any>;
  const secret = createSealer(Buffer.alloc(32, 7)).unseal(c.bootstrapSecret);
  expect(create.setupScript).not.toContain(secret);
  expect(create.files[0].path).toBe("/home/user/.omb-boot.json");
  expect(create.files[0].content).toContain(secret);
  const commands = f.api.requests.filter(r => r.path.endsWith("/commands")).map(r => (r.body as { command: string }).command);
  expect(commands[0]).toContain(`omb-home install /home/user/omb-home.tgz ${SHA}`);
  expect(commands[1]).toBe(`sudo -n /usr/lib/duskbot/bin/omb-home start '${c.origin}' '${c.origin}'`);
  expect(JSON.stringify(f.audit.entries(c.id))).not.toContain(secret);
  expect(f.service.view(c)).toMatchObject({ provider: "managed", status: "running" });
});

it("waits out a slow setup script without counting it as a failure", async () => {
  const f = await boatFixture({ setupPolls: 30 });
  const c = f.service.order({ ...plan, accountId: "acct_1", name: "My Cloud", color: null, region: "eu" });
  f.subscriptions.push({ id: "sub_slow", accountId: "acct_1", cloudId: c.id, status: "active", currentPeriodEnd: f.now() + 30 * DAY_MS, updatedAt: f.now() } as unknown as StoredSubscription);
  f.service.activate(c.id, "sub_slow", plan);
  for (let n = 0; n < 40 && c.status === "provisioning"; n++) { c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(c).toMatchObject({ status: "running", attempts: 0, error: null });
});

it("sleeps an idle home after the handshake, wakes it for its owner, and wakes it before a routine", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  f.advance(3 * 60_000); f.power.idle = true; f.power.busy = [];
  await f.settle(c, c => c.status === "sleeping");
  expect(f.home.sleep).toHaveBeenCalledWith(c.origin, expect.any(String), 15);
  expect(f.api.sandboxes.get(c.serverId!)!.state).toMatch(/archiv/);
  await f.service.reconcile();
  expect(f.api.sandboxes.get(c.serverId!)!.state).toBe("archived");
  await f.service.power(c.accountId, c.id, "on");
  await f.settle(c, c => c.status === "running");
  expect(f.audit.entries(c.id).map(e => e.action)).toEqual(expect.arrayContaining(["sleep", "wake", "awake"]));
  // a routine at +30 minutes: asleep now, awake two minutes before it
  f.advance(3 * 60_000); f.power.nextDueAt = f.now() + 30 * 60_000;
  await f.settle(c, c => c.status === "sleeping");
  f.advance(20 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile();
  expect(c.status).toBe("sleeping");
  f.advance(9 * 60_000); await f.settle(c, c => c.status === "running");
  expect(f.audit.entries(c.id).filter(e => e.action === "wake").at(-1)!.reason).toBe("routine_due");
});

it("backs up a sleeping home's volume encrypted outside Boat and keeps at least two generations", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  for (let day = 0; day < 4; day++) {
    f.advance(DAY_MS); f.power.idle = true; f.power.busy = [];
    await f.settle(c, c => c.status === "sleeping");
    await f.settle(c, c => c.managed!.backups.at(-1)?.at === f.now());
    await f.service.power(c.accountId, c.id, "on"); await f.settle(c, c => c.status === "running");
  }
  expect(c.managed!.backups).toHaveLength(3);
  expect(c.managed!.backups.every(g => g.verifiedAt !== null)).toBe(true);
  const files = readdirSync(join(f.dataDir, "boat-backups", c.id));
  expect(files).toHaveLength(3);
  for (const file of files) expect(readFileSync(join(f.dataDir, "boat-backups", c.id, file)).includes("Test bot")).toBe(false);
});

it("recovers a lost machine from its newest backup into a fresh sandbox and tells the owner", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  f.advance(DAY_MS); f.power.idle = true; f.power.busy = [];
  await f.settle(c, c => c.status === "sleeping");
  await f.settle(c, c => c.managed!.backups.length === 1);
  const lost = c.serverId!;
  f.api.lose(lost);
  // one 404 is not a lost machine: only repeated ones over half an hour, and gone from the account's list
  c.nextAttemptAt = 0; await f.service.reconcile();
  expect(c.serverId).toBe(lost);
  for (let n = 0; n < 40 && !(c.status === "running" && c.serverId !== lost); n++) { f.advance(11 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(c.status === "running" && c.serverId !== lost).toBe(true);
  expect(c.managed!.attempt).toBe(1);
  const fresh = f.api.sandboxes.get(c.serverId!)!;
  expect(fresh.volume.get("__system__/data/.omb-cloud-home.json")!.toString()).toBe("restored-marker");
  expect(f.notices.map(n => n.kind)).toContain("recovered");
  expect(f.api.deletes()).toHaveLength(0);
});

it("keeps an ended plan's home stopped for 45 days with notices, then deletes it only after a verified final backup", async () => {
  const f = await boatFixture();
  const { c, sub } = await f.paid();
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(c, c => c.status === "stopped");
  await f.settle(c, c => (c.managed!.backups.at(-1)?.verifiedAt ?? null) !== null);
  expect(f.notices.map(n => n.kind)).toEqual(["ended"]);
  for (const day of [15, 38, 44, 44.9]) { f.advance((day - (f.now() - sub.currentPeriodEnd!) / DAY_MS) * DAY_MS); c.nextAttemptAt = 0; await f.service.reconcile(); await f.service.reconcile(); }
  expect(f.notices.map(n => n.kind)).toEqual(["ended", "left_30", "left_7", "left_1"]);
  expect(f.api.deletes()).toHaveLength(0);
  expect(c.status).toBe("stopped");
  f.advance(0.2 * DAY_MS);
  await f.settle(c, c => c.status === "destroyed");
  expect(f.api.deletes()).toHaveLength(1);
  expect(f.alerts).toEqual(expect.arrayContaining(["delete_requested:retention_over", "deleted:retention_over"]));
  expect(f.notices.at(-1)!.kind).toBe("deleted");
  expect(f.workspaces.remove).toHaveBeenCalledWith("workspace-1");
  // the backups outlive the sandbox for the tail, then go
  expect(f.backups.list(c.id).length).toBeGreaterThan(0);
  f.advance(31 * DAY_MS); await f.service.reconcile();
  expect(f.backups.list(c.id)).toEqual([]);
});

it("renewing before the end of retention brings the home back without losing anything", async () => {
  const f = await boatFixture();
  const { c, sub } = await f.paid();
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(c, c => c.status === "stopped");
  f.advance(20 * DAY_MS);
  sub.status = "active"; sub.currentPeriodEnd = f.now() + 30 * DAY_MS;
  await f.settle(c, c => c.status === "running");
  expect(f.notices.map(n => n.kind)).toContain("resumed");
  expect(f.api.deletes()).toHaveLength(0);
});

it("refreshes a stopped disk before Boat's 14 days so retained data stays resumable", async () => {
  const f = await boatFixture();
  const { c, sub } = await f.paid();
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(c, c => c.status === "stopped");
  await f.service.reconcile();
  const stoppedAt = f.api.sandboxes.get(c.serverId!)!.stoppedAt!;
  f.advance(11 * DAY_MS + 60_000);
  await f.settle(c, c => (f.api.sandboxes.get(c.serverId!)!.stoppedAt ?? 0) > stoppedAt, 10);
  expect(f.audit.entries(c.id).map(e => e.action)).toContain("refresh");
  expect(c.status).toBe("stopped");
});

it("a Boat outage while running never marks the cloud failed", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  for (let n = 0; n < 12; n++) { f.api.failNext(1); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(c.status).toBe("running");
  expect(c.error).toBeNull();
});

it("stops sandboxes no live cloud runs on and never deletes one that may hold someone's data", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  const stray = await f.provider.create({ cloudId: `c${"e".repeat(24)}`, spec: plan.spec, region: "eu", userData: "", ttlSeconds: 3600 });
  f.advance(1000);
  const duplicate = await f.provider.create({ cloudId: c.id, spec: plan.spec, region: "eu", userData: "", ttlSeconds: 3600, attempt: 9 });
  for (const id of [stray.id, duplicate.id]) await f.provider.sandbox(id);
  f.advance(31 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile();
  expect(f.api.sandboxes.get(stray.id)!.state).toMatch(/archiv/);
  expect(f.api.sandboxes.get(duplicate.id)!.state).toMatch(/archiv/);
  // newer than the cloud's own sandbox: kept for an operator, never retired
  expect(c.managed!.retired.map(r => r.serverId)).not.toContain(duplicate.id);
  expect(f.audit.entries(c.id).map(e => e.action)).toContain("orphan_kept");
  for (let day = 0; day < 50; day++) { f.advance(DAY_MS); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(f.api.deletes()).toHaveLength(0);
  expect(f.audit.entries().map(e => e.action)).toContain("orphan_unclaimed");
  expect(f.api.sandboxes.has(stray.id) && f.api.sandboxes.has(duplicate.id) && f.api.sandboxes.has(c.serverId!)).toBe(true);
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
  const f = await boatFixture();
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
  const f = await boatFixture();
  const { c, sub } = await f.paid();
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(c, c => c.status === "stopped");
  await f.settle(c, c => (c.managed!.backups.at(-1)?.verifiedAt ?? null) !== null);
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

it("backups sealed with the home's own key are sealed again with the service's key, and still restore", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  f.advance(DAY_MS); f.power.idle = true; f.power.busy = [];
  await f.settle(c, c => c.status === "sleeping");
  await f.settle(c, c => c.managed!.backups.length === 1);
  // the file as an earlier version wrote it: keyed from the bootstrap secret the home also holds
  const g = c.managed!.backups[0]!, path = join(f.dataDir, "boat-backups", c.id, g.file);
  const tar = f.backups.read(c.id, boatBackupKey(BACKUP_SECRET, c.id), g.file);
  const legacy = backupKey(createSealer(Buffer.alloc(32, 7)).unseal(c.bootstrapSecret)), iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", legacy, iv);
  cipher.setAAD(Buffer.from(c.id));
  const body = Buffer.concat([cipher.update(tar), cipher.final()]);
  chmodSync(path, 0o600); writeFileSync(path, Buffer.concat([Buffer.from("OMBB1\n"), iv, body, cipher.getAuthTag()]));
  expect(f.backups.version(c.id, g.file)).toBe(1);
  c.nextAttemptAt = 0; await f.service.reconcile();
  const now = c.managed!.backups[0]!;
  expect(f.backups.version(c.id, now.file)).toBe(2);
  expect(f.backups.read(c.id, boatBackupKey(BACKUP_SECRET, c.id), now.file).equals(tar)).toBe(true);
  expect(() => f.backups.read(c.id, legacy, now.file)).toThrow("integrity");
  expect(f.backups.list(c.id)).toEqual([now.file]);
  expect(f.audit.entries(c.id).map(e => e.action)).toContain("backup_rekeyed");
});

it("a plan upgrade resizes the sandbox: stopped, backed up first, resumed on the new size, started", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  expect(f.api.sandboxes.get(c.serverId!)!.type).toBe("small");
  f.service.changePlan(c.id, { kind: "shared_m", placement: "pool", spec: { vcpu: 4, ramGb: 8, diskGb: 80 }, botComputers: 5 });
  // waits for the owner's "restart now" (or the next idle sleep); here the owner asks
  f.advance(3 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile();
  expect(f.api.sandboxes.get(c.serverId!)!.type).toBe("small");
  f.service.managed!.resizeNow(c);
  for (let n = 0; n < 20 && !(c.status === "running" && !f.service.managed!.resizing(c)); n++) { c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(c).toMatchObject({ status: "running", spec: { vcpu: 4, ramGb: 8, diskGb: 80 } });
  expect(f.api.sandboxes.get(c.serverId!)!.type).toBe("default");
  const actions = f.audit.entries(c.id).map(e => e.action);
  expect(actions.indexOf("backup")).toBeGreaterThan(-1);
  expect(actions.indexOf("backup")).toBeLessThan(actions.indexOf("resize"));
  expect(f.service.managed!.resizing(c)).toBe(false);
});

it("a replaced sandbox that answers again is backed up from its own state and kept, never deleted", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  f.advance(DAY_MS); f.power.idle = true; f.power.busy = [];
  await f.settle(c, c => c.status === "sleeping");
  await f.settle(c, c => c.managed!.backups.length === 1);
  await f.service.power(c.accountId, c.id, "on"); await f.settle(c, c => c.status === "running");
  const original = c.serverId!;
  f.api.sandboxes.get(original)!.volume.set("__system__/data/.duskbot/newer.json", Buffer.from("after the backup"));
  // Boat stops answering for this one sandbox long enough, and leaves it off the list: it is taken for lost
  const sandbox = f.provider.sandbox, listed = f.provider.listed;
  f.provider.sandbox = async id => id === original ? null : sandbox(id);
  f.provider.listed = async id => id === original ? false : listed(id);
  for (let n = 0; n < 40 && !(c.status === "running" && c.serverId !== original); n++) { f.advance(11 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(c.serverId).not.toBe(original);
  // it answers again: stopped, its disk backed up as its own kept generation, the operator alerted; nothing deleted
  f.provider.sandbox = sandbox; f.provider.listed = listed;
  for (let n = 0; n < 6; n++) { f.advance(11 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile(); }
  const kept = c.managed!.backups.find(g => g.keep && g.source === original);
  expect(kept?.verifiedAt).not.toBeNull();
  const tar = f.backups.read(c.id, boatBackupKey(BACKUP_SECRET, c.id), kept!.file);
  expect(tar.includes("after the backup")).toBe(true);
  expect(f.audit.entries(c.id).map(e => e.action)).toContain("retired_has_newer_data");
  for (let day = 0; day < 20; day++) { f.advance(DAY_MS); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(f.api.deletes()).toHaveLength(0);
  expect(c.managed!.backups.some(g => g.file === kept!.file)).toBe(true);
});
