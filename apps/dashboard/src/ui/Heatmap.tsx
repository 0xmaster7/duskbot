import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import type { ActivityReport } from "../../../../shared/dashboard-protocol";
import { dayKey, exact, longDate, MONTH_NAMES, monthShort, parseDay, plural, usd } from "../lib/format";
import { cx, Stat } from "./kit";
import { TOKEN_KINDS, tokenSplit } from "../data/usage-math";

export type HeatMetric = "turns" | "tokens" | "spend";
const WEEKS = 53;
const DAY_MS = 86_400_000;

const valueOf = (d: ActivityReport["days"][number] | undefined, metric: HeatMetric) =>
  !d ? 0 : metric === "turns" ? d.turns : metric === "tokens" ? d.tokens : d.costUsd ?? 0;

const say = (v: number, metric: HeatMetric) => (metric === "turns" ? plural(v, "turn") : metric === "tokens" ? `${exact(v)} tokens` : usd(v));

/** "800 input, 120 output, 4,000 cache read" for a day that carries the split, empty for one that does not */
export function splitLine(day: ActivityReport["days"][number] | ActivityReport["totals"] | undefined): string {
  if (!day || day.input === undefined) return "";
  const split = tokenSplit(day);
  return TOKEN_KINDS.filter(({ key }) => key !== "cacheWrite" || split.cacheWrite > 0).map(({ key, label }) => `${exact(split[key])} ${label}`).join(", ");
}

export function activityStats(days: ActivityReport["days"], metric: HeatMetric, now: number) {
  const byDay = new Map(days.map((d) => [d.date, valueOf(d, metric)]));
  const months = new Map<string, number>();
  let bestDay: { date: string; v: number } | null = null;
  for (const [date, v] of byDay) {
    if (v <= 0) continue;
    months.set(date.slice(0, 7), (months.get(date.slice(0, 7)) ?? 0) + v);
    if (!bestDay || v > bestDay.v) bestDay = { date, v };
  }
  let bestMonth: string | null = null;
  for (const [m, v] of months) if (!bestMonth || v > (months.get(bestMonth) ?? 0)) bestMonth = m;
  // streaks walk the calendar, so a gap day breaks them
  let longest = 0, run = 0;
  const active = [...byDay.entries()].filter(([, v]) => v > 0).map(([d]) => d).sort();
  let prev: number | null = null;
  for (const d of active) {
    const t = parseDay(d).getTime();
    run = prev !== null && Math.round((t - prev) / DAY_MS) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  let current = 0;
  const today = parseDay(dayKey(now));
  for (let t = today.getTime(), i = 0; i < 400; i++, t -= DAY_MS) {
    const v = byDay.get(dayKey(t)) ?? 0;
    if (v > 0) current++;
    else if (i > 0 || current > 0) break;
  }
  return {
    bestMonth: bestMonth ? MONTH_NAMES[Number(bestMonth.slice(5)) - 1]! : null,
    bestDay: bestDay ? longDate(parseDay(bestDay.date)) : null,
    longest,
    current,
  };
}

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

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const [picked, setPicked] = useState<{ key: string; v: number } | null>(null);
  const pickedSplit = picked && metric === "tokens" && picked.v > 0 ? splitLine(byDate.get(picked.key)) : "";
  useEffect(() => setPicked(null), [metric]);
  // one handler for the whole grid: a tap on touch, a hover with a mouse, shows the day under the legend
  const pick = (event: SyntheticEvent<HTMLDivElement>) => {
    const day = (event.target as HTMLElement).closest<HTMLElement>("[data-day]");
    if (!day?.dataset.day || day.dataset.future) return;
    const key = day.dataset.day;
    setPicked((p) => (p?.key === key ? p : { key, v: Number(day.dataset.v) }));
  };
  const cell = compactCells ? 11 : undefined;
  const cells = useMemo(() => weeks.flat().map((c) => (
    <div
      key={c.key}
      role="gridcell"
      data-day={c.key}
      data-v={c.v}
      data-future={c.future || undefined}
      aria-label={c.future ? undefined : `${longDate(parseDay(c.key))}: ${say(c.v, metric)}`}
      className={cx("hover-cell aspect-square rounded-[3px] transition-[background-color] duration-300 ease-out", c.future && "opacity-0")}
      style={{ background: c.level ? `var(--heat-${c.level})` : "var(--cell)" }}
    />
  )), [weeks, metric]);
  return (
    <div>
      <div ref={scroller} className="scroll-x -mx-1 px-1 max-sm:[mask-image:linear-gradient(to_right,transparent,black_20px)]">
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
            aria-label={`activity over the last year, ${metric}`}
            onClick={pick}
            onPointerOver={(e) => { if (e.pointerType === "mouse") pick(e); }}
          >
            {cells}
          </div>
        </div>
      </div>
      {picked && <style>{`[data-day="${picked.key}"]{filter:brightness(0.82)}[data-theme="dark"] [data-day="${picked.key}"]{filter:brightness(1.45)}`}</style>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="num min-h-4 text-13 text-ink-2" aria-live="polite">{picked ? `${say(picked.v, metric)} on ${longDate(parseDay(picked.key))}${pickedSplit ? `: ${pickedSplit}` : ""}` : <span className="text-ink-4">pick a day to see it</span>}</p>
        <div className="t-pixel flex items-center gap-1.5 text-ink-3" aria-hidden>
          <span className="me-1">less</span>
          {levels.map((l) => <span key={l} className="size-[10px] rounded-[2px]" style={{ background: l ? `var(--heat-${l})` : "var(--cell)" }} />)}
          <span className="ms-1">more</span>
        </div>
      </div>
    </div>
  );
}

export function HeatStats({ days, metric, now }: { days: ActivityReport["days"]; metric: HeatMetric; now: number }) {
  const s = useMemo(() => activityStats(days, metric, now), [days, metric, now]);
  return (
    <div className="grid grid-cols-4 gap-6 max-md:grid-cols-2 max-md:gap-y-5">
      <Stat label="most active month" value={s.bestMonth ?? "none yet"} />
      <Stat label="most active day" value={s.bestDay ?? "none yet"} />
      <Stat label="longest streak" value={plural(s.longest, "day")} />
      <Stat label="current streak" value={plural(s.current, "day")} />
    </div>
  );
}
