import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { signedPayload } from "../../../../shared/dashboard-protocol.ts";
import type { BillingOverview, Cart, Catalog, CheckoutAnswer, CloudDesktopView, InvoicePage, Quote } from "../../../../shared/billing-api.ts";
import { createDashboardApp } from "../app.ts";
import { memoryMailer } from "../auth/mail.ts";
import { CSRF_HEADER } from "../../../../shared/account-api.ts";
import { createBilling } from "./index.ts";
import type { BillingOptions } from "./index.ts";
import { BILLING_CONFIG } from "./plans.ts";
import { quote } from "./pricing.ts";
import type { BillingState } from "./store.ts";

vi.mock("./index.ts", async importOriginal => {
  const actual = await importOriginal<typeof import("./index.ts")>();
  return { ...actual, createBilling: vi.fn(actual.createBilling) };
});
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const read = <T>(response: Response): Promise<T> => response.json() as Promise<T>;
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture address.");
  cleanup.push(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  return `http://127.0.0.1:${address.port}`;
}
function dataDirectory() {
  const dir = mkdtempSync(join(tmpdir(), "omb-billing-routes-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
async function fixture() {
  for (const key of ["DUSK_BILLING_PROVIDER", "DUSK_CLOUD_PROVIDER", "DUSK_POOL_DRIVER", "DUSK_CLOUD_SEAL_KEY", "DUSK_DODO_PRODUCTS"]) vi.stubEnv(key, undefined);
  const dir = dataDirectory(), mailer = memoryMailer(), csrf = new Map<string, string>();
  let time = Date.now();
  const app = createDashboardApp({ dataDir: dir, publicUrl: "http://127.0.0.1", mailer, staticDir: null, now: () => time });
  const billing = vi.mocked(createBilling).mock.results.at(-1)!.value as ReturnType<typeof createBilling>;
  const dashboard = vi.mocked(createBilling).mock.calls.at(-1)![0].dashboard;
  cleanup.push(() => app.close());
  const origin = await listen(createServer(app.handle));
  async function page(path: string, data?: unknown, cookie?: string, method = data === undefined ? "GET" : "POST") {
    return fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json", origin: "http://127.0.0.1", ...(cookie ? { cookie, [CSRF_HEADER]: csrf.get(cookie) ?? "" } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), redirect: "manual" });
  }
  async function answer<T>(path: string, data?: unknown, cookie?: string, method?: string) {
    const res = await page(path, data, cookie, method); expect(res.status, `${method ?? "request"} ${path}: ${res.status}`).toBe(200); return read<T>(res);
  }
  async function login(email = "owner@example.test") {
    const start = await answer<{ attempt: string }>("/v1/auth/start", { email });
    const res = await page("/v1/auth/verify", { attempt: start.attempt, code: mailer.outbox.findLast(item => item.to === email)?.text.match(/\b\d{8}\b/)?.[0] }); expect(res.status).toBe(200);
    const { account, csrfToken } = await read<{ account: { id: string; email: string }; csrfToken: string }>(res);
    const cookie = res.headers.getSetCookie().find(value => value.startsWith("omb_dash="))!.split(";")[0];
    csrf.set(cookie, csrfToken);
    return { cookie, account, csrfToken };
  }
  const saved = () => JSON.parse(readFileSync(join(dir, "billing.json"), "utf8")) as BillingState;
  async function deliver(delivery: { headers: Record<string, string>; body: Buffer }) {
    const res = await fetch(`${origin}/v1/billing/webhooks/dodo`, { method: "POST", headers: { "content-type": "application/json", ...delivery.headers }, body: new Uint8Array(delivery.body) });
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ ok: true });
  }
  async function complete(id: string) {
    const checkout = saved().checkouts.find(c => c.id === id)!;
    const deliveries = billing.fake!.complete(checkout.providerSessionId!);
    for (const delivery of deliveries) await deliver(delivery); return deliveries;
  }
  async function reconcile() { for (let n = 0; n < 8; n++) await billing.clouds.reconcile(); }
  return { dir, app, dashboard, billing, origin, page, answer, login, saved, complete, deliver, reconcile, setTime: (at: number) => { time = at; }, now: () => time };
}
const bundle = (id: string): Cart => ({ ...structuredClone(BILLING_CONFIG.bundles.find(b => b.id === id)!.cart), interval: "month" });

it("requires csrf on every cookie billing mutation and leaves public quotes and reads accessible", async () => {
  const f = await fixture(), owner = await f.login();
  const mutations = [
    ["POST", "/v1/billing/checkout"], ["POST", "/v1/billing/portal"], ["POST", "/v1/billing/fake/complete"],
    ...["preview", "change", "cancel", "keep"].map(action => ["POST", `/v1/billing/subscriptions/missing/${action}`]),
    ["POST", "/v1/billing/licenses/missing/members"], ["DELETE", "/v1/billing/licenses/missing/members/member%40example.test"],
    ["PATCH", "/v1/clouds/missing"], ["POST", "/v1/clouds/missing/power"],
  ];
  for (const [method, path] of mutations) {
    const response = await fetch(`${f.origin}${path}`, { method, headers: { cookie: owner.cookie, "content-type": "application/json" }, body: "{}" });
    expect(response.status, path).toBe(403);
    expect(await response.json()).toMatchObject({ code: "csrf" });
  }
  for (const path of ["/v1/billing/overview", "/v1/billing/invoices", "/v1/billing/credits", "/v1/billing/license", "/v1/clouds"]) {
    expect((await fetch(`${f.origin}${path}`, { headers: { cookie: owner.cookie } })).status, path).toBe(200);
  }
  for (const path of ["/v1/billing/invoices/missing/download", "/v1/clouds/missing"]) {
    expect((await fetch(`${f.origin}${path}`, { headers: { cookie: owner.cookie } })).status, path).toBe(404);
  }
  expect((await f.page("/v1/billing/quote", { cart: bundle("starter") })).status).toBe(200);
  expect(f.billing.service.subscriptions(owner.account.id)).toEqual([]);
  expect(f.billing.clouds.list(owner.account.id)).toEqual([]);
});

it("separates cookie and app credentials and preserves billing origin and CORS boundaries", async () => {
  const f = await fixture(), owner = await f.login();
  const device = await f.answer<{ deviceCode: string; userCode: string }>("/api/cloud/desktop/authorize", { deviceName: "Fixture", platform: "darwin" });
  await f.answer("/v1/auth/device/approve", { userCode: device.userCode }, owner.cookie);
  const grant = await f.answer<{ accessToken: string }>("/api/cloud/desktop/token", { deviceCode: device.deviceCode });
  for (const token of [undefined, owner.cookie.split("=")[1], `omc_${owner.cookie.split("=")[1]}`]) {
    const response = await fetch(`${f.origin}/api/cloud/desktop/license`, { headers: { cookie: owner.cookie, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "invalid_token" });
  }
  for (const cookie of [undefined, `omb_dash=${grant.accessToken}`, `omb_dash=${grant.accessToken.slice(4)}`]) {
    const response = await fetch(`${f.origin}/v1/billing/overview`, { headers: { authorization: `Bearer ${grant.accessToken}`, ...(cookie ? { cookie } : {}) } });
    expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ code: "signed_out" });
  }
  for (const path of ["/v1/billing/checkout", "/v1/billing/quote", "/v1/clouds/missing/power", "/api/cloud/desktop/checkout"]) {
    for (const headers of [{ "content-type": "text/plain", origin: "http://127.0.0.1" }, { "content-type": "application/json", origin: "https://foreign.test" }]) {
      const response = await fetch(`${f.origin}${path}`, { method: "POST", headers: { ...headers, cookie: owner.cookie, [CSRF_HEADER]: owner.csrfToken, authorization: `Bearer ${grant.accessToken}` }, body: "{}" });
      expect(response.status, path).toBe(403); expect(await response.json()).toMatchObject(path.startsWith("/api/") ? { error: "forbidden" } : { code: "forbidden" });
    }
    const preflight = await fetch(`${f.origin}${path}`, { method: "OPTIONS", headers: { origin: "https://foreign.test", "access-control-request-method": "POST" } });
    expect(preflight.headers.get("access-control-allow-origin"), path).toBeNull();
  }
  const fields = vi.spyOn(f.billing, "sessionFields").mockReturnValue({ account: { id: "wrong" }, device: {}, expiresAt: 0, cloudContractVersion: 99 });
  const session = await fetch(`${f.origin}/api/cloud/desktop/session`, { headers: { authorization: `Bearer ${grant.accessToken}` } });
  expect(await session.json()).toMatchObject({ account: { id: owner.account.id, email: owner.account.email }, device: { id: expect.any(String) }, expiresAt: expect.any(Number), cloudContractVersion: 1 });
  expect(fields).toHaveBeenCalledWith(expect.objectContaining({ id: owner.account.id, email: owner.account.email }));
});

