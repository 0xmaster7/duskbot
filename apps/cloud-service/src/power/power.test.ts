// the power policy's parts: the cost model, the activity predictor, the schedule, the rails and the decision itself
import { describe, expect, it } from "vitest";
import { boatCostProfile } from "../boat.ts";
import { breakEvenMs, DAY, HOUR, MINUTE, startValueCents, type PoolCounts } from "./cost.ts";
import { createRollingPool } from "./pool.ts";
import { createPowerPolicy, DEFAULT_POLICY, type PowerSnapshot } from "./policy.ts";
import { freshStats, observe, predict, validStats, GRID_MS } from "./predictor.ts";
import { DEFAULT_RAILS, flaps, freshMemory, noteFailure, noteHealthy, noteStart, noteStop, startRefusal, stopRefusal, type StopContext } from "./rails.ts";
import { plannedRuns, prewake, spreadOf } from "./schedule.ts";

const T0 = Date.UTC(2026, 10, 9, 12), SMALL = { vcpu: 2, ramGb: 4, diskGb: 40 };
const profile = boatCostProfile({ plan: "20" });
const used = (day: number, hour = 0, minute = 0): PoolCounts => ({ minute, hour, day });
const idlePool = { used: used(10, 2, 0), blockedUntil: null };

describe("the cost model", () => {
  it("prices a start by the highest tier across the rolling windows, and refuses past the hard cap", () => {
    expect(profile.startCents(used(199))).toBe(0);
    expect(profile.startCents(used(200))).toBe(3);
    expect(profile.startCents(used(299))).toBe(3);
    expect(profile.startCents(used(300))).toBe(5);
    expect(profile.startCents(used(400))).toBe(7);
    expect(profile.startCents(used(1199))).toBe(7);
    expect(profile.startCents(used(1200))).toBe(Number.POSITIVE_INFINITY);
    // the minute window is the tightest: 12 included, 3x at most
    expect(profile.startCents(used(10, 10, 12))).toBe(3);
    expect(profile.startCents(used(10, 10, 36))).toBe(Number.POSITIVE_INFINITY);
    expect(profile.startCents(used(10, 60, 0))).toBe(3);
  });

  it("values an included start at its shadow price, rising to the first paid price as the pool fills", () => {
    const prices = DEFAULT_POLICY.prices;
    expect(startValueCents(profile, used(10), prices)).toBeCloseTo(prices.includedStartCents + prices.startRiskCents);
    const mid = startValueCents(profile, used(170), prices), full = startValueCents(profile, used(199), prices);
    expect(mid).toBeGreaterThan(prices.includedStartCents + prices.startRiskCents);
    expect(full).toBeGreaterThan(mid);
    expect(full).toBeLessThanOrEqual(3 + prices.startRiskCents + 1e-9);
    expect(startValueCents(profile, used(450), prices)).toBe(7 + prices.startRiskCents);
    expect(startValueCents(profile, used(1200), prices)).toBe(Number.POSITIVE_INFINITY);
  });

  it("break-even: a paid $0.03 start is 100 minutes of small compute, $0.07 almost 4 hours", () => {
    expect(breakEvenMs(3, 1.8) / MINUTE).toBeCloseTo(100, 0);
    expect(breakEvenMs(7, 1.8) / HOUR).toBeCloseTo(3.89, 1);
    expect(breakEvenMs(Number.POSITIVE_INFINITY, 1.8)).toBe(Number.POSITIVE_INFINITY);
  });

  it("counts the pool in rolling windows, with no reset at midnight", () => {
    const pool = createRollingPool();
    const midnight = Date.UTC(2026, 10, 10);
    for (let i = 0; i < 5; i++) pool.add(midnight - 30_000 + i * 10_000);
    expect(pool.used(midnight + 15_000)).toEqual({ minute: 5, hour: 5, day: 5 });
    expect(pool.used(midnight + 45_000).minute).toBe(3);
    expect(pool.roomAt(midnight + 15_000, "minute", 5)).toBe(midnight - 30_000 + MINUTE + 1);
    expect(pool.roomAt(midnight + 15_000, "minute", 6)).toBe(midnight + 15_000);
    expect(pool.used(midnight + DAY - 30_000 + 5).day).toBe(4);
  });
});

