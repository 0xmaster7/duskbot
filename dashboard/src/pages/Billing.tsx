import { useEffect, useState, type ReactNode } from "react";
import { Check, Download, Minus, Plus } from "lucide-react";
import { useCloud } from "../data/cloud";
import type { BillingInterval, Bundle, DesktopId, LicenseId, PlanCatalog, Selection } from "../data/contracts";
import { botsLine, bundleOf, desktopMonthly, dollars, gb, licenseMonthly, priceCart, selectionFor, specLine, yearly } from "../data/pricing";
import { useSession } from "../data/session";
import { compact, longDate, shortDate, usd } from "../lib/format";
import { navigate, scrollToHash, useLocation } from "../lib/router";
import { monthTotals } from "../lib/usage";
import { Field, Modal, Select, Slider, Toggle } from "../ui/controls";
import { Badge, Bar, Button, Card, cx, KV, PageHeader, SectionTitle, Skeleton } from "../ui/kit";

const INTERVAL_KEY = "omb-dash-interval";

export function useInterval(): [BillingInterval, (v: BillingInterval) => void] {
  const [v, set] = useState<BillingInterval>(() => (sessionStorage.getItem(INTERVAL_KEY) === "month" ? "month" : "year"));
  return [v, (next) => { sessionStorage.setItem(INTERVAL_KEY, next); set(next); }];
}

export function IntervalToggle({ value, onChange, discount }: { value: BillingInterval; onChange(v: BillingInterval): void; discount: number }) {
  return (
    <Toggle<BillingInterval>
      label="Billing period"
      value={value}
      onChange={onChange}
      options={[
        { value: "month", label: "Monthly" },
        { value: "year", label: <>Yearly <span className={cx("text-12", value === "year" ? "text-accent-ink" : "text-ink-4")}>-{Math.round(discount * 100)}%</span></> },
      ]}
    />
  );
}

const money = (n: number) => dollars(n, !Number.isInteger(Math.round(n * 100) / 100));

/** the price as people compare it: per month, the monthly price struck through when yearly saves */
export function Price({ monthly, interval, catalog, from }: { monthly: number; interval: BillingInterval; catalog: PlanCatalog; from?: boolean }) {
  const shown = interval === "year" ? yearly(monthly, catalog) : monthly;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      {from && <span className="text-13 text-ink-3">from</span>}
      <span className="num text-34 font-medium tracking-[-0.02em] text-ink">{money(shown)}</span>
      {interval === "year" && monthly > 0 && <s className="num text-16 text-ink-4">{dollars(monthly)}</s>}
      <span className="text-14 text-ink-3">{monthly > 0 ? "/mo" : "forever"}</span>
    </span>
  );
}

function Feature({ children }: { children: ReactNode }) {
  return <li className="flex gap-2 text-13 leading-[1.45] text-ink-2"><Check size={15} strokeWidth={1.75} className="mt-px shrink-0 text-ink-3" aria-hidden />{children}</li>;
}

function BundleCard({ b, catalog, interval, current, onPick, i }: { b: Bundle; catalog: PlanCatalog; interval: BillingInterval; current: boolean; onPick(): void; i: number }) {
  return (
    <article
      className={cx("enter relative flex flex-col rounded-card bg-card p-5", b.recommended && "ring-1 ring-[color-mix(in_oklab,var(--accent)_55%,transparent)]")}
      style={{ ["--i" as string]: i }}
      aria-labelledby={`bundle-${b.id}`}
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 id={`bundle-${b.id}`} className="text-14 font-medium text-ink">{b.name}</h3>
        {current ? <Badge tone="good">Your plan</Badge> : b.recommended ? <Badge tone="accent">Recommended</Badge> : null}
      </div>
      <div className="mt-4"><Price monthly={b.monthly} interval={interval} catalog={catalog} /></div>
      <p className="mt-1 min-h-[36px] text-13 leading-[1.4] text-ink-3">{b.blurb}</p>
      <ul className="mt-4 flex flex-1 flex-col gap-2 border-t border-line pt-4">
        {b.features.map((f) => <Feature key={f}>{f}</Feature>)}
      </ul>
      <Button variant={b.recommended && !current ? "primary" : "outline"} className="mt-5 w-full" onClick={onPick} disabled={current}>
        {current ? "Current plan" : b.monthly === 0 ? "Use it free" : `Choose ${b.name}`}
      </Button>
    </article>
  );
}

