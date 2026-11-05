import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { useComposerChannelMode } from "@/lib/drafts";
import { localizedRelativeTime } from "@/lib/relative-time";
import { CALL_MODES, callModeHint, effectiveCallMode, setCallMode, useCallMode, type CallMode } from "@/lib/call-mode";
import { callCapabilityHelp } from "@/lib/call-capability";
import type { Routine } from "@/lib/routines";
import { routineFinished, routineScheduleState } from "@/lib/routine-display";
import { niceTime, scheduleLabel } from "@/lib/schedule-label";
import { fishListeningReady, listensHere, speechBridge } from "@/lib/speech";
import { api, openBotThread, useStore, type Bot } from "@/state/store";
import type { ApprovalMode } from "../../../shared/approval-mode";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { ModelSelectRow } from "../native/ModelSelectRow";
import { UsageMeterRow } from "../native/UsageMeter";
import { isArchived, orderedThreadList, threadRecency } from "../SidebarThreadRow";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { SelectPill } from "../ui/SelectPill";
import type { SimplePageId } from "./page-registry";
import { BotSwitch, Card, LabelAction, NavRow, PanelEmpty, rowCls, RowText } from "./rows";

type Derived = ReturnType<typeof useBotSettingsDerived>;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const wallClock = (time: string) => {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return niceTime(new Date(2000, 0, 1, hour, minute).getTime());
};

/** A schedule in Grok's words ("Every Monday at 9:00 AM", "Every 20 minutes"); anything richer keeps OpenMausBot's label. */
export function routineScheduleLine(schedule: Routine["schedule"]): string {
  if (schedule.type === "daily") {
    const days = [...schedule.weekdays].sort();
    const when = days.length === 0 || days.length === 7 ? "day" : days.join(",") === "1,2,3,4,5" ? "weekday" : days.map((day) => WEEKDAY_NAMES[day]).join(", ");
    return `Every ${when} at ${wallClock(schedule.time)}`;
  }
  if (schedule.type === "interval" && !schedule.weekdays && !schedule.window && schedule.endsAt == null) {
    const minutes = schedule.everyMinutes;
    if (minutes === 60) return "Every hour";
    if (minutes < 60) return `Every ${minutes} minutes`;
    if (minutes % 60 === 0) return `Every ${minutes / 60} hours`;
  }
  return scheduleLabel(schedule);
}

/** One routine as Grok lists it: its name, its schedule (or Paused), and the switch that runs it on that schedule. The
 * row opens the routine's page, OpenMausBot's detail for it. */
