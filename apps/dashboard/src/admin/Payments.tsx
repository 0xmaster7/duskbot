import { useMemo, useState, type ReactNode } from "react";
import { cx } from "../ui/kit";
import { Digits } from "../ui/Digits";
import { ago } from "../lib/format";
import { useNow } from "../lib/now";
import { useAdmin } from "./api";
import { PersonLink } from "./sheet";
import { Highlight } from "./motion";
import { usd } from "./kit";
import { Failed, n } from "./ui";
import type { CustomerRow, CustomerStatus, FeedItem, MoneyMode, SubscriptionReport } from "./revenue-types";

const path = (mode: MoneyMode) => `/revenue?days=90&mode=${mode}`;
export const paymentReads = () => [path("live")];

const MONEY_KINDS = new Set<FeedItem["kind"]>(["new", "renewal", "payment", "failed", "refund", "dispute", "dispute_closed", "recovered"]);
const KIND: Partial<Record<FeedItem["kind"], { word: string; tone: "good" | "bad" | "quiet" }>> = {
  new: { word: "first payment", tone: "good" }, renewal: { word: "renewal", tone: "good" }, payment: { word: "payment", tone: "good" }, recovered: { word: "recovered", tone: "good" },
  failed: { word: "failed", tone: "bad" }, refund: { word: "refund", tone: "bad" }, dispute: { word: "disputed", tone: "bad" }, dispute_closed: { word: "dispute closed", tone: "quiet" },
};
const STATUS: Record<CustomerStatus, { word: string; dot: string }> = {
  active: { word: "active", dot: "bg-good" }, past_due: { word: "payment failed", dot: "bg-bad" }, on_hold: { word: "on hold", dot: "bg-bad" },
  cancelling: { word: "cancelling", dot: "bg-warn" }, churned: { word: "churned", dot: "bg-ink-4" }, comped: { word: "comped", dot: "bg-accent" },
};
const stamp = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }).toLowerCase();

function Figure({ label, value, sub, money }: { label: string; value: string | null; sub: ReactNode; money?: boolean }) {
  return (
    <div className="min-w-0 px-4 pb-3.5 pt-3">
      <div className="truncate text-13 text-ink-3">{label}</div>
      <div className={cx("mt-1.5 h-9 font-mono text-[28px] font-medium leading-9 tracking-[-0.045em] num", money ? "text-money" : "text-ink")}>
        {value === null ? <span className="inline-block h-7 w-24 animate-pulse rounded-[8px] bg-card-2 align-middle" data-skeleton /> : <Digits text={value} />}
      </div>
      <div className="mt-1 h-[18px] truncate text-12 text-ink-3">{sub}</div>
    </div>
  );
}

