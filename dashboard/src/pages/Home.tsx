import { useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, ArrowUpRight, CalendarClock, ChevronRight, ExternalLink, Info, Server, Wallet, X, Gauge } from "lucide-react";
import type { MausState } from "@/lib/mascot";
import { useData } from "../data/store";
import type { Bot, Metric } from "../data/types";
import { ago, compact, date, dateLong, greeting, hours, int, time, until, usd, usdTiny } from "../lib/format";
import { navigate, Link } from "../lib/router";
import { addDays, forecast, splitOf, startOfDay, turnPaid, type Split } from "../lib/usage";
import { ButtonLink, Card, CardHead, CoverageTag, cx, Pill, Segmented, STROKE, Ticks } from "../ui/kit";
import { Heatmap } from "../ui/Heatmap";
import { BotMark, Mascot } from "../ui/Mascot";
import { Sparkline } from "../ui/charts";

const SPOTS: Array<{ left: string; mleft: string; top: string; size: number; delay: string }> = [
  { left: "57%", mleft: "18%", top: "54%", size: 52, delay: "0s" },
  { left: "67%", mleft: "38%", top: "34%", size: 40, delay: "-1.8s" },
  { left: "76%", mleft: "58%", top: "58%", size: 46, delay: "-3.1s" },
  { left: "85%", mleft: "80%", top: "32%", size: 36, delay: "-0.9s" },
  { left: "93%", mleft: "90%", top: "60%", size: 42, delay: "-4.2s" },
  { left: "64%", mleft: "8%", top: "76%", size: 32, delay: "-2.4s" },
];

function moodOf(bot: Bot, now: number): MausState {
  const idle = now - bot.lastActiveAt;
  if (idle < 45 * 60_000) return "working";
  if (idle < 4 * 3_600_000) return "happy";
  return new Date(now).getHours() >= 22 || new Date(now).getHours() < 6 ? "sleeping" : "idle";
}

function Hero() {
  const data = useData();
  const weekAgo = data.now - 7 * 86_400_000;
  const week = data.turns.filter((t) => t.at >= weekAgo && t.status === "ok");
  const paid = week.reduce((s, t) => s + turnPaid(t), 0);
  const first = data.account.name.split(" ")[0];
  return (
    <Card className="relative overflow-hidden" aria-labelledby="hello">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[150px] sm:inset-y-0 sm:start-auto sm:end-0 sm:h-auto sm:w-[68%]">
        <img src="/art/cloud-bank.webp" alt="" className="sky-fade size-full object-cover object-[60%_70%] max-sm:[mask-image:linear-gradient(180deg,black_55%,transparent)]" />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[150px] sm:inset-y-0 sm:h-auto">
        {data.bots.slice(0, SPOTS.length).map((bot, i) => {
          const spot = SPOTS[i]!;
          return (
            <span key={bot.id} className={cx("drift pointer-events-auto absolute left-[var(--ml)] top-[var(--t)] -ms-6 sm:left-[var(--l)]", i >= 4 && "max-sm:hidden")}
              style={{ "--l": spot.left, "--ml": spot.mleft, "--t": spot.top, animationDelay: spot.delay } as CSSProperties}>
              <Mascot color={bot.color} body={bot.body} size={spot.size} state={moodOf(bot, data.now)} label={`${bot.name}, ${moodOf(bot, data.now)}`} track />
            </span>
          );
        })}
      </div>
      <div className="relative flex min-h-[230px] flex-col justify-end gap-4 px-5 pb-5 pt-[160px] sm:max-w-[46%] sm:justify-center sm:px-7 sm:py-7">
        <div>
          <p className="text-13 text-ink-3">{dateLong(data.now).replace(/, \d{4}$/, "")}</p>
          <h1 id="hello" className="mt-1 font-serif text-30 font-normal tracking-[-0.6px] text-ink">{greeting(data.now)}, {first}</h1>
          <p className="mt-2 max-w-[40ch] text-14 text-ink-2">
            Your Cloud is running. Your bots finished <span className="num font-medium text-ink">{int(week.length)}</span> turns this week, and <span className="num font-medium text-ink">{usd(paid)}</span> of it was paid.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink to="openmausbot://open" external variant="primary" icon={ExternalLink}>Open the app</ButtonLink>
          <ButtonLink to="/cloud">My Cloud</ButtonLink>
        </div>
      </div>
    </Card>
  );
}

