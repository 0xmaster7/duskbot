import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, Minus, Plus } from "lucide-react";
import { useCloud } from "../data/cloud";
import type { BillingInterval, DesktopId, DesktopTier, LicenseId, LicenseTier, MachineSpec, PlanCatalog, Selection } from "../data/contracts";
import { botsLine, bundleOf, desktopMonthly, desktopOf, desktopOnly, dollars, gb, licenseOf, licenseOnly, perMonthOn, specLine } from "../data/pricing";
import { useCart } from "../data/quote";
import { useSession } from "../data/session";
import { longDate, shortDate, usd } from "../lib/format";
import { navigate, scrollToHash, useLocation } from "../lib/router";
import { Field, Modal, Select, Slider, Toggle } from "../ui/controls";
import { Badge, Button, cx, PageHeader, Skeleton } from "../ui/kit";
import { SectionHead } from "../ui/table";
import { CloudPitch, regionName } from "./cloud-bits";
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
const same = (a: Selection | null | undefined, b: Selection) => Boolean(a) && JSON.stringify(a) === JSON.stringify(b);

/** one choice tile: a radio over the whole tile, its price, a line under it, and room for a control */
function Option({ name, value, checked, onChange, title, price, sub, current, children }: { name: string; value: string; checked: boolean; onChange(): void; title: string; price: ReactNode; sub: ReactNode; current?: boolean; children?: ReactNode }) {
  const id = `${name}-${value}`;
  return (
    <div className={cx("flex min-w-0 flex-col rounded-card bg-card has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ink-3", checked ? "ring-1 ring-ink-4" : "hover-tile")}>
      <label htmlFor={id} className="flex flex-1 cursor-pointer flex-col p-5">
        <input id={id} type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
        <span className="flex min-h-[22px] items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className={cx("size-4 shrink-0 rounded-full border", checked ? "border-[5px] border-ink" : "border-ink-4")} />
            <span className="truncate text-15 font-medium text-ink">{title}</span>
          </span>
          {current && <Badge>Current</Badge>}
        </span>
        <span className="num mt-4 block">{price}</span>
        <span className="mt-1 block text-13 leading-[1.45] text-ink-3">{sub}</span>
      </label>
      {children}
    </div>
  );
}

function PriceTag({ monthly, interval, catalog }: { monthly: number; interval: BillingInterval; catalog: PlanCatalog }) {
  if (monthly === 0) return <span className="text-28 font-semibold tracking-[-0.025em] text-ink">$0</span>;
  return (
    <>
      <span className="text-28 font-semibold tracking-[-0.025em] text-ink">{money(perMonthOn(monthly, interval, catalog))}</span>
      <span className="text-14 text-ink-3">/mo</span>
      {interval === "year" && <span className="ms-2 text-13 text-ink-4">{money(monthly)} monthly</span>}
    </>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange(v: number): void }) {
  return (
    <div className="mx-5 mb-4 flex items-center justify-between gap-3 border-t border-line pt-3" role="group" aria-label="Members">
      <button type="button" aria-label="One member fewer" disabled={value <= min} onClick={() => onChange(value - 1)} className="press hover-outline grid size-9 place-items-center rounded-full bg-card-2 text-ink-2 disabled:opacity-40 max-sm:size-11"><Minus size={15} strokeWidth={1.5} /></button>
      <output className="num text-14 text-ink" aria-live="polite">{members(value)}</output>
      <button type="button" aria-label="One member more" disabled={value >= max} onClick={() => onChange(value + 1)} className="press hover-outline grid size-9 place-items-center rounded-full bg-card-2 text-ink-2 disabled:opacity-40 max-sm:size-11"><Plus size={15} strokeWidth={1.5} /></button>
    </div>
  );
}

