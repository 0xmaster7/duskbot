import { useId, useMemo, useState, type ReactNode } from "react";
import { Download } from "@/icons";
import { useCloud } from "../data/cloud";
import { LoadError } from "./common";
import { useCreditControls } from "../data/credits";
import { dollars } from "../data/pricing";
import { useSession } from "../data/session";
import { useAccountUsage, type PlanWindow } from "../data/usage";
import { eventsCsv, nextMonthStart, seriesBy, type UsageGroup } from "../data/usage-math";
import { compact, parseDay, percent, shortDate, until, usd } from "../lib/format";
import { Field, Modal, Select, Switch } from "../ui/controls";
import { Bar, Button, Card, PageHeader, Skeleton } from "../ui/kit";
import { Nil, SectionHead, Table, Td, Th } from "../ui/table";
import { Legend, UsageChart } from "../ui/UsageChart";
import { BuyCredits } from "./credits-dialog";
import { useNow } from "../lib/now";
import { Figure } from "../ui/Figure";
import { Activity } from "./activity";

const GROUPS: Array<{ value: UsageGroup; label: string }> = [{ value: "bot", label: "bot" }, { value: "model", label: "model" }, { value: "workspace", label: "workspace" }];
const PAGE = 12;

function Label({ id, children }: { id?: string; children: ReactNode }) {
  return <h2 id={id} className="text-15 text-ink-3">{children}</h2>;
}

function Big({ value, unit }: { value: ReactNode; unit?: string }) {
  return <p className="mt-4 flex min-w-0 items-baseline gap-2"><Figure value={value} />{unit && <span className="text-15 text-ink-3">{unit}</span>}</p>;
}

const resetText = (t: number | null, now: number) => (t ? (t - now < 86_400_000 ? `resets ${until(t, now)}` : `resets ${shortDate(t)}`) : "no reset time");

function Included({ plans, now }: { plans: PlanWindow[]; now: number }) {
  const top = plans[0];
  return (
    <Card className="min-w-0 p-7" aria-labelledby="included-title">
      <Label id="included-title">{top ? `${top.provider}${top.plan ? ` ${top.plan}` : ""}, ${top.label.toLowerCase()} included usage` : "included usage"}</Label>
      {top ? (
        <>
          <Big value={percent(top.usedPercent)} unit="used" />
          <Bar value={top.usedPercent} tone={top.usedPercent >= 90 ? "warn" : "ink"} className="mt-5 !h-[5px]" label={`${top.provider} ${top.label} usage`} />
          <p className="mt-3 text-14 text-ink-3">{resetText(top.resetsAt, now)} · from {top.workspaceName}</p>
        </>
      ) : <p className="mt-4 max-w-[44ch] text-15 leading-[1.55] text-ink-3">sign in to codex or claude in the app and your plan usage shows up here.</p>}
    </Card>
  );
}

function LimitDialog({ open, onClose, value, onSave }: { open: boolean; onClose(): void; value: number | null; onSave(v: number | null): void }) {
  const id = useId();
  const [text, setText] = useState(value === null ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const t = text.trim();
    if (!t) { onSave(null); onClose(); return; }
    const n = Number(t);
    if (!Number.isFinite(n) || n < 1) { setError("enter a whole number of dollars, 1 or more, or leave it empty for no limit."); return; }
    onSave(Math.round(n)); onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="monthly spend limit" footer={<><Button onClick={onClose}>cancel</Button><Button variant="outline" onClick={save}>save limit</Button></>}>
      <p>bots stop using credits for the rest of the month once they reach it. your own accounts keep working.</p>
      <form className="mt-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="limit in us dollars" htmlFor={id} error={error} hint="leave empty for no limit.">
          <input id={id} className="field num" inputMode="numeric" value={text} placeholder="no limit" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => { setText(e.target.value); setError(null); }} />
        </Field>
      </form>
    </Modal>
  );
}

