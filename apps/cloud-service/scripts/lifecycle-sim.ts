// The power policy's cost study: personas and mixed fleets on the provider's real prices, the tuned policy against
// always-on, fixed idle timers, OpenBot's rules and a hindsight oracle, and the coordinate-descent tuning that chose
// its settings. Deterministic (seeded); jobs run in parallel worker processes.
//
//   node --experimental-strip-types apps/cloud-service/scripts/lifecycle-sim.ts --report <file.md> [--tune] [--quick]
//   node --experimental-strip-types apps/cloud-service/scripts/lifecycle-sim.ts --tune
import { fork } from "node:child_process";
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boatCostProfile, type BoatPlan } from "../src/boat.ts";
import { DAY, HOUR, MINUTE } from "../src/power/cost.ts";
import { MIX, PERSONAS } from "../src/power/personas.ts";
import { DEFAULT_POLICY, type PolicyParams } from "../src/power/policy.ts";
import { adaptiveDecider, alwaysOnDecider, fixedIdleDecider, hindsightBound, mulberry32, openBotDecider, seedOf, simulate, type SimUser } from "../src/power/sim.ts";

interface Job { label: string; group: string; users: { persona?: string; mix?: boolean; n: number }; days: number; warmup: number; plan: BoatPlan; scale: number; decider: string; seed: number; params?: PolicyParams; waitPrices?: { user: number; connector: number } }
interface Summary {
  label: string; group: string; decider: string; users: number; days: number;
  /** per user and 30 days, in dollars */
  compute: number; startCash: number; cash: number; waitCost: number; total: number;
  /** per user and day */
  starts: number; paid: number; held: number; waits: number; awakeH: number; stops: number; quick: number;
  waitP50: number; waitP95: number; runs: number; late: number; missed: number; maxHour: number; maxDay: number;
  peak: { minute: number; hour: number; day: number }; violations: number; ms: number;
}

const START = Date.UTC(2026, 10, 2);
const SMALL = { vcpu: 2, ramGb: 4, diskGb: 40 };

/** half the users in one zone (bursts at the same local hour), the rest spread over the world */
function tzOf(rand: () => number) { return rand() < 0.5 ? 0 : Math.floor(rand() * 18) - 8; }
function usersOf(job: Job): SimUser[] {
  const rand = mulberry32(seedOf(job.seed, "users", job.label));
  return Array.from({ length: job.users.n }, (_, i) => {
    let key = job.users.persona ?? "grok";
    if (job.users.mix) { let x = rand(); for (const [k, w] of MIX) { if ((x -= w) < 0) { key = k; break; } } }
    return { id: `${key}-${i}`, persona: PERSONAS[key]!, tzHours: tzOf(rand), spec: SMALL };
  });
}
function deciderOf(name: string, params: PolicyParams) {
  if (name === "adaptive") return adaptiveDecider(params);
  if (name === "always-on") return alwaysOnDecider();
  if (name === "openbot") return openBotDecider();
  const idle = /^idle-(\d+)m$/.exec(name);
  if (idle) return fixedIdleDecider(Number(idle[1]) * MINUTE);
  throw new Error(`unknown decider ${name}`);
}
const quantile = (xs: number[], q: number) => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]!; };

