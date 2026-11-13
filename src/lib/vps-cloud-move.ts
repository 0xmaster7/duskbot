import { useEffect, useState } from "react";
import type { CloudOffer } from "../../electron/cloud-home.mjs";

export type VpsMoveRoute = "direct" | "via-mac";
export interface VpsMoveCounts { bots?: number; chats?: number; routines?: number; skills?: number; [key: string]: unknown }

export type VpsCloudMoveView =
  | { stage: "none"; cloud: "signed-out" | "none" | "starting" | "ready" }
  | { stage: "buying" | "waiting"; place: string; route: VpsMoveRoute }
  | { stage: "moving"; place: string; route: VpsMoveRoute; phase: string; chats?: { done: number; total: number }; waitingFor?: string; retrying?: boolean; error?: string | null }
  | { stage: "fallback"; place: string; route: "via-mac"; why?: "outdated" | "vps_failing"; phase?: string }
  | { stage: "failed"; place: string; route: VpsMoveRoute; error: string | null }
  | { stage: "done"; place: string; route: VpsMoveRoute; counts?: VpsMoveCounts; stays?: string };

export interface VpsCloudMoveBridge {
  view(): Promise<VpsCloudMoveView>;
  /** The four below need the person's click. */
  start(): Promise<VpsCloudMoveView>;
  /** Opens the plans on dusk.bot already signed in; rejects with "Sign in to dusk cloud first." while signed out. */
  buy(plan?: "plus" | "pro"): Promise<VpsCloudMoveView>;
  retry(): Promise<VpsCloudMoveView>;
  /** Only before anything moved. */
  cancel(): Promise<VpsCloudMoveView>;
  onChange(callback: (view: VpsCloudMoveView) => void): () => void;
  /** True once when the person asked for this server's move sheet from elsewhere (the rail, the dashboard). */
  asked?(): Promise<boolean>;
  onShow?(callback: () => void): () => void;
}

export const SIGN_IN_FIRST = "Sign in to dusk cloud first.";

export function vpsCloudMoveBridge(): VpsCloudMoveBridge | null {
  const bridge = typeof window === "undefined" ? undefined : window.duskDesktop?.vpsCloudMove;
  return bridge ?? null;
}

/** The move's view as main tells it: read once, then every change. Null until the first answer, or with no bridge. */
export function useVpsCloudMove(enabled: boolean): { bridge: VpsCloudMoveBridge | null; view: VpsCloudMoveView | null; set: (view: VpsCloudMoveView) => void } {
  const bridge = enabled ? vpsCloudMoveBridge() : null;
  const [view, setView] = useState<VpsCloudMoveView | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let alive = true, changed = false;
    const off = bridge.onChange((next) => { changed = true; if (alive) setView(next); });
    void bridge.view().then((next) => { if (alive && !changed) setView(next); }, () => {});
    return () => { alive = false; off(); };
  }, [bridge]);
  return { bridge, view: bridge ? view : null, set: setView };
}

/** The plans' price: cloudAdd is the one account bridge a server's page gets. */
export function useVpsCloudOffer(enabled: boolean): CloudOffer | null {
  const add = enabled ? window.duskDesktop?.cloudAdd : undefined;
  const [offer, setOffer] = useState<CloudOffer | null>(null);
  useEffect(() => {
    if (!add?.state) return;
    let alive = true;
    void add.state().then((view) => { if (alive && view.signedIn) setOffer(view.offer); }, () => {});
    return () => { alive = false; };
  }, [add]);
  return offer;
}
