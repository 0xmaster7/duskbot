import { useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { saveCap } from "@/lib/spend";
import { formatCost } from "@/lib/usage-trace";
import { buttonCls, fieldCls } from "../bot-panel/rows";

/** A weekly cap in dollars for one bot or routine: shown, set, changed or removed in place. */
export function SpendCap({ kind, id, capUsd, onSaved, className }: {
  kind: "bot" | "routine";
  id: string;
  capUsd?: number;
  onSaved: () => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(capUsd ? String(capUsd) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (usd: number | null) => {
    if (usd !== null && !(Number.isFinite(usd) && usd > 0)) return setError(t("usage.cap.invalid"));
    setBusy(true);
    setError(null);
    try {
      await saveCap({ kind, id, usd });
      setEditing(false);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!editing) {
    return (
      <div className={cn("flex flex-wrap items-center gap-1.5", className)} data-spend-cap={id}>
        <span className="text-[13px] leading-[18px] text-ink">{capUsd ? t("usage.cap.amount", { amount: formatCost(capUsd) }) : t("usage.cap.none")}</span>
        <button type="button" className={buttonCls} onClick={() => { setText(capUsd ? String(capUsd) : ""); setEditing(true); }}>
          {capUsd ? t("usage.cap.change") : t("usage.cap.set")}
        </button>
      </div>
    );
  }
  return (
    <form className={cn("flex flex-col gap-1.5", className)} data-spend-cap={id} onSubmit={(event) => { event.preventDefault(); void save(Number(text)); }}>
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-[13px] text-ink-secondary">$</span>
        <input autoFocus inputMode="decimal" aria-label={t("usage.cap.label")} value={text} onChange={(event) => setText(event.target.value.replace(/[^\d.]/g, ""))}
          className={cn(fieldCls, "max-w-24 flex-none tabular-nums")} placeholder="5" />
        <span className="text-[13px] text-ink-secondary">{t("usage.cap.perWeek")}</span>
        <button type="submit" disabled={busy} className={buttonCls}>{t("usage.cap.save")}</button>
        {capUsd ? <button type="button" disabled={busy} onClick={() => void save(null)} className={buttonCls}>{t("usage.cap.remove")}</button> : null}
        <button type="button" onClick={() => setEditing(false)} className={buttonCls}>{t("common.cancel")}</button>
      </div>
      <p className="m-0 text-[12px] leading-4 text-ink-secondary">{t(kind === "bot" ? "usage.cap.botHint" : "usage.cap.routineHint")}</p>
      {error && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{error}</p>}
    </form>
  );
}
