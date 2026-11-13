// The cost-aware power policy: when an idle home stops, and when a sleeping one wakes for a routine. A stop is worth it
// only when the compute it saves over the predicted idle gap is more than what the next wake costs: that start's price
// (or an included start's shadow price as the shared pool fills), the chance it fails, and the wait a person or a
// connector sees on a cold wake. The policy weighs "stop now" against "stay up for tau, then stop" for a range of tau,
// including "stay up through the next run", and takes the cheapest. Every answer passes the rails first.
import type { MachineSpec } from "../../../../shared/billing-api.ts";
import type { SpendView } from "./ceiling.ts";
import { HOUR, MINUTE, breakEvenMs, startValueCents, type ProviderCostProfile, type ShadowPrices } from "./cost.ts";
import { connectorShare, DEFAULT_PREDICTOR, GRID_MS, observe, predict, type PredictorParams } from "./predictor.ts";
import { DEFAULT_RAILS, startRefusal, stopRefusal, type PoolView, type PowerMemory, type RailSettings, type StartKind } from "./rails.ts";
import { createWakePlanner, nextRun, plannedRuns, prewake, runnableFrom, wakeBy, type PlannedRun, type ScheduleParams } from "./schedule.ts";

/** what the lifecycle knows about one home when it asks; nothing provider-specific */
export interface PowerSnapshot {
  now: number;
  cloudId: string;
  spec: MachineSpec;
  /** when the machine came up this time */
  awakeSince: number;
  /** the last real use (a turn, a send, a click), from the home's power read */
  lastActivityAt: number | null;
  /** the home's busy codes; "focus" (an open, focused app) and "recent-activity" are hints, every other code is work */
  busy: readonly string[];
  focusSince: number | null;
  /** the next routine run or retry, and the runs ahead when the home reports them */
  nextDueAt: number | null;
  upcoming?: readonly PlannedRun[] | null;
  /** the home's own word that it is idle */
  homeIdle: boolean;
  /** the last wake somebody asked for (the app, a connector), not yet long past */
  wakeRequestedAt?: number | null;
  /** the same, when a person asked for it (rails.ts StopContext.personWakeAt) */
  personWakeAt?: number | null;
  memory: PowerMemory;
  /** the home's monthly cost book (ceiling.ts), for the rails */
  spend?: SpendView | null;
}
export interface PowerDecision {
  action: "stop" | "stay";
  reason: string;
  /** when to ask again at the latest */
  recheckAt: number;
  /** the idle window to ask the home to agree to, in minutes */
  idleMinutes: number;
  /** the expected costs compared, in cents (for the operator and the tests) */
  stopCents?: number;
  stayCents?: number;
  stayMs?: number;
}
export interface WakePlan { start: boolean; kind: StartKind; reason: string; recheckAt: number; latest: number | null }

export interface PolicyParams {
  prices: ShadowPrices;
  predictor: PredictorParams;
  schedule: ScheduleParams;
  rails: RailSettings;
  /** a stop must beat staying by this many cents (at most half a minute's compute, see decide) */
  marginCents: number;
}
/** tuned on the simulator (scripts/lifecycle-sim.ts); the wait prices are the objective's, not tuned */
export const DEFAULT_POLICY: PolicyParams = {
  prices: { includedStartCents: 0.75, startRiskCents: 1, userWaitCents: 2, connectorWaitCents: 1 },
  predictor: DEFAULT_PREDICTOR,
  schedule: { leadMs: 4 * MINUTE, spreadMs: 0 },
  rails: DEFAULT_RAILS,
  marginCents: 0.01,
};

export interface SleepPolicy {
  decide(snapshot: PowerSnapshot): PowerDecision;
  /** for a stopped home: whether to start it now for a routine */
  wake(snapshot: Pick<PowerSnapshot, "now" | "cloudId" | "nextDueAt" | "upcoming" | "memory" | "spend">): WakePlan;
  /** an event that needed the home (a person's use, a connector's), for the home's own activity model */
  observe(memory: PowerMemory, at: number, kind: "user" | "connector"): void;
}