function Option({ name, group, checked, onChange, title, detail, price, children }: { name: string; group: string; checked: boolean; onChange(): void; title: ReactNode; detail: ReactNode; price: ReactNode; children?: ReactNode }) {
  const id = `${group}-${name}`;
  return (
    <div className={cx("pick rounded-[14px] border", checked ? "border-ink-4 bg-card-2" : "hover-pick border-line-2")}>
      <label htmlFor={id} className="flex cursor-pointer items-center gap-3.5 px-4 py-3.5 max-sm:px-3.5">
        <input id={id} type="radio" name={group} checked={checked} onChange={onChange} className="peer sr-only" />
        <span aria-hidden className={cx("grid size-[18px] shrink-0 place-items-center rounded-full border transition-colors duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink-3", checked ? "border-ink bg-ink" : "border-ink-4")}>
          {checked && <span className="size-1.5 rounded-full bg-bg" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-14 font-medium text-ink">{title}</span>
          <span className="block text-13 leading-[1.4] text-ink-3">{detail}</span>
        </span>
        <span className="shrink-0 text-end">{price}</span>
      </label>
      {checked && children && <div className="step-in border-t border-line px-4 pb-4 pt-4 max-sm:px-3.5">{children}</div>}
    </div>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange(v: number): void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-14 text-ink-2" id="members-label">{label}</span>
      <div className="flex items-center gap-1" role="group" aria-labelledby="members-label">
        <button type="button" aria-label="One member fewer" disabled={value <= min} onClick={() => onChange(value - 1)} className="press hover-outline grid size-11 place-items-center rounded-full border border-line-2 text-ink-2 disabled:opacity-40"><Minus size={16} strokeWidth={1.5} /></button>
        <output className="num w-10 text-center text-16 font-medium text-ink" aria-live="polite">{value}</output>
        <button type="button" aria-label="One member more" disabled={value >= max} onClick={() => onChange(value + 1)} className="press hover-outline grid size-11 place-items-center rounded-full border border-line-2 text-ink-2 disabled:opacity-40"><Plus size={16} strokeWidth={1.5} /></button>
      </div>
    </div>
  );
}

function SmallPrice({ monthly, catalog, interval, from }: { monthly: number; catalog: PlanCatalog; interval: BillingInterval; from?: boolean }) {
  if (monthly === 0) return <span className="num text-14 text-ink-2">$0</span>;
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="num whitespace-nowrap text-14 font-medium text-ink">{from ? <span className="font-normal text-ink-3">from </span> : null}{money(interval === "year" ? yearly(monthly, catalog) : monthly)}<span className="font-normal text-ink-3">/mo</span></span>
      {interval === "year" && <s className="num text-12 text-ink-4">{dollars(monthly)}</s>}
    </span>
  );
}

