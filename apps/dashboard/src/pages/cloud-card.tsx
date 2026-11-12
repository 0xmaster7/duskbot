import { useMemo, useState } from "react";
import { ChevronRight, Laptop, X } from "@/icons";
import type { BotReport, WorkspaceDetail } from "../../../../shared/dashboard-protocol";
import { useCloud } from "../data/cloud";
import type { CloudDesktop } from "../data/contracts";
import { botMood, type BotMood } from "../data/mood";
import { usePulse } from "../data/pulse";
import type { BotRow } from "../data/usage";
import { appLink, openApp } from "../lib/app-link";
import { ago, plural, until } from "../lib/format";
import { useNow } from "../lib/now";
import { Link } from "../lib/router";
import { Button, Card, cx } from "../ui/kit";
import { BotMascot, Mascot, type BotState } from "../ui/Mascot";
import { PulseChart } from "../ui/PulseChart";
import { CloudStatus, PowerButton, Provisioning, regionName } from "./cloud-bits";

const SHOWN = 6;
const ORDER: Record<BotMood, number> = { working: 0, waking: 1, idle: 2, drowsy: 3, sleeping: 4 };
const STATE: Record<BotMood, { label: string; dot: string }> = {
  working: { label: "working", dot: "text-good" },
  waking: { label: "waking up", dot: "text-warn" },
  idle: { label: "waiting", dot: "text-accent" },
  drowsy: { label: "waiting", dot: "text-ink-4" },
  sleeping: { label: "asleep", dot: "text-ink-4" },
};

/** what a bot is on now, or what it did last: a routine by name when that was it, otherwise a chat */
export function botDoing(bot: BotReport, mood: BotMood, now: number): string {
  const running = bot.routines.find((r) => r.running);
  if (mood === "working") return running ? `running ${running.name}` : "in a chat";
  const routine = bot.routines.filter((r) => r.lastRunAt).sort((a, b) => b.lastRunAt! - a.lastRunAt!)[0];
  if (routine && (bot.lastActiveAt === null || routine.lastRunAt! >= bot.lastActiveAt - 10 * 60_000)) return `last ran ${routine.name} · ${ago(routine.lastRunAt, now)}`;
  return bot.lastActiveAt ? `last chatted · ${ago(bot.lastActiveAt, now)}` : "nothing yet";
}

export function botRoutines(bot: BotReport, now: number): string {
  if (!bot.routines.length) return "no routines";
  const active = bot.routines.filter((r) => !r.paused);
  const next = active.map((r) => r.nextRunAt).filter((t): t is number => t !== null).sort((a, b) => a - b)[0];
  const count = plural(bot.routines.length, "routine");
  return !active.length ? `${count}, paused` : next ? `${count}, next ${until(next, now)}` : count;
}

