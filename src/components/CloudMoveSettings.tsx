import { useState } from "react";
import type { CloudSendNotice } from "../../electron/cloud-send.mjs";
import { Loader2 } from "../icons";
import { ipcErrorText, moveLine } from "@/lib/cloud-send";
import { moveOfferBridge } from "@/lib/cloud-move-offer";
import { t } from "@/lib/i18n";
import { useCloudSendNotice } from "./CloudSendStrip";
import { useWorkspacePlace } from "./DesktopWorkspaceSwitcher";
import { Card as RowsCard, ItemRow, NoteRow } from "./ListRows";

const PRIMARY = "ui-button ui-button-primary shrink-0 gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Settings → Computer: the workspace this window shows, switched through the same native menu as the sidebar's, and the
 * move of this computer's bots to dusk cloud while one is offered or under way. Nothing in a browser. */
export function CloudMoveSettings({ cloudHome = false }: { cloudHome?: boolean }) {
  const bridge = moveOfferBridge();
  const [notice, setNotice] = useCloudSendNotice(bridge);
  const place = useWorkspacePlace({ cloudHome });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offer = notice?.offer;
  const line = notice?.move ? moveLine(notice.move, cloudHome ? "cloud" : "local") : null;
  const moving = line && line.kind !== "done" ? line : null;
  const switchable = place.switchable && Boolean(place.current);
  if (!switchable && !offer && !moving) return null;

  const run = (work: () => Promise<CloudSendNotice> | undefined) => {
    if (busy) return;
    const started = work();
    if (!started) return;
    setBusy(true); setError(null);
    void started.then(setNotice).catch((cause: unknown) => setError(ipcErrorText(cause) ?? t("cloudMoveOffer.startFailedPlain"))).finally(() => setBusy(false));
  };
  const name = place.current?.name ?? "";
  return <RowsCard data-settings-block="workspace">
    {switchable && <ItemRow data-panel-row="workspace" title={t("cloudMoveOffer.workspace")} hint={<>{name} · {t("cloudMoveOffer.workspaceHint")}</>}>
      <button type="button" className="ui-button shrink-0" aria-haspopup="menu" aria-expanded={place.open} aria-label={t("cloudMoveOffer.workspaceSwitchName", { name })}
        onClick={place.openMenu}>{t("cloudMoveOffer.workspaceSwitch")}</button>
    </ItemRow>}
    {place.error && <NoteRow tone="danger">{place.error}</NoteRow>}
    {offer && !moving && <ItemRow data-panel-row="cloud-move" title={t("cloudMoveOffer.settingsTitle")}
      hint={offer.bots === 1 ? t("cloudMoveOffer.settingsHintOne") : offer.bots > 1 ? t("cloudMoveOffer.settingsHintMany", { count: offer.bots }) : t("cloudMoveOffer.body")}>
      <button type="button" data-cloud-move-accept="settings" className={PRIMARY} disabled={busy} aria-busy={busy || undefined}
        onClick={() => run(() => bridge?.moveOfferAccept?.("settings"))}>
        {busy && <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />}
        {t("cloudMoveOffer.settingsMove")}
      </button>
    </ItemRow>}
    {moving && <ItemRow data-panel-row="cloud-move" title={t("cloudMoveOffer.movingTitle")} tone={moving.kind === "failed" ? "warn" : undefined}
      hint={<span role="status">{[moving.text, ...moving.extra].join(" ")}</span>}>
      {moving.kind === "failed" && moving.retry && bridge?.moveRetry
        ? <button type="button" className="ui-button shrink-0 gap-1.5" disabled={busy} aria-busy={busy || undefined} onClick={() => run(() => bridge.moveRetry?.())}>
            {busy && <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />}
            {t("cloudSend.strip.retry")}
          </button>
        : <Loader2 size={14} aria-hidden="true" className="shrink-0 animate-spin text-ink-secondary motion-reduce:animate-none" />}
    </ItemRow>}
    {error && <NoteRow tone="danger">{error}</NoteRow>}
  </RowsCard>;
}
