import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import { scheduleLabel } from "@/lib/schedule-label";
import { latestRoutineRun, routineDateTime, routineFinished, routineHeldNote, routineNextLabel, routineRunLabel, routineRunTone, routineScheduleState } from "@/lib/routine-display";
import type { Bot } from "@/state/store";
import { Card, NoteRow, rowCls } from "../ListRows";
import { Switch } from "../SettingsPrimitives";

const lineCls = "text-[13px] leading-[18px] tracking-[0.015em]";
const noteCls = "text-[12px] leading-4 tracking-[0.01em]";

/** Routines as the panel lists them: one plain row each, the name over one grey line (its schedule, or Paused, and how the
 * last run went; the next run and its time in the line's tooltip), a small logs button and the switch on the right.
 * `footer` rows close the same card. */
export function RoutineList({ routines, runs, bots, loading, error, onOpen, onLogs, onToggle, footer, footnote }: {
  routines: Routine[];
  runs: RoutineRun[];
  bots?: Bot[];
  loading?: boolean;
  error?: boolean;
  onOpen: (routine: Routine) => void;
  onLogs: (routine: Routine) => void;
  onToggle?: (routine: Routine) => void;
  footer?: ReactNode;
  footnote?: ReactNode;
}) {
  const sorted = [...routines].sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name));
  return <div aria-label={t("routines.list")}>
    <Card footnote={footnote}>
      {error && <NoteRow tone="danger">{t("routines.loadError")}</NoteRow>}
      {loading && <p role="status" className={cn(rowCls, "m-0", lineCls, "text-ink-secondary")}>{t("routines.loading")}</p>}
      {!loading && !error && sorted.length === 0 && <NoteRow>{t("routines.empty")}</NoteRow>}
      {sorted.map((routine) => {
        const latest = latestRoutineRun(routine.id, runs);
        const bot = bots?.find((candidate) => candidate.id === routine.botId);
        const switched = onToggle !== undefined && !routineFinished(routine);
        const state = routineScheduleState(routine);
        const next = routineNextLabel(routine);
        const result = latest && (latest.attention || latest.error || latest.output);
        const ran = latest && `${t("routines.latestRun", { status: routineRunLabel(latest) })}, ${routineDateTime(latest.finishedAt ?? latest.startedAt ?? latest.scheduledFor)}`;
        const line = [switched || next !== state ? next : null, ran ?? t("routines.neverRun"), bot?.name, scheduleLabel(routine.schedule)].filter(Boolean).join(" · ");
        return <article key={routine.id} data-routine-row={routine.id} aria-label={routine.name} className={cn(rowCls, "relative items-start hover:bg-ink/[0.035]")}>
          <button type="button" onClick={() => onOpen(routine)} className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus">
            <span className={cn("block truncate text-ink", lineCls)}>{routine.name}</span>
            <span title={line} className={cn("block truncate text-ink-secondary", lineCls)}>
              {bot && `${bot.name} · `}
              {switched && !routine.enabled ? <span>{state}</span> : scheduleLabel(routine.schedule)}
              {latest && <> · <span className={routineRunTone(latest)}>{t("routines.latestRun", { status: routineRunLabel(latest) })}</span></>}
            </span>
            {result && <span className={cn("mt-0.5 line-clamp-2 block whitespace-pre-wrap", noteCls, latest.error ? "text-danger" : "text-ink-secondary")}>{result}</span>}
            {!!routine.failureStreak && <span className={cn("mt-0.5 block text-danger", noteCls)}>{t("routines.failureStreak", { count: routine.failureStreak })}</span>}
            {routine.weekRuns && <span className={cn("mt-0.5 block text-ink-secondary", noteCls)}>{t("routines.weekRuns", routine.weekRuns)}</span>}
            {routine.warning && <span className={cn("mt-0.5 block text-warning", noteCls)}>{routine.warning}</span>}
            {routine.heldFor && <span className={cn("mt-0.5 block text-ink-secondary", noteCls)}>{routineHeldNote(routine)}</span>}
            {!!routine.skippedRuns && <span className={cn("mt-0.5 block text-ink-secondary", noteCls)}>
              {t("routines.skippedRuns", { count: routine.skippedRuns })}
              {routine.lastSkippedAt != null && <> · {t("routines.lastSkipped", { date: routineDateTime(routine.lastSkippedAt) })}</>}
            </span>}
          </button>
          <span className="relative z-[1] flex shrink-0 items-center gap-1.5 self-center">
            <button
              type="button"
              onClick={() => onLogs(routine)}
              aria-label={t("routines.logsFor", { name: routine.name })}
              title={t("routines.logs")}
              className="flex size-6 cursor-pointer items-center justify-center rounded-full text-ink/[0.66] hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            >
              <FileText size={13} aria-hidden="true" />
            </button>
            {switched
              ? <Switch checked={routine.enabled} aria-label={t("routines.toggle", { name: routine.name })} onClick={() => onToggle(routine)} />
              : <span className={cn("shrink-0", lineCls, routine.enabled && routine.nextRunAt != null ? "text-ink" : "text-ink-secondary")}>{state}</span>}
          </span>
        </article>;
      })}
      {footer}
    </Card>
  </div>;
}