function Alerts() {
  const data = useData();
  const [gone, setGone] = useState<string[]>([]);
  const shown = data.alerts.filter((a) => !gone.includes(a.id));
  if (!shown.length) return null;
  return (
    <div className="mb-4 flex flex-col gap-2" role="region" aria-label="Needs attention">
      {shown.map((a) => (
        <div key={a.id} className={cx("flex min-h-10 items-center gap-2.5 rounded-[10px] py-1 pe-1 ps-3 text-13", a.tone === "warn" ? "bg-warn-wash text-[#6b4800]" : a.tone === "bad" ? "bg-bad-wash text-bad" : "bg-accent-wash text-accent-ink")}>
          {a.tone === "info" ? <Info size={15} strokeWidth={STROKE} aria-hidden className="shrink-0" /> : <AlertTriangle size={15} strokeWidth={STROKE} aria-hidden className="shrink-0" />}
          <p className="min-w-0 flex-1">{a.text}</p>
          <Link to={a.action.to} className="inline-flex h-7 shrink-0 items-center rounded-full px-2.5 font-medium underline-offset-2 hover:underline pointer-coarse:h-11">{a.action.label}</Link>
          <button type="button" aria-label="Dismiss" onClick={() => setGone((g) => [...g, a.id])} className="inline-flex size-7 shrink-0 items-center justify-center rounded-full opacity-70 hover:bg-black/5 hover:opacity-100 pointer-coarse:size-11"><X size={14} strokeWidth={STROKE} aria-hidden /></button>
        </div>
      ))}
    </div>
  );
}

function CloudCard() {
  const { machine, now } = useData();
  const last = machine.samples[machine.samples.length - 1]!;
  const up = Math.floor((now - machine.startedAt) / 86_400_000);
  const free = Math.round(machine.size.diskGb * (1 - last.disk / 100));
  return (
    <Card className="flex flex-col" aria-labelledby="c-cloud">
      <CardHead icon={Server} title="My Cloud" id="c-cloud"><Pill tone="good" dot>Running</Pill></CardHead>
      <div className="flex flex-1 flex-col px-4 pb-4">
        <p className="text-14 text-ink">Healthy. <span className="text-ink-2">{Math.round(last.mem)}% memory, {free} GB free disk, up {up} days.</span></p>
        <dl className="mt-3 flex flex-col">
          {([["CPU", last.cpu], ["Memory", last.mem], ["Disk", last.disk]] as const).map(([label, v]) => (
            <div key={label} className="flex h-8 items-center gap-3 border-b border-row last:border-0">
              <dt className="flex-1 text-13 text-ink-3">{label}</dt>
              <Ticks value={v} max={100} label={`${label} ${Math.round(v)}%`} />
              <dd className="num w-9 text-end text-13 font-medium">{Math.round(v)}%</dd>
            </div>
          ))}
        </dl>
        <div className="mt-auto flex items-center pt-3 text-12 text-ink-3">
          <span>{machine.region}, {machine.size.vcpu} vCPU, {machine.size.ramGb} GB</span>
          <Link to="/cloud" className="ms-auto inline-flex items-center gap-0.5 font-medium text-ink hover:text-accent">Details<ChevronRight size={14} strokeWidth={STROKE} aria-hidden /></Link>
        </div>
      </div>
    </Card>
  );
}

function SplitRows({ split }: { split: Split }) {
  return (
    <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-row pt-3">
      <div><dt className="text-12 text-ink-3">Included</dt><dd className="num text-13 font-medium">{usd(split.included)}</dd></div>
      <div><dt className="text-12 text-ink-3">Trial</dt><dd className="num text-13 font-medium">{usd(split.trial)}</dd></div>
      <div title="Work on your own Claude or ChatGPT subscription, valued at API rates. Never billed by us."><dt className="text-12 text-ink-3">Your own</dt><dd className="num text-13 font-medium text-ink-4">~{usd(split.own)}</dd></div>
    </dl>
  );
}

