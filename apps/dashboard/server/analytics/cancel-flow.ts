import { CANCEL_ANSWERS } from "../../../../shared/billing-api.ts";
import type { RetentionInput } from "../../../../shared/billing-api.ts";

export interface CancelFlowRow { reason: string; started: number; saved: number; cancelled: number }
export interface CancelFlowSummary { started: number; saved: number; cancelled: number; discounts: number; reasons: CancelFlowRow[] }

const SAVES = new Set<RetentionInput["outcome"]>(["discount", "downgrade", "helped", "kept"]);

/** the cancel flow over [from, to): how many started it, kept their plan (a save) or cancelled, per reason, most cancels first */
export function cancelFlowSummary(entries: ReadonlyArray<RetentionInput & { at: number }>, from: number, to: number): CancelFlowSummary {
  const rows = new Map<string, CancelFlowRow>(CANCEL_ANSWERS.map(reason => [reason, { reason, started: 0, saved: 0, cancelled: 0 }]));
  let discounts = 0;
  for (const entry of entries) {
    if (entry.at < from || entry.at >= to) continue;
    const row = rows.get(entry.reason);
    if (!row) continue;
    if (entry.step === "reason" && entry.outcome === "shown") row.started++;
    else if (entry.outcome === "cancelled") row.cancelled++;
    else if (SAVES.has(entry.outcome)) row.saved++;
    if (entry.outcome === "discount") discounts++;
  }
  const reasons = [...rows.values()].filter(row => row.started + row.saved + row.cancelled > 0).sort((a, b) => b.cancelled - a.cancelled || b.started - a.started);
  const sum = (key: "started" | "saved" | "cancelled") => reasons.reduce((total, row) => total + row[key], 0);
  return { started: sum("started"), saved: sum("saved"), cancelled: sum("cancelled"), discounts, reasons };
}