describe("the activity predictor", () => {
  it("learns a daily session: likely back near its hour, unlikely in the middle of the night", () => {
    const s = freshStats(T0 - 21 * DAY);
    for (let d = 21; d >= 1; d--) {
      const day = Date.UTC(2026, 10, 9) - d * DAY;
      for (let k = 0; k < 4; k++) observe(s, day + 20 * HOUR + k * 3 * MINUTE, "user");
    }
    const at = (h: number, within: number) => {
      const now = Date.UTC(2026, 10, 9) + h * HOUR, survival = predict(s, now).survival;
      return 1 - survival[GRID_MS.indexOf(within * MINUTE)]!;
    };
    // a habit is a rate per hour, so a once-a-day session is at most about 63% within its hour
    expect(at(19.9, 60)).toBeGreaterThan(0.45);
    expect(at(3, 60)).toBeLessThan(0.1);
    expect(at(19.9, 60)).toBeGreaterThan(5 * at(3, 60));
  });

  it("is a proper survival curve, and a new home gets a flat prior", () => {
    const fresh = predict(freshStats(T0), T0).survival;
    expect(fresh[0]).toBe(1);
    for (let i = 1; i < fresh.length; i++) expect(fresh[i]!).toBeLessThanOrEqual(fresh[i - 1]!);
    // three sessions a day: about one in eight within the hour
    expect(1 - fresh[GRID_MS.indexOf(60 * MINUTE)]!).toBeGreaterThan(0.08);
    expect(1 - fresh[GRID_MS.indexOf(60 * MINUTE)]!).toBeLessThan(0.2);
  });

  it("ignores duplicates and late, out-of-order events, and starts over from a malformed record", () => {
    const s = freshStats(T0);
    observe(s, T0, "user"); observe(s, T0 + 10_000, "connector"); observe(s, T0 - 5 * MINUTE, "user");
    expect(s.lastAt).toBe(T0 + 10_000);
    expect(s.human + s.connector).toBeCloseTo(1, 4);
    expect(s.starts.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    observe(s, T0 + 6 * MINUTE, "user");
    expect(s.gaps.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    expect(validStats({ v: 1, starts: [1] }, T0)).toEqual(freshStats(T0));
    expect(validStats(s, T0)).toBe(s);
  });
});

describe("the schedule", () => {
  it("cleans the reported runs and spreads each home's pre-wake inside its lead", () => {
    const runs = plannedRuns(T0 + HOUR, [{ at: T0 + HOUR, flexMs: 5 * MINUTE }, { at: T0 + 30 * HOUR, flexMs: 0 }, { at: Number.NaN, flexMs: 0 }], T0);
    expect(runs).toEqual([{ at: T0 + HOUR, flexMs: 0 }]);
    const params = DEFAULT_POLICY.schedule;
    for (const id of ["a", "b", "c", "d"]) {
      const plan = prewake(id, { at: T0, flexMs: 0 }, params);
      expect(plan.latest).toBe(T0 - params.leadMs);
      expect(plan.at).toBeGreaterThanOrEqual(T0 - params.leadMs - params.spreadMs);
      expect(plan.at).toBeLessThanOrEqual(plan.latest);
    }
    expect(spreadOf("a", T0)).toBe(spreadOf("a", T0));
    // a run that may move 15 minutes can wait for the end of its window
    expect(prewake("a", { at: T0, flexMs: 15 * MINUTE }, params).latest).toBe(T0 + 15 * MINUTE - params.leadMs);
  });
});

function stopContext(patch: Partial<StopContext> = {}): StopContext {
  return { now: T0, awakeSince: T0 - HOUR, busy: [], focusSince: null, lastActivityAt: T0 - 30 * MINUTE, wakeRequestedAt: null, nextRunAt: null, memory: freshMemory(T0 - DAY), pool: idlePool, profile, ...patch };
}

describe("the rails", () => {
  it("never stops a home with work under way, an unknown busy code included; hints alone do not hold it", () => {
    for (const busy of ["turn", "run", "live-call", "computer", "maintenance", "recent-work", "just-woke", "due-soon", "team", "something-new"]) expect(stopRefusal(stopContext({ busy: [busy] }))?.reason).toBe(`busy:${busy}`);
    expect(stopRefusal(stopContext({ busy: ["recent-activity"] }))).toBeNull();
  });

  it("holds the minimum uptime, the minimum idle, a wake's delivery and a run due soon", () => {
    expect(stopRefusal(stopContext({ awakeSince: T0 - MINUTE }))?.reason).toBe("min_uptime");
    expect(stopRefusal(stopContext({ lastActivityAt: T0 - MINUTE }))?.reason).toBe("min_idle");
    expect(stopRefusal(stopContext({ wakeRequestedAt: T0 - MINUTE }))?.reason).toBe("wake_grace");
    expect(stopRefusal(stopContext({ nextRunAt: T0 + 3 * MINUTE }))?.reason).toBe("routine_due");
    expect(stopRefusal(stopContext({ busy: ["focus"], focusSince: T0 - 10 * MINUTE }))?.reason).toBe("focused");
    expect(stopRefusal(stopContext({ busy: ["focus"], focusSince: T0 - 40 * MINUTE }))).toBeNull();
  });

  it("doubles the minimum idle for each stop that a start followed within ten minutes", () => {
    const memory = freshMemory(T0 - DAY);
    for (let i = 0; i < 3; i++) { noteStop(memory, T0 - 5 * HOUR + i * HOUR); noteStart(memory, T0 - 5 * HOUR + i * HOUR + 2 * MINUTE); }
    expect(flaps(memory, T0, DEFAULT_RAILS)).toBe(3);
    const refused = stopRefusal(stopContext({ memory, lastActivityAt: T0 - 20 * MINUTE }));
    expect(refused?.reason).toBe("flap_backoff");
    expect(refused!.recheckAt).toBe(T0 - 20 * MINUTE + 24 * MINUTE);
  });

  it("keeps a home up once its hourly or daily start budget is spent, rather than refuse the next person", () => {
    const memory = freshMemory(T0 - DAY);
    for (let i = 0; i < DEFAULT_RAILS.maxStartsPerHour; i++) noteStart(memory, T0 - 50 * MINUTE + i * 5 * MINUTE);
    expect(stopRefusal(stopContext({ memory }))?.reason).toBe("hour_budget_spent");
    expect(startRefusal({ now: T0, kind: "wake", latest: null, memory, pool: idlePool, profile })).toBeNull();
    const day = freshMemory(T0 - DAY);
    for (let i = 0; i < DEFAULT_RAILS.maxStartsPerDay; i++) noteStart(day, T0 - 23 * HOUR + i * 80 * MINUTE);
    expect(stopRefusal(stopContext({ memory: day }))?.reason).toBe("day_budget_spent");
  });

  it("refuses a stop when the next start might be refused, and a start past the hard cap or before the provider's time", () => {
    expect(stopRefusal(stopContext({ pool: { used: used(1100), blockedUntil: null } }))?.reason).toBe("near_hard_cap_day");
    expect(stopRefusal(stopContext({ pool: { used: used(10), blockedUntil: T0 + MINUTE } }))?.reason).toBe("provider_not_before");
    expect(stopRefusal(stopContext({ pool: { used: used(1200), blockedUntil: null } }))?.reason).toBe("pool_exhausted");
    const memory = freshMemory(T0);
    expect(startRefusal({ now: T0, kind: "wake", latest: null, memory, pool: { used: used(1100, 0, 36), blockedUntil: null }, profile })?.reason).toBe("hard_cap_minute");
    expect(startRefusal({ now: T0, kind: "wake", latest: null, memory, pool: { used: used(10), blockedUntil: T0 + 30_000 }, profile })).toEqual({ reason: "provider_not_before", recheckAt: T0 + 30_000 });
  });

  it("spreads a start that can wait out of a busy minute, never past its latest time, and never holds a person's", () => {
    const busy = { used: used(10, 10, 12), blockedUntil: null }, memory = freshMemory(T0);
    expect(startRefusal({ now: T0, kind: "routine", latest: T0 + 2 * MINUTE, memory, pool: busy, profile })?.reason).toBe("pool_smoothing");
    expect(startRefusal({ now: T0 + 2 * MINUTE, kind: "routine", latest: T0 + 2 * MINUTE, memory, pool: busy, profile })).toBeNull();
    expect(startRefusal({ now: T0, kind: "wake", latest: null, memory, pool: busy, profile })).toBeNull();
  });

  it("opens a breaker after three failed starts in 30 minutes, backs off doubling, lets a person probe, and closes on health", () => {
    const memory = freshMemory(T0);
    expect(noteFailure(memory, T0)).toBe(false);
    expect(noteFailure(memory, T0 + MINUTE)).toBe(false);
    expect(noteFailure(memory, T0 + 2 * MINUTE)).toBe(true);
    expect(memory.breaker).toMatchObject({ trips: 1, openUntil: T0 + 7 * MINUTE });
    expect(startRefusal({ now: T0 + 3 * MINUTE, kind: "routine", latest: null, memory, pool: idlePool, profile })?.reason).toBe("starts_failing");
    expect(stopRefusal(stopContext({ now: T0 + 3 * MINUTE, memory }))?.reason).toBe("starts_failing");
    expect(startRefusal({ now: T0 + 3 * MINUTE, kind: "wake", latest: null, memory, pool: idlePool, profile })).toBeNull();
    noteStart(memory, T0 + 3 * MINUTE);
    expect(startRefusal({ now: T0 + 4 * MINUTE, kind: "wake", latest: null, memory, pool: idlePool, profile })?.reason).toBe("starts_failing");
    expect(noteFailure(memory, T0 + 8 * MINUTE)).toBe(true);
    expect(memory.breaker).toMatchObject({ trips: 2, openUntil: T0 + 18 * MINUTE });
    noteHealthy(memory);
    expect(memory.breaker).toBeNull();
  });
});

describe("the decision", () => {
  const snapshot = (patch: Partial<PowerSnapshot> = {}): PowerSnapshot => ({ now: T0, cloudId: "c1", spec: SMALL, awakeSince: T0 - HOUR, lastActivityAt: T0 - 30 * MINUTE, busy: [], focusSince: null,
    nextDueAt: null, homeIdle: true, wakeRequestedAt: null, memory: freshMemory(T0 - 7 * DAY), ...patch });
  const policy = (pool = idlePool) => createPowerPolicy({ profile, pool: () => pool });

  it("sleeps a home nobody is likely to need soon, and says what it compared", () => {
    const d = policy().decide(snapshot({ lastActivityAt: T0 - 2 * HOUR }));
    expect(d.action).toBe("stop");
    expect(d.stopCents!).toBeLessThan(d.stayCents!);
    expect(d.idleMinutes).toBe(60);
  });

  it("keeps a monitor's home up between runs every 15 minutes: staying is cheaper than a start each time", () => {
    const d = policy().decide(snapshot({ nextDueAt: T0 + 12 * MINUTE }));
    expect(d.action).toBe("stay");
    expect(d.reason).toMatch(/run_soon_cheaper_awake|cheaper_awake_until_run/);
  });

  it("sleeps between runs three hours apart while starts are cheap, and stays up for them once each start is paid", () => {
    expect(policy().decide(snapshot({ nextDueAt: T0 + 3 * HOUR, lastActivityAt: T0 - 2 * HOUR })).action).toBe("stop");
    const paid = policy({ used: used(450, 20, 0), blockedUntil: null }).decide(snapshot({ nextDueAt: T0 + 3 * HOUR, lastActivityAt: T0 - 2 * HOUR }));
    expect(paid.action).toBe("stay");
  });

  it("waits longer for an owner whose sends come back within the session, and lets go once the session is over", () => {
    const memory = freshMemory(T0 - 14 * DAY);
    for (let d = 14; d >= 1; d--) for (let k = 0; k < 6; k++) observe(memory.stats, T0 - d * DAY - 2 * HOUR + k * 12 * MINUTE, "user");
    const later = structuredClone(memory);
    // the lifecycle observes the home's last activity before it asks
    observe(memory.stats, T0 - 5 * MINUTE, "user");
    const soon = policy().decide(snapshot({ memory, lastActivityAt: T0 - 5 * MINUTE }));
    expect(soon.action).toBe("stay");
    observe(later.stats, T0 + 3 * HOUR - 100 * MINUTE, "user");
    expect(policy().decide(snapshot({ memory: later, now: T0 + 3 * HOUR, awakeSince: T0, lastActivityAt: T0 + 3 * HOUR - 100 * MINUTE })).action).toBe("stop");
  });

  it("whatever the costs say, the rails win: no stop during a turn or right after a start", () => {
    expect(policy().decide(snapshot({ lastActivityAt: T0 - 5 * HOUR, busy: ["turn"] }))).toMatchObject({ action: "stay", reason: "busy:turn" });
    expect(policy().decide(snapshot({ lastActivityAt: T0 - 5 * HOUR, awakeSince: T0 - MINUTE }))).toMatchObject({ action: "stay", reason: "min_uptime" });
  });

  it("wakes a sleeping home for a run inside its spread, not before, and not when its starts keep failing", () => {
    const p = policy(), run = T0 + HOUR, plan = prewake("c1", { at: run, flexMs: 0 }, DEFAULT_POLICY.schedule);
    expect(p.wake({ now: plan.at - MINUTE, cloudId: "c1", nextDueAt: run, memory: freshMemory(T0) })).toMatchObject({ start: false, reason: "not_yet" });
    expect(p.wake({ now: plan.at, cloudId: "c1", nextDueAt: run, memory: freshMemory(T0) })).toMatchObject({ start: true, kind: "routine" });
    const failing = freshMemory(T0);
    for (let i = 0; i < 3; i++) noteFailure(failing, plan.at - 3 * MINUTE + i * 30_000);
    expect(p.wake({ now: plan.at, cloudId: "c1", nextDueAt: run, memory: failing })).toMatchObject({ start: false, reason: "starts_failing" });
  });
});
