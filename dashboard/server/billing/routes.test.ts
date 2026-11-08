import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { signedPayload } from "../../../shared/dashboard-protocol.ts";
import type { BillingOverview, Catalog, CheckoutAnswer, CloudDesktopView, InvoicePage, Quote } from "../../../shared/billing-api.ts";
import { createDashboardApp } from "../app.ts";
import { startFakeAdmin } from "../fake-admin.ts";
import { createBilling } from "./index.ts";
import type { BillingOptions } from "./index.ts";
import { BILLING_CONFIG } from "./plans.ts";
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
  for (const key of ["OMB_BILLING_PROVIDER", "OMB_CLOUD_PROVIDER", "OMB_POOL_DRIVER", "OMB_CLOUD_SEAL_KEY", "OMB_DODO_PRODUCTS"]) vi.stubEnv(key, undefined);
  const dir = dataDirectory(), admin = await startFakeAdmin(); cleanup.push(admin.close);
  let time = Date.now();
  const app = createDashboardApp({ dataDir: dir, publicUrl: "http://127.0.0.1", accountOrigin: admin.url, staticDir: null, now: () => time });
  const billing = vi.mocked(createBilling).mock.results.at(-1)!.value as ReturnType<typeof createBilling>;
  const dashboard = vi.mocked(createBilling).mock.calls.at(-1)![0].dashboard;
  cleanup.push(() => app.close());
  const origin = await listen(createServer(app.handle));
  async function page(path: string, data?: unknown, cookie?: string, method = data === undefined ? "GET" : "POST") {
    return fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), redirect: "manual" });
  }
  async function answer<T>(path: string, data?: unknown, cookie?: string, method?: string) {
    const res = await page(path, data, cookie, method); expect(res.status, `${method ?? "request"} ${path}: ${res.status}`).toBe(200); return read<T>(res);
  }
  async function login(email = "owner@example.test") {
    const start = await answer<{ attempt: string }>("/v1/auth/start", { email });
    const res = await page("/v1/auth/verify", { attempt: start.attempt, code: admin.codes.get(email) }); expect(res.status).toBe(200);
    const { account } = await read<{ account: { id: string; email: string } }>(res);
    return { cookie: res.headers.get("set-cookie")!.split(";")[0], account };
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
  return { dir, dashboard, billing, origin, page, answer, login, saved, complete, deliver, reconcile, setTime: (at: number) => { time = at; }, now: () => time };
}
const bundle = (id: string) => ({ ...structuredClone(BILLING_CONFIG.bundles.find(b => b.id === id)!.cart), interval: "month" });

it("runs the dashboard billing lifecycle over HTTP, including signed workspace reports and webhook replays", async () => {
  const f = await fixture(), { cookie, account } = await f.login();
  const catalog = await f.answer<Catalog>("/v1/billing/catalog"); expect(catalog.bundles.map(b => b.id)).toEqual(["free", "starter", "pro", "team"]);
  const builder = { interval: "year", license: { kind: "solo" }, desktop: { kind: "dedicated", region: "fsn1", spec: { vcpu: 12, ramGb: 24, diskGb: 240 } } };
  expect(await f.answer<Quote>("/v1/billing/quote", { cart: builder })).toMatchObject({ bundle: null, machine: builder.desktop.spec, totalCents: 90240 });
  const team = { ...bundle("team"), license: { kind: "team", members: 6 } };
  const teamQuote = await f.answer<Quote>("/v1/billing/quote", { cart: team });
  expect(teamQuote.members).toBe(6); expect(teamQuote.lines.find(l => l.kind === "members")?.amountCents).toBe(4500);
  const checkout = await f.answer<CheckoutAnswer>("/v1/billing/checkout", { kind: "cart", cart: bundle("starter") }, cookie);
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
  const wrongType = await fetch(`${f.origin}/v1/billing/checkout`, { method: "POST", headers: { cookie, "content-type": "text/plain" }, body: "{}" }); expect(wrongType.status).toBe(403);
  const foreignOrigin = await fetch(`${f.origin}/v1/billing/checkout`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: "https://foreign.test" }, body: "{}" }); expect(foreignOrigin.status).toBe(403);
  expect((await f.page("/v1/billing/overview")).status).toBe(401);
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
  const env = { OMB_BILLING_PROVIDER: "dodo", OMB_DODO_API_KEY: "fixture-key", OMB_DODO_WEBHOOK_SECRET: `whsec_${Buffer.alloc(32).toString("base64")}`, OMB_DODO_PRODUCTS: JSON.stringify({ "license_solo:month": "fixture-product" }) };
  for (const key of ["OMB_DODO_API_KEY", "OMB_DODO_WEBHOOK_SECRET", "OMB_DODO_PRODUCTS"] as const) expect(() => createBilling(options({ env: { ...env, [key]: undefined } }))).toThrow(key);
  const dodo = createBilling(options({ env })); cleanup.push(() => dodo.close());
  expect(dodo.fake).toBeNull();
  const dodoOrigin = await listen(createServer(async (req, res) => { if (!await dodo.handle(req, res, new URL(req.url!, "https://dashboard.example.test"))) { res.writeHead(404); res.end(); } }));
  expect((await fetch(`${dodoOrigin}/v1/billing/fake/complete`, { method: "POST", body: "{}" })).status).toBe(404);
  for (const key of ["OMB_HETZNER_TOKEN", "OMB_CLOUD_SEAL_KEY", "OMB_CLOUD_HOME_IMAGE"] as const) {
    const cloudEnv = { OMB_CLOUD_PROVIDER: "hetzner", OMB_HETZNER_TOKEN: "fixture-token", OMB_CLOUD_SEAL_KEY: Buffer.alloc(32, 1).toString("base64url"), OMB_CLOUD_HOME_IMAGE: "ghcr.io/example/home:fixture", [key]: undefined };
    expect(() => createBilling(options({ env: cloudEnv }))).toThrow(key);
  }
  const noClouds = createBilling(options({ env: { OMB_BILLING_PROVIDER: "fake" } })); cleanup.push(() => noClouds.close());
  const checkout = await noClouds.service.checkout({ id: "a", email: "a@example.test" }, { kind: "cart", cart: { ...BILLING_CONFIG.bundles[1].cart, interval: "month" } });
  for (const delivery of noClouds.fake!.complete([...noClouds.fake!.sessions.keys()][0])) noClouds.service.handleWebhook(delivery.headers, delivery.body);
  await noClouds.clouds.reconcile(); expect(noClouds.clouds.get(checkout.cloudId!)!).toMatchObject({ status: "provisioning", error: "Cloud desktops are not configured." });
});

it("never mounts fake completion at a public origin even when fake mode is explicitly configured", async () => {
  const billing = createBilling(options({ env: { OMB_BILLING_PROVIDER: "fake" } })); cleanup.push(() => billing.close());
  const origin = await listen(createServer(async (req, res) => { if (!await billing.handle(req, res, new URL(req.url!, "https://dashboard.example.test"))) { res.writeHead(404); res.end(); } }));
  expect((await fetch(`${origin}/v1/billing/fake/complete`, { method: "POST", body: "{}" })).status).toBe(404);
});