function Builder({ catalog, sel, set }: { catalog: PlanCatalog; sel: Selection; set(patch: Partial<Selection>): void }) {
  const free = catalog.workFreeUntil && catalog.workFreeUntil > Date.now() ? longDate(catalog.workFreeUntil) : null;
  const c = catalog.custom;
  return (
    <div className="flex flex-col gap-4">
      <Card aria-labelledby="license-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="license-title" className="text-16 font-medium text-ink">License</h3>
          {free && <span className="text-13 text-ink-3">Work use is free until {free}</span>}
        </div>
        <p className="mt-1 text-14 leading-[1.5] text-ink-3">Free for personal, non-commercial use. To use OpenMausBot at work, pick a license.</p>
        <div className="mt-5 flex flex-col gap-2.5">
          {catalog.licenses.map((l) => (
            <Option
              key={l.id}
              group="license"
              name={l.id}
              checked={sel.license === l.id}
              onChange={() => set({ license: l.id as LicenseId, members: l.perExtraMember ? Math.max(l.includedMembers, sel.members) : l.includedMembers })}
              title={l.monthly === 0 ? "No license" : `${l.name} license`}
              detail={l.monthly === 0 ? "Personal and non-commercial use" : l.perExtraMember ? `${l.includedMembers} members included, +${dollars(l.perExtraMember)} for each more` : `${l.includedMembers} member, for work`}
              price={<SmallPrice monthly={l.id === sel.license ? licenseMonthly(l, sel.members) : l.monthly} catalog={catalog} interval={sel.interval} />}
            >
              {l.perExtraMember > 0 && <Stepper label="Members" value={sel.members} min={l.includedMembers} max={l.maxMembers} onChange={(members) => set({ members })} />}
            </Option>
          ))}
        </div>
        {sel.license === "personal" && <p className="mt-4 text-13 leading-[1.5] text-ink-4">Using it for a company, for clients or for paid work? That needs a license.</p>}
      </Card>

      <Card aria-labelledby="desktop-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="desktop-title" className="text-16 font-medium text-ink">Cloud desktop</h3>
          <span className="text-13 text-ink-3">Always on, 24/7</span>
        </div>
        <p className="mt-1 text-14 leading-[1.5] text-ink-3">A computer of yours in our cloud, set up in one click. Your bots keep working while your Mac sleeps.</p>
        <div className="mt-5 flex flex-col gap-2.5">
          <Option group="desktop" name="none" checked={sel.desktop === "none"} onChange={() => set({ desktop: "none", size: null })} title="No cloud desktop" detail="Run on my Mac or my own VPS" price={<span className="num text-14 text-ink-2">$0</span>} />
          {catalog.desktops.map((d) => {
            const size = sel.size ?? { vcpu: d.vcpu, ramGb: d.ramGb, diskGb: d.diskGb };
            return (
              <Option
                key={d.id}
                group="desktop"
                name={d.id}
                checked={sel.desktop === d.id}
                onChange={() => set({ desktop: d.id as DesktopId, size: null })}
                title={<>{d.name}{d.priority && <span className="ms-2 align-[1px] text-12 font-normal text-accent-ink">Priority</span>}</>}
                detail={`${specLine(sel.desktop === d.id && d.sizable ? size : d)} · ${botsLine(d.botComputers)}`}
                price={<SmallPrice monthly={sel.desktop === d.id ? desktopMonthly(d, sel.size, c) : d.monthly} catalog={catalog} interval={sel.interval} from={d.sizable && sel.desktop !== d.id} />}
              >
                <div className="flex flex-col gap-5">
                  {d.sizable && (
                    <>
                      <Slider label="vCPU" value={size.vcpu} min={Math.max(c.vcpu.min, d.vcpu)} max={c.vcpu.max} step={c.vcpu.step} format={(v) => `${v}`} onChange={(vcpu) => set({ size: { ...size, vcpu } })} />
                      <Slider label="Memory" value={size.ramGb} min={Math.max(c.ramGb.min, d.ramGb)} max={c.ramGb.max} step={c.ramGb.step} format={gb} onChange={(ramGb) => set({ size: { ...size, ramGb } })} />
                      <Slider label="Disk" value={size.diskGb} min={Math.max(c.diskGb.min, d.diskGb)} max={c.diskGb.max} step={c.diskGb.step} format={gb} onChange={(diskGb) => set({ size: { ...size, diskGb } })} />
                    </>
                  )}
                  {!d.sizable && <p className="text-13 leading-[1.5] text-ink-3">Runs in its own sandbox on our shared machines, with its own network, disk and limits. Nothing is shared with other people.</p>}
                  <Field label="Region" htmlFor={`region-${d.id}`} hint="Pick the one closest to you, or to the sites your bots use.">
                    <Select id={`region-${d.id}`} value={sel.region} onChange={(e) => set({ region: e.target.value })}>
                      {catalog.regions.map((r) => <option key={r.id} value={r.id}>{r.city}, {r.name}</option>)}
                    </Select>
                  </Field>
                </div>
              </Option>
            );
          })}
        </div>
        {sel.desktop === "none" && <p className="mt-4 text-13 leading-[1.5] text-ink-4">Without one, your bots pause when your Mac sleeps or goes offline.</p>}
      </Card>
    </div>
  );
}

