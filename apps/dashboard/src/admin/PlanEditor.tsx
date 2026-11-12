import { useId, useState, type ReactNode } from "react";
import { Button, Segmented } from "../ui/kit";
import { AnimatePresence, EASE_OUT, m } from "../ui/motion";
import { ago } from "../lib/format";
import { toast } from "../lib/toast";
import { adminCall, AdminApiError, type AuditEntry, type PlanChange, type PlanSubscription, type UserDetail } from "./api";
import { money, stamp, Status } from "./ui";

const DAY = 86_400_000;
const LIVE = ["active", "payment_problem", "cancelled"];
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const endOfDay = (value: string) => new Date(`${value}T23:59:59`).getTime();
const addMonths = (t: number, months: number) => { const d = new Date(t); d.setMonth(d.getMonth() + months); return d.getTime(); };

const CODES: Record<string, string> = {
  not_subscribed: "they have no live plan to change.",
  already_subscribed: "they already have a plan. change it instead.",
  grants_unavailable: "this server can't hand out plans: payments run through the payment provider here.",
  already_on_plan: "they're already on that plan.",
  plan_change_unavailable: "that move needs a different kind of cloud. end the plan now, then give the new one.",
  seats_full: "their team has more members than that plan allows.",
  invalid_request: "that date or plan didn't work. pick a date after today.",
};
const ACTION: Record<string, string> = {
  "plan.grant": "gave a plan", "plan.change": "changed the plan", "plan.set_end": "moved the end date", "plan.cancel_now": "ended the plan now",
  "plan.cancel_at_end": "set it to end at the period end", "plan.keep": "kept the plan going", "person.note": "note",
  "cloud.pause": "paused a cloud", "cloud.resume": "resumed a cloud", "cloud.delete": "deleted a cloud",
};

export function endLabel(sub: Pick<PlanSubscription, "openEnded" | "periodEnd" | "cancelAtPeriodEnd" | "status">) {
  if (sub.status === "ended") return "ended";
  if (sub.openEnded) return "open-ended";
  if (sub.periodEnd === null) return "no end date";
  return `${sub.cancelAtPeriodEnd ? "ends" : "runs until"} ${day(sub.periodEnd)}`;
}

/** a button that asks once more in place: the row swaps to a short question and two answers */
function Confirm({ label, question, yes, onYes, danger, disabled }: { label: string; question: string; yes: string; onYes(): void; danger?: boolean; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {armed ? (
        <m.span key="ask" className="inline-flex flex-wrap items-center gap-2" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
          <span className="text-13 text-ink-2" role="status">{question}</span>
          <Button size="sm" variant={danger ? "danger" : "primary"} disabled={disabled} onClick={() => { setArmed(false); onYes(); }}>{yes}</Button>
          <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>keep it</Button>
        </m.span>
      ) : (
        <m.span key="ask-button" className="inline-flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
          <Button size="sm" variant={danger ? "danger" : "outline"} disabled={disabled} onClick={() => setArmed(true)}>{label}</Button>
        </m.span>
      )}
    </AnimatePresence>
  );
}

