import { useState } from "react";
import { AlertTriangle, ExternalLink, Moon, RotateCcw, Sunrise } from "lucide-react";
import { useStore } from "../data/store";
import type { BotComputer } from "../data/types";
import { ago, dateTime, duration, hours } from "../lib/format";
import { Button, ButtonLink, Card, CardHead, cx, PageHead, Pill, STROKE, SubHead, Ticks } from "../ui/kit";
import { BotStack, Mascot } from "../ui/Mascot";
import { ConfirmDialog } from "../ui/overlays";

function Screen({ pc }: { pc: BotComputer }) {
  const { data } = useStore();
  const bots = data.bots.filter((b) => pc.botIds.includes(b.id));
  const asleep = pc.state !== "running";
  return (
    <div className="relative aspect-[16/9] overflow-hidden rounded-[10px] border border-line bg-sunk">
      <img src="/art/sky-meadow.webp" alt="" className={cx("absolute inset-0 size-full object-cover transition-[filter,opacity] duration-500 ease-out", asleep && "opacity-60 grayscale-[0.7]")} />
      <div className="absolute inset-x-0 bottom-[24%] flex items-end justify-center gap-4">
        {bots.map((b, i) => (
          <span key={b.id} className={cx(!asleep && "drift")} style={{ animationDelay: `${-i * 1.7}s` }}>
            <Mascot color={b.color} body={b.body} size={44} state={pc.state === "waking" ? "waking" : asleep ? "sleeping" : "working"} label={`${b.name}, ${asleep ? "asleep" : "working"}`} />
          </span>
        ))}
      </div>
      <span className="absolute start-2.5 top-2.5">
        {pc.state === "running" ? <Pill tone="good" dot className="bg-surface/90">Awake</Pill> : pc.state === "waking" ? <Pill tone="accent" dot className="bg-surface/90">Waking</Pill> : <Pill className="bg-surface/90 text-ink-2">Asleep</Pill>}
      </span>
      {!asleep && <span className="absolute bottom-2.5 end-2.5 rounded-full bg-surface/90 px-2 py-0.5 text-12 text-ink-2">Live screen in the app</span>}
    </div>
  );
}

