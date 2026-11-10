// Each routine caps itself at 3 times its usual run: while a scheduled run works, its running cost (the engine's token
// counts at list prices, on top of what its earlier turns booked) is compared with the median of its last priced runs,
// and past three times that the run stops with one notice. A routine with fewer than three priced runs, or on a model
// with no price, has no usual cost yet and is never stopped here. A run someone started or a test is theirs to stop.
import { SELF_CAP_STOP } from "./routine-quiet.ts";
import type { RoutineRun } from "./routines.ts";

export const SELF_CAP_TIMES = 3;

export interface SelfCapDeps {
  run(threadId: string): RoutineRun | null;
  usual(routineId: string): number | null;
  /** This turn's running cost in dollars from its token counts, or null when its model has no price. */
  estimate(threadId: string, usage: { input: number; output: number; cachedInput?: number }): number | null;
  stop(run: RoutineRun, reason: string, spentUsd: number, usualUsd: number): void;
}

export function createRoutineSelfCap(deps: SelfCapDeps) {
  const stopped = new Set<string>();
  return {
    /** A turn's running token counts (`thread.token-usage.updated`). */
    usage(threadId: string, usage: { input: number; output: number; cachedInput?: number }): void {
      const run = deps.run(threadId);
      if (!run || run.manual || run.dryRun || stopped.has(run.id) || (run.status !== "running" && run.status !== "waiting")) return;
      const usual = deps.usual(run.routineId);
      if (usual === null || !(usual > 0)) return;
      const turn = deps.estimate(threadId, usage);
      if (turn === null) return;
      const spent = (run.cost ?? 0) + turn;
      if (spent <= usual * SELF_CAP_TIMES) return;
      stopped.add(run.id);
      if (stopped.size > 500) stopped.delete(stopped.values().next().value!);
      deps.stop(run, `${SELF_CAP_STOP}: ${spent.toFixed(2)} dollars against a usual ${usual.toFixed(2)}`, spent, usual);
    },
  };
}
