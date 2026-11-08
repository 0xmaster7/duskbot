import { useId, useMemo, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { useCloud } from "../data/cloud";
import { useCreditControls } from "../data/credits";
import { dollars } from "../data/pricing";
import { useSession } from "../data/session";
import { useAccountUsage, type PlanWindow } from "../data/usage";
import { eventsCsv, seriesBy, type UsageGroup } from "../data/usage-math";
import { compact, parseDay, percent, shortDate, until, usd } from "../lib/format";
import { Field, Modal, Select, Switch } from "../ui/controls";
import { Bar, Button, Card, PageHeader, Skeleton } from "../ui/kit";
import { Nil, SectionHead, Table, Td, Th } from "../ui/table";
import { Legend, UsageChart } from "../ui/UsageChart";
import { BuyCredits } from "./credits-dialog";

const GROUPS: Array<{ value: UsageGroup; label: string }> = [{ value: "bot", label: "Bot" }, { value: "model", label: "Model" }, { value: "workspace", label: "Workspace" }];
const PAGE = 12;

const resetText = (t: number | null, now: number) => (t ? (t - now < 86_400_000 ? `Resets ${until(t, now)}` : `Resets ${shortDate(t)}`) : "No reset time");

function Included({ plans, now }: { plans: PlanWindow[]; now: number }) {
  return (
    <section aria-labelledby="included-title">
      <SectionHead id="included-title">Included usage</SectionHead>
      {plans.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {plans.map((p) => (
            <li key={`${p.provider}-${p.label}`} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,200px)_48px] items-center gap-5 py-3 max-sm:grid-cols-[minmax(0,1fr)_48px]">
              <div className="min-w-0">
                <div className="text-14 text-ink">{p.provider}{p.plan ? ` ${p.plan}` : ""} · {p.label}</div>
                <div className="text-13 text-ink-3">{resetText(p.resetsAt, now)}</div>
              </div>
              <Bar value={p.usedPercent} tone={p.usedPercent >= 90 ? "warn" : "ink"} className="max-sm:hidden" label={`${p.provider} ${p.label} usage`} />
              <span className="num text-end text-14 text-ink-2">{percent(p.usedPercent)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-14 text-ink-3">Sign in to Codex or Claude in the app and your plan usage shows up here.</p>}
    </section>
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
    if (!Number.isFinite(n) || n < 1) { setError("Enter a whole number of dollars, 1 or more, or leave it empty for no limit."); return; }
    onSave(Math.round(n)); onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Monthly spend limit" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save limit</Button></>}>
      <p>Bots stop using credits for the rest of the month once they reach it. Your own accounts keep working.</p>
      <form className="mt-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Limit in US dollars" htmlFor={id} error={error} hint="Leave empty for no limit.">
          <input id={id} className="field num" inputMode="numeric" value={text} placeholder="No limit" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => { setText(e.target.value); setError(null); }} />
        </Field>
      </form>
    </Modal>
  );
}

function Credits() {
  const { toast } = useSession();
  const controls = useCreditControls();
  const [limiting, setLimiting] = useState(false);
  return (
    <section aria-labelledby="credits-title">
      <SectionHead id="credits-title">Credits</SectionHead>
      <div className="divide-y divide-line border-y border-line text-14">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="text-ink-3">Monthly spend limit</span>
          <div className="flex items-center gap-3">
            <span className="num text-ink">{controls.limitUsd === null ? "Not set" : dollars(controls.limitUsd)}</span>
            {controls.supported && <button type="button" onClick={() => setLimiting(true)} className="hover-link text-ink-2">Edit</button>}
          </div>
        </div>
        {controls.supported && <div className="flex items-center justify-between gap-3 py-3">
          <label htmlFor="auto-top-up" className="text-ink-3">Auto top-up</label>
          <Switch id="auto-top-up" label="Auto top-up" checked={controls.autoTopUp} onChange={(on) => { controls.setAutoTopUp(on); toast(on ? "Auto top-up is on. We add credits when they run low." : "Auto top-up is off"); }} />
        </div>}
      </div>
      {limiting && <LimitDialog open onClose={() => setLimiting(false)} value={controls.limitUsd} onSave={(v) => { controls.setLimit(v); toast(v === null ? "Spend limit removed" : `Spend limit set to ${dollars(v)} a month`); }} />}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-13 text-ink-3">{label}</div>
      <div className="num mt-2 text-24 font-medium tracking-[-0.02em] text-ink">{value}</div>
    </div>
  );
}

export function UsagePage() {
  const { now } = useSession();
  const { billing } = useCloud();
  const { month, plans, loading, error } = useAccountUsage();
  const [buying, setBuying] = useState(false);
  const [group, setGroup] = useState<UsageGroup>("bot");
  const [limit, setLimit] = useState(PAGE);
  const series = useMemo(() => (month ? seriesBy(month, group) : []), [month, group]);
  const exportCsv = () => {
    if (!month) return;
    const url = URL.createObjectURL(new Blob([eventsCsv(month.events)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `openmausbot-usage-${month.days[0]?.slice(0, 7) ?? "month"}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const credit = billing?.credits.usedThisMonthUsd;
  return (
    <div className="min-w-0">
      <PageHeader title="Usage" sub="This month, across every workspace." action={<Button variant="outline" onClick={() => setBuying(true)}>Add credits</Button>} />
      <div className="grid grid-cols-4 gap-6 border-y border-line py-6 max-sm:grid-cols-2">
        <Stat label="Tokens" value={!loading && month ? compact(month.totals.tokens) : <Skeleton className="h-8 w-24" />} />
        <Stat label="Bot turns" value={!loading && month ? month.totals.turns.toLocaleString("en-US") : <Skeleton className="h-8 w-24" />} />
        <Stat label="Credits used" value={credit === undefined ? <Skeleton className="h-8 w-24" /> : usd(credit)} />
        <Stat label="Credits left" value={billing ? usd(billing.credits.balanceUsd) : <Skeleton className="h-8 w-24" />} />
      </div>
      <div className="mt-10 flex flex-col gap-10">
        <Included plans={plans} now={now} />
        <Credits />
        <Card aria-labelledby="chart-title" className="min-w-0">
          <SectionHead id="chart-title" action={
            <div className="flex items-center gap-3">
              <label htmlFor="usage-group" className="text-13 text-ink-3">Group by</label>
              <Select id="usage-group" className="w-[150px] [&_select]:!h-10 [&_select]:!rounded-full" value={group} onChange={(e) => setGroup(e.target.value as UsageGroup)}>
                {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </Select>
            </div>
          }>Tokens per day</SectionHead>
          <div className="mt-6">
            {error ? <p role="alert" className="py-16 text-center text-14 text-bad">{error}</p>
              : loading || !month ? <Skeleton className="h-[260px]" />
              : month.totals.tokens === 0 ? <p className="py-20 text-center text-14 text-ink-3">No bot turns yet this month. Usage shows up here after the first chat.</p>
              : <UsageChart days={month.days} series={series} />}
          </div>
          {month && month.totals.tokens > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Legend series={series} />
              {month.estimated && group !== "workspace" && <p className="text-13 text-ink-3">Per-day split by {group} is estimated from the month.</p>}
            </div>
          )}
        </Card>
      </div>

      <section className="mt-12" aria-labelledby="events-title">
        <SectionHead id="events-title" action={<Button variant="outline" onClick={exportCsv} disabled={!month || month.events.length === 0}><Download size={16} strokeWidth={1.5} aria-hidden />Export</Button>}>Usage events</SectionHead>
        {loading || !month ? (
          <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : month.events.length ? (
          <>
            <Table label="Usage events" className="max-sm:[&_table]:table-fixed max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
              <thead>
                <tr>
                  <Th className="max-sm:w-[20%]">Date</Th>
                  <Th className="max-md:hidden">Workspace</Th>
                  <Th className="max-sm:w-[32%]">Bot</Th>
                  <Th className="max-lg:hidden">Model</Th>
                  <Th className="!text-end max-md:hidden">Turns</Th>
                  <Th className="!text-end max-sm:w-[25%]">Tokens</Th>
                  <Th className="!text-end max-sm:w-[23%]">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {month.events.slice(0, limit).map((e) => (
                  <tr key={`${e.date}-${e.workspaceId}-${e.bot}`} className="hover-row transition-colors duration-150">
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
            {month.events.length > limit && <button type="button" onClick={() => setLimit((n) => n + PAGE * 2)} className="press-soft hover-ghost -ms-4 mt-2 h-11 rounded-full px-4 text-14 text-ink-3">Show more</button>}
          </>
        ) : <p className="border-y border-line py-8 text-14 text-ink-3">No usage events yet this month.</p>}
        <p className="mt-4 text-13 text-ink-3">Costs are estimates. Workspaces report daily totals, never your messages.</p>
      </section>
      <BuyCredits open={buying} onClose={() => setBuying(false)} />
    </div>
  );
}
