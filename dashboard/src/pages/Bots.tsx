import { ArrowLeft } from "lucide-react";
import type { BotReport, ComputerReport, WorkspaceDetail } from "../../../shared/dashboard-protocol";
import { useSession } from "../data/session";
import { ago, bytes, compact, plural, until, usd } from "../lib/format";
import { Link } from "../lib/router";
import { Badge, ButtonLink, Card, KV, PageHeader, SectionTitle, Stat } from "../ui/kit";
import { BotMascot } from "../ui/Mascot";
import { SkyEmpty } from "../ui/Sky";
import { CommandButton, WorkspaceGate } from "./common";
import { APP_LINK } from "../lib/usage";

const PLACE: Record<NonNullable<BotReport["computer"]>, string> = { vps: "Cloud computer", "local-vm": "This Mac's VM", team: "Shared computer" };

export function computerFor(detail: WorkspaceDetail, bot: BotReport): ComputerReport | null {
  return detail.report?.computers?.computers.find((c) => c.botId === bot.id) ?? null;
}

export function StatePill({ state }: { state: ComputerReport["state"] }) {
  const map = { running: ["good", "Running"], asleep: ["plain", "Asleep"], starting: ["warn", "Waking"], missing: ["plain", "Not set up"], unknown: ["plain", "Unknown"] } as const;
  const [tone, label] = map[state];
  return <Badge tone={tone}><span className="live-dot !size-1.5" data-live={state === "starting"} aria-hidden />{label}</Badge>;
}

export function ComputerActions({ bot, computer }: { bot: Pick<BotReport, "id" | "name">; computer: ComputerReport | null }) {
  if (!computer || computer.state === "missing") return null;
  return computer.state === "running" || computer.state === "starting"
    ? <CommandButton kind="computer.sleep" target={bot.id} label="Sleep" doing="Sleeping…" />
    : <CommandButton kind="computer.wake" target={bot.id} label="Wake" doing="Waking…" />;
}

function BotRow({ bot, detail, now }: { bot: BotReport; detail: WorkspaceDetail; now: number }) {
  const usage = detail.report?.activity?.byBot.find((b) => b.botId === bot.id);
  const computer = computerFor(detail, bot);
  return (
    <li className="hover-row relative grid grid-cols-[minmax(0,1fr)_120px_110px_auto] items-center gap-4 rounded-row px-3 py-3 transition-colors duration-150 max-md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-3.5">
        <BotMascot bot={bot} size={36} />
        <div className="min-w-0">
          <Link to={`/bots/${encodeURIComponent(bot.id)}`} className="block truncate text-14 font-medium text-ink after:absolute after:inset-0 after:rounded-row after:content-['']">{bot.name}</Link>
          <div className="truncate text-13 text-ink-3">{[bot.model, bot.computer ? PLACE[bot.computer] : null].filter(Boolean).join(" · ") || "No model set"}</div>
        </div>
      </div>
      <div className="num text-13 text-ink-2 max-md:hidden">{usage ? plural(usage.turns, "turn") : "No turns yet"}</div>
      <div className="text-13 text-ink-3 max-md:hidden">{bot.busy ? <span className="text-good">Working now</span> : ago(bot.lastActiveAt, now)}</div>
      <div className="relative z-10 flex items-center gap-2">
        {computer && <span className="max-lg:hidden"><StatePill state={computer.state} /></span>}
        <ButtonLink to={APP_LINK} external size="sm">Open</ButtonLink>
      </div>
    </li>
  );
}