export function runJob(job: Job): Summary {
  const t0 = performance.now();
  const profile = boatCostProfile({ plan: job.plan, scale: job.scale });
  if (job.decider === "oracle") {
    const bound = hindsightBound({ users: usersOf(job), days: job.days, warmupDays: job.warmup, start: START, profile, seed: job.seed });
    const n = bound.users.length, month = 30 / bound.days / 100, mean = (f: (x: (typeof bound.users)[number]) => number) => bound.users.reduce((a, x) => a + f(x), 0) / n;
    const compute = mean(x => x.computeCents) * month, startCash = mean(x => x.startCents) * month;
    return { label: job.label, group: job.group, decider: "oracle", users: n, days: bound.days, compute, startCash, cash: compute + startCash, waitCost: 0, total: compute + startCash,
      starts: mean(x => x.starts) / bound.days, paid: mean(x => x.paidStarts) / bound.days, held: 0, waits: 0, awakeH: 0, stops: mean(x => x.starts) / bound.days, quick: 0, waitP50: 0, waitP95: 0,
      runs: mean(x => x.runs) / bound.days, late: 0, missed: 0, maxHour: 0, maxDay: 0, peak: { minute: 0, hour: 0, day: 0 }, violations: 0, ms: Math.round(performance.now() - t0) };
  }
  const result = simulate({ users: usersOf(job), days: job.days, warmupDays: job.warmup, start: START, profile, seed: job.seed, decider: deciderOf(job.decider, job.params ?? DEFAULT_POLICY), waitPrices: job.waitPrices });
  const u = result.users, n = u.length, days = result.days, month = 30 / days / 100;
  const mean = (f: (x: (typeof u)[number]) => number) => u.reduce((a, x) => a + f(x), 0) / n;
  const waits = u.flatMap(x => x.waitMs);
  const compute = mean(x => x.computeCents) * month, startCash = mean(x => x.startCents) * month, waitCost = mean(x => x.waitCents) * month;
  return {
    label: job.label, group: job.group, decider: result.decider, users: n, days,
    compute, startCash, cash: compute + startCash, waitCost, total: compute + startCash + waitCost,
    starts: mean(x => x.starts) / days, paid: mean(x => x.paidStarts) / days, held: mean(x => x.heldResumes) / days, waits: mean(x => x.waited) / days,
    awakeH: mean(x => x.awakeMs) / days / HOUR, stops: mean(x => x.stops) / days, quick: mean(x => x.quickRestarts) / days,
    waitP50: quantile(waits, 0.5) / 1000, waitP95: quantile(waits, 0.95) / 1000,
    runs: mean(x => x.runs) / days, late: u.reduce((a, x) => a + x.runsLate, 0), missed: u.reduce((a, x) => a + x.runsMissed, 0),
    maxHour: Math.max(...u.map(x => x.maxStartsHour)), maxDay: Math.max(...u.map(x => x.maxStartsDay)),
    peak: result.peak, violations: result.violations.length, ms: Math.round(performance.now() - t0),
  };
}

/** jobs in parallel child processes, results in job order */
async function runAll(jobs: Job[]): Promise<Summary[]> {
  const out: Summary[] = new Array(jobs.length);
  let next = 0;
  const self = fileURLToPath(import.meta.url), width = Math.max(1, Math.min(jobs.length, availableParallelism() - 1));
  await Promise.all(Array.from({ length: width }, () => (async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await new Promise<Summary>((resolve, reject) => {
        const child = fork(self, ["--job"], { execArgv: process.execArgv, stdio: ["ignore", "ignore", "inherit", "ipc"] });
        child.once("message", m => { resolve(m as Summary); child.kill(); });
        child.once("error", reject);
        child.once("exit", code => { if (code && code !== 0 && out[i] === undefined) reject(new Error(`job ${jobs[i]!.label} ${jobs[i]!.decider} exited ${code}`)); });
        child.send(jobs[i]);
      });
    }
  })()));
  return out;
}

const DECIDERS = ["adaptive", "always-on", "idle-5m", "idle-15m", "idle-30m", "idle-60m", "openbot", "oracle"];
const BASELINES = DECIDERS.filter(d => d !== "adaptive" && d !== "oracle");
/** each persona as a fleet of its own at the $2000 plan's planning density: 1,000 users per plan, so 2.4 included starts a user a day */
function personaJobs(decider: string, params: PolicyParams, size: { n: number; days: number; warmup: number }, seed = 1): Job[] {
  return Object.keys(PERSONAS).map(key => ({ label: PERSONAS[key]!.name, group: "persona", users: { persona: key, n: size.n }, days: size.days, warmup: size.warmup, plan: "2000" as BoatPlan, scale: size.n / 1000, decider, seed, params }));
}
const FLEETS: Array<{ label: string; plan: BoatPlan; n: number }> = [
  { label: "$20 plan, 60 users", plan: "20", n: 60 },
  { label: "$100 plan, 300 users", plan: "100", n: 300 },
  { label: "$500 plan, 600 users", plan: "500", n: 600 },
  { label: "$2000 plan, 1,000 users", plan: "2000", n: 1000 },
  { label: "$2000 plan, 2,500 users", plan: "2000", n: 2500 },
];
function fleetJobs(decider: string, params: PolicyParams, days: number, warmup: number, seed = 2): Job[] {
  return FLEETS.map(f => ({ label: f.label, group: "fleet", users: { mix: true, n: f.n }, days, warmup, plan: f.plan, scale: 1, decider, seed, params }));
}

