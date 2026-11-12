import type { OpsSignal, OpsSignalKind, OpsSuspect } from "../../../src/admin/ops-types.ts";
import type { OpsRuleState } from "./store.ts";

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** a robust z-score: distance from the median in units of the median absolute deviation (scaled to match a normal sd).
 *  null when the spread is zero, so one value above a flat fleet is judged by its ratio alone */
export function robustZ(value: number, values: readonly number[]): number | null {
  const mid = median(values), mad = median(values.map(v => Math.abs(v - mid))) * 1.4826;
  return mad > 0 ? Math.round((value - mid) / mad * 10) / 10 : null;
}

/** value over the median; the median never counts as below `floor`, so a tiny fleet median can't blow a ratio up */
export function ratioOf(value: number, mid: number, floor: number): number | null {
  const base = Math.max(mid, floor);
  return base > 0 ? Math.round(value / base * 10) / 10 : null;
}

/** `baseline` replaces the fleet median for counts most people never have (signups from one address, failed payments) */
export interface SignalSpec { kind: OpsSignalKind; floor: number; flagRatio: number; label: (value: number) => string; weight?: number; baseline?: number }
export interface SignalInput { key: string; accountId: string | null; email: string | null; ip: string | null; values: Partial<Record<OpsSignalKind, number>> }

/** every key with at least one signal at `flagRatio` times the median of its kind; ranked by the sum of how far past */
export function suspects(inputs: readonly SignalInput[], specs: readonly SignalSpec[], limit = 25): OpsSuspect[] {
  const medians = new Map(specs.map(spec => [spec.kind, spec.baseline ?? median(inputs.map(input => input.values[spec.kind]).filter((v): v is number => typeof v === "number"))]));
  const out: OpsSuspect[] = [];
  for (const input of inputs) {
    const signals: Array<OpsSignal & { weight: number }> = [];
    for (const spec of specs) {
      const value = input.values[spec.kind];
      if (typeof value !== "number" || value <= 0) continue;
      const mid = medians.get(spec.kind)!, ratio = ratioOf(value, mid, spec.floor);
      if (ratio === null || ratio < spec.flagRatio) continue;
      signals.push({ kind: spec.kind, value, median: Math.round(mid * 100) / 100, ratio, label: spec.label(value), weight: spec.weight ?? 1 });
    }
    if (!signals.length) continue;
    signals.sort((a, b) => b.ratio! * b.weight - a.ratio! * a.weight);
    const score = Math.round(signals.reduce((sum, s) => sum + Math.min(50, s.ratio! - 1) * s.weight, 0) * 10) / 10;
    const why = signals.slice(0, 3).map(s => `${s.label} (${s.ratio}x the median)`).join(", ");
    out.push({ key: input.key, accountId: input.accountId, email: input.email, ip: input.ip, score, why, signals: signals.map(({ kind, value, median: mid, ratio, label }) => ({ kind, value, median: mid, ratio, label })) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export type RuleEvent = "fire" | "recover" | null;
/**
 * one rule's next state from one reading. a breach starts `pending`; it fires once it has lasted `forMs` (at once when 0).
 * a firing rule fires nothing more until it recovers, so an outage is one email and its end is one more.
 * `breach: null` means the reading is missing: the rule keeps its state
 */
export function step(prev: OpsRuleState, reading: { breach: boolean | null; value: string | null }, forMs: number, now: number): { next: OpsRuleState; event: RuleEvent } {
  if (reading.breach === null) return { next: prev, event: null };
  const base = { ...prev, value: reading.value, updatedAt: now };
  if (reading.breach) {
    if (prev.state === "firing") return { next: base, event: null };
    const since = prev.state === "pending" && prev.since !== null ? prev.since : now;
    if (now - since >= forMs) return { next: { ...base, state: "firing", since, lastFiredAt: now }, event: "fire" };
    return { next: { ...base, state: "pending", since }, event: null };
  }
  if (prev.state === "firing") return { next: { ...base, state: "ok", since: null }, event: "recover" };
  return { next: { ...base, state: "ok", since: null }, event: null };
}
