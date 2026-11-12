import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, Download } from "@/icons";
import { useCloud } from "../data/cloud";
import { LoadError } from "./common";
import type { BillingInterval, LicenseId, PlanCatalog } from "../data/contracts";
import { bundleOf, desktopOf, gb, licenseMonthly, licenseOf, perMonthOn, wakeSeconds } from "../data/pricing";
import { useCart } from "../data/quote";
import { useSession } from "../data/session";
import { longDate, shortDate, usd } from "../lib/format";
import { navigate, useLocation } from "../lib/router";
import { planIntent } from "../lib/site";
import { Field, Modal, Select } from "../ui/controls";
import { Badge, Button, cx, PageHeader, Skeleton } from "../ui/kit";
import meadow from "../art/p-meadow.webp";
import peaks from "../art/p-peaks.webp";
import sky from "../art/p-sky.webp";
import { SectionHead } from "../ui/table";
import { regionName } from "./cloud-bits";
import { BuyCredits } from "./credits-dialog";
import { FreeSheet } from "./funnel";
import { AnimatePresence } from "../ui/motion";
import { cartText, IntervalToggle, LicenseSheet, PlanSheet, priceText, useInterval, type PaidPlan } from "./plan-sheet";

export { IntervalToggle, useInterval };

const CONTACT = "mailto:hello@dusk.bot";
const members = (n: number) => `${n} ${n === 1 ? "member" : "members"}`;
type Tier = "free" | PaidPlan;

/** four rows, the machine first; every number comes from the catalog */
function points(id: PaidPlan, catalog: PlanCatalog): string[] {
  const b = bundleOf(catalog, id);
  const d = b ? desktopOf(catalog, b.desktop) : null;
  if (!d) return [];
  const machine = `${d.vcpu} vcpu, ${gb(d.ramGb)} ram, ${gb(d.diskGb)} disk`;
  const bots = d.botComputers === null ? "unlimited bots at work at once" : `${d.botComputers} ${d.botComputers === 1 ? "bot" : "bots"} at work at once`;
  const wake = catalog.wake?.[d.id];
  const seconds = wake ? wakeSeconds(wake.medianMs) : null;
  return id === "pro" ? [machine, bots, seconds ? `priority wake, in ${seconds} s` : "priority wake", "work license included"] : [machine, bots, seconds ? `on 24/7, wakes in ${seconds} s` : "on 24/7, wakes for slack messages", "set up in one click"];
}
const ART = { free: sky, starter: meadow, pro: peaks } as const;
const FREE_POINTS = ["your bots on this computer", "they work while it's awake", "every bot, chat and connector, for personal use"];

function PlanCard({ id, catalog, interval, current, onChoose, action, disabled, i }: { id: Tier; catalog: PlanCatalog; interval: BillingInterval; current: boolean; onChoose: (() => void) | null; action: string; disabled: boolean; i: number }) {
  const b = bundleOf(catalog, id);
  const paid = id !== "free";
  const monthly = b?.monthly ?? 0;
  const perMonth = interval === "year" ? Math.round(perMonthOn(monthly, interval, catalog)) : monthly;
  const sub = !paid ? "on your own computer" : interval === "year" ? `per month · ${priceText(monthly, interval, catalog).replace("/yr", "")} billed yearly` : "per month";
  return (
    <article className={cx("surface enter flex min-w-0 flex-col rounded-card bg-card p-2.5 pb-7", !paid && "max-lg:order-last")} style={{ ["--i" as string]: i }} aria-labelledby={`plan-card-${id}`}>
      <img src={ART[id]} alt="" width={800} height={354} className="aspect-[800/300] w-full rounded-[16px] object-cover object-bottom" draggable={false} />
      <div className="flex flex-1 flex-col px-4 pt-5 max-sm:px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 id={`plan-card-${id}`} className="text-24 font-medium tracking-[-0.035em] text-ink">{b?.name ?? id}</h2>
          {paid && <span className="text-14 text-ink-3">dusk cloud</span>}
          {current && <Badge>current</Badge>}
        </div>
        <p className="num mt-4 text-[48px] font-medium leading-none tracking-[-0.05em] text-ink">${perMonth}</p>
        <p className="num mt-2 text-13 text-ink-3">{sub}</p>
        {onChoose ? (
          <button type="button" onClick={onChoose} disabled={disabled} className="press hover-btn mt-6 h-12 w-full rounded-full bg-btn text-15 font-medium text-ink disabled:cursor-default disabled:opacity-50">{action}</button>
        ) : <p className="mt-6 grid h-12 place-items-center rounded-full text-14 text-ink-3">{action}</p>}
        <h3 className="sr-only">what you get</h3>
        <ul className="mt-6 flex flex-col gap-3">
          {(paid ? points(id, catalog) : FREE_POINTS).map((pt) => <li key={pt} className={cx("flex gap-2.5 text-14", paid ? "text-ink-2" : "text-ink-3")}><Check size={17} strokeWidth={1.75} className={cx("mt-0.5 shrink-0", paid ? "text-good" : "text-ink-4")} aria-hidden />{pt}</li>)}
        </ul>
      </div>
    </article>
  );
}