/** the objective: each persona's cost per user-month (cash and waits, a late or missed run a dollar) as a share of its best
 *  baseline's, averaged, so a $0.15 persona weighs as much as a $13 one */
let reference = new Map<string, number>();
const objective = (rows: Summary[]) => rows.reduce((a, r) => a + (r.total + (r.missed + r.late) / r.users * 30 / r.days) / (reference.get(r.label) ?? 1), 0) / rows.length;

interface Knob { name: string; get(p: PolicyParams): number; set(p: PolicyParams, v: number): PolicyParams; values: number[]; unit: string }
const KNOBS: Knob[] = [
  { name: "included start shadow price", unit: "cents", values: [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4], get: p => p.prices.includedStartCents, set: (p, v) => ({ ...p, prices: { ...p.prices, includedStartCents: v } }) },
  { name: "start risk", unit: "cents", values: [0, 0.25, 0.5, 1, 1.5, 2, 3], get: p => p.prices.startRiskCents, set: (p, v) => ({ ...p, prices: { ...p.prices, startRiskCents: v } }) },
  { name: "predictor half-life", unit: "days", values: [3, 7, 14, 28, 56, 112], get: p => p.predictor.halfLifeMs / DAY, set: (p, v) => ({ ...p, predictor: { ...p.predictor, halfLifeMs: v * DAY } }) },
  { name: "prior weight", unit: "days", values: [0.1, 0.25, 0.5, 1, 2], get: p => p.predictor.priorDays, set: (p, v) => ({ ...p, predictor: { ...p.predictor, priorDays: v } }) },
  { name: "session prior", unit: "sessions", values: [0.25, 0.5, 1, 2, 3, 6], get: p => p.predictor.priorSessions, set: (p, v) => ({ ...p, predictor: { ...p.predictor, priorSessions: v } }) },
  { name: "pre-wake spread", unit: "minutes", values: [0, 1, 2, 4, 8], get: p => p.schedule.spreadMs / MINUTE, set: (p, v) => ({ ...p, schedule: { ...p.schedule, spreadMs: v * MINUTE } }) },
  { name: "minimum uptime", unit: "minutes", values: [2, 4, 6, 8, 10, 15], get: p => p.rails.minUptimeMs / MINUTE, set: (p, v) => ({ ...p, rails: { ...p.rails, minUptimeMs: v * MINUTE } }) },
  { name: "decision margin", unit: "cents", values: [0, 0.01, 0.02], get: p => p.marginCents, set: (p, v) => ({ ...p, marginCents: v }) },
];

