import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListChecks, RefreshCw, X } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { useCaptionChrome } from "@/components/DesktopCapabilities";
import {
  formatActivityTime,
  groupActivityByDay,
  outcomeChip,
  type ActivityRow,
  type ChipTone,
} from "@/lib/activity";
import { listenLiveFrames } from "@/lib/live-events";
import { useActivityFocus } from "@/lib/activity-focus";
import { t } from "@/lib/i18n";

const LIMIT = 300;

const TONE_CLASS: Record<ChipTone, string> = {
  ok: "text-ink/[0.56]",
  danger: "text-danger",
  accent: "text-accent-text",
  warn: "text-warning",
};

export function ActivityPanel({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const { dragProps } = useCaptionChrome();
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadAbort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    try {
      const res = await fetch(`/api/bots/${bot.id}/activity?limit=${LIMIT}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`${res.status}`);
      // SAFETY: the same-version harness's typed activity endpoint; malformed transport data is handled by catch.
      const next = (await res.json()) as { rows: ActivityRow[] };
      if (controller.signal.aborted) return;
      setRows(next.rows);
      setError(null);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (loadAbort.current === controller) loadAbort.current = null;
    }
  }, [bot.id]);

  useEffect(() => {
    setRows(null);
    void load();
    return () => loadAbort.current?.abort();
  }, [load]);

  const threadKey = [bot.threadId, ...(bot.tasks ?? []).map((task) => task.threadId)].join("\n");
  const threadIds = useMemo(() => new Set(threadKey.split("\n")), [threadKey]);
  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | null = null;
    const stopLive = listenLiveFrames({
      onMissedFrames: () => void load(),
      onFrame: (frame) => {
        if (frame.kind !== "runtime") return;
        const runtime = frame.event;
        if (!threadIds.has(runtime.threadId)) return;
        if (
          runtime.type === "turn.completed" ||
          runtime.type === "runtime.error" ||
          runtime.type === "request.opened" ||
          runtime.type === "request.resolved" ||
          runtime.type === "item.completed"
        ) {
          if (settle) clearTimeout(settle);
          settle = setTimeout(() => void load(), 400);
        }
      },
    });
    return () => {
      stopLive();
      if (settle) clearTimeout(settle);
    };
  }, [threadIds, load]);

  const days = useMemo(() => (rows ? groupActivityByDay(rows, new Date()) : []), [rows]);
  const focus = useActivityFocus(bot.id);
  const list = useRef<HTMLDivElement>(null);
  const focused = (row: ActivityRow) => Boolean(focus?.turnId && row.turnId === focus.turnId && row.threadId === focus.threadId);
  useEffect(() => {
    list.current?.querySelector("[data-activity-focused]")?.scrollIntoView({ block: "nearest" });
  }, [rows, focus]);

  const jump = (row: ActivityRow) => {
    if (row.threadId !== bot.threadId && threadIds.has(row.threadId)) {
      dispatch({ type: "switchTask", botId: bot.id, threadId: row.threadId });
    }
  };

  return (
    <aside aria-label={t("activity.panel.aria", { name: bot.name })} className="flex h-full w-[400px] max-w-full shrink-0 flex-col border-l border-hairline/40 bg-panel max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-30">
      <div {...dragProps} className="flex items-center justify-between px-3 pb-1 pt-2.5">
        <span className="flex items-center gap-2 text-[13px] font-medium leading-[18px] text-ink">
          <ListChecks size={14} className="text-ink-secondary" /> {t("activity.panel.title")}
        </span>
        <span className="flex items-center gap-1">
          <button
            onClick={() => void load()}
            className="flex size-6 cursor-pointer items-center justify-center rounded-full text-ink-secondary hover:bg-ink/[0.06] hover:text-ink"
            title={t("activity.panel.reload")}
            aria-label={t("activity.panel.reload")}
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => dispatch({ type: "toggleActivity", open: false })}
            aria-label={t("activity.panel.close")}
            title={t("activity.panel.close")}
            className="flex size-6 cursor-pointer items-center justify-center rounded-full text-ink-secondary hover:bg-ink/[0.06] hover:text-ink"
          >
            <X size={14} />
          </button>
        </span>
      </div>

      <p className="px-3 pb-2 text-[12px] leading-4 text-ink/[0.56]">
        {t("activity.panel.subtitle", { name: bot.name })}
      </p>

      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-1.5">
        {error && <div role="alert" className="px-2 py-1.5 text-[13px] leading-[18px] text-danger">{t("activity.panel.error", { message: error })}</div>}
        {rows && rows.length === 0 && !error && (
          <div className="px-2 py-4 text-center text-[13px] leading-[18px] text-ink/[0.56]">
            {t("activity.panel.empty", { name: bot.name })}
          </div>
        )}
        {!rows && !error && <div className="px-2 py-4 text-center text-[13px] leading-[18px] text-ink/[0.56]">{t("activity.panel.loading")}</div>}
        {days.map((day) => (
          <section key={day.key}>
            <h3 className="sticky top-0 bg-panel px-2 pb-1 pt-3 text-[13px] font-normal leading-[18px] text-ink/[0.68]">
              {day.label}
            </h3>
            {day.rows.map((row) => (
              <ActivityLine key={`${row.threadId}:${row.at}:${row.tool}:${row.requestId ?? ""}`} row={row} current={row.threadId === bot.threadId} focused={focused(row)} onJump={() => jump(row)} />
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}

function ActivityLine({ row, current, focused, onJump }: { row: ActivityRow; current: boolean; focused: boolean; onJump: () => void }) {
  const chip = outcomeChip(row.outcome);
  return (
    <button
      type="button"
      onClick={onJump}
      aria-current={focused || undefined}
      data-activity-focused={focused ? "" : undefined}
      className={cn("flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-ink/[0.035] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus", focused && "bg-ink/[0.05]")}
      title={current ? row.tool : t("activity.panel.openOtherTask", { tool: row.tool })}
    >
      <span className="mt-px shrink-0 tabular-nums text-[12px] leading-4 text-ink/[0.56]">{formatActivityTime(row.at)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] leading-[18px] text-ink">
          {row.app && <span className="font-medium">{row.app}</span>}
          {row.app && <span className="text-ink-secondary">·</span>}
          <span className="truncate">{row.label}</span>
        </span>
        {row.summary && (
          <span className="block truncate font-mono text-[12px] leading-4 text-ink/[0.56]">{row.summary}</span>
        )}
      </span>
      <span className={cn("mt-px shrink-0 text-[12px] leading-4", TONE_CLASS[chip.tone])}>
        {chip.text}
      </span>
    </button>
  );
}
