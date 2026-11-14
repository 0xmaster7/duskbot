import { describe, expect, it } from "vitest";
import { moneyIn, moneyViewOf } from "./money-mode.ts";

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
});