/** the tuning set: every persona as its own fleet, and two mixed fleets (the realistic case), all on seed 7 */
function tuneJobs(decider: string, params: PolicyParams, size: { n: number; days: number; warmup: number }): Job[] {
  return [...personaJobs(decider, params, size, 7),
    ...[{ label: "tune fleet $100/300", plan: "100" as BoatPlan, n: 300 }, { label: "tune fleet $2000/1000", plan: "2000" as BoatPlan, n: 1000 }].map(f =>
      ({ label: f.label, group: "fleet", users: { mix: true, n: f.n }, days: size.days - 14, warmup: size.warmup, plan: f.plan, scale: 1, decider, seed: 7, params }))];
}
async function tune(start: PolicyParams, size: { n: number; days: number; warmup: number }, rounds: number, log: string[]): Promise<PolicyParams> {
  const baselines = await runAll(BASELINES.flatMap(d => tuneJobs(d, start, size)));
  reference = new Map([...new Set(baselines.map(r => r.label))].map(label => [label, Math.min(...baselines.filter(r => r.label === label).map(r => r.total))]));
  let best = start, bestScore = objective(await runAll(tuneJobs("adaptive", start, size)));
  log.push(`| start | | | ${bestScore.toFixed(3)} |`);
  for (let round = 1; round <= rounds; round++) {
    let moved = false;
    for (const knob of KNOBS) {
      const tried = knob.values.filter(v => v !== knob.get(best));
      const scores = await Promise.all(tried.map(async v => ({ v, score: objective(await runAll(tuneJobs("adaptive", knob.set(best, v), size))) })));
      const win = scores.reduce((a, b) => b.score < a.score ? b : a, { v: knob.get(best), score: bestScore });
      log.push(`| ${round} | ${knob.name} (${knob.unit}) | ${[`${knob.get(best)}: ${bestScore.toFixed(3)}`, ...scores.map(s => `${s.v}: ${s.score.toFixed(3)}`)].join(", ")} | ${win.score < bestScore - 1e-9 ? `**${win.v}** (${win.score.toFixed(3)})` : "kept"} |`);
      if (win.score < bestScore - 1e-9) { best = knob.set(best, win.v); bestScore = win.score; moved = true; }
      console.error(`tune ${round} ${knob.name}: ${knob.get(best)} -> ${bestScore.toFixed(3)}`);
    }
    if (!moved) break;
  }
  return best;
}

const usd = (x: number) => `$${x.toFixed(2)}`;
function table(rows: Summary[], title: string): string {
  const head = "| policy | total $/user-mo | cash $/user-mo | compute | starts $ | waits $ | starts/day | paid/day | held/day | waits/day | wait p50/p95 s | awake h/day | late+missed runs | max starts/h, /day | flaps/day |";
  const sep = "|" + " --- |".repeat(15);
  const best = Math.min(...rows.filter(r => r.decider !== "oracle").map(r => r.total));
  return [`#### ${title}`, "", head, sep, ...rows.map(r => `| ${r.decider === "adaptive" ? "**adaptive**" : r.decider} | ${r.total === best ? `**${usd(r.total)}**` : usd(r.total)} | ${usd(r.cash)} | ${usd(r.compute)} | ${usd(r.startCash)} | ${usd(r.waitCost)} | ${r.starts.toFixed(2)} | ${r.paid.toFixed(2)} | ${r.held.toFixed(2)} | ${r.waits.toFixed(2)} | ${r.waitP50.toFixed(0)}/${r.waitP95.toFixed(0)} | ${r.awakeH.toFixed(1)} | ${r.late + r.missed} | ${r.maxHour}, ${r.maxDay} | ${r.quick.toFixed(2)} |`), ""].join("\n");
}

