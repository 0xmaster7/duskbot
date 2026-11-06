import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft } from "lucide-react";

import { useDesktopCapabilities, windowFramed } from "@/components/DesktopCapabilities";
import { automationsFrom, automationSentence, automationStatus, orderAutomations, statusLine, type Automation } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isRoutineProblemRun } from "@/lib/routines";
import { saveWebhookCredential, webhookCredentialStore } from "@/lib/webhook-credentials";
import { useStore } from "@/state/store";
import { useAppTriggers } from "@/lib/app-triggers";
import { AppEventEditor } from "./automations/AppEventEditor";
import { useAllAutomationActions } from "./automations/app-actions";
import { AutomationPanel } from "./automations/AutomationPanel";
import { AutomationsCalendar } from "./automations/AutomationsCalendar";
import { LimitWarnings } from "./automations/LimitWarnings";
import { NewAutomation, type SetUpKind } from "./automations/NewAutomation";
import { FixButton, StatusMark } from "./automations/parts";
import { RoutineEditor } from "./RoutineCalendarPage";
import { GrokIcon } from "./GrokIcon";
import { Select } from "./Select";
import { mdPrimaryCls, rowButtonCls, rowHintCls, rowTitleCls } from "./ui/GrokDialog";
import { Switch } from "./SettingsPrimitives";
import { WebhookEditor } from "./WebhookTrigger";

/** The bot filter earns its place only on a long list shared by several bots. */
const FILTER_FROM = 9;