function ComputerCard({ pc }: { pc: BotComputer }) {
  const { data, update, toast } = useStore();
  const [reset, setReset] = useState(false);
  const [hidePressure, setHidePressure] = useState(false);
  const bots = data.bots.filter((b) => pc.botIds.includes(b.id));
  const setState = (state: BotComputer["state"]) => update((d) => ({ ...d, computers: d.computers.map((c) => (c.id === pc.id ? { ...c, state, ...(state === "running" ? { lastWokeAt: Date.now() } : {}) } : c)) }));
  const wake = () => { setState("waking"); setTimeout(() => { setState("running"); toast(`${pc.name} is awake`); }, 1600); };
  const allowance = data.allowances.find((a) => a.kind === "computerHours")!;
  return (
    <Card className="flex flex-col p-3">
      <Screen pc={pc} />
      <div className="flex flex-1 flex-col px-1 pt-3">
        <div className="flex items-center gap-2">
          <h2 className="text-16 font-medium">{pc.name}</h2>
          <span className="ms-auto"><BotStack bots={bots} /></span>
        </div>
        <p className="text-13 text-ink-3">Used by {bots.map((b) => b.name).join(" and ")}. {pc.state === "running" ? `Awake since ${ago(pc.lastWokeAt, data.now)}.` : `Last awake ${ago(pc.lastWokeAt, data.now)}.`}</p>
        {pc.pressure && !hidePressure && (
          <div className="mt-3 flex items-start gap-2 rounded-[10px] bg-warn-wash px-3 py-2 text-13 text-[#6b4800]">
            <AlertTriangle size={15} strokeWidth={STROKE} className="mt-0.5 shrink-0" aria-hidden />
            <p className="flex-1">{pc.pressure.text}</p>
            <button type="button" className="h-6 shrink-0 rounded-full px-2 text-12 font-medium hover:bg-black/5 pointer-coarse:h-11" onClick={() => setHidePressure(true)}>Got it</button>
          </div>
        )}
        <dl className="mt-3">
          <div className="flex h-9 items-center gap-3 border-b border-row"><dt className="flex-1 text-13 text-ink-3">Hours this month</dt><Ticks value={pc.hoursThisMonth} max={allowance.max} label={`${hours(pc.hoursThisMonth)} of ${allowance.max} included hours`} /><dd className="num w-16 text-end text-13 font-medium">{hours(pc.hoursThisMonth)}</dd></div>
          <div className="flex h-9 items-center gap-3 border-b border-row"><dt className="flex-1 text-13 text-ink-3">Memory</dt><dd className="num text-13 font-medium">{pc.state === "running" ? `${pc.memPct}% in use` : "Asleep"}</dd></div>
          <div className="flex h-9 items-center gap-3 border-b border-row"><dt className="flex-1 text-13 text-ink-3">Free disk</dt><dd className="num text-13 font-medium">{pc.diskFreeGb} GB</dd></div>
          <div className="flex min-h-9 items-center gap-3 py-2"><dt className="flex-1 text-13 text-ink-3">Sleeps</dt><dd className="text-end text-13 font-medium">after {pc.idleSleepMinutes} idle minutes, unless a routine is due within 30</dd></div>
        </dl>
        <div className="mt-auto flex flex-wrap gap-2 pt-3">
          {pc.state === "asleep" && <Button variant="primary" icon={Sunrise} onClick={wake}>Wake</Button>}
          {pc.state === "waking" && <Button variant="primary" disabled>Waking</Button>}
          {pc.state === "running" && <Button icon={Moon} onClick={() => { setState("asleep"); toast(`${pc.name} is asleep. A bot wakes it when needed.`, () => setState("running")); }}>Sleep now</Button>}
          <Button variant="ghost" icon={RotateCcw} onClick={() => setReset(true)}>Reset</Button>
          <ButtonLink to={`openmausbot://computer/${pc.id}`} external icon={ExternalLink} className="ms-auto">Watch live</ButtonLink>
        </div>
      </div>
      <ConfirmDialog open={reset} onClose={() => setReset(false)} title={`Reset ${pc.name}?`} action="Reset computer"
        consequences={["Apps and packages installed on it", "Open windows and anything unsaved"]} keeps={["Files in Home and every login in the vault", `${bots.map((b) => b.name).join(" and ")}, untouched`]}
        onConfirm={() => toast(`${pc.name} is being reset. Its files and logins stay.`)} />
    </Card>
  );
}

export function ComputersPage() {
  const { data } = useStore();
  const allowance = data.allowances.find((a) => a.kind === "computerHours")!;
  const sessions = data.computers.flatMap((pc) => pc.sessions.map((s) => ({ ...s, pc }))).sort((a, b) => b.start - a.start);
  return (
    <>
      <PageHead title="Bot computers" sub="Desktops your bots use for browsing, apps and files. They sleep when idle and wake when a bot needs them." />
      <Card className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5">
        <div className="min-w-[200px] flex-1">
          <p className="text-13 text-ink-3">Computer hours this month</p>
          <p className="num text-18 font-semibold">{hours(allowance.used)} <span className="text-13 font-normal text-ink-3">of {allowance.max} included</span></p>
        </div>
        <div className="w-full max-w-[360px]"><Ticks value={allowance.used} max={allowance.max} size="lg" label={`${hours(allowance.used)} of ${allowance.max} hours`} /></div>
        <p className="text-12 text-ink-3">{allowance.overUsd}, up to your Cloud cap.</p>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">{data.computers.map((pc) => <ComputerCard key={pc.id} pc={pc} />)}</div>
      <SubHead title="When they were awake" />
      <Card>
        <CardHead title="Recent sessions" />
        <ul className="px-4 pb-2">
          {sessions.map((s, i) => (
            <li key={i} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-b border-row py-2 last:border-0 sm:grid-cols-[90px_150px_90px_minmax(0,1fr)]">
              <span className="text-13 font-medium">{s.pc.name}</span>
              <span className="num text-end text-12 text-ink-3 sm:text-start sm:text-13 sm:text-ink-2">{dateTime(s.start)}</span>
              <span className="num text-13 text-ink-2">{s.end ? duration(s.end - s.start) : <Pill tone="good" dot>Awake now</Pill>}</span>
              <span className="truncate text-13 text-ink-3 max-sm:col-span-2">Woken by {s.wokeBy}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
