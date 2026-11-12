import type { Cart, MachineSpec, Quote } from "../../../../shared/billing-api.ts";
import type { BillingConfig } from "./plans.ts";
import { BILLING_CONFIG } from "./plans.ts";
import type { ProviderCartLine } from "./types.ts";

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]) { return Object.keys(value).every(key => allowed.includes(key)); }
export function parseCart(input: unknown, config: BillingConfig = BILLING_CONFIG): Cart | null {
  if (!object(input) || !keys(input, ["interval", "license", "desktop"]) || (input.interval !== "month" && input.interval !== "year")) return null;
  const { license, desktop } = input;
  if (!object(license) || !object(desktop) || !keys(license, ["kind", "members"]) || !keys(desktop, ["kind", "region", "spec"])) return null;
  if (license.kind !== "none" && license.kind !== "solo" && license.kind !== "team") return null;
  if (license.kind === "team") {
    if (!Number.isInteger(license.members) || (license.members as number) < config.licenses.team.includedMembers || (license.members as number) > config.licenses.team.maxMembers) return null;
  } else if (license.members !== undefined && license.members !== 1) return null;
  if (desktop.kind !== "none" && desktop.kind !== "shared_s" && desktop.kind !== "shared_m" && desktop.kind !== "dedicated") return null;
  if (desktop.kind === "none") {
    if (desktop.region !== undefined || desktop.spec !== undefined) return null;
  } else {
    if (typeof desktop.region !== "string" || !config.regions.some(region => region.id === desktop.region)) return null;
    if (desktop.kind !== "dedicated" && (!config.poolRegions.includes(desktop.region) || desktop.spec !== undefined)) return null;
    if (desktop.kind === "dedicated") {
      if (!object(desktop.spec) || !keys(desktop.spec, ["vcpu", "ramGb", "diskGb"])) return null;
      for (const key of ["vcpu", "ramGb", "diskGb"] as const) {
        const value = desktop.spec[key], range = config.dedicated[key];
        if (typeof value !== "number" || !Number.isInteger(value) || value < range.min || value > range.max || (value - range.min) % range.step !== 0) return null;
      }
      // only a size the provider makes: no rounding up to a bigger machine than the one priced
      const { vcpu, ramGb } = desktop.spec;
      if (!config.dedicated.sizes.some(size => size.vcpu === vcpu && size.ramGb === ramGb)) return null;
    }
  }
  return { interval: input.interval, license: license.kind === "team" ? { kind: "team", members: license.members as number } : { kind: license.kind },
    desktop: desktop.kind === "none" ? { kind: "none" } : { kind: desktop.kind, region: desktop.region as string, ...(desktop.kind === "dedicated" ? { spec: { ...desktop.spec as unknown as MachineSpec } } : {}) } };
}

