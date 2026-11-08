import { useMemo, useState, type ReactNode } from "react";
import { AppWindow, ArrowUpRight, Cloud, Code, Smartphone } from "lucide-react";
import type { ActivityReport, WorkspaceDetail } from "../../../shared/dashboard-protocol";
import { useSession } from "../data/session";
import { bytes, compact, dayKey, percent, plural, rate, shortDate, usd } from "../lib/format";
import { Link } from "../lib/router";
import { Badge, Bar, ButtonLink, Card, cx, FreshnessTag, Segmented } from "../ui/kit";
import { Heatmap, HeatStats, type HeatMetric } from "../ui/Heatmap";
import { Crew } from "../ui/Sky";
import { WorkspaceGate } from "./common";

export const APP_LINK = "openmausbot://";
export const API_DOCS = "https://github.com/SiddDevZ/OpenMausBot/blob/custom/docs/bot-api.md";

export function monthTotals(activity: ActivityReport | undefined, now: number) {
  const month = dayKey(now).slice(0, 7);
  let turns = 0, tokens = 0, cost = 0, priced = false;
  for (const d of activity?.days ?? []) {
    if (!d.date.startsWith(month)) continue;
    turns += d.turns; tokens += d.tokens;
    if (d.costUsd !== null) { cost += d.costUsd; priced = true; }
  }
  return { turns, tokens, costUsd: priced ? cost : null };
}

function PlanCard({ detail, now }: { detail: WorkspaceDetail; now: number }) {
  const providers = detail.report?.plans?.providers ?? [];
  const plan = providers.find((p) => p.ok && p.windows.length) ?? null;
  const win = plan ? [...plan.windows].sort((a, b) => b.usedPercent - a.usedPercent)[0]! : null;
  const month = monthTotals(detail.report?.activity, now);
  return (
    <Card className="flex flex-col">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <span className="text-14 text-ink-2">{plan ? `${plan.name}${plan.plan ? ` · ${plan.plan}` : ""}` : "This month"}</span>
        {providers.length > 1 && <Link to="/usage" className="text-13 text-ink-3 hover:text-ink-2">{plural(providers.length, "account")}</Link>}
      </div>
      {win ? (
        <>
          <p className="mt-3 flex items-baseline gap-1.5"><span className="num text-28 font-medium tracking-[-0.02em] text-ink">{percent(win.usedPercent)}</span><span className="text-14 text-ink-3">used</span></p>
          <Bar value={win.usedPercent} tone={win.usedPercent >= 90 ? "warn" : "ink"} className="mt-5" label={`${win.label} window used`} />
          <div className="mt-3 flex justify-between gap-3 text-13 text-ink-3">
            <span>{win.label} included usage</span>
            {win.resetsAt && <span className="num">Resets {shortDate(win.resetsAt)}</span>}
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 flex items-baseline gap-1.5"><span className="num text-28 font-medium tracking-[-0.02em] text-ink">{month.turns.toLocaleString("en-US")}</span><span className="text-14 text-ink-3">{month.turns === 1 ? "turn" : "turns"} this month</span></p>
          <Bar value={0} className="mt-5 opacity-0" />
          <div className="mt-3 text-13 text-ink-3">{compact(month.tokens)} tokens. Plan limits show here once an engine reports them.</div>
        </>
      )}
    </Card>
  );
}

