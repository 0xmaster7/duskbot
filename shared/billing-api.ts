// the billing, license and cloud desktop contract between the hosted service (apps/dashboard/server/billing,
// apps/dashboard/server/clouds) and its clients (the dashboard page, the desktop app through the Admin contract).
// version 1; additive changes only. amounts are integer US cents before tax; times are epoch milliseconds.

export const BILLING_API_VERSION = 1 as const;

export const INTERVALS = ["month", "year"] as const;
export type Interval = (typeof INTERVALS)[number];

// licenses: personal, non-commercial use is free; work needs a license (free for work until the configured date).
export const LICENSE_KINDS = ["none", "solo", "team"] as const;
/** none: personal use only. solo: a work license for one member. team: a work license with members. */
export type LicenseKind = (typeof LICENSE_KINDS)[number];

// cloud desktops: shared ones run on our pool, dedicated ones on their own machine (custom sized).
export const DESKTOP_KINDS = ["none", "shared_s", "shared_m", "dedicated"] as const;
export type DesktopKind = (typeof DESKTOP_KINDS)[number];
export type Placement = "pool" | "dedicated";

export interface MachineSpec { vcpu: number; ramGb: number; diskGb: number }
export interface Range { min: number; max: number; step: number }
export interface Region { id: string; label: string; country: string }

/** what someone buys: one cart is one checkout and one subscription with line items */
export interface Cart {
  interval: Interval;
  license: { kind: LicenseKind; /** team only: members in all, at least the included ones */ members?: number };
  desktop: { kind: DesktopKind; region?: string; /** dedicated only */ spec?: MachineSpec };
}

export interface LicenseOption {
  kind: Exclude<LicenseKind, "none">;
  label: string;
  monthlyCents: number;
  includedMembers: number;
  /** each member past the included ones; null when the license is for one member */
  extraMemberCents: number | null;
  maxMembers: number;
  priority: boolean;
}
export interface DesktopOption {
  kind: Exclude<DesktopKind, "none">;
  label: string;
  placement: Placement;
  /** null for dedicated: priced by DedicatedPricing from its spec */
  monthlyCents: number | null;
  machine: MachineSpec;
  /** bot computers it runs at once; null is unlimited */
  botComputers: number | null;
  priority: boolean;
}
export interface DedicatedPricing {
  baseCents: number;
  perVcpuCents: number;
  perGbRamCents: number;
  /** per 10 GB past includedDiskGb */
  per10GbDiskCents: number;
  includedDiskGb: number;
  vcpu: Range;
  ramGb: Range;
  diskGb: Range;
}

export const BUNDLE_IDS = ["free", "starter", "pro", "team"] as const;
export type BundleId = (typeof BUNDLE_IDS)[number];
/** a preset cart; its price is the cart's quote */
export interface BundleView {
  id: BundleId;
  label: string;
  monthlyCents: number;
  /** per month when paid yearly */
  yearlyMonthlyCents: number;
  cart: Omit<Cart, "interval">;
  highlights: string[];
}

export interface Catalog {
  v: typeof BILLING_API_VERSION;
  /** false while paid plans cannot be bought yet (checkout answers checkout_soon); absent means open */
  checkoutOpen?: boolean;
  currency: "USD";
  bundles: BundleView[];
  licenses: LicenseOption[];
  desktops: DesktopOption[];
  dedicated: DedicatedPricing;
  regions: Region[];
  /** regions where shared desktops can be bought; dedicated machines can use any region */
  poolRegions?: string[];
  defaultRegion: string;
  /** percent off a year paid up front */
  yearlyDiscountPercent: number;
  creditPacks: CreditPack[];
  /** work use needs no license until this time; null once the grace is over */
  freeWorkUntil: number | null;
  /** days a cancelled or ended cloud desktop is kept, stopped, before it is destroyed */
  graceDays: number;
  /** measured wake times per desktop kind (wake request to the desktop answering again), only once enough wakes were seen */
  wake?: Partial<Record<Exclude<DesktopKind, "none">, WakeStat>>;
}
export interface WakeStat { medianMs: number; p90Ms: number; samples: number }

