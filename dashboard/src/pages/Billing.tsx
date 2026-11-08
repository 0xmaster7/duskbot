import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, Download } from "lucide-react";
import { useCloud } from "../data/cloud";
import type { BillingInterval, LicenseId, PlanCatalog } from "../data/contracts";
import { botsLine, bundleOf, desktopOf, gb, licenseMonthly, licenseOf } from "../data/pricing";
import { useCart } from "../data/quote";
import { useSession } from "../data/session";
import { longDate, shortDate, usd } from "../lib/format";
import { navigate, useLocation } from "../lib/router";
import { Field, Modal, Select, Toggle } from "../ui/controls";
import { Badge, Button, cx, PageHeader, Skeleton } from "../ui/kit";
import { SectionHead } from "../ui/table";
import { CloudPitch, regionName } from "./cloud-bits";
import { BuyCredits } from "./credits-dialog";
import { cartText, IntervalToggle, LicenseSheet, per, PlanSheet, priceText, useInterval, type PaidPlan } from "./plan-sheet";

export { IntervalToggle, useInterval };

type Use = "personal" | "work";
const CONTACT = "mailto:hello@openmausbot.com";
const members = (n: number) => `${n} ${n === 1 ? "member" : "members"}`;

/** at most three points, with the catalog's real numbers; nothing here is invented */
function points(id: "free" | "starter" | "pro", work: boolean, bots: number | null, members: number): string[] {
  const at = bots === null ? "Unlimited bots at work at once" : `${bots} ${bots === 1 ? "bot" : "bots"} at work at once`;
  if (id === "free") return ["Every bot, chat and connector", work ? "Work license for 1 person" : "Personal use, free forever", "No card needed"];
  if (id === "starter") return [at, "Keeps going while your Mac sleeps", work ? "Work license for 1 person" : "Set up in one click"];
  return [at, "Priority wake", `Work license for ${members} ${members === 1 ? "person" : "people"}`];
}
const LINE = { free: "Your bots on your own Mac.", starter: "A cloud desktop that never sleeps.", pro: "A bigger cloud desktop for real work." } as const;

