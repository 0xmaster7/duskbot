import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus, X } from "@/icons";
import { Button, cx } from "../ui/kit";
import { Modal } from "../ui/controls";
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
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="date range" className="inline-flex rounded-full bg-card-2 p-1">
        {keys.map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={value.key === key} onClick={() => onChange(rangeOf(key, Date.now(), custom))}
            className={cx("h-8 rounded-full px-3.5 text-13", value.key === key ? "bg-pop text-ink" : "text-ink-3 hover-link")}>{label}</button>
        ))}
      </div>
      {value.key === "custom" && (
        <div className="flex items-center gap-1.5">
          <label htmlFor={fromId} className="sr-only">from</label>
          <input id={fromId} type="date" value={custom.from} max={custom.to} onChange={(e) => { const next = { ...custom, from: e.target.value }; setCustom(next); onChange(rangeOf("custom", Date.now(), next)); }} className="field !h-9 !w-[150px] !px-3 !text-13" />
          <span className="text-13 text-ink-4" aria-hidden>to</span>
          <label htmlFor={toId} className="sr-only">to</label>
          <input id={toId} type="date" value={custom.to} min={custom.from} onChange={(e) => { const next = { ...custom, to: e.target.value }; setCustom(next); onChange(rangeOf("custom", Date.now(), next)); }} className="field !h-9 !w-[150px] !px-3 !text-13" />
        </div>
      )}
    </div>
  );
}

