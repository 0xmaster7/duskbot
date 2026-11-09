import type { BundleId, PlanCatalog } from "./contracts";
import { botsLine, bundleOf, desktopOf, gb } from "./pricing";

export type FunnelPlan = Extract<BundleId, "starter" | "pro">;

export interface Tradeoff { topic: string; free: string; paid: string }

/** what Free leaves out next to a paid plan, said plainly; every machine number comes from the catalog */
export function freeTradeoffs(catalog: PlanCatalog, plan: FunnelPlan): Tradeoff[] {
  const b = bundleOf(catalog, plan);
  const d = b ? desktopOf(catalog, b.desktop) : null;
  const rows: Tradeoff[] = [
    { topic: "Staying on", free: "Only while your Mac is awake, or on a server you keep running", paid: "On 24/7, with nothing to keep awake" },
    { topic: "Routines", free: "Pause while your Mac sleeps", paid: "Run on time, day and night" },
    { topic: "Bot computers", free: "Share your Mac's CPU and memory", paid: d ? `${botsLine(d.botComputers)} on ${d.vcpu} vCPU and ${gb(d.ramGb)} RAM of their own` : "A machine of their own" },
    { topic: "Setup", free: "You install and look after it", paid: "Set up in one click" },
  ];
  if (b && b.license !== "personal") rows.push({ topic: "Work use", free: "Personal use only", paid: "Work license included" });
  return rows;
}

/** the one line under a paid plan's name on the start screen */
export function planLine(catalog: PlanCatalog, plan: FunnelPlan): string {
  const b = bundleOf(catalog, plan);
  const d = b ? desktopOf(catalog, b.desktop) : null;
  if (!b || !d) return "";
  return `${botsLine(d.botComputers)}${d.priority ? ", priority wake" : ""}${b.license !== "personal" ? ", work license" : ""}`;
}
