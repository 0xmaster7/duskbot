import { useSyncExternalStore } from "react";

/** The bot's own settings that open as a centred dialog over the panel instead of a page inside it. */
export const MODAL_PAGES = ["instructions", "memory", "skills", "folder", "where", "backups"] as const;
export type ModalPage = (typeof MODAL_PAGES)[number];

export function isModalPage(page: string | undefined): page is ModalPage {
  return page !== undefined && (MODAL_PAGES as readonly string[]).includes(page);
}

export interface ModalRequest {
  page: ModalPage;
  nonce: number;
}

let pending: ModalRequest | null = null;
let count = 0;
const watchers = new Set<() => void>();
// a request can be made while the panel renders: tell the watchers after it
const notify = () => queueMicrotask(() => { for (const watch of Array.from(watchers)) watch(); });

/** Asks the Advanced tab to open `page`'s dialog; a deep link lands there and the tab picks the request up. */
export function requestPanelModal(page: ModalPage): void {
  pending = { page, nonce: ++count };
  notify();
}

/** Marks a request as handled, unless a newer one came meanwhile. */
export function takePanelModalRequest(request: ModalRequest): void {
  if (pending !== request) return;
  pending = null;
  notify();
}

function subscribe(watch: () => void) {
  watchers.add(watch);
  return () => {
    watchers.delete(watch);
  };
}

const snapshot = () => pending;

export function usePanelModalRequest(): ModalRequest | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The dialog asked for and not yet opened, if any. */
export function pendingPanelModal(): ModalRequest | null {
  return pending;
}
