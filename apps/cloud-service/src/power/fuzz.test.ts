// property and fuzz tests: random event streams through the rails, and random fleets through the simulator with the
// production policy, in normal conditions and under provider faults. Every run is seeded, so a failure reproduces.
import { describe, expect, it } from "vitest";
import { pooledCostProfile } from "./pooled-profile.ts";
import { DAY, HOUR, MINUTE } from "./cost.ts";
import { MIX, PERSONAS } from "./personas.ts";
import { DEFAULT_POLICY } from "./policy.ts";
import { countSince, DEFAULT_RAILS, freshMemory, minIdleFor, noteFailure, noteHealthy, noteStart, noteStop, startRefusal, stopRefusal } from "./rails.ts";
import { adaptiveDecider, mulberry32, simulate, type Faults, type Persona, type SimUser } from "./sim.ts";

const START = Date.UTC(2026, 10, 2), SMALL = { vcpu: 2, ramGb: 4, diskGb: 40 }, RAILS = DEFAULT_RAILS;

function fleet(rand: () => number, n: number, persona?: Persona, tz?: number): SimUser[] {
  return Array.from({ length: n }, (_, i) => {
    let key = "grok";
    let x = rand();
    for (const [k, w] of MIX) { if ((x -= w) < 0) { key = k; break; } }
    return { id: `u${i}`, persona: persona ?? PERSONAS[key]!, tzHours: tz ?? Math.floor(rand() * 24) - 11, spec: SMALL };
  });
}

describe("the rails, on random event streams", () => {
  const ITERATIONS = 2000;
  it(`never stop work, never undo a start early, and keep every home's starts within budget (${ITERATIONS} streams)`, () => {
    const profile = pooledCostProfile({ plan: "20" });
    for (let seed = 1; seed <= ITERATIONS; seed++) {
      const rand = mulberry32(seed), memory = freshMemory(START);
      let t = START, up = true, awakeSince = START, lastActivity: number | null = null, busyUntil = 0, wakeAt: number | null = null;
      for (let step = 0; step < 120; step++) {
        t += Math.floor(rand() * 20 * MINUTE) + 1000;
        const roll = rand();
        if (roll < 0.35) {
          // a person or a connector: wakes a stopped home (the rails never refuse it here: no failures, an empty pool)
          lastActivity = t; busyUntil = Math.max(busyUntil, t + Math.floor(rand() * 10 * MINUTE));
          if (!up) {
            expect(startRefusal({ now: t, kind: "wake", latest: null, memory, pool: { used: { minute: 0, hour: 0, day: 0 }, blockedUntil: null }, profile }, RAILS)).toBeNull();
            noteStart(memory, t); noteHealthy(memory); up = true; awakeSince = t; wakeAt = t;
          }
        } else if (up) {
          // a policy that always wants to stop: only the rails stand between it and flapping
          const busy = t < busyUntil ? ["turn"] : [];
          const refused = stopRefusal({ now: t, awakeSince, busy, focusSince: null, lastActivityAt: lastActivity, wakeRequestedAt: wakeAt, personWakeAt: wakeAt, nextRunAt: null, memory,
            pool: { used: { minute: 0, hour: 0, day: 0 }, blockedUntil: null }, profile }, RAILS);
          if (!refused) {
            expect(t >= busyUntil).toBe(true);
            expect(t - awakeSince).toBeGreaterThanOrEqual(RAILS.minUptimeMs);
            const minIdle = minIdleFor(memory, t, RAILS).ms;
            if (lastActivity !== null || wakeAt !== null) expect(t - Math.max(lastActivity ?? 0, wakeAt ?? 0)).toBeGreaterThanOrEqual(minIdle);
            noteStop(memory, t); up = false;
          }
        }
        expect(countSince(memory.starts, t - HOUR)).toBeLessThanOrEqual(RAILS.maxStartsPerHour);
        expect(countSince(memory.starts, t - DAY)).toBeLessThanOrEqual(RAILS.maxStartsPerDay);
      }
    }
  });

  it(`a failing home's breaker bounds its automatic starts and backs off (${ITERATIONS} streams)`, () => {
    const profile = pooledCostProfile({ plan: "20" });
    for (let seed = 1; seed <= ITERATIONS; seed++) {
      const rand = mulberry32(seed * 7919), memory = freshMemory(START);
      let t = START, automatic = 0;
      for (let step = 0; step < 200; step++) {
        t += Math.floor(rand() * 2 * MINUTE) + 1000;
        const kind = rand() < 0.5 ? "routine" : "wake";
        if (!startRefusal({ now: t, kind, latest: null, memory, pool: { used: { minute: 0, hour: 0, day: 0 }, blockedUntil: null }, profile }, RAILS)) {
          noteStart(memory, t);
          if (kind === "routine") automatic++;
          // every start fails
          noteFailure(memory, t + 5 * MINUTE, RAILS);
        }
      }
      // with every start failing, the breaker allows a few in its first window and then backs off up to two hours
      expect(memory.breaker).not.toBeNull();
      expect(automatic).toBeLessThan(60);
    }
  });
});