function RoutineRow({ routine, color, onOpen }: { routine: Routine; color: Bot["color"]; onOpen: () => void }) {
  const { dispatch } = useStore();
  const finished = routineFinished(routine);
  const hint = routine.enabled && !finished ? routineScheduleLine(routine.schedule) : routineScheduleState(routine);
  return (
    <div data-panel-routine={routine.id} className={cn(rowCls, "relative transition-colors duration-100 hover:bg-ink/[0.06]")}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${routine.name}, ${hint}`}
        className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus"
      >
        <RowText title={<span className="block truncate">{routine.name}</span>} hint={<span className="block truncate">{hint}</span>} />
      </button>
      {!finished && (
        <BotSwitch
          color={color}
          checked={routine.enabled}
          aria-label={t(routine.enabled ? "botPanel.routine.pause" : "botPanel.routine.resume", { name: routine.name, schedule: routineScheduleLine(routine.schedule) })}
          onClick={() => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } })}
          className="relative z-[1]"
        />
      )}
    </div>
  );
}

/** The voices the installation's speech provider offers for this bot, the way Voice settings first lists them. */
function useVoiceOptions(bot: Bot, enabled: boolean) {
  const [voices, setVoices] = useState<Array<{ id: string; label: string }> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const current = bot.voice ? `?current=${encodeURIComponent(bot.voice)}` : "";
    void api(`/api/tts/voices${current}`)
      .then((answer: { voices?: Array<{ id: string; label: string }> }) => { if (alive) setVoices(answer.voices ?? []); })
      .catch(() => { if (alive) setVoices([]); });
    return () => { alive = false; };
  }, [enabled, bot.id]);
  return voices;
}

/** Grok's Voice row: the bot's speaking voice as a select pill. Shown once speech is set up and offers voices. */
function VoiceRow({ bot, patch }: { bot: Bot; patch: Derived["patch"] }) {
  const { state } = useStore();
  const tts = state.config?.tts;
  const voices = useVoiceOptions(bot, Boolean(tts?.configured));
  if (!tts?.configured || !voices || voices.length === 0) return null;
  const value = bot.voice ?? "";
  const options = [
    { value: "", label: tts.voice ? t("voice.installDefault") : t("voice.pick") },
    ...(value && !voices.some((voice) => voice.id === value) ? [{ value, label: t("voice.current") }] : []),
    ...voices.map((voice) => ({ value: voice.id, label: voice.label })),
  ];
  return (
    <div data-panel-row="voice" className={cn(rowCls, "gap-1.5")}>
      <RowText title={t("voice.title")} />
      <SelectPill data-panel-select="voice" aria-label={t("voice.title")} value={value} options={options} onChange={(voice: string) => patch({ voice })} />
    </div>
  );
}

/** How a call with the bot runs (44px below routines, as Grok spaces it round an empty meetings slot), as the call button does: where this device cannot listen in turns, a call is always Live. */
export function VoiceChatCard({ voice }: { voice?: ReactNode } = {}) {
  const { state } = useStore();
  const { capabilities, ready } = useDesktopCapabilities();
  const storedCallMode = useCallMode();
  const turnsHere = !ready || listensHere(capabilities, state.config);
  const callMode = effectiveCallMode(storedCallMode, { turnsHere, canLive: true });
  const turnsHelp = turnsHere ? null : callCapabilityHelp(capabilities, Boolean(speechBridge()?.speechStart), fishListeningReady(state.config));
  const title = t("call.mode.menu");
  return (
    <Card label={t("botPanel.section.voiceChat")} anchor="call" className="mt-[44px]">
      {voice}
      <div data-panel-row="call-mode" className={cn(rowCls, "gap-1.5")}>
        <RowText title={title} />
        <SelectPill
          data-panel-select="call-mode"
          aria-label={title}
          title={callMode === "turns" ? callModeHint("turns") : t("call.mode.liveHint")}
          value={callMode}
          onChange={(mode: CallMode) => setCallMode(mode)}
          options={CALL_MODES.map((entry) => ({ value: entry.id, label: t(entry.label), disabled: entry.id === "turns" && turnsHelp !== null }))}
        />
      </div>
    </Card>
  );
}

const RECENT_CONVERSATIONS = 3;

/** The bot's latest conversations, three at most, with New on the card's label. One conversation shows only New. */
function ConversationsCard({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const tasks = orderedThreadList((bot.tasks ?? []).filter((task) => !task.routineRunId && (!isArchived(task) || task.threadId === bot.threadId)));
  const startNew = () => dispatch({ type: "newTask", botId: bot.id });
  const canStart = bot.yourAccess !== "view";
  if (tasks.length < 2) {
    if (!canStart) return null;
    return (
      <Card anchor="conversations">
        <button type="button" data-conversations-new onClick={startNew} className={cn(rowCls, "w-full cursor-pointer text-left transition-colors duration-100 hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus")}>
          <RowText title={t("botPanel.conversations.new")} />
        </button>
      </Card>
    );
  }
  const now = Date.now();
  return (
    <Card
      label={t("botPanel.conversations.title")}
      anchor="conversations"
      action={canStart ? <LabelAction data-panel-action="new-conversation" aria-label={t("botPanel.conversations.new")} onClick={startNew}>{t("botPanel.conversations.newShort")}</LabelAction> : undefined}
    >
      {tasks.slice(0, RECENT_CONVERSATIONS).map((task) => {
        const at = threadRecency(task);
        return (
          <button
            key={task.threadId}
            type="button"
            data-conversation={task.threadId}
            aria-current={task.threadId === bot.threadId || undefined}
            onClick={() => { if (task.threadId !== bot.threadId) openBotThread(dispatch, bot, task.threadId, false); }}
            className={cn(rowCls, "w-full cursor-pointer text-left transition-colors duration-100 hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-[current=true]:bg-ink/[0.06]")}
          >
            <RowText
              title={<span className="block truncate">{task.title || t("task.newShort")}</span>}
              hint={at ? <span className="block truncate">{localizedRelativeTime(at, activeLocale(), now)}</span> : undefined}
            />
          </button>
        );
      })}
    </Card>
  );
}

/** This conversation's own switch: Work until done, the same goal mode the composer keeps for it. */
function ConversationCard({ bot }: { bot: Bot }) {
  const [mode, setMode] = useComposerChannelMode(`bot:${bot.id}:${bot.threadId}`);
  const on = mode === "goal";
  return (
    <Card label={t("botPanel.section.thisConversation")} anchor="conversation">
      <div data-panel-row="goal" className={rowCls}>
        <RowText title={t("composer.goal.soloAria")} />
        <BotSwitch color={bot.color} checked={on} aria-label={t("composer.goal.soloAria")} onClick={() => setMode(on ? "chat" : "goal")} />
      </div>
    </Card>
  );
}

/** The bot's model, its engine's usage when the engine reports it, and how much it asks before it acts. */
function ModelCard({ bot, derived }: { bot: Bot; derived: Derived }) {
  const { dispatch } = useStore();
  const mode = derived.approvalMode;
  const options: Array<{ value: ApprovalMode; label: string; disabled?: boolean }> = [
    { value: "ask", label: t("botSettings.simple.ask") },
    { value: "full", label: t("botSettings.simple.justDoIt") },
    ...(mode === "ask" || mode === "full" ? [] : [{ value: mode, label: t("botPanel.acts.custom"), disabled: true }]),
  ];
  const label = t("botSettings.simple.beforeActs", { name: bot.name });
  return (
    <Card label={t("model.simple.model")} anchor="model">
      <ModelSelectRow bot={bot} threadId={bot.threadId} />
      <UsageMeterRow engine={bot.modelSelection?.instanceId} />
      <div data-panel-row="approval" className={cn(rowCls, "gap-1.5")}>
        <RowText title={label} />
        <SelectPill
          data-panel-select="approval"
          aria-label={label}
          value={mode}
          options={options}
          onChange={(next: ApprovalMode) => {
            if (next === mode || (next !== "ask" && next !== "full")) return;
            dispatch({ type: "updateBot", botId: bot.id, patch: { approvalMode: next, applyToAllThreads: true } });
          }}
        />
      </div>
    </Card>
  );
}

/** Grok's Details tab (routines or the line saying what one is, then Voice chat), with the few native rows Grok has no
 * home for: the bot's conversations, Work until done, its model and how much it asks first. */
export function DetailsTab({ bot, derived, onOpen }: {
  bot: Bot;
  derived: Derived;
  onOpen: (page: SimplePageId) => void;
}) {
  const routines = [...derived.botRoutines].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div data-panel-tabpanel="details">
      <ConversationsCard bot={bot} />

      {routines.length === 0 ? (
        <PanelEmpty data-panel-empty="routines">{t("botPanel.routines.empty")}</PanelEmpty>
      ) : (
        <Card label={t("botSettings.simple.routines")} anchor="routines">
          {routines.map((routine) => <RoutineRow key={routine.id} routine={routine} color={bot.color} onOpen={() => onOpen("routines")} />)}
        </Card>
      )}

      <ConversationCard bot={bot} />

      <ModelCard bot={bot} derived={derived} />

      <VoiceChatCard voice={<VoiceRow bot={bot} patch={derived.patch} />} />

      <Card anchor="settings">
        <NavRow data-panel-gear data-panel-page="settings" title={t("botPanel.page.settings")} onClick={() => onOpen("settings")} />
      </Card>
    </div>
  );
}
