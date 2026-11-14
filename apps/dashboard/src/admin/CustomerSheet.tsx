import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Check, Copy, X } from "@/icons";
import { Button, cx, Segmented } from "../ui/kit";
import { AnimatePresence, EASE_OUT, GLIDE, m } from "../ui/motion";
import { ago } from "../lib/format";
import { Link, useLocation, withBase } from "../lib/router";
import { useNow } from "../lib/now";
import { toast } from "../lib/toast";
import { AdminApiError, adminCall, useAdmin, type PlanChange, type PlanPreview, type PlanSubscription, type UserDetail } from "./api";
import { Avatar, usd } from "./kit";
import { Failed, Loading, n, stamp } from "./ui";
import { endLabel } from "./PlanEditor";
import type { MoneyMode } from "./revenue-types";

const DAY = 86_400_000;
const LIVE = ["active", "payment_problem", "cancelled"];
const PARAM = "customer";
const isoDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const shortDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }).toLowerCase();
const endOfDay = (value: string) => new Date(`${value}T23:59:59`).getTime();
const every = (interval: unknown) => interval === "year" ? "yearly" : "monthly";
const AUDIT: Record<string, string> = { "plan.interval": "billing period", "plan.set_end": "end date moved", "plan.grant": "plan given", "plan.change": "plan changed",
  "plan.cancel_now": "ended now", "plan.cancel_at_end": "set to end", "plan.keep": "kept going", "person.note": "note", "user.view": "viewed" };
const addMonths = (t: number, months: number) => { const d = new Date(t); d.setMonth(d.getMonth() + months); return d.getTime(); };

/** the page's own url with the customer card open on someone, so the link can be shared */
export function customerHref(accountId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, accountId);
  return url.pathname + url.search;
}
const notify = () => window.dispatchEvent(new PopStateEvent("popstate"));
/** opens the card in place: a history entry of its own, so back closes it, and no scroll jump */
export function openCustomer(accountId: string) {
  window.history.pushState({ customerCard: true }, "", customerHref(accountId));
  notify();
}
function closeCustomer() {
  if ((window.history.state as { customerCard?: boolean } | null)?.customerCard) { window.history.back(); return; }
  const url = new URL(window.location.href);
  url.searchParams.delete(PARAM);
  window.history.replaceState(null, "", url.pathname + url.search);
  notify();
}

/** a row that opens the customer card here; a new tab or window still gets the shareable url */
export function CustomerLink({ accountId, className, children }: { accountId: string; className?: string; children: ReactNode }) {
  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openCustomer(accountId);
  };
  return <a href={withBase(customerHref(accountId))} onClick={go} className={className}>{children}</a>;
}

/** test money gets a small chip wherever it shows; live money needs none */
export function ModeChip({ mode, live }: { mode: MoneyMode | undefined; live?: boolean }) {
  if (mode !== "test" && !live) return null;
  return <span className={cx("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11.5px]", mode === "test" ? "bg-wash-lemon text-ink-2" : "bg-card text-ink-3")}
    title={mode === "test" ? "dodo test mode: no real money" : "live money"}>{mode === "test" ? "test" : "live"}</span>;
}

/** the customer card, on whatever admin page carries ?customer= */
export function CustomerSheetHost() {
  const { query } = useLocation();
  const id = query.get(PARAM);
  return createPortal(<AnimatePresence>{id && <Sheet key="customer" id={id} />}</AnimatePresence>, document.body);
}

function Sheet({ id }: { id: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // a confirm step in progress takes escape first, so escape never skips past it
  const pending = useRef<(() => void) | null>(null);
  const close = useCallback(() => closeCustomer(), []);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[data-close]")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); if (pending.current) pending.current(); else close(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, textarea, a[href]")];
      if (!items.length) return;
      const [a, z] = [items[0]!, items[items.length - 1]!];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; back?.focus({ preventScroll: true }); };
  }, [close]);
  const { data, error, reload, setData } = useAdmin<UserDetail>(`/users/${encodeURIComponent(id)}`);
  return (
    <div className="fixed inset-0 z-50">
      <m.div className="absolute inset-0" style={{ background: "var(--scrim)" }} onClick={close} aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} />
      <m.div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 flex w-[min(540px,100vw)] flex-col overflow-y-auto overscroll-contain rounded-s-[28px] bg-pop px-6 pb-8 pt-5 max-sm:rounded-none max-sm:px-4"
        style={{ boxShadow: "var(--pop-shadow)" }}
        initial={{ x: 48, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 48, opacity: 0, transition: { duration: 0.16, ease: EASE_OUT } }} transition={GLIDE}>
        <div className="flex items-center justify-between gap-3">
          <span className="t-meta">customer</span>
          <button data-close type="button" onClick={close} aria-label="close" className="press hover-ghost -me-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-3"><X size={18} strokeWidth={1.5} /></button>
        </div>
        {error && <div className="mt-4"><Failed error={error.status === 404 ? { message: "this account is gone. its payments stay in the revenue numbers." } : error} retry={reload} /></div>}
        {!data && !error && <div className="mt-4"><Loading rows={6} /></div>}
        {data && <Body detail={data} titleId={titleId} onChange={setData} pending={pending} />}
      </m.div>
    </div>
  );
}

