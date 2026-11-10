// A deterministic, seeded simulator of a fleet of homes on one provider account: every user's intent events, connector
// events and routine runs over days, the machines' starts, stops and held resumes, the shared start pool with the
// provider's own prices, and (for the fuzz tests) provider faults. It drives the production policy (decide and wake,
// with its rails) or a baseline through the same small interface, and reports cost, starts, waits and routine timing.
import type { MachineSpec } from "../../../../shared/billing-api.ts";
import { DAY, HOUR, MINUTE, type ProviderCostProfile } from "./cost.ts";
import { createRollingPool, type RollingPool } from "./pool.ts";
import { createPowerPolicy, DEFAULT_POLICY, type PolicyParams } from "./policy.ts";
import { observe, type PredictorParams } from "./predictor.ts";
import { freshMemory, noteFailure, noteHealthy, noteStart, noteStop, startRefusal, type PowerMemory, type StartKind } from "./rails.ts";
import { plannedRuns } from "./schedule.ts";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedOf(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export interface IntentEvent { at: number; kind: "user" | "connector"; workMs: number }
export interface SimRun { at: number; flexMs: number; runMs: number }
export interface DayPlan { events: IntentEvent[]; runs: SimRun[] }
export interface Persona {
  name: string;
  /** one local day: `midnight` is that day's local midnight as a UTC time, `weekday` 0 = Sunday */
  plan(rand: () => number, midnight: number, weekday: number): DayPlan;
}
export interface SimUser { id: string; persona: Persona; tzHours: number; spec: MachineSpec }

export interface Faults {
  /** a start that never brings the home up */
  startFail: number;
  /** a start the provider refuses with a limit and a not-before time */
  limit: number;
  /** a stop that hangs (the machine stays unreachable, unbilled) for up to stuckMs */
  stuckStop: number;
  stuckMs: number;
  /** per awake hour: the machine is lost and stops by itself */
  lostPerHour: number;
  /** each event delivered twice */
  duplicate: number;
  /** the home's clock is off by up to this */
  skewMs: number;
  /** the lifecycle crashed after a stop and before recording it */
  crashMidStop: number;
}
export const NO_FAULTS: Faults = { startFail: 0, limit: 0, stuckStop: 0, stuckMs: 0, lostPerHour: 0, duplicate: 0, skewMs: 0, crashMidStop: 0 };

/** one home as the simulator runs it */
export interface SimHome {
  user: SimUser;
  machine: "off" | "starting" | "on" | "stopping";
  heldUntil: number;
  readyAt: number;
  startAt: number;
  failing: boolean;
  stopDoneAt: number;
  awakeSince: number;
  busyUntil: number;
  busyKind: "turn" | "run";
  lastActivityAt: number | null;
  wakeRequestedAt: number | null;
  lastStopAt: number | null;
  skewMs: number;
  memory: PowerMemory;
  events: IntentEvent[];
  ei: number;
  runs: Array<SimRun & { started?: boolean; forced?: boolean }>;
  waiting: IntentEvent[];
  nextCheck: number;
  /** the oracle's planned wake */
  plannedWakeAt: number | null;
  genDay: number;
  /** the next roll of the lost-machine fault */
  lostCheckAt: number;
}

export interface Decider {
  name: string;
  /** keeps the rails and the policy's memory (the production policy) */
  real: boolean;
  /** the predictor's settings, so its observations decay as its predictions do */
  predictor?: PredictorParams;
  decide(h: SimHome, now: number): { stop: boolean; recheckAt: number; reason: string };
  wake(h: SimHome, now: number): { start: boolean; recheckAt: number };
}
export interface DeciderEnv {
  profile: ProviderCostProfile;
  /** what the lifecycle's ledger counts (every start it asked for, held resumes included) */
  ledger: RollingPool;
  blockedUntil(): number | null;
  /** the provider's own count, for the oracle's prices */
  pool: RollingPool;
  busy(h: SimHome, now: number): string[];
}

export interface UserResult {
  id: string;
  persona: string;
  computeCents: number;
  startCents: number;
  /** starts the provider counted, paid ones, resumes of the kept machine */
  starts: number;
  paidStarts: number;
  heldResumes: number;
  intents: number;
  /** intent events that had to wait for a wake, the waits, and their cost at the shadow prices */
  waited: number;
  waitMs: number[];
  waitCents: number;
  runs: number;
  runsLate: number;
  runsMissed: number;
  awakeMs: number;
  stops: number;
  /** a stop followed by a start within 10 minutes */
  quickRestarts: number;
  /** the shortest time between two of this home's stops */
  minStopGapMs: number;
  maxStartsHour: number;
  maxStartsDay: number;
  limited: number;
  failedStarts: number;
}
export interface SimResult {
  decider: string;
  days: number;
  users: UserResult[];
  peak: { minute: number; hour: number; day: number };
  violations: string[];
}

export interface SimOptions {
  users: readonly SimUser[];
  days: number;
  /** a Monday, 00:00 UTC */
  start: number;
  profile: ProviderCostProfile;
  decider(env: DeciderEnv): Decider;
  seed: number;
  faults?: Faults;
  /** days at the start not counted (the predictor learning, the fleet settling) */
  warmupDays?: number;
  /** the wait prices the results are costed at */
  waitPrices?: { user: number; connector: number };
  /** per-home cap checks for the fuzz tests: hour and day */
  caps?: { hour: number; day: number };
  /** faults stop at this time (the fleet then has to recover by itself) */
  faultsUntil?: number;
}

const FAIL_TIMEOUT_MS = 5 * MINUTE;

class Heap {
  private keys: number[] = []; private items: number[] = [];
  push(key: number, item: number) {
    const k = this.keys, it = this.items;
    let i = k.length; k.push(key); it.push(item);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p]! <= key) break; k[i] = k[p]!; it[i] = it[p]!; i = p; }
    k[i] = key; it[i] = item;
  }
  pop(): [number, number] | null {
    const k = this.keys, it = this.items;
    if (!k.length) return null;
    const top: [number, number] = [k[0]!, it[0]!], lastK = k.pop()!, lastI = it.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lastK;
        if (l < k.length && k[l]! < mk) { m = l; mk = k[l]!; }
        if (r < k.length && k[r]! < mk) { m = r; mk = k[r]!; }
        if (m === i) break;
        k[i] = k[m]!; it[i] = it[m]!; i = m;
      }
      k[i] = lastK; it[i] = lastI;
    }
    return top;
  }
}

