import { useEffect, useState } from "react";
import { ArrowDownToLine, RefreshCw } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

import type { AppUpdateBridge, AppUpdateState } from "../../electron/app-update.mjs";

function ownBridge() {
  return window.duskDesktop?.remoteClient?.active === true ? undefined : window.duskDesktop?.appUpdate;
}

function restartInto(bridge: AppUpdateBridge, setRestarting: (on: boolean) => void) {
  setRestarting(true);
  void bridge.restart().then(ok => { if (!ok) setRestarting(false); }, () => setRestarting(false));
}

/**
 * this app's own page only (electron/app-update.mjs): a newer version found, its download, then a restart into it. a click
 * downloads when it isn't yet and restarts once it is; a downloaded update also installs on quit.
 */
export function AppUpdatePill({ className, bridge = ownBridge() }: { className?: string; bridge?: AppUpdateBridge }) {
  const [update, setUpdate] = useState<AppUpdateState>({ ready: null });
  const [asked, setAsked] = useState(false);
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    let heard = false;
    const unsubscribe = bridge.onState(state => { if (active) { heard = true; setUpdate(state); } });
    void bridge.state().then(state => { if (active && !heard) setUpdate(state); }, () => {});
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  const ready = update.ready;
  const version = ready ?? update.available ?? null;
  const progress = ready ? null : update.progress ?? null;
  useEffect(() => {
    if (!bridge || !asked || !ready) return;
    setAsked(false);
    restartInto(bridge, setRestarting);
  }, [bridge, asked, ready]);
  if (!bridge || !version) return null;
  const downloading = progress !== null || (asked && !ready);
  const percent = progress === null ? null : Math.round(progress * 100);
  const onClick = () => {
    if (ready) return restartInto(bridge, setRestarting);
    setAsked(true);
    if (progress === null) void bridge.download?.().then(found => { if (!found) setAsked(false); }, () => setAsked(false));
  };
  return (
    <button
      type="button"
      data-app-update={version}
      data-app-update-state={ready ? "ready" : downloading ? "downloading" : "available"}
      title={ready ? t("appUpdate.title", { version: ready }) : undefined}
      aria-busy={restarting || downloading || undefined}
      disabled={restarting}
      onClick={onClick}
      className={cn("relative isolate flex items-center gap-1.5 overflow-hidden rounded-full bg-raised px-2.5 py-1 text-[12px] leading-4 text-ink transition-colors duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--color-raised),var(--color-ink)_6%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-progress", className)}
    >
      {percent !== null && (
        <span
          aria-hidden="true"
          data-app-update-progress=""
          className="absolute inset-0 -z-10 origin-left bg-[color-mix(in_srgb,var(--color-raised),var(--color-ink)_8%)] transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${percent / 100})` }}
        />
      )}
      {ready
        ? <RefreshCw size={12} aria-hidden="true" className={restarting ? "animate-spin motion-reduce:animate-none" : undefined} />
        : <ArrowDownToLine size={12} aria-hidden="true" />}
      {ready ? t("appUpdate.restart") : downloading ? t("appUpdate.downloading", { version }) : t("appUpdate.available", { version })}
      {percent !== null && <span className="tabular-nums text-ink-secondary">{t("appUpdate.percent", { percent })}</span>}
    </button>
  );
}
