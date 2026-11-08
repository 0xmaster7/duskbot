import type { ReactNode } from "react";
import type { ComputerReport, WorkspaceDetail } from "../../../shared/dashboard-protocol";
import { ago, bytes, duration, percent, rate } from "../lib/format";
import { Bar, cx, KV } from "../ui/kit";
import { SectionHead } from "../ui/table";
import { BotMascot } from "../ui/Mascot";
import { Spark } from "../ui/Spark";
import { ComputerActions, StatePill } from "./Bots";

export function Metric({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col py-5 pe-6">
      <div className="text-13 text-ink-3">{label}</div>
      <div className="num swap mt-1 truncate text-20 font-semibold tracking-[-0.015em] text-ink">{value}</div>
      <div className="h-4 truncate text-12 text-ink-4">{sub}</div>
      <div className="mt-auto pt-3">{children}</div>
    </div>
  );
}

export function ComputerRow({ c, detail, now }: { c: ComputerReport; detail: WorkspaceDetail; now: number }) {
  const bot = detail.report?.bots?.find((b) => b.id === c.botId) ?? null;
  const mem = c.memoryBytes !== null && c.memoryLimitBytes ? (c.memoryBytes / c.memoryLimitBytes) * 100 : null;
  return (
    <li className="grid min-h-14 grid-cols-[minmax(0,1fr)_110px_160px_auto] items-center gap-4 py-2 max-md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-3">
        {bot ? <BotMascot bot={bot} size={26} /> : <span className="size-[26px] shrink-0 rounded-full bg-card-2" aria-hidden />}
        <div className="min-w-0">
          <div className="truncate text-14 text-ink">{c.botName ?? c.name}</div>
          <div className="truncate text-13 text-ink-3">{c.state === "running" ? `Up · last used ${ago(c.lastUsedAt, now)}` : c.lastUsedAt ? `Last used ${ago(c.lastUsedAt, now)}` : c.name}</div>
        </div>
      </div>
      <div className="max-md:hidden"><StatePill state={c.state} /></div>
      <div className="min-w-0 max-md:hidden">
        <div className="num truncate text-13 text-ink-2">{c.memoryBytes !== null ? `${bytes(c.memoryBytes)}${c.memoryLimitBytes ? ` of ${bytes(c.memoryLimitBytes, 0)}` : ""}` : c.state === "running" ? "Reading memory" : "No memory in use"}</div>
        {mem !== null && <Bar value={mem} className="mt-2" label={`${c.botName ?? c.name} memory used`} />}
      </div>
      <div className="flex justify-end">{c.botId ? <ComputerActions bot={{ id: c.botId, name: c.botName ?? c.name }} computer={c} /> : null}</div>
    </li>
  );
}

/** one workspace's machine: live meters, the server, its services and its bot computers */
export function MachineView({ detail, now, limit, server = true }: { detail: WorkspaceDetail; now: number; limit?: number | null; server?: boolean }) {
  const m = detail.report?.machine;
  const h = detail.history;
  const computers = detail.report?.computers;
  if (!m) return <p className="text-14 text-ink-3">This workspace has not sent machine stats yet.</p>;
  const memPct = (m.memory.usedBytes / Math.max(1, m.memory.totalBytes)) * 100;
  const diskPct = m.disk ? (m.disk.usedBytes / Math.max(1, m.disk.totalBytes)) * 100 : 0;
  const running = computers?.computers.filter((c) => c.state === "running").length ?? 0;
  return (
    <div className="flex flex-col gap-12">
      <div className="grid grid-cols-4 border-y border-line max-lg:grid-cols-2" aria-label="Machine">
        <Metric label="CPU" value={percent(m.cpu.percent)} sub={`${m.host.cpus} ${m.host.cpus === 1 ? "core" : "cores"}`}><Spark values={h.map((s) => s.cpu)} max={100} /></Metric>
        <Metric label="Memory" value={percent(memPct)} sub={`${bytes(m.memory.usedBytes)} of ${bytes(m.memory.totalBytes)}`}><Spark values={h.map((s) => s.mem)} max={100} /></Metric>
        <Metric label="Disk" value={m.disk ? percent(diskPct) : "n/a"} sub={m.disk ? `${bytes(m.disk.usedBytes)} of ${bytes(m.disk.totalBytes)}` : undefined}>
          <div className="flex h-8 items-end pb-1"><Bar value={diskPct} className="w-full" tone={diskPct > 90 ? "warn" : "ink"} label="Disk used" /></div>
        </Metric>
        <Metric label="Network" value={m.network ? rate(m.network.rxBytesPerSec) : "n/a"} sub={m.network ? `${rate(m.network.txBytesPerSec)} out` : undefined}><Spark values={h.map((s) => s.rx)} /></Metric>
      </div>
      <section aria-labelledby="computers-title">
        <SectionHead id="computers-title" action={<span className="num text-13 text-ink-3">{running} running{limit !== undefined ? ` · ${computers?.computers.length ?? 0} of ${limit === null ? "unlimited" : limit}` : ""}</span>}>Bot computers</SectionHead>
        {computers?.computers.length ? (
          <ul className="divide-y divide-line border-y border-line">{computers.computers.map((c) => <ComputerRow key={c.id} c={c} detail={detail} now={now} />)}</ul>
        ) : (
          <p className="border-y border-line py-5 text-14 text-ink-3">{computers?.provider === "none" ? "No bot computers here. Give a bot a computer in the app's bot settings." : "No bot computers yet. They appear once a bot uses its computer."}</p>
        )}
      </section>
      {server && <section aria-labelledby="server-title">
        <SectionHead id="server-title">Server</SectionHead>
        <dl className="divide-y divide-line border-y border-line">
          <KV className="!py-3" k="Version" v={m.update?.available ? `${m.app.version} · ${m.update.latest} is ready` : `${m.app.version} · up to date`} />
          <KV className="!py-3" k="Up for" v={duration(m.processUptimeSec)} />
          <KV className="!py-3" k="Host" v={`${m.host.hostname} · ${m.host.platform} ${m.host.arch}`} />
          <div className="flex items-baseline justify-between gap-4 py-3 text-14">
            <dt className="text-ink-3">Services</dt>
            <dd className="flex min-w-0 flex-wrap justify-end gap-x-4 gap-y-1">
              {m.services.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 text-ink">
                  <span className={cx("live-dot !size-1.5", s.state === "running" ? "text-good" : s.state === "stopped" ? "text-bad" : "text-ink-4")} aria-hidden />
                  {s.name}<span className="sr-only">, {s.state === "running" ? "running" : s.state === "stopped" ? "stopped" : "unknown"}</span>
                </span>
              ))}
            </dd>
          </div>
        </dl>
        {m.update?.available && m.update.how && <p className="mt-3 text-13 text-ink-3">{m.update.how}</p>}
      </section>}
    </div>
  );
}