/** the home's busy codes at `now`, as server/cloud-power.ts reports them */
export function busyCodes(h: SimHome, now: number): string[] {
  const busy: string[] = [];
  if (now < h.busyUntil) busy.push(h.busyKind);
  else if (h.busyUntil > 0 && now - h.busyUntil < 2 * MINUTE) busy.push("recent-work");
  if (now - h.awakeSince < 2 * MINUTE) busy.push("just-woke");
  const run = h.runs.find(r => !r.started);
  if (run && run.at - now < 5 * MINUTE && run.at + run.flexMs >= now) busy.push("due-soon");
  return busy;
}

export function simulate(options: SimOptions): SimResult {
  const { profile, start } = options, end = start + options.days * DAY;
  let faults = options.faults ?? NO_FAULTS;
  const measureFrom = start + (options.warmupDays ?? 0) * DAY;
  const waitPrices = options.waitPrices ?? { user: DEFAULT_POLICY.prices.userWaitCents, connector: DEFAULT_POLICY.prices.connectorWaitCents };
  const pool = createRollingPool(), ledger = createRollingPool();
  let blockedUntil: number | null = null;
  const env: DeciderEnv = { profile, ledger, pool, blockedUntil: () => blockedUntil, busy: busyCodes };
  const decider = options.decider(env);
  const faultRand = mulberry32(seedOf(options.seed, "faults"));
  const violations: string[] = [];
  const violate = (text: string) => { if (violations.length < 200) violations.push(text); else violations[199] = `${text} (and more)`; };
  const peak = { minute: 0, hour: 0, day: 0 };
  const results: UserResult[] = [];
  const startLog: number[][] = [];
  const homes: SimHome[] = options.users.map((user, i) => {
    results.push({ id: user.id, persona: user.persona.name, computeCents: 0, startCents: 0, starts: 0, paidStarts: 0, heldResumes: 0, intents: 0, waited: 0, waitMs: [], waitCents: 0,
      runs: 0, runsLate: 0, runsMissed: 0, awakeMs: 0, stops: 0, quickRestarts: 0, minStopGapMs: Number.POSITIVE_INFINITY, maxStartsHour: 0, maxStartsDay: 0, limited: 0, failedStarts: 0 });
    startLog.push([]);
    const skewMs = faults.skewMs ? Math.round((faultRand() * 2 - 1) * faults.skewMs) : 0;
    return { user, machine: "on", heldUntil: 0, readyAt: start, startAt: start, failing: false, stopDoneAt: 0, awakeSince: start, busyUntil: 0, busyKind: "turn",
      lastActivityAt: null, wakeRequestedAt: null, lastStopAt: null, skewMs, memory: freshMemory(start), events: [], ei: 0, runs: [], waiting: [], nextCheck: start + MINUTE + i % 60 * 1000,
      plannedWakeAt: null, genDay: 0, lostCheckAt: start + HOUR } satisfies SimHome;
  });
  const index = new Map(homes.map((h, i) => [h, i]));
  const rateOf = (h: SimHome) => profile.computeCentsPerHour(h.user.spec) / HOUR;
  const res = (h: SimHome) => results[index.get(h)!]!;

  function generate(h: SimHome, until: number) {
    while (start + h.genDay * DAY - h.user.tzHours * HOUR < until + DAY) {
      const midnight = start + h.genDay * DAY - h.user.tzHours * HOUR;
      const plan = h.user.persona.plan(mulberry32(seedOf(options.seed, h.user.id, h.genDay)), midnight, (1 + h.genDay) % 7);
      let events = plan.events;
      if (faults.duplicate) events = events.flatMap(e => faultRand() < faults.duplicate ? [e, { ...e, at: e.at + 1 + Math.floor(faultRand() * 2000) }] : [e]);
      h.events = [...h.events.slice(h.ei), ...events].sort((a, b) => a.at - b.at); h.ei = 0;
      h.runs = [...h.runs.filter(r => !r.started), ...plan.runs.map(r => ({ ...r }))].sort((a, b) => a.at - b.at);
      h.genDay++;
    }
  }
  function compute(h: SimHome, from: number, to: number) {
    const a = Math.max(from, measureFrom), b = Math.min(to, end);
    if (b > a) { res(h).computeCents += rateOf(h) * (b - a); res(h).awakeMs += b - a; }
  }
  function serve(h: SimHome, e: IntentEvent, at: number) {
    const wait = Math.max(0, at - e.at), r = res(h);
    if (e.at >= measureFrom) {
      r.intents++;
      if (wait > 0) { r.waited++; r.waitMs.push(wait); r.waitCents += (wait / profile.wakeMs.cold) * (e.kind === "user" ? waitPrices.user : waitPrices.connector); }
    }
    if (at + e.workMs > h.busyUntil || h.busyUntil <= at) { h.busyUntil = Math.max(h.busyUntil, at + e.workMs); h.busyKind = "turn"; }
  }
  function runNow(h: SimHome, run: SimRun & { started?: boolean }, at: number) {
    run.started = true;
    const due = run.at + run.flexMs, late = at - due, r = res(h);
    if (run.at >= measureFrom) { r.runs++; if (late > 10 * MINUTE) r.runsMissed++; else if (late > MINUTE) r.runsLate++; }
    if (at + run.runMs > h.busyUntil) { h.busyUntil = at + run.runMs; h.busyKind = "run"; }
  }
  function stop(h: SimHome, now: number) {
    if (now < h.busyUntil) violate(`${h.user.id} stopped during ${h.busyKind} at ${now}`);
    compute(h, h.startAt, now);
    if (h.lastStopAt !== null && now >= measureFrom) res(h).minStopGapMs = Math.min(res(h).minStopGapMs, now - h.lastStopAt);
    h.lastStopAt = now;
    if (now >= measureFrom) res(h).stops++;
    if (decider.real && !(faults.crashMidStop && faultRand() < faults.crashMidStop)) noteStop(h.memory, now);
    const stuck = faults.stuckStop && faultRand() < faults.stuckStop;
    h.machine = stuck ? "stopping" : "off";
    h.stopDoneAt = stuck ? now + Math.floor(faultRand() * faults.stuckMs) : now;
    h.heldUntil = faultRand() < profile.held.probability ? h.stopDoneAt + profile.held.windowMs : 0;
    h.busyUntil = Math.min(h.busyUntil, now);
  }
  /** a start: refused by the rails or the provider (then tried again), else under way */
  function startHome(h: SimHome, now: number, kind: StartKind): boolean {
    if (h.machine === "stopping") { h.nextCheck = Math.min(h.nextCheck, h.stopDoneAt); return false; }
    if (h.machine !== "off") return true;
    if (decider.real) {
      const refused = startRefusal({ now, kind, latest: null, memory: h.memory, pool: { used: ledger.used(now), blockedUntil }, profile });
      if (refused) { h.nextCheck = Math.min(h.nextCheck, refused.recheckAt); return false; }
    }
    if (blockedUntil !== null && blockedUntil > now) { h.nextCheck = Math.min(h.nextCheck, blockedUntil); return false; }
    const r = res(h), counting = now >= measureFrom;
    if (faults.limit && faultRand() < faults.limit) {
      blockedUntil = now + 30_000 + Math.floor(faultRand() * 270_000);
      if (counting) r.limited++;
      h.nextCheck = Math.min(h.nextCheck, blockedUntil); return false;
    }
    const held = now < h.heldUntil;
    if (!held) {
      const used = pool.used(now), price = profile.startCents(used);
      if (!Number.isFinite(price)) {
        violate(`${h.user.id} start refused by the provider's hard cap at ${now}`);
        blockedUntil = Math.min(...(["minute", "hour", "day"] as const).map(w => pool.roomAt(now, w, profile.hardCap[w])).filter(t => t > now), now + MINUTE);
        h.nextCheck = Math.min(h.nextCheck, blockedUntil); return false;
      }
      pool.add(now);
      const u = pool.used(now);
      peak.minute = Math.max(peak.minute, u.minute); peak.hour = Math.max(peak.hour, u.hour); peak.day = Math.max(peak.day, u.day);
      if (counting) { r.starts++; r.startCents += price; if (price > 0) r.paidStarts++; }
    } else if (counting) r.heldResumes++;
    ledger.add(now);
    if (decider.real) noteStart(h.memory, now);
    const log = startLog[index.get(h)!]!;
    log.push(now);
    if (counting) {
      const hour = log.filter(t => t > now - HOUR).length, day = log.filter(t => t > now - DAY).length;
      r.maxStartsHour = Math.max(r.maxStartsHour, hour); r.maxStartsDay = Math.max(r.maxStartsDay, day);
      if (h.lastStopAt !== null && now - h.lastStopAt < 10 * MINUTE) r.quickRestarts++;
    }
    while (log.length && log[0]! <= now - DAY) log.shift();
    h.machine = "starting"; h.startAt = now; h.heldUntil = 0;
    h.readyAt = now + (held ? profile.wakeMs.held : profile.wakeMs.cold);
    h.failing = faults.startFail > 0 && faultRand() < faults.startFail;
    return true;
  }
  function ready(h: SimHome, now: number) {
    h.machine = "on"; h.awakeSince = now; h.plannedWakeAt = null; h.lostCheckAt = now + HOUR;
    if (decider.real) noteHealthy(h.memory);
    for (const e of h.waiting.splice(0)) serve(h, e, now);
    const run = h.runs.find(r => !r.started);
    if (run && now >= run.at - run.flexMs) runNow(h, run, now);
    h.nextCheck = now + MINUTE;
  }
  function intent(h: SimHome, e: IntentEvent, now: number) {
    if (decider.real) observe(h.memory.stats, e.at + h.skewMs, e.kind, decider.predictor ?? DEFAULT_POLICY.predictor);
    h.lastActivityAt = Math.max(h.lastActivityAt ?? 0, e.at + h.skewMs);
    if (h.machine === "on") { serve(h, e, now); h.nextCheck = Math.min(h.nextCheck, now + MINUTE); return; }
    h.waiting.push(e);
    if (h.machine === "off") { h.wakeRequestedAt = now; startHome(h, now, "wake"); }
  }
  function nextTime(h: SimHome): number {
    let t = h.nextCheck;
    if (h.machine === "starting") t = Math.min(t, h.failing ? h.startAt + FAIL_TIMEOUT_MS : h.readyAt);
    if (h.machine === "stopping") t = Math.min(t, h.stopDoneAt);
    const e = h.events[h.ei];
    if (e) t = Math.min(t, e.at);
    const run = h.runs.find(r => !r.started);
    if (run && (h.machine === "on" || !run.forced)) t = Math.min(t, h.machine === "on" ? Math.max(run.at - run.flexMs, 0) : run.at + run.flexMs);
    if (h.machine === "on" && faults.lostPerHour) t = Math.min(t, h.lostCheckAt);
    return t;
  }

  const heap = new Heap();
  homes.forEach((h, i) => { generate(h, start); heap.push(nextTime(h), i); });
  for (;;) {
    const top = heap.pop();
    if (!top) break;
    const [t, i] = top, h = homes[i]!;
    if (t >= end) continue;
    if (options.faultsUntil !== undefined && t >= options.faultsUntil) faults = NO_FAULTS;
    generate(h, t);
    // what is due now, in a fixed order
    if (h.machine === "starting" && h.failing && t >= h.startAt + FAIL_TIMEOUT_MS) {
      compute(h, h.startAt, t); h.machine = "off"; h.heldUntil = 0;
      if (t >= measureFrom) res(h).failedStarts++;
      if (decider.real) noteFailure(h.memory, t);
      h.nextCheck = t;
    } else if (h.machine === "starting" && !h.failing && t >= h.readyAt) ready(h, t);
    if (h.machine === "stopping" && t >= h.stopDoneAt) h.machine = "off";
    if (h.machine === "on" && faults.lostPerHour && t >= h.lostCheckAt) {
      h.lostCheckAt = t + HOUR;
      // lost: it stops by itself (no pre-stop, no held machine); work under way is resumed at once, as the lifecycle does
      if (faultRand() < faults.lostPerHour) { const busy = t < h.busyUntil; h.busyUntil = Math.min(h.busyUntil, t); compute(h, h.startAt, t); h.machine = "off"; h.heldUntil = 0; if (busy) startHome(h, t, "recover"); }
    }
    while (h.events[h.ei] && h.events[h.ei]!.at <= t) intent(h, h.events[h.ei++]!, t);
    const run = h.runs.find(r => !r.started);
    if (run) {
      if (h.machine === "on" && t >= run.at - run.flexMs) runNow(h, run, t);
      // overdue and still asleep: one forced start now; if the rails hold it, the next check tries again
      else if (h.machine === "off" && t >= run.at + run.flexMs && !run.forced) { run.forced = true; startHome(h, t, "routine"); }
    }
    if (t >= h.nextCheck) {
      if (h.machine === "on") {
        const d = decider.decide(h, t);
        if (d.stop) { stop(h, t); h.nextCheck = t + 15_000; }
        else h.nextCheck = Math.max(t + 15_000, d.recheckAt);
      } else if (h.machine === "off") {
        if (h.waiting.length) { h.nextCheck = t + 30_000; startHome(h, t, "wake"); }
        else {
          const w = decider.wake(h, t);
          h.nextCheck = Math.max(t + 15_000, w.recheckAt);
          if (w.start) startHome(h, t, "routine");
        }
      } else h.nextCheck = t + 30_000;
    }
    heap.push(Math.max(t + 1, nextTime(h)), i);
  }
  for (const h of homes) if (h.machine === "on" || h.machine === "starting") compute(h, h.startAt, end);
  if (options.caps) for (const r of results) {
    if (r.maxStartsHour > options.caps.hour) violations.push(`${r.id} made ${r.maxStartsHour} starts in an hour`);
    if (r.maxStartsDay > options.caps.day) violations.push(`${r.id} made ${r.maxStartsDay} starts in a day`);
  }
  return { decider: decider.name, days: options.days - (options.warmupDays ?? 0), users: results, peak, violations };
}