function MonthCard() {
  const data = useData();
  const { periodStart, periodEnd, caps } = data.billing;
  const f = useMemo(() => forecast(data.turns, data.bots, data.now, periodStart, periodEnd), [data, periodStart, periodEnd]);
  const split = useMemo(() => data.turns.filter((t) => t.at >= periodStart).reduce((s, t) => splitOf(t, s), { paid: 0, included: 0, trial: 0, own: 0 }), [data.turns, periodStart]);
  const end = addDays(periodEnd, -1);
  return (
    <Card className="flex flex-col" aria-labelledby="c-month">
      <CardHead icon={Wallet} title="This month" id="c-month"><span className="text-12 text-ink-3">{date(periodStart)} to {date(end)}</span></CardHead>
      <div className="flex flex-1 flex-col px-4 pb-4">
        <p className="flex items-baseline gap-2">
          <span className="num text-24 font-semibold">{usd(f.spent)}</span>
          <span className="text-13 text-ink-3">paid of {usd(caps.ai.limitUsd)} AI cap</span>
        </p>
        <div className="mt-2"><Ticks value={f.spent} max={caps.ai.limitUsd} size="lg" label={`Paid ${usd(f.spent)} of ${usd(caps.ai.limitUsd)}`} /></div>
        <p className="mt-3 text-13 text-ink-2">
          At this pace, <span className="num font-medium text-ink">{usd(f.low)} to {usd(f.high)}</span> by {date(end)}.
          {f.driver && <> Biggest driver: {f.driver}.</>}
        </p>
        <SplitRows split={split} />
        <div className="mt-auto flex pt-3 text-12">
          <Link to="/usage" className="ms-auto inline-flex items-center gap-0.5 font-medium text-ink hover:text-accent">Usage<ChevronRight size={14} strokeWidth={STROKE} aria-hidden /></Link>
        </div>
      </div>
    </Card>
  );
}

const amount = (unit: string, v: number, whole = false) =>
  unit === "h" ? (whole ? `${v} h` : hours(v)) : unit === "usd" ? (whole ? `$${v}` : usd(v)) : unit === "gb" ? (whole ? `${v} GB` : `${v.toFixed(1)} GB`) : compact(v);

