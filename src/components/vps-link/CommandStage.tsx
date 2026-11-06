// stage 1 (the one line to paste) and stage 2 (the install's live checklist)
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useCopyFeedback } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { VpsLinkStep, VpsLinkView, VpsStepId } from "@/lib/vps-link";
import { rowButtonCls } from "../ui/GrokDialog";
import { ErrorNote, StageHead, StepRow } from "./parts";

export const STEP_TITLE: Record<VpsStepId, LocaleKey> = {
  check: "vpsLink.step.check", basics: "vpsLink.step.basics", docker: "vpsLink.step.docker", user: "vpsLink.step.user", node: "vpsLink.step.node",
  app: "vpsLink.step.app", engines: "vpsLink.step.engines", service: "vpsLink.step.service", address: "vpsLink.step.address",
  desktop: "vpsLink.step.desktop", link: "vpsLink.step.link",
};

function minutesLeft(expiresAt: number | null, now: number): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/** The command in a mono box with its Copy pill. */
export function CommandBox({ command }: { command: string }) {
  const { state, copy } = useCopyFeedback(command);
  const label = state === "copied" ? t("vpsLink.copied") : state === "failed" ? t("common.copyFailed") : t("vpsLink.copy");
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-ink/10 py-1.5 pl-3 pr-1.5">
      <code data-vps-command="" className="min-w-0 flex-1 select-all break-all font-mono text-[12px] leading-[18px] text-ink">{command}</code>
      <button type="button" data-autofocus="" onClick={copy} aria-label={state === "copied" ? t("vpsLink.copied") : t("vpsLink.copyAria")} className={cn(rowButtonCls, "gap-1.5")}>
        {state === "copied" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        {label}
      </button>
    </div>
  );
}

export function CommandStage({ view, starting, onRetry }: { view: VpsLinkView; starting: boolean; onRetry: () => void }) {
  const now = useNow(15_000);
  const left = minutesLeft(view.expiresAt, now);
  const expired = left === 0;
  return (
    <div className="flex flex-col gap-4">
      <StageHead mascot={view.command ? "listening" : "thinking"} title={t("vpsLink.command.title")} hint={t("vpsLink.command.hint")} />
      {view.command && !expired
        ? <CommandBox command={view.command} />
        : !view.error && <div className="h-[42px] rounded-[10px] border border-ink/10 px-3 py-3 text-[12px] leading-4 text-ink/56">{starting || !expired ? t("vpsLink.command.making") : t("vpsLink.command.expired")}</div>}
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {(["vpsLink.command.bullet1", "vpsLink.command.bullet2", "vpsLink.command.bullet3"] as const).map((key, index) => (
          <li key={key} className="flex items-center gap-2.5 px-2 py-0.5 text-[13px] leading-[18px] text-ink">
            <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full border border-ink/12 text-[11px] leading-none text-ink/68">{index + 1}</span>
            {t(key)}
          </li>
        ))}
      </ol>
      {view.error
        ? <ErrorNote onRetry={onRetry}>{view.error}</ErrorNote>
        : expired
          ? <ErrorNote onRetry={onRetry} retryLabel={t("vpsLink.command.newOne")}>{t("vpsLink.command.expired")}</ErrorNote>
          : view.command && <p role="status" className="m-0 flex items-center gap-2 px-2 text-[12px] leading-4 text-ink/56">
              <span aria-hidden="true" className="size-1.5 shrink-0 animate-pulse rounded-full bg-success motion-reduce:animate-none" />
              {left !== null ? t("vpsLink.command.waiting", { minutes: left }) : t("vpsLink.command.waitingPlain")}
            </p>}
    </div>
  );
}

function FailedLog({ step, command }: { step: VpsLinkStep; command: string | null }) {
  return (
    <div className="mb-1 ml-[34px] mr-2 flex flex-col gap-2">
      {step.log && <details className="group">
        <summary className="cursor-pointer text-[12px] leading-4 text-ink/68 hover:text-ink">{t("vpsLink.install.showLog")}</summary>
        <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] border border-ink/10 px-2.5 py-2 font-mono text-[11px] leading-4 text-ink/80 [scrollbar-width:thin]">{step.log}</pre>
      </details>}
      <p className="m-0 text-[12px] leading-4 text-ink/68">{t("vpsLink.install.rerun")}</p>
      {command && <CommandBox command={command} />}
    </div>
  );
}

export function InstallStage({ view, onRetry }: { view: VpsLinkView; onRetry: () => void }) {
  const failed = view.steps.find((step) => step.status === "failed");
  const doneCount = view.steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  return (
    <div className="flex flex-col gap-3">
      <StageHead mascot={failed ? "surprised" : "working"} title={failed ? t("vpsLink.install.stuck") : t("vpsLink.install.title")}
        hint={failed ? t("vpsLink.install.stuckHint") : t("vpsLink.install.hint", { done: doneCount, total: view.steps.length })} />
      <ol aria-label={t("vpsLink.install.listAria")} className="m-0 flex list-none flex-col p-0">
        {view.steps.map((step) => (
          <StepRow key={step.id} status={step.status} title={t(STEP_TITLE[step.id])}>
            {step.status === "failed" && <FailedLog step={step} command={view.command} />}
          </StepRow>
        ))}
      </ol>
      {view.error && <ErrorNote onRetry={onRetry}>{view.error}</ErrorNote>}
    </div>
  );
}
