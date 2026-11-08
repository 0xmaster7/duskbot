import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, Blocks, ChevronRight, Code, Download, Smartphone } from "lucide-react";
import type { WorkspaceDetail, WorkspaceSummary } from "../../../shared/dashboard-protocol";
import { cloudForWorkspace, useCloud } from "../data/cloud";
import { useWorkspaceDetail } from "../data/detail";
import type { CloudDesktop } from "../data/contracts";
import { useSession } from "../data/session";
import { useAccountUsage } from "../data/usage";
import { ago, compact, percent, plural, usd } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { API_DOCS, DOWNLOAD_URL } from "../lib/usage";
import { Heatmap, HeatStats, type HeatMetric } from "../ui/Heatmap";
import { Card, FreshnessTag, Segmented, Skeleton } from "../ui/kit";
import { BotMascot } from "../ui/Mascot";
import { KIND_LABEL } from "../ui/Shell";
import { CloudPitch, CloudStatus, PowerButton, Provisioning, regionName, tierName, workspaceIcon } from "./cloud-bits";

function Big({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-13 text-ink-3">{label}</div>
      <div className="num mt-1 truncate text-28 font-medium tracking-[-0.02em] text-ink">{value}</div>
      {sub && <div className="num truncate text-13 text-ink-4">{sub}</div>}
    </div>
  );
}