it("runs the dashboard billing lifecycle over HTTP, including signed workspace reports and webhook replays", async () => {
  const f = await fixture(), { cookie, account, csrfToken } = await f.login();
  const catalog = await f.answer<Catalog>("/v1/billing/catalog"); expect(catalog.bundles.map(b => b.id)).toEqual(["free", "starter", "pro", "team"]);
  const builder: Cart = { interval: "year", license: { kind: "solo" }, desktop: { kind: "dedicated", region: "fsn1", spec: { vcpu: 12, ramGb: 24, diskGb: 240 } } };
  expect(await f.answer<Quote>("/v1/billing/quote", { cart: builder })).toMatchObject({ bundle: null, machine: builder.desktop.spec, totalCents: quote(builder).totalCents });
  const team: Cart = { ...bundle("team"), license: { kind: "team", members: 6 } };
  const teamQuote = await f.answer<Quote>("/v1/billing/quote", { cart: team });
  expect(teamQuote.members).toBe(6); expect(teamQuote.lines.find(l => l.kind === "members")?.amountCents).toBe((team.license.members! - BILLING_CONFIG.licenses.team.includedMembers) * BILLING_CONFIG.licenses.team.extraMemberCents!);
  const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: { ...bundle("starter"), license: { kind: "solo" } } }, cookie);
  expect(checkout).toMatchObject({ v: 1, checkoutId: expect.any(String), cloudId: expect.any(String), checkoutUrl: expect.stringMatching(/^https:\/\/test.checkout.dodopayments.com\//) });
  const deliveries = await f.complete(checkout.checkoutId);
  let overview = await f.answer<BillingOverview>("/v1/billing/overview", undefined, cookie);
  expect(overview.subscriptions).toHaveLength(1); expect(overview.subscriptions[0].status).toBe("active");
  expect(overview.license).toMatchObject({ work: "licensed", license: { status: "active", role: "owner" } }); expect(overview.invoices.invoices).toHaveLength(1);
  const counts = () => { const s = f.saved(); return [s.subscriptions.length, s.licenses.length, s.invoices.length, s.credits.length, s.webhookEvents.length]; };
  const beforeReplay = counts(); for (const d of deliveries) await f.deliver(d); expect(counts()).toEqual(beforeReplay);
  const tampered = await fetch(`${f.origin}/v1/billing/webhooks/dodo`, { method: "POST", headers: { "content-type": "application/json", ...deliveries[0].headers, "webhook-signature": `v1,${Buffer.alloc(32).toString("base64")}` }, body: new Uint8Array(deliveries[0].body) });
  expect(tampered.status).toBe(401); expect(await tampered.json()).toMatchObject({ code: "bad_signature" }); expect(counts()).toEqual(beforeReplay);
  await f.reconcile();
  let cloud = (await f.answer<{ clouds: CloudDesktopView[] }>("/v1/clouds", undefined, cookie)).clouds[0];
  expect(cloud).toMatchObject({ status: "running", origin: expect.stringMatching(/^https:\/\//), workspaceId: expect.stringMatching(/^ws_/) });
  const workspaces = await f.answer<{ workspaces: Array<{ id: string }> }>("/v1/workspaces", undefined, cookie); expect(workspaces.workspaces[0].id).toBe(cloud.workspaceId);
  expect(f.dashboard.state.workspaces[0].ownerAccountId).toBe(account.id);
  expect(JSON.parse(readFileSync(join(f.dir, "state.json"), "utf8")).workspaces[0].id).toBe(cloud.workspaceId);
  const call = f.billing.fakePool!.calls.find(c => c.method === "createSlot")!;
  const bootstrap = JSON.parse((call.input as { bootstrap: string }).bootstrap) as { files: Array<{ path: string; content: string; mode: number }> };
  const link = JSON.parse(bootstrap.files[0].content) as { workspaceId: string; privateKey: string };
  expect(link.workspaceId).toBe(cloud.workspaceId); expect(bootstrap.files[0].mode).toBe(0o600);
  const raw = JSON.stringify({ v: 1, seq: 1, at: f.now(), workspace: { name: "Paid fixture", kind: "vps", version: "1.0.0", platform: "linux" } });
  const signature = sign(null, Buffer.from(signedPayload("POST", "/v1/report", f.now(), createHash("sha256").update(raw).digest("hex"))), createPrivateKey({ key: Buffer.from(link.privateKey, "base64"), format: "der", type: "pkcs8" })).toString("base64");
  const report = await fetch(`${f.origin}/v1/report`, { method: "POST", headers: { "content-type": "application/json", "x-omb-workspace": link.workspaceId, "x-omb-time": String(f.now()), "x-omb-signature": signature }, body: raw }); expect(report.status).toBe(200);
  cloud = (await f.answer<{ cloud: CloudDesktopView }>(`/v1/clouds/${cloud.id}`, undefined, cookie)).cloud; expect(cloud.lastReportAt).toBe(f.now());
  expect(await f.answer(`/v1/clouds/${cloud.id}`, { name: "Paid Cloud", color: "blue", ignored: true }, cookie, "PATCH")).toMatchObject({ cloud: { name: "Paid Cloud", color: "blue" } });
  expect(await f.answer(`/v1/clouds/${cloud.id}/power`, { action: "off" }, cookie)).toMatchObject({ cloud: { status: "stopped" } });
  expect(await f.answer(`/v1/clouds/${cloud.id}/power`, { action: "on" }, cookie)).toMatchObject({ cloud: { status: "running" } });
  const subId = overview.subscriptions[0].id;
  const preview = await f.answer<{ confirmation: string }>(`/v1/billing/subscriptions/${subId}/preview`, { cart: bundle("pro") }, cookie);
  await f.answer(`/v1/billing/subscriptions/${subId}/change`, { confirmation: preview.confirmation }, cookie); await f.reconcile();
  expect(f.billing.clouds.get(cloud.id)?.spec).toEqual(BILLING_CONFIG.desktops.shared_m.machine);
  expect(f.billing.fakePool!.calls.find(c => c.method === "setQuota")?.input).toMatchObject({ ...BILLING_CONFIG.desktops.shared_m.machine, botComputers: 5, netMbps: 250 });
  const credits = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "credits", pack: "c25" }, cookie), creditDeliveries = await f.complete(credits.checkoutId);
  expect(await f.answer("/v1/billing/credits", undefined, cookie)).toMatchObject({ balanceCents: 2500 });
  const afterCredits = counts(); for (const d of [...deliveries, ...creditDeliveries]) await f.deliver(d); expect(counts()).toEqual(afterCredits);
  const invoices = await f.answer<InvoicePage>("/v1/billing/invoices", undefined, cookie); expect(invoices.invoices).toHaveLength(2);
  for (const invoice of invoices.invoices) { const res = await f.page(invoice.downloadUrl!, undefined, cookie); expect(res.status).toBe(302); expect(res.headers.get("location")).toMatch(/^https:\/\/test.customer.dodopayments.com\/invoices\//); expect(res.headers.get("cache-control")).toBe("no-store"); }
  const stranger = await f.login("stranger@example.test");
  for (const [path, data] of [[`/v1/clouds/${cloud.id}`, undefined], [`/v1/billing/subscriptions/${subId}/cancel`, {}], [invoices.invoices[0].downloadUrl!, undefined], [`/v1/billing/licenses/${overview.licenses[0].id}/members`, { email: "x@example.test" }]] as const) {
    const res = await f.page(path, data, stranger.cookie); expect(res.status).toBe(404); expect(await res.json()).toMatchObject({ code: "not_found" });
  }
  const wrongType = await fetch(`${f.origin}/v1/billing/checkout`, { method: "POST", headers: { cookie, [CSRF_HEADER]: csrfToken, origin: "http://127.0.0.1", "content-type": "text/plain" }, body: "{}" }); expect(wrongType.status).toBe(403);
  const foreignOrigin = await fetch(`${f.origin}/v1/billing/checkout`, { method: "POST", headers: { cookie, [CSRF_HEADER]: csrfToken, "content-type": "application/json", origin: "https://foreign.test" }, body: "{}" }); expect(foreignOrigin.status).toBe(403);
  const signedOut = await f.page("/v1/billing/overview");
  expect(signedOut.status).toBe(401); expect(await signedOut.json()).toMatchObject({ code: "signed_out" });
  const beforeCsrf = structuredClone({ billing: f.saved(), cloud: f.billing.clouds.get(cloud.id), dashboard: f.dashboard.state });
  const noCsrf = await fetch(`${f.origin}/v1/billing/subscriptions/${subId}/cancel`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1" }, body: "{}" });
  expect(noCsrf.status).toBe(403); expect(await noCsrf.json()).toMatchObject({ code: "csrf" });
  expect({ billing: f.saved(), cloud: f.billing.clouds.get(cloud.id), dashboard: f.dashboard.state }).toEqual(beforeCsrf);
  await f.answer(`/v1/billing/subscriptions/${subId}/cancel`, { survey: { answer: "price", improve: "cheaper", ignored: true } }, cookie);
  overview = await f.answer<BillingOverview>("/v1/billing/overview", undefined, cookie);
  expect(overview.subscriptions[0].cancelAtPeriodEnd).toBe(true);
  const destroyAt = overview.subscriptions[0].currentPeriodEnd! + 7 * 86400_000;
  expect(f.billing.clouds.get(cloud.id)?.destroyAt).toBe(destroyAt); expect(f.saved().feedback[0]).toMatchObject({ accountId: account.id, answer: "price", improve: "cheaper" });
  await f.answer(`/v1/billing/subscriptions/${subId}/keep`, {}, cookie); expect(f.billing.clouds.get(cloud.id)?.destroyAt).toBeNull();
  await f.answer(`/v1/billing/subscriptions/${subId}/cancel`, {}, cookie); f.setTime(destroyAt + 1); await f.reconcile();
  expect(f.billing.clouds.get(cloud.id)?.status).toBe("destroyed");
  expect(f.dashboard.state.workspaces).toHaveLength(0);
});

it("completes fake checkouts only for their owner and rejects invalid or oversized bodies", async () => {
  const f = await fixture(), owner = await f.login(), stranger = await f.login("stranger@example.test");
  const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: bundle("starter"), ignored: true }, owner.cookie);
  expect((await f.page("/v1/billing/fake/complete", { checkoutId: checkout.checkoutId }, stranger.cookie)).status).toBe(404);
  expect(await f.answer("/v1/billing/fake/complete", { checkoutId: checkout.checkoutId }, owner.cookie)).toEqual({ ok: true, deliveries: 2 });
  expect(await f.answer("/v1/billing/fake/complete", { checkoutId: checkout.checkoutId }, owner.cookie)).toEqual({ ok: true, deliveries: 2 });
  expect(f.saved().subscriptions).toHaveLength(1);
  for (const data of [{ kind: "credits", pack: 25 }, { kind: "cart", cart: bundle("pro"), name: 2 }, { kind: "credits", pack: "c25", ignored: "x".repeat(17000) }]) {
    const res = await f.page("/v1/billing/checkout", data, owner.cookie); expect(res.status).toBe(400); expect(await res.json()).toMatchObject({ code: "invalid_request" });
  }
  const invoice = f.saved().invoices[0];
  vi.spyOn(f.billing.service, "invoiceDownload").mockResolvedValueOnce({ pdf: { contentType: "application/pdf", body: Buffer.from("%PDF-fixture") } });
  const pdf = await f.page(`/v1/billing/invoices/${invoice.id}/download`, undefined, owner.cookie);
  expect(pdf.headers.get("content-type")).toBe("application/pdf"); expect(pdf.headers.get("content-disposition")).toContain("attachment"); expect(pdf.headers.get("cache-control")).toBe("no-store"); expect(await pdf.text()).toBe("%PDF-fixture");
  vi.spyOn(f.billing.service, "handleWebhook").mockImplementationOnce(() => { throw new Error("fixture internal failure"); });
  const res = await f.page("/v1/billing/webhooks/dodo", {}); expect(res.status).toBe(500);
});

it("serves the billing portal and keeps license membership changes owner-only", async () => {
  const f = await fixture(), owner = await f.login();
  const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: { ...bundle("team"), desktop: { kind: "none" } } }, owner.cookie);
  await f.complete(checkout.checkoutId);
  const license = (await f.answer<BillingOverview>("/v1/billing/overview", undefined, owner.cookie)).licenses[0];
  expect(await f.answer("/v1/billing/portal", {}, owner.cookie)).toMatchObject({ url: expect.stringMatching(/^https:\/\/test.customer.dodopayments.com\//) });
  const members = `/v1/billing/licenses/${license.id}/members`;
  expect(await f.answer(members, { email: "member@example.test", ignored: true }, owner.cookie)).toMatchObject({ license: { members: [{ role: "owner" }, { email: "member@example.test", role: "member" }] } });
  const member = await f.login("member@example.test");
  expect(await f.answer("/v1/billing/license", undefined, member.cookie)).toMatchObject({ work: "licensed", license: { role: "member" } });
  expect((await f.page(members, { email: "other@example.test" }, member.cookie)).status).toBe(404);
  expect((await f.page(`${members}/member%40example.test`, {}, member.cookie, "DELETE")).status).toBe(404);
  expect(await f.answer(`${members}/member%40example.test`, {}, owner.cookie, "DELETE")).toMatchObject({ license: { members: [{ role: "owner" }] } });
  expect((await f.answer<BillingOverview>("/v1/billing/overview", undefined, owner.cookie)).licenses[0].members).toHaveLength(1);
});

it("does not give a recreated account the deleted account's license", async () => {
  const f = await fixture(), owner = await f.login();
  const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: bundle("pro") }, owner.cookie);
  await f.complete(checkout.checkoutId); await f.reconcile();
  const before = f.saved(), cloud = f.billing.clouds.get(checkout.cloudId!)!;
  await f.answer("/v1/account/delete", { email: owner.account.email, cancelBilling: true }, owner.cookie);
  expect(f.dashboard.state.accounts).toHaveLength(0);
  expect(f.dashboard.state.workspaces).toHaveLength(0);
  expect(f.saved().subscriptions[0].cancelAtPeriodEnd).toBe(true);
  expect(cloud).toMatchObject({ status: "running", destroyAt: before.subscriptions[0].currentPeriodEnd! + 7 * 86_400_000 });
  f.setTime(f.now() + 30_000);
  const replacement = await f.login();
  expect(replacement.account.id).not.toBe(owner.account.id);
  const overview = await f.answer<BillingOverview>("/v1/billing/overview", undefined, replacement.cookie);
  expect(overview.license.license).toBeNull();
  expect(overview.licenses).toEqual([]);
  expect(overview.subscriptions).toEqual([]);
  expect(overview.clouds).toEqual([]);
  expect(f.billing.sessionFields(replacement.account).license).toMatchObject({ license: null });
  const creditCheckout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "credits", pack: "c25" }, replacement.cookie);
  await f.complete(creditCheckout.checkoutId);
  expect((await f.answer<BillingOverview>("/v1/billing/overview", undefined, replacement.cookie)).licenses).toEqual([]);
});