/** the expected cost of staying up for each candidate tau and then stopping, against stopping now */
export interface CostInputs {
  /** P(no intent event yet) at GRID_MS offsets */
  survival: readonly number[];
  /** compute, cents per ms */
  rate: number;
  /** what the next start is worth, cents */
  startCents: number;
  /** the wait a cold wake costs, cents */
  waitCents: number;
  /** the run ahead, as offsets from now: when it can run, and when the home must start waking for it; null for none */
  run: { runFrom: number; wakeAt: number } | null;
  leadMs: number;
  held: { windowMs: number; probability: number };
  wakeMs: { cold: number; held: number };
}

function survivalAt(survival: readonly number[], t: number): number {
  if (t <= 0) return 1;
  for (let i = 1; i < GRID_MS.length; i++) {
    if (t <= GRID_MS[i]!) {
      const a = GRID_MS[i - 1]!, b = GRID_MS[i]!, w = (t - a) / (b - a);
      return survival[i - 1]! * (1 - w) + survival[i]! * w;
    }
  }
  return survival.at(-1)!;
}

export interface Choice { stopCents: number; stayCents: number; stayMs: number; through: boolean }
/** the expected cost of stopping now and of the cheapest "stay up for tau, then stop" (tau on the prediction grid, or
 *  "through the next run"); costs are unconditional: masses come straight from the survival curve */
export function chooseStay(c: CostInputs): Choice {
  const T = GRID_MS, S = c.survival, K = T.length;
  const end = c.run ? Math.max(0, c.run.wakeAt) : Number.POSITIVE_INFINITY, sEnd = c.run ? survivalAt(S, end) : S[K - 1]!;
  const heldShare = (c.held.probability * c.wakeMs.held + (1 - c.held.probability) * c.wakeMs.cold) / c.wakeMs.cold;
  const startFor = (gap: number) => gap < c.held.windowMs ? (1 - c.held.probability) * c.startCents : c.startCents;
  const waitFor = (gap: number) => gap < c.held.windowMs ? c.waitCents * heldShare : c.waitCents;
  // expected awake time before tau = T[j] while no event has come
  const awake = [0];
  for (let k = 0; k < K - 1; k++) awake.push(awake[k]! + (S[k]! + S[k + 1]!) / 2 * (T[k + 1]! - T[k]!));
  const afterStop = (j: number) => {
    const tau = T[j]!;
    let cost = 0;
    for (let k = j; k < K - 1 && T[k]! < end; k++) {
      const a = T[k]!, b = Math.min(T[k + 1]!, end), sb = b === T[k + 1] ? S[k + 1]! : sEnd, mass = S[k]! - sb;
      if (mass > 0) { const gap = (a + b) / 2 - tau; cost += mass * (startFor(gap) + waitFor(gap)); }
    }
    // no event before the run's wake: woken for the run (a start and the lead's compute, nobody waits); with no run,
    // the owner comes back some time after the horizon, to a cold wake
    return cost + (c.run ? sEnd * (startFor(end - tau) + c.rate * c.leadMs) : sEnd * (c.startCents + c.waitCents));
  };
  const stopCents = afterStop(0);
  let best = { cents: Number.POSITIVE_INFINITY, ms: 0, through: false };
  for (let j = 1; j < K && T[j]! < end; j++) {
    const cents = c.rate * awake[j]! + afterStop(j);
    if (cents < best.cents) best = { cents, ms: T[j]!, through: false };
  }
  if (c.run) {
    const from = Math.max(0, c.run.runFrom);
    let k = 0;
    while (k < K - 1 && T[k + 1]! <= from) k++;
    const partial = from >= T[K - 1]! ? 0 : (S[k]! + survivalAt(S, from)) / 2 * (from - T[k]!);
    const cents = c.rate * (awake[Math.min(k, K - 1)]! + partial);
    if (cents <= best.cents) best = { cents, ms: from, through: true };
  }
  return { stopCents, stayCents: best.cents, stayMs: best.ms, through: best.through };
}

