// Independent review (w13/boat-test): billing and account paths through the whole dashboard app.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CSRF_HEADER } from "../../../../shared/account-api.ts";
import { createBilling } from "../billing/index.ts";
import { createDashboardApp } from "../app.ts";
import { memoryMailer } from "../auth/mail.ts";
import type { BillingState } from "../billing/store.ts";
import { startFakeBoatApi } from "./fake-boat-api.ts";
import { DAY_MS } from "./boat-retention.ts";

vi.mock("../billing/index.ts", async importOriginal => {
  const actual = await importOriginal<typeof import("../billing/index.ts")>();
  return { ...actual, createBilling: vi.fn(actual.createBilling) };
});
const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "omb-boat-security-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  let time = Date.UTC(2026, 10, 9, 12);
  const now = () => time, mailer = memoryMailer();
  const api = await startFakeBoatApi({ now }); cleanup.push(() => api.close());
  api.onCommand(({ sandbox, command }) => {
    if (command.includes("omb-home start") && !sandbox.volume.size) {
      sandbox.volume.set("__system__/data/.omb-cloud-home.json", Buffer.from(JSON.stringify({ version: 1, machine: sandbox.labels["omb.cloud"] })));
      sandbox.volume.set("__system__/data/.openmausbot/config.json", Buffer.from("{}"));
    }
    return { exitCode: 0, stdout: command.includes("install") ? "installed\n" : command.includes("start") ? "started\n" : "" };
  });
  for (const key of ["OMB_BILLING_PROVIDER", "OMB_CLOUD_PROVIDER", "OMB_POOL_DRIVER", "OMB_CLOUD_SEAL_KEY", "OMB_DODO_PRODUCTS", "OMB_BOAT_TEMPLATE"]) vi.stubEnv(key, undefined);
  vi.stubEnv("OMB_BOAT", "1"); vi.stubEnv("BOAT_API_KEY", api.key); vi.stubEnv("BOAT_BASE_URL", api.baseUrl);
  vi.stubEnv("OMB_BOAT_HOME_PACKAGE_URL", "https://packages.example.test/home.tgz"); vi.stubEnv("OMB_BOAT_HOME_PACKAGE_SHA256", "b".repeat(64));
  // the homes answer their signed reads; nothing else leaves the machine
  let idle = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname.endsWith(".on.boat.dev")) {
      const body = url.pathname === "/api/cloud/health" ? { v: 1 } : url.pathname === "/api/cloud/power" ? { v: 1, idle, busy: idle ? [] : ["turn"], nextDueAt: null }
        : url.pathname === "/api/cloud/power/sleep" ? { ok: idle } : { ok: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return fetch(input, init);
  };
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No address.");
  const origin = `http://127.0.0.1:${address.port}`;
  cleanup.push(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const app = createDashboardApp({ dataDir: dir, publicUrl: origin, mailer, staticDir: null, now, fetch: fetcher });
  cleanup.push(() => app.close());
  server.on("request", app.handle);
  const billing = vi.mocked(createBilling).mock.results.at(-1)!.value as ReturnType<typeof createBilling>;
  const csrf = new Map<string, string>();
  function page(path: string, body?: unknown, cookie?: string, extra: Record<string, string> = {}) {
    return fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie, [CSRF_HEADER]: csrf.get(cookie) ?? "" } : {}), origin, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function login(email: string) {
    const { attempt } = await (await page("/v1/auth/start", { email })).json() as { attempt: string };
    const code = mailer.outbox.findLast(m => m.to === email)!.text.match(/\b\d{8}\b/)![0];
    const verify = await page("/v1/auth/verify", { attempt, code });
    const cookie = verify.headers.get("set-cookie")!.split(";")[0]!;
    csrf.set(cookie, (await verify.json() as { csrfToken: string }).csrfToken);
    return cookie;
  }
  const snapshot = () => JSON.parse(readFileSync(join(dir, "billing.json"), "utf8")) as BillingState;
  async function buy(cookie: string) {
    const checkout = await page("/v1/billing/checkout", { kind: "cart", cart: { interval: "month", license: { kind: "none" }, desktop: { kind: "shared_s", region: "fsn1" } } }, cookie);
    expect(checkout.status).toBe(200);
    const stored = snapshot().checkouts.at(-1)!;
    for (const delivery of billing.fake!.complete(stored.providerSessionId!)) {
      const answer = await fetch(`${origin}/v1/billing/webhooks/dodo`, { method: "POST", headers: { "content-type": "application/json", ...delivery.headers }, body: new Uint8Array(delivery.body) });
      expect(answer.status).toBe(200);
    }
    const cloud = billing.clouds.get(stored.cloudId!)!;
    for (let n = 0; n < 20 && cloud.status !== "running"; n++) { cloud.nextAttemptAt = 0; await billing.clouds.reconcile(); }
    expect(cloud).toMatchObject({ backend: "boat", status: "running" });
    return { cloud, subscriptionId: snapshot().subscriptions.at(-1)!.providerSubscriptionId! };
  }
  const clouds: Array<{ nextAttemptAt: number }> = [];
  async function settle(times = 6) { for (let n = 0; n < times; n++) { for (const c of clouds) c.nextAttemptAt = 0; await billing.clouds.reconcile(); } }
  return { api, billing, mailer, page, login, buy: async (cookie: string) => { const bought = await buy(cookie); clouds.push(bought.cloud); return bought; }, settle, origin, csrf, setIdle: (v: boolean) => { idle = v; }, advance: (ms: number) => { time += ms; }, now };
}