export function BotsPage() {
  const { now } = useSession();
  return (
    <div>
      <PageHeader title="Bots" sub="Everyone on this workspace, what they run on and when they last worked." />
      <WorkspaceGate>
        {(detail) => {
          const bots = [...(detail.report?.bots ?? [])].sort((a, b) => Number(b.busy) - Number(a.busy) || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
          if (!bots.length) return <SkyEmpty title="No bots here yet" action={<ButtonLink to={APP_LINK} external variant="primary">Open the app</ButtonLink>}>Make your first bot in the app; it shows up here on the next report.</SkyEmpty>;
          return (
            <Card className="!p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_120px_110px_auto] gap-4 px-3 pb-2 pt-2 text-12 text-ink-4 max-md:hidden" aria-hidden>
                <span>Bot</span><span>This year</span><span>Last active</span><span />
              </div>
              <ul>{bots.map((b) => <BotRow key={b.id} bot={b} detail={detail} now={now} />)}</ul>
            </Card>
          );
        }}
      </WorkspaceGate>
    </div>
  );
}

export function BotPage({ id }: { id: string }) {
  const { now } = useSession();
  return (
    <div>
      <Link to="/bots" className="press-soft hover-ghost -ms-2 mb-6 inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-13 text-ink-2"><ArrowLeft size={15} strokeWidth={1.5} aria-hidden /> Bots</Link>
      <WorkspaceGate>
        {(detail) => {
          const bot = detail.report?.bots?.find((b) => b.id === id);
          if (!bot) return <SkyEmpty title="That bot is not on this workspace">It may have been deleted, or it lives on another workspace. Switch workspaces in the sidebar.</SkyEmpty>;
          const usage = detail.report?.activity?.byBot.find((b) => b.botId === bot.id);
          const computer = computerFor(detail, bot);
          return (
            <div className="flex flex-col gap-4">
              <header className="mb-4 flex flex-wrap items-center gap-5">
                <BotMascot bot={bot} size={72} still={false} track />
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-28 font-medium tracking-[-0.02em] text-ink">{bot.name}</h1>
                  <p className="mt-1 text-14 text-ink-3">{bot.busy ? <span className="text-good">Working now</span> : `Last active ${ago(bot.lastActiveAt, now)}`}</p>
                </div>
                <ButtonLink to={APP_LINK} external variant="primary">Open in the app</ButtonLink>
              </header>
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <SectionTitle>Activity this year</SectionTitle>
                  <div className="grid grid-cols-3 gap-4">
                    <Stat label="Turns" value={(usage?.turns ?? 0).toLocaleString("en-US")} />
                    <Stat label="Tokens" value={compact(usage?.tokens ?? 0)} />
                    <Stat label="Spend" value={usd(usage?.costUsd ?? 0)} />
                  </div>
                  <dl className="mt-5 divide-y divide-line border-t border-line">
                    <KV k="Model" v={bot.model ?? "Not set"} />
                    <KV k="Engine" v={bot.engine ?? "Not set"} />
                  </dl>
                </Card>
                <Card>
                  <SectionTitle action={<ComputerActions bot={bot} computer={computer} />}>Computer</SectionTitle>
                  {computer ? (
                    <dl className="divide-y divide-line">
                      <KV k="State" v={<StatePill state={computer.state} />} />
                      <KV k="Where" v={bot.computer ? PLACE[bot.computer] : computer.kind} />
                      <KV k="Memory" v={computer.memoryBytes !== null ? `${bytes(computer.memoryBytes)}${computer.memoryLimitBytes ? ` of ${bytes(computer.memoryLimitBytes)}` : ""}` : "n/a"} />
                      <KV k="Last used" v={ago(computer.lastUsedAt, now)} />
                    </dl>
                  ) : <p className="text-14 text-ink-3">{bot.name} has no computer of its own. Give it one in the app's bot settings.</p>}
                </Card>
              </div>
              <Card>
                <SectionTitle>Routines</SectionTitle>
                {bot.routines.length ? (
                  <ul className="divide-y divide-line">
                    {bot.routines.map((r) => (
                      <li key={r.id} className="flex items-center gap-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-14 text-ink">{r.name}</div>
                          <div className="truncate text-13 text-ink-3">{r.schedule}{r.paused ? " · Paused" : r.nextRunAt ? ` · Next ${until(r.nextRunAt, now)}` : ""}</div>
                        </div>
                        {r.paused
                          ? <CommandButton kind="routine.resume" target={r.id} label="Resume" doing="Resuming…" />
                          : <CommandButton kind="routine.pause" target={r.id} label="Pause" doing="Pausing…" />}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-14 text-ink-3">No routines. Ask {bot.name} in a chat to do something on a schedule.</p>}
              </Card>
            </div>
          );
        }}
      </WorkspaceGate>
    </div>
  );
}
