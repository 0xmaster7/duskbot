import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopPlan, StoredCloud } from "./types.ts";
import { createFakeCloudProvider } from "./fake-provider.ts";
import { createFakePoolDriver } from "./fake-pool-driver.ts";
import { createPoolProvider } from "./pool.ts";
import { createSealer } from "./seal.ts";
import { CloudError, createCloudsService } from "./service.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
const dedicatedPlan: DesktopPlan = { kind: "dedicated", placement: "dedicated", spec: { vcpu: 2, ramGb: 4, diskGb: 40 }, botComputers: null };
const poolPlan: DesktopPlan = { kind: "shared_s", placement: "pool", spec: { vcpu: 2, ramGb: 4, diskGb: 20 }, botComputers: 1 };
function fixture(options: { poolRam?: number; maxAttempts?: number } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-cloud-service-")); cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  let at = 1_790_000_000_000;
  const dedicated = createFakeCloudProvider(), driver = createFakePoolDriver({ hosts: [{ id: "pool1", region: "eu", domain: "pool.example.test", draining: false, capacity: { vcpu: 16, ramGb: options.poolRam ?? 32, diskGb: 200, slots: 10 } }] }), pool = createPoolProvider({ driver });
  const workspaces = { register: vi.fn(() => "workspace-1"), lastReportAt: vi.fn(() => at - 1000), remove: vi.fn() };
  const home = { healthy: vi.fn(async () => true), pair: vi.fn(async () => ({ code: "ABCD-EFGH-JKLM", expiresAt: at + 300_000 })) };
  const deps = { dataDir, providers: { dedicated, pool }, workspaces, home, sealer: createSealer(Buffer.alloc(32, 3)), config: { adminOrigin: "https://admin.example.test", dashboardUrl: "https://dash.example.test", image: "ghcr.io/example/openmausbot-cloud-home:1.2.3", maxAttempts: options.maxAttempts, poolQuota: (_kind: DesktopPlan["kind"], spec: DesktopPlan["spec"], botComputers: number | null) => ({ ...spec, netMbps: 100, pids: 1000, botComputers }) }, now: () => at };
  const service = createCloudsService(deps); cleanup.push(() => service.close());
  function order(plan = dedicatedPlan, accountId = "a") { return service.order({ ...plan, accountId, name: "My desktop", color: "blue", region: "eu" }); }
  async function ready(c: StoredCloud) { for (let n = 0; n < 20 && c.status === "provisioning"; n++) await service.reconcile(); expect(c.status).toBe("running"); }
  return { service, order, ready, dedicated, driver, pool, workspaces, home, deps, dataDir, advance: (ms: number) => { at += ms; }, now: () => at };
}
it.each([dedicatedPlan, poolPlan])("provisions $placement in order and links the owner without a claim", async plan => {
  const f = fixture(), c = f.order(plan);
  expect(c.id).toMatch(/^c[a-f0-9]{24}$/); expect(c.status).toBe("checkout"); expect(c.primary).toBe(true);
  const second = f.order(plan);
  expect(second.primary).toBe(false); expect(f.service.list("a")).toEqual([second, c]);
  f.service.activate(c.id, "sub1", plan);
  const steps = [c.setupStep];
  for (let n = 0; n < 15 && c.status === "provisioning"; n++) { await f.service.reconcile(); if (steps.at(-1) !== c.setupStep) steps.push(c.setupStep); }
  expect(steps).toEqual(["reserving", "storage", "starting", "checking", null]);
  expect(c.status).toBe("running"); expect(c.sealedLinkPrivateKey).toBeUndefined();
  expect(f.workspaces.register).toHaveBeenCalledExactlyOnceWith({ accountId: "a", name: c.name, publicKey: c.linkPublicKey });
  const view = f.service.view(c);
  expect(view.origin).toBe(plan.placement === "pool" ? `https://${c.id}.pool.example.test` : "https://203-0-113-2.sslip.io");
  expect(view).toMatchObject({ status: "running", workspaceId: "workspace-1", lastReportAt: f.now() - 1000 });
  for (const field of ["serverId", "ipv4", "bootstrapSecret", "sealedLinkPrivateKey"]) expect(view).not.toHaveProperty(field);
  expect(f.home.healthy).toHaveBeenCalledWith(c.origin, expect.stringMatching(/^[\w-]{43}$/));
  const persisted = readFileSync(join(f.dataDir, "clouds.json"), "utf8"); expect(persisted).not.toContain("sealedLinkPrivateKey");
  if (plan.placement === "pool") {
    const call = f.driver.calls.find(call => call.method === "createSlot")!;
    const boot = JSON.parse((call.input as { bootstrap: string }).bootstrap);
    expect(JSON.parse(boot.files[0].content)).toMatchObject({ workspaceId: c.workspaceId, publicKey: c.linkPublicKey, claimed: true, url: f.deps.config.dashboardUrl });
  } else {
    const call = f.dedicated.calls.find(call => call.method === "create")!;
    expect((call.input as { userData: string }).userData).toContain(`-p 127.0.0.1:8080:8080 '${f.deps.config.image}'`);
  }
});
it("activates twice idempotently and persists resumable bootstrap keys without plaintext secrets", async () => {
  const f = fixture(), c = f.order();
  f.service.activate(c.id, "sub1", dedicatedPlan); f.service.activate(c.id, "sub2", dedicatedPlan);
  const secret = f.deps.sealer.unseal(c.bootstrapSecret), key = f.deps.sealer.unseal(c.sealedLinkPrivateKey!);
  expect(readFileSync(join(f.dataDir, "clouds.json"), "utf8")).not.toContain(secret);
  expect(readFileSync(join(f.dataDir, "clouds.json"), "utf8")).not.toContain(key);
  await f.ready(c);
  f.service.activate(c.id, "sub3", dedicatedPlan); await f.service.reconcile();
  expect(c.subscriptionId).toBe("sub3"); expect(f.dedicated.calls.filter(c => c.method === "create")).toHaveLength(1); expect(f.workspaces.register).toHaveBeenCalledTimes(1);
  f.service.close(); const reopened = createCloudsService(f.deps); cleanup.push(() => reopened.close());
  expect(reopened.get(c.id)?.status).toBe("running"); expect(reopened.view(reopened.get(c.id)!).origin).toBe(c.origin);
});
it("respects exponential backoff after create and status failures", async () => {
  const f = fixture(), c = f.order(); f.dedicated.failNextCreate = true;
  f.service.activate(c.id, "sub", dedicatedPlan); await f.service.reconcile();
  expect(c.status).toBe("provisioning"); expect(c.attempts).toBe(1); expect(c.nextAttemptAt).toBe(f.now() + 30_000);
  await f.service.reconcile(); f.advance(29_999); await f.service.reconcile(); expect(f.dedicated.calls.filter(c => c.method === "create")).toHaveLength(1);
  f.advance(1); await f.service.reconcile(); expect(c.setupStep).toBe("storage");
  await f.service.reconcile(); f.dedicated.failNextStatus = true; await f.service.reconcile(); expect(c.attempts).toBe(1);
  f.advance(30_000); await f.ready(c); expect(c.attempts).toBe(0);
});
it("caps retries with a generic error and times out a full pool after thirty minutes", async () => {
  const f = fixture({ maxAttempts: 2 }), c = f.order(); f.dedicated.failNextCreate = true;
  f.service.activate(c.id, "sub", dedicatedPlan); await f.service.reconcile();
  f.advance(30_000); f.dedicated.failNextCreate = true; await f.service.reconcile();
  expect(c.status).toBe("error"); expect(c.error).toBe("Setup failed. We are on it.");
  const full = fixture({ poolRam: 1 }), p = full.order(poolPlan);
  full.service.activate(p.id, "sub", poolPlan); await full.service.reconcile();
  expect(p.status).toBe("provisioning"); expect(p.attempts).toBe(0);
  full.advance(30 * 60_000); await full.service.reconcile(); expect(p.status).toBe("error");
});
it.each([dedicatedPlan, poolPlan])("resizes $placement, preserving the requested power and pool quotas", async plan => {
  const f = fixture(), c = f.order(plan); f.service.activate(c.id, "sub", plan); await f.ready(c);
  const changed = { ...plan, kind: plan.placement === "pool" ? "shared_m" as const : "dedicated" as const, spec: { ...plan.spec, vcpu: 4, ramGb: 8 }, botComputers: 2 };
  f.service.changePlan(c.id, changed);
  for (let n = 0; n < 8; n++) await f.service.reconcile();
  expect(c.spec).toEqual(changed.spec);
  if (plan.placement === "dedicated") expect(f.dedicated.calls.filter(c => c.method === "resize" || c.method.startsWith("power:")).map(c => c.method)).toEqual(["power:off", "resize", "power:on"]);
  else { expect((await f.driver.slots("pool1"))[0].quota).toMatchObject({ ...changed.spec, botComputers: 2 }); expect(f.driver.calls.some(c => c.method.startsWith("power:"))).toBe(false); }
  expect(() => f.service.changePlan(c.id, plan.placement === "pool" ? dedicatedPlan : poolPlan)).toThrow(CloudError);
  await f.service.power("a", c.id, "off"); expect(c.status).toBe("stopped");
  await f.service.power("a", c.id, "on"); expect(c.status).toBe("running");
});
it("resizes a stopped dedicated desktop without powering it back on", async () => {
  const f = fixture(), c = f.order(); f.service.activate(c.id, "sub", dedicatedPlan); await f.ready(c); await f.service.power("a", c.id, "off");
  f.service.changePlan(c.id, { ...dedicatedPlan, spec: { ...dedicatedPlan.spec, ramGb: 8 } });
  for (let n = 0; n < 5; n++) await f.service.reconcile();
  expect(c.status).toBe("stopped"); expect(f.dedicated.calls.some(c => c.method === "power:on")).toBe(false);
});
it("honors the destruction grace, removes the workspace and clears secrets", async () => {
  const f = fixture(), c = f.order(); f.service.activate(c.id, "sub", dedicatedPlan); await f.ready(c);
  f.service.scheduleDestroy(c.id, f.now() + 1000); await f.service.reconcile(); expect(c.status).toBe("running");
  f.advance(1000); await f.service.reconcile(); expect(c.status).toBe("destroyed"); expect(c.bootstrapSecret).toBe(""); expect(c.origin).toBeNull(); expect(f.workspaces.remove).toHaveBeenCalledWith(c.workspaceId);
  expect(f.dedicated.calls.filter(c => c.method === "destroy")).toHaveLength(1);
  f.service.cancelDestroy(c.id); await f.service.reconcile(); expect(c.status).toBe("destroyed");
});
it("cancels destruction and ends by stopping now then destroying at the deadline", async () => {
  const f = fixture(), c = f.order(); f.service.activate(c.id, "sub", dedicatedPlan); await f.ready(c);
  f.service.scheduleDestroy(c.id, f.now() + 1000); f.service.cancelDestroy(c.id); f.advance(1000); await f.service.reconcile(); expect(c.status).toBe("running");
  f.service.end(c.id, f.now() + 5000); await f.service.reconcile(); expect(c.status).toBe("stopped");
  f.advance(4999); await f.service.reconcile(); expect(c.status).toBe("stopped");
  f.advance(1); await f.service.reconcile(); expect(c.status).toBe("destroyed");
});
it("enforces owner and state checks, pairs only running desktops and validates cosmetic changes", async () => {
  const f = fixture(), c = f.order();
  for (const id of [c.id, "missing"]) {
    await expect(f.service.power("other", id, "on")).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(f.service.pair("other", id)).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(() => f.service.rename("other", id, { name: "x" })).toThrow(CloudError);
    expect(() => f.service.hide("other", id)).toThrow(CloudError);
  }
  expect(f.service.owned("other", c.id)).toBeNull(); expect(f.service.get("missing")).toBeNull();
  await expect(f.service.pair("a", c.id)).rejects.toMatchObject({ status: 409 });
  f.service.activate(c.id, "sub", dedicatedPlan); await expect(f.service.power("a", c.id, "on")).rejects.toMatchObject({ status: 409 }); await f.ready(c);
  const grantWithCredential = { code: "ABCD-EFGH-JKLM", expiresAt: f.now() + 300_000, credential: "synthetic-private-credential" };
  f.home.pair.mockResolvedValueOnce(grantWithCredential);
  expect(await f.service.pair("a", c.id)).toEqual({ origin: c.origin, code: "ABCD-EFGH-JKLM", expiresAt: f.now() + 300_000 });
  expect(f.home.pair).toHaveBeenCalledWith(c.origin, expect.any(String), { label: "OpenMausBot app (Cloud)", ttlSeconds: 300 });
  expect(() => f.service.hide("a", c.id)).toThrow(expect.objectContaining({ status: 409, code: "not_removable" }));
  for (const name of ["", "a".repeat(41), "<tag>", "a\nb"]) expect(() => f.service.rename("a", c.id, { name })).toThrow();
  f.service.rename("a", c.id, { name: "New name", color: null }); expect(c.name).toBe("New name"); expect(c.color).toBeNull();
  f.service.setPaymentProblem(c.id, true); expect(f.service.view(c).status).toBe("payment_problem"); f.service.setPaymentProblem(c.id, false);
  await f.service.power("a", c.id, "off"); await expect(f.service.pair("a", c.id)).rejects.toMatchObject({ status: 409 });
  f.service.hide("a", c.id); expect(f.service.list("a")).toEqual([]);
});
it.each([dedicatedPlan, poolPlan])("keeps suspended $placement desktops off until an operator resumes", async plan => {
  const f = fixture(), c = f.order(plan); f.service.activate(c.id, "sub", plan); await f.ready(c);
  await f.service.suspend(c.id, "abuse"); expect(c.status).toBe("suspended");
  await expect(f.service.power("a", c.id, "on")).rejects.toMatchObject({ status: 409 });
  f.service.changePlan(c.id, { ...plan, spec: { ...plan.spec, ramGb: 8 } });
  f.advance(600_000); await f.service.reconcile(); expect((await f.deps.providers[plan.placement].status(c.serverId!)).state).toBe("off");
  expect(c.spec.ramGb).toBe(4);
  await f.service.resume(c.id); expect(c.status).toBe("running");
});
it("coalesces concurrent reconciles, checks missing servers at five minutes and abandons checkout", async () => {
  const f = fixture(), c = f.order(); f.service.activate(c.id, "sub", dedicatedPlan);
  const one = f.service.reconcile(), two = f.service.reconcile(); expect(one).toBe(two); await one; await f.ready(c);
  const count = f.dedicated.calls.filter(c => c.method === "status").length;
  f.advance(299_999); await f.service.reconcile(); expect(f.dedicated.calls.filter(c => c.method === "status")).toHaveLength(count);
  await f.dedicated.destroy(c.serverId!); f.advance(1); await f.service.reconcile(); expect(c.status).toBe("error");
  const checkout = f.order(); f.service.abandon(checkout.id); expect(checkout.status).toBe("destroyed");
});
it("retries a failed suspension and never revives a suspended desktop after destruction", async () => {
  const f = fixture(), c = f.order(poolPlan); f.service.activate(c.id, "sub", poolPlan); await f.ready(c);
  f.driver.failNext = "suspend";
  await expect(f.service.suspend(c.id, "abuse")).rejects.toMatchObject({ retryable: true });
  expect(c.suspensionApplied).toBe(false);
  await f.service.reconcile(); expect(c.suspensionApplied).toBe(true);
  expect((await f.pool.status(c.serverId!)).state).toBe("off");
  f.service.scheduleDestroy(c.id, f.now()); await f.service.reconcile(); await f.service.reconcile();
  expect(c.status).toBe("destroyed"); await f.service.resume(c.id); expect(c.status).toBe("destroyed");
});
it("recovers an ambiguous create by finding the existing server and wiping the bootstrap private key", async () => {
  const f = fixture(), c = f.order(), create = f.dedicated.create;
  let first = true;
  f.dedicated.create = async input => { const server = await create(input); if (first) { first = false; throw Object.assign(new Error("synthetic transient failure"), { retryable: true }); } return server; };
  f.service.activate(c.id, "sub", dedicatedPlan); await f.service.reconcile();
  expect(c.sealedLinkPrivateKey).toBeTruthy(); f.advance(30_000); await f.ready(c);
  expect(c.sealedLinkPrivateKey).toBeUndefined(); expect(f.dedicated.calls.filter(c => c.method === "create")).toHaveLength(1);
});
