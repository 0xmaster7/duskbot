import { t } from "@/lib/i18n";
import { useHelpImprove } from "@/lib/help-improve";
import { SettingRow, Switch } from "./SettingsPrimitives";

/** The single "help improve dusk bot" row: anonymous usage info, notes on how sessions went and crash reports, all
 * scrubbed on this computer first. Off until the person turns it on. */
export function DataSharingRows() {
  const { on, failed, set } = useHelpImprove();
  if (on === null) return failed ? <p className="px-3 py-2 text-[13px] text-ink/60">{t("settings.dataSharing.unavailable")}</p> : null;
  return (
    <SettingRow icon="shield" title={t("settings.dataSharing.improve")} subtitle={t("settings.dataSharing.improveHint")}
      message={failed ? <p role="alert" className="text-danger">{t("settings.dataSharing.error")}</p> : null}>
      <Switch checked={on} aria-label={t("settings.dataSharing.improve")} onClick={() => void set(!on)} />
    </SettingRow>
  );
}