function options(overrides: Partial<BillingOptions> = {}): BillingOptions {
  return { dataDir: dataDirectory(), publicUrl: "https://dashboard.example.test", dashboard: { state: { accounts: [], sessions: [], workspaces: [] }, changed() {} },
    accounts: { fromCookie: () => ({ id: "a", email: "a@example.test" }), fromBearer: () => null }, env: {}, ...overrides };
}
it("keeps billing off outside loopback, checks startup configuration, and never mounts fake completion for Dodo", async () => {
  const billing = createBilling(options()); cleanup.push(() => billing.close());
  const origin = await listen(createServer(async (req, res) => { if (!await billing.handle(req, res, new URL(req.url!, "https://dashboard.example.test"))) { res.writeHead(404); res.end(); } }));
  expect((await fetch(`${origin}/v1/billing/catalog`)).status).toBe(200);
  expect((await fetch(`${origin}/v1/billing/quote`, { method: "POST", body: JSON.stringify({ cart: bundle("starter") }) })).status).toBe(200);
  expect((await fetch(`${origin}/v1/billing/overview`)).status).toBe(503);
  const env = { DUSK_BILLING_PROVIDER: "dodo", DUSK_DODO_API_KEY: "fixture-key", DUSK_DODO_WEBHOOK_SECRET: `whsec_${Buffer.alloc(32).toString("base64")}`, DUSK_DODO_PRODUCTS: JSON.stringify({ "license_solo:month": "fixture-product" }) };
  for (const key of ["DUSK_DODO_API_KEY", "DUSK_DODO_WEBHOOK_SECRET", "DUSK_DODO_PRODUCTS"] as const) expect(() => createBilling(options({ env: { ...env, [key]: undefined } }))).toThrow(key);
  const dodo = createBilling(options({ env })); cleanup.push(() => dodo.close());
  expect(dodo.fake).toBeNull();
  const dodoOrigin = await listen(createServer(async (req, res) => { if (!await dodo.handle(req, res, new URL(req.url!, "https://dashboard.example.test"))) { res.writeHead(404); res.end(); } }));
  expect((await fetch(`${dodoOrigin}/v1/billing/fake/complete`, { method: "POST", body: "{}" })).status).toBe(404);
  for (const key of ["DUSK_HETZNER_TOKEN", "DUSK_CLOUD_SEAL_KEY", "DUSK_CLOUD_HOME_IMAGE"] as const) {
    const cloudEnv = { DUSK_CLOUD_PROVIDER: "hetzner", DUSK_HETZNER_TOKEN: "fixture-token", DUSK_CLOUD_SEAL_KEY: Buffer.alloc(32, 1).toString("base64url"), DUSK_CLOUD_HOME_IMAGE: "ghcr.io/example/home:fixture", [key]: undefined };
    expect(() => createBilling(options({ env: cloudEnv }))).toThrow(key);
  }
  const noClouds = createBilling(options({ env: { DUSK_BILLING_PROVIDER: "fake" } })); cleanup.push(() => noClouds.close());
  const checkout = await noClouds.service.checkout({ id: "a", email: "a@example.test" }, { kind: "cart", cart: { ...BILLING_CONFIG.bundles[1].cart, interval: "month" } });
  for (const delivery of noClouds.fake!.complete([...noClouds.fake!.sessions.keys()][0])) noClouds.service.handleWebhook(delivery.headers, delivery.body);
  await noClouds.clouds.reconcile(); expect(noClouds.clouds.get(checkout.cloudId!)!).toMatchObject({ status: "provisioning", error: "Cloud desktops are not configured." });
});

