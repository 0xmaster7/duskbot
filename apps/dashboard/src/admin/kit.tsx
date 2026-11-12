import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Maximize, Plus, X } from "@/icons";
import { Link } from "../lib/router";
import { Button, cx } from "../ui/kit";
import { Modal } from "../ui/controls";
import { AnimatePresence, m, Pill, usePill, useReducedMotion } from "../ui/motion";
import { Mascot } from "../ui/Mascot";
import { avatarOf, friendlyName } from "./names";
import { countryName } from "./geo";
import { n } from "./ui";

export type RangeKey = "today" | "7d" | "30d" | "90d" | "custom";
export interface Range { key: RangeKey; from: number; to: number }
const DAY = 86_400_000;
const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export function rangeOf(key: RangeKey, now = Date.now(), custom?: { from: string; to: string }): Range {
  if (key === "custom" && custom) {
    const from = new Date(`${custom.from}T00:00:00`).getTime(), to = new Date(`${custom.to}T00:00:00`).getTime() + DAY;
    if (Number.isFinite(from) && Number.isFinite(to) && from < to) return { key, from, to: Math.min(to, now) };
  }
  const days = key === "7d" ? 7 : key === "30d" ? 30 : key === "90d" ? 90 : 1;
  return { key: key === "custom" ? "30d" : key, from: midnight(now) - (days - 1) * DAY, to: now };
}
const isoDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** today, 7, 30, 90 days, or two dates; changes apply at once */
export function RangePicker({ value, onChange }: { value: Range; onChange(range: Range): void }) {
  const [custom, setCustom] = useState({ from: isoDay(value.from), to: isoDay(value.to - 1) });
  const fromId = useId(), toId = useId();
  const keys: Array<[RangeKey, string]> = [["today", "today"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["custom", "custom"]];
  const pill = usePill();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="date range" className="scroll-x inline-flex max-w-full rounded-full bg-card-2 p-1">
        {keys.map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={value.key === key} onClick={() => onChange(rangeOf(key, Date.now(), custom))}
            className={cx("relative h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-13", value.key === key ? "text-ink" : "text-ink-3 hover-link")}>{value.key === key && <Pill id={pill} />}<span className="relative">{label}</span></button>
        ))}
      </div>
      <AnimatePresence initial={false}>
      {value.key === "custom" && (
        <m.div key="custom" className="flex items-center gap-1.5" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6, transition: { duration: 0.12 } }}>
          <label htmlFor={fromId} className="sr-only">from</label>
          <input id={fromId} type="date" value={custom.from} max={custom.to} onChange={(e) => { const next = { ...custom, from: e.target.value }; setCustom(next); onChange(rangeOf("custom", Date.now(), next)); }} className="field !h-9 !w-[150px] !px-3 !text-13" />
          <span className="text-13 text-ink-4" aria-hidden>to</span>
          <label htmlFor={toId} className="sr-only">to</label>
          <input id={toId} type="date" value={custom.to} min={custom.from} onChange={(e) => { const next = { ...custom, to: e.target.value }; setCustom(next); onChange(rangeOf("custom", Date.now(), next)); }} className="field !h-9 !w-[150px] !px-3 !text-13" />
        </m.div>
      )}
      </AnimatePresence>
    </div>
  );
}

/** the change against the previous window, in words and an arrow, green up and red down (or the reverse for bounce) */
export function Delta({ now, before, invert = false }: { now: number | null; before: number | null; invert?: boolean }) {
  if (now === null || before === null) return <span className="text-12 text-ink-4">no earlier data</span>;
  if (before === 0) return <span className="text-12 text-ink-4">{now === 0 ? "same as before" : "new"}</span>;
  const change = (now - before) / before, up = change > 0, good = invert ? !up : up;
  if (Math.abs(change) < 0.005) return <span className="text-12 text-ink-4">same as before</span>;
  const size = Math.round(Math.abs(change) * 100);
  return <span className={cx("font-mono text-12 num", good ? "text-good" : "text-bad")} aria-label={`${up ? "up" : "down"} ${size}% on the window before`}>{size > 999 ? "999+" : size}% {up ? "↑" : "↓"}</span>;
}

