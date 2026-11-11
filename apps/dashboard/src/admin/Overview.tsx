import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, Clock, CreditCard, File, Globe as GlobeIcon, Link2, MapPin, Monitor, MousePointerClick, RotateCcw, Search, Sparkles, Tag, Target, UserPlus, Users } from "@/icons";
import skyBand from "../art/scene-sky-band.webp";
import meadowBand from "../art/scene-meadow-band.webp";
import { Button, cx } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { SkyEmpty } from "../ui/Sky";
import { ago } from "../lib/format";
import { Link } from "../lib/router";
import { useNow } from "../lib/now";
import { adminCall, useAdmin } from "./api";
import { avatarOf } from "./names";
import { centroid, countryName } from "./geo";
import { Avatar, Chip, Delta, DualChart, FilterChips, NoteDialog, RangePicker, RankCard, duration, percent, personName, rangeOf, type Mark, type Note, type Range, type RankRow, type SeriesData } from "./kit";
import { Failed, Loading, n } from "./ui";

const Globe = lazy(() => import("./globe/Globe"));

interface Kpis { visitors: number; visits: number; pageviews: number; signups: number; paid: number; waitlist: number; conversion: number | null; bounce: number | null; visitMs: number | null }
export type Surface = "all" | "site" | "account" | "desktop" | "phone";
export interface WebAnswer {
  from: number; to: number; now: number; filters: Record<string, string>; current: Kpis; previous: Kpis; online: { site: number; app: number };
  series: SeriesData; cards: Record<string, RankRow[]>; notes: Note[]; tracked: boolean; marks?: Mark[];
  surfaces?: { site: number; account: number; desktop: number; phone: number };
  crawlers: { total: number; bot: RankRow[]; page: RankRow[]; kind: RankRow[] };
}
interface Person {
  id: string; seed: string; account: { id: string; email: string; name: string | null } | null; customer: boolean; signedUpAt: number | null; paidAt: number | null;
  firstSeen: number | null; lastSeen: number | null; timeToSignupMs: number | null; visits: number; pageviews: number; source: string; channel: string; campaign: string | null;
  device: string | null; os: string | null; browser: string | null; country: string | null; city: string | null; lastPage: string | null;
}
interface FunnelAnswer { steps: Array<{ id: string; label: string; count: number }> }

export const CHANNEL: Record<string, string> = { direct: "direct", search: "search", social: "social", ai: "ai assistants", referral: "referrals", email: "email", paid: "paid ads", unknown: "unknown" };
export const SURFACES: Array<{ value: Surface; label: string }> = [{ value: "all", label: "all" }, { value: "site", label: "dusk.bot" }, { value: "account", label: "account page" }, { value: "desktop", label: "desktop app" }, { value: "phone", label: "phone app" }];
export const dimLabel = (tab: string, key: string) => tab === "channel" ? CHANNEL[key] ?? key : tab === "country" ? countryName(key) : tab === "surface" ? SURFACES.find((s) => s.value === key)?.label ?? key : key === "unknown" ? "unknown" : key;
const AI_KIND: Record<string, string> = { answers: "ai answers", indexing: "indexing", training: "training" };

export function webQuery(range: Range, surface: Surface, filters: Record<string, string | undefined>) {
  const params = new URLSearchParams({ from: String(range.from), to: String(range.to), surface });
  for (const [dim, value] of Object.entries(filters)) if (value !== undefined) params.set(`f.${dim}`, value);
  return params.toString();
}

/** the page's state, kept in the address so a details view and a reload land on the same window, site and filters */
function useSelection() {
  const read = () => new URLSearchParams(location.search);
  const [state, setState] = useState(() => {
    const q = read(), key = (q.get("range") ?? "30d") as Range["key"];
    const filters: Record<string, string | undefined> = {};
    for (const [k, v] of q) if (k.startsWith("f.")) filters[k.slice(2)] = v;
    return { range: rangeOf(["today", "7d", "30d", "90d"].includes(key) ? key : "30d"), surface: (q.get("site") ?? "all") as Surface, filters };
  });
  useEffect(() => {
    const q = new URLSearchParams();
    if (state.range.key !== "30d") q.set("range", state.range.key);
    if (state.surface !== "all") q.set("site", state.surface);
    for (const [k, v] of Object.entries(state.filters)) if (v !== undefined) q.set(`f.${k}`, v);
    const next = `${location.pathname}${q.size ? `?${q}` : ""}`;
    if (next !== `${location.pathname}${location.search}`) history.replaceState(history.state, "", next);
  }, [state]);
  return [state, setState] as const;
}