// ---- the deciders: the production policy, and the baselines it is measured against

/** the production policy (policy.ts with its rails), exactly as the lifecycle calls it */
export function adaptiveDecider(params: PolicyParams = DEFAULT_POLICY, name = "adaptive") {
  return (env: DeciderEnv): Decider => {
    let now = 0;
    const policy = createPowerPolicy({ profile: env.profile, params, pool: () => ({ used: env.ledger.used(now), blockedUntil: env.blockedUntil() }) });
    const upcoming = (h: SimHome, t: number) => plannedRuns(null, h.runs.filter(r => !r.started).slice(0, 4).map(r => ({ at: r.at, flexMs: r.flexMs })), t);
    return {
      name, real: true, predictor: params.predictor,
      decide(h, t) {
        now = t;
        const d = policy.decide({ now: t, cloudId: h.user.id, spec: h.user.spec, awakeSince: h.awakeSince, lastActivityAt: h.lastActivityAt, busy: env.busy(h, t), focusSince: null,
          nextDueAt: null, upcoming: upcoming(h, t), homeIdle: true, wakeRequestedAt: h.wakeRequestedAt, memory: h.memory });
        return { stop: d.action === "stop", recheckAt: Math.min(Math.max(d.recheckAt, t + MINUTE), t + 5 * MINUTE), reason: d.reason };
      },
      wake(h, t) {
        now = t;
        const w = policy.wake({ now: t, cloudId: h.user.id, nextDueAt: null, upcoming: upcoming(h, t), memory: h.memory });
        return { start: w.start, recheckAt: w.recheckAt };
      },
    };
  };
}

