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

/** the fleet's pre-wakes by minute: each sleeping home with a run ahead holds one minute, at most `perMinute` homes to a
 *  minute, so a burst of runs at the same hour never fills the provider's minute window. A home takes its own place in
 *  the spread when it has room, else the nearest earlier minute with room (waking early costs a few minutes of compute,
 *  a full minute window costs a paid or refused start), and only as a last resort its latest minute. */
export interface WakePlanner {
  slot(cloudId: string, want: number, latest: number, now: number): number;
  release(cloudId: string): void;
}
export function createWakePlanner(options: { perMinute(): number; maxEarlyMs: number }): WakePlanner {
  const taken = new Map<number, number>(), held = new Map<string, number>();
  let pruned = 0;
  const take = (cloudId: string, minute: number) => { held.set(cloudId, minute); taken.set(minute, (taken.get(minute) ?? 0) + 1); return minute * MINUTE; };
  function release(cloudId: string) {
    const minute = held.get(cloudId);
    if (minute === undefined) return;
    held.delete(cloudId);
    const left = (taken.get(minute) ?? 1) - 1;
    if (left > 0) taken.set(minute, left); else taken.delete(minute);
  }
  return {
    release,
    slot(cloudId, want, latest, now) {
      const nowMinute = Math.floor(now / MINUTE);
      if (nowMinute - pruned > 60) {
        pruned = nowMinute;
        for (const [id, minute] of held) if (minute < nowMinute - 30) release(id);
      }
      const cap = Math.max(1, Math.floor(options.perMinute()));
      const last = Math.floor(latest / MINUTE), first = Math.max(nowMinute, Math.floor((latest - options.maxEarlyMs) / MINUTE));
      const mine = held.get(cloudId);
      if (mine !== undefined && mine <= last && mine >= first) return mine * MINUTE;
      release(cloudId);
      const preferred = Math.min(last, Math.max(first, Math.floor(want / MINUTE)));
      for (let m = preferred; m >= first; m--) if ((taken.get(m) ?? 0) < cap) return take(cloudId, m);
      for (let m = preferred + 1; m <= last; m++) if ((taken.get(m) ?? 0) < cap) return take(cloudId, m);
      return take(cloudId, Math.max(nowMinute, last));
    },
  };
}
