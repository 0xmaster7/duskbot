import { useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, ExternalLink, Pause, Play, Plug, Plus, Zap } from "lucide-react";
import { useStore } from "../data/store";
import type { Bot, Metric, Routine } from "../data/types";
import { ago, dateTime, hours, int, until, usd, usdTiny } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { routineRunsLeft, splitOf, emptySplit, type Split } from "../lib/usage";
import { Heatmap } from "../ui/Heatmap";
import { Button, ButtonLink, Card, CardHead, CoverageTag, cx, Field, Input, PageHead, Pill, Segmented, StatusTag, STROKE, SubHead, Switch, Ticks } from "../ui/kit";
import { BotMark, EmptyState, Mascot } from "../ui/Mascot";
import { Dialog } from "../ui/overlays";

interface BotRow { bot: Bot; turns: number; split: Split; minutes: number }

function useBotRows(): BotRow[] {
  const { data } = useStore();
  return useMemo(() => data.bots.map((bot) => {
    const mine = data.turns.filter((t) => t.botId === bot.id && t.at >= data.billing.periodStart);
    return { bot, turns: mine.filter((t) => t.status === "ok").length, split: mine.reduce((s, t) => splitOf(t, s), emptySplit()), minutes: mine.reduce((s, t) => s + t.computerMinutes, 0) };
  }), [data]);
}

const charged = (s: Split) => s.paid + s.trial;

function CostCell({ bot, split }: { bot: Bot; split: Split }) {
  return bot.engineCoverage === "own"
    ? <span className="num text-ink-4" title="Your own subscription. Estimated value, never billed.">~{usd(split.own)}</span>
    : <span className="num font-medium">{usd(charged(split))}</span>;
}

const COLS = "md:grid-cols-[minmax(150px,1.3fr)_minmax(170px,1.3fr)_84px_72px_96px_56px_84px_64px]";

export function BotsPage() {
  const { data } = useStore();
  const rows = useBotRows();
  const [show, setShow] = useState<"all" | "cloud" | "own">("all");
  const shown = rows.filter((r) => show === "all" || (show === "own" ? r.bot.engineCoverage === "own" : r.bot.engineCoverage !== "own"));
  const pc = (id: string | null) => data.computers.find((c) => c.id === id)?.name ?? "None";
  return (
    <>
      <PageHead title="Bots" sub={`${data.bots.length} bots. Personality, tools and memory are edited in the app.`}>
        <ButtonLink to="openmausbot://new-bot" external variant="primary" icon={Plus}>New bot</ButtonLink>
      </PageHead>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented label="Show bots" value={show} onChange={setShow} options={[{ value: "all", label: "All" }, { value: "cloud", label: "Billed by us" }, { value: "own", label: "Your own AI" }]} />
        <p className="text-12 text-ink-3">Bots on your own Claude or ChatGPT are never billed. Their cost shows in grey as an estimate.</p>
      </div>
      <Card>
        <div className={cx("hidden h-9 items-center gap-x-4 border-b border-row px-4 text-12 text-ink-3 md:grid", COLS)} aria-hidden>
          <span>Bot</span><span>Engine</span><span>Computer</span><span className="text-end">Routines</span><span>Last active</span><span className="text-end">Turns</span><span className="text-end">Month</span><span className="text-end">Cap</span>
        </div>
        {shown.length === 0 && <EmptyState title="No bots here" state="curious">Switch the filter, or make a bot in the app and it shows up here.</EmptyState>}
        <ul>
          {shown.map(({ bot, turns, split }) => (
            <li key={bot.id} className={cx("relative grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-row px-4 py-2.5 last:border-0 hover:bg-hover md:py-0", COLS)}>
              <span className="flex min-w-0 items-center gap-2.5">
                <BotMark bot={bot} size={24} />
                <Link to={`/bots/${bot.id}`} className="truncate text-13 font-medium after:absolute after:inset-0 after:content-['']">{bot.name}</Link>
                <span className="hidden truncate text-12 text-ink-3 xl:inline">{bot.role}</span>
              </span>
              <span className="text-end text-13 md:hidden"><CostCell bot={bot} split={split} /></span>
              <span className="flex min-w-0 items-center gap-2 text-13 text-ink-2"><span className="truncate">{bot.model}</span><CoverageTag coverage={bot.engineCoverage} /></span>
              <span className="text-end text-12 text-ink-3 md:hidden">{int(turns)} turns</span>
              <span className="hidden truncate text-13 text-ink-2 md:block">{pc(bot.computerId)}</span>
              <span className="num hidden text-end text-13 text-ink-2 md:block">{bot.routines.length || "None"}</span>
              <span className="hidden truncate text-13 text-ink-2 md:block">{ago(bot.lastActiveAt, data.now)}</span>
              <span className="num hidden text-end text-13 md:block">{int(turns)}</span>
              <span className="hidden text-end text-13 md:block"><CostCell bot={bot} split={split} /></span>
              <span className="hidden justify-end md:flex">{bot.capUsd ? <Ticks value={charged(split)} max={bot.capUsd} label={`${usd(charged(split))} of ${usd(bot.capUsd)} cap`} /> : <span className="text-12 text-ink-4">None</span>}</span>
            </li>
          ))}
        </ul>
      </Card>
      <SubHead title="Routines" />
      <Card>
        <ul>{data.bots.flatMap((b) => b.routines.map((r) => <RoutineRow key={r.id} routine={r} bot={b} now={data.now} periodEnd={data.billing.periodEnd} />))}</ul>
      </Card>
      <p className="mt-3 text-12 text-ink-3">Each routine shows what a run costs before it starts. New routines are made by asking a bot in the app.</p>
    </>
  );
}

