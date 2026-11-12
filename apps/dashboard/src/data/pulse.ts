import { useEffect, useState } from "react";
import { PULSE_INTERVAL_MS, PULSE_SIZE, PULSE_WINDOW_MS, type PulseSample } from "../../../../shared/machine-pulse";
import { api } from "../lib/api";

export interface Pulse {
  samples: PulseSample[];
  /** how far behind this page's clock the newest samples arrive, at most, over the last few answers */
  lag: number;
}

const KEEP = PULSE_SIZE + 4;
const LAGS = 6;

/** a workspace's cpu and memory: the service's two minutes first, then only what is new every PULSE_INTERVAL_MS while
 * the page is visible; nothing is asked while it is hidden or `on` is false */
export function usePulse(workspaceId: string | null, on: boolean): Pulse | null {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  useEffect(() => {
    setPulse(null);
    if (!workspaceId || !on) return;
    const ctl = new AbortController();
    let samples: PulseSample[] = [], lags: number[] = [], timer: ReturnType<typeof setTimeout> | undefined, loading = false, first = true;
    const schedule = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => void load(), ms); };
    const load = async () => {
      if (loading || ctl.signal.aborted || document.visibilityState !== "visible") return;
      loading = true;
      let wait = PULSE_INTERVAL_MS;
      try {
        const answer = await api.pulse(workspaceId, samples.at(-1)?.t ?? 0, ctl.signal);
        if (ctl.signal.aborted) return;
        const last = samples.at(-1)?.t ?? 0, fresh = answer.samples.filter((s) => s.t > last);
        // a workspace that was not being watched sends its two minutes with its next report, a moment after this first ask
        if (first && answer.samples.length < 3) wait = 1200;
        first = false;
        if (fresh.length) {
          const newest = fresh.at(-1)!.t;
          samples = [...samples, ...fresh].filter((s) => s.t >= newest - PULSE_WINDOW_MS - 2 * PULSE_INTERVAL_MS).slice(-KEEP);
          lags = [...lags, Math.max(0, Math.min(30_000, Date.now() - newest))].slice(-LAGS);
          setPulse({ samples, lag: Math.max(...lags) });
        } else if (!samples.length) setPulse({ samples, lag: 0 });
      } catch {} finally {
        loading = false;
        if (!ctl.signal.aborted && document.visibilityState === "visible") schedule(wait);
      }
    };
    const visibility = () => { if (document.visibilityState === "visible") void load(); else clearTimeout(timer); };
    void load();
    document.addEventListener("visibilitychange", visibility);
    return () => { ctl.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [workspaceId, on]);
  return pulse;
}
