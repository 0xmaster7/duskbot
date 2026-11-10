// the monthly ceiling under fire: month-long random streams against the real ledger (replayed from its log on every
// service restart) and the rails' cost rule, with an adversarial policy that stops whenever it may, and the provider's
// truth kept apart: lost machines, failed and crashing starts, provider stops, 429s, 5xx after which a machine may or may
// not run, hung stops, clock jumps, restarts (one between a charge and the provider call), mid-month resizes, retired
// disks' keep-alives, backups growing and pruned, month boundaries in leap and 28-day Februaries. Every complete month's
// true spend must stay at or under its ceiling, and a person's wake is refused only once the provider caused the
// reserve's worth of starts this month (or the month opened with less than the reserve, which storage alone can do).
import { describe, expect, it } from "vitest";
import { boatCostProfile, boatHourlyCents, BOAT_SIZES } from "../boat.ts";
import { createSpendLedger, memorySpendStore, type SpendInit } from "../spend.ts";
import { ceilingFactor, monthOf } from "./ceiling.ts";
import { DAY, HOUR, MINUTE } from "./cost.ts";
import { costChargeRefusal, costStartRefusal, costStopRefusal, type StartKind } from "./rails.ts";
import { MIX, PERSONAS } from "./personas.ts";
import { adaptiveDecider, mulberry32, simulate, type Faults, type SimUser } from "./sim.ts";

const profile = boatCostProfile({ plan: "20" }), N = 5, W = 7, STORAGE = 1.5;
const RATES = BOAT_SIZES.map(z => boatHourlyCents(z));

interface MonthTruth { key: string; hours: number; spend: number; ceiling: number; complete: boolean; rate: number }
export interface StreamResult { months: MonthTruth[]; violations: string[]; refusals: number; personWakes: number; starts: number; worstShare: number }