function CapDialog({ bot, open, onClose }: { bot: Bot; open: boolean; onClose: () => void }) {
  const { update, toast } = useStore();
  const [on, setOn] = useState(bot.capUsd !== null);
  const [value, setValue] = useState(String(bot.capUsd ?? 10));
  const amount = Number(value);
  const error = on && !(amount >= 1 && amount <= 10_000) ? "Enter a cap from $1 to $10,000." : null;
  const save = () => {
    const prev = bot.capUsd;
    const next = on ? Math.round(amount * 100) / 100 : null;
    const set = (cap: number | null) => update((d) => ({ ...d, bots: d.bots.map((b) => (b.id === bot.id ? { ...b, capUsd: cap } : b)) }));
    set(next);
    onClose();
    toast(next ? `${bot.name} capped at ${usd(next)} a month` : `${bot.name} has no cap now`, () => set(prev));
  };
  return (
    <Dialog open={open} onClose={onClose} title={`Monthly cap for ${bot.name}`}
      actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!!error} onClick={save}>Save cap</Button></>}>
      <p className="text-13">When {bot.name} reaches its cap, new turns wait until next month or until you raise it. A turn already running finishes, and any small overage is on us.</p>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-[10px] bg-sunk px-3 py-2.5">
        <span className="text-13 font-medium text-ink">Cap this bot</span>
        <Switch checked={on} onChange={setOn} label="Cap this bot" />
      </div>
      {on && (
        <div className="mt-3">
          <Field label="Monthly cap in dollars" error={error} hint="Counts paid AI only. Included allowances and your own subscriptions do not count.">
            {(id, describedBy) => <Input id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy} data-autofocus />}
          </Field>
        </div>
      )}
    </Dialog>
  );
}

