import { useEffect, useState, type ReactNode } from "react";
import { Check, Download, Minus, Plus } from "lucide-react";
import { useCloud } from "../data/cloud";
import type { BillingInterval, DesktopId, DesktopTier, LicenseId, MachineSpec, PlanCatalog, Selection } from "../data/contracts";
import { botsLine, bundleOf, desktopMonthly, desktopOf, dollars, gb, licenseMonthly, licenseOf, perMonthOn, specLine } from "../data/pricing";
import { useCart } from "../data/quote";
import { useSession } from "../data/session";
import { longDate, shortDate, usd } from "../lib/format";
import { navigate, useLocation } from "../lib/router";
import { Choice, Field, Modal, Select, Sheet, Slider, Toggle } from "../ui/controls";
import { Badge, Button, cx, PageHeader, Skeleton } from "../ui/kit";
import { SectionHead } from "../ui/table";
import { regionName } from "./cloud-bits";
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
const billed = (interval: BillingInterval) => (interval === "year" ? "billed yearly" : "billed monthly");
const members = (n: number) => `${n} ${n === 1 ? "member" : "members"}`;
type DeskId = Exclude<DesktopId, "none">;

/** what each size is for, in one sentence and three points */
function pitch(d: DesktopTier): { line: string; points: string[] } {
  if (d.sizable) return { line: "A whole machine of your own, sized to fit.", points: [`From ${specLine(d)}`, botsLine(d.botComputers), "Size it up any time"] };
  if (d.priority) return { line: "Room for serious bots, and they wake first.", points: [specLine(d), botsLine(d.botComputers), "Priority wake"] };
  return { line: "Small and always on, for a bot or two.", points: [specLine(d), botsLine(d.botComputers), "On 24/7, in its own sandbox"] };
}

