import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Cart } from "../../../shared/billing-api.ts";
import type { CloudsService, DesktopPlan, OrderInput, StoredCloud } from "../clouds/types.ts";
import { BILLING_CONFIG } from "./plans.ts";
import { quote } from "./pricing.ts";
import { createFakeBillingProvider } from "./fake-provider.ts";
import { createBillingStore } from "./store.ts";
import { createBillingService } from "./service.ts";

const owner = { id: "owner", email: "owner@example.com" }, stranger = { id: "stranger", email: "stranger@example.com" };
const day = 86_400_000;
function fakeClouds() {
  const rows: StoredCloud[] = [];
  function get(id: string) { return rows.find(cloud => cloud.id === id) ?? null; }
  const clouds: CloudsService = {
    order: vi.fn((input: OrderInput) => {
      const cloud: StoredCloud = { ...input, id: input.id ?? `cloud_${rows.length}`, desiredSpec: { ...input.spec }, subscriptionId: null, status: "checkout", setupStep: null, wantPower: "on", serverId: null, ipv4: null, origin: null, bootstrapSecret: "fixture", workspaceId: null, primary: false, hidden: false, paymentProblem: false, suspended: null, destroyAt: null, error: null, attempts: 0, nextAttemptAt: 0, createdAt: 0, updatedAt: 0, powerSince: 0 };
      rows.push(cloud); return cloud;
    }),
    activate: vi.fn((id: string, subscriptionId: string, plan: DesktopPlan) => { Object.assign(get(id)!, plan, { subscriptionId, status: "provisioning" }); }),
    changePlan: vi.fn((id: string, plan: DesktopPlan) => { Object.assign(get(id)!, plan); }),
    setPaymentProblem: vi.fn((id: string, problem: boolean) => { get(id)!.paymentProblem = problem; }),
    scheduleDestroy: vi.fn((id: string, at: number) => { get(id)!.destroyAt = at; }),
    cancelDestroy: vi.fn((id: string) => { get(id)!.destroyAt = null; }),
    end: vi.fn((id: string, destroyAt: number) => { Object.assign(get(id)!, { status: "stopped", destroyAt }); }),
    abandon: vi.fn((id: string) => { get(id)!.status = "destroyed"; }),
    scrubAccount: (accountId, anonId) => { for (const cloud of rows) if (cloud.accountId === accountId) { cloud.accountId = anonId; cloud.name = "Deleted"; } },
    get, owned: (accountId, id) => rows.find(cloud => cloud.id === id && cloud.accountId === accountId) ?? null, byWorkspace: workspaceId => rows.find(cloud => cloud.workspaceId === workspaceId) ?? null,
    list: (accountId, includeHidden = false) => rows.filter(cloud => cloud.accountId === accountId && (includeHidden || !cloud.hidden)),
    view: cloud => ({ id: cloud.id, name: cloud.name, color: cloud.color, kind: cloud.kind, placement: cloud.placement, status: cloud.status, setupStep: cloud.setupStep, region: cloud.region, machine: cloud.spec, botComputers: cloud.botComputers, origin: cloud.origin, workspaceId: cloud.workspaceId, lastReportAt: null, destroyAt: cloud.destroyAt, error: cloud.error, subscriptionId: cloud.subscriptionId, createdAt: cloud.createdAt }),
    rename: (_accountId, id, patch) => Object.assign(get(id)!, patch), suspend: async () => {}, resume: async () => {}, hide: (_accountId, id) => get(id)!, power: async (_accountId, id) => get(id)!,
    pair: async () => ({ origin: "https://fixture.test", code: "fixture", expiresAt: 0 }), reconcile: async () => {}, close() {},
  };
  return clouds;
}

