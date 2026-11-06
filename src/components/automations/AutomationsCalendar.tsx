import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { CalendarSidebar } from "@/components/routines/CalendarSidebar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { addDays, calendarRangeLabel, projectedRoutineItems, scheduleAt, startOfDay, startOfWeek } from "@/lib/routine-calendar";
import { resetMarkers, useEngineLimits, type ResetMarker } from "@/lib/limit-resets";
import { automationsFrom, automationStatus } from "@/lib/automations";
import { api, useStore } from "@/state/store";
import { useRoutineRunsFrom } from "@/state/older-routine-runs";
import { CalendarGrid, EventEditor, QuickComposer, type CalendarEventItem, type EventKind, type EventSeed } from "../RoutineCalendarPage";
import type { ResetDrop } from "../routines/LimitResetMarkers";

/** The schedules on a week or day grid. An automation opens the same panel as the list. */
export function AutomationsCalendar({ botFilter, selectedAutomationId, onOpenAutomation }: {
  botFilter: string;
  selectedAutomationId?: string | null;
  onOpenAutomation: (id: string) => void;
}) {
  const { state, dispatch } = useStore();
  const [days, setDays] = useState<1 | 7>(() => (window.innerWidth < 640 ? 1 : 7));
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  const [quick, setQuick] = useState<EventSeed | null>(null);
  const [editor, setEditor] = useState<EventSeed | null>(null);
  const [error, setError] = useState("");
  const visibleBots = state.bots.filter((bot) => !bot.hidden);
  const rangeStart = days === 7 ? startOfWeek(anchor) : startOfDay(anchor);
  const rangeEnd = addDays(rangeStart, days);
  useRoutineRunsFrom(rangeStart);
  const markers = resetMarkers(useEngineLimits(), rangeStart, rangeEnd);

  const items = useMemo<CalendarEventItem[]>(() => {
    const botIds = new Set(state.bots.map((bot) => bot.id));
    const routines = state.routines.filter((routine) => botIds.has(routine.botId));
    const needsYou = new Set(automationsFrom({ routines, webhooks: [], runs: state.routineRuns }).filter((automation) => automationStatus(automation).state === "needs-you").map((automation) => automation.id));
    const routineItems = projectedRoutineItems(routines, state.routineRuns.filter((run) => botIds.has(run.botId)), rangeStart, rangeEnd)
      .map((item) => ({ ...item, kind: "routine" as const, needsYou: Boolean(item.routine && !item.run && needsYou.has(item.routine.id)) }));
    return routineItems
      .filter((item) => botFilter === "all" || (item.routine?.botId ?? item.run?.botId) === botFilter)
      .sort((left, right) => left.at - right.at);
  }, [state.routines, state.routineRuns, state.bots, rangeStart, rangeEnd, botFilter]);

  const openItem = (item: CalendarEventItem) => {
    const id = item.routine?.id ?? item.run?.routineId;
    if (id) onOpenAutomation(id);
  };
  const selectedId = items.find((item) => (item.routine?.id ?? item.run?.routineId) === selectedAutomationId)?.id;
  const moveEvent = async (dragged: { kind: EventKind; id: string; at: number }, nextAt: number) => {
    if (nextAt === dragged.at) return;
    try {
      const routine = state.routines.find((candidate) => candidate.id === dragged.id);
      if (!routine) return;
      if (routine.schedule.type === "cron") throw new Error("Open this automation to change its repeating schedule.");
      if (routine.schedule.type !== "once" && !window.confirm("Move every time it repeats?")) return;
      const response = await api(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify({ schedule: scheduleAt(routine.schedule, dragged.at, nextAt) }) });
      dispatch({ type: "routinePatched", routine: response.routine });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  /** A bot dropped on a reset opens the quick composer for a limit-reset automation; an automation dropped there runs
   * at that reset instead of its time. */
  const dropOnReset = async (drop: ResetDrop, marker: ResetMarker) => {
    if ("botId" in drop) {
      setQuick({ kind: "routine", at: marker.at, durationMinutes: 30, botIds: [drop.botId], limitReset: { engine: marker.engine } });
      return;
    }
    try {
      const response = await api(`/api/routines/${drop.event.id}`, { method: "PATCH", body: JSON.stringify({ schedule: { type: "limit_reset", engine: marker.engine, repeat: "once" } }) });
      dispatch({ type: "routinePatched", routine: response.routine });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const segment = (active: boolean) => cn("rounded-md px-3 py-1 text-[12px] font-medium", active ? "bg-raised text-ink shadow-sm" : "text-ink-secondary hover:text-ink");

  return (
    <div className="@container/routines relative flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline/30 px-4 py-2">
        <button type="button" onClick={() => setAnchor((current) => addDays(current, -days))} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("routines.previous")}><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => setAnchor((current) => addDays(current, days))} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("routines.next")}><ChevronRight size={16} /></button>
        <div className="min-w-0 truncate px-1 text-[14px] font-medium text-ink" aria-live="polite">{calendarRangeLabel(rangeStart, days)}</div>
        <button type="button" onClick={() => setAnchor(startOfDay(Date.now()))} className="rounded-lg border border-hairline/50 px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-raised">{t("routines.today")}</button>
        <div role="group" className="ml-auto flex items-center rounded-lg border border-hairline/50 bg-panel p-0.5" aria-label={t("routines.view.label")}>
          <button type="button" aria-pressed={days === 1} onClick={() => setDays(1)} className={segment(days === 1)}>{t("routines.view.day")}</button>
          <button type="button" aria-pressed={days === 7} onClick={() => setDays(7)} className={segment(days === 7)}>{t("routines.view.week")}</button>
        </div>
        {error && <button type="button" onClick={() => setError("")} className="w-full text-left text-[12px] text-danger">{error}</button>}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="hidden shrink-0 @min-[1040px]/routines:block"><CalendarSidebar bots={visibleBots} anchor={anchor} onSelectDate={(at) => setAnchor(startOfDay(at))} /></div>
        <CalendarGrid anchor={rangeStart} days={days} items={items} bots={state.bots} groups={state.groups} selectedId={selectedId}
          onOpen={openItem}
          onCreate={(seed) => setQuick(seed)}
          onMove={(item, at) => void moveEvent(item, at)}
          markers={markers} onDropOnReset={(drop, marker) => void dropOnReset(drop, marker)} />
      </div>
      {quick && <><div className="fixed inset-0 z-40 bg-black/25" onMouseDown={() => setQuick(null)} /><QuickComposer seed={quick} bots={visibleBots} onClose={() => setQuick(null)} onMore={(seed) => { setQuick(null); setEditor(seed); }} onSavedRoutine={(routine) => dispatch({ type: "routinePatched", routine })} /></>}
      {editor && <EventEditor seed={editor} bots={visibleBots} onClose={() => setEditor(null)} />}
    </div>
  );
}
