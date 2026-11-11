import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, Blocks, ChevronRight, Cloud, Download, Smartphone } from "@/icons";
import type { WorkspaceDetail } from "../../../../shared/dashboard-protocol";
import cloudLemon from "../art/cloud-lemon.png";
import cloudPink from "../art/cloud-pink.png";
import poster from "../art/wide-layers.webp";
import { useCloud } from "../data/cloud";
import { useWorkspaceDetail } from "../data/detail";
import type { CloudDesktop } from "../data/contracts";
import { MOOD_LABEL, type BotMood } from "../data/mood";
import { useSession } from "../data/session";
import { useAccountUsage, type BotRow } from "../data/usage";
import { ago, compact, percent, plural, usd } from "../lib/format";
import { Link } from "../lib/router";
import { DOWNLOAD_URL } from "../lib/usage";
import { Heatmap, HeatStats, type HeatMetric } from "../ui/Heatmap";
import { Card, cx, Segmented, Skeleton } from "../ui/kit";
import { BotMascot, Mascot } from "../ui/Mascot";
import { CloudPitch, CloudStatus, PowerButton, Provisioning, regionName, tierName } from "./cloud-bits";
import { PlanSheet } from "./plan-sheet";
import { useNow } from "../lib/now";
import { LoadError } from "./common";
import { Figure } from "../ui/Figure";

const ORDER: Record<BotMood, number> = { working: 0, waking: 1, idle: 2, drowsy: 3, sleeping: 4 };
const DOT: Record<BotMood, string> = { working: "text-good", waking: "text-warn", idle: "text-accent", drowsy: "text-ink-4", sleeping: "text-ink-4" };