function CopyEmail({ email }: { email: string }) {
  const [done, setDone] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(email).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => toast("couldn't copy. select the address instead.", "bad"));
  return (
    <button type="button" onClick={copy} aria-label={done ? "copied" : `copy ${email}`} className="press hover-ghost grid size-8 shrink-0 place-items-center rounded-full text-ink-3">
      {done ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />}
    </button>
  );
}

function Cell({ label, value, note, money }: { label: string; value: ReactNode; note?: ReactNode; money?: boolean }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="truncate text-12 text-ink-3">{label}</div>
      <div className={cx("mt-0.5 truncate text-15 font-medium", money ? "font-mono text-money num" : "text-ink")}>{value}</div>
      {note && <div className="truncate text-12 text-ink-4">{note}</div>}
    </div>
  );
}

function Body({ detail, titleId, onChange, pending }: { detail: UserDetail; titleId: string; onChange(next: UserDetail): void; pending: MutableRefObject<(() => void) | null> }) {
  const now = useNow(60_000);
  const a = detail.account;
  const live = detail.subscriptions.filter((sub) => LIVE.includes(sub.status)).sort((x, y) => y.createdAt - x.createdAt)[0] ?? null;
  const paid = detail.payments.filter((pay) => pay.status === "paid");
  const lifetime = paid.reduce((sum, pay) => sum + pay.amountCents, 0);
  const mrr = live && !live.comp ? (live.interval === "year" ? Math.round(live.totalCents / 12) : live.totalCents) : 0;
  const [all, setAll] = useState(false);
  const payments = all ? detail.payments : detail.payments.slice(0, 6);
  return (
    <>
      <div className="mt-2 flex items-center gap-3.5">
        <Avatar seed={a.id} size={48} customer={!!live && !live.comp} account={{ id: a.id }} />
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-20 font-medium tracking-[-0.03em] text-ink">{a.name ?? a.email}</h2>
          <div className="flex min-w-0 items-center gap-1">
            <a href={`mailto:${a.email}`} className="text-link min-w-0 truncate text-14">{a.email}</a>
            <CopyEmail email={a.email} />
          </div>
        </div>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-12 text-ink-4">
        <span>signed up {shortDay(a.createdAt)}</span>
        <span>seen {ago(a.lastSeenAt, now).toLowerCase()}</span>
        <span className="t-id">{a.id}</span>
      </p>

      <div className="mt-5 grid grid-cols-2 rounded-[18px] bg-card">
        <Cell label="plan" value={<span className="inline-flex items-center gap-2">{live ? live.plan ?? "custom" : "free"}{live && <ModeChip mode={live.mode} live />}</span>}
          note={live ? (live.comp ? "comp, no billing" : `billed ${live.interval === "year" ? "yearly" : "monthly"}`) : "no plan right now"} />
        <Cell label="mrr" value={usd(mrr)} money note={live && !live.comp ? `${usd(live.totalCents)} a ${live.interval}` : undefined} />
        <Cell label="lifetime" value={usd(lifetime)} money note={`${n(paid.length)} payment${paid.length === 1 ? "" : "s"}`} />
        <Cell label={live?.cancelAtPeriodEnd ? "ends" : live?.comp ? "comp ends" : "renews"} value={live ? (live.openEnded ? "open-ended" : live.periodEnd ? shortDay(live.periodEnd) : "-") : "-"}
          note={live ? live.status.replace(/_/g, " ") : undefined} />
      </div>

      <PlanLength detail={detail} live={live} onChange={onChange} pending={pending} />

      <section aria-labelledby="sheet-payments" className="mt-5">
        <h3 id="sheet-payments" className="px-1 text-13 font-medium text-ink">payments</h3>
        {detail.payments.length ? (
          <ul className="mt-1.5 rounded-[18px] bg-card p-1">
            {payments.map((pay) => (
              <li key={pay.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto_auto] items-center gap-2.5 px-2 py-1.5 text-13">
                <span className="font-mono text-12 text-ink-4 num">{shortDay(pay.createdAt)}</span>
                <span className="flex min-w-0 items-center gap-1.5"><span className="truncate text-ink-2">{pay.description || "payment"}</span><ModeChip mode={pay.mode} /></span>
                <span className="text-12 text-ink-3">{pay.status}</span>
                <span className={cx("w-16 text-end font-mono num", pay.status === "paid" && pay.amountCents > 0 ? "font-medium text-money" : "text-ink-3")}>{usd(pay.amountCents)}</span>
              </li>
            ))}
            {detail.payments.length > 6 && <li><button type="button" onClick={() => setAll((v) => !v)} className="text-link mx-auto block h-8 px-3 text-12">{all ? "show fewer" : `show all ${detail.payments.length}`}</button></li>}
          </ul>
        ) : <p className="mt-1.5 rounded-[18px] bg-card px-3 py-4 text-13 text-ink-3">no payments yet.</p>}
      </section>

      {detail.audit.length > 0 && (
        <section aria-labelledby="sheet-changes" className="mt-5">
          <h3 id="sheet-changes" className="px-1 text-13 font-medium text-ink">recent changes</h3>
          <ol className="mt-1.5 rounded-[18px] bg-card p-1">
            {detail.audit.slice(0, 5).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 px-2 py-1.5 text-13">
                <span className="text-ink">{AUDIT[entry.action] ?? entry.action.replace(/^plan\./, "").replace(/[._]/g, " ")}</span>
                {entry.action === "plan.interval" && typeof entry.detail.interval === "string" ? <span className="min-w-0 text-ink-3">{every(entry.detail.from)} <span aria-hidden>→</span><span className="sr-only">to</span> {every(entry.detail.interval)}</span>
                  : (typeof entry.detail.before === "string" || typeof entry.detail.after === "string") && <span className="min-w-0 text-ink-3">{String(entry.detail.before ?? "")} <span aria-hidden>→</span><span className="sr-only">to</span> {String(entry.detail.after ?? "")}</span>}
                {entry.detail.ok === false && <span className="text-bad">failed</span>}
                <span className="ms-auto shrink-0 text-12 text-ink-4" title={stamp(entry.at)}>{entry.actorEmail ?? "someone"} · {ago(entry.at, now).toLowerCase()}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <Link to={`/admin/users/${encodeURIComponent(a.id)}`} className="text-link mt-6 inline-flex items-center gap-1.5 self-start text-13">full page, with clouds, devices and every plan action <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden /></Link>
    </>
  );
}

const CODES: Record<string, string> = {
  comp_no_billing: "a comp has no billing period. move its end date instead.",
  not_active: "only an active plan that isn't set to cancel can change how often it bills.",
  already_on_plan: "they already pay that often.",
  plan_change_unavailable: "that change can't be made on this plan right now.",
  not_subscribed: "they have no live plan to change.",
  grants_unavailable: "this server can't move that date.",
  unavailable: "dodo didn't answer. nothing changed. try again.",
  invalid_request: "pick a date after today.",
};
const reason = (err: unknown) => err instanceof AdminApiError ? CODES[err.code ?? ""] ?? err.message.toLowerCase() : "that didn't work. try again.";

/** how long they pay for: monthly or yearly, and when the period (or a comp) ends; every change is shown exactly, then confirmed */
function PlanLength({ detail, live, onChange, pending }: { detail: UserDetail; live: PlanSubscription | null; onChange(next: UserDetail): void; pending: MutableRefObject<(() => void) | null> }) {
  const dateId = useId();
  const [change, setChange] = useState<PlanChange | null>(null);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<number | null>(null);
  const cancel = useCallback(() => { setChange(null); setPreview(null); setError(null); }, []);
  useEffect(() => { pending.current = preview ? cancel : null; return () => { pending.current = null; }; }, [preview, cancel, pending]);
  if (!live) return <p className="mt-5 rounded-[18px] bg-card px-4 py-3.5 text-13 text-ink-3">no live plan, so nothing to lengthen. give one from the full page.</p>;
  const path = `/users/${encodeURIComponent(detail.account.id)}/plan`;
  const review = async (body: PlanChange) => {
    setBusy("preview"); setError(null); setChange(body);
    try { setPreview(await adminCall<PlanPreview>(`${path}/preview`, { body })); }
    catch (err) { setError(reason(err)); setChange(null); }
    finally { setBusy(null); }
  };
  const confirm = async () => {
    if (!change) return;
    setBusy("save"); setError(null);
    try {
      const next = await adminCall<UserDetail>(path, { body: change });
      onChange(next); setPreview(null); setChange(null); setDate(null);
      toast(change.action === "interval" ? `now billed ${change.interval === "year" ? "yearly" : "monthly"}.` : "date moved.");
    } catch (err) { setError(reason(err)); }
    finally { setBusy(null); }
  };
  const current = live.openEnded ? null : live.periodEnd;
  const base = Math.max(current ?? Date.now(), Date.now());
  const shift = (months: number) => setDate(addMonths(date ?? base, months));
  const chosen = date ?? current;
  const canPick = !preview && busy === null;
  const dodo = detail.billing.provider === "dodo";
  return (
    <section aria-labelledby="sheet-length" className="mt-5 rounded-[18px] bg-card p-1.5">
      <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
        <h3 id="sheet-length" className="text-13 font-medium text-ink">plan length</h3>
        <span className="t-meta">{endLabel(live)}</span>
      </div>
      <div className="rounded-[14px] bg-pop px-3 py-1">
        {!live.comp && (
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span className="text-13 text-ink-2">billed</span>
            <Segmented<"month" | "year"> label="billing period" value={change?.action === "interval" ? change.interval : live.interval}
              onChange={(v) => { if (canPick && v !== live.interval && !live.cancelAtPeriodEnd) void review({ action: "interval", interval: v, subscription: live.id }); }}
              options={[{ value: "month", label: "monthly" }, { value: "year", label: "yearly" }]} />
          </div>
        )}
        <div className="py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={dateId} className="text-13 text-ink-2">{live.comp ? "comp ends" : "next renewal"}</label>
            <input id={dateId} type="date" min={isoDay(Date.now() + DAY)} value={chosen ? isoDay(chosen) : ""} disabled={!canPick}
              onChange={(e) => { if (e.target.value) setDate(endOfDay(e.target.value)); }} className="field !h-9 !w-[156px] !px-3 !text-13" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <button type="button" disabled={!canPick} onClick={() => shift(-1)} className="hover-ghost h-8 rounded-full px-3 text-12 text-ink-2 disabled:opacity-50">-1 month</button>
            <button type="button" disabled={!canPick} onClick={() => shift(1)} className="hover-ghost h-8 rounded-full px-3 text-12 text-ink-2 disabled:opacity-50">+1 month</button>
            <button type="button" disabled={!canPick} onClick={() => shift(12)} className="hover-ghost h-8 rounded-full px-3 text-12 text-ink-2 disabled:opacity-50">+1 year</button>
            {live.comp && !live.openEnded && <button type="button" disabled={!canPick} onClick={() => void review({ action: "set_end", until: null, subscription: live.id })} className="hover-ghost h-8 rounded-full px-3 text-12 text-ink-2 disabled:opacity-50">open-ended</button>}
            {date !== null && date !== current && !preview && (
              <Button size="sm" variant="primary" className="ms-auto" disabled={busy !== null || date <= Date.now()} aria-busy={busy === "preview"}
                onClick={() => void review({ action: "set_end", until: date, subscription: live.id })}>{busy === "preview" ? "checking" : "review change"}</Button>
            )}
          </div>
          {date !== null && date <= Date.now() && <p className="mt-1.5 text-12 text-bad" role="alert">pick a day after today.</p>}
        </div>
        <AnimatePresence initial={false}>
          {preview && (
            <m.div key="confirm" className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", visualDuration: 0.24, bounce: 0 }}>
              <div className="mb-2.5 rounded-[12px] bg-wash-lemon p-3" role="group" aria-label="confirm the change">
                <p className="text-13 font-medium text-ink">confirm this change</p>
                <dl className="mt-1.5 grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 gap-y-1 text-13">
                  <dt className="text-ink-3">now</dt><dd className="text-ink-2">{preview.before}</dd>
                  <dt className="text-ink-3">after</dt><dd className="font-medium text-ink">{preview.after}</dd>
                  {preview.chargeNowCents !== null && preview.chargeNowCents > 0 && <><dt className="text-ink-3">charge</dt><dd className="font-mono text-ink num">{usd(preview.chargeNowCents)} now</dd></>}
                </dl>
                <ul className="mt-2 flex flex-col gap-0.5 text-12 text-ink-2">{preview.effects.map((line) => <li key={line}>{line}</li>)}</ul>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="primary" disabled={busy !== null} aria-busy={busy === "save"} onClick={() => void confirm()}>{busy === "save" ? "saving" : "confirm change"}</Button>
                  <Button size="sm" variant="ghost" disabled={busy === "save"} onClick={cancel}>cancel</Button>
                </div>
              </div>
            </m.div>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {error && <m.p key="error" role="alert" className="pb-2.5 text-13 text-bad" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{error}</m.p>}
        </AnimatePresence>
      </div>
      <p className="px-2 pb-1 pt-2 text-12 text-ink-4">
        {live.comp ? "a comp has no billing, so only its end date here moves." : dodo ? "changes go through dodo first. a billing period change charges or credits the difference; moving the renewal charges nothing now." : "billing here runs on a test provider; nothing real is charged."}
        {" "}every change is kept in the audit log.
      </p>
    </section>
  );
}