function CartCard({ catalog, sel, onCheckout, busy, error, changing, subscribed }: { catalog: PlanCatalog; sel: Selection; onCheckout(): void; busy: boolean; error: string | null; changing: boolean; subscribed: boolean }) {
  const cart = priceCart(sel, catalog);
  const label = busy ? (subscribed ? "Updating" : "Opening checkout") : subscribed ? (changing ? (cart.free ? "Switch to Free" : "Update plan") : "This is your plan") : cart.free ? "You are on Free" : "Checkout";
  return (
    <Card className="flex flex-col" aria-labelledby="cart-title">
      <h3 id="cart-title" className="text-16 font-medium text-ink">Your plan</h3>
      {cart.lines.length ? (
        <ul className="mt-4 flex flex-col gap-3">
          {cart.lines.map((l) => (
            <li key={l.key} className="flex items-start justify-between gap-4">
              <span className="min-w-0"><span className="block text-14 text-ink">{l.label}</span><span className="block text-13 text-ink-3">{l.detail}</span></span>
              <span className="num shrink-0 text-14 text-ink">{dollars(l.monthly)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-14 leading-[1.5] text-ink-3">Free, personal use, on your Mac or your own VPS.</p>
      )}
      <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-14">
        {cart.bundle && cart.bundleSaving > 0 && <div className="flex justify-between gap-4"><dt className="text-ink-3">{cart.bundle.name} bundle</dt><dd className="num text-good">{dollars(-cart.bundleSaving, true)}</dd></div>}
        {sel.interval === "year" && cart.discount > 0 && <div className="flex justify-between gap-4"><dt className="text-ink-3">Yearly discount ({Math.round(catalog.yearlyDiscount * 100)}%)</dt><dd className="num text-good">{dollars(-cart.discount, true)}</dd></div>}
        <div className="flex items-baseline justify-between gap-4 pt-1">
          <dt className="text-ink-2">Total</dt>
          <dd className="text-end"><span className="num text-28 font-medium tracking-[-0.02em] text-ink">{money(cart.perMonth)}</span><span className="text-14 text-ink-3">/mo</span></dd>
        </div>
      </dl>
      <p className="num mt-1 text-end text-13 text-ink-3">{cart.free ? "Nothing to pay" : sel.interval === "year" ? `${dollars(cart.dueNow, true)} billed yearly` : "Billed monthly"}</p>
      {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
      <Button variant="primary" className="mt-5 w-full" onClick={onCheckout} disabled={busy || (subscribed ? !changing : cart.free)}>{label}</Button>
      <p className="mt-3 text-center text-12 leading-[1.5] text-ink-4">{cart.free && !subscribed ? "Add a license for work, or a cloud desktop to stay on 24/7." : "Secure checkout by Dodo Payments. Cancel any time."}</p>
    </Card>
  );
}

function MobileCartBar({ catalog, sel, onCheckout, busy, show }: { catalog: PlanCatalog; sel: Selection; onCheckout(): void; busy: boolean; show: boolean }) {
  const cart = priceCart(sel, catalog);
  if (!show) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-side/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-[640px] items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="num text-16 font-medium text-ink">{money(cart.perMonth)}<span className="text-13 font-normal text-ink-3">/mo</span></div>
          <div className="truncate text-12 text-ink-3">{cart.lines.map((l) => l.label).join(" + ")}</div>
        </div>
        <Button variant="primary" onClick={onCheckout} disabled={busy}>{busy ? "Opening" : "Checkout"}</Button>
      </div>
    </div>
  );
}

function CurrentPlan({ catalog }: { catalog: PlanCatalog }) {
  const { billing, cancel, openPortal } = useCloud();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<Parameters<ReturnType<typeof useCloud>["cancel"]>[0]>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = billing?.subscription;
  if (!sub) return null;
  const cart = priceCart(sub.selection, catalog);
  const name = sub.bundle ? bundleOf(catalog, sub.bundle)?.name ?? "Paid plan" : "Custom plan";
  const stop = async () => {
    setBusy(true); setError(null);
    try { await cancel(reason); setAsking(false); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card aria-labelledby="current-title" className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="current-title" className="text-14 text-ink-2">Current plan</h2>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2"><span className="text-28 font-medium tracking-[-0.02em] text-ink">{name}</span><span className="num text-14 text-ink-3">{money(cart.perMonth)}/mo, billed {sub.selection.interval === "year" ? "yearly" : "monthly"}</span></p>
          <p className="mt-1 text-13 text-ink-3">{sub.cancelAt ? `Ends ${longDate(sub.cancelAt)}. Your cloud desktop stays until then.` : `Renews ${longDate(sub.currentPeriodEnd)} for ${dollars(sub.amountUsd, true)}`}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => scrollToHash("build")}>Change plan</Button>
          {!sub.cancelAt && <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>Cancel</Button>}
        </div>
      </div>
      <dl className="mt-5 grid gap-x-8 border-t border-line pt-1 sm:grid-cols-2">
        {cart.lines.map((l) => <KV key={l.key} k={l.label} v={l.detail} />)}
      </dl>
      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        title={`Cancel ${name}?`}
        footer={<><Button onClick={() => setAsking(false)}>Keep my plan</Button><Button variant="danger" onClick={() => void stop()} disabled={busy}>{busy ? "Cancelling" : "Cancel plan"}</Button></>}
      >
        <p>Your plan runs until {longDate(sub.currentPeriodEnd)}. After that your cloud desktop is kept for 7 days, then deleted, and your bots only run while your Mac is awake.</p>
        <div className="mt-4">
          <Field label="What made you cancel? (optional)" htmlFor="cancel-reason" error={error}>
            <Select id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              <option value="">Choose one</option>
              <option value="feature">Missing a feature I need</option>
              <option value="price">Too expensive</option>
              <option value="setup">Setting it up was too hard</option>
              <option value="broken">Something did not work</option>
              <option value="later">I will come back later</option>
              <option value="other">Something else</option>
            </Select>
          </Field>
        </div>
        <button type="button" className="hover-link mt-3 text-13 text-ink-3 underline decoration-line-2 underline-offset-4" onClick={() => void openPortal()}>Manage billing details instead</button>
      </Modal>
    </Card>
  );
}

function Credits({ catalog }: { catalog: PlanCatalog }) {
  const { billing, checkout } = useCloud();
  const { detail, now, toast } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const month = monthTotals(detail?.report?.activity, now);
  const credits = billing?.credits;
  const buy = async (pack: string, usdAmount: number) => {
    setBusy(pack);
    try { if (await checkout({ kind: "credits", pack })) toast(`Added ${dollars(usdAmount)} of AI credits`); } finally { setBusy(null); }
  };
  return (
    <Card aria-labelledby="credits-title">
      <SectionTitle id="credits-title">AI credits</SectionTitle>
      <p className="flex items-baseline gap-2"><span className="num text-28 font-medium tracking-[-0.02em] text-ink">{credits ? usd(credits.balanceUsd) : "n/a"}</span><span className="text-14 text-ink-3">left</span></p>
      <p className="mt-1 text-13 leading-[1.5] text-ink-3">For bots that use our AI instead of your own accounts.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {catalog.creditPacks.map((p) => (
          <Button key={p.id} size="sm" onClick={() => void buy(p.id, p.usd)} disabled={busy !== null}>{busy === p.id ? "Opening" : `Add ${dollars(p.usd)}`}</Button>
        ))}
      </div>
      <div className="mt-6 border-t border-line pt-4">
        <h3 className="text-13 text-ink-3">Usage this month</h3>
        <dl className="mt-1">
          <KV k="Credits used" v={credits ? usd(credits.usedThisMonthUsd) : "n/a"} />
          <KV k="Bot turns" v={month.turns.toLocaleString("en-US")} />
          <KV k="Tokens" v={compact(month.tokens)} />
        </dl>
        {credits && credits.balanceUsd + credits.usedThisMonthUsd > 0 && <Bar value={(credits.usedThisMonthUsd / (credits.balanceUsd + credits.usedThisMonthUsd)) * 100} className="mt-2" label="Credits used this month" />}
      </div>
    </Card>
  );
}

function Payment() {
  const { billing, openPortal } = useCloud();
  const pm = billing?.paymentMethod;
  const invoices = billing?.invoices ?? [];
  return (
    <Card aria-labelledby="payment-title">
      <SectionTitle id="payment-title" action={<Button size="sm" onClick={() => void openPortal()}>{pm ? "Update" : "Add a card"}</Button>}>Payment method</SectionTitle>
      {pm ? (
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-12 shrink-0 place-items-center rounded-[8px] border border-line-2 text-12 font-medium uppercase text-ink-2">{pm.brand}</span>
          <span className="num text-14 text-ink">•••• {pm.last4}</span>
          <span className="num ms-auto text-13 text-ink-3">Expires {String(pm.expMonth).padStart(2, "0")}/{String(pm.expYear).slice(-2)}</span>
        </div>
      ) : <p className="text-14 text-ink-3">No card yet. You add one at checkout.</p>}
      <h3 className="mt-7 text-14 font-medium text-ink">Invoices</h3>
      {invoices.length ? (
        <ul className="mt-2 divide-y divide-line">
          {invoices.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 py-1 text-14">
              <span className="num w-14 shrink-0 text-ink-3">{shortDate(inv.date)}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{inv.description}</span>
              {inv.status !== "paid" && <Badge tone={inv.status === "open" ? "warn" : "plain"}>{inv.status === "open" ? "Due" : "Refunded"}</Badge>}
              <span className="num text-ink-2">{usd(inv.amountUsd)}</span>
              {inv.url ? (
                <a href={inv.url} target="_blank" rel="noreferrer" aria-label={`Download invoice ${inv.number}`} className="press hover-ghost -me-3 grid size-11 shrink-0 place-items-center rounded-full text-ink-3"><Download size={16} strokeWidth={1.5} /></a>
              ) : <span className="-me-3 size-11 shrink-0" aria-hidden />}
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-14 text-ink-3">Invoices show up here after your first payment.</p>}
    </Card>
  );
}

export function BillingPage() {
  const { catalog, billing, checkout, changePlan } = useCloud();
  const { toast } = useSession();
  const { query } = useLocation();
  const [interval, setIv] = useInterval();
  const sub = billing?.subscription ?? null;
  const [sel, setSel] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!catalog || sel || billing === null) return;
    const want = query.get("bundle");
    const b = want ? bundleOf(catalog, want) : null;
    const region = catalog.regions[0]?.id ?? "";
    if (b) { setSel(selectionFor(b, catalog, interval, region)); scrollToHash("build"); }
    else if (sub) setSel({ ...sub.selection });
    else setSel(selectionFor(bundleOf(catalog, "pro") ?? catalog.bundles[0]!, catalog, interval, region));
  }, [catalog, billing, sub, sel, query, interval]);

  if (!catalog || !sel) {
    return (
      <div aria-busy="true" aria-label="Loading">
        <Skeleton className="h-9 w-64" />
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[360px] !rounded-card" />)}</div>
      </div>
    );
  }

  const set = (patch: Partial<Selection>) => { setSel((s) => (s ? { ...s, ...patch } : s)); setError(null); };
  const setBoth = (v: BillingInterval) => { setIv(v); set({ interval: v }); };
  const pick = (b: Bundle) => { setSel(selectionFor(b, catalog, interval, sel.region)); setError(null); scrollToHash("build"); };
  const changing = Boolean(sub) && JSON.stringify(sub!.selection) !== JSON.stringify(sel);
  const current = sub ? sub.bundle : "free";
  const cart = priceCart(sel, catalog);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      if (sub) { await changePlan(sel); toast("Plan updated"); }
      else if (await checkout({ kind: "plan", selection: sel, bundle: cart.bundle?.id ?? null })) {
        toast(sel.desktop === "none" ? "License active. Thanks for backing OpenMausBot." : "Paid. Your cloud desktop is being set up.");
        if (sel.desktop !== "none") navigate("/cloud");
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="max-lg:pb-20">
      <PageHeader
        title="Plans & billing"
        sub="Personal use is free. Work needs a license. A cloud desktop keeps your bots on 24/7."
        action={<IntervalToggle value={interval} onChange={setBoth} discount={catalog.yearlyDiscount} />}
      />
      <CurrentPlan catalog={catalog} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {catalog.bundles.map((b, i) => <BundleCard key={b.id} b={b} i={i} catalog={catalog} interval={interval} current={current === b.id} onPick={() => pick(b)} />)}
      </div>
      <section id="build" aria-labelledby="build-title" className="mt-12 scroll-mt-20">
        <div className="mb-4">
          <h2 id="build-title" className="text-20 font-medium tracking-[-0.01em] text-ink">Build your own</h2>
          <p className="mt-1 text-14 text-ink-3">A license and a cloud desktop in one checkout. Self-hosting? Take just the license.</p>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Builder catalog={catalog} sel={sel} set={set} />
          <div className="lg:sticky lg:top-6"><CartCard catalog={catalog} sel={sel} onCheckout={() => void go()} busy={busy} error={error} changing={changing} subscribed={Boolean(sub)} /></div>
        </div>
      </section>
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <Payment />
        <Credits catalog={catalog} />
      </div>
      <MobileCartBar catalog={catalog} sel={sel} onCheckout={() => void go()} busy={busy} show={!cart.free && (!sub || changing)} />
    </div>
  );
}