function PlanCard({ id, catalog, interval, use, current, lead, onChoose, action, disabled }: { id: "free" | "starter" | "pro"; catalog: PlanCatalog; interval: BillingInterval; use: Use; current: boolean; lead: boolean; onChoose(): void; action: string; disabled: boolean }) {
  const b = bundleOf(catalog, id);
  const desk = b ? desktopOf(catalog, b.desktop) : null;
  const work = licenseOf(catalog, "starter");
  if (!b) return null;
  const addsLicense = use === "work" && b.license === "personal" && work;
  const monthly = b.monthly + (addsLicense ? work.monthly : 0);
  const p = per(monthly, interval, catalog);
  const billing = monthly === 0 ? "Free forever" : interval === "year" ? "Billed yearly, 2 months free" : "Billed monthly";
  const spec = desk ? `${desk.vcpu} vCPU · ${gb(desk.ramGb)} · ${gb(desk.diskGb)} · ${botsLine(desk.botComputers).toLowerCase()}` : "Runs on your Mac while it's awake";
  return (
    <article className={cx("enter flex min-w-0 flex-col rounded-card bg-card p-6 max-sm:p-5", lead && "ring-1 ring-line-2")} aria-labelledby={`plan-${id}`}>
      <div className="flex h-[22px] items-center justify-between gap-2">
        <h2 id={`plan-${id}`} className="text-15 font-medium text-ink">{b.name}</h2>
        {current && <Badge>Current</Badge>}
      </div>
      <p className="mt-5 flex items-baseline gap-1">
        <span className="num text-34 font-semibold tracking-[-0.03em] text-ink">{monthly === 0 ? "$0" : p.amount}</span>
        {monthly > 0 && <span className="text-14 text-ink-3">{p.unit}</span>}
      </p>
      <p className="text-13 text-ink-4">{billing}{addsLicense ? ", incl. work license" : ""}</p>
      <p className="mt-4 text-14 leading-[1.5] text-ink-2">{LINE[id]}</p>
      <p className="num mt-1 text-13 text-ink-3">{spec}</p>
      <ul className="mt-5 flex flex-1 flex-col gap-2.5">
        {points(id, use === "work", desk?.botComputers ?? null, licenseOf(catalog, b.license)?.includedMembers ?? 1).map((pt) => <li key={pt} className="flex gap-2.5 text-14 leading-[1.4] text-ink-3"><Check size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-4" aria-hidden />{pt}</li>)}
      </ul>
      <Button variant={lead && !current ? "primary" : "outline"} className="mt-7 w-full" onClick={onChoose} disabled={disabled}>{action}</Button>
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
      <BuyCredits open={buying} onClose={() => setBuying(false)} />
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
  const [use, setUse] = useState<Use>(() => (owned && owned.license !== "personal" ? "work" : "personal"));
  const [planSheet, setPlanSheet] = useState<PaidPlan | null>(null);
  const [licenseSheet, setLicenseSheet] = useState<{ license: LicenseId; members: number } | null>(null);
  const [cancelling, setCancelling] = useState(false);

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
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-8 h-[140px] !rounded-card" />
        <div className="mt-8 grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[420px] !rounded-card" />)}</div>
      </div>
    );
  }

  const ownDesk = owned?.desktop ?? "none";
  const current = (id: "free" | "starter" | "pro") => (id === "free" ? ownDesk === "none" : bundleOf(catalog, id)?.desktop === ownDesk);
  const ownsLicense = Boolean(owned && owned.license !== "personal");
  const team = licenseOf(catalog, "team");
  const free = catalog.workFreeUntil && catalog.workFreeUntil > Date.now() ? catalog.workFreeUntil : null;
  const openLicense = (license: LicenseId = owned && owned.license !== "personal" ? owned.license : "starter", n = owned?.members ?? 1) => setLicenseSheet({ license, members: n });

  const freeAction = () => {
    if (!current("free")) return { label: "Switch to Free", go: () => setCancelling(true) };
    if (use === "work" && !ownsLicense) return { label: "Add a work license", go: () => openLicense("starter", 1) };
    return { label: "You're on Free", go: () => {} };
  };
  const fa = freeAction();
  const paid = (id: PaidPlan) => ({ label: current(id) ? "Current plan" : `${owned && ownDesk !== "none" ? "Switch to" : "Get"} ${bundleOf(catalog, id)?.name}`, go: () => setPlanSheet(id) });

  return (
    <div>
      <PageHeader title="Plans & billing" />
      <CloudPitch id="hero-title" title="Keep your bots working 24/7" body="Give them a cloud desktop of their own, so they keep going while your Mac sleeps. Set up in one click." action={false} link={null} />

      <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex flex-wrap gap-2">
          <Toggle<Use> label="Use" value={use} onChange={setUse} options={[{ value: "personal", label: "Personal" }, { value: "work", label: "Work" }]} />
          <IntervalToggle value={interval} onChange={setIv} catalog={catalog} />
        </div>
        <p className="text-13 text-ink-4 sm:ms-auto">Personal use is free forever.{free ? ` Work use is free until ${longDate(free)}.` : ""}</p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <PlanCard id="free" catalog={catalog} interval={interval} use={use} current={current("free")} lead={false} action={fa.label} onChoose={fa.go} disabled={fa.label === "You're on Free"} />
        <PlanCard id="starter" catalog={catalog} interval={interval} use={use} current={current("starter")} lead={false} action={paid("starter").label} onChoose={paid("starter").go} disabled={current("starter")} />
        <PlanCard id="pro" catalog={catalog} interval={interval} use={use} current={current("pro")} lead action={paid("pro").label} onChoose={paid("pro").go} disabled={current("pro")} />
      </div>

      <p className="mt-6 text-center text-13 text-ink-3">Cancel anytime <span aria-hidden className="text-ink-4">·</span> Set up in about a minute <span aria-hidden className="text-ink-4">·</span> Your data stays yours</p>
      <div className="mt-6 flex flex-col gap-1 border-t border-line pt-5 text-14 text-ink-3">
        {use === "work" && team && <p>Need it for a team? Team license with {team.includedMembers} members, <span className="num">{priceText(team.monthly, interval, catalog)}</span>. <button type="button" className="hover-link inline-flex h-9 items-center text-ink-2 underline decoration-line-2 underline-offset-4 max-sm:h-11" onClick={() => openLicense("team", team.includedMembers)}>Choose seats</button></p>}
        <p>Need a dedicated machine? <a href={CONTACT} className="hover-link inline-flex h-9 items-center text-ink-2 underline decoration-line-2 underline-offset-4 max-sm:h-11">Talk to us</a></p>
      </div>

      <Faq />
      <YourBilling catalog={catalog} onLicense={() => openLicense()} onCancelPlan={() => setCancelling(true)} />

      {planSheet && <PlanSheet start={planSheet} work={use === "work"} onClose={() => setPlanSheet(null)} />}
      {licenseSheet && <LicenseSheet start={licenseSheet} onClose={() => setLicenseSheet(null)} onNothingLeft={() => setCancelling(true)} />}
      <CancelDialog open={cancelling} onClose={() => setCancelling(false)} />
    </div>
  );
}
