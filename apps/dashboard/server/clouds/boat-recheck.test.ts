// Independent re-check (w13/boat-test) of the w13/boat-fix merge.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { spawnSync } from "node:child_process";
import { lockDataDir } from "../data-dir-lock.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { StoredSubscription } from "../billing/store.ts";
import { createBoatProvider } from "./boat.ts";
import { createAudit } from "./boat-audit.ts";
import { boatBackupKey, createBackupStore, tarEntries } from "./boat-backups.ts";
import { backupKey } from "./boat-home.ts";
import { DEFAULT_BOAT_SETTINGS } from "./boat-lifecycle.ts";
import { DAY_MS, entitlementOf } from "./boat-retention.ts";
import { createFakeCloudProvider } from "./fake-provider.ts";
import { startFakeBoatApi } from "./fake-boat-api.ts";
import { createSealer } from "./seal.ts";
import { createCloudsService } from "./service.ts";
import type { DesktopPlan, HomePower, StoredCloud } from "./types.ts";

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
const plan: DesktopPlan = { kind: "shared_s", placement: "pool", spec: { vcpu: 2, ramGb: 4, diskGb: 40 }, botComputers: 2 };
const SEAL = Buffer.alloc(32, 7), BACKUP_SECRET = Buffer.alloc(32, 9);

async function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-boat-review-")); cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  let at = Date.UTC(2026, 10, 9, 12);
  const now = () => at;
  const api = await startFakeBoatApi({ now }); cleanup.push(() => api.close());
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
      // a faithful restore: the volume becomes exactly the tar's files
      const tar = sandbox.files.get("/home/user/omb-restore.tar");
      if (!tar) return { exitCode: 2, stdout: "not a home backup\n" };
      sandbox.volume = new Map(tarEntries(tar).filter(e => e.type === "0").map(e => [e.name, Buffer.from(e.data)]));
      return { exitCode: 0, stdout: "restored\n" };
    }
    return { exitCode: 0, stdout: "" };
  });
  const power: HomePower = { idle: false, busy: ["recent-activity"], lastActivityAt: at, nextDueAt: null, wokeAt: at };
  const subscriptions: StoredSubscription[] = [];
  const notices: Array<{ cloudId: string; kind: string; at: number | null; link?: string }> = [];
  /** one dashboard process over the shared data dir */
  function instance(secret: Buffer = BACKUP_SECRET, previous: Buffer | null = null) {
    const provider = createBoatProvider({ apiKey: api.key, baseUrl: api.baseUrl, scope: "0123456789abcdef" });
    const home = { healthy: vi.fn(async () => true), pair: vi.fn(async () => ({ code: "ABCD-EFGH-JKLM", expiresAt: at + 300_000 })),
      power: vi.fn(async () => ({ ...power })), sleep: vi.fn(async () => ({ ok: power.idle, nextDueAt: power.nextDueAt })), plan: vi.fn(async () => {}) };
    const audit = createAudit({ dataDir, now });
    const backups = createBackupStore({ dir: join(dataDir, "boat-backups"), now });
    const workspaces = { register: vi.fn(() => "workspace-1"), lastReportAt: vi.fn(() => null), remove: vi.fn() };
    const service = createCloudsService({ dataDir, now, home, sealer: createSealer(SEAL), workspaces,
      providers: { dedicated: createFakeCloudProvider(), pool: { ...createFakeCloudProvider(), suspend: async () => {}, resume: async () => {} } },
      config: { adminOrigin: "https://admin.example.test", dashboardUrl: "https://dash.example.test", image: "ghcr.io/example/home:1", poolQuota: (_k, spec, botComputers) => ({ ...spec, netMbps: 1, pids: 1, botComputers }) },
      boat: { provider, backups, audit, kinds: ["shared_s", "shared_m", "dedicated"], backupSecret: secret, previousBackupSecret: previous,
        settings: { ...DEFAULT_BOAT_SETTINGS, package: { sha256: "a".repeat(64), url: "https://packages.example.test/home.tgz" } },
        entitlement: cloud => entitlementOf(subscriptions, cloud, at),
        notify: (cloud, kind, when, link) => notices.push({ cloudId: cloud.id, kind, at: when, ...(link ? { link } : {}) }) } });
    cleanup.push(() => service.close());
    return { service, provider, audit, backups };
  }
  async function settle(s: ReturnType<typeof createCloudsService>, c: StoredCloud, until: (c: StoredCloud) => boolean, max = 30) {
    for (let n = 0; n < max && !until(c); n++) { c.nextAttemptAt = 0; await s.reconcile(); }
    expect(until(c)).toBe(true);
  }
  async function paid(s: ReturnType<typeof createCloudsService>) {
    const c = s.order({ ...plan, accountId: "acct_1", name: "My Cloud", color: null, region: "eu" });
    const sub = { id: `sub_${c.id}`, accountId: c.accountId, cloudId: c.id, status: "active", currentPeriodEnd: at + 30 * DAY_MS, currentPeriodStart: at, updatedAt: at, lastEventAt: at } as unknown as StoredSubscription;
    subscriptions.push(sub);
    s.activate(c.id, sub.id, plan);
    await settle(s, c, c => c.status === "running");
    return { c, sub };
  }
  /** a machine is declared lost only after repeated 404s over half an hour: the clock moves while it is checked */
  async function waitLost(s: ReturnType<typeof createCloudsService>, c: StoredCloud, until: (c: StoredCloud) => boolean) {
    for (let n = 0; n < 60 && !until(c); n++) { at += 11 * 60_000; c.nextAttemptAt = 0; await s.reconcile(); }
    expect(until(c)).toBe(true);
  }
  return { api, power, subscriptions, notices, dataDir, instance, settle, waitLost, paid, now, advance(ms: number) { at += ms; } };
}

