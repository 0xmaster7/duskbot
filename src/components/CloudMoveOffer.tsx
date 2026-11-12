import { useEffect, useRef, useState } from "react";
import type { CloudSendNotice } from "../../electron/cloud-send.mjs";
import { MOVE_LINE } from "../../electron/cloud-send-parts.mjs";
import { Loader2, X } from "../icons";
import { track } from "@/lib/analytics";
import { ipcErrorText, moveLine } from "@/lib/cloud-send";
import { moveOfferBridge, movedBody, movedHeadline, offerAsk, offerWhat } from "@/lib/cloud-move-offer";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { reducedMotion } from "@/lib/onboarding";
import { useStore } from "@/state/store";
import { MausAvatar } from "./Avatar";
import { useCloudSendNotice } from "./CloudSendStrip";
import { GrokDialog, mdPrimaryCls, mdSecondaryCls, rowHintCls } from "./ui/GrokDialog";

const LINE = cn(rowHintCls, "m-0 text-pretty font-[450]");

/** The sheet's own state in this window: asking, or following the move it just started. */
type Sheet = "ask" | "moving" | null;

/**
 * The offer to move this computer's bots to the person's new dusk cloud, on this computer's page or My Cloud's: the sheet
 * asks once by itself; closed, a slim line at the top of the window asks; closed too, Settings → Computer keeps the action
 * (CloudMoveSettings). After the yes the sheet follows the move until the person goes on using the app, and on My Cloud's
 * page, once the move is done, says what arrived.
 */
export function CloudMoveOffer({ cloudHome = false }: { cloudHome?: boolean }) {
  const { state } = useStore();
  const bridge = moveOfferBridge();
  const [notice, setNotice] = useCloudSendNotice(bridge);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const declined = useRef(false);
  const waits = !state.connected || !state.config || state.appSettingsOpen || state.settingsOpen || state.pluginsOpen || state.shortcutsOpen;
  const ask = waits ? null : offerAsk(notice);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (ask === "prompt" && sheet === null && !declined.current) setSheet("ask");
  }, [ask, sheet]);
  useEffect(() => {
    const surface = sheet === "ask" ? "prompt" : ask === "banner" ? "banner" : null;
    if (!surface || shown.current === surface) return;
    shown.current = surface;
    track(`cloud_move_${surface}`, { action: "shown" });
  }, [sheet, ask]);

  if (!bridge?.moveOfferAccept || !notice) return null;

  const accept = (from: "prompt" | "banner") => {
    if (busy) return;
    setBusy(true); setError(null);
    void bridge.moveOfferAccept!(from).then((next: CloudSendNotice) => { setNotice(next); setSheet("moving"); })
      .catch((cause: unknown) => setError(ipcErrorText(cause) ? t("cloudMoveOffer.startFailed", { error: ipcErrorText(cause)! }) : t("cloudMoveOffer.startFailedPlain")))
      .finally(() => setBusy(false));
  };
  const dismiss = (which: "prompt" | "banner") => {
    if (which === "prompt") { declined.current = true; setSheet(null); }
    setError(null);
    void bridge.moveOfferDismiss?.(which).then(setNotice).catch(() => {});
  };

  const move = notice.move;
  const done = cloudHome && move?.phase === "done" && !move.place;
  if (done) {
    const close = () => { void bridge.dismiss(MOVE_LINE).then(setNotice).catch(() => {}); };
    return <GrokDialog data-panel-modal="cloud-move-done" title={movedHeadline(move.counts)} onClose={close} width={420}
      footer={<button type="button" data-autofocus className={mdPrimaryCls} onClick={close}>{t("cloudMoveOffer.gotIt")}</button>}>
      <div data-cloud-move="done" className="flex items-start gap-3">
        <Mascot state="celebrate" />
        <p role="status" className={LINE}>{movedBody(move.counts)}</p>
      </div>
    </GrokDialog>;
  }

  if (sheet === "moving") {
    const line = move ? moveLine(move, cloudHome ? "cloud" : "local") : null;
    const close = () => setSheet(null);
    if (move && !line) return null;
    return <GrokDialog data-panel-modal="cloud-move-progress" title={t("cloudMoveOffer.movingTitle")} onClose={close} width={420}
      footer={<button type="button" data-autofocus className={mdSecondaryCls} onClick={close}>{t("cloudMoveOffer.keepUsing")}</button>}>
      <div data-cloud-move={line?.kind ?? "sending"} className="flex items-start gap-3">
        <Mascot state="uploading" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <p role="status" className={cn(LINE, "inline-flex items-start gap-2 text-ink")}>
            {line?.kind !== "failed" && <Loader2 size={14} aria-hidden="true" className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none" />}
            <span>{line?.text ?? t("cloudMoveOffer.movingTitle")}</span>
          </p>
          <p className={LINE}>{t("cloudMoveOffer.movingHint")}</p>
        </div>
      </div>
    </GrokDialog>;
  }

  if (sheet === "ask" && notice.offer) {
    return <GrokDialog data-panel-modal="cloud-move-offer" title={t("cloudMoveOffer.title")} onClose={() => dismiss("prompt")} width={420}
      footer={<>
        <button type="button" className={mdSecondaryCls} disabled={busy} onClick={() => dismiss("prompt")}>{t("cloudMoveOffer.notNow")}</button>
        <button type="button" data-autofocus data-cloud-move-accept="prompt" className={mdPrimaryCls} disabled={busy} aria-busy={busy || undefined} onClick={() => accept("prompt")}>
          {busy && <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />}
          {t("cloudMoveOffer.move")}
        </button>
      </>}>
      <div data-cloud-move="offer" className="flex items-start gap-3">
        <Mascot state="curious" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className={cn(LINE, "text-ink")}>{t("cloudMoveOffer.body")}</p>
          <p className={LINE}>{offerWhat(notice.offer.bots)}</p>
          <p className={LINE}>{t("cloudMoveOffer.safe")}</p>
          {error && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{error}</p>}
        </div>
      </div>
    </GrokDialog>;
  }

  if (ask === "banner") {
    return <div role="region" aria-label={t("cloudMoveOffer.banner")} data-cloud-move-banner="" className="flex min-h-9 items-center justify-center gap-3 bg-raised/50 px-3 py-1.5 text-[13px] font-[450] text-ink">
      <span className="min-w-0 truncate">{t("cloudMoveOffer.banner")}</span>
      <button type="button" data-cloud-move-accept="banner" disabled={busy} aria-busy={busy || undefined} onClick={() => accept("banner")}
        className="ui-button ui-button-sm ui-button-primary shrink-0 gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        {busy && <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />}
        {t("cloudMoveOffer.bannerMove")}
      </button>
      {error && <span role="alert" className="min-w-0 truncate text-[12px] text-danger">{error}</span>}
      <button type="button" aria-label={t("cloudMoveOffer.bannerClose")} onClick={() => dismiss("banner")}
        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink/68 transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
        <X size={14} aria-hidden="true" />
      </button>
    </div>;
  }
  return null;
}

function Mascot({ state }: { state: "curious" | "uploading" | "celebrate" }) {
  return <span aria-hidden="true" className="shrink-0"><MausAvatar color="green" state={state} size={40} trackPointer={false} animated={!reducedMotion()} /></span>;
}
