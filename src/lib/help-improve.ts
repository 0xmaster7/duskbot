import { useEffect, useState } from "react";
import { api } from "@/state/api";
import { setUsageAnalytics } from "@/lib/product-analytics";

const ROUTE = "/api/dashboard/usage-signals";

/** The one "help improve dusk bot" switch, on by default: anonymous usage info, the scrubbed notes about how sessions
 * went, and crash reports. The workspace's server keeps the choice; the app's own analytics and the desktop's crash
 * reports follow it. `on` is null until it is read; `failed` when reading or saving it did not work. */
export function useHelpImprove() {
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ enabled: boolean }>(ROUTE).then((answer) => { if (live) setOn(answer.enabled); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  const set = async (next: boolean) => {
    const before = on;
    setOn(next);
    setFailed(false);
    try {
      const answer = await api<{ enabled: boolean }>(ROUTE, { method: "PUT", body: JSON.stringify({ enabled: next }) });
      setOn(answer.enabled);
      setUsageAnalytics(answer.enabled);
      void window.duskDesktop?.desktopAnalytics?.set?.(answer.enabled)?.catch(() => {});
    } catch {
      setOn(before);
      setFailed(true);
    }
  };
  return { on, failed, set };
}
