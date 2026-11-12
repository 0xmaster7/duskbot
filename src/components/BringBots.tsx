import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { BOTS_LOOK_TIME_BOX_MS, lookForOtherBots, movable, outcome, planBotMove, planCounts, countsLine, runBotMove, type BotMovePlan } from "@/lib/bot-move";
import { api, useStore, type Bot } from "@/state/store";
import { isMausColor, type MausColor } from "../../shared/wire";
import { BotAvatar, MausAvatar } from "./Avatar";
import { usePrefersReducedMotion } from "./mascot-clock";
import { Loader2, X } from "../icons";
import { GrokMoveDialog } from "./lazy-screens";
import { dialogPrimaryCls, formBodyCls, formCloseCls, formHeaderCls, formSheetCls, formTitleCls, mdSecondaryCls } from "./ui/GrokDialog";

export type BringStep =
  | { kind: "offer" }
  | { kind: "moving"; done: number; total: number; name: string }
  | { kind: "done"; line: string; leftOut: string | null; moved: number }
  | { kind: "error" }
  | { kind: "nothing" };

const list = (parts: string[]) => new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(parts);
export const appNames = (plan: BotMovePlan) => list([...new Set(plan.apps.filter((app) => app.preview.plans.length).map((app) => app.app))]);

function botColor(plan: BotMovePlan["apps"][number]["preview"]["plans"][number]): MausColor {
  const color = plan.document.package.agents[0]?.appearance.color;
  return isMausColor(color) ? color : "chrome";
}

/** What would come over, app by app: its bots as their mascots, and what they bring in counts. */
function Found({ plan, onGrok }: { plan: BotMovePlan; onGrok?: () => void }) {
  return (
    <div className="flex w-full flex-col gap-2 text-left">
      {plan.apps.filter((app) => app.preview.plans.length || app.preview.moved.length).map((app) => (
        <section key={`${app.app}:${app.where}`} data-bot-move-app={app.from.key} aria-label={app.app} className="flex flex-col gap-2.5 rounded-[14px] bg-menu px-4 py-3">
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <h2 className="m-0 truncate text-[14px] font-semibold leading-5 text-ink">{app.app}</h2>
            <span className="shrink-0 truncate text-[12px] leading-4 text-ink/56">{app.where}</span>
          </div>
          {app.preview.plans.length > 0 && (
            <>
              <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-2 p-0">
                {app.preview.plans.map((one) => (
                  <li key={one.packageId} className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-ink">
                    <MausAvatar color={botColor(one)} size={20} state="idle" animated={false} />
                    <span className="truncate">{one.addedAs}</span>
                  </li>
                ))}
              </ul>
              <p className="m-0 text-[13px] leading-[18px] text-ink/68">{countsLine(planCounts(app))}</p>
            </>
          )}
          {app.preview.moved.length > 0 && (
            <p className="m-0 text-[13px] leading-[18px] text-ink/56">{t("botMove.alreadyHere", { names: list(app.preview.moved) })}</p>
          )}
        </section>
      ))}
      {plan.grokWaiting.length > 0 && (
        <p data-bot-move-grok="" className="m-0 px-1 text-[13px] leading-[18px] text-ink/68">
          {t("botMove.grokWaiting", { names: list(plan.grokWaiting) })}{" "}
          {onGrok && <button type="button" onClick={onGrok} className="rounded text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink">{t("botMove.grokOpen")}</button>}
        </p>
      )}
    </div>
  );
}

function Progress({ step }: { step: Extract<BringStep, { kind: "moving" }> }) {
  const share = step.total ? Math.min(1, (step.done + 0.5) / step.total) : 0;
  return (
    <div role="status" aria-live="polite" data-bot-move-progress="" className="flex w-full flex-col items-center gap-3">
      <p className="m-0 text-[15px] leading-[22px] text-ink">{t("botMove.moving", { name: step.name })}</p>
      <div role="progressbar" aria-label={t("botMove.progress")} aria-valuemin={0} aria-valuemax={step.total} aria-valuenow={step.done}
        className="h-1 w-full max-w-[320px] overflow-hidden rounded-full bg-ink/10">
        <div className="h-full w-full origin-left rounded-full bg-ink transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ transform: `scaleX(${share})` }} />
      </div>
      <p className="m-0 text-[13px] leading-[18px] text-ink/56">{t("botMove.step", { done: String(Math.min(step.done + 1, step.total)), total: String(step.total) })}</p>
    </div>
  );
}

