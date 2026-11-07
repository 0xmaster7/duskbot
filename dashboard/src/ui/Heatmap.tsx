import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Bot, Metric, Turn } from "../data/types";
import { dateLong, hours, int, monthName, usd } from "../lib/format";
import { heatmap, type HeatCell } from "../lib/usage";
import { cx } from "./kit";
import { Mascot } from "./Mascot";

export const HEAT = ["#ededed", "#d6e8fc", "#a9cdf7", "#519dfa", "#0077e6"] as const;
const GAP = 3;

const unit = (metric: Metric, v: number) =>
  metric === "turns" ? `${int(v)} ${v === 1 ? "turn" : "turns"}` : metric === "spend" ? `${usd(v)} paid` : `${hours(v)} computer time`;

export function Heatmap({ turns, bots, now, metric, weekStart, botId, onPick }: {
  turns: Turn[]; bots: Bot[]; now: number; metric: Metric; weekStart: 0 | 1; botId?: string; onPick: (from: string, to?: string) => void;
}) {
  const map = useMemo(() => heatmap(turns, now, metric, weekStart, botId), [turns, now, metric, weekStart, botId]);
  const flat = useMemo(() => map.weeks.flat(), [map]);
  const todayIndex = flat.findIndex((c) => c.future) - 1;
  const lastIndex = todayIndex < 0 ? flat.length - 1 : todayIndex;
  const [focus, setFocus] = useState(lastIndex);
  const [shown, setShown] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [CELL, setCell] = useState(11);
  const [width, setWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const fit = Math.floor((entry!.contentRect.width - 32) / map.weeks.length) - GAP;
      setCell(Math.max(11, Math.min(16, fit)));
      setWidth(entry!.contentRect.width);
      setScrollLeft(node.scrollLeft);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [map.weeks.length]);
  const grid = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => { scroller.current?.scrollTo({ left: scroller.current.scrollWidth }); const t = setTimeout(() => (first.current = false), 900); return () => clearTimeout(t); }, []);
  const name = (id: string) => bots.find((b) => b.id === id)?.name ?? id;

  const months = map.weeks.map((week, i) => {
    const firstOfMonth = week.find((c) => new Date(c.t).getDate() === 1);
    return firstOfMonth && i < map.weeks.length - 1 ? monthName(firstOfMonth.t) : i === 0 && new Date(week[0]!.t).getDate() < 22 ? monthName(week[0]!.t) : "";
  });
  const rowLabels = weekStart === 1 ? ["Mon", "", "Wed", "", "Fri", "", ""] : ["", "Mon", "", "Wed", "", "Fri", ""];

  const move = (to: number) => {
    const next = Math.max(0, Math.min(lastIndex, to));
    setFocus(next);
    setShown(next);
    grid.current?.querySelector<HTMLElement>(`[data-i="${next}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
    if (step !== undefined) { e.preventDefault(); move(focus + step); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(lastIndex); }
  };
  const pick = (cell: HeatCell, shift: boolean) => {
    if (shift && anchor) {
      const [a, b] = [anchor, cell.key].sort();
      setAnchor(null);
      onPick(a!, b!);
    } else if (shift) setAnchor(cell.key);
    else onPick(cell.key);
  };

  const tip = shown !== null ? flat[shown] : null;
  const tipCol = shown !== null ? Math.floor(shown / 7) : 0;
  const tipRow = shown !== null ? shown % 7 : 0;

  return (
    <div className="relative">
          {tip && !tip.future && (
            <div role="tooltip" className="pointer-events-none absolute z-20 w-max max-w-[260px] -translate-y-full rounded-[10px] bg-black px-3 py-2 text-12 text-[#f2f2f2] shadow-pop"
              style={{ left: Math.min(Math.max(0, 32 + tipCol * (CELL + GAP) - scrollLeft - 110), Math.max(0, width - 250)), top: 20 + tipRow * (CELL + GAP) - 6 }}>
              <p className="font-medium text-[#fafafa]">{dateLong(tip.t)}: {tip.value > 0 ? unit(metric, tip.value) : "no activity"}</p>
              {tip.byBot.length > 0 && <p className="mt-0.5 text-[#c9c9c9]">{tip.byBot.slice(0, 4).map((b) => `${name(b.botId)} ${b.turns}`).join(", ")}</p>}
              {tip.turns > 0 && <p className="mt-0.5 text-[#c9c9c9]">{usd(tip.paid)} paid, {hours(tip.hours)} computer time</p>}
            </div>
          )}
      <div ref={scroller} onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)} className="scroll-x -mx-1 px-1 pb-1">
        <div className="relative inline-block min-w-max" onMouseLeave={() => setShown(null)}>
          <div className="flex ps-8 text-12 text-ink-3" aria-hidden style={{ gap: GAP }}>
            {months.map((m, i) => <span key={i} className="h-5 overflow-visible whitespace-nowrap" style={{ width: CELL }}>{m}</span>)}
          </div>
          <div className="flex">
            <div className="flex w-8 flex-col text-12 leading-none text-ink-3" aria-hidden style={{ gap: GAP }}>
              {rowLabels.map((l, i) => <span key={i} className="flex items-center" style={{ height: CELL }}>{l}</span>)}
            </div>
            <div ref={grid} role="group" aria-label={`Activity in the last 12 months, ${metric === "turns" ? "finished turns" : metric === "spend" ? "paid spend" : "computer hours"} per day`} onKeyDown={onKey}
              className="grid grid-flow-col" style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, gap: GAP }}>
              {flat.map((cell, i) => {
                const label = cell.future ? "" : `${dateLong(cell.t)}: ${cell.value > 0 ? unit(metric, cell.value) : "no activity"}`;
                return (
                  <button key={cell.key} type="button" data-i={i} aria-label={label} disabled={cell.future} tabIndex={i === focus ? 0 : -1}
                    onFocus={() => { setFocus(i); setShown(i); }} onBlur={() => setShown(null)} onMouseEnter={() => setShown(i)}
                    onClick={(e) => pick(cell, e.shiftKey)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(cell, e.shiftKey); } }}
                    className={cx("rounded-[3px] outline-offset-1 transition-[background-color,box-shadow] duration-200 ease-out focus-visible:outline-2",
                      cell.future ? "invisible" : "cursor-pointer hover:shadow-[0_0_0_1.5px_rgb(0_0_0/0.25)]",
                      first.current && "cell-in", i === lastIndex && "shadow-[0_0_0_1.5px_var(--color-ink)]", anchor === cell.key && "shadow-[0_0_0_2px_var(--color-accent)]")}
                    style={{ width: CELL, height: CELL, background: HEAT[cell.level], animationDelay: first.current ? `${Math.floor(i / 7) * 7}ms` : undefined }} />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-12 text-ink-3">
        <p className="num">
          {metric === "turns" ? `${int(map.total)} turns` : metric === "spend" ? `${usd(map.total)} paid` : `${hours(map.total)} of computer time`} in the last 12 months
          {map.busiest && <>, busiest day {dateLong(map.busiest.t).replace(/, \d{4}$/, "")}</>}
          {map.streak > 1 && <>, {map.streak} days in a row</>}
        </p>
        <p className="text-ink-4">{anchor ? "Shift-click another day to pick a range" : "Click a day for its usage, shift-click two for a range"}</p>
        <div className="ms-auto flex items-center gap-1.5" aria-hidden>
          <span>Less</span>
          {HEAT.map((c) => <span key={c} className="size-[11px] rounded-[3px]" style={{ background: c }} />)}
          <span>More</span>
          <span className="-my-2 ms-1"><Mascot color="blue" body="cloud" size={22} state={map.streak > 0 ? "happy" : "sleeping"} /></span>
        </div>
      </div>
    </div>
  );
}
