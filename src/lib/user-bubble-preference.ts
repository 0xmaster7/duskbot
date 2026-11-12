import { useSyncExternalStore } from "react";

export const USER_BUBBLE_COLOR_KEY = "dusk-color-user-bubbles";

let sessionChoice: boolean | undefined;
let unsetChoice = true;

/** What an unset preference reads as: the phone keeps your bubbles one neutral tone in every chat and room. */
export function setColorUserBubblesDefault(enabled: boolean): void {
  unsetChoice = enabled;
  notify();
}
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readColorUserBubbles(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    const saved = storage()?.getItem(USER_BUBBLE_COLOR_KEY);
    return saved == null ? unsetChoice : saved !== "0";
  } catch {
    return unsetChoice;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== USER_BUBBLE_COLOR_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionChoice = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function setColorUserBubbles(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    storage()?.setItem(USER_BUBBLE_COLOR_KEY, enabled ? "1" : "0");
  } catch {
  }
  notify();
}

export function useColorUserBubbles(): boolean {
  return useSyncExternalStore(subscribe, readColorUserBubbles, readColorUserBubbles);
}
