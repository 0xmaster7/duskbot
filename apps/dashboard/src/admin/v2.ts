// the v2 admin contract, as written in docs/admin-api.md
import type { ServerIdentity } from "./identity";

export type Person = ServerIdentity & { id: string; emailKind: "email" | "apple_relay" | "none"; providers: string[]; avatarSeed: string; label: string; test: boolean };
export type SubscriptionStatus = "pending" | "trial" | "active" | "payment_problem" | "cancelling" | "cancelled" | "ended";
export interface ModeTotals {
  grossCents: number; taxCents: number; chargedCents: number; refundsCents: number; netCents: number;
  payments: number; failed: number; refunds: number; customers: number; activeSubscriptions: number; mrrCents: number; currency: string;
}
export interface OverviewV2 {
  data: string; now: number; days: number; from: number; range: string[];
  visitors: { unique: number; perDay: number[]; views: number[] };
  signups: { total: number; perDay: number[] };
  accounts: { total: number; active7d: number; activated: number };
  anonymous: { total: number };
  paying: { live: number; test: number };
  revenue: { live: ModeTotals; test: ModeTotals };
  waitlist: number | null;
  funnel: Array<{ id: "visited" | "signed_up" | "activated" | "paying"; label: string; count: number }>;
}
export interface AccountRowV2 {
  person: Person; createdAt: number; lastSeenAt: number | null; onboarded: boolean; installs: number; visitors: number; devices: number;
  plan: string | null; planStatus: SubscriptionStatus | null; paidCents: number; mrrCents: number; currency: string; lastPaidAt: number | null;
}
export interface PeopleV2 { data: string; kind: "accounts"; money: "live" | "test"; total: number; next: string | null; people: AccountRowV2[] }
export interface PaymentRow {
  id: string; at: number; type: "payment" | "refund"; status: "paid" | "refunded" | "partially_refunded" | "failed";
  amountCents: number; taxCents: number; netCents: number; refundedCents: number; currency: string;
  plan: string | null; interval: "month" | "year" | null; mode: "live" | "test"; source: string | null; personId: string;
}
export interface SubscriptionRow {
  id: string; personId: string; plan: string; interval: "month" | "year"; status: SubscriptionStatus; amountCents: number; mrrCents: number;
  currency: string; startedAt: number; currentPeriodEnd: number | null; mode: "live" | "test"; source: string | null;
}
export interface PersonMoney {
  personId: string; paidCents: number; refundedCents: number; netCents: number; payments: number; failed: number; currency: string;
  firstPaidAt: number | null; lastPaidAt: number | null; plan: string | null; status: SubscriptionStatus | null; mrrCents: number;
}
export interface PaymentsV2 {
  mode: "live" | "test" | "all"; serverMode: "live" | "test"; data: string;
  totals: { live: ModeTotals; test: ModeTotals };
  people: Array<PersonMoney & { mode: "live" | "test"; person: Person }>;
  subscriptions: Array<SubscriptionRow & { person: Person }>;
  payments: Array<PaymentRow & { person: Person }>;
  next: string | null;
}
export interface PersonV2<Profile> {
  data: string; person: Person;
  money: Record<"live" | "test", { summary: PersonMoney | null; payments: PaymentRow[]; subscriptions: SubscriptionRow[] }>;
  profile: Profile | null;
}
export const LIVE_PLAN = new Set<SubscriptionStatus>(["active", "payment_problem", "cancelling"]);
