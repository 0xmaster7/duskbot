// mirror of shared/account-api.ts (d7ab69369) and shared/billing-api.ts (9259942bd); becomes re-exports once those land on this branch

export type SignInProvider = "email" | "google" | "apple" | "x";

export const OAUTH_PROVIDERS = ["google", "apple", "x"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const EMAIL_CODE_DIGITS = 8;

export const CSRF_COOKIE = "omb_csrf";

export const CSRF_HEADER = "x-omb-csrf";

export interface AccountView {
  id: string;
  email: string;
  name: string | null;
  createdAt: number;
  /** every way this account can sign in, email first when it has one. */
  providers: SignInProvider[];
}

export interface IdentityView {
  provider: OAuthProvider;
  /** the address the provider vouched for, or null (x often has none). */
  email: string | null;
  /** the provider's display handle or name, for the account page only. */
  label: string | null;
  addedAt: number;
}

export interface SessionView {
  id: string;
  kind: "web" | "desktop" | "mobile";
  /** the device's own name (the app sends it) or a browser label for the website. */
  name: string;
  platform: string | null;
  appVersion: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  /** the session this request came with. */
  current: boolean;
}

export interface ProviderView {
  id: OAuthProvider;
  /** configured with real keys (or a fixture provider): the button signs in. */
  enabled: boolean;
  /** not configured; only true on a development service, where the button says "coming soon". */
  comingSoon: boolean;
}

export interface ProvidersAnswer { v: 1; providers: ProviderView[]; signupOpen: boolean }

export interface EmailStartAnswer { attempt: string; expiresIn: number; resendAfter: number; signupOpen: boolean }

export interface WebSignInAnswer { account: AccountView; csrfToken: string; created: boolean; redirect?: string }

export interface MeAnswer { account: AccountView; csrfToken: string }

export interface AccountAnswer { account: AccountView; identities: IdentityView[]; sessions: SessionView[] }

export interface DeviceLookupAnswer { device: { name: string; platform: string }; userCode: string; expiresAt: number }

export const BILLING_API_VERSION = 1 as const;

export const INTERVALS = ["month", "year"] as const;

export type Interval = (typeof INTERVALS)[number];

export const LICENSE_KINDS = ["none", "solo", "team"] as const;

export type LicenseKind = (typeof LICENSE_KINDS)[number];

export const DESKTOP_KINDS = ["none", "shared_s", "shared_m", "dedicated"] as const;

export type DesktopKind = (typeof DESKTOP_KINDS)[number];

export type Placement = "pool" | "dedicated";

export interface MachineSpec { vcpu: number; ramGb: number; diskGb: number }

export interface Range { min: number; max: number; step: number }

export interface Region { id: string; label: string; country: string }

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
  currency: "USD";
  bundles: BundleView[];
  licenses: LicenseOption[];
  desktops: DesktopOption[];
  dedicated: DedicatedPricing;
  regions: Region[];
  defaultRegion: string;
  /** percent off a year paid up front */
  yearlyDiscountPercent: number;
  creditPacks: CreditPack[];
  /** work use needs no license until this time; null once the grace is over */
  freeWorkUntil: number | null;
  /** days a cancelled or ended cloud desktop is kept, stopped, before it is destroyed */
  graceDays: number;
}

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

export interface CheckoutAnswer { v: typeof BILLING_API_VERSION; checkoutId: string; checkoutUrl: string; cloudId: string | null }

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
  /** the dashboard workspace its OpenMausBot install reports as */
  workspaceId: string | null;
  lastReportAt: number | null;
  /** when a cancelled or ended desktop is destroyed */
  destroyAt: number | null;
  error: string | null;
  subscriptionId: string | null;
  createdAt: number;
}

export interface BillingOverview {
  v: typeof BILLING_API_VERSION;
  subscriptions: SubscriptionView[];
  licenses: LicenseView[];
  license: LicenseCheck;
  clouds: CloudDesktopView[];
  credits: CreditsView;
  invoices: InvoicePage;
}