/** the summary under a product: its lines, the yearly discount, the total and its one button */
function Summary({ title, selection, catalog, empty, action, aside }: { title: string; selection: Selection; catalog: PlanCatalog; empty: ReactNode; action: ReactNode; aside?: ReactNode }) {
  const { cart, error } = useCart(selection, catalog);
  const lines = cart?.lines ?? [];
  const pct = Math.round(catalog.yearlyDiscount * 100);
  return (
    <div className="mt-4 grid gap-x-10 gap-y-5 rounded-card bg-card p-6 max-sm:p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div className="min-w-0">
        <h3 className="text-13 text-ink-3">{title}</h3>
        {lines.length ? (
          <dl className="mt-2 max-w-[440px] text-14">
            {lines.map((l) => (
              <div key={l.key} className="flex items-baseline justify-between gap-4 py-1">
                <dt className="min-w-0 truncate text-ink">{l.label}<span className="text-ink-3">, {l.detail}</span></dt>
                <dd className="num shrink-0 text-ink-2">{money(l.monthly)}</dd>
              </div>
            ))}
            {cart && cart.discount > 0 && (
              <div className="flex items-baseline justify-between gap-4 py-1">
                <dt className="text-ink-3">Yearly discount ({pct}%)</dt>
                <dd className="num text-ink-2">-{money(cart.discount)}</dd>
              </div>
            )}
          </dl>
        ) : <p className="mt-2 text-14 text-ink-2">{empty}</p>}
        {aside}
        {error && <p role="alert" className="mt-2 text-13 text-bad">{error}</p>}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:flex-col md:items-end">
        {lines.length > 0 && cart && (
          <p className="num md:text-end">
            <span className="text-24 font-semibold tracking-[-0.02em] text-ink">{money(cart.perMonth)}</span><span className="text-14 text-ink-3">/mo</span>
            <span className="block text-13 text-ink-4">{selection.interval === "year" ? `${money(cart.dueNow)} billed yearly` : "billed monthly"}</span>
          </p>
        )}
        {action}
      </div>
    </div>
  );
}

function licenseSub(l: LicenseTier, interval: BillingInterval, catalog: PlanCatalog) {
  if (!l.work) return "Personal and noncommercial use";
  if (l.perExtraMember > 0) return `${l.includedMembers} members included, +${money(perMonthOn(l.perExtraMember, interval, catalog))} for each more`;
  return `${members(l.includedMembers)}, to use it at work`;
}

const desktopSub = (d: DesktopTier) => `${botsLine(d.botComputers)}${d.priority ? ", priority wake" : ""}`;

type Change = { title: string; body: string; selection: Selection; verb: string; done: string };

