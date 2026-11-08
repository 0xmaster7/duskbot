import { useId } from "react";

/** a quiet live line over the recent samples */
export function Spark({ values, max, className, height = 40 }: { values: number[]; max?: number; className?: string; height?: number }) {
  const id = useId();
  const w = 200;
  if (values.length < 2) return <div className={className} style={{ height }} aria-hidden />;
  const top = Math.max(max ?? 0, ...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 2 - (Math.max(0, v) / top) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={className} style={{ height, width: "100%" }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--ink)" stopOpacity="0.12" />
          <stop offset="1" stopColor="var(--ink)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${w},${height}L0,${height}Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--ink-2)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
