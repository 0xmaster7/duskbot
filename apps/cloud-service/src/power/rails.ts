// The hard limits every stop and start passes, whatever policy asked for it. Nothing here weighs costs: it only says no.
// A stop is refused while anything is under way, too soon after a start, while the home's start budget is spent, while
// starts are failing, or when the next start might be refused; a start is refused past the provider's hard cap or its
// "not before" time, held back while its starts keep failing, and (when it can wait) spread out of a busy minute.
// Caps are kept by refusing stops, never by refusing a person: a home that spent its budget simply stays up.
import { DAY, HOUR, MINUTE, POOL_WINDOWS, WINDOW_MS, type PoolCounts, type ProviderCostProfile } from "./cost.ts";
import { freshStats, type ActivityStats } from "./predictor.ts";

export type StartKind = "create" | "wake" | "routine" | "refresh" | "resize" | "recover";
/** a start somebody is waiting for; the others can wait for the rails */
export const INTENT_KINDS: ReadonlySet<StartKind> = new Set(["wake", "create", "recover", "resize"]);

/** what the lifecycle remembers about one home's power, kept on its record; every list is bounded */
export interface PowerMemory {
  stats: ActivityStats;
  /** its own starts and stops in the last day */
  starts: number[];
  stops: number[];
  /** starts that did not bring the home up, in the last day */
  failures: number[];
  breaker: { trips: number; openUntil: number; probeAt: number | null } | null;
}
export function freshMemory(now: number): PowerMemory { return { stats: freshStats(now), starts: [], stops: [], failures: [], breaker: null }; }

export interface RailSettings {
  /** a start is never undone sooner than this */
  minUptimeMs: number;
  /** never stop within this long of a person's last action */
  minIdleMs: number;
  /** an asked-for wake is delivered first: no stop this long after one */
  wakeGraceMs: number;
  /** an open, focused app keeps a home up this long at most without use */
  focusCapMs: number;
  /** no stop when a run is due within this (it would only need a start again) */
  routineGuardMs: number;
  /** per home: starts per rolling hour and day; once spent, the home is not stopped until one ages out */
  maxStartsPerHour: number;
  maxStartsPerDay: number;
  /** a stop followed by a start within this is a flap: each one in the last day doubles the minimum idle */
  flapMs: number;
  maxMinIdleMs: number;
  /** failed starts within the window that open the breaker, and its backoff (doubling per trip) */
  breakerFailures: number;
  breakerWindowMs: number;
  breakerBaseMs: number;
  breakerMaxMs: number;
  /** the share of the minute window's included starts the fleet's pre-wakes are planned into, per minute */
  poolSoftShare: number;
  /** no stop while any window is past this share of the provider's hard cap */
  hardCapShare: number;
}
export const DEFAULT_RAILS: RailSettings = {
  minUptimeMs: 4 * MINUTE, minIdleMs: 3 * MINUTE, wakeGraceMs: 3 * MINUTE, focusCapMs: 30 * MINUTE, routineGuardMs: 5 * MINUTE,
  maxStartsPerHour: 4, maxStartsPerDay: 16, flapMs: 10 * MINUTE, maxMinIdleMs: 2 * HOUR,
  breakerFailures: 3, breakerWindowMs: 30 * MINUTE, breakerBaseMs: 5 * MINUTE, breakerMaxMs: 2 * HOUR, poolSoftShare: 0.5, hardCapShare: 0.9,
};

/** the account's shared start pool, as the ledger counts it */
export interface PoolView { used: PoolCounts; blockedUntil: number | null }

/** busy codes that are only hints for the policy; every other code (and any unknown one) means work is under way */
const SOFT_BUSY = new Set(["recent-activity", "focus"]);
export const realBusy = (busy: readonly string[]) => busy.filter(b => !SOFT_BUSY.has(b));

export function prune(memory: PowerMemory, now: number): PowerMemory {
  const keep = (list: number[]) => list.filter(t => t > now - DAY && t <= now + 5 * MINUTE).slice(-200);
  memory.starts = keep(memory.starts); memory.stops = keep(memory.stops); memory.failures = keep(memory.failures);
  return memory;
}

/** stops in the last day that a start followed within flapMs */
export function flaps(memory: PowerMemory, now: number, rails: RailSettings): number {
  return memory.stops.filter(s => s > now - DAY && memory.starts.some(t => t > s && t - s <= rails.flapMs)).length;
}

export const countSince = (list: readonly number[], from: number) => list.reduce((n, t) => n + (t > from ? 1 : 0), 0);

export interface StopContext {
  now: number;
  /** when this start's machine came up (or was asked to) */
  awakeSince: number;
  busy: readonly string[];
  focusSince: number | null;
  lastActivityAt: number | null;
  wakeRequestedAt: number | null;
  /** when the next run has to begin, at the earliest */
  nextRunAt: number | null;
  memory: PowerMemory;
  pool: PoolView;
  profile: ProviderCostProfile;
}
export type Refusal = { reason: string; recheckAt: number };