function BotLine({ bot, mood, now }: { bot: BotReport; mood: BotMood; now: number }) {
  const state = STATE[mood];
  return (
    <li>
      <Link to={`/bots/${encodeURIComponent(bot.id)}`} className="press hover-ghost -mx-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[16px] px-3 py-2.5">
        <BotMascot bot={bot} mood={mood} size={38} />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="truncate text-15 font-medium text-ink">{bot.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-13 font-medium text-ink-2">
              <span className={cx("live-dot !size-1.5", state.dot)} data-live={mood === "working"} aria-hidden />{state.label}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-13 font-medium text-ink-2">{botDoing(bot, mood, now)}</span>
          <span className="block text-13 text-ink-3">{bot.model ?? bot.engine ?? "no ai picked"} · {botRoutines(bot, now)}</span>
        </span>
        <ChevronRight size={16} strokeWidth={1.75} className="text-ink-4" aria-hidden />
      </Link>
    </li>
  );
}

/** a dusk cloud that exists: its state and power up top, its bots on the left, live cpu and memory on the right */
export function CloudCard({ cloud, detail }: { cloud: CloudDesktop; detail: WorkspaceDetail | null }) {
  const { catalog } = useCloud();
  const now = useNow(30_000);
  const freshness = detail?.workspace.freshness;
  const rows = useMemo(() => (detail?.report?.bots ?? [])
    .map((bot) => ({ bot, mood: botMood(bot, { freshness, computer: detail?.report?.computers?.computers.find((c) => c.botId === bot.id)?.state }) }))
    .sort((a, b) => ORDER[a.mood] - ORDER[b.mood] || (b.bot.lastActiveAt ?? 0) - (a.bot.lastActiveAt ?? 0)), [detail, freshness]);
  const on = cloud.status === "running";
  const asleep = cloud.status === "sleeping" || cloud.status === "stopped";
  const working = on ? rows.filter((r) => r.mood === "working").length : 0;
  const pulse = usePulse(cloud.workspaceId, on);
  const mood: BotState = asleep ? "sleeping" : cloud.status === "provisioning" ? "loading" : cloud.status === "waking" ? "waking" : working ? "working" : "happy";
  return (
    <Card className="enter" aria-labelledby="cloud-card-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="relative mt-1 shrink-0" aria-hidden>
            <Mascot body="kit" color="blue" size={52} state={mood} tappable />
            {asleep && <span className="absolute -right-1 -top-2"><i className="zz not-italic">z</i><i className="zz not-italic">z</i><i className="zz not-italic">z</i></span>}
          </span>
          <div className="min-w-0">
            <div className="t-meta">dusk cloud</div>
            <h2 id="cloud-card-title" className="mt-1 truncate text-24 font-medium tracking-[-0.035em] text-ink">{cloud.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <CloudStatus cloud={cloud} />
              <span className="text-13 font-medium text-ink-3">{regionName(catalog, cloud.region)}</span>
            </div>
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
        <div className="mt-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <section className="min-w-0 rounded-[20px] bg-pop px-5 pb-3 pt-4" aria-labelledby="cloud-bots-title">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <h3 id="cloud-bots-title" className="text-14 font-medium text-ink">bots</h3>
              <span className="num text-13 font-medium text-ink-3">{rows.length ? (working ? `${working} of ${plural(rows.length, "bot")} working` : plural(rows.length, "bot")) : ""}</span>
            </div>
            {detail === null ? (
              <p className="py-6 text-13 font-medium text-ink-3">{on ? "loading your bots" : "your bots show up once it's awake."}</p>
            ) : rows.length ? (
              <>
                <ul className="flex flex-col">{rows.slice(0, SHOWN).map(({ bot, mood }) => <BotLine key={bot.id} bot={bot} mood={mood} now={now} />)}</ul>
                {rows.length > SHOWN && <Link to="/bots" className="text-link mt-1 inline-flex h-9 items-center text-13">all {rows.length} bots</Link>}
              </>
            ) : (
              <div className="py-6">
                <p className="text-14 font-medium text-ink">no bots here yet</p>
                <p className="mt-0.5 text-13 font-medium text-ink-3">make one in the app, or move yours over from your mac.</p>
              </div>
            )}
          </section>
          <section className="min-w-0 rounded-[20px] bg-pop px-5 pb-3 pt-4" aria-labelledby="cloud-pulse-title">
            <h3 id="cloud-pulse-title" className="sr-only">cpu and memory, last two minutes</h3>
            <PulseChart samples={pulse?.samples ?? []} lag={pulse?.lag ?? 0}
              empty={asleep ? "asleep. wake it to see cpu and memory." : cloud.status === "waking" ? "waking up" : cloud.status === "error" ? "it stopped answering. waking it usually fixes this." : null} />
          </section>
        </div>
      )}
    </Card>
  );
}

const HIDE = "dusk-dash-move-guide";

/** bots still on a mac once a cloud exists: the move in three plain steps, and the link that opens the app's cloud move */
export function MoveGuide({ cloud, rows, cloudBots }: { cloud: CloudDesktop; rows: BotRow[]; cloudBots: BotReport[] | null }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE) === cloud.id; } catch { return false; } });
  const onCloud = new Set((cloudBots ?? []).map((b) => b.id));
  const left = rows.filter((r) => r.kind === "mac" && !onCloud.has(r.bot.id));
  if (hidden || !left.length || cloudBots === null) return null;
  const hide = () => { try { localStorage.setItem(HIDE, cloud.id); } catch {} setHidden(true); };
  const steps = [
    { title: "open dusk bot on your mac", body: "signed in to this account. it offers the move, or starts it by itself." },
    { title: "let it move", body: "chats, memory, files and routines come along. your bots keep working on the mac until it's done, usually a few minutes." },
    { title: `that's it`, body: `they answer from ${cloud.name} from then on, even with your mac shut.` },
  ];
  return (
    <Card className="enter" style={{ ["--i" as string]: 1 }} aria-labelledby="move-guide-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="move-guide-title" className="text-16 font-medium tracking-[-0.02em] text-ink">move your bots from your mac</h2>
          <p className="mt-0.5 text-14 font-medium text-ink-3">{plural(left.length, "bot")} still on {left[0]!.where}{new Set(left.map((r) => r.workspaceId)).size > 1 ? " and more" : ""}.</p>
        </div>
        <button type="button" onClick={hide} aria-label="hide the move guide" className="press hover-ghost -me-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-3"><X size={16} strokeWidth={1.75} aria-hidden /></button>
      </div>
      <ol className="mt-5 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-btn text-13 font-medium text-ink">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-14 font-medium text-ink">{s.title}</span>
              <span className="mt-0.5 block text-13 font-medium leading-[1.5] text-ink-3">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Button variant="primary" onClick={() => openApp(appLink.cloud)}><Laptop size={16} strokeWidth={1.5} aria-hidden />open dusk bot on my mac</Button>
      </div>
    </Card>
  );
}