/** Automations: every schedule and every "when another app sends something", each as one plain sentence. */
export function TriggersPage({ onBack, onOpenRoom }: { onBack: () => void; onOpenRoom: (id: string) => void }) {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const actions = useAllAutomationActions();
  const appTriggers = useAppTriggers();
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const focus = state.routinesFocus;
  const view = focus?.view === "calendar" ? "calendar" : "list";
  const [openId, setOpenId] = useState<string | null>(focus?.section !== "logs" ? focus?.routineId ?? null : null);
  const [botFilter, setBotFilter] = useState(focus?.botId ?? "all");
  const [newText, setNewText] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: SetUpKind; id?: string; botId?: string } | null>(null);
  const routinesOnly = window.ogb?.remoteClient?.active === true;
  const visibleBots = state.bots.filter((bot) => !bot.hidden);
  const botName = (botId: string) => state.bots.find((bot) => bot.id === botId)?.name ?? t("routines.unavailableBot");

  useEffect(() => {
    setBotFilter(focus?.botId ?? "all");
    // "Open" from a chat card or a notice names the automation: open its panel.
    if (focus?.routineId && focus.section !== "logs") setOpenId(focus.routineId);
  }, [focus]);
  useEffect(() => { backButtonRef.current?.focus({ preventScroll: true }); }, []);

  const all = useMemo(() => automationsFrom({ routines: state.routines, webhooks: routinesOnly ? [] : state.webhooks, appTriggers: appTriggers.triggers, runs: state.routineRuns, bots: state.bots }),
    [state.routines, state.webhooks, appTriggers.triggers, state.routineRuns, state.bots, routinesOnly]);
  const showFilter = all.length >= FILTER_FROM && new Set(all.map((automation) => automation.botId)).size > 1;
  const listed = orderAutomations(all.filter((automation) => !showFilter || botFilter === "all" || automation.botId === botFilter));
  const open = all.find((automation) => automation.id === openId) ?? null;
  const sentenceOf = (automation: Automation) => automationSentence(automation, botName(automation.botId));

  // Opening one marks its failed runs seen, which is what clears the dot on the sidebar row.
  useEffect(() => {
    for (const run of open?.runs ?? []) if (isRoutineProblemRun(run) && !run.seenAt) dispatch({ type: "markRoutineRunSeen", runId: run.id });
  }, [open, dispatch]);

  const macInset = capabilities.windowChrome === "mac-inset";
  const windowDragStyle = macInset ? ({ WebkitAppRegion: "drag" } as CSSProperties) : undefined;
  const windowNoDragStyle = macInset ? ({ WebkitAppRegion: "no-drag" } as CSSProperties) : undefined;
  const editRoutine = editing?.kind === "schedule" ? state.routines.find((routine) => routine.id === editing.id) : undefined;
  const editWebhook = editing?.kind === "webhook" ? state.webhooks.find((webhook) => webhook.id === editing.id) : undefined;
  const editApp = editing?.kind === "app" ? appTriggers.triggers.find((trigger) => trigger.id === editing.id) : undefined;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-app animate-workspace-in">
      <header className={cn("shrink-0 border-b border-hairline/35 bg-app py-3 pr-4", macInset && !windowFramed(capabilities) && view === "calendar" ? "pl-[86px]" : view === "list" ? "pl-12 md:pl-4" : "pl-4")} style={windowDragStyle}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" ref={backButtonRef} onClick={onBack} aria-label="Back" title="Back" className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink/68 transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus" style={windowNoDragStyle}><ArrowLeft size={16} /></button>
          <h1 data-tour="automations-page" className="m-0 mr-1 text-[17px] font-medium leading-6 tracking-[0.01em] text-ink">{t("automations.title")}</h1>
          <div className="ml-auto flex items-center gap-3" style={windowNoDragStyle}>
            {showFilter && view === "list" && (
              <Select size="sm" aria-label={t("automations.allBots")} value={botFilter} onChange={(event) => setBotFilter(event.target.value)} className="max-w-[180px]">
                <option value="all">{t("automations.allBots")}</option>
                {visibleBots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
              </Select>
            )}
            <div role="group" aria-label={t("automations.view")} className="flex gap-0.5">
              {(["list", "calendar"] as const).map((option) => (
                <button key={option} type="button" aria-pressed={view === option} onClick={() => dispatch({ type: "showRoutines", view: option, botId: botFilter === "all" ? undefined : botFilter })}
                  className={cn("h-[26px] rounded-full px-2 py-1 text-[13px] leading-[18px] tracking-[0.015em] transition-[background-color,color] duration-[120ms] ease-[ease] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", view === option ? "bg-ink/6 text-ink" : "text-ink/68 hover:bg-ink/6")}>
                  {option === "list" ? t("automations.list") : t("automations.calendar")}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setNewText("")} className={mdPrimaryCls}><GrokIcon name="plus" size={14} />{t("automations.new")}</button>
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {view === "calendar" ? <AutomationsCalendar botFilter={botFilter} selectedAutomationId={openId} onOpenAutomation={setOpenId} onOpenRoom={onOpenRoom} /> : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
              <LimitWarnings botFilter={showFilter ? botFilter : "all"} />
              {all.length === 0 && state.routinesLoadState !== "loading" && state.hydrated ? (
                <section aria-label={t("automations.empty.title")} className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                  <h2 className={cn(rowHintCls, "m-0 font-normal")}>{t("automations.empty.title")}</h2>
                  <button type="button" onClick={() => setNewText(t("automations.empty.example"))} className={rowButtonCls}>{t("automations.empty.try")}</button>
                </section>
              ) : (
                <ul aria-label={t("automations.title")} className="m-0 flex list-none flex-col rounded-[14px] bg-menu p-0 py-2 outline-1 -outline-offset-1 outline-ink/8 [outline-style:solid]">
                  {listed.map((automation) => {
                    const status = automationStatus(automation);
                    const name = automation.name.trim();
                    return (
                      <li key={automation.id} data-automation={automation.id} data-automation-status={status.state} className={cn("relative mx-1.5 flex min-h-12 items-start gap-3 rounded-[10px] px-2 py-2.5 transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/5", openId === automation.id && "bg-ink/5")}>
                        <StatusMark status={status} className="mt-[5px]" />
                        <div className="min-w-0 flex-1">
                          <button type="button" onClick={() => setOpenId(automation.id)} className={cn(rowTitleCls, "block cursor-pointer text-left after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus")}>{name || sentenceOf(automation)}</button>
                          {name && <div className={cn(rowHintCls, "mt-0.5")}>{sentenceOf(automation)}</div>}
                          {status.state === "needs-you"
                            ? <div className="relative mt-1 flex flex-wrap items-center gap-2 text-[13px] leading-[18px] text-warning">{t("automations.needsYou", { reason: status.reason ?? "" })}<FixButton automation={automation} status={status} actions={actions} onEdit={() => setEditing({ kind: automation.kind, id: automation.id })} /></div>
                            : <div className={cn(rowHintCls, "mt-0.5")}>{statusLine(automation)}</div>}
                          {actions.error && actions.errorFor?.endsWith(`:${automation.id}`) && <p role="alert" className="mt-1 text-[12px] text-danger">{actions.error}</p>}
                        </div>
                        {status.state !== "done" && <Switch checked={automation.enabled} disabled={actions.busy === `toggle:${automation.id}`} aria-label={t("automations.toggle", { name: automation.name })} onClick={() => void actions.toggle(automation)} className="relative z-[1] mt-0.5 shrink-0" />}
                      </li>
                    );
                  })}
                </ul>
              )}
              {actions.error && !listed.some((automation) => actions.errorFor?.endsWith(`:${automation.id}`)) && <p role="alert" className="mt-3 text-[12px] text-danger">{actions.error}</p>}
              <RoutineWakeBar />
            </div>
          </div>
        )}
        {open && (
          <div className="absolute inset-y-0 right-0 z-30 flex shadow-2xl lg:static lg:shadow-none">
            <AutomationPanel key={open.id} automation={open} sentence={sentenceOf(open)} onClose={() => setOpenId(null)} onDeleted={() => setOpenId(null)} onEdit={() => setEditing({ kind: open.kind, id: open.id })} />
          </div>
        )}
      </div>

      {newText !== null && (
        <NewAutomation initialText={newText} onClose={() => setNewText(null)} onSetUpYourself={(kind, botId) => { setNewText(null); setEditing({ kind, botId }); }} />
      )}
      {editing?.kind === "schedule" && (editRoutine || !editing.id) && <RoutineEditor routine={editRoutine} bots={visibleBots} initialBotId={editing.botId} plain onClose={() => setEditing(null)} />}
      {editing?.kind === "webhook" && (editWebhook || !editing.id) && (
        <WebhookEditor webhook={editWebhook} bots={visibleBots} initialBotId={editing.botId} onClose={() => setEditing(null)} onCredential={(credential, id) => { saveWebhookCredential(webhookCredentialStore(), id, credential); setOpenId(id); }} />
      )}
      {editing?.kind === "app" && (editApp || !editing.id) && <AppEventEditor trigger={editApp} bots={visibleBots} initialBotId={editing.botId} onClose={() => setEditing(null)} onSaved={(trigger) => setOpenId(trigger.id)} />}
    </main>
  );
}

/** While a Mac sleeps no schedule runs: the shell can hold it awake the hour before one is due, plugged in only. */
function RoutineWakeBar() {
  const bridge = typeof window !== "undefined" ? window.ogb?.routines : undefined;
  const [state, setState] = useState<DesktopRoutineWake | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    const load = () => bridge.wakeState().then((next) => { if (!cancelled) setState(next); }).catch(() => {});
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [bridge]);
  if (!bridge || !state) return null;
  return (
    <div className="mt-6 flex items-center justify-between gap-4 px-1 text-[12px] text-ink-secondary">
      <span>{t("automations.wake")}{state.keepAwake && state.onBattery ? ` ${t("automations.wakeBattery")}` : ""}</span>
      <Switch
        checked={state.keepAwake}
        disabled={busy}
        aria-label={t("automations.wake")}
        onClick={() => {
          setBusy(true);
          bridge.keepAwake(!state.keepAwake).then(setState).catch(() => {}).finally(() => setBusy(false));
        }}
        className="shrink-0 disabled:opacity-50"
      />
    </div>
  );
}
