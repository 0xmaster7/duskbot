import type { WorkspaceDetail } from "../../../../shared/dashboard-protocol";

export const ROUTINE_UPSELL_DELAY = 30 * 86_400_000;

export function routineUpsell(details: WorkspaceDetail[], seen: string[] | null, shownAt: number, now: number) {
  const routines = details.filter(({ workspace }) => ["mac", "linux", "windows"].includes(workspace.kind)).flatMap(({ workspace, report }) =>
    (report?.bots ?? []).flatMap((bot) => bot.routines.map((routine) => ({ routine, workspace }))),
  );
  const known = new Set(seen ?? []);
  const next = seen !== null && now - shownAt >= ROUTINE_UPSELL_DELAY ? routines.find(({ routine }) => !known.has(routine.id) && !routine.paused && routine.nextRunAt !== null) ?? null : null;
  for (const { routine } of routines) { known.delete(routine.id); known.add(routine.id); }
  return { seen: [...known].slice(-500), next };
}