type F = Awaited<ReturnType<typeof fixture>>;
async function sleepCycle(f: F, s: ReturnType<typeof createCloudsService>, c: StoredCloud) {
  f.power.idle = true; f.power.busy = [];
  await f.settle(s, c, c => c.status === "sleeping");
  for (let n = 0; n < 3; n++) { c.nextAttemptAt = 0; await s.reconcile(); }
}
async function wake(f: F, s: ReturnType<typeof createCloudsService>, c: StoredCloud) {
  await s.power(c.accountId, c.id, "on"); await f.settle(s, c, c => c.status === "running");
  f.advance(3 * 60_000);
}


type S = ReturnType<typeof createCloudsService>;
/** a cloud with one backup and, on its disk only, data newer than that backup */
async function withUnbackedData(f: F, s: S) {
  const { c, sub } = await f.paid(s);
  f.advance(DAY_MS); await sleepCycle(f, s, c);
  await wake(f, s, c);
  f.api.sandboxes.get(c.serverId!)!.volume.set("__system__/data/.openmausbot/precious.json", Buffer.from("newer"));
  await sleepCycle(f, s, c);
  expect(c.boat!.backups).toHaveLength(1);
  return { c, sub, original: c.serverId! };
}
/** Boat answers 404 for `id` (and, when `unlisted`, leaves it out of the account list) until restored */
function blackout(provider: ReturnType<F["instance"]>["provider"], id: string, unlisted: boolean) {
  const sandbox = provider.sandbox, listed = provider.listed;
  provider.sandbox = async x => x === id ? null : sandbox(x);
  if (unlisted) provider.listed = async x => x === id ? false : listed(x);
  return () => { provider.sandbox = sandbox; provider.listed = listed; };
}
const holds = (f: F) => [...f.api.sandboxes.values()].some(x => x.volume.has("__system__/data/.openmausbot/precious.json") || x.snapshots.some(sn => sn.volume.has("__system__/data/.openmausbot/precious.json")));

for (const count of [1, 2, 3]) {
  it(`${count} 404s inside 30 minutes, then an answer: no rebuild`, async () => {
    const f = await fixture(); const { service: s, provider } = f.instance();
    const { c, original } = await withUnbackedData(f, s);
    const restore = blackout(provider, original, true);
    for (let n = 0; n < count; n++) { c.nextAttemptAt = 0; await s.reconcile(); f.advance(9 * 60_000); }
    restore(); c.nextAttemptAt = 0; await s.reconcile();
    expect(c.serverId).toBe(original); expect(c.boat!.attempt).toBe(0); expect(c.boat!.missingSince ?? null).toBeNull();
  });
}