it("never mounts fake completion at a public origin even when fake mode is explicitly configured", async () => {
  const billing = createBilling(options({ env: { DUSK_BILLING_PROVIDER: "fake" } })); cleanup.push(() => billing.close());
  const origin = await listen(createServer(async (req, res) => { if (!await billing.handle(req, res, new URL(req.url!, "https://dashboard.example.test"))) { res.writeHead(404); res.end(); } }));
  expect((await fetch(`${origin}/v1/billing/fake/complete`, { method: "POST", body: "{}" })).status).toBe(404);
});

it("refuses deletion with both billing blockers before changing the account or billing", async () => {
  const f = await fixture(), owner = await f.login();
  const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: bundle("starter"), name: "My desktop" }, owner.cookie);
  await f.complete(checkout.checkoutId); await f.reconcile();
  const before = f.saved(), clouds = readFileSync(join(f.dir, "clouds.json"), "utf8");
  const response = await f.page("/v1/account/delete", { email: owner.account.email }, owner.cookie);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Cancel your plan and cloud desktops before deleting your account.", code: "billing_active", blockers: [
    { kind: "subscription", id: before.subscriptions[0].id, label: BILLING_CONFIG.bundles.find(b => b.id === "starter")!.label, status: "active" },
    { kind: "cloud_desktop", id: checkout.cloudId, label: "My desktop", status: "running" },
  ] });
  expect(f.app.auth.account(owner.account.id)).not.toBeNull();
  expect((await f.page("/v1/me", undefined, owner.cookie)).status).toBe(200);
  f.setTime(f.now() + 31_000);
  expect((await f.login()).account.id).toBe(owner.account.id);
  expect(f.saved()).toEqual(before); expect(readFileSync(join(f.dir, "clouds.json"), "utf8")).toBe(clouds);
  expect(f.billing.fake!.cancelCalls).toEqual([]);
});

