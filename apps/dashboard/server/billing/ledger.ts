// The billing ledger: one immutable row per money or subscription moment (paid, renewed, failed, refunded, disputed,
// cancelled, upgraded...), from webhooks and from the owner's backfill. A row's id comes from what happened, not from
// the delivery, so a webhook retried, replayed or also read back by the backfill lands once. Rows are never edited.
import { createHash } from "node:crypto";
import type { ProviderDetails } from "./types.ts";

export type LedgerVia = "webhook" | "sync" | "app" | "fixture";
export interface LedgerEntry {
  /** led_ and a hash of `key` */
  id: string;
  /** what happened, as `type:object[:moment]`: the idempotency key */
  key: string;
  /** when it happened: the provider's own time when it gave one, else when we heard */
  at: number;
  recordedAt: number;
  type: string;
  via: LedgerVia;
  webhookId: string | null;
  accountId: string | null;
  /** ours (sub_...) */
  subscriptionId: string | null;
  providerSubscriptionId: string | null; providerPaymentId: string | null; providerCustomerId: string | null;
  /** a refund's, dispute's or checkout's own id */
  providerRef: string | null;
  /** what was charged, refunded or disputed, tax included, in `currency` */
  amountCents: number | null; currency: string | null;
  /** settlement minus its tax, when the provider reported both */
  netCents: number | null; taxCents: number | null;
  /** the plan's bundle id (starter, pro...) or custom, and how often it bills */
  plan: string | null; interval: "month" | "year" | null;
  /** the subscription's monthly value after this moment (a yearly plan's price / 12), and before it */
  mrrCents: number | null; previousMrrCents: number | null;
  reason: string | null; country: string | null; status: string | null;
}
export type LedgerDraft = Omit<LedgerEntry, "id" | "recordedAt"> & { recordedAt?: number };

export const ledgerId = (key: string) => `led_${createHash("sha256").update(key).digest("base64url").slice(0, 24)}`;

/** the empty fields of a draft, so callers only name what they know */
export function draft(input: Pick<LedgerDraft, "key" | "at" | "type" | "via"> & Partial<LedgerDraft>): LedgerDraft {
  return { webhookId: null, accountId: null, subscriptionId: null, providerSubscriptionId: null, providerPaymentId: null, providerCustomerId: null, providerRef: null,
    amountCents: null, currency: null, netCents: null, taxCents: null, plan: null, interval: null, mrrCents: null, previousMrrCents: null, reason: null, country: null, status: null, ...input };
}

/** what a provider's payment details say about tax and what lands after it */
export function moneyOf(details: ProviderDetails) {
  const settlement = details.settlementCents ?? null, tax = details.settlementTaxCents ?? details.taxCents ?? null;
  return { netCents: settlement !== null ? Math.max(0, settlement - (details.settlementTaxCents ?? 0)) : null, taxCents: tax };
}

const str = (value: unknown) => typeof value === "string";
const nstr = (value: unknown) => value === null || typeof value === "string";
const nint = (value: unknown) => value === null || Number.isSafeInteger(value);
export function validLedgerEntry(value: unknown): value is LedgerEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return str(row.id) && str(row.key) && str(row.type) && Number.isSafeInteger(row.at) && Number.isSafeInteger(row.recordedAt) && ["webhook", "sync", "app", "fixture"].includes(row.via as string)
    && ["webhookId", "accountId", "subscriptionId", "providerSubscriptionId", "providerPaymentId", "providerCustomerId", "providerRef", "currency", "plan", "reason", "country", "status"].every(key => nstr(row[key]))
    && ["amountCents", "netCents", "taxCents", "mrrCents", "previousMrrCents"].every(key => nint(row[key])) && (row.interval === null || row.interval === "month" || row.interval === "year");
}

/** adds a draft once: the new row, or null when its key is already on the ledger */
export function appendLedger(ledger: LedgerEntry[], input: LedgerDraft, now: number): LedgerEntry | null {
  const id = ledgerId(input.key);
  if (ledger.some(row => row.id === id)) return null;
  const entry: LedgerEntry = { ...input, id, recordedAt: input.recordedAt ?? now };
  ledger.push(entry);
  return entry;
}

/** the timeline's word and emoji for a ledger type; null for bookkeeping rows the person page leaves out */
export const LEDGER_LABELS: Record<string, { label: string; emoji: string }> = {
  "subscription.active": { label: "subscribed", emoji: "💰" },
  "payment.succeeded": { label: "paid", emoji: "💰" },
  "subscription.renewed": { label: "renewed", emoji: "🔁" },
  "payment.failed": { label: "payment failed", emoji: "⚠️" },
  "subscription.on_hold": { label: "payment on hold", emoji: "⚠️" },
  "subscription.failed": { label: "subscription failed", emoji: "⚠️" },
  "subscription.recovered": { label: "payment recovered", emoji: "💪" },
  "refund.succeeded": { label: "refunded", emoji: "↩️" },
  "subscription.cancel_scheduled": { label: "cancels at period end", emoji: "👋" },
  "subscription.cancel_undone": { label: "kept the plan", emoji: "🙌" },
  "subscription.cancelled": { label: "cancelled", emoji: "👋" },
  "subscription.expired": { label: "plan ended", emoji: "👋" },
  "subscription.upgraded": { label: "upgraded", emoji: "📈" },
  "subscription.downgraded": { label: "downgraded", emoji: "📉" },
  "subscription.plan_changed": { label: "changed plan", emoji: "🔀" },
  "dispute.opened": { label: "dispute opened", emoji: "🚩" },
  "dispute.won": { label: "dispute won", emoji: "🏆" },
  "dispute.lost": { label: "dispute lost", emoji: "🚩" },
  "checkout.started": { label: "started checkout", emoji: "🛒" },
  "abandoned_checkout.detected": { label: "left checkout", emoji: "🛒" },
  "abandoned_checkout.recovered": { label: "came back to checkout", emoji: "🛒" },
};
