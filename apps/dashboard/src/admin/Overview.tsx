import { lazy, Suspense, useState, type ReactNode } from "react";
import { cx } from "../ui/kit";
import { ago } from "../lib/format";
import { Link } from "../lib/router";
import { useNow } from "../lib/now";
import { useAdmin, type Overview } from "./api";
import { countryName } from "./geo";
import { friendlyName } from "./names";
import { Delta, RangePicker, RankCard, rangeOf, type Range } from "./kit";
import { pointsAt, SAYS, type LiveAnswer } from "./Live";
import { ImproveList, type ProductAnswer } from "./Product";
import type { WebAnswer } from "./Site";
import { AdminHeader, Failed, FunnelStrip, Loading, n, pct, Section } from "./ui";

const Globe = lazy(() => import("./globe/Globe"));
const DAY = 86_400_000;
const CHANNEL: Record<string, string> = { direct: "direct", search: "search", social: "social", ai: "ai assistants", referral: "referrals", email: "email", paid: "paid", unknown: "unknown" };
const more = "hover-link text-13 text-ink-3 underline-offset-4 hover:underline";

/** one headline number: big, with a plain line under it */
function Big({ label, value, children, live }: { label: string; value: string; children?: ReactNode; live?: boolean }) {
  return (
    <div className="min-w-0 bg-card px-5 py-4">
      <div className="flex items-center gap-2 text-13 text-ink-3">{live !== undefined && <span className="live-dot text-good" data-live={live} aria-hidden />}{label}</div>
      <div className="mt-1 truncate font-mono text-[34px] font-medium leading-[1.15] tracking-[-0.045em] text-ink num max-sm:text-[28px]">{value}</div>
      <div className="mt-0.5 truncate text-12 text-ink-3">{children}</div>
    </div>
  );
}

function LiveCard({ live }: { live: LiveAnswer | null }) {
  const now = useNow(15_000);
  const points = live ? pointsAt(live.feed, live.now) : [];
  return (
    <section aria-labelledby="overview-live" className="flex min-w-0 flex-col rounded-[24px] bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 id="overview-live" className="text-16 font-medium tracking-[-0.02em] text-ink">right now</h2>
        <Link to="/admin/live" className={more}>open live</Link>
      </div>
      <Suspense fallback={<div className="aspect-[2/1] w-full rounded-[24px] bg-pop" aria-busy="true" />}>
        <Globe points={points} mode="2d" className="!bg-pop" summary={`${points.length} ${points.length === 1 ? "person" : "people"} on the map`} />
      </Suspense>
      <ol className="mt-3 flex flex-col">
        {(live?.feed ?? []).slice(0, 5).map((item) => (
          <li key={item.id} className="flex h-9 items-center gap-2 px-1 text-13">
            <span className="min-w-0 flex-1 truncate text-ink"><span className="font-medium">{item.email ?? friendlyName(item.seed)}</span> <span className="text-ink-2">{(SAYS[item.name] ?? (() => item.name.replace(/_/g, " ")))(item)}</span>{item.country && <span className="text-ink-4"> · {countryName(item.country)}</span>}</span>
            <span className="shrink-0 text-12 text-ink-4">{ago(item.at, now)}</span>
          </li>
        ))}
        {live && !live.feed.length && <li className="px-1 py-3 text-13 text-ink-3">quiet for the last 30 minutes.</li>}
      </ol>
    </section>
  );
}