/** The step's words and buttons. `screen` is the first run's own page; `sheet` sits in Settings' dialog. */
export function BringBotsView({ plan, step, bot, variant, onBring, onSkip, onContinue, onGrok }: {
  plan: BotMovePlan;
  step: BringStep;
  bot?: Bot;
  variant: "screen" | "sheet";
  onBring: () => void;
  onSkip: () => void;
  onContinue: () => void;
  onGrok?: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const apps = appNames(plan) || t("botMove.dialogTitle");
  const name = bot?.name ?? "Dusk";
  const mood = step.kind === "moving" ? "thinking" : step.kind === "done" && step.moved ? "proud" : "idle";
  const screen = variant === "screen";
  const title = step.kind === "done" ? t("botMove.doneTitle") : step.kind === "nothing" ? t("botMove.nothing")
    : step.kind === "moving" ? t("botMove.progress") : t("botMove.title", { apps });

  let body: ReactNode;
  let actions: ReactNode;
  if (step.kind === "moving") {
    body = <Progress step={step} />;
    actions = null;
  } else if (step.kind === "done") {
    body = (
      <div role="status" data-bot-move-done="" className="flex flex-col items-center gap-2">
        <p className="m-0 text-[15px] leading-[22px] text-ink">{step.line}</p>
        {step.leftOut && <p data-bot-move-left-out="" className="m-0 max-w-[440px] text-balance text-[13px] leading-[18px] text-ink/56">{step.leftOut}</p>}
      </div>
    );
    actions = <button type="button" data-bot-move-continue="" onClick={onContinue} className={dialogPrimaryCls}>{t("botMove.continue")}</button>;
  } else if (step.kind === "nothing") {
    body = <p className="m-0 text-[13px] leading-[18px] text-ink/68">{t("botMove.nothingHint")}</p>;
    actions = <button type="button" onClick={onContinue} className={dialogPrimaryCls}>{t("common.done")}</button>;
  } else {
    body = (
      <>
        <Found plan={plan} onGrok={onGrok} />
        {step.kind === "error" && <p role="alert" data-bot-move-error="" className="m-0 max-w-[440px] text-[13px] leading-[18px] text-danger">{t("botMove.error")}</p>}
      </>
    );
    actions = (
      <button type="button" data-bot-move-bring="" disabled={!movable(plan)} onClick={onBring} className={dialogPrimaryCls}>
        {step.kind === "error" ? t("botMove.retry") : t("botMove.bring")}
      </button>
    );
  }

  return (
    <div data-bot-move={step.kind} className={cn("flex w-full flex-col items-center text-center", screen ? "max-w-[480px]" : "")}>
      <span className="flex size-14" aria-hidden="true">
        {bot ? <BotAvatar bot={bot} size={56} state={mood} animated={!reduced} />
          : <MausAvatar color="chrome" size={56} state={mood} animated={!reduced} label={name} />}
      </span>
      <h1 id="bot-move-title" className={cn("mt-6 text-balance font-normal text-ink", screen ? "text-[28px] leading-[34px] tracking-[-0.02em]" : "text-[20px] leading-[26px] tracking-[-0.01em]")}>
        {title}
      </h1>
      {step.kind === "offer" || step.kind === "error" ? (
        <p className="mt-2 max-w-[440px] text-balance text-[15px] leading-[22px] text-ink-secondary">{t("botMove.sub", { name })}</p>
      ) : null}
      <div className="mt-8 flex w-full flex-col items-center gap-4">{body}</div>
      {actions && <div className="mt-8 flex items-center justify-center gap-2">{actions}</div>}
      {(step.kind === "offer" || step.kind === "error") && (
        <button type="button" data-bot-move-skip="" onClick={onSkip} className={cn(screen ? "mt-4 rounded px-1 py-1 text-[13px] leading-[18px] text-ink-secondary hover:text-ink" : cn(mdSecondaryCls, "mt-2"))}>
          {t("botMove.skip")}
        </button>
      )}
    </div>
  );
}

/** Looks, plans and moves; the plan is null while looking, and stays empty when nothing is here. */
export function useBotMove(options: { look?: boolean } = {}) {
  const { state, dispatch } = useStore();
  const [plan, setPlan] = useState<BotMovePlan | null>(null);
  const [step, setStep] = useState<BringStep>({ kind: "offer" });
  const facts = useRef({ bots: state.bots });
  facts.current = { bots: state.bots };
  const running = useRef(false);

  const look = useCallback(async () => {
    const [found, servers] = await Promise.all([
      lookForOtherBots(),
      api<{ servers?: Array<{ name: string }> }>("/api/mcp/servers", { timeoutMs: BOTS_LOOK_TIME_BOX_MS }).then((answer) => answer.servers ?? [], () => []),
    ]);
    const next = planBotMove(found, { bots: facts.current.bots, servers: new Set(servers.map((server) => server.name)), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    setPlan(next);
    const moved = next.apps.some((app) => app.preview.moved.length);
    setStep(movable(next) || next.grokWaiting.length ? { kind: "offer" }
      : moved ? { kind: "done", line: t("botMove.allHere"), leftOut: null, moved: 0 } : { kind: "nothing" });
    return next;
  }, []);

  useEffect(() => {
    if (options.look !== false) void look();
  }, [look, options.look]);

  const bring = useCallback(async () => {
    if (!plan || running.current) return;
    running.current = true;
    try {
      // after a failed try, what did come over is now here: look again so it is not brought twice
      const fresh = step.kind === "error" ? await look() : plan;
      const total = movable(fresh);
      if (!total) return;
      setStep({ kind: "moving", done: 0, total, name: fresh.apps.find((app) => app.preview.plans.length)?.preview.plans[0]?.addedAs ?? "" });
      const reports = await runBotMove(fresh, dispatch, (done, name) => setStep({ kind: "moving", done, total, name }));
      const result = outcome(reports);
      track("team_imported", { members: result.moved, source: "other_app", mode: "add", format: "package" });
      if (!result.moved && result.failed.length) setStep({ kind: "error" });
      else setStep({ kind: "done", line: result.line, leftOut: result.leftOut, moved: result.moved });
    } catch {
      setStep({ kind: "error" });
    } finally {
      running.current = false;
    }
  }, [plan, step.kind, look, dispatch]);

  return { plan, step, look, bring, setStep };
}

/** Settings → Import → bots from other apps: the same step as the first run's, in a dialog. Nothing is read until it opens. */
export function BringBotsDialog({ onClose }: { onClose: () => void }) {
  const { state } = useStore();
  const move = useBotMove();
  const [grokOpen, setGrokOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const maus = state.bots.find((one) => one.defaultBot && !one.hidden);
  const busy = move.step.kind === "moving";
  useEffect(() => root.current?.focus({ preventScroll: true }), [move.step.kind, move.plan]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div aria-hidden="true" className="ui-dialog-scrim pointer-events-none absolute inset-0" />
      <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={move.plan ? "bot-move-title" : "bot-move-dialog-title"} data-bot-move-dialog=""
        onKeyDown={(event) => {
          if (event.key !== "Escape" || busy || grokOpen) return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        className={cn(formSheetCls, "max-h-[min(720px,calc(100dvh-32px))] max-w-[520px] focus-visible:outline-none!")}>
        <div className={cn(formHeaderCls, "justify-end")}>
          {!move.plan && <h2 id="bot-move-dialog-title" className={formTitleCls}>{t("botMove.dialogTitle")}</h2>}
          <button type="button" disabled={busy} onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className={cn(formCloseCls, "disabled:opacity-40")}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className={cn(formBodyCls, "flex flex-col items-center pb-6 pt-4")}>
          {move.plan ? (
            <BringBotsView plan={move.plan} step={move.step} bot={maus} variant="sheet" onBring={() => void move.bring()}
              onSkip={onClose} onContinue={onClose} onGrok={() => setGrokOpen(true)} />
          ) : (
            <p role="status" className="m-0 flex items-center gap-2 py-10 text-[13px] leading-[18px] text-ink/68">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />{t("botMove.looking")}
            </p>
          )}
        </div>
      </div>
      {grokOpen && <GrokMoveDialog onClose={() => { setGrokOpen(false); void move.look(); }} />}
    </div>
  );
}
