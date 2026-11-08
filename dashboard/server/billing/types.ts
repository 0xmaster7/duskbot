/** what a checkout charges, as product ids the provider knows (plans.ts dodoCart): the base line, the rest as addons */
export interface ProviderCartLine { productId: string; quantity: number; addons: Array<{ addonId: string; quantity: number }> }

export interface CreateCheckoutInput {
  /** our checkout id; sent as metadata and read back from every webhook */
  checkoutId: string;
  accountId: string;
  email: string;
  customerId: string | null;
  cart: ProviderCartLine[];
  returnUrl: string;
  /** local quote for the fake provider; never sent to dodo */
  billing?: { interval: "month" | "year" | null; amountCents: number; currency: string };
}

/** a provider webhook after its signature was verified, mapped to our words */
export type BillingEvent =
  | { kind: "subscription"; type: "active" | "renewed" | "on_hold" | "failed" | "cancelled" | "expired" | "plan_changed" | "updated";
      subscriptionId: string; customerId: string | null; checkoutId: string | null; productId: string | null;
      addons: Array<{ addonId: string; quantity: number }>; nextBillingAt: number | null; cancelAtPeriodEnd: boolean; status: string | null }
  | { kind: "payment"; type: "succeeded" | "failed"; paymentId: string; subscriptionId: string | null; customerId: string | null;
      checkoutId: string | null; amountCents: number; currency: string }
  | { kind: "refund"; refundId: string; paymentId: string; amountCents: number; currency: string }
  | { kind: "ignored"; type: string };

export interface VerifiedWebhook { id: string; at: number; event: BillingEvent }

export interface ChangePlanInput { subscriptionId: string; productId: string; addons: Array<{ addonId: string; quantity: number }>; billing?: CreateCheckoutInput["billing"] }

/** payments backend: fake for tests and dev, dodo when configured. no method ever logs a secret. */
export interface BillingProvider {
  readonly name: "fake" | "dodo";
  createCheckout(input: CreateCheckoutInput): Promise<{ sessionId: string; url: string }>;
  portal(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** throws BillingProviderError("bad_signature") unless the raw body is signed and fresh */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): VerifiedWebhook;
  cancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void>;
  changePlan(input: ChangePlanInput): Promise<void>;
  /** a url the owner's browser may open for this payment's invoice */
  invoiceUrl(paymentId: string): Promise<string | null>;
  invoicePdf(paymentId: string): Promise<{ contentType: string; body: Buffer } | null>;
}

export class BillingProviderError extends Error {
  code: "bad_signature" | "unavailable" | "refused";
  constructor(code: "bad_signature" | "unavailable" | "refused", message: string = code) { super(message); this.code = code; }
}

/** the account behind a request: dashboard cookie or app bearer token. swapped for shared/account-api.ts once it lands. */
export interface AccountRef { id: string; email: string }
export interface AccountResolver {
  /** the dashboard's signed-in account (HttpOnly cookie), or null */
  fromCookie(cookieHeader: string | undefined): AccountRef | null | Promise<AccountRef | null>;
  /** the app's signed-in account (Authorization: Bearer omc_...), or null */
  fromBearer(token: string): AccountRef | null | Promise<AccountRef | null>;
}