async function main() {
  const args = process.argv.slice(2), out = args.includes("--report") ? args[args.indexOf("--report") + 1] : null, quick = args.includes("--quick");
  const tuneSize = quick ? { n: 30, days: 28, warmup: 7 } : { n: 60, days: 42, warmup: 14 };
  const evalSize = quick ? { n: 40, days: 35, warmup: 7 } : { n: 120, days: 74, warmup: 14 };
  const fleetDays = quick ? { days: 21, warmup: 7 } : { days: 44, warmup: 14 };
  const log: string[] = [];
  let params = DEFAULT_POLICY;
  if (args.includes("--tune")) {
    params = await tune(DEFAULT_POLICY, tuneSize, 3, log);
    console.log(JSON.stringify({ ...params, predictor: { ...params.predictor }, rails: { ...params.rails } }, null, 2));
    if (!out) return;
  }
  if (!out) { console.error("--report <file> or --tune"); process.exit(2); }
  const personaRows = await runAll(DECIDERS.flatMap(d => personaJobs(d, params, evalSize, 11)));
  const fleetRows = await runAll(DECIDERS.flatMap(d => fleetJobs(d, params, fleetDays.days, fleetDays.warmup, 13)));
  // robustness: the same tuned policy on fresh seeds, and under other wait prices
  const seeds = await runAll([21, 22, 23].flatMap(seed => ["adaptive", ...BASELINES].flatMap(d => personaJobs(d, params, { n: 60, days: 42, warmup: 14 }, seed))));
  const sensitivity = await runAll([0.5, 5].flatMap(w => ["adaptive", ...BASELINES, "oracle"].map(d => ({ label: `wait price ${w}`, group: "sensitivity", users: { persona: "grok", n: 100 }, days: 56, warmup: 14, plan: "2000" as BoatPlan, scale: 0.1, decider: d, seed: 31,
    params: d === "adaptive" ? { ...params, prices: { ...params.prices, userWaitCents: w, connectorWaitCents: w / 2 } } : params, waitPrices: { user: w, connector: w / 2 } }))));
  writeFileSync(out, report({ params, personaRows, fleetRows, seeds, sensitivity, log, evalSize, fleetDays, tuneSize }));
  console.error(`wrote ${out}`);
}

