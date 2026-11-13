import type { Freshness } from "../../../../shared/dashboard-protocol.ts";
import { ago } from "../lib/format.ts";
import type { CloudDesktop } from "./contracts.ts";

export type PlaceTone = "good" | "warn" | "quiet" | "accent" | "bad";
export interface PlaceState { label: string; tone: PlaceTone; live: boolean }

/** how a workspace reads to its owner. a dusk cloud follows the cloud itself: one we put to sleep to save cost
 *  reads online (any use wakes it), and only its owner's own pause reads stopped. a mac or server that went
 *  quiet just says when it was last seen, never an alarming "offline" */
export function placeState(freshness: Freshness, at: number | null, now: number, cloud?: CloudDesktop | null): PlaceState {
  if (cloud) {
    if (cloud.awaitingPayment) return { label: "waiting for payment", tone: "quiet", live: false };
    if (cloud.status === "running") return { label: "online", tone: "good", live: true };
    if (cloud.status === "waking") return { label: "waking up", tone: "warn", live: true };
    if (cloud.status === "provisioning") return { label: "setting up", tone: "accent", live: true };
    if (cloud.status === "error") return { label: "needs attention", tone: "bad", live: false };
    return { label: "stopped", tone: "quiet", live: false };
  }
  if (freshness === "live") return { label: "online", tone: "good", live: true };
  if (freshness === "recent") return { label: `updated ${ago(at, now)}`, tone: "warn", live: false };
  if (freshness === "offline") return { label: `last seen ${ago(at, now)}`, tone: "quiet", live: false };
  return { label: "waiting for its first report", tone: "quiet", live: false };
}

export const TONE_TEXT: Record<PlaceTone, string> = { good: "text-good", warn: "text-warn", quiet: "text-ink-4", accent: "text-accent", bad: "text-bad" };

/** the freshness bots should wake or sleep by: a running cloud's bots are awake even before its first report lands */
export const botFreshness = (freshness: Freshness, cloud?: CloudDesktop | null): Freshness | undefined => (cloud?.status === "running" ? undefined : freshness);