it("closes billing, revokes licenses and scrubs personal records while retaining invoices", async () => {
  const f = await fixture(), owner = await f.login();
  const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: bundle("pro"), name: owner.account.email }, owner.cookie);
  await f.complete(checkout.checkoutId); await f.reconcile();
  f.billing.service.feedback(owner.account, { cloudId: checkout.cloudId, survey: { answer: "other", expected: owner.account.email, improve: owner.account.id } });
  const other = await f.login("other@example.test");
  const team = await f.billing.service.checkout(other.account, { kind: "cart", cart: { ...BILLING_CONFIG.bundles.find(b => b.id === "team")!.cart, interval: "month" } });
  await f.complete(team.checkoutId);
  const otherLicense = f.billing.service.licenses(other.account.id)[0];
  f.billing.service.addMember(other.account, otherLicense.id, owner.account.email);
  f.billing.service.licenseCheck(owner.account);
  const before = f.saved(), sub = before.subscriptions[0];
  await f.answer("/v1/account/delete", { email: owner.account.email, cancelBilling: true }, owner.cookie);
  expect(f.app.auth.account(owner.account.id)).toBeNull();
  expect((await f.page("/v1/me", undefined, owner.cookie)).status).toBe(401);
  const saved = f.saved(), closure = saved.closures![0];
  expect(closure.anonId).toMatch(/^anon_[A-Za-z0-9_-]{22}$/);
  expect(closure.accountId).toBe(closure.anonId); expect(closure.completedAt).toBe(f.now());
  expect(f.billing.fake!.cancelCalls).toEqual([{ subscriptionId: sub.providerSubscriptionId, cancel: true }]);
  expect(f.billing.clouds.get(checkout.cloudId!)).toMatchObject({ accountId: closure.anonId, name: "Deleted", destroyAt: sub.currentPeriodEnd! + 7 * 86_400_000 });
  expect(saved.licenses[0]).toMatchObject({ ownerAccountId: closure.anonId, status: "expired", validUntil: f.now() });
  expect(saved.licenses[1].members).toHaveLength(1);
  expect(saved.invoices[0]).toMatchObject({ accountId: closure.anonId, amountCents: quote(bundle("pro")).totalCents, currency: "USD", status: "paid" });
  for (const name of ["billing.json", "clouds.json"]) {
    const content = readFileSync(join(f.dir, name), "utf8"); expect(content).not.toContain(owner.account.email); expect(content).not.toContain(owner.account.id);
  }
  f.billing.accountDeleted(owner.account.id); expect(f.saved()).toEqual(saved);
});