export function createPowerPolicy(options: { profile: ProviderCostProfile; pool(): PoolView; params?: PolicyParams }): SleepPolicy {
  const { profile } = options, params = options.params ?? DEFAULT_POLICY;
  // one planner for the whole fleet this policy serves: pre-wakes share the minute window's soft share
  const planner = createWakePlanner({ perMinute: () => params.rails.poolSoftShare * profile.included.minute, maxEarlyMs: 30 * MINUTE });
  return {
    observe(memory, at, kind) { if (Number.isFinite(at)) observe(memory.stats, at, kind, params.predictor); },
    decide(s) {
      const { now } = s, rails = params.rails;
      planner.release(s.cloudId);
      const runs = plannedRuns(s.nextDueAt, s.upcoming, now), next = nextRun(runs, now);
      const idleMinutes = Math.max(1, Math.min(24 * 60, Math.floor((now - Math.max(s.lastActivityAt ?? 0, s.awakeSince)) / MINUTE)));
      const stay = (reason: string, at: number, extra: Partial<PowerDecision> = {}): PowerDecision => ({ action: "stay", reason, recheckAt: Math.max(now + 15_000, Math.min(at, now + HOUR)), idleMinutes, ...extra });
      const pool = options.pool();
      const refusal = stopRefusal({ now, awakeSince: s.awakeSince, busy: s.busy, focusSince: s.focusSince, lastActivityAt: s.lastActivityAt, wakeRequestedAt: s.wakeRequestedAt ?? null, personWakeAt: s.personWakeAt ?? null,
        nextRunAt: next ? runnableFrom(next) : null, memory: s.memory, pool, profile, spend: s.spend ?? null }, rails);
      if (refusal) return stay(refusal.reason, refusal.recheckAt);
      // past the rails with no work under way: a cost guess never keeps a home up this long after the last input
      if (now - Math.max(s.lastActivityAt ?? 0, s.awakeSince) >= rails.maxNoInputMs) return { action: "stop", reason: "no_input_cap", recheckAt: now, idleMinutes };
      const rate = profile.computeCentsPerHour(s.spec) / HOUR;
      const startCents = startValueCents(profile, pool.used, params.prices);
      const share = connectorShare(s.memory.stats);
      const inputs: CostInputs = {
        survival: predict(s.memory.stats, now, params.predictor).survival, rate, startCents,
        waitCents: params.prices.userWaitCents * (1 - share) + params.prices.connectorWaitCents * share,
        run: next ? { runFrom: runnableFrom(next) - now, wakeAt: wakeBy(next, params.schedule) - now } : null,
        leadMs: params.schedule.leadMs, held: profile.held, wakeMs: profile.wakeMs,
      };
      const choice = chooseStay(inputs);
      const costs = { stopCents: round(choice.stopCents), stayCents: round(choice.stayCents), stayMs: choice.stayMs };
      // staying one more minute is never more than a minute's compute dearer than stopping now, so a larger margin would
      // keep every home up for good: it is capped at half of that
      if (choice.stopCents + Math.min(params.marginCents, rate * MINUTE / 2) <= choice.stayCents) return { action: "stop", reason: next ? "cheaper_asleep_until_run" : "cheaper_asleep", recheckAt: now, idleMinutes, ...costs };
      if (choice.through) return stay(choice.stayMs <= breakEvenMs(startCents, rate * HOUR) ? "run_soon_cheaper_awake" : "cheaper_awake_until_run", now + Math.min(choice.stayMs, 10 * MINUTE), costs);
      return stay("likely_back_soon", now + Math.min(Math.max(choice.stayMs, MINUTE), 10 * MINUTE), costs);
    },
    wake(s) {
      const { now } = s, runs = plannedRuns(s.nextDueAt, s.upcoming, now), next = nextRun(runs, now);
      if (!next) return { start: false, kind: "routine", reason: "nothing_due", recheckAt: now + HOUR, latest: null };
      const plan = prewake(s.cloudId, next, params.schedule);
      // reserved only once the run is near: the reservation order is the order homes come up to it
      if (now < plan.latest - 45 * MINUTE) return { start: false, kind: "routine", reason: "not_yet", recheckAt: Math.min(plan.latest - 45 * MINUTE, now + HOUR), latest: plan.latest };
      const at = planner.slot(s.cloudId, plan.at, plan.latest, now);
      if (now < at) return { start: false, kind: "routine", reason: "not_yet", recheckAt: Math.min(at, now + HOUR), latest: plan.latest };
      const refusal = startRefusal({ now, kind: "routine", latest: plan.latest, memory: s.memory, pool: options.pool(), profile, spend: s.spend ?? null }, params.rails);
      if (refusal) return { start: false, kind: "routine", reason: refusal.reason, recheckAt: refusal.recheckAt, latest: plan.latest };
      planner.release(s.cloudId);
      return { start: true, kind: "routine", reason: "routine_due", recheckAt: now, latest: plan.latest };
    },
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
