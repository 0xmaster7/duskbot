import { useMemo, useState } from "react";
import { Bell, Check, CreditCard, Download, Gift, MoreHorizontal, Plus, ShieldCheck, Wallet } from "lucide-react";
import { useStore } from "../data/store";
import type { Billing, Cap, Invoice, PaymentMethod } from "../data/types";
import { date, monthYear, until, usd } from "../lib/format";
import { download, turnPaid } from "../lib/usage";
import { Button, Card, CardHead, cx, Field, FilterSelect, IconButton, Input, PageHead, Pill, Select, STROKE, Switch, Ticks } from "../ui/kit";
import { EmptyState } from "../ui/Mascot";
import { ConfirmDialog, Dialog, Menu } from "../ui/overlays";

const PLANS = [
  { tier: "starter", label: "Starter", price: 15, line: "2 vCPU, 100 computer hours, 30,000 voice characters" },
  { tier: "pro", label: "Pro", price: 49, line: "4 vCPU, 300 computer hours, 60,000 voice characters" },
  { tier: "max", label: "Max", price: 99, line: "8 vCPU, 800 computer hours, 180,000 voice characters" },
] as const;

function useBilling() {
  const { data, update, toast } = useStore();
  const set = (fn: (b: Billing) => Billing) => update((d) => ({ ...d, billing: fn(d.billing) }));
  return { b: data.billing, data, set, toast };
}