it("destroys desktops on reconcile when immediate destruction was requested", async () => {
  const f = await fixture(), owner = await f.login();
  const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: bundle("starter") }, owner.cookie);
  await f.complete(checkout.checkoutId); await f.reconcile();
  await f.answer("/v1/account/delete", { email: owner.account.email, cancelBilling: true, destroyDesktopsNow: true }, owner.cookie);
  await f.billing.clouds.reconcile();
  expect(f.billing.clouds.get(checkout.cloudId!)?.status).toBe("destroyed");
});

it("keeps the account on provider failure and resumes without cancelling completed subscriptions twice", async () => {
  const f = await fixture(), owner = await f.login();
  for (let n = 0; n < 2; n++) {
    const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: { ...bundle("starter"), license: { kind: "none" } } }, owner.cookie);
    await f.complete(checkout.checkoutId);
  }
  const original = f.billing.fake!.cancelAtPeriodEnd.bind(f.billing.fake);
  const cancel = vi.spyOn(f.billing.fake!, "cancelAtPeriodEnd").mockImplementationOnce(original).mockRejectedValueOnce(new Error("provider unavailable"));
  const response = await f.page("/v1/account/delete", { email: owner.account.email, cancelBilling: true }, owner.cookie);
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "unavailable" });
  expect(f.app.auth.account(owner.account.id)).not.toBeNull();
  expect((await f.page("/v1/me", undefined, owner.cookie)).status).toBe(200);
  expect(f.saved().closures![0].completedAt).toBeNull();
  await f.answer("/v1/account/delete", { email: owner.account.email, cancelBilling: true }, owner.cookie);
  expect(cancel).toHaveBeenCalledTimes(3);
  expect(f.billing.fake!.cancelCalls).toEqual(f.saved().subscriptions.map(sub => ({ subscriptionId: sub.providerSubscriptionId, cancel: true })));
  expect(f.app.auth.account(owner.account.id)).toBeNull();
});