function DesktopCard({ d, catalog, interval, current, lead, onChoose }: { d: DesktopTier; catalog: PlanCatalog; interval: BillingInterval; current: boolean; lead: boolean; onChoose(): void }) {
  const { line, points } = pitch(d);
  return (
    <article className={cx("enter flex min-w-0 flex-col rounded-card bg-card p-6 max-sm:p-5", lead && "ring-1 ring-line-2")} aria-labelledby={`desk-${d.id}`}>
      <div className="flex h-[22px] items-center justify-between gap-2">
        <h2 id={`desk-${d.id}`} className="text-15 font-medium text-ink">{d.name}</h2>
        {current && <Badge>Current</Badge>}
      </div>
      <p className="mt-5 flex items-baseline gap-1">
        {d.sizable && <span className="text-14 text-ink-3">from</span>}
        <span className="num text-34 font-semibold tracking-[-0.03em] text-ink">{money(perMonthOn(desktopMonthly(d, null, catalog.custom), interval, catalog))}</span>
        <span className="text-14 text-ink-3">/mo</span>
      </p>
      <p className="text-13 text-ink-4">{billed(interval)}</p>
      <p className="mt-4 text-14 leading-[1.5] text-ink-2">{line}</p>
      <ul className="mt-5 flex flex-1 flex-col gap-2.5">
        {points.map((p) => <li key={p} className="flex gap-2.5 text-14 leading-[1.4] text-ink-3"><Check size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-4" aria-hidden />{p}</li>)}
      </ul>
      <Button variant={lead ? "primary" : "outline"} className="mt-7 w-full" onClick={onChoose} disabled={current}>{current ? "Current" : `Choose ${d.name}`}</Button>
    </article>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange(v: number): void }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      <span className="text-14 text-ink-2" id="members-label">Members</span>
      <div className="flex items-center gap-1" role="group" aria-labelledby="members-label">
        <button type="button" aria-label="One member fewer" disabled={value <= min} onClick={() => onChange(value - 1)} className="press hover-outline grid size-9 place-items-center rounded-full bg-card-2 text-ink-2 disabled:opacity-40 max-sm:size-11"><Minus size={15} strokeWidth={1.5} /></button>
        <output className="num w-9 text-center text-15 font-medium text-ink" aria-live="polite">{value}</output>
        <button type="button" aria-label="One member more" disabled={value >= max} onClick={() => onChange(value + 1)} className="press hover-outline grid size-9 place-items-center rounded-full bg-card-2 text-ink-2 disabled:opacity-40 max-sm:size-11"><Plus size={15} strokeWidth={1.5} /></button>
      </div>
    </div>
  );
}

/** the sheet's footer: what it costs, the yearly discount, and the one button */
function Total({ selection, catalog, label, disabled, onGo, error, note }: { selection: Selection; catalog: PlanCatalog; label: string; disabled: boolean; onGo(): void; error: string | null; note?: string }) {
  const { cart, ready, error: quoteError } = useCart(selection, catalog);
  return (
    <div>
      {cart && cart.lines.length > 0 && (
        <dl className="mb-3 text-13">
          {cart.lines.map((l) => <div key={l.key} className="flex justify-between gap-4 py-0.5"><dt className="min-w-0 truncate text-ink-3">{l.label}, {l.detail}</dt><dd className="num shrink-0 text-ink-2">{money(l.monthly)}</dd></div>)}
          {cart.discount > 0 && <div className="flex justify-between gap-4 py-0.5"><dt className="text-ink-3">Yearly discount ({Math.round(catalog.yearlyDiscount * 100)}%)</dt><dd className="num text-ink-2">-{money(cart.discount)}</dd></div>}
        </dl>
      )}
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-14 text-ink-3">Total</span>
        <span className="num"><span className="text-24 font-semibold tracking-[-0.02em] text-ink">{cart ? money(cart.perMonth) : "..."}</span><span className="text-14 text-ink-3">/mo</span></span>
      </div>
      <p className="num mt-0.5 text-end text-13 text-ink-4">{cart?.free ? "Nothing to pay" : selection.interval === "year" && cart ? `${money(cart.dueNow)} billed yearly` : "Billed monthly"}</p>
      {note && <p className="mt-2 text-13 text-ink-4">{note}</p>}
      {(error ?? quoteError) && <p role="alert" className="mt-3 text-13 text-bad">{error ?? quoteError}</p>}
      <Button variant="primary" className="mt-4 w-full !h-11" onClick={onGo} disabled={disabled || !ready}>{label}</Button>
    </div>
  );
}

/** buy or change through one sheet; a running plan is changed, otherwise it opens checkout */
function useSave(onClose: () => void, onNothingLeft: () => void) {
  const { billing, checkout, changePlan } = useCloud();
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = billing?.subscription ?? null;
  const save = async (sel: Selection, done: string) => {
    if (sel.license === "personal" && sel.desktop === "none") { onClose(); onNothingLeft(); return; }
    setBusy(true); setError(null);
    try {
      if (sub) { await changePlan(sel); toast(done); onClose(); }
      else if (await checkout({ kind: "plan", selection: sel, bundle: null })) {
        toast(sel.desktop === "none" ? "License active. Thanks for backing OpenMausBot." : "Paid. Your cloud desktop is being set up.");
        onClose();
        if (sel.desktop !== "none") navigate("/cloud");
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return { sub, busy, error, save, setError };
}

function DesktopSheet({ catalog, start, onClose, onNothingLeft }: { catalog: PlanCatalog; start: Selection; onClose(): void; onNothingLeft(): void }) {
  const { sub, busy, error, save, setError } = useSave(onClose, onNothingLeft);
  const [sel, setSel] = useState(start);
  const set = (patch: Partial<Selection>) => { setSel((s) => ({ ...s, ...patch })); setError(null); };
  const d = desktopOf(catalog, sel.desktop);
  const c = catalog.custom;
  const size: MachineSpec | null = d ? sel.size ?? { vcpu: d.vcpu, ramGb: d.ramGb, diskGb: d.diskGb } : null;
  const owned = sub?.selection ?? null;
  const ownsLicense = Boolean(owned && owned.license !== "personal");
  const starter = licenseOf(catalog, "starter");
  const unchanged = owned !== null && JSON.stringify(owned) === JSON.stringify(sel);
  return (
    <Sheet
      open
      onClose={onClose}
      title={owned && owned.desktop !== "none" ? `Switch to ${d?.name ?? "this size"}` : `Get ${d?.name ?? "a cloud desktop"}`}
      footer={<Total selection={sel} catalog={catalog} label={busy ? (owned ? "Updating" : "Opening checkout") : owned ? "Update plan" : "Checkout"} disabled={busy || unchanged} onGo={() => void save(sel, `${d?.name ?? "Cloud desktop"} is on your plan`)} error={error} note={owned ? "It starts today, and the difference is prorated." : undefined} />}
    >
      <div className="mt-2"><IntervalToggle value={sel.interval} onChange={(interval) => set({ interval })} discount={catalog.yearlyDiscount} /></div>
      <fieldset className="mt-7 min-w-0">
        <legend className="mb-2 text-13 text-ink-3">Size</legend>
        <div className="flex flex-col gap-1">
          {catalog.desktops.map((x) => <Choice key={x.id} name="sheet-desktop" value={x.id} checked={sel.desktop === x.id} onChange={() => set({ desktop: x.id, size: null })} title={x.name} detail={`${botsLine(x.botComputers)} · ${specLine(x)}`} aside={<>{money(perMonthOn(desktopMonthly(x, null, c), sel.interval, catalog))}<span className="text-ink-3">/mo</span></>} />)}
        </div>
      </fieldset>
      {d?.sizable && size && (
        <div className="mt-5 flex flex-col gap-5 px-3">
          <Slider label="vCPU" value={size.vcpu} min={Math.max(c.vcpu.min, d.vcpu)} max={c.vcpu.max} step={c.vcpu.step} format={(v) => `${v}`} onChange={(vcpu) => set({ size: { ...size, vcpu } })} />
          <Slider label="Memory" value={size.ramGb} min={Math.max(c.ramGb.min, d.ramGb)} max={c.ramGb.max} step={c.ramGb.step} format={gb} onChange={(ramGb) => set({ size: { ...size, ramGb } })} />
          <Slider label="Disk" value={size.diskGb} min={Math.max(c.diskGb.min, d.diskGb)} max={c.diskGb.max} step={c.diskGb.step} format={gb} onChange={(diskGb) => set({ size: { ...size, diskGb } })} />
        </div>
      )}
      <div className="mt-7">
        <Field label="Region" htmlFor="sheet-region">
          <Select id="sheet-region" value={sel.region} onChange={(e) => set({ region: e.target.value })}>
            {catalog.regions.map((r) => <option key={r.id} value={r.id}>{r.city}, {r.name}</option>)}
          </Select>
        </Field>
      </div>
      {!ownsLicense && starter && (
        <label className="hover-row mt-5 flex min-h-14 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5">
          <input type="checkbox" checked={sel.license !== "personal"} onChange={(e) => set({ license: e.target.checked ? "starter" : "personal", members: 1 })} className="size-4 shrink-0 accent-[var(--ink)]" />
          <span className="min-w-0 flex-1">
            <span className="block text-14 text-ink">Add a work license</span>
            <span className="block truncate text-13 text-ink-3">Starter, one member, for work</span>
          </span>
          <span className="num shrink-0 text-14 text-ink-2">+{money(perMonthOn(starter.monthly, sel.interval, catalog))}<span className="text-ink-3">/mo</span></span>
        </label>
      )}
    </Sheet>
  );
}

function LicenseSheet({ catalog, start, onClose, onNothingLeft }: { catalog: PlanCatalog; start: Selection; onClose(): void; onNothingLeft(): void }) {
  const { sub, busy, error, save, setError } = useSave(onClose, onNothingLeft);
  const [sel, setSel] = useState(start);
  const set = (patch: Partial<Selection>) => { setSel((s) => ({ ...s, ...patch })); setError(null); };
  const owned = sub?.selection ?? null;
  const lic = licenseOf(catalog, sel.license);
  const unchanged = owned ? JSON.stringify(owned) === JSON.stringify(sel) : sel.license === "personal";
  const label = busy ? (owned ? "Updating" : "Opening checkout") : owned ? (sel.license === "personal" ? "Remove license" : "Update license") : sel.license === "personal" ? "Personal use is free" : `Buy ${lic?.name} license`;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Work license"
      footer={<Total selection={owned ? sel : { ...sel, desktop: "none", size: null }} catalog={catalog} label={label} disabled={busy || unchanged} onGo={() => void save(sel, sel.license === "personal" ? "License removed" : "License updated")} error={error} note={owned ? "Changes start today, prorated." : undefined} />}
    >
      <p className="text-14 leading-[1.55] text-ink-3">Personal and noncommercial use is free. Using it at work needs a license.{catalog.workFreeUntil && catalog.workFreeUntil > Date.now() ? ` Work use is free until ${longDate(catalog.workFreeUntil)}.` : ""}</p>
      <div className="mt-5"><IntervalToggle value={sel.interval} onChange={(interval) => set({ interval })} discount={catalog.yearlyDiscount} /></div>
      <fieldset className="mt-6 min-w-0">
        <legend className="sr-only">License</legend>
        <div className="flex flex-col gap-1">
          {catalog.licenses.map((l) => (
            <Choice
              key={l.id}
              name="sheet-license"
              value={l.id}
              checked={sel.license === l.id}
              onChange={() => set({ license: l.id as LicenseId, members: l.perExtraMember ? Math.max(l.includedMembers, sel.members) : l.includedMembers })}
              title={l.work ? l.name : "Personal"}
              detail={!l.work ? "Personal and noncommercial use" : l.perExtraMember ? `${l.includedMembers} members, +${money(perMonthOn(l.perExtraMember, sel.interval, catalog))} each more` : "One member, for work"}
              aside={l.monthly === 0 ? "$0" : <>{money(perMonthOn(l.id === sel.license ? licenseMonthly(l, sel.members) : l.monthly, sel.interval, catalog))}<span className="text-ink-3">/mo</span></>}
            />
          ))}
        </div>
        {lic && lic.perExtraMember > 0 && <Stepper value={sel.members} min={lic.includedMembers} max={lic.maxMembers} onChange={(n) => set({ members: n })} />}
      </fieldset>
    </Sheet>
  );
}

/** the license in one row: what it is, what it costs, and one quiet button */
function LicenseRow({ catalog, interval, onOpen }: { catalog: PlanCatalog; interval: BillingInterval; onOpen(): void }) {
  const { billing } = useCloud();
  const owned = billing?.subscription?.selection ?? null;
  const lic = owned ? licenseOf(catalog, owned.license) : null;
  const starter = licenseOf(catalog, "starter");
  const team = licenseOf(catalog, "team");
  const free = catalog.workFreeUntil && catalog.workFreeUntil > Date.now() ? catalog.workFreeUntil : null;
  const has = Boolean(lic?.work && owned);
  return (
    <section className="enter mt-4 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-card bg-card px-6 py-5 max-sm:p-5" style={{ ["--i" as string]: 3 }} aria-labelledby="license-title">
      <div className="min-w-0 flex-1 basis-[320px]">
        <h2 id="license-title" className="text-15 font-medium text-ink">License</h2>
        <p className="mt-1 text-14 text-ink-3">Free for personal use. For work: {starter ? <>Starter <span className="num">{money(perMonthOn(starter.monthly, interval, catalog))}/mo</span> per member</> : null}{team ? <>, Team <span className="num">{money(perMonthOn(team.monthly, interval, catalog))}/mo</span> with {team.includedMembers} members</> : null}.</p>
        {free && !has && <p className="mt-1 text-13 text-ink-4">Work use is free until {longDate(free)}.</p>}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <span className="num text-14 text-ink-2">{has && lic && owned ? <>{lic.name} license, {members(owned.members)}<span className="text-ink-3"> · {money(perMonthOn(licenseMonthly(lic, owned.members), owned.interval, catalog))}/mo</span></> : "Personal use"}</span>
        <Button size="sm" onClick={onOpen}>{has ? "Change" : "Add license"}</Button>
      </div>
    </section>
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

function Account({ catalog, onLicense, onRemoveDesktop }: { catalog: PlanCatalog; onLicense(): void; onRemoveDesktop(): void }) {
  const { billing, clouds, openPortal } = useCloud();
  const [buying, setBuying] = useState(false);
  const sub = billing?.subscription ?? null;
  const sel = sub?.selection ?? null;
  const { cart } = useCart(sel, catalog);
  const pm = billing?.paymentMethod;
  const invoices = billing?.invoices ?? [];
  const files = invoices.some((inv) => inv.url);
  const lic = sel ? licenseOf(catalog, sel.license) : null;
  const desk = sel && sel.desktop !== "none" ? desktopOf(catalog, sel.desktop) : null;
  const line = (key: string) => cart?.lines.find((l) => l.key === key) ?? null;
  const renews = sub ? (sub.cancelAt ? `Ends ${longDate(sub.cancelAt)}` : `Renews ${longDate(sub.currentPeriodEnd)}`) : null;
  const price = (key: string) => { const l = line(key); return l && sel ? `${money(perMonthOn(l.monthly, sel.interval, catalog))}/mo, ${billed(sel.interval)}` : null; };
  return (
    <>
      <section className="mt-16" aria-labelledby="billing-title">
        <SectionHead id="billing-title">Billing</SectionHead>
        <dl className="divide-y divide-line border-y border-line">
          <Row k="License" action={<button type="button" className={quiet} onClick={onLicense}>{lic?.work ? "Change" : "Add"}</button>}>
            {lic?.work && sel ? <><span className="block truncate">{lic.name} license<span className="text-ink-3">, {members(sel.members)}</span></span><span className="num block truncate text-13 text-ink-3">{[price("license"), renews].filter(Boolean).join(" · ")}</span></> : <span className="text-ink-3">Personal use, free</span>}
          </Row>
          <Row k="Cloud desktop" action={desk && sub && !sub.cancelAt ? <button type="button" className={quiet} onClick={onRemoveDesktop}>Cancel</button> : undefined}>
            {desk && sel ? <><span className="block truncate">{desk.name}<span className="text-ink-3">{clouds?.[0] ? `, ${clouds[0].name}` : ""}, {regionName(catalog, sel.region)}</span></span><span className="num block truncate text-13 text-ink-3">{[price("desktop"), renews].filter(Boolean).join(" · ")}</span></> : <span className="text-ink-3">None. Your bots run while your Mac is awake.</span>}
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

function CancelDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { billing, cancel, openPortal } = useCloud();
  const [reason, setReason] = useState<Parameters<ReturnType<typeof useCloud>["cancel"]>[0]>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = billing?.subscription;
  if (!sub) return null;
  const stop = async () => {
    setBusy(true); setError(null);
    try { await cancel(reason); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const desk = sub.selection.desktop !== "none";
  return (
    <Modal open={open} onClose={onClose} title="Cancel your plan?" footer={<><Button onClick={onClose}>Keep it</Button><Button variant="danger" onClick={() => void stop()} disabled={busy}>{busy ? "Cancelling" : "Cancel plan"}</Button></>}>
      <p>It runs until {longDate(sub.currentPeriodEnd)}.{desk ? " Your cloud desktop is then kept for 7 days and deleted, and your bots only run while your Mac is awake." : " After that, work use is no longer covered. Personal use stays free."}</p>
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

/** drop the cloud desktop and keep the license: a plan change, not a cancel */
function RemoveDesktopDialog({ open, onClose, catalog }: { open: boolean; onClose(): void; catalog: PlanCatalog }) {
  const { billing, changePlan } = useCloud();
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owned = billing?.subscription?.selection;
  if (!owned) return null;
  const lic = licenseOf(catalog, owned.license);
  const go = async () => {
    setBusy(true); setError(null);
    try { await changePlan({ ...owned, desktop: "none", size: null }); toast("Your cloud desktop ends with this period"); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Cancel your cloud desktop?" footer={<><Button onClick={onClose}>Keep it</Button><Button variant="danger" onClick={() => void go()} disabled={busy}>{busy ? "Cancelling" : "Cancel cloud desktop"}</Button></>}>
      <p>It is kept, stopped, for 7 days and then deleted. Your {lic?.name ?? ""} license stays.</p>
      {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
    </Modal>
  );
}

export function BillingPage() {
  const { catalog, billing } = useCloud();
  const { query } = useLocation();
  const [interval, setIv] = useInterval();
  const [desktopSheet, setDesktopSheet] = useState<Selection | null>(null);
  const [licenseSheet, setLicenseSheet] = useState<Selection | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const owned = billing?.subscription?.selection ?? null;
  const region0 = catalog?.regions[0]?.id ?? "";

  // a running plan shows its own billing period
  useEffect(() => { if (owned) setIv(owned.interval); }, [owned?.interval]);

  const openDesktop = (id: DeskId) => setDesktopSheet(owned ? { ...owned, desktop: id, size: null, region: owned.desktop !== "none" ? owned.region : region0, interval } : { license: "personal", members: 1, desktop: id, size: null, region: region0, interval });
  const openLicense = (id?: LicenseId, n?: number) => {
    const base: Selection = owned ? { ...owned, interval } : { license: "personal", members: 1, desktop: "none", size: null, region: region0, interval };
    const lic = id ? licenseOf(catalog!, id) : null;
    setLicenseSheet(id ? { ...base, license: id, members: Math.max(n ?? 1, lic?.includedMembers ?? 1) } : base.license === "personal" ? { ...base, license: "starter", members: 1 } : base);
  };

  // older links like /billing?bundle=pro open the matching sheet
  const want = query.get("bundle");
  useEffect(() => {
    if (!catalog || billing === null || !want) return;
    const b = bundleOf(catalog, want);
    navigate("/billing", { replace: true });
    if (!b) return;
    if (b.desktop !== "none") openDesktop(b.desktop);
    else if (b.license !== "personal") openLicense(b.license, b.members);
  }, [catalog, billing, want]);

  if (!catalog || billing === null) {
    return (
      <div aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-56" />
        <div className="mt-10 grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[380px] !rounded-card" />)}</div>
      </div>
    );
  }

  const ownDesk = owned?.desktop ?? "none";
  const lead = ownDesk === "shared-m" ? null : "shared-m";
  const removeDesktop = () => (owned && owned.license !== "personal" ? setRemoving(true) : setCancelling(true));

  return (
    <div>
      <PageHeader title="Plans & billing" sub="A cloud desktop keeps your bots on 24/7. Personal use is free." action={<IntervalToggle value={interval} onChange={setIv} discount={catalog.yearlyDiscount} />} />
      <div className="grid gap-4 md:grid-cols-3">
        {catalog.desktops.map((d) => <DesktopCard key={d.id} d={d} catalog={catalog} interval={interval} current={ownDesk === d.id} lead={d.id === lead} onChoose={() => openDesktop(d.id)} />)}
      </div>
      <LicenseRow catalog={catalog} interval={interval} onOpen={() => openLicense()} />

      <Account catalog={catalog} onLicense={() => openLicense()} onRemoveDesktop={removeDesktop} />

      {desktopSheet && <DesktopSheet catalog={catalog} start={desktopSheet} onClose={() => setDesktopSheet(null)} onNothingLeft={() => setCancelling(true)} />}
      {licenseSheet && <LicenseSheet catalog={catalog} start={licenseSheet} onClose={() => setLicenseSheet(null)} onNothingLeft={() => setCancelling(true)} />}
      <CancelDialog open={cancelling} onClose={() => setCancelling(false)} />
      <RemoveDesktopDialog open={removing} onClose={() => setRemoving(false)} catalog={catalog} />
    </div>
  );
}
