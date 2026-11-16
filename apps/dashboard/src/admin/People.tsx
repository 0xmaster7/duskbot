import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight } from "@/icons";
import { Segmented, cx } from "../ui/kit";
import { ago } from "../lib/format";
import { Link, useLocation } from "../lib/router";
import { closeCard, PersonLink, SidePanel } from "./sheet";
import { useNow } from "../lib/now";
import { useAdmin } from "./api";
import { AdminHeader, Failed, Loading, n, SearchBox, stamp } from "./ui";
import { AnimatePresence } from "../ui/motion";
import { Avatar, CHANNEL, Chip, RangePicker, duration, personName, rangeOf, usd, where, type Range } from "./kit";
import { Platform, deviceEmoji, flagOf } from "./person";
import { BillingCard } from "./PersonBilling";
import type { PersonBilling } from "./revenue-types";

interface Person {
  id: string; seed: string; account: { id: string; email: string; name: string | null; avatarUrl?: string; avatar?: string } | null; customer: boolean; signedUpAt: number | null; paidAt: number | null;
  firstSeen: number | null; lastSeen: number | null; timeToSignupMs: number | null; visits: number; pageviews: number; source: string; channel: string; campaign: string | null;
  device: string | null; os: string | null; browser: string | null; country: string | null; city: string | null; lastPage: string | null;
}
type StepKind = "view" | "goal" | "paid" | "refund" | "checkout" | "signup" | "signin" | "onboarding" | "plan" | "paired" | "install" | "app" | "reply" | "cloud" | "upsell" | "notice"
  | "error" | "feedback" | "returned" | "billing";
interface Step {
  at: number; kind: StepKind; surface: "site" | "account" | "app" | "server"; name: string; path: string | null; detail: string | null; amountCents: number | null; gapMs?: number;
  taxCents?: number; ms?: number; scroll?: number; emoji?: string;
}
interface Session { start: number; end: number; ms: number; surface: Step["surface"]; source: string | null; channel: string | null; campaign: string | null; referrer: string | null; steps: Step[] }
interface Profile {
  id: string; seed: string; account: { id: string; email: string; name: string | null; createdAt: number; avatarUrl?: string; avatar?: string } | null; customer: boolean; paidAt: number | null; visitors: number; installs: number;
  where: { device: string | null; os: string | null; browser: string | null; country: string | null; region: string | null; city: string | null };
  firstSource: { at: number; source: string; channel: string; campaign: string | null; referrer: string | null; ref: string | null } | null;
  stats: { firstSeen: number | null; visits: number; pageviews: number; spentCents: number; refundedCents: number; payments: number; firstPaidAt: number | null; timeToPayMs: number | null };
  sessions: Session[];
  billing: PersonBilling | null;
}

const FILTERS = [{ value: "all", label: "everyone" }, { value: "signups", label: "signed up" }, { value: "customers", label: "customers" }] as const;
type Only = (typeof FILTERS)[number]["value"];

export function PeoplePage({ tabs }: { tabs?: ReactNode }) {
  const [range, setRange] = useState<Range>(() => rangeOf("30d"));
  const [only, setOnly] = useState<Only>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setSearch(q.trim().toLowerCase()), 220); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useAdmin<{ total: number; people: Person[] }>(`/journeys?from=${range.from}&to=${range.to}&only=${only}&q=${encodeURIComponent(search)}`);
  const now = useNow(60_000);
  return (
    <>
      <AdminHeader title="people" sub={data ? `${n(data.total)} in this window` : "visitors and accounts, from first visit to first bot reply"} action={<RangePicker value={range} onChange={setRange} />} tabs={tabs} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={q} onChange={setQ} label="search people" placeholder="email, name, source or id" />
        <Segmented<Only> label="show" value={only} options={[...FILTERS]} onChange={setOnly} />
      </div>
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading />}
      {data && (data.people.length ? (
        <ul className={cx("", loading && "opacity-70")}>
          {data.people.map((person) => (
            <li key={person.id}>
              <PersonLink id={person.id} className="hover-row -mx-3 grid grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_110px] items-center gap-4 rounded-[16px] px-3 py-3 max-md:grid-cols-[minmax(0,1fr)_auto]">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar seed={person.seed} customer={person.customer} account={person.account} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-14 font-medium text-ink">{personName(person.seed, person.account?.email)}</span>
                      {person.customer ? <span className="tag !h-[22px] !px-2 text-accent-ink">customer</span> : person.account ? <span className="tag !h-[22px] !px-2">signed up</span> : null}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Chip>{person.country && <span aria-hidden className="me-1">{flagOf(person.country)}</span>}{where(person.country, person.city)}</Chip>
                      {person.device && <Chip>{person.device}</Chip>}
                      {person.os && person.os !== "other" && <Chip><Platform kind="os" value={person.os} /></Chip>}
                      {person.browser && person.browser !== "other" && <Chip><Platform kind="browser" value={person.browser} /></Chip>}
                    </span>
                  </span>
                </span>
                <span className="min-w-0 max-md:hidden"><span className="block truncate text-14 text-ink-2">{person.source === "direct" ? "direct" : person.source}</span>{person.campaign && <span className="block truncate text-12 text-ink-3">{person.campaign}</span>}</span>
                <span className="text-13 text-ink-3 max-md:hidden">{person.timeToSignupMs !== null ? <>signed up after <span className="text-ink">{duration(person.timeToSignupMs)}</span></> : `${n(person.visits)} visit${person.visits === 1 ? "" : "s"}, ${n(person.pageviews)} page${person.pageviews === 1 ? "" : "s"}`}</span>
                <span className="text-end text-13 text-ink-3">{ago(person.lastSeen, now)}</span>
              </PersonLink>
            </li>
          ))}
        </ul>
      ) : <p className="rounded-[18px] bg-card px-4 py-6 text-center text-14 text-ink-3">{search ? `no one matches "${search}".` : "no one in this window yet."}</p>)}
    </>
  );
}