function PlanCard() {
  const { b, set, toast } = useBilling();
  const [change, setChange] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [pick, setPick] = useState<string>(b.plan.tier);
  return (
    <Card id="plan" className="flex flex-col">
      <CardHead icon={ShieldCheck} title="Plan" />
      <div className="flex flex-1 flex-col px-4 pb-4">
        <p className="flex items-baseline gap-2"><span className="text-24 font-semibold">{b.plan.label}</span><span className="num text-14 text-ink-3">{usd(b.plan.priceUsd)} a month</span></p>
        <p className="mt-0.5 text-13 text-ink-3">Renews {date(b.plan.renewsAt)}, {until(b.plan.renewsAt, Date.now())}. The app itself is free and open source; the plan pays for My Cloud.</p>
        <ul className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {b.plan.includes.map((line) => <li key={line} className="flex items-start gap-2 text-13 text-ink-2"><Check size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-accent" aria-hidden />{line}</li>)}
        </ul>
        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          <Button variant="primary" onClick={() => { setPick(b.plan.tier); setChange(true); }}>Change plan</Button>
          <Button variant="ghost" onClick={() => setCancel(true)}>Cancel plan</Button>
        </div>
      </div>
      <Dialog open={change} onClose={() => setChange(false)} title="Change plan"
        actions={<><Button onClick={() => setChange(false)}>Keep {b.plan.label}</Button><Button variant="primary" disabled={pick === b.plan.tier} onClick={() => {
          const plan = PLANS.find((p) => p.tier === pick)!;
          set((x) => ({ ...x, plan: { ...x.plan, tier: plan.tier, label: plan.label, priceUsd: plan.price } }));
          setChange(false);
          toast(`Switched to ${plan.label}. The difference is prorated on your next invoice.`);
        }}>Switch plan</Button></>}>
        <div role="radiogroup" aria-label="Plans" className="flex flex-col gap-2">
          {PLANS.map((p) => (
            <button key={p.tier} type="button" role="radio" aria-checked={pick === p.tier} onClick={() => setPick(p.tier)}
              className={cx("flex items-start gap-3 rounded-[10px] border px-3 py-2.5 text-start transition-colors", pick === p.tier ? "border-accent bg-accent-wash" : "border-line hover:bg-hover")}>
              <span className={cx("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", pick === p.tier ? "border-accent bg-accent" : "border-[#cfcfcf]")}>{pick === p.tier && <span className="size-1.5 rounded-full bg-surface" />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2"><span className="text-14 font-medium text-ink">{p.label}{p.tier === b.plan.tier && <span className="ms-2 text-12 font-normal text-ink-3">current</span>}</span><span className="num text-13 text-ink-2">{usd(p.price)} a month</span></span>
                <span className="block text-12 text-ink-3">{p.line}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-12 text-ink-3">Moving down takes effect at renewal, so this month's allowances stay.</p>
      </Dialog>
      <ConfirmDialog open={cancel} onClose={() => setCancel(false)} title="Cancel your plan?" word="cancel" action="Cancel plan"
        consequences={[`My Cloud stops on ${date(b.plan.renewsAt)} and its machine is deleted 30 days later`, "Bot computers and their files", "Included allowances from the next period"]}
        keeps={["The app, your bots and chats on your own computers", "Your balance, which you can still spend or have refunded", "Invoices and usage history"]}
        onConfirm={() => toast(`Plan cancelled. My Cloud keeps running until ${date(b.plan.renewsAt)}.`)} />
    </Card>
  );
}

function BalanceCard() {
  const { b, set, toast } = useBilling();
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("25");
  const n = Number(amount);
  const bad = !(n >= 5 && n <= 500) ? "Add between $5 and $500 at a time." : null;
  const auto = b.autoTopUp;
  const card = b.methods.find((m) => m.isDefault);
  return (
    <Card id="balance" className="flex flex-col">
      <CardHead icon={Wallet} title="Balance"><Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add funds</Button></CardHead>
      <div className="flex flex-1 flex-col px-4 pb-4">
        <p className="num text-24 font-semibold">{usd(b.balanceUsd)}</p>
        <p className="text-13 text-ink-3">One prepaid balance in dollars. Paid usage draws from it as it happens. It never expires.</p>
        <div className="mt-4 rounded-[10px] bg-sunk px-3 py-2.5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-13 font-medium">Auto top-up</p>
              <p className="text-12 text-ink-3">{auto.enabled ? `Adds ${usd(auto.amountUsd)} when the balance drops below ${usd(auto.belowUsd)}.` : "Off. Bots on paid AI pause when the balance runs out."}</p>
            </div>
            <Switch checked={auto.enabled} label="Auto top-up" onChange={(on) => { set((x) => ({ ...x, autoTopUp: { ...x.autoTopUp, enabled: on } })); toast(on ? "Auto top-up is on" : "Auto top-up is off"); }} />
          </div>
          {auto.enabled && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="When below">{(id) => <Input id={id} inputMode="decimal" value={auto.belowUsd} onChange={(e) => set((x) => ({ ...x, autoTopUp: { ...x.autoTopUp, belowUsd: Number(e.target.value) || 0 } }))} />}</Field>
              <Field label="Add">{(id) => <Input id={id} inputMode="decimal" value={auto.amountUsd} onChange={(e) => set((x) => ({ ...x, autoTopUp: { ...x.autoTopUp, amountUsd: Number(e.target.value) || 0 } }))} />}</Field>
            </div>
          )}
        </div>
        {b.grants.map((g) => (
          <div key={g.id} className="mt-3 flex items-center gap-3 border-t border-row pt-3">
            <Gift size={16} strokeWidth={STROKE} className="text-ink-3" aria-hidden />
            <p className="min-w-0 flex-1 text-13"><span className="font-medium">{g.label}</span><span className="text-ink-3">, {usd(g.remainingUsd)} left</span></p>
            <Pill tone="warn">Ends {date(g.expiresAt)}</Pill>
          </div>
        ))}
      </div>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add funds"
        actions={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" disabled={!!bad} onClick={() => { set((x) => ({ ...x, balanceUsd: x.balanceUsd + n })); setAdding(false); toast(`Added ${usd(n)}. Receipt sent to ${b.details.email}.`); }}>Add {bad ? "" : usd(n)}</Button></>}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Amount">
          {[10, 25, 50, 100].map((v) => <button key={v} type="button" aria-pressed={n === v} onClick={() => setAmount(String(v))} className={cx("h-8 rounded-full border px-3.5 text-13 font-medium pointer-coarse:h-11", n === v ? "border-black bg-black text-[#fafafa]" : "border-line hover:bg-hover")}>{usd(v)}</button>)}
        </div>
        <div className="mt-3"><Field label="Or another amount" error={bad}>{(id, d) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!bad} aria-describedby={d} />}</Field></div>
        <p className="mt-3 text-12 text-ink-3">Charged to {card ? `${brandName(card)} ending ${card.last4}` : "your default payment method"}. Adding funds does not count toward your caps; only usage does.</p>
      </Dialog>
    </Card>
  );
}

function CapColumn({ title, spent, cap, at, unitNote, onEdit, onAlerts }: { title: string; spent: number; cap: Cap; at: string; unitNote: string; onEdit: () => void; onAlerts: (a: number[]) => void }) {
  return (
    <div className="flex flex-col px-4 py-4">
      <div className="flex items-center gap-2">
        <p className="text-13 font-medium">{title}</p>
        <Button size="sm" className="ms-auto" onClick={onEdit}>Edit</Button>
      </div>
      <p className="mt-1 flex items-baseline gap-2"><span className="num text-18 font-semibold">{usd(spent)}</span><span className="text-13 text-ink-3">of {usd(cap.limitUsd)} this month</span></p>
      <div className="mt-2"><Ticks value={spent} max={cap.limitUsd} size="lg" label={`${title}: ${usd(spent)} of ${usd(cap.limitUsd)}`} /></div>
      <p className="mt-3 text-13 text-ink-2">{at}</p>
      <p className="mt-1 text-12 text-ink-3">{unitNote}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="me-1 inline-flex items-center gap-1 text-12 text-ink-3"><Bell size={12} strokeWidth={STROKE} aria-hidden />Email me at</span>
        {[50, 75, 90, 100].map((p) => {
          const on = cap.alerts.includes(p);
          return <button key={p} type="button" aria-pressed={on} onClick={() => onAlerts(on ? cap.alerts.filter((x) => x !== p) : [...cap.alerts, p].sort((a, b) => a - b))}
            className={cx("h-6 rounded-chip border px-2 text-12 font-medium transition-colors pointer-coarse:h-11", on ? "border-accent-3 bg-accent-wash text-accent-ink" : "border-line text-ink-3 hover:text-ink")}>{p}%</button>;
        })}
      </div>
    </div>
  );
}

function LimitsCard() {
  const { b, data, set, toast } = useBilling();
  const [editing, setEditing] = useState<null | "ai" | "cloud">(null);
  const [value, setValue] = useState("");
  const spentAi = data.turns.filter((t) => t.at >= b.periodStart).reduce((s, t) => s + turnPaid(t), 0);
  const hoursOver = Math.max(0, data.allowances.find((a) => a.kind === "computerHours")!.used - 300);
  const n = Number(value);
  const bad = !(n >= 1 && n <= 5000) ? "Enter a cap from $1 to $5,000." : null;
  const edit = (which: "ai" | "cloud") => { setValue(String(b.caps[which].limitUsd)); setEditing(which); };
  const alerts = (which: "ai" | "cloud") => (a: number[]) => set((x) => ({ ...x, caps: { ...x.caps, [which]: { ...x.caps[which], alerts: a } } }));
  return (
    <Card id="limits" className="mt-4">
      <CardHead title="Caps" />
      <div className="grid divide-y divide-row md:grid-cols-2 md:divide-x md:divide-y-0">
        <CapColumn title="AI cap" spent={spentAi} cap={b.caps.ai} onEdit={() => edit("ai")} onAlerts={alerts("ai")}
          at="At the cap, bots on Cloud AI pause new turns. Bots on your own Claude or ChatGPT keep working, and My Cloud keeps running."
          unitNote="Counts paid AI only. Trial credit and your own subscriptions never count." />
        <CapColumn title="Cloud cap" spent={hoursOver * 0.09} cap={b.caps.cloud} onEdit={() => edit("cloud")} onAlerts={alerts("cloud")}
          at="At the cap, bot computers sleep and do not wake for paid hours. Chat keeps working and My Cloud stays up."
          unitNote="Counts computer hours past your 300 included hours, at $0.09 an hour." />
      </div>
      <p className="border-t border-row px-4 py-3 text-12 text-ink-3">Caps are checked before each turn starts. A turn already running finishes, and any small overage is on us, never billed later.</p>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "ai" ? "AI cap" : "Cloud cap"}
        actions={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" disabled={!!bad} onClick={() => {
          const which = editing!;
          set((x) => ({ ...x, caps: { ...x.caps, [which]: { ...x.caps[which], limitUsd: n } } }));
          setEditing(null);
          toast(`${which === "ai" ? "AI" : "Cloud"} cap set to ${usd(n)} a month`);
        }}>Save cap</Button></>}>
        <Field label="Monthly cap in dollars" error={bad} hint="Raising a cap lets paused bots start again right away.">{(id, d) => <Input id={id} data-autofocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!bad} aria-describedby={d} />}</Field>
      </Dialog>
    </Card>
  );
}

const brandName = (m: PaymentMethod) => ({ visa: "Visa", mastercard: "Mastercard", amex: "Amex", link: "Link" })[m.brand];

function PaymentCard() {
  const { b, set, toast } = useBilling();
  const remove = (m: PaymentMethod) => set((x) => ({ ...x, methods: x.methods.filter((y) => y.id !== m.id) }));
  return (
    <Card id="payment">
      <CardHead icon={CreditCard} title="Payment methods"><Button size="sm" icon={Plus} onClick={() => toast("Opening secure checkout to add a card")}>Add</Button></CardHead>
      {b.methods.length === 0 ? <EmptyState title="No payment method" state="curious">Add a card or Link to pay for your plan and top-ups.</EmptyState> : (
        <ul className="px-4 pb-2">
          {b.methods.map((m) => (
            <li key={m.id} className="flex min-h-11 items-center gap-3 border-b border-row last:border-0">
              <span className="flex h-6 w-9 items-center justify-center rounded-[5px] border border-line text-[10px] font-semibold uppercase tracking-normal text-ink-2" aria-hidden>{m.brand === "link" ? "Link" : m.brand.slice(0, 4)}</span>
              <span className="min-w-0 flex-1 text-13"><span className="font-medium">{brandName(m)}{m.brand === "link" ? "" : ` ending ${m.last4}`}</span>{m.expires && <span className="text-ink-3">, expires {m.expires}</span>}</span>
              {m.isDefault && <Pill>Default</Pill>}
              <Menu label={`${brandName(m)} options`} trigger={(p) => <IconButton label={`${brandName(m)} options`} icon={MoreHorizontal} {...p} />} items={[
                ...(m.isDefault ? [] : [{ label: "Make default", onSelect: () => { set((x) => ({ ...x, methods: x.methods.map((y) => ({ ...y, isDefault: y.id === m.id })) })); toast(`${brandName(m)} is now the default`); } }]),
                { label: "Remove", tone: "danger" as const, onSelect: () => { const before = b.methods; remove(m); toast(`${brandName(m)} removed`, () => set((x) => ({ ...x, methods: before }))); } },
              ]} />
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-row px-4 py-3 text-12 text-ink-3">Purchases over $50 ask for your passkey first.</p>
    </Card>
  );
}

function DetailsCard() {
  const { b, set, toast } = useBilling();
  const [form, setForm] = useState(b.details);
  const emailBad = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? null : "Enter an email address like name@example.com.";
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })) });
  return (
    <Card id="details">
      <CardHead title="Billing details" />
      <form className="grid gap-3 px-4 pb-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (emailBad) return; set((x) => ({ ...x, details: form })); toast("Billing details saved"); }}>
        <Field label="Name or company">{(id) => <Input id={id} autoComplete="organization" {...field("name")} />}</Field>
        <Field label="Invoice email" error={emailBad}>{(id, d) => <Input id={id} type="email" autoComplete="email" aria-invalid={!!emailBad} aria-describedby={d} {...field("email")} />}</Field>
        <Field label="Address">{(id) => <Input id={id} autoComplete="street-address" {...field("line1")} />}</Field>
        <Field label="Postcode and city">{(id) => <Input id={id} {...field("city")} />}</Field>
        <Field label="Country">{(id) => <Select id={id} {...field("country")}>{["Germany", "France", "India", "Netherlands", "Portugal", "United Kingdom", "United States"].map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        <Field label="Tax ID" hint="Optional. Shown on every invoice.">{(id, d) => <Input id={id} placeholder="DE123456789" aria-describedby={d} {...field("taxId")} />}</Field>
        <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={JSON.stringify(form) === JSON.stringify(b.details)}>Save details</Button></div>
      </form>
    </Card>
  );
}

function InvoicesCard() {
  const { b, toast } = useBilling();
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("");
  const months = useMemo(() => [...new Set(b.invoices.map((i) => monthYear(i.at)))], [b.invoices]);
  const rows = b.invoices.filter((i) => (!month || monthYear(i.at) === month) && (!status || i.status === status));
  const tone: Record<Invoice["status"], "good" | "warn" | "bad" | "neutral"> = { paid: "good", open: "warn", failed: "bad", refunded: "neutral" };
  return (
    <Card id="invoices" className="mt-4">
      <CardHead title="Invoices">
        <FilterSelect label="Month" value={month} onChange={setMonth} options={[{ value: "", label: "All" }, ...months.map((m) => ({ value: m, label: m }))]} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "", label: "All" }, { value: "paid", label: "Paid" }, { value: "open", label: "Due" }, { value: "refunded", label: "Refunded" }]} />
      </CardHead>
      <div className="scroll-x">
        <table className="w-full min-w-[560px] text-13">
          <thead><tr className="h-9 border-b border-row text-12 text-ink-3"><th className="ps-4 text-start font-normal">Date</th><th className="text-start font-normal">Number</th><th className="text-start font-normal">For</th><th className="text-end font-normal">Amount</th><th className="ps-6 text-start font-normal">Status</th><th className="pe-4"><span className="sr-only">Download</span></th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="h-10 border-b border-row last:border-0 hover:bg-hover">
                <td className="ps-4">{date(i.at)}</td>
                <td className="font-mono text-12 text-ink-2">{i.number}</td>
                <td className="text-ink-2">{{ subscription: "Plan", "top-up": "Added funds", usage: "Usage" }[i.kind]}</td>
                <td className="num text-end font-medium">{usd(i.amountUsd)}</td>
                <td className="ps-6"><Pill tone={tone[i.status]}>{{ paid: "Paid", open: `Due ${date(b.plan.renewsAt)}`, failed: "Failed", refunded: "Refunded" }[i.status]}</Pill></td>
                <td className="pe-4 text-end"><Button size="sm" variant="ghost" icon={Download} aria-label={`Download invoice ${i.number}`} onClick={() => { download(`${i.number}.txt`, `${i.number}\n${date(i.at)}\n${usd(i.amountUsd)}\n`, "text/plain"); toast(`Downloaded ${i.number}`); }}>Download</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-8 text-center text-13 text-ink-3">No invoices match. Clear a filter to see them all.</p>}
      </div>
    </Card>
  );
}

export function BillingPage() {
  return (
    <>
      <PageHead title="Billing" sub="Your plan, one balance in dollars, separate caps for AI and Cloud, and every invoice." />
      <div className="grid gap-4 lg:grid-cols-2">
        <PlanCard />
        <BalanceCard />
      </div>
      <LimitsCard />
      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_3fr]">
        <PaymentCard />
        <DetailsCard />
      </div>
      <InvoicesCard />
    </>
  );
}
