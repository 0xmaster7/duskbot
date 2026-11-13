import { t } from "@/lib/i18n";
import { useHelpImprove } from "@/lib/help-improve";
import { SwitchRow } from "./ListRows";

/** The hint, its {never} in the same weight as the rest. */
const promise = () => t("settings.dataSharing.improveHint", { never: t("settings.dataSharing.never") });

/** The single "help improve dusk bot" row: anonymous usage info, notes on how sessions went and crash reports, all
 * scrubbed on this computer first. On by default. */
export function DataSharingRows() {
  const { on, failed, set } = useHelpImprove();
  if (on === null) return failed ? <p className="px-3 py-2 text-[13px] text-ink/60">{t("settings.dataSharing.unavailable")}</p> : null;
  return (
    <>
      <SwitchRow title={t("settings.dataSharing.improve")} hint={promise()} checked={on} onChange={() => void set(!on)} />
      {failed && <p role="alert" className="px-3 py-2 text-[13px] text-danger">{t("settings.dataSharing.error")}</p>}
    </>
  );
}
