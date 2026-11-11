import { ArrowLeft } from "lucide-react";
import type { BotReport, ComputerReport, WorkspaceDetail } from "../../../../shared/dashboard-protocol";
import { ago, bytes, compact, until, usd } from "../lib/format";
import { Link } from "../lib/router";
import { Button, Card, cx, KV, PageHeader, SectionTitle, Stat } from "../ui/kit";
import { botMood } from "../data/mood";
import { BotMascot } from "../ui/Mascot";
import { SkyEmpty } from "../ui/Sky";
import { Nil, Table, Td, Th } from "../ui/table";
import { CommandButton, WorkspaceGate } from "./common";
import { appLink, openApp } from "../lib/app-link";
import { useNow } from "../lib/now";

const PLACE: Record<NonNullable<BotReport["computer"]>, string> = { vps: "cloud computer", "local-vm": "this mac's vm", team: "shared computer" };

export function computerFor(detail: WorkspaceDetail, bot: BotReport): ComputerReport | null {
  return detail.report?.computers?.computers.find((c) => c.botId === bot.id) ?? null;
}

export function StatePill({ state }: { state: ComputerReport["state"] }) {
  const map = { running: ["text-good", "running"], asleep: ["text-ink-4", "asleep"], starting: ["text-warn", "waking"], missing: ["text-ink-4", "not set up"], unknown: ["text-ink-4", "unknown"] } as const;
  const [tone, label] = map[state];
  return <span className="inline-flex items-center gap-2 whitespace-nowrap text-13 text-ink-2"><span className={cx("live-dot !size-1.5", tone)} data-live={state === "starting"} aria-hidden />{label}</span>;
}

export function ComputerActions({ bot, computer }: { bot: Pick<BotReport, "id" | "name">; computer: ComputerReport | null }) {
  if (!computer || computer.state === "missing") return null;
  return computer.state === "running" || computer.state === "starting"
    ? <CommandButton kind="computer.sleep" target={bot.id} label="sleep" doing="sleeping…" />
    : <CommandButton kind="computer.wake" target={bot.id} label="wake" doing="waking…" />;
}

function BotRow({ bot, detail, now }: { bot: BotReport; detail: WorkspaceDetail; now: number }) {
  const usage = detail.report?.activity?.byBot.find((b) => b.botId === bot.id);
  const computer = computerFor(detail, bot);
  return (
    <tr className="hover-row relative">
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <BotMascot bot={bot} mood={botMood(bot, { computer: computer?.state, freshness: detail.workspace.freshness })} size={36} />
          <div className="min-w-0">
            <Link to={`/bots/${encodeURIComponent(bot.id)}`} className="block truncate font-medium text-ink after:absolute after:inset-0 after:content-['']">{bot.name}</Link>
            <div className="truncate text-13 text-ink-3 md:hidden">{bot.busy ? <span className="text-good">working now</span> : bot.model ?? "no model set"}</div>
          </div>
        </div>
      </Td>
      <Td className="max-w-[220px] truncate text-ink-2 max-md:hidden">{bot.model ?? <Nil />}</Td>
      <Td className="text-ink-2 max-lg:hidden">{computer ? <StatePill state={computer.state} /> : bot.computer ? PLACE[bot.computer] : <Nil />}</Td>
      <Td className="num text-end text-ink-2 max-md:hidden">{usage ? usage.turns.toLocaleString("en-US") : <Nil />}</Td>
      <Td className="whitespace-nowrap text-ink-2 max-md:hidden">{bot.busy ? <span className="text-good">working now</span> : ago(bot.lastActiveAt, now)}</Td>
      <Td className="relative z-10 w-0 !ps-1 text-end"><Button size="sm" className="!h-9 !px-4 !text-14" onClick={() => openApp(appLink.bot(bot.id))} aria-label={`open ${bot.name} in the app`}>open</Button></Td>
    </tr>
  );
}