function AllowanceCard() {
  const data = useData();
  return (
    <Card className="flex flex-col" aria-labelledby="c-allow">
      <CardHead icon={Gauge} title="Included in Pro" id="c-allow"><span className="text-12 text-ink-3">Resets {until(data.billing.periodEnd, data.now)}</span></CardHead>
      <dl className="flex flex-col px-4 pb-3">
        {data.allowances.map((a) => (
          <div key={a.kind} title={a.overUsd} className="flex h-8 items-center gap-3 border-b border-row last:border-0">
            <dt className="min-w-0 flex-1 truncate text-13 text-ink-3">{a.label}</dt>
            <Ticks value={a.used} max={a.max} label={`${a.label}: ${amount(a.unit, a.used)} of ${amount(a.unit, a.max)}`} />
            <dd className="num w-[104px] text-end text-12 text-ink-3"><span className="font-medium text-ink">{amount(a.unit, a.used)}</span> / {amount(a.unit, a.max, true)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Activity() {
  const data = useData();
  const [metric, setMetric] = useState<Metric>("turns");
  return (
    <Card className="mt-4" aria-labelledby="c-activity">
      <CardHead title="Activity" id="c-activity">
        <Segmented size="sm" label="Heatmap metric" value={metric} onChange={setMetric} options={[{ value: "turns", label: "Turns" }, { value: "spend", label: "Spend" }, { value: "hours", label: "Computer hours" }]} />
      </CardHead>
      <div className="px-4 pb-4 pt-1">
        <Heatmap turns={data.turns} bots={data.bots} now={data.now} metric={metric} weekStart={data.account.weekStart === "monday" ? 1 : 0}
          onPick={(from, to) => navigate(`/usage?from=${from}&to=${to ?? from}`)} />
      </div>
    </Card>
  );
}

function TopBots() {
  const data = useData();
  const period = data.billing.periodStart;
  const rows = useMemo(() => {
    const start = startOfDay(data.now) - 13 * 86_400_000;
    return data.bots.map((bot) => {
      const mine = data.turns.filter((t) => t.botId === bot.id && t.at >= period);
      const split = mine.reduce((s, t) => splitOf(t, s), { paid: 0, included: 0, trial: 0, own: 0 });
      const spark = Array.from({ length: 14 }, (_, i) => data.turns.filter((t) => t.botId === bot.id && t.at >= start + i * 86_400_000 && t.at < start + (i + 1) * 86_400_000).length);
      return { bot, turns: mine.filter((t) => t.status === "ok").length, split, spark };
    }).sort((a, b) => b.turns - a.turns);
  }, [data, period]);
  return (
    <Card aria-labelledby="c-bots" className="min-w-0">
      <CardHead title="Top bots this month" id="c-bots"><Link to="/bots" className="text-12 font-medium text-ink-3 hover:text-ink">All bots</Link></CardHead>
      <div className="flex h-7 items-center gap-3 px-4 text-12 text-ink-4" aria-hidden>
        <span className="flex-1">Bot</span><span className="hidden w-[72px] sm:block">14 days</span><span className="w-16 text-end">Turns</span><span className="w-20 text-end">Cost</span>
      </div>
      <ul className="px-2 pb-2">
        {rows.map(({ bot, turns, split, spark }) => {
          const charged = split.paid + split.trial;
          return (
            <li key={bot.id}>
              <Link to={`/bots/${bot.id}`} className="flex h-11 items-center gap-3 rounded-row px-2 hover:bg-hover">
                <BotMark bot={bot} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-13 font-medium">{bot.name}</span>
                  <span className="block truncate text-12 text-ink-3">{bot.engine}, {bot.model}</span>
                </span>
                <span className="hidden sm:block"><Sparkline values={spark} label={`${bot.name}, turns per day for two weeks`} /></span>
                <span className="num w-16 text-end text-13 text-ink-2">{int(turns)}<span className="sr-only"> turns</span></span>
                <span className="num w-20 text-end text-13 font-medium">{bot.engineCoverage === "own" ? <span className="text-ink-4" title="Your own subscription, not billed">~{usd(split.own)}</span> : usd(charged)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Timeline() {
  const data = useData();
  const bot = (id: string) => data.bots.find((b) => b.id === id)!;
  const upcoming = data.bots.flatMap((b) => b.routines).filter((r) => r.nextRunAt && r.nextRunAt - data.now < 2 * 86_400_000 && r.state !== "paused").sort((a, b) => a.nextRunAt! - b.nextRunAt!).slice(0, 3);
  const recent = data.turns.slice(0, 6);
  return (
    <Card aria-labelledby="c-time" className="min-w-0">
      <CardHead icon={CalendarClock} title="What your bots did and will do" id="c-time" />
      <div className="px-4 pb-4">
        <p className="mb-1 text-12 font-medium text-ink-4">Coming up</p>
        <ul>
          <li className="flex min-h-10 items-center gap-2.5 border-b border-row py-1.5">
            <span className="w-16 shrink-0 text-12 text-ink-3">Waiting</span>
            <BotMark bot={bot("echo")} size={18} />
            <span className="min-w-0 flex-1 text-13">Echo wants to call the clinic to move your appointment</span>
            <Pill tone="warn">Approve</Pill>
          </li>
          {upcoming.map((r) => (
            <li key={r.id} className="flex min-h-10 items-center gap-2.5 border-b border-row py-1.5">
              <span className="num w-16 shrink-0 text-12 text-ink-3">{time(r.nextRunAt!)}</span>
              <BotMark bot={bot(r.botId)} size={18} />
              <span className="min-w-0 flex-1 truncate text-13">{r.name}{r.state === "error" && <span className="text-bad">, last run failed</span>}</span>
              <span className="num text-12 text-ink-3">~{usdTiny(r.costPerRunUsd)}</span>
            </li>
          ))}
        </ul>
        <p className="mb-1 mt-4 text-12 font-medium text-ink-4">Recently</p>
        <ul>
          {recent.map((t) => {
            const s = splitOf(t);
            const cov = s.paid ? "paid" : s.trial ? "trial" : s.own ? "own" : "included";
            return (
              <li key={t.id}>
                <Link to={`/usage?turn=${t.id}`} className="-mx-2 flex min-h-10 items-center gap-2.5 rounded-row px-2 py-1.5 hover:bg-hover">
                  <span className="w-16 shrink-0 text-12 text-ink-3">{ago(t.at, data.now)}</span>
                  <BotMark bot={bot(t.botId)} size={18} />
                  <span className="min-w-0 flex-1 truncate text-13">{t.title}</span>
                  {t.status !== "ok" ? <Pill tone="outline">Not charged</Pill> : <CoverageTag coverage={cov} />}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

export function HomePage() {
  return (
    <>
      <Alerts />
      <Hero />
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <CloudCard />
        <MonthCard />
        <div className="md:col-span-2 xl:col-span-1"><AllowanceCard /></div>
      </div>
      <Activity />
      <div className="mt-4 grid gap-4 xl:grid-cols-[7fr_5fr]">
        <TopBots />
        <Timeline />
      </div>
      <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-12 text-ink-3">
        <Link to="/billing#invoices" className="hover:text-ink">Invoices</Link>
        <Link to="/usage" className="hover:text-ink">Export usage</Link>
        <a href="https://openmausbot.com/pricing" className="inline-flex items-center gap-0.5 hover:text-ink">Price list<ArrowUpRight size={12} strokeWidth={STROKE} aria-hidden /></a>
        <span className="ms-auto">Failed turns are never charged.</span>
      </p>
    </>
  );
}