export interface CartLine {
  kind: "license" | "members" | "desktop" | "discount";
  label: string;
  /** per interval; negative for a discount */
  amountCents: number;
}
export interface Quote {
  cart: Cart;
  /** the bundle this cart is exactly, if any */
  bundle: BundleId | null;
  lines: CartLine[];
  totalCents: number;
  monthlyEquivalentCents: number;
  machine: MachineSpec | null;
  botComputers: number | null;
  members: number;
}

export interface CreditPack { id: string; label: string; priceCents: number; creditCents: number }

/** where a checkout started; anything else an older client sends is recorded as "other" */
export const CHECKOUT_SOURCES = ["app_card", "app_howto", "app_menu", "app_settings", "app_routines", "app_pages", "app_whats_new_pro", "app_whats_new_team", "app_onboarding", "app_computer_move", "app_sidebar", "app_invested", "app_always_on", "app_mobile",
  "dash_home", "dash_billing", "dash_cloud", "dash_onboarding", "dash_routines", "dash_license", "dash_credits", "dash_start", "dash_free_sheet", "dash_sidebar", "dash_invested", "other"] as const;
export type CheckoutSource = (typeof CHECKOUT_SOURCES)[number];
export const checkoutSource = (value: unknown): CheckoutSource | null =>
  value === undefined || value === null || value === "" ? null : (CHECKOUT_SOURCES as readonly unknown[]).includes(value) ? value as CheckoutSource : "other";

/** checkouts per source over a window: opened, paid (a subscription or a top-up landed), and still paying now */
export interface FunnelRow { source: CheckoutSource | "unknown"; started: number; paid: number; active: number }
export interface FunnelView { v: typeof BILLING_API_VERSION; from: number; to: number; rows: FunnelRow[]; totals: Omit<FunnelRow, "source"> }

export type CheckoutItem =
  | { kind: "cart"; cart: Cart; name?: string; color?: CloudSwatch }
  | { kind: "credits"; pack: string };
/** `revives`: paying brings back this account's paused cloud (`cloudId`) with its data instead of a new one. The same
 * cart while its checkout is still open answers that checkout again. */
export interface CheckoutAnswer { v: typeof BILLING_API_VERSION; checkoutId: string; checkoutUrl: string; cloudId: string | null; revives: boolean }

