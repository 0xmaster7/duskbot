import assert from "node:assert/strict";
import test from "node:test";
import { BILLING_CONFIG, catalogView } from "../../server/billing/plans.ts";
import { catalogFromWire } from "./live.ts";
import type { Selection } from "./contracts.ts";
import { planTotal } from "./pricing.ts";

const catalog = catalogFromWire(catalogView(Date.UTC(2027, 0, 1), BILLING_CONFIG));
const sel = (license: Selection["license"], desktop: Selection["desktop"]): Selection => ({ license, members: license === "team" ? 2 : 1, desktop, size: null, region: "fsn1", interval: "month" });

test("prices a resize as the whole plan the plans page sells, license included", () => {
  assert.deepEqual(planTotal(catalog, sel("personal", "shared-s")), { amount: "$20", unit: "/mo", note: "cloud size only" });
  assert.deepEqual(planTotal(catalog, sel("starter", "shared-m")), { amount: "$50", unit: "/mo", note: "with your work license" });
  assert.deepEqual(planTotal(catalog, sel("team", "dedicated")), { amount: "$119", unit: "/mo", note: "with your team license" });
  assert.equal(planTotal(catalog, { ...sel("personal", "dedicated"), interval: "year" }).unit, "/yr");
});