it("404s for over 30 minutes while Boat's list still shows the sandbox: no rebuild", async () => {
  const f = await fixture(); const { service: s, provider } = f.instance();
  const { c, original } = await withUnbackedData(f, s);
  const restore = blackout(provider, original, false);
  for (let n = 0; n < 12; n++) { f.advance(11 * 60_000); c.nextAttemptAt = 0; await s.reconcile(); }
  restore();
  expect(c.boat!.attempt).toBe(0); expect(c.serverId).toBe(original);
});

it("3 404s spread just under 30 minutes and unlisted: still no rebuild", async () => {
  const f = await fixture(); const { service: s, provider } = f.instance();
  const { c, original } = await withUnbackedData(f, s);
  blackout(provider, original, true);
  for (const gap of [0, 14 * 60_000, 15 * 60_000]) { f.advance(gap); c.nextAttemptAt = 0; await s.reconcile(); }
  expect(c.boat!.attempt).toBe(0);
});

it("confirmed lost (404 and unlisted past 30 minutes) but the disk comes back: rebuilt, original kept, backed up from its own state, never deleted while paid", async () => {
  const f = await fixture(); const { service: s, provider, audit } = f.instance();
  const { c, original } = await withUnbackedData(f, s);
  const restore = blackout(provider, original, true);
  for (let n = 0; n < 8 && c.boat!.attempt === 0; n++) { f.advance(11 * 60_000); c.nextAttemptAt = 0; await s.reconcile(); }
  expect(c.boat!.attempt).toBe(1);
  await f.settle(s, c, c => c.status === "running" && c.serverId !== original);
  restore();
  // the reconciler keeps running while the home sleeps: time passes between passes
  for (let day = 0; day < 60; day++) { f.advance(DAY_MS); if (c.status === "sleeping") await wake(f, s, c); await sleepCycle(f, s, c); for (let n = 0; n < 3; n++) { f.advance(11 * 60_000); c.nextAttemptAt = 0; await s.reconcile(); } }
  expect(f.api.deletes().map(d => d.path)).not.toContain(`/sandboxes/${original}`);
  expect(holds(f)).toBe(true);
  const kept = c.boat!.backups.filter(g => g.keep && g.source === original);
  expect(kept.length).toBeGreaterThan(0);
  expect(audit.entries(c.id).map(e => e.action)).toContain("retired_has_newer_data");
  // the original disk was kept alive past Boat's 14-day purge
  expect(f.api.sandboxes.get(original)!.dataExpiredAt).toBeNull();
});

it("an ended plan's cloud that is confirmed lost keeps its notices and is not deleted before 45 days", async () => {
  const f = await fixture(); const { service: s, provider } = f.instance();
  const { c, sub, original } = await withUnbackedData(f, s);
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(s, c, c => c.status === "stopped");
  for (let n = 0; n < 3; n++) { c.nextAttemptAt = 0; await s.reconcile(); }
  const endedAt = f.now();
  blackout(provider, original, true);
  for (let n = 0; n < 8; n++) { f.advance(11 * 60_000); c.nextAttemptAt = 0; await s.reconcile(); }
  while (f.now() < endedAt + 45 * DAY_MS - DAY_MS) { f.advance(DAY_MS); c.nextAttemptAt = 0; await s.reconcile(); }
  expect(f.api.deletes()).toHaveLength(0);
  expect(f.notices.filter(n => n.cloudId === c.id).map(n => n.kind)).toEqual(expect.arrayContaining(["ended", "left_30", "left_7", "left_1"]));
});