/** heavy: a fault on a large share of everything */
export function stream(seed: number, heavy = 1): StreamResult {
  const rand = mulberry32(seed), chance = (p: number) => rand() < p * heavy, pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  // start anywhere in 2024..2028, often right before a month ends, often in a February
  const y = 2024 + Math.floor(rand() * 5), m = rand() < 0.3 ? 1 : Math.floor(rand() * 12);
  let T = rand() < 0.4 ? Date.UTC(y, m + 1, 1) - Math.floor(rand() * 3 * DAY) : Date.UTC(y, m, 1) + Math.floor(rand() * 27 * DAY);
  const end = T + Math.floor((32 + rand() * 40) * DAY);
  let skew = 0, monoBase = rand() * 1e9, rate = pick(RATES);
  const store = memorySpendStore(), cloud = "c1";
  const make = () => createSpendLedger({ store, profile, reserveStarts: N, now: () => T + skew, mono: () => monoBase + T });
  let ledger = make();
  // the home is new: nothing spent before it, every start after it charged
  const init = (): SpendInit => ({ rate, up: false, bytes: 0, prepaid: true, before: false });
  const violations: string[] = [];
  // ---- the provider's truth
  let on = false, stopDoneAt = 0, bytes = 0, extraUntil = 0, extraRate = 0;
  const gens: number[] = [];
  const months = new Map<string, MonthTruth>();
  const truth = (t: number) => { const mo = monthOf(t); let r = months.get(mo.key); if (!r) { r = { key: mo.key, hours: mo.hours, spend: 0, ceiling: 0, complete: false, rate }; months.set(mo.key, r); } return r; };
  { const mo = monthOf(T); truth(T).ceiling += rate * ceilingFactor(mo.hours) * (T - mo.start) / HOUR; }
  function accrue(to: number) {
    while (T < to) {
      const mo = monthOf(T), until = Math.min(to, mo.end), h = (until - T) / HOUR, r = truth(T);
      r.ceiling += rate * ceilingFactor(mo.hours) * h;
      if (on || stopDoneAt > T) r.spend += rate * (Math.min(until, on ? until : stopDoneAt) - T) / HOUR;
      if (extraUntil > T) r.spend += extraRate * (Math.min(until, extraUntil) - T) / HOUR;
      r.spend += bytes / 1e9 * STORAGE / mo.hours * h;
      r.rate = Math.max(r.rate, rate);
      if (until === mo.end) r.complete = true;
      T = until;
    }
  }
  const pay = (cents: number) => { truth(T).spend += cents; };
  // ---- the home and the people
  let personUntil = 0, personWaiting: number | null = null, nextPerson = T + rand() * 6 * HOUR, routineAt = T + rand() * 3 * HOUR;
  let lostAt: number | null = null, rebuild = false, providerStopped = false, uptimeUntil = 0, crashAt: number | null = null, resizeTo: number | null = null;
  let refusals = 0, personWakes = 0, starts = 0, refusedEpisode = false;
  const openSlack = new Map<string, number>();
  const view = () => {
    const v = ledger.view(cloud, init), key = ledger.book(cloud).current!.month;
    if (!openSlack.has(key)) openSlack.set(key, v.slackCents);
    if (v.slackCents < -1e-6) violations.push(`${seed}: slack ${v.slackCents.toFixed(3)} at ${new Date(T).toISOString()}`);
    return v;
  };

  function tryStart(kind: StartKind, person: boolean): boolean {
    const v = view(), refused = costStartRefusal(v, kind, T);
    if (refused) {
      if (person) {
        if (!refusedEpisode) { refusals++; refusedEpisode = true; }
        const b = ledger.book(cloud).current!, opened = openSlack.get(b.month) ?? Infinity;
        if (b.unplanned < N && opened >= (N + 1) * W) violations.push(`${seed}: a person refused with ${b.unplanned} unplanned starts, slack ${v.slackCents.toFixed(2)} (opened ${opened.toFixed(2)}) at ${new Date(T).toISOString()}`);
      }
      return false;
    }
    if (kind === "resize" && resizeTo !== null) { rate = resizeTo; resizeTo = null; ledger.record(cloud, init, { e: "rate", rate }); }
    ledger.record(cloud, init, { e: "start", kind, cents: W });
    starts++;
    // the service dies after the charge and before asking the provider: nothing ran, the charge stays
    if (chance(0.01)) { skew = 0; monoBase = rand() * 1e9; ledger = make(); return false; }
    const roll = rand();
    if (roll < 0.08 * heavy) { ledger.record(cloud, init, { e: "settle", cents: W, void: true }); return false; }
    if (roll < 0.14 * heavy) { if (rand() < 0.5) { pay(pick([3, 5, 7])); on = true; crashAt = T + rand() * 20 * MINUTE; } return false; }
    const price = pick([0, 0, 0, 3, 5, 7]);
    pay(price); on = true; uptimeUntil = T + 6 * MINUTE;
    if (price < W) ledger.record(cloud, init, { e: "settle", cents: W - price });
    // a start that never brings the home up: the provider stops the broken machine a few minutes later
    if (chance(0.15)) crashAt = T + rand() * 10 * MINUTE;
    return true;
  }

  while (T < end) {
    const t = Math.min(end, T + Math.floor((1 + rand() * 15) * MINUTE));
    accrue(t);
    if (T >= end) break;
    // the clock and the service
    if (chance(0.004)) skew = rand() < 0.5 ? 0 : Math.floor((rand() * 2 - 1) * 20 * DAY);
    if (chance(0.002)) { skew = 0; monoBase = rand() * 1e9; ledger = make(); }
    // the provider
    if (on && crashAt !== null && T >= crashAt) { on = false; crashAt = null; providerStopped = true; }
    if (on && chance(0.003)) { on = false; lostAt = T; }
    if (on && chance(0.004)) { on = false; providerStopped = true; }
    if (extraUntil && T >= extraUntil) extraUntil = 0;
    // what the service observes: stopped, or (30 minutes later) gone
    if (!on && stopDoneAt <= T && (lostAt === null || T - lostAt >= 30 * MINUTE)) {
      ledger.mark(cloud, init, false);
      if (lostAt !== null) { lostAt = null; rebuild = true; }
    }
    // people
    if (T >= nextPerson) { personUntil = Math.max(personUntil, T + rand() * 2 * HOUR); if (!on && personWaiting === null) { personWaiting = T; personWakes++; refusedEpisode = false; } nextPerson = T + rand() * (rand() < 0.3 ? 20 * MINUTE : 10 * HOUR); }
    if (rand() < 0.002) resizeTo = pick(RATES);
    if (!on && stopDoneAt <= T && lostAt === null) {
      const person = personWaiting !== null || T < personUntil;
      if (rebuild) { if (tryStart("recover", person)) rebuild = false; }
      else if (person) { if (tryStart(resizeTo !== null ? "resize" : "wake", true)) personWaiting = null; }
      else if (providerStopped) { if (tryStart("wake", false)) providerStopped = false; }
      else if (T >= routineAt) { if (tryStart("routine", false)) routineAt = T + rand() * 8 * HOUR; }
    } else if (on && T >= uptimeUntil && T >= personUntil && crashAt === null) {
      // the adversary: stops whenever the rails let it
      if (!costStopRefusal(view(), T)) {
        ledger.record(cloud, init, { e: "stop" }); on = false; providerStopped = false;
        stopDoneAt = chance(0.05) ? T + rand() * 30 * MINUTE : T;
      }
    }
    // backups: a new generation charged before it is written, the oldest pruned past three
    if (chance(0.01)) {
      const size = Math.floor((0.2 + rand() * 2.3) * 1e9);
      if (!costChargeRefusal(view(), ledger.storageCents(cloud, init, size), T)) {
        gens.push(size); bytes += size; ledger.record(cloud, init, { e: "bytes", bytes });
        while (gens.length > 3) bytes -= gens.shift()!;
        ledger.record(cloud, init, { e: "bytes", bytes });
      }
    }
    // a retired disk's keep-alive: a second machine for up to the lease
    if (!extraUntil && chance(0.002)) {
      const extra = rate * 2;
      if (!costStartRefusal(view(), "refresh", T, extra)) {
        ledger.record(cloud, init, { e: "extra", cents: W + extra, why: "retired_refresh" });
        pay(pick([0, 3, 7])); extraRate = rate; extraUntil = T + rand() * 2 * HOUR;
      }
    }
  }
  const list = [...months.values()];
  let worstShare = 0;
  for (const r of list) {
    if (r.complete && r.spend > r.ceiling + 1e-6) violations.push(`${seed}: ${r.key} spent ${r.spend.toFixed(3)} over its ceiling ${r.ceiling.toFixed(3)}`);
    if (r.complete) worstShare = Math.max(worstShare, r.spend / r.ceiling);
  }
  return { months: list, violations, refusals, personWakes, starts, worstShare };
}

