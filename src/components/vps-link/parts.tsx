// small shared pieces of Add your VPS, laid out where Grok Bot's first run puts them: the heading 264px above the middle,
// the picture under it, one idea in the middle and the pills 200px below it
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Loader2, Minus, X } from "lucide-react";
import { useCopyFeedback } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export type RowStatus = "waiting" | "running" | "done" | "failed" | "skipped";

export const TITLE_ID = "vps-flow-title";
// grok's lg pills from the first run: the 288px primary, and Back's quiet ink/6 one under it
export const PILL = "ui-button ui-button-pill ui-button-lg ui-button-primary w-[288px] max-w-full font-normal tracking-[0.14px]";
export const SOFT_PILL = "ui-button ui-button-pill ui-button-lg w-[288px] max-w-full border-transparent! bg-ink/6! font-normal tracking-[0.14px] text-ink hover:bg-ink/10!";
/** a block centred across the screen at `top` (a css length from the middle) */
export const centered = "absolute left-1/2 w-[520px] max-w-[calc(100%-32px)] -translate-x-1/2";

/** "Mac" on a Mac, "computer" elsewhere, as copy says it. */
export function deviceWord(): string {
  const platform = typeof window === "undefined" ? undefined : window.ogb?.platform;
  return platform === "darwin" ? t("vpsLink.device.mac") : t("vpsLink.device.computer");
}

export const message = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "");

export function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <h1 id={TITLE_ID} className="absolute left-1/2 top-[calc(50%-264px)] m-0 w-max max-w-[min(560px,calc(100%-32px))] -translate-x-1/2 text-center text-[28px] font-normal leading-[34px] tracking-[-0.02em] text-ink text-balance">
      {children}
    </h1>
  );
}

/** The one grey line under the picture. */
export function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn(centered, "m-0 text-center text-[14px] leading-5 text-ink/68 text-pretty", className)}>{children}</p>;
}

/** The pills, 200px below the middle: one primary and, under it, a quiet one. */
export function Footer({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="absolute left-1/2 top-[calc(50%+200px)] flex w-[440px] max-w-[calc(100%-32px)] -translate-x-1/2 flex-col items-center gap-3 text-center">
      {children}
      {note}
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
export const statusWord = (status: RowStatus) => t(STATUS_WORD[status]);

/** One thin bar, filled on transform. */
export function ProgressBar({ value, label, detail, tone }: { value: number | null; label: string; detail?: string | null; tone?: "danger" }) {
  const clamped = value === null ? null : Math.max(0, Math.min(1, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped === null ? undefined : Math.round(clamped * 100)} aria-valuetext={detail ?? undefined}
      className="h-1 w-full overflow-hidden rounded-full bg-ink/8">
      <div className={cn("vps-bar h-full w-full rounded-full", clamped === null && "animate-pulse motion-reduce:animate-none opacity-30", tone === "danger" ? "bg-danger" : "bg-ink")} style={{ transform: clamped === null ? undefined : `scaleX(${clamped})` }} />
    </div>
  );
}

/** The command in one clean pill with its Copy button; a copy says so with a little cheer. */
export function CommandPill({ command, onCopied }: { command: string; onCopied?: () => void }) {
  const { state, copy } = useCopyFeedback(command);
  const cheer = useRef(onCopied);
  cheer.current = onCopied;
  useEffect(() => { if (state === "copied") cheer.current?.(); }, [state]);
  const copied = state === "copied";
  return (
    <div className="flex h-11 w-full items-center gap-2 rounded-full border border-ink/10 py-1.5 pe-1.5 ps-4">
      <span aria-hidden="true" className="shrink-0 select-none font-mono text-[13px] leading-[18px] text-ink/40">$</span>
      <code data-vps-command="" tabIndex={0} className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-[13px] leading-[18px] text-ink outline-none [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] [scrollbar-width:none] focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-focus">{command}</code>
      <button type="button" data-autofocus="" onClick={copy} aria-label={copied ? t("vpsLink.copied") : t("vpsLink.copyAria")}
        className="omb-press inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] leading-[18px] text-app outline-none hover:bg-[color-mix(in_srgb,var(--color-ink)_88.5%,var(--color-app))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        {copied
          ? <span key="copied" className="vps-land inline-flex items-center gap-1.5"><Check size={13} strokeWidth={2.5} aria-hidden="true" />{t("vpsLink.copied")}</span>
          : <span key="copy" className="inline-flex items-center gap-1.5"><Copy size={13} aria-hidden="true" />{state === "failed" ? t("common.copyFailed") : t("vpsLink.copy")}</span>}
      </button>
    </div>
  );
}

export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("m-0 flex items-start justify-center gap-1.5 text-center text-[13px] leading-[18px] text-danger [overflow-wrap:anywhere]", className)}>
      <X size={14} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
