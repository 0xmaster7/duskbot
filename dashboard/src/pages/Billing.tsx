import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, Download } from "lucide-react";
import { useCloud } from "../data/cloud";
import type { BillingInterval, LicenseId, PlanCatalog } from "../data/contracts";
import { bundleOf, desktopOf, gb, licenseMonthly, licenseOf, perMonthOn, wakeSeconds } from "../data/pricing";
import { useCart } from "../data/quote";
import { useSession } from "../data/session";
import { longDate, shortDate, usd } from "../lib/format";
import { navigate, useLocation } from "../lib/router";
import { Field, Modal, Select, Toggle } from "../ui/controls";
import { Badge, Button, cx, PageHeader, Skeleton } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { SectionHead } from "../ui/table";
import { CloudPitch, regionName } from "./cloud-bits";
import { BuyCredits } from "./credits-dialog";
import { cartText, IntervalToggle, LicenseSheet, PlanSheet, priceText, useInterval, type PaidPlan } from "./plan-sheet";

export { IntervalToggle, useInterval };

const CONTACT = "mailto:hello@openmausbot.com";
const members = (n: number) => `${n} ${n === 1 ? "member" : "members"}`;
type Tier = "free" | "starter" | "pro";
type Use = "personal" | "work";

/** four rows, the machine first; every number comes from the catalog */
function points(id: Tier, catalog: PlanCatalog): string[] {
  const b = bundleOf(catalog, id);
  const d = b ? desktopOf(catalog, b.desktop) : null;
  if (!d) return ["Runs on your Mac while it's awake", "Every bot, chat and connector", "Personal use, free forever", "No card needed"];
  const machine = `${d.vcpu} vCPU, ${gb(d.ramGb)} RAM, ${gb(d.diskGb)} disk`;
  const bots = d.botComputers === null ? "Unlimited bots at work at once" : `${d.botComputers} ${d.botComputers === 1 ? "bot" : "bots"} at work at once`;
  const wake = catalog.wake?.[d.id];
  const seconds = wake ? wakeSeconds(wake.medianMs) : null;
  return id === "pro" ? [machine, bots, seconds ? `Priority wake, in ${seconds} s` : "Priority wake", "Work license included"] : [machine, bots, seconds ? `On 24/7, wakes in ${seconds} s` : "On 24/7, wakes for Slack messages", "Set up in one click"];
}
const MASCOT = { free: "orange", starter: "blue", pro: "green" } as const;

