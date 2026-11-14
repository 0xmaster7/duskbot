import type { createBilling } from "../billing/index.ts";
import { BILLING_CONFIG } from "../billing/plans.ts";
import { BillingError, OPEN_ENDED_AT } from "../billing/service.ts";
import type { StoredSubscription } from "../billing/store.ts";
import type { AccountRef } from "../billing/types.ts";

type Billing = ReturnType<typeof createBilling>;
type Detail = Record<string, string | number | boolean | null>;

export const PLAN_ACTIONS = ["grant", "change", "set_end", "cancel", "keep", "note"] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];
const PAID_BUNDLES = ["starter", "pro", "team"] as const;
const COMP_SOURCES = ["admin_comp", "ops_grant"];
const LIVE = ["active", "payment_problem", "cancelled"];

export class PlanError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const invalid = (): never => { throw new PlanError(400, "invalid_request", "Invalid request."); };

export interface PlanSubscriptionRow {
  id: string; plan: string | null; bundle: string | null; interval: "month" | "year"; status: StoredSubscription["status"]; totalCents: number;
  periodStart: number | null; periodEnd: number | null; openEnded: boolean; cancelAtPeriodEnd: boolean; cloudId: string | null; source: string | null; comp: boolean; createdAt: number;
}
export interface PlanBillingInfo { grants: boolean; provider: "preview" | "fake" | "dodo" | "off"; plans: Array<{ id: string; label: string; monthlyCents: number }> }

const labelOf = (bundle: string | null) => BILLING_CONFIG.bundles.find(item => item.id === bundle)?.label.toLowerCase() ?? (bundle ? "custom" : null);
const openEnded = (sub: Pick<StoredSubscription, "currentPeriodEnd">) => sub.currentPeriodEnd !== null && sub.currentPeriodEnd >= OPEN_ENDED_AT;

function until(value: unknown, now: number) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= now || value >= OPEN_ENDED_AT) return invalid();
  return value;
}

