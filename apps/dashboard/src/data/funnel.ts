import type { BundleId, PlanCatalog } from "./contracts";
import { botsLine, bundleOf, desktopOf, gb } from "./pricing";

export type FunnelPlan = Extract<BundleId, "starter" | "pro">;

export interface Tradeoff { topic: string; free: string; paid: string }

/** what Free leaves out next to a paid plan, said plainly; every machine number comes from the catalog */
export function freeTradeoffs(catalog: PlanCatalog, plan: FunnelPlan): Tradeoff[] {
  const b = bundleOf(catalog, plan);
  const d = b ? desktopOf(catalog, b.desktop) : null;
  const rows: Tradeoff[] = [
    { topic: "staying on", free: "only while your mac is awake, or on a server you keep running", paid: "on 24/7, with nothing to keep awake" },
    { topic: "routines", free: "pause while your mac sleeps", paid: "run on time, day and night" },
    { topic: "bot computers", free: "share your mac's cpu and memory", paid: d ? `${botsLine(d.botComputers)} on ${d.vcpu} vcpu and ${gb(d.ramGb)} ram of their own` : "a machine of their own" },
    { topic: "setup", free: "you install and look after it", paid: "set up in one click" },
  ];
  if (b && b.license !== "personal") rows.push({ topic: "work use", free: "personal use only", paid: "work license included" });
  return rows;
}

/** the one line under a paid plan's name on the start screen */
export function planLine(catalog: PlanCatalog, plan: FunnelPlan): string {
  const b = bundleOf(catalog, plan);
  const d = b ? desktopOf(catalog, b.desktop) : null;
  if (!b || !d) return "";
  return `${botsLine(d.botComputers)}${d.priority ? ", priority wake" : ""}${b.license !== "personal" ? ", work license" : ""}`;
}
