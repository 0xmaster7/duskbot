import { describe, expect, it } from "vitest";
import { moneyIn, moneyViewOf, opsEventOf, withoutOps } from "./money-mode.ts";

describe("money mode", () => {
  const state = {
    subscriptions: [{ id: "s1", mode: "live" as const }, { id: "s2" }],
    invoices: [{ providerPaymentId: "p1", subscriptionId: "s1" }, { providerPaymentId: "p2", subscriptionId: "s2" }, { providerPaymentId: "p3", subscriptionId: null, mode: "live" as const }],
    refunds: [{ paymentId: "p2" }],
    ledger: [{ subscriptionId: "s2", providerPaymentId: null }],
    checkouts: [{ subscriptionId: "s1" }, { subscriptionId: null }],
    lastSync: 1,
  };
  it("counts an unstamped record in the server's mode, so preview's test money never reads as live", () => {
    const live = moneyIn(state, "live", "test");
    expect(live.subscriptions.map(row => row.id)).toEqual(["s1"]);
    expect(live.invoices.map(row => row.providerPaymentId)).toEqual(["p1", "p3"]);
    expect(live.refunds).toEqual([]);
    expect(live.ledger).toEqual([]);
    expect(live.checkouts).toEqual([{ subscriptionId: "s1" }]);
    expect(live.lastSync).toBe(1);
    const test = moneyIn(state, "test", "test");
    expect(test.invoices.map(row => row.providerPaymentId)).toEqual(["p2"]);
    expect(moneyIn(state, "all", "test")).toBe(state);
  });
  it("reads live unless the header asks for test or all", () => {
    expect([undefined, "", "LIVE", "live", ["test"]].map(moneyViewOf)).toEqual(["live", "live", "live", "live", "live"]);
    expect(moneyViewOf("test")).toBe("test");
    expect(moneyViewOf("all")).toBe("all");
  });
  it("drops what the operator gave and everything that hangs off it, and the billing events it wrote", () => {
    const state = {
      subscriptions: [{ id: "bought", checkoutId: "c1", source: "dash_home" }, { id: "grant", checkoutId: "c2", source: "ops_grant" }, { id: "review", checkoutId: "c3", source: null, review: true }],
      checkouts: [{ id: "c1", source: "dash_home", subscriptionId: "bought" }, { id: "c2", source: "ops_grant", subscriptionId: null }, { id: "c3", source: null, subscriptionId: "review" }, { id: "c4", source: "admin_comp", subscriptionId: null }],
      invoices: [{ accountId: "a", amountCents: 2000, providerPaymentId: "p1", subscriptionId: "bought", checkoutId: "c1" },
        { accountId: "b", amountCents: 1500, providerPaymentId: "p2", subscriptionId: null, checkoutId: "c2" },
        { accountId: "c", amountCents: 900, providerPaymentId: "p3", subscriptionId: null, checkoutId: "c4" }],
      refunds: [{ paymentId: "p2" }, { paymentId: "p1" }],
      ledger: [{ accountId: "a", at: 1, subscriptionId: "bought", providerPaymentId: null }, { accountId: "b", at: 2, subscriptionId: null, providerPaymentId: "p2" }, { accountId: "c", at: 3, subscriptionId: "review", providerPaymentId: null }],
    };
    const kept = withoutOps(state);
    expect(kept.subscriptions.map(row => row.id)).toEqual(["bought"]);
    expect(kept.checkouts.map(row => row.id)).toEqual(["c1"]);
    expect(kept.invoices.map(row => row.providerPaymentId)).toEqual(["p1"]);
    expect(kept.refunds).toEqual([{ paymentId: "p1" }]);
    expect(kept.ledger.map(row => row.at)).toEqual([1]);
    const ops = opsEventOf(state);
    expect(ops({ name: "billing", at: 2, accountId: "b", props: {} })).toBe(true);
    expect(ops({ name: "billing", at: 1, accountId: "a", props: {} })).toBe(false);
    expect(ops({ name: "checkout_paid", at: 5, accountId: "b", props: { amountCents: 1500 } })).toBe(true);
    expect(ops({ name: "checkout_paid", at: 5, accountId: "a", props: { amountCents: 2000 } })).toBe(false);
    expect(withoutOps({ subscriptions: [], checkouts: [], invoices: [] })).toEqual({ subscriptions: [], checkouts: [], invoices: [] });
  });
});
