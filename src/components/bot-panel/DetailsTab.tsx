import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CALL_MODES, callModeHint, effectiveCallMode, setCallMode, useCallMode, type CallMode } from "@/lib/call-mode";
import { callCapabilityHelp } from "@/lib/call-capability";
import type { Routine } from "@/lib/routines";
import { routineFinished, routineScheduleState } from "@/lib/routine-display";
import { niceTime, scheduleLabel } from "@/lib/schedule-label";
import { fishListeningReady, listensHere, speechBridge } from "@/lib/speech";
import { api, useStore, type Bot } from "@/state/store";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { SelectPill } from "../ui/SelectPill";
import type { SimplePageId } from "./page-registry";
import { BotSwitch, Card, PanelEmpty, rowCls, RowText } from "./rows";
import { setVoicePrefs, useVoicePrefs, VOICE_LANGUAGES, VOICE_SPEEDS, type VoiceSpeed } from "./voice-prefs";

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

function VoiceChatRow({ label, children, row }: { label: string; children: ReactNode; row: string }) {
  return (
    <div data-panel-row={row} className={cn(rowCls, "gap-1.5")}>
      <RowText title={label} />
      {children}
    </div>
  );
}

/** Grok's Voice chat card: Voice, Speed and Language as ghost select pills. Voice is the bot's speaking voice; speed and
 * language are kept per bot on this device. */
export function VoiceChatCard({ bot, patch, afterEmpty = false }: { bot: Bot; patch: Derived["patch"]; afterEmpty?: boolean }) {
  const { state } = useStore();
  const tts = state.config?.tts;
  const voices = useVoiceOptions(bot, Boolean(tts?.configured)) ?? [];
  const prefs = useVoicePrefs(bot.id);
  const voice = bot.voice ?? "";
  const voiceOptions = [
    { value: "", label: tts?.voice || !tts?.configured ? t("botPanel.voice.default") : t("voice.pick") },
    ...(voice && !voices.some((entry) => entry.id === voice) ? [{ value: voice, label: t("voice.current") }] : []),
    ...voices.map((entry) => ({ value: entry.id, label: entry.label })),
  ];
  return (
    <Card label={t("botPanel.section.voiceChat")} anchor="call" className={afterEmpty ? "mt-[22px]" : "mt-[44px]"}>
      <VoiceChatRow row="voice" label={t("voice.title")}>
        <SelectPill data-panel-select="voice" aria-label={t("voice.title")} value={voice} options={voiceOptions} onChange={(next: string) => patch({ voice: next })} />
      </VoiceChatRow>
      <VoiceChatRow row="speed" label={t("botPanel.voice.speed")}>
        <SelectPill
          data-panel-select="speed"
          aria-label={t("botPanel.voice.speed")}
          value={prefs.speed}
          options={VOICE_SPEEDS.map((speed) => ({ value: speed, label: `${speed}x` }))}
          onChange={(speed: VoiceSpeed) => setVoicePrefs(bot.id, { speed })}
        />
      </VoiceChatRow>
      <VoiceChatRow row="language" label={t("botPanel.voice.language")}>
        <SelectPill
          data-panel-select="language"
          aria-label={t("botPanel.voice.language")}
          value={prefs.language}
          options={VOICE_LANGUAGES.map(([code, name]) => ({ value: code, label: name }))}
          onChange={(language: string) => setVoicePrefs(bot.id, { language })}
        />
      </VoiceChatRow>
    </Card>
  );
}

/** How a call with the bot runs, as the call button does: where this device cannot listen in turns, a call is always Live. */
export function CallModeRow() {
  const { state } = useStore();
  const { capabilities, ready } = useDesktopCapabilities();
  const storedCallMode = useCallMode();
  const turnsHere = !ready || listensHere(capabilities, state.config);
  const callMode = effectiveCallMode(storedCallMode, { turnsHere, canLive: true });
  const turnsHelp = turnsHere ? null : callCapabilityHelp(capabilities, Boolean(speechBridge()?.speechStart), fishListeningReady(state.config));
  const title = t("call.mode.menu");
  return (
    <div data-panel-row="call-mode" className={cn(rowCls, "gap-1.5")}>
      <RowText title={title} hint={t("botPanel.call.hint")} />
      <SelectPill
        data-panel-select="call-mode"
        aria-label={title}
        title={callMode === "turns" ? callModeHint("turns") : t("call.mode.liveHint")}
        value={callMode}
        onChange={(mode: CallMode) => setCallMode(mode)}
        options={CALL_MODES.map((entry) => ({ value: entry.id, label: t(entry.label), disabled: entry.id === "turns" && turnsHelp !== null }))}
      />
    </div>
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
      {routines.length === 0 ? (
        <PanelEmpty data-panel-empty="routines">{t("botPanel.routines.empty")}</PanelEmpty>
      ) : (
        <Card label={t("botSettings.simple.routines")} anchor="routines">
          {routines.map((routine) => <RoutineRow key={routine.id} routine={routine} color={bot.color} onOpen={() => onOpen("routines")} />)}
        </Card>
      )}

      <VoiceChatCard bot={bot} patch={derived.patch} afterEmpty={routines.length === 0} />
    </div>
  );
}
