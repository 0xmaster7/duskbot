import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CALL_MODES, callModeHint, effectiveCallMode, setCallMode, useCallMode, type CallMode } from "@/lib/call-mode";
import { callCapabilityHelp } from "@/lib/call-capability";
import type { Routine } from "@/lib/routines";
import { routineFinished, routineScheduleState } from "@/lib/routine-display";
import { scheduleLabel } from "@/lib/schedule-label";
import { fishListeningReady, listensHere, speechBridge } from "@/lib/speech";
import { useStore, type Bot } from "@/state/store";
import { useChatMoreItems } from "../ChatMoreMenu";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { ModelPicker } from "../ModelPicker";
import type { SidebarMenuItem } from "../SidebarPopoverMenu";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { SelectPill } from "../ui/SelectPill";
import { Toggle } from "../ui/Toggle";
import { BotConversations } from "./Conversations";
import type { SimplePageId } from "./page-registry";
import { TryAsking } from "./TryAsking";
import { Card, LabelAction, NavRow, rowCls, RowText } from "./rows";

type Derived = ReturnType<typeof useBotSettingsDerived>;

export const CONVERSATION_ITEMS = ["find", "usage", "activity"];

/** A ⋯ menu item drawn as a panel row: the same label, icon, value and handler. */
function ItemRow({ item }: { item: SidebarMenuItem }) {
  return (
    <button
      type="button"
      data-panel-item={item.key}
      disabled={item.disabled}
      aria-pressed={item.active || undefined}
      onClick={item.onSelect}
      className={cn(rowCls, "w-full text-left enabled:hover:bg-ink/[0.06] disabled:cursor-default disabled:opacity-45")}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-ink-secondary [&_svg]:size-[15px]" aria-hidden="true">
        {item.icon}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-[18px] tracking-[0.015em]", item.active ? "text-accent-text" : "text-ink")}>{item.label}</span>
      {item.trailing && <span className="flex shrink-0 items-center">{item.trailing}</span>}
    </button>
  );
}

/** One routine as Grok lists it: its name, its schedule (or Paused), and the switch that runs it on that schedule. */
function RoutineRow({ routine, onOpen }: { routine: Routine; onOpen: () => void }) {
  const { dispatch } = useStore();
  const finished = routineFinished(routine);
  const hint = routine.enabled && !finished ? scheduleLabel(routine.schedule) : routineScheduleState(routine);
  return (
    <div data-panel-routine={routine.id} className={cn(rowCls, "relative hover:bg-ink/[0.06]")}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${routine.name}, ${hint}`}
        className="min-w-0 flex-1 rounded-md text-left after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus"
      >
        <RowText title={<span className="block truncate">{routine.name}</span>} hint={<span className="block truncate">{hint}</span>} />
      </button>
      {!finished && (
        <Toggle
          checked={routine.enabled}
          aria-label={t("routines.toggle", { name: routine.name })}
          onClick={() => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } })}
          className="relative z-[1]"
        />
      )}
    </div>
  );
}

/** How a call with the bot runs, as the call button does: where this device cannot listen in turns, a call is always Live. */
export function VoiceChatCard() {
  const { state } = useStore();
  const { capabilities, ready } = useDesktopCapabilities();
  const storedCallMode = useCallMode();
  const turnsHere = !ready || listensHere(capabilities, state.config);
  const callMode = effectiveCallMode(storedCallMode, { turnsHere, canLive: true });
  const turnsHelp = turnsHere ? null : callCapabilityHelp(capabilities, Boolean(speechBridge()?.speechStart), fishListeningReady(state.config));
  const title = t("call.mode.menu");
  return (
    <Card label={t("botPanel.section.voiceChat")} anchor="call">
      <div data-panel-row="call-mode" className={rowCls}>
        <RowText title={title} />
        <SelectPill
          aria-label={title}
          title={callMode === "turns" ? callModeHint("turns") : t("call.mode.liveHint")}
          value={callMode}
          onChange={(event) => setCallMode(event.target.value as CallMode)}
        >
          {CALL_MODES.map((entry) => (
            <option key={entry.id} value={entry.id} disabled={entry.id === "turns" && turnsHelp !== null}>
              {t(entry.label)}
            </option>
          ))}
        </SelectPill>
      </div>
    </Card>
  );
}

export function DetailsTab({ bot, derived, onOpen }: {
  bot: Bot;
  derived: Derived;
  onOpen: (page: SimplePageId) => void;
}) {
  const { items } = useChatMoreItems(bot);
  const conversationItems = CONVERSATION_ITEMS.flatMap((key) => items.filter((item) => item.key === key));
  const routines = [...derived.botRoutines].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));

  return (
    <div data-panel-tabpanel="details">
      <Card anchor="model">
        <div data-panel-row="model" className={rowCls}>
          <ModelPicker
            bot={bot}
            contained
            threadId={bot.threadId}
            label={<span className="flex min-w-0 flex-1 items-center"><RowText title={t("model.simple.model")} /></span>}
          />
        </div>
      </Card>

      <BotConversations bot={bot} />

      {routines.length === 0 ? (
        <div data-panel-empty="routines" className="px-3 pb-1 pt-6 text-center text-[13px] leading-[18px] text-ink-tertiary">
          <p>{t("botPanel.routines.empty")}</p>
          <button
            type="button"
            data-panel-page="routines"
            onClick={() => onOpen("routines")}
            className="mt-1.5 rounded-md px-1.5 py-0.5 text-[13px] font-medium text-ink-secondary transition-colors duration-100 hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t("botPanel.routines.add")}
          </button>
        </div>
      ) : (
        <Card
          label={t("botSettings.simple.routines")}
          anchor="routines"
          action={<LabelAction data-panel-page="routines" aria-label={t("botPanel.routines.add")} onClick={() => onOpen("routines")}>{t("botPanel.routines.add")}</LabelAction>}
        >
          {routines.map((routine) => <RoutineRow key={routine.id} routine={routine} onOpen={() => onOpen("routines")} />)}
        </Card>
      )}

      <VoiceChatCard />

      <TryAsking bot={bot} />

      {conversationItems.length > 0 && (
        <Card label={t("botPanel.section.conversation")} anchor="conversation">
          {conversationItems.map((item) => <ItemRow key={item.key} item={item} />)}
        </Card>
      )}

      <Card anchor="settings">
        <NavRow data-panel-gear data-panel-page="settings" title={t("botPanel.page.settings")} onClick={() => onOpen("settings")} />
      </Card>
    </div>
  );
}
