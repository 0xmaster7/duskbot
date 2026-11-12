import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { BOT_COLOURS } from "./Mascot";
import type { UsageSeries } from "../data/usage-math";
import { EASE_OUT, m, useSlots } from "./motion";
import { compact, parseDay, shortDate } from "../lib/format";

// series take the mascots' own colours, in an order that keeps neighbours apart
export const SERIES_COLORS = [BOT_COLOURS.blue, BOT_COLOURS.orange, BOT_COLOURS.green, BOT_COLOURS.purple, BOT_COLOURS.cyan, BOT_COLOURS.pink, "#91919b"];

const H = 260;
const PAD = { top: 12, right: 12, bottom: 30, left: 52 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 6 ? 6 : n <= 8 ? 8 : 10) * pow;
}

/** tokens per day, one line per group with a faint wash under it; arrow keys or the pointer pick a day */
export function UsageChart({ days, series }: { days: string[]; series: UsageSeries[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [at, setAt] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setW(Math.max(280, el.clientWidth));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const slots = useSlots(series.map((s) => s.key));
  const iw = w - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (days.length <= 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const ticks = [0, max / 3, (max * 2) / 3, max];
  const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(iw / 64))));
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left - PAD.left) / Math.max(1, iw);
    setAt(Math.max(0, Math.min(days.length - 1, Math.round(rel * (days.length - 1)))));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setAt((a) => Math.max(0, Math.min(days.length - 1, (a ?? days.length - 1) + (e.key === "ArrowRight" ? 1 : -1))));
  };
  const total = series.reduce((n, s) => n + s.values.reduce((a, b) => a + b, 0), 0);
  const tipLeft = at === null ? 0 : Math.min(Math.max(x(at) - 90, 0), w - 180);
  return (
    <div
      ref={box}
      className="relative outline-none focus-visible:rounded-[12px]"
      tabIndex={0}
      role="group"
      aria-label={`tokens per day, ${compact(total)} this month across ${series.length} ${series.length === 1 ? "group" : "groups"}. use the left and right arrow keys to read a day.`}
      onPointerMove={pick}
      onPointerLeave={() => setAt(null)}
      onKeyDown={key}
      onBlur={() => setAt(null)}
    >
      <svg width={w} height={H} className="block" aria-hidden>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} style={{ stroke: "var(--line)" }} />
            <text x={PAD.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="num" style={{ fill: "var(--ink-4)", fontSize: 12 }}>{compact(t)}</text>
          </g>
        ))}
        {days.map((d, i) => (i % every === 0 || i === days.length - 1) && (i === days.length - 1 || days.length - 1 - i >= every) ? (
          <text key={d} x={x(i)} y={H - 8} textAnchor={days.length > 1 && i === 0 ? "start" : days.length > 1 && i === days.length - 1 ? "end" : "middle"} style={{ fill: "var(--ink-4)", fontSize: 12 }}>{shortDate(parseDay(d))}</text>
        ) : null)}
        <m.g initial={{ clipPath: "inset(0% 100% 0% 0%)" }} animate={{ clipPath: "inset(0% 0% 0% 0%)" }} transition={{ duration: 0.6, ease: EASE_OUT }}>
        {[...series].reverse().map((s) => {
          const i = series.indexOf(s);
          const color = SERIES_COLORS[i % SERIES_COLORS.length]!;
          const line = s.values.map((v, j) => `${j ? "L" : "M"}${x(j).toFixed(1)},${y(v).toFixed(1)}`).join("");
          const area = `${line}L${x(s.values.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
          const morph = { type: "spring", visualDuration: 0.4, bounce: 0 } as const;
          return (
            <g key={slots[i]}>
              <m.path initial={false} animate={{ d: area, fill: color }} transition={morph} style={{ opacity: i === 0 ? 0.12 : 0.05 }} />
              <m.path initial={false} animate={{ d: line, stroke: color }} transition={morph} fill="none" style={{ strokeWidth: 1.75, strokeLinejoin: "round", strokeLinecap: "round" }} />
            </g>
          );
        })}
        </m.g>
        {at !== null && (
          <g>
            <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={PAD.top + ih} style={{ stroke: "var(--line-2)" }} />
            {series.map((s, i) => <circle key={s.key} cx={x(at)} cy={y(s.values[at] ?? 0)} r={3.5} style={{ fill: SERIES_COLORS[i % SERIES_COLORS.length], stroke: "var(--card)", strokeWidth: 2 }} />)}
          </g>
        )}
      </svg>
      <p className="sr-only" aria-live="polite">{at !== null ? `${shortDate(parseDay(days[at]!))}: ${series.map((s) => `${s.label} ${compact(s.values[at] ?? 0)} tokens`).join(", ")}` : ""}</p>
      {at !== null && (
        <div className="pointer-events-none absolute top-1 z-10 w-[180px] rounded-[12px] bg-card-2 px-3 py-2.5 text-13" style={{ left: tipLeft, boxShadow: "var(--pop-shadow)" }} aria-hidden>
          <div className="text-ink-3">{shortDate(parseDay(days[at]!))}</div>
          {series.map((s, i) => (
            <div key={s.key} className="mt-1 flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate text-ink-2">{s.label}</span>
              <span className="num text-ink">{compact(s.values[at] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ series }: { series: UsageSeries[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="legend">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2 text-14 text-ink-2">
          <span className="size-2 shrink-0 rounded-full" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