const ICON: Record<StepKind, string> = { view: "📄", goal: "🎯", paid: "💰", refund: "↩️", checkout: "🛒", signup: "🧑‍💻", signin: "🔑", onboarding: "🧭", plan: "🧾", paired: "📲",
  install: "💾", app: "🖥️", reply: "🤖", cloud: "☁️", upsell: "✨", notice: "💬", error: "⚠️", feedback: "⭐", returned: "🔁", billing: "🧾" };
const PLAN_CHANGE = new Set(["upgraded", "downgraded"]);
const CHANNEL_ICON: Record<string, string> = { direct: "🔗", search: "🔎", social: "💬", ai: "🤖", referral: "🤝", email: "✉️", paid: "📣" };
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }).toLowerCase();
const clock = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();

function sessionLabel(session: Session): { icon: string; text: string } {
  if (session.surface === "app") {
    const phone = session.steps.some((step) => step.detail === "ios" || step.detail === "android" || step.name.includes("phone"));
    return { icon: phone ? "📱" : "🖥️", text: phone ? "phone app" : "desktop app" };
  }
  if (session.surface === "server") return { icon: "🧾", text: "account and billing" };
  const source = session.source ?? "direct";
  return { icon: CHANNEL_ICON[session.channel ?? "direct"] ?? "🔗", text: `${source}${session.campaign ? `, ${session.campaign}` : ""}` };
}

const seconds = (ms: number) => ms < 1000 ? "<1s" : duration(ms);
const Time = ({ ms }: { ms: number }) => <span className="font-mono text-12 text-ink-2 num">{seconds(ms)}</span>;
const UPSELL_DID: Record<string, string> = { upsell_click: "clicked", upsell_dismiss: "closed" };
const NOTICE_DID: Record<string, string> = { notice_closed: "closed", notice_acted: "acted on" };

/** how long someone had an upsell or notice in front of them before they did something, or that they did nothing */
function Outcome({ did, what, ms }: { did: string | null; what: ReactNode; ms?: number }) {
  if (did === null) return ms === undefined ? <>saw {what}</> : <>saw {what} for <Time ms={ms} />, <span className="text-ink-3">did nothing</span></>;
  return <><span className="font-medium text-accent-ink">{did}</span> {what}{ms !== undefined && <> after <Time ms={ms} /></>}</>;
}

