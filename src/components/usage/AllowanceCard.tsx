import { useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  addForWeek, dismissAllowance, fetchAllowance, resetIn, resetWhen, saveAllowance, saveAutoTopUp, setSaver, sharePercent, topUpOffer, useLoaded,
  type AllowanceReport,
} from "@/lib/spend";
import { useServerHas, whenServerHas } from "@/lib/server-compat";
import { formatCost } from "@/lib/usage-trace";
import { api } from "@/state/store";
import { buttonCls, fieldCls } from "../bot-panel/rows";
import { Card as RowsCard, NoteRow, rowCls, SwitchRow } from "../ListRows";
import { Art } from "../ui/Art";

const amountOf = (text: string) => { const value = Number(text); return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null; };

/** A dollar amount typed in place: shown, saved or cancelled. */
function AmountForm({ label, initial, hint, onSave, onCancel, busy }: { label: string; initial?: number; hint?: string; onSave: (usd: number) => void; onCancel: () => void; busy: boolean }) {
  const [text, setText] = useState(initial ? String(initial) : "");
  const [bad, setBad] = useState(false);
  return (
    <form className="flex flex-col gap-1.5 px-2 py-1.5" onSubmit={(event) => { event.preventDefault(); const usd = amountOf(text); if (usd === null) return setBad(true); onSave(usd); }}>
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-[13px] text-ink-secondary">$</span>
        <input autoFocus inputMode="decimal" aria-label={label} aria-invalid={bad || undefined} value={text} placeholder="20"
          onChange={(event) => { setBad(false); setText(event.target.value.replace(/[^\d.]/g, "")); }} className={cn(fieldCls, "max-w-24 flex-none tabular-nums", bad && "border-danger")} />
        <span className="text-[13px] text-ink-secondary">{label}</span>
        <button type="submit" disabled={busy} className={buttonCls}>{t("usage.cap.save")}</button>
        <button type="button" onClick={onCancel} className={buttonCls}>{t("common.cancel")}</button>
      </div>
      {hint && <p className="m-0 text-[12px] leading-4 text-ink-secondary">{hint}</p>}
      {bad && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{t("usage.cap.invalid")}</p>}
    </form>
  );
}

function names(report: AllowanceReport): string {
  const [first, second] = report.top.map((one) => t("usage.allowance.spender", { name: one.name, amount: formatCost(one.usd) }));
  return second ? t("usage.allowance.topTwo", { first: first!, second }) : first ?? "";
}

/** The account's one weekly allowance in dollars: "$1.80 of $6.00 · resets Monday" (tap for %), the one 80% notice
 * with its choices, the soft landing at 100%, Saver mode and auto top-up (off unless the person turns it on). */
const loadAllowance = () => whenServerHas("allowance", fetchAllowance);

