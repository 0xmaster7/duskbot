import { describe, expect, it } from "vitest";
import type { Cart } from "../../../shared/billing-api.ts";
import { BILLING_CONFIG as config, catalogView, dodoProducts } from "./plans.ts";
import { changeCharge, dedicatedMonthlyCents, dodoCart, dodoCreditsCart, parseCart, quote } from "./pricing.ts";

const preset = (index: number, interval: Cart["interval"] = "month"): Cart => ({ ...structuredClone(config.bundles[index].cart), interval });
const products = Object.fromEntries(["month", "year"].flatMap(interval => ["license_solo", "license_team", "desktop_shared_s", "desktop_shared_m", "desktop_dedicated", "addon_member", "addon_shared_s", "addon_shared_m", "addon_dedicated", "addon_vcpu", "addon_ram_gb", "addon_disk_10gb"].map(key => [`${key}:${interval}`, `${key}_${interval}`])));

describe("billing pricing", () => {
  it("quotes every preset monthly and yearly from one catalog", () => {
    expect(config.bundles.map((_, index) => quote(preset(index), config).totalCents)).toEqual([0, 2000, 5000, 10000]);
    expect(config.bundles.map((_, index) => quote(preset(index, "year"), config).monthlyEquivalentCents)).toEqual([0, 1600, 4000, 8000]);
    expect(config.bundles.map((_, index) => quote(preset(index), config).bundle)).toEqual(["free", "starter", "pro", "team"]);
    expect(catalogView(0).bundles.map(bundle => bundle.monthlyCents)).toEqual([0, 2000, 5000, 10000]);
    expect(catalogView(Date.UTC(2030, 0, 1)).freeWorkUntil).toBeNull();
  });
  it("quotes the live team cart with separate annual line items and discount", () => {
    const result = quote({ interval: "year", license: { kind: "team", members: 5 }, desktop: { kind: "shared_m", region: "fsn1" } }, config);
    expect(result.lines).toEqual([
      { kind: "license", label: "Team license, 3 members", amountCents: 48000 },
      { kind: "members", label: "2 extra members", amountCents: 36000 },
      { kind: "desktop", label: "Shared M cloud desktop", amountCents: 48000 },
      { kind: "discount", label: "Yearly discount (20%)", amountCents: -26400 },
    ]);
    expect(result).toMatchObject({ totalCents: 105600, monthlyEquivalentCents: 8800, members: 5, bundle: null, botComputers: 5, machine: { vcpu: 4, ramGb: 8, diskGb: 80 } });
  });
  it("prices and validates dedicated units, ranges and steps", () => {
    expect(dedicatedMonthlyCents({ vcpu: 8, ramGb: 16, diskGb: 160 }, config)).toBe(6000);
    for (const spec of [{ vcpu: 2, ramGb: 4, diskGb: 40 }, { vcpu: 32, ramGb: 64, diskGb: 1000 }]) expect(parseCart({ ...preset(3), desktop: { kind: "dedicated", region: "sin", spec } }, config)).not.toBeNull();
    for (const spec of [{ vcpu: 3, ramGb: 16, diskGb: 160 }, { vcpu: 34, ramGb: 16, diskGb: 160 }, { vcpu: 8, ramGb: 6, diskGb: 160 }, { vcpu: 8, ramGb: 68, diskGb: 160 }, { vcpu: 8, ramGb: 16, diskGb: 45 }, { vcpu: 8, ramGb: 16, diskGb: 1010 }]) expect(parseCart({ ...preset(3), desktop: { kind: "dedicated", region: "fsn1", spec } }, config)).toBeNull();
  });
  it("rejects malformed carts and normalizes solo members", () => {
    for (const cart of [null, {}, { ...preset(1), interval: "week" }, { ...preset(1), license: { kind: "bad" } }, { ...preset(1), license: { kind: "team", members: 2 } }, { ...preset(1), license: { kind: "team", members: 51 } }, { ...preset(1), license: { kind: "team", members: 3.5 } }, { ...preset(1), license: { kind: "solo", members: 2 } }, { ...preset(1), desktop: { kind: "shared_s", region: "sin" } }, { ...preset(1), desktop: { kind: "shared_s", region: "missing" } }, { ...preset(1), desktop: { kind: "shared_s", region: "fsn1", spec: {} } }, { ...preset(1), desktop: { kind: "none", spec: {} } }, { ...preset(1), unexpected: true }]) expect(parseCart(cart, config)).toBeNull();
    expect(parseCart({ ...preset(1), license: { kind: "solo", members: 1 } }, config)).toEqual(preset(1));
    expect(quote({ interval: "month", license: { kind: "none" }, desktop: { kind: "shared_s", region: "fsn1" } }).members).toBe(0);
  });
  it("maps license bases, desktop bases and dedicated units", () => {
    expect(dodoCart(preset(1), products)).toEqual([{ productId: "license_solo_month", quantity: 1, addons: [{ addonId: "addon_shared_s_month", quantity: 1 }] }]);
    expect(dodoCart({ ...preset(2), license: { kind: "none" } }, products)).toEqual([{ productId: "desktop_shared_m_month", quantity: 1, addons: [] }]);
    const addons = [{ addonId: "addon_vcpu_year", quantity: 8 }, { addonId: "addon_ram_gb_year", quantity: 16 }, { addonId: "addon_disk_10gb_year", quantity: 12 }];
    expect(dodoCart(preset(3, "year"), products)).toEqual([{ productId: "license_team_year", quantity: 1, addons: [{ addonId: "addon_dedicated_year", quantity: 1 }, ...addons] }]);
    expect(dodoCart({ ...preset(3, "year"), license: { kind: "none" } }, products)).toEqual([{ productId: "desktop_dedicated_year", quantity: 1, addons }]);
    expect(dodoCart({ ...preset(3), license: { kind: "team", members: 5 } }, products)![0].addons[0]).toEqual({ addonId: "addon_member_month", quantity: 2 });
    const minimum = { ...preset(3), desktop: { kind: "dedicated" as const, region: "fsn1", spec: { vcpu: 2, ramGb: 4, diskGb: 40 } } };
    expect(dodoCart(minimum, products)![0].addons).not.toContainEqual(expect.objectContaining({ addonId: "addon_disk_10gb_month" }));
    expect(dodoCart(preset(1), {})).toBeNull(); expect(dodoCart(preset(1), { "license_solo:month": "solo" })).toBeNull();
    expect(dodoCreditsCart("c10", {})).toBeNull(); expect(dodoCreditsCart("c10", { credits_c10: "credits" })).toEqual([{ productId: "credits", quantity: 1, addons: [] }]);
  });
  it("charges the difference on upgrades, nothing on downgrades, and validates product configuration", () => {
    expect(changeCharge(2000, 5000)).toBe(3000); expect(changeCharge(5000, 2000)).toBe(0);
    expect(dodoProducts({ OMB_DODO_PRODUCTS: '{"license_solo:month":"p1"}' })).toEqual({ "license_solo:month": "p1" });
    expect(() => dodoProducts({ OMB_DODO_PRODUCTS: '{"bad":1}' })).toThrow();
  });
});
