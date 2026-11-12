import { useState, type ReactNode } from "react";
import { cx } from "../ui/kit";
import { n } from "./ui";
import { usd } from "./kit";
import type { CustomerStatus, PersonBilling } from "./revenue-types";

export const STATUS: Record<CustomerStatus, { label: string; wash: string }> = {
  active: { label: "active", wash: "bg-wash-lime" }, past_due: { label: "payment failed", wash: "bg-wash-pink" }, on_hold: { label: "on hold", wash: "bg-wash-pink" },
  cancelling: { label: "cancelling", wash: "bg-wash-lilac" }, churned: { label: "churned", wash: "bg-card" }, comped: { label: "comped", wash: "bg-wash-sky" },
};
const INVOICE: Record<PersonBilling["invoices"][number]["status"], { label: string; wash: string }> = {
  paid: { label: "paid", wash: "bg-wash-lime" }, failed: { label: "failed", wash: "bg-wash-pink" }, refunded: { label: "refunded", wash: "bg-wash-lilac" },
};
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }).toLowerCase();

function Cell({ label, value, note, money }: { label: string; value: ReactNode; note?: ReactNode; money?: boolean }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <div className="truncate text-12 text-ink-3">{label}</div>
      <div className={cx("mt-0.5 truncate text-15 font-medium", money ? "font-mono text-money num" : "text-ink")}>{value}</div>
      {note && <div className="truncate text-12 text-ink-4">{note}</div>}
    </div>
  );
}

/** a customer's plan, what they are worth, when they renew and every invoice */
export function BillingCard({ billing }: { billing: PersonBilling }) {
  const [all, setAll] = useState(false);
  const c = billing.customer;
  const failed = c?.failed ?? billing.invoices.filter((i) => i.status === "failed").length;
  const invoices = all ? billing.invoices : billing.invoices.slice(0, 5);
  const renew = billing.cancelAtPeriodEnd && billing.currentPeriodEnd ? { label: "cancels on", value: day(billing.currentPeriodEnd) }
    : c?.renewsAt ? { label: "next renewal", value: day(c.renewsAt) }
    : c?.churnedAt ? { label: "left on", value: day(c.churnedAt) } : { label: "next renewal", value: "-" };
  return (
    <section aria-labelledby="billing-title" className="mt-5 rounded-[20px] bg-card p-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1 pt-1">
        <h3 id="billing-title" className="text-13 font-medium text-ink">billing</h3>
        {c && <span className={cx("inline-flex h-6 items-center rounded-full px-2.5 text-12 text-ink-2", STATUS[c.status].wash)}>{STATUS[c.status].label}</span>}
      </div>
      <div className="grid grid-cols-5 rounded-[14px] bg-pop max-md:grid-cols-2">
        <Cell label="plan" value={c ? c.plan : "-"} note={c?.interval === "year" ? "billed yearly" : c?.interval === "month" ? "billed monthly" : undefined} />
        <Cell label="mrr" value={usd(c?.mrr ?? 0)} money />
        <Cell label="lifetime value" value={usd(c?.ltv ?? 0)} money note={c?.refunds ? `after ${usd(c.refunds)} refunded` : c ? `${n(c.payments)} payment${c.payments === 1 ? "" : "s"}` : undefined} />
        <Cell label={renew.label} value={renew.value} />
        <Cell label="failed payments" value={n(failed)} note={failed ? "card trouble at some point" : "never"} />
      </div>
      {billing.invoices.length > 0 && (
        <ul className="mt-1.5 rounded-[14px] bg-pop p-1" aria-label="invoices">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="grid grid-cols-[72px_minmax(0,1fr)_auto_auto] items-center gap-3 px-2 py-1.5 text-13">
              <span className="font-mono text-12 text-ink-4 num">{day(invoice.at)}</span>
              <span className="min-w-0 truncate text-ink-2">{invoice.description ?? "payment"}</span>
              <span className={cx("inline-flex h-5 items-center rounded-full px-2 text-[11.5px] text-ink-2", INVOICE[invoice.status].wash)}>{INVOICE[invoice.status].label}</span>
              <span className={cx("w-16 text-end font-mono num", invoice.status === "paid" ? "font-medium text-money" : "text-ink-3")}>{usd(invoice.amountCents)}</span>
            </li>
          ))}
          {billing.invoices.length > 5 && <li><button type="button" onClick={() => setAll((v) => !v)} className="text-link mx-auto block h-8 px-3 text-12">{all ? "show fewer" : `show all ${billing.invoices.length}`}</button></li>}
        </ul>
      )}
    </section>
  );
}
