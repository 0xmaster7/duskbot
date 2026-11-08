import { useEffect, useState, type ReactNode } from "react";
import { Check, Download, Minus, Plus } from "lucide-react";
import { useCloud } from "../data/cloud";
import type { BillingInterval, Bundle, BundleId, DesktopId, LicenseId, PlanCatalog, Selection } from "../data/contracts";
import { botsLine, bundleOf, desktopMonthly, desktopOf, dollars, licenseMonthly, licenseOf, selectionFor, specLine, yearly } from "../data/pricing";
import { useCart } from "../data/quote";
import { useSession } from "../data/session";
import { longDate, shortDate, usd } from "../lib/format";
import { navigate, useLocation } from "../lib/router";
import { Choice, Field, Modal, Select, Sheet, Toggle } from "../ui/controls";
import { Badge, Button, cx, PageHeader, Skeleton } from "../ui/kit";
import { SectionHead } from "../ui/table";
import { BuyCredits } from "./credits-dialog";

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
        { value: "year", label: <>Yearly <span className="text-ink-4">-{Math.round(discount * 100)}%</span></> },
      ]}
    />
  );
}

const money = (n: number) => dollars(n, !Number.isInteger(Math.round(n * 100) / 100));
const perMonth = (monthly: number, interval: BillingInterval, catalog: PlanCatalog) => (interval === "year" ? yearly(monthly, catalog) : monthly);
const billed = (interval: BillingInterval) => (interval === "year" ? "billed yearly" : "billed monthly");

/** the three plans people pick from; starter and custom builds live one quiet click away */
const SHOWN: BundleId[] = ["free", "pro", "team"];

function pitch(b: Bundle, catalog: PlanCatalog): { line: string; points: string[] } {
  const desk = desktopOf(catalog, b.desktop);
  const lic = licenseOf(catalog, b.license);
  if (b.id === "free") return { line: "Every bot, chat and connector, on your own computer.", points: ["Personal, non-commercial use", "Runs on your Mac or your own server", "Bots pause when it sleeps"] };
  if (b.license === "team") {
    const members = Math.max(b.members, lic?.includedMembers ?? 1);
    return { line: "Your team's bots on a machine of its own.", points: [`${members} members${lic?.perExtraMember ? `, +${dollars(lic.perExtraMember)} for each more` : ""}`, "Dedicated cloud desktop, on 24/7", desk ? botsLine(desk.botComputers) : "Unlimited bot computers"] };
  }
  return { line: "A work license and a cloud desktop that never sleeps.", points: ["Work license for one person", "Cloud desktop, on 24/7", desk ? botsLine(desk.botComputers) : "Bot computers included"] };
}

