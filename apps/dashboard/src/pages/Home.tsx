import { useMemo, type ReactNode } from "react";
import { ArrowUpRight, Bot, ChevronRight, Download, LayoutGrid, Smartphone } from "@/icons";
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
import { ago, percent, plural } from "../lib/format";
import { useNow } from "../lib/now";
import { Link } from "../lib/router";
import { DOWNLOAD_URL } from "../lib/usage";
import { Card, cx, Skeleton } from "../ui/kit";
import { BotMascot } from "../ui/Mascot";
import { CloudStatus, PowerButton, Provisioning, regionName, tierName } from "./cloud-bits";
import { Activity } from "./activity";
import { CloudHero } from "./cloud-offer";
import { LoadError } from "./common";
import { Figure } from "../ui/Figure";

const ORDER: Record<BotMood, number> = { working: 0, waking: 1, idle: 2, drowsy: 3, sleeping: 4 };
const DOT: Record<BotMood, string> = { working: "text-good", waking: "text-warn", idle: "text-accent", drowsy: "text-ink-4", sleeping: "text-ink-4" };

/** every bot on every workspace and what each is doing right now; on the poster when it is the page's one picture,
 * on a plain wash when the cloud offer above already has it */
function Crew({ rows, plain = false }: { rows: BotRow[]; plain?: boolean }) {
  const shown = useMemo(() => [...rows].sort((a, b) => ORDER[a.mood] - ORDER[b.mood] || (b.bot.lastActiveAt ?? 0) - (a.bot.lastActiveAt ?? 0)).slice(0, 8), [rows]);
  const working = rows.filter((r) => r.mood === "working").length;
  const pill = plain ? "bg-pop text-ink" : "bg-white text-[#131316]";
  return (
    <section className={cx("enter relative isolate overflow-hidden rounded-card", plain ? "surface bg-card" : "bg-[#3fbdfb]")} style={{ ["--i" as string]: 1 }} aria-labelledby="crew-title">
      {!plain && <>
        <img src={poster} alt="" className="absolute inset-0 -z-10 size-full object-cover object-[center_76%]" draggable={false} />
        <img src={cloudPink} alt="" width={240} height={80} className="pixel-art cloud-drift absolute left-[8%] top-5 -z-10 w-[104px]" style={{ ["--drift" as string]: "120px", ["--dur" as string]: "44s" }} draggable={false} />
        <img src={cloudLemon} alt="" width={240} height={80} className="pixel-art cloud-drift absolute right-[14%] top-10 -z-10 w-[76px] max-sm:hidden" style={{ ["--drift" as string]: "-90px", ["--dur" as string]: "58s" }} draggable={false} />
      </>}
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <h2 id="crew-title" className={cx("flex h-7 items-center gap-2 rounded-full px-3 text-13 font-medium", pill)}><span className={cx("live-dot", working ? (plain ? "text-good" : "text-[#12894a]") : "text-ink-4")} data-live={working > 0} />{working ? `${working} of ${plural(rows.length, "bot")} working` : `${plural(rows.length, "bot")}, all quiet`}</h2>
        <Link to="/bots" className={cx("press inline-flex h-7 items-center gap-0.5 rounded-full ps-3 pe-2 text-13 font-medium", pill)}>all bots<ChevronRight size={14} strokeWidth={2} aria-hidden /></Link>
      </div>
      <ul className={cx("scroll-x flex items-end gap-x-7 px-6 pb-5 sm:justify-center max-sm:gap-x-4", plain ? "pt-6" : "pt-9")}>
        {shown.map(({ bot, where, mood }, i) => (
          <li key={`${where}-${bot.id}`} className="peek flex shrink-0 flex-col items-center gap-2.5" style={{ ["--i" as string]: i }}>
            <BotMascot bot={bot} mood={mood} size={plain ? 56 : i % 3 === 1 ? 84 : 72} track={640} tappable />
            <span className={cx("flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-13", pill)}>
              <span className={cx("live-dot", DOT[mood])} data-live={mood === "working"} aria-hidden />
              <b className="font-medium">{bot.name}</b>
              <span className={plain ? "text-ink-3" : "text-[#6c6c77]"}>{MOOD_LABEL[mood]}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** nobody here yet: a few bots asleep on the wash, and the way to get the first one */
function CrewEmpty() {
  return (
    <section className="surface enter flex items-center gap-4 rounded-card bg-card p-5" style={{ ["--i" as string]: 1 }} aria-labelledby="crew-empty-title">
      <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-pop text-ink-2"><Bot {...ICON} /></span>
      <div className="min-w-0">
        <h2 id="crew-empty-title" className="text-16 font-medium tracking-[-0.02em] text-ink">no bots yet</h2>
        <p className="text-14 text-ink-2">make one in the app and it shows up here.</p>
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

/** a dusk cloud that exists: its state and four live numbers */
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
          <div className="t-meta">dusk cloud</div>
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
const ICON = { size: 20, strokeWidth: 1.75 } as const;

function Tile({ icon, tint, title, body, to, external }: { icon: ReactNode; tint: keyof typeof TINT; title: string; body: string; to: string; external?: boolean }) {
  const inner = (
    <>
      <span className={cx("grid size-11 shrink-0 place-items-center rounded-[14px] text-ink", TINT[tint])}>{icon}</span>
      <span className="min-w-0 md:mt-5">
        <span className="block text-16 font-medium tracking-[-0.02em] text-ink">{title}</span>
        <span className="mt-0.5 block text-13 leading-[1.45] text-ink-3">{body}</span>
      </span>
      <ArrowUpRight size={17} className="tile-arrow absolute right-5 top-5 text-ink-4 max-md:top-1/2 max-md:-translate-y-1/2" aria-hidden />
    </>
  );
  const cls = "surface hover-tile relative flex h-full items-center gap-4 rounded-card bg-card p-5 pe-12 text-start md:flex-col md:items-start md:gap-0";
  return external ? <a href={to} className={cls} target="_blank" rel="noreferrer">{inner}</a> : <Link to={to} className={cls}>{inner}</Link>;
}

/** the bots that ran last, across every workspace */
function Recent({ rows: all }: { rows: BotRow[] }) {
  const now = useNow();
  const rows = useMemo(() => all.filter((r) => r.bot.lastActiveAt).sort((a, b) => Number(b.bot.busy) - Number(a.bot.busy) || (b.bot.lastActiveAt ?? 0) - (a.bot.lastActiveAt ?? 0)).slice(0, 5), [all]);
  if (!rows.length) return null;
  return (
    <Card className="enter !p-3" style={{ ["--i" as string]: 4 }} aria-labelledby="recent-title">
      <h2 id="recent-title" className="px-3 pb-1 pt-2 text-16 font-medium tracking-[-0.02em] text-ink">who ran last</h2>
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
  const { account, detail } = useSession();
  const { account: profile, clouds, error, refresh } = useCloud();
  const { bots, loading } = useAccountUsage();
  const now = useNow(60_000);
  const name = profile?.profile.name || account?.name || account?.email.split("@")[0] || "";
  const cloud = clouds?.[0] ?? null;
  const cloudDetail = useWorkspaceDetail(cloud?.workspaceId ?? null);
  const crew = bots.length ? <Crew rows={bots} plain={!cloud} /> : loading ? <Skeleton className="h-[200px] !rounded-card" /> : <CrewEmpty />;
  return (
    <div>
      <h1 className="t-title enter mb-8 max-sm:mb-6">hi {name}.</h1>
      <div className="flex flex-col gap-4">
        {error && clouds === null ? <LoadError error={error} retry={refresh} /> : clouds === null ? <Skeleton className="h-[360px] !rounded-card" /> : cloud ? <CloudLive cloud={cloud} detail={cloudDetail} /> : <CloudHero minimal={bots.length > 0} />}
        {clouds !== null && <>
          {crew}
          <div className="enter grid grid-cols-3 gap-4 max-md:grid-cols-1 max-sm:gap-3" style={{ ["--i" as string]: 2 }}>
            <Tile tint="sky" icon={<Download {...ICON} />} title="get the app" body="make bots and chat with them." to={DOWNLOAD_URL} external />
            <Tile tint="rose" icon={<Smartphone {...ICON} />} title="link your phone" body="text your bots from anywhere." to="/account#devices" />
            <Tile tint="lemon" icon={<LayoutGrid {...ICON} />} title="apps" body="gmail, slack, github and more." to="/connectors" />
          </div>
          <Activity detail={detail?.report?.activity ? detail : null} now={now} className="enter" style={{ ["--i" as string]: 3 }} />
          <Recent rows={bots} />
        </>}
      </div>
    </div>
  );
}