function Credits({ now, onAdd }: { now: number; onAdd(): void }) {
  const { billing } = useCloud();
  const { toast } = useSession();
  const controls = useCreditControls();
  const [limiting, setLimiting] = useState(false);
  const credits = billing?.credits;
  return (
    <Card className="min-w-0 p-7" aria-labelledby="balance-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Label id="balance-title">ai credits</Label>
        <Button variant="primary" size="sm" onClick={onAdd}>add credits</Button>
      </div>
      {credits ? <Big value={usd(credits.usedThisMonthUsd)} unit="used this month" /> : <Skeleton className="mt-4 h-9 w-40" />}
      <dl className="mt-5 text-15">
        <div className="flex items-baseline justify-between gap-4 py-1.5 text-14 text-ink-3"><dt>monthly usage</dt><dd className="num">resets {shortDate(nextMonthStart(now))}</dd></div>
        <div className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-ink-3">monthly spend limit</dt>
          <dd className="num text-ink">{controls.limitUsd === null ? "not set" : dollars(controls.limitUsd)}{controls.supported && <> <span className="text-ink-4">·</span> <button type="button" onClick={() => setLimiting(true)} className="hover-link rounded-full text-ink-2 underline decoration-line-2 underline-offset-4">edit</button></>}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-2"><dt className="text-ink-3">credits available</dt><dd className="num text-ink">{credits ? usd(credits.balanceUsd) : <Nil />}</dd></div>
        {controls.supported && <div className="flex items-center justify-between gap-3 py-2">
          <dt><label htmlFor="auto-top-up" className="text-14 text-ink-3">auto top-up</label></dt>
          <dd><Switch id="auto-top-up" label="auto top-up" checked={controls.autoTopUp} onChange={(on) => { controls.setAutoTopUp(on); toast(on ? "auto top-up is on. we add credits when they run low." : "auto top-up is off"); }} /></dd>
        </div>}
      </dl>
      {limiting && <LimitDialog open onClose={() => setLimiting(false)} value={controls.limitUsd} onSave={(v) => { controls.setLimit(v); toast(v === null ? "spend limit removed" : `spend limit set to ${dollars(v)} a month`); }} />}
    </Card>
  );
}

