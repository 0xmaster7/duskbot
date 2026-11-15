import { useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronRight } from "@/icons";
import { cx } from "../ui/kit";
import { Digits } from "../ui/Digits";
import { ago } from "../lib/format";
import { Link } from "../lib/router";
import { useNow } from "../lib/now";
import { useAdmin } from "./api";
import { PersonLink } from "./sheet";
import { Highlight } from "./motion";
import { usd } from "./kit";
import { Failed, n } from "./ui";
import { identity, PersonFace } from "./identity";
import type { BugReportRow } from "./BugReports";
import type { Note } from "./Feedback";
import { LIVE_PLAN, PEOPLE_FIRST, useOtherMode, type OverviewV2, type PaymentsV2, type PeopleV2 } from "./v2";

const DAY = 86_400_000;
type Days = 7 | 30 | 90;
const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** a window that only moves at midnight, so its reads stay cached all day */
const windowOf = (days: Days) => { const to = midnight(Date.now()) + DAY; return { from: to - days * DAY, to }; };

interface ExperienceAnswer { days: string[]; series: Record<"bad" | "confusing" | "done", number[]>; totals: Record<"bad" | "confusing" | "done", number>; installs: number; top: Record<"bad" | "confusing" | "done", Array<{ key: string; count: number }>> }
interface BugAnswer { reports: BugReportRow[]; counts: Record<"new" | "looking" | "fixed" | "wont-fix", number> }
interface FeedbackAnswer { notes: Note[]; counts: Record<"bad" | "big" | "weekly", number> }

const LATEST_PAYMENTS = "/v2/payments?mode=live&limit=200";
const reads = (days: Days) => {
  const { from, to } = windowOf(days);
  return { overview: `/v2/overview?days=${days}`, experience: `/experience?from=${from}&to=${to}`, bugs: "/bug-reports", feedback: "/feedback?kind=bad", people: PEOPLE_FIRST, payments: LATEST_PAYMENTS };
};
export const homeReads = () => Object.values(reads(30));

const step = (o: OverviewV2 | null, id: OverviewV2["funnel"][number]["id"]) => o?.funnel.find((f) => f.id === id)?.count ?? null;
const rate = (part: number | null, whole: number | null) => part === null || !whole ? null : `${(Math.round((part / whole) * 1000) / 10).toLocaleString("en-US")}%`;

function Stat({ label, value, sub, step, money, href }: { label: string; value: string | null; sub: ReactNode; step?: string | null; money?: boolean; href: string }) {
  return (
    <Link to={href} className="hover-row group relative flex min-w-0 flex-col rounded-[18px] px-4 pb-3.5 pt-3">
      <span className="flex items-center justify-between gap-2 text-13 text-ink-3">
        <span className="truncate">{label}</span>
        {step !== undefined && <span className="shrink-0 font-mono text-[11.5px] text-ink-4 num" title="of the step before">{step ?? ""}</span>}
      </span>
      <span className={cx("mt-1.5 block h-9 whitespace-nowrap font-mono text-[26px] font-medium leading-9 tracking-[-0.045em] num", money ? "text-money" : "text-ink")}>
        {value === null ? <span className="inline-block h-7 w-20 animate-pulse rounded-[8px] bg-card-2 align-middle" data-skeleton aria-label="loading" /> : <Digits text={value} />}
      </span>
      <span className="mt-1 block h-[18px] truncate text-12 leading-[18px] text-ink-3">{sub}</span>
    </Link>
  );
}

