import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { StoredSubscription } from "../billing/store.ts";
import { createBoatProvider } from "./boat.ts";
import { createAudit } from "./boat-audit.ts";
import { createBackupStore } from "./boat-backups.ts";
import { DEFAULT_BOAT_SETTINGS } from "./boat-lifecycle.ts";
import { DAY_MS, entitlementOf } from "./boat-retention.ts";
import { createFakeCloudProvider } from "./fake-provider.ts";
import { startFakeBoatApi } from "./fake-boat-api.ts";
import { createSealer } from "./seal.ts";
import { createCloudsService } from "./service.ts";
import type { DesktopPlan, HomePower, StoredCloud } from "./types.ts";

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const plan: DesktopPlan = { kind: "shared_s", placement: "pool", spec: { vcpu: 2, ramGb: 4, diskGb: 40 }, botComputers: 2 };
const SHA = "a".repeat(64);

export async function boatFixture(options: { retentionDays?: number; setupPolls?: number } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-boat-")); cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  let at = Date.UTC(2026, 10, 9, 12);
  const now = () => at;
  const api = await startFakeBoatApi({ now, setupPolls: options.setupPolls }); cleanup.push(() => api.close());
  // the machine: the launcher marks its volume on first start, a bot writes data
  api.onCommand(({ sandbox, command }) => {
    if (command.includes("omb-home install")) return { exitCode: 0, stdout: "installed\n" };
    if (command.includes("omb-home start")) {
      if (!sandbox.volume.size) {
        sandbox.volume.set("__system__/data/.omb-cloud-home.json", Buffer.from(JSON.stringify({ version: 1, machine: sandbox.labels["omb.cloud"] })));
        sandbox.volume.set("__system__/data/.openmausbot/bots.json", Buffer.from(JSON.stringify([{ id: "bot-1", name: "Test bot" }])));
      }
      return { exitCode: 0, stdout: "started\n" };
    }
    if (command.includes("omb-home restore")) {
      const tar = sandbox.files.get("/home/user/omb-restore.tar")!;
      sandbox.volume = new Map([["__system__/data/.omb-cloud-home.json", Buffer.from("restored-marker")]]);
      sandbox.volume.set("__system__/data/restored.tar.bytes", Buffer.from(String(tar.length)));
      return { exitCode: 0, stdout: "restored\n" };
    }
    return { exitCode: 0, stdout: "" };
  });
  const provider = createBoatProvider({ apiKey: api.key, baseUrl: api.baseUrl, scope: "0123456789abcdef" });
  const power: HomePower = { idle: false, busy: ["recent-activity"], lastActivityAt: at, nextDueAt: null, wokeAt: at };
  const home = { healthy: vi.fn(async () => true), pair: vi.fn(async () => ({ code: "ABCD-EFGH-JKLM", expiresAt: at + 300_000 })),
    power: vi.fn(async () => ({ ...power })), sleep: vi.fn(async () => ({ ok: power.idle, nextDueAt: power.nextDueAt })), plan: vi.fn(async () => {}) };
  const subscriptions: StoredSubscription[] = [];
  const notices: Array<{ cloudId: string; kind: string; at: number | null; link?: string }> = [];
  const alerts: string[] = [];
  const audit = createAudit({ dataDir, now, alert: entry => alerts.push(`${entry.action}:${entry.reason}`) });
  const backups = createBackupStore({ dir: join(dataDir, "boat-backups"), now });
  const workspaces = { register: vi.fn(() => "workspace-1"), lastReportAt: vi.fn(() => null), remove: vi.fn() };
  const service = createCloudsService({ dataDir, now, home, sealer: createSealer(Buffer.alloc(32, 7)), workspaces,
    providers: { dedicated: createFakeCloudProvider(), pool: { ...createFakeCloudProvider(), suspend: async () => {}, resume: async () => {} } },
    config: { adminOrigin: "https://admin.example.test", dashboardUrl: "https://dash.example.test", image: "ghcr.io/example/home:1", poolQuota: (_k, spec, botComputers) => ({ ...spec, netMbps: 1, pids: 1, botComputers }) },
    boat: { provider, backups, audit, kinds: ["shared_s", "shared_m", "dedicated"],
      settings: { ...DEFAULT_BOAT_SETTINGS, package: { sha256: SHA, url: "https://packages.example.test/home.tgz" }, ...(options.retentionDays ? { retentionDays: options.retentionDays } : {}) },
      entitlement: cloud => entitlementOf(subscriptions, cloud, at),
      notify: (cloud, kind, when, link) => notices.push({ cloudId: cloud.id, kind, at: when, ...(link ? { link } : {}) }) } });
  cleanup.push(() => service.close());
  function subscribe(c: StoredCloud) {
    const sub = { id: `sub_${c.id}`, accountId: c.accountId, cloudId: c.id, status: "active", currentPeriodEnd: at + 30 * DAY_MS, currentPeriodStart: at, updatedAt: at, lastEventAt: at } as unknown as StoredSubscription;
    subscriptions.push(sub); return sub;
  }
  async function paid(accountId = "acct_1") {
    const c = service.order({ ...plan, accountId, name: "My Cloud", color: null, region: "eu" });
    const sub = subscribe(c);
    service.activate(c.id, sub.id, plan);
    for (let n = 0; n < 20 && c.status === "provisioning"; n++) { await service.reconcile(); c.nextAttemptAt = 0; }
    return { c, sub };
  }
  async function settle(c: StoredCloud, until: (c: StoredCloud) => boolean, max = 20) {
    for (let n = 0; n < max && !until(c); n++) { c.nextAttemptAt = 0; await service.reconcile(); }
    expect(until(c)).toBe(true);
  }
  return { api, provider, service, home, power, subscriptions, notices, alerts, audit, backups, dataDir, paid, settle, workspaces,
    advance(ms: number) { at += ms; }, now };
}