export function dedicatedMonthlyCents(spec: MachineSpec, config: BillingConfig = BILLING_CONFIG) {
  const p = config.dedicated;
  return p.baseCents + spec.vcpu * p.perVcpuCents + spec.ramGb * p.perGbRamCents + (spec.diskGb - p.includedDiskGb) / 20 * p.per20GbDiskCents;
}
export function sameCart(a: Cart, b: Cart) {
  return a.interval === b.interval && a.license.kind === b.license.kind && (a.license.members ?? 1) === (b.license.members ?? 1)
    && a.desktop.kind === b.desktop.kind && a.desktop.region === b.desktop.region
    && a.desktop.spec?.vcpu === b.desktop.spec?.vcpu && a.desktop.spec?.ramGb === b.desktop.spec?.ramGb && a.desktop.spec?.diskGb === b.desktop.spec?.diskGb;
}
/** the bundle a cart is, whatever region it runs in: a plan is the same plan in every region */
export function bundleOf(cart: Cart, config: BillingConfig = BILLING_CONFIG): Quote["bundle"] {
  const plain = (c: Cart): Cart => c.desktop.kind === "none" ? c : { ...c, desktop: { ...c.desktop, region: "" } };
  return config.bundles.find(bundle => sameCart(plain(cart), plain({ ...bundle.cart, interval: cart.interval })))?.id ?? null;
}
export function quote(cart: Cart, config: BillingConfig = BILLING_CONFIG): Quote {
  const lines: Quote["lines"] = [], multiplier = cart.interval === "year" ? 12 : 1;
  const members = cart.license.kind === "none" ? 0 : cart.license.kind === "solo" ? 1 : cart.license.members!;
  if (cart.license.kind !== "none") {
    const license = config.licenses[cart.license.kind];
    lines.push({ kind: "license", label: `${license.label}, ${license.includedMembers} ${license.includedMembers === 1 ? "member" : "members"}`, amountCents: license.monthlyCents * multiplier });
    const extra = members - license.includedMembers;
    if (extra > 0) lines.push({ kind: "members", label: `${extra} extra ${extra === 1 ? "member" : "members"}`, amountCents: extra * license.extraMemberCents! * multiplier });
  }
  let machine: MachineSpec | null = null, botComputers: number | null = null;
  if (cart.desktop.kind !== "none") {
    const desktop = config.desktops[cart.desktop.kind];
    machine = { ...(cart.desktop.spec ?? desktop.machine) }; botComputers = desktop.botComputers;
    lines.push({ kind: "desktop", label: cart.desktop.kind === "dedicated" ? `dusk cloud dedicated, ${machine.vcpu} vCPU, ${machine.ramGb} GB, ${machine.diskGb} GB` : `dusk cloud ${desktop.label.toLowerCase()}`,
      amountCents: (cart.desktop.kind === "dedicated" ? dedicatedMonthlyCents(machine, config) : desktop.monthlyCents!) * multiplier });
  }
  const sum = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (cart.interval === "year") lines.push({ kind: "discount", label: Math.abs(config.yearlyDiscountPercent - 100 / 6) < 0.001 ? "Yearly, 2 months free" : `Yearly discount (${Number(config.yearlyDiscountPercent.toFixed(1))}%)`, amountCents: -Math.round(sum * config.yearlyDiscountPercent / 100) });
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  return { cart: structuredClone(cart), bundle: bundleOf(cart, config),
    lines, totalCents, monthlyEquivalentCents: cart.interval === "year" ? Math.round(totalCents / 12) : totalCents, machine, botComputers, members };
}

/** the DUSK_DODO_PRODUCTS keys a cart needs, base product first, each add-on with the quantity it is sent with */
export function dodoCartKeys(cart: Cart, config: BillingConfig = BILLING_CONFIG): Array<{ key: string; quantity: number }> {
  const hasLicense = cart.license.kind !== "none";
  if (!hasLicense && cart.desktop.kind === "none") return [];
  const keys = [{ key: `${hasLicense ? `license_${cart.license.kind}` : `desktop_${cart.desktop.kind}`}:${cart.interval}`, quantity: 1 }];
  const add = (key: string, quantity: number) => { if (quantity) keys.push({ key: `${key}:${cart.interval}`, quantity }); };
  if (cart.license.kind === "team") add("addon_member", cart.license.members! - config.licenses.team.includedMembers);
  if (hasLicense && cart.desktop.kind !== "none") add(`addon_${cart.desktop.kind}`, 1);
  if (cart.desktop.kind === "dedicated") {
    add("addon_vcpu", cart.desktop.spec!.vcpu); add("addon_ram_gb", cart.desktop.spec!.ramGb);
    add("addon_disk_20gb", (cart.desktop.spec!.diskGb - config.dedicated.includedDiskGb) / 20);
  }
  return keys;
}
/** the cart as dodo ids, or null when it is empty or any key it needs is missing from DUSK_DODO_PRODUCTS */
export function dodoCart(cart: Cart, products: Record<string, string>, config: BillingConfig = BILLING_CONFIG): ProviderCartLine[] | null {
  const keys = dodoCartKeys(cart, config);
  if (!keys.length || keys.some(({ key }) => !products[key])) return null;
  const [base, ...addons] = keys;
  return [{ productId: products[base.key], quantity: 1, addons: addons.map(({ key, quantity }) => ({ addonId: products[key], quantity })) }];
}
/** what dodo charges now for a plan change in difference_immediately mode (the billing cycle restarts that day) */
export function changeCharge(fromTotalCents: number, toTotalCents: number) { return Math.max(0, toTotalCents - fromTotalCents); }
