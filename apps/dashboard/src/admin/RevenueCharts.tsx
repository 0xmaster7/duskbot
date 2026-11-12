import { useId, useState } from "react";
import { cx, Segmented } from "../ui/kit";
import { AnimatePresence, EASE_OUT, m, useReducedMotion } from "../ui/motion";
import { sampled, useWidth } from "./charts";
import { Morph, Row, bar, usd } from "./kit";
import { n } from "./ui";
import type { CohortRow, MonthRow } from "./revenue-types";

export const monthName = (t: number, year = false) => new Date(t).toLocaleDateString("en-US", { month: "short", timeZone: "UTC", ...(year ? { year: "2-digit" } : {}) }).toLowerCase();
export const MOVE = {
  new: "var(--viz-new)",
  expansion: "color-mix(in oklab, var(--viz-new) 50%, var(--pop))",
  reactivation: "color-mix(in oklab, var(--viz-visitors) 45%, var(--pop))",
  contraction: "color-mix(in oklab, var(--viz-renewal) 38%, var(--pop))",
  churned: "color-mix(in oklab, var(--viz-renewal) 72%, var(--pop))",
} as const;
const SPRING = { type: "spring", visualDuration: 0.36, bounce: 0 } as const;

/** a round step up for an axis: 1, 2, 2.5, 5 and their tens, for any positive number */
export function nice(value: number) {
  if (!(value > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(value)), f = value / p;
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => f <= step) ?? 10) * p;
}

/** last month against this one: money up in green, down in quiet ink, never red; churn reads the other way round */
export function MoneyDelta({ now, before, invert = false, mode = "relative" }: { now: number | null; before: number | null; invert?: boolean; mode?: "relative" | "points" | "usd" }) {
  if (now === null || before === null) return <span className="text-12 text-ink-4">no month before</span>;
  const diff = now - before;
  const change = mode === "relative" ? (before === 0 ? null : diff / Math.abs(before)) : diff;
  if (change === null) return <span className="text-12 text-ink-4">{now === 0 ? "same as last month" : "new this month"}</span>;
  const still = mode === "points" ? Math.abs(change) < 0.0005 : mode === "usd" ? change === 0 : Math.abs(change) < 0.005;
  if (still) return <span className="text-12 text-ink-4">same as last month</span>;
  const up = change > 0, good = invert ? !up : up;
  const size = mode === "relative" ? `${Math.min(999, Math.round(Math.abs(change) * 100))}%` : mode === "points" ? `${(Math.round(Math.abs(change) * 1000) / 10).toFixed(1)} pts` : usd(Math.abs(change), true);
  return (
    <span className={cx("inline-flex items-center gap-1 font-mono text-12 num", good ? "text-money" : "text-ink-3")} aria-label={`${up ? "up" : "down"} ${size} on last month`}>
      {size} {up ? "↑" : "↓"}<span className="font-sans text-ink-4 max-sm:hidden">vs last month</span>
    </span>
  );
}

/** twelve months as one soft line with a wash under it; the newest point gets a dot */
export function Sparkline({ values, color, height = 34, label }: { values: Array<number | null>; color: string; height?: number; label: string }) {
  const reduced = useReducedMotion() ?? false;
  const fill = useId().replace(/:/g, "");
  const [box, W] = useWidth(60);
  const known = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  const lo = Math.min(0, ...known.map((p) => p[1])), hi = Math.max(lo + 1, ...known.map((p) => p[1]));
  const y = (v: number) => height - 3 - ((v - lo) / (hi - lo)) * (height - 8);
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W;
  const pts: Array<[number, number]> = known.map(([i, v]) => [x(i), y(v)]);
  const line = pts.length > 1 ? sampled(pts, height, pts[0]![0], pts.at(-1)![0]) : `M0,${height - 3}L${W},${height - 3}`;
  const last = pts.at(-1);
  return (
    <div ref={box} className="w-full"><svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} className="block overflow-visible" role="img" aria-label={label}>
      <defs><linearGradient id={fill} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.22} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
      {pts.length > 1 && <m.path d={`${line}L${pts.at(-1)![0]},${height}L${pts[0]![0]},${height}Z`} fill={`url(#${fill})`} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.15 }} />}
      <m.path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" 
        initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.55, ease: EASE_OUT }} />
      {last && <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />}
    </svg></div>
  );
}

