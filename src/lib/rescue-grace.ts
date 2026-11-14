// A turn its AI refused (a limit, a sign-out) ends and, with another AI to carry on, the backup's turn starts moments
// later: what failed is not shown in that gap, only once nothing took over.
import { useEffect, useState } from "react";

import type { Bot, InstanceInfo } from "@/state/store";

export const RESCUE_GRACE_MS = 1_500;

/** Another AI may carry on this bot's refused turn: a backup it lists, or another AI that is ready. */
export function mayTakeOver(bot: Pick<Bot, "fallback" | "modelSelection">, instances: readonly Pick<InstanceInfo, "instanceId" | "snapshot">[]): boolean {
  return Boolean(bot.fallback?.length) || instances.some((instance) => instance.snapshot.state === "available" && instance.instanceId !== bot.modelSelection?.instanceId);
}

/** True while a turn runs and for `graceMs` after it ends, when another AI may take it over; a conversation opened
 * idle shows its failure at once. Decided while rendering, so not one frame of the failure is painted. */
export function useRescueGrace(busy: boolean, canTakeOver: boolean, key: string, graceMs = RESCUE_GRACE_MS): boolean {
  const [seen, setSeen] = useState({ busy, key, idleAt: null as number | null });
  const [, rerender] = useState(0);
  let current = seen;
  if (busy !== seen.busy || key !== seen.key) {
    current = { busy, key, idleAt: !busy && seen.busy && key === seen.key ? Date.now() : null };
    setSeen(current);
  }
  const idleAt = current.idleAt;
  useEffect(() => {
    if (idleAt === null) return;
    const timer = setTimeout(() => rerender((count) => count + 1), Math.max(0, idleAt + graceMs - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [idleAt, graceMs]);
  if (!canTakeOver) return false;
  return busy || (idleAt !== null && Date.now() - idleAt < graceMs);
}
