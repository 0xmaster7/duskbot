// the billing and cloud desktop contract between the hosted service (dashboard/server/billing, dashboard/server/clouds)
// and its clients (the dashboard page, the desktop app through the Admin contract). version 1; additive changes only.
// amounts are integer US cents before tax; times are epoch milliseconds.

export const BILLING_API_VERSION = 1 as const;

export const PLAN_TIERS = ["starter", "pro", "max", "team"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];
/** a fixed plan, or a machine built in the custom configurator */
export type Tier = PlanTier | "custom";
export const INTERVALS = ["month", "year"] as const;
export type Interval = (typeof INTERVALS)[number];

export interface MachineSpec { vcpu: number; ramGb: number; diskGb: number }

export interface PlanView {
  tier: PlanTier;
  label: string;
  /** the monthly price, and the price of a year paid up front */
  monthlyCents: number;
  yearlyCents: number;
  machine: MachineSpec;
  /** bot computers the plan includes; null is unlimited */
  botComputers: number | null;
  /** sleeps when idle and wakes on a message; otherwise always on */
  sleeps: boolean;
  priority: boolean;
  members: boolean;
  notes: string[];
}

export interface Range { min: number; max: number; step: number }
export interface Region { id: string; label: string; country: string }

export interface CustomPricing {
  baseCents: number;
  perVcpuCents: number;
  perGbRamCents: number;
  per10GbDiskCents: number;
  alwaysOnCents: number;
  vcpu: Range;
  ramGb: Range;
  diskGb: Range;
  /** bot computers a custom machine includes: one per this many vCPUs, at least one */
  vcpuPerBotComputer: number;
}

export interface CustomConfig extends MachineSpec { region: string; alwaysOn: boolean }

export interface CreditPack { id: string; label: string; priceCents: number; creditCents: number }

export interface Catalog {
  v: typeof BILLING_API_VERSION;
  currency: "USD";
  plans: PlanView[];
  custom: CustomPricing;
  regions: Region[];
  defaultRegion: string;
  /** months free when a year is paid up front */
  annualFreeMonths: number;
  creditPacks: CreditPack[];
  /** days a cancelled or ended cloud desktop is kept, stopped, before it is destroyed */
  graceDays: number;
}

export interface QuoteRequest { tier: Tier; interval: Interval; custom?: CustomConfig }
export interface Quote {
  tier: Tier;
  interval: Interval;
  machine: MachineSpec;
  botComputers: number | null;
  sleeps: boolean;
  /** the price per interval, and what that is per month */
  priceCents: number;
  monthlyEquivalentCents: number;
}

export type CheckoutItem =
  | { kind: "plan"; tier: Tier; interval: Interval; region?: string; custom?: CustomConfig; name?: string; color?: CloudSwatch }
  | { kind: "credits"; pack: string };
export interface CheckoutAnswer { v: typeof BILLING_API_VERSION; checkoutId: string; checkoutUrl: string; cloudId: string | null }

