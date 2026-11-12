import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** this app's own page only: a downloaded update waits for a restart (electron/app-update.mjs); it also installs on quit */
export function AppUpdatePill({ className }: { className?: string }) {
  const bridge = window.duskDesktop?.remoteClient?.active === true ? undefined : window.duskDesktop?.appUpdate;
  const [ready, setReady] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.onState(state => { if (active) setReady(state.ready); });
    void bridge.state().then(state => { if (active) setReady(current => current ?? state.ready); }, () => {});
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  if (!bridge || !ready) return null;
  return (
    <button
      type="button"
      data-app-update={ready}
      title={t("appUpdate.title", { version: ready })}
      aria-busy={restarting || undefined}
      disabled={restarting}
      onClick={() => { setRestarting(true); void bridge.restart().then(ok => { if (!ok) setRestarting(false); }, () => setRestarting(false)); }}
      className={cn("flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-[12px] leading-4 text-ink transition-colors duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--color-raised),var(--color-ink)_6%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-progress", className)}
    >
      <RefreshCw size={12} aria-hidden="true" className={restarting ? "animate-spin motion-reduce:animate-none" : undefined} />
      {t("appUpdate.restart")}
    </button>
  );
}