/** whether a stop may happen now; null when it may */
export function stopRefusal(c: StopContext, rails: RailSettings = DEFAULT_RAILS): Refusal | null {
  const { now, memory } = c, no = (reason: string, at: number): Refusal => ({ reason, recheckAt: Math.max(now + 15_000, at) });
  const busy = realBusy(c.busy);
  if (busy.length) return no(`busy:${busy[0]}`, now + MINUTE);
  if (now - c.awakeSince < rails.minUptimeMs) return no("min_uptime", c.awakeSince + rails.minUptimeMs);
  if (c.wakeRequestedAt !== null && now - c.wakeRequestedAt < rails.wakeGraceMs) return no("wake_grace", c.wakeRequestedAt + rails.wakeGraceMs);
  if (c.focusSince !== null && c.busy.includes("focus")) {
    const until = Math.max(c.focusSince, c.lastActivityAt ?? 0) + rails.focusCapMs;
    if (now < until) return no("focused", Math.min(until, now + 5 * MINUTE));
  }
  const minIdle = Math.min(rails.maxMinIdleMs, rails.minIdleMs * 2 ** flaps(memory, now, rails));
  const idleFrom = Math.max(c.lastActivityAt ?? 0, c.awakeSince);
  if (now - idleFrom < minIdle) return no(minIdle > rails.minIdleMs ? "flap_backoff" : "min_idle", idleFrom + minIdle);
  if (c.nextRunAt !== null && c.nextRunAt - now <= rails.routineGuardMs) return no("routine_due", c.nextRunAt + MINUTE);
  if (memory.breaker && memory.breaker.openUntil > now) return no("starts_failing", memory.breaker.openUntil);
  const hourStarts = countSince(memory.starts, now - HOUR), dayStarts = countSince(memory.starts, now - DAY);
  if (hourStarts >= rails.maxStartsPerHour) return no("hour_budget_spent", (memory.starts.filter(t => t > now - HOUR)[0] ?? now) + HOUR);
  if (dayStarts >= rails.maxStartsPerDay) return no("day_budget_spent", (memory.starts.filter(t => t > now - DAY)[0] ?? now) + DAY);
  if (c.pool.blockedUntil !== null && c.pool.blockedUntil > now) return no("provider_not_before", c.pool.blockedUntil);
  if (!Number.isFinite(c.profile.startCents(c.pool.used))) return no("pool_exhausted", now + 5 * MINUTE);
  for (const w of POOL_WINDOWS) if (c.pool.used[w] >= rails.hardCapShare * c.profile.hardCap[w]) return no(`near_hard_cap_${w}`, now + Math.min(WINDOW_MS[w], 15 * MINUTE));
  return null;
}

export interface StartContext {
  now: number;
  kind: StartKind;
  /** a start that can wait: the latest it may happen (a run's wake-by time); null for one somebody waits for */
  latest: number | null;
  memory: PowerMemory;
  pool: PoolView;
  profile: ProviderCostProfile;
}

/** whether a start may happen now; null when it may */
export function startRefusal(c: StartContext, rails: RailSettings = DEFAULT_RAILS): Refusal | null {
  const { now, memory, pool, profile } = c, no = (reason: string, at: number): Refusal => ({ reason, recheckAt: Math.max(now + 5_000, at) });
  if (pool.blockedUntil !== null && pool.blockedUntil > now) return no("provider_not_before", pool.blockedUntil);
  for (const w of POOL_WINDOWS) if (pool.used[w] + 1 > profile.hardCap[w]) return no(`hard_cap_${w}`, now + Math.min(WINDOW_MS[w], 5 * MINUTE));
  if (!Number.isFinite(profile.startCents(pool.used))) return no("pool_exhausted", now + MINUTE);
  const b = memory.breaker;
  if (b && b.openUntil > now) {
    if (!INTENT_KINDS.has(c.kind)) return no("starts_failing", b.openUntil);
    // a person may still try, once per quarter of the backoff (at least two minutes apart)
    const spacing = Math.max(2 * MINUTE, breakerBackoff(b.trips, rails) / 4);
    if (b.probeAt !== null && now - b.probeAt < spacing) return no("starts_failing", b.probeAt + spacing);
  }
  if (c.kind === "refresh" && countSince(memory.starts, now - DAY) >= rails.maxStartsPerDay) return no("day_budget_spent", now + HOUR);
  if (c.latest !== null && now < c.latest) {
    // the planner gives pre-wakes poolSoftShare of each minute; this holds one that would make the minute window paid (a few
    // minutes of waiting cannot help the hour or day windows, so they are left to the price)
    if (pool.used.minute + 1 > profile.included.minute) return no("pool_smoothing", Math.min(c.latest, now + 20_000));
  }
  return null;
}

export const breakerBackoff = (trips: number, rails: RailSettings) => Math.min(rails.breakerMaxMs, rails.breakerBaseMs * 2 ** Math.max(0, trips - 1));

/** a start was asked for */
export function noteStart(memory: PowerMemory, now: number) {
  memory.starts.push(now);
  if (memory.breaker && memory.breaker.openUntil > now) memory.breaker.probeAt = now;
  prune(memory, now);
}
export function noteStop(memory: PowerMemory, now: number) { memory.stops.push(now); prune(memory, now); }
/** the home came up and answered: the breaker closes */
export function noteHealthy(memory: PowerMemory) { memory.breaker = null; }
/** a start did not bring the home up: true when this opened (or reopened) the breaker, which the operator hears about */
export function noteFailure(memory: PowerMemory, now: number, rails: RailSettings = DEFAULT_RAILS): boolean {
  memory.failures.push(now); prune(memory, now);
  if (countSince(memory.failures, now - rails.breakerWindowMs) < rails.breakerFailures) return false;
  if (memory.breaker && memory.breaker.openUntil > now) return false;
  const trips = (memory.breaker?.trips ?? 0) + 1;
  memory.breaker = { trips, openUntil: now + breakerBackoff(trips, rails), probeAt: null };
  return true;
}
