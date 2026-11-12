import { useEffect, useState } from "react";
import { api } from "@/state/api";
import { t } from "@/lib/i18n";
import { setUsageAnalytics } from "@/lib/product-analytics";
import { SwitchRow } from "./ListRows";

type Choice = { enabled: boolean; summaries: boolean };

/** What this workspace shares: usage counts, the summaries written on this computer when a chat goes badly or once a
 * week, and (on the desktop) error reports. All on by default; never message content. */
export function DataSharingRows() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [errors, setErrors] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.desktopErrorReports;
  useEffect(() => {
    let live = true;
    api<Choice>("/api/dashboard/usage-signals").then((answer) => { if (live) setChoice(answer); }, () => { if (live) setFailed(true); });
    bridge?.enabled().then((on) => { if (live) setErrors(on); }, () => {});
    return () => { live = false; };
  }, [bridge]);
  const save = async (next: Partial<Choice>) => {
    try {
      setChoice(await api<Choice>("/api/dashboard/usage-signals", { method: "PUT", body: JSON.stringify(next) }));
      setFailed(false);
      if (next.enabled !== undefined) {
        setUsageAnalytics(next.enabled);
        void window.ogb?.desktopAnalytics?.set?.(next.enabled);
      }
    } catch { setFailed(true); }
  };
  if (!choice && !bridge) return failed ? <p className="px-3 py-2 text-[13px] text-ink/60">{t("settings.dataSharing.unavailable")}</p> : null;
  return (
    <>
      {choice && <SwitchRow title={t("settings.dataSharing.usage")} hint={t("settings.dataSharing.note")} checked={choice.enabled} onChange={() => void save({ enabled: !choice.enabled })} />}
      {choice && <SwitchRow title={t("settings.dataSharing.summaries")} hint={t("settings.dataSharing.summariesHint")} checked={choice.enabled && choice.summaries} disabled={!choice.enabled}
        onChange={() => void save({ summaries: !choice.summaries })} />}
      {bridge && errors !== null && <SwitchRow title={t("settings.dataSharing.errors")} hint={t("settings.dataSharing.errorsHint")} checked={errors}
        onChange={() => { const next = !errors; setErrors(next); void bridge.set(next).catch(() => setErrors(!next)); }} />}
      {failed && <p role="alert" className="px-3 py-2 text-[13px] text-danger">{t("settings.dataSharing.error")}</p>}
    </>
  );
}
