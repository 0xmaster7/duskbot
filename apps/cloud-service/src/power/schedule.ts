// Routine runs as the lifecycle sees them: when the home has to be up for one, and when a sleeping home wakes for it.
// A run keeps its exact time unless its routine allows a window (`flexMs`); then it may run anywhere within plus or
// minus that, so it can share a wake the owner already caused. Pre-wakes are spread over a few minutes per home
// (a fixed place per home and run), so a fleet's top-of-the-hour routines never all start in the same minute.
import { MINUTE } from "./cost.ts";

export interface PlannedRun { at: number; flexMs: number }
export interface ScheduleParams {
  /** a home is up this long before a run: a cold wake and a margin */
  leadMs: number;
  /** pre-wakes spread over this long before the latest one */
  spreadMs: number;
}

/** the runs from the home's report, cleaned: in order, deduplicated, at most a day ahead and 96 of them */
export function plannedRuns(nextDueAt: number | null, upcoming: readonly PlannedRun[] | null | undefined, now: number): PlannedRun[] {
  const all = [...(upcoming ?? []), ...(nextDueAt === null ? [] : [{ at: nextDueAt, flexMs: 0 }])]
    .filter(r => Number.isFinite(r.at) && r.at >= now - 30 * MINUTE && r.at <= now + 24 * 60 * MINUTE)
    .map(r => ({ at: r.at, flexMs: Math.max(0, Math.min(60 * MINUTE, Number.isFinite(r.flexMs) ? r.flexMs : 0)) }))
    .sort((a, b) => a.at - b.at);
  const out: PlannedRun[] = [];
  for (const r of all) { const last = out.at(-1); if (last && last.at === r.at) last.flexMs = Math.min(last.flexMs, r.flexMs); else out.push(r); }
  return out.slice(0, 96);
}

/** the first run not yet over its window */
export function nextRun(runs: readonly PlannedRun[], now: number): PlannedRun | null {
  return runs.find(r => r.at + r.flexMs >= now) ?? null;
}

/** when the home must start waking at the latest, for this run to begin within its window */
export const wakeBy = (run: PlannedRun, params: ScheduleParams) => run.at + run.flexMs - params.leadMs;
/** from when an awake home can run it */
export const runnableFrom = (run: PlannedRun) => run.at - run.flexMs;

/** a fixed place in [0, 1) per home and run */
export function spreadOf(cloudId: string, at: number): number {
  let h = 0x811c9dc5;
  const text = `${cloudId}:${Math.floor(at / MINUTE)}`;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 2 ** 32;
}

/** when a sleeping home wakes for a run: its own place in the spread, never after its wake-by time */
export function prewake(cloudId: string, run: PlannedRun, params: ScheduleParams): { at: number; latest: number } {
  const latest = wakeBy(run, params);
  return { at: latest - Math.round(params.spreadMs * spreadOf(cloudId, run.at)), latest };
}