export function createPlanEditor(deps: { billing: Billing; now: () => number; audit(actor: string, action: string, target: string | null, detail: Detail): Promise<void> }) {
  const { billing, now } = deps;
  const stored = (id: string) => billing.store.state.subscriptions.find(sub => sub.id === id) ?? null;
  const bundleOf = (accountId: string, id: string) => billing.service.subscriptions(accountId).find(view => view.id === id)?.bundle ?? null;

  function describe(sub: StoredSubscription | null) {
    if (!sub) return "none";
    const end = sub.status === "ended" ? "" : openEnded(sub) ? " open-ended" : sub.currentPeriodEnd !== null ? ` until ${new Date(sub.currentPeriodEnd).toISOString().slice(0, 10)}` : "";
    return `${labelOf(bundleOf(sub.accountId, sub.id)) ?? "plan"} ${sub.status}${end}${sub.cancelAtPeriodEnd && sub.status !== "ended" ? " cancelling" : ""}`;
  }
  function subscriptions(accountId: string): PlanSubscriptionRow[] {
    return billing.service.subscriptions(accountId).map(view => {
      const sub = stored(view.id)!;
      return { id: sub.id, plan: labelOf(view.bundle), bundle: view.bundle, interval: sub.cart.interval, status: sub.status, totalCents: sub.totalCents,
        periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, openEnded: openEnded(sub), cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        cloudId: sub.cloudId, source: sub.source ?? null, comp: sub.review === true || COMP_SOURCES.includes(sub.source ?? ""), createdAt: sub.createdAt };
    });
  }
  function info(): PlanBillingInfo {
    return { grants: billing.operator.grants, provider: billing.operator.provider,
      plans: billing.service.catalog().bundles.map(bundle => ({ id: bundle.id, label: bundle.label.toLowerCase(), monthlyCents: bundle.monthlyCents })) };
  }
  function live(accountId: string, requested: unknown) {
    if (requested !== undefined && (typeof requested !== "string" || requested.length > 100)) invalid();
    const subs = billing.store.state.subscriptions.filter(sub => sub.accountId === accountId && LIVE.includes(sub.status) && (requested === undefined || sub.id === requested));
    return subs.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }
  function needLive(accountId: string, requested: unknown) {
    const sub = live(accountId, requested);
    if (!sub) throw new PlanError(409, "not_subscribed", "This person has no live plan.");
    return sub;
  }
  function needGrants() { if (!billing.operator.grants) throw new PlanError(409, "grants_unavailable", "Plans can only be granted or re-dated while billing runs on the preview or fake provider."); }

  async function edit(owner: AccountRef, account: AccountRef, input: Record<string, unknown>): Promise<void> {
    const action = input.action as PlanAction;
    if (!PLAN_ACTIONS.includes(action)) invalid();
    if (action === "note") {
      if (typeof input.text !== "string") invalid();
      const text = (input.text as string).trim();
      if (!text || text.length > 500) invalid();
      await deps.audit(owner.id, "person.note", account.id, { text });
      return;
    }
    let auditAction = `plan.${action}`, target: StoredSubscription | null = null, inputs: Detail = {};
    let run: () => Promise<string | null>;
    if (action === "grant") {
      if (!PAID_BUNDLES.includes(input.plan as (typeof PAID_BUNDLES)[number])) invalid();
      if (input.interval !== undefined && input.interval !== "month" && input.interval !== "year") invalid();
      const end = until(input.until, now()), interval = input.interval === "year" ? "year" as const : "month" as const;
      inputs = { plan: input.plan as string, interval, until: end };
      needGrants();
      if (live(account.id, undefined)) throw new PlanError(409, "already_subscribed", "This person already has a live plan.");
      run = async () => (await billing.operator.grant(account, { bundle: input.plan as string, interval, source: "admin_comp", amountCents: 0, until: end ?? OPEN_ENDED_AT })).subscriptionId;
    } else if (action === "change") {
      const plan = input.plan as string;
      if (plan !== "free" && !PAID_BUNDLES.includes(plan as (typeof PAID_BUNDLES)[number])) invalid();
      inputs = { plan };
      target = needLive(account.id, input.subscription);
      const sub = target;
      if (plan === "free") run = async () => { await billing.service.endNow(account, sub.id); return sub.id; };
      else {
        const bundle = BILLING_CONFIG.bundles.find(item => item.id === plan)!;
        run = async () => { await billing.service.operatorChange(account, sub.id, billing.service.quote({ ...bundle.cart, interval: sub.cart.interval }).cart); return sub.id; };
      }
    } else if (action === "set_end") {
      const end = until(input.until, now());
      inputs = { until: end };
      target = needLive(account.id, input.subscription);
      needGrants();
      const sub = target;
      run = async () => { billing.operator.setEnd(account, sub.id, end ?? OPEN_ENDED_AT); return sub.id; };
    } else if (action === "cancel") {
      if (input.when !== "now" && input.when !== "period_end") invalid();
      inputs = { when: input.when as string };
      auditAction = input.when === "now" ? "plan.cancel_now" : "plan.cancel_at_end";
      target = needLive(account.id, input.subscription);
      const sub = target;
      run = input.when === "now" ? async () => { await billing.service.endNow(account, sub.id); return sub.id; } : async () => { await billing.service.cancel(account, sub.id); return sub.id; };
    } else {
      target = needLive(account.id, input.subscription);
      const sub = target;
      run = async () => { await billing.service.keep(account, sub.id); return sub.id; };
    }
    const before = describe(target);
    let changed: string | null;
    try { changed = await run(); }
    catch (error) {
      const code = error instanceof BillingError || error instanceof PlanError ? error.code : "failed";
      await deps.audit(owner.id, auditAction, account.id, { ok: false, code, subscription: target?.id ?? null, ...inputs });
      if (error instanceof BillingError) throw new PlanError(error.status, error.code, error.status === 503 ? "Billing refused that change. Try again." : "That change is not possible in this plan's current state.");
      throw error;
    }
    const after = changed ? stored(changed) : null;
    await deps.audit(owner.id, auditAction, account.id, { ok: true, subscription: changed, before, after: describe(after), ...inputs });
  }
  return { edit, subscriptions, info };
}