let dataDir: string, time: number;
let store: ReturnType<typeof createBillingStore>, provider: ReturnType<typeof createFakeBillingProvider>, service: ReturnType<typeof createBillingService>, clouds: CloudsService;
let config: typeof BILLING_CONFIG;
const preset = (index: number, interval: Cart["interval"] = "month"): Cart => ({ ...structuredClone(config.bundles[index].cart), interval });
const licensedDesktop = (): Cart => ({ ...preset(1), license: { kind: "solo" } });
const desktopOnly = (): Cart => ({ ...preset(1), license: { kind: "none" } });
function deliver(deliveries: Array<{ headers: Record<string, string>; body: Buffer }>) { return deliveries.map(delivery => service.handleWebhook(delivery.headers, delivery.body)); }
async function buy(cart = licensedDesktop(), account = owner) {
  const answer = await service.checkout(account, { kind: "cart", cart });
  const checkout = store.state.checkouts.find(checkout => checkout.id === answer.checkoutId)!;
  const deliveries = provider.complete(checkout.providerSessionId!); deliver(deliveries);
  return { answer, checkout, deliveries, sub: store.state.subscriptions.find(sub => sub.checkoutId === checkout.id)! };
}
function signed(type: string, data: object, id = `event_${store.state.webhookEvents.length}`) {
  return provider.sign(id, { business_id: "fixture", timestamp: new Date(time).toISOString(), type, data });
}
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "omb-billing-fixture-")); time = Date.UTC(2026, 10, 8); config = structuredClone(BILLING_CONFIG);
  store = createBillingStore(dataDir); provider = createFakeBillingProvider({ now: () => time }); clouds = fakeClouds();
  service = createBillingService({ store, provider, clouds, config, publicUrl: "https://dashboard.test", now: () => time });
});
afterEach(() => { service.close(); rmSync(dataDir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe("billing service isolated fixture", () => {
  it("completes a checkout, persists its license and invoice, and replays without side effects", async () => {
    const { answer, sub, deliveries } = await buy();
    expect(sub).toMatchObject({ status: "active", totalCents: quote(licensedDesktop(), config).totalCents, cloudId: answer.cloudId, version: 1 });
    expect(service.licenses(owner.id)[0]).toMatchObject({ kind: "solo", status: "active", seats: 1, members: [{ email: owner.email, role: "owner", accountId: owner.id }] });
    expect(service.invoices(owner.id).invoices[0]).toMatchObject({ amountCents: quote(licensedDesktop(), config).totalCents, currency: "USD", status: "paid" });
    expect(store.state.invoices[0].subscriptionId).toBe(sub.id);
    expect(clouds.activate).toHaveBeenCalledExactlyOnceWith(answer.cloudId, sub.id, { kind: "shared_s", placement: "pool", spec: { vcpu: 2, ramGb: 4, diskGb: 40 }, botComputers: 2 });
    const before = structuredClone(store.state); expect(deliver(deliveries)).toEqual([{ duplicate: true }, { duplicate: true }]);
    expect(store.state).toEqual(before); expect(clouds.activate).toHaveBeenCalledTimes(1);
    const newId = provider.sign("another_activation", deliveries[1].body); deliver([newId]);
    expect(store.state.subscriptions).toHaveLength(1); expect(clouds.activate).toHaveBeenCalledTimes(1);
    service.close(); store = createBillingStore(dataDir);
    expect(store.state.subscriptions[0].id).toBe(sub.id); expect(statSync(join(dataDir, "billing.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dataDir, "billing.json"), "utf8")).not.toContain(provider.secret);
    expect(service.appState(owner)).toMatchObject({ entitlement: { plan: "pro", tier: "custom", status: "active" } });
  });
  it("records where each checkout started on the checkout and its subscription, and counts the funnel by source", async () => {
    const started = time;
    const paid = await service.checkout(owner, { kind: "cart", cart: desktopOnly() }, { source: "app_routines" });
    const row = store.state.checkouts.find(checkout => checkout.id === paid.checkoutId)!;
    deliver(provider.complete(row.providerSessionId!));
    const sub = store.state.subscriptions.find(item => item.checkoutId === row.id)!;
    expect([row.source, sub.source, sub.status]).toEqual(["app_routines", "app_routines", "active"]);
    const other = { id: "acct_other", email: "other@example.test" };
    await service.checkout(other, { kind: "cart", cart: desktopOnly() }, { source: "dash_billing" });
    await service.checkout({ id: "acct_third", email: "third@example.test" }, { kind: "cart", cart: desktopOnly() }, { source: "something_new" });
    await service.checkout({ id: "acct_fourth", email: "fourth@example.test" }, { kind: "credits", pack: "c10" });
    expect(store.state.checkouts.map(checkout => checkout.source)).toEqual(["app_routines", "dash_billing", "other", null]);
    expect(service.funnel(started, time + 1)).toEqual({ v: 1, from: started, to: time + 1, totals: { started: 4, paid: 1, active: 1 }, rows: [
      { source: "app_routines", started: 1, paid: 1, active: 1 }, { source: "dash_billing", started: 1, paid: 0, active: 0 },
      { source: "other", started: 1, paid: 0, active: 0 }, { source: "unknown", started: 1, paid: 0, active: 0 }] });
    expect(service.funnel(time + 1, time + 2).totals).toEqual({ started: 0, paid: 0, active: 0 });
  });

  it("refuses bad signatures without modifying state and records unknown signed events", () => {
    const delivery = signed("payment.succeeded", { payment_id: "p", total_amount: 1, currency: "USD", metadata: { checkoutId: "unknown" } });
    const before = structuredClone(store.state);
    expect(() => service.handleWebhook({ ...delivery.headers, "webhook-signature": "v1,bad" }, delivery.body)).toThrow(expect.objectContaining({ status: 401, code: "bad_signature" }));
    expect(store.state).toEqual(before); deliver([delivery]); expect(store.state.invoices).toHaveLength(0); expect(store.state.webhookEvents).toHaveLength(1);
    expect(deliver([delivery])).toEqual([{ duplicate: true }]);
  });
  it("credits and refunds once per payment and refund, including differently signed duplicates", async () => {
    await service.checkout(owner, { kind: "credits", pack: "c25" });
    const checkout = store.state.checkouts[0], deliveries = provider.complete(checkout.providerSessionId!); deliver(deliveries); deliver(deliveries);
    expect(service.credits(owner.id).balanceCents).toBe(2500); expect(checkout.status).toBe("completed"); expect(store.state.subscriptions).toHaveLength(0);
    deliver([provider.sign("payment_again", deliveries[0].body)]); expect(service.credits(owner.id).entries).toHaveLength(1);
    const refund = provider.refund(store.state.invoices[0].providerPaymentId); deliver(refund); deliver(refund); deliver([provider.sign("refund_again", refund[0].body)]);
    expect(service.credits(owner.id)).toMatchObject({ balanceCents: 0, entries: expect.arrayContaining([expect.objectContaining({ reason: "refund", deltaCents: -2500 })]) });
    expect(service.credits(owner.id).entries).toHaveLength(2); expect(service.invoices(owner.id).invoices[0].status).toBe("refunded");
    const partial = signed("refund.succeeded", { refund_id: "extra_refund", payment_id: store.state.invoices[0].providerPaymentId, amount: 100, currency: "USD" }); deliver([partial]);
    expect(service.credits(owner.id).balanceCents).toBe(0);
  });
  it("cancels with a trimmed survey, schedules deletion, and keeps the subscription", async () => {
    const { sub } = await buy();
    expect(await service.cancel(owner, sub.id, { answer: "price", expected: "  cheaper  ", improve: "  flexibility " })).toMatchObject({ cancelAtPeriodEnd: true });
    expect(store.state.feedback[0]).toMatchObject({ accountId: owner.id, subscriptionId: sub.id, cloudId: sub.cloudId, answer: "price", expected: "cheaper", improve: "flexibility" });
    expect(clouds.scheduleDestroy).toHaveBeenLastCalledWith(sub.cloudId, sub.currentPeriodEnd! + 7 * day);
    expect(provider.cancelCalls[0]).toEqual({ subscriptionId: sub.providerSubscriptionId, cancel: true });
    await service.keep(owner, sub.id); expect(sub.cancelAtPeriodEnd).toBe(false); expect(clouds.cancelDestroy).toHaveBeenLastCalledWith(sub.cloudId);
    expect(provider.cancelCalls.at(-1)?.cancel).toBe(false);
    service.feedback(owner, { cloudId: sub.cloudId, survey: { answer: "later" } }); expect(store.state.feedback).toHaveLength(2);
    await expect(service.cancel(owner, sub.id, { answer: "other", improve: "x".repeat(2001) })).rejects.toMatchObject({ code: "invalid_request" });
    expect(() => service.feedback(stranger, { cloudId: sub.cloudId, survey: { answer: "later" } })).toThrow(expect.objectContaining({ code: "not_found" }));
  });
  it("previews and applies an upgrade with a single-use confirmation", async () => {
    const { sub } = await buy(); time = (sub.currentPeriodStart! + sub.currentPeriodEnd!) / 2;
    const preview = service.previewChange(owner, sub.id, preset(2));
    expect(preview).toMatchObject({ chargeNowCents: quote(preset(2), config).totalCents - quote(licensedDesktop(), config).totalCents, expiresAt: time + 600_000 }); expect(preview.confirmation).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await service.change(owner, sub.id, preview.confirmation);
    expect(sub).toMatchObject({ totalCents: quote(preset(2), config).totalCents, version: 2, cart: preset(2) });
    expect(clouds.changePlan).toHaveBeenCalledExactlyOnceWith(sub.cloudId, { kind: "shared_m", placement: "pool", spec: { vcpu: 4, ramGb: 8, diskGb: 80 }, botComputers: 5 });
    await expect(service.change(owner, sub.id, preview.confirmation)).rejects.toMatchObject({ code: "confirmation_required" });
    expect(() => service.previewChange(owner, sub.id, preset(2))).toThrow(expect.objectContaining({ code: "already_on_plan" }));
    expect(() => service.previewChange(owner, sub.id, preset(3))).toThrow(expect.objectContaining({ code: "plan_change_unavailable" }));
    expect(() => service.previewChange(owner, sub.id, preset(2, "year"))).toThrow(expect.objectContaining({ code: "plan_change_unavailable" }));
  });
  it("expires and binds confirmations, detects price changes and preserves the plan on provider failure", async () => {
    const { sub } = await buy();
    let preview = service.previewChange(owner, sub.id, preset(2)); time += 600_000;
    await expect(service.change(owner, sub.id, preview.confirmation)).rejects.toMatchObject({ code: "confirmation_required" });
    preview = service.previewChange(owner, sub.id, preset(2)); config.desktops.shared_m.monthlyCents! += 100;
    await expect(service.change(owner, sub.id, preview.confirmation)).rejects.toMatchObject({ code: "price_changed" });
    preview = service.previewChange(owner, sub.id, preset(2)); provider.failChangePlan = true;
    await expect(service.change(owner, sub.id, preview.confirmation)).rejects.toMatchObject({ status: 503, code: "unavailable" });
    expect(sub.totalCents).toBe(quote(licensedDesktop(), BILLING_CONFIG).totalCents); expect(clouds.changePlan).not.toHaveBeenCalled();
    await expect(service.change(stranger, sub.id, preview.confirmation)).rejects.toMatchObject({ code: "not_found" });
  });
  it("licenses owners and invited members, binds normalized emails and enforces seats", async () => {
    expect(service.licenseCheck(owner).work).toBe("free_until"); time = config.freeWorkUntil!; expect(service.licenseCheck(owner).work).toBe("unlicensed");
    const { sub } = await buy(preset(3)); expect(service.licenseCheck(owner).work).toBe("licensed");
    service.addMember(owner, sub.licenseId!, "  Friend@Example.com  ");
    expect(() => service.addMember(owner, sub.licenseId!, "full@example.com")).toThrow(expect.objectContaining({ code: "seats_full" }));
    const friend = { id: "friend", email: "friend@example.com" }; expect(service.licenseCheck(friend)).toMatchObject({ work: "licensed", license: { role: "member" } });
    expect(service.licenses(friend.id)[0].members[1].accountId).toBe("friend");
    expect(() => service.removeMember(owner, sub.licenseId!, owner.email)).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(() => service.addMember(friend, sub.licenseId!, "bad@example.com")).toThrow(expect.objectContaining({ code: "not_found" }));
    service.removeMember(owner, sub.licenseId!, friend.email); expect(service.licenseCheck(friend).work).toBe("unlicensed");
  });
  it("keeps paid license grace, renews periods, respects cancellation and expires", async () => {
    const { sub } = await buy(); const until = sub.currentPeriodEnd!;
    deliver(provider.fail(sub.providerSubscriptionId!)); expect(sub.status).toBe("payment_problem"); expect(clouds.setPaymentProblem).toHaveBeenLastCalledWith(sub.cloudId, true);
    expect(service.licenseCheck(owner)).toMatchObject({ work: "licensed", license: { status: "grace", validUntil: until } });
    time = until; expect(service.appState(owner).entitlement).toMatchObject({ status: "inactive", expiresAt: null });
    expect(service.licenseCheck(owner).license).toBeNull();
    await service.cancel(owner, sub.id); const cancelCalls = vi.mocked(clouds.cancelDestroy).mock.calls.length;
    deliver(provider.renew(sub.providerSubscriptionId!)); expect(sub.currentPeriodStart).toBe(until); expect(sub.currentPeriodEnd).toBeGreaterThan(until);
    expect(clouds.cancelDestroy).toHaveBeenCalledTimes(cancelCalls); expect(clouds.setPaymentProblem).toHaveBeenLastCalledWith(sub.cloudId, false);
    deliver(provider.expire(sub.providerSubscriptionId!)); expect(sub.status).toBe("ended"); expect(service.licenses(owner.id)[0].status).toBe("expired");
    expect(clouds.end).toHaveBeenLastCalledWith(sub.cloudId, time + 7 * day); expect(service.appState(owner).primary).toBeNull();
  });
  it("enforces open checkout, license exclusivity, desktop cap, and account rate limits", async () => {
    await service.checkout(owner, { kind: "cart", cart: licensedDesktop() });
    await expect(service.checkout(owner, { kind: "cart", cart: preset(2) })).rejects.toMatchObject({ code: "checkout_open", url: store.state.checkouts[0].url });
    deliver(provider.complete(store.state.checkouts[0].providerSessionId!));
    await expect(service.checkout(owner, { kind: "cart", cart: preset(2) })).rejects.toMatchObject({ code: "already_subscribed" });
    await buy(desktopOnly()); config.maxCloudsPerAccount = 2;
    await expect(service.checkout(owner, { kind: "cart", cart: desktopOnly() })).rejects.toMatchObject({ code: "cap" });
    config.checkoutsPerHour = 2; await expect(service.checkout(owner, { kind: "credits", pack: "c10" })).rejects.toMatchObject({ code: "rate_limited" });
    await expect(service.checkout(stranger, { kind: "cart", cart: preset(0) })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("reserves concurrent checkouts before awaiting the provider and abandons failures", async () => {
    let release: (() => void) | undefined;
    const original = provider.createCheckout;
    vi.spyOn(provider, "createCheckout").mockImplementation(async input => { await new Promise<void>(resolve => { release = resolve; }); return original(input); });
    const pending = service.checkout(owner, { kind: "cart", cart: preset(1) });
    await expect(service.checkout(owner, { kind: "cart", cart: preset(1) })).rejects.toMatchObject({ code: "checkout_open" }); release!(); await pending;
    time += 31 * 60_000; vi.mocked(provider.createCheckout).mockRejectedValue(new Error("provider fixture failure"));
    await expect(service.checkout(owner, { kind: "cart", cart: preset(1) })).rejects.toMatchObject({ code: "unavailable" });
    expect(store.state.checkouts.map(checkout => checkout.status)).toEqual(["expired", "expired"]); expect(clouds.abandon).toHaveBeenCalledTimes(2);
  });
  it("paginates invoices at equal timestamps without skipping or duplicating and protects downloads", async () => {
    const { sub } = await buy(); deliver(provider.renew(sub.providerSubscriptionId!)); deliver(provider.renew(sub.providerSubscriptionId!));
    const first = service.invoices(owner.id, null, 2), second = service.invoices(owner.id, first.nextCursor, 2);
    expect(first.invoices).toHaveLength(2); expect(second.invoices).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.invoices, ...second.invoices].map(invoice => invoice.id)).size).toBe(3);
    expect(first.invoices[0].downloadUrl).toBe(`/v1/billing/invoices/${first.invoices[0].id}/download`);
    expect(await service.invoiceDownload(owner.id, first.invoices[0].id)).toMatchObject({ redirect: expect.stringContaining("https://") });
    await expect(service.invoiceDownload(stranger.id, first.invoices[0].id)).rejects.toMatchObject({ code: "not_found" });
    expect(service.invoices(stranger.id).invoices).toEqual([]); expect(() => service.invoices(owner.id, "bad")).toThrow(expect.objectContaining({ code: "invalid_request" }));
    expect(await service.portal(owner, "/billing")).toMatchObject({ url: expect.stringContaining("test.customer.dodopayments.com") });
    await expect(service.portal(stranger)).rejects.toMatchObject({ code: "not_subscribed" });
    await expect(service.portal(owner, "//evil.test")).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("adds and removes a desktop and updates seats without an unnecessary resize", async () => {
    const licenseOnly: Cart = { ...licensedDesktop(), desktop: { kind: "none" } }; const { sub } = await buy(licenseOnly);
    await service.change(owner, sub.id, service.previewChange(owner, sub.id, licensedDesktop()).confirmation);
    expect(clouds.activate).toHaveBeenCalledTimes(1); const cloudId = sub.cloudId;
    const team: Cart = { ...preset(1), license: { kind: "team", members: 5 } };
    await service.change(owner, sub.id, service.previewChange(owner, sub.id, team).confirmation);
    expect(clouds.changePlan).not.toHaveBeenCalled(); expect(service.licenses(owner.id)[0]).toMatchObject({ kind: "team", seats: 5 });
    await service.change(owner, sub.id, service.previewChange(owner, sub.id, { ...team, desktop: { kind: "none" } }).confirmation);
    // paid to the period's end: it runs until then, and the 7 days start there
    const periodEnd = sub.currentPeriodEnd!; expect(periodEnd).toBeGreaterThan(time);
    expect(clouds.end).toHaveBeenLastCalledWith(cloudId, periodEnd + 7 * day, periodEnd); expect(sub.cloudId).toBeNull();
  });
  it("records failed invoices once and upgrades the same payment on success", async () => {
    await service.checkout(owner, { kind: "credits", pack: "c10" });
    const data = { payment_id: "pay_one", customer: { customer_id: "cus_one" }, metadata: { checkoutId: store.state.checkouts[0].id, accountId: owner.id }, total_amount: 1000, currency: "USD" };
    deliver([signed("payment.failed", data)]); expect(store.state.invoices[0].status).toBe("failed"); expect(service.credits(owner.id).balanceCents).toBe(0);
    deliver([signed("payment.succeeded", data)]); expect(store.state.invoices).toHaveLength(1); expect(store.state.invoices[0].status).toBe("paid"); expect(service.credits(owner.id).balanceCents).toBe(1000);
  });
  it("keeps purchased prices and lines stable when the catalog changes before activation", async () => {
    const answer = await service.checkout(owner, { kind: "cart", cart: preset(1) });
    config.desktops.shared_s.monthlyCents = 2500;
    deliver(provider.complete(store.state.checkouts[0].providerSessionId!));
    const sub = service.subscriptions(owner.id)[0];
    expect(sub.totalCents).toBe(quote(preset(1), BILLING_CONFIG).totalCents); expect(sub.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(quote(preset(1), BILLING_CONFIG).totalCents);
    expect(sub.cloudId).toBe(answer.cloudId);
    service.close(); store = createBillingStore(dataDir);
    service = createBillingService({ store, provider, clouds, config, publicUrl: "https://dashboard.test", now: () => time });
    expect(deliver(provider.complete(store.state.checkouts[0].providerSessionId!))).toEqual([{ duplicate: true }, { duplicate: true }]);
    expect(clouds.activate).toHaveBeenCalledTimes(1);
  });
  it("renews at the changed fake-provider price and streams an owner-only PDF", async () => {
    const { sub } = await buy(); await service.change(owner, sub.id, service.previewChange(owner, sub.id, preset(2)).confirmation);
    deliver(provider.renew(sub.providerSubscriptionId!)); expect(store.state.invoices.at(-1)!.amountCents).toBe(quote(preset(2), config).totalCents);
    service = createBillingService({ store, provider: { ...provider, invoiceUrl: async () => null }, clouds, config, publicUrl: "https://dashboard.test", now: () => time });
    expect(await service.invoiceDownload(owner.id, store.state.invoices[0].id)).toMatchObject({ pdf: { contentType: "application/pdf", body: expect.any(Buffer) } });
  });
  it("serializes license additions across subscriptions of the same account", async () => {
    const first = await buy(desktopOnly()), second = await buy(desktopOnly());
    const a = service.previewChange(owner, first.sub.id, licensedDesktop()), b = service.previewChange(owner, second.sub.id, licensedDesktop());
    const results = await Promise.allSettled([service.change(owner, first.sub.id, a.confirmation), service.change(owner, second.sub.id, b.confirmation)]);
    expect(results[0].status).toBe("fulfilled"); expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "already_subscribed" } });
    expect(provider.changeCalls).toHaveLength(1);
  });
  it("refuses missing product ids in real-provider mode and binds confirmations to subscriptions", async () => {
    const a = await buy(desktopOnly()), b = await buy(desktopOnly());
    const preview = service.previewChange(owner, a.sub.id, { ...desktopOnly(), desktop: { kind: "shared_m", region: "fsn1" } });
    await expect(service.change(owner, b.sub.id, preview.confirmation)).rejects.toMatchObject({ code: "confirmation_required" });
    service = createBillingService({ store, provider: { ...provider, name: "dodo" }, clouds, config, publicUrl: "https://dashboard.test", now: () => time });
    const realPreview = service.previewChange(owner, a.sub.id, preset(2));
    await expect(service.change(owner, a.sub.id, realPreview.confirmation)).rejects.toMatchObject({ code: "unavailable" });
    await expect(service.checkout(stranger, { kind: "cart", cart: preset(1) })).rejects.toMatchObject({ code: "unavailable" });
    expect(provider.changeCalls).toHaveLength(0);
  });
  it("prunes webhook retention and refuses invalid persisted state", () => {
    store.state.webhookEvents = Array.from({ length: 20_000 }, (_, i) => ({ id: `old_${i}`, at: time, type: "ignored" }));
    store.state.webhookEvents.push({ id: "expired", at: time - 31 * day, type: "ignored" });
    deliver([signed("unknown", {})]); expect(store.state.webhookEvents).toHaveLength(20_001); expect(store.state.webhookEvents.some(event => event.id === "expired")).toBe(false);
    writeFileSync(join(dataDir, "billing.json"), JSON.stringify({ ...store.state, invoices: [{ amountCents: 0.5 }] }));
    expect(() => createBillingStore(dataDir)).toThrow("Invalid state");
  });
});

describe("billing security regressions", () => {
  it("binds signed events to account, customer, checkout kind, amount, currency and product", async () => {
    const cart = await service.checkout(owner, { kind: "cart", cart: preset(1) });
    await service.checkout(stranger, { kind: "credits", pack: "c25" });
    const credit = store.state.checkouts[1];
    const payment = { payment_id: "p", subscription_id: null, customer: { customer_id: "cus_stranger" }, metadata: { checkoutId: credit.id, accountId: stranger.id }, total_amount: 2500, currency: "USD" };
    for (const patch of [{ metadata: { ...payment.metadata, accountId: owner.id } }, { subscription_id: "unexpected_subscription" }, { total_amount: 1 }, { currency: "EUR" }]) {
      deliver([signed("payment.succeeded", { ...payment, ...patch })]);
    }
    expect(store.state.credits).toEqual([]); expect(store.state.customers.every(customer => customer.providerCustomerId === null)).toBe(true);
    deliver([signed("payment.succeeded", payment)]);
    deliver([signed("payment.succeeded", { ...payment, payment_id: "another_payment" })]);
    expect(service.credits(stranger.id).balanceCents).toBe(2500);
    const activation = JSON.parse(provider.complete(store.state.checkouts[0].providerSessionId!)[1].body.toString());
    deliver([signed("subscription.active", { ...activation.data, metadata: { checkoutId: cart.checkoutId, accountId: stranger.id } })]);
    deliver([signed("subscription.active", { ...activation.data, product_id: "wrong_product" })]);
    deliver([signed("subscription.active", { ...activation.data, customer: payment.customer })]);
    expect(store.state.subscriptions).toEqual([]); expect(clouds.activate).not.toHaveBeenCalled();
    deliver([signed("subscription.active", activation.data)]); expect(store.state.subscriptions).toHaveLength(1);
  });

  it("does not associate a different subscription with a checkout already bound by its payment", async () => {
    await service.checkout(owner, { kind: "cart", cart: preset(1) });
    const deliveries = provider.complete(store.state.checkouts[0].providerSessionId!); deliver([deliveries[0]]);
    const activation = JSON.parse(deliveries[1].body.toString());
    deliver([signed("subscription.active", { ...activation.data, subscription_id: "other_subscription" })]);
    expect(store.state.subscriptions).toEqual([]);
    deliver([deliveries[1]]); expect(store.state.subscriptions).toHaveLength(1);
  });

  it("settles partial, out-of-order and taxed refunds without over-debiting purchased credits", async () => {
    await service.checkout(owner, { kind: "credits", pack: "c10" });
    const checkout = store.state.checkouts[0];
    deliver([signed("refund.succeeded", { refund_id: "r1", payment_id: "p", amount: 600, currency: "USD" })]);
    service.close(); store = createBillingStore(dataDir);
    service = createBillingService({ store, provider, clouds, config, publicUrl: "https://dashboard.test", now: () => time });
    const payment = { payment_id: "p", customer: { customer_id: "cus" }, metadata: { checkoutId: checkout.id, accountId: owner.id }, total_amount: 1200, currency: "USD" };
    deliver([signed("payment.succeeded", payment)]);
    expect(service.credits(owner.id).balanceCents).toBe(500); expect(store.state.invoices[0].status).toBe("paid");
    deliver([signed("refund.succeeded", { refund_id: "wrong_currency", payment_id: "p", amount: 600, currency: "EUR" })]);
    expect(service.credits(owner.id).balanceCents).toBe(500);
    deliver([signed("refund.succeeded", { refund_id: "r2", payment_id: "p", amount: 900, currency: "USD" })]);
    expect(service.credits(owner.id).balanceCents).toBe(0); expect(store.state.invoices[0].status).toBe("refunded");
    deliver([signed("payment.succeeded", payment)]); expect(service.credits(owner.id).balanceCents).toBe(0);
  });

  it("commits the event and cloud intent together and retries partial application after restart", async () => {
    await service.checkout(owner, { kind: "cart", cart: preset(1) });
    const deliveries = provider.complete(store.state.checkouts[0].providerSessionId!); deliver([deliveries[0]]);
    vi.mocked(clouds.setPaymentProblem).mockImplementationOnce(() => { throw new Error("synthetic disk failure"); });
    expect(() => deliver([deliveries[1]])).toThrow(expect.objectContaining({ code: "unavailable" }));
    expect(store.state.subscriptions).toHaveLength(1);
    const subId = store.state.subscriptions[0].id;
    expect(store.state.cloudActions).toHaveLength(2);
    service.close(); store = createBillingStore(dataDir);
    service = createBillingService({ store, provider, clouds, config, publicUrl: "https://dashboard.test", now: () => time });
    expect(store.state.cloudActions).toEqual([]); expect(store.state.subscriptions[0].id).toBe(subId);
    expect(deliver([deliveries[1]])).toEqual([{ duplicate: true }]); expect(clouds.activate).toHaveBeenCalledTimes(1);
  });

  it("does not activate a cloud when the billing transaction fails to persist", async () => {
    await service.checkout(owner, { kind: "cart", cart: preset(1) });
    const deliveries = provider.complete(store.state.checkouts[0].providerSessionId!); deliver([deliveries[0]]);
    vi.spyOn(store, "commit").mockImplementationOnce(() => { throw new Error("synthetic full disk"); });
    expect(() => deliver([deliveries[1]])).toThrow(expect.objectContaining({ code: "unavailable" }));
    expect(store.state.subscriptions).toEqual([]); expect(store.state.cloudActions).toEqual([]); expect(clouds.activate).not.toHaveBeenCalled();
    deliver([deliveries[1]]); expect(store.state.subscriptions).toHaveLength(1); expect(clouds.activate).toHaveBeenCalledTimes(1);
  });

  it("keeps unpaid destruction scheduled and refuses stale activation or unpaid plan changes", async () => {
    const { sub, deliveries } = await buy(); time += 1000;
    deliver(provider.fail(sub.providerSubscriptionId!));
    const deadline = sub.currentPeriodEnd! + config.graceDays * day;
    expect(clouds.get(sub.cloudId!)?.destroyAt).toBe(deadline);
    await expect(service.keep(owner, sub.id)).rejects.toMatchObject({ code: "not_subscribed" });
    expect(() => service.previewChange(owner, sub.id, preset(2))).toThrow(expect.objectContaining({ code: "not_subscribed" }));
    deliver([provider.sign("stale_activation", deliveries[1].body)]);
    expect(sub.status).toBe("payment_problem"); expect(clouds.get(sub.cloudId!)?.destroyAt).toBe(deadline);
    const updated = JSON.parse(deliveries[1].body.toString()).data;
    deliver([signed("subscription.updated", { ...updated, next_billing_date: new Date(time + 365 * day).toISOString() })]);
    expect(sub.currentPeriodEnd! + config.graceDays * day).toBe(deadline); expect(clouds.get(sub.cloudId!)?.destroyAt).toBe(deadline);
  });

  it("expires active licenses at the paid boundary even when an expiry webhook is missing", async () => {
    const { sub } = await buy(); time = sub.currentPeriodEnd!;
    expect(service.licenseCheck(owner).license).toBeNull();
    await expect(service.keep(owner, sub.id)).rejects.toMatchObject({ code: "not_subscribed" });
    expect(() => service.invoices(owner.id, "a".repeat(513))).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });
});

describe("durable provider reconciliation", () => {
  it("recovers a plan change when the provider applied it but the response was lost", async () => {
    const { sub } = await buy();
    const change = provider.changePlan;
    vi.spyOn(provider, "changePlan").mockImplementationOnce(async input => { await change(input); throw new Error("synthetic lost response"); });
    const preview = service.previewChange(owner, sub.id, preset(2));
    await expect(service.change(owner, sub.id, preview.confirmation)).rejects.toMatchObject({ code: "unavailable" });
    expect(sub.totalCents).toBe(quote(licensedDesktop(), BILLING_CONFIG).totalCents); expect(sub.pendingChange).toBeDefined();
    expect(() => service.previewChange(owner, sub.id, preset(2))).toThrow(expect.objectContaining({ code: "plan_change_unavailable" }));
    service.close(); store = createBillingStore(dataDir);
    service = createBillingService({ store, provider, clouds, config, publicUrl: "https://dashboard.test", now: () => time });
    deliver(provider.renew(sub.providerSubscriptionId!));
    expect(store.state.subscriptions[0]).toMatchObject({ totalCents: quote(preset(2), config).totalCents, cart: preset(2) });
    expect(store.state.subscriptions[0].pendingChange).toBeUndefined(); expect(provider.changeCalls).toHaveLength(1);
    expect(clouds.changePlan).toHaveBeenCalledTimes(1);
  });

  it("does not revive a subscription when expiry arrives before activation", async () => {
    await service.checkout(owner, { kind: "cart", cart: preset(1) });
    const deliveries = provider.complete(store.state.checkouts[0].providerSessionId!);
    const activation = JSON.parse(deliveries[1].body.toString());
    deliver([signed("subscription.expired", { ...activation.data, status: "expired" })]);
    deliver(deliveries);
    expect(store.state.subscriptions[0].status).toBe("ended"); expect(clouds.activate).not.toHaveBeenCalled();
  });

  it("refreshes fake delivery signatures without changing their idempotency keys", async () => {
    const { checkout } = await buy(); time += 600_000;
    expect(deliver(provider.complete(checkout.providerSessionId!))).toEqual([{ duplicate: true }, { duplicate: true }]);
    expect(store.state.subscriptions).toHaveLength(1);
  });
});

it("waits for a matching signed outcome before granting a Dodo upgrade", async () => {
  const { sub, deliveries } = await buy(); service.close();
  config.products = Object.fromEntries(["license_solo:month", "addon_shared_s:month", "addon_shared_m:month"].map(key => [key, key]));
  service = createBillingService({ store, provider: { ...provider, name: "dodo" }, clouds, config, publicUrl: "https://dashboard.test", now: () => time });
  const end = sub.currentPeriodEnd;
  const result = await service.change(owner, sub.id, service.previewChange(owner, sub.id, preset(2)).confirmation);
  expect(result.totalCents).toBe(quote(licensedDesktop(), BILLING_CONFIG).totalCents); expect(clouds.changePlan).not.toHaveBeenCalled();
  const data = JSON.parse(deliveries[1].body.toString()).data;
  deliver([signed("subscription.plan_changed", data)]);
  expect(sub.pendingChange).toBeDefined(); expect(sub.totalCents).toBe(quote(licensedDesktop(), BILLING_CONFIG).totalCents);
  deliver([signed("subscription.plan_changed", { ...data, addons: [{ addon_id: "addon_shared_m:month", quantity: 1 }] })]);
  expect(sub.pendingChange).toBeUndefined(); expect(sub.totalCents).toBe(quote(preset(2), config).totalCents);
  expect(sub.currentPeriodEnd).toBe(end); expect(clouds.changePlan).toHaveBeenCalledTimes(1);
});

it("fulfills a late paid checkout with one replacement instead of reviving the abandoned cloud", async () => {
  const answer = await service.checkout(owner, { kind: "cart", cart: preset(1) });
  const checkout = store.state.checkouts[0]; time += 31 * 60_000;
  await service.checkout(owner, { kind: "credits", pack: "c10" });
  expect(clouds.get(answer.cloudId!)?.status).toBe("destroyed");
  const deliveries = provider.complete(checkout.providerSessionId!); deliver(deliveries); deliver(deliveries);
  const sub = store.state.subscriptions[0];
  expect(sub.cloudId).not.toBe(answer.cloudId); expect(clouds.get(sub.cloudId!)?.status).toBe("provisioning");
  expect(clouds.get(answer.cloudId!)?.status).toBe("destroyed"); expect(clouds.activate).toHaveBeenCalledTimes(1);
});

it("counts hidden desktops against the account limit", async () => {
  const { sub } = await buy(); clouds.get(sub.cloudId!)!.hidden = true; config.maxCloudsPerAccount = 1;
  expect(clouds.list(owner.id)).toEqual([]);
  await expect(service.checkout(owner, { kind: "cart", cart: desktopOnly() })).rejects.toMatchObject({ code: "cap" });
});

it("does not debit a legacy fully refunded invoice again", async () => {
  await service.checkout(owner, { kind: "credits", pack: "c10" });
  deliver(provider.complete(store.state.checkouts[0].providerSessionId!));
  const invoice = store.state.invoices[0];
  deliver(provider.refund(invoice.providerPaymentId)); delete store.state.refunds; store.commit();
  service.close(); store = createBillingStore(dataDir);
  service = createBillingService({ store, provider, clouds, config, publicUrl: "https://dashboard.test", now: () => time });
  deliver([signed("refund.succeeded", { refund_id: "another", payment_id: invoice.providerPaymentId, amount: 1000, currency: "USD" })]);
  expect(service.credits(owner.id).balanceCents).toBe(0);
});

it("discards a stale resize intent after the desktop has been destroyed", async () => {
  const { sub } = await buy();
  clouds.get(sub.cloudId!)!.status = "destroyed";
  store.state.cloudActions = [{ kind: "change", cloudId: sub.cloudId!, plan: { kind: "shared_m", placement: "pool", spec: { vcpu: 4, ramGb: 8, diskGb: 80 }, botComputers: 5 } }];
  store.commit(); service.close();
  service = createBillingService({ store, provider, clouds, config, publicUrl: "https://dashboard.test", now: () => time });
  expect(clouds.changePlan).not.toHaveBeenCalled(); expect(store.state.cloudActions).toEqual([]);
});