const UP = [["new", "new"], ["expansion", "expansion"], ["reactivation", "came back"]] as const;
const DOWN = [["contraction", "contraction"], ["churned", "churned"]] as const;
/** each month's mrr movement: what came in stacked above the line, what left below it, net new as a line through both */
export function MovementChart({ months, height = 260 }: { months: MonthRow[]; height?: number }) {
  const [box, width] = useWidth(260);
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useReducedMotion() ?? false;
  const pad = { top: 12, right: 8, bottom: 24, left: 48 };
  const count = months.length, inner = width - pad.left - pad.right, step = inner / Math.max(1, count);
  const ups = months.map((r) => r.new + r.expansion + r.reactivation), downs = months.map((r) => -(r.contraction + r.churned));
  const top = nice(Math.max(1, ...ups, ...months.map((r) => r.netNew))), bottom = Math.max(...downs, ...months.map((r) => -r.netNew)) > 0 ? nice(Math.max(...downs, ...months.map((r) => -r.netNew))) : 0;
  const tall = height - pad.top - pad.bottom;
  const y = (v: number) => pad.top + ((top - v) / (top + bottom)) * tall, zero = y(0);
  const x = (i: number) => pad.left + step * (i + 0.5);
  const bw = Math.max(4, Math.min(28, step * 0.56));
  const net = months.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.netNew).toFixed(1)}`).join("");
  const delay = (i: number) => reduced ? 0 : Math.min(0.24, i * 0.02);
  const at = hover;
  return (
    <div className="relative" ref={box}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.floor((e.clientX - r.left - pad.left) / step); setHover(i >= 0 && i < count ? i : null); }} onMouseLeave={() => setHover(null)}>
        {[top, top / 2, 0, ...(bottom ? [-bottom] : [])].map((v) => <g key={v}>
          <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--line-2)" : "var(--line)"} strokeDasharray={v === 0 ? undefined : "3 5"} />
          <text x={pad.left - 8} y={y(v) + 4} textAnchor="end" className={cx("font-mono text-[10.5px]", v > 0 ? "fill-money" : "fill-ink-4")}>{v > 0 ? "+" : ""}{usd(v, true)}</text>
        </g>)}
        {months.map((r, i) => {
          let up = 0, down = 0;
          const left = x(i) - bw / 2, flat = bar(left, zero, zero, bw);
          return <g key={r.start} opacity={hover === null || hover === i ? 1 : 0.45} style={{ transition: "opacity 150ms ease" }}>
            {UP.map(([key]) => { const v = Math.max(0, r[key]), y0 = y(up), y1 = y(up + v); up += v; return <Morph key={key} d={bar(left, y0, y1, bw)} flat={flat} fill={MOVE[key]} delay={delay(i)} reduced={reduced} />; })}
            {DOWN.map(([key]) => { const v = Math.max(0, -r[key]), y0 = y(-down), y1 = y(-(down + v)); down += v; return <Morph key={key} d={bar(left, y0, y1, bw)} flat={flat} fill={MOVE[key]} delay={delay(i)} reduced={reduced} />; })}
          </g>;
        })}
        <m.path d={net} fill="none" stroke="var(--ink-2)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" initial={reduced ? false : { pathLength: 0, d: net }} animate={{ pathLength: 1, d: net }} transition={reduced ? { duration: 0 } : { pathLength: { duration: 0.6, ease: EASE_OUT, delay: 0.2 }, d: SPRING }} />
        {months.map((r, i) => <circle key={r.start} cx={x(i)} cy={y(r.netNew)} r={hover === i ? 4.5 : 3} fill="var(--pop)" stroke="var(--ink-2)" strokeWidth={1.75} />)}
        {months.map((r, i) => i % Math.max(1, Math.ceil(30 / step)) === 0 && <text key={r.start} x={x(i)} y={height - 7} textAnchor="middle" className="fill-ink-4 font-mono text-[10.5px]">{monthName(r.start)}</text>)}
      </svg>
      <AnimatePresence>
        {at !== null && (() => {
          const r = months[at]!;
          return (
            <m.div key="tip" className="pointer-events-none absolute left-0 top-0 z-10 min-w-[188px] rounded-[14px] bg-pop px-3 py-2 text-12 text-ink" style={{ boxShadow: "var(--pop-shadow)" }}
              initial={{ opacity: 0, x: Math.min(x(at) + 14, width - 196) }} animate={{ opacity: 1, x: Math.min(x(at) + 14, width - 196) }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ x: { type: "spring", visualDuration: 0.18, bounce: 0 }, opacity: { duration: 0.12 } }}>
              <div className="font-mono text-ink-3">{monthName(r.start, true)}</div>
              {[...UP, ...DOWN].filter(([key]) => r[key] !== 0).map(([key, label]) => <Row key={key} dot={MOVE[key]} label={label} value={`${r[key] > 0 ? "+" : ""}${usd(r[key])}`} />)}
              <Row label="net new" value={`${r.netNew > 0 ? "+" : ""}${usd(r.netNew)}`} strong />
              <Row label="mrr at month end" value={usd(r.mrr)} />
            </m.div>
          );
        })()}
      </AnimatePresence>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-12 text-ink-3" aria-label="legend">
        {[...UP, ...DOWN].map(([key, label]) => <li key={key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: MOVE[key] }} aria-hidden />{label}</li>)}
        <li className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-ink-2" aria-hidden />net new</li>
      </ul>
      <div className="sr-only"><table>
        <caption>mrr movement per month</caption>
        <thead><tr><th scope="col">month</th>{[...UP, ...DOWN].map(([key, label]) => <th key={key} scope="col">{label}</th>)}<th scope="col">net new</th></tr></thead>
        <tbody>{months.map((r) => <tr key={r.start}><th scope="row">{monthName(r.start, true)}</th>{[...UP, ...DOWN].map(([key]) => <td key={key}>{usd(r[key])}</td>)}<td>{usd(r.netNew)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}

export interface LineSeries { key: string; label: string; color: string; values: Array<number | null>; dashed?: boolean }
/** a few rates over the months on one axis; a hover lists each */
export function LineChart({ starts, series, format, height = 180 }: { starts: number[]; series: LineSeries[]; format(v: number): string; height?: number }) {
  const [box, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useReducedMotion() ?? false;
  const pad = { top: 10, right: 8, bottom: 24, left: 44 };
  const count = starts.length, inner = width - pad.left - pad.right, step = inner / Math.max(1, count);
  const max = nice(Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))));
  const y = (v: number) => height - pad.bottom - (v / max) * (height - pad.top - pad.bottom);
  const x = (i: number) => pad.left + step * (i + 0.5);
  const path = (values: Array<number | null>) => values.map((v, i) => v === null ? "" : `${i && values[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <div className="relative" ref={box}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.floor((e.clientX - r.left - pad.left) / step); setHover(i >= 0 && i < count ? i : null); }} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={pad.left} x2={width - pad.right} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" strokeDasharray={f ? "3 5" : undefined} /><text x={pad.left - 6} y={y(max * f) + 4} textAnchor="end" className="fill-ink-4 font-mono text-[10.5px]">{format(max * f)}</text></g>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} stroke="var(--line-2)" />}
        {series.map((s, k) => <g key={s.key}>
          <m.path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.dashed ? "4 5" : undefined}
            initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: EASE_OUT, delay: reduced ? 0 : k * 0.08 }} />
          {s.values.map((v, i) => v !== null && (hover === i || i === count - 1) && <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill="var(--pop)" stroke={s.color} strokeWidth={2} />)}
        </g>)}
        {starts.map((t, i) => i % Math.max(1, Math.ceil(30 / step)) === 0 && <text key={t} x={x(i)} y={height - 7} textAnchor="middle" className="fill-ink-4 font-mono text-[10.5px]">{monthName(t)}</text>)}
      </svg>
      <AnimatePresence>
        {hover !== null && (
          <m.div key="tip" className="pointer-events-none absolute left-0 top-0 z-10 min-w-[170px] rounded-[14px] bg-pop px-3 py-2 text-12 text-ink" style={{ boxShadow: "var(--pop-shadow)" }}
            initial={{ opacity: 0, x: Math.min(x(hover) + 12, width - 180) }} animate={{ opacity: 1, x: Math.min(x(hover) + 12, width - 180) }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ x: { type: "spring", visualDuration: 0.18, bounce: 0 }, opacity: { duration: 0.12 } }}>
            <div className="font-mono text-ink-3">{monthName(starts[hover]!, true)}</div>
            {series.map((s) => <Row key={s.key} dot={s.color} label={s.label} value={s.values[hover] === null ? "-" : format(s.values[hover]!)} />)}
          </m.div>
        )}
      </AnimatePresence>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-12 text-ink-3" aria-label="legend">
        {series.map((s) => <li key={s.key} className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} aria-hidden />{s.label}</li>)}
      </ul>
      <div className="sr-only"><table><tbody>{starts.map((t, i) => <tr key={t}><th scope="row">{monthName(t, true)}</th>{series.map((s) => <td key={s.key}>{s.label} {s.values[i] === null ? "-" : format(s.values[i]!)}</td>)}</tr>)}</tbody></table></div>
    </div>
  );
}