export const SUBSCRIPTION_STATUSES = ["pending", "active", "payment_problem", "cancelled", "ended"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export interface SubscriptionView {
  id: string;
  cart: Cart;
  bundle: BundleId | null;
  lines: CartLine[];
  totalCents: number;
  status: SubscriptionStatus;
  licenseId: string | null;
  cloudId: string | null;
  currentPeriodEnd: number | null;
  /** renewal is off: everything on it ends at currentPeriodEnd */
  cancelAtPeriodEnd: boolean;
  createdAt: number;
}

export const LICENSE_STATUSES = ["active", "grace", "expired"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];
export interface LicenseMember { email: string; accountId: string | null; role: "owner" | "member"; addedAt: number }
export interface LicenseView {
  id: string;
  kind: Exclude<LicenseKind, "none">;
  ownerAccountId: string;
  seats: number;
  members: LicenseMember[];
  priority: boolean;
  status: LicenseStatus;
  /** paid through; null for a license without an end */
  validUntil: number | null;
  subscriptionId: string | null;
}
/**
 * what an app or the dashboard asks before work use: may this account use Dusk Bot for work now, and why.
 * personal use is always allowed and is not asked about.
 */
export interface LicenseCheck {
  v: typeof BILLING_API_VERSION;
  work: "licensed" | "free_until" | "unlicensed";
  /** the license this account is a member of, if any */
  license: { id: string; kind: Exclude<LicenseKind, "none">; status: LicenseStatus; validUntil: number | null; role: "owner" | "member" } | null;
  freeWorkUntil: number | null;
  checkedAt: number;
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
export const CLOUD_STATUSES = ["checkout", "provisioning", "running", "sleeping", "stopped", "payment_problem", "suspended", "error", "destroying", "destroyed"] as const;
export type CloudStatus = (typeof CLOUD_STATUSES)[number];
export const SETUP_STEPS = ["reserving", "storage", "starting", "checking"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export interface CloudDesktopView {
  id: string;
  name: string;
  color: CloudSwatch | null;
  kind: Exclude<DesktopKind, "none">;
  placement: Placement;
  status: CloudStatus;
  setupStep: SetupStep | null;
  region: string;
  machine: MachineSpec;
  botComputers: number | null;
  /** the desktop's own https origin once it answers */
  origin: string | null;
  /** the dashboard workspace its Dusk Bot install reports as */
  workspaceId: string | null;
  lastReportAt: number | null;
  /** when a cancelled or ended desktop is destroyed */
  destroyAt: number | null;
  error: string | null;
  subscriptionId: string | null;
  createdAt: number;
  /** when a new plan brought this desktop back with its data after its previous plan ended */
  revivedAt?: number | null;
  /** a managed cloud desktop: it sleeps when idle and keeps backups */
  provider?: "managed";
  /** managed only: the newest backup of its data */
  lastBackupAt?: number | null;
  /** managed only: when an owner-confirmed deletion happens unless cancelled */
  deleteScheduledAt?: number | null;
  /** managed only: when the owner asked to delete its data; the emailed link stays valid for an hour after */
  deleteAskedAt?: number | null;
  /** managed only: asleep, and a wake (the owner's, the app's, a routine's) is under way */
  waking?: boolean;
}

export type PowerAction = "on" | "off";

export interface BillingOverview {
  v: typeof BILLING_API_VERSION;
  subscriptions: SubscriptionView[];
  licenses: LicenseView[];
  license: LicenseCheck;
  clouds: CloudDesktopView[];
  credits: CreditsView;
  invoices: InvoicePage;
}

/**
 * dashboard routes (cookie session, JSON, same origin). catalog and quote need no session.
 *   GET  /v1/billing/catalog                         -> Catalog
 *   POST /v1/billing/quote          { cart: Cart }   -> Quote
 *   GET  /v1/billing/overview                        -> BillingOverview
 *   POST /v1/billing/checkout       CheckoutItem     -> CheckoutAnswer
 *   POST /v1/billing/portal                          -> { url }
 *   GET  /v1/billing/invoices?cursor=                -> InvoicePage
 *   GET  /v1/billing/invoices/:id/download           -> 302 to the provider's invoice
 *   GET  /v1/billing/credits                         -> CreditsView
 *   GET  /v1/billing/license                         -> LicenseCheck
 *   POST /v1/billing/licenses/:id/members  { email } -> { license: LicenseView }
 *   DELETE /v1/billing/licenses/:id/members/:email   -> { license: LicenseView }
 *   POST /v1/billing/subscriptions/:id/preview  { cart: Cart }            -> ChangePreview
 *   POST /v1/billing/subscriptions/:id/change   { confirmation }          -> { subscription: SubscriptionView }
 *   POST /v1/billing/subscriptions/:id/cancel   { survey?: CancelSurvey } -> { subscription: SubscriptionView }
 *   POST /v1/billing/subscriptions/:id/keep                               -> { subscription: SubscriptionView }
 *   GET  /v1/clouds                                  -> { clouds: CloudDesktopView[] }
 *   GET  /v1/clouds/:id                              -> { cloud: CloudDesktopView }
 *   PATCH /v1/clouds/:id            { name?, color? } -> { cloud: CloudDesktopView }
 *   POST /v1/clouds/:id/power       { action: PowerAction } -> { cloud: CloudDesktopView }
 * apps (Authorization: Bearer): GET /api/cloud/desktop/license -> LicenseCheck; the session carries it as `license`.
 * provider webhooks: POST /v1/billing/webhooks/dodo (standard webhooks signature).
 * errors: { error, code } with codes below.
 */
export const BILLING_ERROR_CODES = ["billing_active", "signed_out", "invalid_request", "not_found", "forbidden", "rate_limited", "already_subscribed", "checkout_open", "cap",
  "confirmation_required", "price_changed", "not_subscribed", "already_on_plan", "plan_change_unavailable", "seats_full", "unavailable", "checkout_soon", "bad_signature", "failed"] as const;
export interface DeletionBlocker { kind: "subscription" | "cloud_desktop"; id: string; label: string; status: string }
export interface DeleteAccountOptions { cancelBilling?: boolean; destroyDesktopsNow?: boolean }
export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];
