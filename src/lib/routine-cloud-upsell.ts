import type { Routine } from "./routines";

type RoutineState = Pick<Routine, "id" | "enabled"> & { heldFor?: unknown };

export function newRoutineSinceBaseline<T extends RoutineState>(seen: ReadonlySet<string> | null, routines: readonly T[]): {
  seen: ReadonlySet<string> | null; created: T | null;
} {
  if (!seen) return { seen: routines.length ? new Set(routines.map(routine => routine.id)) : null, created: null };
  const created = routines.find(routine => !seen.has(routine.id) && routine.enabled && !routine.heldFor) ?? null;
  return { seen: new Set([...seen, ...routines.map(routine => routine.id)]), created };
}

/** what was made since `since` (this window opened): a schedule, an app event or another app's messages. Only these can
 * be new, so a list that loads late never looks freshly made, and the very first one counts. */
export function madeSince<T extends { createdAt: number }>(entries: readonly T[], since: number): T[] {
  return entries.filter(entry => entry.createdAt >= since);
}
