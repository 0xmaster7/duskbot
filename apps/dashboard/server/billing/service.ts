import { createHash, randomBytes } from "node:crypto";
import { CANCEL_ANSWERS, CLOUD_SWATCHES, checkoutSource } from "../../../../shared/billing-api.ts";
import type { FunnelRow, FunnelView, DeletionBlocker, BillingErrorCode, BillingOverview, CancelSurvey, Cart, ChangePreview, CheckoutAnswer, CheckoutItem, CreditsView, InvoicePage, LicenseCheck, LicenseView, SubscriptionView } from "../../../../shared/billing-api.ts";
import type { CloudsService, DesktopPlan, StoredCloud } from "../clouds/types.ts";
import { BILLING_CONFIG, catalogView } from "./plans.ts";
import type { BillingConfig } from "./plans.ts";
import { changeCharge, dodoCart, dodoCreditsCart, parseCart, quote, sameCart } from "./pricing.ts";
import type { BillingStore, CloudAction, PendingChange, StoredCheckout, StoredSubscription } from "./store.ts";
import { BillingProviderError } from "./types.ts";
import type { AccountRef, BillingEvent, BillingProvider } from "./types.ts";
import type { WebhookHeaders } from "./webhook-signature.ts";

export class BillingError extends Error {
  status: number; code: BillingErrorCode; url?: string | null; blockers?: DeletionBlocker[];
  constructor(status: number, code: BillingErrorCode, url?: string | null) { super(code); this.status = status; this.code = code; if (url !== undefined) this.url = url; }
}
export interface BillingServiceOptions {
  store: BillingStore; provider: BillingProvider; clouds: CloudsService; config?: BillingConfig; publicUrl: string; now?: () => number; random?: (bytes: number) => string;
  /** told after a change is stored: an email goes out for each; never throws into billing */
  notify?: (notice: BillingNotice) => void;
}
export type BillingNotice =
  | { kind: "receipt"; accountId: string; invoiceId: string; amountCents: number; currency: string; description: string; paidAt: number;
      periodStart: number | null; periodEnd: number | null; renews: boolean; first: boolean; cloudId: string | null; revived: boolean }
  | { kind: "payment_failed"; accountId: string; amountCents: number; currency: string; description: string; cloudId: string | null; fixBy: number | null }
  | { kind: "cancelled"; accountId: string; description: string; cloudId: string | null; endsAt: number | null; graceDays: number };
const day = 86_400_000;
/** an open-ended comp's period end: far enough out that every entitlement check reads it as current */
export const OPEN_ENDED_AT = Date.UTC(2100, 0, 1);
/** a plan the operator gave rather than sold: its own checkout source, and what its one payment records */
export interface OperatorGrant { source: "ops_grant" | "admin_comp"; amountCents?: number }
const emailOf = (email: string) => email.trim().toLowerCase();
function fail(status: number, code: BillingErrorCode): never { throw new BillingError(status, code); }
function serviceError(error: unknown): never { if (error instanceof BillingError) throw error; throw new BillingError(503, "unavailable"); }
function guarded<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args) => { try { const result = fn(...args); return result instanceof Promise ? result.catch(serviceError) as R : result; } catch (error) { return serviceError(error); } };
}
function surveyOf(input: unknown): CancelSurvey {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "invalid_request");
  const value = input as Record<string, unknown>;
  if (!CANCEL_ANSWERS.includes(value.answer as CancelSurvey["answer"]) || Object.keys(value).some(key => !["answer", "expected", "improve"].includes(key))) fail(400, "invalid_request");
  const survey: CancelSurvey = { answer: value.answer as CancelSurvey["answer"] };
  for (const key of ["expected", "improve"] as const) if (value[key] !== undefined) {
    if (typeof value[key] !== "string" || value[key].trim().length > 2000) fail(400, "invalid_request");
    survey[key] = value[key].trim();
  }
  return survey;
}

