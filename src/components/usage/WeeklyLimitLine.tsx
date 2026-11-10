import { useEffect, useState } from "react";
import { useLimitReached } from "@/lib/allowance-notice";
import { t } from "@/lib/i18n";
import { resetWhen, setSaver } from "@/lib/spend";

/** Whether a send failed only because the week's limit is reached (the server's refusal, in any language it has). */
export function isLimitRefusal(text: string | null | undefined): boolean {
  if (!text) return false;
  const pattern = t("server.allowance.refused").split(/\{\w+\}/).map((part) => part.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&")).join("[\\s\\S]+");
  return new RegExp(`^${pattern}$`).test(text);
}

/** One small line above the message box while the week's limit is reached: "Weekly limit reached · Saver mode". No
 * amounts here; they live in Usage & Billing. While it shows, a send the limit refused says nothing more: the draft
 * stays in the box and this line already says why. */
export function WeeklyLimitLine({ onSeeUsage, error, clearError }: { onSeeUsage: () => void; error?: string | null; clearError?: () => void }) {
  const limit = useLimitReached();
  const [busy, setBusy] = useState(false);
  const refused = Boolean(limit) && isLimitRefusal(error);
  useEffect(() => { if (refused) clearError?.(); }, [refused, clearError]);
  if (!limit) return null;
  const { report } = limit;
  return (
    <div role="status" data-weekly-limit={report.saver ? "saver" : "waiting"} className="flex items-center gap-1.5 px-1 pb-1.5 text-[12px] leading-4 text-ink-secondary">
      <span>{t("composer.limit.reached")}</span>
      <span aria-hidden="true">·</span>
      {report.saver
        ? <button type="button" onClick={onSeeUsage} className="cursor-pointer text-ink-secondary hover:text-ink">{t("composer.limit.saverOn")}</button>
        : (
          <button type="button" disabled={busy} title={t("composer.limit.until", { when: resetWhen(report.resetAt) })}
            onClick={() => { setBusy(true); void setSaver(true).then(limit.update, () => {}).finally(() => setBusy(false)); }}
            className="cursor-pointer text-ink hover:underline disabled:opacity-50">
            {t("composer.limit.saver")}
          </button>
        )}
    </div>
  );
}