/** open-ended, or a day after today; the presets add to the current end */
function EndPicker({ value, onChange, from }: { value: number | null; onChange(value: number | null): void; from: number }) {
  const id = useId();
  const min = day(Date.now() + DAY);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<"open" | "date"> label="how long" value={value === null ? "open" : "date"} onChange={(v) => onChange(v === "open" ? null : addMonths(Math.max(from, Date.now()), 1))}
        options={[{ value: "open", label: "open-ended" }, { value: "date", label: "until a date" }]} />
      <AnimatePresence initial={false}>
        {value !== null && (
          <m.span key="date" className="inline-flex flex-wrap items-center gap-1.5" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6, transition: { duration: 0.12, ease: EASE_OUT } }}>
            <label htmlFor={id} className="sr-only">ends on</label>
            <input id={id} type="date" min={min} value={day(value)} onChange={(e) => { if (e.target.value) onChange(endOfDay(e.target.value)); }} className="field !h-9 !w-[156px] !px-3 !text-13" />
            <button type="button" onClick={() => onChange(addMonths(value, 1))} className="hover-ghost h-9 rounded-full px-3 text-13 text-ink-2">+1 month</button>
            <button type="button" onClick={() => onChange(addMonths(value, 12))} className="hover-ghost h-9 rounded-full px-3 text-13 text-ink-2">+1 year</button>
          </m.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-3 py-3 max-sm:grid-cols-1 max-sm:gap-1.5">
      <span className="pt-2 text-13 text-ink-3 max-sm:pt-0">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** everything about one person's plan, and every change to it, in one card */
export function PlanEditor({ detail, onChange }: { detail: UserDetail; onChange(next: UserDetail): void }) {
  const live = detail.subscriptions.filter((sub) => LIVE.includes(sub.status)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  const paid = detail.billing.plans.filter((plan) => plan.id !== "free");
  const [plan, setPlan] = useState(paid[0]?.id ?? "starter");
  const [until, setUntil] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const noteId = useId();
  const comps = detail.billing.provider !== "dodo";
  const run = async (key: string, body: PlanChange, done: string) => {
    setBusy(key); setError(null);
    try {
      const next = await adminCall<UserDetail>(`/users/${encodeURIComponent(detail.account.id)}/plan`, { body });
      onChange(next); setEnd(undefined); toast(done);
      return true;
    } catch (err) {
      setError(err instanceof AdminApiError ? CODES[err.code ?? ""] ?? err.message : "that didn't work. try again.");
      return false;
    } finally { setBusy(null); }
  };
  const label = (id: string) => detail.billing.plans.find((p) => p.id === id)?.label ?? id;
  const pendingEnd = end === undefined ? (live ? (live.openEnded ? null : live.periodEnd) : null) : end;
  const endChanged = live !== null && end !== undefined && !(end === null ? live.openEnded : !live.openEnded && end === live.periodEnd);
  return (
    <section aria-labelledby="plan-title" className="rounded-[24px] bg-card p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <h2 id="plan-title" className="inline-flex h-8 items-center text-14 font-medium text-ink">plan</h2>
        {comps && <span className="tag" title="no money changes hands for plans set here">payments aren't live: every plan here is a free comp</span>}
      </div>
      <div className="rounded-[18px] bg-pop px-4 py-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-3">
          <span className="text-[22px] font-medium tracking-[-0.03em] text-ink">{live ? live.plan ?? "custom" : "free"}</span>
          {live && <Status value={live.status} label={live.cancelAtPeriodEnd ? "cancelling" : live.status.replace(/_/g, " ")} />}
          {live && <span className="text-13 text-ink-3">{endLabel(live)}{live.comp ? " · comp" : ` · ${money(live.totalCents)} a ${live.interval}`}</span>}
          {!live && <span className="text-13 text-ink-3">no plan right now</span>}
        </div>
        {!detail.billing.grants && <p className="py-3 text-13 text-ink-3">this server can't hand out plans (billing runs on {detail.billing.provider}). changes to existing plans still work where the provider allows.</p>}
        {!live ? (
          <>
            <Line label="give them">
              <Segmented label="plan to give" value={plan} onChange={setPlan} options={paid.map((p) => ({ value: p.id, label: p.label }))} />
            </Line>
            <Line label="for">
              <EndPicker value={until} onChange={setUntil} from={Date.now()} />
            </Line>
            <Line label="">
              <Button variant="primary" size="sm" disabled={!detail.billing.grants || busy !== null} aria-busy={busy === "grant"} onClick={() => void run("grant", { action: "grant", plan, until }, `gave ${label(plan)}${until === null ? ", open-ended" : ` until ${day(until)}`}.`)}>
                {busy === "grant" ? "giving" : `give ${label(plan)}`}
              </Button>
            </Line>
          </>
        ) : (
          <>
            <Line label="plan">
              <div className="flex flex-wrap items-center gap-2">
                {detail.billing.plans.filter((p) => p.id !== live.bundle).map((p) => (
                  <Confirm key={p.id} label={p.id === "free" ? "move to free" : `move to ${p.label}`} danger={p.id === "free"} disabled={busy !== null}
                    question={p.id === "free" ? "end their plan now?" : `move them to ${p.label}?`} yes={p.id === "free" ? "end it" : "move"}
                    onYes={() => void run(`change:${p.id}`, { action: "change", plan: p.id, subscription: live.id }, p.id === "free" ? "plan ended." : `moved to ${p.label}.`)} />
                ))}
              </div>
            </Line>
            {live.status !== "ended" && (
              <Line label="ends">
                <EndPicker value={pendingEnd} onChange={setEnd} from={live.periodEnd ?? Date.now()} />
                <AnimatePresence initial={false}>
                  {endChanged && (
                    <m.div key="save" className="mt-2 flex items-center gap-2" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
                      <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void run("end", { action: "set_end", until: end ?? null, subscription: live.id }, end === null ? "now open-ended." : `now runs until ${day(end!)}.`)}>{busy === "end" ? "saving" : "save end date"}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEnd(undefined)}>undo</Button>
                    </m.div>
                  )}
                </AnimatePresence>
              </Line>
            )}
            <Line label="stop">
              <div className="flex flex-wrap items-center gap-2">
                {live.cancelAtPeriodEnd
                  ? <Button size="sm" disabled={busy !== null} onClick={() => void run("keep", { action: "keep", subscription: live.id }, "kept going.")}>keep it going</Button>
                  : !live.openEnded && <Confirm label="end at period end" question={`end on ${live.periodEnd ? day(live.periodEnd) : "the period end"}?`} yes="end then" disabled={busy !== null}
                    onYes={() => void run("cancel-end", { action: "cancel", when: "period_end", subscription: live.id }, "ends at the period end.")} />}
                <Confirm label="end now" danger question="end it now? their cloud stops and is kept 30 days." yes="end now" disabled={busy !== null}
                  onYes={() => void run("cancel-now", { action: "cancel", when: "now", subscription: live.id }, "plan ended.")} />
              </div>
            </Line>
          </>
        )}
        <AnimatePresence initial={false}>
          {error && <m.p key="error" role="alert" className="pb-3 text-13 text-bad" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{error}</m.p>}
        </AnimatePresence>
      </div>
      <form className="mt-1.5 flex items-end gap-2 rounded-[18px] bg-pop p-3" onSubmit={(e) => { e.preventDefault(); const text = note.trim(); if (text) void run("note", { action: "note", text }, "note added.").then((ok) => { if (ok) setNote(""); }); }}>
        <div className="min-w-0 flex-1">
          <label htmlFor={noteId} className="mb-1.5 block text-13 text-ink-2">add a note</label>
          <textarea id={noteId} value={note} maxLength={500} rows={1} onChange={(e) => setNote(e.target.value)} placeholder="why this comp, what they asked for" className="field !h-auto min-h-10 resize-y !py-2 !text-14" />
        </div>
        <Button type="submit" size="sm" disabled={!note.trim() || busy !== null}>{busy === "note" ? "adding" : "add"}</Button>
      </form>
      <AuditList entries={detail.audit} />
    </section>
  );
}

function AuditList({ entries }: { entries: AuditEntry[] }) {
  const now = Date.now();
  return (
    <div className="mt-1.5 rounded-[18px] bg-pop p-3">
      <h3 className="text-13 font-medium text-ink">changes and notes</h3>
      {entries.length ? (
        <ol className="mt-1 divide-y divide-line">
          <AnimatePresence initial={false}>
            {entries.map((entry) => {
              const d = entry.detail;
              return (
                <m.li key={entry.id} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-13">
                  <span className="text-ink">{ACTION[entry.action] ?? entry.action.replace(/[._]/g, " ")}</span>
                  {typeof d.text === "string" ? <span className="min-w-0 basis-full text-ink-2">{d.text}</span>
                    : (typeof d.before === "string" || typeof d.after === "string") && <span className="min-w-0 text-ink-3">{String(d.before ?? "")} <span aria-hidden>→</span><span className="sr-only">to</span> {String(d.after ?? "")}</span>}
                  {d.ok === false && <span className="text-bad">failed{typeof d.code === "string" ? `: ${d.code.replace(/_/g, " ")}` : ""}</span>}
                  <span className="ms-auto shrink-0 text-12 text-ink-4" title={stamp(entry.at)}>{entry.actorEmail ?? "someone"} · {ago(entry.at, now)}</span>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ol>
      ) : <p className="mt-1 text-13 text-ink-3">no changes yet. anything you do here is kept with who did it.</p>}
    </div>
  );
}
