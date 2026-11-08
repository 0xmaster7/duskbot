import { join } from "node:path";
import type { CancelSurvey, Cart, CartLine, LicenseView, SubscriptionStatus } from "../../../shared/billing-api.ts";
import { createJsonStore } from "./json-store.ts";

export interface StoredCheckout {
  id: string; accountId: string; email: string; kind: "cart" | "credits"; cart: Cart | null; packId: string | null; cloudId: string | null;
  providerSessionId: string | null; url: string | null; status: "open" | "completed" | "expired"; source: string | null;
  createdAt: number; openUntil: number; subscriptionId: string | null; amountCents: number; creditCents: number | null; lines: CartLine[];
}
export interface StoredSubscription {
  id: string; accountId: string; providerSubscriptionId: string | null; checkoutId: string; cart: Cart; totalCents: number; lines: CartLine[];
  status: SubscriptionStatus; licenseId: string | null; cloudId: string | null; currentPeriodStart: number | null; currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean; createdAt: number; updatedAt: number; version: number;
}
export interface StoredInvoice {
  id: string; accountId: string; providerPaymentId: string; subscriptionId: string | null; checkoutId: string | null; amountCents: number;
  currency: string; status: "paid" | "failed" | "refunded"; description: string; createdAt: number;
}
export interface BillingState {
  customers: Array<{ accountId: string; email: string; providerCustomerId: string | null }>;
  checkouts: StoredCheckout[]; subscriptions: StoredSubscription[]; licenses: LicenseView[]; invoices: StoredInvoice[];
  credits: Array<{ id: string; accountId: string; deltaCents: number; reason: "top_up" | "refund" | "usage" | "grant"; ref: string; at: number }>;
  webhookEvents: Array<{ id: string; at: number; type: string }>;
  feedback: Array<CancelSurvey & { id: string; accountId: string; cloudId: string | null; subscriptionId: string | null; at: number }>;
}

type Check = (value: unknown) => boolean;
const str: Check = value => typeof value === "string";
const int: Check = value => Number.isSafeInteger(value);
const bool: Check = value => typeof value === "boolean";
const nullable = (check: Check): Check => value => value === null || check(value);
const one = (...values: unknown[]): Check => value => values.includes(value);
const array = (check: Check): Check => value => Array.isArray(value) && value.every(check);
const shape = (fields: Record<string, Check>): Check => value => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.entries(fields).every(([key, check]) => check((value as Record<string, unknown>)[key]));
const optional = (check: Check): Check => value => value === undefined || check(value);
const cart: Check = shape({ interval: one("month", "year"), license: shape({ kind: one("none", "solo", "team"), members: optional(int) }),
  desktop: shape({ kind: one("none", "shared_s", "shared_m", "dedicated"), region: optional(str), spec: optional(shape({ vcpu: int, ramGb: int, diskGb: int })) }) });
const line = shape({ kind: one("license", "members", "desktop", "discount"), label: str, amountCents: int });
const valid = shape({
  customers: array(shape({ accountId: str, email: str, providerCustomerId: nullable(str) })),
  checkouts: array(shape({ id: str, accountId: str, email: str, kind: one("cart", "credits"), cart: nullable(cart), packId: nullable(str), cloudId: nullable(str), providerSessionId: nullable(str), url: nullable(str), status: one("open", "completed", "expired"), source: nullable(str), createdAt: int, openUntil: int, subscriptionId: nullable(str), amountCents: int, creditCents: nullable(int), lines: array(line) })),
  subscriptions: array(shape({ id: str, accountId: str, providerSubscriptionId: nullable(str), checkoutId: str, cart, totalCents: int, lines: array(line), status: one("pending", "active", "payment_problem", "cancelled", "ended"), licenseId: nullable(str), cloudId: nullable(str), currentPeriodStart: nullable(int), currentPeriodEnd: nullable(int), cancelAtPeriodEnd: bool, createdAt: int, updatedAt: int, version: int })),
  licenses: array(shape({ id: str, ownerAccountId: str, kind: one("solo", "team"), seats: int, members: array(shape({ email: str, accountId: nullable(str), role: one("owner", "member"), addedAt: int })), priority: bool, subscriptionId: nullable(str), status: one("active", "grace", "expired"), validUntil: nullable(int) })),
  invoices: array(shape({ id: str, accountId: str, providerPaymentId: str, subscriptionId: nullable(str), checkoutId: nullable(str), amountCents: int, currency: str, status: one("paid", "failed", "refunded"), description: str, createdAt: int })),
  credits: array(shape({ id: str, accountId: str, deltaCents: int, reason: one("top_up", "refund", "usage", "grant"), ref: str, at: int })),
  webhookEvents: array(shape({ id: str, at: int, type: str })),
  feedback: array(shape({ id: str, accountId: str, cloudId: nullable(str), subscriptionId: nullable(str), answer: one("feature", "price", "setup", "broken", "later", "other"), expected: optional(str), improve: optional(str), at: int })),
});
function validState(value: unknown): value is BillingState {
  if (!valid(value)) return false;
  const state = value as BillingState;
  const unique = (values: string[]) => new Set(values).size === values.length;
  return Object.entries(state).every(([key, rows]) => unique(rows.map((row: { id?: string; accountId?: string }) => key === "customers" ? row.accountId! : row.id!)))
    && unique(state.invoices.map(row => row.providerPaymentId)) && unique(state.credits.map(row => `${row.reason}:${row.ref}`))
    && unique(state.subscriptions.flatMap(row => row.providerSubscriptionId ? [row.providerSubscriptionId] : []));
}
export function createBillingStore(dataDir: string) {
  return createJsonStore<BillingState>(join(dataDir, "billing.json"), () => ({ customers: [], checkouts: [], subscriptions: [], licenses: [], invoices: [], credits: [], webhookEvents: [], feedback: [] }), validState);
}
export type BillingStore = ReturnType<typeof createBillingStore>;