function SpendCard({ detail, now }: { detail: WorkspaceDetail; now: number }) {
  const month = monthTotals(detail.report?.activity, now);
  const next = new Date(new Date(now).getFullYear(), new Date(now).getMonth() + 1, 1);
  return (
    <Card className="flex flex-col">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <span className="text-14 text-ink-2">Account balance</span>
        <div className="flex items-center gap-2">
          <ButtonLink to="/billing" size="sm" className="max-sm:hidden">Spending caps</ButtonLink>
          <ButtonLink to="/billing" size="sm" variant="primary">Buy credits</ButtonLink>
        </div>
      </div>
      <p className="mt-3 flex items-baseline gap-1.5"><span className="num text-28 font-medium tracking-[-0.02em] text-ink">{usd(month.costUsd ?? 0)}</span><span className="text-14 text-ink-3">used this month</span></p>
      <dl className="mt-4 text-14">
        <div className="flex justify-between gap-3 py-1.5 text-13 text-ink-3"><dt className="min-w-0 truncate">Estimated from token prices</dt><dd className="num shrink-0 whitespace-nowrap">Resets {shortDate(next)}</dd></div>
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-ink-3">Monthly spending cap</dt><dd className="text-ink">Not set · <Link to="/billing" className="text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink">Edit</Link></dd></div>
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-ink-3">Credits available</dt><dd className="flex items-center gap-2"><Badge className="!h-5 !px-2 !text-[11px]">Preview</Badge><span className="num text-ink">$0.00</span></dd></div>
      </dl>
    </Card>
  );
}

function Tile({ icon, title, body, to, external }: { icon: ReactNode; title: string; body: string; to: string; external?: boolean }) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <span className="text-ink-2">{icon}</span>
        <ArrowUpRight size={16} strokeWidth={1.5} className="tile-arrow text-ink-4 transition-colors duration-150" aria-hidden />
      </div>
      <div className="mt-6 text-14 font-medium text-ink">{title}</div>
      <div className="mt-1 text-13 leading-[1.45] text-ink-3">{body}</div>
    </>
  );
  const cls = "press-soft hover-tile block rounded-card bg-card p-5 transition-colors duration-150";
  return external ? <a href={to} className={cls} target={to.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{inner}</a> : <Link to={to} className={cls}>{inner}</Link>;
}

const ICON = { size: 20, strokeWidth: 1.5 } as const;

function ActivityCard({ detail, now }: { detail: WorkspaceDetail; now: number }) {
  const [metric, setMetric] = useState<HeatMetric>("turns");
  const activity = detail.report?.activity;
  const days = activity?.days ?? [];
  const total = metric === "turns" ? (activity?.totals.turns ?? 0).toLocaleString("en-US") : metric === "tokens" ? compact(activity?.totals.tokens ?? 0) : usd(activity?.totals.costUsd ?? 0);
  return (
    <Card aria-labelledby="activity-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="activity-title" className="text-14 text-ink-2">{metric === "turns" ? "Bot turns" : metric === "tokens" ? "Tokens" : "Estimated spend"}</h2>
          <p className="num mt-1.5 text-28 font-medium tracking-[-0.02em] text-ink">{total}</p>
        </div>
        <Segmented<HeatMetric> label="Measure" value={metric} onChange={setMetric} options={[{ value: "turns", label: "Turns" }, { value: "tokens", label: "Tokens" }, { value: "spend", label: "Spend" }]} />
      </div>
      <div className="mt-6"><Heatmap days={days} metric={metric} now={now} /></div>
      <div className="mt-7"><HeatStats days={days} metric={metric} now={now} /></div>
    </Card>
  );
}