export const percent = (value: number | null) => value === null ? "-" : `${Math.round(value * 1000) / 10}%`;
export function duration(ms: number | null) {
  if (ms === null) return "-";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.round(h / 24)} days`;
}

/** a visitor's stable mascot and colour, from the hash of their id */
export function Avatar({ seed, size = 32, customer }: { seed: string; size?: number; customer?: boolean }) {
  const { body, ink } = avatarOf(seed);
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-full bg-card", customer && "ring-2 ring-accent ring-offset-2 ring-offset-bg")} style={{ width: size + 8, height: size + 8 }} aria-hidden>
      <Mascot body={body} color={ink} size={size} still />
    </span>
  );
}
export const personName = (seed: string, email?: string | null) => email ?? friendlyName(seed);

export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-6 items-center rounded-full bg-card px-2.5 text-12 text-ink-2">{children}</span>;
}
export const where = (country: string | null | undefined, city?: string | null) => country ? `${city ? `${city}, ` : ""}${countryName(country)}` : "unknown place";

export interface Note { id: string; at: number; text: string; by: string; createdAt: number }
export interface SeriesData { size: number; starts: number[]; visitors: number[]; signups: number[]; paid: number[]; waitlist: number[]; /** cents per bucket */ revenue?: { new: number[]; renewal: number[]; refund: number[] } }

/** dollars from cents: whole dollars when even, one decimal in thousands past $10k */
export function usd(cents: number, compact = false) {
  const sign = cents < 0 ? "-" : "", v = Math.abs(cents) / 100;
  if (compact && v >= 10_000) return `${sign}$${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  return `${sign}$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

const TOP = 200, GAP = 26, LOW = 84, PAD = { top: 22, right: 14, bottom: 28, left: 52 };
function niceMax(value: number) { if (value <= 4) return 4; const p = 10 ** Math.floor(Math.log10(value)); const m = value / p; return ([1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => m <= step) ?? 10) * p; }
/** a smooth line through the points (Catmull-Rom as cubic Béziers), clamped so it never dips below the axis; the same
 * number of points always gives the same commands, so one line can morph into the next */
function smooth(points: Array<[number, number]>, floor: number) {
  if (points.length < 3) return points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  let d = `M${points[0]![0].toFixed(1)},${points[0]![1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!, p1 = points[i]!, p2 = points[i + 1]!, p3 = points[i + 2] ?? p2;
    const c1y = Math.min(floor, p1[1] + (p2[1] - p0[1]) / 6), c2y = Math.min(floor, p2[1] - (p3[1] - p1[1]) / 6);
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${c1y.toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
/** a bar with its data end rounded and its baseline end square; a zero bar keeps the same commands, flat on the baseline */
function bar(x: number, y0: number, y1: number, w: number) {
  const up = y1 <= y0, h = Math.abs(y1 - y0), r = Math.min(3, h, w / 2), f = (v: number) => v.toFixed(1);
  return up ? `M${f(x)},${f(y0)}V${f(y1 + r)}Q${f(x)},${f(y1)} ${f(x + r)},${f(y1)}H${f(x + w - r)}Q${f(x + w)},${f(y1)} ${f(x + w)},${f(y1 + r)}V${f(y0)}Z`
    : `M${f(x)},${f(y0)}V${f(y1 - r)}Q${f(x)},${f(y1)} ${f(x + r)},${f(y1)}H${f(x + w - r)}Q${f(x + w)},${f(y1)} ${f(x + w)},${f(y1 - r)}V${f(y0)}Z`;
}

/** a mark that grows out of its flat self on mount and morphs to each new shape after */
function Morph({ d, flat, fill, delay = 0, reduced, ...rest }: { d: string; flat: string; fill: string; delay?: number; reduced: boolean } & React.SVGProps<SVGPathElement>) {
  return <m.path {...(rest as object)} fill={fill} initial={{ d: reduced ? d : flat }} animate={{ d }} transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: 0.36, bounce: 0, delay }} />;
}

export interface Mark { at: number; kind: "signup" | "paid"; seed: string; email: string | null; customer?: boolean }
/** sales first: money per day as bars (new and renewals stacked up, refunds down) with the new customers each day above
 * them; visitors run light in a band underneath, and the whole thing morphs when the window or a filter changes */
export function SalesChart({ data, notes, visitors, onNote, empty }: { data: SeriesData; notes: Note[]; visitors: boolean; onNote(note: Note | { at: number }): void; /** shown over an empty money panel */ empty?: string | null }) {
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const gradient = useId().replace(/:/g, "");
  const reduced = useReducedMotion() ?? false;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const count = data.starts.length;
  const money = data.revenue ?? { new: data.starts.map(() => 0), renewal: data.starts.map(() => 0), refund: data.starts.map(() => 0) };
  const H = PAD.top + TOP + (visitors ? GAP + LOW : 0) + PAD.bottom;
  const inner = width - PAD.left - PAD.right, step = inner / Math.max(1, count);
  const x = (i: number) => PAD.left + step * (i + 0.5);
  const up = money.new.map((v, i) => v + money.renewal[i]!), down = money.refund.map((v) => -v);
  const rUp = niceMax(Math.max(1, ...up) / 100) * 100, rDown = Math.max(...down) > 0 ? niceMax(Math.max(...down) / 100) * 100 : 0;
  const zero = PAD.top + TOP * (rUp / (rUp + rDown));
  const yR = (cents: number) => zero - (cents / (rUp + rDown)) * TOP;
  const lowTop = PAD.top + TOP + GAP, lowBase = lowTop + LOW;
  const vMax = niceMax(Math.max(1, ...data.visitors));
  const yV = (v: number) => lowTop + LOW * (1 - v / vMax);
  const line = smooth(data.visitors.map((v, i) => [x(i), yV(v)]), lowBase);
  const flatLine = smooth(data.visitors.map((_, i) => [x(i), lowBase]), lowBase);
  const area = (path: string) => `${path}L${x(count - 1).toFixed(1)},${lowBase}L${x(0).toFixed(1)},${lowBase}Z`;
  const hourly = data.size < DAY;
  const label = (t: number) => hourly ? new Date(t).toLocaleTimeString("en-US", { hour: "numeric" }).toLowerCase().replace(" ", "") : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
  const long = (t: number) => hourly ? label(t) : new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toLowerCase();
  const ticks = useMemo(() => { const every = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(inner / 90)))); return data.starts.map((_, i) => i % every === 0 ? i : -1).filter(i => i >= 0); }, [count, inner, data.starts]);
  const noteIndex = (at: number) => Math.min(count - 1, Math.max(0, Math.floor((at - data.starts[0]!) / data.size)));
  const visibleNotes = notes.filter(note => count && note.at >= data.starts[0]! && note.at < data.starts[count - 1]! + data.size);
  const net = (i: number) => up[i]! + money.refund[i]!;
  const totals = { revenue: up.reduce((a, b) => a + b, 0) + money.refund.reduce((a, b) => a + b, 0), paid: data.paid.reduce((a, b) => a + b, 0), visitors: data.visitors.reduce((a, b) => a + b, 0) };
  const bw = Math.max(2, Math.min(20, step * 0.58));
  const stagger = (i: number) => reduced ? 0 : Math.min(0.18, (i / Math.max(1, count)) * 0.18);
  const at = hover;
  const shape = `${count}-${data.size}`;
  return (
    <div className="relative" ref={box}>
      <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={`chart: ${usd(totals.revenue)} in sales, ${n(totals.paid)} new customers${visitors ? `, ${n(totals.visitors)} visitors` : ""}`}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.floor((e.clientX - r.left - PAD.left) / step); setHover(i >= 0 && i < count ? i : null); }} onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--viz-visitors)" stopOpacity={0.14} /><stop offset="100%" stopColor="var(--viz-visitors-wash)" stopOpacity={0.3} /></linearGradient></defs>
        {[0.5, 1].map((f) => <g key={f}>
          <line x1={PAD.left} x2={width - PAD.right} y1={yR(rUp * f)} y2={yR(rUp * f)} stroke="var(--line)" strokeDasharray="3 4" />
          <text x={PAD.left - 8} y={yR(rUp * f) + 4} textAnchor="end" className="fill-ink-4 font-mono text-[11px]">{usd(Math.round(rUp * f), true)}</text>
        </g>)}
        <line x1={PAD.left} x2={width - PAD.right} y1={zero} y2={zero} stroke="var(--line-2)" />
        <text x={PAD.left - 8} y={zero + 4} textAnchor="end" className="fill-ink-4 font-mono text-[11px]">$0</text>
        {rDown > 0 && <text x={PAD.left - 8} y={yR(-rDown) + 4} textAnchor="end" className="fill-ink-4 font-mono text-[11px]">{usd(-rDown, true)}</text>}
        <g key={shape}>
          {data.starts.map((_, i) => {
            const fade = hover === null || hover === i ? 1 : 0.4, left = x(i) - bw / 2, mid = yR(money.new[i]!), gap = money.new[i]! > 0 && money.renewal[i]! > 0 ? 2 : 0;
            return <g key={i} opacity={fade}>
              <Morph d={bar(left, zero, mid, bw)} flat={bar(left, zero, zero, bw)} fill="var(--viz-new)" delay={stagger(i)} reduced={reduced} />
              <Morph d={bar(left, mid - gap, Math.min(mid - gap, yR(up[i]!) - gap), bw)} flat={bar(left, zero, zero, bw)} fill="var(--viz-renewal)" delay={stagger(i)} reduced={reduced} />
              {rDown > 0 && <Morph d={bar(left, zero + 1, Math.max(zero + 1, yR(money.refund[i]!)), bw)} flat={bar(left, zero + 1, zero + 1, bw)} fill="var(--viz-refund)" delay={stagger(i)} reduced={reduced} />}
            </g>;
          })}
          {data.paid.map((paid, i) => paid > 0 && (
            <m.g key={`p${i}`} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: hover === null || hover === i ? 1 : 0.4, y: 0 }} transition={{ duration: 0.24, delay: reduced ? 0 : 0.2 + stagger(i) }}>
              {step >= 16
                ? <><rect x={x(i) - 9} y={yR(up[i]!) - 21} width={18} height={15} rx={7.5} fill="var(--coral-soft)" /><text x={x(i)} y={yR(up[i]!) - 10} textAnchor="middle" className="fill-coral-deep font-mono text-[10.5px] font-medium">{paid}</text></>
                : <circle cx={x(i)} cy={yR(up[i]!) - 8} r={3} fill="var(--coral)" />}
            </m.g>
          ))}
        </g>
        {visitors && <g key={`v${shape}`}>
          <line x1={PAD.left} x2={width - PAD.right} y1={lowBase} y2={lowBase} stroke="var(--line)" />
          <text x={PAD.left - 8} y={lowTop + 4} textAnchor="end" className="fill-ink-4 font-mono text-[11px]">{n(vMax)}</text>
          <Morph d={area(line)} flat={area(flatLine)} fill={`url(#${gradient})`} reduced={reduced} />
          <m.path fill="none" stroke="var(--viz-visitors)" strokeOpacity={0.7} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round"
            initial={reduced ? { d: line } : { d: line, pathLength: 0 }} animate={{ d: line, pathLength: 1 }} transition={reduced ? { duration: 0 } : { d: { type: "spring", visualDuration: 0.36, bounce: 0 }, pathLength: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } }} />
        </g>}
        {at !== null && <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={visitors ? lowBase : PAD.top + TOP} stroke="var(--line-2)" />}
        {at !== null && visitors && <circle cx={x(at)} cy={yV(data.visitors[at]!)} r={4} fill="var(--bg)" stroke="var(--viz-visitors)" strokeWidth={1.75} />}
        {ticks.map((i) => <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-ink-4 font-mono text-[11px]">{label(data.starts[i]!)}</text>)}
      </svg>
      {empty && totals.revenue === 0 && <p className="pointer-events-none absolute inset-x-0 text-center text-13 text-ink-3" style={{ top: PAD.top + TOP / 2 - 10 }}>{empty}</p>}
      <div className="absolute inset-x-0" style={{ top: zero - 12 }} aria-label="chart notes">
        {visibleNotes.map((note) => (
          <button key={note.id} type="button" onClick={() => onNote(note)} title={note.text} aria-label={`note: ${note.text}. edit`}
            className="group absolute grid size-6 -translate-x-1/2 place-items-center" style={{ left: x(noteIndex(note.at)) }}>
            <span className="block size-[9px] rotate-45 rounded-[2px] bg-warn ring-2 ring-bg" aria-hidden />
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-pop px-2.5 py-1 text-12 text-ink group-hover:block group-focus-visible:block" style={{ boxShadow: "var(--pop-shadow)" }}>{note.text}</span>
          </button>
        ))}
      </div>
      <AnimatePresence>
        {at !== null && (
          <m.div key="tip" className="pointer-events-none absolute z-10 min-w-[184px] rounded-[16px] bg-pop px-3.5 py-2.5 text-13 text-ink" style={{ top: 8, left: 0, boxShadow: "var(--pop-shadow)" }}
            initial={{ opacity: 0, x: Math.min(x(at) + 14, width - 204) }} animate={{ opacity: 1, x: Math.min(x(at) + 14, width - 204) }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ x: { type: "spring", visualDuration: 0.18, bounce: 0 }, opacity: { duration: 0.12 } }}>
            <div className="font-mono text-12 text-ink-3">{long(data.starts[at]!)}</div>
            <Row label="sales" value={usd(net(at))} strong />
            {money.new[at]! > 0 && <Row dot="var(--viz-new)" label="new" value={usd(money.new[at]!)} />}
            {money.renewal[at]! > 0 && <Row dot="var(--viz-renewal)" label="renewals" value={usd(money.renewal[at]!)} />}
            {money.refund[at]! < 0 && <Row dot="var(--viz-refund)" label="refunds" value={usd(money.refund[at]!)} />}
            <Row dot="var(--coral)" label="new customers" value={n(data.paid[at]!)} />
            <div className="mt-1.5 border-t border-line pt-1.5">
              {visitors && <Row dot="var(--viz-visitors)" label="visitors" value={n(data.visitors[at]!)} />}
              <Row label="signups" value={n(data.signups[at]!)} />
              {data.waitlist[at]! > 0 && <Row label="waitlist" value={n(data.waitlist[at]!)} />}
            </div>
            {visibleNotes.filter((note) => noteIndex(note.at) === at).map((note) => <div key={note.id} className="mt-1.5 border-t border-line pt-1.5 text-12 text-ink-2">{note.text}</div>)}
          </m.div>
        )}
      </AnimatePresence>
      <table className="sr-only">
        <caption>sales and visitors per {hourly ? "hour" : "day"}</caption>
        <thead><tr><th scope="col">{hourly ? "hour" : "day"}</th><th scope="col">sales</th><th scope="col">new customers</th><th scope="col">visitors</th><th scope="col">signups</th></tr></thead>
        <tbody>{data.starts.map((t, i) => <tr key={t}><th scope="row">{long(t)}</th><td>{usd(net(i))}</td><td>{data.paid[i]}</td><td>{data.visitors[i]}</td><td>{data.signups[i]}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
function Row({ label, value, dot, strong }: { label: string; value: string; dot?: string; strong?: boolean }) {
  return <div className="mt-0.5 flex items-center justify-between gap-4"><span className="inline-flex items-center gap-1.5 text-ink-2">{dot && <span className="size-2 rounded-[2px]" style={{ background: dot }} aria-hidden />}{label}</span><span className={cx("font-mono num", strong && "font-medium")}>{value}</span></div>;
}

/** add or edit a chart note; deleting is here too */
export function NoteDialog({ note, onClose, onSave, onDelete }: { note: Note | { at: number } | null; onClose(): void; onSave(input: { at: number; text: string }): Promise<void>; onDelete(id: string): Promise<void> }) {
  const editing = note && "id" in note ? note : null;
  const [text, setText] = useState(editing?.text ?? "");
  const [day, setDay] = useState(note ? isoDay(note.at) : isoDay(Date.now()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const textId = useId(), dayId = useId();
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); onClose(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  return (
    <Modal open={note !== null} onClose={onClose} title={editing ? "edit note" : "add a note to the chart"}
      footer={<>
        {editing && <Button variant="danger" disabled={busy} onClick={() => void run(() => onDelete(editing.id))} className="me-auto">delete</Button>}
        <Button variant="ghost" onClick={onClose} disabled={busy}>cancel</Button>
        <Button variant="primary" disabled={busy || !text.trim() || text.length > 140} onClick={() => void run(() => onSave({ at: new Date(`${day}T12:00:00`).getTime(), text: text.trim() }))}>{editing ? "save" : "add note"}</Button>
      </>}>
      <p>a short line, like "launch thread on x" or "pricing page v2".</p>
      <label htmlFor={textId} className="mt-4 block text-13 text-ink-2">note</label>
      <input id={textId} value={text} maxLength={140} onChange={(e) => setText(e.target.value)} className="field mt-1.5" aria-invalid={error ? true : undefined} />
      <label htmlFor={dayId} className="mt-3 block text-13 text-ink-2">day</label>
      <input id={dayId} type="date" value={day} onChange={(e) => setDay(e.target.value)} className="field mt-1.5" />
      {error && <p role="alert" className="mt-2 text-13 text-bad">{error}</p>}
    </Modal>
  );
}

export interface RankRow { key: string; visitors: number; signups: number; paid: number }
/** a tabbed ranked card: visitors as a light bar, the signups they became as a darker bar on top; a row filters the page */
export function RankCard({ title, tabs, data, label, onPick, active, metric, details, panels, rows: limit = 8, money }: { title: string; tabs: Array<{ id: string; label: string; icon?: ReactNode }>; data: Record<string, RankRow[]>; label?(tab: string, key: string): ReactNode; onPick?(tab: string, key: string): void; active?: Record<string, string | undefined>; /** a single count instead of visitors and signups */ metric?: string;
  /** the full-page view of a tab, when it has one */ details?(tab: string): string | null; /** a tab drawn its own way, like a map */ panels?: Record<string, ReactNode>; rows?: number;
  /** revenue in cents per tab and row key, credited to where each payer came from */ money?: Record<string, Record<string, number>> }) {
  const [tab, setTab] = useState(tabs[0]!.id);
  const [all, setAll] = useState(false);
  const [byMoney, setByMoney] = useState(false);
  const tabPill = usePill(), sortPill = usePill();
  const cents = money?.[tab] ?? {};
  const earned = Object.values(cents).some((v) => v !== 0);
  const listed = data[tab] ?? [];
  const extra = Object.keys(cents).filter((key) => !listed.some((row) => row.key === key)).map((key) => ({ key, visitors: 0, signups: 0, paid: 0 }));
  const rows = byMoney && earned ? [...listed, ...extra].sort((a, b) => (cents[b.key] ?? 0) - (cents[a.key] ?? 0) || b.visitors - a.visitors) : [...listed, ...extra];
  const max = Math.max(1, ...rows.map((row) => row.visitors));
  const moneyMax = Math.max(1, ...Object.values(cents));
  const shown = all ? rows : rows.slice(0, limit);
  const more = details?.(tab);
  return (
    <section className="flex min-w-0 flex-col rounded-[24px] bg-card p-2" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <div role="tablist" aria-label={title} className="scroll-x flex max-w-full gap-0.5">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setAll(false); }}
              className={cx("relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-13", tab === t.id ? "font-medium text-ink" : "text-ink-3 hover-link")}>{tab === t.id && <Pill id={tabPill} />}{t.icon && <span aria-hidden className="relative opacity-70">{t.icon}</span>}<span className="relative">{t.label}</span></button>
          ))}
        </div>
        {money ? (
          <div role="radiogroup" aria-label="sort rows by" className="inline-flex shrink-0 rounded-full bg-card-2 p-0.5">
            {([[false, "visitors"], [true, "revenue"]] as const).map(([value, text]) => (
              <button key={text} type="button" role="radio" aria-checked={byMoney === value} onClick={() => setByMoney(value)}
                className={cx("relative h-7 rounded-full px-2.5 text-12", byMoney === value ? "font-medium text-ink" : "text-ink-3 hover-link")}>{byMoney === value && <Pill id={sortPill} />}<span className="relative">{text}</span></button>
            ))}
          </div>
        ) : <span className="t-meta hidden shrink-0 sm:inline">{metric ?? "visitors · signups"}</span>}
      </div>
      {panels?.[tab] ? <div role="tabpanel" aria-label={tabs.find((t) => t.id === tab)?.label} className="flex-1 rounded-[18px] bg-pop p-1.5">{panels[tab]}</div> : <ul className="flex flex-1 flex-col gap-px rounded-[18px] bg-pop p-1.5" role="tabpanel" aria-label={tabs.find((t) => t.id === tab)?.label}>
        <AnimatePresence initial={false} mode="popLayout">
        {shown.map((row) => {
          const on = active?.[tab] === row.key;
          const conversion = row.visitors ? Math.round((row.signups / row.visitors) * 1000) / 10 : 0;
          const got = cents[row.key] ?? 0;
          const bar = byMoney && earned ? (Math.max(0, got) / moneyMax) * 100 : (row.visitors / max) * 100, coral = !byMoney && row.signups ? Math.max(bar * 0.06, Math.min(bar, bar * (row.signups / Math.max(1, row.visitors)) * 6)) : 0;
          return (
            <m.li key={`${tab}:${row.key}`} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ layout: { type: "spring", visualDuration: 0.28, bounce: 0 }, opacity: { duration: 0.18 } }}>
              <button type="button" disabled={!onPick} onClick={() => onPick?.(tab, row.key)} aria-pressed={onPick ? on : undefined} title={`${n(row.visitors)} visitors, ${n(row.signups)} signups, ${conversion}% signed up${row.paid ? `, ${n(row.paid)} paid` : ""}${got ? `, ${usd(got)} revenue` : ""}`}
                className={cx("relative flex h-9 w-full items-center gap-3 overflow-hidden rounded-[10px] px-2.5 text-start text-13 disabled:cursor-default", on ? "ring-2 ring-accent" : onPick && "hover-ghost")}>
                <m.span className={cx("absolute inset-0", byMoney && earned ? "bg-wash-lime" : "bg-wash-sky")} initial={{ clipPath: "inset(0% 100% 0% 0% round 10px)" }} animate={{ clipPath: `inset(0% ${(100 - bar).toFixed(2)}% 0% 0% round 10px)` }} transition={{ type: "spring", visualDuration: 0.4, bounce: 0 }} aria-hidden />
                {row.signups > 0 && <m.span className="absolute inset-0 bg-wash-pink" initial={{ clipPath: "inset(0% 100% 0% 0% round 0px 10px 10px 0px)" }} animate={{ clipPath: `inset(0% ${(100 - bar).toFixed(2)}% 0% ${(bar - coral).toFixed(2)}% round 0px 10px 10px 0px)` }} transition={{ type: "spring", visualDuration: 0.4, bounce: 0 }} aria-hidden />}
                <span className="relative min-w-0 flex-1 truncate text-ink">{label ? label(tab, row.key) : row.key}</span>
                <span className="relative w-12 text-end font-mono text-ink num">{n(row.visitors)}</span>
                {!metric && <span className={cx("relative w-10 text-end font-mono num", row.signups ? "text-coral-deep" : "text-ink-4")}>{n(row.signups)}</span>}
                {money && <span className={cx("relative w-16 text-end font-mono num", got > 0 ? "font-medium text-money" : got < 0 ? "text-bad" : "text-ink-4")}>{got ? usd(got, true) : "-"}</span>}
              </button>
            </m.li>
          );
        })}
        </AnimatePresence>
        {!rows.length && <li className="px-2.5 py-6 text-center text-13 text-ink-3">nothing in this window yet.</li>}
      </ul>}
      {more && !panels?.[tab] ? <Link to={more} className="hover-link mx-auto mt-1.5 inline-flex h-8 items-center gap-1.5 px-3 font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-3"><Maximize size={13} strokeWidth={1.75} aria-hidden /> details</Link>
        : !panels?.[tab] && rows.length > limit && <button type="button" onClick={() => setAll((v) => !v)} className="hover-link mx-auto mt-1.5 h-8 px-3 text-12 text-ink-3">{all ? "show fewer" : `show all ${rows.length}`}</button>}
    </section>
  );
}

export function FilterChips({ filters, onRemove, label }: { filters: Record<string, string | undefined>; onRemove(dim: string): void; label?(dim: string, value: string): string }) {
  const list = Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (!list.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="filters">
      <span className="t-meta">filtered by</span>
      {list.map(([dim, value]) => (
        <span key={dim} className="inline-flex h-8 items-center gap-1 rounded-full bg-sky ps-3 pe-1 text-13 text-ink">
          {dim}: {label ? label(dim, value) : value}
          <button type="button" onClick={() => onRemove(dim)} aria-label={`remove the ${dim} filter`} className="grid size-6 place-items-center rounded-full hover-ghost"><X size={13} strokeWidth={2} /></button>
        </span>
      ))}
    </div>
  );
}
export { Plus };
