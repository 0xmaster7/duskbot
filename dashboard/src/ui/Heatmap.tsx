import { useEffect, useMemo, useRef } from "react";
import type { ActivityReport } from "../../../shared/dashboard-protocol";
import { compact, dayKey, longDate, monthShort, parseDay, plural, usd } from "../lib/format";
import { cx } from "./kit";

export type HeatMetric = "turns" | "tokens" | "spend";
const WEEKS = 53;
const DAY_MS = 86_400_000;

const valueOf = (d: ActivityReport["days"][number] | undefined, metric: HeatMetric) =>
  !d ? 0 : metric === "turns" ? d.turns : metric === "tokens" ? d.tokens : d.costUsd ?? 0;

const say = (v: number, metric: HeatMetric) => (metric === "turns" ? plural(v, "turn") : metric === "tokens" ? `${compact(v)} tokens` : usd(v));

export function Heatmap({ days, metric, now, compactCells = false }: { days: ActivityReport["days"]; metric: HeatMetric; now: number; compactCells?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { weeks, months, levels } = useMemo(() => {
    const byDay = new Map(days.map((d) => [d.date, d]));
    const today = parseDay(dayKey(now));
    const start = new Date(today.getTime() - ((WEEKS - 1) * 7 + today.getDay()) * DAY_MS);
    // steps of the busiest day, so a quiet year still shows its best day at full colour
    const top = Math.max(0, ...days.map((d) => valueOf(d, metric)));
    const level = (v: number) => (v <= 0 || top <= 0 ? 0 : Math.max(1, Math.ceil((v / top) * 4)));
    const weeks: Array<Array<{ key: string; v: number; level: number; future: boolean }>> = [];
    const months: Array<{ col: number; label: string }> = [];
    for (let w = 0; w < WEEKS; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
        const key = dayKey(date);
        const v = valueOf(byDay.get(key), metric);
        col.push({ key, v, level: level(v), future: date > today });
        if (date.getDate() === 1 && (months.length === 0 || months[months.length - 1]!.col < w - 2)) months.push({ col: w, label: monthShort(date.getMonth()) });
      }
      weeks.push(col);
    }
    if (!months.length || months[0]!.col > 2) months.unshift({ col: 0, label: monthShort(start.getMonth()) });
    return { weeks, months, levels: [0, 1, 2, 3, 4] };
  }, [days, metric, now]);

  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth; }, [weeks]);

  const cell = compactCells ? 11 : undefined;
  return (
    <div>
      <div ref={scroller} className="scroll-x -mx-1 px-1">
        <div className={cx("grid gap-y-2", compactCells ? "w-max" : "min-w-[640px]")}>
          <div className="relative h-4 text-12 text-ink-3" aria-hidden>
            {months.map((m) => (
              <span key={`${m.col}-${m.label}`} className="absolute" style={{ left: `calc(${(m.col / WEEKS) * 100}%)` }}>{m.label}</span>
            ))}
          </div>
          <div
            className="grid grid-flow-col gap-[3px]"
            style={{ gridTemplateRows: "repeat(7, auto)", gridTemplateColumns: cell ? `repeat(${WEEKS}, ${cell}px)` : `repeat(${WEEKS}, minmax(0, 1fr))` }}
            role="grid"
            aria-label={`Activity over the last year, ${metric}`}
          >
            {weeks.flat().map((c) => (
              <div
                key={c.key}
                role="gridcell"
                aria-label={c.future ? undefined : `${longDate(parseDay(c.key))}: ${say(c.v, metric)}`}
                title={c.future ? undefined : `${say(c.v, metric)} on ${longDate(parseDay(c.key))}`}
                className={cx("hover-cell aspect-square rounded-[3px]", c.future && "opacity-0")}
                style={{ background: c.level ? `var(--heat-${c.level})` : "var(--cell)" }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-1.5 text-12 text-ink-3" aria-hidden>
        <span className="me-1">Less</span>
        {levels.map((l) => <span key={l} className="size-[10px] rounded-[2px]" style={{ background: l ? `var(--heat-${l})` : "var(--cell)" }} />)}
        <span className="ms-1">More</span>
      </div>
    </div>
  );
}