const FAQ = [
  { q: "do i need it if i have a mac?", a: "no. free runs everything on your mac; your bots just pause while it sleeps. add dusk cloud when you want them working around the clock." },
  { q: "what counts as work use?", a: "anything you do for a company, for a client or to earn money. personal projects, learning and hobbies are personal use, which is free forever." },
];

function Faq() {
  return (
    <section className="mt-16" aria-labelledby="faq-title">
      <SectionHead id="faq-title">questions</SectionHead>
      <div className="">
        {FAQ.map((f) => (
          <details key={f.q} className="group">
            <summary className="hover-link flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-14 text-ink [&::-webkit-details-marker]:hidden">{f.q}<ChevronDown size={16} strokeWidth={1.5} className="shrink-0 text-ink-3 group-open:rotate-180" aria-hidden /></summary>
            <p className="max-w-[64ch] pb-4 text-14 leading-[1.6] text-ink-3">{f.a}</p>
          </details>
        ))}
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

const quiet = "text-link inline-flex h-9 items-center rounded-full px-1 text-14 disabled:opacity-45 max-sm:h-11";

function YourBilling({ catalog, onLicense, onCancelPlan }: { catalog: PlanCatalog; onLicense(): void; onCancelPlan(): void }) {
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
  const plan = sel && desk ? catalog.bundles.find((b) => b.desktop === sel.desktop && b.id !== "team")?.name ?? desk.name : "free";
  const renews = sub ? (sub.cancelAt ? `ends ${longDate(sub.cancelAt)}` : `renews ${longDate(sub.currentPeriodEnd)}`) : null;
  return (
    <>
      <section className="mt-16" aria-labelledby="billing-title">
        <SectionHead id="billing-title">your billing</SectionHead>
        <dl className="">
          <Row k="plan" action={sub && !sub.cancelAt ? <button type="button" className={quiet} onClick={onCancelPlan}>cancel</button> : undefined}>
            <span className="block truncate">{plan}{desk && sel ? <span className="text-ink-3">, {clouds?.[0]?.name ?? desk.name} in {regionName(catalog, sel.region)}</span> : <span className="text-ink-3">, your bots run on your mac</span>}</span>
            {sub && <span className="num block truncate text-13 text-ink-3">{cart ? `${cartText(cart, sub.selection.interval)} · ` : ""}{renews}</span>}
          </Row>
          <Row k="license" action={<button type="button" className={quiet} onClick={onLicense}>{lic?.work ? "change" : "add"}</button>}>
            {lic?.work && sel ? <span className="block truncate">{lic.name} license<span className="num text-ink-3">, {members(sel.members)} · {bundleOf(catalog, "pro")?.license === sel.license && bundleOf(catalog, "pro")?.desktop === sel.desktop ? "included with pro" : priceText(licenseMonthly(lic, sel.members), sel.interval, catalog)}</span></span> : <span className="text-ink-3">personal use, free</span>}
          </Row>
          <Row k="payment method" action={<button type="button" className={quiet} onClick={() => void openPortal()}>{pm ? "update" : "add"}</button>}>
            {pm ? <span className="num"><span className="uppercase">{pm.brand}</span> •••• {pm.last4}<span className="text-ink-3">, expires {String(pm.expMonth).padStart(2, "0")}/{String(pm.expYear).slice(-2)}</span></span> : <span className="text-ink-3">none yet. you add one at checkout.</span>}
          </Row>
          <Row k="ai credits" action={<button type="button" className={quiet} onClick={() => setBuying(true)}>add credits</button>}>
            {billing ? <span className="num">{usd(billing.credits.balanceUsd)} <span className="text-ink-3">left</span></span> : <Skeleton className="h-5 w-24" />}
          </Row>
        </dl>
      </section>
      <section className="mt-12" aria-labelledby="invoices-title">
        <SectionHead id="invoices-title">invoices</SectionHead>
        {invoices.length ? (
          <ul className="">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex min-h-12 items-center gap-4 text-14">
                <span className="num w-16 shrink-0 text-ink-3">{shortDate(inv.date)}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{inv.description}</span>
                {inv.status !== "paid" && <span className={cx("text-13", inv.status === "open" ? "text-warn" : "text-ink-3")}>{inv.status === "open" ? "due" : "refunded"}</span>}
                <span className="num text-ink-2">{usd(inv.amountUsd)}</span>
                {inv.url ? (
                  <a href={inv.url} target="_blank" rel="noreferrer" aria-label={`download invoice ${inv.number}`} className="hover-ghost -me-2 grid size-9 shrink-0 place-items-center rounded-full text-ink-3 max-sm:size-11"><Download size={15} strokeWidth={1.5} /></a>
                ) : files ? <span className="-me-2 size-9 shrink-0 max-sm:size-11" aria-hidden /> : null}
              </li>
            ))}
          </ul>
        ) : <p className="py-5 text-14 text-ink-3">invoices show up here after your first payment.</p>}
      </section>
      <BuyCredits source="dash_credits" open={buying} onClose={() => setBuying(false)} />
    </>
  );
}

function CancelDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { billing, cancel, changePlan, openPortal } = useCloud();
  const { toast } = useSession();
  const [reason, setReason] = useState<Parameters<ReturnType<typeof useCloud>["cancel"]>[0]>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = billing?.subscription;
  if (!sub) return null;
  // with a work license on the plan, cancelling the dusk cloud keeps the license
  const keepsLicense = sub.selection.license !== "personal" && sub.selection.desktop !== "none";
  const stop = async () => {
    setBusy(true); setError(null);
    try {
      if (keepsLicense) { await changePlan({ ...sub.selection, desktop: "none", size: null }); toast("your dusk cloud ends with this period"); }
      else await cancel(reason);
      onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const desk = sub.selection.desktop !== "none";
  return (
    <Modal open={open} onClose={onClose} title={keepsLicense ? "cancel your dusk cloud?" : "cancel your plan?"} footer={<><Button onClick={onClose}>keep it</Button><Button variant="danger" onClick={() => void stop()} disabled={busy}>{busy ? "cancelling" : "cancel"}</Button></>}>
      <p>it runs until {longDate(sub.currentPeriodEnd)}.{desk ? " your dusk cloud then sleeps and is kept for 30 days before it's deleted, and your bots only run while your mac is awake." : " after that, work use is no longer covered. personal use stays free."}{keepsLicense ? " your work license stays." : ""}</p>
      {!keepsLicense && (
        <div className="mt-4">
          <Field label="what made you cancel? (optional)" htmlFor="cancel-reason" error={error}>
            <Select id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              <option value="">choose one</option>
              <option value="feature">missing a feature i need</option>
              <option value="price">too expensive</option>
              <option value="setup">setting it up was too hard</option>
              <option value="broken">something did not work</option>
              <option value="later">i will come back later</option>
              <option value="other">something else</option>
            </Select>
          </Field>
        </div>
      )}
      {keepsLicense && error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
      <button type="button" className="text-link mt-3 h-9 text-13" onClick={() => void openPortal()}>manage billing details instead</button>
    </Modal>
  );
}

export function BillingPage() {
  const { catalog, billing, error, refresh } = useCloud();
  const { query } = useLocation();
  const [interval, setIv] = useInterval();
  const owned = billing?.subscription?.selection ?? null;
  const [planSheet, setPlanSheet] = useState<PaidPlan | null>(null);
  const [licenseSheet, setLicenseSheet] = useState<{ license: LicenseId; members: number } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [toFree, setToFree] = useState(false);
  // a running plan shows its own billing period and use
  useEffect(() => { if (owned) setIv(owned.interval); }, [owned?.interval]);

  // a plan picked on the site (/billing?plan=pro&period=year, or the older ?bundle=pro) opens its sheet on that plan and period
  const want = query.get("plan") ?? query.get("bundle");
  const period = planIntent(query)?.interval ?? null;
  useEffect(() => {
    if (!catalog || billing === null || !want) return;
    const intent = planIntent(new URLSearchParams({ plan: want }));
    navigate("/billing", { replace: true });
    if (intent) { if (period && !owned) setIv(period); setPlanSheet(intent.plan); }
    else if (want === "team") setLicenseSheet({ license: "team", members: licenseOf(catalog, "team")?.includedMembers ?? 2 });
  }, [catalog, billing, want]);

  if (error && (!catalog || !billing)) return <div><PageHeader title="plans and billing" /><LoadError error={error} retry={refresh} /></div>;
  if (!catalog || billing === null) {
    return (
      <div aria-busy="true" aria-label="loading">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-3 h-5 w-96 max-w-full" />
        <div className="mt-8 grid gap-3 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[520px] !rounded-card" />)}</div>
      </div>
    );
  }

  const ownDesk = owned?.desktop ?? "none";
  const current = (id: Tier) => (id === "free" ? ownDesk === "none" : bundleOf(catalog, id)?.desktop === ownDesk);
  const ownsLicense = Boolean(owned && owned.license !== "personal");
  const work = licenseOf(catalog, "starter");
  const free = catalog.workFreeUntil && catalog.workFreeUntil > Date.now() ? catalog.workFreeUntil : null;
  const openLicense = (license: LicenseId = owned && owned.license !== "personal" ? owned.license : "starter", n = owned?.members ?? 1) => setLicenseSheet({ license, members: n });
  const card = (id: PaidPlan, i: number) => {
    const label = current(id) ? "your plan" : `${owned && ownDesk !== "none" ? "switch to" : "get"} ${bundleOf(catalog, id)?.name}`;
    return <PlanCard key={id} id={id} i={i} catalog={catalog} interval={interval} current={current(id)} action={label} onChoose={() => setPlanSheet(id)} disabled={current(id)} />;
  };
  const ownPlan: PaidPlan = current("pro") ? "pro" : "starter";

  return (
    <div>
      <PageHeader title="plans and billing" sub="keep your bots working 24/7, laptop open or shut." action={<IntervalToggle value={interval} onChange={setIv} catalog={catalog} />} />
      <div className="grid gap-3 lg:grid-cols-3">
        <PlanCard id="free" i={0} catalog={catalog} interval={interval} current={current("free")} action={current("free") ? "your plan" : "switch to free"} onChoose={current("free") ? null : () => setToFree(true)} disabled={false} />
        {card("starter", 1)}
        {card("pro", 2)}
      </div>
      <p className="mt-3 text-13 text-ink-4">{interval === "year" ? "billed yearly, two months free." : "billed monthly, cancel anytime."} personal use is free.{free ? ` work use is free until ${longDate(free)}.` : ""} need a dedicated machine? <a href={CONTACT} className="text-link">talk to us</a>.</p>

      {work && (
        <div className="surface mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-card bg-card px-6 py-4">
          <div className="min-w-0">
            <p className="text-14 text-ink">{ownsLicense ? "you have a work license" : "using it for work?"}</p>
            <p className="num mt-0.5 text-13 text-ink-3">{ownsLicense ? "covers work use on every plan." : `${priceText(work.monthly, "month", catalog).replace("/mo", "")} a month per person. pro includes one.`}</p>
          </div>
          <button type="button" className="press hover-btn h-10 shrink-0 rounded-full bg-btn px-4.5 text-14 font-medium text-ink" onClick={() => openLicense()}>{ownsLicense ? "manage" : "add a license"}</button>
        </div>
      )}


      <Faq />
      <YourBilling catalog={catalog} onLicense={() => openLicense()} onCancelPlan={() => setCancelling(true)} />

      <AnimatePresence>{planSheet && <PlanSheet key="plan" source="dash_billing" start={planSheet} work={ownsLicense} onClose={() => setPlanSheet(null)} />}</AnimatePresence>
      <AnimatePresence>{licenseSheet && <LicenseSheet key="license" source="dash_license" start={licenseSheet} onClose={() => setLicenseSheet(null)} onNothingLeft={() => setCancelling(true)} />}</AnimatePresence>
      <FreeSheet
        open={toFree}
        catalog={catalog}
        plan={ownPlan}
        onClose={() => setToFree(false)}
        onFree={() => { setToFree(false); setCancelling(true); }}
        primary={<Button variant="primary" onClick={() => setToFree(false)}>keep {bundleOf(catalog, ownPlan)?.name}</Button>}
      />
      <CancelDialog open={cancelling} onClose={() => setCancelling(false)} />
    </div>
  );
}
