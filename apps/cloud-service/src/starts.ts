// Every provider start this deployment makes (create, resume, a resize's resume), counted per UTC day against the plan's
// included starts, so we hear before the pool runs out and can tell when the next plan tier pays off. It also keeps each
// cloud's intent wakes (a person or a connector, never our own refresh) for the sleep policy's return prediction.
import { join } from "node:path";
import { createJsonStore } from "../../dashboard/server/billing/json-store.ts";
import { HARD_CAP_FACTOR, startCostCents } from "./sleep-policy.ts";

export type StartKind = "create" | "wake" | "routine" | "refresh" | "resize" | "recover";
interface Day { day: string; starts: number; byKind: Partial<Record<StartKind, number>>; extraCents: number; alerted: number[] }
interface State { v: 1; days: Day[]; wakes: Record<string, number[]> }
/** shares of the included starts that alert the operator, once a day each */
export const START_ALERTS = [0.7, 1, 1.5, 2, 5] as const;
const DAY_MS = 86_400_000;

export class StartCapError extends Error {
  readonly retryable = true;
  constructor() { super("Today's provider starts are used up."); this.name = "StartCapError"; }
}

export function createStartLedger(options: { dataDir: string; included: number; now?: () => number; alert?: (text: string) => void }) {
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(options.included) || options.included < 1) throw new Error("Invalid included starts.");
  const store = createJsonStore<State>(join(options.dataDir, "provider-starts.json"), () => ({ v: 1, days: [], wakes: {} }),
    (v): v is State => !!v && typeof v === "object" && (v as State).v === 1 && Array.isArray((v as State).days));
  const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
  function today(): Day {
    const key = dayOf(now());
    let d = store.state.days.find(x => x.day === key);
    if (!d) { d = { day: key, starts: 0, byKind: {}, extraCents: 0, alerted: [] }; store.state.days = [...store.state.days.slice(-89), d]; }
    return d;
  }
  return {
    included: options.included,
    /** starts made today */
    count: () => today().starts,
    /** refuses a start that would pass the provider's hard cap (6x the included), which would fail anyway */
    admit() { if (today().starts + 1 > options.included * HARD_CAP_FACTOR) throw new StartCapError(); },
    record(cloudId: string, kind: StartKind) {
      const d = today();
      d.starts++; d.byKind[kind] = (d.byKind[kind] ?? 0) + 1; d.extraCents += startCostCents(d.starts, options.included);
      if (kind === "wake" || kind === "routine") {
        const kept = (store.state.wakes[cloudId] ?? []).filter(t => t > now() - 14 * DAY_MS);
        if (kind === "wake") kept.push(now());
        store.state.wakes[cloudId] = kept.slice(-300);
      }
      for (const share of START_ALERTS) {
        if (d.starts >= Math.ceil(options.included * share) && !d.alerted.includes(share)) {
          d.alerted.push(share);
          options.alert?.(`provider starts: ${d.starts} today, ${Math.round(share * 100)}% of the ${options.included} included; extra starts so far $${(d.extraCents / 100).toFixed(2)}`);
        }
      }
      store.commit();
    },
    /** a cloud's intent wakes in the last 14 days, for predictReturn */
    wakes: (cloudId: string) => [...(store.state.wakes[cloudId] ?? [])],
    /** the last days, for the next-tier decision: starts, by kind, and what the extra ones cost */
    days: () => structuredClone(store.state.days),
    close: () => store.close(),
  };
}
export type StartLedger = ReturnType<typeof createStartLedger>;