function CloudCard({ detail, now }: { detail: WorkspaceDetail; now: number }) {
  const m = detail.report?.machine;
  const computers = detail.report?.computers?.computers ?? [];
  const running = computers.filter((c) => c.state === "running").length;
  const memPct = m ? (m.memory.usedBytes / Math.max(1, m.memory.totalBytes)) * 100 : 0;
  const diskPct = m?.disk ? (m.disk.usedBytes / Math.max(1, m.disk.totalBytes)) * 100 : 0;
  const metrics = [
    { label: "CPU", value: m ? percent(m.cpu.percent) : "n/a", bar: m?.cpu.percent ?? 0 },
    { label: "Memory", value: m ? `${bytes(m.memory.usedBytes)} of ${bytes(m.memory.totalBytes)}` : "n/a", bar: memPct },
    { label: "Disk", value: m?.disk ? `${percent(diskPct)} used` : "n/a", bar: diskPct },
    { label: "Network", value: m?.network ? `${rate(m.network.rxBytesPerSec)} in` : "n/a", bar: null },
  ];
  return (
    <Card aria-labelledby="cloud-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Cloud size={20} strokeWidth={1.5} className="shrink-0 text-ink-2" aria-hidden />
          <h2 id="cloud-title" className="truncate text-14 font-medium text-ink">{detail.workspace.name}</h2>
          <FreshnessTag freshness={detail.workspace.freshness} at={detail.workspace.lastReportAt} now={now} />
        </div>
        <ButtonLink to="/cloud" size="sm">Open My Cloud</ButtonLink>
      </div>
      <div className="mt-6 grid grid-cols-4 gap-6 max-md:grid-cols-2">
        {metrics.map((x) => (
          <div key={x.label} className="min-w-0">
            <div className="text-13 text-ink-3">{x.label}</div>
            <div className="num mt-1 truncate text-14 text-ink">{x.value}</div>
            {x.bar !== null ? <Bar value={x.bar} className="mt-3" label={`${x.label} used`} /> : <div className="mt-3 h-1" />}
          </div>
        ))}
      </div>
      {computers.length > 0 && (
        <p className="mt-5 text-13 text-ink-3">{plural(computers.length, "bot computer")}, {running} running. {m?.update?.available ? `Update ${m.update.latest ?? ""} available.` : ""}</p>
      )}
    </Card>
  );
}

export function OverviewPage() {
  const { account, now, workspaces } = useSession();
  const name = account?.email.split("@")[0] ?? "";
  return (
    <div>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-6 max-sm:mb-6">
        <h1 className="enter text-34 font-medium tracking-[-0.025em] text-ink max-sm:text-28">Welcome, {name}.</h1>
        <OverviewCrew />
      </header>
      <WorkspaceGate>
        {(detail) => (
          <div className="flex flex-col gap-4">
            <div className="enter grid gap-4 md:grid-cols-2" style={{ ["--i" as string]: 1 }}>
              <PlanCard detail={detail} now={now} />
              <SpendCard detail={detail} now={now} />
            </div>
            <p className="-mt-1 px-6 text-13 text-ink-4 max-sm:px-1">Plans come from the AI accounts your bots sign in with. Spend is an estimate until billing goes live.</p>
            <div className="enter mt-3 grid grid-cols-4 gap-4 max-lg:grid-cols-2" style={{ ["--i" as string]: 2 }}>
              <Tile icon={<AppWindow {...ICON} />} title="Open the app" body="Your bots, chats and their computers." to={APP_LINK} external />
              <Tile icon={<Smartphone {...ICON} />} title="Mobile app" body="Pair your phone and chat from anywhere." to="/devices" />
              <Tile icon={<Cloud {...ICON} />} title="My Cloud" body="Your server and bot computers, live." to="/cloud" />
              <Tile icon={<Code {...ICON} />} title="API" body="Drive your bots from your own scripts." to={API_DOCS} external />
            </div>
            <div className="enter mt-3" style={{ ["--i" as string]: 3 }}><ActivityCard detail={detail} now={now} /></div>
            <div className="enter" style={{ ["--i" as string]: 4 }}><CloudCard detail={detail} now={now} /></div>
            {(workspaces?.length ?? 0) < 2 && (
              <Card className="enter mt-3 flex items-center gap-4 !py-5" style={{ ["--i" as string]: 5 }}>
                <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-card-2 text-ink-2" aria-hidden><Cloud size={18} strokeWidth={1.5} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-14 font-medium text-ink">Add another workspace</div>
                  <div className="text-13 text-ink-3">Your Mac and each VPS can report here side by side.</div>
                </div>
                <ButtonLink to="/connect" size="sm">Connect</ButtonLink>
              </Card>
            )}
          </div>
        )}
      </WorkspaceGate>
    </div>
  );
}

function OverviewCrew() {
  const { detail } = useSession();
  const bots = useMemo(() => [...(detail?.report?.bots ?? [])].sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)), [detail?.report?.bots]);
  return <Crew bots={bots} className={cx("max-sm:hidden")} />;
}
