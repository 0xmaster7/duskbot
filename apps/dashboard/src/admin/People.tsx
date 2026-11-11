import { useEffect, useState } from "react";
import { Segmented, cx } from "../ui/kit";
import { Modal } from "../ui/controls";
import { ago } from "../lib/format";
import { Link, navigate, useLocation } from "../lib/router";
import { useNow } from "../lib/now";
import { useAdmin } from "./api";
import { AdminHeader, Failed, Loading, n, SearchBox, stamp } from "./ui";
import { Avatar, Chip, RangePicker, duration, personName, rangeOf, where, type Range } from "./kit";

interface Person {
  id: string; seed: string; account: { id: string; email: string; name: string | null } | null; customer: boolean; signedUpAt: number | null; paidAt: number | null;
  firstSeen: number | null; lastSeen: number | null; timeToSignupMs: number | null; visits: number; pageviews: number; source: string; channel: string; campaign: string | null;
  device: string | null; os: string | null; browser: string | null; country: string | null; city: string | null; lastPage: string | null;
}
interface Profile {
  id: string; seed: string; account: { id: string; email: string; name: string | null; createdAt: number } | null; customer: boolean; paidAt: number | null; visitors: number; installs: number;
  summary: { visits: number; pageviews: number; firstSeen: number; lastSeen: number; source: string; channel: string; campaign: string | null; device: string | null; os: string | null; browser: string | null; country: string | null; city: string | null; lastPage: string } | null;
  timeline: Array<{ at: number; name: string; surface: "site" | "account" | "app" | "server"; props: Record<string, string | number | boolean>; page: string | null; source: string | null; country: string | null; device: string | null; app: { platform?: string; version?: string } | null }>;
}

const FILTERS = [{ value: "all", label: "everyone" }, { value: "signups", label: "signed up" }, { value: "customers", label: "customers" }] as const;
type Only = (typeof FILTERS)[number]["value"];

