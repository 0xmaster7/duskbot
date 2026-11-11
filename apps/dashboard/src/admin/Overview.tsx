import { useState } from "react";
import { Segmented } from "../ui/kit";
import { Link } from "../lib/router";
import { useAdmin, type Overview } from "./api";
import { AdminHeader, DayBars, Failed, FunnelStrip, Loading, n, pct, Section, Status, Tile } from "./ui";

const WINDOWS = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }] as const;

export function OverviewPage() {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const { data, error, loading, reload } = useAdmin<Overview>(`/overview?days=${days}`, 60_000);
  return (
    <>
      <AdminHeader title="overview" sub={data ? `last ${days} days, updated ${new Date(data.now).toISOString().slice(11, 16)} utc` : "how dusk bot is doing"}
        action={<Segmented<typeof days> label="window" value={days} options={[...WINDOWS]} onChange={setDays} />} />
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading rows={8} />}
      {data && (
        <>
          <div className="grid grid-cols-6 gap-2.5 max-xl:grid-cols-3 max-sm:grid-cols-2">
            <Tile label="accounts" value={n(data.totals.accounts)} note={`+${n(data.totals.newAccounts)} in ${days} days`} />
            <Tile label="active today" value={n(data.totals.activeToday)} note={`${n(data.totals.wau)} this week, ${n(data.totals.mau)} this month`} />
            <Tile label="paying or granted" value={n(data.totals.paying)} note={pct(data.totals.paying, data.totals.accounts)} />
            <Tile label="waitlist" value={n(data.totals.waitlist)} note={data.totals.waitlist === null ? "not connected" : `+${n(data.series.waitlist.reduce((a, b) => a + b, 0))} in ${days} days`} />
            <Tile label="clouds" value={n(data.totals.clouds)} note="not deleted" />
            <Tile label="app devices" value={n(data.totals.devices)} note={data.platforms.map((p) => `${p.platform} ${p.count}`).join(", ") || "none signed in"} />
          </div>

          <Section title="funnel" className="mt-10" action={<span className="t-meta">signups of the window, and how far they got</span>}>
            <FunnelStrip steps={data.funnel} />
          </Section>

          <Section title="every day">
            <div className="grid grid-cols-2 gap-x-10 gap-y-8 rounded-[24px] bg-card p-6 max-md:grid-cols-1 max-sm:p-4">
              <DayBars title="signups" days={data.range} values={data.series.signups} />
              <DayBars title="waitlist joins" days={data.range} values={data.series.waitlist} tone="ink" />
              <DayBars title="active accounts" days={data.range} values={data.series.active} />
              <DayBars title="site visitors" days={data.range} values={data.series.visitors} tone="ink" />
            </div>
          </Section>

          <div className="mt-10 grid grid-cols-2 gap-10 max-md:grid-cols-1">
            <Section className="!mt-0" title="clouds by state" action={<Link to="/admin/clouds" className="hover-link text-13 text-ink-3 underline-offset-4 hover:underline">all clouds</Link>}>
              {data.clouds.length ? (
                <ul className="divide-y divide-line">
                  {data.clouds.map((row) => (
                    <li key={row.state} className="flex h-11 items-center justify-between gap-3"><Status value={row.state} /><span className="font-mono text-14 text-ink num">{n(row.count)}</span></li>
                  ))}
                </ul>
              ) : <p className="text-14 text-ink-3">no clouds yet.</p>}
              <p className="mt-4 text-13 text-ink-3">instabox spend: not shown yet. {data.spend.note}.</p>
            </Section>
            <Section className="!mt-0" title="bots, across connected workspaces">
              <ul className="divide-y divide-line">
                <li className="flex h-11 items-center justify-between"><span className="text-14 text-ink-2">workspaces with an owner</span><span className="font-mono text-14 num">{n(data.bots.workspaces)}</span></li>
                <li className="flex h-11 items-center justify-between"><span className="text-14 text-ink-2">bots</span><span className="font-mono text-14 num">{n(data.bots.bots)}</span></li>
                <li className="flex h-11 items-center justify-between"><span className="text-14 text-ink-2">bot replies, last 30 days</span><span className="font-mono text-14 num">{n(data.bots.turns30d)}</span></li>
              </ul>
              <p className="mt-4 text-13 text-ink-3">counts only. dusk bot never sends message content here.</p>
            </Section>
          </div>
        </>
      )}
    </>
  );
}
