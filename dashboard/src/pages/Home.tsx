import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, Blocks, ChevronRight, Code, Download, Smartphone } from "lucide-react";
import type { WorkspaceDetail } from "../../../shared/dashboard-protocol";
import { cloudForWorkspace, useCloud } from "../data/cloud";
import { useWorkspaceDetail } from "../data/detail";
import type { CloudDesktop } from "../data/contracts";
import { useSession } from "../data/session";
import { compact, percent, plural, usd } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { API_DOCS, DOWNLOAD_URL } from "../lib/usage";
import { Heatmap, HeatStats, type HeatMetric } from "../ui/Heatmap";
import { Card, cx, FreshnessTag, Segmented, Skeleton } from "../ui/kit";
import { BotMascot } from "../ui/Mascot";
import { Nightshift } from "../ui/Nightshift";
import { KIND_LABEL } from "../ui/Shell";
import { Crew, Stars } from "../ui/Sky";
import { CloudStatus, PowerButton, Provisioning, QuickPick, regionName, tierName, workspaceIcon } from "./cloud-bits";

function Pitch() {
  const { catalog } = useCloud();
  return (
    <Card className="enter grid gap-8 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-center" style={{ ["--i" as string]: 1 }} aria-labelledby="pitch-title">
      <div className="min-w-0">
        <h2 id="pitch-title" className="text-28 font-medium tracking-[-0.02em] text-ink max-sm:text-[24px]">Keep your bots working 24/7</h2>
        <p className="mt-2 max-w-[52ch] text-14 leading-[1.6] text-ink-3">Your Mac sleeps, closes its lid and drops off Wi-Fi. A cloud desktop never does. Your bots keep answering, running their routines and using their computers around the clock. One click to set up.</p>
        {catalog ? <QuickPick catalog={catalog} className="mt-6" /> : <Skeleton className="mt-6 h-[150px]" />}
      </div>
      <Nightshift />
    </Card>
  );
}

function Big({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-13 text-ink-3">{label}</div>
      <div className="num mt-1 truncate text-28 font-medium tracking-[-0.02em] text-ink">{value}</div>
      {sub && <div className="num truncate text-13 text-ink-4">{sub}</div>}
    </div>
  );
}

