import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createCloudAccountClient } from "../../../electron/cloud-account.mjs";
import { parseCloudOffer, parseCloudSummary, parsePairingGrant, parsePublicOffer } from "../../../electron/cloud-home.mjs";
import { otherOwnClouds, parseCloudList, parseCloudRenewal } from "../../../electron/cloud-list.mjs";
import { createBilling } from "./index.ts";
import { body, json } from "./http.ts";
import { BILLING_CONFIG } from "./plans.ts";
import type { AccountRef } from "./types.ts";
import type { BillingState } from "./store.ts";
import type { CloudDesktopView } from "../../../shared/billing-api.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "omb-billing-app-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const time = Date.now(), now = () => time;
  const tokens = new Map<string, AccountRef>(), attempts = new Map<string, string>();
  let billing: ReturnType<typeof createBilling>, origin: string, owner: AccountRef | null = null;
  const shim = createServer(async (req, res) => {
    const url = new URL(req.url!, origin);
    try {
      if (req.method === "POST" && url.pathname === "/api/cloud/app/sign-in/start") {
        const data = await body(req), attempt = randomBytes(32).toString("base64url");
        if (typeof data.email !== "string") return json(res, 400, { error: "invalid_request" });
        attempts.set(attempt, data.email);
        return json(res, 200, { cloudContractVersion: 1, attempt, expiresIn: 600, resendAfter: 30 });
      }
      if (req.method === "POST" && url.pathname === "/api/cloud/app/sign-in/verify") {
        const data = await body(req), email = attempts.get(String(data.attempt));
        if (!email || data.code !== "12345678") return json(res, 400, { error: "invalid_code" });
        attempts.delete(String(data.attempt));
        const account = { id: `acct_${createHash("sha256").update(email).digest("hex").slice(0, 24)}`, email }, token = `omc_${randomBytes(32).toString("base64url")}`;
        tokens.set(token, account); owner = account;
        return json(res, 200, { cloudContractVersion: 1, accessToken: token, expiresAt: now() + 86400_000, device: { id: "fixture-device" }, account });
      }
      if (url.pathname === "/api/cloud/desktop/session") {
        const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "", account = tokens.get(token);
        if (!account) return json(res, 401, { error: "invalid_token" });
        if (req.method === "DELETE") { tokens.delete(token); return json(res, 200, { cloudContractVersion: 1, ok: true }); }
        return json(res, 200, { cloudContractVersion: 1, expiresAt: now() + 86400_000, device: { id: "fixture-device" }, account, ...await billing.sessionFields(account) });
      }
      if (await billing.handle(req, res, url)) return;
      json(res, 404, { error: "not_found" });
    } catch { json(res, 500, { error: "fixture_failed" }); }
  });
  await new Promise<void>(resolve => shim.listen(0, "127.0.0.1", resolve));
  const address = shim.address(); if (!address || typeof address === "string") throw new Error("No fixture address.");
  origin = `http://127.0.0.1:${address.port}`;
  billing = createBilling({ dataDir: dir, publicUrl: origin, now, env: {}, dashboard: { state: { accounts: [], sessions: [], workspaces: [] }, changed() {} },
    accounts: { fromBearer: token => tokens.get(token) ?? null, fromCookie: req => req.headers.cookie === "fixture=owner" ? owner : null } });
  cleanup.push(() => billing.close());
  cleanup.push(() => new Promise<void>(resolve => { shim.close(() => resolve()); shim.closeAllConnections(); }));
  const browsers: string[] = []; let saved: unknown = null;
  const timers = { setTimer: () => 1, clearTimer: () => {} };
  const client = createCloudAccountClient({ origin, fixture: true, platform: "darwin", deviceName: "Fixture Mac", appVersion: "0.1.fixture", now,
    store: { read: async () => saved, write: async value => { saved = value; } }, openBrowser: async url => { browsers.push(url); },
    ...timers });
  cleanup.push(() => client.close());
  const snapshot = () => JSON.parse(readFileSync(join(dir, "billing.json"), "utf8")) as BillingState;
  async function request(path: string, data?: unknown, token = [...tokens.keys()][0], method = data === undefined ? "GET" : "POST") {
    const response = await fetch(`${origin}${path.startsWith("/") ? path : `/api/cloud/desktop/${path}`}`, { method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, data: await response.json() as Record<string, unknown> };
  }
  async function signIn() {
    expect((await client.emailStart("owner@example.test")).outcome).toBe("sent");
    expect((await client.emailVerify("12345678")).outcome).toBe("signed-in");
  }
  async function complete(index = 0) {
    const checkout = snapshot().checkouts[index], deliveries = billing.fake!.complete(checkout.providerSessionId!);
    for (const delivery of deliveries) {
      const response = await fetch(`${origin}/v1/billing/webhooks/dodo`, { method: "POST", headers: { "content-type": "application/json", ...delivery.headers }, body: new Uint8Array(delivery.body) });
      expect(response.status).toBe(200);
    }
    return checkout;
  }
  async function reconcile() { for (let n = 0; n < 8; n++) await billing.clouds.reconcile(); }
  return { billing, client, origin, tokens, browsers, signIn, request, complete, reconcile, snapshot, now, owner: () => owner! };
}