function PlanCard({ b, catalog, interval, current, busy, onChoose }: { b: Bundle; catalog: PlanCatalog; interval: BillingInterval; current: boolean; busy: boolean; onChoose(): void }) {
  const { line, points } = pitch(b, catalog);
  const free = b.monthly === 0;
  const lead = b.recommended && !current;
  return (
    <article className={cx("enter flex min-w-0 flex-col rounded-card bg-card p-6 max-sm:p-5", lead && "ring-1 ring-line-2")} aria-labelledby={`plan-${b.id}`}>
      <div className="flex h-[22px] items-center justify-between gap-2">
        <h2 id={`plan-${b.id}`} className="text-15 font-medium text-ink">{b.name}</h2>
        {current && <Badge>Current</Badge>}
      </div>
      <p className="mt-5 flex items-baseline gap-1">
        <span className="num text-34 font-semibold tracking-[-0.03em] text-ink">{money(perMonth(b.monthly, interval, catalog))}</span>
        <span className="text-14 text-ink-3">/mo</span>
      </p>
      <p className="text-13 text-ink-4">{free ? "Free forever" : billed(interval)}</p>
      <p className="mt-4 text-14 leading-[1.5] text-ink-2">{line}</p>
      <ul className="mt-5 flex flex-1 flex-col gap-2.5">
        {points.map((p) => <li key={p} className="flex gap-2.5 text-14 leading-[1.4] text-ink-3"><Check size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-4" aria-hidden />{p}</li>)}
      </ul>
      <Button variant={lead ? "primary" : "outline"} className="mt-7 w-full" onClick={onChoose} disabled={current || busy}>
        {current ? "Current plan" : busy ? "Opening checkout" : free ? "Switch to Free" : `Choose ${b.name}`}
      </Button>
    </article>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange(v: number): void }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      <span className="text-14 text-ink-2" id="members-label">People</span>
      <div className="flex items-center gap-1" role="group" aria-labelledby="members-label">
        <button type="button" aria-label="One person fewer" disabled={value <= min} onClick={() => onChange(value - 1)} className="press hover-outline grid size-9 place-items-center rounded-full bg-card-2 text-ink-2 disabled:opacity-40 max-sm:size-11"><Minus size={15} strokeWidth={1.5} /></button>
        <output className="num w-9 text-center text-15 font-medium text-ink" aria-live="polite">{value}</output>
        <button type="button" aria-label="One person more" disabled={value >= max} onClick={() => onChange(value + 1)} className="press hover-outline grid size-9 place-items-center rounded-full bg-card-2 text-ink-2 disabled:opacity-40 max-sm:size-11"><Plus size={15} strokeWidth={1.5} /></button>
      </div>
    </div>
  );
}

const Price = ({ n }: { n: number }) => (n === 0 ? <>$0</> : <>{money(n)}<span className="text-ink-3">/mo</span></>);

/** build your own: seats and a desktop size, a live total, one checkout; only here, never on the page */
function CustomizeSheet({ catalog, initial, onClose, subscribed }: { catalog: PlanCatalog; initial: Selection; onClose(): void; subscribed: boolean }) {
  const { checkout, changePlan, billing } = useCloud();
  const { toast } = useSession();
  const [sel, setSel] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { cart, ready, error: quoteError } = useCart(sel, catalog);
  const set = (patch: Partial<Selection>) => { setSel((s) => ({ ...s, ...patch })); setError(null); };
  const iv = sel.interval;
  const same = subscribed && JSON.stringify(billing?.subscription?.selection) === JSON.stringify(sel);
  const go = async () => {
    if (!ready || !cart) return;
    setBusy(true); setError(null);
    try {
      if (subscribed) { await changePlan(sel); toast("Plan updated"); onClose(); }
      else if (await checkout({ kind: "plan", selection: sel, bundle: cart.bundle?.id ?? null })) {
        toast(sel.desktop === "none" ? "License active. Thanks for backing OpenMausBot." : "Paid. Your cloud desktop is being set up.");
        onClose();
        if (sel.desktop !== "none") navigate("/cloud");
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const free = cart?.free ?? true;
  const label = busy ? (subscribed ? "Updating" : "Opening checkout") : subscribed ? "Update plan" : "Checkout";
  const team = licenseOf(catalog, sel.license);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Customize your plan"
      footer={
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-14 text-ink-3">Total</span>
            <span className="num"><span className="text-24 font-semibold tracking-[-0.02em] text-ink">{cart ? money(cart.perMonth) : "..."}</span><span className="text-14 text-ink-3">/mo</span></span>
          </div>
          <p className="num mt-0.5 text-end text-13 text-ink-4">{free ? "Nothing to pay" : iv === "year" && cart ? `${dollars(cart.dueNow, true)} billed yearly` : "Billed monthly"}</p>
          {(error ?? quoteError) && <p role="alert" className="mt-3 text-13 text-bad">{error ?? quoteError}</p>}
          <Button variant="primary" className="mt-4 w-full !h-11" onClick={() => void go()} disabled={!ready || busy || same || (!subscribed && free)}>{label}</Button>
        </div>
      }
    >
      <div className="mt-2"><IntervalToggle value={iv} onChange={(interval) => set({ interval })} discount={catalog.yearlyDiscount} /></div>
      <fieldset className="mt-7 min-w-0">
        <legend className="mb-2 text-13 text-ink-3">License</legend>
        <div className="flex flex-col gap-1">
          {catalog.licenses.map((l) => (
            <Choice
              key={l.id}
              name="license"
              value={l.id}
              checked={sel.license === l.id}
              onChange={() => set({ license: l.id as LicenseId, members: l.perExtraMember ? Math.max(l.includedMembers, sel.members) : l.includedMembers })}
              title={l.monthly === 0 ? "Personal" : l.name}
              detail={l.monthly === 0 ? "Personal, non-commercial use" : l.perExtraMember ? `${l.includedMembers} people, +${dollars(perMonth(l.perExtraMember, iv, catalog))} each more` : "One person, for work"}
              aside={<Price n={perMonth(l.id === sel.license ? licenseMonthly(l, sel.members) : l.monthly, iv, catalog)} />}
            />
          ))}
        </div>
        {team && team.perExtraMember > 0 && <Stepper value={sel.members} min={team.includedMembers} max={team.maxMembers} onChange={(members) => set({ members })} />}
      </fieldset>
      <fieldset className="mt-7 min-w-0">
        <legend className="mb-2 text-13 text-ink-3">Cloud desktop</legend>
        <div className="flex flex-col gap-1">
          <Choice name="desktop" value="none" checked={sel.desktop === "none"} onChange={() => set({ desktop: "none", size: null })} title="None" detail="Run on your Mac or your own server" aside={<Price n={0} />} />
          {catalog.desktops.map((d) => (
            <Choice key={d.id} name="desktop" value={d.id} checked={sel.desktop === d.id} onChange={() => set({ desktop: d.id as DesktopId, size: null })} title={d.name} detail={`${botsLine(d.botComputers)} · ${specLine(d)}`} aside={<Price n={perMonth(desktopMonthly(d, null, catalog.custom), iv, catalog)} />} />
          ))}
        </div>
      </fieldset>
      {sel.desktop !== "none" && (
        <div className="mt-7">
          <Field label="Region" htmlFor="sheet-region">
            <Select id="sheet-region" value={sel.region} onChange={(e) => set({ region: e.target.value })}>
              {catalog.regions.map((r) => <option key={r.id} value={r.id}>{r.city}, {r.name}</option>)}
            </Select>
          </Field>
        </div>
      )}
    </Sheet>
  );
}

function Row({ k, children, action }: { k: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid min-h-14 grid-cols-[160px_minmax(0,1fr)_auto] items-center gap-4 py-2.5 text-14 max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-y-0.5">
      <dt className="text-ink-3 max-sm:col-span-2 max-sm:text-13">{k}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
      {action ? <dd className="justify-self-end">{action}</dd> : <dd aria-hidden />}
    </div>
  );
}

const quiet = "hover-link inline-flex h-9 items-center rounded-full px-1 text-14 text-ink-2 disabled:opacity-45 max-sm:h-11";

function Account({ catalog, onCancel }: { catalog: PlanCatalog; onCancel(): void }) {
  const { billing, openPortal } = useCloud();
  const [buying, setBuying] = useState(false);
  const sub = billing?.subscription ?? null;
  const { cart } = useCart(sub?.selection ?? null, catalog);
  const pm = billing?.paymentMethod;
  const invoices = billing?.invoices ?? [];
  const files = invoices.some((inv) => inv.url);
  const name = sub ? (sub.bundle ? bundleOf(catalog, sub.bundle)?.name ?? "Paid plan" : "Custom plan") : "Free";
  return (
    <>
      <section className="mt-16" aria-labelledby="billing-title">
        <SectionHead id="billing-title">Billing</SectionHead>
        <dl className="divide-y divide-line border-y border-line">
          <Row k="Current plan" action={sub && !sub.cancelAt ? <button type="button" className={quiet} onClick={onCancel}>Cancel</button> : undefined}>
            <span className="block truncate">{name}{sub && cart ? <span className="num text-ink-3">, {money(cart.perMonth)}/mo {billed(sub.selection.interval)}</span> : <span className="text-ink-3">, personal use</span>}</span>
            {sub && <span className="block truncate text-13 text-ink-3">{sub.cancelAt ? `Ends ${longDate(sub.cancelAt)}. Your cloud desktop stays until then.` : `Renews ${longDate(sub.currentPeriodEnd)}`}</span>}
          </Row>
          <Row k="Payment method" action={<button type="button" className={quiet} onClick={() => void openPortal()}>{pm ? "Update" : "Add"}</button>}>
            {pm ? <span className="num"><span className="uppercase">{pm.brand}</span> •••• {pm.last4}<span className="text-ink-3">, expires {String(pm.expMonth).padStart(2, "0")}/{String(pm.expYear).slice(-2)}</span></span> : <span className="text-ink-3">None yet. You add one at checkout.</span>}
          </Row>
          <Row k="AI credits" action={<button type="button" className={quiet} onClick={() => setBuying(true)}>Add credits</button>}>
            {billing ? <span className="num">{usd(billing.credits.balanceUsd)} <span className="text-ink-3">left</span></span> : <Skeleton className="h-5 w-24" />}
          </Row>
        </dl>
      </section>
      <section className="mt-12" aria-labelledby="invoices-title">
        <SectionHead id="invoices-title">Invoices</SectionHead>
        {invoices.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex min-h-12 items-center gap-4 text-14">
                <span className="num w-16 shrink-0 text-ink-3">{shortDate(inv.date)}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{inv.description}</span>
                {inv.status !== "paid" && <span className={cx("text-13", inv.status === "open" ? "text-warn" : "text-ink-3")}>{inv.status === "open" ? "Due" : "Refunded"}</span>}
                <span className="num text-ink-2">{usd(inv.amountUsd)}</span>
                {inv.url ? (
                  <a href={inv.url} target="_blank" rel="noreferrer" aria-label={`Download invoice ${inv.number}`} className="hover-ghost -me-2 grid size-9 shrink-0 place-items-center rounded-full text-ink-3 max-sm:size-11"><Download size={15} strokeWidth={1.5} /></a>
                ) : files ? <span className="-me-2 size-9 shrink-0 max-sm:size-11" aria-hidden /> : null}
              </li>
            ))}
          </ul>
        ) : <p className="border-y border-line py-5 text-14 text-ink-3">Invoices show up here after your first payment.</p>}
      </section>
      <BuyCredits open={buying} onClose={() => setBuying(false)} />
    </>
  );
}