it("the data-dir lock: another process is refused, a dead process's lock is taken over", () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-lock-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const unlock = lockDataDir(dir);
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "-e", `import("${join(process.cwd(), "apps/dashboard/server/data-dir-lock.ts")}").then(m => { try { m.lockDataDir(${JSON.stringify(dir)}); console.log("TOOK"); } catch (e) { console.log("REFUSED " + e.name); } })`], { encoding: "utf8" });
  expect(child.stdout).toContain("REFUSED DataDirLockedError");
  unlock();
  // a crashed process on this host (pid no longer alive)
  writeFileSync(join(dir, ".writer.lock"), JSON.stringify({ pid: 2 ** 22 - 3, host: hostname(), at: Date.now() - 1000 }));
  const again = lockDataDir(dir); again();
  // another host's lock is never taken over
  writeFileSync(join(dir, ".writer.lock"), JSON.stringify({ pid: 1, host: "other-host", at: Date.now() }));
  expect(() => lockDataDir(dir)).toThrow("already using");
  rmSync(join(dir, ".writer.lock"));
});

it("a stale lock left by an earlier run that had this same pid (a restarted container's pid 1) is taken over", () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-lock-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, ".writer.lock"), JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() - 3_600_000 }));
  let took = false;
  try { lockDataDir(dir)(); took = true; } catch {}
  expect(took, "the service cannot start after a crash when it gets the same pid again").toBe(true);
});

it("a cancel written to the record by another writer stops a due owner deletion", async () => {
  const f = await fixture(); const A = f.instance();
  const { c, sub } = await f.paid(A.service);
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(A.service, c, c => c.status === "stopped");
  A.service.boat!.requestDelete(c, t => `#${t}`);
  A.service.boat!.confirmDelete(c, f.notices.findLast(n => n.kind === "delete_requested")!.link!.slice(1));
  const file = join(f.dataDir, "clouds.json"), stored = JSON.parse(readFileSync(file, "utf8"));
  stored.clouds.find((x: { id: string }) => x.id === c.id).boat.deleteRequest.cancelledAt = f.now();
  writeFileSync(file, JSON.stringify(stored));
  f.advance(8 * DAY_MS);
  for (let n = 0; n < 4; n++) { c.nextAttemptAt = 0; await A.service.reconcile(); }
  expect(f.api.deletes()).toHaveLength(0);
});

it("an old version 1 backup (key the home could derive) is sealed again with the server key and still restores", async () => {
  const f = await fixture(); const { service: s, backups } = f.instance();
  const { c } = await f.paid(s);
  f.advance(DAY_MS); await sleepCycle(f, s, c);
  const g = c.boat!.backups[0]!, v2 = boatBackupKey(BACKUP_SECRET, c.id);
  const tar = backups.read(c.id, v2, g.file);
  // rewrite it as a version 1 file, as the first merge wrote them
  const legacy = backupKey(createSealer(SEAL).unseal(c.bootstrapSecret)), iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", legacy, iv);
  cipher.setAAD(Buffer.from(c.id));
  const body = Buffer.concat([cipher.update(tar), cipher.final()]);
  const v1name = `${String(f.now() - 1000).padStart(13, "0")}-0000beef.ombb`;
  writeFileSync(join(f.dataDir, "boat-backups", c.id, v1name), Buffer.concat([Buffer.from("OMBB1\n"), iv, body, cipher.getAuthTag()]), { mode: 0o400 });
  backups.remove(c.id, g.file); g.file = v1name;
  expect(backups.version(c.id, v1name)).toBe(1);
  await s.power(c.accountId, c.id, "on"); await f.settle(s, c, c => c.status === "running");
  for (let n = 0; n < 2; n++) { c.nextAttemptAt = 0; await s.reconcile(); }
  const now = c.boat!.backups[0]!;
  expect(now.file).not.toBe(v1name);
  expect(backups.version(c.id, now.file)).toBe(2);
  expect(readdirSync(join(f.dataDir, "boat-backups", c.id))).not.toContain(v1name);
  expect(() => backups.read(c.id, legacy, now.file)).toThrow();
  expect(backups.read(c.id, v2, now.file).equals(tar)).toBe(true);
});

