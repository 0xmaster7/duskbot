// Every provider start this deployment makes (create, resume, a resize's resume), counted the way the provider counts its
// shared pool: rolling minute, hour and day windows, never a midnight reset. The policy prices the next start from it,
// the rails keep starts under the provider's hard cap and its "not before" time after a refusal, and the operator hears
// as the day window fills. Held-machine resumes are counted too (we cannot tell them apart), so it errs on the safe side.
import { join } from "node:path";
import { createJsonStore } from "../../dashboard/server/billing/json-store.ts";
import { POOL_WINDOWS, type ProviderCostProfile } from "./power/cost.ts";
import { createRollingPool } from "./power/pool.ts";
import type { PoolView, StartKind } from "./power/rails.ts";

export type { StartKind } from "./power/rails.ts";
interface Day { day: string; starts: number; byKind: Partial<Record<StartKind, number>>; extraCents: number; alerted?: number[] }
/** v2: start times in seconds for the last day, the provider's not-before time, a day-by-day summary, alerts by share */
interface State { v: 2; times: number[]; blockedUntil: number | null; days: Day[]; alerted: Record<string, number> }
/** shares of the rolling day's included starts that alert the operator, at most once a day each */
export const START_ALERTS = [0.7, 1, 1.5, 2, 5] as const;
const DAY_MS = 86_400_000;

export class StartCapError extends Error {
  readonly retryable = true;
  readonly retryAt: number;
  constructor(retryAt: number) { super("The provider's starts are used up for now."); this.name = "StartCapError"; this.retryAt = retryAt; }
}

export function createStartLedger(options: { dataDir: string; profile: ProviderCostProfile; now?: () => number; alert?: (text: string) => void }) {
  const now = options.now ?? Date.now, { profile } = options;
  const store = createJsonStore<State>(join(options.dataDir, "provider-starts.json"), () => ({ v: 2, times: [], blockedUntil: null, days: [], alerted: {} }),
    (v): v is State => !!v && typeof v === "object" && ((v as State).v === 2 && Array.isArray((v as State).times) || (v as { v?: unknown }).v === 1) && Array.isArray((v as State).days));
  // a v1 file kept per-UTC-day counts only: its days stay as history, the rolling windows start empty
  if ((store.state as { v: number }).v === 1) Object.assign(store.state, { v: 2, times: [], blockedUntil: null, alerted: {} }, { wakes: undefined });
  const pool = createRollingPool(store.state.times.map(s => s * 1000));
  const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
  function today(): Day {
    const key = dayOf(now());
    let d = store.state.days.find(x => x.day === key);
    if (!d) { d = { day: key, starts: 0, byKind: {}, extraCents: 0 }; store.state.days = [...store.state.days.slice(-89), d]; }
    return d;
  }
  const blocked = () => store.state.blockedUntil !== null && store.state.blockedUntil > now() ? store.state.blockedUntil : null;
  return {
    /** the pool as the policy and the rails read it */
    view: (): PoolView => ({ used: pool.used(now()), blockedUntil: blocked() }),
    /** refuses a start the provider would refuse anyway: past its hard cap in any window, or before its not-before time */
    admit() {
      const at = now(), until = blocked();
      if (until !== null) throw new StartCapError(until);
      const used = pool.used(at);
      for (const w of POOL_WINDOWS) if (used[w] + 1 > profile.hardCap[w]) throw new StartCapError(pool.roomAt(at, w, profile.hardCap[w]));
    },
    record(_cloudId: string, kind: StartKind) {
      const at = now(), price = profile.startCents(pool.used(at)), d = today();
      pool.add(at);
      d.starts++; d.byKind[kind] = (d.byKind[kind] ?? 0) + 1; d.extraCents += Number.isFinite(price) ? price : 0;
      store.state.times = pool.times(at).map(t => Math.floor(t / 1000));
      const day = pool.used(at).day;
      for (const share of START_ALERTS) {
        const key = String(share), last = store.state.alerted[key] ?? 0;
        if (day >= Math.ceil(profile.included.day * share) && at - last >= DAY_MS) {
          store.state.alerted[key] = at;
          options.alert?.(`provider starts: ${day} in the last 24 hours, ${Math.round(share * 100)}% of the ${profile.included.day} included; extra starts today so far $${(d.extraCents / 100).toFixed(2)}`);
        }
      }
      store.commit();
    },
    /** the provider refused a start until this time (its 429's nextStartAt): no start before it, and no stop that would need one */
    block(until: number) {
      if (!Number.isFinite(until) || until <= now() || until > now() + DAY_MS) return;
      store.state.blockedUntil = Math.max(store.state.blockedUntil ?? 0, until); store.commit();
    },
    /** starts in the rolling day, and the last days by UTC day, for the next-tier decision */
    count: () => pool.used(now()).day,
    days: () => structuredClone(store.state.days),
    close: () => store.close(),
  };
}
export type StartLedger = ReturnType<typeof createStartLedger>;