const HARD_BUSY = new Set(["turn", "run", "recent-work", "just-woke", "due-soon"]);
/** stop after a fixed idle time; wake `leadMs` before a run; never stop with a run due within 10 minutes */
export function fixedIdleDecider(idleMs: number, options: { leadMs?: number; cronMs?: number; name?: string } = {}) {
  const lead = options.leadMs ?? 5 * MINUTE, cron = options.cronMs ?? 0, guard = 10 * MINUTE;
  const tick = (t: number) => cron ? Math.ceil(t / cron) * cron : t;
  return (env: DeciderEnv): Decider => ({
    name: options.name ?? `idle-${idleMs / MINUTE}m`, real: false,
    decide(h, t) {
      if (env.busy(h, t).some(b => HARD_BUSY.has(b))) return { stop: false, recheckAt: tick(t + MINUTE), reason: "busy" };
      const run = h.runs.find(r => !r.started);
      if (run && run.at - run.flexMs - t <= guard) return { stop: false, recheckAt: tick(Math.max(t + MINUTE, run.at - run.flexMs + MINUTE)), reason: "run_due" };
      const idleFrom = Math.max(h.lastActivityAt ?? 0, h.awakeSince);
      if (t - idleFrom < idleMs) return { stop: false, recheckAt: tick(idleFrom + idleMs), reason: "idle" };
      return { stop: true, recheckAt: t, reason: "idle" };
    },
    wake(h, t) {
      const run = h.runs.find(r => !r.started);
      if (!run) return { start: false, recheckAt: tick(t + HOUR) };
      const at = run.at - run.flexMs - lead;
      return t >= at ? { start: true, recheckAt: t } : { start: false, recheckAt: tick(Math.min(at, t + HOUR)) };
    },
  });
}
/** OpenBot's published rules: a 5-minute cron, idle stop after 15 minutes, no stop and a pre-wake within 10 minutes of a run */
export const openBotDecider = () => fixedIdleDecider(15 * MINUTE, { leadMs: 10 * MINUTE, cronMs: 5 * MINUTE, name: "openbot" });
export const alwaysOnDecider = () => (_env: DeciderEnv): Decider => ({
  name: "always-on", real: false,
  decide: (_h, t) => ({ stop: false, recheckAt: t + DAY, reason: "always_on" }),
  wake: (_h, t) => ({ start: true, recheckAt: t }),
});
/** a lower bound in hindsight: every home's needs (its turns and runs) known in advance, each idle gap between them either
 *  kept awake or bridged by a stop and a start timed so nobody waits, and the fleet's starts given to the gaps that save
 *  the most first, priced by the day window's tiers (a gap under the kept-machine window costs only its chance of a full
 *  start). The minute and hour windows, the rails and wake timing are relaxed, so no policy can do better. */
