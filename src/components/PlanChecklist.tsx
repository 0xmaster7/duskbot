import { useEffect, useState } from "react";
import { Check, ChevronRight, Circle, CircleDot } from "../icons";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { PlanStepState, TurnPlan } from "../../shared/turn-plan";
import { RUN_TOGGLE } from "./ActivityRun";
import { WorkingDots } from "./WorkingIndicator";

const STATE: Record<PlanStepState, LocaleKey> = { done: "chat.plan.stateDone", now: "chat.plan.stateNow", todo: "chat.plan.stateTodo" };
const TEXT: Record<PlanStepState, string> = { done: "text-ink-tertiary", now: "text-ink", todo: "text-ink-secondary" };
const MARK = "absolute inset-0 grid place-items-center transition-[opacity,scale] duration-150 ease-[var(--ease-out-bencho)] motion-reduce:scale-100";

/** One step's mark: the three marks share a slot and cross-fade, so a step that changes state retargets mid-flight. */
function StepMark({ state, live }: { state: PlanStepState; live: boolean }) {
  const shown = (mark: PlanStepState) => (state === mark ? "opacity-100 scale-100" : "opacity-0 scale-90");
  return (
    <span aria-hidden="true" className="relative mt-[3px] size-[13px] shrink-0">
      <span className={cn(MARK, shown("done"))}><Check size={13} className="text-success" /></span>
      <span className={cn(MARK, shown("now"))}>{state === "now" && live ? <WorkingDots size={3} className="gap-0.5" /> : <CircleDot size={13} className="text-ink-secondary" />}</span>
      <span className={cn(MARK, shown("todo"))}><Circle size={13} className="text-ink-tertiary" /></span>
    </span>
  );
}

/** The bot's plan for the person's ask as a checklist: open while the bot works it, folded to "4 of 6 done" after. */
export function PlanChecklist({ plan, live }: { plan: TurnPlan; live: boolean }) {
  const [open, setOpen] = useState(live);
  useEffect(() => setOpen(live), [live]);
  const complete = plan.done === plan.total;
  return (
    <section aria-label={t("chat.plan.label")} className="flex flex-col gap-1" data-plan-checklist="" data-plan-live={live ? "" : undefined}>
      <div className="flex min-w-0 justify-start">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} data-plan-toggle="" className={RUN_TOGGLE}>
          {complete
            ? <Check size={13} aria-hidden="true" className="shrink-0 text-success" />
            : <CircleDot size={13} aria-hidden="true" className="shrink-0" />}
          <span className="min-w-0 truncate leading-5 tabular-nums" aria-live={live ? "polite" : undefined}>
            {t("chat.plan.progress", { done: plan.done, total: plan.total })}
          </span>
          <ChevronRight size={13} aria-hidden="true" className={cn("shrink-0 transition-transform duration-150 ease-[var(--ease-out-bencho)]", open && "rotate-90")} />
        </button>
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out-bencho)] motion-reduce:transition-opacity",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        inert={!open}
        data-plan-steps=""
      >
        <div className="min-h-0 overflow-hidden">
          <ol className="flex w-[min(32rem,100%)] flex-col gap-1 rounded-xl bg-panel px-3 py-2">
            {plan.steps.map((step, index) => (
              <li key={`${index}:${step.text}`} className="flex min-w-0 items-start gap-2 text-[13px] leading-5" data-plan-step={step.state}>
                <StepMark state={step.state} live={live} />
                <span dir="auto" className={cn("min-w-0 break-words transition-colors duration-150 ease-[var(--ease-out-bencho)]", TEXT[step.state])}>{step.text}</span>
                <span className="sr-only">{t(STATE[step.state])}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
