// the first two screens: the one line to paste, then the server setting itself up, mirrored here as it reports in
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCopyFeedback } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { VpsLinkStep, VpsLinkView, VpsStepId } from "@/lib/vps-link";
import { centered, CommandPill, ErrorNote, Footer, formatElapsed, Heading, PILL, ProgressBar, SOFT_PILL, StatusMark, statusWord, useNow, type RowStatus } from "./parts";

export const STEP_TITLE: Record<VpsStepId, LocaleKey> = {
  check: "vpsLink.step.check", basics: "vpsLink.step.basics", docker: "vpsLink.step.docker", user: "vpsLink.step.user", node: "vpsLink.step.node",
  app: "vpsLink.step.app", engines: "vpsLink.step.engines", service: "vpsLink.step.service", address: "vpsLink.step.address",
  desktop: "vpsLink.step.desktop", link: "vpsLink.step.link",
};
const CHEER_MS = 4000;

function minutesLeft(expiresAt: number | null, now: number): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

export function CommandScreen({ view, starting, onRetry, onCopied }: { view: VpsLinkView; starting: boolean; onRetry: () => void; onCopied: () => void }) {
  const now = useNow(15_000);
  const left = minutesLeft(view.expiresAt, now);
  const expired = left === 0;
  const [cheering, setCheering] = useState(false);
  useEffect(() => {
    if (!cheering) return;
    const timer = setTimeout(() => setCheering(false), CHEER_MS);
    return () => clearTimeout(timer);
  }, [cheering]);
  const copied = () => { setCheering(true); onCopied(); };
  return (
    <>
      <Heading>{t("vpsLink.command.title")}</Heading>
      <div className={cn(centered, "top-[calc(50%-28px)]")}>
        {view.command && !expired
          ? <CommandPill command={view.command} onCopied={copied} />
          : <div className="flex h-11 w-full items-center rounded-full border border-ink/10 px-4 text-[13px] leading-[18px] text-ink/56">
              {expired ? t("vpsLink.command.expired") : t("vpsLink.command.making")}
            </div>}
      </div>
      <div className={cn(centered, "top-[calc(50%+30px)] flex flex-col items-center gap-1 text-center")}>
        {cheering
          ? <p key="cheer" role="status" className="vps-land m-0 text-[13px] leading-[18px] text-ink">{t("vpsLink.command.copiedCheer")}</p>
          : <p key="how" className="m-0 text-[13px] leading-[18px] text-ink">{t("vpsLink.command.how")}</p>}
        <p className="m-0 max-w-[460px] text-[13px] leading-[18px] text-ink/56 text-pretty">{t("vpsLink.command.hint")}</p>
      </div>
      <Footer>
        {view.error
          ? <><ErrorNote>{view.error}</ErrorNote><button type="button" className={PILL} onClick={onRetry} disabled={starting}>{t("vpsLink.tryAgain")}</button></>
          : expired
            ? <button type="button" className={PILL} onClick={onRetry} disabled={starting}>{t("vpsLink.command.newOne")}</button>
            : view.command && <p role="status" className="m-0 flex items-center justify-center gap-2 text-[13px] leading-[18px] text-ink/68 text-pretty">
                <span aria-hidden="true" className="vps-waiting-dot size-1.5 shrink-0 rounded-full bg-success" />
                {left !== null ? t("vpsLink.command.waiting", { minutes: left }) : t("vpsLink.command.waitingPlain")}
              </p>}
      </Footer>
    </>
  );
}

type Line = { at: number; status: RowStatus; text: string; id: string };

/** When each step was first heard in its current state, so the mirror reads like a log with times on it. */
function useLines(steps: VpsLinkStep[], start: number): Line[] {
  const seen = useRef(new Map<string, { status: RowStatus; at: number }>());
  const lines: Line[] = [];
  for (const step of steps) {
    if (step.status === "waiting") continue;
    const before = seen.current.get(step.id);
    if (!before || before.status !== step.status) seen.current.set(step.id, { status: step.status, at: Date.now() });
    lines.push({ id: step.id, status: step.status, at: seen.current.get(step.id)!.at - start, text: t(STEP_TITLE[step.id]) });
  }
  return lines;
}

const GLYPH: Record<RowStatus, string> = { done: "✓", running: "›", failed: "✗", skipped: "–", waiting: " " };
const GLYPH_TONE: Record<RowStatus, string> = { done: "text-success", running: "text-ink", failed: "text-danger", skipped: "text-ink/40", waiting: "text-ink/40" };