export const SUBSCRIPTION_STATUSES = ["pending", "active", "payment_problem", "cancelled", "ended"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export interface SubscriptionView {
  id: string;
  cloudId: string;
  tier: Tier;
  interval: Interval;
  machine: MachineSpec;
  priceCents: number;
  status: SubscriptionStatus;
  currentPeriodEnd: number | null;
  /** renewal is off: the plan ends at currentPeriodEnd */
  cancelAtPeriodEnd: boolean;
  createdAt: number;
}

export interface InvoiceView {
  id: string;
  at: number;
  amountCents: number;
  currency: string;
  status: "paid" | "failed" | "refunded";
  description: string;
  /** same-origin link that redirects to the provider's invoice; null while none exists */
  downloadUrl: string | null;
}
export interface InvoicePage { invoices: InvoiceView[]; nextCursor: string | null }

export interface CreditsView { balanceCents: number; entries: Array<{ id: string; at: number; deltaCents: number; reason: "top_up" | "refund" | "usage" | "grant" }> }

export const CANCEL_ANSWERS = ["feature", "price", "setup", "broken", "later", "other"] as const;
export type CancelAnswer = (typeof CANCEL_ANSWERS)[number];
/** the desktop app's cancel sheet survey (electron/cloud-account.mjs cancelSurvey), as the dashboard sends it too */
export interface CancelSurvey { answer: CancelAnswer; expected?: string; improve?: string }

export interface ChangePreview { v: typeof BILLING_API_VERSION; quote: Quote; chargeNowCents: number; confirmation: string; expiresAt: number }

export const CLOUD_SWATCHES = ["blue", "green", "amber", "rose", "violet", "slate"] as const;
export type CloudSwatch = (typeof CLOUD_SWATCHES)[number];
export const CLOUD_STATUSES = ["checkout", "provisioning", "running", "sleeping", "stopped", "payment_problem", "error", "destroying", "destroyed"] as const;
export type CloudStatus = (typeof CLOUD_STATUSES)[number];
export const SETUP_STEPS = ["reserving", "storage", "starting", "checking"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export interface CloudDesktopView {
  id: string;
  name: string;
  color: CloudSwatch | null;
  tier: Tier;
  status: CloudStatus;
  setupStep: SetupStep | null;
  region: string;
  machine: MachineSpec;
  botComputers: number | null;
  sleeps: boolean;
  /** the desktop's own https origin once it answers */
  origin: string | null;
  /** the dashboard workspace its OpenMausBot install reports as */
  workspaceId: string | null;
  lastReportAt: number | null;
  /** when a cancelled or ended desktop is destroyed */
  destroyAt: number | null;
  error: string | null;
  createdAt: number;
}

export type PowerAction = "on" | "off";

export interface BillingOverview {
  v: typeof BILLING_API_VERSION;
  subscriptions: SubscriptionView[];
  clouds: CloudDesktopView[];
  credits: CreditsView;
  invoices: InvoicePage;
}

/**
 * dashboard routes (cookie session, JSON, same origin). catalog and quote need no session.
 *   GET  /v1/billing/catalog                         -> Catalog
 *   POST /v1/billing/quote          QuoteRequest     -> Quote
 *   GET  /v1/billing/overview                        -> BillingOverview
 *   POST /v1/billing/checkout       CheckoutItem     -> CheckoutAnswer
 *   POST /v1/billing/portal                          -> { url }
 *   GET  /v1/billing/invoices?cursor=                -> InvoicePage
 *   GET  /v1/billing/invoices/:id/download           -> 302 to the provider's invoice
 *   GET  /v1/billing/credits                         -> CreditsView
 *   POST /v1/billing/subscriptions/:id/preview  QuoteRequest              -> ChangePreview
 *   POST /v1/billing/subscriptions/:id/change   { confirmation }          -> { subscription: SubscriptionView }
 *   POST /v1/billing/subscriptions/:id/cancel   { survey?: CancelSurvey } -> { subscription: SubscriptionView }
 *   POST /v1/billing/subscriptions/:id/keep                               -> { subscription: SubscriptionView }
 *   GET  /v1/clouds                                  -> { clouds: CloudDesktopView[] }
 *   GET  /v1/clouds/:id                              -> { cloud: CloudDesktopView }
 *   PATCH /v1/clouds/:id            { name?, color? } -> { cloud: CloudDesktopView }
 *   POST /v1/clouds/:id/power       { action: PowerAction } -> { cloud: CloudDesktopView }
 * provider webhooks: POST /v1/billing/webhooks/dodo (standard webhooks signature).
 * errors: { error, code } with codes below.
 */
export const BILLING_ERROR_CODES = ["signed_out", "invalid_request", "not_found", "rate_limited", "already_subscribed", "checkout_open", "cap",
  "confirmation_required", "price_changed", "not_subscribed", "already_on_plan", "plan_change_unavailable", "unavailable", "bad_signature", "failed"] as const;
export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];
