import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "./kit";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};

function useHover(count: number) {
  const [index, setIndex] = useState<number | null>(null);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    setIndex((i) => {
      const at = i ?? count - 1;
      return e.key === "Home" ? 0 : e.key === "End" ? count - 1 : Math.max(0, Math.min(count - 1, at + (e.key === "ArrowLeft" ? -1 : 1)));
    });
  };
  return { index, setIndex, onKey };
}

function Tip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.max(8, Math.min(width - 188, x - 90));
  return (
    <div className="pointer-events-none absolute top-0 z-10 w-[180px] rounded-[10px] border border-line bg-surface px-3 py-2 text-12 shadow-pop" style={{ left }}>
      {children}
    </div>
  );
}

export interface LineSeries { label: string; values: number[]; dotted?: boolean; color?: string }

/** Thin blue line over a dotted comparison series, Rico's chart. */
export function LineChart({ series, labels, height = 160, format, axis = format, label, max: fixedMax }: { series: LineSeries[]; labels: string[]; height?: number; format: (v: number) => string; axis?: (v: number) => string; label: string; max?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = labels.length;
  const { index, setIndex, onKey } = useHover(n);
  const pad = { l: 36, r: 8, t: 10, b: 22 };
  const max = fixedMax ?? niceMax(Math.max(...series.flatMap((s) => s.values), 0));
  const w = Math.max(0, width - pad.l - pad.r), h = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * w);
  const y = (v: number) => pad.t + h - (v / max) * h;
  const path = (values: number[]) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setIndex(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left - pad.l) / Math.max(1, w)) * (n - 1)))));
  };
  const tickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 72))));
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} tabIndex={0} onKeyDown={onKey} onPointerMove={onMove} onPointerLeave={() => setIndex(null)} onBlur={() => setIndex(null)} className="block touch-pan-y">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={pad.l} x2={width - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-row)" />
              <text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end" className="fill-ink-4 text-[11px]">{axis(max * f)}</text>
            </g>
          ))}
          {labels.map((l, i) => ((i % tickEvery === 0 && x(n - 1) - x(i) >= 72) || i === n - 1) && i > 0 ? <text key={i} x={x(i)} y={height - 6} textAnchor={i === n - 1 ? "end" : "middle"} className="fill-ink-4 text-[11px]">{l}</text> : null)}
          {series.map((s) => (
            <path key={s.label} d={path(s.values)} fill="none" stroke={s.color ?? (s.dotted ? "#b9b9b6" : "var(--color-accent)")} strokeWidth={s.dotted ? 1.25 : 1.5} strokeDasharray={s.dotted ? "1.5 3.5" : undefined} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {index !== null && (
            <g>
              <line x1={x(index)} x2={x(index)} y1={pad.t} y2={pad.t + h} stroke="var(--color-line)" />
              {series.map((s) => <circle key={s.label} cx={x(index)} cy={y(s.values[index] ?? 0)} r={3} fill="var(--color-surface)" stroke={s.dotted ? "#b9b9b6" : "var(--color-accent)"} strokeWidth={1.5} />)}
            </g>
          )}
        </svg>
      )}
      {index !== null && width > 0 && (
        <Tip x={x(index)} width={width}>
          <p className="font-medium text-ink">{labels[index]}</p>
          {series.map((s) => <p key={s.label} className="mt-0.5 flex justify-between gap-2 text-ink-3"><span>{s.label}</span><span className="num text-ink">{format(s.values[index] ?? 0)}</span></p>)}
        </Tip>
      )}
    </div>
  );
}

export interface StackKey { key: string; label: string; color: string }