export function BillingPage() {
  const { catalog, billing, checkout, changePlan } = useCloud();
  const { toast } = useSession();
  const { query } = useLocation();
  const [interval, setIv] = useInterval();
  const sub = billing?.subscription ?? null;
  const owned = sub?.selection ?? null;
  const region0 = catalog?.regions[0]?.id ?? "";

  const [license, setLicense] = useState<{ id: LicenseId; members: number } | null>(null);
  const [desk, setDesk] = useState<{ id: Exclude<DesktopId, "none">; size: MachineSpec | null; region: string } | null>(null);
  const [busy, setBusy] = useState<"license" | "desktop" | "change" | null>(null);
  const [error, setError] = useState<{ part: "license" | "desktop"; text: string } | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // start from what they own, else from a sensible first pick
  useEffect(() => {
    if (!catalog || billing === null) return;
    if (owned && license === null) setIv(owned.interval);
    setLicense((v) => v ?? (owned ? { id: owned.license, members: owned.members } : { id: "personal", members: 1 }));
    setDesk((v) => v ?? (owned && owned.desktop !== "none" ? { id: owned.desktop, size: owned.size, region: owned.region } : { id: catalog.desktops.find((d) => d.id === "shared-m")?.id ?? catalog.desktops[0]!.id, size: null, region: region0 }));
  }, [catalog, billing]);

  // older links like /billing?bundle=pro land on the matching license and cloud desktop
  const want = query.get("bundle");
  useEffect(() => {
    if (!catalog || billing === null || !want) return;
    const b = bundleOf(catalog, want);
    if (b) {
      setLicense({ id: b.license, members: Math.max(b.members, licenseOf(catalog, b.license)?.includedMembers ?? 1) });
      if (b.desktop !== "none") setDesk({ id: b.desktop, size: null, region: region0 });
    }
    navigate("/billing", { replace: true });
    scrollToHash(b && b.desktop !== "none" ? "cloud" : "license");
  }, [catalog, billing, want]);

  const licenseSel = useMemo<Selection | null>(() => (license ? { license: license.id, members: license.members, desktop: "none", size: null, region: region0, interval } : null), [license, interval, region0]);
  const desktopSel = useMemo<Selection | null>(() => (desk ? { license: "personal", members: 1, desktop: desk.id, size: desk.id === "dedicated" ? desk.size : null, region: desk.region, interval } : null), [desk, interval]);

  if (!catalog || billing === null || !licenseSel || !desktopSel || !license || !desk) {
    return (
      <div aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-56" />
        <div className="mt-10 grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[180px] !rounded-card" />)}</div>
      </div>
    );
  }

  const freeUntil = catalog.workFreeUntil && catalog.workFreeUntil > Date.now() ? catalog.workFreeUntil : null;
  const ownLicense = owned ? owned.license : "personal";
  const ownDesk = owned?.desktop ?? "none";
  const lic = licenseOf(catalog, license.id);
  const chosenDesk = desktopOf(catalog, desk.id);

  // what the one subscription becomes when one product changes; the other stays as it is
  const withLicense: Selection | null = owned ? { ...owned, license: license.id, members: license.members, interval } : null;
  const withDesktop: Selection | null = owned ? { ...owned, desktop: desk.id, size: desktopSel.size, region: desk.region, interval } : null;
  const nothingLeft = (s: Selection) => s.license === "personal" && s.desktop === "none";
  const onlyInterval = (next: Selection) => Boolean(owned) && owned!.interval !== next.interval && same({ ...owned!, interval: next.interval }, next);
  const switchLabel = `Switch to ${interval === "year" ? "yearly" : "monthly"} billing`;
  const switchChange = { title: `${switchLabel}?`, body: interval === "year" ? `Everything on your plan is billed once a year, ${Math.round(catalog.yearlyDiscount * 100)}% less.` : "Everything on your plan is billed every month.", verb: "Switch", done: `Switched to ${interval === "year" ? "yearly" : "monthly"} billing` };

  const buy = async (part: "license" | "desktop") => {
    const selection = part === "license" ? licenseOnly(licenseSel) : desktopOnly(desktopSel);
    setBusy(part); setError(null);
    try {
      if (await checkout({ kind: "plan", selection, bundle: null })) {
        if (part === "desktop") { toast("Paid. Your cloud desktop is being set up."); navigate("/cloud"); }
        else toast("License active. Thanks for backing OpenMausBot.");
      }
    } catch (e) { setError({ part, text: (e as Error).message }); } finally { setBusy(null); }
  };
  const ask = (next: Selection, c: Omit<Change, "selection">) => (nothingLeft(next) ? setCancelling(true) : setChange({ ...c, selection: next }));
  const confirm = async () => {
    if (!change) return;
    setBusy("change");
    try { await changePlan(change.selection); toast(change.done); setChange(null); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); }
  };

  const licenseName = lic?.work ? `${lic.name} license` : "No license";
  const dropping = license.id === "personal";
  const licenseAction = !withLicense
    ? lic?.work ? <Button variant="primary" disabled={busy !== null} onClick={() => void buy("license")}>{busy === "license" ? "Opening checkout" : `Buy ${licenseName}`}</Button> : <Button disabled>Your current license</Button>
    : same(owned, withLicense)
      ? <Button disabled>Your current license</Button>
      : onlyInterval(withLicense) ? <Button variant="primary" disabled={busy !== null} onClick={() => ask(withLicense, switchChange)}>{switchLabel}</Button>
      : <Button variant="primary" disabled={busy !== null} onClick={() => ask(withLicense, dropping
        ? { title: "Remove your license?", body: "Work use stops being covered when this period ends. Personal use stays free.", verb: "Remove license", done: "License removed" }
        : { title: `Change to ${licenseName}?`, body: `${licenseName}, ${members(license.members)}.`, verb: "Change license", done: "License updated" })}>
        {dropping ? "Remove license" : ownLicense === "personal" ? `Add ${licenseName}` : "Change license"}
      </Button>;

  const deskAction = !withDesktop
    ? <Button variant="primary" disabled={busy !== null} onClick={() => void buy("desktop")}>{busy === "desktop" ? "Opening checkout" : `Get ${chosenDesk?.name ?? "a cloud desktop"}`}</Button>
    : same(owned, withDesktop)
      ? <Button disabled>Your current cloud desktop</Button>
      : onlyInterval(withDesktop) ? <Button variant="primary" disabled={busy !== null} onClick={() => ask(withDesktop, switchChange)}>{switchLabel}</Button>
      : <Button variant="primary" disabled={busy !== null} onClick={() => ask(withDesktop, ownDesk === "none"
        ? { title: `Add ${chosenDesk?.name}?`, body: "It is set up in about a minute, and your bots move in by themselves.", verb: "Add cloud desktop", done: "Cloud desktop added. It is being set up." }
        : { title: `Change to ${chosenDesk?.name}?`, body: "It restarts once while it moves, usually in under a minute. Bots, files and logins come along.", verb: "Change size", done: "Resizing your cloud desktop" })}>
        {ownDesk === "none" ? `Add ${chosenDesk?.name}` : `Change to ${chosenDesk?.name}`}
      </Button>;
  const removeDesk = owned && ownDesk !== "none"
    ? <button type="button" className="hover-link mt-2 inline-flex h-9 items-center text-13 text-ink-3 max-sm:h-11" onClick={() => ask({ ...owned, desktop: "none", size: null, interval }, { title: "Remove your cloud desktop?", body: "It runs until this period ends, then it is kept, stopped, for 7 days and deleted. Your bots run on your Mac or your own server again.", verb: "Remove cloud desktop", done: "Your cloud desktop ends with this period" })}>Remove cloud desktop</button>
    : null;

  const c = catalog.custom;
  const size = desk.size ?? (chosenDesk ? { vcpu: chosenDesk.vcpu, ramGb: chosenDesk.ramGb, diskGb: chosenDesk.diskGb } : null);
  const setSize = (patch: Partial<MachineSpec>) => { if (size) setDesk({ ...desk, size: { ...size, ...patch } }); };

  return (
    <div>
      <PageHeader title="Plans & billing" sub="Licenses and cloud desktops are sold separately. Buy either one, or both." action={<IntervalToggle value={interval} onChange={setIv} discount={catalog.yearlyDiscount} />} />

      <section id="license" className="scroll-mt-20" aria-labelledby="license-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <h2 id="license-title" className="text-17 font-semibold tracking-[-0.01em] text-ink">License</h2>
            <p className="mt-0.5 text-14 text-ink-3">To use it at work. Personal use is always free.</p>
          </div>
          {freeUntil && <p className="inline-flex items-center gap-2 text-13 text-ink-2"><span className="live-dot !size-1.5 text-good" aria-hidden />Free for work until {longDate(freeUntil)}</p>}
        </div>
        <fieldset className="grid min-w-0 gap-4 md:grid-cols-3">
          <legend className="sr-only">License</legend>
          {catalog.licenses.map((l) => (
            <Option
              key={l.id}
              name="license"
              value={l.id}
              checked={license.id === l.id}
              onChange={() => setLicense({ id: l.id, members: l.perExtraMember ? Math.max(l.includedMembers, license.members) : l.includedMembers })}
              title={l.work ? `${l.name} license` : "No license"}
              price={<PriceTag monthly={l.monthly} interval={interval} catalog={catalog} />}
              sub={licenseSub(l, interval, catalog)}
              current={ownLicense === l.id}
            >
              {l.perExtraMember > 0 && license.id === l.id && <Stepper value={license.members} min={l.includedMembers} max={l.maxMembers} onChange={(n) => setLicense({ id: l.id, members: n })} />}
            </Option>
          ))}
        </fieldset>
        <Summary title="Your license" selection={licenseSel} catalog={catalog} empty="No license. Personal and noncommercial use, free." action={licenseAction} aside={error?.part === "license" ? <p role="alert" className="mt-2 text-13 text-bad">{error.text}</p> : null} />
      </section>

      <section id="cloud" className="mt-16 scroll-mt-20" aria-labelledby="cloud-title">
        {ownDesk === "none" ? (
          <CloudPitch id="cloud-title" title="A cloud desktop, on 24/7 for your bots" body="Your own computer in the cloud. Your bots keep answering, running routines and using their computers while your Mac sleeps." action={false} link={null} className="mb-4" />
        ) : (
          <div className="mb-4">
            <h2 id="cloud-title" className="text-17 font-semibold tracking-[-0.01em] text-ink">Cloud desktop</h2>
            <p className="mt-0.5 text-14 text-ink-3">On 24/7 for your bots. Resize it any time.</p>
          </div>
        )}
        <fieldset className="grid min-w-0 gap-4 md:grid-cols-3">
          <legend className="sr-only">Cloud desktop size</legend>
          {catalog.desktops.map((d) => {
            const spec = desk.id === d.id && d.sizable && size ? size : d;
            return (
              <Option
                key={d.id}
                name="desktop"
                value={d.id}
                checked={desk.id === d.id}
                onChange={() => setDesk({ ...desk, id: d.id, size: null })}
                title={d.name}
                price={<PriceTag monthly={desktopMonthly(d, d.sizable ? spec : null, c)} interval={interval} catalog={catalog} />}
                sub={<>{specLine(spec)}<span className="block">{desktopSub(d)}</span></>}
                current={ownDesk === d.id}
              />
            );
          })}
        </fieldset>
        {chosenDesk?.sizable && size && (
          <div className="mt-4 grid gap-6 rounded-card bg-card p-6 max-sm:p-5 md:grid-cols-3" role="group" aria-label="Dedicated size">
            <Slider label="vCPU" value={size.vcpu} min={Math.max(c.vcpu.min, chosenDesk.vcpu)} max={c.vcpu.max} step={c.vcpu.step} format={(v) => `${v}`} onChange={(vcpu) => setSize({ vcpu })} />
            <Slider label="Memory" value={size.ramGb} min={Math.max(c.ramGb.min, chosenDesk.ramGb)} max={c.ramGb.max} step={c.ramGb.step} format={gb} onChange={(ramGb) => setSize({ ramGb })} />
            <Slider label="Disk" value={size.diskGb} min={Math.max(c.diskGb.min, chosenDesk.diskGb)} max={c.diskGb.max} step={c.diskGb.step} format={gb} onChange={(diskGb) => setSize({ diskGb })} />
          </div>
        )}
        <div className="mt-4 max-w-[320px]">
          <Field label="Region" htmlFor="desk-region">
            <Select id="desk-region" value={desk.region} onChange={(e) => setDesk({ ...desk, region: e.target.value })}>
              {catalog.regions.map((r) => <option key={r.id} value={r.id}>{r.city}, {r.name}</option>)}
            </Select>
          </Field>
        </div>
        <Summary
          title="Your cloud desktop"
          selection={desktopSel}
          catalog={catalog}
          empty="No cloud desktop."
          action={deskAction}
          aside={<>
            {chosenDesk && <p className="mt-1 text-13 text-ink-4">In {regionName(catalog, desk.region)}. Cancel any time.</p>}
            {removeDesk}
            {error?.part === "desktop" ? <p role="alert" className="mt-2 text-13 text-bad">{error.text}</p> : null}
          </>}
        />
      </section>

      <Account catalog={catalog} onCancel={() => setCancelling(true)} />

      <CancelDialog open={cancelling} onClose={() => setCancelling(false)} />
      <ChangeDialog change={change} catalog={catalog} busy={busy === "change"} onClose={() => setChange(null)} onConfirm={() => void confirm()} />
    </div>
  );
}

