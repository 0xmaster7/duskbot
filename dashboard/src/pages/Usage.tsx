import { useId, useMemo, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { useCloud } from "../data/cloud";
import { useCreditControls } from "../data/credits";
import { dollars } from "../data/pricing";
import { useSession } from "../data/session";
import { useAccountUsage, type PlanWindow } from "../data/usage";
import { eventsCsv, nextMonthStart, seriesBy, type UsageGroup } from "../data/usage-math";
import { compact, parseDay, percent, shortDate, until, usd } from "../lib/format";
import { Field, Modal, Select } from "../ui/controls";
import { Bar, Button, cx, PageHeader, Skeleton } from "../ui/kit";
import { Nil, SectionHead, Table, Td, Th } from "../ui/table";
import { Legend, UsageChart } from "../ui/UsageChart";

const GROUPS: Array<{ value: UsageGroup; label: string }> = [{ value: "bot", label: "Bot" }, { value: "model", label: "Model" }, { value: "workspace", label: "Workspace" }];
const PAGE = 12;

function Panel({ children, className, labelledBy }: { children: ReactNode; className?: string; labelledBy?: string }) {
  return <section aria-labelledby={labelledBy} className={cx("min-w-0 rounded-card bg-card p-7 max-sm:p-5", className)}>{children}</section>;
}

function Label({ id, children }: { id?: string; children: ReactNode }) {
  return <h2 id={id} className="text-15 text-ink-3">{children}</h2>;
}

function Big({ value, unit }: { value: ReactNode; unit?: string }) {
  return <p className="num mt-4 flex items-baseline gap-2"><span className="text-28 font-medium tracking-[-0.02em] text-ink">{value}</span>{unit && <span className="text-15 text-ink-3">{unit}</span>}</p>;
}

const resetText = (t: number | null, now: number) => (t ? (t - now < 86_400_000 ? `Resets ${until(t, now)}` : `Resets ${shortDate(t)}`) : "No reset time");

function Included({ plans, now }: { plans: PlanWindow[]; now: number }) {
  const top = plans[0];
  return (
    <Panel labelledBy="included-title">
      <Label id="included-title">{top ? `${top.provider}${top.plan ? ` ${top.plan}` : ""}, ${top.label.toLowerCase()} included usage` : "Included usage"}</Label>
      {top ? (
        <>
          <Big value={percent(top.usedPercent)} unit="used" />
          <Bar value={top.usedPercent} tone={top.usedPercent >= 90 ? "warn" : "ink"} className="mt-5 !h-[5px]" label={`${top.provider} ${top.label} usage`} />
          <p className="mt-3 text-14 text-ink-3">{resetText(top.resetsAt, now)} · from {top.workspaceName}</p>
        </>
      ) : <p className="mt-4 max-w-[44ch] text-15 leading-[1.55] text-ink-3">Nothing reported yet. Sign in to Codex or Claude in the app and the share of your plan your bots use shows up here.</p>}
    </Panel>
  );
}

function BuyCredits({ open, onClose }: { open: boolean; onClose(): void }) {
  const { catalog, checkout } = useCloud();
  const { toast } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buy = async (pack: string, amount: number) => {
    setBusy(pack); setError(null);
    try { if (await checkout({ kind: "credits", pack })) { toast(`Added ${dollars(amount)} of AI credits`); onClose(); } }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Buy AI credits">
      <p>Credits pay for bots that use our AI instead of your own accounts. They never expire.</p>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {(catalog?.creditPacks ?? []).map((p) => (
          <button key={p.id} type="button" disabled={busy !== null} onClick={() => void buy(p.id, p.usd)} className="press-soft pick hover-pick num h-16 rounded-[14px] border border-line-2 text-20 font-medium text-ink disabled:opacity-45">
            {busy === p.id ? <span className="text-14 font-normal text-ink-3">Opening</span> : dollars(p.usd)}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
    </Modal>
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

function Balance({ now }: { now: number }) {
  const { billing } = useCloud();
  const { toast } = useSession();
  const controls = useCreditControls();
  const [buying, setBuying] = useState(false);
  const [limiting, setLimiting] = useState(false);
  const credits = billing?.credits;
  return (
    <Panel labelledBy="balance-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Label id="balance-title">AI credits</Label>
        <div className="-mt-2 flex flex-wrap gap-2">
          {controls.supported && <Button onClick={() => { controls.setAutoTopUp(!controls.autoTopUp); toast(controls.autoTopUp ? "Auto top-up is off" : "Auto top-up is on. We add credits when they run low."); }}>{controls.autoTopUp ? "Turn off auto top-up" : "Turn on auto top-up"}</Button>}
          <Button variant="primary" onClick={() => setBuying(true)}>Buy credits</Button>
        </div>
      </div>
      {credits ? <Big value={usd(credits.usedThisMonthUsd)} unit="used this month" /> : <Skeleton className="mt-4 h-9 w-40" />}
      <dl className="mt-5 text-15">
        <div className="flex items-baseline justify-between gap-4 py-1.5 text-14 text-ink-3"><dt>Monthly usage</dt><dd className="num">Resets {shortDate(nextMonthStart(now))}</dd></div>
        <div className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-ink-3">Monthly spend limit</dt>
          <dd className="num text-ink">{controls.limitUsd === null ? "Not set" : dollars(controls.limitUsd)}{controls.supported && <> <span className="text-ink-4">·</span> <button type="button" onClick={() => setLimiting(true)} className="hover-link rounded-full text-ink-2 underline decoration-line-2 underline-offset-4">Edit</button></>}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-2"><dt className="text-ink-3">Credits available</dt><dd className="num text-ink">{credits ? usd(credits.balanceUsd) : <Nil />}</dd></div>
      </dl>
      <BuyCredits open={buying} onClose={() => setBuying(false)} />
      {limiting && <LimitDialog open onClose={() => setLimiting(false)} value={controls.limitUsd} onSave={(v) => { controls.setLimit(v); toast(v === null ? "Spend limit removed" : `Spend limit set to ${dollars(v)} a month`); }} />}
    </Panel>
  );
}

function Resets({ plans, now }: { plans: PlanWindow[]; now: number }) {
  return (
    <Panel labelledBy="resets-title">
      <Label id="resets-title">Usage resets</Label>
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
      ) : <p className="mt-4 text-17 text-ink-2">No usage resets available</p>}
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-card bg-card px-7 py-6 max-sm:px-5 max-sm:py-5">
      <div className="text-15 text-ink-3">{label}</div>
      <div className="num mt-2 truncate text-28 font-medium tracking-[-0.02em] text-ink">{value}</div>
    </div>
  );
}

export function UsagePage() {
  const { now } = useSession();
  const { billing } = useCloud();
  const { month, plans, loading, error } = useAccountUsage();
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
      <PageHeader title="Usage" sub="What your bots used this month, across every workspace." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Included plans={plans} now={now} />
        <Balance now={now} />
      </div>
      <p className="mt-3 px-1 text-14 text-ink-4">Included usage comes with the plans your bots sign in to and is used first. Credits cover bots that use our AI.</p>

      <div className="mt-8 flex flex-col gap-4">
        <Resets plans={plans} now={now} />
        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="Total" value={month ? `${compact(month.totals.tokens)} tokens` : <Skeleton className="h-8 w-32" />} />
          <Stat label="Bot turns" value={month ? month.totals.turns.toLocaleString("en-US") : <Skeleton className="h-8 w-24" />} />
          <Stat label="Credit usage" value={credit === undefined ? <Skeleton className="h-8 w-24" /> : usd(credit)} />
        </div>

        <Panel labelledBy="chart-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="chart-title" className="text-17 font-medium text-ink">Tokens per day</h2>
            <div className="flex items-center gap-3">
              <label htmlFor="usage-group" className="text-14 text-ink-3">Group by</label>
              <Select id="usage-group" className="w-[150px] [&_select]:!h-10 [&_select]:!rounded-full" value={group} onChange={(e) => setGroup(e.target.value as UsageGroup)}>
                {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </Select>
            </div>
          </div>
          <div className="mt-6">
            {error ? <p role="alert" className="py-16 text-center text-14 text-bad">{error}</p>
              : loading || !month ? <Skeleton className="h-[260px]" />
              : month.totals.tokens === 0 ? <p className="py-20 text-center text-15 text-ink-3">No bot turns yet this month. Usage shows up here after the first chat.</p>
              : <UsageChart days={month.days} series={series} />}
          </div>
          {month && month.totals.tokens > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Legend series={series} />
              {month.estimated && group !== "workspace" && <p className="text-13 text-ink-4">Per-day split by {group} is estimated from the month.</p>}
            </div>
          )}
        </Panel>
      </div>

      <section className="mt-12" aria-labelledby="events-title">
        <SectionHead id="events-title" action={<Button onClick={exportCsv} disabled={!month || month.events.length === 0}><Download size={16} strokeWidth={1.5} aria-hidden />Export</Button>}>Usage events</SectionHead>
        {loading || !month ? (
          <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : month.events.length ? (
          <>
            <Table label="Usage events">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th className="max-md:hidden">Workspace</Th>
                  <Th>Bot</Th>
                  <Th className="max-lg:hidden">Model</Th>
                  <Th className="!text-end max-md:hidden">Turns</Th>
                  <Th className="!text-end">Tokens</Th>
                  <Th className="!text-end">Cost</Th>
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
                    <Td className="num text-end">{compact(e.tokens)}</Td>
                    <Td className="num text-end text-ink-2">{e.costUsd === null ? <Nil /> : usd(e.costUsd)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {month.events.length > limit && <button type="button" onClick={() => setLimit((n) => n + PAGE * 2)} className="press-soft hover-ghost mt-2 h-11 rounded-full px-4 text-15 text-ink-3">Show more</button>}
          </>
        ) : <p className="border-y border-line py-8 text-15 text-ink-3">No usage events yet this month.</p>}
        <p className="mt-4 text-13 text-ink-4">Costs are estimates from each model's list price. Workspaces report daily totals, never your messages.</p>
      </section>
    </div>
  );
}