export function OverviewPage() {
  const [range, setRange] = useState<Range>(() => rangeOf("30d"));
  const days = Math.min(90, Math.max(7, Math.ceil((range.to - range.from) / DAY)));
  const overview = useAdmin<Overview>(`/overview?days=${days}`, 60_000);
  const web = useAdmin<WebAnswer>(`/web?from=${range.from}&to=${range.to}`, 60_000);
  const product = useAdmin<ProductAnswer>(`/product?from=${range.from}&to=${range.to}`, 120_000);
  const live = useAdmin<LiveAnswer>("/realtime?minutes=30", 15_000);
  const o = overview.data, w = web.data, p = product.data;
  const error = overview.error ?? web.error;
  const features = (p?.features ?? []).slice(0, 8).map((row) => ({ key: row.feature, visitors: row.people, signups: 0, paid: 0 }));
  return (
    <>
      <AdminHeader title="overview" sub={o ? `updated ${new Date(o.now).toISOString().slice(11, 16)} utc` : "how dusk bot is doing"} action={<RangePicker value={range} onChange={setRange} />} />
      {error && <Failed error={error} retry={() => { overview.reload(); web.reload(); }} />}
      {!o && !error && <Loading rows={8} />}
      {o && (
        <>
          <div className="grid grid-cols-6 gap-px overflow-hidden rounded-[24px] bg-line max-xl:grid-cols-3 max-sm:grid-cols-2">
            <Big label="visitors" value={n(w?.current.visitors ?? null)}>{w ? <Delta now={w.current.visitors} before={w.previous.visitors} /> : " "}</Big>
            <Big label="signups" value={n(o.totals.newAccounts)}>{n(o.totals.accounts)} accounts in all</Big>
            <Big label="waitlist" value={n(o.totals.waitlist)}>{o.totals.waitlist === null ? "not connected" : `+${n(o.series.waitlist.reduce((a, b) => a + b, 0))} in this window`}</Big>
            <Big label="paying" value={n(o.totals.paying)}>{pct(o.totals.paying, o.totals.accounts)} of accounts</Big>
            <Big label="active today" value={n(o.totals.activeToday)}>{n(o.totals.wau)} this week</Big>
            <Big label="here now" value={n(live.data ? live.data.online.site + live.data.online.app : null)} live={(live.data?.online.site ?? 0) + (live.data?.online.app ?? 0) > 0}>{live.data ? `${n(live.data.online.site)} on the site, ${n(live.data.online.app)} in the apps` : " "}</Big>
          </div>

          <Section title="fix first" className="mt-10" action={<Link to="/admin/product" className={more}>everything to improve</Link>}>
            {p ? <ImproveList items={p.improve} limit={3} /> : product.error ? <Failed error={product.error} retry={product.reload} /> : <Loading rows={3} />}
          </Section>

          <Section title="funnel" action={<Link to="/admin/funnel" className={more}>where they drop off</Link>}>
            <FunnelStrip steps={o.funnel} />
          </Section>

          <div className="mt-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
            <LiveCard live={live.data} />
            <div className={cx("flex min-w-0 flex-col gap-4", web.loading && "opacity-70")}>
              {w && <RankCard title="top channels" tabs={[{ id: "channel", label: "channels" }, { id: "source", label: "sources" }]} data={w.cards} label={(tab, key) => tab === "channel" ? CHANNEL[key] ?? key : key} />}
              {w && <RankCard title="top pages" tabs={[{ id: "page", label: "pages" }, { id: "entry", label: "landed on" }]} data={w.cards} />}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
            <RankCard title="what people use most" metric="people" tabs={[{ id: "features", label: "in the apps" }]} data={{ features }} label={(_, key) => key.replace(/_/g, " ")} />
            <section aria-label="clouds and bots" className="rounded-[24px] bg-card p-5">
              <div className="mb-2 flex items-center justify-between"><h2 className="text-16 font-medium tracking-[-0.02em] text-ink">clouds and bots</h2><Link to="/admin/clouds" className={more}>all clouds</Link></div>
              <ul className="divide-y divide-line">
                <li className="flex h-11 items-center justify-between"><span className="text-14 text-ink-2">clouds, not deleted</span><span className="font-mono text-14 num">{n(o.totals.clouds)}</span></li>
                <li className="flex h-11 items-center justify-between"><span className="text-14 text-ink-2">app devices signed in</span><span className="font-mono text-14 num">{n(o.totals.devices)}</span></li>
                <li className="flex h-11 items-center justify-between"><span className="text-14 text-ink-2">bots</span><span className="font-mono text-14 num">{n(o.bots.bots)}</span></li>
                <li className="flex h-11 items-center justify-between"><span className="text-14 text-ink-2">bot replies, last 30 days</span><span className="font-mono text-14 num">{n(o.bots.turns30d)}</span></li>
              </ul>
            </section>
          </div>
        </>
      )}
    </>
  );
}