export function BotsPage() {
  const now = useNow();
  return (
    <div>
      <PageHeader title="bots" sub="everyone on this workspace, what they run on and when they last worked." />
      <WorkspaceGate>
        {(detail) => {
          const bots = [...(detail.report?.bots ?? [])].sort((a, b) => Number(b.busy) - Number(a.busy) || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
          if (!bots.length) return <SkyEmpty title="no bots here yet" action={<Button variant="primary" onClick={() => openApp(appLink.app)}>open the app</Button>}>make your first bot in the app; it shows up here on the next report.</SkyEmpty>;
          return (
            <Table label="bots" className="enter">
              <thead><tr><Th>bot</Th><Th className="max-md:hidden">model</Th><Th className="max-lg:hidden">computer</Th><Th className="!text-end max-md:hidden">turns this year</Th><Th className="max-md:hidden">last active</Th><Th className="w-0"><span className="sr-only">open</span></Th></tr></thead>
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
      <Link to="/bots" className="press-soft hover-ghost -ms-2 mb-6 inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-13 text-ink-2"><ArrowLeft size={15} strokeWidth={1.5} aria-hidden /> bots</Link>
      <WorkspaceGate>
        {(detail) => {
          const bot = detail.report?.bots?.find((b) => b.id === id);
          if (!bot) return <SkyEmpty title="that bot is not on this workspace">it may have been deleted, or it lives on another workspace. switch workspaces in the sidebar.</SkyEmpty>;
          const usage = detail.report?.activity?.byBot.find((b) => b.botId === bot.id);
          const computer = computerFor(detail, bot);
          return (
            <div className="flex flex-col gap-4">
              <header className="mb-4 flex flex-wrap items-center gap-5">
                <BotMascot bot={bot} mood={botMood(bot, { computer: computer?.state, freshness: detail.workspace.freshness })} size={88} track={900} tappable />
                <div className="min-w-0 flex-1">
                  <h1 className="t-title truncate">{bot.name}</h1>
                  <p className="mt-1 text-14 text-ink-3">{bot.busy ? <span className="text-good">working now</span> : `last active ${ago(bot.lastActiveAt, now)}`}</p>
                </div>
                <Button variant="primary" className="max-sm:w-full" onClick={() => openApp(appLink.bot(bot.id))}>open in the app</Button>
              </header>
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <SectionTitle>activity this year</SectionTitle>
                  <div className="grid grid-cols-3 gap-4">
                    <Stat label="turns" value={(usage?.turns ?? 0).toLocaleString("en-US")} />
                    <Stat label="tokens" value={compact(usage?.tokens ?? 0)} />
                    <Stat label="spend" value={usd(usage?.costUsd ?? 0)} />
                  </div>
                  <dl className="mt-5 divide-y divide-line border-t border-line">
                    <KV k="model" v={bot.model ?? "not set"} />
                    <KV k="engine" v={bot.engine ?? "not set"} />
                  </dl>
                </Card>
                <Card>
                  <SectionTitle action={<ComputerActions bot={bot} computer={computer} />}>computer</SectionTitle>
                  {computer ? (
                    <dl className="divide-y divide-line">
                      <KV k="state" v={<StatePill state={computer.state} />} />
                      <KV k="where" v={bot.computer ? PLACE[bot.computer] : computer.kind} />
                      <KV k="memory" v={computer.memoryBytes !== null ? `${bytes(computer.memoryBytes)}${computer.memoryLimitBytes ? ` of ${bytes(computer.memoryLimitBytes)}` : ""}` : "n/a"} />
                      <KV k="last used" v={ago(computer.lastUsedAt, now)} />
                    </dl>
                  ) : <p className="text-14 text-ink-3">{bot.name} has no computer of its own. give it one in the app's bot settings.</p>}
                </Card>
              </div>
              <Card>
                <SectionTitle>routines</SectionTitle>
                {bot.routines.length ? (
                  <ul className="divide-y divide-line">
                    {bot.routines.map((r) => (
                      <li key={r.id} className="flex items-center gap-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-14 text-ink">{r.name}</div>
                          <div className="truncate text-13 text-ink-3">{r.schedule}{r.paused ? " · paused" : r.nextRunAt ? ` · next ${until(r.nextRunAt, now)}` : ""}</div>
                        </div>
                        {r.paused
                          ? <CommandButton kind="routine.resume" target={r.id} label="resume" doing="resuming…" />
                          : <CommandButton kind="routine.pause" target={r.id} label="pause" doing="pausing…" />}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-14 text-ink-3">no routines. ask {bot.name} in a chat to do something on a schedule.</p>}
              </Card>
            </div>
          );
        }}
      </WorkspaceGate>
    </div>
  );
}
