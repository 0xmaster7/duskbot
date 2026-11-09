import type { Routine } from "./routines";

type RoutineState = Pick<Routine, "id" | "enabled" | "heldFor">;

export function newRoutineSinceBaseline<T extends RoutineState>(seen: ReadonlySet<string> | null, routines: readonly T[]): {
  seen: ReadonlySet<string> | null; created: T | null;
} {
  if (!seen) return { seen: routines.length ? new Set(routines.map(routine => routine.id)) : null, created: null };
  const created = routines.find(routine => !seen.has(routine.id) && routine.enabled && !routine.heldFor) ?? null;
  return { seen: new Set([...seen, ...routines.map(routine => routine.id)]), created };
}
