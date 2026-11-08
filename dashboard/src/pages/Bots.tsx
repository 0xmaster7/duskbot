import { ArrowLeft } from "lucide-react";
import type { BotReport, ComputerReport, WorkspaceDetail } from "../../../shared/dashboard-protocol";
import { ago, bytes, compact, until, usd } from "../lib/format";
import { Link } from "../lib/router";
import { Button, Card, cx, KV, PageHeader, SectionTitle, Stat } from "../ui/kit";
import { BotMascot } from "../ui/Mascot";
import { SkyEmpty } from "../ui/Sky";
import { Nil, Table, Td, Th } from "../ui/table";
import { CommandButton, WorkspaceGate } from "./common";
import { appLink, openApp } from "../lib/app-link";
import { useNow } from "../lib/now";

const PLACE: Record<NonNullable<BotReport["computer"]>, string> = { vps: "Cloud computer", "local-vm": "This Mac's VM", team: "Shared computer" };

export function computerFor(detail: WorkspaceDetail, bot: BotReport): ComputerReport | null {
  return detail.report?.computers?.computers.find((c) => c.botId === bot.id) ?? null;
}

export function StatePill({ state }: { state: ComputerReport["state"] }) {
  const map = { running: ["text-good", "Running"], asleep: ["text-ink-4", "Asleep"], starting: ["text-warn", "Waking"], missing: ["text-ink-4", "Not set up"], unknown: ["text-ink-4", "Unknown"] } as const;
  const [tone, label] = map[state];
  return <span className="inline-flex items-center gap-2 whitespace-nowrap text-13 text-ink-2"><span className={cx("live-dot !size-1.5", tone)} data-live={state === "starting"} aria-hidden />{label}</span>;
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
    <tr className="hover-row relative">
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <BotMascot bot={bot} size={32} />
          <div className="min-w-0">
            <Link to={`/bots/${encodeURIComponent(bot.id)}`} className="block truncate font-medium text-ink after:absolute after:inset-0 after:content-['']">{bot.name}</Link>
            <div className="truncate text-13 text-ink-3 md:hidden">{bot.busy ? <span className="text-good">Working now</span> : bot.model ?? "No model set"}</div>
          </div>
        </div>
      </Td>
      <Td className="max-w-[220px] truncate text-ink-2 max-md:hidden">{bot.model ?? <Nil />}</Td>
      <Td className="text-ink-2 max-lg:hidden">{computer ? <StatePill state={computer.state} /> : bot.computer ? PLACE[bot.computer] : <Nil />}</Td>
      <Td className="num text-end text-ink-2 max-md:hidden">{usage ? usage.turns.toLocaleString("en-US") : <Nil />}</Td>
      <Td className="whitespace-nowrap text-ink-2 max-md:hidden">{bot.busy ? <span className="text-good">Working now</span> : ago(bot.lastActiveAt, now)}</Td>
      <Td className="relative z-10 w-0 !ps-1 text-end"><Button size="sm" className="!h-9 !px-4 !text-14" onClick={() => openApp(appLink.bot(bot.id))} aria-label={`Open ${bot.name} in the app`}>Open</Button></Td>
    </tr>
  );
}

export function BotsPage() {
  const now = useNow();
  return (
    <div>
      <PageHeader title="Bots" sub="Everyone on this workspace, what they run on and when they last worked." />
      <WorkspaceGate>
        {(detail) => {
          const bots = [...(detail.report?.bots ?? [])].sort((a, b) => Number(b.busy) - Number(a.busy) || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
          if (!bots.length) return <SkyEmpty title="No bots here yet" action={<Button variant="primary" onClick={() => openApp(appLink.app)}>Open the app</Button>}>Make your first bot in the app; it shows up here on the next report.</SkyEmpty>;
          return (
            <Table label="Bots" className="enter">
              <thead><tr><Th>Bot</Th><Th className="max-md:hidden">Model</Th><Th className="max-lg:hidden">Computer</Th><Th className="!text-end max-md:hidden">Turns this year</Th><Th className="max-md:hidden">Last active</Th><Th className="w-0"><span className="sr-only">Open</span></Th></tr></thead>
              <tbody>{bots.map((b) => <BotRow key={b.id} bot={b} detail={detail} now={now} />)}</tbody>
            </Table>
          );
        }}
      </WorkspaceGate>
    </div>
  );
}

export function BotPage({ id }: { id: string }) {
  const now = useNow();
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
                  <h1 className="t-title truncate">{bot.name}</h1>
                  <p className="mt-1 text-14 text-ink-3">{bot.busy ? <span className="text-good">Working now</span> : `Last active ${ago(bot.lastActiveAt, now)}`}</p>
                </div>
                <Button variant="primary" className="max-sm:w-full" onClick={() => openApp(appLink.bot(bot.id))}>Open in the app</Button>
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
