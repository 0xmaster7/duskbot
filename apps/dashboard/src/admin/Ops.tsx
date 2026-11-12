import { useId, useState, type ReactNode } from "react";
import { ChevronDown, RefreshCw } from "@/icons";
import { Button, cx, Segmented } from "../ui/kit";
import { Table, Td, Th } from "../ui/table";
import { AnimatePresence, m } from "../ui/motion";
import { ago, compact } from "../lib/format";
import { Link } from "../lib/router";
import { useNow } from "../lib/now";
import { toast } from "../lib/toast";
import { adminCall, useAdmin } from "./api";
import { Avatar, percent, personName, usd } from "./kit";
import { BarRow, ChartCard } from "./charts";
import { Sparkline } from "./RevenueCharts";
import { AdminHeader, Failed, Loading, n, Section } from "./ui";
import type { OpsAnswer, OpsBox, OpsCheck, OpsCheckGroup, OpsInstabox, OpsLevel, OpsMeter, OpsRule, OpsSource, OpsSourceId, OpsSpend } from "./ops-types";

const personLink = (accountId: string) => `/admin/people/visitors?person=${encodeURIComponent(accountId)}`;
function size(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const units = ["b", "kb", "mb", "gb", "tb"];
  let v = value, i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
const perSecond = (value: number) => `${size(value)}/s`;
const short = (value: number) => compact(value).toLowerCase();
const gb = (value: number) => `${Math.round(value * 10) / 10} gb`;
const hours = (value: number) => `${n(Math.round(value))} h`;

const LEVEL_DOT: Record<OpsLevel, string> = { ok: "bg-good", watch: "bg-warn", bad: "bg-bad", unknown: "bg-ink-4" };
const LEVEL_WORD: Record<OpsLevel, string> = { ok: "ok", watch: "watch", bad: "bad", unknown: "unknown" };
const RULE_LEVEL: Record<OpsRule["state"], OpsLevel> = { ok: "ok", pending: "watch", firing: "bad" };

/** a level as a small square plus its word, so colour is never the only signal */
function Level({ level, word, quiet }: { level: OpsLevel; word?: string; quiet?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={cx("inline-block size-[7px] shrink-0 rounded-[2px]", LEVEL_DOT[level])} />
      <span className={cx("text-12", quiet && level === "ok" ? "sr-only" : level === "ok" || level === "unknown" ? "text-ink-3" : "text-ink-2")}>{word ?? LEVEL_WORD[level]}</span>
    </span>
  );
}

function Stat({ label, value, note, money, tone }: { label: string; value: string; note?: string; money?: boolean; tone?: "bad" }) {
  return (
    <div className={cx("min-w-0 rounded-[14px] px-3 py-2.5", money ? "bg-wash-lime" : "bg-card")} title={note}>
      <div className="truncate text-12 text-ink-3">{label}</div>
      <div className={cx("mt-0.5 truncate font-mono text-15 font-medium num", money ? "text-money" : tone === "bad" ? "text-bad" : "text-ink")}>{value}</div>
    </div>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="t-meta">{children}</span>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-1 py-3 text-13 text-ink-3">{children}</p>;
}

/** one quota: what's used against the plan, with a tick where the period ends at this pace */
function Meter({ label, meter, format }: { label: string; meter: OpsMeter; format(v: number): string }) {
  const limit = meter.limit && meter.limit > 0 ? meter.limit : null;
  const used = limit ? Math.min(1, meter.used / limit) : 0;
  const pace = limit && meter.projected !== null ? Math.min(1, meter.projected / limit) : null;
  const over = limit && meter.projected !== null && meter.projected > limit;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="flex items-center gap-2 text-13 text-ink-2">{label} <Level level={meter.level} quiet /></span>
        <span className="font-mono text-12 text-ink-3 num"><span className="text-ink">{format(meter.used)}</span>{limit ? ` of ${format(limit)}` : ""}</span>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-track" role="img" aria-label={`${label}: ${format(meter.used)}${limit ? ` of ${format(limit)}` : ""}${meter.projected !== null ? `, ${format(meter.projected)} at this pace` : ""}`}>
        {limit && <span className={cx("bar-fill absolute inset-0 block rounded-full", meter.level === "bad" ? "bg-bad" : meter.level === "watch" ? "bg-warn" : "bg-accent")} style={{ transform: `scaleX(${Math.max(0.01, used)})` }} />}
        {pace !== null && <span aria-hidden className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-ink-2" style={{ left: `${pace * 100}%` }} />}
      </div>
      {meter.projected !== null && <div className="mt-1.5 text-12 text-ink-3">month pace <span className="font-mono text-ink-2 num">{format(meter.projected)}</span>{over ? ", past the plan" : ""}</div>}
    </div>
  );
}

/** a provider block that has nothing yet: one quiet line, never an error wall */
function NotYet({ title, source }: { title: string; source: OpsSource | undefined }) {
  return (
    <ChartCard title={title}>
      <p className="text-13 text-ink-3">
        {!source || !source.configured ? "not set up yet." : source.error ? `not collected yet: ${source.error}` : "not collected yet."}
      </p>
    </ChartCard>
  );
}

function Person({ accountId, email, fallback, sub }: { accountId: string | null; email: string | null; fallback?: string; sub?: ReactNode }) {
  const body = (
    <span className="flex min-w-0 items-center gap-2.5">
      {accountId && <Avatar seed={accountId} size={20} customer />}
      <span className="min-w-0">
        <span className="block truncate text-13 text-ink">{accountId ? personName(accountId, email) : email ?? fallback ?? "unknown"}</span>
        {sub && <span className="block truncate text-12 text-ink-4">{sub}</span>}
      </span>
    </span>
  );
  return body;
}


function Glance({ data }: { data: OpsAnswer }) {
  const t = data.spend.totals;
  const firing = data.alerts.filter((rule) => rule.state === "firing").length;
  const bad = data.health.checks.filter((check) => check.level === "bad").length;
  return (
    <section className="rounded-[28px] bg-card p-2" aria-label="at a glance">
      <div className="grid grid-cols-5 gap-1.5 max-lg:grid-cols-3 max-sm:grid-cols-2">
        <Stat label="spend this month" value={usd(t.monthCents)} money />
        <Stat label="month pace" value={usd(t.projectedCents)} money />
        <Stat label="today" value={usd(t.todayCents)} money />
        <Stat label="alerts firing" value={n(firing)} tone={firing ? "bad" : undefined} note={`${n(data.alerts.length)} rules`} />
        <Stat label="checks bad" value={n(bad)} tone={bad ? "bad" : undefined} note={`${n(data.health.checks.length)} checks`} />
      </div>
    </section>
  );
}


const LINE_COLS = "grid-cols-[minmax(0,1.2fr)_96px_96px_minmax(0,2fr)] max-md:grid-cols-[minmax(0,1fr)_auto]";
function Lines({ spend }: { spend: OpsSpend }) {
  return (
    <ChartCard title="by provider" action={<Meta>so far and month pace</Meta>}>
      <div className={cx("-mx-1 grid gap-4 px-2.5 pb-1 t-meta max-md:hidden", LINE_COLS)}><span>provider</span><span className="text-end">so far</span><span className="text-end">month pace</span><span>note</span></div>
      <ul className="-mx-1">
        {spend.lines.map((line) => (
          <li key={line.provider} className={cx("grid items-center gap-x-4 gap-y-0.5 rounded-[12px] px-2.5 py-2", LINE_COLS)}>
            <span className="truncate text-13 text-ink">{line.label}</span>
            <span className={cx("text-end font-mono text-13 num", line.monthCents > 0 ? "font-medium text-money" : "text-ink-4")}>{usd(line.monthCents)}</span>
            <span className="text-end font-mono text-13 text-money num max-md:hidden">{usd(line.projectedCents)}</span>
            <span className="truncate text-12 text-ink-3 max-md:col-span-2" title={line.note}><span className="md:hidden">pace <span className="font-mono text-money num">{usd(line.projectedCents)}</span> · </span>{line.note}</span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

type Sort = "cost" | "awake" | "egress";
const CUSTOMER_COLS = "grid-cols-[minmax(0,2fr)_72px_72px_84px_84px] max-md:grid-cols-[minmax(0,1fr)_auto]";
function Instabox({ box }: { box: OpsInstabox }) {
  const [sort, setSort] = useState<Sort>("cost");
  const [open, setOpen] = useState(false);
  const machinesId = useId();
  const t = box.totals;
  const customers = [...box.customers].sort((a, b) => sort === "cost" ? b.costCents - a.costCents : sort === "awake" ? b.awakeHours - a.awakeHours : b.egressGb - a.egressGb);
  return (
    <ChartCard title="instabox" action={<Meta>{n(t.machines)} {t.machines === 1 ? "machine" : "machines"}, {n(t.customers)} {t.customers === 1 ? "customer" : "customers"}</Meta>}>
      <div className="grid grid-cols-6 gap-1.5 max-xl:grid-cols-3 max-sm:grid-cols-2">
        <Stat label="so far" value={usd(t.costCents)} money />
        <Stat label="month pace" value={usd(t.projectedCents)} money />
        <Stat label="today" value={usd(t.todayCents)} money />
        <Stat label="awake" value={hours(t.awakeHours)} note={`${n(Math.round(t.vcpuHours))} vcpu hours, ${n(Math.round(t.memGiBHours))} gib hours of memory`} />
        <Stat label="vcpu hours" value={n(Math.round(t.vcpuHours))} />
        <Stat label="egress" value={gb(t.egressGb)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1">
        <h3 className="text-13 font-medium text-ink">per customer</h3>
        <Segmented<Sort> label="sort customers by" value={sort} onChange={setSort} options={[{ value: "cost", label: "cost" }, { value: "awake", label: "awake" }, { value: "egress", label: "egress" }]} />
      </div>
      {customers.length ? (
        <>
          <div className={cx("mt-1 grid gap-4 px-2.5 py-2 t-meta max-md:hidden", CUSTOMER_COLS)}><span>customer</span><span className="text-end">awake</span><span className="text-end">egress</span><span className="text-end">so far</span><span className="text-end">month pace</span></div>
          <ul className="-mx-1">
            {customers.map((c) => (
              <m.li key={c.accountId} layout="position" transition={{ layout: { type: "spring", visualDuration: 0.26, bounce: 0 } }}>
                <Link to={personLink(c.accountId)} className={cx("hover-row grid items-center gap-4 rounded-[12px] px-2.5 py-2", CUSTOMER_COLS)}>
                  <Person accountId={c.accountId} email={c.email} sub={<>{c.plan} · {n(c.machines)} {c.machines === 1 ? "machine" : "machines"}<span className="md:hidden"> · {hours(c.awakeHours)} · {gb(c.egressGb)}</span>{c.egressState && <span className="text-warn"> · egress {c.egressState}</span>}</>} />
                  <span className="text-end font-mono text-13 text-ink num max-md:hidden">{hours(c.awakeHours)}</span>
                  <span className="text-end font-mono text-13 text-ink num max-md:hidden">{gb(c.egressGb)}</span>
                  <span className="text-end font-mono text-13 font-medium text-money num">{usd(c.costCents)}</span>
                  <span className="text-end font-mono text-13 text-money num max-md:hidden">{usd(c.projectedCents)}</span>
                </Link>
              </m.li>
            ))}
          </ul>
        </>
      ) : <Empty>no managed cloud usage this month yet.</Empty>}

      <button type="button" aria-expanded={open} aria-controls={machinesId} onClick={() => setOpen((v) => !v)} className="hover-ghost mt-3 inline-flex h-9 items-center gap-2 rounded-full px-3 text-13 text-ink-2">
        {open ? "hide machines" : `show machines (${n(box.machines.length)})`}
        <m.span aria-hidden className="inline-flex" initial={false} animate={{ rotate: open ? 180 : 0 }}><ChevronDown size={14} strokeWidth={1.75} /></m.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div key="machines" id={machinesId} className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", visualDuration: 0.24, bounce: 0 }}>
            <Table label="instabox machines" className="mt-1 px-1">
              <thead><tr><Th>owner</Th><Th>server</Th><Th className="text-end">awake</Th><Th className="text-end">vcpu h</Th><Th className="text-end">disk</Th><Th className="text-end">egress</Th><Th className="text-end">today</Th><Th className="text-end">so far</Th></tr></thead>
              <tbody>
                {box.machines.map((machine) => (
                  <tr key={machine.cloudId}>
                    <Td className="!h-11 max-w-[220px] truncate text-13"><Link to={personLink(machine.accountId)} className="text-link">{personName(machine.accountId, machine.email)}</Link>{machine.egressState && <span className="text-12 text-warn"> · {machine.egressState}</span>}</Td>
                    <Td className="t-id !h-11 whitespace-nowrap text-ink-3">{machine.serverId}</Td>
                    <Td className="!h-11 text-end font-mono text-13 num">{hours(machine.awakeHours)}</Td>
                    <Td className="!h-11 text-end font-mono text-13 num">{n(Math.round(machine.vcpuHours))}</Td>
                    <Td className="!h-11 text-end font-mono text-13 num">{n(machine.diskGiB)} gib</Td>
                    <Td className="!h-11 text-end font-mono text-13 num">{gb(machine.egressGb)}</Td>
                    <Td className="!h-11 text-end font-mono text-13 text-money num">{usd(machine.todayCents)}</Td>
                    <Td className="!h-11 text-end font-mono text-13 font-medium text-money num">{usd(machine.costCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </m.div>
        )}
      </AnimatePresence>

      <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <div className="min-w-0">
          <h3 className="px-1 pb-1 text-13 font-medium text-ink">furthest from the median</h3>
          {box.outliers.length ? (
            <ul className="-mx-1">
              {box.outliers.map((o) => (
                <li key={`${o.accountId}-${o.metric}`}>
                  <Link to={personLink(o.accountId)} className="hover-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] px-2.5 py-2">
                    <Person accountId={o.accountId} email={o.email} sub={<>{o.metric.replace(/_/g, " ")} {n(Math.round(o.value))}, median {n(Math.round(o.median))}</>} />
                    <span className="font-mono text-13 text-ink num">{o.ratio !== null ? `${Math.round(o.ratio * 10) / 10}x` : o.z !== null ? `z ${Math.round(o.z * 10) / 10}` : "-"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty>nobody stands out this month.</Empty>}
        </div>
        <div className="min-w-0">
          <h3 className="px-1 pb-1 text-13 font-medium text-ink">at a slowed or paused egress step</h3>
          {box.limited.length ? (
            <ul className="-mx-1">
              {box.limited.map((row) => (
                <li key={row.cloudId}>
                  <Link to={personLink(row.accountId)} className="hover-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] px-2.5 py-2">
                    <Person accountId={row.accountId} email={row.email} sub={`${gb(row.egressGb)} out this month`} />
                    <Level level={row.state === "paused" ? "bad" : "watch"} word={row.state} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty>no cloud is slowed or paused.</Empty>}
        </div>
      </div>
    </ChartCard>
  );
}

function Providers({ spend, sources }: { spend: OpsSpend; sources: OpsSource[] }) {
  const source = (id: OpsSourceId) => sources.find((s) => s.id === id);
  const { workers, r2, composio, brevo, dodo, relay } = spend;
  return (
    <div className="grid grid-cols-2 items-start gap-4 max-lg:grid-cols-1">
      {workers ? (
        <ChartCard title="cloudflare workers" action={<Meta>{workers.plan.label}</Meta>}>
          <div className="flex flex-col gap-4">
            <Meter label="requests" meter={workers.requests} format={short} />
            <Meter label="cpu time" meter={workers.cpuMs} format={(v) => `${short(v)} ms`} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-12 text-ink-3">
            <span>base <span className="font-mono text-money num">{usd(workers.plan.baseCents)}</span></span>
            <span>overage at this pace <span className="font-mono font-medium text-money num">{usd(workers.overageCents)}</span></span>
          </div>
          {workers.scripts.length > 0 && (
            <Table label="workers scripts" className="mt-3">
              <thead><tr><Th>script</Th><Th className="text-end">requests</Th><Th className="text-end">cpu</Th><Th className="text-end">errors</Th><Th className="text-end">today</Th></tr></thead>
              <tbody>
                {workers.scripts.map((s) => (
                  <tr key={s.name}>
                    <Td className="t-id !h-10 max-w-[200px] truncate">{s.name}</Td>
                    <Td className="!h-10 whitespace-nowrap text-end font-mono text-13 num">{short(s.requests)}</Td>
                    <Td className="!h-10 whitespace-nowrap text-end font-mono text-13 num">{short(s.cpuMs)} ms</Td>
                    <Td className={cx("!h-10 whitespace-nowrap text-end font-mono text-13 num", s.errors ? "text-warn" : "text-ink-4")}>{short(s.errors)}</Td>
                    <Td className="!h-10 whitespace-nowrap text-end font-mono text-13 text-ink-3 num">{short(s.todayRequests)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </ChartCard>
      ) : <NotYet title="cloudflare workers" source={source("cloudflare")} />}

      {r2 ? (
        <ChartCard title="r2 storage" action={<Meta>{size(r2.freeBytes)} free</Meta>}>
          <Meter label="stored" meter={r2.total} format={size} />
          <div className="mt-3 text-12 text-ink-3">overage at this pace <span className="font-mono font-medium text-money num">{usd(r2.overageCents)}</span></div>
          {r2.buckets.length > 0 && (
            <ul className="-mx-1 mt-2">
              {r2.buckets.map((b) => (
                <li key={b.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 rounded-[12px] px-2.5 py-1.5">
                  <span className="t-id truncate text-ink">{b.name}</span>
                  <span className="font-mono text-12 text-ink-3 num">{n(b.objects)} objects</span>
                  <span className="w-16 text-end font-mono text-13 text-ink num">{size(b.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      ) : <NotYet title="r2 storage" source={source("cloudflare")} />}

      {composio ? (
        <ChartCard title="composio" action={<Meta>limits {n(composio.limits.installation)} a day per install, {n(composio.limits.account)} per account</Meta>}>
          <div className="grid grid-cols-4 gap-1.5 max-sm:grid-cols-2">
            <Stat label="calls today" value={n(composio.today.calls)} note={`${n(composio.today.installations)} installations`} />
            <Stat label="this week" value={n(composio.week.calls)} />
            <Stat label="near the limit" value={n(composio.nearLimit)} tone={composio.nearLimit ? "bad" : undefined} note="past 80% of their daily limit" />
            <Stat label="queue" value={composio.queue ? n(composio.queue.events) : "-"} note={composio.queue ? size(composio.queue.bytes) : "not measured"} />
          </div>
          {composio.top.length > 0 && (
            <>
              <h3 className="mt-4 px-1 pb-1 text-13 font-medium text-ink">top installations today</h3>
              <ul className="flex flex-col gap-px">
                <AnimatePresence initial={false}>
                  {composio.top.map((row) => <BarRow key={row.installationId} label={row.email ?? row.installationId} value={n(row.today)} note={`${percent(row.share)} · ${n(row.week)} this week`} share={Math.min(1, row.share)} color="bg-wash-lilac" />)}
                </AnimatePresence>
              </ul>
            </>
          )}
          {composio.registrationsTopIp.length > 0 && (
            <>
              <h3 className="mt-4 px-1 pb-1 text-13 font-medium text-ink">registrations by ip today</h3>
              <ul className="-mx-1">
                {composio.registrationsTopIp.map((row) => (
                  <li key={row.ip} className="flex items-center justify-between gap-3 rounded-[12px] px-2.5 py-1.5"><span className="t-id truncate text-ink">{row.ip}</span><span className="font-mono text-13 text-ink num">{n(row.today)}</span></li>
                ))}
              </ul>
            </>
          )}
        </ChartCard>
      ) : <NotYet title="composio" source={source("composio")} />}

      {brevo ? (
        <ChartCard title="brevo" action={brevo.plan ? <Meta>{brevo.plan}</Meta> : undefined}>
          <div className="flex flex-col gap-4">
            <Meter label="today" meter={brevo.daily} format={n} />
            <Meter label="this month" meter={brevo.monthly} format={n} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-12 text-ink-3">
            <span>sent <span className="font-mono text-ink num">{n(brevo.today.sent)}</span></span>
            <span>delivered <span className="font-mono text-ink num">{n(brevo.today.delivered)}</span></span>
            <span>bounced <span className="font-mono text-ink num">{n(brevo.today.bounced)}</span></span>
            <span>blocked <span className="font-mono text-ink num">{n(brevo.today.blocked)}</span></span>
          </div>
        </ChartCard>
      ) : <NotYet title="brevo" source={source("brevo")} />}

      <ChartCard title="dodo fees" action={dodo.estimated ? <Meta>estimated</Meta> : undefined}>
        <div className="grid grid-cols-4 gap-1.5 max-sm:grid-cols-2">
          <Stat label="fees this month" value={usd(dodo.monthCents)} money />
          <Stat label="fees today" value={usd(dodo.todayCents)} money />
          <Stat label="gross" value={usd(dodo.grossCents)} money />
          <Stat label="payments" value={n(dodo.payments)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-12 text-ink-3">
          <span>{percent(dodo.rate.rate)} + {usd(dodo.rate.fixedCents)} a payment</span>
          <span>last webhook {ago(dodo.lastWebhookAt)}</span>
        </div>
      </ChartCard>

      {relay ? (
        <ChartCard title="link relay" action={<Meta>{size(relay.dailyLimitBytes)} a day per tunnel</Meta>}>
          <div className="grid grid-cols-4 gap-1.5 max-sm:grid-cols-2">
            <Stat label="today" value={size(relay.today.bytes)} />
            <Stat label="this month" value={size(relay.month.bytes)} />
            <Stat label="tunnels today" value={n(relay.today.tunnels)} />
            <Stat label="limited today" value={n(relay.today.limited)} tone={relay.today.limited ? "bad" : undefined} />
          </div>
          {relay.top.length > 0 && (
            <>
              <h3 className="mt-4 px-1 pb-1 text-13 font-medium text-ink">top tunnels</h3>
              <ul className="-mx-1">
                {relay.top.map((row) => {
                  const body = <><Person accountId={row.accountId} email={row.email} fallback={row.tunnelId} sub={`${size(row.monthBytes)} this month${row.limited ? `, limited ${n(row.limited)}x` : ""}`} /><span className="font-mono text-13 text-ink num">{size(row.todayBytes)}</span></>;
                  const cls = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] px-2.5 py-2";
                  return <li key={row.tunnelId}>{row.accountId ? <Link to={personLink(row.accountId)} className={cx("hover-row", cls)}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
                })}
              </ul>
            </>
          )}
        </ChartCard>
      ) : <NotYet title="link relay" source={source("relay")} />}
    </div>
  );
}


const gaugeLevel = (v: number | null): OpsLevel => v === null ? "unknown" : v >= 90 ? "bad" : v >= 75 ? "watch" : "ok";
function Gauge({ label, value, total }: { label: string; value: number | null; total?: number | null }) {
  const level = gaugeLevel(value);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-12 text-ink-3">{label} <Level level={level} quiet /></span>
        <span className="font-mono text-13 text-ink num">{value === null ? "-" : `${Math.round(value)}%`}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
        <span className={cx("bar-fill absolute inset-0 block rounded-full", level === "bad" ? "bg-bad" : level === "watch" ? "bg-warn" : "bg-accent")} style={{ transform: `scaleX(${Math.max(0.01, (value ?? 0) / 100)})` }} />
      </div>
      {total ? <div className="mt-1 font-mono text-[11.5px] text-ink-4 num">of {size(total)}</div> : null}
    </div>
  );
}

function Box({ box, now }: { box: OpsBox; now: number }) {
  return (
    <ChartCard title={box.name} action={<Meta>{box.at ? `sampled ${ago(box.at, now)}` : "no sample yet"}</Meta>}>
      <div className="grid grid-cols-3 gap-4">
        <Gauge label="cpu" value={box.cpu} />
        <Gauge label="memory" value={box.mem} total={box.memTotalBytes} />
        <Gauge label="disk" value={box.disk} total={box.diskTotalBytes} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-12 text-ink-3">
        <span>load <span className="font-mono text-ink num">{box.load ? box.load.map((v) => v.toFixed(2)).join(" ") : "-"}</span>{box.cores ? ` on ${box.cores} cores` : ""}</span>
        {box.net ? (
          <>
            <span>net today <span className="font-mono text-ink num">{size(box.net.inToday)}</span> in, <span className="font-mono text-ink num">{size(box.net.outToday)}</span> out</span>
            <span>now <span className="font-mono text-ink num">{perSecond(box.net.inRate)}</span> in, <span className="font-mono text-ink num">{perSecond(box.net.outRate)}</span> out</span>
          </>
        ) : <span>no network numbers</span>}
      </div>
      {box.series.length > 1 && (
        <div className="mt-3">
          <div className="t-meta pb-1">cpu, last 24 hours</div>
          <Sparkline values={box.series.map((p) => p.cpu)} color="var(--viz-visitors)" height={40} label={`${box.name} cpu over the last 24 hours`} />
        </div>
      )}
    </ChartCard>
  );
}

const GROUPS: Array<[OpsCheckGroup, string]> = [["boxes", "boxes"], ["services", "services"], ["data", "data"], ["providers", "providers"], ["backups", "backups"], ["certs", "certificates"]];
function Checks({ checks }: { checks: OpsCheck[] }) {
  const groups = GROUPS.map(([id, label]) => [label, checks.filter((check) => check.group === id)] as const).filter(([, list]) => list.length);
  if (!groups.length) return <Empty>no checks have run yet.</Empty>;
  return (
    <div className="grid grid-cols-3 items-start gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
      {groups.map(([label, list]) => (
        <ChartCard key={label} title={label} action={<Meta>{n(list.filter((c) => c.level === "ok").length)} of {n(list.length)} ok</Meta>}>
          <ul className="-my-1 flex flex-col">
            {list.map((check) => (
              <li key={check.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1.5" title={check.detail ?? undefined}>
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className={cx("inline-block size-[7px] shrink-0 rounded-[2px]", LEVEL_DOT[check.level])} />
                  <span className="truncate text-13 text-ink">{check.name}</span>
                  <span className="sr-only">, {LEVEL_WORD[check.level]}</span>
                </span>
                <span className="font-mono text-12 text-ink-2 num">{check.value}{check.latencyMs !== null ? <span className="text-ink-4"> · {n(check.latencyMs)} ms</span> : null}</span>
                {(check.level === "watch" || check.level === "bad" || check.detail) && (
                  <span className="col-span-2 ps-[15px] text-12 text-ink-3">{check.level === "watch" || check.level === "bad" ? <span className={check.level === "bad" ? "text-bad" : "text-warn"}>{check.level}{check.detail ? ", " : ""}</span> : null}{check.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </ChartCard>
      ))}
    </div>
  );
}


function Abuse({ list }: { list: OpsAnswer["abuse"] }) {
  if (!list.length) return <p className="rounded-[18px] bg-card px-4 py-6 text-center text-14 text-ink-3">nothing unusual right now.</p>;
  return (
    <ChartCard title="ranked by score" action={<Meta>{n(list.length)}</Meta>}>
      <ol className="-mx-1">
        {list.map((s, i) => {
          const who = s.accountId ? personName(s.accountId, s.email) : s.email ?? s.ip ?? s.key;
          return (
            <li key={s.key} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 rounded-[12px] px-2.5 py-2.5">
              <span className="pt-0.5 font-mono text-12 text-ink-4 num">{i + 1}</span>
              <span className="min-w-0">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                  {s.accountId ? <Link to={personLink(s.accountId)} className="text-link truncate text-13 font-medium">{who}</Link> : <span className="truncate text-13 font-medium text-ink">{who}</span>}
                  {s.ip && s.accountId && <span className="t-id text-ink-4">{s.ip}</span>}
                </span>
                <span className="mt-0.5 block text-13 text-ink-2">{s.why}</span>
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {s.signals.map((sig) => (
                    <span key={sig.kind} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-card px-2.5 text-12 text-ink-2" title={`${sig.label}: ${n(Math.round(sig.value))}, median ${n(Math.round(sig.median))}`}>
                      {sig.label}{sig.ratio !== null && <span className="font-mono text-ink-3 num">{Math.round(sig.ratio * 10) / 10}x</span>}
                    </span>
                  ))}
                </span>
              </span>
              <span className="text-end">
                <span className="block font-mono text-15 font-medium text-ink num">{Math.round(s.score)}</span>
                <span className="t-meta">score</span>
              </span>
            </li>
          );
        })}
      </ol>
    </ChartCard>
  );
}

const ALERT_COLS = "grid-cols-[110px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] max-md:grid-cols-[minmax(0,1fr)_auto]";
function Alerts({ rules, now }: { rules: OpsRule[]; now: number }) {
  if (!rules.length) return <Empty>no alert rules yet.</Empty>;
  const order = { firing: 0, pending: 1, ok: 2 } as const;
  const sorted = [...rules].sort((a, b) => order[a.state] - order[b.state]);
  return (
    <ChartCard title="rules" action={<Meta>{n(rules.filter((r) => r.state === "firing").length)} firing</Meta>}>
      <div className={cx("-mx-1 grid gap-4 px-2.5 pb-1 t-meta max-md:hidden", ALERT_COLS)}><span>state</span><span>rule</span><span>threshold</span><span>now</span><span>since or last</span></div>
      <ul className="-mx-1">
        {sorted.map((rule) => (
          <li key={rule.id} className={cx("grid items-center gap-x-4 gap-y-0.5 rounded-[12px] px-2.5 py-2", ALERT_COLS)}>
            <span className="max-md:order-2 max-md:justify-self-end"><Level level={RULE_LEVEL[rule.state]} word={rule.state} /></span>
            <span className="truncate text-13 text-ink max-md:order-1">{rule.label}</span>
            <span className="truncate text-12 text-ink-3 max-md:order-3 max-md:col-span-2">{rule.threshold}<span className="md:hidden"> · now {rule.value ?? "-"}</span></span>
            <span className="truncate font-mono text-12 text-ink-2 num max-md:hidden">{rule.value ?? "-"}</span>
            <span className="truncate text-12 text-ink-3 max-md:order-4 max-md:col-span-2">{rule.state !== "ok" && rule.since ? `since ${ago(rule.since, now)}` : rule.lastFiredAt ? `last fired ${ago(rule.lastFiredAt, now)}` : "never fired"}</span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

const EVERY_MS = { "5m": 300_000, "1h": 3_600_000 } as const;
function Sources({ sources, now }: { sources: OpsSource[]; now: number }) {
  return (
    <footer aria-labelledby="ops-sources" className="mt-10">
      <h2 id="ops-sources" className="t-meta mb-2">where these numbers come from</h2>
      <ul className="grid grid-cols-3 gap-x-6 gap-y-1.5 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {sources.map((s) => {
          const stale = s.at !== null && now - s.at > EVERY_MS[s.every] * 3;
          const level: OpsLevel = !s.configured ? "unknown" : !s.ok ? "bad" : stale || s.at === null ? "watch" : "ok";
          return (
            <li key={s.id} className="min-w-0 text-12">
              <span className="flex items-center gap-2">
                <span aria-hidden className={cx("inline-block size-[7px] shrink-0 rounded-[2px]", LEVEL_DOT[level])} />
                <span className="text-ink-2">{s.label}</span>
                <span className="text-ink-4">every {s.every.replace("m", " min").replace("h", " h")}</span>
              </span>
              <span className="block ps-[15px] text-ink-3">
                {!s.configured ? "not set up" : `${s.at ? `collected ${ago(s.at, now)}` : "never collected"}${stale ? ", late" : ""}`}
                {s.error && <span className="text-bad">, {s.error}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </footer>
  );
}

function Collect({ onDone }: { onDone(): void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const answer = await adminCall<{ ran: string[] }>("/ops/collect", { body: {} });
      toast(answer.ran.length ? `collected ${answer.ran.join(", ")}.` : "nothing to collect right now.");
      onDone();
    } catch (error) {
      toast((error as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" disabled={busy} aria-busy={busy} onClick={() => void run()}>
      <m.span className="inline-flex" aria-hidden animate={busy ? { rotate: 360 } : { rotate: 0 }} transition={busy ? { repeat: Infinity, duration: 0.9, ease: "linear" } : { duration: 0 }}><RefreshCw size={14} strokeWidth={1.75} /></m.span>
      {busy ? "collecting" : "collect now"}
    </Button>
  );
}

/** everything that costs money or can go down, from what the collectors last stored */
export function OpsPage() {
  const { data, error, loading, reload } = useAdmin<OpsAnswer>("/ops", 60_000);
  const now = useNow(30_000);
  return (
    <>
      <AdminHeader title="ops"
        sub={data ? <span className="inline-flex flex-wrap items-center gap-2">{data.month}, {percent(data.elapsed)} of the month gone · updated {ago(data.now, now)}{data.fixture && <span className="tag !h-[22px] !px-2">sample data</span>}</span> : "spend, health, abuse and alerts in one place"}
        action={<Collect onDone={reload} />} />
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading rows={8} />}
      {data && (
        <div className="flex flex-col">
          <Glance data={data} />
          <Section title="spend and usage">
            <div className="flex flex-col gap-4">
              <Lines spend={data.spend} />
              <Instabox box={data.spend.instabox} />
              <Providers spend={data.spend} sources={data.sources} />
            </div>
          </Section>
          <Section title="health">
            <div className="flex flex-col gap-4">
              {data.health.boxes.length > 0 && <div className="grid grid-cols-2 items-start gap-4 max-lg:grid-cols-1">{data.health.boxes.map((box) => <Box key={box.name} box={box} now={now} />)}</div>}
              <Checks checks={data.health.checks} />
            </div>
          </Section>
          <Section title="abuse and outliers"><Abuse list={data.abuse} /></Section>
          <Section title="alerts"><Alerts rules={data.alerts} now={now} /></Section>
          <Sources sources={data.sources} now={now} />
        </div>
      )}
    </>
  );
}
