import { useSyncExternalStore } from "react";

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** The sidebar footer's spot above Connect apps, set by the footer while it is on screen. */
export function setSidebarFooterSlot(element: HTMLElement | null): void {
  if (element === slot) return;
  slot = element;
  for (const listener of listeners) listener();
}

/** Where a card that belongs above Connect apps goes: null while no sidebar footer is on screen. */
export function useSidebarFooterSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => slot,
    () => null,
  );
}