it("a changed backup secret refuses to start unless the previous one is given, and then every backup opens with the new one", async () => {
  const f = await fixture(); const A = f.instance();
  const { c, sub } = await f.paid(A.service);
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(A.service, c, c => c.status === "stopped");
  await f.settle(A.service, c, c => (c.boat!.backups.at(-1)?.verifiedAt ?? null) !== null);
  A.service.close();
  // the operator sets OMB_BOAT_BACKUP_KEY (or rotates the seal key) after backups were written
  expect(() => f.instance(Buffer.alloc(32, 1))).toThrow("backup secret changed");
  // given the old one, every backup is sealed again first
  const B = f.instance(Buffer.alloc(32, 1), BACKUP_SECRET); const cB = B.service.get(c.id)!;
  const file = cB.boat!.backups.at(-1)!.file;
  expect(B.backups.read(c.id, boatBackupKey(Buffer.alloc(32, 1), c.id), file).length).toBeGreaterThan(0);
  expect(() => B.backups.read(c.id, boatBackupKey(BACKUP_SECRET, c.id), file)).toThrow("integrity");
  f.advance(46 * DAY_MS);
  for (let n = 0; n < 6; n++) { cB.nextAttemptAt = 0; await B.service.reconcile(); }
  expect(cB.status).toBe("destroyed");
});

it("retention never deletes a sandbox whose final backup no longer opens, and says so", async () => {
  const f = await fixture(); const A = f.instance();
  const { c, sub } = await f.paid(A.service);
  sub.status = "ended"; sub.currentPeriodEnd = f.now(); sub.lastEventAt = f.now();
  await f.settle(A.service, c, c => c.status === "stopped");
  await f.settle(A.service, c, c => (c.boat!.backups.at(-1)?.verifiedAt ?? null) !== null);
  const path = join(f.dataDir, "boat-backups", c.id, c.boat!.backups.at(-1)!.file);
  chmodSync(path, 0o600); const bytes = readFileSync(path); bytes[bytes.length - 20]! ^= 0xff; writeFileSync(path, bytes);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  f.advance(46 * DAY_MS);
  for (let n = 0; n < 6; n++) { c.nextAttemptAt = 0; await A.service.reconcile(); }
  expect(f.api.deletes()).toHaveLength(0);
  expect(A.audit.entries(c.id).map(e => `${e.action}:${e.reason}`)).toContain("delete_refused:backup_unreadable");
  expect(warn.mock.calls.flat().join(" ")).toContain("ALERT");
});

it("a plan upgrade resizes the sandbox at its next sleep, backed up first, and it comes back on the new size", async () => {
  const f = await fixture(); const { service: s } = f.instance();
  const { c } = await f.paid(s);
  s.changePlan(c.id, { kind: "shared_m", placement: "pool", spec: { vcpu: 4, ramGb: 8, diskGb: 40 }, botComputers: 2 });
  f.advance(DAY_MS); f.power.idle = true; f.power.busy = [];
  await f.settle(s, c, c => c.status === "running" && c.spec.vcpu === 4, 40);
  expect(f.api.sandboxes.get(c.serverId!)!.type).toBe("default");
  expect(c.boat!.backups.some(g => g.verifiedAt !== null)).toBe(true);
});

it("every resume (wake, disk refresh, resize) asks Boat for no-env again", async () => {
  const f = await fixture(); const { service: s } = f.instance();
  const { c } = await f.paid(s);
  f.power.idle = true; f.power.busy = []; f.advance(3 * 60_000);
  await f.settle(s, c, c => c.status === "sleeping");
  await s.power(c.accountId, c.id, "on"); await f.settle(s, c, c => c.status === "running");
  s.changePlan(c.id, { kind: "shared_m", placement: "pool", spec: { vcpu: 4, ramGb: 8, diskGb: 40 }, botComputers: 2 });
  f.advance(DAY_MS);
  await f.settle(s, c, c => c.status === "running" && c.spec.vcpu === 4, 40);
  f.power.idle = true; f.power.busy = []; f.advance(3 * 60_000);
  await f.settle(s, c, c => c.status === "sleeping");
  for (let n = 0; n < 3; n++) { c.nextAttemptAt = 0; await s.reconcile(); }
  f.advance(12 * DAY_MS); await f.settle(s, c, c => c.status === "running", 20);
  const resumes = f.api.requests.filter(r => r.method === "POST" && r.path.endsWith("/resume"));
  expect(resumes.length).toBeGreaterThanOrEqual(3);
  for (const r of resumes) expect(r.body).toMatchObject({ noEnv: true });
});