function report(r: { params: PolicyParams; personaRows: Summary[]; fleetRows: Summary[]; seeds: Summary[]; sensitivity: Summary[]; log: string[]; evalSize: { n: number; days: number; warmup: number }; fleetDays: { days: number; warmup: number }; tuneSize: { n: number; days: number; warmup: number } }): string {
  const by = (rows: Summary[], label: string) => DECIDERS.map(d => rows.find(x => x.label === label && x.decider === d)).filter((x): x is Summary => !!x);
  const verdict = (rows: Summary[]) => {
    const labels = [...new Set(rows.map(x => x.label))];
    return labels.map(label => {
      const g = by(rows, label), a = g.find(x => x.decider === "adaptive")!, o = g.find(x => x.decider === "oracle"), base = g.filter(x => BASELINES.includes(x.decider));
      const runner = base.reduce((m, x) => x.total < m.total ? x : m);
      const verdict = base.every(x => a.total < x.total - 0.005) ? "yes" : base.every(x => a.total <= x.total + 0.005) ? `ties ${runner.decider}` : "**no**";
      return `| ${label} | ${usd(a.total)} | ${runner.decider} ${usd(runner.total)} | ${((1 - a.total / runner.total) * 100).toFixed(1)}% | ${o ? `${usd(o.total)} (${((a.total / o.total - 1) * 100).toFixed(0)}% above)` : "-"} | ${a.late + a.missed} | ${verdict} |`;
    }).join("\n");
  };
  const p = r.params;
  return [
    "# Lifecycle costs: the tuned power policy against the baselines",
    "",
    "Generated by `apps/cloud-service/scripts/lifecycle-sim.ts` (deterministic, seeded). Prices: the provider profile in",
    "`apps/cloud-service/src/boat.ts` (`small` at $0.018/h; extra starts $0.03 / $0.05 / $0.07 by tier, the highest of the",
    "minute, hour and day windows; the kept machine reused on 70% of resumes within 10 minutes; a cold wake 60 s, a held one 15 s).",
    "**Total** = compute + paid starts + the wait people saw, priced at $0.02 per cold wake a person waited through and $0.01 per",
    "one a connector event waited through (pro rata by wait length). A late or missed routine run costs $1 in the tuning objective.",
    "Every number is per user, scaled to 30 days, after a warm-up the predictor learns in.",
    "",
    "## Verdict",
    "",
    "### Per persona (each persona as a fleet of its own at the $2000 plan's density: 2.4 included starts per user a day)",
    "",
    "| persona | adaptive total | best baseline | adaptive saves | oracle (gap) | adaptive late+missed runs | beats every baseline |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    verdict(r.personaRows),
    "",
    "### Mixed fleets by plan tier (the research's mix plus the Grok-style user; half the users in one time zone)",
    "",
    "| fleet | adaptive total | best baseline | adaptive saves | oracle (gap) | adaptive late+missed runs | beats every baseline |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    verdict(r.fleetRows),
    "",
    "### Same policy, fresh seeds (personas, 60 users, 28 measured days each)",
    "",
    "| seed | personas where adaptive beats every baseline | adaptive late+missed runs |",
    "| --- | --- | --- |",
    ...[21, 22, 23].map(seed => {
      const rows = r.seeds.filter(x => seedOfRow(x) === seed);
      const labels = [...new Set(rows.map(x => x.label))];
      const wins = labels.filter(l => { const g = rows.filter(x => x.label === l), a = g.find(x => x.decider === "adaptive")!; return g.filter(x => x.decider !== "adaptive").every(x => a.total < x.total); });
      return `| ${seed} | ${wins.length} of ${labels.length} | ${rows.filter(x => x.decider === "adaptive").reduce((s, x) => s + x.late + x.missed, 0)} |`;
    }),
    "",
    "### Wait-price sensitivity (Grok-style persona, 100 users; the policy re-priced with the objective)",
    "",
    ...[0.5, 5].map(w => table(DECIDERS.map(d => r.sensitivity.find(x => x.label === `wait price ${w}` && x.decider === d)).filter((x): x is Summary => !!x), `a cold wake a person waits through priced at ${w} cents`)),
    "## Chosen settings",
    "",
    "```json",
    JSON.stringify({ prices: p.prices, predictor: { ...p.predictor, halfLifeDays: p.predictor.halfLifeMs / DAY }, schedule: { leadMinutes: p.schedule.leadMs / MINUTE, spreadMinutes: p.schedule.spreadMs / MINUTE },
      rails: Object.fromEntries(Object.entries(p.rails).map(([k, v]) => [k, k.endsWith("Ms") ? `${v / MINUTE} min` : v])), marginCents: p.marginCents }, null, 2),
    "```",
    "",
    ...(r.log.length ? ["## Tuning iterations", "",
      `Coordinate descent over the knobs below, each persona as a ${r.tuneSize.n}-user fleet over ${r.tuneSize.days - r.tuneSize.warmup} measured days (seed 7, a different seed from every table here). The objective is the mean over the eight personas and two mixed fleets ($100 plan with 300 users, $2000 plan with 1,000) of the adaptive total per user-month divided by that set's best baseline total (1.000 = no better than the best fixed rule; lower is better), with a late or missed run costing $1; a step is kept only when it lowers it. Rounds repeat until no knob moves (3 at most).`, "",
      "| round | knob | value: objective | kept |", "| --- | --- | --- | --- |", ...r.log, ""] : []),
    "## Per persona, every policy",
    "",
    `Each persona as a ${r.evalSize.n}-user fleet, ${r.evalSize.days - r.evalSize.warmup} measured days after ${r.evalSize.warmup} warm-up days (seed 11).`,
    "",
    ...[...new Set(r.personaRows.map(x => x.label))].map(l => table(by(r.personaRows, l), l)),
    "## Mixed fleets, every policy",
    "",
    `${r.fleetDays.days - r.fleetDays.warmup} measured days after ${r.fleetDays.warmup} warm-up days (seed 13). Pool peaks are the fleet's starts in its busiest rolling minute, hour and day.`,
    "",
    ...[...new Set(r.fleetRows.map(x => x.label))].map(l => table(by(r.fleetRows, l), l) + `Pool peaks (minute / hour / day): ${by(r.fleetRows, l).map(x => `${x.decider} ${x.peak.minute}/${x.peak.hour}/${x.peak.day}`).join("; ")}\n`),
  ].join("\n");
}
const seedOfRow = (x: Summary) => (x as Summary & { seed: number }).seed;

if (process.argv.includes("--job")) {
  process.once("message", job => { const j = job as Job; const s = runJob(j); process.send!({ ...s, seed: j.seed }); });
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