/** the change against the previous window, in words and an arrow, green up and red down (or the reverse for bounce) */
export function Delta({ now, before, invert = false }: { now: number | null; before: number | null; invert?: boolean }) {
  if (now === null || before === null) return <span className="text-12 text-ink-4">no earlier data</span>;
  if (before === 0) return <span className="text-12 text-ink-4">{now === 0 ? "same as before" : "new"}</span>;
  const change = (now - before) / before, up = change > 0, good = invert ? !up : up;
  if (Math.abs(change) < 0.005) return <span className="text-12 text-ink-4">same as before</span>;
  return <span className={cx("text-12 num", good ? "text-good" : "text-bad")}>{up ? "up" : "down"} {Math.round(Math.abs(change) * 100)}%</span>;
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
export interface SeriesData { size: number; starts: number[]; visitors: number[]; signups: number[]; paid: number[]; waitlist: number[] }

const H = 240, PAD = { top: 16, right: 44, bottom: 28, left: 40 };
function niceMax(value: number) { if (value <= 4) return 4; const p = 10 ** Math.floor(Math.log10(value)); const m = value / p; return (m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }

/** visitors as a line on the left axis, signups and payments as bars on the right, notes pinned along the bottom */
export function DualChart({ data, notes, show, onNote }: { data: SeriesData; notes: Note[]; show: { visitors: boolean; signups: boolean; paid: boolean }; onNote(note: Note | { at: number }): void }) {
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
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
  const inner = width - PAD.left - PAD.right, step = inner / Math.max(1, count);
  const vMax = niceMax(Math.max(1, ...data.visitors)), bMax = niceMax(Math.max(1, ...data.signups.map((s, i) => s + data.paid[i]!)));
  const x = (i: number) => PAD.left + step * (i + 0.5);
  const yV = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / vMax);
  const yB = (v: number) => (H - PAD.top - PAD.bottom) * (v / bMax);
  const line = data.visitors.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yV(v).toFixed(1)}`).join("");
  const area = `${line}L${x(count - 1).toFixed(1)},${H - PAD.bottom}L${x(0).toFixed(1)},${H - PAD.bottom}Z`;
  const hourly = data.size < DAY;
  const label = (t: number) => hourly ? new Date(t).toLocaleTimeString("en-US", { hour: "numeric" }).toLowerCase().replace(" ", "") : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
  const ticks = useMemo(() => { const every = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(inner / 90)))); return data.starts.map((_, i) => i % every === 0 ? i : -1).filter(i => i >= 0); }, [count, inner, data.starts]);
  const noteIndex = (at: number) => Math.min(count - 1, Math.max(0, Math.floor((at - data.starts[0]!) / data.size)));
  const visibleNotes = notes.filter(note => count && note.at >= data.starts[0]! && note.at < data.starts[count - 1]! + data.size);
  const at = hover;
  return (
    <div className="relative" ref={box}>
      <svg width="100%" height={H + 18} viewBox={`0 0 ${width} ${H + 18}`} role="img" aria-label={`chart: ${n(data.visitors.reduce((a, b) => a + b, 0))} visitors, ${n(data.signups.reduce((a, b) => a + b, 0))} signups`}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.floor((e.clientX - r.left - PAD.left) / step); setHover(i >= 0 && i < count ? i : null); }} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => <g key={f}>
          <line x1={PAD.left} x2={width - PAD.right} y1={yV(vMax * f)} y2={yV(vMax * f)} stroke="var(--line)" strokeDasharray={f ? "3 4" : undefined} />
          <text x={PAD.left - 8} y={yV(vMax * f) + 4} textAnchor="end" className="fill-ink-4 font-mono text-[11px]">{n(Math.round(vMax * f))}</text>
          {(show.signups || show.paid) && <text x={width - PAD.right + 8} y={yV(vMax * f) + 4} className="fill-ink-4 font-mono text-[11px]">{n(Math.round(bMax * f))}</text>}
        </g>)}
        {data.starts.map((_, i) => {
          const s = show.signups ? data.signups[i]! : 0, p = show.paid ? data.paid[i]! : 0, bw = Math.max(2, Math.min(22, step * 0.5));
          return <g key={i}>
            {s > 0 && <rect x={x(i) - bw / 2} y={H - PAD.bottom - yB(s)} width={bw} height={yB(s)} rx={2} fill="var(--ink)" opacity={hover === null || hover === i ? 0.85 : 0.4} />}
            {p > 0 && <rect x={x(i) - bw / 2} y={H - PAD.bottom - yB(s) - yB(p)} width={bw} height={yB(p)} rx={2} fill="var(--good)" opacity={hover === null || hover === i ? 0.9 : 0.4} />}
          </g>;
        })}
        {show.visitors && <><path d={area} fill="var(--accent)" opacity={0.08} /><path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="draw-in" /></>}
        {at !== null && <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--line-2)" />}
        {at !== null && show.visitors && <circle cx={x(at)} cy={yV(data.visitors[at]!)} r={4} fill="var(--bg)" stroke="var(--accent)" strokeWidth={2} />}
        {ticks.map((i) => <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-ink-4 font-mono text-[11px]">{label(data.starts[i]!)}</text>)}
      </svg>
      <div className="absolute inset-x-0" style={{ top: H - PAD.bottom + 4 }} aria-label="chart notes">
        {visibleNotes.map((note) => (
          <button key={note.id} type="button" onClick={() => onNote(note)} title={note.text} aria-label={`note: ${note.text}. edit`}
            className="group absolute -translate-x-1/2" style={{ left: x(noteIndex(note.at)) }}>
            <span className="block size-[9px] rotate-45 rounded-[2px] bg-warn ring-2 ring-bg" aria-hidden />
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2.5 py-1 text-12 text-primary-ink group-hover:block group-focus-visible:block">{note.text}</span>
          </button>
        ))}
      </div>
      {at !== null && (
        <div className="pointer-events-none absolute z-10 min-w-[150px] rounded-[14px] bg-primary px-3.5 py-2.5 text-13 text-primary-ink" style={{ left: Math.min(x(at) + 12, width - 170), top: 8, boxShadow: "var(--pop-shadow)" }}>
          <div className="font-mono text-12 opacity-70">{hourly ? `${label(data.starts[at]!)}` : new Date(data.starts[at]!).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toLowerCase()}</div>
          {show.visitors && <div className="mt-1 flex justify-between gap-4"><span>visitors</span><span className="font-mono">{n(data.visitors[at]!)}</span></div>}
          {show.signups && <div className="flex justify-between gap-4"><span>signups</span><span className="font-mono">{n(data.signups[at]!)}</span></div>}
          {show.paid && <div className="flex justify-between gap-4"><span>paid</span><span className="font-mono">{n(data.paid[at]!)}</span></div>}
          {data.waitlist[at]! > 0 && <div className="flex justify-between gap-4"><span>waitlist</span><span className="font-mono">{n(data.waitlist[at]!)}</span></div>}
          {visibleNotes.filter((note) => noteIndex(note.at) === at).map((note) => <div key={note.id} className="mt-1.5 border-t border-white/15 pt-1.5 text-12">{note.text}</div>)}
        </div>
      )}
    </div>
  );
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
export function RankCard({ title, tabs, data, label, onPick, active, metric }: { title: string; tabs: Array<{ id: string; label: string }>; data: Record<string, RankRow[]>; label?(tab: string, key: string): ReactNode; onPick?(tab: string, key: string): void; active?: Record<string, string | undefined>; /** a single count instead of visitors and signups */ metric?: string }) {
  const [tab, setTab] = useState(tabs[0]!.id);
  const [all, setAll] = useState(false);
  const rows = data[tab] ?? [];
  const max = Math.max(1, ...rows.map((row) => row.visitors));
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <section className="flex min-w-0 flex-col rounded-[24px] bg-card p-2" aria-label={title}>
      <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <div role="tablist" aria-label={title} className="scroll-x flex gap-0.5">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setAll(false); }}
              className={cx("h-8 shrink-0 rounded-full px-3 text-13", tab === t.id ? "bg-pop font-medium text-ink" : "text-ink-3 hover-link")}>{t.label}</button>
          ))}
        </div>
        <span className="t-meta hidden shrink-0 sm:inline">{metric ?? "visitors · signups"}</span>
      </div>
      <ul className="flex flex-col gap-px rounded-[18px] bg-pop p-1.5" role="tabpanel" aria-label={tabs.find((t) => t.id === tab)?.label}>
        {shown.map((row) => {
          const on = active?.[tab] === row.key;
          const conversion = row.visitors ? Math.round((row.signups / row.visitors) * 1000) / 10 : 0;
          return (
            <li key={row.key}>
              <button type="button" disabled={!onPick} onClick={() => onPick?.(tab, row.key)} aria-pressed={onPick ? on : undefined} title={`${n(row.visitors)} visitors, ${n(row.signups)} signups, ${conversion}% signed up${row.paid ? `, ${n(row.paid)} paid` : ""}`}
                className={cx("relative flex h-9 w-full items-center gap-3 overflow-hidden rounded-[10px] px-2.5 text-start text-13 disabled:cursor-default", on ? "ring-2 ring-accent" : onPick && "hover-ghost")}>
                <span className="absolute inset-y-0 left-0 rounded-[10px] bg-accent/10" style={{ width: `${(row.visitors / max) * 100}%` }} aria-hidden />
                {row.signups > 0 && <span className="absolute inset-y-0 left-0 rounded-[10px] bg-accent/25" style={{ width: `${(Math.min(row.signups, row.visitors) / max) * 100}%` }} aria-hidden />}
                <span className="relative min-w-0 flex-1 truncate text-ink">{label ? label(tab, row.key) : row.key}</span>
                <span className="relative w-12 text-end font-mono text-ink num">{n(row.visitors)}</span>
                {!metric && <span className={cx("relative w-10 text-end font-mono num", row.signups ? "text-accent-ink" : "text-ink-4")}>{n(row.signups)}</span>}
              </button>
            </li>
          );
        })}
        {!rows.length && <li className="px-2.5 py-6 text-center text-13 text-ink-3">nothing in this window yet.</li>}
      </ul>
      {rows.length > 8 && <button type="button" onClick={() => setAll((v) => !v)} className="hover-link mx-auto mt-1.5 h-8 px-3 text-12 text-ink-3">{all ? "show fewer" : `show all ${rows.length}`}</button>}
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