it("records late renewal payments anonymously without reviving a closed account", async () => {
  const f = await fixture(), owner = await f.login();
  const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: bundle("pro") }, owner.cookie);
  await f.complete(checkout.checkoutId); await f.reconcile();
  const sub = f.saved().subscriptions[0];
  await f.answer("/v1/account/delete", { email: owner.account.email, cancelBilling: true }, owner.cookie);
  const destroyAt = f.billing.clouds.get(checkout.cloudId!)!.destroyAt;
  const deliveries = f.billing.fake!.renew(sub.providerSubscriptionId!);
  for (const event of deliveries) { await f.deliver(event); await f.deliver(event); }
  await f.billing.service.drainProviderCancels();
  const saved = f.saved(), anonId = saved.closures![0].anonId;
  expect(saved.invoices).toHaveLength(2); expect(saved.invoices.every(invoice => invoice.accountId === anonId)).toBe(true);
  expect(saved.subscriptions[0]).toMatchObject({ status: "ended", cancelAtPeriodEnd: true });
  expect(saved.licenses).toHaveLength(1); expect(saved.licenses[0].status).toBe("expired");
  expect(f.billing.clouds.get(checkout.cloudId!)!.destroyAt).toBe(destroyAt);
  expect(f.billing.clouds.list(anonId, true)).toHaveLength(1);
});

