import { useCallback, useEffect, useId, useState, type MutableRefObject, type ReactNode } from "react";
import { Check, Copy } from "@/icons";
import { Button, cx, Segmented } from "../ui/kit";
import { AnimatePresence, m } from "../ui/motion";
import { CardLink } from "./sheet";
import { toast } from "../lib/toast";
import { AdminApiError, adminCall, type PlanChange, type PlanPreview, type PlanSubscription, type UserDetail } from "./api";
import { usd } from "./kit";
import { endLabel } from "./PlanEditor";
import type { MoneyMode } from "./revenue-types";

const DAY = 86_400_000;
const isoDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const endOfDay = (value: string) => new Date(`${value}T23:59:59`).getTime();
const addMonths = (t: number, months: number) => { const d = new Date(t); d.setMonth(d.getMonth() + months); return d.getTime(); };

/** a row that opens the customer card here */
export const CustomerLink = ({ accountId, ...rest }: { accountId: string; className?: string; children: ReactNode }) => <CardLink param="person" id={accountId} {...rest} />;

/** test money gets a small chip wherever it shows; live money needs none */
export function ModeChip({ mode, live }: { mode: MoneyMode | undefined; live?: boolean }) {
  if (mode !== "test" && !live) return null;
  return <span className={cx("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11.5px]", mode === "test" ? "bg-wash-lemon text-ink-2" : "bg-card text-ink-3")}
    title={mode === "test" ? "dodo test mode: no real money" : "live money"}>{mode === "test" ? "test" : "live"}</span>;
}

export function CopyEmail({ email }: { email: string }) {
  const [done, setDone] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(email).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => toast("couldn't copy. select the address instead.", "bad"));
  return (
    <button type="button" onClick={copy} aria-label={done ? "copied" : `copy ${email}`} className="press hover-ghost grid size-8 shrink-0 place-items-center rounded-full text-ink-3">
      {done ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />}
    </button>
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
export function PlanLength({ detail, live, onChange, pending }: { detail: UserDetail; live: PlanSubscription | null; onChange(next: UserDetail): void; pending: MutableRefObject<(() => void) | null> }) {
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
  const free = live.comp && !live.dodo;
  const current = live.openEnded ? null : live.periodEnd;
  const base = Math.max(current ?? Date.now(), Date.now());
  const shift = (months: number) => setDate(addMonths(date ?? base, months));
  const chosen = date ?? current;
  const canPick = !preview && busy === null;
  const dodo = !!live.dodo;
  return (
    <section aria-labelledby="sheet-length" className="mt-5 rounded-[18px] bg-card p-1.5">
      <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
        <h3 id="sheet-length" className="text-13 font-medium text-ink">plan length</h3>
        <span className="t-meta">{endLabel(live)}</span>
      </div>
      <div className="rounded-[14px] bg-pop px-3 py-1">
        {!free && (
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span className="text-13 text-ink-2">billed</span>
            <Segmented<"month" | "year"> label="billing period" value={change?.action === "interval" ? change.interval : live.interval}
              onChange={(v) => { if (canPick && v !== live.interval && !live.cancelAtPeriodEnd) void review({ action: "interval", interval: v, subscription: live.id }); }}
              options={[{ value: "month", label: "monthly" }, { value: "year", label: "yearly" }]} />
          </div>
        )}
        <div className="py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={dateId} className="text-13 text-ink-2">{free ? "comp ends" : "next renewal"}</label>
            <input id={dateId} type="date" min={isoDay(Date.now() + DAY)} value={chosen ? isoDay(chosen) : ""} disabled={!canPick}
              onChange={(e) => { if (e.target.value) setDate(endOfDay(e.target.value)); }} className="field !h-9 !w-[156px] !px-3 !text-13" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <button type="button" disabled={!canPick} onClick={() => shift(-1)} className="hover-ghost h-8 rounded-full px-3 text-12 text-ink-2 disabled:opacity-50">-1 month</button>
            <button type="button" disabled={!canPick} onClick={() => shift(1)} className="hover-ghost h-8 rounded-full px-3 text-12 text-ink-2 disabled:opacity-50">+1 month</button>
            <button type="button" disabled={!canPick} onClick={() => shift(12)} className="hover-ghost h-8 rounded-full px-3 text-12 text-ink-2 disabled:opacity-50">+1 year</button>
            {free && !live.openEnded && <button type="button" disabled={!canPick} onClick={() => void review({ action: "set_end", until: null, subscription: live.id })} className="hover-ghost h-8 rounded-full px-3 text-12 text-ink-2 disabled:opacity-50">open-ended</button>}
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
        {free ? "a comp has no billing, so only its end date here moves." : dodo ? "changes go through dodo first. a billing period change charges or credits the difference; moving the renewal charges nothing now." : "billing here runs on a test provider; nothing real is charged."}
        {" "}every change is kept in the audit log.
      </p>
    </section>
  );
}