function RoutineRow({ routine, now, periodEnd, bot }: { routine: Routine; now: number; periodEnd: number; bot?: Bot }) {
  const { update, toast } = useStore();
  const set = (state: Routine["state"]) => update((d) => ({ ...d, bots: d.bots.map((b) => ({ ...b, routines: b.routines.map((r) => (r.id === routine.id ? { ...r, state } : r)) })) }));
  const left = routineRunsLeft(routine, now, periodEnd);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-b border-row px-4 py-2.5 last:border-0 md:grid-cols-[minmax(0,1.3fr)_80px_minmax(0,1.2fr)_150px_auto]">
      <span className="flex min-w-0 items-center gap-2.5">
        {bot && <BotMark bot={bot} size={22} />}
        <span className="min-w-0">
        <span className="block truncate text-13 font-medium">{bot && <Link to={`/bots/${bot.id}`} className="hover:underline">{bot.name}</Link>}{bot && <span className="text-ink-3">, </span>}{routine.name}</span>
        <span className="block text-12 text-ink-3">{routine.schedule}</span>
        </span>
      </span>
      <span>{routine.state === "on" ? <Pill tone="good" dot>On</Pill> : routine.state === "paused" ? <Pill>Paused</Pill> : <Pill tone="bad" dot>Failing</Pill>}</span>
      <span className="text-12 text-ink-3 md:text-13 md:text-ink-2">
        {routine.lastRunAt ? `Last ran ${ago(routine.lastRunAt, now)}` : "Never run"}
        {routine.nextRunAt && routine.state !== "paused" ? `, next ${until(routine.nextRunAt, now)}` : ""}
      </span>
      <span className="num text-end text-12 text-ink-3 md:text-13">~{usdTiny(routine.costPerRunUsd)} a run{left > 0 && <span className="block text-12 text-ink-4">~{usd(left * routine.costPerRunUsd)} more this month</span>}</span>
      <span className="col-span-2 flex gap-1.5 md:col-span-1 md:justify-end">
        {routine.state === "paused"
          ? <Button size="sm" icon={Play} onClick={() => { set("on"); toast(`${routine.name} resumed`); }}>Resume</Button>
          : <Button size="sm" icon={Pause} onClick={() => { set("paused"); toast(`${routine.name} paused`, () => set(routine.state)); }}>Pause</Button>}
        <Button size="sm" icon={Zap} onClick={() => toast(`${routine.name} started. Its receipt lands in Usage when it finishes.`)}>Run now</Button>
      </span>
    </li>
  );
}