export function AllowanceCard() {
  const [version, setVersion] = useState(0);
  const supported = useServerHas("allowance");
  const loaded = useLoaded(loadAllowance, version);
  const [report, setReport] = useState<AllowanceReport | null>(null);
  const [editing, setEditing] = useState<"weekly" | "auto" | null>(null);
  const [percent, setPercent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = report ?? loaded;

  const act = async (change: () => Promise<AllowanceReport>) => {
    setBusy(true);
    setError(null);
    try { setReport(await change()); setEditing(null); setVersion((n) => n + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  if (supported === false) return null;
  if (!shown) return <RowsCard label={t("usage.allowance.title")} data-settings-block="allowance"><NoteRow>{t("common.checking")}</NoteRow></RowsCard>;
  const set = shown.limitUsd !== null;
  const over = shown.level === "over", near = shown.level === "near";
  const offer = shown.weeklyUsd ? topUpOffer(shown.weeklyUsd) : 0;
  const resets = resetWhen(shown.resetAt);
  const pauseTop = shown.top.find((one) => one.kind === "routine");

  return (
    <RowsCard label={t("usage.allowance.title")} data-settings-block="allowance"
      footnote={set ? t("usage.allowance.footnote") : undefined}>
      {!set && editing !== "weekly" && (
        <div className="flex items-center gap-3 px-2 py-2" data-allowance="none">
          <Art name="coins" className="size-8 shrink-0 object-contain" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-[18px] text-ink">{t("usage.allowance.noneTitle")}</span>
            <span className="block text-[12px] leading-4 text-ink-secondary">{t("usage.allowance.none")}</span>
          </span>
          <button type="button" className={cn(buttonCls, "shrink-0")} onClick={() => setEditing("weekly")}>{t("usage.allowance.set")}</button>
        </div>
      )}
      {editing === "weekly" && (
        <AmountForm label={t("usage.cap.perWeek")} initial={shown.weeklyUsd ?? undefined} hint={t("usage.allowance.hint")} busy={busy}
          onSave={(usd) => void act(() => saveAllowance(usd))} onCancel={() => setEditing(null)} />
      )}
      {set && editing !== "weekly" && (
        <button type="button" data-allowance={shown.level} onClick={() => setPercent((on) => !on)} aria-label={t("usage.allowance.toggle")}
          className="flex w-full cursor-pointer flex-col gap-1.5 rounded-lg px-2 py-2 text-start hover:bg-ink/[0.035] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
          <span className="flex w-full items-baseline justify-between gap-2">
            <span className="text-[15px] leading-5 tabular-nums text-ink">
              {percent
                ? t("usage.allowance.used", { percent: sharePercent(shown.share) })
                : t("usage.allowance.of", { spent: formatCost(shown.spentUsd), limit: formatCost(shown.limitUsd!) })}
            </span>
            <span className="text-[12px] leading-4 text-ink-secondary">{t("usage.allowance.resets", { when: resets })}</span>
          </span>
          <span className="h-1 w-full overflow-hidden rounded-full bg-ink/[0.07]" aria-hidden="true">
            <span className={cn("block h-full rounded-full", over ? "bg-danger" : "bg-ink/70")} style={{ width: `${Math.max(1, shown.share * 100)}%` }} />
          </span>
        </button>
      )}
      {near && !shown.dismissed && (
        <div className="flex flex-col gap-2 px-2 pb-2 pt-1" role="status" data-allowance-notice="near">
          <p className="m-0 text-[13px] leading-[18px] text-ink">
            {t("usage.allowance.near", { spent: formatCost(shown.spentUsd), limit: formatCost(shown.limitUsd!), top: names(shown), when: resets })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {!shown.saver && <button type="button" disabled={busy} className={buttonCls} onClick={() => void act(() => setSaver(true))}>{t("usage.allowance.saverWeek")}</button>}
            {pauseTop && <button type="button" disabled={busy} className={buttonCls} data-allowance-pause={pauseTop.id}
              onClick={() => void act(async () => { await api(`/api/routines/${encodeURIComponent(pauseTop.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) }); return fetchAllowance(); })}>
              {t("usage.allowance.pause", { name: pauseTop.name })}
            </button>}
            <button type="button" disabled={busy} className={buttonCls} onClick={() => void act(dismissAllowance)}>{t("usage.allowance.leave")}</button>
          </div>
        </div>
      )}
      {over && (
        <div className="flex flex-col gap-2 px-2 pb-2 pt-1" role="status" data-allowance-notice="over">
          <p className="m-0 text-[13px] leading-[18px] text-ink">
            {t("usage.allowance.over", { limit: formatCost(shown.limitUsd!) })}
            {shown.overrunUsd > 0 ? ` ${t("usage.allowance.overrun", { amount: formatCost(shown.overrunUsd) })}` : ""}
          </p>
          {shown.skipped.length > 0 && (
            <div>
              <p className="m-0 text-[12px] leading-4 text-ink-secondary">{t("usage.allowance.skipping", { count: String(shown.skipped.length) })}</p>
              <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-[13px] leading-[18px] text-ink" data-allowance-skipped="">
                {shown.skipped.slice(0, 6).map((one) => (
                  <li key={one.routineId} className="flex justify-between gap-2"><span className="truncate">{one.name}</span><span className="shrink-0 tabular-nums text-ink-secondary">{resetWhen(one.at)}</span></li>
                ))}
              </ul>
            </div>
          )}
          <p className="m-0 text-[12px] leading-4 text-ink-secondary">{t("usage.allowance.overTail", { when: resets, left: resetIn(shown.resetAt) })}</p>
          <div className="flex flex-wrap gap-1.5">
            {!shown.dismissed && <button type="button" disabled={busy} className={buttonCls} onClick={() => void act(dismissAllowance)}>{t("usage.allowance.wait", { when: resets })}</button>}
            {offer > 0 && <button type="button" disabled={busy} className={buttonCls} data-allowance-add={offer} onClick={() => void act(() => addForWeek(offer))}>{t("usage.allowance.add", { amount: formatCost(offer) })}</button>}
          </div>
        </div>
      )}
      {set && (
        <SwitchRow data-sheet-row="saver" title={t("usage.allowance.saver")} checked={shown.saver} disabled={busy} onChange={() => void act(() => setSaver(!shown.saver))}
          hint={shown.saver ? t("usage.allowance.saverOn", { when: resets }) : t("usage.allowance.saverHint")} />
      )}
      {set && editing !== "auto" && (
        <div className={cn(rowCls, "justify-between")} data-allowance-auto={shown.autoTopUp.on ? "on" : "off"}>
          <span className="min-w-0">
            <span className="block text-[13px] leading-[18px] text-ink">{t("usage.allowance.auto")}</span>
            <span className="block text-[12px] leading-4 text-ink-secondary">
              {shown.autoTopUp.on
                ? t("usage.allowance.autoOn", { step: formatCost(shown.autoTopUp.stepUsd), ceiling: formatCost(shown.autoTopUp.monthlyCeilingUsd), used: formatCost(shown.autoTopUp.monthUsd) })
                : t("usage.allowance.autoOff")}
            </span>
          </span>
          {shown.autoTopUp.on
            ? <button type="button" disabled={busy} className={buttonCls} onClick={() => void act(() => saveAutoTopUp({ on: false, stepUsd: 0, monthlyCeilingUsd: 0 }))}>{t("usage.allowance.autoTurnOff")}</button>
            : <button type="button" className={buttonCls} onClick={() => setEditing("auto")}>{t("usage.allowance.autoTurnOn")}</button>}
        </div>
      )}
      {editing === "auto" && (
        <AmountForm label={t("usage.allowance.autoCeiling")} hint={t("usage.allowance.autoHint", { step: formatCost(offer) })} busy={busy}
          onSave={(ceiling) => void act(() => saveAutoTopUp({ on: true, stepUsd: Math.min(offer, ceiling), monthlyCeilingUsd: ceiling }))} onCancel={() => setEditing(null)} />
      )}
      {set && editing !== "weekly" && (
        <div className={cn(rowCls, "gap-1.5")}>
          <button type="button" className={buttonCls} onClick={() => setEditing("weekly")}>{t("usage.cap.change")}</button>
          <button type="button" disabled={busy} className={buttonCls} onClick={() => void act(() => saveAllowance(null))}>{t("usage.allowance.remove")}</button>
        </div>
      )}
      {error && <p role="alert" className="m-0 px-2 pb-1.5 text-[12px] leading-4 text-danger">{error}</p>}
    </RowsCard>
  );
}
