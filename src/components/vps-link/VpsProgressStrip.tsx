import { useEffect, useState } from "react";
import { Check, ChevronRight, CircleAlert, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { openAddVps, useAddVpsOpen, useVpsLink } from "@/lib/vps-link";
import { formatElapsed, ProgressBar } from "./parts";
import { progressQuietFor, QUIET_AFTER_MS, vpsProgress } from "./progress";

export function VpsProgressStrip({ connected, hydrated }: { connected: boolean; hydrated: boolean }) {
  const { view, ready, bridge } = useVpsLink();
  const open = useAddVpsOpen();
  const active = view.stage === "installing" || view.stage === "moving";
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const remote = window.ogb?.app?.ownPage === false;
  if (remote) {
    if (!hydrated) return null;
    return <div role="status" data-vps-connection={connected ? "connected" : "reconnecting"} className={cn("flex shrink-0 items-center justify-center gap-1.5 border-b border-hairline/40 px-3 py-1 text-[12px] leading-4", connected ? "text-success" : "text-ink-secondary")}>
      {connected ? <Check size={12} aria-hidden="true" /> : <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {t(connected ? "vpsLink.progress.connected" : "vpsLink.progress.reconnecting")}
    </div>;
  }
  if (!bridge || !ready || open || (view.stage === "idle" && !view.error)) return null;
  const progress = vpsProgress(view);
  const quietFor = progressQuietFor(view, now);
  const stalled = !progress.failed && quietFor >= QUIET_AFTER_MS;
  const needsAttention = progress.failed || stalled || Boolean(progress.error);
  const detail = progress.error ?? (stalled ? t("vpsLink.progress.quiet", { time: formatElapsed(quietFor) }) : progress.detail);
  const linked = view.stage === "linked" || view.stage === "moved";
  return <div data-vps-progress-strip="" className="relative shrink-0 border-b border-hairline/40 bg-app">
    <button type="button" onClick={openAddVps} aria-label={`${t("vpsLink.progress.open")}: ${progress.title}${detail ? `, ${detail}` : ""}`}
      className={cn("flex w-full items-center justify-center gap-2 px-3 py-2 text-[12px] leading-4 outline-none hover:bg-ink/4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus [-webkit-app-region:no-drag]", needsAttention ? "text-warning" : linked ? "text-success" : "text-ink-secondary")}>
      {needsAttention ? <CircleAlert size={13} className="shrink-0" aria-hidden="true" /> : linked ? <Check size={13} className="shrink-0" aria-hidden="true" /> : <LoaderCircle size={13} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      <span className="shrink-0 font-medium">{progress.title}</span>
      {detail && <span className="min-w-0 truncate text-ink-secondary">{detail}</span>}
      <ChevronRight size={13} className="shrink-0" aria-hidden="true" />
    </button>
    {active && <div className="pointer-events-none absolute inset-x-0 bottom-0"><ProgressBar value={progress.value} detail={progress.detail} label={progress.title} tone={progress.failed ? "danger" : undefined} /></div>}
  </div>;
}