export function PeoplePage() {
  const { query } = useLocation();
  const [range, setRange] = useState<Range>(() => rangeOf("30d"));
  const [only, setOnly] = useState<Only>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setSearch(q.trim().toLowerCase()), 220); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useAdmin<{ total: number; people: Person[] }>(`/journeys?from=${range.from}&to=${range.to}&only=${only}&q=${encodeURIComponent(search)}`);
  const now = useNow(60_000);
  const open = query.get("person");
  return (
    <>
      <AdminHeader title="people" sub={data ? `${n(data.total)} in this window` : "visitors and accounts, from first visit to first bot reply"} action={<RangePicker value={range} onChange={setRange} />} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={q} onChange={setQ} label="search people" placeholder="email, name, source or id" />
        <Segmented<Only> label="show" value={only} options={[...FILTERS]} onChange={setOnly} />
      </div>
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading />}
      {data && (data.people.length ? (
        <ul className={cx("divide-y divide-line", loading && "opacity-70")}>
          {data.people.map((person) => (
            <li key={person.id}>
              <Link to={`/admin/people?person=${encodeURIComponent(person.id)}`} className="hover-row -mx-3 grid grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_110px] items-center gap-4 rounded-[16px] px-3 py-3 max-md:grid-cols-[minmax(0,1fr)_auto]">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar seed={person.seed} customer={person.customer} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-14 font-medium text-ink">{personName(person.seed, person.account?.email)}</span>
                      {person.customer ? <span className="tag !h-[22px] !px-2 text-accent-ink">customer</span> : person.account ? <span className="tag !h-[22px] !px-2">signed up</span> : null}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Chip>{where(person.country, person.city)}</Chip>
                      {person.device && <Chip>{person.device}</Chip>}
                      {person.os && person.os !== "other" && <Chip>{person.os}</Chip>}
                      {person.browser && person.browser !== "other" && <Chip>{person.browser}</Chip>}
                    </span>
                  </span>
                </span>
                <span className="min-w-0 max-md:hidden"><span className="block truncate text-14 text-ink-2">{person.source === "direct" ? "direct" : person.source}</span>{person.campaign && <span className="block truncate text-12 text-ink-3">{person.campaign}</span>}</span>
                <span className="text-13 text-ink-3 max-md:hidden">{person.timeToSignupMs !== null ? <>signed up after <span className="text-ink">{duration(person.timeToSignupMs)}</span></> : `${n(person.visits)} visit${person.visits === 1 ? "" : "s"}, ${n(person.pageviews)} page${person.pageviews === 1 ? "" : "s"}`}</span>
                <span className="text-end text-13 text-ink-3">{ago(person.lastSeen, now)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="rounded-[18px] bg-card px-4 py-6 text-center text-14 text-ink-3">{search ? `no one matches "${search}".` : "no one in this window yet."}</p>)}
      {open && <ProfileDialog id={open} onClose={() => navigate("/admin/people", { replace: true })} />}
    </>
  );
}

const WHAT: Record<string, (item: Profile["timeline"][number]) => string> = {
  site_view: (i) => `opened ${i.page ?? "a page"}`, site_goal: (i) => String(i.props.goal ?? "goal").replace(/_/g, " ") + (i.props.to ? ` (${i.props.to})` : ""),
  identify: (i) => i.props.via === "app" ? "signed in to the app" : "signed in on the site", signup: () => "made an account", sign_in: (i) => `signed in (${i.props.kind ?? "web"})`,
  page_view: (i) => `account page ${i.props.path ?? ""}`, onboarding_step: (i) => `onboarding: ${i.props.step}`, onboarding_done: () => "finished onboarding", plan_chosen: (i) => `picked ${i.props.plan}`,
  app_paired: (i) => `paired an app${i.props.platform ? ` (${i.props.platform})` : ""}`, app_open: (i) => `opened the ${i.props.kind ?? "desktop"} app`, app_screen: (i) => `app: ${i.props.screen}`,
  app_feature: (i) => String(i.props.feature ?? "a feature").replace(/_/g, " "), app_messages: (i) => `${i.props.sent ?? 0} messages, ${i.props.replies ?? 0} replies`,
  app_error: (i) => `app error ${i.props.kind ?? ""} ${i.props.code ?? ""}`, app_pair_failed: (i) => `pairing failed: ${i.props.reason ?? "unknown"}`, app_active: () => "used the app",
  first_bot_reply: () => "first bot reply", checkout_paid: () => "paid", cloud_state: (i) => `cloud ${i.props.from} to ${i.props.to}`, app_close: (i) => `closed the app after ${duration(Number(i.props.ms) || 0)}`,
};
const SURFACE: Record<string, string> = { site: "bg-sky", account: "bg-lime", app: "bg-lemon", server: "bg-card-2" };

function ProfileDialog({ id, onClose }: { id: string; onClose(): void }) {
  const { data, error, reload } = useAdmin<Profile>(`/journeys/${encodeURIComponent(id)}`);
  const name = data ? personName(data.seed, data.account?.email) : "loading";
  const days = new Map<string, Profile["timeline"]>();
  for (const item of data?.timeline ?? []) { const key = new Date(item.at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).toLowerCase(); (days.get(key) ?? days.set(key, []).get(key)!).push(item); }
  return (
    <Modal open onClose={onClose} title={name} wide>
      {error && <Failed error={error} retry={reload} />}
      {!data && !error && <Loading rows={5} />}
      {data && (
        <div className="text-ink-2">
          <div className="flex items-center gap-3">
            <Avatar seed={data.seed} size={40} customer={data.customer} />
            <div className="min-w-0">
              <div className="flex flex-wrap gap-1.5">
                {data.customer && <span className="tag text-accent-ink">customer</span>}
                {data.account ? <Link to={`/admin/users/${encodeURIComponent(data.account.id)}`} className="tag underline-offset-4 hover:underline">account</Link> : <span className="tag">anonymous</span>}
                {data.installs > 0 && <span className="tag">{data.installs} app install{data.installs === 1 ? "" : "s"}</span>}
              </div>
              {data.summary && <p className="mt-1.5 text-13">first came from <span className="text-ink">{data.summary.source}</span>{data.summary.campaign ? ` (${data.summary.campaign})` : ""}, {where(data.summary.country, data.summary.city)}, {data.summary.device ?? "unknown device"}. {n(data.summary.visits)} visit{data.summary.visits === 1 ? "" : "s"}, {n(data.summary.pageviews)} page{data.summary.pageviews === 1 ? "" : "s"}.</p>}
            </div>
          </div>
          <div className="mt-5 max-h-[52dvh] overflow-y-auto pe-1">
            {[...days].map(([day, items]) => (
              <section key={day} className="mb-4">
                <h3 className="t-meta sticky top-0 bg-pop py-1">{day}</h3>
                <ol className="mt-1 flex flex-col">
                  {items.map((item, i) => (
                    <li key={`${item.at}-${i}`} className="grid grid-cols-[52px_64px_minmax(0,1fr)] items-baseline gap-3 py-1.5 text-13">
                      <span className="font-mono text-12 text-ink-4">{new Date(item.at).toTimeString().slice(0, 5)}</span>
                      <span className={cx("justify-self-start rounded-full px-2 py-0.5 text-[11.5px] text-ink", SURFACE[item.surface])}>{item.surface}</span>
                      <span className="min-w-0 truncate text-ink">{(WHAT[item.name] ?? ((x) => x.name.replace(/_/g, " ")))(item)}{item.name === "site_view" && item.source && item.source !== "direct" ? <span className="text-ink-4"> from {item.source}</span> : null}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
            {!data.timeline.length && <p className="text-13">nothing recorded.</p>}
          </div>
          <p className="mt-3 text-12 text-ink-4">since {stamp(data.summary?.firstSeen ?? data.account?.createdAt ?? null)}. a person's site visits join their account when they sign in on the same domain; app use joins when the app signs in.</p>
        </div>
      )}
    </Modal>
  );
}
