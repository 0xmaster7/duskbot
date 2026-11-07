import { t } from "@/lib/i18n";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { Card, ItemRow } from "./ListRows";
import { MacLocalControl } from "./MacLocalControl";
import { WindowsLocalControl } from "./WindowsLocalControl";
import { LinuxLocalControl } from "./LinuxLocalControl";

export function NativeComputerSettings() {
  const { capabilities, ready } = useDesktopCapabilities();
  const local = capabilities.localComputer;
  if (typeof window === "undefined" || !window.ogb || !local || local.reasonCode === "remote-server" || window.ogb.remoteClient?.active === true) return null;
  return <div data-settings-block="native-computer">
    <Card label={t("settings.grok.group.yourComputer")}>
      <ItemRow title={t("settings.native.title")} hint={t("settings.native.hint")}>
        <span data-native-computer-state={!ready ? "checking" : local.available ? "working" : "unavailable"} className={ready && local.available ? "text-[13px] text-success" : "text-[13px] text-ink-secondary"}>
          {!ready ? t("common.checking") : local.available ? t("settings.vps.working") : t("settings.native.unavailable")}
        </span>
      </ItemRow>
    </Card>
    {ready && <><MacLocalControl /><WindowsLocalControl /><LinuxLocalControl /></>}
  </div>;
}
