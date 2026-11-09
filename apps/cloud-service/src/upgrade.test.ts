import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createFakeCloudProvider } from "../../dashboard/server/clouds/fake-provider.ts";
import { createSealer } from "../../dashboard/server/clouds/seal.ts";
import { createCloudsService } from "../../dashboard/server/clouds/service.ts";
import type { ManagedCloudFactory } from "../../dashboard/server/clouds/managed.ts";
import { upgradeManagedRecord } from "./index.ts";
import { freshBoatState } from "./lifecycle.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const ID = `c${"a".repeat(24)}`;

function legacyStore() {
  const dir = mkdtempSync(join(tmpdir(), "omb-managed-upgrade-")); dirs.push(dir);
  const at = Date.UTC(2026, 10, 9);
  const cloud = { id: ID, accountId: "acct_1", name: "Old", color: null, kind: "shared_s", placement: "pool", subscriptionId: "sub_1", spec: { vcpu: 2, ramGb: 4, diskGb: 40 },
    desiredSpec: { vcpu: 2, ramGb: 4, diskGb: 40 }, region: "eu", botComputers: 2, status: "sleeping", setupStep: null, wantPower: "off", serverId: "bx_23456789", ipv4: null,
    origin: "https://home.example.test", bootstrapSecret: "plain.secret", workspaceId: "ws_1", primary: true, hidden: false, paymentProblem: false, suspended: null,
    destroyAt: at - 1, error: null, attempts: 0, nextAttemptAt: 0, createdAt: at, updatedAt: at, powerSince: at, backend: "boat", boat: { ...freshBoatState(), attempt: 3 } };
  writeFileSync(join(dir, "clouds.json"), JSON.stringify({ v: 1, clouds: [cloud] }));
  return dir;
}
const service = (dir: string, managed: ManagedCloudFactory | null) => createCloudsService({ dataDir: dir, now: () => Date.UTC(2026, 10, 10), sealer: createSealer(Buffer.alloc(32, 1)),
  home: { healthy: async () => true, pair: async () => ({ code: "x", expiresAt: 0 }) }, workspaces: { register: () => "ws", lastReportAt: () => null, remove: vi.fn() },
  providers: { dedicated: createFakeCloudProvider(), pool: { ...createFakeCloudProvider(), destroy: vi.fn(async () => {}), suspend: async () => {}, resume: async () => {} } },
  config: { adminOrigin: "https://admin.example.test", dashboardUrl: "https://dash.example.test", image: "x", poolQuota: (_k, spec, botComputers) => ({ ...spec, netMbps: 1, pids: 1, botComputers }) },
  managed });

it("moves an older record to the current names, once, and keeps its lifecycle record", () => {
  const record = { backend: "boat", boat: { attempt: 2, backups: [] } } as never;
  expect(upgradeManagedRecord(record)).toBe(true);
  expect(record).toEqual({ backend: "managed", managed: { attempt: 2, backups: [] } });
  expect(upgradeManagedRecord(record)).toBe(false);
});

it("the clouds service upgrades stored records on start and writes them back", async () => {
  const dir = legacyStore();
  const reconcile = vi.fn(async () => {});
  const factory: ManagedCloudFactory = { kinds: ["shared_s"], upgrade: upgradeManagedRecord, create: () => ({ kinds: ["shared_s"], fresh: freshBoatState, reconcile, retryAt: () => null, view: () => ({}),
    afterPass: async () => {}, requestDelete() {}, confirmDelete: () => 0, cancelDelete() {}, resizeNow() {}, resizing: () => false, setHold() {}, close() {} }) };
  const s = service(dir, factory);
  const c = s.get(ID)!;
  expect(c.backend).toBe("managed");
  expect(c.managed?.attempt).toBe(3);
  expect(JSON.parse(readFileSync(join(dir, "clouds.json"), "utf8")).clouds[0]).not.toHaveProperty("boat");
  await s.reconcile();
  expect(reconcile).toHaveBeenCalledWith(c);
  s.close();
});

it("never runs the generic lifecycle on an older managed record, even with no backend configured", async () => {
  const dir = legacyStore();
  const s = service(dir, null);
  await s.reconcile();
  const c = s.get(ID)!;
  expect(c.status).toBe("sleeping");
  expect(c.serverId).toBe("bx_23456789");
  expect(c.error).toBe("Managed clouds are not configured.");
  s.close();
});
