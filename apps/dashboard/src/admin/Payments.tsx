import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search } from "@/icons";
import { Button, cx } from "../ui/kit";
import { Digits } from "../ui/Digits";
import { ago } from "../lib/format";
import { useNow } from "../lib/now";
import { adminCall, useAdmin } from "./api";
import { PersonLink } from "./sheet";
import { Highlight } from "./motion";
import { usd } from "./kit";
import { Failed, n } from "./ui";
import { PersonFace } from "./identity";
import type { PaymentRow, PaymentsV2, Person, SubscriptionStatus } from "./v2";

type Mode = "live" | "test";
type Status = "" | "paid" | "refunded" | "failed";
const pathOf = (mode: Mode, status: Status, q: string) => `/v2/payments?mode=${mode}&limit=200${status ? `&status=${status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
export const paymentReads = () => [pathOf("live", "", "")];

const STATUS_WORD: Record<PaymentRow["status"], { word: string; dot: string }> = {
  paid: { word: "paid", dot: "bg-good" }, refunded: { word: "refunded", dot: "bg-warn" }, partially_refunded: { word: "partly refunded", dot: "bg-warn" }, failed: { word: "failed", dot: "bg-bad" },
};
const PLAN_WORD: Record<SubscriptionStatus, { word: string; dot: string }> = {
  pending: { word: "pending", dot: "bg-ink-4" }, trial: { word: "trial", dot: "bg-accent" }, active: { word: "active", dot: "bg-good" }, payment_problem: { word: "payment failed", dot: "bg-bad" },
  cancelling: { word: "cancelling", dot: "bg-warn" }, cancelled: { word: "cancelled", dot: "bg-ink-4" }, ended: { word: "ended", dot: "bg-ink-4" },
};
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }).toLowerCase();
const gross = (row: PaymentRow) => row.amountCents - row.taxCents;

function Figure({ label, value, sub, money }: { label: string; value: string | null; sub: ReactNode; money?: boolean }) {
  return (
    <div className="min-w-0 px-4 pb-3.5 pt-3">
      <div className="truncate text-13 text-ink-3">{label}</div>
      <div className={cx("mt-1.5 h-9 whitespace-nowrap font-mono text-[26px] font-medium leading-9 tracking-[-0.045em] num", money ? "text-money" : "text-ink")}>
        {value === null ? <span className="inline-block h-7 w-24 animate-pulse rounded-[8px] bg-card-2 align-middle" data-skeleton /> : <Digits text={value} />}
      </div>
      <div className="mt-1 min-h-[18px] text-12 leading-[18px] text-ink-3">{sub}</div>
    </div>
  );
}

function Who({ person }: { person: Person }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <PersonFace id={person.avatarSeed || person.id} size={26} anonymous={person.kind !== "account"} avatarUrl={person.avatarUrl} avatar={person.avatar ?? undefined} />
      <span className="min-w-0">
        <span className="block truncate text-13 font-medium text-ink">{person.name}</span>
        {person.email && person.nameFrom !== "email" && <span className="block truncate text-12 text-ink-3">{person.emailKind === "apple_relay" ? "apple private relay" : person.email}</span>}
        {person.label === "deleted account" && <span className="block text-12 text-ink-4">deleted account</span>}
      </span>
    </span>
  );
}

