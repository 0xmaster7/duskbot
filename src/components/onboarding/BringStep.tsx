// The first run's "bring what you already use": what this Mac holds from other AI apps, all chosen, brought in on one
// press while the run goes on; and for AIs that live online (ChatGPT, Claude, Gemini), a prompt to copy now and an answer
// to paste into any chat later. Nothing here waits on anything.
import { useState } from "react";
import { Check } from "../../icons";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { copyNotesPrompt } from "@/lib/assistant-notes";
import type { LocalFind } from "@/lib/first-run-import";
import { PRIMARY, QUIET, SECONDARY, StepFrame } from "./FunnelSteps";

function FindRow({ find, on, onToggle }: { find: LocalFind; on: boolean; onToggle: () => void }) {
  return (
    <li>
      <button type="button" role="checkbox" aria-checked={on} data-bring-find={find.id} onClick={onToggle}
        className={cn("flex w-full min-w-0 items-center gap-3 rounded-[14px] px-4 py-3 text-start transition-[background-color,transform] duration-150 ease-[ease] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none motion-reduce:active:scale-100",
          on ? "bg-ink/[0.06] hover:bg-ink/[0.08]" : "bg-ink/[0.025] hover:bg-ink/[0.045]")}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-[14px] font-semibold leading-5", on ? "text-ink" : "text-ink-secondary")}>{find.app}</span>
          <span className="truncate text-[13px] leading-[18px] text-ink-secondary">{find.summary}</span>
        </span>
        <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-150 motion-reduce:transition-none", on ? "bg-ink text-app" : "bg-ink/10 text-transparent")}>
          <Check size={12} strokeWidth={2.5} />
        </span>
      </button>
    </li>
  );
}

export function BringStep({ finds, grokWaiting, onGrok, onBring, onNext }: {
  /** null while still looking */
  finds: readonly LocalFind[] | null;
  grokWaiting: readonly string[];
  onGrok: () => void;
  onBring: (chosen: LocalFind[]) => void;
  onNext: () => void;
}) {
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const chosen = (finds ?? []).filter((find) => !off.has(find.id));
  const found = Boolean(finds?.length);
  const toggle = (id: string) => setOff((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const copyPrompt = async () => setCopy((await copyNotesPrompt()) ? "copied" : "failed");

  const copiedLine = copy !== "idle" && (
    <p role="status" data-bring-copied={copy} className={cn("place-reveal max-w-[400px] text-pretty text-[13px] leading-[18px]", copy === "failed" ? "text-danger" : "text-ink-secondary")}>
      {copy === "failed" ? t("bring.copyFailed") : t("bring.copied")}
    </p>
  );

  return (
    <StepFrame title={t("bring.title")} sub={found ? t("bring.sub") : t("bring.subNone")}
      footer={found ? (
        <>
          <button type="button" data-primary="" data-bring-go="" autoFocus disabled={!chosen.length} onClick={() => onBring(chosen)} className={PRIMARY}>{t("bring.bring")}</button>
          <button type="button" data-bring-skip="" onClick={onNext} className={QUIET}>{t("funnel.skip")}</button>
          <div className="mt-4 flex flex-col items-center gap-1.5">
            <p className="text-[13px] leading-[18px] text-ink-secondary">
              {t("bring.cloudAsk")}{" "}
              <button type="button" data-bring-copy="" onClick={() => void copyPrompt()}
                className="rounded text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                {t("bring.copy")}
              </button>
            </p>
            {copiedLine}
          </div>
        </>
      ) : (
        <>
          {copy === "copied"
            ? <button type="button" data-primary="" data-bring-next="" onClick={onNext} className={PRIMARY}>{t("funnel.next")}</button>
            : <button type="button" data-primary="" data-bring-copy="" onClick={() => void copyPrompt()} className={PRIMARY}>{t("bring.copyPrimary")}</button>}
          {copiedLine}
          {copy !== "copied" && <button type="button" data-bring-skip="" onClick={onNext} className={SECONDARY}>{t("funnel.skip")}</button>}
        </>
      )}>
      {finds === null && <p role="status" data-bring-looking="" className="text-[13px] leading-[18px] text-ink-tertiary">{t("bring.looking")}</p>}
      {found && (
        <ul aria-label={t("bring.foundLabel")} className="m-0 flex w-full max-w-[420px] list-none flex-col gap-1.5 p-0">
          {finds!.map((find) => <FindRow key={find.id} find={find} on={!off.has(find.id)} onToggle={() => toggle(find.id)} />)}
        </ul>
      )}
      {grokWaiting.length > 0 && (
        <p data-bring-grok="" className="mt-3 max-w-[420px] text-[13px] leading-[18px] text-ink-secondary">
          {t("botMove.grokWaiting", { names: new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(grokWaiting) })}{" "}
          <button type="button" onClick={onGrok} className="rounded text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink">{t("botMove.grokOpen")}</button>
        </p>
      )}
    </StepFrame>
  );
}

/** The run's one quiet line at the foot of every step: bringing in, then what came in. */
export function BringStatus({ line, working }: { line: string | null; working: boolean }) {
  if (!line && !working) return null;
  return (
    <p role="status" aria-live="polite" data-bring-status={working ? "working" : "done"}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-10 mx-auto flex w-fit max-w-[min(520px,calc(100%-32px))] items-center gap-2 rounded-[14px] bg-ink/[0.05] px-3 py-1.5 text-[12px] leading-4 text-ink-secondary">
      {working && <span aria-hidden="true" className="funnel-wait inline-block size-1.5 shrink-0 rounded-full bg-ink" />}
      <span className="text-pretty">{working ? t("bring.working") : line}</span>
    </p>
  );
}