it("abandons checkout desktops and queues renewal-off for payments received after deletion", async () => {
  const f = await fixture(), owner = await f.login();
  const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: bundle("starter") }, owner.cookie);
  const session = f.saved().checkouts[0].providerSessionId!;
  await f.answer("/v1/account/delete", { email: owner.account.email }, owner.cookie);
  expect(f.billing.clouds.get(checkout.cloudId!)!.status).toBe("destroyed");
  const deliveries = f.billing.fake!.complete(session);
  const cancel = vi.spyOn(f.billing.fake!, "cancelAtPeriodEnd").mockRejectedValueOnce(new Error("offline"));
  await f.deliver(deliveries[0]);
  expect(f.saved().providerCancels![0].completedAt).toBeNull();
  await f.deliver(deliveries[1]); await f.billing.service.drainProviderCancels();
  for (const event of deliveries) await f.deliver(event);
  const saved = f.saved(), anonId = saved.closures![0].anonId;
  expect(saved.invoices).toHaveLength(1); expect(saved.invoices[0]).toMatchObject({ accountId: anonId, amountCents: quote(bundle("starter")).totalCents });
  expect(saved.subscriptions[0]).toMatchObject({ status: "ended", accountId: anonId });
  expect(saved.providerCancels![0].completedAt).toBe(f.now()); expect(cancel).toHaveBeenCalledTimes(2);
  expect(saved.licenses).toEqual([]); expect(f.billing.clouds.list(anonId, true)).toHaveLength(1);
  expect(f.billing.clouds.get(checkout.cloudId!)!.status).toBe("destroyed"); expect(f.billing.fakePool!.calls).toEqual([]);
});

it("deletes accounts with no billing and recovers a crash between account deletion and scrubbing", async () => {
  const f = await fixture(), owner = await f.login();
  const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: bundle("starter") }, owner.cookie);
  await f.complete(checkout.checkoutId);
  vi.spyOn(f.billing, "accountDeleted").mockImplementationOnce(() => { throw new Error("simulated crash"); });
  vi.spyOn(console, "error").mockImplementation(() => {});
  await f.answer("/v1/account/delete", { email: owner.account.email, cancelBilling: true }, owner.cookie);
  expect(f.saved().closures![0].accountId).toBe(owner.account.id);
  f.app.close();
  const restarted = createDashboardApp({ dataDir: f.dir, publicUrl: "http://127.0.0.1", mailer: memoryMailer(), staticDir: null, now: f.now });
  cleanup.push(() => restarted.close());
  expect(restarted.auth.account(owner.account.id)).toBeNull();
  expect(f.saved().closures![0].accountId).toBe(f.saved().closures![0].anonId);
  for (const name of ["billing.json", "clouds.json"]) expect(readFileSync(join(f.dir, name), "utf8")).not.toContain(owner.account.id);
  const empty = await fixture(), free = await empty.login();
  await empty.answer("/v1/account/delete", { email: free.account.email }, free.cookie);
  expect(empty.app.auth.account(free.account.id)).toBeNull(); expect(empty.saved().closures![0].steps).toContain("scrubbed");
});

it("shows the operator's checkout funnel only with DUSK_OPS_TOKEN, and refuses a short token at startup", async () => {
  const token = "ops-fixture-token-0123456789abcdef";
  expect(() => createBilling(options({ env: { DUSK_OPS_TOKEN: "short" } }))).toThrow("DUSK_OPS_TOKEN");
  for (const env of [{}, { DUSK_OPS_TOKEN: token }]) {
    const billing = createBilling(options({ env })); cleanup.push(() => billing.close());
    const origin = await listen(createServer(async (req, res) => { if (!await billing.handle(req, res, new URL(req.url!, "https://dashboard.example.test"))) { res.writeHead(404); res.end(); } }));
    const read = (auth?: string, query = "") => fetch(`${origin}/v1/billing/ops/funnel${query}`, auth ? { headers: { authorization: auth } } : {});
    expect((await read()).status).toBe(404);
    expect((await read(`Bearer ${token}x`)).status).toBe(404);
    if (!("DUSK_OPS_TOKEN" in env)) { expect((await read(`Bearer ${token}`)).status).toBe(404); continue; }
    const answer = await read(`Bearer ${token}`, "?days=7");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ v: 1, rows: [], totals: { started: 0, paid: 0, active: 0 } });
    expect((await read(`Bearer ${token}`, "?days=0")).status).toBe(400);
  }
});