/** every bot on every workspace, standing in one picture: each one shows what it is doing right now */
function Crew({ rows }: { rows: BotRow[] }) {
  const shown = useMemo(() => [...rows].sort((a, b) => ORDER[a.mood] - ORDER[b.mood] || (b.bot.lastActiveAt ?? 0) - (a.bot.lastActiveAt ?? 0)).slice(0, 8), [rows]);
  const working = rows.filter((r) => r.mood === "working").length;
  return (
    <section className="enter relative isolate overflow-hidden rounded-card bg-[#3fbdfb]" aria-labelledby="crew-title">
      <img src={poster} alt="" className="absolute inset-0 -z-10 size-full object-cover object-[center_76%]" draggable={false} />
      <img src={cloudPink} alt="" width={240} height={80} className="pixel-art cloud-drift absolute left-[8%] top-5 -z-10 w-[104px]" style={{ ["--drift" as string]: "120px", ["--dur" as string]: "44s" }} draggable={false} />
      <img src={cloudLemon} alt="" width={240} height={80} className="pixel-art cloud-drift absolute right-[14%] top-10 -z-10 w-[76px] max-sm:hidden" style={{ ["--drift" as string]: "-90px", ["--dur" as string]: "58s" }} draggable={false} />
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <h2 id="crew-title" className="flex h-7 items-center gap-2 rounded-full bg-white px-3 text-13 font-medium text-[#131316]"><span className={cx("live-dot", working ? "text-[#12894a]" : "text-[#91919b]")} data-live={working > 0} />{working ? `${working} of ${plural(rows.length, "bot")} working` : `${plural(rows.length, "bot")}, all quiet`}</h2>
        <Link to="/bots" className="press inline-flex h-7 items-center gap-0.5 rounded-full bg-white ps-3 pe-2 text-13 font-medium text-[#131316]">all bots<ChevronRight size={14} strokeWidth={2} aria-hidden /></Link>
      </div>
      <ul className="scroll-x flex items-end gap-x-7 px-6 pb-5 pt-9 sm:justify-center max-sm:gap-x-4">
        {shown.map(({ bot, where, mood }, i) => (
          <li key={`${where}-${bot.id}`} className="peek flex shrink-0 flex-col items-center gap-2.5" style={{ ["--i" as string]: i }}>
            <BotMascot bot={bot} mood={mood} size={i % 3 === 1 ? 84 : 72} track={640} tappable />
            <span className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-3 text-13 text-[#131316]">
              <span className={cx("live-dot", DOT[mood])} data-live={mood === "working"} aria-hidden />
              <b className="font-medium">{bot.name}</b>
              <span className="text-[#6c6c77]">{MOOD_LABEL[mood]}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** nobody here yet: the same picture with one bot asleep in it, and the way to get the first one */
function CrewEmpty() {
  return (
    <section className="enter relative isolate overflow-hidden rounded-card bg-[#3fbdfb]" aria-labelledby="crew-empty-title">
      <img src={poster} alt="" className="absolute inset-0 -z-10 size-full object-cover object-[center_76%]" draggable={false} />
      <img src={cloudPink} alt="" width={240} height={80} className="pixel-art cloud-drift absolute right-[30%] top-6 -z-10 w-[104px] max-sm:hidden" style={{ ["--drift" as string]: "90px", ["--dur" as string]: "44s" }} draggable={false} />
      <div className="flex items-end justify-between gap-6 p-5 max-sm:flex-col max-sm:items-start">
        <div className="pop max-w-[380px] rounded-[20px] bg-white p-5 text-[#131316]">
          <h2 id="crew-empty-title" className="text-20 font-medium tracking-[-0.03em]">your bots will hang out here.</h2>
          <p className="mt-1 text-14 text-[#4b4b55]">make one in the app and it shows up in a few seconds, with what it's doing.</p>
          <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer" className="press mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-[#131316] px-4.5 text-14 font-medium text-white"><Download size={16} strokeWidth={1.75} aria-hidden />get the app</a>
        </div>
        <div className="flex shrink-0 items-end gap-5 pe-6 max-sm:self-center max-sm:pe-0" aria-hidden>
          <span className="peek relative" style={{ ["--i" as string]: 0 }}><Mascot body="moon" color="purple" size={64} state="sleeping" /><span className="absolute -right-1 -top-2"><i className="zz not-italic !text-white">z</i><i className="zz not-italic !text-white">z</i><i className="zz not-italic !text-white">z</i></span></span>
          <span className="peek" style={{ ["--i" as string]: 1 }}><Mascot body="circle" color="blue" size={92} state="curious" track={900} tappable /></span>
          <span className="peek" style={{ ["--i" as string]: 2 }}><Mascot body="heart" color="pink" size={70} state="idle" track={900} tappable /></span>
        </div>
      </div>
    </section>
  );
}

function Big({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-13 text-ink-3">{label}</div>
      <div className="mt-1.5"><Figure value={value} /></div>
      {sub && <div className="num t-meta truncate">{sub}</div>}
    </div>
  );
}

/** a cloud desktop that exists: its state and four live numbers */
function CloudLive({ cloud, detail }: { cloud: CloudDesktop; detail: WorkspaceDetail | null }) {
  const { catalog } = useCloud();
  const m = detail?.report?.machine;
  const bots = detail?.report?.bots ?? [];
  const busy = bots.filter((b) => b.busy);
  const used = detail?.report?.computers?.computers.length ?? cloud.botComputers.used;
  const mem = m ? (m.memory.usedBytes / Math.max(1, m.memory.totalBytes)) * 100 : null;
  const on = cloud.status === "running";
  return (
    <Card className="enter" style={{ ["--i" as string]: 1 }} aria-labelledby="cloud-live-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="t-meta">cloud desktop</div>
          <h2 id="cloud-live-title" className="mt-1 truncate text-24 font-medium tracking-[-0.035em] text-ink">{cloud.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <CloudStatus cloud={cloud} />
            <span className="text-13 text-ink-3">{tierName(catalog, cloud)} · {regionName(catalog, cloud.region)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PowerButton cloud={cloud} />
          <Link to="/cloud" className="press hover-primary inline-flex h-9 items-center gap-1 rounded-full bg-primary ps-4 pe-3 text-13 font-medium text-primary-ink max-sm:h-11">open <ChevronRight size={15} strokeWidth={1.75} aria-hidden /></Link>
        </div>
      </div>
      {cloud.status === "provisioning" ? (
        <div className="mt-7 max-w-[520px]"><Provisioning cloud={cloud} /></div>
      ) : (
        <div className="mt-7 grid grid-cols-4 gap-6 max-md:grid-cols-2">
          <Big label="working now" value={on ? busy.length : 0} sub={`of ${plural(bots.length, "bot")}`} />
          <Big label="bot computers" value={used} sub={cloud.botComputers.limit === null ? "no limit" : `of ${cloud.botComputers.limit}`} />
          <Big label="cpu" value={m && on ? percent(m.cpu.percent) : "idle"} sub={`${cloud.vcpu} vcpu`} />
          <Big label="memory" value={mem !== null && on ? percent(mem) : "idle"} sub={`${cloud.ramGb} gb`} />
        </div>
      )}
    </Card>
  );
}

const TINT = { sky: "bg-sky", lime: "bg-lime", rose: "bg-rose", lemon: "bg-lemon" } as const;

function Tile({ icon, tint, title, body, to, external, onClick }: { icon: ReactNode; tint: keyof typeof TINT; title: string; body: string; to?: string; external?: boolean; onClick?(): void }) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <span className={cx("grid size-11 place-items-center rounded-[14px] text-ink", TINT[tint])}>{icon}</span>
        <ArrowUpRight size={17} strokeWidth={1.75} className="tile-arrow text-ink-4" aria-hidden />
      </div>
      <div className="mt-5 text-16 font-medium tracking-[-0.02em] text-ink">{title}</div>
      <div className="mt-1 text-13 leading-[1.45] text-ink-3">{body}</div>
    </>
  );
  const cls = "press-soft hover-tile block rounded-card bg-card p-5 text-start";
  if (onClick || !to) return <button type="button" className={cls} onClick={onClick}>{inner}</button>;
  return external ? <a href={to} className={cls} target="_blank" rel="noreferrer">{inner}</a> : <Link to={to} className={cls}>{inner}</Link>;
}

const ICON = { size: 20, strokeWidth: 1.75 } as const;

function Activity({ detail, now }: { detail: WorkspaceDetail; now: number }) {
  const [metric, setMetric] = useState<HeatMetric>("turns");
  const activity = detail.report?.activity;
  const days = activity?.days ?? [];
  const total = metric === "turns" ? (activity?.totals.turns ?? 0).toLocaleString("en-US") : metric === "tokens" ? compact(activity?.totals.tokens ?? 0) : usd(activity?.totals.costUsd ?? 0);
  return (
    <Card className="enter" style={{ ["--i" as string]: 3 }} aria-labelledby="activity-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="activity-title" className="text-14 text-ink-2">{metric === "turns" ? "bot turns" : metric === "tokens" ? "tokens" : "estimated spend"} on {detail.workspace.name}</h2>
          <p className="mt-1.5"><Figure value={total} /></p>
        </div>
        <Segmented<HeatMetric> label="measure" value={metric} onChange={setMetric} options={[{ value: "turns", label: "turns" }, { value: "tokens", label: "tokens" }, { value: "spend", label: "spend" }]} />
      </div>
      <div key={metric} className="swap-in mt-6"><Heatmap days={days} metric={metric} now={now} /></div>
      <div className="mt-7 border-t border-line pt-5"><HeatStats days={days} metric={metric} now={now} /></div>
    </Card>
  );
}

/** the bots that ran last, across every workspace */
function Recent({ rows: all }: { rows: BotRow[] }) {
  const now = useNow();
  const rows = useMemo(() => all.filter((r) => r.bot.lastActiveAt).sort((a, b) => Number(b.bot.busy) - Number(a.bot.busy) || (b.bot.lastActiveAt ?? 0) - (a.bot.lastActiveAt ?? 0)).slice(0, 5), [all]);
  if (!rows.length) return null;
  return (
    <Card className="enter !p-3" style={{ ["--i" as string]: 4 }} aria-labelledby="recent-title">
      <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-2">
        <h2 id="recent-title" className="text-16 font-medium tracking-[-0.02em] text-ink">who ran last</h2>
      </div>
      <ul className="divide-y divide-line px-3">
        {rows.map(({ bot, where, mood }) => (
          <li key={`${where}-${bot.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 md:grid-cols-[minmax(0,1fr)_200px_130px]">
            <span className="flex min-w-0 items-center gap-3">
              <BotMascot bot={bot} mood={mood} size={30} />
              <span className="min-w-0">
                <span className="block truncate text-14 text-ink">{bot.name}<span className="text-ink-3"> on {where}</span></span>
                {bot.model && <span className="block truncate text-13 text-ink-4 md:hidden">{bot.model}</span>}
              </span>
            </span>
            <span className="t-id truncate text-ink-3 max-md:hidden">{bot.model ?? ""}</span>
            <span className="num text-end text-13 text-ink-3">{bot.busy ? <span className="text-good">working now</span> : ago(bot.lastActiveAt, now)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function HomePage() {
  const { account, detail, workspaces } = useSession();
  const now = useNow(60_000);
  const { clouds, error, refresh } = useCloud();
  const { bots, loading } = useAccountUsage();
  const name = account?.name || account?.email.split("@")[0] || "";
  const cloud = clouds?.[0] ?? null;
  const cloudDetail = useWorkspaceDetail(cloud?.workspaceId ?? null);
  const [plan, setPlan] = useState(false);
  return (
    <div>
      {plan && <PlanSheet source="dash_home" start="starter" onClose={() => setPlan(false)} />}
      <h1 className="t-title enter mb-8 max-sm:mb-6">hi {name}.</h1>
      <div className="flex flex-col gap-4">
        {bots.length ? <Crew rows={bots} /> : loading ? <Skeleton className="h-[226px] !rounded-card" /> : <CrewEmpty />}
        {error && clouds === null ? <LoadError error={error} retry={refresh} /> : clouds === null ? <Skeleton className="h-[200px] !rounded-card" /> : cloud ? <CloudLive cloud={cloud} detail={cloudDetail} /> : <CloudPitch source="dash_home" />}
        <div className="enter grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:gap-3" style={{ ["--i" as string]: 2 }}>
          <Tile tint="sky" icon={<Download {...ICON} />} title="get the app" body="your bots, chats and their computers." to={DOWNLOAD_URL} external />
          <Tile tint="lime" icon={<Cloud {...ICON} />} title="cloud desktop" body={cloud ? `open ${cloud.name}, on 24/7.` : "keep your bots on 24/7."} {...(cloud ? { to: "/cloud" } : { onClick: () => setPlan(true) })} />
          <Tile tint="rose" icon={<Smartphone {...ICON} />} title="link your phone" body="text your bots from anywhere." to="/account#devices" />
          <Tile tint="lemon" icon={<Blocks {...ICON} />} title="connectors" body="gmail, slack, github and hundreds more." to="/connectors" />
        </div>
        {detail?.report?.activity && workspaces?.length ? <Activity detail={detail} now={now} /> : null}
        <Recent rows={bots} />
      </div>
    </div>
  );
}
