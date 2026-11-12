import type { CloudSendNotice, CloudSendPageBridge } from "../../electron/cloud-send.mjs";
import type { OneHomeCounts } from "../../electron/one-home.mjs";
import { arrivedList, listOf } from "@/lib/cloud-send";
import { t } from "@/lib/i18n";

export type MoveOfferSurface = "prompt" | "banner" | "settings";

/** The move's page bridge, in the desktop app only: never in a browser. */
export function moveOfferBridge(): CloudSendPageBridge | undefined {
  return typeof window !== "undefined" && !window.duskDesktop?.remoteClient?.active ? window.duskDesktop?.cloudSendPage : undefined;
}

/** Which ask the window shows by itself now: the sheet, the line at the top, or none (Settings keeps it either way). */
export function offerAsk(notice: CloudSendNotice | null | undefined): "prompt" | "banner" | null {
  const stage = notice?.offer?.stage;
  return stage === "prompt" || stage === "banner" ? stage : null;
}

/** "12 bots moved to dusk cloud", from what the move checked on both sides. */
export function movedHeadline(counts: OneHomeCounts | undefined): string {
  if (!counts?.bots) return t("cloudMoveOffer.doneAll");
  return counts.bots === 1 ? t("cloudMoveOffer.doneOne") : t("cloudMoveOffer.doneMany", { count: counts.bots });
}

/** What arrived besides the bots, in one sentence; the plain line when nothing else came. */
export function movedBody(counts: OneHomeCounts | undefined): string {
  const rest = counts ? arrivedList({ ...counts, bots: 0 }) : [];
  return rest.length ? t("cloudMoveOffer.doneBody", { list: listOf(rest) }) : t("cloudMoveOffer.doneKept");
}

export function offerWhat(bots: number): string {
  return bots === 1 ? t("cloudMoveOffer.whatOne") : t("cloudMoveOffer.whatMany", { count: bots });
}
