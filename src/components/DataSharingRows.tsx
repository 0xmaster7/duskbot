import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/state/api";
import { t } from "@/lib/i18n";
import { setUsageAnalytics } from "@/lib/product-analytics";
import type { LocaleKey } from "@/locales";
import { SwitchRow } from "./ListRows";

/** A hint whose promise reads at a glance: its {never} is drawn bold. */
function promise(key: LocaleKey): ReactNode {
  const [before, ...rest] = t(key).split("{never}");
  if (!rest.length) return before;
  return <>{before}<strong className="font-semibold text-ink">{t("settings.dataSharing.never")}</strong>{rest.join(t("settings.dataSharing.never"))}</>;
}

type Choice = { enabled: boolean; summaries: boolean };

/** What this workspace shares: usage counts, the summaries written on this computer when a chat goes badly or once a
 * week, and (on the desktop) error reports. All on by default; never message content. */
export function DataSharingRows() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [errors, setErrors] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const bridge = typeof window === "undefined" ? undefined : window.duskDesktop?.desktopErrorReports;
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
        void window.duskDesktop?.desktopAnalytics?.set?.(next.enabled);
      }
    } catch { setFailed(true); }
  };
  if (!choice && !bridge) return failed ? <p className="px-3 py-2 text-[13px] text-ink/60">{t("settings.dataSharing.unavailable")}</p> : null;
  return (
    <>
      {choice && <SwitchRow title={t("settings.dataSharing.usage")} hint={promise("settings.dataSharing.note")} checked={choice.enabled} onChange={() => void save({ enabled: !choice.enabled })} />}
      {choice && <SwitchRow title={t("settings.dataSharing.summaries")} hint={promise("settings.dataSharing.summariesHint")} checked={choice.enabled && choice.summaries} disabled={!choice.enabled}
        onChange={() => void save({ summaries: !choice.summaries })} />}
      {bridge && errors !== null && <SwitchRow title={t("settings.dataSharing.errors")} hint={promise("settings.dataSharing.errorsHint")} checked={errors}
        onChange={() => { const next = !errors; setErrors(next); void bridge.set(next).catch(() => setErrors(!next)); }} />}
      {failed && <p role="alert" className="px-3 py-2 text-[13px] text-danger">{t("settings.dataSharing.error")}</p>}
    </>
  );
}
