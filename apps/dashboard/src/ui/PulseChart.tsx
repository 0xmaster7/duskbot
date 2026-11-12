import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PULSE_INTERVAL_MS, PULSE_WINDOW_MS, type PulseSample } from "../../../../shared/machine-pulse";
import { percent } from "../lib/format";
import { useReducedMotion } from "./motion";

export const PULSE_SERIES = { cpu: "var(--viz-visitors)", mem: "var(--viz-renewal)" } as const;
const H = 196, PAD = { top: 10, right: 6, bottom: 24, left: 38 };
const BASE = H - PAD.bottom, TALL = BASE - PAD.top;
/** how quickly the window's right edge follows a change in how late samples arrive */
const LAG_EASE_MS = 1500;

type Point = [number, number];

/** monotone cubic through the points (Fritsch-Carlson, as d3's curveMonotoneX), so the line never overshoots 0 or 100 */
function monotone(points: Point[]): string {
  if (points.length < 2) return "";
  const n = points.length, slopes: number[] = [], tangents: number[] = [];
  for (let i = 0; i < n - 1; i++) slopes.push((points[i + 1]![1] - points[i]![1]) / Math.max(1e-6, points[i + 1]![0] - points[i]![0]));
  tangents[0] = slopes[0]!; tangents[n - 1] = slopes[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const a = slopes[i - 1]!, b = slopes[i]!, h0 = points[i]![0] - points[i - 1]![0], h1 = points[i + 1]![0] - points[i]![0];
    tangents[i] = a * b <= 0 ? 0 : (Math.sign(a) + Math.sign(b)) * Math.min(Math.abs(a), Math.abs(b), 0.5 * Math.abs((a * h1 + b * h0) / (h0 + h1)));
  }
  let d = `M${points[0]![0].toFixed(1)},${points[0]![1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!, [x1, y1] = points[i + 1]!, h = (x1 - x0) / 3;
    d += `C${(x0 + h).toFixed(1)},${(y0 + tangents[i]! * h).toFixed(1)},${(x1 - h).toFixed(1)},${(y1 - tangents[i + 1]! * h).toFixed(1)},${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/** runs of samples with no gap longer than three intervals between them; a gap breaks the line */
function runs(samples: PulseSample[]): PulseSample[][] {
  const out: PulseSample[][] = [];
  for (const s of samples) {
    const run = out.at(-1);
    if (run && s.t - run.at(-1)!.t <= 3 * PULSE_INTERVAL_MS) run.push(s); else out.push([s]);
  }
  return out;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const ago = (ms: number) => ms < 4000 ? "now" : `${Math.round(ms / 1000)} s ago`;

/** cpu and memory over the last two minutes, sliding left as time passes: the paths are drawn once per new sample in
 * time space, and only the group's transform moves each frame */
export function PulseChart({ samples, lag, empty }: { samples: PulseSample[]; lag: number; empty?: string | null }) {
  const [box, width] = useWidth();
  const clip = useId().replace(/:/g, "");
  const reduced = useReducedMotion() ?? false;
  const slide = useRef<SVGGElement>(null);
  const [hover, setHover] = useState<PulseSample | null>(null);
  const inner = Math.max(1, width - PAD.left - PAD.right), scale = inner / PULSE_WINDOW_MS;
  const t0 = samples[0]?.t ?? 0, newest = samples.at(-1)?.t ?? 0;
  const y = (v: number) => BASE - (Math.max(0, Math.min(100, v)) / 100) * TALL;
  const paths = useMemo(() => {
    const parts = runs(samples).filter((run) => run.length > 1);
    const line = (key: "cpu" | "mem") => parts.map((run) => monotone(run.map((s) => [(s.t - t0) * scale, y(s[key])]))).join("");
    const area = parts.map((run) => { const d = monotone(run.map((s) => [(s.t - t0) * scale, y(s.cpu)])); return `${d}L${((run.at(-1)!.t - t0) * scale).toFixed(1)},${BASE}L${((run[0]!.t - t0) * scale).toFixed(1)},${BASE}Z`; }).join("");
    return { cpu: line("cpu"), mem: line("mem"), area };
  }, [samples, t0, scale]);
  const live = useRef({ t0, scale, lag, shown: lag, newest, reduced });
  live.current = { ...live.current, t0, scale, lag, newest, reduced };
  const edge = () => live.current.reduced ? live.current.newest : Date.now() - live.current.shown;
  const place = () => {
    const { t0, scale } = live.current;
    slide.current?.setAttribute("transform", `translate(${(PAD.left + inner - (edge() - t0) * scale).toFixed(2)} 0)`);
  };
  useLayoutEffect(place);
  useEffect(() => {
    if (reduced || samples.length < 2) return;
    let frame = 0, last = performance.now();
    const step = (now: number) => {
      const state = live.current, dt = Math.min(100, now - last);
      last = now;
      state.shown += (state.lag - state.shown) * Math.min(1, dt / LAG_EASE_MS);
      place();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reduced, samples.length >= 2, inner]);
  const current = hover ?? samples.at(-1) ?? null;
  const ready = samples.length > 1 && width > 0;
  const pick = (clientX: number, rect: DOMRect) => {
    const at = edge() - (PAD.left + inner - (clientX - rect.left)) / scale;
    let best: PulseSample | null = null;
    for (const s of samples) if (!best || Math.abs(s.t - at) < Math.abs(best.t - at)) best = s;
    setHover(best && Math.abs(best.t - at) <= 2 * PULSE_INTERVAL_MS ? best : null);
  };
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {(["cpu", "mem"] as const).map((key) => (
          <span key={key} className="inline-flex items-center gap-2 text-13 font-medium text-ink-2">
            <span className="h-[3px] w-3.5 rounded-full" style={{ background: PULSE_SERIES[key] }} aria-hidden />
            {key === "cpu" ? "cpu" : "memory"}
            <span className="num swap text-ink">{current ? percent(current[key]) : "-"}</span>
          </span>
        ))}
        <span className="num ms-auto text-12 font-medium text-ink-4" aria-hidden>{hover ? ago(Date.now() - hover.t) : ""}</span>
      </div>
      <div ref={box} className="relative mt-3">
        <svg width="100%" height={H} viewBox={`0 0 ${Math.max(1, width)} ${H}`} role="img" className="block touch-pan-y"
          aria-label={current ? `cpu ${percent(current.cpu)}, memory ${percent(current.mem)} of capacity, over the last two minutes` : "cpu and memory, no samples yet"}
          onPointerMove={(e) => ready && pick(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setHover(null)}>
          <defs>
            <clipPath id={clip}><rect x={PAD.left} y={0} width={inner} height={H} /></clipPath>
            <linearGradient id={`${clip}-wash`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={PULSE_SERIES.cpu} stopOpacity={0.16} /><stop offset="100%" stopColor={PULSE_SERIES.cpu} stopOpacity={0} /></linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={PAD.left + inner} y1={BASE - TALL * f} y2={BASE - TALL * f} stroke="var(--line)" strokeDasharray={f ? "3 5" : undefined} />
              <text x={PAD.left - 8} y={BASE - TALL * f + 4} textAnchor="end" className="fill-ink-4 font-mono text-[11px]">{f ? `${f * 100}%` : "0"}</text>
            </g>
          ))}
          <text x={PAD.left} y={H - 6} className="fill-ink-4 font-mono text-[11px]">2 min ago</text>
          <text x={PAD.left + inner} y={H - 6} textAnchor="end" className="fill-ink-4 font-mono text-[11px]">now</text>
          {ready && (
            <g clipPath={`url(#${clip})`}>
              <g ref={slide}>
                <path d={paths.area} fill={`url(#${clip}-wash)`} />
                <path d={paths.mem} fill="none" stroke={PULSE_SERIES.mem} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <path d={paths.cpu} fill="none" stroke={PULSE_SERIES.cpu} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {hover && <>
                  <line x1={(hover.t - t0) * scale} x2={(hover.t - t0) * scale} y1={PAD.top} y2={BASE} stroke="var(--line-2)" />
                  <circle cx={(hover.t - t0) * scale} cy={y(hover.mem)} r={4} fill="var(--pop)" stroke={PULSE_SERIES.mem} strokeWidth={2} />
                  <circle cx={(hover.t - t0) * scale} cy={y(hover.cpu)} r={4} fill="var(--pop)" stroke={PULSE_SERIES.cpu} strokeWidth={2} />
                </>}
              </g>
            </g>
          )}
        </svg>
        {!ready && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-10 text-center text-13 font-medium text-ink-3" style={{ marginTop: -PAD.bottom / 2 }}>{empty ?? "reading cpu and memory"}</p>}
      </div>
    </div>
  );
}
