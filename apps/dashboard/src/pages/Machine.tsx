import type { ReactNode } from "react";
import type { ComputerReport, WorkspaceDetail } from "../../../../shared/dashboard-protocol";
import { ago, bytes, duration, percent, rate } from "../lib/format";
import { Badge, Bar, Card, cx, KV, SectionTitle } from "../ui/kit";
import { BotMascot } from "../ui/Mascot";
import { Spark } from "../ui/Spark";
import { ComputerActions, StatePill } from "./Bots";

export function Metric({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col !p-5">
      <div className="text-13 text-ink-3">{label}</div>
      <div className="num swap mt-1.5 truncate text-20 font-medium tracking-[-0.01em] text-ink">{value}</div>
      <div className="mt-0.5 h-4 truncate text-12 text-ink-4">{sub}</div>
      <div className="mt-auto pt-4">{children}</div>
    </Card>
  );
}

export function ComputerRow({ c, detail, now }: { c: ComputerReport; detail: WorkspaceDetail; now: number }) {
  const bot = detail.report?.bots?.find((b) => b.id === c.botId) ?? null;
  const mem = c.memoryBytes !== null && c.memoryLimitBytes ? (c.memoryBytes / c.memoryLimitBytes) * 100 : null;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_110px_200px_auto] items-center gap-4 py-3 max-md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-3">
        {bot ? <BotMascot bot={bot} size={30} /> : <span className="size-[30px] shrink-0 rounded-full bg-card-2" aria-hidden />}
        <div className="min-w-0">
          <div className="truncate text-14 text-ink">{c.botName ?? c.name}</div>
          <div className="truncate text-13 text-ink-3">{c.state === "running" ? `Up · last used ${ago(c.lastUsedAt, now)}` : c.lastUsedAt ? `Last used ${ago(c.lastUsedAt, now)}` : c.name}</div>
        </div>
      </div>
      <div className="max-md:hidden"><StatePill state={c.state} /></div>
      <div className="min-w-0 max-md:hidden">
        <div className="num truncate text-13 text-ink-2">{c.memoryBytes !== null ? `${bytes(c.memoryBytes)}${c.memoryLimitBytes ? ` of ${bytes(c.memoryLimitBytes, 0)}` : ""}` : c.state === "running" ? "Reading memory" : "No memory in use"}{c.state === "running" && c.cpuPercent !== null && <span className="text-ink-4"> · {percent(c.cpuPercent)} CPU</span>}</div>
        {mem !== null && <Bar value={mem} className="mt-2" label={`${c.botName ?? c.name} memory used`} />}
      </div>
      <div className="flex justify-end">{c.botId ? <ComputerActions bot={{ id: c.botId, name: c.botName ?? c.name }} computer={c} /> : null}</div>
    </li>
  );
}

/** one workspace's machine: live meters, the server, its services and its bot computers */
const LINK = { direct: "Direct", relay: "Through the relay", off: "Off" } as const;