function Resets({ plans, now }: { plans: PlanWindow[]; now: number }) {
  return (
    <Card className="min-w-0 p-7" aria-labelledby="resets-title">
      <Label id="resets-title">usage resets</Label>
      {plans.length ? (
        <ul className="mt-3">
          {plans.map((p) => (
            <li key={`${p.provider}-${p.label}`} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,200px)_48px] items-center gap-5 border-b border-line py-3.5 last:border-0 max-sm:grid-cols-[minmax(0,1fr)_48px]">
              <div className="min-w-0">
                <div className="truncate text-15 text-ink">{p.provider}{p.plan ? ` ${p.plan}` : ""} · {p.label}</div>
                <div className="truncate text-13 text-ink-3">{resetText(p.resetsAt, now)}</div>
              </div>
              <Bar value={p.usedPercent} tone={p.usedPercent >= 90 ? "warn" : "ink"} className="max-sm:hidden" label={`${p.provider} ${p.label} usage`} />
              <span className="num text-end text-15 text-ink-2">{percent(p.usedPercent)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-17 text-ink-2">no usage resets available</p>}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-card bg-card px-7 py-6 max-sm:px-5 max-sm:py-5">
      <div className="text-15 text-ink-3">{label}</div>
      <div className="mt-2"><Figure value={value} /></div>
    </div>
  );
}

export function UsagePage() {
  const now = useNow(60_000);
  const cloud = useCloud();
  const { billing } = cloud;
  const { month, plans, loading, error, refresh } = useAccountUsage();
  const { detail } = useSession();
  const [buying, setBuying] = useState(false);
  const [group, setGroup] = useState<UsageGroup>("bot");
  const [limit, setLimit] = useState(PAGE);
  const series = useMemo(() => (month ? seriesBy(month, group) : []), [month, group]);
  const exportCsv = () => {
    if (!month) return;
    const url = URL.createObjectURL(new Blob([eventsCsv(month.events)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `duskbot-usage-${month.days[0]?.slice(0, 7) ?? "month"}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const credit = billing?.credits.usedThisMonthUsd;
  const loadError = error ?? cloud.error;
  if (loadError && !month) return <div><PageHeader title="usage" sub="this month, every workspace." /><LoadError error={loadError} retry={() => { refresh(); cloud.refresh(); }} /></div>;
  return (
    <div className="min-w-0">
      <PageHeader title="usage" sub="this month, every workspace." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Included plans={plans} now={now} />
        <Credits now={now} onAdd={() => setBuying(true)} />
      </div>
      <p className="mt-3 px-1 text-14 text-ink-4">included usage comes with the plans your bots sign in to and is used first. credits cover bots that use our ai.</p>

      <div className="mt-8 flex flex-col gap-4">
        <Resets plans={plans} now={now} />
        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="total tokens" value={!loading && month ? compact(month.totals.tokens) : <Skeleton className="h-8 w-24" />} />
          <Stat label="bot turns" value={!loading && month ? month.totals.turns.toLocaleString("en-US") : <Skeleton className="h-8 w-24" />} />
          <Stat label="credit usage" value={credit === undefined ? <Skeleton className="h-8 w-24" /> : usd(credit)} />
        </div>
        <Card aria-labelledby="chart-title" className="min-w-0">
          <SectionHead id="chart-title" action={
            <div className="flex items-center gap-3">
              <label htmlFor="usage-group" className="text-13 text-ink-3">group by</label>
              <Select id="usage-group" className="w-[150px] [&_select]:!h-10 [&_select]:!rounded-full" value={group} onChange={(e) => setGroup(e.target.value as UsageGroup)}>
                {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </Select>
            </div>
          }>tokens per day</SectionHead>
          <div className="mt-6">
            {loading || !month ? <Skeleton className="h-[260px]" />
              : month.totals.tokens === 0 ? <p className="py-20 text-center text-14 text-ink-3">no bot turns yet this month. usage shows up here after the first chat.</p>
              : <div key={group} className="swap-in"><UsageChart days={month.days} series={series} /></div>}
          </div>
          {month && month.totals.tokens > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Legend series={series} />
              {month.estimated && group !== "workspace" && <p className="text-13 text-ink-3">per-day split by {group} is estimated from the month.</p>}
            </div>
          )}
        </Card>
        {detail?.report?.activity && <Activity detail={detail} now={now} />}
      </div>

      <section className="mt-12" aria-labelledby="events-title">
        <SectionHead id="events-title" action={<Button variant="outline" onClick={exportCsv} disabled={!month || month.events.length === 0}><Download size={16} strokeWidth={1.5} aria-hidden />export</Button>}>usage events</SectionHead>
        {loading || !month ? (
          <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : month.events.length ? (
          <>
            <Table label="usage events" className="max-sm:[&_table]:table-fixed max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
              <thead>
                <tr>
                  <Th className="max-sm:w-[20%]">date</Th>
                  <Th className="max-md:hidden">workspace</Th>
                  <Th className="max-sm:w-[32%]">bot</Th>
                  <Th className="max-lg:hidden">model</Th>
                  <Th className="!text-end max-md:hidden">turns</Th>
                  <Th className="!text-end max-sm:w-[25%]">tokens</Th>
                  <Th className="!text-end max-sm:w-[23%]">cost</Th>
                </tr>
              </thead>
              <tbody>
                {month.events.slice(0, limit).map((e) => (
                  <tr key={`${e.date}-${e.workspaceId}-${e.bot}`} className="hover-row">
                    <Td className="num whitespace-nowrap">{shortDate(parseDay(e.date))}</Td>
                    <Td className="max-w-[200px] truncate text-ink-2 max-md:hidden">{e.workspaceName}</Td>
                    <Td className="max-w-[160px] truncate">{e.bot}</Td>
                    <Td className="max-w-[200px] truncate text-ink-2 max-lg:hidden">{e.model === "Mixed" ? <Nil /> : e.model}</Td>
                    <Td className="num text-end text-ink-2 max-md:hidden">{e.turns.toLocaleString("en-US")}</Td>
                    <Td className="num truncate text-end">{compact(e.tokens)}</Td>
                    <Td className="num truncate text-end text-ink-2">{e.costUsd === null ? <Nil /> : usd(e.costUsd)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {month.events.length > limit && <button type="button" onClick={() => setLimit((n) => n + PAGE * 2)} className="press-soft hover-ghost -ms-4 mt-2 h-11 rounded-full px-4 text-14 text-ink-3">show more</button>}
          </>
        ) : <p className="border-y border-line py-8 text-14 text-ink-3">no usage events yet this month.</p>}
        <p className="mt-4 text-13 text-ink-3">costs are estimates. workspaces report daily totals, never your messages.</p>
      </section>
      <BuyCredits source="dash_credits" open={buying} onClose={() => setBuying(false)} />
    </div>
  );
}