function Pulse({ days }: { days: Days }) {
  const { data: o, error, reload } = useAdmin<OverviewV2>(reads(days).overview, 120_000);
  const visitors = o ? step(o, "visited") ?? o.visitors.unique : null, signups = o ? step(o, "signed_up") ?? o.signups.total : null;
  const activated = o ? step(o, "activated") ?? o.accounts.activated : null, newPaying = o ? step(o, "paying") : null;
  const live = o?.revenue.live, test = o?.revenue.test;
  return (
    <section aria-label="the funnel and money" className="rounded-[26px] bg-card p-1.5">
      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.45fr)_minmax(0,1.45fr)] gap-1 max-xl:grid-cols-3 max-sm:grid-cols-2">
        <Stat label="visitors" value={visitors === null ? null : n(visitors)} sub={`in ${days} days`} href="/admin/people/visitors" />
        <Stat label="signups" value={signups === null ? null : n(signups)} step={rate(signups, visitors)} sub={o ? `${n(o.accounts.total)} in all` : ""} href="/admin/people" />
        <Stat label="activated" value={activated === null ? null : n(activated)} step={rate(activated, signups)} sub="app or bot reply" href="/admin/retention" />
        <Stat label="paying now" value={o ? n(o.paying.live) : null} step={rate(newPaying, activated)} sub={newPaying === null ? "" : `${n(newPaying)} new in ${days} days`} href="/admin/payments" />
        <div className="rounded-[18px] bg-wash-lime">
          <Stat money label="mrr" value={live ? usd(live.mrrCents) : null} sub={live ? `${usd(live.mrrCents * 12)} a year` : ""} href="/admin/payments" />
        </div>
        <div className="rounded-[18px] bg-wash-lime">
          <Stat money label="revenue" value={live ? usd(live.grossCents) : null} sub={live ? `${usd(live.netCents)} net` : ""} href="/admin/payments" />
        </div>
      </div>
      {error && <div className="p-1.5"><Failed error={error} retry={reload} /></div>}
      <p className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1 pt-1.5 text-12 text-ink-3">
        <span>{days} days for the funnel; money is live only, all time.</span>
        {test && (test.payments > 0 || test.mrrCents > 0) && (
          <span>
            <span className="me-1.5 inline-flex h-5 items-center rounded-full bg-wash-lemon px-2 align-middle text-[11.5px] text-ink-2">test</span>
            <span className="font-mono num">{usd(test.mrrCents)}</span> mrr, <span className="font-mono num">{usd(test.grossCents)}</span> from {n(test.payments)} test payments, not counted
          </span>
        )}
      </p>
    </section>
  );
}

