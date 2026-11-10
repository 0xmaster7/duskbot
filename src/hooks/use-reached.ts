import { useEffect, useState } from "react";

/** When a turn's status line comes, after its send (ms): Grok Bot's mark mounts 0.55 to 1.2 s later, drawn per turn. */
export const STATUS_MOUNT_MS = { min: 550, max: 1200 } as const;

/** Whether the clock has reached `at` (epoch ms), waking once when it does; null never is. */
export function useReached(at: number | null): boolean {
  const [, wake] = useState(0);
  const reached = at !== null && Date.now() >= at;
  useEffect(() => {
    if (at === null || reached) return;
    const timer = setTimeout(() => wake((tick) => tick + 1), Math.max(0, at - Date.now()));
    return () => clearTimeout(timer);
  }, [at, reached]);
  return reached;
}
