import { useState } from "react";
import type { CloudSendNotice } from "../../electron/cloud-send.mjs";
import { Loader2 } from "../icons";
import { moveOfferBridge, moveSheetState } from "@/lib/cloud-move-offer";
import { t } from "@/lib/i18n";
import { useCloudSendNotice } from "./CloudSendStrip";
import { useWorkspacePlace } from "./DesktopWorkspaceSwitcher";
import { Card as RowsCard, ItemRow } from "./ListRows";
import { mdPrimaryCls, mdSecondaryCls } from "./ui/GrokDialog";

/** Settings → Computer, one row: the workspace this window shows with its switch (the sidebar's native menu), and Move to
 * dusk cloud beside it while one is offered; while the bots move, how it goes, and Try again when it got stuck. */
export function CloudMoveSettings({ cloudHome = false }: { cloudHome?: boolean }) {
  const bridge = moveOfferBridge();
  const [notice, setNotice] = useCloudSendNotice(bridge);
  const place = useWorkspacePlace({ cloudHome });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const moving = moveSheetState(notice?.move);
  const offered = Boolean(notice?.offer) && !moving;
  const switchable = place.switchable && Boolean(place.current);
  if (!switchable && !offered && moving !== "moving" && moving !== "failed") return null;

  const run = (work: () => Promise<CloudSendNotice> | undefined) => {
    if (busy) return;
    const started = work();
    if (!started) return;
    setBusy(true); setFailed(false);
    void started.then(setNotice).catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  const name = place.current?.name ?? "";
  const stuck = failed || moving === "failed";
  const hint = stuck ? t("cloudMoveOffer.failed") : moving === "moving" ? t("cloudMoveOffer.moving") : offered ? t("cloudMoveOffer.banner") : name;
  const spinner = busy && <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />;
  return <RowsCard data-settings-block="workspace">
    <ItemRow data-panel-row="workspace" title={switchable ? <>{t("cloudMoveOffer.workspace")} · {name}</> : t("cloudMoveOffer.workspace")}
      hint={<span role="status" className="font-medium">{hint}</span>} tone={stuck ? "warn" : undefined}>
      {moving === "moving" && !stuck && <Loader2 size={14} aria-hidden="true" className="shrink-0 animate-spin text-ink-secondary motion-reduce:animate-none" />}
      {stuck && <button type="button" className={mdPrimaryCls} disabled={busy} aria-busy={busy || undefined}
        onClick={() => run(() => (moving === "failed" ? bridge?.moveRetry?.() : bridge?.moveOfferAccept?.("settings")))}>{spinner}{t("cloudMoveOffer.tryAgain")}</button>}
      {offered && !stuck && <button type="button" data-cloud-move-accept="settings" className={mdPrimaryCls} disabled={busy} aria-busy={busy || undefined}
        onClick={() => run(() => bridge?.moveOfferAccept?.("settings"))}>{spinner}{t("cloudMoveOffer.move")}</button>}
      {switchable && <button type="button" className={mdSecondaryCls} aria-haspopup="menu" aria-expanded={place.open} aria-label={t("cloudMoveOffer.workspaceSwitchName", { name })}
        onClick={place.openMenu}>{t("cloudMoveOffer.workspaceSwitch")}</button>}
    </ItemRow>
  </RowsCard>;
}