/** A small window onto the server's terminal: what it said so far, newest at the bottom; or every step at once. */
function Mirror({ view, start, live, className }: { view: VpsLinkView; start: number; live: boolean; className?: string }) {
  const [all, setAll] = useState(false);
  const lines = useLines(view.steps, start);
  const failed = view.steps.find((step) => step.status === "failed");
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = body.current;
    if (node && !all) node.scrollTop = node.scrollHeight;
  }, [lines.length, all, failed?.log]);
  return (
    <section aria-label={t("vpsLink.install.live")} className={cn("flex flex-col overflow-hidden rounded-[12px] border border-ink/10", className)}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-ink/6 pe-1.5 ps-3">
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-danger" : live ? "vps-waiting-dot bg-success" : "bg-ink/25")} />
        <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-ink/56">{t("vpsLink.install.live")}</span>
        <button type="button" aria-pressed={all} onClick={() => setAll((now) => !now)}
          className={cn("omb-press inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[12px] leading-4 outline-none hover:bg-ink/[0.035] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
            all ? "border-ink/30 text-ink" : "border-ink/12 text-ink/68")}>
          {t("vpsLink.install.allSteps")}
        </button>
      </div>
      {all
        ? <ol aria-label={t("vpsLink.install.listAria")} className="m-0 grid min-h-0 flex-1 list-none grid-cols-2 content-start gap-x-4 overflow-auto px-3 py-2 [scrollbar-width:thin]">
            {view.steps.map((step) => (
              <li key={step.id} data-vps-step={step.status} className="flex min-h-[22px] items-center gap-2">
                <StatusMark status={step.status} />
                <span className={cn("min-w-0 truncate text-[12px] leading-4", step.status === "waiting" || step.status === "skipped" ? "text-ink/56" : "text-ink")}>{t(STEP_TITLE[step.id])}</span>
                <span className="sr-only">{statusWord(step.status)}</span>
              </li>
            ))}
          </ol>
        : <div ref={body} role="log" className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-[18px] [scrollbar-width:thin]">
            {view.command && <div className="truncate text-ink/40">$ {view.command}</div>}
            {lines.map((line) => (
              <div key={line.id} data-vps-step={line.status} className="flex gap-2.5 whitespace-nowrap">
                <span className="shrink-0 tabular-nums text-ink/40">{formatElapsed(line.at)}</span>
                <span aria-hidden="true" className={cn("w-2 shrink-0", GLYPH_TONE[line.status])}>{GLYPH[line.status]}</span>
                <span className={cn("min-w-0 truncate", line.status === "skipped" ? "text-ink/56" : "text-ink")}>{line.text}</span>
                <span className="sr-only">{statusWord(line.status)}</span>
                {line.status === "running" && <span aria-hidden="true" className="vps-caret -ms-1 inline-block h-[13px] w-[7px] translate-y-[2.5px] bg-ink/70" />}
              </div>
            ))}
            {failed?.log && <pre className="m-0 mt-1 whitespace-pre-wrap text-ink/68 [overflow-wrap:anywhere]">{failed.log}</pre>}
          </div>}
    </section>
  );
}

function CopyLog({ text }: { text: string }) {
  const { state, copy } = useCopyFeedback(text);
  return (
    <button type="button" className={SOFT_PILL} onClick={copy}>
      {state === "copied" ? t("vpsLink.install.logCopied") : state === "failed" ? t("common.copyFailed") : t("vpsLink.install.copyLog")}
    </button>
  );
}

export function InstallScreen({ view, onRetry }: { view: VpsLinkView; onRetry: () => void }) {
  const [start] = useState(() => Date.now());
  const now = useNow(1000);
  const failed = view.steps.find((step) => step.status === "failed");
  const running = view.steps.find((step) => step.status === "running");
  const next = view.steps.find((step) => step.status === "waiting");
  const finished = view.steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  const progress = Math.max(0.03, (finished + (running ? 0.5 : 0)) / view.steps.length);
  const current = failed ?? running ?? next;
  const label = failed
    ? t("vpsLink.install.stepFailed", { step: t(STEP_TITLE[failed.id]) })
    : current ? t(STEP_TITLE[current.id]) : t("vpsLink.install.almost");
  return (
    <>
      <Heading>{failed ? t("vpsLink.install.stuck") : t("vpsLink.install.title")}</Heading>
      <div className={cn(centered, "top-[calc(50%-40px)] flex flex-col gap-2.5")}>
        <div className="flex items-baseline gap-3">
          <p role="status" className={cn("m-0 min-w-0 flex-1 truncate text-[15px] leading-5", failed ? "text-danger" : "text-ink")}>{label}</p>
          <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink/56">{t("vpsLink.install.count", { done: finished, total: view.steps.length })}</span>
          <span aria-label={t("vpsLink.install.elapsedAria")} className="shrink-0 font-mono text-[12px] leading-4 tabular-nums text-ink/56">{formatElapsed(now - start)}</span>
        </div>
        <ProgressBar value={progress} label={t("vpsLink.install.progressAria")} tone={failed ? "danger" : undefined} />
      </div>
      {failed
        ? <>
            <div className={cn(centered, "top-[calc(50%+10px)] flex flex-col gap-2")}>
              <p className="m-0 text-center text-[13px] leading-[18px] text-ink/68 text-pretty">{t("vpsLink.install.rerun")}</p>
              {view.command && <CommandPill command={view.command} />}
            </div>
            <Mirror view={view} start={start} live={false} className={cn(centered, "top-[calc(50%+96px)] h-[92px]")} />
          </>
        : <Mirror view={view} start={start} live className={cn(centered, "top-[calc(50%+4px)] h-[172px]")} />}
      <Footer>
        {view.error && <ErrorNote>{view.error}</ErrorNote>}
        {failed || view.error
          ? <>
              <button type="button" data-primary="" className={PILL} onClick={onRetry}>{t("vpsLink.tryAgain")}</button>
              {failed?.log && <CopyLog text={failed.log} />}
            </>
          : <p className="m-0 text-[13px] leading-[18px] text-ink/56">{t("vpsLink.install.closeOk")}</p>}
      </Footer>
    </>
  );
}
