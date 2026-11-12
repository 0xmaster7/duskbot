import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, CreditCard, File, Repeat, Star, Globe as GlobeIcon, Link2, MapPin, Monitor, MousePointerClick, RotateCcw, Search, Sparkles, Tag, Target, UserPlus, Users } from "@/icons";
import { Button, cx, Segmented } from "../ui/kit";
import { Switch } from "../ui/controls";
import { SkyEmpty } from "../ui/Sky";
import { AnimatePresence, m, Pill, usePill } from "../ui/motion";
import { Figure } from "../ui/Figure";
import { ago } from "../lib/format";
import { Link } from "../lib/router";
import { useNow } from "../lib/now";
import { adminCall, useAdmin, type Overview } from "./api";
import { avatarOf } from "./names";
import { centroid, countryName } from "./geo";
import { Avatar, Chip, Delta, FilterChips, NoteDialog, RangePicker, RankCard, SalesChart, duration, percent, personName, rangeOf, usd, type Mark, type Note, type Range, type RankRow, type SeriesData } from "./kit";
import { CheerBubble, PaymentsCard, useCheer, type RevenueAnswer } from "./Revenue";
import { PulseGrid } from "./Pulse";
import { Failed, Loading, n } from "./ui";

const Globe = lazy(() => import("./globe/Globe"));

interface Kpis { visitors: number; visits: number; pageviews: number; signups: number; paid: number; waitlist: number; conversion: number | null; bounce: number | null; visitMs: number | null }
export type Surface = "all" | "site" | "account" | "desktop" | "phone";
export interface WebAnswer {
  from: number; to: number; now: number; filters: Record<string, string>; current: Kpis; previous: Kpis; online: { site: number; app: number };
  series: SeriesData; cards: Record<string, RankRow[]>; notes: Note[]; tracked: boolean; marks?: Mark[];
  surfaces?: { site: number; account: number; desktop: number; phone: number };
  crawlers: { total: number; bot: RankRow[]; page: RankRow[]; kind: RankRow[] };
  revenue?: RevenueAnswer;
}
interface Person {
  id: string; seed: string; account: { id: string; email: string; name: string | null } | null; customer: boolean; signedUpAt: number | null; paidAt: number | null;
  firstSeen: number | null; lastSeen: number | null; timeToSignupMs: number | null; visits: number; pageviews: number; source: string; channel: string; campaign: string | null;
  device: string | null; os: string | null; browser: string | null; country: string | null; city: string | null; lastPage: string | null;
}
interface FunnelAnswer {
  mode: "visitors" | "signups"; steps: Array<{ id: string; label: string; count: number }>; bySource: Array<{ channel: string; counts: number[] }>;
  upsells?: Array<{ source: string; shown: number; clicked: number; dismissed: number; paid: number }>;
}

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
  const pill = usePill();
  return (
    <div role="radiogroup" aria-label="which surface" className="scroll-x inline-flex max-w-full rounded-full bg-card-2 p-1">
      {SURFACES.map((s) => {
        const count = s.value === "all" || !counts ? null : counts[s.value];
        return (
          <button key={s.value} type="button" role="radio" aria-checked={value === s.value} onClick={() => onChange(s.value)}
            className={cx("relative h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-13", value === s.value ? "font-medium text-ink" : "text-ink-3 hover-link")}>
            {value === s.value && <Pill id={pill} />}
            <span className="relative">{s.label}{count !== null && <span className="ms-1.5 font-mono text-[11px] text-ink-4">{n(count)}</span>}</span>
          </button>
        );
      })}
    </div>
  );
}

