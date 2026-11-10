// When a sleeping-plan home should stop. Starts, not compute, are the provider's main cost: one extra start is worth 2 to
// 4 hours of a small machine. So the home stops after the base idle window, but stays up longer when a stop would
// likely be paid back by an early wake: the shared daily start pool is filling, its owner usually comes back soon, or a
// routine is due before a start would pay for itself. Prices: docs.boat.dev pricing.md and limits.md, read 2026-11-10.

export const MINUTE = 60_000, HOUR = 60 * MINUTE;
/** the base idle window, as OpenBot's; never stop with a run due within the guard */
export const BASE_IDLE_MS = 15 * MINUTE;
export const ROUTINE_GUARD_MS = 10 * MINUTE;
export const MIN_AWAKE_MS = 2 * MINUTE;
/** an open, focused app keeps its home up this long at most without real use */
export const FOCUS_CAP_MS = 30 * MINUTE;
/** past this share of the included starts, every start is treated as a paid one */
export const POOL_PRESSURE = 0.7;
/** what an included start is still worth (half the cheapest extra): a stop must save at least this much compute */
export const INCLUDED_START_CENTS = 1.5;
/** however good the reasons, an idle home stops after this long (except near the hard cap, where a stop could strand it) */
export const MAX_IDLE_MS = 6 * HOUR;
export const HARD_CAP_FACTOR = 6;
export const HOURLY_CENTS = { small: 1.8, default: 3.6, large: 7.2, xlarge: 20 } as const;

/** what the nth start of the day costs in cents: included, then $0.03 to 1.5x, $0.05 to 2x, $0.07 to 6x; past 6x it fails */
export function startCostCents(nth: number, included: number): number {
  if (nth <= included) return 0;
  if (nth <= included * 1.5) return 3;
  if (nth <= included * 2) return 5;
  if (nth <= included * HARD_CAP_FACTOR) return 7;
  return Number.POSITIVE_INFINITY;
}

/** what the next start is worth to us: its price, or a nominal value for an included one, a paid one's once the pool fills */
export function nextStartCents(startsToday: number, included: number): number {
  const price = startCostCents(startsToday + 1, included);
  if (price > 0) return price;
  return startsToday + 1 > included * POOL_PRESSURE ? 3 : INCLUDED_START_CENTS;
}

/** how long staying up costs the same as one start */
export function breakEvenMs(startCents: number, hourlyCents: number): number {
  return Number.isFinite(startCents) ? (startCents / hourlyCents) * HOUR : Number.POSITIVE_INFINITY;
}

export interface SleepInput {
  now: number;
  /** when the machine came up this time */
  awakeSince: number;
  /** the last real use (a turn, a send, a click), from the home's power read */
  lastActivityAt: number | null;
  /** the home's own busy reasons; "focus" is an open, focused app, which counts for 30 minutes at most */
  busy: readonly string[];
  /** when the current focus streak began, or null */
  focusSince: number | null;
  /** the next routine run or retry */
  nextDueAt: number | null;
  /** starts the whole deployment made today (UTC), and the plan's included starts a day */
  startsToday: number;
  includedStarts: number;
  /** when the owner's own wake history says they are back, as ms from now; null when it does not say */
  predictedReturnMs: number | null;
  hourlyCents: number;
  /** the home's own word that it has been idle for the base window (its clock and its rules win over lastActivityAt) */
  homeIdle?: boolean;
}
export interface SleepDecision { action: "stop" | "stay"; reason: string; recheckAt: number }

export function sleepDecision(input: SleepInput): SleepDecision {
  const { now } = input, stay = (reason: string, at: number): SleepDecision => ({ action: "stay", reason, recheckAt: Math.max(now + MINUTE / 4, Math.min(at, now + HOUR)) });
  const idleMs = now - Math.max(input.lastActivityAt ?? input.awakeSince, input.awakeSince);
  const real = input.busy.filter(b => b !== "focus" && b !== "recent-activity");
  if (real.length) return stay(`busy:${real[0]}`, now + MINUTE);
  if (now - input.awakeSince < MIN_AWAKE_MS) return stay("just_woke", input.awakeSince + MIN_AWAKE_MS);
  const due = input.nextDueAt === null ? null : input.nextDueAt - now;
  if (due !== null && due <= ROUTINE_GUARD_MS) return stay("routine_due", input.nextDueAt! + MINUTE);
  if (input.busy.includes("focus") && input.focusSince !== null && now - input.focusSince < FOCUS_CAP_MS) return stay("focused", input.focusSince + FOCUS_CAP_MS);
  if (!input.homeIdle && idleMs < BASE_IDLE_MS) return stay("recent_use", now + BASE_IDLE_MS - idleMs);
  // near the hard cap a stop might be the last start anyone gets today: stay up until the day's pool resets
  if (input.startsToday + 1 >= input.includedStarts * HARD_CAP_FACTOR * 0.95) return stay("near_hard_cap", nextUtcDay(now));
  if (idleMs >= MAX_IDLE_MS) return { action: "stop", reason: "max_idle", recheckAt: now };
  const cents = nextStartCents(input.startsToday, input.includedStarts), breakEven = breakEvenMs(cents, input.hourlyCents);
  // a routine due before a start pays for itself: cheaper to stay up and run it on this wake
  if (due !== null && due <= breakEven) return stay("routine_cheaper_awake", input.nextDueAt! + MINUTE);
  if (input.predictedReturnMs !== null && input.predictedReturnMs <= breakEven) return stay("owner_back_soon", now + input.predictedReturnMs + BASE_IDLE_MS);
  // a filling pool: idle up to the break-even before a stop (a wake inside it would have cost more than the compute)
  if (input.startsToday >= input.includedStarts * POOL_PRESSURE && idleMs < breakEven) return stay("pool_pressure", now + breakEven - idleMs);
  return { action: "stop", reason: input.startsToday >= input.includedStarts * POOL_PRESSURE ? "idle_past_break_even" : "idle", recheckAt: now };
}

export function nextUtcDay(now: number): number { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); }

/** when the owner is usually back after `now`: over the last 14 days, the first intent wake after the same time of day;
 *  the median gap, if at least 3 of those days had one within 12 hours */
export function predictReturn(wakes: readonly number[], now: number): number | null {
  const gaps: number[] = [];
  for (let day = 1; day <= 14; day++) {
    const then = now - day * 24 * HOUR;
    const next = wakes.filter(t => t > then && t <= then + 12 * HOUR).sort((a, b) => a - b)[0];
    if (next !== undefined) gaps.push(next - then);
  }
  if (gaps.length < 3) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}
