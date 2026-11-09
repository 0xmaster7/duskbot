import type { BundleView, Catalog, CreditPack, DedicatedPricing, DesktopOption, LicenseOption, Region } from "../../../../shared/billing-api.ts";
import { quote } from "./pricing.ts";

export interface BillingConfig {
  currency: "USD"; yearlyDiscountPercent: number; graceDays: number; maxCloudsPerAccount: number; checkoutOpenMinutes: number; checkoutsPerHour: number;
  freeWorkUntil: number | null;
  licenses: Record<"solo" | "team", LicenseOption>;
  desktops: Record<"shared_s" | "shared_m" | "dedicated", DesktopOption>;
  dedicated: DedicatedPricing;
  poolQuotas: Record<"shared_s" | "shared_m", { netMbps: number; pids: number }>;
  appAllowances: Record<"shared_s" | "shared_m" | "dedicated", { computerHours: number; voiceCharacters: number }>;
  trial: null;
  bundles: Array<Pick<BundleView, "id" | "label" | "cart" | "highlights">>;
  regions: Region[]; defaultRegion: string; poolRegions: string[]; creditPacks: CreditPack[]; products: Record<string, string>;
}

/**
 * OMB_DODO_PRODUCTS is a JSON object mapping these keys to dodo ids, with month and year intervals:
 * license_solo:<interval>, license_team:<interval>, desktop_shared_s:<interval>, desktop_shared_m:<interval>, desktop_dedicated:<interval>;
 * addon_member:<interval>, addon_shared_s:<interval>, addon_shared_m:<interval>, addon_dedicated:<interval>,
 * addon_vcpu:<interval>, addon_ram_gb:<interval>, addon_disk_10gb:<interval>; credits_c10, credits_c25, credits_c50.
 * base products and addons must match this config's prices; yearly prices include its yearly discount.
 */
export function dodoProducts(env: Record<string, string | undefined>): Record<string, string> {
  if (!env.OMB_DODO_PRODUCTS) return {};
  const value: unknown = JSON.parse(env.OMB_DODO_PRODUCTS);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(id => typeof id !== "string" || !id.trim())) throw new Error("Invalid OMB_DODO_PRODUCTS.");
  return value as Record<string, string>;
}

function freeWorkUntil(value: string | undefined) {
  if (value === "off") return null;
  if (value && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value))) return Date.parse(value);
  return Date.UTC(2026, 11, 1);
}

export const BILLING_CONFIG: BillingConfig = {
  // yearly is two months free: 12 months for the price of 10
  currency: "USD", yearlyDiscountPercent: 100 / 6, graceDays: 7, maxCloudsPerAccount: 5, checkoutOpenMinutes: 30, checkoutsPerHour: 10,
  freeWorkUntil: freeWorkUntil(process.env.OMB_FREE_WORK_UNTIL),
  licenses: {
    solo: { kind: "solo", label: "Work license", monthlyCents: 1200, includedMembers: 1, extraMemberCents: null, maxMembers: 1, priority: false },
    team: { kind: "team", label: "Team license", monthlyCents: 3000, includedMembers: 2, extraMemberCents: 1800, maxMembers: 50, priority: false },
  },
  desktops: {
    shared_s: { kind: "shared_s", label: "Shared S", placement: "pool", monthlyCents: 2000, machine: { vcpu: 2, ramGb: 4, diskGb: 40 }, botComputers: 2, priority: false },
    shared_m: { kind: "shared_m", label: "Shared M", placement: "pool", monthlyCents: 3800, machine: { vcpu: 4, ramGb: 8, diskGb: 80 }, botComputers: 5, priority: true },
    dedicated: { kind: "dedicated", label: "Dedicated", placement: "dedicated", monthlyCents: null, machine: { vcpu: 8, ramGb: 16, diskGb: 160 }, botComputers: null, priority: true },
  },
  dedicated: { baseCents: 1400, perVcpuCents: 300, perGbRamCents: 100, per10GbDiskCents: 50, includedDiskGb: 40,
    vcpu: { min: 2, max: 32, step: 2 }, ramGb: { min: 4, max: 64, step: 4 }, diskGb: { min: 40, max: 1000, step: 10 } },
  poolQuotas: { shared_s: { netMbps: 100, pids: 2048 }, shared_m: { netMbps: 250, pids: 4096 } },
  appAllowances: { shared_s: { computerHours: 720, voiceCharacters: 0 }, shared_m: { computerHours: 720, voiceCharacters: 0 }, dedicated: { computerHours: 720, voiceCharacters: 0 } },
  trial: null,
  // free $0, plus $20 (a cloud desktop), pro $50 (a bigger one and a work license for one person); the starter id sells as Plus
  bundles: [
    { id: "free", label: "Free", cart: { license: { kind: "none" }, desktop: { kind: "none" } }, highlights: ["Your bots, on your Mac", "Personal use", "No subscription"] },
    { id: "starter", label: "Plus", cart: { license: { kind: "none" }, desktop: { kind: "shared_s", region: "fsn1" } }, highlights: ["Your bots work 24/7", "A cloud desktop, on 24/7", "2 bot computers"] },
    { id: "pro", label: "Pro", cart: { license: { kind: "solo" }, desktop: { kind: "shared_m", region: "fsn1" } }, highlights: ["A bigger always-on cloud desktop", "5 bot computers, priority wake", "Work license for one person"] },
    { id: "team", label: "Team", cart: { license: { kind: "team", members: 2 }, desktop: { kind: "dedicated", region: "fsn1", spec: { vcpu: 8, ramGb: 16, diskGb: 160 } } }, highlights: ["Team license, 2 members", "Dedicated cloud desktop, unlimited bot computers", "8 vCPU, 16 GB RAM, 160 GB disk"] },
  ],
  regions: [{ id: "fsn1", label: "Falkenstein", country: "DE" }, { id: "nbg1", label: "Nuremberg", country: "DE" }, { id: "hel1", label: "Helsinki", country: "FI" }, { id: "ash", label: "Ashburn", country: "US" }, { id: "hil", label: "Hillsboro", country: "US" }, { id: "sin", label: "Singapore", country: "SG" }],
  defaultRegion: "fsn1", poolRegions: ["fsn1"],
  creditPacks: [{ id: "c10", label: "$10 credits", priceCents: 1000, creditCents: 1000 }, { id: "c25", label: "$25 credits", priceCents: 2500, creditCents: 2500 }, { id: "c50", label: "$50 credits", priceCents: 5000, creditCents: 5000 }],
  products: dodoProducts(process.env),
};

export function catalogView(now: number, config: BillingConfig = BILLING_CONFIG): Catalog {
  return structuredClone({ v: 1, currency: config.currency, bundles: config.bundles.map(bundle => ({ ...bundle,
    monthlyCents: quote({ ...bundle.cart, interval: "month" }, config).totalCents,
    yearlyMonthlyCents: quote({ ...bundle.cart, interval: "year" }, config).monthlyEquivalentCents })),
  licenses: Object.values(config.licenses), desktops: Object.values(config.desktops), dedicated: config.dedicated, regions: config.regions, poolRegions: config.poolRegions,
  defaultRegion: config.defaultRegion, yearlyDiscountPercent: config.yearlyDiscountPercent, creditPacks: config.creditPacks,
  freeWorkUntil: config.freeWorkUntil !== null && now < config.freeWorkUntil ? config.freeWorkUntil : null, graceDays: config.graceDays });
}
