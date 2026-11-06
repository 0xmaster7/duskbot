// small shared pieces of the Add your VPS sheet: the mascot header, a status mark, a step row and the device word
import type { ReactNode } from "react";
import { Check, Loader2, Minus, X } from "lucide-react";
import { MausAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { MausState } from "@/lib/mascot";

export type RowStatus = "waiting" | "running" | "done" | "failed" | "skipped";

/** "Mac" on a Mac, "computer" elsewhere, as copy says it. */
export function deviceWord(): string {
  const platform = typeof window === "undefined" ? undefined : window.ogb?.platform;
  return platform === "darwin" ? t("vpsLink.device.mac") : t("vpsLink.device.computer");
}

export function StageHead({ mascot, title, hint, id }: { mascot: MausState; title: ReactNode; hint?: ReactNode; id?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden="true" className="shrink-0"><MausAvatar color="green" state={mascot} size={40} /></div>
      <div className="min-w-0">
        <h3 id={id} className="m-0 text-[15px] font-medium leading-5 text-ink">{title}</h3>
        {hint && <p className="m-0 mt-0.5 text-[13px] leading-[18px] text-ink/68 text-pretty">{hint}</p>}
      </div>
    </div>
  );
}

export function StatusMark({ status }: { status: RowStatus }) {
  const box = "flex size-4 shrink-0 items-center justify-center rounded-full";
  if (status === "done") return <span className={cn(box, "bg-success/15 text-success")}><Check size={10} strokeWidth={3} aria-hidden="true" /></span>;
  if (status === "failed") return <span className={cn(box, "bg-danger/15 text-danger")}><X size={10} strokeWidth={3} aria-hidden="true" /></span>;
  if (status === "skipped") return <span className={cn(box, "text-ink/40")}><Minus size={12} aria-hidden="true" /></span>;
  if (status === "running") return <span className={cn(box, "text-ink")}><Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /></span>;
  return <span className={cn(box, "border border-dashed border-ink/25")} aria-hidden="true" />;
}

const STATUS_WORD: Record<RowStatus, Parameters<typeof t>[0]> = {
  waiting: "vpsLink.status.waiting", running: "vpsLink.status.running", done: "vpsLink.status.done", failed: "vpsLink.status.failed", skipped: "vpsLink.status.skipped",
};

/** One line of a checklist: the mark, the plain name, and what it is doing in words (never by colour alone). */
export function StepRow({ status, title, detail, children }: { status: RowStatus; title: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <li data-vps-step={status} className="flex flex-col">
      <div className="flex min-h-[30px] items-center gap-2.5 px-2 py-1">
        <StatusMark status={status} />
        <span className={cn("min-w-0 flex-1 text-[13px] leading-[18px]", status === "waiting" || status === "skipped" ? "text-ink/56" : "text-ink")}>{title}</span>
        <span className={cn("shrink-0 text-[12px] leading-4", status === "failed" ? "text-danger" : "text-ink/56")}>{detail ?? t(STATUS_WORD[status])}</span>
      </div>
      {children}
    </li>
  );
}

export function ErrorNote({ children, onRetry, retryLabel }: { children: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[10px] border border-danger/25 px-3 py-2">
      <p className="m-0 min-w-0 flex-1 text-[13px] leading-[18px] text-danger [overflow-wrap:anywhere]">{children}</p>
      {onRetry && <button type="button" onClick={onRetry} className="ui-button shrink-0">{retryLabel ?? t("vpsLink.tryAgain")}</button>}
    </div>
  );
}