function PlanCard({ id, catalog, interval, current, lead, onChoose, action, disabled }: { id: Tier; catalog: PlanCatalog; interval: BillingInterval; current: boolean; lead: boolean; onChoose(): void; action: string; disabled: boolean }) {
  const b = bundleOf(catalog, id);
  if (!b) return null;
  const perMonth = b.monthly === 0 ? 0 : interval === "year" ? Math.round(perMonthOn(b.monthly, interval, catalog)) : b.monthly;
  const sub = b.monthly === 0 ? "free forever" : interval === "year" ? `per month · ${priceText(b.monthly, interval, catalog).replace("/yr", "")} billed yearly` : "per month";
  return (
    <article className="enter flex min-w-0 flex-col rounded-card border border-line bg-card p-7 max-sm:p-6" aria-labelledby={`plan-${id}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 id={`plan-${id}`} className="text-17 font-medium text-ink">{b.name}</h2>
          {current && <Badge>Current</Badge>}
        </div>
        <span className="-mt-1 shrink-0" aria-hidden><Mascot color={MASCOT[id]} size={44} /></span>
      </div>
      <p className="num mt-2 text-[40px] font-semibold leading-none tracking-[-0.03em] text-ink">${perMonth}</p>
      <p className="num mt-2 text-13 text-ink-3">{sub}</p>
      <button type="button" onClick={onChoose} disabled={disabled} className={cx("press mt-6 h-10 w-full rounded-full text-14 font-medium disabled:cursor-default disabled:opacity-50", lead && !current ? "hover-primary bg-primary text-primary-ink" : "hover-outline border border-line-2 bg-card-2 text-ink")}>{action}</button>
      <h3 className="mt-7 text-14 font-medium text-ink">What you get:</h3>
      <ul className="mt-3.5 flex flex-col gap-3">
        {points(id, catalog).map((pt) => <li key={pt} className="flex gap-2.5 text-14 text-ink-2"><Check size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />{pt}</li>)}
      </ul>
    </article>
  );
}

const FAQ = [
  { q: "What's a cloud desktop?", a: "A computer of your own in the cloud, made for your bots. It stays on day and night, so they keep answering, running routines and using their computers while your Mac is closed." },
  { q: "Do I need it if I have a Mac?", a: "No. Free runs everything on your Mac; your bots just pause while it sleeps. Add a cloud desktop when you want them working around the clock." },
  { q: "What counts as work use?", a: "Anything you do for a company, for a client or to earn money. Personal projects, learning and hobbies are personal use, which is free forever." },
];

function Faq() {
  return (
    <section className="mt-16" aria-labelledby="faq-title">
      <SectionHead id="faq-title">Questions</SectionHead>
      <div className="divide-y divide-line border-y border-line">
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

const quiet = "hover-link inline-flex h-9 items-center rounded-full px-1 text-14 text-ink-2 disabled:opacity-45 max-sm:h-11";

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
  const plan = sel && desk ? catalog.bundles.find((b) => b.desktop === sel.desktop && b.id !== "team")?.name ?? desk.name : "Free";
  const renews = sub ? (sub.cancelAt ? `Ends ${longDate(sub.cancelAt)}` : `Renews ${longDate(sub.currentPeriodEnd)}`) : null;
  return (
    <>
      <section className="mt-16" aria-labelledby="billing-title">
        <SectionHead id="billing-title">Your billing</SectionHead>
        <dl className="divide-y divide-line border-y border-line">
          <Row k="Plan" action={sub && !sub.cancelAt ? <button type="button" className={quiet} onClick={onCancelPlan}>Cancel</button> : undefined}>
            <span className="block truncate">{plan}{desk && sel ? <span className="text-ink-3">, {clouds?.[0]?.name ?? desk.name} in {regionName(catalog, sel.region)}</span> : <span className="text-ink-3">, your bots run on your Mac</span>}</span>
            {sub && <span className="num block truncate text-13 text-ink-3">{cart ? `${cartText(cart, sub.selection.interval)} · ` : ""}{renews}</span>}
          </Row>
          <Row k="License" action={<button type="button" className={quiet} onClick={onLicense}>{lic?.work ? "Change" : "Add"}</button>}>
            {lic?.work && sel ? <span className="block truncate">{lic.name} license<span className="num text-ink-3">, {members(sel.members)} · {bundleOf(catalog, "pro")?.license === sel.license && bundleOf(catalog, "pro")?.desktop === sel.desktop ? "included with Pro" : priceText(licenseMonthly(lic, sel.members), sel.interval, catalog)}</span></span> : <span className="text-ink-3">Personal use, free</span>}
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
  // with a work license on the plan, cancelling the cloud desktop keeps the license
  const keepsLicense = sub.selection.license !== "personal" && sub.selection.desktop !== "none";
  const stop = async () => {
    setBusy(true); setError(null);
    try {
      if (keepsLicense) { await changePlan({ ...sub.selection, desktop: "none", size: null }); toast("Your cloud desktop ends with this period"); }
      else await cancel(reason);
      onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const desk = sub.selection.desktop !== "none";
  return (
    <Modal open={open} onClose={onClose} title={keepsLicense ? "Cancel your cloud desktop?" : "Cancel your plan?"} footer={<><Button onClick={onClose}>Keep it</Button><Button variant="danger" onClick={() => void stop()} disabled={busy}>{busy ? "Cancelling" : "Cancel"}</Button></>}>
      <p>It runs until {longDate(sub.currentPeriodEnd)}.{desk ? " Your cloud desktop is then kept for 7 days and deleted, and your bots only run while your Mac is awake." : " After that, work use is no longer covered. Personal use stays free."}{keepsLicense ? " Your work license stays." : ""}</p>
      {!keepsLicense && (
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
      )}
      {keepsLicense && error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
      <button type="button" className="hover-link mt-3 h-9 text-13 text-ink-3 underline decoration-line-2 underline-offset-4" onClick={() => void openPortal()}>Manage billing details instead</button>
    </Modal>
  );
}

export function BillingPage() {
  const { catalog, billing } = useCloud();
  const { query } = useLocation();
  const [interval, setIv] = useInterval();
  const owned = billing?.subscription?.selection ?? null;
  const [planSheet, setPlanSheet] = useState<PaidPlan | null>(null);
  const [licenseSheet, setLicenseSheet] = useState<{ license: LicenseId; members: number } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [use, setUse] = useState<Use>(() => (owned && owned.license !== "personal" ? "work" : "personal"));

  // a running plan shows its own billing period and use
  useEffect(() => { if (owned) { setIv(owned.interval); if (owned.license !== "personal") setUse("work"); } }, [owned?.interval, owned?.license]);

  // older links like /billing?bundle=pro, and the sidebar's plus button, open the matching sheet
  const want = query.get("bundle");
  useEffect(() => {
    if (!catalog || billing === null || !want) return;
    navigate("/billing", { replace: true });
    if (want === "plus" || want === "starter") setPlanSheet("starter");
    else if (want === "pro") setPlanSheet("pro");
    else if (want === "team") setLicenseSheet({ license: "team", members: licenseOf(catalog, "team")?.includedMembers ?? 2 });
  }, [catalog, billing, want]);

  if (!catalog || billing === null) {
    return (
      <div aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-3 h-5 w-96 max-w-full" />
        <div className="mt-8 grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[400px] !rounded-card" />)}</div>
      </div>
    );
  }

  const ownDesk = owned?.desktop ?? "none";
  const current = (id: Tier) => (id === "free" ? ownDesk === "none" : bundleOf(catalog, id)?.desktop === ownDesk);
  const ownsLicense = Boolean(owned && owned.license !== "personal");
  const work = licenseOf(catalog, "starter");
  const free = catalog.workFreeUntil && catalog.workFreeUntil > Date.now() ? catalog.workFreeUntil : null;
  const openLicense = (license: LicenseId = owned && owned.license !== "personal" ? owned.license : "starter", n = owned?.members ?? 1) => setLicenseSheet({ license, members: n });
  const paid = (id: PaidPlan) => ({ label: current(id) ? "Current plan" : `${owned && ownDesk !== "none" ? "Switch to" : "Get"} ${bundleOf(catalog, id)?.name}`, go: () => setPlanSheet(id) });
  const card = (id: Tier, lead = false) => {
    const a = id !== "free" ? paid(id) : !current("free") ? { label: "Switch to Free", go: () => setCancelling(true) } : use === "work" && !ownsLicense ? { label: "Add a work license", go: () => openLicense("starter", 1) } : { label: "Current plan", go: () => {} };
    return <PlanCard id={id} catalog={catalog} interval={interval} current={current(id)} lead={lead} action={a.label} onChoose={a.go} disabled={a.label === "Current plan"} />;
  };

  return (
    <div>
      <PageHeader title="Plans & billing" />
      <CloudPitch id="hero-title" title="Keep your bots working 24/7" body="Give them a cloud desktop of their own, so they keep going while your Mac sleeps. Set up in one click." action={false} link={null} />

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <Toggle<Use> label="Use" value={use} onChange={setUse} options={[{ value: "personal", label: "Personal" }, { value: "work", label: "Work" }]} />
        <IntervalToggle value={interval} onChange={setIv} catalog={catalog} />
      </div>
      <p className="mt-3 text-13 text-ink-4">{interval === "year" ? "Billed yearly, two months free." : "Billed monthly, cancel anytime."} Personal use is free forever.{free ? ` Work use is free until ${longDate(free)}.` : ""}</p>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {card("free")}
        {card("starter")}
        {card("pro", true)}
      </div>

      {work && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-card border border-line bg-card px-6 py-4">
          <div className="min-w-0">
            <p className="text-14 text-ink">{ownsLicense ? "You have a work license" : "Using it for work?"}</p>
            <p className="num mt-0.5 text-13 text-ink-3">{ownsLicense ? "Covers work use on every plan." : `A work license is ${priceText(work.monthly, "month", catalog).replace("/mo", "")} a month per person. Pro includes one.`}</p>
          </div>
          <button type="button" className="press hover-outline h-9 shrink-0 rounded-full border border-line-2 bg-card-2 px-4 text-14 font-medium text-ink" onClick={() => openLicense()}>{ownsLicense ? "Manage" : "Add a work license"}</button>
        </div>
      )}

      <p className="mt-5 text-center text-13 text-ink-3">Cancel anytime <span aria-hidden className="text-ink-4">·</span> Set up in about a minute <span aria-hidden className="text-ink-4">·</span> Need a dedicated machine? <a href={CONTACT} className="hover-link text-ink-2 underline decoration-line-2 underline-offset-4">Talk to us</a></p>

      <Faq />
      <YourBilling catalog={catalog} onLicense={() => openLicense()} onCancelPlan={() => setCancelling(true)} />

      {planSheet && <PlanSheet source="dash_billing" start={planSheet} work={use === "work" || ownsLicense} onClose={() => setPlanSheet(null)} />}
      {licenseSheet && <LicenseSheet source="dash_license" start={licenseSheet} onClose={() => setLicenseSheet(null)} onNothingLeft={() => setCancelling(true)} />}
      <CancelDialog open={cancelling} onClose={() => setCancelling(false)} />
    </div>
  );
}