function StepText({ step }: { step: Step }) {
  const where = step.path ? <span className="text-ink-4"> on <span className="font-mono text-12 text-ink-3">{step.path}</span></span> : null;
  const detail = step.detail ? <span className="text-ink-4"> · {step.detail.replace(/_/g, " ")}</span> : null;
  const took = step.ms !== undefined ? <span className="text-ink-4"> · <Time ms={step.ms} /></span> : null;
  const amount = step.amountCents !== null ? <span className={cx("font-mono font-medium num", step.kind === "checkout" ? "text-ink-2" : "text-money")}> {usd(step.amountCents)}</span> : null;
  // prices are tax exclusive: the tax paid on top reads after the amount
  const tax = step.taxCents ? <span className="font-mono text-ink-4 num"> (+{usd(Math.abs(step.taxCents))} tax)</span> : null;
  switch (step.kind) {
    case "view": return <>{step.surface === "app" ? "opened" : "viewed"} <span className="font-mono text-12 text-ink">{step.path}</span>{took}
      {step.scroll !== undefined && <span className="text-ink-4"> · read <span className="font-mono text-12 text-ink-2 num">{step.scroll}%</span></span>}</>;
    case "upsell": {
      const shown = step.name === "upsell_shown";
      return <><Outcome did={shown || step.name === "upsell_ignored" ? null : UPSELL_DID[step.name] ?? step.name} what="the cloud upsell" ms={shown ? undefined : step.ms} />{where}{detail}</>;
    }
    case "notice": return <Outcome did={step.name === "notice_ignored" ? null : NOTICE_DID[step.name] ?? step.name} what={<>the {step.detail ?? "corner"} notice</>} ms={step.ms} />;
    case "goal": return <><span className="font-medium text-accent-ink">{step.name}</span>{where}{detail}{step.ms !== undefined && <span className="text-ink-4"> · after <Time ms={step.ms} /></span>}</>;
    case "onboarding": return <>{step.name}{step.ms !== undefined && <span className="text-ink-4"> · <Time ms={step.ms} /> on the step before</span>}</>;
    case "paid": return <>{step.name}{amount}{tax}{detail}</>;
    case "refund": return <>{step.name}{step.amountCents !== null && <span className="font-mono text-ink-3 num"> {usd(step.amountCents)}</span>}{tax}{detail}</>;
    case "billing": {
      if (PLAN_CHANGE.has(step.name)) {
        const delta = step.amountCents;
        return <>{step.name}{step.detail && <> to <span className="font-medium">{step.detail}</span></>}{delta !== null && delta !== 0 && <span className={cx("font-mono num", delta > 0 ? "font-medium text-money" : "text-ink-3")}> {delta > 0 ? "+" : "-"}{usd(Math.abs(delta))}<span className="text-12 text-ink-4">/mo</span></span>}</>;
      }
      return <>{step.name}{step.amountCents !== null && <span className="font-mono text-ink-3 num"> {usd(Math.abs(step.amountCents))}</span>}{detail}</>;
    }
    case "checkout": return <>{step.name}{amount}{detail}</>;
    case "returned": return <>returned{step.gapMs ? <span className="text-ink-4"> after {duration(step.gapMs)}</span> : null}</>;
    case "error": return <><span className="text-bad">{step.name}</span>{where}{detail}</>;
    default: return <>{step.name}{detail}</>;
  }
}

function Stat({ label, value, note, money }: { label: string; value: ReactNode; note?: ReactNode; money?: boolean }) {
  return (
    <div className="min-w-0 rounded-[16px] bg-card px-3.5 py-3">
      <div className="text-12 font-medium text-ink-3">{label}</div>
      <div className={cx("mt-1 truncate text-[17px] font-medium leading-6", money ? "font-mono text-money num" : "text-ink")}>{value}</div>
      <div className="mt-0.5 h-[18px] truncate text-12 leading-[18px] text-ink-4">{note}</div>
    </div>
  );
}

/** the person card, on whatever admin page carries ?person= */
export function PersonSheetHost() {
  const { query } = useLocation();
  const id = query.get("person");
  return createPortal(<AnimatePresence>{id && <PersonSheet key={id} id={id} />}</AnimatePresence>, document.body);
}

function PersonSheet({ id }: { id: string }) {
  const titleId = useId();
  const close = useCallback(() => closeCard("person"), []);
  return <SidePanel label="person" titleId={titleId} onClose={close} wide><PersonCard id={id} titleId={titleId} /></SidePanel>;
}