export const FUZZ_STREAMS = 600;
describe("the monthly cost ceiling, on month-long streams with heavy faults", () => {
  it(`never lets a month's spend pass its ceiling, never refuses a person within the reserve (${FUZZ_STREAMS} streams, about 50 days each)`, () => {
    const violations: string[] = [];
    let months = 0, worst = 0, refusals = 0, wakes = 0;
    for (let seed = 1; seed <= FUZZ_STREAMS; seed++) {
      const r = stream(seed, seed % 3 === 0 ? 2.5 : 1);
      violations.push(...r.violations); months += r.months.filter(m => m.complete).length; worst = Math.max(worst, r.worstShare); refusals += r.refusals; wakes += r.personWakes;
    }
    console.log(`ceiling fuzz: ${FUZZ_STREAMS} streams, ${months} complete months, worst spend ${(worst * 100).toFixed(2)}% of the ceiling, ${refusals} of ${wakes} person wakes refused (all past the reserve)`);
    expect(violations.slice(0, 10)).toEqual([]);
    expect(months).toBeGreaterThan(FUZZ_STREAMS);
  }, 180_000);
});

export const SIM_FLEETS = 12;
describe("the monthly cost ceiling, through the simulator with the production policy", () => {
  it(`every home's every complete month stays under its ceiling, in leap and 28-day Februaries, under heavy faults (${SIM_FLEETS} fleets of 8 homes, 62 days each)`, () => {
    let worst = 0, months = 0, refusals = 0;
    for (let seed = 1; seed <= SIM_FLEETS; seed++) {
      const rand = mulberry32(seed * 7919);
      const faults: Faults = { startFail: rand() * 0.4, limit: rand() * 0.2, stuckStop: rand() * 0.3, stuckMs: 40 * MINUTE, lostPerHour: rand() * 0.1,
        duplicate: rand() * 0.3, skewMs: Math.floor(rand() * 3 * MINUTE), crashMidStop: rand() * 0.3 };
      const users: SimUser[] = Array.from({ length: 8 }, (_, i) => {
        let key = "grok", x = rand();
        for (const [k, w] of MIX) { if ((x -= w) < 0) { key = k; break; } }
        return { id: `u${i}`, persona: PERSONAS[key]!, tzHours: Math.floor(rand() * 24) - 11, spec: BOAT_SIZES[Math.floor(rand() * BOAT_SIZES.length)]! };
      });
      // a Monday in January of a leap year or not, so the run covers the whole of February and March
      const start = seed % 2 ? Date.UTC(2028, 0, 3) : Date.UTC(2027, 0, 4);
      const result = simulate({ users, days: 62, start, profile: boatCostProfile({ plan: "2000", scale: 0.008 }), seed, decider: adaptiveDecider(), faults, backupBytes: Math.floor(rand() * 8e9) });
      for (const u of result.users) for (const m of u.months) {
        if (!m.complete) continue;
        months++; worst = Math.max(worst, m.spendCents / m.ceilingCents);
        expect(m.spendCents, `seed ${seed} ${u.id} ${m.key}`).toBeLessThanOrEqual(m.ceilingCents + 1e-6);
      }
      refusals += result.users.reduce((a, u) => a + u.costRefusals, 0);
    }
    console.log(`ceiling sim fuzz: ${SIM_FLEETS} fleets, ${months} complete home-months, worst ${(worst * 100).toFixed(2)}% of the ceiling, ${refusals} wakes held for cost`);
    expect(months).toBeGreaterThanOrEqual(SIM_FLEETS * 8 * 2);
  }, 180_000);
});