export function BotPage({ id }: { id?: string }) {
  const { data } = useStore();
  const bot = data.bots.find((b) => b.id === id);
  const [metric, setMetric] = useState<Metric>("turns");
  const [capOpen, setCapOpen] = useState(false);
  const rows = useBotRows();
  if (!bot) return <EmptyState state="confused" title="No bot by that name" action={<ButtonLink to="/bots" variant="primary">All bots</ButtonLink>}>It may have been deleted or moved to another Cloud.</EmptyState>;
  const row = rows.find((r) => r.bot.id === bot.id)!;
  const recent = data.turns.filter((t) => t.botId === bot.id).slice(0, 8);
  const pc = data.computers.find((c) => c.id === bot.computerId);
  const cost = charged(row.split);
  return (
    <>
      <Link to="/bots" className="mb-4 inline-flex h-8 items-center gap-1.5 text-13 text-ink-3 hover:text-ink"><ArrowLeft size={14} strokeWidth={STROKE} aria-hidden />Bots</Link>
      <header className="flex flex-wrap items-center gap-4 pb-6">
        <Mascot color={bot.color} body={bot.body} size={64} state="happy" label={bot.name} track />
        <div className="min-w-0 flex-1">
          <h1 className="text-24 font-semibold tracking-[-0.4px]">{bot.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-14 text-ink-3">{bot.role && <span>{bot.role}</span>}<span>{bot.engine}, {bot.model}</span><CoverageTag coverage={bot.engineCoverage} /></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setCapOpen(true)}>{bot.capUsd ? `Cap ${usd(bot.capUsd)}` : "Set a cap"}</Button>
          <ButtonLink to={`openmausbot://bot/${bot.id}`} external variant="primary" icon={ExternalLink}>Open in the app</ButtonLink>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-13 text-ink-3">This month</p>
          {bot.engineCoverage === "own"
            ? <><p className="num mt-1 text-24 font-semibold text-ink-4">~{usd(row.split.own)}</p><p className="mt-1 text-12 text-ink-3">Your own {bot.engine}, not billed</p></>
            : <><p className="num mt-1 text-24 font-semibold">{usd(cost)}</p>
              {bot.capUsd ? <div className="mt-2"><Ticks value={cost} max={bot.capUsd} size="lg" label={`${usd(cost)} of ${usd(bot.capUsd)}`} /><p className="mt-1.5 text-12 text-ink-3">of {usd(bot.capUsd)} cap</p></div> : <p className="mt-1 text-12 text-ink-3">No cap</p>}</>}
        </Card>
        <Card className="p-4"><p className="text-13 text-ink-3">Turns</p><p className="num mt-1 text-24 font-semibold">{int(row.turns)}</p><p className="mt-1 text-12 text-ink-3">this month</p></Card>
        <Card className="p-4"><p className="text-13 text-ink-3">Computer time</p><p className="num mt-1 text-24 font-semibold">{hours(row.minutes / 60)}</p><p className="mt-1 text-12 text-ink-3">{pc ? `on ${pc.name}, included` : "No computer"}</p></Card>
        <Card className="p-4"><p className="text-13 text-ink-3">Per turn</p><p className="num mt-1 text-24 font-semibold">{usdTiny(row.turns ? (bot.engineCoverage === "own" ? row.split.own : cost) / row.turns : 0)}</p><p className="mt-1 text-12 text-ink-3">average this month</p></Card>
      </div>

      <Card className="mt-4">
        <CardHead title="Activity">
          <Segmented size="sm" label="Heatmap metric" value={metric} onChange={setMetric} options={[{ value: "turns", label: "Turns" }, { value: "spend", label: "Spend" }, { value: "hours", label: "Computer hours" }]} />
        </CardHead>
        <div className="px-4 pb-4 pt-1">
          <Heatmap turns={data.turns} bots={data.bots} now={data.now} metric={metric} botId={bot.id} weekStart={data.account.weekStart === "monday" ? 1 : 0}
            onPick={(from, to) => navigate(`/usage?bot=${bot.id}&from=${from}&to=${to ?? from}`)} />
        </div>
      </Card>

      <SubHead title="Routines" />
      <Card>
        {bot.routines.length === 0
          ? <EmptyState color={bot.color} body={bot.body} title={`${bot.name} has no routines`} state="drowsy">Routines run on a schedule, like a morning brief. Ask {bot.name} in the app to set one up; its cost per run shows here before it starts.</EmptyState>
          : <ul>{bot.routines.map((r) => <RoutineRow key={r.id} routine={r} now={data.now} periodEnd={data.billing.periodEnd} />)}</ul>}
      </Card>

      <div className="mt-10 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="min-w-0">
          <CardHead icon={CalendarClock} title="Recent turns"><Link to={`/usage?bot=${bot.id}`} className="text-12 font-medium text-ink-3 hover:text-ink">All in Usage</Link></CardHead>
          <ul className="px-2 pb-2">
            {recent.map((t) => {
              const s = splitOf(t);
              return (
                <li key={t.id}>
                  <Link to={`/usage?bot=${bot.id}&turn=${t.id}`} className="flex min-h-10 items-center gap-3 rounded-row px-2 py-1.5 hover:bg-hover">
                    <span className="w-24 shrink-0 text-12 text-ink-3 sm:w-28">{dateTime(t.at)}</span>
                    <span className="min-w-0 flex-1 truncate text-13">{t.title}</span>
                    <StatusTag status={t.status} />
                    <span className={cx("num w-16 text-end text-13", s.own ? "text-ink-4" : "font-medium")}>{t.status !== "ok" ? usd(0) : s.own ? `~${usdTiny(s.own)}` : usdTiny(s.paid + s.trial + s.included)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardHead icon={Plug} title="Apps it can use" />
          <ul className="px-4 pb-3">
            {bot.connectors.map((c) => (
              <li key={c.name} className="flex min-h-10 items-center justify-between gap-3 border-b border-row last:border-0">
                <span className="text-13 font-medium">{c.name}</span><span className="text-12 text-ink-3">{c.access}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-row px-4 py-3 text-12 text-ink-3">Change what {bot.name} may do in the app, or disconnect an app for every bot in <Link to="/account/connections" className="font-medium text-ink underline-offset-2 hover:underline">Connections</Link>.</p>
        </Card>
      </div>
      <CapDialog key={bot.id} bot={bot} open={capOpen} onClose={() => setCapOpen(false)} />
    </>
  );
}