export function hindsightBound(options: Pick<SimOptions, "users" | "days" | "start" | "profile" | "seed" | "warmupDays">): { users: Array<{ id: string; persona: string; computeCents: number; startCents: number; starts: number; paidStarts: number; runs: number }>; days: number } {
  const { profile, start } = options, end = start + options.days * DAY, from = start + (options.warmupDays ?? 0) * DAY;
  const out = options.users.map(u => ({ id: u.id, persona: u.persona.name, computeCents: 0, startCents: 0, starts: 0, paidStarts: 0, runs: 0 }));
  const gaps: Array<{ user: number; day: number; gap: number; rate: number }> = [];
  options.users.forEach((user, i) => {
    const busy: Array<[number, number]> = [];
    for (let d = 0; start + d * DAY - user.tzHours * HOUR < end + DAY; d++) {
      const midnight = start + d * DAY - user.tzHours * HOUR;
      const plan = user.persona.plan(mulberry32(seedOf(options.seed, user.id, d)), midnight, (1 + d) % 7);
      for (const e of plan.events) busy.push([e.at, e.at + e.workMs]);
      for (const r of plan.runs) { busy.push([r.at, r.at + r.runMs]); if (r.at >= from && r.at < end) out[i]!.runs++; }
    }
    busy.sort((a, b) => a[0] - b[0]);
    const rate = profile.computeCentsPerHour(user.spec) / HOUR;
    let cursor = from;
    for (const [s0, e0] of busy) {
      const s1 = Math.max(s0, from), e1 = Math.min(e0, end);
      if (e1 <= cursor || s1 >= e1) continue;
      if (s1 > cursor) gaps.push({ user: i, day: Math.floor((cursor - start) / DAY), gap: s1 - cursor, rate });
      out[i]!.computeCents += rate * (e1 - Math.max(s1, cursor)); cursor = e1;
    }
    if (cursor < end) gaps.push({ user: i, day: Math.floor((cursor - start) / DAY), gap: end - cursor, rate });
  });
  const byDay = new Map<number, typeof gaps>();
  for (const g of gaps) byDay.set(g.day, [...(byDay.get(g.day) ?? []), g]);
  const p = profile.held.probability;
  for (const list of byDay.values()) {
    list.sort((a, b) => b.rate * (b.gap - profile.wakeMs.cold) - a.rate * (a.gap - profile.wakeMs.cold));
    let used = 0;
    for (const g of list) {
      const held = g.gap < profile.held.windowMs, share = held ? 1 - p : 1;
      const price = profile.startCents({ minute: 0, hour: 0, day: Math.floor(used) }), cost = share * (Number.isFinite(price) ? price : Number.POSITIVE_INFINITY) + g.rate * profile.wakeMs.cold;
      const r = out[g.user]!;
      if (g.rate * g.gap > cost) { used += share; r.computeCents += g.rate * profile.wakeMs.cold; r.startCents += share * price; r.starts += share; if (price > 0) r.paidStarts += share; }
      else r.computeCents += g.rate * g.gap;
    }
  }
  return { users: out, days: options.days - (options.warmupDays ?? 0) };
}