function Panel({ title, to, action, children, className }: { title: string; to?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cx("flex min-w-0 flex-col rounded-[24px] bg-card p-1.5", className)}>
      <div className="flex min-h-10 items-center justify-between gap-3 px-3">
        <h2 className="text-14 font-medium text-ink">{title}</h2>
        {action ?? (to && <Link to={to} className="text-link inline-flex items-center gap-1 text-12">see all <ChevronRight size={13} strokeWidth={1.75} aria-hidden /></Link>)}
      </div>
      <div className="flex flex-1 flex-col rounded-[18px] bg-pop p-1.5">{children}</div>
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="px-2.5 py-5 text-center text-13 text-ink-3">{children}</p>;
const Rows = ({ n: rows }: { n: number }) => <div data-skeleton aria-busy="true" aria-label="loading" className="flex flex-col gap-1 p-1">{Array.from({ length: rows }, (_, i) => <span key={i} className="h-10 animate-pulse rounded-[12px] bg-card" />)}</div>;

function Experience({ days }: { days: Days }) {
  const { data, error, reload } = useAdmin<ExperienceAnswer>(reads(days).experience, 120_000);
  const fams = [["bad", "bad", "bg-wash-pink"], ["confusing", "confusing", "bg-wash-lilac"], ["done", "got done", "bg-wash-sky"]] as const;
  return (
    <div>
      <div className="grid grid-cols-3 gap-1">
        {fams.map(([key, label, wash]) => (
          <Link key={key} to="/admin/experience" className={cx("hover-row min-w-0 rounded-[14px] px-3 py-2.5", wash)}>
            <span className="block text-12 text-ink-2">{label}</span>
            <span className="block h-7 font-mono text-[22px] font-medium leading-7 tracking-[-0.04em] text-ink num">{data ? <Digits text={n(data.totals[key])} /> : <span className="inline-block h-5 w-10 animate-pulse rounded-[6px] bg-pop/60" data-skeleton />}</span>
          </Link>
        ))}
      </div>
      {error ? <div className="mt-1.5"><Failed error={error} retry={reload} /></div> : data && (
        data.top.bad.length ? (
          <ul className="mt-1.5 flex flex-col">
            {data.top.bad.slice(0, 4).map((row) => (
              <li key={row.key} className="flex h-9 items-center gap-3 px-2.5 text-13">
                <span className="size-1.5 shrink-0 rounded-full bg-bad" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ink">{row.key}</span>
                <span className="font-mono text-12 text-ink-3 num">{n(row.count)}</span>
              </li>
            ))}
          </ul>
        ) : <Quiet>nothing went badly in {days} days.</Quiet>
      )}
    </div>
  );
}

const BUG_WASH: Record<string, string> = { new: "bg-wash-pink", looking: "bg-wash-lilac", fixed: "bg-wash-sky", "wont-fix": "bg-card-2" };
function Bugs() {
  const { data, error, reload } = useAdmin<BugAnswer>("/bug-reports", 120_000);
  const now = useNow(60_000);
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Rows n={3} />;
  const open = data.reports.filter((r) => r.status === "new" || r.status === "looking");
  if (!open.length) return <Quiet>no open bug reports.</Quiet>;
  return (
    <ul className="flex flex-col">
      {open.slice(0, 4).map((r) => (
        <li key={r.id}>
          <Link to="/admin/bug-reports" className="hover-row flex min-h-11 items-center gap-3 rounded-[12px] px-2.5 py-2 text-13">
            <span className={cx("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11.5px] text-ink-2", BUG_WASH[r.status])}>{r.status}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{r.description || "no description"}</span>
            <span className="shrink-0 text-12 text-ink-4">{ago(r.receivedAt, now)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BadChats() {
  const { data, error, reload } = useAdmin<FeedbackAnswer>("/feedback?kind=bad", 120_000);
  const now = useNow(60_000);
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Rows n={3} />;
  if (!data.notes.length) return <Quiet>no bad chats reported.</Quiet>;
  return (
    <ul className="flex flex-col">
      {data.notes.slice(0, 3).map((note) => (
        <li key={note.id} className="flex flex-col gap-0.5 rounded-[12px] px-2.5 py-2 text-13">
          <span className="line-clamp-2 text-ink">{note.text ?? "no words, just the signals"}</span>
          <span className="flex flex-wrap gap-x-2 text-12 text-ink-4">
            <span>{ago(note.at, now)}</span>{note.apps?.length ? <span>{note.apps.slice(0, 3).join(", ")}</span> : null}{note.engine && <span>{note.engine}</span>}
            {note.person && <PersonLink id={note.person} className="text-link">who</PersonLink>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function WrongPanel({ days }: { days: Days }) {
  const [tab, setTab] = useState<"experience" | "bugs" | "feedback">("experience");
  const bugs = useAdmin<BugAnswer>("/bug-reports", 120_000);
  const fb = useAdmin<FeedbackAnswer>("/feedback?kind=bad", 120_000);
  const tabs = [
    ["experience", "experience", null],
    ["bugs", "bug reports", bugs.data ? bugs.data.counts.new + bugs.data.counts.looking : null],
    ["feedback", "bad chats", fb.data ? fb.data.counts.bad : null],
  ] as const;
  const to = { experience: "/admin/experience", bugs: "/admin/bug-reports", feedback: "/admin/feedback" }[tab];
  return (
    <Panel title="what's going wrong" className="xl:col-span-7"
      action={<Link to={to} className="text-link inline-flex items-center gap-1 text-12">open <ChevronRight size={13} strokeWidth={1.75} aria-hidden /></Link>}>
      <div role="tablist" aria-label="what's going wrong" className="relative mb-1.5 flex gap-0.5 self-start rounded-full bg-card p-0.5">
        <Highlight target={tab} className="bg-pop" />
        {tabs.map(([id, label, badge]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} data-hl={id} onClick={() => setTab(id)}
            className={cx("relative z-[1] inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-13", tab === id ? "font-medium text-ink" : "text-ink-3 hover-link")}>
            {label}{badge ? <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-wash-pink px-1 font-mono text-[11px] text-ink num">{badge}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tabs.find((t) => t[0] === tab)![1]} className="min-h-[196px]">
        {tab === "experience" ? <Experience days={days} /> : tab === "bugs" ? <Bugs /> : <BadChats />}
      </div>
    </Panel>
  );
}

function NewPeople() {
  const { data, error, reload } = useAdmin<PeopleV2>(PEOPLE_FIRST);
  const other = useOtherMode(data?.money ?? "live");
  const now = useNow(60_000);
  const rows = data ? [...data.people].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5) : [];
  return (
    <Panel title="newest accounts" to="/admin/people" className="h-full">
      {error ? <Failed error={error} retry={reload} /> : !data ? <Rows n={5} /> : rows.length ? (
        <ul className="flex flex-col">
          {rows.map((r) => {
            const who = identity({ id: r.person.id, identity: r.person });
            return (
              <li key={r.person.id}>
                <PersonLink id={r.person.id} className="hover-row flex h-12 items-center gap-3 rounded-[12px] px-2">
                  <PersonFace id={r.person.id} size={28} avatarUrl={r.person.avatarUrl} avatar={r.person.avatar ?? undefined} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-13 font-medium text-ink">{who.name}</span>
                    {who.sub && <span className="block truncate text-12 text-ink-3">{who.sub}</span>}
                  </span>
                  {(() => {
                    const elsewhere = other.by.get(r.person.id);
                    if (r.plan && r.planStatus && LIVE_PLAN.has(r.planStatus)) return <span className="shrink-0 rounded-full bg-wash-sky px-2 py-0.5 text-[11.5px] text-ink-2">{r.plan}</span>;
                    if (elsewhere?.plan && elsewhere.status && LIVE_PLAN.has(elsewhere.status)) return <span className="shrink-0 rounded-full bg-wash-lemon px-2 py-0.5 text-[11.5px] text-ink-2">{elsewhere.plan}, {other.mode}</span>;
                    return null;
                  })()}
                  <span className="w-16 shrink-0 whitespace-nowrap text-end text-12 text-ink-4">{ago(r.createdAt, now)}</span>
                </PersonLink>
              </li>
            );
          })}
        </ul>
      ) : <Quiet>no accounts yet.</Quiet>}
    </Panel>
  );
}

function NewPayments() {
  const { data, error, reload } = useAdmin<PaymentsV2>(LATEST_PAYMENTS, 120_000);
  const now = useNow(60_000);
  const rows = data?.payments.slice(0, 5) ?? [];
  return (
    <Panel title="latest money" to="/admin/payments" className="h-full">
      {error ? <Failed error={error} retry={reload} /> : !data ? <Rows n={5} /> : rows.length ? (
        <ul className="flex flex-col">
          {rows.map((r) => {
            const bad = r.type === "refund" || r.status === "failed";
            return (
              <li key={r.id}>
                <PersonLink id={r.personId} className="hover-row flex h-12 items-center gap-3 rounded-[12px] px-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-13 font-medium text-ink">{r.person.name}</span>
                    <span className="block truncate text-12 text-ink-3">{r.type === "refund" ? "refunded" : r.status === "failed" ? "payment failed" : "paid"}{r.plan ? `, ${r.plan}` : ""}</span>
                  </span>
                  <span className={cx("shrink-0 font-mono text-13 num", bad ? "text-bad" : "font-medium text-money")}>{r.amountCents < 0 ? "-" : ""}{usd(Math.abs(r.amountCents))}</span>
                  <span className="w-16 shrink-0 whitespace-nowrap text-end text-12 text-ink-4">{ago(r.at, now)}</span>
                </PersonLink>
              </li>
            );
          })}
        </ul>
      ) : <Quiet>no live payments yet.</Quiet>}
    </Panel>
  );
}

function Daily({ days }: { days: Days }) {
  const { data } = useAdmin<OverviewV2>(reads(days).overview, 120_000);
  const [hover, setHover] = useState<number | null>(null);
  const v = data?.visitors.perDay ?? [], s = data?.signups.perDay ?? [], range = data?.range ?? [];
  const max = Math.max(1, ...v);
  const at = hover ?? v.length - 1;
  return (
    <section aria-label="visitors and signups per day" className="flex h-full flex-col rounded-[24px] bg-card p-1.5">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-3 px-3">
        <h2 className="text-14 font-medium text-ink">every day</h2>
        <span className="flex items-center gap-3 font-mono text-12 text-ink-3 num">
          {range[at] && <span>{range[at]}</span>}
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-accent/45" aria-hidden />{n(v[at] ?? 0)} visitors</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-coral-deep" aria-hidden />{n(s[at] ?? 0)} signups</span>
        </span>
      </div>
      <div className="min-h-[120px] flex-1 rounded-[18px] bg-pop px-3 pb-2 pt-3">
        {data ? (
          <svg viewBox={`0 0 ${v.length * 10} 100`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden onMouseLeave={() => setHover(null)}>
            {v.map((value, i) => {
              const h = Math.max(1.5, (value / max) * 96), sh = s[i] ? Math.max(2, (s[i]! / max) * 96) : 0;
              return (
                <g key={range[i] ?? i} onMouseEnter={() => setHover(i)} opacity={hover === null || hover === i ? 1 : 0.5}>
                  <rect x={i * 10} y={0} width={10} height={100} fill="transparent" />
                  <rect x={i * 10 + 1.5} y={100 - h} width={7} height={h} rx={1.5} fill="color-mix(in oklab, var(--accent) 45%, transparent)" />
                  {sh > 0 && <rect x={i * 10 + 1.5} y={100 - sh} width={7} height={sh} rx={1.5} fill="var(--coral-deep)" />}
                </g>
              );
            })}
          </svg>
        ) : <span className="block h-full animate-pulse rounded-[12px] bg-card" data-skeleton />}
      </div>
      {data && (
        <div className="sr-only"><table><caption>visitors and signups per day</caption><tbody>{range.map((day, i) => <tr key={day}><th scope="row">{day}</th><td>{v[i]} visitors</td><td>{s[i]} signups</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

export function HomePage() {
  const [days, setDays] = useState<Days>(() => { const v = Number(new URLSearchParams(location.search).get("days")); return v === 7 || v === 90 ? v : 30; });
  const pick = (d: Days) => { setDays(d); const q = new URLSearchParams(location.search); if (d === 30) q.delete("days"); else q.set("days", String(d)); history.replaceState(history.state, "", `${location.pathname}${q.size ? `?${q}` : ""}`); };
  return (
    <>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-medium leading-[1.15] tracking-[-0.04em] text-ink max-sm:text-[24px]">home</h1>
        <div role="radiogroup" aria-label="window" className="relative inline-flex gap-0.5 rounded-full bg-card p-1">
          <Highlight target={String(days)} className="bg-pop" />
          {([7, 30, 90] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} data-hl={String(d)} onClick={() => pick(d)}
              className={cx("relative z-[1] h-8 rounded-full px-3.5 text-13", days === d ? "font-medium text-ink" : "text-ink-3 hover-link")}>{d} days</button>
          ))}
        </div>
      </header>
      <Pulse days={days} />
      <div className="mt-3 grid grid-cols-12 gap-3 max-xl:grid-cols-1">
        <WrongPanel days={days} />
        <div className="grid gap-3 xl:col-span-5">
          <NewPeople />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-12 gap-3 max-xl:grid-cols-1">
        <div className="xl:col-span-7"><Daily days={days} /></div>
        <div className="xl:col-span-5"><NewPayments /></div>
      </div>
      <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-12 text-ink-4">
        <Link to="/admin/traffic" className="text-link inline-flex items-center gap-1">traffic sources and pages <ArrowUpRight size={12} strokeWidth={1.75} aria-hidden /></Link>
        <Link to="/admin/revenue" className="text-link inline-flex items-center gap-1">revenue analysis <ArrowUpRight size={12} strokeWidth={1.75} aria-hidden /></Link>
      </p>
    </>
  );
}