function ChangeDialog({ change, catalog, busy, onClose, onConfirm }: { change: Change | null; catalog: PlanCatalog; busy: boolean; onClose(): void; onConfirm(): void }) {
  const { cart } = useCart(change?.selection ?? null, catalog);
  return (
    <Modal open={change !== null} onClose={() => { if (!busy) onClose(); }} title={change?.title ?? ""} footer={<><Button onClick={onClose} disabled={busy}>Not now</Button><Button variant="primary" onClick={onConfirm} disabled={busy}>{busy ? "Saving" : change?.verb}</Button></>}>
      {change && <p>{change.body}</p>}
      {change && cart && <p className="num mt-3 text-ink-2">Everything on your plan: {money(cart.perMonth)}/mo, {billed(change.selection.interval)}. It starts today, and the difference is prorated.</p>}
    </Modal>
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
  const part = (key: string) => cart?.lines.find((l) => l.key === key) ?? null;
  const cloud = clouds?.[0] ?? null;
  const licLine = part("license"), deskLine = part("desktop");
  return (
    <>
      <section className="mt-16" aria-labelledby="billing-title">
        <SectionHead id="billing-title">Billing</SectionHead>
        <dl className="divide-y divide-line border-y border-line">
          <Row k="License" action={<button type="button" className={quiet} onClick={() => scrollToHash("license")}>{lic?.work ? "Change" : "Buy"}</button>}>
            {lic?.work && sel ? <span className="block truncate">{lic.name} license<span className="text-ink-3">, {members(sel.members)}</span>{licLine && <span className="num text-ink-3"> · {money(licLine.monthly)}/mo</span>}</span> : <span className="text-ink-3">None. Personal and noncommercial use.</span>}
          </Row>
          <Row k="Cloud desktop" action={desk ? <button type="button" className={quiet} onClick={() => navigate("/cloud")}>Open</button> : <button type="button" className={quiet} onClick={() => scrollToHash("cloud")}>Get one</button>}>
            {desk && sel ? <span className="block truncate">{desk.name}<span className="text-ink-3">{cloud ? `, ${cloud.name}` : ""}, {regionName(catalog, sel.region)}</span>{deskLine && <span className="num text-ink-3"> · {money(deskLine.monthly)}/mo</span>}</span> : <span className="text-ink-3">None. Your bots run while your Mac is awake.</span>}
          </Row>
          {sub && (
            <Row k="Renewal" action={!sub.cancelAt ? <button type="button" className={quiet} onClick={onCancel}>Cancel</button> : undefined}>
              <span className="num block truncate">{cart ? `${money(cart.perMonth)}/mo, ${billed(sub.selection.interval)}` : usd(sub.amountUsd)}</span>
              <span className="block truncate text-13 text-ink-3">{sub.cancelAt ? `Ends ${longDate(sub.cancelAt)}. Everything stays until then.` : `Renews ${longDate(sub.currentPeriodEnd)}`}</span>
            </Row>
          )}
          <Row k="Payment method" action={<button type="button" className={quiet} onClick={() => void openPortal()}>{pm ? "Update" : "Add"}</button>}>
            {pm ? <span className="num"><span className="uppercase">{pm.brand}</span> •••• {pm.last4}<span className="text-ink-3">, expires {String(pm.expMonth).padStart(2, "0")}/{String(pm.expYear).slice(-2)}</span></span> : <span className="text-ink-3">None yet. You add one at checkout.</span>}
          </Row>
          <Row k="AI credits" action={<button type="button" className={quiet} onClick={() => setBuying(true)}>Add credits</button>}>
            {billing ? <span className="num">{usd(billing.credits.balanceUsd)} <span className="text-ink-3">left · {usd(billing.credits.usedThisMonthUsd)} used this month</span></span> : <Skeleton className="h-5 w-24" />}
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
    <Modal
      open={open}
      onClose={onClose}
      title="Cancel your plan?"
      footer={<><Button onClick={onClose}>Keep it</Button><Button variant="danger" onClick={() => void stop()} disabled={busy}>{busy ? "Cancelling" : "Cancel plan"}</Button></>}
    >
      <p>Everything runs until {longDate(sub.currentPeriodEnd)}.{desk ? " Your cloud desktop is then kept for 7 days and deleted, and your bots only run while your Mac is awake." : " After that, work use is no longer covered. Personal use stays free."}</p>
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