async function deliver(f: Awaited<ReturnType<typeof fixture>>, deliveries: Array<{ headers: Record<string, string>; body: Buffer | Uint8Array }>) {
  const codes: number[] = [];
  for (const d of deliveries) codes.push((await fetch(`${f.origin}/v1/billing/webhooks/dodo`, { method: "POST", headers: { "content-type": "application/json", ...d.headers }, body: new Uint8Array(d.body) })).status);
  return codes;
}

it("deleting the account with a paid plan pauses the Boat cloud at the period end and deletes it 45 days later", async () => {
  const f = await fixture();
  const owner = await f.login("owner@example.test");
  const { cloud, subscriptionId } = await f.buy(owner);
  const periodEnd = f.billing.service.subscriptions(cloud.accountId)[0]!.currentPeriodEnd!;
  const res = await f.page("/v1/account/delete", { email: "owner@example.test", cancelBilling: true, destroyDesktopsNow: true }, owner);
  expect(res.status).toBe(200);
  await f.settle(4);
  // Dodo ends the cancelled subscription at the period end
  f.advance(periodEnd - f.now() + 60_000);
  console.info(`[review] expiry webhook after account deletion answered ${JSON.stringify(await deliver(f, f.billing.fake!.expire(subscriptionId)))}`);
  await f.settle(6);
  console.info(`[review] after period end: cloud=${cloud.status} entitled=${JSON.stringify(f.billing.clouds.boat!.verdict(cloud))}`);
  expect.soft(cloud.status, "the deleted account's Boat cloud is still running after its paid period").toBe("stopped");
  f.advance(46 * DAY_MS); await f.settle(6);
  console.info(`[review] 46 days later: cloud=${cloud.status} deletes=${f.api.deletes().length}`);
  expect(cloud.status, "the deleted account's Boat cloud and data are never removed").toBe("destroyed");
});

it("signed but late, replayed or out-of-order billing events never bring retention forward", async () => {
  const f = await fixture();
  const owner = await f.login("owner@example.test");
  const { cloud, subscriptionId } = await f.buy(owner);
  const renewal = f.billing.fake!.renew(subscriptionId);
  expect(await deliver(f, renewal)).toEqual([200, 200]);
  const expiry = f.billing.fake!.expire(subscriptionId);
  await deliver(f, expiry); await f.settle(8);
  expect(cloud.status).toBe("stopped");
  const deleteAt = f.billing.clouds.view(cloud).destroyAt!;
  // the same expiry replayed, the earlier renewal replayed, and a freshly signed out-of-order "active"
  await deliver(f, expiry); await deliver(f, renewal);
  await deliver(f, f.billing.fake!.renew(subscriptionId));
  await f.settle(4);
  expect(f.billing.clouds.view(cloud).destroyAt!).toBeGreaterThanOrEqual(deleteAt);
  while (f.now() + DAY_MS < deleteAt) { f.advance(DAY_MS); await f.settle(1); }
  expect(f.api.deletes()).toHaveLength(0);
});

it("cancel then keep through the billing routes never stops or deletes the cloud", async () => {
  const f = await fixture();
  const owner = await f.login("owner@example.test");
  const { cloud, subscriptionId } = await f.buy(owner);
  const sub = f.billing.service.subscriptions(cloud.accountId)[0]!;
  expect((await f.page(`/v1/billing/subscriptions/${sub.id}/cancel`, {}, owner)).status).toBe(200);
  await f.settle(2);
  expect((await f.page(`/v1/billing/subscriptions/${sub.id}/keep`, {}, owner)).status).toBe(200);
  for (let month = 0; month < 3; month++) { f.advance(31 * DAY_MS); await deliver(f, f.billing.fake!.renew(subscriptionId)); await f.settle(2); }
  expect(cloud.status).toBe("running");
  expect(f.api.deletes()).toHaveLength(0);
});