function CancelDialog({ open, onClose, catalog }: { open: boolean; onClose(): void; catalog: PlanCatalog }) {
  const { billing, cancel, openPortal } = useCloud();
  const [reason, setReason] = useState<Parameters<ReturnType<typeof useCloud>["cancel"]>[0]>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = billing?.subscription;
  if (!sub) return null;
  const name = sub.bundle ? bundleOf(catalog, sub.bundle)?.name ?? "your plan" : "your plan";
  const stop = async () => {
    setBusy(true); setError(null);
    try { await cancel(reason); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Cancel ${name}?`}
      footer={<><Button onClick={onClose}>Keep my plan</Button><Button variant="danger" onClick={() => void stop()} disabled={busy}>{busy ? "Cancelling" : "Cancel plan"}</Button></>}
    >
      <p>It runs until {longDate(sub.currentPeriodEnd)}. Your cloud desktop is then kept for 7 days and deleted, and your bots only run while your Mac is awake.</p>
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
      <button type="button" className="hover-link mt-3 h-9 text-13 text-ink-3 underline decoration-line-2 underline-offset-4" onClick={() => void openPortal()}>Manage billing details instead</button>
    </Modal>
  );
}

export function BillingPage() {
  const { catalog, billing, checkout, changePlan } = useCloud();
  const { toast } = useSession();
  const { query } = useLocation();
  const [interval, setIv] = useInterval();
  const [sheet, setSheet] = useState<Selection | null>(null);
  const [busy, setBusy] = useState<BundleId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<Bundle | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const sub = billing?.subscription ?? null;
  const region = catalog?.regions[0]?.id ?? "";

  // older links like /billing?bundle=pro open the sheet with that plan in it
  const want = query.get("bundle");
  useEffect(() => {
    if (!catalog || billing === null || !want) return;
    const b = bundleOf(catalog, want);
    if (b) setSheet(selectionFor(b, catalog, interval, region));
    navigate("/billing", { replace: true });
  }, [catalog, billing, want]);

  if (!catalog || billing === null) {
    return (
      <div aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-56" />
        <div className="mt-10 grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[380px] !rounded-card" />)}</div>
      </div>
    );
  }

  const current: BundleId | null = sub ? sub.bundle : "free";
  const bundles = SHOWN.map((id) => bundleOf(catalog, id)).filter((b): b is Bundle => Boolean(b));
  const starter = bundleOf(catalog, "starter");

  const choose = async (b: Bundle) => {
    if (b.id === "free") { if (sub) setCancelling(true); return; }
    if (sub) { setSwitching(b); return; }
    setBusy(b.id); setError(null);
    try {
      if (await checkout({ kind: "plan", selection: selectionFor(b, catalog, interval, region), bundle: b.id })) {
        toast("Paid. Your cloud desktop is being set up.");
        navigate("/cloud");
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const confirmSwitch = async () => {
    if (!switching) return;
    setBusy(switching.id); setError(null);
    try { await changePlan(selectionFor(switching, catalog, interval, sub?.selection.region ?? region)); toast(`Switched to ${switching.name}`); setSwitching(null); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const customize = () => setSheet(sub ? { ...sub.selection } : selectionFor(bundleOf(catalog, "pro") ?? bundles[0]!, catalog, interval, region));

  return (
    <div>
      <PageHeader title="Plans & billing" sub="Personal use is free. Work needs a license." action={<IntervalToggle value={interval} onChange={setIv} discount={catalog.yearlyDiscount} />} />
      <div className="grid gap-4 md:grid-cols-3">
        {bundles.map((b) => <PlanCard key={b.id} b={b} catalog={catalog} interval={interval} current={current === b.id} busy={busy === b.id} onChoose={() => void choose(b)} />)}
      </div>
      {error && !switching && <p role="alert" className="mt-4 text-13 text-bad">{error}</p>}
      <p className="mt-5 flex flex-wrap items-center gap-x-2 text-14 text-ink-3">
        {starter && current !== "starter" && <>Need less? <button type="button" className={quiet} onClick={() => void choose(starter)} disabled={busy !== null}>Starter is {money(perMonth(starter.monthly, interval, catalog))}/mo</button><span aria-hidden className="text-ink-4">·</span></>}
        <button type="button" className={quiet} onClick={customize}>Customize</button>
      </p>

      <Account catalog={catalog} onCancel={() => setCancelling(true)} />

      {sheet && <CustomizeSheet catalog={catalog} initial={{ ...sheet, interval: sheet.interval }} subscribed={Boolean(sub)} onClose={() => setSheet(null)} />}
      <CancelDialog open={cancelling} onClose={() => setCancelling(false)} catalog={catalog} />
      <Modal
        open={switching !== null}
        onClose={() => { if (!busy) { setSwitching(null); setError(null); } }}
        title={`Switch to ${switching?.name ?? ""}?`}
        footer={<><Button onClick={() => setSwitching(null)} disabled={busy !== null}>Not now</Button><Button variant="primary" onClick={() => void confirmSwitch()} disabled={busy !== null}>{busy ? "Switching" : "Switch"}</Button></>}
      >
        {switching && <p className="num">{money(perMonth(switching.monthly, interval, catalog))}/mo, {billed(interval)}. It starts today, and the difference is prorated.</p>}
        {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
      </Modal>
    </div>
  );
}