function SitePicker({ value, onChange, counts }: { value: Surface; onChange(v: Surface): void; counts?: WebAnswer["surfaces"] }) {
  return (
    <div role="radiogroup" aria-label="which surface" className="scroll-x inline-flex max-w-full rounded-full bg-card-2 p-1">
      {SURFACES.map((s) => {
        const count = s.value === "all" || !counts ? null : counts[s.value];
        return (
          <button key={s.value} type="button" role="radio" aria-checked={value === s.value} onClick={() => onChange(s.value)}
            className={cx("h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-13", value === s.value ? "bg-pop font-medium text-ink" : "text-ink-3 hover-link")}>
            {s.label}{count !== null && <span className="ms-1.5 font-mono text-[11px] text-ink-4">{n(count)}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** kit's mood from the numbers: napping when nobody is around, cheering on a record day or more signups */
export function moodOf(data: WebAnswer | null): { state: "sleeping" | "excited" | "happy" | "idle"; line: string } {
  if (!data) return { state: "idle", line: "" };
  const online = data.online.site + data.online.app, days = data.series.visitors, last = days.at(-1) ?? 0;
  if (last > 0 && days.length > 2 && last >= Math.max(...days)) return { state: "excited", line: "busiest stretch of this window. nice." };
  if (data.current.signups > data.previous.signups) return { state: "happy", line: `${n(data.current.signups - data.previous.signups)} more signups than the window before.` };
  if (online === 0) return { state: "sleeping", line: "quiet right now. kit is napping." };
  return { state: "idle", line: `${n(online)} here right now.` };
}

/** a slim pixel sky with kit on the meadow, and the window in one sentence */
function Band({ data, range }: { data: WebAnswer | null; range: Range }) {
  const span = range.key === "today" ? "today" : range.key === "7d" ? "in the last 7 days" : range.key === "90d" ? "in the last 90 days" : range.key === "custom" ? "in this window" : "in the last 30 days";
  const mood = moodOf(data);
  return (
    <div className="relative mb-5 overflow-hidden rounded-[24px] bg-sky" style={{ backgroundImage: `url(${skyBand})`, backgroundSize: "cover", imageRendering: "pixelated" }}>
      <div className="absolute inset-0 bg-gradient-to-r from-white/55 via-white/25 to-transparent" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-5" style={{ backgroundImage: `url(${meadowBand})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x", imageRendering: "pixelated" }} aria-hidden />
      <div className="relative flex min-h-[104px] items-center justify-between gap-4 px-6 pb-7 pt-5 max-sm:px-4">
        <div className="min-w-0 text-[#14243a]">
          <p className="text-[22px] leading-[1.3] tracking-[-0.03em] max-sm:text-[17px]">
            {data ? <>you got <b className="font-mono font-medium">{n(data.current.visitors)}</b> visitors and <b className="font-mono font-medium">{n(data.current.signups)}</b> signups {span}.</> : "counting visitors."}
          </p>
          {mood.line && <p className="mt-0.5 text-13 text-[#14243a]/70">{mood.line}</p>}
        </div>
        <span className="me-4 shrink-0 max-sm:me-0" aria-hidden><Mascot body="kit" color="blue" size={52} state={mood.state} /></span>
      </div>
    </div>
  );
}

const I = { size: 14, strokeWidth: 1.75 } as const;
function Kpi({ label, value, now, before, invert, toggle, live, icon }: { label: string; value: string; now?: number | null; before?: number | null; invert?: boolean; toggle?: { on: boolean; flip(): void; colour: string }; live?: boolean; icon?: ReactNode }) {
  return (
    <div className="min-w-0 bg-pop px-4 py-3.5">
      {toggle ? (
        <label className="flex cursor-pointer items-center gap-2 text-13 text-ink-3">
          <input type="checkbox" checked={toggle.on} onChange={toggle.flip} className="size-3.5" style={{ accentColor: toggle.colour }} />{label}<span className="ms-auto text-ink-4" aria-hidden>{icon}</span>
        </label>
      ) : <div className="flex items-center gap-2 text-13 text-ink-3">{label}{live !== undefined && <span className="live-dot text-good" data-live={live} aria-hidden />}<span className="ms-auto text-ink-4" aria-hidden>{icon}</span></div>}
      <div className="mt-1 truncate font-mono text-[28px] font-medium leading-9 tracking-[-0.045em] text-ink num">{value}</div>
      <div className="mt-0.5 h-5 truncate leading-5">{now !== undefined && <Delta now={now ?? null} before={before ?? null} invert={invert} />}</div>
    </div>
  );
}

function MapPanel({ rows }: { rows: RankRow[] }) {
  const points = rows.slice(0, 40).flatMap((row) => {
    const c = centroid(row.key);
    if (!c) return [];
    const { body, ink } = avatarOf(row.key);
    return [{ id: row.key, lat: c[1], lon: c[0], label: countryName(row.key), detail: `${n(row.visitors)} visitors, ${n(row.signups)} signups`, avatar: { body, colour: ink } }];
  });
  return (
    <Suspense fallback={<div className="aspect-[2/1] w-full rounded-[14px] bg-card" aria-busy="true" />}>
      <Globe points={points} mode="2d" className="!bg-pop" summary={`${points.length} countries on the map`} />
    </Suspense>
  );
}

function VisitDots({ count }: { count: number }) {
  return <span className="flex gap-0.5" aria-label={`${count} visit${count === 1 ? "" : "s"}`}>{Array.from({ length: Math.min(8, Math.max(1, count)) }, (_, i) => <span key={i} className="size-1.5 rounded-full bg-accent/60" />)}{count > 8 && <span className="ms-0.5 text-[10px] text-ink-4">+{count - 8}</span>}</span>;
}

/** goals, the funnel, who signed up and every journey, in one card like the rest */
function PeopleCard({ range, data, filters }: { range: Range; data: WebAnswer; filters: Record<string, string | undefined> }) {
  const [tab, setTab] = useState<"journey" | "users" | "goals" | "funnel">("journey");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const people = useAdmin<{ total: number; people: Person[] }>(tab === "journey" || tab === "users" ? `/journeys?from=${range.from}&to=${range.to}&only=${tab === "users" ? "signups" : "all"}` : null);
  const funnel = useAdmin<FunnelAnswer>(tab === "funnel" ? `/funnel?from=${range.from}&to=${range.to}&mode=visitors` : null);
  const now = useNow(60_000);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (people.data?.people ?? []).filter((p) => !needle || personName(p.seed, p.account?.email).toLowerCase().includes(needle) || p.source.toLowerCase().includes(needle) || (p.country ?? "").toLowerCase().includes(needle));
    return all ? rows : rows.slice(0, 10);
  }, [people.data, q, all]);
  const TABS = [["journey", "journeys", <MousePointerClick key="j" {...I} />], ["users", "users", <Users key="u" {...I} />], ["goals", "goals", <Target key="g" {...I} />], ["funnel", "funnel", <Sparkles key="f" {...I} />]] as const;
  return (
    <section aria-label="people and goals" className="rounded-[24px] bg-card p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <div role="tablist" aria-label="people and goals" className="scroll-x flex gap-0.5">
          {TABS.map(([id, label, icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-13", tab === id ? "bg-pop font-medium text-ink" : "text-ink-3 hover-link")}><span aria-hidden className="opacity-70">{icon}</span>{label}</button>)}
        </div>
        {(tab === "journey" || tab === "users") && (
          <div className="relative w-[220px] max-sm:w-full">
            <label htmlFor="journey-search" className="sr-only">search people</label>
            <Search size={14} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" aria-hidden />
            <input id="journey-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search" className="field !h-8 !rounded-full !ps-8 !text-13" />
          </div>
        )}
      </div>
      <div role="tabpanel" className="rounded-[18px] bg-pop p-1.5">
        {tab === "goals" && <RankCardRows rows={data.cards.goal ?? []} label={(key) => key.replace(/_/g, " ")} />}
        {tab === "funnel" && (funnel.data ? <MiniFunnel steps={funnel.data.steps.slice(0, 8)} /> : <Loading rows={3} />)}
        {(tab === "journey" || tab === "users") && (people.error ? <Failed error={people.error} retry={people.reload} /> : !people.data ? <Loading rows={5} /> : list.length ? (
          <>
            <div className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_96px] gap-4 px-3 py-2 t-meta max-md:hidden"><span>visitor</span><span>source</span><span>visits</span><span>time to sign up</span><span className="text-end">last seen</span></div>
            <ul className="divide-y divide-line">
              {list.map((p) => (
                <li key={p.id}>
                  <Link to={`/admin/people/visitors?person=${encodeURIComponent(p.id)}`} className="hover-row grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_96px] items-center gap-4 rounded-[12px] px-3 py-2.5 max-md:grid-cols-[minmax(0,1fr)_auto]">
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar seed={p.seed} size={26} customer={p.customer} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2"><span className="truncate text-14 font-medium text-ink">{personName(p.seed, p.account?.email)}</span>{p.customer ? <span className="inline-flex h-5 items-center rounded-full bg-coral-soft px-2 text-[11.5px] text-coral-deep">customer</span> : p.account ? <span className="inline-flex h-5 items-center rounded-full bg-sky px-2 text-[11.5px] text-accent-ink">signed up</span> : null}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1">{p.country && <Chip>{countryName(p.country)}</Chip>}{p.device && <Chip>{p.device}</Chip>}{p.os && p.os !== "other" && <Chip>{p.os}</Chip>}{p.browser && p.browser !== "other" && <Chip>{p.browser}</Chip>}</span>
                      </span>
                    </span>
                    <span className="min-w-0 max-md:hidden"><span className="block truncate text-13 text-ink">{p.source}</span>{p.campaign && <span className="block truncate text-12 text-ink-3">{p.campaign}</span>}</span>
                    <span className="max-md:hidden"><VisitDots count={p.visits} /></span>
                    <span className="text-13 text-ink-2 max-md:hidden">{p.timeToSignupMs !== null ? duration(p.timeToSignupMs) : <span className="text-ink-4">not yet</span>}</span>
                    <span className="text-end text-12 text-ink-3">{ago(p.lastSeen, now)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {(people.data.people.length > 10) && <button type="button" onClick={() => setAll((v) => !v)} className="hover-link mx-auto mt-1 block h-8 px-3 font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-3">{all ? "show fewer" : `show all ${n(people.data.people.length)}`}</button>}
          </>
        ) : <SkyEmpty art="cat" className="!py-8" title={q ? `no one matches "${q}".` : "no one here yet."} />)}
      </div>
      {Object.values(filters).some((v) => v !== undefined) && <p className="px-3 pt-2 text-12 text-ink-4">journeys show everyone in the window; the filters above apply to the cards.</p>}
    </section>
  );
}

function RankCardRows({ rows, label }: { rows: RankRow[]; label(key: string): string }) {
  const max = Math.max(1, ...rows.map((r) => r.visitors));
  if (!rows.length) return <p className="px-3 py-8 text-center text-13 text-ink-3">no goals in this window yet.</p>;
  return (
    <ul className="flex flex-col gap-px">
      {rows.slice(0, 12).map((row) => (
        <li key={row.key} className="relative flex h-9 items-center gap-3 overflow-hidden rounded-[10px] px-2.5 text-13">
          <span className="absolute inset-y-0 left-0 rounded-[10px] bg-accent/12" style={{ width: `${(row.visitors / max) * 100}%` }} aria-hidden />
          <span className="relative min-w-0 flex-1 truncate text-ink">{label(row.key)}</span>
          <span className="relative w-14 text-end font-mono text-ink num">{n(row.visitors)}</span>
          <span className={cx("relative w-10 text-end font-mono num", row.signups ? "text-coral-deep" : "text-ink-4")}>{n(row.signups)}</span>
        </li>
      ))}
    </ul>
  );
}

function MiniFunnel({ steps }: { steps: FunnelAnswer["steps"] }) {
  const top = Math.max(1, steps[0]?.count ?? 1);
  return (
    <div>
      <ol className="grid grid-flow-col auto-cols-fr items-end gap-1.5 px-2 pt-3 max-md:grid-flow-row max-md:auto-cols-auto">
        {steps.map((step, i) => {
          const prev = steps[i - 1], kept = prev && prev.count ? step.count / prev.count : null;
          return (
            <li key={step.id} className="flex min-w-0 flex-col">
              <span className="font-mono text-[22px] font-medium leading-7 tracking-[-0.04em] num">{n(step.count)}</span>
              <span className="truncate text-12 text-ink-3" title={step.label}>{step.label}</span>
              <span className="mt-2 flex h-20 items-end overflow-hidden rounded-[8px] bg-track max-md:h-2 max-md:items-stretch" aria-hidden><span className="block w-full rounded-[8px] bg-accent/70 max-md:h-2" style={{ height: `${Math.max(3, (step.count / top) * 100)}%` }} /></span>
              <span className={cx("mt-1.5 h-4 font-mono text-12 num", kept === null ? "text-ink-4" : kept >= 0.5 ? "text-good" : "text-bad")}>{kept === null ? " " : `${percent(kept)} kept`}</span>
            </li>
          );
        })}
      </ol>
      <Link to="/admin/funnel" className="hover-link mx-auto mt-1 flex h-8 w-fit items-center px-3 font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-3">full funnel</Link>
    </div>
  );
}

function AiCard({ crawlers }: { crawlers: WebAnswer["crawlers"] }) {
  const [kind, setKind] = useState<string>("all");
  const kinds = [{ key: "all", visitors: crawlers.total }, ...["answers", "indexing", "training"].map((k) => ({ key: k, visitors: crawlers.kind.find((r) => r.key === k)?.visitors ?? 0 }))];
  return (
    <section aria-label="ai crawlers" className="rounded-[24px] bg-card p-2">
      <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5 pt-1">
        <span className="me-2 inline-flex items-center gap-1.5 text-14 font-medium text-ink"><Bot {...I} aria-hidden /> ai bots</span>
        {kinds.map((k) => (
          <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)} className={cx("h-8 rounded-full px-3 text-13", kind === k.key ? "bg-pop font-medium text-ink" : "text-ink-3 hover-link")}>
            {k.key === "all" ? "all" : AI_KIND[k.key]} <span className="ms-1 font-mono text-[11.5px] text-ink-4">{n(k.visitors)}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5 max-md:grid-cols-1">
        <RankCard title="crawlers" metric="requests" tabs={[{ id: "bot", label: "crawlers" }]} data={{ bot: crawlers.bot }} />
        <RankCard title="pages they read" metric="requests" tabs={[{ id: "page", label: "pages they read" }]} data={{ page: crawlers.page }} />
      </div>
      <p className="px-3 pb-1 pt-2 text-12 text-ink-4">{kind === "answers" ? "a person asked an ai assistant, and it read dusk.bot to answer." : kind === "indexing" ? "search and answer engines building their index." : kind === "training" ? "collected to train models." : "every request from a known ai crawler."}</p>
    </section>
  );
}

export function OverviewPage() {
  const [sel, setSel] = useSelection();
  const { range, surface, filters } = sel;
  const [show, setShow] = useState({ visitors: true, signups: true, paid: true });
  const [note, setNote] = useState<Note | { at: number } | null>(null);
  const { data, error, loading, reload } = useAdmin<WebAnswer>(`/web?${webQuery(range, surface, filters)}`, 60_000);
  const pick = (dim: string, key: string) => setSel((s) => ({ ...s, filters: { ...s.filters, [dim]: s.filters[dim] === key ? undefined : key } }));
  const c = data?.current, p = data?.previous;
  const online = data ? data.online.site + data.online.app : 0;
  const detail = (tab: string) => `/admin/analytics/${tab}?${webQuery(range, surface, filters).replace(/from=\d+&to=\d+&?/, `range=${range.key}&`).replace(/surface=/, "site=")}`;
  return (
    <>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <h1 className="sr-only">overview</h1>
          <SitePicker value={surface} onChange={(v) => setSel((s) => ({ ...s, surface: v }))} counts={data?.surfaces} />
          <RangePicker value={range} onChange={(r) => setSel((s) => ({ ...s, range: r }))} />
        </div>
        <Link to="/admin/live" className="hover-ghost inline-flex h-9 items-center gap-2 rounded-full px-3 text-13 text-ink-2"><span className="live-dot text-good" data-live={online > 0} aria-hidden /><span className="font-mono num">{n(online)}</span> online</Link>
      </header>
      <Band data={data} range={range} />
      <FilterChips filters={filters} onRemove={(dim) => setSel((s) => ({ ...s, filters: { ...s.filters, [dim]: undefined } }))} label={dimLabel} />
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading rows={8} />}
      {data && c && p && (
        <div className={cx(loading && "opacity-80")}>
          <section className="rounded-[28px] bg-card p-2" aria-label="key numbers and chart">
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[22px] bg-line max-xl:grid-cols-4 max-sm:grid-cols-2">
              <Kpi label="visitors" icon={<Users {...I} />} value={n(c.visitors)} now={c.visitors} before={p.visitors} toggle={{ on: show.visitors, flip: () => setShow((s) => ({ ...s, visitors: !s.visitors })), colour: "var(--accent)" }} />
              <Kpi label="signups" icon={<UserPlus {...I} />} value={n(c.signups)} now={c.signups} before={p.signups} toggle={{ on: show.signups, flip: () => setShow((s) => ({ ...s, signups: !s.signups })), colour: "var(--coral)" }} />
              <Kpi label="conversion" icon={<Target {...I} />} value={percent(c.conversion)} now={c.conversion} before={p.conversion} />
              <Kpi label="paid" icon={<CreditCard {...I} />} value={n(c.paid)} now={c.paid} before={p.paid} toggle={{ on: show.paid, flip: () => setShow((s) => ({ ...s, paid: !s.paid })), colour: "var(--coral-deep)" }} />
              <Kpi label="bounce rate" icon={<RotateCcw {...I} />} value={percent(c.bounce)} now={c.bounce} before={p.bounce} invert />
              <Kpi label="session time" icon={<Clock {...I} />} value={duration(c.visitMs)} now={c.visitMs} before={p.visitMs} />
              <Kpi label="online" value={n(online)} live={online > 0} />
            </div>
            <div className="px-3 pb-2 pt-6 max-sm:px-1">
              {!data.tracked && <p className="mb-3 rounded-[14px] bg-lemon px-4 py-2.5 text-13 text-ink">no visits recorded for this view yet.</p>}
              <DualChart data={data.series} notes={data.notes} show={show} onNote={setNote} marks={data.marks} />
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 px-1">
                <div className="flex flex-wrap gap-4 text-12 text-ink-3" aria-hidden>
                  <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-accent" /> visitors</span>
                  <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-coral" /> signups</span>
                  <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-coral-deep" /> paid</span>
                  <span className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 rounded-[2px] bg-warn" /> notes</span>
                </div>
                <Button size="sm" onClick={() => setNote({ at: Date.now() })}>add a note</Button>
              </div>
            </div>
          </section>

          <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
            <RankCard title="where they came from" tabs={[{ id: "channel", label: "channel", icon: <Link2 {...I} /> }, { id: "referrer", label: "referrer" }, { id: "campaign", label: "campaign", icon: <Tag {...I} /> }, { id: "keyword", label: "keyword", icon: <Search {...I} /> }, { id: "ref", label: "ref" }]}
              data={data.cards} label={dimLabel} onPick={pick} active={filters} details={detail} />
            <RankCard title="where they are" tabs={[{ id: "map", label: "map", icon: <GlobeIcon {...I} /> }, { id: "country", label: "country", icon: <MapPin {...I} /> }, { id: "region", label: "region" }, { id: "city", label: "city" }]}
              data={data.cards} label={dimLabel} onPick={pick} active={filters} details={(tab) => tab === "map" ? null : detail(tab)} panels={{ map: <MapPanel rows={data.cards.country ?? []} /> }} />
            <RankCard title="pages" tabs={[{ id: "page", label: "page", icon: <File {...I} /> }, { id: "entry", label: "entry" }, { id: "exit", label: "exit" }, { id: "host", label: "hostname" }]} data={data.cards} label={dimLabel} onPick={pick} active={filters} details={detail} />
            <RankCard title="what they use" tabs={[{ id: "browser", label: "browser", icon: <Monitor {...I} /> }, { id: "os", label: "os" }, { id: "device", label: "device" }, { id: "surface", label: "surface" }]} data={data.cards} label={dimLabel} onPick={pick} active={filters} details={detail} />
          </div>
          <div className="mt-4"><PeopleCard range={range} data={data} filters={filters} /></div>
          <div className="mt-4"><AiCard crawlers={data.crawlers} /></div>
          <p className="mt-4 text-center text-12 text-ink-4">tap a row to filter every number. blue is visitors, coral is the signups they became.</p>
        </div>
      )}
      <NoteDialog key={note ? ("id" in note ? note.id : "new") : "closed"} note={note} onClose={() => setNote(null)}
        onSave={async (input) => { await adminCall(note && "id" in note ? `/notes/${note.id}` : "/notes", { method: note && "id" in note ? "PATCH" : "POST", body: input }); reload(); }}
        onDelete={async (id) => { await adminCall(`/notes/${id}`, { method: "DELETE", body: {} }); reload(); }} />
    </>
  );
}