/** a cloud desktop that exists: its state, four live numbers and who is working */
function CloudLive({ cloud, detail }: { cloud: CloudDesktop; detail: WorkspaceDetail | null }) {
  const { catalog } = useCloud();
  const m = detail?.report?.machine;
  const bots = detail?.report?.bots ?? [];
  const busy = bots.filter((b) => b.busy);
  const used = detail?.report?.computers?.computers.length ?? cloud.botComputers.used;
  const mem = m ? (m.memory.usedBytes / Math.max(1, m.memory.totalBytes)) * 100 : null;
  const on = cloud.status === "running";
  return (
    <Card className="enter" aria-labelledby="cloud-live-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-13 text-ink-3">Cloud desktop</div>
          <h2 id="cloud-live-title" className="mt-0.5 truncate text-20 font-semibold tracking-[-0.015em] text-ink">{cloud.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <CloudStatus cloud={cloud} />
            <span className="text-13 text-ink-4">{tierName(catalog, cloud)} · {regionName(catalog, cloud.region)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PowerButton cloud={cloud} />
          <Link to="/cloud" className="press hover-primary inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3.5 text-13 font-medium text-primary-ink max-sm:h-11">Open <ChevronRight size={15} strokeWidth={1.75} aria-hidden /></Link>
        </div>
      </div>
      {cloud.status === "provisioning" ? (
        <div className="mt-7 max-w-[520px]"><Provisioning cloud={cloud} /></div>
      ) : (
        <div className="mt-7 grid grid-cols-4 gap-6 max-md:grid-cols-2">
          <Big label="Working now" value={on ? busy.length : 0} sub={`of ${plural(bots.length, "bot")}`} />
          <Big label="Bot computers" value={used} sub={cloud.botComputers.limit === null ? "no limit" : `of ${cloud.botComputers.limit}`} />
          <Big label="CPU" value={m && on ? percent(m.cpu.percent) : "Idle"} sub={`${cloud.vcpu} vCPU`} />
          <Big label="Memory" value={mem !== null && on ? percent(mem) : "Idle"} sub={`${cloud.ramGb} GB`} />
        </div>
      )}
      {on && bots.length > 0 && (
        <div className="mt-6 flex items-center gap-3 border-t border-line pt-5">
          <div className="flex -space-x-1.5">{bots.slice(0, 5).map((b) => <BotMascot key={b.id} bot={b} size={24} />)}</div>
          <p className="min-w-0 truncate text-13 text-ink-3">{busy.length ? `${busy.map((b) => b.name).join(" and ")} ${busy.length === 1 ? "is" : "are"} working right now.` : "Everyone is ready. They keep going while your Mac sleeps."}</p>
        </div>
      )}
    </Card>
  );
}

/** one workspace and its live state: bots at work, and the machine's load when it reports */
function WorkspaceRow({ w, cloud }: { w: WorkspaceSummary; cloud: CloudDesktop | null }) {
  const { now, pick } = useSession();
  const detail = useWorkspaceDetail(w.id);
  const bots = detail?.report?.bots ?? [];
  const working = bots.filter((b) => b.busy).length;
  const m = detail?.report?.machine;
  const fresh = w.freshness === "live" || w.freshness === "recent";
  const botLine = !detail ? null : bots.length ? `${plural(bots.length, "bot")}${working && fresh ? `, ${working} working` : ""}` : "No bots yet";
  const load = m && fresh ? `CPU ${percent(m.cpu.percent)} · Memory ${percent((m.memory.usedBytes / Math.max(1, m.memory.totalBytes)) * 100)}` : null;
  return (
    <li>
      <button type="button" onClick={() => { pick(w.id); navigate(cloud ? "/cloud" : `/workspaces/${encodeURIComponent(w.id)}`); }} className="press-soft hover-row grid w-full grid-cols-[minmax(0,1fr)_130px_180px_150px_16px] items-center gap-4 rounded-row px-3 py-3 text-start max-md:grid-cols-[minmax(0,1fr)_auto_16px]">
        <span className="flex min-w-0 items-center gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-card-2 text-ink-2">{workspaceIcon(w, cloud)}</span>
          <span className="min-w-0">
            <span className="block truncate text-14 text-ink">{w.name}</span>
            <span className="block truncate text-13 text-ink-3">{KIND_LABEL(w.kind, cloud)}<span className="md:hidden">{botLine ? ` · ${botLine}` : ""}</span></span>
          </span>
        </span>
        <span className="num truncate text-13 text-ink-2 max-md:hidden">{botLine ?? <span className="skeleton inline-block h-4 w-20" aria-hidden />}</span>
        <span className="num truncate text-13 text-ink-3 max-md:hidden">{load ?? (detail ? <span className="text-ink-4">No live stats</span> : <span className="skeleton inline-block h-4 w-28" aria-hidden />)}</span>
        <FreshnessTag freshness={w.freshness} at={w.lastReportAt} now={now} className="justify-end max-sm:[&>span:last-child]:hidden" />
        <ChevronRight size={16} strokeWidth={1.5} className="shrink-0 text-ink-4" aria-hidden />
      </button>
    </li>
  );
}

function Workspaces() {
  const { workspaces } = useSession();
  const { clouds } = useCloud();
  return (
    <Card className="enter !p-3" style={{ ["--i" as string]: 1 }} aria-labelledby="ws-title">
      <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-2">
        <h2 id="ws-title" className="text-14 font-medium text-ink">Your workspaces</h2>
        <Link to="/workspaces" className="hover-link inline-flex h-8 items-center rounded-full px-1 text-13 text-ink-3">Manage</Link>
      </div>
      {workspaces === null ? (
        <div className="flex flex-col gap-2 p-3"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : workspaces.length === 0 ? (
        <p className="px-3 py-4 text-14 text-ink-3">Nothing connected yet. <Link to="/workspaces#add" className="hover-link text-ink-2 underline decoration-line-2 underline-offset-4">Connect your Mac</Link> to see it here.</p>
      ) : (
        <ul>{workspaces.map((w) => <WorkspaceRow key={w.id} w={w} cloud={cloudForWorkspace(clouds, w.id)} />)}</ul>
      )}
    </Card>
  );
}

function Tile({ icon, title, body, to, external }: { icon: ReactNode; title: string; body: string; to: string; external?: boolean }) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <span className="text-ink-2">{icon}</span>
        <ArrowUpRight size={16} strokeWidth={1.5} className="tile-arrow text-ink-4" aria-hidden />
      </div>
      <div className="mt-5 text-14 font-medium text-ink">{title}</div>
      <div className="mt-1 text-13 leading-[1.45] text-ink-3">{body}</div>
    </>
  );
  const cls = "press-soft hover-tile block rounded-card bg-card p-5";
  return external ? <a href={to} className={cls} target="_blank" rel="noreferrer">{inner}</a> : <Link to={to} className={cls}>{inner}</Link>;
}

const ICON = { size: 20, strokeWidth: 1.5 } as const;

function Activity({ detail, now }: { detail: WorkspaceDetail; now: number }) {
  const [metric, setMetric] = useState<HeatMetric>("turns");
  const activity = detail.report?.activity;
  const days = activity?.days ?? [];
  const total = metric === "turns" ? (activity?.totals.turns ?? 0).toLocaleString("en-US") : metric === "tokens" ? compact(activity?.totals.tokens ?? 0) : usd(activity?.totals.costUsd ?? 0);
  return (
    <Card className="enter" style={{ ["--i" as string]: 3 }} aria-labelledby="activity-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="activity-title" className="text-14 text-ink-2">{metric === "turns" ? "Bot turns" : metric === "tokens" ? "Tokens" : "Estimated spend"} on {detail.workspace.name}</h2>
          <p className="num mt-1 text-28 font-medium tracking-[-0.02em] text-ink">{total}</p>
        </div>
        <Segmented<HeatMetric> label="Measure" value={metric} onChange={setMetric} options={[{ value: "turns", label: "Turns" }, { value: "tokens", label: "Tokens" }, { value: "spend", label: "Spend" }]} />
      </div>
      <div className="mt-6"><Heatmap days={days} metric={metric} now={now} /></div>
      <div className="mt-7 border-t border-line pt-5"><HeatStats days={days} metric={metric} now={now} /></div>
    </Card>
  );
}

/** the bots that ran last, across every workspace */
function Recent() {
  const { now } = useSession();
  const { bots } = useAccountUsage();
  const rows = useMemo(() => bots.filter((r) => r.bot.lastActiveAt).sort((a, b) => Number(b.bot.busy) - Number(a.bot.busy) || (b.bot.lastActiveAt ?? 0) - (a.bot.lastActiveAt ?? 0)).slice(0, 5), [bots]);
  if (!rows.length) return null;
  return (
    <Card className="enter !p-3" style={{ ["--i" as string]: 4 }} aria-labelledby="recent-title">
      <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-2">
        <h2 id="recent-title" className="text-14 font-medium text-ink">Recent activity</h2>
        <Link to="/bots" className="hover-link inline-flex h-8 items-center rounded-full px-1 text-13 text-ink-3">All bots</Link>
      </div>
      <ul className="divide-y divide-line px-3">
        {rows.map(({ bot, where }) => (
          <li key={`${where}-${bot.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 md:grid-cols-[minmax(0,1fr)_200px_130px]">
            <span className="flex min-w-0 items-center gap-3">
              <BotMascot bot={bot} size={24} />
              <span className="min-w-0">
                <span className="block truncate text-14 text-ink">{bot.name}<span className="text-ink-3"> on {where}</span></span>
                {bot.model && <span className="block truncate text-13 text-ink-4 md:hidden">{bot.model}</span>}
              </span>
            </span>
            <span className="truncate text-13 text-ink-3 max-md:hidden">{bot.model ?? ""}</span>
            <span className="num text-end text-13 text-ink-3">{bot.busy ? <span className="text-good">Working now</span> : ago(bot.lastActiveAt, now)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function HomePage() {
  const { account, now, detail, workspaces } = useSession();
  const { clouds } = useCloud();
  const name = account?.name || account?.email.split("@")[0] || "";
  const cloud = clouds?.[0] ?? null;
  const cloudDetail = useWorkspaceDetail(cloud?.workspaceId ?? null);
  return (
    <div>
      <h1 className="enter mb-8 text-28 font-semibold tracking-[-0.025em] text-ink max-sm:mb-6 max-sm:text-24">Welcome, {name}.</h1>
      <div className="flex flex-col gap-4">
        {clouds === null ? <Skeleton className="h-[200px] !rounded-card" /> : cloud ? <CloudLive cloud={cloud} detail={cloudDetail} /> : <CloudPitch />}
        <Workspaces />
        <div className="enter grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:gap-3" style={{ ["--i" as string]: 2 }}>
          <Tile icon={<Download {...ICON} />} title="Download the app" body="For Mac. Your bots, chats and their computers." to={DOWNLOAD_URL} external />
          <Tile icon={<Smartphone {...ICON} />} title="Link your phone" body="Chat with your bots from anywhere." to="/account#devices" />
          <Tile icon={<Blocks {...ICON} />} title="Connectors" body="Gmail, Slack, GitHub and hundreds more." to="/connectors" />
          <Tile icon={<Code {...ICON} />} title="API" body="Drive your bots from your own scripts." to={API_DOCS} external />
        </div>
        {detail?.report?.activity && workspaces?.length ? <Activity detail={detail} now={now} /> : null}
        <Recent />
      </div>
    </div>
  );
}