it("runs the real desktop client through checkout, setup, pairing, upgrade, another Cloud and Cancel/Keep", async () => {
  const f = await fixture(); await f.client.start(); await f.signIn();
  expect(f.client.state()).toMatchObject({ status: "connected", entitlement: { plan: "free", status: "inactive" }, offer: { plans: [{ tier: "starter" }, { tier: "pro" }, { tier: "team" }] } });
  const publicConfig = await f.request("/api/public/config");
  expect(parsePublicOffer(publicConfig.data)?.plans.map(p => p.tier)).toEqual(["starter", "pro", "team"]);
  expect(parseCloudOffer((await f.billing.sessionFields(f.owner())).offer)?.recommended).toBe("pro");
  expect((await f.client.checkout("starter", "app_card")).outcome).toBe("opened");
  expect(f.browsers[0]).toMatch(/^https:\/\/test.checkout.dodopayments.com\//);
  let fields = f.billing.sessionFields(f.owner());
  expect(fields).toMatchObject({ canAdd: false, addBlocked: "checkout_open", offer: { checkout: { plan: "starter" } } });
  const checkout = await f.complete();
  await f.client.refresh();
  expect(f.client.state()).toMatchObject({ status: "connected", entitlement: { plan: "pro", tier: "starter", status: "active" }, machine: { status: "provisioning" } });
  await f.reconcile(); await f.client.refresh();
  expect(f.client.state()).toMatchObject({ machine: { status: "ready", origin: expect.stringMatching(/^https:\/\//) }, clouds: [{ id: checkout.cloudId, primary: true }] });
  fields = f.billing.sessionFields(f.owner());
  expect(parseCloudSummary(fields.cloud)).toMatchObject({ status: "ready", disk: { gb: 40, maxGb: 40 } });
  expect(parseCloudList(fields.clouds)).toHaveLength(1); expect(parseCloudRenewal(fields.clouds)).toMatchObject({ cancelled: false, trial: false, keptDays: 7 });
  expect(fields.offer).toBeUndefined();
  expect(fields.cloud).not.toHaveProperty("power");
  const grant = await f.client.pairHome(); expect(parsePairingGrant({ ...grant, cloudContractVersion: 1 }, grant.origin, f.now())).toEqual(grant);
  expect((await f.client.pairHome()).code).not.toBe(grant.code);
  expect(await f.client.upgradePreview("pro", "app_usage")).toMatchObject({ outcome: "preview", preview: { plan: "pro", from: "starter", price: 5000, tax: 0, trial: false } });
  expect(await f.client.upgrade("pro", "app_usage")).toEqual({ outcome: "upgraded", tier: "pro" });
  await f.reconcile(); expect(f.billing.clouds.get(checkout.cloudId!)!.spec).toEqual(BILLING_CONFIG.desktops.shared_m.machine);
  expect((await f.client.addCloud({ tier: "pro", interval: "month", name: "Client B", color: "green" })).outcome).toBe("opened");
  expect(f.snapshot().checkouts[1].cart).toMatchObject({ license: { kind: "none" }, desktop: { kind: "shared_m" } });
  expect(f.snapshot().checkouts[1].amountCents).toBe(4000);
  await f.client.refresh();
  fields = f.billing.sessionFields(f.owner());
  expect(parseCloudList(fields.clouds)).toHaveLength(2); expect(otherOwnClouds(parseCloudList(fields.clouds))).toMatchObject([{ name: "Client B", color: "green", primary: false }]);
  const cancelled = await f.client.cancelPlan({ answer: "price", improve: "cheaper" });
  expect(cancelled).toMatchObject({ outcome: "cancelled", renewal: { cancelled: true, trial: false, keptDays: 7 }, surveyed: true });
  expect(f.snapshot().feedback[0]).toMatchObject({ cloudId: checkout.cloudId, answer: "price", improve: "cheaper" });
  expect(await f.client.keepPlan()).toMatchObject({ outcome: "kept" });
  expect(f.snapshot().subscriptions[0].cancelAtPeriodEnd).toBe(false);
  f.tokens.clear();
  expect((await f.request("license", undefined, `omc_${"Z".repeat(43)}`))).toEqual({ status: 401, data: { error: "invalid_token" } });
  expect((await f.client.refresh()).status).toBe("reauth-required");
});

it("enforces Admin ownership, one-time confirmations, typed bodies, and the desktop error codes", async () => {
  const f = await fixture(); await f.signIn();
  const refused = async (path: string, data: unknown, status: number, error: string, token?: string) => {
    const result = await f.request(path, data, token); expect(result).toMatchObject({ status, data: { error } }); return result;
  };
  await refused("upgrade/preview", { plan: "pro", source: "app_usage" }, 409, "not_subscribed");
  for (const plan of ["personal", "max"]) await refused("upgrade/preview", { plan }, 409, "plan_change_unavailable");
  for (const data of [{ plan: "free" }, { plan: 1 }, { plan: "starter", source: 2 }]) await refused("checkout", data, 400, "invalid_request");
  const checkout = await f.request("checkout", { plan: "starter", source: "app_card", ignored: true, color: 12 }); expect(checkout.status).toBe(200);
  const open = await refused("checkout", { plan: "starter", source: "app_card" }, 409, "checkout_open"); expect(open.data.checkoutUrl).toBe(checkout.data.url);
  expect(await refused("clouds", { tier: "pro", interval: "month", name: "Other" }, 409, "checkout_open")).toMatchObject({ data: { addBlocked: "checkout_open" } });
  const purchase = await f.complete(), id = purchase.cloudId!;
  await refused("checkout", { plan: "pro", source: "app_card" }, 409, "already_subscribed");
  await refused("pairing", { cloudId: id }, 409, "not_running");
  await f.reconcile();
  const stranger = `omc_${"S".repeat(43)}`; f.tokens.set(stranger, { id: "stranger", email: "stranger@example.test" });
  for (const [route, data, method] of [[`clouds/${id}`, { color: "green" }, "PATCH"], [`clouds/${id}/hide`, {}, "POST"], [`clouds/${id}/cancel`, {}, "POST"], [`clouds/${id}/keep`, {}, "POST"], ["pairing", { cloudId: id }, "POST"], ["feedback", { cloudId: id, answer: "price" }, "POST"]] as const) {
    expect(await f.request(route, data, stranger, method)).toMatchObject({ status: 404, data: { error: "not_found" } });
  }
  await refused(`clouds/${id}/hide`, {}, 409, "not_removable");
  expect(await f.request(`clouds/${id}`, { color: null }, undefined, "PATCH")).toMatchObject({ status: 200, data: { cloudContractVersion: 1, ok: true } });
  expect(await f.request(`clouds/${id}`, { color: 12 }, undefined, "PATCH")).toMatchObject({ status: 400, data: { error: "invalid_request" } });
  await refused("upgrade/preview", { plan: "starter", source: "app_usage" }, 409, "already_on_plan");
  const preview = await f.request("upgrade/preview", { plan: "pro", source: "app_usage" }); expect(preview.status).toBe(200);
  await refused("upgrade", { plan: "starter", confirmation: preview.data.confirmation, source: "app_usage" }, 409, "confirmation_required");
  expect((await f.request("upgrade", { plan: "pro", confirmation: preview.data.confirmation, source: "app_usage" })).status).toBe(200);
  await refused("upgrade", { plan: "pro", confirmation: preview.data.confirmation, source: "app_usage" }, 409, "confirmation_required");
  const cloud = f.billing.clouds.get(id)!;
  expect(await f.request("moved-to", { origin: cloud.origin }, stranger)).toMatchObject({ data: { state: "unknown" } });
  expect(await f.request("moved-to", { origin: cloud.origin })).toMatchObject({ data: { state: "live", cloudContractVersion: 1 } });
  expect(await f.request("wake", {})).toMatchObject({ data: { state: "awake", cloudContractVersion: 1 } });
  expect(await f.request("resize-now", {})).toMatchObject({ data: { state: "current", cloudContractVersion: 1 } });
  expect(await f.request("license")).toMatchObject({ data: { v: 1, cloudContractVersion: 1, work: "licensed" } });
  const view = f.billing.clouds.view(cloud) as CloudDesktopView; expect(view.machine).toEqual(BILLING_CONFIG.desktops.shared_m.machine);
  const previousOrigin = cloud.origin;
  f.billing.clouds.end(id, f.now()); await f.reconcile();
  expect(await f.request("moved-to", { origin: previousOrigin })).toMatchObject({ data: { state: "deleted" } });
  expect(await f.request(`clouds/${id}/hide`, {})).toMatchObject({ status: 200, data: { cloudContractVersion: 1, ok: true } });
  expect(parseCloudList(f.billing.sessionFields(f.owner()).clouds)).toHaveLength(0);
});

it("reports Add a Cloud cap and rate blocks in the desktop shape", async () => {
  const f = await fixture(); await f.signIn();
  const plan = BILLING_CONFIG.desktops.shared_s;
  for (let n = 0; n < BILLING_CONFIG.maxCloudsPerAccount; n++) f.billing.clouds.order({ accountId: f.owner().id, name: `Cloud ${n}`, color: null, region: "fsn1", kind: plan.kind, placement: plan.placement, spec: plan.machine, botComputers: plan.botComputers });
  expect(await f.request("clouds", { tier: "pro", interval: "month", name: "One too many" })).toMatchObject({ status: 409, data: { error: "cap", addBlocked: "cap" } });
  expect(f.billing.sessionFields(f.owner())).toMatchObject({ canAdd: false, addBlocked: "cap" });
  for (let n = 0; n < BILLING_CONFIG.checkoutsPerHour; n++) await f.billing.service.checkout(f.owner(), { kind: "credits", pack: "c10" });
  expect(await f.request("clouds", { tier: "pro", interval: "month", name: "Rate limited" })).toMatchObject({ status: 429, data: { error: "rate_limited", addBlocked: "rate" } });
});