function CloudLive({ cloud, detail }: { cloud: CloudDesktop; detail: WorkspaceDetail | null }) {
  const { catalog } = useCloud();
  const m = detail?.report?.machine;
  const bots = detail?.report?.bots ?? [];
  const busy = bots.filter((b) => b.busy).length;
  const used = detail?.report?.computers?.computers.length ?? cloud.botComputers.used;
  const mem = m ? (m.memory.usedBytes / Math.max(1, m.memory.totalBytes)) * 100 : null;
  return (
    <Card className="enter relative overflow-hidden" style={{ ["--i" as string]: 1 }} aria-labelledby="cloud-live-title">
      <Stars count={26} seed={17} className="left-1/2 [mask-image:linear-gradient(to_left,black,transparent)]" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-13 text-ink-3">Cloud desktop</div>
          <h2 id="cloud-live-title" className="mt-1 truncate text-28 font-medium tracking-[-0.02em] text-ink">{cloud.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <CloudStatus cloud={cloud} />
            <span className="text-13 text-ink-4">{tierName(catalog, cloud)} · {regionName(catalog, cloud.region)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PowerButton cloud={cloud} />
          <Link to="/cloud" className="press hover-primary inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3.5 text-13 font-medium text-primary-ink">Open <ChevronRight size={15} strokeWidth={1.75} aria-hidden /></Link>
        </div>
      </div>
      {cloud.status === "provisioning" ? (
        <div className="relative mt-8 max-w-[520px]"><Provisioning cloud={cloud} /></div>
      ) : (
        <div className="relative mt-8 grid grid-cols-4 gap-6 max-md:grid-cols-2">
          <Big label="Working now" value={cloud.status === "running" ? busy : 0} sub={plural(bots.length, "bot")} />
          <Big label="Bot computers" value={`${used}`} sub={cloud.botComputers.limit === null ? "no limit" : `of ${cloud.botComputers.limit}`} />
          <Big label="CPU" value={m && cloud.status === "running" ? percent(m.cpu.percent) : "Idle"} sub={`${cloud.vcpu} vCPU`} />
          <Big label="Memory" value={mem !== null && cloud.status === "running" ? percent(mem) : "Idle"} sub={`${cloud.ramGb} GB`} />
        </div>
      )}
      {cloud.status === "running" && bots.length > 0 && (
        <div className="relative mt-7 flex items-center gap-3 border-t border-line pt-5">
          <div className="flex -space-x-1.5">{bots.slice(0, 5).map((b) => <BotMascot key={b.id} bot={b} size={26} />)}</div>
          <p className="min-w-0 truncate text-13 text-ink-3">{busy ? `${bots.filter((b) => b.busy).map((b) => b.name).join(" and ")} ${busy === 1 ? "is" : "are"} working right now.` : "Everyone is ready. They keep going when your Mac sleeps."}</p>
        </div>
      )}
    </Card>
  );
}

function Workspaces() {
  const { workspaces, now, pick } = useSession();
  const { clouds } = useCloud();
  const hasCloud = Boolean(clouds?.length);
  const mac = workspaces?.find((w) => w.kind === "mac");
  return (
    <Card className="enter !p-3" style={{ ["--i" as string]: 2 }} aria-labelledby="ws-title">
      <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-2">
        <h2 id="ws-title" className="text-14 font-medium text-ink">Your workspaces</h2>
        <Link to="/workspaces" className="hover-link rounded-full px-1 text-13 text-ink-3">Manage</Link>
      </div>
      {workspaces === null ? (
        <div className="flex flex-col gap-2 p-3"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : workspaces.length === 0 ? (
        <p className="px-3 py-4 text-14 text-ink-3">Nothing connected yet. <Link to="/workspaces#add" className="text-ink-2 underline decoration-line-2 underline-offset-4">Connect your Mac</Link> or get a cloud desktop above.</p>
      ) : (
        <ul>
          {workspaces.map((w) => {
            const cloud = cloudForWorkspace(clouds, w.id);
            return (
              <li key={w.id}>
                <button type="button" onClick={() => { pick(w.id); navigate(cloud ? "/cloud" : "/bots"); }} className="press-soft hover-row flex w-full items-center gap-3.5 rounded-row px-3 py-3 text-start transition-colors duration-150">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-card-2 text-ink-2">{workspaceIcon(w, cloud)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-14 text-ink">{w.name}</span>
                    <span className="block truncate text-13 text-ink-3">{KIND_LABEL(w.kind, cloud)}</span>
                  </span>
                  <FreshnessTag freshness={w.freshness} at={w.lastReportAt} now={now} className="max-sm:hidden" />
                  <ChevronRight size={16} strokeWidth={1.5} className="shrink-0 text-ink-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!hasCloud && mac && clouds !== null && (
        <div className="mx-3 mb-2 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] border border-line px-3.5 py-3">
          <p className="min-w-[200px] flex-1 text-13 leading-[1.45] text-ink-3"><span className="text-ink-2">{mac.name}</span> sleeps at night, and your bots with it.</p>
          <Link to="/billing?bundle=pro" className="hover-link shrink-0 text-13 font-medium text-ink-2">Move them to the cloud</Link>
        </div>
      )}
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
  return external ? <a href={to} className={cls} target="_blank" rel="noreferrer">{inner}</a> : <Link to={to} className={cls}>{inner}</Link>;
}

const ICON = { size: 20, strokeWidth: 1.5 } as const;

function Activity({ detail, now }: { detail: WorkspaceDetail; now: number }) {
  const [metric, setMetric] = useState<HeatMetric>("turns");
  const activity = detail.report?.activity;
  const days = activity?.days ?? [];
  const total = metric === "turns" ? (activity?.totals.turns ?? 0).toLocaleString("en-US") : metric === "tokens" ? compact(activity?.totals.tokens ?? 0) : usd(activity?.totals.costUsd ?? 0);
  return (
    <Card aria-labelledby="activity-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="activity-title" className="text-14 text-ink-2">{metric === "turns" ? "Bot turns" : metric === "tokens" ? "Tokens" : "Estimated spend"} on {detail.workspace.name}</h2>
          <p className="num mt-1.5 text-28 font-medium tracking-[-0.02em] text-ink">{total}</p>
        </div>
        <Segmented<HeatMetric> label="Measure" value={metric} onChange={setMetric} options={[{ value: "turns", label: "Turns" }, { value: "tokens", label: "Tokens" }, { value: "spend", label: "Spend" }]} />
      </div>
      <div className="mt-6"><Heatmap days={days} metric={metric} now={now} /></div>
      <div className="mt-7"><HeatStats days={days} metric={metric} now={now} /></div>
    </Card>
  );
}

export function HomePage() {
  const { account, now, detail, workspaces } = useSession();
  const { clouds } = useCloud();
  const name = account?.name || account?.email.split("@")[0] || "";
  const cloud = clouds?.[0] ?? null;
  const cloudDetail = useWorkspaceDetail(cloud?.workspaceId ?? null);
  const bots = useMemo(() => [...(detail?.report?.bots ?? [])].sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)), [detail?.report?.bots]);
  return (
    <div>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-6 max-sm:mb-6">
        <h1 className="enter text-34 font-medium tracking-[-0.025em] text-ink max-sm:text-28">Welcome, {name}.</h1>
        <Crew bots={bots} className="max-sm:hidden" />
      </header>
      <div className="flex flex-col gap-4">
        {clouds === null ? <Skeleton className="h-[320px] !rounded-card" /> : cloud ? <CloudLive cloud={cloud} detail={cloudDetail} /> : <Pitch />}
        <Workspaces />
        <div className={cx("enter mt-3 grid grid-cols-4 gap-4 max-lg:grid-cols-2")} style={{ ["--i" as string]: 3 }}>
          <Tile icon={<Download {...ICON} />} title="Download the app" body="For Mac. Your bots, chats and their computers." to={DOWNLOAD_URL} external />
          <Tile icon={<Smartphone {...ICON} />} title="Link your phone" body="Chat with your bots from anywhere." to="/account#devices" />
          <Tile icon={<Blocks {...ICON} />} title="Connectors" body="Gmail, Slack, GitHub and hundreds more." to="/connectors" />
          <Tile icon={<Code {...ICON} />} title="API" body="Drive your bots from your own scripts." to={API_DOCS} external />
        </div>
        {detail?.report?.activity && workspaces?.length ? <div className="enter mt-3" style={{ ["--i" as string]: 4 }}><Activity detail={detail} now={now} /></div> : null}
      </div>
    </div>
  );
}
