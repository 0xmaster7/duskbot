import { randomBytes } from "node:crypto";
import { BillingProviderError } from "./types.ts";
import type { ApplyDiscountInput, BillingProvider, ChangePlanInput, CreateCheckoutInput } from "./types.ts";
import { signWebhook, verifyWebhook } from "./webhook-signature.ts";

const id = (prefix: string) => `${prefix}${randomBytes(16).toString("base64url")}`;
export function createFakeBillingProvider(options: { secret?: string; now?: () => number } = {}) {
  const secret = options.secret ?? `whsec_${randomBytes(32).toString("base64")}`, now = options.now ?? Date.now;
  const sessions = new Map<string, CreateCheckoutInput>();
  const subscriptions = new Map<string, { input: CreateCheckoutInput; customerId: string; nextBillingAt: number; cancel: boolean }>();
  const payments = new Map<string, { amount: number; currency: string }>();
  const completed = new Map<string, ReturnType<typeof signWebhook>[]>();
  const cancelCalls: Array<{ subscriptionId: string; cancel: boolean }> = [], changeCalls: ChangePlanInput[] = [];
  const cancelNowCalls: string[] = [], refundCalls: Array<{ paymentId: string; reason: string }> = [], discountCalls: ApplyDiscountInput[] = [];
  function sign(eventId: string, body: Buffer | string | object) { return signWebhook(secret, eventId, Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body), now()); }
  function delivery(type: string, data: object) { return sign(id("evt_"), { business_id: "fake_business", type, timestamp: new Date(now()).toISOString(), data }); }
  function next(time: number, interval: "month" | "year") {
    const date = new Date(time), day = date.getUTCDate(); date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + (interval === "year" ? 12 : 1));
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(); date.setUTCDate(Math.min(day, last)); return date.getTime();
  }
  function subscriptionData(subscriptionId: string) {
    const sub = subscriptions.get(subscriptionId); if (!sub) throw new BillingProviderError("refused");
    return { subscription_id: subscriptionId, customer: { customer_id: sub.customerId }, metadata: { checkoutId: sub.input.checkoutId, accountId: sub.input.accountId },
      product_id: sub.input.cart[0].productId, addons: sub.input.cart[0].addons.map(addon => ({ addon_id: addon.addonId, quantity: addon.quantity })),
      next_billing_date: new Date(sub.nextBillingAt).toISOString(), cancel_at_next_billing_date: sub.cancel, status: "active" };
  }
  function payment(input: CreateCheckoutInput, customerId: string, subscriptionId: string | null) {
    const paymentId = id("pay_"), amount = input.billing?.amountCents ?? 0, currency = input.billing?.currency ?? "USD";
    payments.set(paymentId, { amount, currency });
    return delivery("payment.succeeded", { payment_id: paymentId, subscription_id: subscriptionId, customer: { customer_id: customerId }, metadata: { checkoutId: input.checkoutId, accountId: input.accountId }, total_amount: amount, currency });
  }
  const provider = {
    name: "fake" as const, secret, sessions, subscriptions, payments, cancelCalls, changeCalls, cancelNowCalls, refundCalls, discountCalls, failChangePlan: false, failDiscount: false,
    async createCheckout(input: CreateCheckoutInput) { const sessionId = id("fake_"); sessions.set(sessionId, structuredClone(input)); return { sessionId, url: `https://test.checkout.dodopayments.com/session/${sessionId}` }; },
    async portal(customerId: string, _returnUrl: string) { return { url: `https://test.customer.dodopayments.com/fake_${encodeURIComponent(customerId)}` }; },
    verifyWebhook: (headers, body) => verifyWebhook(secret, headers, body, now()),
    async cancelAtPeriodEnd(subscriptionId: string, cancel: boolean) { cancelCalls.push({ subscriptionId, cancel }); const sub = subscriptions.get(subscriptionId); if (sub) sub.cancel = cancel; },
    async cancelNow(subscriptionId: string) { cancelNowCalls.push(subscriptionId); subscriptions.delete(subscriptionId); },
    async refundPayment(paymentId: string, reason: string) { if (!payments.has(paymentId)) throw new BillingProviderError("refused"); refundCalls.push({ paymentId, reason }); },
    async changePlan(input: ChangePlanInput) {
      changeCalls.push(structuredClone(input)); if (provider.failChangePlan) throw new BillingProviderError("unavailable");
      const sub = subscriptions.get(input.subscriptionId);
      if (sub) { sub.input.cart = [{ productId: input.productId, quantity: 1, addons: structuredClone(input.addons) }]; if (input.billing) sub.input.billing = structuredClone(input.billing); }
    },
    async applyDiscount(input: ApplyDiscountInput) {
      if (provider.failDiscount) throw new BillingProviderError("unavailable");
      discountCalls.push(structuredClone(input)); return { code: `KEEP${randomBytes(6).toString("hex").toUpperCase()}` };
    },
    async invoiceUrl(paymentId: string) { return `https://test.customer.dodopayments.com/invoices/${encodeURIComponent(paymentId)}`; },
    async invoicePdf(_paymentId: string) { return { contentType: "application/pdf", body: Buffer.from("%PDF-1.4\n%%EOF\n") }; },
    sign,
    complete(sessionId: string) {
      const previous = completed.get(sessionId); if (previous) return previous.map(delivery => sign(delivery.headers["webhook-id"], delivery.body));
      const input = sessions.get(sessionId); if (!input) throw new BillingProviderError("refused");
      const customerId = input.customerId ?? id("cus_"), subscriptionId = id("dsub_");
      const result = [payment(input, customerId, subscriptionId)];
      const interval = input.billing?.interval ?? (input.cart[0].productId.endsWith(":year") ? "year" : "month");
      subscriptions.set(subscriptionId, { input: structuredClone(input), customerId, nextBillingAt: next(now(), interval), cancel: false });
      result.push(delivery("subscription.active", subscriptionData(subscriptionId)));
      completed.set(sessionId, result); return result;
    },
    renew(subscriptionId: string) {
      const sub = subscriptions.get(subscriptionId); if (!sub) throw new BillingProviderError("refused");
      sub.nextBillingAt = next(sub.nextBillingAt, sub.input.billing?.interval ?? "month");
      return [payment(sub.input, sub.customerId, subscriptionId), delivery("subscription.renewed", subscriptionData(subscriptionId))];
    },
    fail(subscriptionId: string) { return [delivery("subscription.on_hold", { ...subscriptionData(subscriptionId), status: "on_hold" })]; },
    expire(subscriptionId: string) { return [delivery("subscription.expired", { ...subscriptionData(subscriptionId), status: "expired" })]; },
    refund(paymentId: string) { const payment = payments.get(paymentId); if (!payment) throw new BillingProviderError("refused"); return [delivery("refund.succeeded", { refund_id: id("ref_"), payment_id: paymentId, amount: payment.amount, currency: payment.currency })]; },
  } satisfies BillingProvider & Record<string, unknown>;
  return provider;
}