export function PaymentsPage() {
  const [mode, setMode] = useState<MoneyMode>("live");
  const [view, setView] = useState<"payments" | "customers">("payments");
  const { data, error, reload } = useAdmin<SubscriptionReport>(path(mode), 120_000);
  const now = useNow(60_000);
  const feed = useMemo(() => data?.feed.filter((f) => MONEY_KINDS.has(f.kind)) ?? [], [data]);
  const sums = useMemo(() => {
    const paid = feed.filter((f) => KIND[f.kind]?.tone === "good" && f.kind !== "recovered");
    return { paid: paid.reduce((s, f) => s + (f.amountCents ?? 0), 0), count: paid.length, refunds: feed.filter((f) => f.kind === "refund").reduce((s, f) => s + Math.abs(f.amountCents ?? 0), 0) };
  }, [feed]);
  const totals = data ? data.modes?.[mode] ?? { mrr: data.headline.mrr, customers: data.headline.customers, gross: data.cash.gross, payments: data.cash.payments } : null;
  const other = data?.modes?.[mode === "live" ? "test" : "live"];
  const customers = useMemo(() => [...(data?.customers ?? [])].sort((a, b) => (b.lastPaidAt ?? 0) - (a.lastPaidAt ?? 0)), [data]);
  const complete = data ? sums.count === data.cash.payments : false;
  const attention = data?.risk ?? [];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="which money" className="relative inline-flex gap-0.5 rounded-full bg-card p-1">
          <Highlight target={mode} className={mode === "test" ? "bg-wash-lemon" : "bg-pop"} />
          {(["live", "test"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} data-hl={m} onClick={() => setMode(m)} className={cx("relative z-[1] h-8 rounded-full px-3.5 text-13", mode === m ? "font-medium text-ink" : "text-ink-3 hover-link")}>{m} money</button>)}
        </div>
        {other && (other.payments > 0 || other.mrr > 0) && <p className="text-12 text-ink-3">{mode === "live" ? "test" : "live"} money, kept apart: <span className="font-mono num">{usd(other.gross)}</span> from {n(other.payments)} payments, <span className="font-mono num">{usd(other.mrr)}</span> mrr</p>}
      </div>
      {error && !data && <Failed error={error} retry={reload} />}
      <section aria-label="money in" className={cx("grid grid-cols-4 gap-1 rounded-[26px] p-1.5 max-md:grid-cols-2", mode === "test" ? "bg-wash-lemon" : "bg-card")}>
        <Figure money label="mrr" value={totals ? usd(totals.mrr) : null} sub={totals ? `${usd(totals.mrr * 12)} a year` : ""} />
        <Figure money label="paid in total" value={totals ? usd(totals.gross) : null} sub={data ? `${n(totals?.payments ?? 0)} payments, ${usd(data.cash.afterTax)} after tax and refunds` : ""} />
        <Figure label="paying now" value={totals ? n(totals.customers) : null} sub={data ? `${n(data.status.cancelScheduled)} cancelling, ${n(data.status.pastDue)} past due` : ""} />
        <Figure label="refunded" value={data ? usd(data.refunds.cents) : null} sub={data ? `${n(data.refunds.count)} refunds${data.refunds.disputesOpen ? `, ${n(data.refunds.disputesOpen)} open disputes` : ""}` : ""} />
      </section>

      {attention.length > 0 && (
        <section aria-label="needs a look" className="mt-3 rounded-[24px] bg-wash-pink p-1.5">
          <h2 className="px-3 py-2 text-14 font-medium text-ink">needs a look</h2>
          <ul className="flex flex-col rounded-[18px] bg-pop p-1.5">
            {attention.slice(0, 5).map((r) => (
              <li key={r.accountId}>
                <PersonLink id={r.accountId} className="hover-row flex h-11 items-center gap-3 rounded-[12px] px-2.5 text-13">
                  <span className="min-w-0 flex-1 truncate text-ink">{r.email ?? r.accountId}</span>
                  <span className="text-ink-3">{r.reason === "payment_failed" ? "payment failed" : r.reason === "cancel_scheduled" ? "set to cancel" : "barely uses it"}</span>
                  <span className="w-20 text-end font-mono text-money num">{usd(r.mrr)}/mo</span>
                </PersonLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-3 mt-7 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="payments or customers" className="relative inline-flex gap-0.5 rounded-full bg-card p-1">
          <Highlight target={view} className="bg-pop" />
          {([["payments", "every payment"], ["customers", "by customer"]] as const).map(([v, label]) => <button key={v} type="button" role="tab" aria-selected={view === v} data-hl={v} onClick={() => setView(v)} className={cx("relative z-[1] h-8 rounded-full px-3.5 text-13", view === v ? "font-medium text-ink" : "text-ink-3 hover-link")}>{label}</button>)}
        </div>
        {data && view === "payments" && (
          <p className={cx("text-12", complete ? "text-ink-3" : "text-ink-4")}>
            {complete ? <>these add up to <span className="font-mono text-ink num">{usd(sums.paid)}</span>, the same as paid in total</> : <>newest {n(feed.length)} shown. paid in total counts all {n(data.cash.payments)}.</>}
          </p>
        )}
      </div>

      <div className="rounded-[24px] bg-card p-1.5">
        {!data ? (
          <div data-skeleton aria-busy="true" className="flex flex-col gap-1 rounded-[18px] bg-pop p-1.5">{Array.from({ length: 6 }, (_, i) => <span key={i} className="h-12 animate-pulse rounded-[12px] bg-card" />)}</div>
        ) : view === "payments" ? (
          feed.length ? (
            <>
              <div className="grid h-9 grid-cols-[80px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_96px] items-center gap-4 px-3 t-meta max-md:hidden" aria-hidden><span>when</span><span>who</span><span>what</span><span>plan</span><span className="text-end">amount</span></div>
              <ul aria-label="payments" className="flex flex-col rounded-[18px] bg-pop p-1.5">
                {feed.map((f) => {
                  const k = KIND[f.kind]!;
                  const cells = (
                    <>
                      <span className="font-mono text-12 text-ink-3 num max-md:hidden" title={new Date(f.at).toLocaleString()}>{stamp(f.at)}</span>
                      <span className="min-w-0"><span className="block truncate text-13 font-medium text-ink">{f.email ?? "unknown payer"}</span><span className="hidden text-12 text-ink-3 max-md:block">{k.word}, {ago(f.at, now)}</span></span>
                      <span className="inline-flex items-center gap-2 text-13 text-ink-2 max-md:hidden"><span className={cx("size-[7px] rounded-[2px]", k.tone === "good" ? "bg-good" : k.tone === "bad" ? "bg-bad" : "bg-ink-4")} aria-hidden />{k.word}{f.detail && f.kind !== "new" && f.kind !== "renewal" && f.kind !== "payment" ? <span className="truncate text-ink-4">{f.detail}</span> : null}</span>
                      <span className="truncate text-13 text-ink-3 max-md:hidden">{f.plan ?? "-"}</span>
                      <span className={cx("text-end font-mono text-13 num", k.tone === "bad" ? "text-bad" : k.tone === "good" ? "font-medium text-money" : "text-ink-3")}>{f.amountCents === null ? "-" : `${f.amountCents < 0 ? "-" : ""}${usd(Math.abs(f.amountCents))}`}</span>
                    </>
                  );
                  const cls = "grid min-h-12 grid-cols-[80px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_96px] items-center gap-4 rounded-[12px] px-3 max-md:grid-cols-[minmax(0,1fr)_auto]";
                  return <li key={f.id}>{f.accountId ? <PersonLink id={f.accountId} className={cx(cls, "hover-row")}>{cells}</PersonLink> : <div className={cls}>{cells}</div>}</li>;
                })}
              </ul>
            </>
          ) : <p className="rounded-[18px] bg-pop px-4 py-10 text-center text-14 text-ink-3">no {mode} payments yet.</p>
        ) : customers.length ? (
          <>
            <div className="grid h-9 grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_80px_96px_88px] items-center gap-4 px-3 t-meta max-md:hidden" aria-hidden><span>customer</span><span>plan</span><span>status</span><span className="text-end">mrr</span><span className="text-end">paid in total</span><span className="text-end">last paid</span></div>
            <ul aria-label="customers" className="flex flex-col rounded-[18px] bg-pop p-1.5">
              {customers.map((c: CustomerRow) => (
                <li key={`${c.accountId}${c.mode ?? ""}`}>
                  <PersonLink id={c.accountId} className="hover-row grid min-h-12 grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_80px_96px_88px] items-center gap-4 rounded-[12px] px-3 max-md:grid-cols-[minmax(0,1fr)_auto]">
                    <span className="min-w-0"><span className="block truncate text-13 font-medium text-ink">{c.name || c.email || "unknown payer"}</span>{c.name && c.email && <span className="block truncate text-12 text-ink-3">{c.email}</span>}</span>
                    <span className="truncate text-13 text-ink-2 max-md:hidden">{c.plan}{c.interval === "year" ? ", yearly" : ""}</span>
                    <span className="inline-flex items-center gap-2 text-13 text-ink-2 max-md:hidden"><span className={cx("size-[7px] rounded-[2px]", STATUS[c.status].dot)} aria-hidden />{STATUS[c.status].word}</span>
                    <span className="text-end font-mono text-13 text-ink-2 num max-md:hidden">{usd(c.mrr)}</span>
                    <span className="text-end font-mono text-13 font-medium text-money num">{usd(c.ltv)}</span>
                    <span className="text-end text-12 text-ink-3 max-md:hidden">{c.lastPaidAt ? ago(c.lastPaidAt, now) : "-"}</span>
                  </PersonLink>
                </li>
              ))}
            </ul>
          </>
        ) : <p className="rounded-[18px] bg-pop px-4 py-10 text-center text-14 text-ink-3">no {mode} customers yet.</p>}
      </div>
    </>
  );
}