const I = { size: 14, strokeWidth: 1.75 } as const;
/** one number in the strip: money and traffic in the same plain tile, easing to each new value */
function Kpi({ label, value, format, now, before, invert, icon }: { label: string; value: number | null; format(v: number): string; now?: number | null; before?: number | null; invert?: boolean; icon?: ReactNode }) {
  return (
    <div className="min-w-0 bg-pop px-4 py-3.5">
      <div className="flex items-center gap-2 text-13 text-ink-3">{label}<span className="ms-auto text-ink-4" aria-hidden>{icon}</span></div>
      <div className="mt-1 truncate font-mono text-[26px] font-medium leading-9 tracking-[-0.045em] text-ink num">{value === null ? "-" : <Figure value={format(value)} className="!font-mono !text-[26px] !leading-9 !tracking-[-0.045em]" />}</div>
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
  const [tab, setTab] = useState<"journey" | "users" | "goals">("journey");
  const pill = usePill();
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const people = useAdmin<{ total: number; people: Person[] }>(tab === "journey" || tab === "users" ? `/journeys?from=${range.from}&to=${range.to}&only=${tab === "users" ? "signups" : "all"}` : null);
  const now = useNow(60_000);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (people.data?.people ?? []).filter((p) => !needle || personName(p.seed, p.account?.email).toLowerCase().includes(needle) || p.source.toLowerCase().includes(needle) || (p.country ?? "").toLowerCase().includes(needle));
    return all ? rows : rows.slice(0, 10);
  }, [people.data, q, all]);
  const TABS = [["journey", "journeys", <MousePointerClick key="j" {...I} />], ["users", "users", <Users key="u" {...I} />], ["goals", "goals", <Target key="g" {...I} />]] as const;
  return (
    <section aria-label="people and goals" className="rounded-[24px] bg-card p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <div role="tablist" aria-label="people and goals" className="scroll-x flex gap-0.5">
          {TABS.map(([id, label, icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx("relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-13", tab === id ? "font-medium text-ink" : "text-ink-3 hover-link")}>{tab === id && <Pill id={pill} />}<span aria-hidden className="relative opacity-70">{icon}</span><span className="relative">{label}</span></button>)}
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
        {(tab === "journey" || tab === "users") && (people.error ? <Failed error={people.error} retry={people.reload} /> : !people.data ? <Loading rows={5} /> : list.length ? (
          <>
            <div className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_96px] gap-4 px-3 py-2 t-meta max-md:hidden"><span>visitor</span><span>source</span><span>visits</span><span>time to sign up</span><span className="text-end">last seen</span></div>
            <ul className="">
              <AnimatePresence initial={false} mode="popLayout">
              {list.map((p) => (
                <m.li key={p.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
                  <Link to={p.account ? `/admin/users/${encodeURIComponent(p.account.id)}` : `/admin/people/visitors?person=${encodeURIComponent(p.id)}`} className="hover-row grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_96px] items-center gap-4 rounded-[12px] px-3 py-2.5 max-md:grid-cols-[minmax(0,1fr)_auto]">
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
                </m.li>
              ))}
              </AnimatePresence>
            </ul>
            {(people.data.people.length > 10) && <button type="button" onClick={() => setAll((v) => !v)} className="text-link mx-auto mt-1 block h-8 px-3 font-mono text-[11.5px] uppercase tracking-[0.06em]">{all ? "show fewer" : `show all ${n(people.data.people.length)}`}</button>}
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

const UPSELL: Record<string, string> = { dash_sidebar: "sidebar card", dash_invested: "home note", dash_routines: "routines prompt", dash_home: "home pitch", dash_billing: "plans page" };
const FUNNEL_CHANNEL: Record<string, string> = { ai: "ai assistants", referral: "referrals", unknown: "not tracked" };

/** the funnel, small: every step in one row with how many were kept from the step before, the biggest drop in words,
 * and which upsell turns into money */
function FunnelSection({ range }: { range: Range }) {
  const [mode, setMode] = useState<"visitors" | "signups">("visitors");
  const [channel, setChannel] = useState("all");
  const pill = usePill();
  const { data, error, loading, reload } = useAdmin<FunnelAnswer>(`/funnel?from=${range.from}&to=${range.to}&mode=${mode}`);
  useEffect(() => { if (data && location.hash === "#funnel") document.getElementById("funnel")?.scrollIntoView({ block: "start" }); }, [Boolean(data)]);
  const row = data?.bySource.find((r) => r.channel === channel);
  const counts = data ? (row ? row.counts : data.steps.map((step) => step.count)) : [];
  const first = Math.max(1, counts[0] ?? 1);
  const drops = data ? data.steps.slice(1).map((step, i) => ({ to: step, from: data.steps[i]!, kept: counts[i] ? counts[i + 1]! / counts[i]! : null, lost: (counts[i] ?? 0) - (counts[i + 1] ?? 0), base: counts[i] ?? 0 })) : [];
  const worst = [...drops].filter((d) => d.kept !== null && d.base >= 3).sort((a, b) => (a.kept ?? 1) - (b.kept ?? 1))[0];
  const upsells = data?.upsells ?? [];
  return (
    <section id="funnel" aria-labelledby="funnel-title" className="scroll-mt-6 rounded-[24px] bg-card p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <h2 id="funnel-title" className="inline-flex h-8 items-center gap-1.5 text-14 font-medium text-ink"><Sparkles {...I} aria-hidden /> funnel</h2>
        <Segmented<"visitors" | "signups"> label="start from" value={mode} onChange={setMode} options={[{ value: "visitors", label: "from visitors" }, { value: "signups", label: "from signups" }]} />
      </div>
      <div className="rounded-[18px] bg-pop p-3">
        {error ? <Failed error={error} retry={reload} /> : !data ? <Loading rows={2} /> : (
          <div className={cx("transition-opacity duration-150", loading && "opacity-70")}>
            {data.bySource.length > 0 && (
              <div role="radiogroup" aria-label="channel" className="scroll-x mb-3 flex gap-0.5">
                {[{ channel: "all" }, ...data.bySource].map((r) => (
                  <button key={r.channel} type="button" role="radio" aria-checked={channel === r.channel} onClick={() => setChannel(r.channel)}
                    className={cx("relative h-7 shrink-0 rounded-full px-3 text-12", channel === r.channel ? "font-medium text-ink" : "text-ink-3 hover-link")}>
                    {channel === r.channel && <Pill id={pill} className="bg-card" />}
                    <span className="relative">{r.channel === "all" ? "every channel" : CHANNEL[r.channel] ?? FUNNEL_CHANNEL[r.channel] ?? r.channel}</span>
                  </button>
                ))}
              </div>
            )}
            <ol className="scroll-x flex items-stretch" aria-label="funnel steps">
              {data.steps.map((step, i) => {
                const drop = drops[i - 1], share = (counts[i] ?? 0) / first;
                return (
                  <li key={step.id} className="flex shrink-0 items-stretch">
                    {drop && (
                      <span className="flex w-12 flex-col items-center justify-center text-center" title={`${n(drop.lost)} stopped between these steps`}>
                        <span className={cx("font-mono text-12 num", drop === worst ? "font-medium text-bad" : "text-ink-3")}>{drop.kept === null ? "-" : percent(drop.kept)}</span>
                        <span className="text-[10.5px] leading-tight text-ink-4">kept</span>
                      </span>
                    )}
                    <div className="flex w-[104px] flex-col py-1">
                      <Figure value={n(counts[i] ?? 0)} className="!font-mono !text-[20px] !leading-7 !tracking-[-0.04em]" />
                      <span className="line-clamp-2 min-h-8 text-12 leading-4 text-ink-3">{step.label}</span>
                      <span className="mt-2 h-1 overflow-hidden rounded-full bg-track" aria-hidden>
                        <m.span className="block h-full w-full rounded-full bg-viz-visitors/60" style={{ originX: 0 }} initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0.02, share) }} transition={{ type: "spring", visualDuration: 0.4, bounce: 0 }} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 pt-3 text-13 text-ink-2">
              {worst ? <>biggest drop: <span className="font-medium text-ink">{percent(1 - (worst.kept ?? 0))}</span> stop between "{worst.from.label}" and "{worst.to.label}" (<span className="font-mono num">{n(worst.lost)}</span> people).</> : "not enough people in this window to call a biggest drop."}
            </p>
          </div>
        )}
      </div>
      {data && (
        <div className="mt-1.5 rounded-[18px] bg-pop p-3">
          <h3 className="text-13 font-medium text-ink">which upsell converts</h3>
          {upsells.length ? (
            <table className="mt-2 w-full text-13">
              <thead><tr className="t-meta"><th scope="col" className="py-1 text-start font-medium">where</th><th scope="col" className="py-1 text-end font-medium">shown</th><th scope="col" className="py-1 text-end font-normal">clicked</th><th scope="col" className="py-1 text-end font-normal">paid</th><th scope="col" className="py-1 text-end font-normal">click rate</th></tr></thead>
              <tbody className="">
                {upsells.map((u) => (
                  <tr key={u.source}>
                    <th scope="row" className="py-1.5 text-start font-normal text-ink">{UPSELL[u.source] ?? u.source.replace(/_/g, " ")}</th>
                    <td className="py-1.5 text-end font-mono num">{n(u.shown)}</td>
                    <td className="py-1.5 text-end font-mono num">{n(u.clicked)}</td>
                    <td className={cx("py-1.5 text-end font-mono num", u.paid ? "font-medium text-ink" : "text-ink-4")}>{n(u.paid)}</td>
                    <td className="py-1.5 text-end font-mono text-ink-3 num">{u.shown ? percent(u.clicked / u.shown) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="mt-1 text-13 text-ink-3">no upsell was shown in this window.</p>}
        </div>
      )}
    </section>
  );
}

function AiCard({ crawlers }: { crawlers: WebAnswer["crawlers"] }) {
  const [kind, setKind] = useState<string>("all");
  const pill = usePill();
  const kinds = [{ key: "all", visitors: crawlers.total }, ...["answers", "indexing", "training"].map((k) => ({ key: k, visitors: crawlers.kind.find((r) => r.key === k)?.visitors ?? 0 }))];
  return (
    <section aria-label="ai crawlers" className="rounded-[24px] bg-card p-2">
      <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5 pt-1">
        <span className="me-2 inline-flex items-center gap-1.5 text-14 font-medium text-ink"><Bot {...I} aria-hidden /> ai bots</span>
        {kinds.map((k) => (
          <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)} className={cx("relative h-8 rounded-full px-3 text-13", kind === k.key ? "font-medium text-ink" : "text-ink-3 hover-link")}>
            {kind === k.key && <Pill id={pill} />}
            <span className="relative">{k.key === "all" ? "all" : AI_KIND[k.key]} <span className="ms-1 font-mono text-[11.5px] text-ink-4">{n(k.visitors)}</span></span>
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

/** a signup or payment since the last visit, said once in the corner */
function Cheer({ data }: { data: WebAnswer | null }) {
  const [cheer, dismiss] = useCheer(data?.marks, data?.revenue?.recent);
  const close = useCallback(() => dismiss(), [dismiss]);
  return (
    <div className="fixed bottom-5 right-5 z-40 max-w-[calc(100%-2.5rem)] max-sm:left-4 max-sm:right-4">
      <AnimatePresence>
        {cheer && (
          <m.div key={cheer.key} initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16 } }} style={{ originX: 1, originY: 1 }}>
            <CheerBubble cheer={cheer} onClose={close} />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function OverviewPage() {
  const [sel, setSel] = useSelection();
  const { range, surface, filters } = sel;
  const [visitors, setVisitors] = useState(true);
  const [note, setNote] = useState<Note | { at: number } | null>(null);
  const { data, error, loading, reload } = useAdmin<WebAnswer>(`/web?${webQuery(range, surface, filters)}`, 60_000);
  const overview = useAdmin<Overview>("/overview?days=30", 120_000);
  const pick = (dim: string, key: string) => setSel((s) => ({ ...s, filters: { ...s.filters, [dim]: s.filters[dim] === key ? undefined : key } }));
  const c = data?.current, p = data?.previous, r = data?.revenue;
  const online = data ? data.online.site + data.online.app : 0;
  const detail = (tab: string) => `/admin/analytics/${tab}?${webQuery(range, surface, filters).replace(/from=\d+&to=\d+&?/, `range=${range.key}&`).replace(/surface=/, "site=")}`;
  const series = useMemo(() => data ? { ...data.series, revenue: data.revenue?.series } : null, [data]);
  const filtered = Object.values(filters).some((v) => v !== undefined);
  const whole = (v: number) => n(v), dollars = (v: number) => usd(v, true), share = (v: number) => percent(v);
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
      <FilterChips filters={filters} onRemove={(dim) => setSel((s) => ({ ...s, filters: { ...s.filters, [dim]: undefined } }))} label={dimLabel} />
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading rows={8} />}
      {data && c && p && series && (
        <div className={cx("transition-opacity duration-150", loading && "opacity-80")}>
          <section className="rounded-[28px] bg-card p-2" aria-label="key numbers and chart">
            <div className="grid grid-cols-8 gap-1.5 overflow-hidden rounded-[22px] max-xl:grid-cols-4 max-sm:grid-cols-2">
              <Kpi label="sales" icon={<CreditCard {...I} />} value={r ? r.current.net : null} format={dollars} now={r?.current.net} before={r?.previous.net} />
              <Kpi label="mrr" icon={<Repeat {...I} />} value={r && !filtered ? r.current.mrr : null} format={dollars} now={r && !filtered ? r.current.mrr : undefined} before={r?.previous.mrr} />
              <Kpi label="customers" icon={<Star {...I} />} value={r ? (overview.data?.totals.paying ?? r.current.customers) : null} format={whole} now={r?.current.customers} before={r?.previous.customers} />
              <Kpi label="new customers" icon={<UserPlus {...I} />} value={c.paid} format={whole} now={c.paid} before={p.paid} />
              <Kpi label="visitors" icon={<Users {...I} />} value={c.visitors} format={whole} now={c.visitors} before={p.visitors} />
              <Kpi label="signups" icon={<UserPlus {...I} />} value={c.signups} format={whole} now={c.signups} before={p.signups} />
              <Kpi label="conversion" icon={<Sparkles {...I} />} value={c.conversion} format={share} now={c.conversion} before={p.conversion} />
              <Kpi label="bounce rate" icon={<RotateCcw {...I} />} value={c.bounce} format={share} now={c.bounce} before={p.bounce} invert />
            </div>
            <div className="px-3 pb-2 pt-6 max-sm:px-1">
              {!data.tracked && <p className="mb-3 rounded-[14px] bg-wash-lemon px-4 py-2.5 text-13 text-ink">no visits recorded for this view yet.</p>}
              <SalesChart data={series} notes={data.notes} visitors={visitors} onNote={setNote} empty={r?.live ? "no sales in this window yet." : "no sales yet. payments aren't live, so plans are comps for now."} />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1">
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-12 text-ink-3" aria-label="legend">
                  <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-viz-new" aria-hidden /> new sales</li>
                  <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-viz-renewal" aria-hidden /> renewals</li>
                  <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-viz-refund" aria-hidden /> refunds</li>
                  <li className="inline-flex items-center gap-1.5"><span className="h-3 min-w-3 rounded-full bg-coral-soft px-1 font-mono text-[9.5px] leading-3 text-coral-deep" aria-hidden>1</span> new customers</li>
                  <li className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 rounded-[2px] bg-warn" aria-hidden /> notes</li>
                </ul>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-13 text-ink-2"><span className="h-0.5 w-4 rounded-full bg-viz-visitors" aria-hidden />visitors<Switch checked={visitors} onChange={setVisitors} label="show visitors under the chart" /></label>
                  <Button size="sm" onClick={() => setNote({ at: Date.now() })}>add a note</Button>
                </div>
              </div>
            </div>
          </section>

          <div className="mt-4"><FunnelSection range={range} /></div>

          <div className="mt-4 grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
            {r ? <PaymentsCard revenue={r} /> : <div />}
            <PulseGrid overview={overview} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
            <RankCard title="where they came from" tabs={[{ id: "channel", label: "channel", icon: <Link2 {...I} /> }, { id: "referrer", label: "referrer" }, { id: "campaign", label: "campaign", icon: <Tag {...I} /> }, { id: "keyword", label: "keyword", icon: <Search {...I} /> }, { id: "ref", label: "ref" }]}
              data={data.cards} label={dimLabel} onPick={pick} active={filters} details={detail} money={r?.cards} />
            <RankCard title="where they are" tabs={[{ id: "map", label: "map", icon: <GlobeIcon {...I} /> }, { id: "country", label: "country", icon: <MapPin {...I} /> }, { id: "region", label: "region" }, { id: "city", label: "city" }]}
              data={data.cards} label={dimLabel} onPick={pick} active={filters} details={(tab) => tab === "map" ? null : detail(tab)} panels={{ map: <MapPanel rows={data.cards.country ?? []} /> }} money={r?.cards} />
            <RankCard title="pages" tabs={[{ id: "page", label: "page", icon: <File {...I} /> }, { id: "entry", label: "entry" }, { id: "exit", label: "exit" }, { id: "host", label: "hostname" }]} data={data.cards} label={dimLabel} onPick={pick} active={filters} details={detail} money={r?.cards} />
            <RankCard title="what they use" tabs={[{ id: "browser", label: "browser", icon: <Monitor {...I} /> }, { id: "os", label: "os" }, { id: "device", label: "device" }, { id: "surface", label: "surface" }]} data={data.cards} label={dimLabel} onPick={pick} active={filters} details={detail} money={r?.cards} />
          </div>
          <div className="mt-4"><PeopleCard range={range} data={data} filters={filters} /></div>
          <div className="mt-4"><AiCard crawlers={data.crawlers} /></div>
          <p className="mt-4 text-center text-12 text-ink-4">tap a row to filter every number. sales go to the last place a payer came from before paying, or their first visit.</p>
        </div>
      )}
      <Cheer data={data} />
      <AnimatePresence>{note && <NoteDialog key={"id" in note ? note.id : "new"} note={note} onClose={() => setNote(null)}
        onSave={async (input) => { await adminCall(note && "id" in note ? `/notes/${note.id}` : "/notes", { method: note && "id" in note ? "PATCH" : "POST", body: input }); reload(); }}
        onDelete={async (id) => { await adminCall(`/notes/${id}`, { method: "DELETE", body: {} }); reload(); }} />}</AnimatePresence>
    </>
  );
}
