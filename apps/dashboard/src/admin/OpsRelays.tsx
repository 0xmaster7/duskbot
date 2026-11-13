import { useId, useState, type ReactNode } from "react";
import { Button, cx } from "../ui/kit";
import { Modal, Switch } from "../ui/controls";
import { ago } from "../lib/format";
import { useNow } from "../lib/now";
import { toast } from "../lib/toast";
import { adminCall, useAdmin } from "./api";
import { percent, usd } from "./kit";
import { n } from "./ui";
import { Bar, Empty, Facts, Level, Meter, Panel, Person, PersonRow, size } from "./Ops";
import type { OpsLevel, OpsMeter, OpsRelayCard, OpsRelayLimits, OpsRelayStats } from "./ops-types";

/** bytes per second as megabits, the way link speeds are talked about */
export function mbit(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const v = (value * 8) / 1e6;
  return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(0) : v.toFixed(1)} mbit/s`;
}

type Unit = { label: string; factor: number };
const UNITS = { rate: { label: "mbit/s", factor: 125_000 }, gb: { label: "gb", factor: 1e9 }, mb: { label: "mb", factor: 1e6 }, count: { label: "", factor: 1 } } satisfies Record<string, Unit>;
const LIMITS: Record<string, { label: string; unit: Unit; hint?: string }> = {
  perTunnelBytesPerSec: { label: "speed per tunnel", unit: UNITS.rate },
  burstBytes: { label: "burst", unit: UNITS.mb, hint: "empty: a few seconds of the speed" },
  perTunnelDailyBytes: { label: "daily traffic per tunnel", unit: UNITS.gb },
  tunnelsPerAccount: { label: "tunnels per account", unit: UNITS.count },
  globalCeilingBytesPerSec: { label: "speed for everyone together", unit: UNITS.rate, hint: "shared evenly between active tunnels" },
  maxTunnels: { label: "busy tunnels", unit: UNITS.count, hint: "a screen or a download; past it, a new tunnel hears the relay is busy" },
  maxConnected: { label: "tunnels in use", unit: UNITS.count, hint: "an open desktop on a linked server; past it, a new tunnel hears the relay is busy" },
  maxServers: { label: "servers on this node", unit: UNITS.count, hint: "new servers go to another node from 90%" },
  accountBytesPerSec: { label: "speed per account", unit: UNITS.rate },
  accountFullSpeedBytes: { label: "full speed each month", unit: UNITS.gb, hint: "then it slows down step by step" },
  accountFloorAtBytes: { label: "slowest by", unit: UNITS.gb, hint: "past it, only the chat speed" },
  floorBytesPerSec: { label: "slowest speed", unit: UNITS.rate },
  chatBytesPerSec: { label: "chat speed", unit: UNITS.rate, hint: "past the slowest, enough for chat and approvals" },
  accountBurstSeconds: { label: "burst while slowed", unit: { label: "s", factor: 1 } },
};
const describe = (key: string) => LIMITS[key] ?? { label: key.replace(/([A-Z])/g, " $1").toLowerCase(), unit: /PerSec$/.test(key) ? UNITS.rate : /Bytes$/.test(key) ? UNITS.gb : UNITS.count };
const shown = (key: string, value: number | null | undefined) => {
  if (value === null || value === undefined) return "off";
  const { unit } = describe(key);
  const v = value / unit.factor;
  return `${Number.isInteger(v) ? n(v) : Math.round(v * 100) / 100}${unit.label ? ` ${unit.label}` : ""}`;
};
const numericKeys = (limits: OpsRelayLimits) => Object.keys(limits).filter((key) => key !== "paused" && (limits[key] === null || typeof limits[key] === "number"));

const isPaused = (stats: OpsRelayStats) => stats.limits.paused === true || stats.paused === true;
const isBusy = (stats: OpsRelayStats) => stats.busy === true || (typeof stats.busy === "object" && stats.busy !== null);
function stateOf(stats: OpsRelayStats): { level: OpsLevel; word: string } {
  if (isPaused(stats)) return { level: "watch", word: "new tunnels paused" };
  if (isBusy(stats)) return { level: "bad", word: "busy, turning new tunnels away" };
  return { level: "ok", word: "taking tunnels" };
}
const meterOf = (used: number, limit: number | null | undefined, projected: number | null = null): OpsMeter => {
  const cap = limit && limit > 0 ? limit : null;
  return { used, limit: cap, projected, level: cap === null ? "unknown" : used >= cap ? "bad" : used >= cap * 0.8 || (projected ?? 0) >= cap ? "watch" : "ok" };
};

/** a limits change: every field, then the changes spelled out before they are sent */
function LimitsEditor({ relay, open, onClose, onSaved }: { relay: OpsRelayCard; open: boolean; onClose(): void; onSaved(card: OpsRelayCard): void }) {
  const limits = relay.stats?.limits ?? {};
  const keys = numericKeys(limits);
  const base = useId();
  const initial = () => Object.fromEntries(keys.map((key) => [key, limits[key] === null || limits[key] === undefined ? "" : String(Math.round(((limits[key] as number) / describe(key).unit.factor) * 1000) / 1000)]));
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed: Record<string, number | null> = {};
  let bad: string | null = null;
  for (const key of keys) {
    const text = (draft[key] ?? "").trim();
    if (!text) { parsed[key] = null; continue; }
    const v = Number(text);
    if (!Number.isFinite(v) || v < 0) { bad ??= `${describe(key).label} needs a number, or leave it empty for off.`; continue; }
    parsed[key] = Math.round(v * describe(key).unit.factor);
  }
  const changes = keys.filter((key) => key in parsed && parsed[key] !== (limits[key] ?? null));
  const close = () => { if (busy) return; setReview(false); setError(null); setDraft(initial()); onClose(); };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const answer = await adminCall<{ relay: OpsRelayCard }>(`/ops/relays/${relay.id}/limits`, { method: "PUT", body: Object.fromEntries(changes.map((key) => [key, parsed[key]])) });
      onSaved(answer.relay);
      toast(`${relay.label} limits saved.`);
      setReview(false);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setReview(false);
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={close} title={review ? `change ${changes.length === 1 ? "this limit" : `these ${changes.length} limits`}?` : `${relay.label} limits`}
      footer={review
        ? <><Button variant="ghost" onClick={() => setReview(false)} disabled={busy}>back</Button><Button variant="primary" disabled={busy} aria-busy={busy} onClick={() => void save()}>{busy ? "saving" : "apply"}</Button></>
        : <><Button variant="ghost" onClick={close}>cancel</Button><Button variant="primary" disabled={!changes.length || !!bad} onClick={() => setReview(true)}>review changes</Button></>}>
      {review ? (
        <ul className="flex flex-col gap-1.5">
          {changes.map((key) => (
            <li key={key} className="flex items-baseline justify-between gap-3 text-13">
              <span className="text-ink-2">{describe(key).label}</span>
              <span className="font-mono text-ink num"><span className="text-ink-3">{shown(key, limits[key] as number | null)}</span> to {shown(key, parsed[key])}</span>
            </li>
          ))}
          <li className="mt-2 text-13 text-ink-3">tunnels pick up a new speed within about 10 seconds. tunnels already on stay on.</li>
        </ul>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 max-sm:grid-cols-1">
          {keys.map((key) => {
            const d = describe(key), id = `${base}-${key}`;
            return (
              <div key={key} className="min-w-0">
                <label htmlFor={id} className="mb-1.5 block text-13 text-ink-2">{d.label}{d.unit.label && <span className="text-ink-3"> in {d.unit.label}</span>}</label>
                <input id={id} inputMode="decimal" autoComplete="off" value={draft[key] ?? ""} placeholder="off" onChange={(e) => setDraft((v) => ({ ...v, [key]: e.target.value }))}
                  className="field !h-9 !px-3 font-mono !text-13" aria-describedby={d.hint ? `${id}-hint` : undefined} />
                {d.hint && <p id={`${id}-hint`} className="mt-1 text-12 text-ink-3">{d.hint}</p>}
              </div>
            );
          })}
          <p className="col-span-full text-12 text-ink-3">leave a field empty to turn that limit off.</p>
        </div>
      )}
      {(bad || error) && <p role="alert" className="mt-3 text-13 text-bad">{bad ?? error}</p>}
    </Modal>
  );
}

function PauseConfirm({ relay, pause, open, onClose, onSaved }: { relay: OpsRelayCard; pause: boolean; open: boolean; onClose(): void; onSaved(card: OpsRelayCard): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const answer = await adminCall<{ relay: OpsRelayCard }>(`/ops/relays/${relay.id}/limits`, { method: "PUT", body: { paused: pause } });
      onSaved(answer.relay);
      toast(pause ? `${relay.label}: new tunnels paused.` : `${relay.label}: taking new tunnels again.`);
      onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={() => { if (!busy) { setError(null); onClose(); } }} title={pause ? `pause new tunnels on the ${relay.label}?` : `take new tunnels on the ${relay.label} again?`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>keep it</Button><Button variant="primary" disabled={busy} aria-busy={busy} onClick={() => void run()}>{busy ? "working" : pause ? "pause" : "resume"}</Button></>}>
      <p className="text-14 text-ink-2">{pause
        ? "servers already on the relay stay on. a new one hears the relay is busy and uses the other path until you resume."
        : "new servers can get on this relay again, up to its tunnel limit."}</p>
      {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
    </Modal>
  );
}

function RelayCard({ relay, now, onSaved }: { relay: OpsRelayCard; now: number; onSaved(card: OpsRelayCard): void }) {
  const [editing, setEditing] = useState(false);
  const [pausing, setPausing] = useState<boolean | null>(null);
  const id = `ops-relay-${relay.id}`;
  const stats = relay.stats;
  if (!stats) {
    return (
      <Panel id={id} title={relay.label} meta={relay.configured ? <Level level="bad" word="can't read it" /> : <Level level="unknown" word="not set up" />}>
        <Empty>{relay.error ?? "no numbers yet."}</Empty>
      </Panel>
    );
  }
  const state = stateOf(stats), { limits } = stats, paused = isPaused(stats);
  const facts: Array<[string, ReactNode]> = [
    ["accounts on it", n(stats.now.accounts)],
    ["in now", mbit(stats.now.bytesPerSecIn)],
    ["today out", size(stats.today.bytesOut)],
    ["today in", size(stats.today.bytesIn)],
  ];
  if (stats.now.cpu !== null && stats.now.cpu !== undefined) facts.push(["cpu", `${Math.round(stats.now.cpu)}%`]);
  if (stats.now.rssMb !== null && stats.now.rssMb !== undefined) facts.push(["memory", `${n(Math.round(stats.now.rssMb))} mb`]);
  if (stats.node) {
    facts.push(["servers living here", n(stats.node.homed)]);
    facts.push(["new servers", stats.node.accepting ? "placed here" : `not placed here (${stats.node.refuses ?? "full"})`]);
  }
  if (stats.box) {
    if (stats.box.cpu !== null) facts.push(["box cpu", `${Math.round(stats.box.cpu)}%`]);
    if (stats.box.mem !== null) facts.push(["box memory", `${Math.round(stats.box.mem)}%`]);
    if (stats.box.bytesPerSecOut !== null) facts.push(["box out now", mbit(stats.box.bytesPerSecOut)]);
  }
  if (stats.turn) facts.push(["turn", stats.turn.ok === null ? "not checked yet" : stats.turn.ok ? `up${stats.turn.rttMs !== null ? `, ${stats.turn.rttMs} ms` : ""}` : "down"]);
  for (const peer of (stats.nodes ?? []).filter((one) => !one.self)) facts.push([`sees ${peer.id}`, peer.up ? "up" : peer.lastOkAt ? `down, last heard ${ago(peer.lastOkAt, now)}` : "never heard"]);
  if (stats.cost) {
    facts.push([stats.cost.estimated ? "cost so far, est." : "cost so far", <span className="text-money">{usd(Math.round(stats.cost.monthCents))}</span>]);
    facts.push(["cost at this pace", <span className="text-money">{usd(Math.round(stats.cost.projectedCents))}</span>]);
  }
  return (
    <Panel id={id} title={relay.label} meta={<Level level={state.level} word={state.word} />}
      foot={
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-1 pt-2.5">
          <label className="flex items-center gap-2.5 text-13 text-ink-2">
            <Switch checked={paused} onChange={(v) => setPausing(v)} label="pause new tunnels" />
            pause new tunnels
          </label>
          <Button size="sm" onClick={() => setEditing(true)}>edit limits</Button>
        </div>
      }>
      <div className="flex flex-col gap-3 px-2.5 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-13 text-ink"><span className="font-mono num">{n(stats.now.tunnels)}</span> {stats.now.connected !== undefined ? "busy" : "live"} {stats.now.tunnels === 1 ? "tunnel" : "tunnels"}</span>
          <span className="t-meta">{limits.maxTunnels ? `of ${n(limits.maxTunnels)}` : "no tunnel cap"}{stats.now.connected !== undefined ? ` · ${n(stats.now.connected)} in use` : ""}{stats.now.servers !== undefined ? ` · ${n(stats.now.servers)} servers` : ""} · updated {ago(relay.at, now)}</span>
        </div>
        <Meter label={limits.globalCeilingBytesPerSec ? "out now, of the ceiling" : "out now, no ceiling"} meter={meterOf(stats.now.bytesPerSecOut, limits.globalCeilingBytesPerSec)} format={mbit} />
        {stats.box?.monthBytesOut !== null && stats.box?.monthBytesOut !== undefined
          ? <Meter label="box out this month, of the allowance" meter={meterOf(stats.box.monthBytesOut, stats.month.allowanceBytes, stats.box.projectedBytesOut)} format={size} />
          : <Meter label={stats.month.allowanceBytes ? "out this month, of the allowance" : `out this month, ${size(stats.month.projectedBytesOut)} at this pace`}
            meter={meterOf(stats.month.bytesOut, stats.month.allowanceBytes, stats.month.projectedBytesOut)} format={size} />}
        <Facts items={facts} />
      </div>
      <div className="px-2.5 pb-1 pt-1 t-meta">top accounts today</div>
      {stats.top.length ? (
        <ul>
          {stats.top.slice(0, 5).map((row) => (
            <PersonRow key={row.account} accountId={row.accountId ?? null}>
              <Person accountId={row.accountId ?? null} email={row.email ?? null} fallback={`account ${row.account.slice(0, 8)}`} sub={`${n(row.tunnels)} ${row.tunnels === 1 ? "tunnel" : "tunnels"}`} />
              <span className="font-mono text-13 text-ink num">{size(row.bytesToday)}</span>
            </PersonRow>
          ))}
        </ul>
      ) : <Empty>nobody has used it today.</Empty>}
      {stats.fairUse ? <>
        <div className="px-2.5 pb-1 pt-3 t-meta">fair use this month, every node together</div>
        {stats.fairUse.accounts.length ? (
          <ul>
            {stats.fairUse.accounts.slice(0, 5).map((row) => (
              <PersonRow key={row.account ?? row.tunnel ?? ""} accountId={row.accountId ?? null}>
                <Person accountId={row.accountId ?? null} email={row.email ?? null} fallback={row.account ? `account ${row.account.slice(0, 8)}` : `server ${(row.tunnel ?? "").slice(0, 8)}`} sub={`now ${mbit(row.bytesPerSec)}`} />
                <span className="font-mono text-13 text-ink num">{size(row.monthBytes)}</span>
              </PersonRow>
            ))}
          </ul>
        ) : <Empty>nobody has used it this month.</Empty>}
      </> : null}
      <LimitsEditor key={editing ? "open" : "shut"} relay={relay} open={editing} onClose={() => setEditing(false)} onSaved={onSaved} />
      <PauseConfirm relay={relay} pause={pausing ?? false} open={pausing !== null} onClose={() => setPausing(null)} onSaved={onSaved} />
    </Panel>
  );
}

type RelaysAnswer = { relays: OpsRelayCard[]; at: number };
/** every link relay node and the cloudflare relay, live: refreshed every 10 s while the page is visible */
export function useRelays() {
  return useAdmin<RelaysAnswer>("/ops/relays", 10_000);
}

const isLink = (card: OpsRelayCard) => card.id !== "cloudflare";
const sum = (list: Array<number | null | undefined>) => list.some((v) => v === null || v === undefined) ? null : list.reduce<number>((a, v) => a + (v as number), 0);
/** what a node sends this month against its allowance: the whole box when it reports it, else the relay's own */
export function monthOut(stats: OpsRelayStats) {
  const box = stats.box?.monthBytesOut !== null && stats.box?.monthBytesOut !== undefined;
  return { used: box ? stats.box!.monthBytesOut! : stats.month.bytesOut, projected: box ? stats.box!.projectedBytesOut : stats.month.projectedBytesOut, allowance: stats.month.allowanceBytes };
}

function Of({ used, cap, format = n }: { used: number | null | undefined; cap: number | null | undefined; format?(v: number): string }) {
  return <span className="font-mono num"><span className="text-ink">{used === null || used === undefined ? "-" : format(used)}</span>{cap ? <span className="text-ink-3"> / {format(cap)}</span> : null}</span>;
}
function MonthCell({ used, cap, projected }: { used: number; cap: number | null; projected: number | null }) {
  const meter = meterOf(used, cap, projected);
  return (
    <span className="block min-w-[150px]">
      <span className="flex items-baseline justify-end gap-1.5"><Of used={used} cap={cap} format={size} /></span>
      {cap ? <span className="mt-1 block"><Bar share={used / cap} level={meter.level} tick={projected !== null ? projected / cap : null} /></span> : null}
      <span className="mt-0.5 block text-end text-12 text-ink-3">{projected !== null ? `${size(projected)} at this pace` : "no pace yet"}</span>
    </span>
  );
}

const SUMMARY_COLS = "grid grid-cols-[minmax(110px,1fr)_minmax(96px,auto)_minmax(84px,auto)_minmax(84px,auto)_minmax(150px,1fr)_80px_minmax(160px,1.3fr)] items-center gap-3";
/** both link nodes and their totals in one table: what is on them now, against every cap, and the month against the allowance */
export function RelaySummary({ data, error }: { data: RelaysAnswer | null; error: Error | null }) {
  const links = (data?.relays ?? []).filter(isLink);
  const read = links.flatMap((card) => card.stats ? [card.stats] : []);
  const paths = read.map((stats) => stats.paths).filter((p): p is NonNullable<OpsRelayStats["paths"]> => !!p);
  const split = paths.length ? { direct: paths.reduce((a, p) => a + p.direct, 0), cloudflare: paths.reduce((a, p) => a + p.cloudflare, 0), relay: paths.reduce((a, p) => a + p.relay, 0) } : null;
  const splitTotal = split ? split.direct + split.cloudflare + split.relay : 0;
  const row = (key: string, label: ReactNode, list: OpsRelayStats[], total = false) => {
    const months = list.map(monthOut);
    const cells: ReactNode[] = [
      <Of used={sum(list.map((s) => s.now.servers))} cap={sum(list.map((s) => s.limits.maxServers))} />,
      <Of used={sum(list.map((s) => s.now.connected))} cap={sum(list.map((s) => s.limits.maxConnected))} />,
      <Of used={sum(list.map((s) => s.now.tunnels))} cap={sum(list.map((s) => s.limits.maxTunnels))} />,
      <Of used={sum(list.map((s) => s.now.bytesPerSecOut))} cap={sum(list.map((s) => s.limits.globalCeilingBytesPerSec))} format={mbit} />,
      <span className="font-mono text-ink num">{size(sum(list.map((s) => s.today.bytesOut)))}</span>,
      <MonthCell used={sum(months.map((m) => m.used)) ?? 0} cap={sum(months.map((m) => m.allowance))} projected={sum(months.map((m) => m.projected))} />,
    ];
    return (
      <div key={key} role="row" className={cx(SUMMARY_COLS, "rounded-[12px] px-2.5 py-2 text-13", total && "bg-wash-lime")}>
        <span role="rowheader" className={cx("min-w-0 truncate", total ? "font-medium text-ink" : "text-ink")}>{label}</span>
        {cells.map((cell, i) => <span key={i} role="cell" className="text-end">{cell}</span>)}
      </div>
    );
  };
  return (
    <Panel id="ops-relays-summary" title="relays now" meta={data ? `${n(read.length)} of ${n(links.length)} ${links.length === 1 ? "node" : "nodes"} answering` : undefined}>
      {error && !data && <Empty>relays can't be read right now: {error.message}</Empty>}
      {!data && !error && <div className="h-[132px] animate-pulse rounded-[12px] bg-card" />}
      {data && (
        <div role="region" className="scroll-x" tabIndex={0} aria-label="relay nodes, scrolls sideways on a small screen">
          <div role="table" aria-label="relay nodes now and this month" className="min-w-[900px]">
            <div role="row" className={cx(SUMMARY_COLS, "px-2.5 pb-1 pt-1 t-meta")}>
              {["node", "servers", "in use", "busy", "out now, of ceiling", "today out", "this month out, of allowance"].map((label, i) => <span key={label} role="columnheader" className={i ? "text-end" : undefined}>{label}</span>)}
            </div>
            {links.map((card) => card.stats ? row(card.id, card.label.replace(/ relay/, ""), [card.stats])
              : <div key={card.id} role="row" className={cx(SUMMARY_COLS, "px-2.5 py-2 text-13")}><span role="rowheader" className="truncate text-ink">{card.label.replace(/ relay/, "")}</span><span role="cell" className="col-span-6 text-end text-12 text-ink-3">{card.error ?? "no numbers yet."}</span></div>)}
            {read.length > 1 && row("total", "every node", read, true)}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-2.5 pb-1.5 pt-2.5 text-12">
        <span className="text-ink-3">how apps reach their server this month</span>
        {split && splitTotal > 0
          ? <span className="font-mono text-ink-2 num">direct {percent(split.direct / splitTotal)} · their cloudflare {percent(split.cloudflare / splitTotal)} · our relay {percent(split.relay / splitTotal)}</span>
          : <span className="text-ink-3">not reported yet</span>}
      </div>
    </Panel>
  );
}

/** every relay's own card: limits, pause, its top accounts */
export function Relays({ data, error, setData }: { data: RelaysAnswer | null; error: Error | null; setData: ReturnType<typeof useRelays>["setData"] }) {
  const now = useNow(10_000);
  const saved = (card: OpsRelayCard) => setData((d) => d && { ...d, relays: d.relays.map((one) => one.id === card.id ? card : one) });
  return (
    <section aria-label="relays" className="mb-4">
      {error && !data && <p className="rounded-[24px] bg-card px-4 py-3 text-13 text-ink-3">relays can't be read right now: {error.message}</p>}
      {!data && !error && <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">{[0, 1].map((i) => <div key={i} className="h-[420px] animate-pulse rounded-[24px] bg-card" />)}</div>}
      {data && <div className={cx("grid grid-cols-2 items-start gap-4 max-lg:grid-cols-1")}>{data.relays.map((relay) => <RelayCard key={relay.id} relay={relay} now={now} onSaved={saved} />)}</div>}
    </section>
  );
}