export function MachineView({ detail, now, limit, region }: { detail: WorkspaceDetail; now: number; limit?: number | null; region?: string }) {
  const m = detail.report?.machine;
  const h = detail.history;
  const computers = detail.report?.computers;
  if (!m) return <Card><p className="text-14 text-ink-3">This workspace has not sent machine stats yet.</p></Card>;
  const memPct = (m.memory.usedBytes / Math.max(1, m.memory.totalBytes)) * 100;
  const diskPct = m.disk ? (m.disk.usedBytes / Math.max(1, m.disk.totalBytes)) * 100 : 0;
  const running = computers?.computers.filter((c) => c.state === "running").length ?? 0;
  const link = detail.report?.devices?.link ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
        <Metric label="CPU" value={percent(m.cpu.percent)} sub={`Load ${m.cpu.load.map((l) => l.toFixed(2)).join(" ")}`}><Spark values={h.map((s) => s.cpu)} max={100} /></Metric>
        <Metric label="Memory" value={percent(memPct)} sub={`${bytes(m.memory.usedBytes)} of ${bytes(m.memory.totalBytes)}`}><Spark values={h.map((s) => s.mem)} max={100} /></Metric>
        <Metric label="Disk" value={m.disk ? percent(diskPct) : "n/a"} sub={m.disk ? `${bytes(m.disk.usedBytes)} of ${bytes(m.disk.totalBytes)}` : undefined}>
          <div className="flex h-10 items-end"><Bar value={diskPct} className="w-full" tone={diskPct > 90 ? "warn" : "ink"} label="Disk used" /></div>
        </Metric>
        <Metric label="Network" value={m.network ? rate(m.network.rxBytesPerSec) : "n/a"} sub={m.network ? `${rate(m.network.txBytesPerSec)} out` : undefined}><Spark values={h.map((s) => s.rx)} /></Metric>
      </div>
      <Card aria-labelledby="computers-title">
        <SectionTitle id="computers-title" action={<span className="num text-13 text-ink-3">{running} running{limit !== undefined ? ` · ${computers?.computers.length ?? 0} of ${limit === null ? "unlimited" : limit}` : ""}</span>}>Bot computers</SectionTitle>
        {limit !== undefined && limit !== null && <Bar value={((computers?.computers.length ?? 0) / Math.max(1, limit)) * 100} className="-mt-1 mb-3" label="Bot computers used" />}
        {computers?.computers.length ? (
          <ul className="divide-y divide-line">{computers.computers.map((c) => <ComputerRow key={c.id} c={c} detail={detail} now={now} />)}</ul>
        ) : (
          <p className="text-14 text-ink-3">{computers?.provider === "none" ? "No bot computers here. Give a bot a computer in the app's bot settings." : "No bot computers yet. They appear once a bot uses its computer."}</p>
        )}
      </Card>
      <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <SectionTitle action={m.update?.available ? <Badge tone="accent">Update {m.update.latest} ready</Badge> : <Badge>Up to date</Badge>}>Server</SectionTitle>
          <dl className="divide-y divide-line">
            <KV k="Machine uptime" v={duration(m.uptimeSec)} />
            <KV k="OpenMausBot running for" v={duration(m.processUptimeSec)} />
            <KV k="Host" v={`${m.host.hostname} · ${m.host.platform} ${m.host.arch}`} />
            {region && <KV k="Region" v={region} />}
            <KV k="Processor" v={`${m.host.cpus} ${m.host.cpus === 1 ? "core" : "cores"}${m.host.cpuModel ? ` · ${m.host.cpuModel}` : ""}`} />
            <KV k="Version" v={`${m.app.version} · Node ${m.app.node}`} />
            <KV k="Last report" v={ago(detail.report?.at ?? null, now)} />
          </dl>
          {m.update?.available && m.update.how && <p className="mt-4 text-13 leading-[1.5] text-ink-3">{m.update.how}</p>}
        </Card>
        <Card>
          <SectionTitle>Services</SectionTitle>
          <ul className="divide-y divide-line">
            {m.services.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <span className={cx("live-dot", s.state === "running" ? "text-good" : s.state === "stopped" ? "text-bad" : "text-ink-4")} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-14 text-ink">{s.name}</span>
                <span className="truncate text-13 text-ink-3">{s.state === "running" ? "Running" : s.state === "stopped" ? "Stopped" : "Unknown"}</span>
              </li>
            ))}
            {link && (
              <li className="flex items-center gap-3 py-2.5">
                <span className={cx("live-dot", link.mode === "off" ? "text-ink-4" : link.connected ? "text-good" : "text-warn")} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-14 text-ink">Phone link</span>
                <span className="truncate text-13 text-ink-3">{link.mode === "off" ? "Off" : link.connected ? `${LINK[link.mode]}${link.since ? ` · since ${ago(link.since, now)}` : ""}` : "Reconnecting"}</span>
              </li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}
