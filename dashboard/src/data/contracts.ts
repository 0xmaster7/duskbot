// the account and billing shapes the dashboard reads. they follow CLOUD-PLAN.md until shared/account-api.ts and
// shared/billing-api.ts land; then these become re-exports of those files.

export type IdentityProvider = "google" | "x" | "apple" | "email";

export interface AccountProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: number;
  /** false until the first-run onboarding is finished or skipped */
  onboarded: boolean;
}

export interface Identity {
  provider: IdentityProvider;
  /** the address or handle it signs in as */
  label: string;
  linkedAt: number;
}

export interface AccountDevice {
  id: string;
  kind: "browser" | "desktop" | "phone";
  label: string;
  platform: string | null;
  location: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  current: boolean;
}

export interface NotificationPrefs {
  cloudStatus: boolean;
  billing: boolean;
  botDigest: boolean;
  product: boolean;
}

/** which sign-in buttons work on this instance; a disabled one is not configured yet */
export interface AuthProviders { providers: Array<{ id: IdentityProvider; enabled: boolean; comingSoon?: boolean }> }

export interface EmailCodeStart { attempt: string; resendAfter: number; expiresIn: number; codeLength: number }

export type BillingInterval = "month" | "year";

export interface MachineSpec { vcpu: number; ramGb: number; diskGb: number }

/** personal is the free, non-commercial use; work needs starter or team */
export type LicenseId = "personal" | "starter" | "team";

export interface LicenseTier {
  id: LicenseId;
  name: string;
  /** usd per month on monthly billing */
  monthly: number;
  includedMembers: number;
  /** usd per month for each member past the included ones; 0 when it cannot grow */
  perExtraMember: number;
  maxMembers: number;
  work: boolean;
  blurb: string;
}

export type DesktopId = "none" | "shared-s" | "shared-m" | "dedicated";

export interface DesktopTier extends MachineSpec {
  id: Exclude<DesktopId, "none">;
  name: string;
  monthly: number;
  /** shared runs on our pool of big hosts in its own sandbox; dedicated is a whole machine */
  placement: "shared" | "dedicated";
  /** null is unlimited */
  botComputers: number | null;
  priority: boolean;
  blurb: string;
  /** dedicated machines can be sized with the custom pricing */
  sizable: boolean;
}

export type BundleId = "free" | "starter" | "pro" | "team";

export interface Bundle {
  id: BundleId;
  name: string;
  /** usd per month on monthly billing; may be less than its parts */
  monthly: number;
  license: LicenseId;
  members: number;
  desktop: DesktopId;
  blurb: string;
  features: string[];
  recommended?: boolean;
}

export interface Region { id: string; name: string; city: string }

export interface Range { min: number; max: number; step: number }

/** prices a dedicated machine sized with the sliders */
export interface CustomPricing {
  base: number;
  perVcpu: number;
  perGbRam: number;
  /** per 10 GB past includedDiskGb */
  per10GbDisk: number;
  includedDiskGb: number;
  vcpu: Range;
  ramGb: Range;
  diskGb: Range;
}

export interface CreditPack { id: string; usd: number }

export interface PlanCatalog {
  bundles: Bundle[];
  licenses: LicenseTier[];
  desktops: DesktopTier[];
  custom: CustomPricing;
  regions: Region[];
  /** where shared desktops can be bought; absent means every region */
  poolRegions?: string[];
  /** 0.2 = yearly billing costs 20% less */
  yearlyDiscount: number;
  /** work use is free until then (an early grace period); null when it is over */
  workFreeUntil: number | null;
  creditPacks: CreditPack[];
}

/** what the builder holds and checkout buys: one subscription with a line per part */
export interface Selection {
  license: LicenseId;
  members: number;
  desktop: DesktopId;
  /** a sized dedicated machine; null keeps the tier's own size */
  size: MachineSpec | null;
  region: string;
  interval: BillingInterval;
}

export interface Subscription {
  id: string;
  bundle: BundleId | null;
  selection: Selection;
  status: "pending" | "active" | "past_due" | "canceled";
  /** what each period charges, after the yearly discount */
  amountUsd: number;
  currentPeriodEnd: number;
  cancelAt: number | null;
}

export interface PaymentMethod { brand: string; last4: string; expMonth: number; expYear: number }

export interface Invoice {
  id: string;
  number: string;
  date: number;
  description: string;
  amountUsd: number;
  status: "paid" | "open" | "refunded";
  url: string | null;
}

export interface Credits { balanceUsd: number; autoTopUp: boolean; usedThisMonthUsd: number }

export interface BillingOverview {
  subscription: Subscription | null;
  paymentMethod: PaymentMethod | null;
  invoices: Invoice[];
  credits: Credits;
}

export type CloudStatus = "provisioning" | "running" | "sleeping" | "stopped" | "error";

export interface CloudDesktop extends MachineSpec {
  id: string;
  name: string;
  status: CloudStatus;
  tier: Exclude<DesktopId, "none">;
  placement: "shared" | "dedicated";
  region: string;
  /** the workspace its reports arrive under, once it has linked */
  workspaceId: string | null;
  createdAt: number;
  /** while provisioning: 0..1 and what it is doing */
  progress: { step: string; value: number } | null;
  error: string | null;
  botComputers: { used: number; limit: number | null };
  uptimeSec: number | null;
}

export type CheckoutRequest =
  | { kind: "plan"; selection: Selection; bundle: BundleId | null }
  | { kind: "credits"; pack: string };

/** the provider's hosted checkout; the dashboard opens it and waits for the webhook to land */
export interface CheckoutAnswer { url: string; id: string }
