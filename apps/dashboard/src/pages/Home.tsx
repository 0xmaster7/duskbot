import { useMemo, type ReactNode } from "react";
import { ChevronRight, Download } from "@/icons";
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
import { percent, plural } from "../lib/format";
import { Link } from "../lib/router";
import { DOWNLOAD_URL } from "../lib/usage";
import { Card, cx, Skeleton } from "../ui/kit";
import { BotMascot, Mascot } from "../ui/Mascot";
import { CloudStatus, PowerButton, Provisioning, regionName, tierName } from "./cloud-bits";
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

const STEPS = ["download dusk bot", "sign in with this account", "make a bot. it shows up here"];

/** no bots and no cloud yet: the free way to a first bot, quieter than the cloud offer above it, so home has one main button */
function GetTheApp() {
  return (
    <section className="surface enter flex items-center gap-8 rounded-card bg-card p-6 max-sm:flex-col max-sm:items-start max-sm:gap-5 max-sm:p-5" style={{ ["--i" as string]: 1 }} aria-labelledby="app-title">
      <div className="min-w-0 flex-1">
        <h2 id="app-title" className="text-20 font-medium tracking-[-0.03em] text-ink">or start free on your own computer.</h2>
        <ol className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-14 text-ink-2">
          {STEPS.map((s, i) => <li key={s} className="flex items-center gap-2"><span className="num grid size-5 place-items-center rounded-full bg-pop font-pixel text-12 text-ink">{i + 1}</span>{s}</li>)}
        </ol>
      </div>
      <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer" className="press hover-outline inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-btn px-5 text-14 font-medium text-ink"><Download size={16} strokeWidth={1.75} aria-hidden />download free</a>
    </section>
  );
}

/** nobody here yet, with the cloud already on: the picture with one bot asleep in it, and the way to get the first one */
function CrewEmpty() {
  return (
    <section className="enter relative isolate overflow-hidden rounded-card bg-[#3fbdfb]" style={{ ["--i" as string]: 1 }} aria-labelledby="crew-empty-title">
      <img src={poster} alt="" className="absolute inset-0 -z-10 size-full object-cover object-[center_76%]" draggable={false} />
      <img src={cloudPink} alt="" width={240} height={80} className="pixel-art cloud-drift absolute right-[30%] top-6 -z-10 w-[104px] max-sm:hidden" style={{ ["--drift" as string]: "90px", ["--dur" as string]: "44s" }} draggable={false} />
      <div className="flex items-end justify-between gap-6 p-5 max-sm:flex-col max-sm:items-start">
        <div className="pop max-w-[380px] rounded-[20px] bg-white p-5 text-[#131316]">
          <h2 id="crew-empty-title" className="text-20 font-medium tracking-[-0.03em]">your bots will hang out here.</h2>
          <p className="mt-1 text-14 text-[#4b4b55]">make one in the app and it shows up in a few seconds, with what it's doing.</p>
          <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer" className="press mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-[#131316] px-5 text-14 font-medium text-white"><Download size={16} strokeWidth={1.75} aria-hidden />get the app</a>
        </div>
        <div className="flex shrink-0 items-end gap-5 pe-6 max-sm:self-center max-sm:pe-0" aria-hidden>
          <span className="peek relative" style={{ ["--i" as string]: 0 }}><Mascot body="wisp" color="purple" size={64} state="sleeping" /><span className="absolute -right-1 -top-2"><i className="zz not-italic !text-white">z</i><i className="zz not-italic !text-white">z</i><i className="zz not-italic !text-white">z</i></span></span>
          <span className="peek" style={{ ["--i" as string]: 1 }}><Mascot body="kit" color="blue" size={92} state="curious" track={900} tappable /></span>
          <span className="peek" style={{ ["--i" as string]: 2 }}><Mascot body="hearty" color="pink" size={70} state="idle" track={900} tappable /></span>
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

export function HomePage() {
  const { account } = useSession();
  const { account: profile, clouds, error, refresh } = useCloud();
  const { bots, loading } = useAccountUsage();
  const name = profile?.profile.name || account?.name || account?.email.split("@")[0] || "";
  const cloud = clouds?.[0] ?? null;
  const cloudDetail = useWorkspaceDetail(cloud?.workspaceId ?? null);
  const crew = bots.length ? <Crew rows={bots} plain={!cloud} /> : loading ? <Skeleton className="h-[200px] !rounded-card" /> : cloud ? <CrewEmpty /> : <GetTheApp />;
  return (
    <div>
      <h1 className="t-title enter mb-8 max-sm:mb-6">hi {name}.</h1>
      <div className="flex flex-col gap-4">
        {error && clouds === null ? <LoadError error={error} retry={refresh} /> : clouds === null ? <Skeleton className="h-[360px] !rounded-card" /> : cloud ? <CloudLive cloud={cloud} detail={cloudDetail} /> : <CloudHero />}
        {clouds !== null && crew}
      </div>
    </div>
  );
}
