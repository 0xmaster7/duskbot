import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/plain-error";
import { exportUsageLog, trailAvailable } from "@/lib/trail";
import { SettingRow } from "./SettingsPrimitives";

/** Settings > advanced: the scrubbed usage log (electron/trail-main.mjs), saved where the person picks, then offered to support */
export function UsageLogRow() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  if (!trailAvailable()) return null;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const done = await exportUsageLog("settings");
      if (done?.saved) setResult({ kind: "success", message: t(done.sent ? "settings.usageLog.sent" : "settings.usageLog.saved") });
    } catch (error) {
      setResult({ kind: "error", message: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingRow
      title={t("settings.usageLog.title")}
      subtitle={t("settings.usageLog.preview")}
      message={result && <span role={result.kind === "error" ? "alert" : "status"} className={cn("block", result.kind === "error" ? "text-danger" : "text-ink-secondary")}>{result.message}</span>}
    >
      <button type="button" data-trail="export-usage-log" onClick={() => void run()} disabled={busy} className="ui-button">
        {busy ? t("settings.usageLog.exporting") : t("settings.usageLog.export")}
      </button>
    </SettingRow>
  );
}