export function createBillingService(options: BillingServiceOptions) {
  const { store, provider, clouds } = options, state = store.state, config = options.config ?? BILLING_CONFIG;
  const now = options.now ?? Date.now, random = options.random ?? (bytes => randomBytes(bytes).toString("base64url"));
  const publicUrl = guarded(() => new URL(options.publicUrl).origin)();
  state.cloudActions ??= []; state.refunds ??= []; state.closures ??= []; state.providerCancels ??= []; state.duplicates ??= [];
  const confirmations = new Map<string, { accountId: string; subscriptionId: string; cart: Cart; total: number; expiresAt: number; version: number }>();
  const queues = new Map<string, Promise<unknown>>();
  const id = (prefix: string) => `${prefix}_${random(16)}`;
  const copy = <T>(value: T): T => structuredClone(value);
  let notices: BillingNotice[] = [];
  function sendNotices() {
    const due = notices; notices = [];
    for (const notice of due) try { options.notify?.(notice); } catch { console.warn("billing: a notice failed"); }
  }
  const planLabel = (sub: StoredSubscription) => config.bundles.find(bundle => bundle.id === quote(sub.cart, config).bundle)?.label ?? "Custom plan";
  const cancelledNotice = (sub: StoredSubscription): BillingNotice =>
    ({ kind: "cancelled", accountId: sub.accountId, description: planLabel(sub), cloudId: sub.cloudId, endsAt: sub.currentPeriodEnd, graceDays: config.graceDays });
  // retain webhook ownership binding without retaining the deleted account id.
  const closureId = (accountId: string) => `closure_${createHash("sha256").update(accountId).digest("hex")}`;
  function closureFor(accountId: string) {
    return state.closures!.find(entry => entry.accountId === accountId || entry.anonId === accountId || entry.id === closureId(accountId));
  }
  function ensureClosure(accountId: string, destroyDesktopsNow = false) {
    let closure = closureFor(accountId);
    if (!closure) {
      closure = { id: closureId(accountId), accountId, anonId: id("anon"), startedAt: now(), completedAt: null, destroyDesktopsNow, steps: [] };
      state.closures!.push(closure); store.commit();
    }
    return closure;
  }
  function deletionBlockers(accountId: string): DeletionBlocker[] {
    return [
      ...state.subscriptions.filter(sub => sub.accountId === accountId && ["active", "payment_problem"].includes(sub.status)).map(sub => ({
        kind: "subscription" as const, id: sub.id, label: config.bundles.find(bundle => bundle.id === quote(sub.cart, config).bundle)?.label ?? "Custom plan", status: sub.status,
      })),
      ...clouds.list(accountId, true).filter(cloud => !["checkout", "destroyed"].includes(cloud.status)).map(cloud => ({ kind: "cloud_desktop" as const, id: cloud.id, label: cloud.name, status: clouds.view(cloud).status })),
    ];
  }
  function closeAccount(account: AccountRef, input: { destroyDesktopsNow: boolean }) {
    return serialized(account.id, async () => {
      const closure = ensureClosure(account.id, input.destroyDesktopsNow);
      if (closure.completedAt !== null) return;
      async function step(name: string, fn: () => void | Promise<void>) {
        if (closure.steps.includes(name)) return;
        await fn(); closure.steps.push(name); store.commit();
      }
      await step("checkouts", () => {
        for (const checkout of state.checkouts) if (checkout.accountId === account.id && checkout.status === "open") {
          if (checkout.cloudId) clouds.abandon(checkout.cloudId);
          checkout.status = "expired";
        }
      });
      for (const sub of state.subscriptions.filter(sub => sub.accountId === account.id && sub.status !== "ended" && sub.providerSubscriptionId)) {
        await step(`cancel:${sub.id}`, async () => {
          await provider.cancelAtPeriodEnd(sub.providerSubscriptionId!, true);
          sub.cancelAtPeriodEnd = true; sub.updatedAt = now(); sub.version++;
        });
      }
      await step("desktops", () => {
        for (const cloud of clouds.list(account.id, true)) if (cloud.status !== "destroyed") {
          if (cloud.status === "checkout") { clouds.abandon(cloud.id); continue; }
          const sub = state.subscriptions.find(sub => sub.id === cloud.subscriptionId);
          if (closure.destroyDesktopsNow) clouds.end(cloud.id, closure.startedAt + config.graceDays * day);
          else clouds.scheduleDestroy(cloud.id, (sub?.currentPeriodEnd ?? closure.startedAt) + config.graceDays * day);
        }
      });
      await step("licenses", () => {
        for (const license of state.licenses) {
          if (license.ownerAccountId === account.id) { license.status = "expired"; license.validUntil = closure.startedAt; }
          else license.members = license.members.filter(member => member.accountId !== account.id && emailOf(member.email) !== emailOf(account.email));
        }
      });
      closure.completedAt = now(); store.commit();
    });
  }
  function accountDeleted(accountId: string) {
    const closure = ensureClosure(accountId);
    if (closure.steps.includes("scrubbed")) return;
    const original = closure.accountId, anonId = closure.anonId;
    const emails = new Set([...state.customers, ...state.checkouts].filter(row => row.accountId === original).map(row => emailOf(row.email)).filter(Boolean));
    clouds.scrubAccount(original, anonId);
    for (const rows of [state.customers, state.checkouts, state.subscriptions, state.invoices, state.credits, state.feedback]) {
      for (const row of rows) if (row.accountId === original) row.accountId = anonId;
    }
    for (const row of state.customers) if (row.accountId === anonId) row.email = "";
    for (const row of state.checkouts) if (row.accountId === anonId) { row.email = ""; row.source = null; row.url = null; }
    for (const row of state.feedback) if (row.accountId === anonId) { delete row.expected; delete row.improve; }
    for (const license of state.licenses) {
      if (license.ownerAccountId === original) { license.ownerAccountId = anonId; license.status = "expired"; license.validUntil = closure.startedAt; }
      for (const member of license.members) if (member.accountId === original || emails.has(emailOf(member.email))) { member.accountId = anonId; member.email = ""; }
    }
    for (const row of state.duplicates ?? []) if (row.accountId === original) row.accountId = anonId;
    for (const action of state.cloudActions ?? []) if (action.kind === "order" && action.input.accountId === original) { action.input.accountId = anonId; action.input.name = "Deleted"; }
    closure.accountId = anonId; closure.completedAt ??= now(); closure.steps.push("scrubbed"); store.commit();
  }
  function scrubDeleted(exists: (accountId: string) => boolean) {
    for (const closure of state.closures!) if (!closure.steps.includes("scrubbed") && !exists(closure.accountId)) accountDeleted(closure.accountId);
  }
  function queueProviderCancel(subscriptionId: string) {
    if (!state.providerCancels!.some(entry => entry.id === subscriptionId)) state.providerCancels!.push({ id: subscriptionId, completedAt: null });
  }
  /** a refusal (already cancelled or refunded, say) never blocks the queue: the operator is told instead */
  async function settledAtProvider(call: () => Promise<void>, what: string) {
    try { await call(); }
    catch (error) {
      if (!(error instanceof BillingProviderError) || error.code !== "refused") throw error;
      console.warn(`billing: ALERT the provider refused a duplicate subscription's ${what}; check it by hand`);
    }
  }
  let draining: Promise<void> | null = null;
  function drainProviderCancels(): Promise<void> {
    if (draining) return draining;
    draining = Promise.resolve().then(async () => {
      for (const entry of state.providerCancels!) if (entry.completedAt === null) {
        await provider.cancelAtPeriodEnd(entry.id, true);
        entry.completedAt = now(); store.commit();
      }
      for (const entry of state.duplicates!) {
        if (entry.cancelledAt === null) { await settledAtProvider(() => provider.cancelNow(entry.id), "cancel"); entry.cancelledAt = now(); store.commit(); }
        for (const payment of entry.payments) if (payment.refundedAt === null) {
          await settledAtProvider(() => provider.refundPayment(payment.id, "duplicate_subscription"), "refund");
          payment.refundedAt = now(); store.commit();
        }
      }
    }).finally(() => { draining = null; });
    return draining;
  }
  function kickProviderCancels() { void drainProviderCancels().catch(() => {}); }
  function endClosedSubscription(checkout: StoredCheckout, providerId: string) {
    let sub = state.subscriptions.find(sub => sub.providerSubscriptionId === providerId);
    if (!sub && checkout.cart) {
      sub = { id: id("sub"), accountId: checkout.accountId, providerSubscriptionId: providerId, checkoutId: checkout.id, cart: copy(checkout.cart), totalCents: checkout.amountCents, lines: copy(checkout.lines),
        status: "ended", source: checkout.source, licenseId: null, cloudId: checkout.cloudId, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: true, createdAt: now(), updatedAt: now(), version: 0 };
      state.subscriptions.push(sub); checkout.subscriptionId = sub.id;
      for (const invoice of state.invoices) if (invoice.checkoutId === checkout.id && !invoice.subscriptionId) invoice.subscriptionId = sub.id;
    }
    if (sub) { sub.status = "ended"; sub.cancelAtPeriodEnd = true; delete sub.pendingChange; }
    checkout.providerSubscriptionId = providerId;
    queueProviderCancel(providerId);
    return sub;
  }
  function parsed(input: unknown) { const cart = parseCart(input, config); if (!cart) fail(400, "invalid_request"); return cart; }
  function purchasable(cart: Cart) { if (cart.license.kind === "none" && cart.desktop.kind === "none") fail(400, "invalid_request"); }
  function returnUrl(path = "/billing") {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) fail(400, "invalid_request");
    const url = new URL(path, publicUrl); if (url.origin !== publicUrl) fail(400, "invalid_request"); return url.href;
  }
  function products() {
    if (provider.name !== "fake") return config.products;
    return new Proxy(config.products, { get: (target, key) => typeof key === "string" ? target[key] ?? key : undefined });
  }
  function desktopPlan(cart: Cart): DesktopPlan {
    if (cart.desktop.kind === "none") fail(400, "invalid_request");
    const option = config.desktops[cart.desktop.kind];
    return { kind: option.kind, placement: option.placement, spec: copy(cart.desktop.spec ?? option.machine), botComputers: option.botComputers };
  }
  function owned(accountId: string, subscriptionId: string) {
    const sub = state.subscriptions.find(sub => sub.id === subscriptionId && sub.accountId === accountId);
    if (!sub) fail(404, "not_found"); return sub;
  }
  function editable(accountId: string, subscriptionId: string) {
    if (closureFor(accountId)) fail(409, "billing_active");
    const sub = owned(accountId, subscriptionId);
    if (sub.status === "ended" || sub.status === "pending" || !sub.providerSubscriptionId) fail(409, "not_subscribed"); return sub;
  }
  function ownedLicense(account: AccountRef, licenseId: string) {
    if (closureFor(account.id)) fail(409, "billing_active");
    const license = state.licenses.find(license => license.id === licenseId && license.ownerAccountId === account.id);
    if (!license) fail(404, "not_found"); return license;
  }
  function customer(accountId: string, email: string, providerCustomerId: string | null = null) {
    let entry = state.customers.find(customer => customer.accountId === accountId);
    if (!entry) { entry = { accountId, email: emailOf(email), providerCustomerId }; state.customers.push(entry); }
    if (providerCustomerId) entry.providerCustomerId = providerCustomerId;
    return entry;
  }
  function view(sub: StoredSubscription): SubscriptionView {
    return copy({ id: sub.id, cart: sub.cart, bundle: quote(sub.cart, config).bundle, lines: sub.lines, totalCents: sub.totalCents, status: sub.status,
      licenseId: sub.licenseId, cloudId: sub.cloudId, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, createdAt: sub.createdAt });
  }
  function cap(accountId: string) { if (clouds.list(accountId, true).filter(cloud => cloud.status !== "destroyed").length >= config.maxCloudsPerAccount) fail(409, "cap"); }
  /** a live subscription this cart would duplicate: the same plan, or a second work license */
  function duplicateOf(accountId: string, cart: Cart, exceptProviderId: string | null = null) {
    return state.subscriptions.find(sub => sub.accountId === accountId && ["pending", "active", "payment_problem"].includes(sub.status)
      && (exceptProviderId === null || sub.providerSubscriptionId !== exceptProviderId)
      && (sameCart(sub.cart, cart) || cart.license.kind !== "none" && sub.cart.license.kind !== "none")) ?? null;
  }
  /** the newest of this account's ended clouds whose data is still kept, which a new plan of this cart brings back */
  function revivableCloud(accountId: string, cart: Cart) {
    if (cart.desktop.kind === "none") return null;
    const plan = desktopPlan(cart);
    return clouds.list(accountId, true).filter(cloud => cloud.ended && clouds.revivable(cloud.id, plan)
      && !state.subscriptions.some(sub => sub.cloudId === cloud.id && sub.status !== "ended"))
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0] ?? null;
  }
  /** a signed event for a cart checkout of ours whose account already has this plan under another provider subscription */
  function duplicateEvent(event: Extract<BillingEvent, { kind: "subscription" | "payment" }>, checkout: StoredCheckout): event is typeof event & { subscriptionId: string } {
    if (checkout.kind !== "cart" || !checkout.cart || !event.subscriptionId || event.checkoutId !== checkout.id || event.accountId !== checkout.accountId) return false;
    if (state.subscriptions.some(sub => sub.providerSubscriptionId === event.subscriptionId)) return false;
    return state.duplicates!.some(row => row.id === event.subscriptionId) || duplicateOf(checkout.accountId, checkout.cart, event.subscriptionId) !== null;
  }
  function settleDuplicate(checkout: StoredCheckout, providerId: string, input: { paymentId?: string; ended?: boolean } = {}) {
    let entry = state.duplicates!.find(row => row.id === providerId);
    if (!entry) {
      entry = { id: providerId, accountId: checkout.accountId, checkoutId: checkout.id, cancelledAt: input.ended ? now() : null, payments: [] };
      state.duplicates!.push(entry);
      console.warn("billing: ALERT a duplicate subscription is cancelled and refunded");
    }
    for (const invoice of state.invoices) if (invoice.checkoutId === checkout.id && invoice.status === "paid" && !entry.payments.some(row => row.id === invoice.providerPaymentId)) {
      entry.payments.push({ id: invoice.providerPaymentId, refundedAt: null });
    }
    if (input.paymentId && !entry.payments.some(row => row.id === input.paymentId)) entry.payments.push({ id: input.paymentId, refundedAt: null });
    if (checkout.status === "open") checkout.status = "completed";
    if (checkout.cloudId && !checkout.revive && !checkout.subscriptionId) clouds.abandon(checkout.cloudId);
  }
  function licenseAvailable(accountId: string, cart: Cart, except?: string) {
    if (cart.license.kind !== "none" && state.subscriptions.some(sub => sub.accountId === accountId && sub.id !== except && sub.status !== "ended" && sub.cart.license.kind !== "none")) fail(409, "already_subscribed");
  }
  function refreshLicense(sub: StoredSubscription, email: string) {
    let license = state.licenses.find(license => license.id === sub.licenseId);
    if (sub.cart.license.kind === "none") { if (license) license.status = "expired"; sub.licenseId = null; return; }
    const option = config.licenses[sub.cart.license.kind];
    if (!license) {
      license = { id: id("lic"), ownerAccountId: sub.accountId, kind: sub.cart.license.kind, seats: 1, members: [{ email: emailOf(email), accountId: sub.accountId, role: "owner", addedAt: now() }], priority: option.priority, subscriptionId: sub.id, status: "active", validUntil: sub.currentPeriodEnd };
      state.licenses.push(license); sub.licenseId = license.id;
    }
    Object.assign(license, { kind: sub.cart.license.kind, seats: sub.cart.license.kind === "solo" ? 1 : sub.cart.license.members!, priority: option.priority,
      validUntil: sub.currentPeriodEnd, status: sub.status === "ended" ? "expired" : sub.status === "payment_problem" ? "grace" : "active" });
  }
  function period(sub: StoredSubscription, next: number | null) {
    if (next === null || (sub.currentPeriodEnd !== null && next <= sub.currentPeriodEnd)) return;
    if (sub.currentPeriodEnd !== null) sub.currentPeriodStart = sub.currentPeriodEnd;
    else {
      const start = new Date(next), date = start.getUTCDate(); start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() - (sub.cart.interval === "year" ? 12 : 1));
      const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate(); start.setUTCDate(Math.min(date, last)); sub.currentPeriodStart = start.getTime();
    }
    sub.currentPeriodEnd = next;
  }
  function endSubscription(sub: StoredSubscription, email: string) {
    sub.status = "ended"; refreshLicense(sub, email);
    if (sub.cloudId) cloudAction({ kind: "end", cloudId: sub.cloudId, at: now() + config.graceDays * day });
  }
  function ledger(accountId: string, deltaCents: number, reason: "top_up" | "refund", ref: string) {
    if (deltaCents === 0) return;
    if (!state.credits.some(entry => entry.reason === reason && entry.ref === ref)) state.credits.push({ id: id("cr"), accountId, deltaCents, reason, ref, at: now() });
  }
  function cloudAction(action: CloudAction) { (state.cloudActions ??= []).push(action); }
  function flushCloudActions() {
    while (state.cloudActions?.length) {
      const action = state.cloudActions[0];
      const accountId = action.kind === "order" ? action.input.accountId : clouds.get(action.cloudId)?.accountId;
      if (accountId && closureFor(accountId) && !["end", "schedule"].includes(action.kind)) { state.cloudActions.shift(); store.commit(); continue; }
      if (action.kind === "order") clouds.order({ ...action.input, id: action.cloudId });
      else if (action.kind === "change") {
        const cloud = clouds.get(action.cloudId);
        if (!cloud?.ended && cloud?.status !== "destroyed" && cloud?.status !== "destroying") clouds.changePlan(action.cloudId, action.plan);
      }
      else if (action.kind === "activate") clouds.activate(action.cloudId, action.subscriptionId, action.plan);
      else if (action.kind === "revive") revive(action);
      else if (action.kind === "payment") clouds.setPaymentProblem(action.cloudId, action.problem);
      else if (action.kind === "schedule") clouds.scheduleDestroy(action.cloudId, action.at);
      else if (action.kind === "end") { if (action.from === undefined) clouds.end(action.cloudId, action.at); else clouds.end(action.cloudId, action.at, action.from); }
      else clouds.cancelDestroy(action.cloudId);
      state.cloudActions.shift();
      try { store.commit(); } catch (error) { state.cloudActions.unshift(action); throw error; }
    }
  }
  function revive(action: Extract<CloudAction, { kind: "revive" }>) {
    if (clouds.revive(action.cloudId, action.subscriptionId, action.plan)) return;
    const sub = state.subscriptions.find(row => row.id === action.subscriptionId), previous = clouds.get(action.cloudId);
    if (!sub || sub.cloudId !== action.cloudId || sub.status === "ended" || sub.cart.desktop.kind === "none") return;
    const fresh = clouds.order({ ...action.plan, accountId: sub.accountId, name: previous?.name ?? "My Cloud", color: previous?.color ?? null, region: sub.cart.desktop.region! });
    sub.cloudId = fresh.id;
    clouds.activate(fresh.id, sub.id, action.plan);
  }
  function applyChange(sub: StoredSubscription, change: PendingChange, email: string) {
    const previous = sub.cart, cart = change.cart;
    sub.cart = copy(cart); sub.totalCents = change.totalCents; sub.lines = copy(change.lines); sub.updatedAt = now(); sub.version++;
    refreshLicense(sub, email);
    if (cart.desktop.kind !== "none") {
      const plan = desktopPlan(cart);
      if (previous.desktop.kind === "none") {
        sub.cloudId = change.cloudId;
        cloudAction({ kind: "order", cloudId: sub.cloudId!, input: { ...plan, accountId: sub.accountId, name: "My Cloud", color: null, region: cart.desktop.region! } });
        cloudAction({ kind: "activate", cloudId: sub.cloudId!, subscriptionId: sub.id, plan });
      } else if (!sameCart({ ...cart, license: previous.license }, previous) && sub.cloudId) cloudAction({ kind: "change", cloudId: sub.cloudId, plan });
    } else if (previous.desktop.kind !== "none" && sub.cloudId) {
      // the desktop is paid to the period's end (a downgrade refunds nothing): it runs until then, and the grace starts there
      const paidTo = sub.currentPeriodEnd !== null && sub.currentPeriodEnd > now() ? sub.currentPeriodEnd : now();
      cloudAction({ kind: "end", cloudId: sub.cloudId, at: paidTo + config.graceDays * day, ...(paidTo > now() ? { from: paidTo } : {}) }); sub.cloudId = null;
    }
    if (sub.cloudId && sub.cancelAtPeriodEnd && sub.currentPeriodEnd !== null) cloudAction({ kind: "schedule", cloudId: sub.cloudId, at: sub.currentPeriodEnd + config.graceDays * day });
    delete sub.pendingChange;
  }
  function matchesProduct(event: Extract<BillingEvent, { kind: "subscription" }>, product: PendingChange["products"]) {
    const addons = (items: typeof event.addons) => JSON.stringify([...items].sort((a, b) => a.addonId.localeCompare(b.addonId)));
    return event.productId === product.productId && addons(event.addons) === addons(product.addons);
  }
  function bound(event: Extract<BillingEvent, { kind: "subscription" | "payment" }>, checkout: StoredCheckout) {
    if (event.checkoutId !== null && event.checkoutId !== checkout.id) return false;
    const closure = closureFor(checkout.accountId);
    if (event.accountId !== checkout.accountId && (!closure || !event.accountId || closure.id !== closureId(event.accountId))) return false;
    const owner = state.customers.find(customer => customer.accountId === checkout.accountId);
    return event.customerId !== null && (!owner?.providerCustomerId || owner.providerCustomerId === event.customerId)
      && !state.customers.some(customer => customer.accountId !== checkout.accountId && customer.providerCustomerId === event.customerId);
  }
  function applySubscription(event: Extract<BillingEvent, { kind: "subscription" }>, at: number) {
    let sub = state.subscriptions.find(sub => sub.providerSubscriptionId === event.subscriptionId);
    const checkout = sub ? state.checkouts.find(checkout => checkout.id === sub!.checkoutId) : state.checkouts.find(checkout => checkout.id === event.checkoutId);
    if (!checkout || checkout.kind !== "cart") return;
    if (!sub && !closureFor(checkout.accountId) && duplicateEvent(event, checkout)) {
      settleDuplicate(checkout, event.subscriptionId, { ended: event.type === "cancelled" || event.type === "expired" }); return;
    }
    if (!bound(event, checkout)) return;
    if (checkout.providerSubscriptionId && checkout.providerSubscriptionId !== event.subscriptionId) return;
    if (!sub) {
      const expected = checkout.cart && dodoCart(checkout.cart, products(), config)?.[0];
      if (!expected || !matchesProduct(event, expected)) return;
    }
    if (closureFor(checkout.accountId)) {
      if (["active", "renewed", "plan_changed"].includes(event.type) || event.status === "active") endClosedSubscription(checkout, event.subscriptionId);
      return;
    }
    if ((event.type === "active" || event.type === "renewed") && (event.nextBillingAt === null || event.nextBillingAt <= now())) return;
    if (!sub && checkout?.cart && checkout.kind === "cart" && !checkout.subscriptionId) {
      const previousCloud = checkout.cloudId ? clouds.get(checkout.cloudId) : null;
      const lost = checkout.revive ? !clouds.revivable(checkout.cloudId!, desktopPlan(checkout.cart)) : previousCloud?.status === "destroyed";
      if (event.type === "active" && lost && previousCloud && checkout.cart.desktop.kind !== "none") {
        delete checkout.revive;
        checkout.cloudId = `c${randomBytes(12).toString("hex")}`;
        cloudAction({ kind: "order", cloudId: checkout.cloudId, input: { ...desktopPlan(checkout.cart), accountId: checkout.accountId, name: previousCloud.name, color: previousCloud.color, region: checkout.cart.desktop.region! } });
      }
      sub = { id: id("sub"), accountId: checkout.accountId, providerSubscriptionId: event.subscriptionId, checkoutId: checkout.id, cart: copy(checkout.cart), totalCents: checkout.amountCents, lines: copy(checkout.lines),
        status: "pending", source: checkout.source, licenseId: null, cloudId: checkout.cloudId, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, createdAt: now(), updatedAt: now(), version: 0 };
      state.subscriptions.push(sub); checkout.subscriptionId = sub.id;
      for (const invoice of state.invoices) if (invoice.checkoutId === checkout.id && !invoice.subscriptionId) invoice.subscriptionId = sub.id;
    }
    if (!sub || !checkout) return;
    if (sub.status === "ended" || at < (sub.lastEventAt ?? 0)) return;
    checkout.providerSubscriptionId = event.subscriptionId;
    customer(sub.accountId, checkout.email, event.customerId);
    sub.lastEventAt = at;
    if (sub.pendingChange && ["plan_changed", "active", "renewed"].includes(event.type) && event.status === "active" && matchesProduct(event, sub.pendingChange.products)) applyChange(sub, sub.pendingChange, checkout.email);
    const first = sub.status === "pending" || sub.cloudId !== null && clouds.get(sub.cloudId)?.status === "checkout";
    if (event.type === "active" || event.type === "renewed") {
      sub.status = "active"; period(sub, event.nextBillingAt); if (event.type === "active") sub.cancelAtPeriodEnd = event.cancelAtPeriodEnd; checkout.status = "completed";
      refreshLicense(sub, checkout.email);
      if (sub.cloudId && sub.cart.desktop.kind !== "none") {
        if (first) cloudAction({ kind: checkout.revive && sub.cloudId === checkout.cloudId ? "revive" : "activate", cloudId: sub.cloudId, subscriptionId: sub.id, plan: desktopPlan(sub.cart) });
        cloudAction({ kind: "payment", cloudId: sub.cloudId, problem: false });
        if (!sub.cancelAtPeriodEnd) cloudAction({ kind: "keep", cloudId: sub.cloudId });
        else if (sub.currentPeriodEnd !== null) cloudAction({ kind: "schedule", cloudId: sub.cloudId, at: sub.currentPeriodEnd + config.graceDays * day });
      }
    } else if (event.type === "on_hold" || event.type === "failed") {
      if (sub.status !== "payment_problem") notices.push({ kind: "payment_failed", accountId: sub.accountId, amountCents: sub.totalCents, currency: config.currency, description: planLabel(sub),
        cloudId: sub.cloudId, fixBy: (sub.currentPeriodEnd ?? now()) + config.graceDays * day });
      sub.status = "payment_problem"; refreshLicense(sub, checkout.email);
      if (sub.cloudId) {
        cloudAction({ kind: "payment", cloudId: sub.cloudId, problem: true });
        cloudAction({ kind: "schedule", cloudId: sub.cloudId, at: (sub.currentPeriodEnd ?? now()) + config.graceDays * day });
      }
    } else if (event.type === "cancelled" || event.type === "expired") endSubscription(sub, checkout.email);
    else {
      if (event.cancelAtPeriodEnd && !sub.cancelAtPeriodEnd && sub.status === "active") notices.push(cancelledNotice({ ...sub, cancelAtPeriodEnd: true }));
      sub.cancelAtPeriodEnd = event.cancelAtPeriodEnd;
      const license = state.licenses.find(license => license.id === sub!.licenseId); if (license) license.validUntil = sub.currentPeriodEnd;
      if (sub.cloudId) {
        if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd !== null) cloudAction({ kind: "schedule", cloudId: sub.cloudId, at: sub.currentPeriodEnd + config.graceDays * day });
        else if (!sub.cancelAtPeriodEnd && sub.status === "active" && sub.currentPeriodEnd !== null && sub.currentPeriodEnd > now()) cloudAction({ kind: "keep", cloudId: sub.cloudId });
      }
    }
    sub.updatedAt = now(); sub.version++;
  }
  function applyPayment(event: Extract<BillingEvent, { kind: "payment" }>) {
    let sub = state.subscriptions.find(sub => sub.providerSubscriptionId === event.subscriptionId);
    const checkout = state.checkouts.find(checkout => checkout.id === (sub?.checkoutId ?? event.checkoutId));
    if (checkout && !sub && !closureFor(checkout.accountId) && duplicateEvent(event, checkout)) {
      if (event.type === "succeeded") settleDuplicate(checkout, event.subscriptionId, { paymentId: event.paymentId });
      return;
    }
    if (!checkout || !bound(event, checkout) || event.currency !== config.currency
      || checkout.kind === "credits" && (event.subscriptionId !== null || event.amountCents < checkout.amountCents)
      || checkout.kind === "cart" && event.subscriptionId === null) return;
    if (checkout.providerSubscriptionId && checkout.providerSubscriptionId !== event.subscriptionId) return;
    if (checkout.kind === "credits" && state.invoices.some(invoice => invoice.checkoutId === checkout.id && invoice.status !== "failed" && invoice.providerPaymentId !== event.paymentId)) return;
    let invoice = state.invoices.find(invoice => invoice.providerPaymentId === event.paymentId);
    if (invoice && (invoice.accountId !== checkout.accountId || invoice.checkoutId !== checkout.id)) return;
    if (closureFor(checkout.accountId) && event.type === "succeeded" && event.subscriptionId) sub = endClosedSubscription(checkout, event.subscriptionId);
    if (event.subscriptionId) checkout.providerSubscriptionId = event.subscriptionId;
    customer(checkout.accountId, checkout.email, event.customerId);
    if (!invoice) {
      invoice = { id: id("inv"), accountId: checkout.accountId, providerPaymentId: event.paymentId, subscriptionId: sub?.id ?? checkout.subscriptionId, checkoutId: checkout.id,
        amountCents: event.amountCents, currency: event.currency, status: event.type === "succeeded" ? "paid" : "failed",
        description: checkout.cart ? (sub?.lines ?? checkout.lines).filter(line => line.kind !== "discount").map(line => line.label).join(", ") : config.creditPacks.find(pack => pack.id === checkout.packId)?.label ?? "Credits", createdAt: now() };
      state.invoices.push(invoice);
      if (invoice.status === "paid") receipt(invoice, sub ?? null);
    } else if (event.type === "succeeded" && invoice.status === "failed") { Object.assign(invoice, { status: "paid", amountCents: event.amountCents, currency: event.currency }); receipt(invoice, sub ?? null); }
    if (event.type === "succeeded" && checkout.kind === "credits") {
      ledger(checkout.accountId, checkout.creditCents!, "top_up", event.paymentId); checkout.status = "completed";
    }
    settleRefunds(event.paymentId);
  }
  function receipt(invoice: (typeof state.invoices)[number], sub: StoredSubscription | null) {
    if (invoice.amountCents === 0) return;
    const paidBefore = state.invoices.some(other => other !== invoice && other.status !== "failed" && other.checkoutId === invoice.checkoutId);
    notices.push({ kind: "receipt", accountId: invoice.accountId, invoiceId: invoice.id, amountCents: invoice.amountCents, currency: invoice.currency, description: invoice.description, paidAt: now(),
      periodStart: sub?.currentPeriodStart ?? null, periodEnd: sub?.currentPeriodEnd ?? null, renews: sub ? !sub.cancelAtPeriodEnd : false, first: !paidBefore, cloudId: sub?.cloudId ?? null,
      revived: !paidBefore && state.checkouts.some(checkout => checkout.id === invoice.checkoutId && checkout.revive === true) });
  }
  function applyRefund(event: Extract<BillingEvent, { kind: "refund" }>) {
    const refunds = state.refunds ??= [];
    if (state.invoices.some(invoice => invoice.providerPaymentId === event.paymentId && invoice.status === "refunded") && !refunds.some(refund => refund.paymentId === event.paymentId)) return;
    if (!refunds.some(refund => refund.id === event.refundId)) refunds.push({ id: event.refundId, paymentId: event.paymentId, amountCents: event.amountCents, currency: event.currency });
    settleRefunds(event.paymentId);
  }
  function settleRefunds(paymentId: string) {
    const invoice = state.invoices.find(invoice => invoice.providerPaymentId === paymentId);
    if (!invoice || invoice.status === "failed" || invoice.amountCents <= 0) return;
    const checkout = state.checkouts.find(checkout => checkout.id === invoice.checkoutId);
    let refunded = 0, debited = 0;
    for (const refund of state.refunds ?? []) if (refund.paymentId === paymentId && refund.currency === invoice.currency) {
      refunded += Math.min(refund.amountCents, invoice.amountCents - refunded);
      if (checkout?.kind === "credits") {
        const target = Number(BigInt(checkout.creditCents!) * BigInt(refunded) / BigInt(invoice.amountCents));
        ledger(checkout.accountId, debited - target, "refund", refund.id); debited = target;
      }
    }
    if (refunded === invoice.amountCents) invoice.status = "refunded";
  }
  function handleWebhook(headers: WebhookHeaders, rawBody: Buffer): { duplicate: boolean } {
    let verified;
    try { verified = provider.verifyWebhook(headers, rawBody); }
    catch (error) { if (error instanceof BillingProviderError && error.code === "refused") fail(400, "invalid_request"); fail(401, "bad_signature"); }
    flushCloudActions();
    if (state.webhookEvents.some(event => event.id === verified.id)) { kickProviderCancels(); return { duplicate: true }; }
    const before = copy(state);
    try {
      const event = verified.event;
      if (event.kind === "subscription") applySubscription(event, verified.at);
      else if (event.kind === "payment") applyPayment(event);
      else if (event.kind === "refund") applyRefund(event);
      state.webhookEvents.push({ id: verified.id, at: now(), type: event.kind === "refund" ? "refund.succeeded" : event.kind === "ignored" ? event.type : `${event.kind}.${event.type}` });
      state.webhookEvents = state.webhookEvents.filter(event => event.at >= now() - 30 * day).sort((a, b) => a.at - b.at);
      store.commit();
    } catch (error) { Object.assign(state, before); notices = []; throw error; }
    sendNotices();
    flushCloudActions();
    kickProviderCancels();
    return { duplicate: false };
  }
  kickProviderCancels();
  try { flushCloudActions(); } catch {}
  const retryCloudActions = setInterval(() => { try { flushCloudActions(); } catch {} }, 15_000);
  retryCloudActions.unref();
  /** `all`: an operator's grant replaces an open checkout the person never paid */
  function expireCheckouts(accountId: string, all = false) {
    for (const checkout of state.checkouts) if (checkout.accountId === accountId && checkout.status === "open" && (all || checkout.openUntil <= now())) {
      checkout.status = "expired"; if (checkout.cloudId) clouds.abandon(checkout.cloudId);
    }
  }
  async function checkout(account: AccountRef, item: CheckoutItem, input: { source?: unknown; returnPath?: string; operator?: OperatorGrant } = {}): Promise<CheckoutAnswer> {
    if (closureFor(account.id)) fail(409, "billing_active");
    if (!item || typeof item !== "object" || (item.kind !== "cart" && item.kind !== "credits")) fail(400, "invalid_request");
    const url = returnUrl(input.returnPath);
    const source = input.operator?.source ?? checkoutSource(input.source);
    expireCheckouts(account.id, input.operator !== undefined);
    const cart = item.kind === "cart" ? parsed(item.cart) : null;
    const amount = (priced: number) => input.operator?.amountCents ?? priced;
    const open = state.checkouts.find(checkout => checkout.accountId === account.id && checkout.kind === "cart" && checkout.status === "open" && checkout.openUntil > now());
    if (cart && open?.cart && open.url && sameCart(open.cart, cart) && open.amountCents === amount(quote(cart, config).totalCents)) return { v: 1, checkoutId: open.id, checkoutUrl: open.url, cloudId: open.cloudId, revives: open.revive === true };
    if (state.checkouts.filter(checkout => checkout.accountId === account.id && checkout.createdAt > now() - 3_600_000).length >= config.checkoutsPerHour) fail(429, "rate_limited");
    if (queues.has(account.id) || state.subscriptions.some(sub => sub.accountId === account.id && sub.pendingChange)) fail(409, "plan_change_unavailable");
    const pack = item.kind === "credits" ? config.creditPacks.find(pack => pack.id === item.pack) : null;
    if (item.kind === "credits" && !pack) fail(400, "invalid_request");
    let revive: StoredCloud | null = null;
    if (cart) {
      purchasable(cart); licenseAvailable(account.id, cart);
      if (open) throw new BillingError(409, "checkout_open", open.url);
      if (duplicateOf(account.id, cart)) fail(409, "already_subscribed");
      revive = revivableCloud(account.id, cart);
      if (cart.desktop.kind !== "none" && !revive) cap(account.id);
    }
    if (item.kind === "cart" && ((item.name !== undefined && (typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 100)) || (item.color !== undefined && !CLOUD_SWATCHES.includes(item.color)))) fail(400, "invalid_request");
    const lines = cart ? dodoCart(cart, products(), config) : dodoCreditsCart(pack!.id, products());
    if (!lines) fail(503, "unavailable");
    const cloud = revive ?? (cart && cart.desktop.kind !== "none" && item.kind === "cart" ? clouds.order({ ...desktopPlan(cart), accountId: account.id, name: item.name?.trim() ?? "My Cloud", color: item.color ?? null, region: cart.desktop.region! }) : null);
    const entry: StoredCheckout = { id: id("chk"), accountId: account.id, email: emailOf(account.email), kind: item.kind, cart, packId: pack?.id ?? null,
      cloudId: cloud?.id ?? null, ...(revive ? { revive: true } : {}), providerSessionId: null, url: null, status: "open", source, createdAt: now(), openUntil: now() + config.checkoutOpenMinutes * 60_000,
      subscriptionId: null, amountCents: cart ? amount(quote(cart, config).totalCents) : pack!.priceCents, creditCents: pack?.creditCents ?? null, lines: cart ? quote(cart, config).lines : [] };
    state.checkouts.push(entry); const owner = customer(account.id, account.email); store.commit();
    try {
      const session = await provider.createCheckout({ checkoutId: entry.id, accountId: account.id, email: entry.email, customerId: owner.providerCustomerId, cart: lines, returnUrl: url,
        billing: { interval: cart?.interval ?? null, amountCents: entry.amountCents, currency: config.currency } });
      entry.providerSessionId = session.sessionId;
      if (closureFor(account.id)) { entry.status = "expired"; entry.url = null; store.commit(); fail(409, "billing_active"); }
      entry.url = session.url; store.commit();
      return { v: 1, checkoutId: entry.id, checkoutUrl: session.url, cloudId: entry.cloudId, revives: entry.revive === true };
    } catch {
      entry.status = "expired"; store.commit(); if (entry.cloudId && !entry.revive) clouds.abandon(entry.cloudId); fail(503, "unavailable");
    }
  }
  function licenseCheck(account: AccountRef): LicenseCheck {
    const email = emailOf(account.email); let changed = false;
    for (const license of state.licenses) for (const member of license.members) if (member.email === email && member.accountId === null) { member.accountId = account.id; changed = true; }
    if (changed) store.commit();
    const license = state.licenses.find(license => license.members.some(member => member.accountId === account.id) &&
      (["active", "grace"].includes(license.status) && license.validUntil !== null && now() < license.validUntil));
    const until = config.freeWorkUntil !== null && now() < config.freeWorkUntil ? config.freeWorkUntil : null;
    return { v: 1, work: license ? "licensed" : until !== null ? "free_until" : "unlicensed",
      license: license ? { id: license.id, kind: license.kind, status: license.status, validUntil: license.validUntil, role: license.ownerAccountId === account.id ? "owner" : "member" } : null,
      freeWorkUntil: until, checkedAt: now() };
  }
  function licenses(accountId: string) {
    const email = state.customers.find(customer => customer.accountId === accountId)?.email;
    return copy(state.licenses.filter(license => license.ownerAccountId === accountId || license.members.some(member => member.accountId === accountId || member.accountId === null && email !== undefined && member.email === email)));
  }
  function addMember(account: AccountRef, licenseId: string, input: string): LicenseView {
    const license = ownedLicense(account, licenseId);
    if (typeof input !== "string" || input.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim())) fail(400, "invalid_request");
    const email = emailOf(input); if (license.members.some(member => member.email === email)) return copy(license);
    if (license.members.length >= license.seats) fail(409, "seats_full");
    license.members.push({ email, accountId: null, role: "member", addedAt: now() }); store.commit(); return copy(license);
  }
  function removeMember(account: AccountRef, licenseId: string, input: string): LicenseView {
    const license = ownedLicense(account, licenseId); if (typeof input !== "string") fail(400, "invalid_request");
    const email = emailOf(input); if (license.members.some(member => member.email === email && member.role === "owner")) fail(403, "forbidden");
    license.members = license.members.filter(member => member.email !== email); store.commit(); return copy(license);
  }
  function saveFeedback(account: AccountRef, cloudId: string | null, subscriptionId: string | null, survey: CancelSurvey) {
    const entry = { id: id("fb"), accountId: account.id, cloudId, subscriptionId, ...survey, at: now() }; state.feedback.push(entry); store.commit();
  }
  async function serialized<T>(subscriptionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = queues.get(subscriptionId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(fn); queues.set(subscriptionId, current);
    try { return await current; } finally { if (queues.get(subscriptionId) === current) queues.delete(subscriptionId); }
  }
  async function setCancel(account: AccountRef, subscriptionId: string, cancel: boolean, survey?: CancelSurvey) {
    return serialized(account.id, async () => {
      let sub = editable(account.id, subscriptionId);
      if (!cancel && (sub.status !== "active" || sub.currentPeriodEnd === null || sub.currentPeriodEnd <= now())) fail(409, "not_subscribed");
      if (survey !== undefined) saveFeedback(account, sub.cloudId, sub.id, surveyOf(survey));
      await provider.cancelAtPeriodEnd(sub.providerSubscriptionId!, cancel);
      sub = owned(account.id, subscriptionId);
      if (sub.status === "ended" || !cancel && (sub.status !== "active" || sub.currentPeriodEnd === null || sub.currentPeriodEnd <= now())) fail(409, "not_subscribed");
      const before = copy(state);
      const wasCancelled = sub.cancelAtPeriodEnd;
      try {
        sub.cancelAtPeriodEnd = cancel; sub.updatedAt = now(); sub.version++;
        if (sub.cloudId) {
          if (cancel && sub.currentPeriodEnd !== null) cloudAction({ kind: "schedule", cloudId: sub.cloudId, at: sub.currentPeriodEnd + config.graceDays * day });
          else if (!cancel) cloudAction({ kind: "keep", cloudId: sub.cloudId });
        }
        store.commit();
      } catch (error) { Object.assign(state, before); throw error; }
      if (cancel && !wasCancelled && sub.status === "active") { notices.push(cancelledNotice(sub)); sendNotices(); }
      flushCloudActions(); return view(sub);
    });
  }
  function feedback(account: AccountRef, input: { cloudId?: string | null; survey: CancelSurvey }) {
    if (!input || typeof input !== "object") fail(400, "invalid_request");
    const cloudId = input.cloudId ?? null;
    if (cloudId !== null && typeof cloudId !== "string") fail(400, "invalid_request");
    if (cloudId && !clouds.owned(account.id, cloudId)) fail(404, "not_found");
    const sub = cloudId ? state.subscriptions.find(sub => sub.accountId === account.id && sub.cloudId === cloudId) : null;
    saveFeedback(account, cloudId, sub?.id ?? null, surveyOf(input.survey));
  }
  function changeAllowed(account: AccountRef, sub: StoredSubscription, cart: Cart) {
    if (sub.status !== "active" || sub.currentPeriodEnd === null || sub.currentPeriodEnd <= now()) fail(409, "not_subscribed");
    if (state.subscriptions.some(other => other.accountId === account.id && other.pendingChange)) fail(409, "plan_change_unavailable");
    purchasable(cart); licenseAvailable(account.id, cart, sub.id);
    if (cart.license.kind !== "none" && sub.cart.license.kind === "none") {
      const open = state.checkouts.find(checkout => checkout.accountId === account.id && checkout.status === "open" && checkout.openUntil > now() && checkout.cart && checkout.cart.license.kind !== "none");
      if (open) throw new BillingError(409, "checkout_open", open.url);
    }
    if (sameCart(sub.cart, cart)) fail(409, "already_on_plan");
    if (cart.interval !== sub.cart.interval || (cart.desktop.kind !== "none" && sub.cart.desktop.kind !== "none" && desktopPlan(cart).placement !== desktopPlan(sub.cart).placement)
      || (cart.desktop.kind !== "none" && sub.cart.desktop.kind !== "none" && cart.desktop.region !== sub.cart.desktop.region)) fail(409, "plan_change_unavailable");
    if (cart.desktop.kind !== "none" && sub.cart.desktop.kind === "none") cap(account.id);
    const license = state.licenses.find(license => license.id === sub.licenseId);
    if (license && cart.license.kind !== "none" && license.members.length > quote(cart, config).members) fail(409, "seats_full");
  }
  function previewChange(account: AccountRef, subscriptionId: string, input: unknown): ChangePreview {
    const sub = editable(account.id, subscriptionId), cart = parsed(input); changeAllowed(account, sub, cart);
    const priced = quote(cart, config), expiresAt = now() + 600_000, confirmation = random(32);
    for (const [token, preview] of confirmations) if (preview.expiresAt <= now() || preview.accountId === account.id && preview.subscriptionId === sub.id) confirmations.delete(token);
    confirmations.set(confirmation, { accountId: account.id, subscriptionId, cart, total: priced.totalCents, expiresAt, version: sub.version });
    return { v: 1, quote: priced, chargeNowCents: changeCharge(sub.totalCents, priced.totalCents), confirmation, expiresAt };
  }
  async function change(account: AccountRef, subscriptionId: string, confirmation: string) {
    return serialized(account.id, async () => {
      let sub = editable(account.id, subscriptionId);
      const preview = confirmations.get(confirmation);
      if (!preview || preview.accountId !== account.id || preview.subscriptionId !== subscriptionId) fail(409, "confirmation_required");
      confirmations.delete(confirmation);
      if (preview.expiresAt <= now() || preview.version !== sub.version) fail(409, "confirmation_required");
      const cart = preview.cart, priced = quote(cart, config);
      if (priced.totalCents !== preview.total) fail(409, "price_changed");
      changeAllowed(account, sub, cart);
      const lines = dodoCart(cart, products(), config); if (!lines) fail(503, "unavailable");
      const pending: PendingChange = { cart: copy(cart), totalCents: priced.totalCents, lines: priced.lines, products: copy(lines[0]), cloudId: cart.desktop.kind !== "none" && sub.cart.desktop.kind === "none" ? `c${randomBytes(12).toString("hex")}` : sub.cloudId };
      sub.pendingChange = pending;
      try { store.commit(); } catch (error) { delete sub.pendingChange; throw error; }
      try {
        await provider.changePlan({ subscriptionId: sub.providerSubscriptionId!, productId: lines[0].productId, addons: lines[0].addons, billing: { interval: cart.interval, amountCents: priced.totalCents, currency: config.currency } });
      } catch (error) {
        if (error instanceof BillingProviderError && error.code === "refused") { delete owned(account.id, subscriptionId).pendingChange; store.commit(); }
        throw error;
      }
      sub = owned(account.id, subscriptionId);
      if (sub.status !== "active") fail(409, "not_subscribed");
      if (provider.name === "dodo" && sub.pendingChange) return view(sub);
      if (sub.pendingChange) {
        const before = copy(state);
        try { applyChange(sub, pending, account.email); store.commit(); }
        catch (error) { Object.assign(state, before); throw error; }
      }
      flushCloudActions(); return view(sub);
    });
  }
  /** the operator's change of a live plan: the owner's own preview and change, without the round trip through their page */
  async function operatorChange(account: AccountRef, subscriptionId: string, input: unknown) {
    const changed = await change(account, subscriptionId, previewChange(account, subscriptionId, input).confirmation);
    const sub = owned(account.id, subscriptionId);
    if (sub.source === "admin_comp" && sub.totalCents !== 0) { sub.totalCents = 0; sub.updatedAt = now(); sub.version++; store.commit(); return view(sub); }
    return changed;
  }
  /** moves a live plan's period end either way; `OPEN_ENDED_AT` makes it open-ended */
  function setPeriodEnd(account: AccountRef, subscriptionId: string, until: number) {
    const sub = editable(account.id, subscriptionId);
    if (!Number.isSafeInteger(until) || until <= now()) fail(400, "invalid_request");
    const before = copy(state);
    try {
      sub.currentPeriodEnd = until;
      if (sub.currentPeriodStart === null || sub.currentPeriodStart >= until) sub.currentPeriodStart = Math.min(sub.currentPeriodStart ?? now(), now());
      sub.updatedAt = now(); sub.version++;
      refreshLicense(sub, state.checkouts.find(checkout => checkout.id === sub.checkoutId)?.email ?? account.email);
      if (sub.cloudId && sub.cancelAtPeriodEnd) cloudAction({ kind: "schedule", cloudId: sub.cloudId, at: until + config.graceDays * day });
      store.commit();
    } catch (error) { Object.assign(state, before); throw error; }
    flushCloudActions(); return view(sub);
  }
  /** ends a live plan today: the provider stops billing, and its cloud gets the usual grace from now */
  async function endNow(account: AccountRef, subscriptionId: string) {
    return serialized(account.id, async () => {
      let sub = editable(account.id, subscriptionId);
      await provider.cancelNow(sub.providerSubscriptionId!);
      sub = owned(account.id, subscriptionId);
      if (sub.status === "ended") return view(sub);
      const before = copy(state);
      try {
        delete sub.pendingChange;
        endSubscription(sub, state.checkouts.find(checkout => checkout.id === sub.checkoutId)?.email ?? account.email);
        sub.updatedAt = now(); sub.version++; store.commit();
      } catch (error) { Object.assign(state, before); throw error; }
      flushCloudActions(); return view(sub);
    });
  }
  function invoices(accountId: string, cursor?: string | null, limit = 20): InvoicePage {
    if (!Number.isInteger(limit) || limit < 1) fail(400, "invalid_request"); limit = Math.min(limit, 50);
    let after: { at: number; id: string } | null = null;
    if (cursor) {
      if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) fail(400, "invalid_request");
      try {
        const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (!decoded || typeof decoded !== "object" || !Number.isSafeInteger((decoded as { at: number }).at) || typeof (decoded as { id: string }).id !== "string") fail(400, "invalid_request");
        after = decoded as { at: number; id: string };
      } catch { fail(400, "invalid_request"); }
    }
    const rows = state.invoices.filter(invoice => invoice.accountId === accountId && (!after || invoice.createdAt < after.at || invoice.createdAt === after.at && invoice.id < after.id))
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const selected = rows.slice(0, limit), last = selected.at(-1);
    return { invoices: selected.map(invoice => ({ id: invoice.id, at: invoice.createdAt, amountCents: invoice.amountCents, currency: invoice.currency, status: invoice.status, description: invoice.description, downloadUrl: `/v1/billing/invoices/${invoice.id}/download` })),
      nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString("base64url") : null };
  }
  async function invoiceDownload(accountId: string, invoiceId: string) {
    const invoice = state.invoices.find(invoice => invoice.id === invoiceId && invoice.accountId === accountId); if (!invoice) fail(404, "not_found");
    const url = await provider.invoiceUrl(invoice.providerPaymentId); if (url) return { redirect: url };
    const pdf = await provider.invoicePdf(invoice.providerPaymentId); if (!pdf) fail(404, "not_found"); return { pdf };
  }
  function credits(accountId: string): CreditsView {
    const entries = state.credits.filter(entry => entry.accountId === accountId);
    return { balanceCents: entries.reduce((sum, entry) => sum + entry.deltaCents, 0), entries: entries.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).slice(0, 50).map(({ id, at, deltaCents, reason }) => ({ id, at, deltaCents, reason })) };
  }
  function overview(account: AccountRef): BillingOverview {
    const license = licenseCheck(account);
    return { v: 1, subscriptions: state.subscriptions.filter(sub => sub.accountId === account.id).map(view), licenses: licenses(account.id), license,
      clouds: clouds.list(account.id).map(cloud => clouds.view(cloud)), credits: credits(account.id), invoices: invoices(account.id) };
  }
  function appState(account: AccountRef) {
    const primary = state.subscriptions.find(sub => sub.accountId === account.id && sub.cart.desktop.kind !== "none" && ["active", "payment_problem", "cancelled"].includes(sub.status)) ?? null;
    const active = primary !== null && primary.currentPeriodEnd !== null && primary.currentPeriodEnd > now();
    return { primary: primary ? view(primary) : null, entitlement: { plan: active ? "pro" as const : "free" as const, tier: primary ? quote(primary.cart, config).bundle ?? "custom" : "free",
      status: active ? "active" as const : "inactive" as const, expiresAt: active ? primary!.currentPeriodEnd : null, version: primary?.version ?? 0 } };
  }
  /** checkouts opened in [from, to) by where they started: paid once a subscription or a top-up landed */
  function funnel(from: number, to: number): FunnelView {
    const rows = new Map<FunnelRow["source"], FunnelRow>();
    for (const row of state.checkouts) {
      if (row.createdAt < from || row.createdAt >= to) continue;
      const source = (row.source as FunnelRow["source"] | null) ?? "unknown";
      const entry = rows.get(source) ?? { source, started: 0, paid: 0, active: 0 };
      entry.started++;
      const sub = row.subscriptionId ? state.subscriptions.find(item => item.id === row.subscriptionId) : undefined;
      if (row.status === "completed" || sub && sub.status !== "pending") entry.paid++;
      if (sub && (sub.status === "active" || sub.status === "payment_problem")) entry.active++;
      rows.set(source, entry);
    }
    const list = [...rows.values()].sort((a, b) => b.started - a.started || a.source.localeCompare(b.source));
    const totals = list.reduce((sum, row) => ({ started: sum.started + row.started, paid: sum.paid + row.paid, active: sum.active + row.active }), { started: 0, paid: 0, active: 0 });
    return { v: 1, from, to, rows: list, totals };
  }
  return {
    funnel: guarded(funnel),
    deletionBlockers: guarded(deletionBlockers), closeAccount: guarded(closeAccount), accountDeleted: guarded(accountDeleted), scrubDeleted: guarded(scrubDeleted), drainProviderCancels: guarded(drainProviderCancels),
    catalog: guarded(() => catalogView(now(), config)), quote: guarded((input: unknown) => quote(parsed(input), config)), checkout: guarded(checkout), handleWebhook: guarded(handleWebhook),
    subscriptions: guarded((accountId: string) => state.subscriptions.filter(sub => sub.accountId === accountId).map(view)), licenses: guarded(licenses), licenseCheck: guarded(licenseCheck), addMember: guarded(addMember), removeMember: guarded(removeMember),
    cancel: guarded((account: AccountRef, subscriptionId: string, survey?: CancelSurvey) => setCancel(account, subscriptionId, true, survey)), keep: guarded((account: AccountRef, subscriptionId: string) => setCancel(account, subscriptionId, false)),
    feedback: guarded(feedback), previewChange: guarded(previewChange), change: guarded(change),
    operatorChange: guarded(operatorChange), setPeriodEnd: guarded(setPeriodEnd), endNow: guarded(endNow),
    portal: guarded(async (account: AccountRef, path?: string) => { const url = returnUrl(path), owner = state.customers.find(customer => customer.accountId === account.id); if (!owner?.providerCustomerId) fail(409, "not_subscribed"); return provider.portal(owner.providerCustomerId, url); }),
    invoices: guarded(invoices), invoiceDownload: guarded(invoiceDownload), credits: guarded(credits), overview: guarded(overview), appState: guarded(appState), close: guarded(() => { clearInterval(retryCloudActions); confirmations.clear(); store.close(); }),
  };
}