describe("the simulator, normal conditions", () => {
  const FLEETS = 16;
  it(`random fleets never miss a routine, never stop work, keep the caps and never flap (${FLEETS} fleets of 30 homes, 10 days)`, () => {
    for (let seed = 1; seed <= FLEETS; seed++) {
      const rand = mulberry32(seed * 104729);
      const users = fleet(rand, 30);
      const result = simulate({ users, days: 10, warmupDays: 2, start: START, profile: pooledCostProfile({ plan: "2000", scale: 30 / 1000 }), seed, decider: adaptiveDecider(),
        caps: { hour: RAILS.maxStartsPerHour, day: RAILS.maxStartsPerDay } });
      expect(result.violations, `seed ${seed}`).toEqual([]);
      for (const u of result.users) {
        expect(u.runsMissed + u.runsLate, `seed ${seed} ${u.id}`).toBe(0);
        expect(u.minStopGapMs, `seed ${seed} ${u.id}`).toBeGreaterThanOrEqual(RAILS.minUptimeMs);
      }
      expect(result.peak.minute).toBeLessThanOrEqual(pooledCostProfile({ plan: "2000", scale: 30 / 1000 }).hardCap.minute);
    }
  });

  it("a routine storm: 400 homes in one time zone with runs at 08:00 and 18:00, every run on time, never a paid or refused start", () => {
    const storm: Persona = { name: "storm", plan: (rand, m) => ({ events: rand() < 0.3 ? [{ at: m + 19 * HOUR + Math.floor(rand() * 3 * HOUR), kind: "user", workMs: 30_000 }] : [],
      runs: [8, 18].map(h => ({ at: m + h * HOUR, flexMs: 0, runMs: 90_000 })) }) };
    const profile = pooledCostProfile({ plan: "500" });
    const result = simulate({ users: fleet(mulberry32(5), 400, storm, 0), days: 4, warmupDays: 1, start: START, profile, seed: 5, decider: adaptiveDecider() });
    expect(result.violations).toEqual([]);
    expect(result.users.reduce((a, u) => a + u.runsMissed + u.runsLate, 0)).toBe(0);
    expect(result.peak.minute).toBeLessThanOrEqual(profile.included.minute);
    expect(result.users.reduce((a, u) => a + u.paidStarts, 0)).toBe(0);
  });
});

describe("the simulator, under provider faults", () => {
  const FLEETS = 24;
  it(`failed resumes, 429s, stuck stops, lost machines, duplicate webhooks, clock skew and crashes mid-stop: no stop during work, no hard cap, no runaway, and it recovers (${FLEETS} fleets of 12 homes)`, () => {
    for (let seed = 1; seed <= FLEETS; seed++) {
      const rand = mulberry32(seed * 15485863);
      const faults: Faults = { startFail: rand() * 0.25, limit: rand() * 0.15, stuckStop: rand() * 0.2, stuckMs: 30 * MINUTE, lostPerHour: rand() * 0.05,
        duplicate: rand() * 0.3, skewMs: Math.floor(rand() * 3 * MINUTE), crashMidStop: rand() * 0.2 };
      const profile = pooledCostProfile({ plan: "2000", scale: 12 / 1000 });
      // faults for five days, then two calm days to settle, then two measured days
      const result = simulate({ users: fleet(rand, 12), days: 9, warmupDays: 7, start: START, profile, seed, decider: adaptiveDecider(), faults, faultsUntil: START + 5 * DAY });
      expect(result.violations.filter(v => v.includes("stopped during") || v.includes("hard cap")), `seed ${seed}`).toEqual([]);
      expect(result.peak.minute).toBeLessThanOrEqual(profile.hardCap.minute);
      for (const u of result.users) {
        expect(u.runsMissed + u.runsLate, `seed ${seed} ${u.id} recovered`).toBe(0);
        expect(u.maxStartsHour, `seed ${seed} ${u.id}`).toBeLessThanOrEqual(RAILS.maxStartsPerHour);
      }
    }
  });

  it("while faults last, a home's starts stay bounded (no restart loop)", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const faults: Faults = { startFail: 0.5, limit: 0.2, stuckStop: 0.3, stuckMs: 20 * MINUTE, lostPerHour: 0.1, duplicate: 0.5, skewMs: 2 * MINUTE, crashMidStop: 0.3 };
      const result = simulate({ users: fleet(mulberry32(seed), 10), days: 4, warmupDays: 1, start: START, profile: pooledCostProfile({ plan: "2000", scale: 0.01 }), seed, decider: adaptiveDecider(), faults });
      expect(result.violations.filter(v => v.includes("stopped during") || v.includes("hard cap")), `seed ${seed}`).toEqual([]);
      for (const u of result.users) expect(u.maxStartsDay, `seed ${seed} ${u.id}`).toBeLessThanOrEqual(60);
    }
  });

  it("the policy's defaults are the tuned ones the report was made with", () => {
    expect(DEFAULT_POLICY.rails).toBe(DEFAULT_RAILS);
  });
});
