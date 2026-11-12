import { useSyncExternalStore } from "react";

function subscribe(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

let lastEvent: "online" | "offline" | null = null;
if (typeof globalThis.window?.addEventListener === "function") {
  window.addEventListener("online", () => { lastEvent = "online"; }, { capture: true });
  window.addEventListener("offline", () => { lastEvent = "offline"; }, { capture: true });
}

/** The phone has no network: the system said so, either through its flag or its last online/offline event. */
export function phoneOffline(): boolean {
  if (lastEvent) return lastEvent === "offline";
  return globalThis.navigator?.onLine === false;
}

export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, phoneOffline, () => false);
}