function PersonCard({ id, titleId }: { id: string; titleId: string }) {
  const { path } = useLocation();
  const { data, error, reload } = useAdmin<Profile>(`/journeys/${encodeURIComponent(id)}`);
  const first = data?.firstSource;
  const place = data?.where;
  if (error) return <div className="mt-4"><h2 id={titleId} className="sr-only">person</h2><Failed error={error} retry={reload} /></div>;
  if (!data || !place) return <div className="mt-4"><h2 id={titleId} className="sr-only">loading</h2><Loading rows={5} /></div>;
  return (
        <div className="text-14 leading-[1.55] text-ink-2">
          <div className="mt-2 flex items-center gap-3.5">
            <Avatar seed={data.seed} size={48} customer={data.customer} account={data.account} />
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-20 font-medium tracking-[-0.03em] text-ink">{personName(data.seed, data.account?.email)}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {data.customer && <span className="inline-flex h-6 items-center rounded-full bg-coral-soft px-2.5 text-12 text-coral-deep">customer</span>}
                {data.account ? <span className="tag">account</span> : <span className="tag">anonymous</span>}
                {data.account?.name && <span className="text-13 text-ink-3">{data.account.name}</span>}
                {data.installs > 0 && <span className="tag">{data.installs} app install{data.installs === 1 ? "" : "s"}</span>}
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-13">
                <span>{place.country && <span aria-hidden>{flagOf(place.country)} </span>}{where(place.country, place.city)}</span>
                {place.device && <span><span aria-hidden>{deviceEmoji(place.device)} </span>{place.device}</span>}
                <Platform kind="os" value={place.os} />
                <Platform kind="browser" value={place.browser} />
              </p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-4 gap-2 max-md:grid-cols-2">
            <Stat label="first source" value={first ? <><span aria-hidden>{CHANNEL_ICON[first.channel] ?? "🔗"} </span>{first.source}</> : "unknown"}
              note={first ? first.campaign ?? (first.ref && first.ref !== first.source ? `ref ${first.ref}` : first.referrer ?? CHANNEL[first.channel] ?? first.channel) : "no site visit recorded"} />
            <Stat label="visits" value={n(data.stats.visits)} note={`${n(data.stats.pageviews)} page${data.stats.pageviews === 1 ? "" : "s"}`} />
            <Stat label="total spent" value={usd(data.stats.spentCents)} money
              note={data.stats.refundedCents ? `after ${usd(data.stats.refundedCents)} refunded` : data.stats.payments ? `${n(data.stats.payments)} payment${data.stats.payments === 1 ? "" : "s"}` : "nothing yet"} />
            <Stat label="time to first payment" value={data.stats.timeToPayMs !== null ? duration(data.stats.timeToPayMs) : "-"} note={data.stats.firstPaidAt ? `paid ${day(data.stats.firstPaidAt)}` : "not paid yet"} />
          </div>
          {data.billing && <BillingCard billing={data.billing} />}
          <div className="mt-5">
            {data.sessions.map((session) => {
              const label = sessionLabel(session);
              return (
                <section key={session.start} className="mb-4">
                  <h3 className="sticky top-0 z-[1] flex flex-wrap items-center gap-x-2 bg-pop py-1.5 text-13 font-medium text-ink">
                    <span>{day(session.start)}, {clock(session.start)}</span>
                    <span className="text-ink-4" aria-hidden>·</span>
                    <span className="text-ink-2"><span aria-hidden>{label.icon} </span>{label.text}</span>
                    {session.ms >= 1000 && <><span className="text-ink-4" aria-hidden>·</span><span className="font-mono text-12 text-ink-3 num">{duration(session.ms)}</span></>}
                  </h3>
                  <ol className="flex flex-col">
                    {session.steps.map((step, i) => (
                      <li key={`${step.at}-${i}`} className="grid grid-cols-[64px_22px_minmax(0,1fr)] items-baseline gap-2 rounded-[10px] py-1.5 text-13">
                        <span className="font-mono text-12 text-ink-4 num">{clock(step.at)}</span>
                        <span aria-hidden className="text-center">{step.emoji ?? (step.kind === "app" && (step.detail === "ios" || step.detail === "android") ? "📱" : ICON[step.kind] ?? "•")}</span>
                        <span className="min-w-0 break-words text-ink"><StepText step={step} /></span>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
            {!data.sessions.length && <p className="text-13">nothing recorded.</p>}
          </div>
          <p className="mt-3 text-12 text-ink-4">since {stamp(data.stats.firstSeen ?? data.account?.createdAt ?? null)}. a person's site visits join their account when they sign in on the same domain; app use joins when the app signs in. a new session starts after 30 quiet minutes.</p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-13">
            {data.account && <Link to={`/admin/users/${encodeURIComponent(data.account.id)}`} className="text-link inline-flex items-center gap-1.5">full account page <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden /></Link>}
            {path !== "/admin/people/visitors" && <Link to={`/admin/people/visitors?person=${encodeURIComponent(id)}`} className="text-link inline-flex items-center gap-1.5">open in people <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden /></Link>}
          </div>
        </div>
  );
}
