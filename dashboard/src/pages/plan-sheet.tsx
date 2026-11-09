import { useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { useCloud } from "../data/cloud";
import type { BillingInterval, BundleId, CheckoutSource, LicenseId, PlanCatalog, Selection } from "../data/contracts";
import { botsLine, bundleOf, desktopOf, dollars, licenseMonthly, licenseOf, perMonthOn, yearlyPerk } from "../data/pricing";
import { useCart } from "../data/quote";
import { useSession } from "../data/session";
import { longDate } from "../lib/format";
import { navigate } from "../lib/router";
import { Choice, Field, Select, Sheet, Toggle } from "../ui/controls";
import { Button, Skeleton } from "../ui/kit";

export const money = (n: number) => dollars(n, !Number.isInteger(Math.round(n * 100) / 100));

/** a monthly list price on the chosen period: per month, or the whole year (two months free reads as $200, not $16.67) */
export const per = (monthly: number, interval: BillingInterval, c: Pick<PlanCatalog, "yearlyDiscount">) => (interval === "year" ? { amount: money(perMonthOn(monthly, interval, c) * 12), unit: "/yr" } : { amount: money(monthly), unit: "/mo" });
export const priceText = (monthly: number, interval: BillingInterval, c: Pick<PlanCatalog, "yearlyDiscount">) => { const p = per(monthly, interval, c); return `${p.amount}${p.unit}`; };

/** what a cart charges per period, as one line */
export const cartText = (cart: { perMonth: number; dueNow: number }, interval: BillingInterval) => (interval === "year" ? `${money(cart.dueNow)}/yr` : `${money(cart.perMonth)}/mo`);

const INTERVAL_KEY = "omb-dash-interval";
/** Plus and Pro are shared desktops: only the pool regions can take them. */
function sharedRegions(catalog: PlanCatalog) {
  return catalog.poolRegions ? catalog.regions.filter((r) => catalog.poolRegions!.includes(r.id)) : catalog.regions;
}

export function useInterval(): [BillingInterval, (v: BillingInterval) => void] {
  const [v, set] = useState<BillingInterval>(() => (sessionStorage.getItem(INTERVAL_KEY) === "month" ? "month" : "year"));
  return [v, (next) => { sessionStorage.setItem(INTERVAL_KEY, next); set(next); }];
}

export function IntervalToggle({ value, onChange, catalog }: { value: BillingInterval; onChange(v: BillingInterval): void; catalog: PlanCatalog }) {
  return (
    <Toggle<BillingInterval>
      label="Billing period"
      value={value}
      onChange={onChange}
      options={[
        { value: "month", label: "Monthly" },
        { value: "year", label: <>Yearly <span className="text-ink-4">{yearlyPerk(catalog)}</span></> },
      ]}
    />
  );
}

/** the paid plans a sheet can sell: plus is the starter bundle */
export type PaidPlan = Extract<BundleId, "starter" | "pro">;

/** a plan's full selection; plus can carry a work license, pro always has one */
export function planSelection(catalog: PlanCatalog, plan: PaidPlan, opts: { interval: BillingInterval; region?: string; work: boolean; keep?: Selection | null }): Selection {
  const b = bundleOf(catalog, plan)!;
  const keepLicense = opts.keep && opts.keep.license !== "personal" ? opts.keep : null;
  const license: LicenseId = keepLicense ? keepLicense.license : b.license !== "personal" ? b.license : opts.work ? "starter" : "personal";
  return { license, members: keepLicense?.members ?? 1, desktop: b.desktop, size: null, region: opts.region ?? catalog.regions[0]?.id ?? "", interval: opts.interval };
}

/** one place to buy plus or pro: the plan, the billing period, the region and an optional work license */
export function PlanSheet({ start, source, work = false, onClose }: { source: CheckoutSource; start: PaidPlan; work?: boolean; onClose(): void }) {
  const { catalog, billing, checkout, changePlan } = useCloud();
  const { toast } = useSession();
  const owned = billing?.subscription?.selection ?? null;
  const [interval, setInterval] = useState<BillingInterval>(owned?.interval ?? (sessionStorage.getItem(INTERVAL_KEY) === "month" ? "month" : "year"));
  const [plan, setPlan] = useState<PaidPlan>(start);
  const [withLicense, setWithLicense] = useState(work);
  const regions = catalog ? sharedRegions(catalog) : [];
  const [region, setRegion] = useState(owned && owned.desktop !== "none" && regions.some((r) => r.id === owned.region) ? owned.region : regions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sel = catalog ? planSelection(catalog, plan, { interval, region, work: withLicense, keep: owned }) : null;
  const { cart, ready, error: quoteError } = useCart(sel, catalog);
  if (!catalog || !sel) return <Sheet open onClose={onClose} title="Get a cloud desktop"><Skeleton className="mt-4 h-40" /></Sheet>;
  const b = bundleOf(catalog, plan);
  const ownsLicense = Boolean(owned && owned.license !== "personal");
  const work1 = licenseOf(catalog, "starter");
  const unchanged = owned !== null && JSON.stringify(owned) === JSON.stringify(sel);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      if (owned) { await changePlan(sel); toast(`You are on ${b?.name}`); onClose(); }
      else if (await checkout({ source, kind: "plan", selection: sel, bundle: null })) { toast("Paid. Your cloud desktop is being set up."); onClose(); navigate("/cloud"); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const line = (id: PaidPlan): ReactNode => {
    const x = bundleOf(catalog, id);
    const d = x ? desktopOf(catalog, x.desktop) : null;
    return d ? `${botsLine(d.botComputers)}${d.priority ? ", priority wake" : ""}${x?.license !== "personal" ? ", work license" : ""}` : "";
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={owned ? `Switch to ${b?.name}` : `Get ${b?.name}`}
      footer={
        <div>
          {cart && cart.discount > 0 && <p className="num flex justify-between text-13 text-ink-3"><span>Two months free</span><span>-{money(cart.discount * 12)}</span></p>}
          <div className="mt-1 flex items-baseline justify-between gap-4">
            <span className="text-14 text-ink-3">Total</span>
            <span className="num"><span className="text-24 font-semibold tracking-[-0.02em] text-ink">{cart ? money(interval === "year" ? cart.dueNow : cart.perMonth) : "..."}</span><span className="text-14 text-ink-3">{interval === "year" ? "/yr" : "/mo"}</span></span>
          </div>
          <p className="num mt-0.5 text-end text-13 text-ink-4">{interval === "year" ? "Billed yearly" : "Billed monthly"}{owned ? ", prorated from today" : ""}</p>
          {(error ?? quoteError) && <p role="alert" className="mt-3 text-13 text-bad">{error ?? quoteError}</p>}
          <Button variant="primary" className="mt-4 w-full !h-11" onClick={() => void go()} disabled={busy || !ready || unchanged}>{busy ? (owned ? "Switching" : "Opening checkout") : unchanged ? "Your plan" : owned ? "Switch plan" : "Checkout"}</Button>
          <p className="mt-3 text-center text-12 text-ink-4">Cancel anytime. Set up in about a minute.</p>
        </div>
      }
    >
      <div className="mt-2"><IntervalToggle value={interval} onChange={setInterval} catalog={catalog} /></div>
      <fieldset className="mt-6 min-w-0">
        <legend className="mb-2 text-13 text-ink-3">Plan</legend>
        <div className="flex flex-col gap-1">
          {(["starter", "pro"] as const).map((id) => {
            const x = bundleOf(catalog, id);
            if (!x) return null;
            return <Choice key={id} name="plan" value={id} checked={plan === id} onChange={() => setPlan(id)} title={x.name} detail={line(id)} aside={<>{per(x.monthly, interval, catalog).amount}<span className="text-ink-3">{per(x.monthly, interval, catalog).unit}</span></>} />;
          })}
        </div>
      </fieldset>
      {plan === "starter" && !ownsLicense && work1 && (
        <label className="hover-row mt-3 flex min-h-14 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5">
          <input type="checkbox" checked={withLicense} onChange={(e) => setWithLicense(e.target.checked)} className="size-4 shrink-0 accent-[var(--ink)]" />
          <span className="min-w-0 flex-1">
            <span className="block text-14 text-ink">Add a work license</span>
            <span className="block truncate text-13 text-ink-3">To use it at work, one person</span>
          </span>
          <span className="num shrink-0 text-14 text-ink-2">+{priceText(work1.monthly, interval, catalog)}</span>
        </label>
      )}
      <div className="mt-6">
        <Field label="Region" htmlFor="plan-region" hint="Pick the one closest to you. You can move it later.">
          <Select id="plan-region" value={region} onChange={(e) => setRegion(e.target.value)}>
            {regions.map((r) => <option key={r.id} value={r.id}>{r.city}, {r.name}</option>)}
          </Select>
        </Field>
      </div>
    </Sheet>
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

/** the work license on its own: personal, one person, or a team with seats */
export function LicenseSheet({ start, source, onClose, onNothingLeft }: { source: CheckoutSource; start: { license: LicenseId; members: number }; onClose(): void; onNothingLeft(): void }) {
  const { catalog, billing, checkout, changePlan } = useCloud();
  const { toast } = useSession();
  const owned = billing?.subscription?.selection ?? null;
  const [sel, setSel] = useState<Selection>(() => ({ ...(owned ?? { desktop: "none", size: null, region: catalog?.regions[0]?.id ?? "" }), license: start.license, members: start.members, interval: owned?.interval ?? "year" }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { cart, ready, error: quoteError } = useCart(sel, catalog);
  if (!catalog) return null;
  const set = (patch: Partial<Selection>) => { setSel((s) => ({ ...s, ...patch })); setError(null); };
  const lic = licenseOf(catalog, sel.license);
  const unchanged = owned ? JSON.stringify(owned) === JSON.stringify(sel) : sel.license === "personal";
  const go = async () => {
    if (sel.license === "personal" && sel.desktop === "none") { onClose(); onNothingLeft(); return; }
    setBusy(true); setError(null);
    try {
      if (owned) { await changePlan(sel); toast(sel.license === "personal" ? "License removed" : "License updated"); onClose(); }
      else if (await checkout({ source, kind: "plan", selection: sel, bundle: null })) { toast("License active. Thanks for backing OpenMausBot."); onClose(); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const free = catalog.workFreeUntil && catalog.workFreeUntil > Date.now() ? catalog.workFreeUntil : null;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Work license"
      footer={
        <div>
          {cart && cart.discount > 0 && <p className="num flex justify-between text-13 text-ink-3"><span>Two months free</span><span>-{money(cart.discount * 12)}</span></p>}
          <div className="mt-1 flex items-baseline justify-between gap-4">
            <span className="text-14 text-ink-3">{owned ? "Your plan in total" : "Total"}</span>
            <span className="num"><span className="text-24 font-semibold tracking-[-0.02em] text-ink">{cart ? money(sel.interval === "year" ? cart.dueNow : cart.perMonth) : "..."}</span><span className="text-14 text-ink-3">{sel.interval === "year" ? "/yr" : "/mo"}</span></span>
          </div>
          <p className="num mt-0.5 text-end text-13 text-ink-4">{cart?.free ? "Nothing to pay" : sel.interval === "year" ? "Billed yearly" : "Billed monthly"}</p>
          {(error ?? quoteError) && <p role="alert" className="mt-3 text-13 text-bad">{error ?? quoteError}</p>}
          <Button variant="primary" className="mt-4 w-full !h-11" onClick={() => void go()} disabled={busy || !ready || unchanged}>{busy ? (owned ? "Updating" : "Opening checkout") : owned ? (sel.license === "personal" ? "Remove license" : "Update license") : sel.license === "personal" ? "Personal use is free" : `Buy ${lic?.name} license`}</Button>
        </div>
      }
    >
      <p className="text-14 leading-[1.55] text-ink-3">Personal use is free forever. Using it at work needs a license.{free ? ` Work use is free until ${longDate(free)}.` : ""}</p>
      <div className="mt-5"><IntervalToggle value={sel.interval} onChange={(interval) => set({ interval })} catalog={catalog} /></div>
      <fieldset className="mt-6 min-w-0">
        <legend className="sr-only">License</legend>
        <div className="flex flex-col gap-1">
          {catalog.licenses.map((l) => (
            <Choice
              key={l.id}
              name="sheet-license"
              value={l.id}
              checked={sel.license === l.id}
              onChange={() => set({ license: l.id, members: l.perExtraMember ? Math.max(l.includedMembers, sel.members) : l.includedMembers })}
              title={l.work ? l.name : "Personal"}
              detail={!l.work ? "Personal and noncommercial use" : l.perExtraMember ? `${l.includedMembers} members, +${priceText(l.perExtraMember, sel.interval, catalog)} each more` : "One person, for work"}
              aside={l.monthly === 0 ? "$0" : priceText(l.id === sel.license ? licenseMonthly(l, sel.members) : l.monthly, sel.interval, catalog)}
            />
          ))}
        </div>
        {lic && lic.perExtraMember > 0 && <Stepper value={sel.members} min={lic.includedMembers} max={lic.maxMembers} onChange={(n) => set({ members: n })} />}
      </fieldset>
    </Sheet>
  );
}