function useDebounced(value: string, ms = 220) {
  const [out, setOut] = useState(value);
  useEffect(() => { const t = setTimeout(() => setOut(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return out;
}

export function PaymentsPage() {
  const [mode, setMode] = useState<Mode>("live");
  const [view, setView] = useState<"payments" | "customers">("payments");
  const [status, setStatus] = useState<Status>("");
  const [typed, setTyped] = useState("");
  const q = useDebounced(typed.trim());
  const path = pathOf(mode, status, q);
  const { data, error, reload } = useAdmin<PaymentsV2>(path, 120_000);
  const [more, setMore] = useState<{ path: string; rows: PaymentsV2["payments"]; next: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const now = useNow(60_000);
  const extra = more?.path === path ? more : null;
  const rows = useMemo(() => [...(data?.payments ?? []), ...(extra?.rows ?? [])], [data, extra]);
  const next = extra ? extra.next : data?.next ?? null;
  const loadMore = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const page = await adminCall<PaymentsV2>(`${path}&before=${encodeURIComponent(next)}`);
      setMore({ path, rows: [...(extra?.rows ?? []), ...page.payments], next: page.next });
    } finally { setLoading(false); }
  };
  const totals = data?.totals[mode] ?? null;
  const other = data?.totals[mode === "live" ? "test" : "live"];
  const attention = (data?.subscriptions ?? []).filter((s) => s.status === "payment_problem" || s.status === "cancelling");
  const listedGross = rows.filter((r) => r.type === "payment" && r.status !== "failed").reduce((s, r) => s + gross(r), 0);
  const whole = !next && !status && !q;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="which money" className="relative inline-flex gap-0.5 rounded-full bg-card p-1">
          <Highlight target={mode} className={mode === "test" ? "bg-wash-lemon" : "bg-pop"} />
          {(["live", "test"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} data-hl={m} onClick={() => setMode(m)} className={cx("relative z-[1] h-8 rounded-full px-3.5 text-13", mode === m ? "font-medium text-ink" : "text-ink-3 hover-link")}>{m} money</button>)}
        </div>
        {other && (other.payments > 0 || other.mrrCents > 0) && <p className="text-12 text-ink-3">{mode === "live" ? "test" : "live"} money, kept apart: <span className="font-mono num">{usd(other.grossCents)}</span> from {n(other.payments)} payments, <span className="font-mono num">{usd(other.mrrCents)}</span> mrr</p>}
      </div>
      {error && !data && <Failed error={error} retry={reload} />}
      <section aria-label="money in" className={cx("grid grid-cols-4 gap-1 rounded-[26px] p-1.5 max-md:grid-cols-2", mode === "test" ? "bg-wash-lemon" : "bg-card")}>
        <Figure money label="mrr" value={totals ? usd(totals.mrrCents) : null} sub={totals ? `${usd(totals.mrrCents * 12)} a year` : ""} />
        <Figure money label="paid in total" value={totals ? usd(totals.grossCents) : null} sub={totals ? `${n(totals.payments)} payments, ${usd(totals.netCents)} net` : ""} />
        <Figure label="paying now" value={totals ? n(totals.customers) : null} sub={totals ? `${n(totals.failed)} failed payments` : ""} />
        <Figure label="refunded" value={totals ? usd(totals.refundsCents) : null} sub={totals ? `${n(totals.refunds)} refunds` : ""} />
      </section>

      {attention.length > 0 && (
        <section aria-label="needs a look" className="mt-3 rounded-[24px] bg-wash-pink p-1.5">
          <h2 className="px-3 py-2 text-14 font-medium text-ink">needs a look</h2>
          <ul className="flex flex-col rounded-[18px] bg-pop p-1.5">
            {attention.slice(0, 6).map((s) => (
              <li key={s.id}>
                <PersonLink id={s.personId} className="hover-row flex min-h-12 items-center gap-3 rounded-[12px] px-2.5 text-13">
                  <span className="min-w-0 flex-1"><Who person={s.person} /></span>
                  <span className="text-ink-3">{s.status === "payment_problem" ? "payment failed" : `cancelling${s.currentPeriodEnd ? ` ${day(s.currentPeriodEnd)}` : ""}`}</span>
                  <span className="w-20 text-end font-mono text-money num">{usd(s.mrrCents)}/mo</span>
                </PersonLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-3 mt-7 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="payments or customers" className="relative inline-flex gap-0.5 rounded-full bg-card p-1">
          <Highlight target={view} className="bg-pop" />
          {([["payments", "every payment"], ["customers", "by customer"]] as const).map(([v, label]) => <button key={v} type="button" role="tab" aria-selected={view === v} data-hl={v} onClick={() => setView(v)} className={cx("relative z-[1] h-8 rounded-full px-3.5 text-13", view === v ? "font-medium text-ink" : "text-ink-3 hover-link")}>{label}</button>)}
        </div>
        {view === "payments" && (
          <div role="radiogroup" aria-label="status" className="relative inline-flex gap-0.5 rounded-full bg-card p-1">
            <Highlight target={status || "all"} className="bg-pop" />
            {([["", "all"], ["paid", "paid"], ["refunded", "refunded"], ["failed", "failed"]] as const).map(([v, label]) => <button key={label} type="button" role="radio" aria-checked={status === v} data-hl={v || "all"} onClick={() => setStatus(v)} className={cx("relative z-[1] h-8 rounded-full px-3 text-13", status === v ? "font-medium text-ink" : "text-ink-3 hover-link")}>{label}</button>)}
          </div>
        )}
        <div className="relative ms-auto w-[260px] max-sm:ms-0 max-sm:w-full">
          <label htmlFor="pay-search" className="sr-only">search payments</label>
          <Search size={15} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4" aria-hidden />
          <input id="pay-search" data-admin-search type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="name, email or dodo id" autoComplete="off" spellCheck={false} className="field !h-10 !rounded-full !ps-10 !text-13" />
        </div>
      </div>
      {data && view === "payments" && (
        <p className="mb-2 px-3 text-12 text-ink-3" aria-live="polite">
          {whole
            ? listedGross === totals?.grossCents ? <>all {n(rows.length)} rows shown. payments add up to <span className="font-mono text-ink num">{usd(listedGross)}</span> before tax, the same as paid in total.</> : <>all {n(rows.length)} rows shown, adding up to <span className="font-mono num">{usd(listedGross)}</span> before tax; paid in total says <span className="font-mono num">{usd(totals?.grossCents ?? 0)}</span>.</>
            : <>{n(rows.length)} rows{next ? ", more below" : ""}{q || status ? ", filtered" : ""}.</>}
        </p>
      )}

      <div className="rounded-[24px] bg-card p-1.5">
        {!data ? (
          <div data-skeleton aria-busy="true" className="flex flex-col gap-1 rounded-[18px] bg-pop p-1.5">{Array.from({ length: 6 }, (_, i) => <span key={i} className="h-12 animate-pulse rounded-[12px] bg-card" />)}</div>
        ) : view === "payments" ? (
          rows.length ? (
            <>
              <div className="grid h-9 grid-cols-[80px_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_104px] items-center gap-4 px-3 t-meta max-md:hidden" aria-hidden><span>when</span><span>who</span><span>status</span><span>plan</span><span className="text-end">charged</span></div>
              <ul aria-label="payments" className="flex flex-col rounded-[18px] bg-pop p-1.5">
                {rows.map((r) => {
                  const s = STATUS_WORD[r.status];
                  return (
                    <li key={r.id}>
                      <PersonLink id={r.personId} className="hover-row grid min-h-12 grid-cols-[80px_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_104px] items-center gap-4 rounded-[12px] px-3 py-1.5 max-md:grid-cols-[minmax(0,1fr)_auto]">
                        <span className="font-mono text-12 text-ink-3 num max-md:hidden" title={new Date(r.at).toLocaleString()}>{day(r.at)}</span>
                        <span className="min-w-0"><Who person={r.person} /><span className="hidden ps-[36px] text-12 text-ink-4 max-md:block">{r.type === "refund" ? "refund" : s.word}, {ago(r.at, now)}</span></span>
                        <span className="inline-flex items-center gap-2 text-13 text-ink-2 max-md:hidden"><span className={cx("size-[7px] rounded-[2px]", r.type === "refund" ? "bg-warn" : s.dot)} aria-hidden />{r.type === "refund" ? "refund" : s.word}</span>
                        <span className="truncate text-13 text-ink-3 max-md:hidden">{r.plan ? `${r.plan}${r.interval === "year" ? ", yearly" : ""}` : "-"}</span>
                        <span className="text-end">
                          <span className={cx("block font-mono text-13 num", r.type === "refund" || r.status === "failed" ? "text-bad" : "font-medium text-money")}>{r.amountCents < 0 ? "-" : ""}{usd(Math.abs(r.amountCents))}</span>
                          {r.taxCents !== 0 && r.type === "payment" && <span className="block font-mono text-[11px] text-ink-4 num">{usd(r.taxCents)} tax</span>}
                        </span>
                      </PersonLink>
                    </li>
                  );
                })}
              </ul>
              {next && <div className="flex justify-center p-2"><Button size="sm" onClick={() => void loadMore()} disabled={loading} aria-busy={loading}>{loading ? "loading" : "show older payments"}</Button></div>}
            </>
          ) : <p className="rounded-[18px] bg-pop px-4 py-10 text-center text-14 text-ink-3">{q || status ? "no payment matches." : `no ${mode} payments yet.`}</p>
        ) : data.people.length ? (
          <>
            <div className="grid h-9 grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_80px_104px_88px] items-center gap-4 px-3 t-meta max-md:hidden" aria-hidden><span>customer</span><span>plan</span><span>status</span><span className="text-end">mrr</span><span className="text-end">net paid</span><span className="text-end">last paid</span></div>
            <ul aria-label="customers" className="flex flex-col rounded-[18px] bg-pop p-1.5">
              {data.people.map((c) => (
                <li key={`${c.personId}${c.mode}`}>
                  <PersonLink id={c.personId} className="hover-row grid min-h-12 grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_80px_104px_88px] items-center gap-4 rounded-[12px] px-3 py-1.5 max-md:grid-cols-[minmax(0,1fr)_auto]">
                    <Who person={c.person} />
                    <span className="truncate text-13 text-ink-2 max-md:hidden">{c.plan ?? "-"}</span>
                    <span className="inline-flex items-center gap-2 text-13 text-ink-2 max-md:hidden">{c.status ? <><span className={cx("size-[7px] rounded-[2px]", PLAN_WORD[c.status].dot)} aria-hidden />{PLAN_WORD[c.status].word}</> : <span className="text-ink-4">no plan</span>}</span>
                    <span className="text-end font-mono text-13 text-ink-2 num max-md:hidden">{usd(c.mrrCents)}</span>
                    <span className="text-end font-mono text-13 font-medium text-money num">{usd(c.netCents)}{c.refundedCents > 0 && <span className="block text-[11px] font-normal text-ink-4">{usd(c.refundedCents)} refunded</span>}</span>
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
