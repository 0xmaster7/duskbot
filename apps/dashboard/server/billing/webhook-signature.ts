import { createHmac, timingSafeEqual } from "node:crypto";
import { BillingProviderError } from "./types.ts";
import type { BillingEvent, ProviderDetails, VerifiedWebhook } from "./types.ts";

export type WebhookHeaders = Record<string, string | string[] | undefined>;
function key(secret: string) {
  const encoded = secret.replace(/^whsec_/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new BillingProviderError("bad_signature");
  const decoded = Buffer.from(encoded, "base64");
  if (!decoded.length) throw new BillingProviderError("bad_signature");
  return decoded;
}
export function signWebhook(secret: string, id: string, body: Buffer | string, now: number): { headers: Record<string, string>; body: Buffer } {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body), timestamp = String(Math.floor(now / 1000));
  const signature = createHmac("sha256", key(secret)).update(`${id}.${timestamp}.`).update(raw).digest("base64");
  return { headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` }, body: raw };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BillingProviderError("refused");
  return value as Record<string, unknown>;
}
function string(value: unknown): string { if (typeof value !== "string" || !value) throw new BillingProviderError("refused"); return value; }
function optionalString(value: unknown) { return value === undefined || value === null ? null : string(value); }
function amount(value: unknown) { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new BillingProviderError("refused"); return value as number; }
function date(value: unknown) { const time = Date.parse(string(value)); if (!Number.isFinite(time)) throw new BillingProviderError("refused"); return time; }
// the soft readers: a field the ledger only records never refuses a delivery; a wrong shape reads as null
const softInt = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : typeof value === "string" && /^\d{1,12}$/.test(value) ? Number(value) : null;
const softText = (value: unknown, max = 80) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const softDate = (value: unknown) => { const time = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(time) ? time : null; };
const softRecord = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const INTERVALS: Record<string, "month" | "year"> = { month: "month", year: "year" };
/** what a dodo payment, subscription, refund or dispute object adds for the ledger (docs.dodopayments.com/api-reference) */
export function detailsOf(data: Record<string, unknown>): ProviderDetails {
  const country = softText(softRecord(data.billing).country, 2);
  const interval = INTERVALS[String(data.payment_frequency_interval ?? "").toLowerCase()] ?? null;
  return { createdAt: softDate(data.created_at), settlementCents: softInt(data.settlement_amount), settlementTaxCents: softInt(data.settlement_tax), taxCents: softInt(data.tax),
    settlementCurrency: softText(data.settlement_currency, 3), country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    errorCode: softText(data.error_code), reason: softText(data.reason) ?? softText(data.cancellation_reason),
    recurringCents: softInt(data.recurring_pre_tax_amount), interval: interval && Number(data.payment_frequency_count ?? 1) === 1 ? interval : null, cancelledAt: softDate(data.cancelled_at) };
}
const DISPUTE = /^dispute\.(opened|challenged|accepted|cancelled|expired|won|lost)$/;
/** a type the code does not act on but the owner's ledger keeps (abandoned checkouts, dunning) */
const RECORDED = /^(abandoned_checkout\.(detected|recovered)|dunning\.(started|recovered)|payment\.(processing|cancelled)|refund\.failed|subscription\.(past_due|paused|unpaused))$/;
function eventOf(type: string, value: unknown): BillingEvent {
  if (DISPUTE.test(type)) {
    const data = record(value), money = softInt(data.amount);
    if (money === null) throw new BillingProviderError("refused");
    return { kind: "dispute", type: type.slice(8) as Extract<BillingEvent, { kind: "dispute" }>["type"], disputeId: string(data.dispute_id), paymentId: string(data.payment_id),
      amountCents: money, currency: string(data.currency), stage: softText(data.dispute_stage), ...detailsOf(data) };
  }
  if (!/^(subscription\.(active|renewed|on_hold|failed|cancelled|expired|plan_changed|updated)|payment\.(succeeded|failed)|refund\.succeeded)$/.test(type)) {
    return RECORDED.test(type) && value && typeof value === "object" && !Array.isArray(value) ? { kind: "ignored", type, data: value as Record<string, unknown> } : { kind: "ignored", type };
  }
  const data = record(value);
  if (type === "refund.succeeded") return { kind: "refund", refundId: string(data.refund_id), paymentId: string(data.payment_id), amountCents: amount(data.amount), currency: string(data.currency), ...detailsOf(data) };
  const customerId = data.customer == null ? null : optionalString(record(data.customer).customer_id);
  const checkoutId = data.metadata == null ? null : optionalString(record(data.metadata).checkoutId);
  const accountId = data.metadata == null ? null : optionalString(record(data.metadata).accountId);
  if (type.startsWith("payment.")) return { kind: "payment", type: type.slice(8) as "succeeded" | "failed", paymentId: string(data.payment_id), subscriptionId: optionalString(data.subscription_id), customerId, checkoutId, accountId, amountCents: amount(data.total_amount), currency: string(data.currency), ...detailsOf(data) };
  if (data.addons !== undefined && !Array.isArray(data.addons)) throw new BillingProviderError("refused");
  if (data.cancel_at_next_billing_date !== undefined && typeof data.cancel_at_next_billing_date !== "boolean") throw new BillingProviderError("refused");
  return { kind: "subscription", type: type.slice(13) as Extract<BillingEvent, { kind: "subscription" }>["type"], subscriptionId: string(data.subscription_id), customerId, checkoutId, accountId,
    productId: optionalString(data.product_id), addons: (data.addons as unknown[] ?? []).map(item => { const addon = record(item); return { addonId: string(addon.addon_id), quantity: amount(addon.quantity) }; }),
    nextBillingAt: data.next_billing_date == null ? null : date(data.next_billing_date), cancelAtPeriodEnd: data.cancel_at_next_billing_date === true, status: optionalString(data.status), ...detailsOf(data) };
}
export function verifyWebhook(secret: string, headers: WebhookHeaders, rawBody: Buffer, now: number): VerifiedWebhook {
  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  const id = normalized["webhook-id"], timestamp = normalized["webhook-timestamp"], signatures = normalized["webhook-signature"];
  if (typeof id !== "string" || !id || typeof timestamp !== "string" || !/^\d+$/.test(timestamp) || typeof signatures !== "string" || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new BillingProviderError("bad_signature");
  const expected = createHmac("sha256", key(secret)).update(`${id}.${timestamp}.`).update(rawBody).digest();
  let matched = false;
  for (const entry of signatures.split(/\s+/)) {
    const [version, encoded] = entry.split(",");
    if (version !== "v1" || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) continue;
    const signature = Buffer.from(encoded, "base64");
    if (signature.length === expected.length) matched = timingSafeEqual(signature, expected) || matched;
  }
  if (!matched) throw new BillingProviderError("bad_signature");
  try {
    const payload = record(JSON.parse(rawBody.toString("utf8")));
    string(payload.business_id);
    return { id, at: date(payload.timestamp), event: eventOf(string(payload.type), payload.data) };
  } catch { throw new BillingProviderError("refused"); }
}