it("provisions a paid cloud on Boat: labelled sandbox, secrets only in its boot file, package installed, home started", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  expect(c).toMatchObject({ backend: "boat", status: "running", setupStep: null });
  expect(c.origin).toMatch(/^https:\/\/.+\.on\.boat\.dev$/);
  const create = f.api.requests.find(r => r.method === "POST" && r.path === "/sandboxes")!.body as Record<string, any>;
  const secret = createSealer(Buffer.alloc(32, 7)).unseal(c.bootstrapSecret);
  expect(create.setupScript).not.toContain(secret);
  expect(create.files[0].path).toBe("/home/user/.omb-boot.json");
  expect(create.files[0].content).toContain(secret);
  const commands = f.api.requests.filter(r => r.path.endsWith("/commands")).map(r => (r.body as { command: string }).command);
  expect(commands[0]).toContain(`omb-home install /home/user/omb-home.tgz ${SHA}`);
  expect(commands[1]).toBe(`sudo -n /usr/lib/openmausbot/bin/omb-home start '${c.origin}'`);
  expect(JSON.stringify(f.audit.entries(c.id))).not.toContain(secret);
  expect(f.service.view(c)).toMatchObject({ provider: "boat", status: "running" });
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
    await f.settle(c, c => c.boat!.backups.at(-1)?.at === f.now());
    await f.service.power(c.accountId, c.id, "on"); await f.settle(c, c => c.status === "running");
  }
  expect(c.boat!.backups).toHaveLength(3);
  expect(c.boat!.backups.every(g => g.verifiedAt !== null)).toBe(true);
  const files = readdirSync(join(f.dataDir, "boat-backups", c.id));
  expect(files).toHaveLength(3);
  for (const file of files) expect(readFileSync(join(f.dataDir, "boat-backups", c.id, file)).includes("Test bot")).toBe(false);
});

it("recovers a lost machine from its newest backup into a fresh sandbox and tells the owner", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  f.advance(DAY_MS); f.power.idle = true; f.power.busy = [];
  await f.settle(c, c => c.status === "sleeping");
  await f.settle(c, c => c.boat!.backups.length === 1);
  const lost = c.serverId!;
  f.api.lose(lost);
  await f.settle(c, c => c.status === "running" && c.serverId !== lost, 30);
  expect(c.boat!.attempt).toBe(1);
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
  await f.settle(c, c => (c.boat!.backups.at(-1)?.verifiedAt ?? null) !== null);
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

it("stops sandboxes no live cloud runs on, and deletes an unknown one only after the whole retention", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  const stray = await f.provider.create({ cloudId: `c${"e".repeat(24)}`, spec: plan.spec, region: "eu", userData: "", ttlSeconds: 3600 });
  const duplicate = await f.provider.create({ cloudId: c.id, spec: plan.spec, region: "eu", userData: "", ttlSeconds: 3600, attempt: 9 });
  for (const id of [stray.id, duplicate.id]) await f.provider.sandbox(id);
  f.advance(31 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile();
  expect(f.api.sandboxes.get(stray.id)!.state).toMatch(/archiv/);
  expect(f.api.sandboxes.get(duplicate.id)!.state).toMatch(/archiv/);
  expect(c.boat!.retired.map(r => r.serverId)).toContain(duplicate.id);
  expect(f.api.deletes()).toHaveLength(0);
  for (let day = 0; day < 44; day++) { f.advance(DAY_MS); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(f.api.deletes().map(d => d.path)).not.toContain(`/sandboxes/${stray.id}`);
  f.advance(2 * DAY_MS); c.nextAttemptAt = 0; await f.service.reconcile();
  expect(f.api.deletes().map(d => d.path)).toContain(`/sandboxes/${stray.id}`);
  expect(f.alerts).toContain("delete_requested:orphan_past_retention");
  expect(f.api.sandboxes.has(c.serverId!)).toBe(true);
});
