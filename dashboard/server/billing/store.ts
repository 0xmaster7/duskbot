import { join } from "node:path";
import type { CancelSurvey, Cart, CartLine, LicenseView, SubscriptionStatus } from "../../../shared/billing-api.ts";
import type { DesktopPlan, OrderInput } from "../clouds/types.ts";
import { createJsonStore } from "./json-store.ts";

export interface PendingChange { cart: Cart; totalCents: number; lines: CartLine[]; products: { productId: string; addons: Array<{ addonId: string; quantity: number }> }; cloudId: string | null }
export type CloudAction =
  | { kind: "order"; cloudId: string; input: OrderInput }
  | { kind: "change"; cloudId: string; plan: DesktopPlan }
  | { kind: "activate"; cloudId: string; subscriptionId: string; plan: DesktopPlan }
  | { kind: "payment"; cloudId: string; problem: boolean }
  | { kind: "schedule"; cloudId: string; at: number }
  /** `from`: the desktop runs until then (the paid period's end), and `at` deletes it */
  | { kind: "end"; cloudId: string; at: number; from?: number }
  | { kind: "keep"; cloudId: string };
export interface StoredCheckout {
  id: string; accountId: string; email: string; kind: "cart" | "credits"; cart: Cart | null; packId: string | null; cloudId: string | null;
  providerSubscriptionId?: string;
  providerSessionId: string | null; url: string | null; status: "open" | "completed" | "expired"; source: string | null;
  createdAt: number; openUntil: number; subscriptionId: string | null; amountCents: number; creditCents: number | null; lines: CartLine[];
}
export interface StoredSubscription {
  id: string; accountId: string; providerSubscriptionId: string | null; checkoutId: string; cart: Cart; totalCents: number; lines: CartLine[];
  status: SubscriptionStatus; licenseId: string | null; cloudId: string | null; currentPeriodStart: number | null; currentPeriodEnd: number | null;
  pendingChange?: PendingChange;
  /** where its checkout started (CHECKOUT_SOURCES), copied from the checkout */
  source?: string | null;
  lastEventAt?: number;
  cancelAtPeriodEnd: boolean; createdAt: number; updatedAt: number; version: number;
}
export interface StoredInvoice {
  id: string; accountId: string; providerPaymentId: string; subscriptionId: string | null; checkoutId: string | null; amountCents: number;
  currency: string; status: "paid" | "failed" | "refunded"; description: string; createdAt: number;
}
export interface AccountClosure {
  id: string; accountId: string; anonId: string; startedAt: number; completedAt: number | null; destroyDesktopsNow: boolean; steps: string[];
}
export interface BillingState {
  closures?: AccountClosure[];
  providerCancels?: Array<{ id: string; completedAt: number | null }>;
  cloudActions?: CloudAction[];
  refunds?: Array<{ id: string; paymentId: string; amountCents: number; currency: string }>;
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
const plan = shape({ kind: one("shared_s", "shared_m", "dedicated"), placement: one("pool", "dedicated"), spec: shape({ vcpu: int, ramGb: int, diskGb: int }), botComputers: nullable(int) });
const valid = shape({
  closures: optional(array(shape({ id: str, accountId: str, anonId: str, startedAt: int, completedAt: nullable(int), destroyDesktopsNow: bool, steps: array(str) }))),
  providerCancels: optional(array(shape({ id: str, completedAt: nullable(int) }))),
  cloudActions: optional(array(value => {
    if (!value || typeof value !== "object") return false;
    const action = value as CloudAction;
    return str(action.cloudId) && (action.kind === "order" && shape({ accountId: str, name: str, region: str })(action.input) && plan(action.input)
      || action.kind === "change" && plan(action.plan) || action.kind === "keep" || action.kind === "payment" && bool(action.problem)
      || (action.kind === "schedule" || action.kind === "end") && int(action.at)
      || action.kind === "activate" && str(action.subscriptionId) && plan(action.plan));
  })),
  refunds: optional(array(shape({ id: str, paymentId: str, amountCents: int, currency: str }))),
  customers: array(shape({ accountId: str, email: str, providerCustomerId: nullable(str) })),
  checkouts: array(shape({ id: str, accountId: str, email: str, kind: one("cart", "credits"), cart: nullable(cart), packId: nullable(str), cloudId: nullable(str), providerSubscriptionId: optional(str), providerSessionId: nullable(str), url: nullable(str), status: one("open", "completed", "expired"), source: nullable(str), createdAt: int, openUntil: int, subscriptionId: nullable(str), amountCents: int, creditCents: nullable(int), lines: array(line) })),
  subscriptions: array(shape({ id: str, accountId: str, providerSubscriptionId: nullable(str), checkoutId: str, cart, totalCents: int, lines: array(line), status: one("pending", "active", "payment_problem", "cancelled", "ended"), lastEventAt: optional(int), source: optional(nullable(str)), pendingChange: optional(shape({ cart, totalCents: int, lines: array(line), products: shape({ productId: str, addons: array(shape({ addonId: str, quantity: int })) }), cloudId: nullable(str) })), licenseId: nullable(str), cloudId: nullable(str), currentPeriodStart: nullable(int), currentPeriodEnd: nullable(int), cancelAtPeriodEnd: bool, createdAt: int, updatedAt: int, version: int })),
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
  return Object.entries(state).filter(([key]) => key !== "cloudActions").every(([key, rows]) => unique(rows.map((row: { id?: string; accountId?: string }) => key === "customers" ? row.accountId! : row.id!)))
    && unique(state.invoices.map(row => row.providerPaymentId)) && unique(state.credits.map(row => `${row.reason}:${row.ref}`))
    && unique(state.subscriptions.flatMap(row => row.providerSubscriptionId ? [row.providerSubscriptionId] : []));
}
export function createBillingStore(dataDir: string) {
  return createJsonStore<BillingState>(join(dataDir, "billing.json"), () => ({ closures: [], providerCancels: [], customers: [], checkouts: [], subscriptions: [], licenses: [], invoices: [], credits: [], webhookEvents: [], feedback: [] }), validState);
}
export type BillingStore = ReturnType<typeof createBillingStore>;