type CohortKind = "payment" | "signup";
type CohortMetric = "logo" | "revenue";
/** month-by-month retention per cohort: who is still paying, or how much of their mrr is left; pick the cohort by first payment or by signup */
export function CohortHeat({ cohorts }: { cohorts: { payment: CohortRow[]; signup: CohortRow[] } }) {
  const [kind, setKind] = useState<CohortKind>("payment");
  const [metric, setMetric] = useState<CohortMetric>("logo");
  const rows = cohorts[kind].filter((row) => row.size > 0);
  const cols = Math.max(0, ...rows.map((row) => row[metric].length));
  const peak = Math.max(1, ...rows.flatMap((row) => row.revenue.filter((v): v is number => v !== null)));
  const level = (v: number) => kind === "signup" && metric === "revenue" ? v / peak : Math.min(1, v);
  const show = (v: number) => kind === "signup" && metric === "revenue" ? usd(v, true) : `${Math.round(v * 100)}%`;
  const tint = metric === "revenue" ? "var(--viz-new)" : "var(--viz-visitors)";
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented<CohortKind> label="group people by" value={kind} onChange={setKind} options={[{ value: "payment", label: "by first payment" }, { value: "signup", label: "by signup" }]} />
        <Segmented<CohortMetric> label="measure" value={metric} onChange={setMetric} options={[{ value: "logo", label: "customers" }, { value: "revenue", label: "revenue" }]} />
      </div>
      {rows.length ? (
        <div className="scroll-x -mx-1 px-1">
          <table className="w-full min-w-[720px] border-separate border-spacing-[3px] text-12">
            <caption className="sr-only">{metric === "logo" ? "share still paying" : kind === "signup" ? "mrr" : "share of starting mrr kept"} by months since {kind === "payment" ? "first payment" : "signup"}</caption>
            <thead><tr className="text-ink-4">
              <th scope="col" className="w-[72px] pb-1 text-start font-normal">cohort</th>
              <th scope="col" className="w-[52px] pb-1 text-end font-normal">{kind === "payment" ? "paid" : "signed up"}</th>
              {Array.from({ length: cols }, (_, i) => <th key={i} scope="col" className="pb-1 text-center font-mono font-normal">m{i}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={row.start}>
                  <th scope="row" className="whitespace-nowrap pe-2 text-start font-mono font-normal text-ink-2">{monthName(row.start, true)}</th>
                  <td className="pe-2 text-end font-mono text-ink-3 num">{n(row.size)}</td>
                  {Array.from({ length: cols }, (_, i) => {
                    const v = row[metric][i] ?? null;
                    if (v === null) return <td key={i} />;
                    const t = level(v);
                    return (
                      <td key={i} className="h-8 rounded-[7px] text-center font-mono num" title={`${monthName(row.start, true)}, month ${i}: ${show(v)}`}>
                        <m.span className="grid h-8 min-w-[40px] place-items-center rounded-[7px] text-ink"
                          initial={{ opacity: 0 }} animate={{ opacity: 1, backgroundColor: v === 0 ? "var(--cell)" : `color-mix(in oklab, ${tint} ${Math.round(8 + t * 30)}%, var(--pop))` }}
                          transition={{ opacity: { duration: 0.2, delay: Math.min(0.3, (r + i) * 0.012) }, backgroundColor: { duration: 0.24 } }}>{show(v)}</m.span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="py-6 text-center text-13 text-ink-3">cohorts show up after the first month of payments.</p>}
      <p className="mt-2 text-12 text-ink-4">
        {metric === "logo" ? `the share of each ${kind === "payment" ? "month's new customers" : "month's signups"} paying in each month after.`
          : kind === "payment" ? "the share of each cohort's starting mrr still coming in; above 100% means upgrades outgrew the churn." : "the mrr each month's signups bring in, month by month."}
      </p>
    </div>
  );
}