export function StackedBars({ keys, rows, labels, line, lineLabel, forecast, cap, capLabel, rightAxisLabel = "Month to date", height = 240, format, label, onPick }: {
  keys: StackKey[]; rows: Array<Record<string, number>>; labels: string[]; line?: number[]; lineLabel?: string; forecast?: number[]; cap?: number; capLabel?: string;
  rightAxisLabel?: string; height?: number; format: (v: number) => string; label: string; onPick?: (i: number) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = rows.length;
  const total = labels.length;
  const { index, setIndex, onKey } = useHover(n);
  const pad = { l: 40, r: 94, t: 34, b: 22 };
  const w = Math.max(0, width - pad.l - pad.r), h = height - pad.t - pad.b;
  const barMax = niceMax(Math.max(...rows.map((r) => keys.reduce((s, k) => s + (r[k.key] ?? 0), 0)), 0.01));
  const lineMax = niceMax(Math.max(...(line ?? [0]), ...(forecast ?? [0]), cap ?? 0, 0.01));
  const slot = w / Math.max(1, total);
  const bw = Math.max(2, Math.min(18, slot * 0.62));
  const x = (i: number) => pad.l + slot * i + slot / 2;
  const yb = (v: number) => pad.t + h - (v / barMax) * h;
  const yl = (v: number) => pad.t + h - (v / lineMax) * h;
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setIndex(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - box.left - pad.l) / Math.max(1, slot)))));
  };
  const tickEvery = Math.max(1, Math.ceil(total / Math.max(2, Math.floor(w / 64))));
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} tabIndex={0} onKeyDown={(e) => { onKey(e); if (e.key === "Enter" && index !== null) onPick?.(index); }}
          onPointerMove={onMove} onPointerLeave={() => setIndex(null)} onBlur={() => setIndex(null)} onClick={() => index !== null && onPick?.(index)} className={cx("block touch-pan-y", onPick && "cursor-pointer")}>
          <text x={pad.l} y={14} className="fill-accent text-12">Per day</text>
          {line && <text x={width - 4} y={14} textAnchor="end" className="fill-ink-2 text-12">{rightAxisLabel}</text>}
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={pad.l} x2={width - pad.r} y1={yb(barMax * f)} y2={yb(barMax * f)} stroke="var(--color-row)" />
              <text x={pad.l - 6} y={yb(barMax * f) + 4} textAnchor="end" className="fill-accent text-12">{format(barMax * f)}</text>
              {line && <text x={width - pad.r + 6} y={yl(lineMax * f) + 4} className="fill-ink-2 text-12">{format(lineMax * f)}</text>}
            </g>
          ))}
          {labels.map((l, i) => ((i % tickEvery === 0 && x(total - 1) - x(i) >= 32) || i === total - 1 ? <text key={i} x={x(i)} y={height - 6} textAnchor={i === total - 1 ? "end" : "middle"} className="fill-ink-4 text-12">{l}</text> : null))}
          {rows.map((r, i) => {
            let acc = 0;
            return (
              <g key={i} opacity={index === null || index === i ? 1 : 0.55} className="transition-opacity duration-150">
                {keys.map((k) => {
                  const v = r[k.key] ?? 0;
                  if (v <= 0) return null;
                  const y0 = yb(acc), y1 = yb(acc + v);
                  acc += v;
                  return <rect key={k.key} x={x(i) - bw / 2} y={y1} width={bw} height={Math.max(0.5, y0 - y1)} fill={k.color} rx={1} />;
                })}
              </g>
            );
          })}
          {cap !== undefined && (
            <g>
              <line x1={pad.l} x2={width - pad.r} y1={yl(cap)} y2={yl(cap)} stroke="var(--color-ink-3)" strokeDasharray="4 4" strokeWidth={1} />
              <text x={width - pad.r + 6} y={yl(cap) - 7} className="fill-ink-3 text-12 font-medium">{capLabel}</text>
            </g>
          )}
          {forecast && <path d={forecast.map((v, i) => (i < n - 1 ? "" : `${i === n - 1 ? "M" : "L"}${x(i).toFixed(1)},${yl(v).toFixed(1)}`)).join("")} fill="none" stroke="var(--color-ink-2)" strokeWidth={1.25} strokeDasharray="1.5 3.5" strokeLinecap="round" />}
          {line && <path d={line.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yl(v).toFixed(1)}`).join("")} fill="none" stroke="var(--color-ink-2)" strokeWidth={1.5} strokeLinejoin="round" />}
          {index !== null && line && <circle cx={x(index)} cy={yl(line[index] ?? 0)} r={3} fill="var(--color-surface)" stroke="var(--color-ink-2)" strokeWidth={1.5} />}
        </svg>
      )}
      {index !== null && width > 0 && (
        <Tip x={x(index)} width={width}>
          <p className="font-medium text-ink">{labels[index]}</p>
          {keys.map((k) => (rows[index]?.[k.key] ?? 0) > 0 && (
            <p key={k.key} className="mt-0.5 flex items-center gap-1.5 text-ink-3"><span className="size-2 rounded-[2px]" style={{ background: k.color }} /><span className="flex-1">{k.label}</span><span className="num text-ink">{format(rows[index]![k.key]!)}</span></p>
          ))}
          {line && <p className="mt-1 flex justify-between border-t border-row pt-1 text-ink-3"><span>{lineLabel}</span><span className="num text-ink">{format(line[index] ?? 0)}</span></p>}
        </Tip>
      )}
    </div>
  );
}

export function Sparkline({ values, width = 72, height = 22, label }: { values: number[]; width?: number; height?: number; label: string }) {
  const max = Math.max(...values, 0.0001);
  const step = width / Math.max(1, values.length - 1);
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="block shrink-0">
      <path d={d} fill="none" stroke="var(--color-accent-2)" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
